// decisionLab -- Scenario Generator (spec sections 6-11, 26-30, 60-62).
//
// Constraint-driven, not "random values and hope":
//
//   Template -> Constraints -> Factor Selection -> State Construction
//            -> Relationship Resolution -> Decision Construction
//            -> Outcome Construction -> Validation
//
//  * Factor selection honours required / allowed / forbidden factors (per
//    template AND per decision structure) and a factor-count range that is
//    the intersection of the template's and the difficulty level's.
//  * Every factor gets a target level (exposed factors a non-neutral one,
//    everything else neutral) and stateBuilder realizes ALL of them together
//    from a dependency-resolved state; nothing is randomized independently.
//  * Bounded backtracking: a candidate that cannot be built, or that fails
//    validation, is discarded and the next candidate (a new named sub-stream
//    of the same seed) is tried, up to GENERATION_LIMITS.maxCandidates. If
//    the budget is exhausted the result is { ok: false }. An invalid scenario
//    is NEVER returned because generation was difficult.
//  * Deterministic: see the reproducibility contract in config.js.
//
// assembleScenario() is the single place a scenario is built from a raw
// state. Generated, coach-crafted and fixture scenarios all pass through it,
// so they share one schema, one validator and one staleness model.

import { VERSIONS, GENERATION_LIMITS, DIFFICULTY_PROFILES, DIFFICULTY_WEIGHTS, STATE_VOCAB, deepFreeze } from "./config.js";
import { createRng, hash32, seedToString, isValidSeed } from "./prng.js";
import { FACTORS, FACTOR_IDS, nonNeutralLevels } from "./factors.js";
import { checkConstants, constantsIdentity, CONSTANTS_STATUS } from "./gameConstants.js";
import { deriveState, crossMapLevel } from "./relationships.js";
import { buildRawState, projectPublicState, FIGHTABILITY_DRIVERS } from "./stateBuilder.js";
import { buildAnswerKey, recomputeAnswerKey } from "./scoring.js";
import { buildDependencies, computeDataFingerprint, computeScenarioRef, registryVersions, materialSignature, materialKey, materialFingerprint, stableStringify, hash64 } from "./fingerprint.js";
import { validateScenarioBundle, templateRuleIssues, templateContentIssue } from "./validator.js";
import { effectiveFactorRules, difficultyProfileIssues, evaluabilityIssues, tierSpreadIssues } from "./invariants.js";
import { OBJECTIVE_TRADE_TEMPLATE } from "./templates/objectiveTrade.js";

// --- Learning objective (spec section 6: every scenario teaches something specific) ---

function buildLearningObjective(template, structureName, active, dominantFactor) {
  // A state with no exposed factor teaches nothing. That is a validation
  // failure (edu.*), never an exception: focusFactor is null and the
  // validator reports it.
  const focus = dominantFactor && active.includes(dominantFactor) ? dominantFactor : active[0] || null;
  const principles = Array.from(new Set(active.flatMap((f) => FACTORS[f].principles))).sort();
  const tracks = Array.from(new Set(active.flatMap((f) => FACTORS[f].trackLinks.map((l) => l.trackId)))).sort();
  return {
    id: `${template.id}.${structureName}.${focus}`,
    templateGoalId: template.educationalGoal.id,
    structure: structureName,
    focusFactor: focus,
    factors: active.slice(),
    principles,
    tracks,
    summary: focus === null ? "No factor is exposed in this state" : `${FACTORS[focus].label} in a ${structureName.toLowerCase().replace("_vs_", " vs ").replace(/_/g, " ")} decision`,
  };
}

// --- Public scenario (spec sections 16, 60-61) -------------------------------------------

/** What the player receives. No answer-key data, no derived state, no
 *  reproduction details. Options carry presentation metadata only. */
