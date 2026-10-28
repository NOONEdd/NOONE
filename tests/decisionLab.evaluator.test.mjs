// decisionLab -- evaluator tests (Phase 5).
//
//   node tests/decisionLab.evaluator.test.mjs
//
// The evaluator is deterministic and LLM-free. These tests check its
// contract, its properties over every option of hundreds of generated
// scenarios, the exposure/performance separation, the INVALID and
// SITUATIONAL paths, that signal thresholds come from the (DRAFT) rule table
// rather than from code, and that it is a plain synchronous pure function.
// Exact expected values for hand-built cases live in the golden test.

import { readFileSync } from "node:fs";
import { generateScenario } from "../functions/_lib/decisionLab/generator.js";
import { evaluateAnswer } from "../functions/_lib/decisionLab/evaluator.js";
import { OBJECTIVE_TRADE_TEMPLATE as T } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { SIGNALS, TIER_RANK, DEFENSIBLE_TIERS, VERSIONS } from "../functions/_lib/decisionLab/config.js";
import { FACTOR_IDS, FACTORS } from "../functions/_lib/decisionLab/factors.js";
import { stableStringify } from "../functions/_lib/decisionLab/fingerprint.js";
import { FIXTURE_CONSTANTS as C, craft, setPath, moveAllies, copy, createHarness } from "./decisionLab.fixtures.mjs";

const { check, finish } = createHarness();
const evalOf = (b, choice, tmpl = T, extra = {}) => evaluateAnswer({ scenario: b.scenario, answerKey: b.answerKey, answer: { choice, ...extra }, template: tmpl });

// ---- pool -------------------------------------------------------------------------
const pool = [];
for (let seed = 1; seed <= 300; seed++) {
  const r = generateScenario({ seed, constants: C });
  if (r.ok) pool.push({ scenario: r.scenario, answerKey: r.answerKey, publicScenario: r.publicScenario });
}

console.log("\n[1] Contract and error cases");
{
  const b = pool[0];
  const first = b.scenario.decision.options[0].id;
  const r = evalOf(b, first);
  check("a valid answer evaluates ok", r.ok === true);
  check("evaluation is a plain synchronous value, not a Promise", !(r instanceof Promise) && typeof r.then === "undefined");
  const bad = [["unknown option id", "teleport"], ["non-string choice", 7], ["missing choice", undefined], ["prototype key", "__proto__"], ["inherited key", "constructor"], ["empty string", ""]];
  for (const [label, choice] of bad) {
    const e = evaluateAnswer({ scenario: b.scenario, answerKey: b.answerKey, answer: { choice }, template: T });
    check(`invalid choice rejected: ${label}`, e.ok === false && e.error.code === "invalid_choice", e);
  }
  check("a missing answer object is rejected, not thrown", (() => { try { return evaluateAnswer({ scenario: b.scenario, answerKey: b.answerKey, answer: undefined, template: T }).ok === false; } catch { return false; } })());
  const other = pool[1];
  check("an answer key from a different scenario is rejected", evaluateAnswer({ scenario: b.scenario, answerKey: other.answerKey, answer: { choice: first }, template: T }).error.code === "answer_key_mismatch");
  const drift = copy(b.answerKey);
  drift.versions.rulesVersion = "objective_trade.rules.999";
  check("an answer key built under a different rules version is rejected", evaluateAnswer({ scenario: b.scenario, answerKey: drift, answer: { choice: first }, template: T }).error.code === "rules_version_mismatch");
}

