// decisionLab -- validator tests (Phase 4).
//
//   node tests/decisionLab.validator.test.mjs
//
// A validator that has never been shown a broken scenario proves nothing, so
// every one of the 45 invariants is MUTATION-TESTED: start from a valid
// generated bundle, break exactly the thing the invariant guards, and require
// that invariant (by id) to fire. Also covers layer selection, robustness
// (malformed input is reported, never thrown), the public/private leakage
// guarantees, and the serving gate (draft content is never servable).

import { generateScenario } from "../functions/_lib/decisionLab/generator.js";
import { validateScenarioBundle, isServable, LAYERS } from "../functions/_lib/decisionLab/validator.js";
import { INVARIANT_LIST, INVARIANT_IDS } from "../functions/_lib/decisionLab/invariants.js";
import { OBJECTIVE_TRADE_TEMPLATE as T } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { deepFreeze } from "../functions/_lib/decisionLab/config.js";
import { FACTOR_IDS } from "../functions/_lib/decisionLab/factors.js";
import { PRINCIPLE_IDS } from "../functions/_lib/decisionLab/principles.js";
import { FIXTURE_CONSTANTS, copy, createHarness } from "./decisionLab.fixtures.mjs";

const { check, finish } = createHarness();
const C = FIXTURE_CONSTANTS;

// ---- a pool of valid bundles -------------------------------------------------------
const pool = [];
for (let seed = 1; seed <= 600; seed++) {
  const r = generateScenario({ seed, constants: C });
  if (r.ok) pool.push({ scenario: r.scenario, answerKey: r.answerKey, publicScenario: r.publicScenario });
}
const find = (pred) => pool.find(pred);
const ctxOf = (b) => ({ ...b, template: T, constants: C, dataInputs: {} });
const validate = (b, opts) => validateScenarioBundle(ctxOf(b), opts);

/** Deep-copy a valid bundle, mutate the copy, re-freeze the scenario (so the
 *  immutability invariant only fires when a test wants it to). */
function mutated(b, fn, { freeze = true } = {}) {
  const c = { scenario: copy(b.scenario), answerKey: copy(b.answerKey), publicScenario: copy(b.publicScenario) };
  fn(c);
  if (freeze) deepFreeze(c.scenario);
  return c;
}

console.log("\n[1] Valid bundles pass every layer");
{
  const bad = pool.filter((b) => !validate(b).ok);
  check(`all ${pool.length} pool bundles validate cleanly`, bad.length === 0, bad.length && validate(bad[0]).violations.slice(0, 2));
  const v = validate(pool[0]);
  check("a full run checks all 45 invariants", v.checked === 45, v.checked);
  check("layers are exactly structure/state/decision/edu/public", JSON.stringify(LAYERS) === JSON.stringify(["structure", "state", "decision", "edu", "public"]));
  check("every invariant belongs to a known layer", INVARIANT_LIST.every((i) => LAYERS.includes(i.layer)));
  const counts = Object.fromEntries(LAYERS.map((l) => [l, validate(pool[0], { layers: [l] }).checked]));
  check(`layers can run separately (${JSON.stringify(counts)})`, counts.structure === 9 && counts.state === 11 && counts.decision === 8 && counts.edu === 11 && counts.public === 6, counts);
}

