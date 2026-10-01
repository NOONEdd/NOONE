// Lenient KV read for read-only consumers of Coach Mode data (the AI
// Coach, /api/version, Patch Intelligence's Academy-comparison step).
// These want "whatever's live, or the safe empty default" and would
// rather answer from static data than fail a whole request over a KV
// hiccup -- they never write, so there's nothing here for them to
// silently corrupt.
//
// Anything that WRITES coach-overrides -- Coach Mode saves, Patch
// Intelligence publish, admin restore -- must NOT use this file. Use
// functions/_lib/kvSafety.js's mutateOverrides() instead, which is the
// one place a read failure is never treated as "empty" and every write
// is backed up, validated, and revisioned first. See that file's header
// comment for why this split exists.

import { EMPTY_OVERRIDES } from "./kvSafety.js";

const KEY = "coach-overrides";
export { EMPTY_OVERRIDES };

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
  // `revision`/`updatedAt` (added by kvSafety.js) are along for the ride
  // here too but unused by every current caller of this function.
  if (!kv) return EMPTY_OVERRIDES;
  try {
    const value = await kv.get(KEY);
    return value ? JSON.parse(value) : EMPTY_OVERRIDES;
  } catch {
    return EMPTY_OVERRIDES;
  }
}