console.log("\n[2] Properties over every option of every pool scenario");
let evals = 0;
const tally = { signals: {}, tierVsSignal: {}, nsReasons: {}, byFactor: {} };
let strongPosNeedsRealized = true;
let valueClassOk = true;
let allDeterministic = true;
let allVocab = true;
let onePerExposed = true;
let provenanceComplete = true;
let strongNeverStrongNeg = true;
let weakNeverPositive = true;
let tierMatches = true;
let integersOnly = true;
let strongChoiceWithNoSignal = 0;
let sameTierDifferentSignals = 0;
let scenariosWithBothPolarities = 0;
for (const b of pool) {
  const exposed = FACTOR_IDS.filter((f) => b.answerKey.factorEvidence[f].exposed);
  const perTier = {};
  let pos = false;
  let neg = false;
  for (const opt of b.scenario.decision.options) {
    const r = evalOf(b, opt.id);
    const r2 = evalOf(b, opt.id);
    evals += 1;
    const e = r.evaluation;
    if (stableStringify(r) !== stableStringify(r2)) allDeterministic = false;
    if (e.decision.tier !== b.answerKey.options[opt.id].tier || e.decision.actionType !== opt.actionType) tierMatches = false;
    if (e.factorSignals.length !== exposed.length || e.factorSignals.some((f, i) => f.factor !== exposed[i] || f.exposure !== true)) onePerExposed = false;
    const p = e.provenance;
    if (!(p.source === "deterministic" && p.scenarioVersion && p.templateVersion && p.generatorVersion && p.rulesVersion && p.registries && p.constants && p.dataFingerprint && p.evaluatorVersion === VERSIONS.evaluator) || e.reasoning.analyzed !== false) provenanceComplete = false;
    const sigs = e.factorSignals.map((f) => f.performance.signal);
    for (const f of e.factorSignals) {
      tally.signals[f.performance.signal] = (tally.signals[f.performance.signal] || 0) + 1;
      tally.byFactor[f.factor] = (tally.byFactor[f.factor] || 0) + 1;
      if (f.performance.signal === "strong_positive" && f.basis.realized < T.rules.signals.strongMin) strongPosNeedsRealized = false;
      if (f.valueClass !== FACTORS[f.factor].valueClass) valueClassOk = false;
      if (!SIGNALS.includes(f.performance.signal)) allVocab = false;
      if (f.performance.signal === "no_signal") tally.nsReasons[f.performance.reason] = (tally.nsReasons[f.performance.reason] || 0) + 1;
      if (!Object.values(f.basis).every(Number.isInteger)) integersOnly = false;
    }
    if (e.decision.tier === "STRONG" && sigs.includes("strong_negative")) strongNeverStrongNeg = false;
    if (!DEFENSIBLE_TIERS.includes(e.decision.tier) && sigs.some((s) => s === "positive" || s === "strong_positive")) weakNeverPositive = false;
    if (e.decision.tier === "STRONG" && sigs.includes("no_signal")) strongChoiceWithNoSignal += 1;
    if (sigs.some((s) => s === "positive" || s === "strong_positive")) pos = true;
    if (sigs.some((s) => s === "negative" || s === "strong_negative")) neg = true;
    const key = e.decision.tier;
    if (perTier[key] !== undefined && perTier[key] !== sigs.join()) sameTierDifferentSignals += 1;
    perTier[key] = sigs.join();
  }
  if (pos && neg) scenariosWithBothPolarities += 1;
}
const sigTotal = Object.values(tally.signals).reduce((a, b) => a + b, 0);
const strongShare = ((tally.signals.strong_positive || 0) + (tally.signals.strong_negative || 0)) / sigTotal;
console.log(`  STATS evaluations=${evals} signals=${JSON.stringify(tally.signals)} no_signal reasons=${JSON.stringify(tally.nsReasons)}`);
console.log(`  STATS signal shares: strong ${(100 * strongShare).toFixed(1)}% (strong_positive ${(100 * (tally.signals.strong_positive || 0) / sigTotal).toFixed(1)}%, strong_negative ${(100 * (tally.signals.strong_negative || 0) / sigTotal).toFixed(1)}%), positive ${(100 * (tally.signals.positive || 0) / sigTotal).toFixed(1)}%, negative ${(100 * (tally.signals.negative || 0) / sigTotal).toFixed(1)}%, no_signal ${(100 * (tally.signals.no_signal || 0) / sigTotal).toFixed(1)}%`);
console.log(`  STATS STRONG choices that still left some exposed factor at no_signal: ${strongChoiceWithNoSignal}; scenarios where the same tier gave different signals for different choices: ${sameTierDifferentSignals}`);
check(`evaluated ${evals} answers (every option of ${pool.length} scenarios)`, evals > 600, evals);
check("strong signals are a minority (well below the 37-40% the first draft produced): strong < 20% of all signals", strongShare < 0.2, strongShare);
check("evaluation is deterministic (identical output on repeat)", allDeterministic);
check("decision.tier / actionType equal the answer key's", tierMatches);
check("factor signals use only the specified vocabulary", allVocab);
check("exactly one signal per EXPOSED factor, none for unexposed ones, each marked exposure:true", onePerExposed);
check("provenance is complete and marked deterministic; reasoning is recorded but not analysed", provenanceComplete);
check("a STRONG choice is never strong_negative on a factor", strongNeverStrongNeg);
check("a WEAK or INVALID choice never earns a positive signal", weakNeverPositive);
check("all signal basis numbers are integers (no floating point in evaluation)", integersOnly);
check("evidence strength: every strong_positive is backed by REALIZED evidence (avoidance alone never exceeds positive)", strongPosNeedsRealized);
check("valueClass travels with every factor signal and matches the registry (objective_value and long_term_map_value are scenario_contextual)", valueClassOk);
check("fightability produces its own factor-level signals (it is a first-class factor)", (tally.byFactor.fightability || 0) > 0, tally.byFactor);
check("both positive and negative signals occur (the evaluator discriminates)", (tally.signals.positive || 0) + (tally.signals.strong_positive || 0) > 0 && (tally.signals.negative || 0) + (tally.signals.strong_negative || 0) > 0);
check("no_signal is a real outcome with a stated reason, distinct from every performance signal", (tally.signals.no_signal || 0) > 0 && SIGNALS.filter((s) => s === "no_signal").length === 1 && Object.keys(tally.nsReasons).every((k) => ["insufficient_evidence", "below_threshold", "unavailable_action"].includes(k)), tally.nsReasons);
check("performance is NOT the tier: STRONG choices can leave a factor at no_signal", strongChoiceWithNoSignal > 0);
check("performance is NOT the tier: the same tier can yield different factor signals depending on the choice", sameTierDifferentSignals > 0);
check("a single decision can be right on one factor and wrong on another", scenariosWithBothPolarities > 0, scenariosWithBothPolarities);

