// Cloudflare Pages Function — POST /api/coach
//
// Keeps the AI provider's API key server-side only. In the Cloudflare
// dashboard: Workers & Pages -> your project -> Settings -> Environment
// variables -> add the active provider's key (ANTHROPIC_API_KEY for the
// default "anthropic" provider) as a Secret, not plain text -> redeploy.
// The key is read from env, passed straight to functions/_lib/aiProvider.js,
// and never appears in any response body or log line -- see
// functions/_lib/providers/anthropic.js.
//
// FULL GROUNDING PIPELINE (see functions/_lib/ for each piece -- each has
// a single, focused job, and none of them know which AI provider is active):
//   1. Rate limit + size caps (unchanged, always first)
//   2. Effective KV overrides fetched once (fetchOverrides)
//   3. Effective current patch resolved (resolveEffectivePatch) -- KV
//      override if Coach Mode set one, static src/data/patch.js otherwise.
//      This is Academy's patch and is UNRELATED to which Riot patch gets
//      fetched below -- see riotFallback.js's header comment.
//   4. Conversation-aware entity detection (detectChampionsInConversation,
//      detectItemsAndRunesInConversation) -- checks the latest message
//      first, falls back through a small recent window for follow-ups
//      that don't repeat an entity name ("what if they have a dive comp?")
//   5. Effective entity data resolved (extractChampionContext,
//      extractItemRuneContext -- both delegate the actual base+override
//      merge to src/lib/effectiveData.js, the SAME resolver src/App.jsx
//      uses for the website itself)
//   6. Priority-2 fallback: an entity being FOUND doesn't mean Academy's
//      data about it is SUFFICIENT for this specific question (see
//      academyCoverage.js's isAcademyDataSufficient -- deterministic
//      keyword logic, not another LLM call). Only when insufficient,
//      official Riot Wild Rift patch notes are fetched (riotFallback.js)
//      -- its own independently-discovered latest patch, cached,
//      timeout-bounded, never blocks or fails the request if unavailable
//   7. Prompt assembly (buildSystemPrompt) -- pure formatting, no
//      resolution logic of its own
//   8. Provider-agnostic AI call (callAIProvider)
//
// This endpoint does NOT persist chat messages anywhere -- `messages`
// exists only for the duration of this one request. Conversation history
// lives entirely in the browser (src/pages/AICoachPage.jsx component
// state); nothing here writes it to KV or any other store, and nothing
// here is keyed by user/session, so there's no mechanism by which two
// visitors' conversations could ever mix.

