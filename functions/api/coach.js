// Cloudflare Pages Function — POST /api/coach
// Keeps your Anthropic API key server-side. In the Cloudflare dashboard:
// Workers & Pages → your project → Settings → Environment variables →
// add ANTHROPIC_API_KEY (as a Secret, not plain text) → redeploy.
//
// Grounds every answer in your ACTUAL site data instead of just the
// model's general Wild Rift knowledge: detects which champion(s) the
// question is about, pulls ONLY that champion's data (tier, builds,
// coaching notes, matchups -- including live Coach Mode edits, no
// redeploy needed) from the exact same source files and KV store the
// site itself uses, and hands the model a compact, focused prompt --
// never the entire 30+ champion roster. See functions/_lib/ for the
// individual pieces (detection, extraction, prompt assembly, rate
// limiting) -- each one has a single, focused job.

import { CHAMPIONS } from "../../src/data/champions.js";
import { MODEL, MAX_TOKENS, MAX_MESSAGES, MAX_TOTAL_CHARS, PATCH_VERSION } from "../_lib/config.js";
import { checkRateLimit } from "../_lib/rateLimiter.js";
import { fetchOverrides } from "../_lib/kv.js";
import { detectChampions } from "../_lib/detectChampion.js";
import { extractChampionContext, extractEnemyContext } from "../_lib/extractChampionContext.js";
import { buildSystemPrompt } from "../_lib/buildPrompt.js";
import { logCoachRequest } from "../_lib/logger.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const startedAt = Date.now();

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: "Server is missing ANTHROPIC_API_KEY. Add it in Cloudflare Pages → Settings → Environment variables, then redeploy." }, 500);
  }

  const ip = request.headers.get("CF-Connecting-IP");
  const { limited } = await checkRateLimit(env.COACH_KV, ip);
  if (limited) {
    return json({ error: "You've sent a lot of messages in the last hour — take a short break and try again a bit later." }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { messages } = body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "Missing messages array" }, 400);
  }
  if (messages.length > MAX_MESSAGES) {
    return json({ error: "This conversation has gotten long — start a new chat so it stays fast and on-topic." }, 400);
  }
  const totalChars = messages.reduce((sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0), 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return json({ error: "That message (or the conversation so far) is too long. Try breaking it into smaller questions." }, 400);
  }

  // Ground the answer: detect which champion(s) the latest user message is
  // about, then pull ONLY that champion's data -- never the whole roster.
  const latestUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const question = typeof latestUserMessage?.content === "string" ? latestUserMessage.content : "";

  const kvStartedAt = Date.now();
  const overrides = await fetchOverrides(env.COACH_KV);
  const kvMs = Date.now() - kvStartedAt;

  const { championId, enemyId } = detectChampions(question, CHAMPIONS);
  const championContext = championId ? extractChampionContext(championId, CHAMPIONS, overrides) : null;
  const enemyContext = enemyId ? extractEnemyContext(enemyId, CHAMPIONS, championContext) : null;
  const systemPrompt = buildSystemPrompt(championContext, enemyContext);

  try {
    const aiStartedAt = Date.now();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages,
      }),
    });
    const aiMs = Date.now() - aiStartedAt;

    if (!response.ok) {
      const errText = await response.text();
      return json({ error: `Anthropic API error: ${errText}` }, response.status);
    }

    const data = await response.json();
    const reply = (data.content || [])
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n");

    logCoachRequest({ path: "/api/coach", championId, enemyId, kvMs, aiMs, totalMs: Date.now() - startedAt });

    return json({ reply, patch: PATCH_VERSION, groundedIn: championId || null });
  } catch (err) {
    return json({ error: "Failed to reach Anthropic API" }, 500);
  }
}

// Reject any other HTTP method with a clean 405 instead of a silent 404
export async function onRequestGet() {
  return json({ error: "Method not allowed — POST only" }, 405);
}
