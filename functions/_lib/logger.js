/** Goes to Cloudflare's real-time Function logs (dashboard -> your
 *  project -> Functions -> Real-time Logs), never anywhere user-visible.
 *  Called at two points per request in functions/api/coach.js: once
 *  right after grounding completes (so even a request that then fails
 *  at the AI provider still tells you what was detected and how long
 *  KV took), and once more at the end with the outcome. NEVER pass an
 *  API key, password, or raw user message text into this -- everything
 *  logged here ends up in a dashboard that might get screenshotted or
 *  shared, and none of that is needed to diagnose a slow or wrong-
 *  feeling answer. */
export function logCoachEvent(fields) {
  console.log(JSON.stringify({ path: "/api/coach", ...fields }));
}

/** Same idea as logCoachEvent above, scoped to Patch Intelligence
 *  (functions/api/admin/patch-check.js). Added specifically so a failed
 *  analysis is actually diagnosable from Cloudflare's real-time Function
 *  logs -- previously the detailed failure reason (raw AI reply length,
 *  finish/stop reason, a bounded snippet of what the model actually
 *  returned) was computed by patchIntelligence.js but discarded rather
 *  than surfaced anywhere. Same rule as logCoachEvent: never pass an API
 *  key, password, session token, or webhook URL into this -- only
 *  already-bounded, already-safe diagnostic fields (provider, model,
 *  reply length, finish reason, a truncated raw-reply snippet, a parse
 *  error message). Every call site in patch-check.js passes fields that
 *  originate from patchIntelligence.js's own `logDetail`, which already
 *  follows this same rule at its source. */
export function logPatchIntelEvent(fields) {
  console.log(JSON.stringify({ path: "/api/admin/patch-check", ...fields }));
}