console.log("\n[2] Mutation test: every invariant fires when the thing it guards is broken");
const anyB = () => pool[0];
const cases = [
  // ---- structure
  ["structure.scenario_shape", anyB, (c) => { delete c.scenario.difficulty; }],
  ["structure.versions_present", anyB, (c) => { delete c.scenario.provenance.rulesVersion; }],
  ["structure.ref_matches_content", anyB, (c) => { c.scenario.state.raw.gameContext.gameTimeSec += 1; }],
  ["structure.state_immutable", anyB, () => {}, { freeze: false }],
  ["structure.enums_valid", anyB, (c) => { c.scenario.state.raw.waves.top = "sideways"; }],
  ["structure.answer_key_shape", anyB, (c) => { const id = Object.keys(c.answerKey.options)[0]; c.answerKey.options[id].tier = "AMAZING"; }],
  ["structure.entity_refs_shape", anyB, (c) => { c.scenario.state.raw.teams.allies.members.support.refs = { bogus: true }; }],
  ["structure.raw_state_closed", anyB, (c) => { c.scenario.state.raw.fightability = "favorable"; }],
  ["structure.no_generation_metadata", anyB, (c) => { c.scenario.provenance.plannedFightability = "favorable"; }],
  // ---- state
  ["state.members_complete", anyB, (c) => { delete c.scenario.state.raw.teams.allies.members.baron; }],
  ["state.member_status_position", anyB, (c) => { const m = c.scenario.state.raw.teams.allies.members.baron; m.status = "alive"; m.zone = "base"; }],
  ["state.player_alive", anyB, (c) => { const m = c.scenario.state.raw.teams.allies.members.support; m.status = "dead"; m.zone = "base"; m.hpBand = "none"; }],
  ["state.objective_consistent", anyB, (c) => { const o = c.scenario.state.raw.objectives[c.scenario.decision.primaryObjective]; o.status = o.availableInSec === 0 ? "upcoming" : "available"; }],
  ["state.objective_spawn_supported", anyB, (c) => { c.scenario.state.raw.gameContext.gameTimeSec = 10; }],
  ["state.window_consistent", anyB, (c) => { const g = c.scenario.state.raw.gameContext; g.windowKind = g.windowKind === "shared" ? "primary_only" : "shared"; }],
  ["state.enemy_information_consistent", anyB, (c) => { const m = c.scenario.state.raw.teams.enemies.members.baron; m.status = "dead"; m.zone = "base"; m.hpBand = "none"; m.lastSeenAgoSec = 999; }],
  ["state.vision_flags_consistent", anyB, (c) => { const v = c.scenario.state.raw.vision; v.fogRisk.top_side = "high"; v.allies.top_side = "full"; }],
  ["state.gold_items_coherent", anyB, (c) => { const r = c.scenario.state.raw; for (const s of Object.keys(r.teams.allies.members)) { r.teams.allies.members[s].completedItems = 3; r.teams.enemies.members[s].completedItems = 0; } r.gameContext.goldBand = "behind"; }],
  ["state.derived_rebuildable", anyB, (c) => { c.scenario.state.derived.turretPressure.score += 1; }],
  ["state.no_impossible_relationships", () => find((b) => b.scenario.state.derived.objectives[b.scenario.decision.primaryObjective].teamAccess.arrivals.length > 0), (c) => {
    const slot = c.scenario.state.derived.objectives[c.scenario.decision.primaryObjective].teamAccess.arrivals[0];
    const m = c.scenario.state.raw.teams.allies.members[slot];
    m.status = "dead"; m.zone = "base"; m.hpBand = "none";
  }],
  // ---- decision
  ["decision.options_allowed", anyB, (c) => { c.scenario.decision.options[0].actionType = "TELEPORT"; }],
  ["decision.structure_matches_actions", () => find((b) => b.scenario.decision.structure === "CONTEST_VS_TRADE"), (c) => { c.scenario.decision.structure = "SETUP_VS_GIVE"; }],
  ["decision.option_preconditions_hold", anyB, (c) => { const o = c.answerKey.options[c.scenario.decision.options[0].id]; o.valid = !o.valid; }],
  ["decision.option_ids_valid", anyB, (c) => { c.scenario.decision.options[1].id = c.scenario.decision.options[0].id; }],
  ["decision.answer_key_recomputes", anyB, (c) => { const o = c.answerKey.options[c.scenario.decision.options[0].id]; o.score += 1; }],
  ["decision.outcomes_supported_by_state", anyB, (c) => { const o = c.answerKey.options[c.scenario.decision.options[0].id]; o.outcomeChain[0].outcome = "made_up_outcome"; }],
  ["decision.no_numeric_probabilities", anyB, (c) => { const o = c.answerKey.options[c.scenario.decision.options[0].id]; o.probability = 0.73; }],
  ["decision.has_defensible_option", anyB, (c) => { c.answerKey.defensible = []; }],
  // ---- edu
  ["edu.required_factors_present", anyB, (c) => { c.answerKey.factorEvidence.objective_value.exposed = false; }],
  ["edu.forbidden_factors_absent", () => find((b) => b.scenario.decision.structure === "SETUP_VS_GIVE"), (c) => { c.scenario.activeFactors = [...c.scenario.activeFactors, "cross_map_trade"]; }],
  ["edu.allowed_factors_only", anyB, (c) => { c.scenario.activeFactors = [...c.scenario.activeFactors, "made_up_factor"]; }],
  ["edu.factor_count_in_range", () => find((b) => b.scenario.difficulty === 1), (c) => { c.scenario.activeFactors = FACTOR_IDS.slice(); }],
  ["edu.difficulty_in_template_range", anyB, (c) => { c.scenario.difficulty = 9; }],
  ["edu.difficulty_profile_satisfied", () => find((b) => b.scenario.difficulty === 1), (c) => { c.scenario.difficulty = 4; }],
  ["edu.learning_objective_valid", anyB, (c) => { c.scenario.learningObjective.principles = ["not_a_principle"]; }],
  ["edu.active_factors_evaluable", anyB, (c) => { const f = c.scenario.activeFactors[0]; for (const o of Object.values(c.answerKey.options)) o.contributions[f] = 0; }],
  ["edu.inactive_factors_neutral", anyB, (c) => { c.answerKey.factorEvidence.turret_pressure.exposed = !c.answerKey.factorEvidence.turret_pressure.exposed; }],
  ["edu.background_signals_permitted", () => find((b) => b.scenario.difficulty <= 2 && !b.scenario.activeFactors.includes("vision_gap")), (c) => { c.scenario.state.derived.infoQuality.level = "poor"; }],
  ["edu.tier_spread", () => find((b) => b.scenario.difficulty <= 2), (c) => { for (const o of Object.values(c.answerKey.options)) o.tier = "WEAK"; }],
  // ---- public
  ["public.schema_allowlist", anyB, (c) => { c.publicScenario.extra = true; }],
  ["public.no_answer_key_fields", anyB, (c) => { c.publicScenario.decision.options[0].tier = "STRONG"; }],
  ["public.no_answer_key_values", anyB, (c) => { c.publicScenario.presentation.prompt += " Note: team_access is strong."; }],
  ["public.state_matches_projection", anyB, (c) => { c.publicScenario.state.gameContext.gameTimeSec += 5; }],
  ["public.options_metadata_only", anyB, (c) => { c.publicScenario.decision.options[0].label = "Definitely the best move"; }],
  ["public.ref_and_provenance", anyB, (c) => { c.publicScenario.provenance.rulesVersion = "tampered"; }],
];
const covered = new Set();
for (const [id, pick, mutate, opts] of cases) {
  const base = pick();
  if (!base) {
    check(`${id}: (setup) a suitable bundle exists in the pool`, false);
    continue;
  }
  const verdict = validate(mutated(base, mutate, opts || {}));
  const fired = verdict.violations.some((v) => v.id === id);
  covered.add(id);
  check(`${id} fires on the matching mutation`, fired, fired ? undefined : verdict.violations.map((v) => v.id));
}
check("the mutation table covers all 45 invariants exactly", covered.size === INVARIANT_IDS.length && INVARIANT_IDS.every((id) => covered.has(id)), INVARIANT_IDS.filter((id) => !covered.has(id)));
check("(control) the unmutated base still passes after the same copy+freeze path", validate(mutated(pool[0], () => {})).ok);

