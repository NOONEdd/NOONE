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
  // `patch` is the KV-set current-patch override (see
  // src/lib/effectiveData.js's resolveEffectivePatch()); null means
  // "not set," which falls back to src/data/patch.js's static value.
  // `verifiedPatch`/`patchStatus` feed resolvePatchDataStatus() in that
  // same file -- kept alongside `patch` in this one object (not a
  // separate KV key) so a patch bump and its verification state are
  // always read/written together, never able to drift out of sync.
  const empty = { champions: {}, items: {}, runes: {}, decisionTrees: {}, patch: null, verifiedPatch: null, patchStatus: null };
  if (!kv) return empty;
  try {
    const value = await kv.get(KEY);
    return value ? JSON.parse(value) : empty;
  } catch {
    return empty;
  }
}
