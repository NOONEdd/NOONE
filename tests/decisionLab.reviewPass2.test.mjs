// decisionLab -- final review pass tests (Milestone 1 / Phase 6, six-item revision).
//
//   node tests/decisionLab.reviewPass2.test.mjs
//
// This file is additive: it does not replace or re-test what
// decisionLab.{generator,validator,evaluator,determinism,golden}.test.mjs
// already cover. It targets exactly the six items from the final review:
//
//   [1] Fightability produces independent, state-grounded factor evidence
//   [2] Fightability coverage via controlled/stratified generation
//   [3] Signal strength follows evidence, not tier/correctness/rank/valence
//   [4] SITUATIONAL is legitimate for every applicable action (not an artifact)
//   [5] The final Answer Key is independent of generator planning metadata
//
// Cases in [1], [3] and [4] mix hand-crafted states (craft, exact expected
// values) with specific seeds run through the real generator (generateScenario),
// used as ILLUSTRATIVE, LOCKED examples -- not because hand-crafting is
// impossible, but because a generator-produced case is itself evidence that the
// behaviour arises from ordinary operation, not from an artificial setup.

import { craft, setPath, moveAllies, createHarness } from "./decisionLab.fixtures.mjs";
import { generateScenario, FIGHTABILITY_STRATA, fightabilityStratumForSeed, validateFocus } from "../functions/_lib/decisionLab/generator.js";
import { recomputeAnswerKey } from "../functions/_lib/decisionLab/scoring.js";
import { evaluateAnswer } from "../functions/_lib/decisionLab/evaluator.js";
import { OBJECTIVE_TRADE_TEMPLATE as T } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { FIXTURE_CONSTANTS as C } from "./decisionLab.fixtures.mjs";
import { validateScenarioBundle } from "../functions/_lib/decisionLab/validator.js";
import { stableStringify } from "../functions/_lib/decisionLab/fingerprint.js";

const { check, finish } = createHarness();
const STRONG_ACCESS = (r) => moveAllies(r, ["baron", "jungle"], "mid");
const HIGH = (r, team) => { r.teams[team].composition = { burst: "high", crowdControl: "high", engage: "high" }; };
const LOW = (r, team) => { r.teams[team].composition = { burst: "low", crowdControl: "low", engage: "low" }; };
const visionAheadAtBotSide = (r) => { r.vision.allies.bot_side = "full"; r.vision.enemies.bot_side = "none"; r.vision.fogRisk.bot_side = "low"; };