export function buildPublicScenario(scenario, template, constants) {
  const p = scenario.provenance;
  const d = scenario.decision;
  return {
    publicVersion: VERSIONS.scenarioSchema,
    scenarioRef: scenario.scenarioRef,
    provenance: {
      scenarioVersion: p.scenarioVersion,
      templateId: p.templateId,
      templateVersion: p.templateVersion,
      generatorVersion: p.generatorVersion,
      rulesVersion: p.rulesVersion,
      dataFingerprint: p.dataFingerprint,
    },
    presentation: template.runtime.buildPresentation(scenario.state.raw, d.primaryObjective, d.alternativeObjective),
    state: projectPublicState(scenario.state.raw, constants),
    decision: {
      question: "What do you do?",
      options: d.options.map((o) => ({ id: o.id, label: template.runtime.optionLabel(o.actionType, d.primaryObjective, d.alternativeObjective), actionType: o.actionType })),
    },
  };
}

// --- Assembly ----------------------------------------------------------------------------------

/** Build Scenario + AnswerKey + PublicScenario from a raw state and validate.
 *  input = {
 *    template, constants, dataInputs?, origin,
 *    raw, structure, primary, alternative, actionTypes (presentation order),
 *    difficulty, reproduction?, versionOverrides?
 *  }
 *  Returns { ok, violations, scenario, answerKey, publicScenario }. The raw
 *  state is copied, never frozen in place. */
export function assembleScenario(input) {
  const { template, constants, dataInputs = {}, origin, structure, primary, alternative, actionTypes, difficulty, reproduction = null, versionOverrides = null } = input;
  // A malformed rule table is never evaluated (see ERROR_CODES.rules_invalid): no scenario is built from it.
  const ruleIssues = templateRuleIssues(template);
  if (ruleIssues.length) {
    const violations = [{ id: "template.rules_valid", layer: "template", message: ruleIssues.join("; ") }];
    return { ok: false, error: { code: "rules_invalid", issues: ruleIssues }, violations, scenario: null, answerKey: null, publicScenario: null };
  }
  // Registered labels must carry exactly the registered content (TEMPLATE_TRUST_CONTRACT.md).
  const content = templateContentIssue(template);
  if (content) {
    const violations = [{ id: "template.content_matches_registry", layer: "template", message: `the content differs from the registered pins: ${content.parts.join(", ")}` }];
    return { ok: false, error: content, violations, scenario: null, answerKey: null, publicScenario: null };
  }
  const raw = JSON.parse(JSON.stringify(input.raw));
  const versions = {
    templateVersion: (versionOverrides && versionOverrides.templateVersion) || template.version,
    generatorVersion: (versionOverrides && versionOverrides.generatorVersion) || VERSIONS.generator,
    rulesVersion: (versionOverrides && versionOverrides.rulesVersion) || template.rules.version,
  };

  const derived = deriveState(raw, constants, template.rules.thresholds);
  const dependencies = buildDependencies({ constants, raw, dataInputs });
  const dataFingerprint = computeDataFingerprint(dependencies);
  const decision = {
    structure,
    primaryObjective: primary,
    alternativeObjective: alternative,
    options: actionTypes.map((a) => ({ id: a.toLowerCase(), actionType: a })),
  };
  const registries = registryVersions();
  const constantsId = constantsIdentity(constants);
  const scenarioRef = computeScenarioRef({
    scenarioVersion: VERSIONS.scenarioSchema,
    stateSchemaVersion: VERSIONS.stateSchema,
    template: { id: template.id, version: versions.templateVersion, rulesVersion: versions.rulesVersion },
    generatorVersion: versions.generatorVersion,
    registries,
    constants: constantsId,
    dataFingerprint,
    difficulty,
    decision,
    raw,
  });

  // The final Answer Key comes ONLY from the authoritative recomputation over the
  // final immutable state. Nothing the generator predicted while planning is an input.
  const answerKey = recomputeAnswerKey({ template, constants, raw, decision, scenarioRef, versions });
  const active = FACTOR_IDS.filter((f) => answerKey.factorEvidence[f].exposed);
  const learningObjective = buildLearningObjective(template, structure, active, answerKey.analysis.dominantFactor);

  const scenario = {
    scenarioRef,
    scenarioVersion: VERSIONS.scenarioSchema,
    origin,
    template: { id: template.id, version: versions.templateVersion, status: template.status, rulesVersion: versions.rulesVersion, rulesStatus: template.rules.status },
    difficulty,
    decision,
    learningObjective,
    activeFactors: active,
    state: { schemaVersion: VERSIONS.stateSchema, raw, derived },
    provenance: {
      scenarioVersion: VERSIONS.scenarioSchema,
      stateSchemaVersion: VERSIONS.stateSchema,
      templateId: template.id,
      templateVersion: versions.templateVersion,
      generatorVersion: versions.generatorVersion,
      rulesVersion: versions.rulesVersion,
      registries,
      constants: constantsId,
      dataFingerprint,
      dependencies,
      reproduction,
    },
    fingerprints: { material: null },
  };
  const signature = materialSignature({ scenario, answerKey, constants });
  scenario.fingerprints.material = { hash: materialFingerprint(signature), key: materialKey(signature), signature };

  const publicScenario = buildPublicScenario(scenario, template, constants);
  deepFreeze(scenario);
  deepFreeze(answerKey);
  deepFreeze(publicScenario);

  const verdict = validateScenarioBundle({ scenario, answerKey, publicScenario, template, constants, dataInputs });
  return { ok: verdict.ok, violations: verdict.violations, scenario, answerKey, publicScenario };
}