console.log("\n[3] INVALID and SITUATIONAL paths, alignment, escalation");
{
  // SETUP is unavailable once the enemy is already taking the objective.
  const inv = craft({ structure: "CONTEST_VS_TRADE", actions: ["CONTEST", "TRADE", "SETUP"], difficulty: 3, mutate: (r) => {
    setPath(r, "objectives.dragon.availableInSec", 0); setPath(r, "objectives.dragon.status", "available"); setPath(r, "objectives.dragon.activity", "enemy_taking"); setPath(r, "objectives.riftHerald.availableInSec", 8);
    for (const s of ["mid", "jungle", "support"]) r.teams.enemies.members[s].zone = "bot_side";
  } });
  const e = evalOf(inv, "setup").evaluation;
  check("choosing an unavailable action is tiered INVALID and marked unavailable", e.decision.tier === "INVALID" && e.decision.available === false);
  check("...with no outcome alignment (there is no chain to compare)", e.outcomeAlignment === null);
  check("...and every factor signal is no_signal for reason unavailable_action (no learning inferred from it)", e.factorSignals.length > 0 && e.factorSignals.every((f) => f.performance.signal === "no_signal" && f.performance.reason === "unavailable_action"));
  check("...and it raises an escalation signal", e.escalation.signals.some((s) => s.code === "chosen_unavailable_action"));
  check("the answer key still ranks the available options and lists INVALID with a reason", inv.answerKey.options.setup.tier === "INVALID" && inv.answerKey.options.setup.invalidReason === "no_team_has_committed" && inv.answerKey.ranking.length === 2);
  check("INVALID options are never among best or defensible", !inv.answerKey.best.includes("setup") && !inv.answerKey.defensible.includes("setup"));

  // Poor information: the contest now rests mostly on low-certainty outcomes, but it is the ONLY defensible
  // option, so it keeps its base tier: an uncertain payoff is not a choice between defensible decisions.
  const lone = craft({ structure: "CONTEST_VS_TRADE", actions: ["CONTEST", "TRADE"], difficulty: 3, mutate: (r) => {
    setPath(r, "objectives.dragon.stakes", "high"); moveAllies(r, ["jungle", "baron"], "mid");
    r.vision.allies.top_side = "none";
    for (const s of ["baron", "jungle", "support"]) r.teams.enemies.members[s].lastSeenAgoSec = 40;
  } });
  const l = evalOf(lone, "contest").evaluation;
  check("poor information is derived from the state", lone.scenario.state.derived.infoQuality.level === "poor");
  check("the contest's result rests mostly on low-certainty outcomes (recorded)...", lone.answerKey.options.contest.lowCertaintyPercent >= T.rules.tiering.situationalLowCertaintyPercent, lone.answerKey.options.contest);
  check("...but with no other defensible option it is NOT labelled SITUATIONAL (it keeps its base tier)", lone.answerKey.defensible.length === 1 && l.decision.tier !== "SITUATIONAL", l.decision);
  check("...and the uncertainty still reaches the learner as an escalation signal", l.escalation.signals.some((x) => x.code === "poor_information"), l.escalation);

  // Genuine SITUATIONAL, from generated scenarios: an uncertain-but-good option next to a defensible alternative.
  const sitB = pool.find((b) => Object.values(b.answerKey.options).some((o) => o.tier === "SITUATIONAL"));
  check("(setup) the pool contains scenarios with a SITUATIONAL option", !!sitB);
  if (sitB) {
    const sitId = Object.keys(sitB.answerKey.options).find((id) => sitB.answerKey.options[id].tier === "SITUATIONAL");
    const so = sitB.answerKey.options[sitId];
    const e = evalOf(sitB, sitId).evaluation;
    check("a SITUATIONAL option is tiered SITUATIONAL, has a non-negative score and mostly low-certainty weight", e.decision.tier === "SITUATIONAL" && so.score >= T.rules.tiering.situationalMinScore && so.lowCertaintyPercent >= T.rules.tiering.situationalLowCertaintyPercent, so);
    check("...exists alongside another defensible option (multiple defensible decisions)", sitB.answerKey.defensible.length >= 2 && sitB.answerKey.defensible.some((id) => id !== sitId));
    check("...still counts as defensible and raises the chosen_situational escalation signal", sitB.answerKey.defensible.includes(sitId) && e.escalation.signals.some((x) => x.code === "chosen_situational"));
  }
  check("certainty is qualitative only (no numbers) in every chain", [lone, inv, ...pool].every((b) => Object.values(b.answerKey.options).every((o) => o.outcomeChain.every((c) => ["guaranteed", "high", "medium", "low"].includes(c.certainty)))));

  // Alignment labels from the pool: best -> aligned, defensible non-best -> partial, weak -> divergent.
  const mixed = pool.find((b) => b.answerKey.best.length === 1 && b.answerKey.defensible.length >= 2 && b.answerKey.options[b.answerKey.best[0]].tier === "STRONG");
  check("(setup) found a scenario with one STRONG and another defensible option", !!mixed);
  if (mixed) {
    const bestId = mixed.answerKey.best[0];
    const otherId = mixed.answerKey.defensible.find((id) => id !== bestId);
    const weakId = Object.keys(mixed.answerKey.options).find((id) => mixed.answerKey.options[id].tier === "WEAK");
    check("choosing the best option is 'aligned' with every stage 'same'", evalOf(mixed, bestId).evaluation.outcomeAlignment.label === "aligned" && evalOf(mixed, bestId).evaluation.outcomeAlignment.stages.every((x) => x.relation === "same"));
    check("choosing another defensible option is 'partial'", evalOf(mixed, otherId).evaluation.outcomeAlignment.label === "partial");
    if (weakId) check("choosing a WEAK option is 'divergent'", evalOf(mixed, weakId).evaluation.outcomeAlignment.label === "divergent");
    const cmp = evalOf(mixed, otherId).evaluation.decision.compare;
    check("the evaluation compares the choice with the close alternatives (best listed first)", cmp.length >= 1 && cmp[0].optionId === bestId && cmp.every((x, i) => i === 0 || TIER_RANK[cmp[i - 1].tier] >= TIER_RANK[x.tier]), cmp);
  }
}