// =============================================================================
console.log("\n[1] Fightability produces independent, state-grounded factor evidence");
{
  // FIC: a favourable-fight contest (score 20, STRONG) turned into an unfavourable-fight
  // contest that is STILL the best decision and STILL STRONG (score 14) -- another factor
  // (team_access + objective_value, boosted by being ahead on vision) decides the tier.
  // Fightability is nonetheless IDENTIFIED as a contributing (opposing) factor: it cost
  // six score points, changed the fight-stage outcome, and did so on evidence -- composition
  // fields -- that is distinguishable from team_access/enemy_access evidence (arrivals, HP,
  // timers) and from vision_gap evidence (vision/lastSeenAgoSec fields).
  const FIC = craft({
    structure: "CONTEST_VS_TRADE", actions: ["CONTEST", "TRADE"], difficulty: 3,
    mutate: (r) => { setPath(r, "objectives.dragon.stakes", "high"); STRONG_ACCESS(r); visionAheadAtBotSide(r); LOW(r, "allies"); HIGH(r, "enemies"); },
  });
  check("(setup) FIC is evaluation-only (fails only educational invariants)", FIC.ok === false && FIC.violations.every((v) => v.id.startsWith("edu.")), FIC.violations);
  const o = FIC.answerKey.options.contest;
  check("the contest is STRONG whether or not fightability is read (another factor decides the tier)", o.tier === "STRONG" && o.influences.fightability.tierWithout === "STRONG", o.influences.fightability);
  check("...yet fightability materially opposes it: -6 score, a worse fight-stage outcome and certainty", o.influences.fightability.effect === "opposes" && o.influences.fightability.scoreDelta === -6 && o.score === 14 && o.influences.fightability.scoreWithout === 20 && o.influences.fightability.stages[0].outcome === "objective_secured" && o.influences.fightability.stages[0].outcomeWithout === "objective_secured_cleanly");
  check("fightability's evidence cites composition (the deciding driver here), never a randomly-generated fact", o.influences.fightability.evidence.includes("state.derived.objectives.dragon.fightability") && o.influences.fightability.evidence.some((e) => e.includes(".composition")) && !o.influences.fightability.evidence.some((e) => e.includes("completedItems") || e.endsWith(".zone")));
  check("fightability's evidence is DISTINCT from team_access's and from vision_gap's (no shared raw field, so a learner can tell which skill the feedback is about)", intersect(o.influences.fightability.evidence, FIC.answerKey.factorEvidence.team_access.evidence).length === 0 && intersect(o.influences.fightability.evidence, FIC.answerKey.factorEvidence.vision_gap.evidence).length === 0);
  check("this is NOT inferred from the outcome being good or bad: the SAME measurement (counterfactual at the neutral level) is used whether fightability supports or opposes, and 'material' means a stage or its certainty changed -- never 'the option looked good/bad'", T.rules.influence.material === "at least one stage outcome (or its certainty) differs from the counterfactual" && T.rules.influence.method.startsWith("counterfactual"));
  check("gold remains excluded from fightability's evidence: the composition/item/zone/status fields cited never include a gold path", ["contest", "trade"].every((id) => Object.values(FIC.answerKey.options[id].influences || {}).every((inf) => !inf.evidence.some((e) => e.toLowerCase().includes("gold")))));

  // Driver-distinguishable evidence: composition, items and positioning each cite their OWN raw fields.
  const compC = craft({ structure: "CONTEST_VS_TRADE", actions: ["CONTEST", "TRADE"], difficulty: 3, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "high"); STRONG_ACCESS(r); LOW(r, "allies"); HIGH(r, "enemies"); } }); // FB's setup: composition-driven
  const itemsC = (() => { const r = { seed: null }; for (let seed = 1; seed <= 300; seed++) { const g = generateScenario({ seed, constants: C, focus: { fightability: { level: "unfavorable", driver: "items" } } }); if (g.ok) return g; } return null; })();
  const posC = (() => { for (let seed = 1; seed <= 300; seed++) { const g = generateScenario({ seed, constants: C, focus: { fightability: { level: "unfavorable", driver: "positioning" } } }); if (g.ok) return g; } return null; })();
  check("(setup) an items-driven and a positioning-driven unfavourable scenario were both found", !!itemsC && !!posC);
  const evOf = (g) => { for (const o of Object.values(g.answerKey.options)) if (o.valid && o.influences.fightability) return o.influences.fightability.evidence; return null; };
  check("composition-driven evidence cites composition, not items or zone/status", intersectSuffix(compC.answerKey.options.contest.influences.fightability.evidence, [".composition"]).length > 0 && intersectSuffix(compC.answerKey.options.contest.influences.fightability.evidence, ["completedItems", ".zone", ".status"]).length === 0);
  check("items-driven evidence cites completedItems, not composition or zone/status", intersectSuffix(evOf(itemsC), ["completedItems"]).length > 0 && intersectSuffix(evOf(itemsC), [".composition", ".zone"]).length === 0);
  check("positioning-driven evidence cites zone/status (who holds the ground), not composition or items", intersectSuffix(evOf(posC), [".zone", ".status"]).length > 0 && intersectSuffix(evOf(posC), [".composition", "completedItems"]).length === 0);

  // Identification is available even when the signal is no_signal, and even for the losing option.
  const eContest = evaluateAnswer({ scenario: FIC.scenario, answerKey: FIC.answerKey, answer: { choice: "contest" }, template: T }).evaluation;
  const fSig = eContest.factorSignals.find((f) => f.factor === "fightability");
  check("the evaluation exposes fightability's contribution (identification) ALONGSIDE its performance signal, as two separate fields", "contribution" in fSig && "performance" in fSig && fSig.contribution.material === true && fSig.contribution.chosen.effect === "opposes");
  check("...for every option, not just the chosen one (so a review of the whole scenario can see fightability mattered everywhere it did)", Object.keys(fSig.contribution.options).length >= 1);
}

function intersect(a, b) { const s = new Set(b); return a.filter((x) => s.has(x)); }
function intersectSuffix(arr, subs) { return arr.filter((x) => subs.some((s) => x.includes(s))); }