console.log("\n[2b] Fightability cannot be a generated fact");
{
  const b = pool.find((x) => x.answerKey.factorEvidence.fightability.exposed);
  check("(setup) a scenario with fightability exposed exists", !!b);
  const smuggle = [
    ["fightability stored in raw state", (c) => { c.scenario.state.raw.fightability = "favorable"; }],
    ["fightability stored on a team", (c) => { c.scenario.state.raw.teams.allies.fightability = "favorable"; }],
    ["fightability stored on a member", (c) => { c.scenario.state.raw.teams.allies.members.support.fightability = "favorable"; }],
    ["a derived block stored in raw state", (c) => { c.scenario.state.raw.derived = c.scenario.state.derived; }],
  ];
  for (const [label, fn] of smuggle) {
    const v = validate(mutated(b, fn));
    check(`rejected: ${label}`, v.violations.some((x) => x.id === "structure.raw_state_closed"), v.violations.map((x) => x.id));
  }
  const fightDerived = b.scenario.state.derived.objectives[b.scenario.decision.primaryObjective].fightability;
  check("fightability lives in DERIVED state, per objective, with its drivers (composition, items, positioning)", ["level", "edge", "driver", "compEdge", "itemEdge", "posEdge"].every((k) => k in fightDerived));
  const tampered = validate(mutated(b, (c) => { const f = c.scenario.state.derived.objectives[c.scenario.decision.primaryObjective].fightability; f.level = f.level === "favorable" ? "unfavorable" : "favorable"; }));
  check("a tampered derived fightability is caught (derived state must equal a fresh derivation)", tampered.violations.some((x) => x.id === "state.derived_rebuildable"));
}

