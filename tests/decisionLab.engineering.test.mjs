// decisionLab -- engineering tests (implementation contracts, not coaching).
//
//   node tests/decisionLab.engineering.test.mjs
//
// Checks properties of the CODE that the other suites take for granted:
//   [1] stableStringify is byte-identical to its original implementation, so
//       every scenarioRef, fingerprint and validator comparison is unchanged;
//   [2] the runtime reads the rule table of the template being evaluated;
//   [3] factor signals read only contributions and defensibility, as the
//       signal contract says (metamorphic checks on stored answer keys);
//   [4] a malformed focus and a mismatched template are refused up front
//       (diff B: focus_invalid, template_mismatch);
//   [5] a malformed rule table is reported at every public entry point and
//       never evaluated, and every error follows the contract (diff C; the
//       boundary codes of diff H are produced here once each, and swept in
//       decisionLab.boundaries.test.mjs).
// The total rule-table check is tested in decisionLab.ruleTable.test.mjs and
// the trusted template registry in decisionLab.templateTrust.test.mjs.
// Nothing here says the DRAFT rules are correct Wild Rift coaching. Expected
// values come from the code's own contracts, never from a coach.

import { stableStringify } from "../functions/_lib/decisionLab/fingerprint.js";
import { createRng } from "../functions/_lib/decisionLab/prng.js";
import { generateScenario, assembleScenario, validateFocus } from "../functions/_lib/decisionLab/generator.js";
import { validateScenarioBundle, templateRuleIssues } from "../functions/_lib/decisionLab/validator.js";
import { OBJECTIVE_TRADE_CONSTANTS } from "../functions/_lib/decisionLab/gameConstants.js";
import { evaluateAnswer } from "../functions/_lib/decisionLab/evaluator.js";
import { buildOptionChain } from "../functions/_lib/decisionLab/outcome.js";
import { recomputeAnswerKey, scoreChain } from "../functions/_lib/decisionLab/scoring.js";
import { DEFENSIBLE_TIERS, ERROR_CODES, DecisionLabError } from "../functions/_lib/decisionLab/config.js";
import { OBJECTIVE_TRADE_TEMPLATE as T, OBJECTIVE_TRADE_RULES, checkRuleTable, termValue, preconditionOf } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { FIXTURE_CONSTANTS as C, craft, setPath, copy, withConstants, createHarness } from "./decisionLab.fixtures.mjs";

const { check, finish } = createHarness();
const gen = (seed, extra = {}) => generateScenario({ seed, constants: C, ...extra });

