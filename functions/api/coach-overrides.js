// Cloudflare Pages Function — GET/POST /api/coach-overrides
// Real, cross-device persistence for Coach Mode edits (champion tiers,
// item/rune tiers, and their notes), backed by Cloudflare KV.
//
// SETUP (one-time, in the Cloudflare dashboard):
//   1. Workers & Pages → KV → Create a namespace (call it whatever you like,
//      e.g. "vanguard-coach-data")
//   2. Workers & Pages → your Pages project → Settings → Functions →
//      KV namespace bindings → Add binding
//        Variable name:  COACH_KV        (must match exactly, used below)
//        KV namespace:   the one you just created
//   3. Redeploy (or trigger a new deployment) so the binding takes effect
//
// Until that binding exists, this endpoint will return a clear error
// instead of crashing, and the site automatically falls back to
// browser-local storage (see src/hooks/useCoachOverrides.js) so Coach Mode
// still works locally in the meantime.

const KEY = "coach-overrides";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function onRequestGet(context) {
  const kv = context.env.COACH_KV;
  if (!kv) {
    return json({ error: "COACH_KV binding not set up yet — see comments in functions/api/coach-overrides.js", overrides: null }, 200);
  }
  const value = await kv.get(KEY);
  return json({ overrides: value ? JSON.parse(value) : { champions: {}, items: {}, runes: {} } });
}

export async function onRequestPost(context) {
  const kv = context.env.COACH_KV;
  if (!kv) {
    return json({ error: "COACH_KV binding not set up yet — see comments in functions/api/coach-overrides.js" }, 500);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { overrides } = body || {};
  if (!overrides || typeof overrides !== "object") {
    return json({ error: "Missing overrides object" }, 400);
  }

  await kv.put(KEY, JSON.stringify(overrides));
  return json({ ok: true });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