// --- Candidate construction -----------------------------------------------------------------

/** Digest of the player-snapshot subset the selector passed in. The
 *  generator never reads a live Player Model; it only sees this. */
export function selectionDigest(selectionContext) {
  return hash64(stableStringify(selectionContext === undefined ? null : selectionContext));
}

/** Error string for a selection context the generator cannot use, or null.
 *  It must be absent or a plain object; the avoid lists, when present, are
 *  arrays of strings; and it must be canonically serializable, because its
 *  digest is recorded in provenance. Other keys are allowed (they are digested). */
function selectionContextIssue(selectionContext) {
  if (selectionContext === null || selectionContext === undefined) return null;
  if (typeof selectionContext !== "object" || Array.isArray(selectionContext)) return "selectionContext must be null or a plain object";
  for (const k of ["avoidMaterialKeys", "avoidScenarioRefs"]) {
    const list = selectionContext[k];
    if (list !== undefined && list !== null && !(Array.isArray(list) && list.every((x) => typeof x === "string"))) return `selectionContext.${k} must be an array of strings`;
  }
  try {
    stableStringify(selectionContext);
  } catch (e) {
    return `selectionContext must be canonically serializable (${e.message})`;
  }
  return null;
}

function intersectRange(a, b) {
  return { min: Math.max(a.min, b.min), max: Math.min(a.max, b.max) };
}

function chooseTimings(rng, constants, primary, alternative, activity) {
  const v = constants.values;
  const win = v.window.availableInSec;
  const gap = v.window.sharedWindowMaxGapSec;
  // The window range describes UPCOMING objectives. An objective the enemy is
  // already taking is available now (0).
  const p = activity === "enemy_taking" ? 0 : rng.int(win.min, win.max);
  let a = null;
  if (alternative) {
    const lo = Math.max(0, p - gap, activity === "enemy_taking" ? 0 : win.min);
    const hi = Math.min(win.max, p + gap);
    if (lo > hi) return null;
    a = rng.int(lo, hi);
  }
  const spawnNeed = Math.max(v.objectives[primary].firstSpawnSec - p, alternative ? v.objectives[alternative].firstSpawnSec - a : -Infinity);
  const tMin = Math.max(v.time.earlyWindowSec.min, spawnNeed);
  const tMax = v.time.earlyWindowSec.max;
  if (tMin > tMax) return null;
  return { gameTimeSec: rng.int(tMin, tMax), primary: p, alternative: a };
}

/** Difficulty is decided ONCE per seed (from its own sub-stream), never per
 *  attempt: re-drawing it per attempt would let the harder levels lose more
 *  candidates to rejection and silently skew the distribution easy. */
