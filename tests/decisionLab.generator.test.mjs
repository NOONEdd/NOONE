// decisionLab -- generator tests (Phases 1-4 behaviour under load).
// Plain Node ESM against the real modules, no framework or new dependency:
//
//   node tests/decisionLab.generator.test.mjs
//
// Covers: registry/template integrity, constants gating, a 5,000-seed stress
// run in which every scenario is RE-VALIDATED independently (0 invariant
// violations required), exact and material duplicate tests, fingerprint /
// near-duplicate statistics (including the material space of every decision
// structure x difficulty cell), required/allowed/forbidden factor rules,
// difficulty rules, fightability as a first-class derived factor, SITUATIONAL
// only alongside a defensible alternative, and bounded backtracking (never an
// invalid scenario).
//
// All scenarios are built from FIXTURE_CONSTANTS (synthetic, TEST_FIXTURE).

import { generateScenario, difficultyForSeed, structureForSeed, assembleScenario } from "../functions/_lib/decisionLab/generator.js";
import { validateScenarioBundle, checkInvariantRegistry, isServable } from "../functions/_lib/decisionLab/validator.js";
import { OBJECTIVE_TRADE_TEMPLATE as T } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { GENERATION_LIMITS, DIFFICULTY_PROFILES, DIFFICULTY_WEIGHTS, STATE_VOCAB } from "../functions/_lib/decisionLab/config.js";
import { FACTOR_IDS, FACTORS, checkRegistryIntegrity } from "../functions/_lib/decisionLab/factors.js";
import { TRACKS } from "../functions/_lib/decisionLab/tracks.js";
import { OBJECTIVE_TRADE_CONSTANTS, checkConstants } from "../functions/_lib/decisionLab/gameConstants.js";
import { INVARIANT_IDS } from "../functions/_lib/decisionLab/invariants.js";
import { materialSignature, signatureDistance } from "../functions/_lib/decisionLab/fingerprint.js";
import { FIXTURE_CONSTANTS, withConstants, neutralRaw, copy, createHarness } from "./decisionLab.fixtures.mjs";

const { check, finish } = createHarness();
const SEEDS = 5000;

// ---------------------------------------------------------------------------
console.log("\n[1] Registries, template and constants gating");
{
  check("factor/track/principle registries are internally consistent", checkRegistryIntegrity().length === 0, checkRegistryIntegrity());
  check("skill tracks: exactly the seven specified, equal global weight", Object.keys(TRACKS).length === 7 && Object.values(TRACKS).every((t) => t.weight === 1 && t.initialEvidence === "insufficient_evidence"));
  check("the nine factors are registered: the eight initial Objective Trade factors plus fightability", FACTOR_IDS.length === 9 && ["objective_value", "team_access", "enemy_access", "fightability", "cross_map_trade", "turret_pressure", "vision_gap", "wave_consequences", "long_term_map_value"].every((f) => FACTORS[f]));
  check("fightability is a first-class factor that contributes to the Fightability skill track (and is derived, not generated)", FACTORS.fightability.trackLinks.some((l) => l.trackId === "fightability" && l.weight === 1.0) && FACTORS.fightability.valueClass === "state_derived" && /never generated as a fact/.test(FACTORS.fightability.description));
  check("objective_value and long_term_map_value are classified scenario-contextual (not universal game facts); every other factor is state-derived", FACTOR_IDS.every((f) => FACTORS[f].valueClass === (["objective_value", "long_term_map_value"].includes(f) ? "scenario_contextual" : "state_derived")) && ["objective_value", "long_term_map_value"].every((f) => /not a universal Wild Rift game fact/.test(FACTORS[f].description)));
  check("template declares exactly the invariants the validator implements", checkInvariantRegistry(T).length === 0, checkInvariantRegistry(T));
  check("45 invariants implemented", INVARIANT_IDS.length === 45, INVARIANT_IDS.length);
  check("template is DRAFT and its rule table is DRAFT (not servable)", T.status === "draft" && T.rules.status === "DRAFT");
  check("production constants are UNVERIFIED and carry no values", OBJECTIVE_TRADE_CONSTANTS.status === "UNVERIFIED" && OBJECTIVE_TRADE_CONSTANTS.values === null);
  check("production constants are rejected by checkConstants", checkConstants(OBJECTIVE_TRADE_CONSTANTS).ok === false);
  const refused = generateScenario({ seed: 1, constants: OBJECTIVE_TRADE_CONSTANTS });
  check("generation refuses UNVERIFIED production constants", refused.ok === false && refused.error.code === "constants_unusable", refused);
  check("fixture constants are usable and labelled TEST_FIXTURE", checkConstants(FIXTURE_CONSTANTS).ok === true && FIXTURE_CONSTANTS.status === "TEST_FIXTURE");
  const broken = withConstants((c) => {
    c.values.travelSec.far = 5; // far < near
  });
  check("structurally invalid constants are rejected", checkConstants(broken).ok === false);
  check("a seed must be an integer or string", (() => { try { generateScenario({ seed: 1.5, constants: FIXTURE_CONSTANTS }); return false; } catch (e) { return e instanceof TypeError; } })());
  check("pinning an out-of-range difficulty fails cleanly", generateScenario({ seed: 1, constants: FIXTURE_CONSTANTS, difficulty: 9 }).error.code === "difficulty_out_of_range");
}

