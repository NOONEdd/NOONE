// Provider-agnostic entry point for functions/api/coach.js. This is the
// ONLY place that decides which AI provider adapter handles a request --
// coach.js, the grounding pipeline, and buildPrompt.js don't know or
// care which provider is active.
//
// Switching providers later:
//   1. Write functions/_lib/providers/<name>.js with the same contract
//      as providers/anthropic.js: an async function taking
//      { apiKey, model, maxTokens, systemPrompt, messages } and
//      returning { ok: true, reply } or { ok: false, status, code,
//      error, logDetail }.
//   2. Add one line to the PROVIDERS map below.
//   3. Set AI_PROVIDER=<name> and AI_MODEL=<model id> as Cloudflare
//      environment variables, and the provider's own API key as a
//      Cloudflare Secret (see apiKeyEnvVar below).
// Nothing else changes.
//
// Deliberately NOT stubbing out providers that aren't implemented yet
// (e.g. OpenRouter, Qwen) -- an AI_PROVIDER value with no real adapter
// fails loudly below instead of silently pretending to work or quietly
// falling back to Anthropic.

import { callAnthropic } from "./providers/anthropic.js";
import { DEFAULT_PROVIDER, DEFAULT_MODEL } from "./config.js";

const PROVIDERS = {
  anthropic: { call: callAnthropic, apiKeyEnvVar: "ANTHROPIC_API_KEY" },
};

/**
 * Resolves AI_PROVIDER / AI_MODEL from Cloudflare environment variables
 * (falling back to the defaults in config.js), looks up the matching
 * adapter, and calls it. Returns the adapter's normalized result
 * unchanged. NEVER throws.
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
  const model = (env && env.AI_MODEL) || DEFAULT_MODEL;

  return provider.call({ apiKey, model, maxTokens, systemPrompt, messages });
}

/** Exposed for functions/api/version.js so the version endpoint can
 *  report the actually-active provider/model without duplicating the
 *  env-var-with-fallback logic. */
export function resolveActiveProviderAndModel(env) {
  const providerName = ((env && env.AI_PROVIDER) || DEFAULT_PROVIDER).toLowerCase().trim();
  const model = (env && env.AI_MODEL) || DEFAULT_MODEL;
  return { provider: providerName, model, implemented: Boolean(PROVIDERS[providerName]) };
}
