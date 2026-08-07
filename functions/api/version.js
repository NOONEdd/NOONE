// Cloudflare Pages Function — GET /api/version
import { MODEL, PATCH_VERSION } from "../_lib/config.js";

export async function onRequestGet() {
  return new Response(JSON.stringify({ model: MODEL, patch: PATCH_VERSION }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
