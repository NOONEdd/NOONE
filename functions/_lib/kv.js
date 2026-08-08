const KEY = "coach-overrides";

/** Reads the exact same KV key functions/api/coach-overrides.js reads, so
 *  the AI Coach is grounded in whatever Coach Mode edits are live on the
 *  site RIGHT NOW -- if you just changed a champion's build five minutes
 *  ago, the AI already knows about it, no redeploy required. Never
 *  throws: on any KV problem, returns an empty override set so the AI
 *  still has the static baseline data (champions.js etc.) to work with
 *  instead of failing the whole request over a KV hiccup. */
export async function fetchOverrides(kv) {
  // Matches src/hooks/useCoachOverrides.js's EMPTY constant exactly --
  // previously missing decisionTrees here (harmless in practice, since
  // every read of it uses optional chaining, but worth keeping the two
  // shapes in sync).
  const empty = { champions: {}, items: {}, runes: {}, decisionTrees: {} };
  if (!kv) return empty;
  try {
    const value = await kv.get(KEY);
    return value ? JSON.parse(value) : empty;
  } catch {
    return empty;
  }
}
