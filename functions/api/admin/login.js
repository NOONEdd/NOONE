// Cloudflare Pages Function — POST /api/admin/login
//
// Replaces functions/api/verify-coach.js. Same COACH_PASSWORD env var,
// same brute-force lockout (functions/_lib/passwordAttempts.js) -- the
// only thing that changed is what happens on success: instead of the
// client remembering the raw password (old design: sessionStorage,
// resent on every write), this issues a signed, HttpOnly session cookie
// (functions/_lib/adminAuth.js) and the password itself never leaves
// this one request again for the rest of the session.
//
// Called only from src/pages/AdminPage.jsx's login form -- there is no
// other place in the UI that prompts for this password anymore (see
// src/components/TierBoard.jsx's CoachToggle, which now just checks
// auth.isAuthorized and never shows a password field).

import { isPasswordLocked, recordFailedPasswordAttempt, resetPasswordAttempts } from "../../_lib/passwordAttempts.js";
import { createSessionToken, buildSessionCookie } from "../../_lib/adminAuth.js";

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...extraHeaders },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const correctPassword = env.COACH_PASSWORD;
  if (!correctPassword) {
    return json({ ok: false, error: "Admin login isn't fully set up yet — add COACH_PASSWORD in the Cloudflare dashboard (Settings → Environment variables) as a Secret, then redeploy." }, 500);
  }

  const kv = env.COACH_KV;
  const ip = request.headers.get("CF-Connecting-IP");

  if (await isPasswordLocked(kv, ip)) {
    return json({ ok: false, error: "Too many incorrect attempts. Try again in about 15 minutes." }, 429);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const { password } = body || {};
  if (password !== correctPassword) {
    await recordFailedPasswordAttempt(kv, ip);
    return json({ ok: false, error: "Incorrect password" }, 401);
  }

  await resetPasswordAttempts(kv, ip);

  const token = await createSessionToken(env);
  if (!token) {
    // Only happens if a signing key genuinely can't be resolved, which
    // can't occur here since COACH_PASSWORD (checked above) is itself a
    // valid fallback signing-key source -- kept as a defensive branch
    // rather than assumed unreachable.
    return json({ ok: false, error: "Couldn't start a session — try again, and check ADMIN_SESSION_SECRET / COACH_PASSWORD are set correctly." }, 500);
  }

  return json({ ok: true }, 200, { "Set-Cookie": buildSessionCookie(token, request) });
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