// The implementation stableStringify had before it was rewritten for speed. Kept verbatim as the oracle.
function originalStableStringify(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "number") {
    if (!Number.isFinite(value)) throw new TypeError("stableStringify: non-finite number");
    return JSON.stringify(value);
  }
  if (t === "string" || t === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(originalStableStringify).join(",")}]`;
  if (t === "object") {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${originalStableStringify(value[k])}`).join(",")}}`;
  }
  throw new TypeError(`stableStringify: unsupported type ${t}`);
}
const outcomeOf = (f, v) => { try { return { ok: f(v) }; } catch (e) { return { threw: `${e.constructor.name}: ${e.message}` }; } };
const sameAsOriginal = (v) => stableStringify(outcomeOf(stableStringify, v)) === stableStringify(outcomeOf(originalStableStringify, v)) && JSON.stringify(outcomeOf(stableStringify, v)) === JSON.stringify(outcomeOf(originalStableStringify, v));

console.log("\n[1] stableStringify is byte-identical to the original implementation");
{
  const docs = [];
  for (let seed = 1; seed <= 150; seed++) {
    const r = gen(seed);
    docs.push([`seed ${seed} scenario`, r.scenario], [`seed ${seed} answerKey`, r.answerKey], [`seed ${seed} publicScenario`, r.publicScenario], [`seed ${seed} stats`, r.stats]);
    const choice = r.scenario.decision.options[0].id;
    docs.push([`seed ${seed} evaluation`, evaluateAnswer({ scenario: r.scenario, answerKey: r.answerKey, answer: { choice }, template: T })]);
  }
  const bad = docs.filter(([, d]) => stableStringify(d) !== originalStableStringify(d)).map(([label]) => label);
  check(`identical output on ${docs.length} engine documents (scenario, answer key, public scenario, stats, evaluation of seeds 1-150)`, bad.length === 0, bad.slice(0, 5));

  const specials = ["", "plain", '"', "\\", "\n", "\t", "\b", "\f", "\r", "\u0000", "\u001f", " ", "~", "\u007f", "\u0080", "é", "日本", "😀", "\ud800", "\udc00", "a\ud83dz", "</script>", "\u2028"];
  const edge = [
    null, true, false, 0, -0, 1, -1, 1.5, 1e21, 1e-7, Number.MAX_SAFE_INTEGER, -1e300,
    ...specials, specials, Object.fromEntries(specials.map((s, i) => [s, i])),
    {}, [], [[]], { a: undefined, b: 1 }, [1, , 2], [null], { z: { y: { x: [1, { w: "v" }] } }, a: [] },
    Object.freeze({ b: 2, a: 1 }), { 10: "ten", 9: "nine", a: "a", A: "A", _: "_" },
  ];
  const edgeBad = edge.filter((v) => !sameAsOriginal(v)).map((v) => outcomeOf(originalStableStringify, v));
  check(`identical output on ${edge.length} edge values (escapes, control characters, non-ASCII, lone surrogates, -0, large and tiny numbers, holes, undefined properties, numeric keys)`, edgeBad.length === 0, edgeBad.slice(0, 5));

  const errors = [NaN, Infinity, -Infinity, undefined, () => 1, Symbol("s"), 10n, [undefined], { a: NaN }, [1, [() => 1]], { a: { b: [Infinity] } }];
  const errBad = errors.filter((v) => !sameAsOriginal(v)).map((v) => [outcomeOf(stableStringify, v), outcomeOf(originalStableStringify, v)]);
  check(`the same exception (type and message) for ${errors.length} unrepresentable values (NaN, Infinity, undefined, function, symbol, bigint, nested)`, errBad.length === 0, errBad.slice(0, 3));

  // Seeded fuzz: random nested values over the same special characters.
  const rng = createRng(20261027, "engineering/stableStringify-fuzz");
  const pool = ["a", "Z", "0", " ", ...specials.filter((s) => s.length > 0)];
  const str = () => Array.from({ length: rng.int(0, 6) }, () => rng.pick(pool)).join("");
  const value = (depth) => {
    const k = rng.int(0, depth > 3 ? 4 : 7);
    if (k === 0) return null;
    if (k === 1) return rng.chance(1, 2);
    if (k === 2) return rng.int(-1000, 1000) * (rng.chance(1, 4) ? 0.25 : 1);
    if (k === 3 || k === 4) return str();
    if (k === 5) return Array.from({ length: rng.int(0, 4) }, () => value(depth + 1));
    const o = {};
    for (let i = rng.int(0, 4); i > 0; i--) o[str()] = rng.chance(1, 8) ? undefined : value(depth + 1);
    return o;
  };
  let fuzzBad = null;
  for (let i = 0; i < 3000 && !fuzzBad; i++) { const v = value(0); if (!sameAsOriginal(v)) fuzzBad = { case: i, value: outcomeOf(originalStableStringify, v) }; }
  check("identical output on 3,000 seeded random nested values", fuzzBad === null, fuzzBad);
}

console.log("\n[2] The runtime reads the rule table of the template being evaluated");
{
  const g = gen(12);
  const s = g.scenario;
  const fe = g.answerKey.factorEvidence;
  const levels = Object.fromEntries(Object.entries(fe).map(([f, e]) => [f, e.level]));
  const evidence = Object.fromEntries(Object.entries(fe).map(([f, e]) => [f, e.evidence]));
  const ctx = { raw: s.state.raw, derived: s.state.derived, constants: C, primary: s.decision.primaryObjective, alternative: s.decision.alternativeObjective, levels, evidence };
  const chainTerms = (tmpl, action) => buildOptionChain(tmpl, action, ctx).chain.map((c) => c.terms.map((t) => `${t.term}=${t.value}`).join(" "));
  check("the shipped template carries the module's rule table (so passing template.rules changes nothing for it)", T.rules === OBJECTIVE_TRADE_RULES);
  check("(setup) seed 12 is a TRADE_VS_IGNORE scenario with enemy_access partial and a limited cross-map trade", s.decision.structure === "TRADE_VS_IGNORE" && levels.enemy_access === "partial" && levels.cross_map_trade === "limited", levels);
  check("the module-default runtime calls equal the calls with the shipped table", Object.keys(OBJECTIVE_TRADE_RULES.terms).every((name) => termValue(name, ctx) === termValue(name, ctx, OBJECTIVE_TRADE_RULES)) && ["CONTEST", "SETUP", "TRADE", "GIVE", "IGNORE"].every((a) => preconditionOf(a, ctx).ok === preconditionOf(a, ctx, OBJECTIVE_TRADE_RULES).ok));

  const altered = copy(OBJECTIVE_TRADE_RULES);
  altered.terms.enemy_access.values = { weak: 2, partial: 2, strong: 2 };
  altered.thresholds.crossMap.strong.ourMin = 99;
  altered.thresholds.crossMap.limited.ourMin = 99;
  const alteredPre = copy(OBJECTIVE_TRADE_RULES);
  alteredPre.preconditions.TRADE = { rule: "no_team_has_committed", definition: "TRADE", describe: "what-if" };
  const Tw = { ...T, rules: altered };
  const before = chainTerms(T, "TRADE")[0];
  const after = chainTerms(Tw, "TRADE")[0];
  check("an altered term value in the template's table reaches the chain (enemy_access 0 -> 2)", /enemy_access=0/.test(before) && /enemy_access=2/.test(after), { before, after });
  check("an altered threshold reaches the derived TRADE terms (with ourMin 99 nothing can be captured: trade_gain 1 -> 0)", /trade_gain=1/.test(before) && /trade_gain=0/.test(after), { before, after });
  const taking = (r) => { setPath(r, "objectives.dragon.availableInSec", 0); setPath(r, "objectives.dragon.status", "available"); setPath(r, "objectives.dragon.activity", "enemy_taking"); };
  const tk = craft({ structure: "CONTEST_VS_TRADE", actions: ["CONTEST", "TRADE"], difficulty: 2, mutate: taking });
  const tctx = { raw: tk.scenario.state.raw, primary: "dragon", alternative: "riftHerald" };
  check("an altered precondition reaches availability (TRADE becomes unavailable while the enemy is taking the objective, also through buildOptionChain)", preconditionOf("TRADE", tctx, OBJECTIVE_TRADE_RULES).ok === true && preconditionOf("TRADE", tctx, alteredPre).ok === false && buildOptionChain({ ...T, rules: alteredPre }, "TRADE", { ...ctx, raw: tk.scenario.state.raw, derived: tk.scenario.state.derived, primary: "dragon", alternative: "riftHerald" }).valid === false);
  const keyShipped = recomputeAnswerKey({ template: T, constants: C, raw: s.state.raw, decision: s.decision, scenarioRef: s.scenarioRef, versions: { templateVersion: 3, generatorVersion: s.provenance.generatorVersion, rulesVersion: s.provenance.rulesVersion } });
  const keyCopy = recomputeAnswerKey({ template: { ...T }, constants: C, raw: s.state.raw, decision: s.decision, scenarioRef: s.scenarioRef, versions: { templateVersion: 3, generatorVersion: s.provenance.generatorVersion, rulesVersion: s.provenance.rulesVersion } });
  check("a copy of the template with the same table gives the byte-identical answer key, equal to the stored one", stableStringify(keyShipped) === stableStringify(keyCopy) && stableStringify(keyShipped) === stableStringify(g.answerKey));
}

console.log("\n[3] Factor signals read only contributions and defensibility (signal contract, checked on the code)");
{
  // Each transformation changes something the signal contract says a signal must NOT depend on, and keeps
  // everything it may depend on (each option's contributions, which options are defensible, the thresholds).
  const ROTATE = { STRONG: "VIABLE", VIABLE: "SITUATIONAL", SITUATIONAL: "STRONG" };
  const transforms = {
    "defensible tiers relabelled (STRONG -> VIABLE -> SITUATIONAL -> STRONG)": (k) => { for (const o of Object.values(k.options)) if (DEFENSIBLE_TIERS.includes(o.tier)) o.tier = ROTATE[o.tier]; },
    "ranking reversed": (k) => { k.ranking.reverse(); },
    "option scores shifted by +17": (k) => { for (const o of Object.values(k.options)) if (o.valid) o.score += 17; },
    "outcome valences negated": (k) => { for (const o of Object.values(k.options)) for (const c of o.outcomeChain) c.valence = 0 - c.valence; },
  };
  const signalsOf = (scenario, answerKey, choice) => {
    const r = evaluateAnswer({ scenario, answerKey, answer: { choice }, template: T });
    return r.ok ? stableStringify(r.evaluation.factorSignals.map((f) => [f.factor, f.performance, f.basis])) : `error:${r.error.code}`;
  };
  for (const [label, transform] of Object.entries(transforms)) {
    const bad = [];
    let compared = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const g = gen(seed);
      const k2 = copy(g.answerKey);
      transform(k2);
      for (const o of g.scenario.decision.options) {
        compared += 1;
        if (signalsOf(g.scenario, g.answerKey, o.id) !== signalsOf(g.scenario, k2, o.id)) bad.push({ seed, choice: o.id });
      }
    }
    check(`${label}: every factor signal and its basis is unchanged (${compared} choices over seeds 1-120)`, bad.length === 0, bad.slice(0, 5));
  }
  const g = gen(12);
  const k3 = copy(g.answerKey);
  for (const o of Object.values(k3.options)) for (const f of Object.keys(o.contributions)) o.contributions[f] *= 4;
  check("(control) changing contributions, which signals DO read, changes a signal: the checks above can fail", signalsOf(g.scenario, g.answerKey, "trade") !== signalsOf(g.scenario, k3, "trade"));
}

console.log("\n[4] A malformed focus and a mismatched template are refused up front");
{
  const good = { fightability: { level: "favorable", driver: "items" } };
  check("validateFocus accepts { level, driver } and rejects any other key inside focus.fightability", validateFocus(good) === null && validateFocus({ fightability: { level: "favorable" } }) === null && validateFocus({ fightability: { ...good.fightability, note: "x" } }) === "focus.fightability may only contain { level, driver }");
  check("the checks that existed before keep their messages", validateFocus({ fightability: { level: "sideways", note: "x" } }) === "focus.fightability.level must be favorable, even or unfavorable" && validateFocus({ other: 1 }) === "focus may only contain { fightability }");
  const r = gen(1, { focus: { fightability: { ...good.fightability, note: "x" } } });
  check("generateScenario refuses such a focus at once (focus_invalid, no candidate built) instead of exhausting 120 candidates on structure.no_generation_metadata", r.ok === false && r.error.code === "focus_invalid" && r.stats === undefined, r);
  check("a well-formed focus still generates", gen(1, { focus: good }).ok === true);

  const g = gen(12);
  const evalWith = (template) => evaluateAnswer({ scenario: g.scenario, answerKey: g.answerKey, answer: { choice: "trade" }, template });
  const huge = 1e9;
  check("the template the scenario was built from evaluates, and so does an omitted template (resolved from the registry), with a byte-identical evaluation", evalWith(T).ok && stableStringify(evalWith(undefined)) === stableStringify(evalWith(T)));
  const sameLabels = evalWith({ ...T, rules: { ...T.rules, signals: { ...T.rules.signals, positiveMin: huge } } });
  check("a copy with the same versions but other signal thresholds is refused: template_content_mismatch (error contract v1.1)", sameLabels.ok === false && sameLabels.error.code === "template_content_mismatch", sameLabels);
  const mismatches = {
    "another rules version": { ...T, rules: { ...T.rules, version: "objective_trade.rules.99" } },
    "another template version": { ...T, version: 99 },
    "another template id": { ...T, id: "another_template" },
    "no rule table": { ...T, rules: undefined },
    "a null template": null,
  };
  for (const [label, tmpl] of Object.entries(mismatches)) {
    const res = evalWith(tmpl);
    check(`${label}: template_mismatch (signals would be graded with a table the provenance does not name)`, res.ok === false && res.error.code === "template_mismatch", res.ok ? "evaluated" : res.error);
  }
  const custom = { ...T, rules: { ...T.rules, version: "objective_trade.rules.3+engineering" } };
  const cg = generateScenario({ seed: 12, constants: C, template: custom });
  const cev = cg.ok && evaluateAnswer({ scenario: cg.scenario, answerKey: cg.answerKey, answer: { choice: cg.scenario.decision.options[0].id }, template: custom });
  const cevOmitted = cg.ok && evaluateAnswer({ scenario: cg.scenario, answerKey: cg.answerKey, answer: { choice: cg.scenario.decision.options[0].id } });
  check("a custom (unregistered) template generates, but its scenarios are never evaluated: template_unregistered, supplied or omitted", cg.ok && cev.ok === false && cev.error.code === "template_unregistered" && cevOmitted.ok === false && cevOmitted.error.code === "template_unregistered", { cev, cevOmitted });
  const badKey = { ...g.answerKey, scenarioRef: "sc_0000000000000000" };
  check("earlier checks keep precedence (an answer key for another scenario is still answer_key_mismatch)", evaluateAnswer({ scenario: g.scenario, answerKey: badKey, answer: { choice: "trade" }, template: undefined }).error.code === "answer_key_mismatch");
}

console.log("\n[5] A malformed rule table is reported at every public entry point, never evaluated; errors follow the contract (diff C)");
{
  check("the shipped rule table has no problems", checkRuleTable(OBJECTIVE_TRADE_RULES).length === 0, checkRuleTable(OBJECTIVE_TRADE_RULES));
  check("the template exposes the check as runtime.checkRules, and templateRuleIssues is that check", T.runtime.checkRules === checkRuleTable && templateRuleIssues(T).length === 0);
  const cases = [
    ["a factor level with no term value", (r) => { delete r.terms.turret_pressure.values.neutral; }, "terms.turret_pressure: no integer value for turret_pressure level neutral"],
    ["a term value for a level the factor does not have", (r) => { r.terms.team_access.values.stong = 1; }, "terms.team_access: stong is not a level of team_access"],
    ["a stage that reads an unknown term", (r) => { r.actions.CONTEST.objective_fight.terms.push({ term: "no_such_term" }); }, "actions.CONTEST.objective_fight: unknown term no_such_term"],
    ["a stage without a terminal band", (r) => { r.actions.GIVE.objective_fight.bands.pop(); }, "actions.GIVE.objective_fight: the last band needs min null"],
    ["band minimums out of order", (r) => { r.actions.CONTEST.objective_fight.bands[1].min = 5; }, "actions.CONTEST.objective_fight: band mins must strictly decrease"],
    ["a non-qualitative certainty", (r) => { r.actions.SETUP.objective_fight.bands[0].certainty = "80%"; }, "actions.SETUP.objective_fight: band 0 certainty 80% is not qualitative"],
    ["a carry from a later stage", (r) => { r.actions.CONTEST.objective_fight.terms.push({ carry: "tempo_map_access" }); }, "actions.CONTEST.objective_fight: carry must name an earlier stage (tempo_map_access)"],
    ["a missing stage", (r) => { delete r.actions.IGNORE.turret_wave_gold; }, "actions.IGNORE.turret_wave_gold: needs terms[] and a non-empty bands[]"],
    ["a precondition rule with no implementation", (r) => { r.preconditions.SETUP.rule = "nobody_has_vision"; }, "preconditions.SETUP: rule nobody_has_vision is not implemented"],
    ["a certainty shift that would raise certainty", (r) => { r.certaintyShift[0].shift = 1; }, "certaintyShift[0]: shift must be a negative integer (it may only lower certainty)"],
    ["a certainty shift on an unknown factor level", (r) => { r.certaintyShift[2].when = { factorLevel: { vision_gap: "blind" } }; }, "certaintyShift[2]: vision_gap=blind is not a factor level"],
    ["a certainty weight missing", (r) => { delete r.tiering.certaintyWeights.guaranteed; }, "tiering.certaintyWeights.guaranteed must be an integer"],
    ["a fractional signal threshold", (r) => { r.signals.strongMin = 999.5; }, "signals.strongMin must be a non-negative integer"],
    ["a missing derivation threshold", (r) => { delete r.thresholds.strongMinArrivals; }, "thresholds.strongMinArrivals must be a non-negative integer"],
    ["a non-finite cross-map threshold", (r) => { r.thresholds.crossMap.limited.ourMin = Infinity; }, "thresholds.crossMap.limited.ourMin must be a non-negative integer"],
  ];
  for (const [label, mutate, expected] of cases) {
    const r = copy(OBJECTIVE_TRADE_RULES);
    mutate(r);
    const problems = checkRuleTable(r);
    check(`${label} is reported: "${expected}"`, problems.includes(expected), problems);
  }

  // Enforcement: the same malformed tables at every public entry point.
  const malformed = {
    "a missing term value": (r) => { for (const k of Object.keys(r.terms.turret_pressure.values)) delete r.terms.turret_pressure.values[k]; },
    "no terminal band": (r) => { for (const a of ["CONTEST", "SETUP", "TRADE", "GIVE"]) r.actions[a].objective_fight.bands.pop(); },
    "a missing certainty weight": (r) => { delete r.tiering.certaintyWeights.medium; },
    "an unimplemented precondition rule": (r) => { r.preconditions.TRADE.rule = "nobody_has_vision"; },
    "a missing threshold": (r) => { delete r.thresholds.partialMinArrivals; },
    "a NaN signal threshold": (r) => { r.signals.minAttributionMass = NaN; },
  };
  const g = gen(12);
  for (const [label, mutate] of Object.entries(malformed)) {
    const rules = copy(OBJECTIVE_TRADE_RULES);
    mutate(rules);
    const Tm = { ...T, rules };
    const issues = templateRuleIssues(Tm);
    const outcome = (f) => { try { return f(); } catch (e) { return { threw: `${e.constructor.name}: ${e.message}` }; } };
    const genR = outcome(() => generateScenario({ seed: 5, constants: C, template: Tm }));
    const asm = outcome(() => assembleScenario({ template: Tm, constants: C, origin: "coach_crafted", raw: g.scenario.state.raw, structure: g.scenario.decision.structure, primary: g.scenario.decision.primaryObjective, alternative: g.scenario.decision.alternativeObjective, actionTypes: g.scenario.decision.options.map((o) => o.actionType), difficulty: g.scenario.difficulty }));
    const val = outcome(() => validateScenarioBundle({ scenario: g.scenario, answerKey: g.answerKey, publicScenario: g.publicScenario, template: Tm, constants: C, dataInputs: {} }, { layers: ["public"] }));
    const ev = outcome(() => evaluateAnswer({ scenario: g.scenario, answerKey: g.answerKey, answer: { choice: "trade" }, template: Tm }));
    const ok = issues.length > 0
      && genR.ok === false && genR.error && genR.error.code === "rules_invalid" && stableStringify(genR.error.issues) === stableStringify(issues) && genR.stats === undefined
      && asm.ok === false && asm.error && asm.error.code === "rules_invalid" && asm.scenario === null && asm.violations.length === 1 && asm.violations[0].id === "template.rules_valid"
      && val.ok === false && val.checked === 0 && val.violations.length === 1 && val.violations[0].id === "template.rules_valid" && val.violations[0].layer === "template"
      && ev.ok === false && ev.error && ev.error.code === "rules_invalid";
    check(`${label}: generateScenario, assembleScenario, validateScenarioBundle (even restricted to the public layer) and evaluateAnswer all report rules_invalid / template.rules_valid, none throws`, ok, { issues, genR: genR.error || genR, asm: asm.error || asm, val: val.violations || val, ev: ev.error || ev });
  }

  // The primitives refuse too (last-resort guard): never a NaN sum falling through to a band.
  const fe = g.answerKey.factorEvidence;
  const ctx = { raw: g.scenario.state.raw, derived: g.scenario.state.derived, constants: C, primary: g.scenario.decision.primaryObjective, alternative: g.scenario.decision.alternativeObjective, levels: Object.fromEntries(Object.entries(fe).map(([f, e]) => [f, e.level])), evidence: Object.fromEntries(Object.entries(fe).map(([f, e]) => [f, e.evidence])) };
  const broken = copy(OBJECTIVE_TRADE_RULES);
  for (const k of Object.keys(broken.terms.turret_pressure.values)) delete broken.terms.turret_pressure.values[k];
  const thrown = (f) => { try { f(); return null; } catch (e) { return e; } };
  const e1 = thrown(() => buildOptionChain({ ...T, rules: broken }, "IGNORE", ctx));
  check("buildOptionChain with a missing term value throws DecisionLabError rules_invalid instead of choosing a band for a NaN sum", e1 instanceof DecisionLabError && e1.code === "rules_invalid" && /turret_pressure has no integer value/.test(e1.message), e1 && e1.message);
  const noWeight = copy(OBJECTIVE_TRADE_RULES.tiering);
  delete noWeight.certaintyWeights.medium;
  const chain = buildOptionChain(T, "IGNORE", ctx).chain; // IGNORE's tempo stage is always medium certainty (MAP_BANDS)
  const e2 = thrown(() => scoreChain(chain, noWeight));
  check("scoreChain with a missing certainty weight throws DecisionLabError rules_invalid instead of returning a NaN score", chain.some((c) => c.certainty === "medium") && e2 instanceof DecisionLabError && e2.code === "rules_invalid", e2 && e2.message);

  // The error contract (config.js ERROR_CODES): every documented condition gives its code, and none throws.
  const genErr = (req) => { try { const r = generateScenario(req); return r.ok ? "ok" : r.error.code; } catch (e) { return `threw ${e.constructor.name}`; } };
  const impossible = withConstants((c) => { c.values.time.earlyWindowSec = { min: 0, max: 100 }; });
  const contract = [
    ["seed 1.5", { seed: 1.5, constants: C }, "seed_invalid"],
    ["empty string seed", { seed: "", constants: C }, "seed_invalid"],
    ["NaN seed", { seed: NaN, constants: C }, "seed_invalid"],
    ["object seed", { seed: {}, constants: C }, "seed_invalid"],
    ["missing seed", { constants: C }, "seed_invalid"],
    ["the shipped UNVERIFIED production constants", { seed: 1, constants: OBJECTIVE_TRADE_CONSTANTS }, "constants_unverified"],
    ["no constants", { seed: 1, constants: null }, "constants_invalid"],
    ["structurally broken constants", { seed: 1, constants: withConstants((c) => { c.values.travelSec.far = 5; }) }, "constants_invalid"],
    ["VERIFIED constants without a patch", { seed: 1, constants: withConstants((c) => { c.status = "VERIFIED"; }) }, "constants_invalid"],
    ["a template without a rule table", { seed: 1, constants: C, template: { ...T, rules: undefined } }, "rules_invalid"],
    ["a null template", { seed: 1, constants: C, template: null }, "rules_invalid"],
    ["difficulty 9", { seed: 1, constants: C, difficulty: 9 }, "difficulty_out_of_range"],
    ["an unknown focus key", { seed: 1, constants: C, focus: { fightability: { level: "favorable", extra: 1 } } }, "focus_invalid"],
    ["a string selection context", { seed: 1, constants: C, selectionContext: "x" }, "selection_context_invalid"],
    ["an array selection context", { seed: 1, constants: C, selectionContext: [] }, "selection_context_invalid"],
    ["non-iterable avoid keys", { seed: 1, constants: C, selectionContext: { avoidMaterialKeys: 5 } }, "selection_context_invalid"],
    ["non-string avoid refs", { seed: 1, constants: C, selectionContext: { avoidScenarioRefs: [1] } }, "selection_context_invalid"],
    ["an unserializable selection context", { seed: 1, constants: C, selectionContext: { f() {} } }, "selection_context_invalid"],
    ["impossible constants", { seed: 5, constants: impossible }, "generation_exhausted"],
    ["precedence: a bad seed and no constants", { seed: 1.5, constants: null }, "seed_invalid"],
    ["precedence: UNVERIFIED constants and no rule table", { seed: 1, constants: OBJECTIVE_TRADE_CONSTANTS, template: { ...T, rules: undefined } }, "constants_unverified"],
    ["precedence: no rule table and difficulty 9", { seed: 1, constants: C, template: { ...T, rules: undefined }, difficulty: 9 }, "rules_invalid"],
    ["the registered labels with other content", { seed: 1, constants: C, template: { ...T, rules: { ...T.rules, signals: { ...T.rules.signals, positiveMin: 99 } } } }, "template_content_mismatch"],
    ["precedence: other content and difficulty 9", { seed: 1, constants: C, template: { ...T, rules: { ...T.rules, signals: { ...T.rules.signals, positiveMin: 99 } } }, difficulty: 9 }, "template_content_mismatch"],
  ];
  for (const [label, req, code] of contract) {
    const got = genErr(req);
    check(`generateScenario, ${label}: ${code} (returned, not thrown)`, got === code, got);
  }
  check("still accepted: a selection context with null avoid lists and extra keys", genErr({ seed: 1, constants: C, selectionContext: { avoidMaterialKeys: null, player: "p1" } }) === "ok");
  // Diff H (ERROR_CONTRACT_v1_1.md 5): the boundary codes, each returned, never thrown.
  const asmErr = (input) => { try { const r = assembleScenario(input); return r.ok ? "ok" : r.error ? r.error.code : `violation ${r.violations[0].id}`; } catch (e) { return `threw ${e.constructor.name}`; } };
  const evalErr = (req) => { try { const r = evaluateAnswer(req); return r.ok ? "ok" : r.error.code; } catch (e) { return `threw ${e.constructor.name}`; } };
  const throwing = new Proxy({}, { get() { throw new Error("getter"); } });
  const b1 = generateScenario({ seed: 1, constants: C });
  const asmInput = (patch) => ({ template: T, constants: C, origin: "coach_crafted", raw: b1.scenario.state.raw, structure: b1.scenario.decision.structure, primary: b1.scenario.decision.primaryObjective, alternative: b1.scenario.decision.alternativeObjective, actionTypes: b1.scenario.decision.options.map((o) => o.actionType), difficulty: b1.scenario.difficulty, ...patch });
  const choice = { choice: b1.scenario.decision.options[0].id };
  const boundary = [
    ["generateScenario(undefined)", () => genErr(undefined), "request_invalid"],
    ["assembleScenario(null)", () => asmErr(null), "request_invalid"],
    ["evaluateAnswer(undefined)", () => evalErr(undefined), "request_invalid"],
    ["assembleScenario with no raw.teams (a hand-crafted state the build cannot read)", () => asmErr(asmInput({ raw: { ...b1.scenario.state.raw, teams: undefined } })), "assembly_input_invalid"],
    ["evaluateAnswer with a stored answer key without options", () => evalErr({ scenario: b1.scenario, answerKey: { ...b1.answerKey, options: undefined }, answer: choice, template: T }), "bundle_invalid"],
    ["generateScenario with constants whose getters throw", () => genErr({ seed: 1, constants: throwing }), "operation_failed"],
    ["assembleScenario with constants whose getters throw", () => asmErr(asmInput({ constants: throwing })), "operation_failed"],
    ["evaluateAnswer with an answer whose reasoning getter throws", () => evalErr({ scenario: b1.scenario, answerKey: b1.answerKey, answer: { ...choice, get reasoning() { throw new Error("getter"); } }, template: T }), "operation_failed"],
    ["(unchanged) the same assembly input, well formed", () => asmErr(asmInput({})), "ok"],
  ];
  for (const [label, run, code] of boundary) {
    const got = run();
    check(`${label}: ${code} (returned, not thrown)`, got === code, got);
  }
  const produced = new Set([...contract.map((c) => c[2]), ...boundary.map((c) => c[2]).filter((c) => c !== "ok"), "rules_invalid", "focus_invalid", "answer_key_mismatch", "rules_version_mismatch", "template_version_mismatch", "registry_version_mismatch", "template_mismatch", "template_unregistered", "template_content_mismatch", "invalid_choice"]);
  check("every code the engine produces is registered in ERROR_CODES, and every registered code is produced by a case above or in [4]", [...produced].every((c) => c in ERROR_CODES) && Object.keys(ERROR_CODES).every((c) => produced.has(c)), { unregistered: [...produced].filter((c) => !(c in ERROR_CODES)), unproduced: Object.keys(ERROR_CODES).filter((c) => !produced.has(c)) });
}

finish();