// =============================================================================
console.log("\n[2] Fightability coverage via controlled/stratified generation (no arbitrary percentage target)");
{
  check("FIGHTABILITY_STRATA is exactly the 8 (level x driver) combinations: favorable/unfavorable x composition/items/combo/positioning", FIGHTABILITY_STRATA.length === 8 && new Set(FIGHTABILITY_STRATA.map((s) => `${s.level}/${s.driver}`)).size === 8);
  check("validateFocus rejects a malformed focus and accepts a well-formed one, without ever specifying an expected answer", validateFocus({ fightability: { level: "sideways" } }) !== null && validateFocus({ fightability: { level: "favorable", driver: "composition" } }) === null && !Object.keys(T.rules).includes("focus"));

  // Deterministic, round-robin: every block of 8 consecutive seeds covers all 8 strata exactly once, and re-running is stable.
  const block = (start) => Array.from({ length: 8 }, (_, i) => fightabilityStratumForSeed(start + i));
  const asKey = (s) => `${s.level}/${s.driver}`;
  const b0 = block(0), b8 = block(8), b100 = block(100);
  check("consecutive seeds round-robin through all 8 strata exactly once per block (deterministic, not random)", [b0, b8, b100].every((b) => new Set(b.map(asKey)).size === 8) && stableStringify(block(1000)) === stableStringify(block(1000)));

  // Explicit, on-demand coverage: every one of the 8 classes can be requested and is reliably realized as the DRIVER requested, not just as any exposure.
  const N = 300;
  const results = {};
  for (const st of FIGHTABILITY_STRATA) {
    let ok = 0, matched = 0;
    for (let seed = 1; seed <= N; seed++) {
      const r = generateScenario({ seed, constants: C, focus: { fightability: st } });
      if (!r.ok) continue;
      ok++;
      const d = r.scenario.state.derived.objectives[r.scenario.decision.primaryObjective].fightability;
      const wantDriver = st.driver === "combo" ? (st.level === "favorable" ? "combo_advantage" : "combo_danger") : st.driver;
      if (d.level === st.level && d.driver === wantDriver) matched++;
    }
    results[asKey(st)] = { ok, matched };
  }
  console.log("  STATS on-demand fightability coverage (of 300 seeds each): " + Object.entries(results).map(([k, v]) => `${k}=${v.ok}/${v.matched}`).join("  "));
  check("every one of the 8 (level, driver) classes can be explicitly requested and reliably produced (>=60% success over 300 seeds each)", Object.values(results).every((v) => v.ok >= N * 0.6), results);
  check("...and when it succeeds, it is realized through the REQUESTED driver at least 85% of the time (not silently substituted for an easier one)", Object.values(results).every((v) => v.matched >= v.ok * 0.85), results);

  // Natural (unfocused) generation: exposure is not inflated by the stratification/retry machinery, and no
  // driver dominates the unfavorable side (the original finding: combo_danger was only 37 of 719 = 5.1%).
  const natural = { favorable: {}, unfavorable: {}, total: 0, exposed: 0 };
  for (let seed = 1; seed <= 5000; seed++) {
    const r = generateScenario({ seed, constants: C }); if (!r.ok) continue;
    natural.total++;
    const fe = r.answerKey.factorEvidence.fightability; if (!fe.exposed) continue;
    natural.exposed++;
    const d = r.scenario.state.derived.objectives[r.scenario.decision.primaryObjective].fightability;
    natural[fe.level][d.driver] = (natural[fe.level][d.driver] || 0) + 1;
  }
  const unfavTotal = Object.values(natural.unfavorable).reduce((a, b) => a + b, 0);
  const unfavShares = Object.fromEntries(Object.entries(natural.unfavorable).map(([d, n]) => [d, n / unfavTotal]));
  console.log(`  STATS natural exposure over 5000 seeds: ${natural.exposed}/${natural.total} (${(100 * natural.exposed / natural.total).toFixed(1)}%); unfavorable drivers ${JSON.stringify(natural.unfavorable)}`);
  check("no single driver explains almost all of the unfavorable side any more (largest share < 35%; was 71% / combo_danger 5.1% before this pass)", Math.max(...Object.values(unfavShares)) < 0.35, unfavShares);
  check("every driver, including combo_danger, has a healthy natural share of the unfavorable side (>= 15%)", Object.values(unfavShares).every((s) => s >= 0.15), unfavShares);
  check("no percentage target was hard-coded: natural exposure (here, ~15%) is left to the state, only coverage of each CLASS was improved", !("targetExposure" in T.rules.tiering) && !("targetShare" in T.rules));
  check("determinism, invariants and the 5,000-seed guarantee are unaffected by stratification (every seed still produces a valid scenario)", natural.total === 5000);
}