export function difficultyForSeed(template, seed, requestedDifficulty) {
  if (requestedDifficulty !== null) return requestedDifficulty;
  const levels = Object.keys(DIFFICULTY_PROFILES).map(Number).filter((d) => d >= template.difficultyRange.min && d <= template.difficultyRange.max);
  return createRng(seed, "difficulty").weightedPick(levels, levels.map((d) => DIFFICULTY_WEIGHTS[d]));
}

/** Predict the answer key a plan WOULD produce, from its target levels alone,
 *  using the same buildAnswerKey the real scenario uses. The stub state carries
 *  only what the rule table reads: the primary objective's activity, the
 *  setup opportunity of the primary zone, the cross-map counts the plan
 *  committed to, and (assumed) clear information. Fightability and every other
 *  factor enter as their target LEVELS. It is a planning aid ONLY: it decides
 *  which plans are worth building, it is never stored in a scenario, and the
 *  final Answer Key is always recomputed from the final state (scoring.js
 *  recomputeAnswerKey). The real state is validated in full afterwards. */
function predictAnswerKey({ template, constants, plan }) {
  const zone = constants.values.objectives[plan.primary].zone;
  const rawStub = { objectives: { [plan.primary]: { activity: plan.activity } } };
  const counts = plan.crossMapCounts || { ourY: 0, resp: 0 };
  const derivedStub = {
    infoQuality: { level: "clear" },
    vision: { [zone]: { setupOpportunity: plan.targets.vision_gap === "behind" ? (plan.safeToClearPrimary ? 1 : -1) : 0 } },
    crossMap: { [plan.primary]: { ourArrivals: counts.ourY, enemyResponse: counts.resp, level: plan.targets.cross_map_trade } },
  };
  const evidence = Object.fromEntries(FACTOR_IDS.map((f) => [f, ["plan"]]));
  const decision = {
    structure: plan.structureName,
    primaryObjective: plan.primary,
    alternativeObjective: plan.alternative,
    options: plan.actionTypes.map((a) => ({ id: a.toLowerCase(), actionType: a })),
  };
  return buildAnswerKey({
    template,
    scenarioRef: "sc_plan",
    raw: rawStub,
    derived: derivedStub,
    constants,
    decision,
    versions: { templateVersion: template.version, generatorVersion: VERSIONS.generator, rulesVersion: template.rules.version },
    detection: { levels: plan.targets, evidence },
    withInfluences: false, // a construction aid: the counterfactual pass belongs to final keys only
  }).answerKey;
}

/** { key, issues } for a plan: the predicted key is returned so the accepted
 *  plan's prediction is not computed a second time for stats.planned. */
function planIssues({ template, plan, difficulty }) {
  const key = predictAnswerKey({ template, constants: plan.constants, plan });
  const active = FACTOR_IDS.filter((f) => key.factorEvidence[f].exposed);
  const issues = [
    ...(key.defensible.length >= 1 ? [] : ["no defensible option"]),
    ...difficultyProfileIssues(difficulty, key.analysis),
    ...evaluabilityIssues(active, key.options, template.rules.signals.minAttributionMass),
    ...tierSpreadIssues(difficulty, key.options, key.analysis),
  ];
  return { key, issues };
}

// --- Stratified fightability coverage -------------------------------------------------------------
//
// Why: every failed attempt used to re-draw a random fightability level and
// driver, so strata that fail more often at state construction (positioning
// needs placements, combos need specific compositions) were silently filtered
// out -- systematic under-sampling that has nothing to do with realism.
//
// How: each seed is assigned ONE stratum (level x driver, round-robin so
// consecutive seeds cover all eight equally). It applies whenever the
// ordinary factor selection includes fightability, and it stays fixed across
// retries, so a hard stratum costs more attempts instead of disappearing. It
// never forces fightability into a plan (exposure still comes from the normal
// selection and from the state), it sets no target share for any outcome, and
// a slice of each candidate's plan budget is unconstrained, so a stratum the
// rules cannot satisfy for this structure and difficulty is relaxed, not
// forced. What is realized is what the rules make feasible; the report shows it.

