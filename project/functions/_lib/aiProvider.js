// Provider-agnostic entry point for functions/api/coach.js. This is the
// ONLY place that decides which AI provider adapter handles a request --
// coach.js, the grounding pipeline, and buildPrompt.js don't know or
// care which provider is active, and never will: this file is the sole
// boundary between "Coach logic" and "how to actually talk to an AI".
//
// Two providers exist today:
//   anthropic          Anthropic's Messages API (functions/_lib/providers/anthropic.js)
//   openai-compatible   ANY provider speaking the standard OpenAI-style
//                       chat/completions shape -- OpenAI itself,
//                       OpenRouter, Together, Groq, a self-hosted
//                       vLLM/Ollama server, etc (functions/_lib/providers/openaiCompatible.js)
//
// That is NOT a claim that only two literal services are supported --
// "openai-compatible" is a wire-format contract, not one vendor. Switch
// AI_PROVIDER/AI_BASE_URL/AI_MODEL to point it at whichever OpenAI-
// compatible provider you want, with no code changes.
//
// Adding a provider that ISN'T OpenAI-compatible (e.g. something with
// its own bespoke API, the way Anthropic's is):
//   1. Write functions/_lib/providers/<name>.js with the same contract
//      every adapter here follows: an async function taking
//      { apiKey, model, maxTokens, systemPrompt, messages, env } and
//      returning { ok: true, reply } or { ok: false, status, code,
//      error, logDetail }. `env` is passed through so an adapter can
//      read whatever extra config it personally needs (the way
//      openaiCompatible.js reads AI_BASE_URL/AI_TEMPERATURE) without
//      this dispatcher needing to know about it.
//   2. Add one line to the PROVIDERS map below, including a
//      `defaultModel` ONLY if there's a genuinely sensible one (there
//      isn't for openai-compatible, since AI_BASE_URL could point
//      anywhere -- see below).
//   3. Set AI_PROVIDER=<name>, that provider's own API key as a
//      Cloudflare Secret, and AI_MODEL as needed.
// Nothing in coach.js, the grounding pipeline, rate limiting, privacy
// handling, or the frontend changes.
//
// Deliberately NOT stubbing out providers that aren't implemented (e.g.
// a literal "openai" or "qwen" entry) -- an AI_PROVIDER value with no
// real adapter fails loudly below instead of silently pretending to
// work or quietly falling back to Anthropic. Equally deliberately, this
// file does not hard-code any specific "cheap" or default third-party
// service as AI_BASE_URL's fallback -- openai-compatible has no
// defaultModel and callOpenAICompatible() has no default base URL,
// so leaving either unset fails with a clear config error rather than
// silently routing your traffic (and your API key) to some vendor you
// never chose.

import { callAnthropic } from "./providers/anthropic.js";
import { callOpenAICompatible } from "./providers/openaiCompatible.js";
import { DEFAULT_PROVIDER, DEFAULT_MODEL } from "./config.js";

const PROVIDERS = {
  anthropic: { call: callAnthropic, apiKeyEnvVar: "ANTHROPIC_API_KEY", defaultModel: DEFAULT_MODEL },
  "openai-compatible": { call: callOpenAICompatible, apiKeyEnvVar: "AI_API_KEY", defaultModel: null },
};

/**
 * Resolves AI_PROVIDER from Cloudflare environment variables (falling
 * back to DEFAULT_PROVIDER), looks up the matching adapter, resolves
 * that adapter's API key and model, and calls it. Returns the adapter's
 * normalized result unchanged. NEVER throws.
 */
export async function callAIProvider({ env, systemPrompt, messages, maxTokens }) {
  const providerName = ((env && env.AI_PROVIDER) || DEFAULT_PROVIDER).toLowerCase().trim();
  const provider = PROVIDERS[providerName];

  if (!provider) {
    return {
      ok: false,
      status: 500,
      code: "unknown_provider",
      error: "The AI Coach isn't fully set up yet — check back soon.",
      logDetail: `AI_PROVIDER "${providerName}" has no adapter in functions/_lib/providers/. Implemented providers: ${Object.keys(PROVIDERS).join(", ")}.`,
    };
  }

  const apiKey = env ? env[provider.apiKeyEnvVar] : undefined;
  // Only "anthropic" has a sane default here (config.js's DEFAULT_MODEL).
  // openai-compatible's defaultModel is null on purpose -- AI_BASE_URL
  // could point at literally anything, so there's no model name that
  // would be a safe guess, and guessing one would be exactly the kind
  // of implicit hard-coded-provider behavior this abstraction avoids.
  // Each adapter validates a missing model itself and returns a clear
  // "missing_model" error rather than this dispatcher silently
  // substituting something.
  const model = (env && env.AI_MODEL) || provider.defaultModel || undefined;

  return provider.call({ apiKey, model, maxTokens, systemPrompt, messages, env });
}

/** Exposed for functions/api/version.js so the version endpoint can
 *  report the actually-active provider/model without duplicating the
 *  env-var-with-fallback logic. `model: null` genuinely means "not
 *  configured" for a provider with no default (e.g. openai-compatible
 *  without AI_MODEL set) rather than falsely reporting a value that
 *  isn't really active. */
export function resolveActiveProviderAndModel(env) {
  const providerName = ((env && env.AI_PROVIDER) || DEFAULT_PROVIDER).toLowerCase().trim();
  const provider = PROVIDERS[providerName];
  const model = (env && env.AI_MODEL) || (provider && provider.defaultModel) || null;
  return { provider: providerName, model, implemented: Boolean(provider) };
}
