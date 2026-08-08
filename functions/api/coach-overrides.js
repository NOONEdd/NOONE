// Cloudflare Pages Function — GET/POST /api/coach-overrides
// Real, cross-device persistence for Coach Mode edits (champion tiers,
// item/rune tiers, decision trees, and their notes), backed by
// Cloudflare KV.
//
// SETUP (one-time, in the Cloudflare dashboard):
//   1. Workers & Pages → KV → Create a namespace (call it whatever you like,
//      e.g. "vanguard-coach-data")
//   2. Workers & Pages → your Pages project → Settings → Functions →
//      KV namespace bindings → Add binding
//        Variable name:  COACH_KV        (must match exactly, used below)
//        KV namespace:   the one you just created
//      Do this for BOTH the Production and Preview environments in the
//      dashboard -- they're configured separately, and a binding added
//      to only one will work in previews but silently miss in
//      production (or vice versa). See the note in README.md.
//   3. Workers & Pages → your Pages project → Settings → Environment
//      variables → Add variable
//        Variable name:  COACH_PASSWORD  (must match exactly, used below)
//        Value:          whatever password only you should know
//        Mark it as a Secret so it's never shown/logged in plain text.
//      Again, set this for both Production and Preview.
//   4. Redeploy (or trigger a new deployment) so both bindings take effect
//
// Anyone can still READ the tier list (that's the whole point of a public
// site), but WRITES require this password — checked here, server-side,
// which is the actual security boundary — plus a brute-force lockout
// (functions/_lib/passwordAttempts.js: 5 wrong attempts per IP locks that
// IP out for 15 minutes, shared with /api/verify-coach). The client-side
// password prompt (see CoachToggle in src/components/Layout.jsx) is just
// the UX layer on top; even if someone bypassed it entirely and called
// this endpoint directly, a write without the correct password is
// rejected right here.
//
// Until COACH_KV/COACH_PASSWORD are set up, this endpoint returns a clear
// error instead of crashing, and the site automatically falls back to
// browser-local storage (see src/hooks/useCoachOverrides.js) so Coach Mode
// still works locally in the meantime.

import { isPasswordLocked, recordFailedPasswordAttempt, resetPasswordAttempts } from "../_lib/passwordAttempts.js";

const KEY = "coach-overrides";
const EMPTY_OVERRIDES = { champions: {}, items: {}, runes: {}, decisionTrees: {} };

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
  return json({ overrides: value ? JSON.parse(value) : EMPTY_OVERRIDES });
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

  const ip = context.request.headers.get("CF-Connecting-IP");
  if (await isPasswordLocked(kv, ip)) {
    return json({ error: "Too many incorrect attempts. Try again in about 15 minutes." }, 429);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { overrides, password } = body || {};
  if (password !== correctPassword) {
    await recordFailedPasswordAttempt(kv, ip);
    return json({ error: "Incorrect password" }, 401);
  }
  await resetPasswordAttempts(kv, ip);

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
