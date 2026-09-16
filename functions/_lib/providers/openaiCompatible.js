// Generic adapter for ANY provider that exposes a standard OpenAI-style
// chat/completions endpoint: POST {base_url} with an `Authorization:
// Bearer <key>` header and a JSON body of { model, messages, max_tokens,
// temperature? }, returning JSON shaped like
// { choices: [{ message: { content } }] }.
//
// This file is intentionally provider-NAME-agnostic. It does not know or
// care whether AI_BASE_URL points at OpenAI itself, OpenRouter, Together,
// Groq, a self-hosted vLLM/Ollama/LM Studio server, or anything else --
// it only knows the one standard request/response shape. Anything that
// speaks that shape works through this single file; nothing about a
// specific provider is hard-coded here, and no default base URL is
// assumed (see the missing_base_url check below) -- that would silently
// pin one particular provider as the "real" default, which is exactly
// what this adapter is designed not to do.
//
// This does NOT mean every AI API is supported. Providers that don't
// speak this standard shape (Anthropic's Messages API is the current
// example -- different auth header, different request/response shape,
// a separate top-level `system` field instead of a system role message)
// need their own adapter file, same as functions/_lib/providers/anthropic.js.
//
// Same normalized-result contract as providers/anthropic.js:
//   success: { ok: true, reply: string, truncated: boolean, finishReason: string }
//   failure: { ok: false, status, code, error, logDetail, truncated? }
//
// `jsonSchema` (optional, additive): see aiProvider.js's callAIProvider()
// doc comment. When provided, sends `response_format: {type:"json_object"}`
// -- the widely-supported baseline JSON mode across the OpenAI-compatible
// ecosystem (OpenAI, OpenRouter, Together, Groq, and most others). This
// guarantees syntactically valid JSON but NOT schema conformance the way
// Anthropic's forced tool-use does (see providers/anthropic.js) --
// "OpenAI-compatible" covers too wide a range of actual backends to
// assume the newer, stricter `json_schema` mode is universally
// supported, so this deliberately uses the safer baseline. The schema
// itself is still included in the prompt (unchanged), and
// patchIntelligence.js's own normalization layer is still the real
// safety net regardless of which mode was used. Omitted (AI Coach's
// every call), the request body is unchanged from before.

export async function callOpenAICompatible({ apiKey, model, maxTokens, systemPrompt, messages, env, jsonSchema }) {
  const baseUrl = env && env.AI_BASE_URL;
  if (!baseUrl) {
    return {
      ok: false,
      status: 500,
      code: "missing_base_url",
      error: "The AI Coach isn't fully set up yet — check back soon.",
      logDetail: "AI_BASE_URL is not set (required when AI_PROVIDER=openai-compatible). Point it at the provider's chat/completions endpoint, e.g. https://<provider>/v1/chat/completions.",
    };
  }
  if (!apiKey) {
    return {
      ok: false,
      status: 500,
      code: "missing_api_key",
      error: "The AI Coach isn't fully set up yet — check back soon.",
      logDetail: "AI_API_KEY is not set (required when AI_PROVIDER=openai-compatible).",
    };
  }
  if (!model) {
    return {
      ok: false,
      status: 500,
      code: "missing_model",
      error: "The AI Coach isn't fully set up yet — check back soon.",
      logDetail: "AI_MODEL is not set. Unlike the anthropic provider, openai-compatible has no built-in default model -- set AI_MODEL to whatever your provider calls it (e.g. \"gpt-4o-mini\", \"llama-3.3-70b\", etc).",
    };
  }

  // OpenAI-style chat/completions expects the system prompt AS a message
  // (role: "system") inside the `messages` array -- unlike Anthropic's
  // separate top-level `system` field. This is the one real shape
  // difference this adapter has to bridge; everything else is a
  // near-literal pass-through of what coach.js already built.
  const body = {
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    max_tokens: maxTokens,
  };

  if (jsonSchema) {
    body.response_format = { type: "json_object" };
  }

  // Optional and provider-agnostic: only sent if explicitly configured,
  // never defaulted to a specific value here.
  const rawTemperature = env && env.AI_TEMPERATURE;
  if (rawTemperature !== undefined && rawTemperature !== null && rawTemperature !== "") {
    const temperature = Number(rawTemperature);
    if (!Number.isNaN(temperature)) body.temperature = temperature;
  }

  let response;
  try {
    response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      code: "provider_unreachable",
      error: "Couldn't reach the AI provider. Try again in a moment.",
      logDetail: `openai-compatible fetch to ${baseUrl} threw: ${err && err.message ? err.message : String(err)}`,
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
      logDetail: `openai-compatible provider (${baseUrl}) responded ${response.status}: ${errText.slice(0, 500)}`,
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
      logDetail: `openai-compatible response JSON parse failed: ${err && err.message ? err.message : String(err)}`,
    };
  }

  const reply = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : undefined;

  // "length" specifically means generation was cut off before finishing
  // -- any other finish_reason ("stop", "tool_calls", etc.) is a normal
  // completion. Computed unconditionally, additive field -- AI Coach
  // chat (functions/api/coach.js) never reads this, so a chat reply
  // that hits MAX_TOKENS still behaves exactly as before: shown as-is,
  // no error.
  const truncated = data && data.choices && data.choices[0] && data.choices[0].finish_reason === "length";
  const finishReason = data && data.choices && data.choices[0] ? data.choices[0].finish_reason : undefined;

  if (!reply || typeof reply !== "string") {
    return {
      ok: false,
      status: 502,
      code: truncated ? "truncated_output" : "empty_reply",
      error: truncated
        ? "The AI provider's response was cut off before it finished (hit the output token limit)."
        : "The AI provider didn't return an answer. Try again.",
      logDetail: `openai-compatible response had no choices[0].message.content (finish_reason: ${finishReason}): ${JSON.stringify(data).slice(0, 300)}`,
      truncated,
    };
  }

  return { ok: true, reply, truncated, finishReason };
}
