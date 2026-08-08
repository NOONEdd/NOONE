// Cloudflare Pages Function — GET /api/version
import { PATCH_VERSION } from "../_lib/config.js";
import { resolveActiveProviderAndModel } from "../_lib/aiProvider.js";

export async function onRequestGet(context) {
  const { provider, model, implemented } = resolveActiveProviderAndModel(context.env);
  return new Response(JSON.stringify({ provider, model, providerImplemented: implemented, patch: PATCH_VERSION }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