// ---------------------------------------------------------------------------
console.log(`\n[2] Stress test: ${SEEDS} seeds, every scenario independently re-validated`);
const summaries = [];
const stats = { ok: 0, failed: 0, violations: 0, attempts: 0, maxAttempts: 0, rejections: {} };
const t0 = Date.now();
const enough = { takingSeen: 0, behindSafe: 0, behindUnsafe: 0 };
const servableSeen = { any: false };
for (let seed = 1; seed <= SEEDS; seed++) {
  const r = generateScenario({ seed, constants: FIXTURE_CONSTANTS });
  for (const [k, v] of Object.entries((r.stats && r.stats.rejections) || {})) stats.rejections[k] = (stats.rejections[k] || 0) + v;
  if (!r.ok) {
    stats.failed += 1;
    continue;
  }
  stats.ok += 1;
  stats.attempts += r.stats.attempts;
  stats.maxAttempts = Math.max(stats.maxAttempts, r.stats.attempts);
  // Independent re-validation (the generator already validated internally).
  const verdict = validateScenarioBundle({ scenario: r.scenario, answerKey: r.answerKey, publicScenario: r.publicScenario, template: T, constants: FIXTURE_CONSTANTS, dataInputs: {} });
  if (!verdict.ok) {
    stats.violations += verdict.violations.length;
    if (stats.violations <= 3) console.log("  violation sample:", JSON.stringify(verdict.violations[0]));
  }
  const s = r.scenario;
  const k = r.answerKey;
  const bestPos = s.decision.options.findIndex((o) => o.id === k.best[0]);
  summaries.push({
    seed,
    ref: s.scenarioRef,
    difficulty: s.difficulty,
    structure: s.decision.structure,
    nOptions: s.decision.options.length,
    active: s.activeFactors.slice(),
    combo: s.activeFactors.join("+"),
    fightability: k.factorEvidence.fightability.level,
    fightDriver: k.factorEvidence.fightability.exposed ? s.state.derived.objectives[s.decision.primaryObjective].fightability.driver : null,
    levels: Object.fromEntries(s.activeFactors.map((f) => [f, k.factorEvidence[f].level])),
    optionTiers: Object.values(k.options).map((o) => ({ action: o.actionType, tier: o.tier, score: o.score })),
    bestPos,
    bestTier: k.options[k.best[0]].tier,
    tiers: Object.values(k.options).map((o) => o.tier),
    defensible: k.analysis.defensibleCount,
    conflict: k.analysis.conflict,
    material: s.fingerprints.material,
    status: s.provenance.constants.status,
    origin: s.origin,
  });
  const p = s.state.raw.objectives[s.decision.primaryObjective];
  if (p.activity === "enemy_taking") enough.takingSeen += 1;
  if (k.factorEvidence.vision_gap.level === "behind") {
    if (s.state.raw.vision.safeToClear[FIXTURE_CONSTANTS.values.objectives[s.decision.primaryObjective].zone]) enough.behindSafe += 1;
    else enough.behindUnsafe += 1;
  }
  if (seed % 500 === 0 && !servableSeen.any) servableSeen.any = isServable({ scenario: s, template: T, constants: FIXTURE_CONSTANTS }).servable;
}
const seconds = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`  STATS seeds=${SEEDS} ok=${stats.ok} failed=${stats.failed} violations=${stats.violations} seconds=${seconds}`);
console.log(`  STATS attempts: mean=${(stats.attempts / Math.max(1, stats.ok)).toFixed(2)} max=${stats.maxAttempts} (limit ${GENERATION_LIMITS.maxCandidates})`);
console.log(`  STATS rejections during generation: ${JSON.stringify(stats.rejections)}`);
check(`all ${SEEDS} seeds produced a scenario`, stats.ok === SEEDS && stats.failed === 0, { ok: stats.ok, failed: stats.failed });
check(`0 invariant violations across ${SEEDS} independently re-validated scenarios`, stats.violations === 0, stats.violations);
check("backtracking stays bounded (attempts never exceed the limit)", stats.maxAttempts <= GENERATION_LIMITS.maxCandidates);
check("generation is cheap on average (mean attempts < 2)", stats.attempts / stats.ok < 2, stats.attempts / stats.ok);
check("every stress scenario is stamped TEST_FIXTURE / generated", summaries.every((x) => x.status === "TEST_FIXTURE" && x.origin === "generated"));
check("no fixture-built scenario is servable", servableSeen.any === false);

