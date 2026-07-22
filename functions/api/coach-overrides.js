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
//   3. Workers & Pages → your Pages project → Settings → Environment
//      variables → Add variable
//        Variable name:  COACH_PASSWORD  (must match exactly, used below)
//        Value:          whatever password only you should know
//        Mark it as a Secret so it's never shown/logged in plain text.
//   4. Redeploy (or trigger a new deployment) so both bindings take effect
//
// Anyone can still READ the tier list (that's the whole point of a public
// site), but WRITES now require this password — checked here, server-side,
// which is the actual security boundary. The client-side password prompt
// (see CoachToggle in src/components/Layout.jsx) is just the UX layer on
// top; even if someone bypassed it entirely and called this endpoint
// directly, a write without the correct password is rejected right here.
//
// Until COACH_KV/COACH_PASSWORD are set up, this endpoint returns a clear
// error instead of crashing, and the site automatically falls back to
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

  const correctPassword = context.env.COACH_PASSWORD;
  if (!correctPassword) {
    return json({ error: "COACH_PASSWORD not set yet — add it as an environment variable in the Cloudflare dashboard (Settings → Environment variables), mark it as a Secret, then redeploy." }, 500);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { overrides, password } = body || {};
  if (password !== correctPassword) {
    return json({ error: "Incorrect password" }, 401);
  }
  if (!overrides || typeof overrides !== "object") {
    return json({ error: "Missing overrides object" }, 400);
  }

  try {
    await kv.put(KEY, JSON.stringify(overrides));
  } catch (err) {
    // Cloudflare's Workers KV free tier caps out at 1,000 put operations
    // per day; past that, kv.put() itself rejects -- this is exactly the
    // "Daily Workers KV put limit exceeded" email. The client (see
    // src/hooks/useCoachOverrides.js) already falls back to localStorage
    // on any non-ok response, so no edit is lost -- it just won't sync to
    // other devices/visitors until the quota resets at 00:00 UTC.
    return json({ error: "Cloudflare's daily free-tier KV write limit was reached. Your edit is saved in this browser and will sync once the limit resets (00:00 UTC)." }, 429);
  }
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