export const FIGHTABILITY_STRATA = Object.freeze(
  ["favorable", "unfavorable"].flatMap((level) => FIGHTABILITY_DRIVERS.map((driver) => Object.freeze({ level, driver }))),
);

/** Deterministic stratum for a seed (round-robin for non-negative integer seeds). */
export function fightabilityStratumForSeed(seed) {
  const n = FIGHTABILITY_STRATA.length;
  const idx = Number.isSafeInteger(seed) && seed >= 0 ? seed % n : hash32(`fightability-stratum|${seedToString(seed)}`) % n;
  return FIGHTABILITY_STRATA[idx];
}

/** One plan: decision structure, factor selection, target levels, objective
 *  window, options and information background -- everything except the state. */
function makePlan({ template, constants, rng, difficulty, structureName, factorRules, focus = null, stratum = null }) {
  const profile = DIFFICULTY_PROFILES[difficulty];
  const structure = template.structures[structureName];

  // Factor selection: required / allowed / forbidden, and count range.
  const { required, forbidden, allowed } = factorRules;
  if (required.some((f) => forbidden.includes(f) || !allowed.includes(f))) return { ok: false, reason: "factor_rules_conflict" };
  const range = intersectRange(template.factorCount, profile.factorCount);
  const minCount = Math.max(range.min, required.length);
  const maxCount = Math.min(range.max, allowed.length);
  if (minCount > maxCount) return { ok: false, reason: "factor_count_range_empty" };
  const rF = rng.fork("factors");
  const count = rF.int(minCount, maxCount);
  let pool = rF.shuffle(allowed.filter((f) => !required.includes(f)));
  let take = count - required.length;

  // Controlled coverage (see coverageFocusForSeed): a fightability focus asks
  // for that level (and driver) to be REALIZED IN THE STATE. It changes only
  // which factors the plan selects; exposure is still decided by the state and
  // the answer key that follow. "even" means fightability is not exposed.
  const fightFocus = focus && focus.fightability ? focus.fightability : null;
  if (fightFocus) {
    const others = pool.filter((f) => f !== "fightability");
    if (fightFocus.level === "even") pool = others;
    else if (!required.includes("fightability")) {
      if (!allowed.includes("fightability")) return { ok: false, reason: "focus_infeasible" };
      pool = ["fightability", ...others];
      take = Math.max(take, 1);
      if (required.length + take > maxCount) return { ok: false, reason: "focus_infeasible" };
    }
  }
  const optional = pool.slice(0, take);
  const active = FACTOR_IDS.filter((f) => required.includes(f) || optional.includes(f));

  // Target level for every factor: exposed -> non-neutral, otherwise neutral.
  const rT = rng.fork("targets");
  const targets = {};
  for (const f of FACTOR_IDS) targets[f] = active.includes(f) ? rT.pick(nonNeutralLevels(f)) : FACTORS[f].neutral;
  if (fightFocus && fightFocus.level !== "even" && active.includes("fightability")) targets.fightability = fightFocus.level;
  // The seed's stratum applies only where fightability is selected anyway (and no explicit focus was requested).
  const seedStratum = !fightFocus && stratum && active.includes("fightability") ? stratum : null;
  if (seedStratum) targets.fightability = seedStratum.level;

  // Objective window.
  const rW = rng.fork("window");
  const needsAlternative = structure.requiresAlternative || targets.cross_map_trade !== "none";
  const windowKind = needsAlternative ? "shared" : rW.pick(STATE_VOCAB.windowKind);
  const primary = rW.pick(STATE_VOCAB.objectiveIds);
  const alternative = windowKind === "shared" ? STATE_VOCAB.objectiveIds.find((id) => id !== primary) : null;
  const activity = !structure.requiresIdle && targets.enemy_access !== "weak" && rW.chance(1, 3) ? "enemy_taking" : "none";
  const timing = chooseTimings(rng.fork("timing"), constants, primary, alternative, activity);
  if (!timing) return { ok: false, reason: "timing_infeasible" };

  // Fightability is a factor: a non-even level is REALIZED through one of
  // composition / items / a burst+CC combination / positioning.
  const rB = rng.fork("backgroundChoice");
  const pickedDriver = rB.pick(FIGHTABILITY_DRIVERS);
  const fightabilityDriver = targets.fightability === "even" ? null : fightFocus && fightFocus.driver ? fightFocus.driver : seedStratum ? seedStratum.driver : pickedDriver;
  // Information quality is the one non-factor driver: only where the level allows it.
  const infoMode = profile.backgroundSignals || active.includes("vision_gap") ? "free" : "clear";
  const safeToClearPrimary = targets.vision_gap === "behind" ? rB.chance(1, 2) : null;

  // Cross-map counts the state must realize exactly (arrivals at the
  // alternative for us / the enemy's response), consistent with the level.
  let crossMapCounts = null;
  if (alternative && targets.cross_map_trade !== "none") {
    const th = template.rules.thresholds;
    const pairs = [];
    for (let ourY = 0; ourY <= STATE_VOCAB.slots.length; ourY++) for (let resp = 0; resp <= STATE_VOCAB.slots.length; resp++) if (crossMapLevel(ourY, resp, th) === targets.cross_map_trade) pairs.push({ ourY, resp });
    crossMapCounts = rng.fork("crossMapCounts").pick(pairs);
  }

  // Decision construction: base actions of the structure, plus (at higher
  // difficulty) one extra action; every offered action must be available.
  const rO = rng.fork("options");
  const pre = { raw: { objectives: { [primary]: { activity } } }, primary, alternative };
  const actions = structure.actions.slice();
  for (const a of actions) if (!template.runtime.preconditionOf(a, pre, template.rules).ok) return { ok: false, reason: `base_action_unavailable:${a}` };
  if (difficulty >= template.constraints.extraOptionMinDifficulty) {
    const extras = structure.extraActions.filter((a) => template.runtime.preconditionOf(a, pre, template.rules).ok);
    if (extras.length > 0 && rO.chance(1, 2)) actions.push(rO.pick(extras));
  }
  return {
    ok: true,
    plan: { constants, structureName, primary, alternative, windowKind, activity, timing, targets, fightabilityDriver, crossMapCounts, infoMode, safeToClearPrimary, actionTypes: rO.shuffle(actions) },
  };
}

