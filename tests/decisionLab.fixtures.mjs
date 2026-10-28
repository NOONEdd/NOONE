// decisionLab test fixtures -- TEST-ONLY. Not imported by any production file.
//
// !!! FIXTURE_CONSTANTS ARE SYNTHETIC. They are NOT Wild Rift game facts. !!!
// They exist so the engine can be exercised end to end while the real
// constants remain UNVERIFIED (functions/_lib/decisionLab/gameConstants.js).
// Every value below was chosen only so that all factor levels are reachable
// in tests (for example: travel time "far" exceeds the largest availability
// window, so a far-away member never arrives). A scenario generated from
// these constants is stamped status TEST_FIXTURE in its provenance and is
// never servable (validator.isServable).
//
// The fake entity resolver and the entity refs used in tests are also
// fixtures ("fixture:*" ids). They prove the extension path for future
// Academy-backed champion/item/rune/spell references without asserting any
// fact about a real champion or item.

import { deepFreeze } from "../functions/_lib/decisionLab/config.js";
import { assembleScenario } from "../functions/_lib/decisionLab/generator.js";
import { OBJECTIVE_TRADE_TEMPLATE } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";

export const FIXTURE_CONSTANTS = deepFreeze({
  schema: 1,
  id: "objective_trade",
  status: "TEST_FIXTURE",
  version: "fixture.1",
  verifiedForPatch: null,
  notice: "SYNTHETIC values for engine tests only. NOT Wild Rift game facts.",
  values: {
    zones: ["top_side", "mid", "bot_side"],
    distance: {
      top_side: { top_side: "same", mid: "near", bot_side: "far" },
      mid: { top_side: "near", mid: "same", bot_side: "near" },
      bot_side: { top_side: "far", mid: "near", bot_side: "same" },
    },
    travelSec: { same: 0, near: 20, far: 40 },
    objectives: {
      dragon: { zone: "bot_side", firstSpawnSec: 300 },
      riftHerald: { zone: "top_side", firstSpawnSec: 360 },
    },
    window: { sharedWindowMaxGapSec: 10, availableInSec: { min: 5, max: 30 }, contestGraceSec: 5 },
    time: { earlyWindowSec: { min: 480, max: 900 } },
    info: { staleAfterSec: 15 },
  },
});

/** A constants object that is structurally valid but impossible to satisfy
 *  (both objectives share a zone-free timing window of zero width and the
 *  time range is empty). Used to prove generation fails cleanly. */
export function withConstants(mutator) {
  const copy = JSON.parse(JSON.stringify(FIXTURE_CONSTANTS));
  mutator(copy);
  return copy;
}

/** Fake Academy-entity resolver. `data` maps "kind:id" -> record of fields.
 *  Returning null means "does not resolve". */
export function makeFakeResolver(data) {
  return {
    fingerprint(kind, id, fields) {
      const rec = data[`${kind}:${id}`];
      if (!rec) return null;
      return JSON.stringify(fields.map((f) => [f, rec[f] === undefined ? null : rec[f]]));
    },
  };
}

/** Test harness in the repo's existing idiom (see tests/patchIntelRetryVsDetect.test.mjs). */
export function createHarness() {
  let pass = 0;
  let fail = 0;
  const failures = [];
  function check(label, cond, detail) {
    if (cond) {
      pass += 1;
      console.log(`  PASS  ${label}`);
    } else {
      fail += 1;
      failures.push(label);
      console.log(`  FAIL  ${label}${detail !== undefined ? `  -- ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
    }
  }
  function finish() {
    console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
    if (fail > 0) process.exit(1);
  }
  return { check, finish, counts: () => ({ pass, fail }), failures };
}

// ---------------------------------------------------------------------------
// Hand-built raw states (used by golden, evaluator, validator and determinism
// tests). Positions/timers are consistent with FIXTURE_CONSTANTS only.
// neutralRaw() reads NEUTRAL on every factor (a state in which nothing is
// decisive); tests perturb it one fact at a time so each expectation is
// attributable to a single change.
// ---------------------------------------------------------------------------

/** Deep copy of plain JSON-like data (tests mutate copies, never fixtures). */
export function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

export function neutralRaw() {
  const A = (zone) => ({ zone, status: "alive", hpBand: "high", completedItems: 1 });
  const E = (zone) => ({ zone, status: "alive", hpBand: "high", completedItems: 1, lastSeenAgoSec: 0 });
  const lane = () => ({ turret: { allied: "intact", enemy: "intact" }, pressure: "none" });
  const comp = () => ({ burst: "medium", crowdControl: "medium", engage: "medium" });
  const zones = (v) => ({ top_side: v, mid: v, bot_side: v });
  return {
    gameContext: { gameTimeSec: 600, windowKind: "shared", goldBand: "even" },
    teams: {
      allies: { composition: comp(), members: { baron: A("top_side"), jungle: A("top_side"), mid: A("mid"), dragon: A("bot_side"), support: A("bot_side") } },
      enemies: { composition: comp(), members: { baron: E("top_side"), jungle: E("top_side"), mid: E("mid"), dragon: E("bot_side"), support: E("top_side") } },
    },
    lanes: { top: lane(), mid: lane(), bot: lane() },
    waves: { top: "neutral", mid: "crashing_into_enemy", bot: "pushed_to_enemy" },
    objectives: {
      dragon: { status: "upcoming", availableInSec: 20, stakes: "medium", followUp: "neutral", activity: "none" },
      riftHerald: { status: "upcoming", availableInSec: 25, stakes: "medium", followUp: "neutral", activity: "none" },
    },
    vision: { allies: zones("partial"), enemies: zones("partial"), fogRisk: zones("low"), safeToClear: zones(false) },
  };
}

/** Set a dotted path on a raw state (tests only). */
export function setPath(raw, path, value) {
  const keys = path.split(".");
  let o = raw;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = value;
}

/** Move allied members to a zone (tests only). */
export function moveAllies(raw, slots, zone) {
  for (const s of slots) raw.teams.allies.members[s].zone = zone;
}

/** Build a hand-specified scenario through the SAME assembleScenario path a
 *  generated or coach-crafted scenario takes. Starts from neutralRaw() and
 *  applies `mutate`. Returns { ok, violations, scenario, answerKey, publicScenario }. */
export function craft({ structure, primary = "dragon", alternative = "riftHerald", actions, difficulty, mutate, origin = "engine_fixture", constants = FIXTURE_CONSTANTS, dataInputs = {}, versionOverrides = null }) {
  const raw = neutralRaw();
  if (mutate) mutate(raw);
  return assembleScenario({ template: OBJECTIVE_TRADE_TEMPLATE, constants, dataInputs, origin, raw, structure, primary, alternative, actionTypes: actions, difficulty, versionOverrides });
}