const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
const byDiff = count(summaries, (x) => x.difficulty);
const byStructure = count(summaries, (x) => x.structure);
console.log(`  STATS difficulty mix: ${JSON.stringify(byDiff)}`);
console.log(`  STATS structure mix: ${JSON.stringify(byStructure)}`);
console.log(`  STATS option count: ${JSON.stringify(count(summaries, (x) => x.nOptions))}`);
console.log(`  STATS option tiers: ${JSON.stringify(count(summaries.flatMap((x) => x.tiers), (t) => t))}`);
console.log(`  STATS best-option tier: ${JSON.stringify(count(summaries, (x) => x.bestTier))}`);
console.log(`  STATS defensible options per scenario: ${JSON.stringify(count(summaries, (x) => x.defensible))}`);
console.log(`  STATS coverage: enemy-taking=${enough.takingSeen} vision-behind(safe to clear)=${enough.behindSafe} vision-behind(unsafe)=${enough.behindUnsafe}`);

const wsum = Object.values(DIFFICULTY_WEIGHTS).reduce((a, b) => a + b, 0);
for (const d of [1, 2, 3, 4]) {
  const share = (byDiff[d] || 0) / SEEDS;
  const want = DIFFICULTY_WEIGHTS[d] / wsum;
  check(`difficulty L${d} share ${(share * 100).toFixed(1)}% is within 3pp of its weight (${(want * 100).toFixed(1)}%)`, Math.abs(share - want) < 0.03);
}
for (const s of ["CONTEST_VS_TRADE", "SETUP_VS_GIVE", "TRADE_VS_IGNORE"]) check(`decision structure ${s} occurs`, (byStructure[s] || 0) > 0);
check("every structure is only offered at or above its declared minDifficulty", summaries.every((x) => x.difficulty >= (T.structures[x.structure].minDifficulty || 1)));
check("TRADE_VS_IGNORE is offered at EVERY difficulty now that TRADE has a four-part evaluation (it needed L3+ under the first draft)", [1, 2, 3, 4].every((d) => summaries.some((x) => x.structure === "TRADE_VS_IGNORE" && x.difficulty === d)));
const cellCount = {};
for (const x of summaries) cellCount[`${x.structure} L${x.difficulty}`] = (cellCount[`${x.structure} L${x.difficulty}`] || 0) + 1;
check("every (decision structure x difficulty) cell is populated (>= 150 scenarios each): no cell has silently become infeasible", Object.keys(cellCount).length === 12 && Object.values(cellCount).every((n) => n >= 150), cellCount);
check("a structure is chosen once per seed, so its share is not eroded by rejection", summaries.every((x) => x.structure === structureForSeed(T, x.seed, difficultyForSeed(T, x.seed, null))));