console.log("\n[4] Thresholds are DATA in the rule table, not code");
{
  const b = pool.find((x) => evalOf(x, x.answerKey.best[0]).evaluation.factorSignals.some((f) => f.performance.signal !== "no_signal"));
  const baseline = evalOf(b, b.answerKey.best[0]).evaluation.factorSignals.map((f) => f.performance.signal);
  const huge = 1e9;
  const T2 = { ...T, rules: { ...T.rules, signals: { ...T.rules.signals, positiveMin: huge, strongMin: huge, avoidedPositiveMin: huge, missedMin: huge, missedStrongMin: huge } } };
  const raised = evalOf(b, b.answerKey.best[0], T2).evaluation.factorSignals.map((f) => f.performance.signal);
  check("with the shipped thresholds this scenario produces at least one signal", baseline.some((s) => s !== "no_signal"), baseline);
  check("raising the thresholds in the rule table alone turns every signal into no_signal", raised.every((s) => s === "no_signal"), raised);
  const T3 = { ...T, rules: { ...T.rules, signals: { ...T.rules.signals, minAttributionMass: huge } } };
  const thin = evalOf(b, b.answerKey.best[0], T3).evaluation.factorSignals;
  check("demanding more evidence than exists yields no_signal with reason insufficient_evidence", thin.every((f) => f.performance.signal === "no_signal" && f.performance.reason === "insufficient_evidence"));
}

