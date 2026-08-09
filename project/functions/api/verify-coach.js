// Cloudflare Pages Function — POST /api/verify-coach
// Called by the Coach Mode password prompt (src/components/Layout.jsx)
// before revealing any edit controls. This is a convenience/UX check --
// the real security boundary is the same COACH_PASSWORD check repeated
// server-side in functions/api/coach-overrides.js, so a write still can't
// succeed even if this endpoint were somehow skipped entirely.
//
// Uses the same COACH_PASSWORD environment variable set up for
// coach-overrides.js -- see the setup comment there. Also shares that
// endpoint's brute-force lockout (functions/_lib/passwordAttempts.js) --
// both check the same password, so both need the same protection, or an
// attacker would simply target whichever one lacked it.

import { isPasswordLocked, recordFailedPasswordAttempt, resetPasswordAttempts } from "../_lib/passwordAttempts.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function onRequestPost(context) {
  const correctPassword = context.env.COACH_PASSWORD;
  if (!correctPassword) {
    return json({ ok: false, error: "COACH_PASSWORD not set yet — add it in the Cloudflare dashboard (Settings → Environment variables) as a Secret, then redeploy." }, 500);
  }

  const kv = context.env.COACH_KV;
  const ip = context.request.headers.get("CF-Connecting-IP");

  if (await isPasswordLocked(kv, ip)) {
    return json({ ok: false, error: "Too many incorrect attempts. Try again in about 15 minutes." }, 429);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { password } = body || {};
  if (password === correctPassword) {
    await resetPasswordAttempts(kv, ip);
    return json({ ok: true });
  }

  await recordFailedPasswordAttempt(kv, ip);
  return json({ ok: false, error: "Incorrect password" }, 401);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
