// Isolates the actual Anthropic HTTP call so nothing else in the codebase
// (functions/api/coach.js, functions/_lib/aiProvider.js) needs to know
// Anthropic-specific request/response shape. To add another provider
// later, write one new file with this same contract -- see
// functions/_lib/aiProvider.js for how adapters get registered.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Calls Anthropic's Messages API. Never throws -- always resolves to a
 * normalized result so the caller doesn't need a try/catch or any
 * Anthropic-specific knowledge:
 *   success: { ok: true, reply: string }
 *   failure: { ok: false, status, code, error, logDetail }
 * `error` is short and safe to show a visitor. `logDetail` is for
 * server-side logs ONLY (functions/_lib/logger.js) and must never be
 * sent to the client -- it can include the raw upstream error body,
 * which may describe internal request shape and has no business
 * reaching a browser. Neither field, nor anything else this function
 * returns, ever includes `apiKey` itself.
 */
export async function callAnthropic({ apiKey, model, maxTokens, systemPrompt, messages }) {
  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      code: "missing_api_key",
      error: "The AI Coach isn't fully set up yet — check back soon.",
      logDetail: "ANTHROPIC_API_KEY is not set (Settings -> Environment variables -> add as a Secret -> redeploy).",
    };
  }

  let response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      }),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      code: "provider_unreachable",
      error: "Couldn't reach the AI provider. Try again in a moment.",
      logDetail: `Anthropic fetch threw: ${err && err.message ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    return {
      ok: false,
      status: response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status,
      code: response.status === 429 ? "provider_rate_limited" : "provider_error",
      error: response.status === 429
        ? "The AI provider is busy right now. Try again in a minute."
        : "The AI provider had a problem answering that. Try again in a moment.",
      logDetail: `Anthropic responded ${response.status}: ${errText.slice(0, 500)}`,
    };
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    return {
      ok: false,
      status: 502,
      code: "provider_error",
      error: "The AI provider sent back something unreadable. Try again in a moment.",
      logDetail: `Anthropic response JSON parse failed: ${err && err.message ? err.message : String(err)}`,
    };
  }

  const reply = (data.content || [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");

  if (!reply) {
    return {
      ok: false,
      status: 502,
      code: "empty_reply",
      error: "The AI provider didn't return an answer. Try again.",
      logDetail: `Anthropic response had no text content blocks: ${JSON.stringify(data).slice(0, 300)}`,
    };
  }

  return { ok: true, reply };
}
