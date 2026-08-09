// Cloudflare Pages Function — GET /api/version
import { STATIC_PATCH_VERSION } from "../../src/data/patch.js";
import { resolveEffectivePatch } from "../../src/lib/effectiveData.js";
import { resolveActiveProviderAndModel } from "../_lib/aiProvider.js";
import { fetchOverrides } from "../_lib/kv.js";

export async function onRequestGet(context) {
  const { provider, model, implemented } = resolveActiveProviderAndModel(context.env);
  const overrides = await fetchOverrides(context.env.COACH_KV);
  const patch = resolveEffectivePatch(overrides.patch, STATIC_PATCH_VERSION);
  return new Response(JSON.stringify({ provider, model, providerImplemented: implemented, patch }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
