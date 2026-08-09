// Brute-force protection for the Coach Mode password, shared by
// functions/api/verify-coach.js and functions/api/coach-overrides.js --
// both check the same COACH_PASSWORD, so both need the same lockout, or
// an attacker would just hit whichever endpoint isn't protected.
//
// Uses the same COACH_KV binding already configured for rateLimiter.js
// and coach-overrides.js -- no new Cloudflare setup needed. Fixed
// window (not sliding), same accepted tradeoff as rateLimiter.js: KV
// doesn't support sorted-set-style windows well, and a fixed window is
// standard for a limiter this lightweight.
//
// Fails OPEN if COACH_KV isn't bound or a KV call errors -- an
// unavailable KV store shouldn't turn into "nobody can ever unlock
// Coach Mode," and the password check itself (functions/api/verify-coach.js,
// functions/api/coach-overrides.js) remains the real security boundary
// either way.

import { MAX_PASSWORD_ATTEMPTS, PASSWORD_ATTEMPT_WINDOW_MS } from "./config.js";

function bucketKey(ip) {
  const bucket = Math.floor(Date.now() / PASSWORD_ATTEMPT_WINDOW_MS);
  return `pwattempt:${ip}:${bucket}`;
}

/** Check BEFORE looking at the submitted password -- while locked, even
 *  a correct password is rejected, which is the point (a script that
 *  eventually stumbles onto the right password mid-lockout still
 *  shouldn't get in early). */
export async function isPasswordLocked(kv, ip) {
  if (!kv || !ip) return false;
  try {
    const current = parseInt((await kv.get(bucketKey(ip))) || "0", 10);
    return current >= MAX_PASSWORD_ATTEMPTS;
  } catch {
    return false; // fail open -- see comment above
  }
}

export async function recordFailedPasswordAttempt(kv, ip) {
  if (!kv || !ip) return;
  try {
    const key = bucketKey(ip);
    const current = parseInt((await kv.get(key)) || "0", 10);
    // TTL a little past the window so the bucket cleans itself up
    // instead of accumulating keys forever.
    await kv.put(key, String(current + 1), { expirationTtl: Math.ceil(PASSWORD_ATTEMPT_WINDOW_MS / 1000) + 60 });
  } catch {
    // fail open -- see comment above
  }
}

/** Called on a successful password check so a genuine coach who
 *  fat-fingered it a couple times isn't left sitting near the limit for
 *  the rest of the window. Best-effort -- a failure here just means the
 *  bucket expires naturally via its TTL instead of clearing early. */
export async function resetPasswordAttempts(kv, ip) {
  if (!kv || !ip) return;
  try {
    await kv.delete(bucketKey(ip));
  } catch {
    // best-effort only
  }
}