/** Decision structure, likewise decided once per seed (see difficultyForSeed):
 *  structures that satisfy plans less often must not lose share to rejection. */
export function structureForSeed(template, seed, difficulty) {
  const names = Object.keys(template.structures).filter((n) => (template.structures[n].minDifficulty || template.difficultyRange.min) <= difficulty);
  return createRng(seed, "structure").weightedPick(names, names.map((n) => template.structures[n].weight));
}

function buildCandidate({ template, constants, seed, attempt, difficulty, structureName, focus }) {
  const stratum = fightabilityStratumForSeed(seed);
  const rng = createRng(seed, `candidate/${attempt}`);
  const rules = template.rules;

  // Planning loop (cheap: no state is built). Keep sampling plans until one is
  // predicted to satisfy the difficulty level; bounded.
  const factorRules = effectiveFactorRules(template, structureName); // fixed for the seed: computed once, not per plan sample
  let plan = null;
  let predictedKey = null;
  let lastReason = "plan_unsatisfiable";
  for (let i = 0; i < GENERATION_LIMITS.maxPlanSamples && !plan; i++) {
    const made = makePlan({ template, constants, rng: rng.fork(`plan/${i}`), difficulty, structureName, factorRules, focus, stratum: i < GENERATION_LIMITS.maxStratifiedPlanSamples ? stratum : null });
    if (!made.ok) {
      lastReason = made.reason;
      continue;
    }
    const verdict = planIssues({ template, plan: made.plan, difficulty });
    if (verdict.issues.length === 0) {
      plan = made.plan;
      predictedKey = verdict.key;
    }
  }
  if (!plan) return { ok: false, reason: `plan:${lastReason}` };

  const spec = {
    primary: plan.primary,
    alternative: plan.alternative,
    windowKind: plan.windowKind,
    activity: plan.activity,
    gameTimeSec: plan.timing.gameTimeSec,
    availableInSec: { primary: plan.timing.primary, alternative: plan.timing.alternative },
    targets: plan.targets,
    fightabilityDriver: plan.fightabilityDriver,
    crossMapCounts: plan.crossMapCounts,
    background: { infoMode: plan.infoMode },
    safeToClearPrimary: plan.safeToClearPrimary,
  };
  // What the plan selected for fightability. Used ONLY to keep that decision
  // sticky across retries (see generateScenario); it is never stored in the
  // scenario and never says what the answer will be.
  const planned = plan.targets.fightability === "even" ? null : { level: plan.targets.fightability, driver: plan.fightabilityDriver };
  const predicted = Object.fromEntries(Object.entries(predictedKey.options).map(([id, o]) => [id, o.tier])); // diagnostics only
  const built = buildRawState({ spec, constants, rules, rng: rng.fork("state") });
  if (!built.ok) return { ok: false, reason: `state:${built.reason}`, planned, predicted };
  return { ok: true, raw: built.raw, structure: plan.structureName, primary: plan.primary, alternative: plan.alternative, actionTypes: plan.actionTypes, difficulty, planned, predicted };
}

