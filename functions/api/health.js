// Cloudflare Pages Function — GET /api/health
export async function onRequestGet() {
  return new Response(JSON.stringify({ status: "ok", time: new Date().toISOString() }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
