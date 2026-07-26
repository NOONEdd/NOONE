// Cloudflare Pages Function — POST /api/coach
// Keeps your Anthropic API key server-side. In the Cloudflare dashboard:
// Workers & Pages → your project → Settings → Environment variables →
// add ANTHROPIC_API_KEY (as a Secret, not plain text) → redeploy.

const SYSTEM_PROMPT = `You are the Vanguard Academy AI Support Coach for Wild Rift. You are not a generic assistant — you are a Socratic coach who teaches Support players HOW to think, not just what to do. Rules: never give a direct answer first. Walk the player through the relevant decision-making questions for their situation (for a roaming question: is the ADC safe, where is the enemy jungler, is there a wave worth sacrificing, what objective is coming up, can the roam actually swing the game). After listing the questions, briefly explain why each one matters. Only then give a clear, reasoned recommendation that ties back to those questions. Be concise — this is a mobile chat interface, not an essay. Stay focused on Support-role Wild Rift strategy: lane states, roaming, vision, objectives, drafting, tempo, win conditions. If a question is unrelated to Wild Rift or Support play, gently redirect back to the academy's focus. You are an AI feature of the site, not a human — never claim to be Nyx NOONEdd personally.`;

// These three numbers exist for one reason: this endpoint calls the
// Anthropic API using YOUR key, billed to YOUR account, and the client
// controls the entire `messages` array in the request body. Without caps,
// one visitor (or a bot doing it automatically) can rack up real cost by
// looping this endpoint or sending an enormous fabricated conversation
// history. None of this affects a normal coaching conversation.
const MAX_MESSAGES = 40; // a real session rarely needs more before starting fresh is better anyway
const MAX_TOTAL_CHARS = 12000; // bounds the worst-case cost of any single request, independent of rate limiting below
const RATE_LIMIT_PER_HOUR = 20; // generous for genuine use, still bounds the damage from one IP looping the endpoint

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Best-effort per-IP rate limit using the SAME COACH_KV binding already
 *  configured for coach-overrides.js -- no new Cloudflare setup needed.
 *  Fixed hourly windows (not a sliding window) since KV doesn't support
 *  sorted-set-style windows well; a fixed window is a standard, accepted
 *  tradeoff for a limiter this lightweight. Each write carries its own
 *  expirationTtl so old buckets clean themselves up automatically rather
 *  than accumulating keys forever -- this does NOT reuse or compete with
 *  the "coach-overrides" key that the Coach Mode editor writes to, so it
 *  can never contribute to that separate KV-put quota.
 *  Fails OPEN (allows the request through) if COACH_KV isn't bound or a
 *  KV call errors -- the size caps above are a second, independent layer
 *  of defense, and a temporarily-unavailable KV store shouldn't take down
 *  the whole AI Coach feature over a rate-limit check. */
async function checkRateLimit(kv, ip) {
  if (!kv || !ip) return { limited: false };
  const hourBucket = Math.floor(Date.now() / 3600000);
  const key = `ratelimit:coach:${ip}:${hourBucket}`;
  try {
    const current = parseInt((await kv.get(key)) || "0", 10);
    if (current >= RATE_LIMIT_PER_HOUR) return { limited: true };
    await kv.put(key, String(current + 1), { expirationTtl: 3700 });
    return { limited: false };
  } catch {
    return { limited: false }; // fail open -- see comment above
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

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

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return json({ error: `Anthropic API error: ${errText}` }, response.status);
    }

    const data = await response.json();
    const reply = (data.content || [])
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n");

    return json({ reply });
  } catch (err) {
    return json({ error: "Failed to reach Anthropic API" }, 500);
  }
}

// Reject any other HTTP method with a clean 405 instead of a silent 404
export async function onRequestGet() {
  return json({ error: "Method not allowed — POST only" }, 405);
}