// --- Focus (controlled generation) ---------------------------------------------------------------

/** A focus is a REQUEST INPUT that asks the planner to include a specific
 *  fightability level (and optionally the driver it is realized through). It
 *  is recorded in provenance.reproduction so the scenario can be regenerated.
 *  It never carries an expected answer: tiers are always computed from the
 *  final state. Returns an error string, or null when valid. */
export function validateFocus(focus) {
  if (focus === null || focus === undefined) return null;
  if (typeof focus !== "object" || Array.isArray(focus) || Object.keys(focus).some((k) => k !== "fightability")) return "focus may only contain { fightability }";
  const f = focus.fightability;
  if (f === undefined) return null;
  if (!f || typeof f !== "object" || !["favorable", "even", "unfavorable"].includes(f.level)) return "focus.fightability.level must be favorable, even or unfavorable";
  if (f.driver !== undefined && !FIGHTABILITY_DRIVERS.includes(f.driver)) return `focus.fightability.driver must be one of ${FIGHTABILITY_DRIVERS.join(", ")}`;
  // The focus is stored in provenance.reproduction, whose schema
  // (structure.no_generation_metadata) permits only these two keys.
  if (Object.keys(f).some((k) => k !== "level" && k !== "driver")) return "focus.fightability may only contain { level, driver }";
  return null;
}

// --- Public entry point ---------------------------------------------------------------------------

/** Generate one valid scenario for `seed`.
 *  request = {
 *    seed, constants,
 *    template?,            default: Objective Trade
 *    dataInputs?,          { effectivePatch?, entities? }
 *    difficulty?,          1-4 to pin a level (default: chosen deterministically)
 *    selectionContext?,    { avoidMaterialKeys?: [...], avoidScenarioRefs?: [...] } (anti-repetition)
 *    focus?,               { fightability: { level, driver? } } (controlled coverage; a request input, never an answer)
 *    origin?,              default "generated"
 *    versionOverrides?     tests only
 *  }
 *  Returns { ok: true, scenario, answerKey, publicScenario, stats } or
 *          { ok: false, error: { code, ... }, stats? }. */