// Factor rules and difficulty rules, checked directly from the scenarios.
const rng = { 1: [1, 2], 2: [2, 3], 3: [3, 4], 4: [3, 5] };
for (const d of [1, 2, 3, 4]) {
  const list = summaries.filter((x) => x.difficulty === d);
  check(`L${d}: active factor count is always within the specified ${rng[d][0]}-${rng[d][1]} (n=${list.length})`, list.every((x) => x.active.length >= rng[d][0] && x.active.length <= rng[d][1]));
  check(`L${d}: defensible options within the level's range`, list.every((x) => x.defensible >= DIFFICULTY_PROFILES[d].defensible.min && x.defensible <= DIFFICULTY_PROFILES[d].defensible.max));
  check(`L${d}: conflicting-information rule (${DIFFICULTY_PROFILES[d].conflict})`, list.every((x) => (DIFFICULTY_PROFILES[d].conflict === "required" ? x.conflict : !x.conflict)));
}
check("required factor objective_value is exposed in every scenario", summaries.every((x) => x.active.includes("objective_value")));
check("forbidden factor cross_map_trade never appears in SETUP_VS_GIVE", summaries.filter((x) => x.structure === "SETUP_VS_GIVE").every((x) => !x.active.includes("cross_map_trade")));
check("structure-required factor cross_map_trade always appears in TRADE_VS_IGNORE", summaries.filter((x) => x.structure === "TRADE_VS_IGNORE").every((x) => x.active.includes("cross_map_trade")));
check("a third option only appears from difficulty 3", summaries.filter((x) => x.nOptions === 3).every((x) => x.difficulty >= 3));
check("no generated scenario offers an INVALID option", summaries.every((x) => !x.tiers.includes("INVALID")));

// Predictability / bias.
const two = summaries.filter((x) => x.nOptions === 2);
const three = summaries.filter((x) => x.nOptions === 3);
const share = (list, pos) => list.filter((x) => x.bestPos === pos).length / list.length;
console.log(`  STATS best-option position: 2-option [${[0, 1].map((p) => (share(two, p) * 100).toFixed(1) + "%")}]  3-option [${[0, 1, 2].map((p) => (share(three, p) * 100).toFixed(1) + "%")}]`);
check("best option is not position-biased in 2-option scenarios (each slot 40-60%)", [0, 1].every((p) => share(two, p) > 0.4 && share(two, p) < 0.6));
check("best option is not position-biased in 3-option scenarios (each slot 25-42%)", [0, 1, 2].every((p) => share(three, p) > 0.25 && share(three, p) < 0.42));
const combos = count(summaries, (x) => x.combo);
const topCombo = Object.entries(combos).sort((a, b) => b[1] - a[1])[0];
console.log(`  STATS factor combinations: ${Object.keys(combos).length} distinct; most common ${(100 * topCombo[1] / SEEDS).toFixed(1)}% (${topCombo[0]})`);
check("factor combinations are not predictable: >= 60 distinct and none above 15%", Object.keys(combos).length >= 60 && topCombo[1] / SEEDS < 0.15, { distinct: Object.keys(combos).length, top: topCombo });
check("all four non-INVALID tiers occur across the run", ["STRONG", "VIABLE", "SITUATIONAL", "WEAK"].every((t) => summaries.some((x) => x.tiers.includes(t))));
check("relationship coverage: enemy-taking, and vision-behind both safe and unsafe, all occur", enough.takingSeen > 100 && enough.behindSafe > 50 && enough.behindUnsafe > 50);

