// decisionLab -- shared vocabulary, versions, and engine-mechanics tunables.
//
// This file is deliberately dependency-free and side-effect-free. Nothing
// in functions/_lib/decisionLab/ may touch an LLM, the network, KV, the
// UI, wall-clock time, Math.random, locale or any runtime-specific API
// (Cloudflare or Node). tests/decisionLab.determinism.test.mjs scans every
// file in this directory and fails the build if that ever regresses.
//
// ---------------------------------------------------------------------------
// REPRODUCIBILITY CONTRACT (v1)
// ---------------------------------------------------------------------------
//  1. A generated Scenario is a pure function of:
//        template id + template version
//        seed
//        generator version + rules version + scenario/state schema versions
//        dataFingerprint  (constants + registries + Academy entity
//                          dependencies -- see fingerprint.js)
//        selectionContext digest (the part of the player snapshot the
//                          selector chose to pass in; the generator never
//                          reads a live Player Model)
//        requested difficulty (if the caller pinned one)
//     The same inputs produce deep-equal Scenario, PublicScenario and
//     AnswerKey objects.
//  2. All randomness comes from prng.js: seeded, 32-bit integer math, with
//     named sub-streams so that adding a draw in one generation stage does
//     not shift the values drawn in another.
//  3. All scoring, attribution and tiering use integer arithmetic only, so
//     results cannot drift between JavaScript runtimes.
//  4. Game time is scenario time (seconds since game start, as a field of
//     the state). Wall-clock time never influences a scenario.
//  5. scenarioRef is a hash of the scenario's canonical CONTENT plus every
//     version and the dataFingerprint. Two different seeds that yield the
//     same content are therefore the same scenario (an exact duplicate).
//     How to regenerate a scenario (seed, candidate index, selection
//     digest) is recorded separately in provenance.reproduction.
//  6. Any change to generation logic, template data, the rule table, or a
//     registry must bump the matching version. Refs record every version;
//     a scenario whose versions are no longer in SUPPORTED_VERSIONS
//     (fingerprint.js) is "retired", never silently re-interpreted.
//  7. A scenario's state is immutable once generated (deep-frozen). If data
//     later changes, the stored state is kept for audit and the scenario is
//     flagged review_required by fingerprint.js -- it is never edited.
// ---------------------------------------------------------------------------

export function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

/** Versions that affect reproducibility. `rules` and `template` versions
 *  live with the template (they version game-truth content); everything
 *  here versions engine mechanics and object shapes. */
export const VERSIONS = deepFreeze({
  scenarioSchema: 3, // shape of Scenario / PublicScenario / AnswerKey / Evaluation (3: answer keys carry per-option factor influences and registry versions; evaluations carry factor contributions)
  stateSchema: 2, // shape of scenario.state ({ raw, derived }) (2: fightability is derived per objective, with positioning)
  generator: "1.2.0",
  evaluator: "1.2.0",
  validator: "1.2.0",
});

// --- Evaluation vocabulary (spec sections 3, 35, 37-38, 42) -----------------

export const TIERS = deepFreeze(["STRONG", "VIABLE", "SITUATIONAL", "WEAK", "INVALID"]);
export const TIER_RANK = deepFreeze({ STRONG: 4, VIABLE: 3, SITUATIONAL: 2, WEAK: 1, INVALID: 0 });
/** Tiers a well-informed player could reasonably choose. */
export const DEFENSIBLE_TIERS = deepFreeze(["STRONG", "VIABLE", "SITUATIONAL"]);

/** Qualitative certainty only. The engine never produces probabilities. */
export const CERTAINTY = deepFreeze(["guaranteed", "high", "medium", "low"]);
export const SIGNALS = deepFreeze(["strong_positive", "positive", "negative", "strong_negative", "no_signal"]);
export const EVIDENCE_VALIDITY = deepFreeze(["valid", "historical_valid", "superseded", "invalid", "pending_review"]);
export const STALENESS = deepFreeze(["fresh", "review_required", "retired"]);
export const ORIGINS = deepFreeze(["generated", "coach_crafted", "engine_fixture"]);

/** Outcome-chain stages, in order (spec section 24):
 *  Decision -> Objective/Fight -> Turret/Wave/Gold -> Tempo/Map Access. */
export const STAGES = deepFreeze(["objective_fight", "turret_wave_gold", "tempo_map_access"]);

// --- State vocabulary --------------------------------------------------------
// Every enumerated raw-state field draws from here, so the state builder,
// the derivation code and invariants.js cannot disagree about what a legal
// value is.