export function generateScenario(request) {
  const { seed, constants, template = OBJECTIVE_TRADE_TEMPLATE, dataInputs = {}, difficulty = null, selectionContext = null, focus = null, origin = "generated", versionOverrides = null } = request;
  // Input checks, in the order of the error contract (config.js ERROR_CODES).
  if (!isValidSeed(seed)) return { ok: false, error: { code: "seed_invalid", detail: "seed must be a safe integer or a non-empty string" } };
  const check = checkConstants(constants);
  if (!check.ok) return { ok: false, error: { code: constants && constants.status === CONSTANTS_STATUS.UNVERIFIED ? "constants_unverified" : "constants_invalid", issues: check.issues } };
  const ruleIssues = templateRuleIssues(template);
  if (ruleIssues.length) return { ok: false, error: { code: "rules_invalid", issues: ruleIssues } };
  const content = templateContentIssue(template);
  if (content) return { ok: false, error: content };
  if (difficulty !== null && !(Number.isInteger(difficulty) && difficulty >= template.difficultyRange.min && difficulty <= template.difficultyRange.max)) {
    return { ok: false, error: { code: "difficulty_out_of_range", difficulty } };
  }

  const focusIssue = validateFocus(focus);
  if (focusIssue) return { ok: false, error: { code: "focus_invalid", detail: focusIssue } };
  const selectionIssue = selectionContextIssue(selectionContext);
  if (selectionIssue) return { ok: false, error: { code: "selection_context_invalid", detail: selectionIssue } };
  const digest = selectionDigest(selectionContext);
  const avoidKeys = new Set((selectionContext && selectionContext.avoidMaterialKeys) || []);
  const avoidRefs = new Set((selectionContext && selectionContext.avoidScenarioRefs) || []);
  const rejections = {};
  const samples = {}; // first violation message per reason (diagnostics only)
  const reject = (reason, message) => {
    rejections[reason] = (rejections[reason] || 0) + 1;
    if (message !== undefined && samples[reason] === undefined) samples[reason] = message;
  };

  const seedDifficulty = difficultyForSeed(template, seed, difficulty);
  const seedStructure = structureForSeed(template, seed, seedDifficulty);
  // Retry stickiness, in BOTH directions. The seed's first accepted plan decides
  // whether fightability is in the scenario (and at which level and driver),
  // exactly as the ordinary selection would. If that attempt then fails (state
  // construction or validation), later attempts keep the decision: an included
  // stratum is retried instead of being re-drawn away, and an excluded one is not
  // re-drawn into. Without this a failed attempt silently re-rolls exposure and
  // hard-to-build strata vanish (or, if only inclusion were sticky, exposure
  // would inflate with the number of failures). Only the decision is carried,
  // never any expected answer.
  let decided; // undefined until a plan is accepted; then null (excluded) or { level, driver }
  for (let attempt = 0; attempt < GENERATION_LIMITS.maxCandidates; attempt++) {
    const carriedFocus = decided === undefined ? null : decided === null ? { fightability: { level: "even" } } : { fightability: decided };
    const cand = buildCandidate({ template, constants, seed, attempt, difficulty: seedDifficulty, structureName: seedStructure, focus: focus || carriedFocus });
    if (decided === undefined && cand.planned !== undefined) decided = cand.planned;
    if (!cand.ok) {
      reject(cand.reason);
      continue;
    }
    const asm = assembleScenario({
      template,
      constants,
      dataInputs,
      origin,
      raw: cand.raw,
      structure: cand.structure,
      primary: cand.primary,
      alternative: cand.alternative,
      actionTypes: cand.actionTypes,
      difficulty: cand.difficulty,
      reproduction: { seed, candidateIndex: attempt, selectionDigest: digest, requestedDifficulty: difficulty, focus },
      versionOverrides,
    });
    if (!asm.ok) {
      reject(`invalid:${asm.violations[0].id}`, asm.violations[0].message);
      continue;
    }
    if (avoidRefs.has(asm.scenario.scenarioRef)) {
      reject("duplicate_exact");
      continue;
    }
    if (avoidKeys.has(asm.scenario.fingerprints.material.key)) {
      reject("duplicate_material");
      continue;
    }
    // stats.planned is CONSTRUCTION DIAGNOSTICS ONLY: what the planner expected. It is not part of
    // the scenario, the answer key or the public scenario, and nothing reads it as truth.
    return { ok: true, scenario: asm.scenario, answerKey: asm.answerKey, publicScenario: asm.publicScenario, stats: { attempts: attempt + 1, rejections, samples, planned: { tiers: cand.predicted, fightability: decided === undefined ? null : decided } } };
  }
  return { ok: false, error: { code: "generation_exhausted", attempts: GENERATION_LIMITS.maxCandidates }, stats: { attempts: GENERATION_LIMITS.maxCandidates, rejections, samples } };
}