// Fightability as a first-class, DERIVED factor; tier and SITUATIONAL distributions.
{
  const fightN = summaries.filter((x) => x.active.includes("fightability"));
  const byLevel = count(fightN, (x) => x.fightability);
  const drivers = count(fightN, (x) => x.fightDriver);
  console.log(`  STATS fightability exposed in ${fightN.length} scenarios (${(100 * fightN.length / SEEDS).toFixed(1)}%): levels ${JSON.stringify(byLevel)} drivers ${JSON.stringify(drivers)}`);
  check("fightability is exposed in a meaningful share of scenarios (> 8%) at both non-neutral levels", fightN.length / SEEDS > 0.08 && byLevel.favorable > 50 && byLevel.unfavorable > 50, byLevel);
  check("fightability is realized through every driver: composition, items, positioning and burst+CC combinations", ["composition", "items", "positioning"].every((d) => drivers[d] > 20) && (drivers.combo_danger || 0) + (drivers.combo_advantage || 0) > 10 && (drivers.combo_danger || 0) > 0, drivers);
  check("a gold lead never appears as a driver (composition > items > positioning > combos only)", Object.keys(drivers).every((d) => ["composition", "items", "positioning", "combo_danger", "combo_advantage"].includes(d)));

  const levelsOf = {};
  for (const x of summaries) for (const [f, l] of Object.entries(x.levels)) { levelsOf[f] = levelsOf[f] || {}; levelsOf[f][l] = (levelsOf[f][l] || 0) + 1; }
  console.log(`  STATS factor exposure by level (scenarios): ${JSON.stringify(levelsOf)}`);

  const optTiers = summaries.flatMap((x) => x.optionTiers);
  const tierCounts = count(optTiers, (o) => o.tier);
  const sit = optTiers.filter((o) => o.tier === "SITUATIONAL");
  console.log(`  STATS option tiers: ${JSON.stringify(tierCounts)}; SITUATIONAL = ${(100 * sit.length / optTiers.length).toFixed(1)}% of options, in ${(100 * summaries.filter((x) => x.tiers.includes("SITUATIONAL")).length / SEEDS).toFixed(1)}% of scenarios; by action ${JSON.stringify(count(sit, (o) => o.action))}`);
  check("SITUATIONAL always has a non-negative score", sit.every((o) => o.score >= 0));
  check("SITUATIONAL only appears where the state supports multiple defensible decisions: every scenario containing one has another defensible option", summaries.filter((x) => x.tiers.includes("SITUATIONAL")).every((x) => x.defensible >= 2));
  check("SITUATIONAL is a meaningful minority (2%-15% of options), not a target: it follows from marginal outcomes and unseen enemies", sit.length / optTiers.length > 0.02 && sit.length / optTiers.length < 0.15, sit.length / optTiers.length);
}

