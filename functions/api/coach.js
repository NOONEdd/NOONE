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
// Grounds every answer in the site's ACTUAL data instead of just the
// model's general Wild Rift knowledge: detects which champion(s), items,
// and runes the question is about, pulls ONLY that data (including live
// Coach Mode overrides -- no redeploy needed) from the same source files
// and KV store the site itself uses, and hands the model a compact,
// focused prompt -- never the full champion/item/rune catalog. See
// functions/_lib/ for the individual pieces (detection, extraction,
// prompt assembly, rate limiting, provider dispatch) -- each has a
// single, focused job.
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
import { MAX_TOKENS, MAX_MESSAGES, MAX_TOTAL_CHARS, PATCH_VERSION } from "../_lib/config.js";
import { checkRateLimit } from "../_lib/rateLimiter.js";
import { fetchOverrides } from "../_lib/kv.js";
import { detectChampions } from "../_lib/detectChampion.js";
import { detectItemsAndRunes } from "../_lib/detectItemsRunes.js";
import { extractChampionContext, extractEnemyContext, extractDecisionTrees } from "../_lib/extractChampionContext.js";
import { extractItemContext, extractRuneContext } from "../_lib/extractItemRuneContext.js";
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

  // Ground the answer: detect which champion/items/runes the latest user
  // message is about, then pull ONLY that data -- never the whole catalog.
  const latestUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const question = typeof latestUserMessage?.content === "string" ? latestUserMessage.content : "";

  const kvStartedAt = Date.now();
  const overrides = await fetchOverrides(env.COACH_KV);
  const kvMs = Date.now() - kvStartedAt;

  const { championId, enemyId } = detectChampions(question, CHAMPIONS);
  const { itemIds, runeIds } = detectItemsAndRunes(question, ITEMS, RUNES);

  const championContext = championId ? extractChampionContext(championId, CHAMPIONS, overrides) : null;
  const enemyContext = enemyId ? extractEnemyContext(enemyId, CHAMPIONS, championContext) : null;
  const decisionTreeEntries = championId ? extractDecisionTrees(championId, overrides) : [];
  const itemContext = extractItemContext(itemIds, ITEMS, overrides);
  const runeContext = extractRuneContext(runeIds, RUNES, overrides);

  const systemPrompt = buildSystemPrompt({ championContext, enemyContext, itemContext, runeContext, decisionTreeEntries });

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

  return json({ reply: result.reply, patch: PATCH_VERSION, groundedIn: championId || null });
}

// Reject any other HTTP method with a clean 405 instead of a silent 404
export async function onRequestGet() {
  return json({ error: "Method not allowed — POST only", code: "method_not_allowed" }, 405);
}