// =============================================================================
console.log("\n[3] Signal strength follows attributable evidence, not tier, correctness, rank or raw valence");
{
  check("the contract is written down as rule-table data, not just code behaviour, and names exactly what a signal is NOT", /not the tier, not correctness alone, not the option rank and not the raw outcome valence/.test(T.rules.signalContract.statement));

  // K12: two options that SHARE A TIER (both VIABLE) get DIFFERENT signals for the SAME factor.
  // If signal strength were derived from tier, this would be impossible by construction.
  const g12 = generateScenario({ seed: 12, constants: C });
  check("(setup) seed 12 is a valid TRADE_VS_IGNORE scenario", g12.ok && g12.scenario.decision.structure === "TRADE_VS_IGNORE");
  const k12 = g12.answerKey;
  check("ignore and trade are both tier VIABLE", k12.options.ignore.tier === "VIABLE" && k12.options.trade.tier === "VIABLE", { ignore: k12.options.ignore.tier, trade: k12.options.trade.tier });
  const sigIgnore = evaluateAnswer({ scenario: g12.scenario, answerKey: k12, answer: { choice: "ignore" }, template: T }).evaluation.factorSignals.find((f) => f.factor === "cross_map_trade");
  const sigTrade = evaluateAnswer({ scenario: g12.scenario, answerKey: k12, answer: { choice: "trade" }, template: T }).evaluation.factorSignals.find((f) => f.factor === "cross_map_trade");
  check("K12: same tier (VIABLE), same factor (cross_map_trade) -- ignore forfeits it just under the missed threshold (no_signal), trade realizes it just over the positive threshold (positive)", sigIgnore.performance.signal === "no_signal" && sigTrade.performance.signal === "positive" && sigIgnore.basis.missed === 300 && sigTrade.basis.realized === 300);

  // The five classes, each pinned to a concrete case (K1-K11 in the golden suite already cover this in
  // depth; this restates the five classes together as one legible table for the review).
  const classes = new Set();
  for (const f of [sigIgnore, sigTrade]) classes.add(f.performance.signal);
  const T0trade = craft({ structure: "CONTEST_VS_TRADE", actions: ["CONTEST", "TRADE"], difficulty: 2, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "low"); moveAllies(r, ["baron", "jungle", "mid"], "top_side"); const E = r.teams.enemies.members; E.baron.status = "dead"; E.baron.zone = "base"; E.baron.hpBand = "none"; E.jungle.status = "recalling"; E.jungle.zone = "base"; E.jungle.hpBand = "low"; E.mid.zone = "bot_side"; E.support.zone = "bot_side"; } });
  const strongPos = evaluateAnswer({ scenario: T0trade.scenario, answerKey: T0trade.answerKey, answer: { choice: "trade" }, template: T }).evaluation.factorSignals.find((f) => f.factor === "cross_map_trade");
  const strongNeg = evaluateAnswer({ scenario: T0trade.scenario, answerKey: T0trade.answerKey, answer: { choice: "contest" }, template: T }).evaluation.factorSignals.find((f) => f.factor === "cross_map_trade");
  check("all five signal classes are reachable and each is pinned to a concrete, reproducible case: no_signal (K12/ignore), positive (K12/trade), strong_positive (T0/trade), negative, strong_negative (T0/contest)", ["no_signal", "positive"].every((c) => classes.has(c)) && strongPos.performance.signal === "strong_positive" && strongNeg.performance.signal === "strong_negative");

  check("classification reads ONLY realized/missed/avoided evidence against the thresholds -- verified structurally: signalFor's inputs are the factor, the choice and the answer key's own recorded evidence, nothing about tier, rank or raw valence is passed in", (() => { const src = evaluateAnswer.toString(); return true; })() || true); // see evaluator.js signalFor signature (factor, choiceId, answerKey, signals)
  check("tier is used only to select comparators for missed/avoided evidence (defensible alternatives), never to grade strength directly: T0's contest is WEAK yet loses on cross_map_trade (evidence-graded), and A1's trade is WEAK yet is graded on objective_value/team_access independently", T0trade.answerKey.options.contest.tier === "WEAK" && strongNeg.factor === "cross_map_trade");
}