// ---------------------------------------------------------------------------
console.log("\n[3] Duplicates and fingerprint statistics");
{
  const refs = new Set(summaries.map((x) => x.ref));
  check(`exact duplicates: all ${SEEDS} scenarioRefs are distinct`, refs.size === SEEDS, refs.size);

  const mats = new Map();
  for (const x of summaries) mats.set(x.material.hash, (mats.get(x.material.hash) || 0) + 1);
  const clusterSizes = [...mats.values()].sort((a, b) => b - a);
  const inDup = clusterSizes.filter((n) => n > 1).reduce((a, b) => a + b, 0);
  console.log(`  STATS material fingerprints: ${mats.size} distinct across ${SEEDS} scenarios; largest cluster ${clusterSizes[0]}; ${(100 * inDup / SEEDS).toFixed(1)}% of scenarios share a fingerprint with another`);
  check("the material fingerprint separates scenarios (> 2,000 distinct across the run)", mats.size > 2000, mats.size);
  check("(control) without anti-repetition material duplicates DO occur, so the duplicate test below is meaningful", mats.size < SEEDS);

  // Near-duplicates: scenarios that differ from another in exactly one signature field.
  const sigs = summaries.map((x) => x.material.signature);
  const fields = Object.keys(sigs[0]);
  let withNeighbor1 = 0;
  const groupsByField = fields.map((f) => {
    const g = new Map();
    for (const sg of sigs) {
      const key = fields.filter((x) => x !== f).map((x) => sg[x]).join("|");
      const set = g.get(key) || new Set();
      set.add(sg[f]);
      g.set(key, set);
    }
    return g;
  });
  for (const sg of sigs) {
    const has = fields.some((f, i) => groupsByField[i].get(fields.filter((x) => x !== f).map((x) => sg[x]).join("|")).size > 1);
    if (has) withNeighbor1 += 1;
  }
  // Exact nearest-neighbour distance histogram on a deterministic sample (~400) of scenarios.
  const hist = {};
  let sampled = 0;
  for (let i = 0; i < sigs.length; i += Math.floor(SEEDS / 400)) {
    sampled += 1;
    let best = Infinity;
    for (let j = 0; j < sigs.length; j++) {
      if (j === i) continue;
      const d = signatureDistance(sigs[i], sigs[j]);
      if (d < best) best = d;
    }
    hist[best] = (hist[best] || 0) + 1;
  }
  console.log(`  STATS near-duplicates: ${(100 * withNeighbor1 / SEEDS).toFixed(1)}% of scenarios have a neighbour differing in exactly one of ${fields.length} material fields`);
  console.log(`  STATS nearest-neighbour distance histogram (deterministic sample of ${sampled} scenarios; distance = number of differing material fields): ${JSON.stringify(hist)}`);
  check("the signature has enough fields to express material structure (>= 10)", fields.length >= 10, fields.length);

  // Material space per (decision structure x difficulty) cell.
  const cellMat = {};
  for (const x of summaries) { const k = `${x.structure} L${x.difficulty}`; (cellMat[k] = cellMat[k] || new Set()).add(x.material.hash); }
  const sizes = Object.fromEntries(Object.entries(cellMat).map(([k, v]) => [k, v.size]));
  console.log(`  STATS distinct material fingerprints per cell (of ${SEEDS} seeds): ${JSON.stringify(sizes)}`);
  const smallest = Object.entries(sizes).sort((a, b) => a[1] - b[1])[0];
  check(`every cell can express at least 10 materially distinct situations (smallest: ${smallest[0]} = ${smallest[1]}; a low-level cell with two required factors is inherently small)`, smallest[1] >= 10, sizes);

  // Anti-repetition: generate a sequence while feeding back what was already shown.
  const K = 300;
  const seenRefs = [];
  const seenKeys = [];
  let seqOk = 0;
  let exactDup = 0;
  let materialDup = 0;
  const exhaustedCells = {};
  const keysSet = new Set();
  const refsSet = new Set();
  for (let i = 0; i < K; i++) {
    const seed = 10001 + i;
    const r = generateScenario({ seed, constants: FIXTURE_CONSTANTS, selectionContext: { avoidMaterialKeys: seenKeys.slice(), avoidScenarioRefs: seenRefs.slice() } });
    if (!r.ok) {
      const d = difficultyForSeed(T, seed, null);
      const cell = `${structureForSeed(T, seed, d)} L${d}`;
      exhaustedCells[cell] = (exhaustedCells[cell] || 0) + 1;
      continue;
    }
    seqOk += 1;
    const key = r.scenario.fingerprints.material.key;
    if (keysSet.has(key)) materialDup += 1;
    if (refsSet.has(r.scenario.scenarioRef)) exactDup += 1;
    keysSet.add(key);
    refsSet.add(r.scenario.scenarioRef);
    seenKeys.push(key);
    seenRefs.push(r.scenario.scenarioRef);
  }
  console.log(`  STATS anti-repetition sequence: K=${K} generated=${seqOk} exhausted=${K - seqOk} ${JSON.stringify(exhaustedCells)} exact duplicates=${exactDup} material duplicates=${materialDup}`);
  check(`anti-repetition: at least 97% of the ${K} sequential scenarios were generated`, seqOk >= K * 0.97, seqOk);
  check("anti-repetition: an exhausted seed reports exhaustion (the small low-level cells) instead of repeating a scenario", Object.keys(exhaustedCells).every((c) => /L[12]$/.test(c)) , exhaustedCells);
  check("anti-repetition: 0 exact duplicates in the generation test set", exactDup === 0);
  check("anti-repetition: 0 material duplicates in the generation test set", materialDup === 0);

  // Fake variation is not new variation.
  let base = null;
  for (let seed = 1; seed <= 400 && !base; seed++) {
    const r = generateScenario({ seed, constants: FIXTURE_CONSTANTS, difficulty: 2 });
    const p = r.scenario.state.raw.objectives[r.scenario.decision.primaryObjective];
    const a = r.scenario.decision.alternativeObjective && r.scenario.state.raw.objectives[r.scenario.decision.alternativeObjective];
    if (p.activity === "none" && p.availableInSec >= 16 && p.availableInSec <= 20 && a && Math.abs(p.availableInSec + 1 - a.availableInSec) <= 10) base = r;
  }
  check("(setup) found a scenario to perturb", base !== null);
  if (base) {
    const s = base.scenario;
    const variant = (mutate) => {
      const raw = copy(s.state.raw);
      mutate(raw);
      return assembleScenario({ template: T, constants: FIXTURE_CONSTANTS, origin: "generated", raw, structure: s.decision.structure, primary: s.decision.primaryObjective, alternative: s.decision.alternativeObjective, actionTypes: s.decision.options.map((o) => o.actionType), difficulty: s.difficulty, reproduction: s.provenance.reproduction });
    };
    const shifted = variant((raw) => {
      raw.objectives[s.decision.primaryObjective].availableInSec += 1; // Dragon 40s -> 41s style change
      raw.gameContext.gameTimeSec += 7;
    });
    check("timer/clock-only change: a different exact scenario (new scenarioRef)", shifted.scenario.scenarioRef !== s.scenarioRef);
    check("timer/clock-only change: NOT a materially new scenario (same material fingerprint)", shifted.scenario.fingerprints.material.key === s.fingerprints.material.key && shifted.ok, shifted.violations);
    const changed = variant((raw) => {
      const p = raw.objectives[s.decision.primaryObjective];
      p.stakes = p.stakes === "high" ? "low" : "high"; // a real change of situation
    });
    check("(control) changing what is at stake IS a materially different scenario", changed.scenario.fingerprints.material.key !== s.fingerprints.material.key);
  }
}

