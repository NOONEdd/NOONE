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