console.log("\n[3] Robustness: malformed input is reported, never thrown");
{
  let threw = false;
  let r;
  try {
    r = validateScenarioBundle({ scenario: null, answerKey: null, publicScenario: null, template: T, constants: C, dataInputs: {} });
  } catch {
    threw = true;
  }
  check("a null scenario does not throw", threw === false && r.ok === false);
  check("...and is reported as a structural failure only", r.violations.length >= 1 && r.violations.every((v) => v.id === "structure.scenario_shape"), r.violations);
  const noKey = validate({ scenario: pool[0].scenario, answerKey: null, publicScenario: pool[0].publicScenario });
  check("a missing answer key is a violation, not a crash", noKey.ok === false && noKey.violations.some((v) => v.id === "structure.answer_key_shape"));
  const broken = validate(mutated(pool[0], (c) => { delete c.scenario.state.raw.teams; }));
  check("a scenario with its state torn out yields violations (internal errors are contained)", broken.ok === false && broken.violations.length > 0);
}

console.log("\n[4] Public / private leakage");
{
  // Independent of the validator's own checks: scan the public JSON directly.
  const outcomes = new Set();
  for (const a of Object.values(T.rules.actions)) for (const st of Object.values(a)) for (const b of st.bands) outcomes.add(b.outcome);
  const secrets = [...FACTOR_IDS, ...PRINCIPLE_IDS, ...outcomes, "STRONG", "VIABLE", "SITUATIONAL", "WEAK", "INVALID", "supportedBy", "againstBy", "tradeoffs", "failureConditions", "outcomeChain", "contributions", "answerKey", "factorEvidence", "learningObjective", "activeFactors", "\"derived\"", "\"tier\"", "\"score\"", "reproduction", "\"seed\""];
  // What the player READS gets the full list. provenance is metadata (the
  // template id legitimately reads "objective_trade", which is also a
  // principle id), so it gets the list minus principle ids.
  const provenanceSecrets = secrets.filter((w) => !PRINCIPLE_IDS.includes(w));
  let leaks = 0;
  let sample = null;
  for (const b of pool) {
    const p = b.publicScenario;
    const readable = JSON.stringify({ presentation: p.presentation, state: p.state, decision: p.decision });
    const meta = JSON.stringify(p.provenance);
    for (const w of secrets) if (readable.includes(w)) { leaks += 1; sample = sample || `${w} in what the player reads (${b.scenario.scenarioRef})`; }
    for (const w of provenanceSecrets) if (meta.includes(w)) { leaks += 1; sample = sample || `${w} in provenance (${b.scenario.scenarioRef})`; }
  }
  check(`independent scan: 0 answer-key strings in ${pool.length} public scenarios`, leaks === 0, sample);
  check("public scenarios never expose the answer key's ranking: option order is not sorted by tier", pool.some((b) => { const t = b.publicScenario.decision.options.map((o) => b.answerKey.options[o.id].tier); return t.join() !== t.slice().sort().join(); }));
  const keyOf = (b) => Object.keys(b.publicScenario).sort().join(",");
  check("public scenarios have exactly the allow-listed top-level shape", pool.every((b) => keyOf(b) === "decision,presentation,provenance,publicVersion,scenarioRef,state"));
  check("public options carry exactly id, label, actionType", pool.every((b) => b.publicScenario.decision.options.every((o) => Object.keys(o).sort().join() === "actionType,id,label")));
  check("public state has no derived block and no factor levels", pool.every((b) => !("derived" in b.publicScenario.state) && !JSON.stringify(b.publicScenario.state).includes("teamAccess")));

  // Negative leaks: each must be caught by the validator's public layer.
  const leakCases = [
    ["a tier smuggled into an option", (c) => { c.publicScenario.decision.options[0].tier = "STRONG"; }],
    ["supportedBy nested deep inside the state", (c) => { c.publicScenario.state.teams.allies.members.support.supportedBy = ["team_access"]; }],
    ["the derived block attached to the state", (c) => { c.publicScenario.state.derived = c.scenario.state.derived; }],
    ["a factor id in the prompt text", (c) => { c.publicScenario.presentation.prompt += " (vision_gap)"; }],
    ["a tier name in an option label", (c) => { c.publicScenario.decision.options[0].label += " - STRONG"; }],
    ["an outcome id in the title", (c) => { c.publicScenario.presentation.title = "objective_secured"; }],
    ["the seed in provenance", (c) => { c.publicScenario.provenance.seed = 1; }],
    ["the whole answer key attached", (c) => { c.publicScenario.answerKey = c.answerKey; }],
    ["a learning objective attached", (c) => { c.publicScenario.learningObjective = c.scenario.learningObjective; }],
  ];
  for (const [label, fn] of leakCases) {
    const v = validate(mutated(pool[0], fn), { layers: ["public"] });
    check(`leak caught: ${label}`, v.ok === false && v.violations.length > 0, v.violations);
  }
}