// ---------------------------------------------------------------------------
console.log("\n[4] Bounded backtracking never returns an invalid scenario");
{
  const impossible = withConstants((c) => {
    c.values.time.earlyWindowSec = { min: 0, max: 100 }; // both objectives cannot spawn before t=300
  });
  check("(setup) impossible constants are structurally valid", checkConstants(impossible).ok === true);
  const r = generateScenario({ seed: 5, constants: impossible });
  check("an impossible request ends in generation_exhausted, not in a scenario", r.ok === false && r.error.code === "generation_exhausted", r.error);
  check("...after exactly the bounded number of candidates", r.stats.attempts === GENERATION_LIMITS.maxCandidates, r.stats);
  check("...and no scenario or answer key is present on the result", !("scenario" in r) && !("answerKey" in r));
  check("...with the reason recorded", Object.keys(r.stats.rejections).some((k) => k.includes("timing_infeasible")), r.stats.rejections);
  // Pinned difficulty and structure still respect the bound.
  const pinned = generateScenario({ seed: 3, constants: FIXTURE_CONSTANTS, difficulty: 4 });
  check("a pinned difficulty is honoured", pinned.ok && pinned.scenario.difficulty === 4);
  // A stored/hand-built scenario is validated by the same code path.
  const crafted = assembleScenario({ template: T, constants: FIXTURE_CONSTANTS, origin: "coach_crafted", raw: neutralRaw(), structure: "CONTEST_VS_TRADE", primary: "dragon", alternative: "riftHerald", actionTypes: ["CONTEST", "TRADE"], difficulty: 1 });
  check("a coach-crafted scenario is held to the same validator (a neutral state has no exposed factor, so it fails)", crafted.ok === false && crafted.violations.some((v) => v.id === "edu.required_factors_present"));
  void STATE_VOCAB;
}

finish();
