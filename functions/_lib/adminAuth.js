// Signed, HttpOnly admin session -- replaces the old pattern of storing
// the Coach Mode password in sessionStorage and re-sending it on every
// write (functions/api/coach-overrides.js used to accept `password` in
// its POST body; it now calls requireAdminSession() below instead). This
// file is the ONLY place that creates or checks a session token; every
// admin-mutation endpoint imports requireAdminSession() from here rather
// than re-implementing cookie parsing or signature verification.
//
// Design, and why it needs no new Cloudflare infrastructure:
//   - The token is a signed, stateless "JWT-shaped" string
//     (base64url(payload) + "." + base64url(HMAC-SHA256 signature)),
//     verified purely by recomputing the signature -- no session table,
//     no new KV namespace, no new KV reads on every request. It carries
//     nothing but an issued-at and expiry timestamp; there's exactly one
//     class of admin, so there's no role/user id to encode.
//   - Signing key: ADMIN_SESSION_SECRET (a Cloudflare Secret) if set --
//     recommended, see README -- otherwise SHA-256(COACH_PASSWORD plus a
//     fixed context string), computed server-side only and never sent
//     anywhere. Either way the actual login password itself is never
//     reused as key material directly, and (unlike the old design) it
//     never leaves the server after the one login request that checks
//     it -- every subsequent admin request only ever carries this
//     derived, time-boxed token.
//   - Web Crypto (`crypto.subtle`) is a standard Workers-runtime Web
//     API, not a new dependency -- no JWT library needed for a token
//     this simple (two fixed fields, one algorithm, no header to parse).
//
// Cookie flags: HttpOnly (never readable by page JS -- an XSS on the
// site still can't steal the session), SameSite=Strict (never sent on a
// cross-site request, so another site can't ride a logged-in admin's
// cookie), Secure whenever the request itself arrived over HTTPS (always
// true in production on Cloudflare; conditionally omitted for plain-HTTP
// local dev via `wrangler pages dev`, since a browser silently drops a
// Secure cookie set over HTTP).

import { ADMIN_SESSION_TTL_SECONDS, ADMIN_SESSION_COOKIE_NAME } from "./config.js";

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBuffer(base64url) {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((base64url.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function stringToBase64Url(str) {
  return bufferToBase64Url(new TextEncoder().encode(str).buffer);
}

function base64UrlToString(base64url) {
  return new TextDecoder().decode(base64UrlToBuffer(base64url));
}

/** Resolves the HMAC signing key from env, preferring a dedicated secret
 *  over deriving one from the login password. Returns null if NEITHER
 *  is configured -- callers treat that as "sessions unavailable" (same
 *  fail-closed posture as a missing COACH_PASSWORD elsewhere in this
 *  codebase: a clear "not set up yet" state, never a silent bypass). */
async function getSigningKey(env) {
  const encoder = new TextEncoder();
  let keyBytes;
  if (env && env.ADMIN_SESSION_SECRET) {
    keyBytes = encoder.encode(env.ADMIN_SESSION_SECRET);
  } else if (env && env.COACH_PASSWORD) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`academy-admin-session:${env.COACH_PASSWORD}`));
    keyBytes = new Uint8Array(digest);
  } else {
    return null;
  }
  return crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Mints a new session token good for ADMIN_SESSION_TTL_SECONDS from
 *  now. Returns null only if no signing key could be resolved (neither
 *  ADMIN_SESSION_SECRET nor COACH_PASSWORD set) -- callers surface that
 *  as a clear "not configured" error, same pattern as every other
 *  missing-env-var case in this codebase. */
export async function createSessionToken(env) {
  const key = await getSigningKey(env);
  if (!key) return null;
  const now = Date.now();
  const payload = { iat: now, exp: now + ADMIN_SESSION_TTL_SECONDS * 1000 };
  const payloadB64 = stringToBase64Url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${bufferToBase64Url(signature)}`;
}

/** Verifies a token's signature AND that it hasn't expired. Never
 *  throws -- any malformed input (tampered cookie, wrong key after a
 *  secret rotation, garbage value) is just "not valid," same as a wrong
 *  password. */
export async function verifySessionToken(token, env) {
  if (!token || typeof token !== "string" || !token.includes(".")) return false;
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return false;

  const key = await getSigningKey(env);
  if (!key) return false;

  let signatureBuffer;
  try {
    signatureBuffer = base64UrlToBuffer(sigB64);
  } catch {
    return false;
  }

  let valid = false;
  try {
    valid = await crypto.subtle.verify("HMAC", key, signatureBuffer, new TextEncoder().encode(payloadB64));
  } catch {
    return false;
  }
  if (!valid) return false;

  let payload;
  try {
    payload = JSON.parse(base64UrlToString(payloadB64));
  } catch {
    return false;
  }
  return Boolean(payload) && typeof payload.exp === "number" && Date.now() < payload.exp;
}

function isHttpsRequest(request) {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return true; // if the URL is somehow unparseable, default to the safer (Secure-flag) behavior
  }
}

/** Set-Cookie value for a successful login. */
export function buildSessionCookie(token, request) {
  const parts = [`${ADMIN_SESSION_COOKIE_NAME}=${token}`, `Max-Age=${ADMIN_SESSION_TTL_SECONDS}`, "Path=/", "HttpOnly", "SameSite=Strict"];
  if (isHttpsRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

/** Set-Cookie value that clears the session (logout). */
export function buildLogoutCookie(request) {
  const parts = [`${ADMIN_SESSION_COOKIE_NAME}=`, "Max-Age=0", "Path=/", "HttpOnly", "SameSite=Strict"];
  if (isHttpsRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

function readCookieValue(request, name) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  return null;
}

/** The one function every admin-mutation endpoint should call first.
 *  Returns true only for a present, correctly-signed, unexpired session
 *  cookie -- false for anything else (missing, tampered, expired, or
 *  sessions simply unavailable because no signing key is configured).
 *  A direct API request with no cookie at all (or a forged one that
 *  doesn't verify) gets false here exactly the same as a normal
 *  unauthenticated browser request -- there is no separate code path
 *  that trusts a request just because it skipped the browser UI. */
export async function requireAdminSession(context) {
  const token = readCookieValue(context.request, ADMIN_SESSION_COOKIE_NAME);
  return verifySessionToken(token, context.env);
}

/** Alternate auth for functions/api/admin/patch-check.js ONLY, so an
 *  external scheduler (a small companion Worker's Cron Trigger, or a
 *  free third-party cron service -- see README) can trigger a patch
 *  check without ever holding the admin login password. Requires
 *  PATCH_CHECK_SECRET to be set AND matched exactly; if the secret
 *  isn't configured, this always returns false -- there is no default
 *  or fallback value, so an unconfigured deployment simply can't be
 *  triggered this way (the admin session path still works for the
 *  manual "Check now" button either way). */
export function hasValidPatchCheckSecret(request, env) {
  if (!env || !env.PATCH_CHECK_SECRET) return false;
  const provided = request.headers.get("X-Patch-Check-Secret");
  return Boolean(provided) && provided === env.PATCH_CHECK_SECRET;
}