console.log("\n[5] Transfer, complexity and purity");
{
  const b = pool[3];
  const keys = b.scenario.decision.options.map((o) => evalOf(b, o.id).evaluation.transfer.patternKey);
  check("the transfer pattern key does not depend on which option was chosen", new Set(keys).size === 1);
  const distinct = new Set(pool.map((x) => evalOf(x, x.scenario.decision.options[0].id).evaluation.transfer.patternKey));
  check(`different situations have different transfer pattern keys (${distinct.size} across ${pool.length})`, distinct.size > 50);
  const c = evalOf(pool[3], pool[3].scenario.decision.options[0].id).evaluation.complexity;
  check("complexity signals describe the scenario (difficulty, factor count, conflict, defensible count)", c.difficulty === pool[3].scenario.difficulty && c.activeFactorCount === pool[3].scenario.activeFactors.length && typeof c.conflict === "boolean" && c.defensibleCount === pool[3].answerKey.analysis.defensibleCount);
  const withReasoning = evalOf(pool[0], pool[0].scenario.decision.options[0].id, T, { reasoning: "I contest because my jungler is close." }).evaluation;
  const without = evalOf(pool[0], pool[0].scenario.decision.options[0].id).evaluation;
  check("free-text reasoning is recorded as provided but changes nothing computed", withReasoning.reasoning.provided === true && withReasoning.reasoning.analyzed === false && stableStringify({ ...withReasoning, reasoning: 0 }) === stableStringify({ ...without, reasoning: 0 }));
  const src = readFileSync(new URL("../functions/_lib/decisionLab/evaluator.js", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check("evaluator.js imports only pure decisionLab modules (no AI, network, storage, clock)", [...code.matchAll(/from\s+"([^"]+)"/g)].every((m) => /^\.\//.test(m[1])), [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]));
  check("evaluator.js has no async code, network or provider calls", !/\b(async|await|fetch|callAIProvider|anthropic|openai)\b/i.test(code));
}

finish();