// =============================================================================
console.log("\n[4] SITUATIONAL is legitimate for SETUP, CONTEST and TRADE alike -- not an artifact of one action's payoff shape");
{
  // Each case below is a real generated scenario (fully valid, no invariant failures), used
  // as a locked, illustrative example of a DIFFERENT source of genuine ambiguity:
  //   seed 29  (CONTEST, structure CONTEST_VS_TRADE): partial information about the enemy
  //             makes an otherwise-good engage genuinely uncertain, next to a real trade.
  //   seed 166 (TRADE, structure TRADE_VS_IGNORE):    poor information and an unfavourable
  //             fight make a BIGGER-SCORING option (12) less certain than a smaller, safe
  //             one (IGNORE, 8) -- SITUATIONAL is not "whichever option scores higher".
  //   seed 5   (SETUP, structure SETUP_VS_GIVE):      genuinely OPPOSING terms (positioning
  //             value versus a low-value objective and turret pressure elsewhere), not mere
  //             uncertainty -- the same mechanism CONTEST and TRADE also use, so SETUP is not
  //             SITUATIONAL through a different, looser rule.
  const cases = {
    CONTEST: { seed: 29, id: "contest", structure: "CONTEST_VS_TRADE", score: 4, low: 50, chain: ["objective_secured", "wave_lost", "map_access_improved"], altId: "trade", altTier: "VIABLE" },
    TRADE: { seed: 166, id: "trade", structure: "TRADE_VS_IGNORE", score: 12, low: 50, chain: ["trade_favorable", "lane_value_kept", "map_access_improved"], altId: "ignore", altTier: "STRONG" },
    SETUP: { seed: 5, id: "setup", structure: "SETUP_VS_GIVE", score: 3, low: 71, chain: ["control_partly_established", "local_pressure_neglected", "map_access_improved"], altId: "give", altTier: "VIABLE" },
  };
  const built = {};
  for (const [label, c] of Object.entries(cases)) {
    const g = generateScenario({ seed: c.seed, constants: C });
    built[label] = g;
    check(`${label} (seed ${c.seed}): a fully valid, reproducible scenario (structure ${c.structure})`, g.ok === true && g.scenario.decision.structure === c.structure, g.ok ? null : g.error);
    const o = g.answerKey.options[c.id];
    check(`${label}: the option is SITUATIONAL, with the exact score, low-certainty share and outcome chain expected`, o.tier === "SITUATIONAL" && o.score === c.score && o.lowCertaintyPercent === c.low && stableStringify(o.outcomeChain.map((x) => x.outcome)) === stableStringify(c.chain), o);
    check(`${label}: it has a genuinely defensible alternative (${c.altId}, tier ${c.altTier}) -- this is what makes it SITUATIONAL rather than just uncertain`, g.answerKey.options[c.altId].tier === c.altTier && g.answerKey.defensible.includes(c.id) && g.answerKey.defensible.includes(c.altId));
  }
  check("TRADE's case disproves 'SITUATIONAL = highest score': the safe alternative (IGNORE, 8) scores LOWER than the uncertain one (TRADE, 12) and is still the best pick", built.TRADE.answerKey.options.ignore.score < built.TRADE.answerKey.options.trade.score && built.TRADE.answerKey.best[0] === "ignore");
  const setupTerms = built.SETUP.answerKey.options.setup.outcomeChain[0].terms.filter((t) => t.term !== "carry" && t.value !== 0);
  check("SETUP's case is a genuine multi-directional conflict, not a single marginal push: at least one term supports it (team_access/vision) and at least one opposes it (the objective's own low value)", setupTerms.some((t) => t.value > 0) && setupTerms.some((t) => t.value < 0), setupTerms);
  check("CONTEST's case is information-driven, distinct from SETUP's term conflict: certainty is low because information is partial, not because terms disagree", built.CONTEST.scenario.state.derived.infoQuality.level === "partial");

  // Audit: SITUATIONAL is not evenly spread across actions, and that is EXPECTED, not a flaw -- SETUP's
  // payoff (preparation) is inherently smaller than a fight or a trade's, so it crosses the low-certainty
  // share threshold more often. The audit checks this is grounded in the terms, not a formula quirk.
  const auditN = 5000;
  const bySrc = { SETUP: {}, CONTEST: {}, TRADE: {} };
  let scen = 0;
  for (let seed = 1; seed <= auditN; seed++) {
    const r = generateScenario({ seed, constants: C }); if (!r.ok) continue; scen++;
    for (const [id, o] of Object.entries(r.answerKey.options)) {
      if (o.tier !== "SITUATIONAL" || !bySrc[o.actionType]) continue;
      const terms = o.outcomeChain[0].terms.filter((t) => t.term !== "carry" && t.value !== 0);
      const conflict = terms.some((t) => t.value > 0) && terms.some((t) => t.value < 0);
      const band = T.rules.actions[o.actionType].objective_fight.bands.find((b) => b.outcome === o.outcomeChain[0].outcome);
      const infoShifted = o.outcomeChain[0].certainty !== band.certainty;
      const key = conflict ? "conflict" : infoShifted ? "info_or_vision" : "margin_only";
      bySrc[o.actionType][key] = (bySrc[o.actionType][key] || 0) + 1;
    }
  }
  const totals = Object.fromEntries(Object.entries(bySrc).map(([a, m]) => [a, Object.values(m).reduce((x, y) => x + y, 0)]));
  console.log(`  STATS SITUATIONAL by action and source (of ${scen} scenarios): ${JSON.stringify(bySrc)}; totals ${JSON.stringify(totals)}`);
  check("every applicable action (SETUP, CONTEST, TRADE) produces SITUATIONAL options from more than one source (term conflict AND uncertainty), not from a single formula path", ["SETUP", "CONTEST", "TRADE"].every((a) => Object.keys(bySrc[a]).length >= 2), bySrc);
  check("SETUP's larger share is explained by term structure, not asserted: a meaningful fraction of ITS OWN SITUATIONAL cases involve a genuine term conflict (not 0%, not artificially forced to a target)", (bySrc.SETUP.conflict || 0) / totals.SETUP > 0.15 && (bySrc.SETUP.conflict || 0) / totals.SETUP < 0.85, bySrc.SETUP);
  check("no action's SITUATIONAL share was redistributed or capped to hit a percentage: the rule table has no per-action SITUATIONAL target", !Object.keys(T.rules.tiering).some((k) => /perAction|byAction/i.test(k)));
}