import { CHAMPIONS } from "../../src/data/champions.js";
import { ITEMS } from "../../src/data/items.js";
import { RUNES } from "../../src/data/runes.js";
import { STATIC_PATCH_VERSION } from "../../src/data/patch.js";
import { resolveEffectivePatch } from "../../src/lib/effectiveData.js";
import { MAX_TOKENS, MAX_MESSAGES, MAX_TOTAL_CHARS, CONVERSATION_LOOKBACK_MESSAGES } from "../_lib/config.js";
import { checkRateLimit } from "../_lib/rateLimiter.js";
import { fetchOverrides } from "../_lib/kv.js";
import { detectChampionsInConversation } from "../_lib/detectChampion.js";
import { detectItemsAndRunesInConversation } from "../_lib/detectItemsRunes.js";
import { extractChampionContext, extractEnemyContext, extractDecisionTrees } from "../_lib/extractChampionContext.js";
import { extractItemContext, extractRuneContext } from "../_lib/extractItemRuneContext.js";
import { isAcademyDataSufficient, buildAcademyGroundedText } from "../_lib/academyCoverage.js";
import { getRiotPatchNotesFallback } from "../_lib/riotFallback.js";
import { buildSystemPrompt } from "../_lib/buildPrompt.js";
import { callAIProvider } from "../_lib/aiProvider.js";
import { logCoachEvent } from "../_lib/logger.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = Date.now();

  const ip = request.headers.get("CF-Connecting-IP");
  const { limited } = await checkRateLimit(env.COACH_KV, ip);
  if (limited) {
    return json({ error: "You've sent a lot of messages in the last hour — take a short break and try again a bit later.", code: "rate_limited" }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body", code: "bad_request" }, 400);
  }

  const { messages } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "Missing messages array", code: "bad_request" }, 400);
  }
  if (messages.length > MAX_MESSAGES) {
    return json({ error: "This conversation has gotten long — start a new chat so it stays fast and on-topic.", code: "too_many_messages" }, 400);
  }
  const totalChars = messages.reduce((sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0), 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return json({ error: "That message (or the conversation so far) is too long. Try breaking it into smaller questions.", code: "message_too_long" }, 400);
  }

  const kvStartedAt = Date.now();
  const overrides = await fetchOverrides(env.COACH_KV);
  const kvMs = Date.now() - kvStartedAt;

  const effectivePatch = resolveEffectivePatch(overrides.patch, STATIC_PATCH_VERSION);

  // Conversation-aware grounding: checks the latest user message first,
  // falls back through a small bounded recent window for follow-ups that
  // don't repeat an entity name. See functions/_lib/detectChampion.js /
  // detectItemsRunes.js for exactly how the fallback works.
  const { championId, enemyId } = detectChampionsInConversation(messages, CHAMPIONS, CONVERSATION_LOOKBACK_MESSAGES);
  const { itemIds, runeIds } = detectItemsAndRunesInConversation(messages, ITEMS, RUNES, CONVERSATION_LOOKBACK_MESSAGES);

  const championContext = championId ? extractChampionContext(championId, CHAMPIONS, overrides) : null;
  const enemyContext = enemyId ? extractEnemyContext(enemyId, CHAMPIONS, championContext) : null;
  const decisionTreeEntries = championId ? extractDecisionTrees(championId, overrides) : [];
  const itemContext = extractItemContext(itemIds, ITEMS, overrides);
  const runeContext = extractRuneContext(runeIds, RUNES, overrides);

  // Priority 2: an entity being found does NOT mean Academy's data about
  // it is sufficient for THIS question (e.g. "what's Redemption's
  // cooldown" vs. "when should I buy Redemption" -- Academy might cover
  // one and not the other). isAcademyDataSufficient() is deterministic
  // keyword logic (functions/_lib/academyCoverage.js), not another model
  // call. Riot fallback is only attempted when it returns false, and
  // never blocks or fails the request either way -- riotFallback.js
  // always resolves, even on failure, to { found: false }.
  const latestUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const question = typeof latestUserMessage?.content === "string" ? latestUserMessage.content : "";

  const academyGroundedText = buildAcademyGroundedText({ championContext, itemContext, runeContext, decisionTreeEntries });
  const hasAnyGrounding = Boolean(championContext) || itemContext.length > 0 || runeContext.length > 0;
  const academySufficient = isAcademyDataSufficient(question, hasAnyGrounding, academyGroundedText);

  let riotFallback = null;
  let riotFallbackWasCached = false;
  let riotPatchUsed = null;
  if (!academySufficient) {
    const riotResult = await getRiotPatchNotesFallback(question, env.COACH_KV);
    if (riotResult.found) {
      riotFallback = { content: riotResult.content, source: riotResult.source };
      riotFallbackWasCached = riotResult.cached;
      riotPatchUsed = riotResult.patchSlug;
    }
  }

  const systemPrompt = buildSystemPrompt({ championContext, enemyContext, itemContext, runeContext, decisionTreeEntries, effectivePatch, riotFallback });

  // Log grounding results now, independent of whether the AI call below
  // succeeds -- so a request that fails at the provider still tells you
  // (Cloudflare dashboard -> Functions -> Real-time Logs) what was
  // detected and how long KV took, instead of only logging on success.
  logCoachEvent({
    stage: "grounding",
    championDetected: championId || null,
    enemyDetected: enemyId || null,
    itemsDetected: itemIds,
    runesDetected: runeIds,
    decisionTreeEntries: decisionTreeEntries.length,
    effectivePatch,
    academySufficient,
    riotFallbackUsed: Boolean(riotFallback),
    riotFallbackCached: riotFallbackWasCached,
    riotPatchUsed,
    kvLatencyMs: kvMs,
  });

  const aiStartedAt = Date.now();
  const result = await callAIProvider({ env, systemPrompt, messages, maxTokens: MAX_TOKENS });
  const aiMs = Date.now() - aiStartedAt;
  const totalMs = Date.now() - startedAt;

  if (!result.ok) {
    logCoachEvent({ stage: "provider_error", code: result.code, aiLatencyMs: aiMs, totalMs, detail: result.logDetail });
    return json({ error: result.error, code: result.code }, result.status);
  }

  logCoachEvent({ stage: "success", championDetected: championId || null, aiLatencyMs: aiMs, totalMs });

  return json({ reply: result.reply, patch: effectivePatch, groundedIn: championId || null });
}

// Reject any other HTTP method with a clean 405 instead of a silent 404
export async function onRequestGet() {
  return json({ error: "Method not allowed — POST only", code: "method_not_allowed" }, 405);
}
