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
 *   success: { ok: true, reply: string, truncated: boolean, finishReason: string }
 *   failure: { ok: false, status, code, error, logDetail, truncated? }
 * `error` is short and safe to show a visitor. `logDetail` is for
 * server-side logs ONLY (functions/_lib/logger.js) and must never be
 * sent to the client -- it can include the raw upstream error body,
 * which may describe internal request shape and has no business
 * reaching a browser. Neither field, nor anything else this function
 * returns, ever includes `apiKey` itself.
 *
 * `truncated`/`finishReason` are ADDITIVE fields carrying Anthropic's
 * `stop_reason` -- present on every successful result, but AI Coach
 * chat (functions/api/coach.js) never reads them, so their addition
 * changes nothing about its existing behavior (a chat reply that hits
 * MAX_TOKENS still displays exactly as it always has: whatever text was
 * generated, no error). functions/_lib/patchIntelligence.js DOES read
 * `truncated`, because a truncated JSON response is unparseable and
 * worth a specific, clear error rather than a generic "invalid JSON."
 *
 * `jsonSchema` (optional): see aiProvider.js's callAIProvider() doc
 * comment. When provided, forces a response via a single tool call
 * whose arguments are parsed server-side by Anthropic against the given
 * schema -- no free-text JSON-in-prose to go wrong. Omitted (AI Coach's
 * every call), the request body is built exactly as before this change;
 * nothing here is different for that path.
 */
export async function callAnthropic({ apiKey, model, maxTokens, systemPrompt, messages, jsonSchema }) {
  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      code: "missing_api_key",
      error: "The AI Coach isn't fully set up yet — check back soon.",
      logDetail: "ANTHROPIC_API_KEY is not set (Settings -> Environment variables -> add as a Secret -> redeploy).",
    };
  }

  const TOOL_NAME = "submit_structured_response";
  const body = { model, max_tokens: maxTokens, system: systemPrompt, messages };
  if (jsonSchema) {
    body.tools = [{ name: TOOL_NAME, description: "Submit the structured response matching the required schema. Always call this tool exactly once with the complete response.", input_schema: jsonSchema }];
    body.tool_choice = { type: "tool", name: TOOL_NAME };
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
      body: JSON.stringify(body),
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

  // "max_tokens" specifically means generation was cut off before
  // finishing (whether or not tool-use was involved) -- any other
  // stop_reason ("end_turn", "tool_use", "stop_sequence") is a normal,
  // complete response. Computed unconditionally; see doc comment above
  // for why this is safe to add without affecting AI Coach.
  const truncated = data.stop_reason === "max_tokens";
  const finishReason = data.stop_reason;

  if (jsonSchema) {
    const toolBlock = (data.content || []).find((block) => block.type === "tool_use" && block.name === TOOL_NAME);
    if (!toolBlock || toolBlock.input === undefined) {
      return {
        ok: false,
        status: 502,
        code: truncated ? "truncated_output" : "empty_reply",
        error: truncated
          ? "The AI provider's response was cut off before it finished (hit the output token limit)."
          : "The AI provider didn't return the requested structured response.",
        logDetail: `Anthropic forced tool-use response had no usable "${TOOL_NAME}" tool_use block (stop_reason: ${finishReason}): ${JSON.stringify(data).slice(0, 500)}`,
        truncated,
      };
    }
    // toolBlock.input is already a parsed object -- Anthropic parses the
    // tool call's arguments server-side against input_schema. Stringify
    // it so the result contract (`reply: string`) is identical either
    // way; patchIntelligence.js's own JSON.parse trivially succeeds
    // against JSON produced by JSON.stringify.
    return { ok: true, reply: JSON.stringify(toolBlock.input), truncated, finishReason };
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
      logDetail: `Anthropic response had no text content blocks (stop_reason: ${finishReason}): ${JSON.stringify(data).slice(0, 300)}`,
      truncated,
    };
  }

  return { ok: true, reply, truncated, finishReason };
}