export const STATE_VOCAB = deepFreeze({
  slots: ["baron", "jungle", "mid", "dragon", "support"], // the Academy's own role labels
  lanerSlots: ["baron", "mid", "dragon"], // slots whose absence/presence affects a lane wave
  homeZone: { baron: "top_side", jungle: null, mid: "mid", dragon: "bot_side", support: "bot_side" },
  laneZones: ["top_side", "mid", "bot_side"],
  zones: ["top_side", "mid", "bot_side", "base"],
  laneOfZone: { top_side: "top", mid: "mid", bot_side: "bot" },
  lanes: ["top", "mid", "bot"],
  status: ["alive", "recalling", "dead"],
  hpBand: ["high", "medium", "low", "none"], // "none" only for dead members
  waveState: ["crashing_into_enemy", "pushed_to_enemy", "neutral", "pushed_to_ally", "crashing_into_ally"],
  turretState: ["intact", "damaged", "vulnerable"],
  lanePressure: ["ally", "none", "enemy"],
  visionControl: ["none", "partial", "full"],
  fogRisk: ["low", "medium", "high"],
  compositionLevel: ["low", "medium", "high"],
  compositionDims: ["burst", "crowdControl", "engage"],
  goldBand: ["behind", "even", "ahead"],
  stakes: ["low", "medium", "high"],
  followUp: ["negative", "neutral", "positive"],
  activity: ["none", "enemy_taking"],
  objectiveIds: ["dragon", "riftHerald"],
  objectiveStatus: ["upcoming", "available", "not_in_window"],
  windowKind: ["shared", "primary_only"],
  maxCompletedItems: 3,
  // Future Academy-backed references. Optional on every member; the MVP
  // never populates them. See stateBuilder.js / fingerprint.js.
  entityRefKinds: ["champion", "item", "rune", "spell"],
});

// --- Difficulty (spec sections 10, 49) ---------------------------------------
// Factor-count ranges per level are the ones given in the spec. The other
// fields turn "difficulty is not just the number of factors" into checkable
// predicates over the answer key (see validator/invariants: edu.difficulty_profile).
//   conflict:  "forbidden" -> no two active factors may favour different options
//              "required"  -> at least two active factors must favour different options
//   defensible: how many options may be STRONG/VIABLE/SITUATIONAL
//   backgroundSignals: whether INFORMATION QUALITY (a certainty modifier that
//              is not itself a registry factor) may be non-clear without the
//              vision_gap factor being exposed. At L1-L2 every driver of the
//              answer must be an exposed factor. (Fightability used to be a
//              hidden driver governed by this flag; it is now a first-class
//              factor and is exposed like any other.)
export const DIFFICULTY_PROFILES = deepFreeze({
  1: { label: "one dominant factor", factorCount: { min: 1, max: 2 }, conflict: "forbidden", defensible: { min: 1, max: 1 }, backgroundSignals: false },
  2: { label: "two or three interacting factors", factorCount: { min: 2, max: 3 }, conflict: "forbidden", defensible: { min: 1, max: 2 }, backgroundSignals: false },
  3: { label: "conflicting information", factorCount: { min: 3, max: 4 }, conflict: "required", defensible: { min: 1, max: 2 }, backgroundSignals: true },
  4: { label: "multiple defensible decisions", factorCount: { min: 3, max: 5 }, conflict: "required", defensible: { min: 2, max: 3 }, backgroundSignals: true },
});
// Level 5 (free-form reasoning) is out of scope for deterministic generation.

/** Relative weights used when the caller does not pin a difficulty. */
export const DIFFICULTY_WEIGHTS = deepFreeze({ 1: 2, 2: 3, 3: 3, 4: 3 });

// --- Generation mechanics ------------------------------------------------------

export const GENERATION_LIMITS = deepFreeze({
  maxCandidates: 120, // bounded backtracking: candidates tried per seed
  maxPlanSamples: 60, // plans sampled (no state built) per candidate before it is abandoned
  maxStratifiedPlanSamples: 45, // ...of which this many honour the seed's fightability stratum; the rest are unconstrained so a stratum is preferred, never mandatory
  maxAllyCombosTried: 10, // ally placements tried before giving up on a candidate
  maxUnavailablePerTeam: 2, // dead + recalling members allowed per team
  maxCompositionDraws: 60, // rejection draws when sampling a neutral background
});

export function isInt(n) {
  return typeof n === "number" && Number.isInteger(n);
}
