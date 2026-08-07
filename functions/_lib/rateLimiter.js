import { RATE_LIMIT_PER_HOUR } from "./config.js";

/** Best-effort per-IP rate limit using the SAME COACH_KV binding already
 *  configured for coach-overrides.js -- no new Cloudflare setup needed.
 *  Fixed hourly windows (not a sliding window) since KV doesn't support
 *  sorted-set-style windows well; a fixed window is a standard, accepted
 *  tradeoff for a limiter this lightweight. Each write carries its own
 *  expirationTtl so old buckets clean themselves up automatically rather
 *  than accumulating keys forever -- this does NOT reuse or compete with
 *  the "coach-overrides" key that the Coach Mode editor writes to, so it
 *  can never contribute to that separate KV-put quota.
 *  Fails OPEN (allows the request through) if COACH_KV isn't bound or a
 *  KV call errors -- the size caps in config.js are a second, independent
 *  layer of defense, and a temporarily-unavailable KV store shouldn't
 *  take down the whole AI Coach feature over a rate-limit check. */
export async function checkRateLimit(kv, ip) {
  if (!kv || !ip) return { limited: false };
  const hourBucket = Math.floor(Date.now() / 3600000);
  const key = `ratelimit:coach:${ip}:${hourBucket}`;
  try {
    const current = parseInt((await kv.get(key)) || "0", 10);
    if (current >= RATE_LIMIT_PER_HOUR) return { limited: true };
    await kv.put(key, String(current + 1), { expirationTtl: 3700 });
    return { limited: false };
  } catch {
    return { limited: false }; // fail open -- see comment above
  }
}
