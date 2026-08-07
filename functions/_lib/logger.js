/** Goes to Cloudflare's real-time Function logs (dashboard → your project
 *  → Functions → Real-time Logs), never anywhere user-visible. One line
 *  per request: what was asked, what got detected, and where the time
 *  went, so a slow or wrong-feeling answer is easy to diagnose after the
 *  fact instead of guessing. */
export function logCoachRequest({ path, championId, enemyId, kvMs, aiMs, totalMs }) {
  console.log(JSON.stringify({
    path,
    championDetected: championId || null,
    enemyDetected: enemyId || null,
    kvLatencyMs: kvMs,
    aiLatencyMs: aiMs,
    totalMs,
  }));
}
