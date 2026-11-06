// decisionLab -- game constants for the Objective Trade template.
//
// "Game constants" are facts about how Wild Rift works that the engine needs
// in order to build a coherent state: when objectives can first appear, how
// far apart map zones are and how long travel takes, how long an objective
// window is, and so on. The Academy repository does not contain any of them.
// They are FACT-layer inputs that only the coach can supply and verify, so:
//
//   * The shipped constants below are UNVERIFIED and contain NO VALUES.
//     Nothing was guessed and nothing was copied from another game or
//     from memory.
//   * The generator refuses to run against constants that are not usable
//     (checkConstants). Tests inject a clearly labelled TEST_FIXTURE set
//     (tests/decisionLab.fixtures.mjs); a scenario built from fixtures is
//     stamped with that status in its provenance and is never servable.
//   * To go live the coach supplies the values, sets status "VERIFIED" and
//     `verifiedForPatch`, and bumps `version`. Because `version` is part of
//     dataFingerprint, every scenario built on the old values becomes
//     review_required automatically (fingerprint.js).
//
// Shape of `values` (all numbers are integer seconds unless noted):
//   zones:      the lane zones ("top_side", "mid", "bot_side")
//   distance:   distance[fromZone][toZone] in {"same","near","far"}, symmetric
//   travelSec:  { same, near, far }, same = 0, same <= near <= far
//   objectives: { dragon: { zone, firstSpawnSec }, riftHerald: { zone, firstSpawnSec } }
//   window:     { sharedWindowMaxGapSec, availableInSec: {min,max}, contestGraceSec }
//   time:       { earlyWindowSec: {min,max} }   (scenario game-time range)
//   info:       { staleAfterSec }               (older than this = stale information)

import { deepFreeze, STATE_VOCAB, isInt } from "./config.js";

export const CONSTANTS_STATUS = deepFreeze({
  UNVERIFIED: "UNVERIFIED",
  VERIFIED: "VERIFIED",
  TEST_FIXTURE: "TEST_FIXTURE",
});

export const OBJECTIVE_TRADE_CONSTANTS = deepFreeze({
  schema: 1,
  id: "objective_trade",
  status: CONSTANTS_STATUS.UNVERIFIED,
  version: "unverified.0",
  verifiedForPatch: null,
  notice: "No values supplied. Awaiting coach-verified constants; see the header of gameConstants.js.",
  values: null,
});

const DISTANCE_CLASSES = ["same", "near", "far"];

/** Validate a constants object. Returns { ok, issues } where each issue is
 *  { code, path, message }. `ok` is true only when the structure is valid
 *  AND the status is VERIFIED or TEST_FIXTURE. */
export function checkConstants(constants) {
  const issues = [];
  const add = (code, path, message) => issues.push({ code, path, message });

  if (!constants || typeof constants !== "object") {
    add("constants_missing", "constants", "constants object required");
    return { ok: false, issues };
  }
  if (constants.schema !== 1) add("constants_schema", "schema", "unsupported constants schema");
  if (constants.id !== "objective_trade") add("constants_id", "id", "constants id must be objective_trade");
  if (typeof constants.version !== "string" || constants.version.length === 0) add("constants_version", "version", "version required");
  if (!Object.values(CONSTANTS_STATUS).includes(constants.status)) add("constants_status", "status", "unknown status");
  if (constants.status === CONSTANTS_STATUS.UNVERIFIED) add("constants_unverified", "status", "constants are unverified and cannot be used to generate scenarios");
  if (constants.status === CONSTANTS_STATUS.VERIFIED && (typeof constants.verifiedForPatch !== "string" || constants.verifiedForPatch.trim() === "")) {
    add("constants_patch_missing", "verifiedForPatch", "VERIFIED constants must name the patch they were verified for");
  }

  const v = constants.values;
  if (v === null || typeof v !== "object") {
    add("constants_values_missing", "values", "no values supplied");
    return { ok: false, issues };
  }

  const zones = STATE_VOCAB.laneZones;
  if (!Array.isArray(v.zones) || v.zones.length !== zones.length || !zones.every((z) => v.zones.includes(z))) {
    add("constants_zones", "values.zones", "zones must be the three lane zones");
  }
  if (!v.distance || typeof v.distance !== "object") {
    add("constants_distance", "values.distance", "distance matrix required");
  } else {
    for (const a of zones) {
      for (const b of zones) {
        const d = v.distance[a] && v.distance[a][b];
        if (!DISTANCE_CLASSES.includes(d)) add("constants_distance", `values.distance.${a}.${b}`, "distance class must be same|near|far");
        else if (a === b && d !== "same") add("constants_distance", `values.distance.${a}.${b}`, "a zone is 'same' as itself");
        else if (a !== b && d === "same") add("constants_distance", `values.distance.${a}.${b}`, "distinct zones cannot be 'same'");
        else if (v.distance[b] && v.distance[b][a] !== d) add("constants_distance", `values.distance.${a}.${b}`, "distance must be symmetric");
      }
    }
  }
  const t = v.travelSec;
  if (!t || !isInt(t.same) || !isInt(t.near) || !isInt(t.far) || t.same !== 0 || !(t.same <= t.near && t.near <= t.far)) {
    add("constants_travel", "values.travelSec", "travelSec needs integer same=0 <= near <= far");
  }
  for (const id of STATE_VOCAB.objectiveIds) {
    const o = v.objectives && v.objectives[id];
    if (!o || !zones.includes(o.zone) || !isInt(o.firstSpawnSec) || o.firstSpawnSec < 0) {
      add("constants_objective", `values.objectives.${id}`, "objective needs a lane zone and integer firstSpawnSec >= 0");
    }
  }
  const [oa, ob] = STATE_VOCAB.objectiveIds.map((id) => v.objectives && v.objectives[id]);
  if (oa && ob && oa.zone === ob.zone) add("constants_objective", "values.objectives", "the two objectives must be in different zones");
  const w = v.window;
  const rangeOk = (r) => r && isInt(r.min) && isInt(r.max) && r.min >= 0 && r.max >= r.min;
  if (!w || !isInt(w.sharedWindowMaxGapSec) || w.sharedWindowMaxGapSec < 0 || !isInt(w.contestGraceSec) || w.contestGraceSec < 0 || !rangeOk(w.availableInSec)) {
    add("constants_window", "values.window", "window needs sharedWindowMaxGapSec, contestGraceSec and availableInSec {min,max}");
  }
  if (!v.time || !rangeOk(v.time.earlyWindowSec)) add("constants_time", "values.time.earlyWindowSec", "earlyWindowSec {min,max} required");
  if (!v.info || !isInt(v.info.staleAfterSec) || v.info.staleAfterSec <= 0) add("constants_info", "values.info.staleAfterSec", "staleAfterSec must be a positive integer");

  return { ok: issues.length === 0, issues };
}

/** The identity slice recorded in provenance and folded into dataFingerprint. */
export function constantsIdentity(constants) {
  return {
    id: constants.id,
    version: constants.version,
    status: constants.status,
    verifiedForPatch: constants.verifiedForPatch === undefined ? null : constants.verifiedForPatch,
  };
}