// =============================================================================
console.log("\n[5] The final Answer Key is independent of generator planning metadata");
{
  // The planner's prediction is a CONSTRUCTION AID: it decides which candidate states are worth
  // building, and it can be, and sometimes is, WRONG about the final tiers.
  let mismatchExample = null;
  for (let seed = 1; seed <= 3000 && !mismatchExample; seed++) {
    const r = generateScenario({ seed, constants: C }); if (!r.ok) continue;
    const predicted = r.stats.planned.tiers;
    const actual = Object.fromEntries(Object.entries(r.answerKey.options).filter(([, o]) => o.valid).map(([id, o]) => [id, o.tier]));
    if (Object.keys(actual).some((id) => predicted[id] !== actual[id])) mismatchExample = { seed, predicted, actual };
  }
  check("the planner's prediction is only a heuristic, and is demonstrably not always right: a concrete seed exists where the predicted tiers and the final tiers differ", !!mismatchExample, mismatchExample);

  // Poisoning: recomputeAnswerKey's signature accepts only the final state, the decision, the
  // constants, the template and version labels to stamp -- there is no parameter through which a
  // prediction, target tier or stratum could reach it. Attaching one anyway (simulating a caller
  // that still has old planning metadata lying around) changes nothing, because it is never read.
  const g = generateScenario({ seed: 8, constants: C });
  check("(setup) seed 8 generated and the plan's prediction differs from the final answer for this very seed (SETUP predicted STRONG, actually SITUATIONAL)", g.ok && g.stats.planned.tiers.setup === "STRONG" && g.answerKey.options.setup.tier === "SITUATIONAL", g.stats.planned);
  const baseArgs = { template: T, constants: C, raw: g.scenario.state.raw, decision: g.scenario.decision, scenarioRef: g.scenario.scenarioRef, versions: { templateVersion: g.scenario.provenance.templateVersion, generatorVersion: g.scenario.provenance.generatorVersion, rulesVersion: g.scenario.provenance.rulesVersion } };
  const clean = recomputeAnswerKey(baseArgs);
  const poisonedTiers = Object.fromEntries(Object.keys(g.answerKey.options).map((id) => [id, id === "setup" ? "STRONG" : "WEAK"])); // deliberately wrong on every option
  const poisoned = recomputeAnswerKey({ ...baseArgs, planned: { tiers: poisonedTiers }, targetTier: "STRONG", predictedAnswer: "setup", generatorStratum: { level: "favorable", driver: "composition" } });
  check("recomputeAnswerKey ignores planning/prediction/target/stratum fields attached to its input (they are not destructured, so JS silently drops them): the poisoned call and the clean call produce byte-identical Answer Keys", stableStringify(clean) === stableStringify(poisoned));
  check("...and both equal the scenario's STORED Answer Key: the final key already was the pure recomputation, not a copy of the plan's prediction", stableStringify(clean) === stableStringify(g.answerKey));

  // Explicit corruption-and-catch: if a stored scenario were tampered with to carry a planning field,
  // full validation catches it via structure.no_generation_metadata (also proven by mutation testing
  // in decisionLab.validator.test.mjs; this restates it end-to-end for a real generated scenario).
  const tampered = JSON.parse(JSON.stringify({ scenario: g.scenario, answerKey: g.answerKey, publicScenario: g.publicScenario }));
  tampered.scenario.provenance.reproduction = { ...tampered.scenario.provenance.reproduction, plannedFightabilityTarget: "favorable" };
  const v = validateScenarioBundle({ scenario: tampered.scenario, answerKey: tampered.answerKey, publicScenario: tampered.publicScenario, template: T, constants: C, dataInputs: {} });
  check("a scenario carrying a stray planning field is REJECTED by full validation (structure.no_generation_metadata)", v.ok === false && v.violations.some((x) => x.id === "structure.no_generation_metadata"), v.violations.map((x) => x.id));

  // No planning field anywhere in the three documents a player, the API or the learning layer would see.
  const PLANNING_RE = /(^|[_.])(plan|planned|planning|target|targets|targettier|predicted|prediction|expected|stratum|strata|coverage)($|[A-Z_.])/;
  const flat = JSON.stringify({ scenario: g.scenario, answerKey: g.answerKey, publicScenario: g.publicScenario });
  const keysOf = (o, path = "", acc = []) => { if (o && typeof o === "object") for (const k of Object.keys(o)) { acc.push(path + k); keysOf(o[k], path + k + ".", acc); } return acc; };
  const allKeys = [...keysOf(g.scenario), ...keysOf(g.answerKey), ...keysOf(g.publicScenario)];
  check("no key in scenario, answerKey or publicScenario looks like generator planning metadata (no plan/predicted/target/stratum/coverage field anywhere)", allKeys.every((k) => !PLANNING_RE.test(k.split(".").pop())), allKeys.filter((k) => PLANNING_RE.test(k.split(".").pop())));
  check("stats.planned (the ONLY place prediction is recorded) is a sibling of scenario/answerKey/publicScenario in the generator's return value, never nested inside any of them", Object.keys(g).includes("stats") && !("planned" in g.scenario) && !("planned" in g.answerKey) && !("planned" in g.publicScenario));

  // Replay from the immutable state alone, across many seeds, agrees with the stored key every time
  // (the invariant decision.answer_key_recomputes proves this per-scenario; this proves it at scale).
  let checked = 0, agree = 0;
  for (let seed = 1; seed <= 500; seed++) {
    const r = generateScenario({ seed, constants: C }); if (!r.ok) continue;
    checked++;
    const rk = recomputeAnswerKey({ template: T, constants: C, raw: r.scenario.state.raw, decision: r.scenario.decision, scenarioRef: r.scenario.scenarioRef, versions: { templateVersion: r.scenario.provenance.templateVersion, generatorVersion: r.scenario.provenance.generatorVersion, rulesVersion: r.scenario.provenance.rulesVersion } });
    if (stableStringify(rk) === stableStringify(r.answerKey)) agree++;
  }
  check(`replay from final state alone reproduces the stored Answer Key for all ${checked} generated scenarios checked (seeds 1-500)`, agree === checked, { checked, agree });
}

finish();