console.log("\n[5] Serving gate: draft or unverified content is never servable");
{
  const b = pool[0];
  const g = isServable({ scenario: b.scenario, template: T, constants: C });
  check("a fixture-built scenario is not servable", g.servable === false);
  const has = (prefix) => g.blockers.some((x) => x.startsWith(prefix));
  check("blocker: template not approved", has("template_not_approved"), g.blockers);
  check("blocker: rule table not approved", has("rule_table_not_approved"));
  check("blocker: constants not verified", has("constants_not_verified"));
  check("blocker: principles not approved", has("principle_not_approved"));
  check("blocker: factors not approved", has("factor_not_approved"));
  const fixtureOrigin = mutated(b, (c) => { c.scenario.origin = "engine_fixture"; });
  check("engine fixtures are never servable", isServable({ scenario: fixtureOrigin.scenario, template: T, constants: C }).blockers.includes("origin_engine_fixture"));
  const stale = isServable({ scenario: b.scenario, template: T, constants: { ...C, version: "fixture.2" }, dataInputs: {} });
  check("a data change adds a staleness blocker", stale.blockers.some((x) => x.startsWith("stale:")), stale.blockers);
  check("the gate reads CURRENT statuses, not the scenario's snapshot of them", b.scenario.template.status === "draft" && isServable({ scenario: b.scenario, template: { ...T, status: "approved" }, constants: C }).blockers.every((x) => !x.startsWith("template_not_approved")));
}

finish();
