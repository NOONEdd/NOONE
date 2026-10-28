// decisionLab -- deterministic Evaluator (spec sections 36-40, 47).
//
// Input:  Scenario + AnswerKey + the player's answer.
// Output: Decision, Tier, Factor Signals, Outcome Alignment, Transfer,
//         Complexity Signals, Escalation Signals -- all deterministic.
//
// There is no LLM here, no I/O and no async. The player's optional free-text
// reasoning is recorded as "provided" and NOT analysed (reasoning analysis is
// a later phase and may only ever produce lower-trust, closed-vocabulary
// evidence with provenance; it can never change anything computed here).
//
// FACTOR SIGNALS (spec sections 37-39). Exposure is separate from
// performance. For every EXPOSED factor the signal comes from the chosen
// option's outcome chain (choice), the scenario's conditions (which options
// the factor's level made better or worse), and the outcome attribution --
// never from the tier alone:
//
//   realized   what the chosen option's chain actually gained/lost through f
//   missed     benefit on f that a better-defended option captured and the
//              player forfeited (only defensible options count as "available")
//   avoided    harm on f that the chosen option steered clear of, measured on
//              the options that were NOT defensible
//
// The mapping from those numbers to strong_positive / positive / negative /
// strong_negative / no_signal uses the thresholds in the template's DRAFT
// rule table (rules.signals). no_signal means "not enough evidence"; it is
// NOT neutral performance.
//
// THE SIGNAL CONTRACT (rules.signalContract). A signal is the strength of the
// evidence ATTRIBUTABLE TO ONE FACTOR. It is not the tier, not whether the
// answer was correct, not the option rank and not the raw outcome valence:
// the same outcome (same valence, certainty and stage) is strong evidence for a
// sole driver and moderate evidence for each of two co-drivers, and two choices
// in the same tier can earn different classes. Tier is used only to decide which
// alternatives are defensible comparators; it never grades strength.
//
// FACTOR CONTRIBUTIONS (identification, separate from the signal). For every
// exposed factor the evaluation also reports its INFLUENCE on the chosen option
// and on every other option (answerKey.options[id].influences): a deterministic
// counterfactual measured against the final state, covering factors that
// SUPPORT an option and factors that OPPOSE it. So a factor that only shrinks
// the best option's margin (an unfavourable fight behind a still-best contest)
// is identified as a contributing factor even though another factor decides the
// tier and even though it earns no performance signal.
//
// EVIDENCE STRENGTH. A strong_positive needs REALIZED evidence: the chosen
// option's own chain gained a lot through the factor. Avoiding a harm that a
// rejected option would have suffered is counterfactual (the player may have
// chosen for other reasons), so avoidance alone earns at most `positive`.
// Direct losses and forfeited benefits can still be strong_negative.

import { STAGES, DEFENSIBLE_TIERS, TIER_RANK, VERSIONS } from "./config.js";
import { FACTOR_IDS } from "./factors.js";
import { stableStringify, hash64 } from "./fingerprint.js";
import { templateRuleIssues, errorText, isRequestObject } from "./validator.js";
import { registeredTemplate, templateTrust } from "./templates/registry.js";

/** The signal classifier: evidence for one factor, graded against `signals`
 *  (the rule table's thresholds). Pure. evaluateAnswer always passes the
 *  registered table's thresholds; exported so the classifier's contract can be
 *  tested with other thresholds without evaluating against untrusted content. */
export function signalFor({ factor, choiceId, answerKey, signals }) {
  const options = answerKey.options;
  const chosen = options[choiceId];
  const contrib = (id) => options[id].contributions[factor] || 0;
  const validIds = Object.keys(options).filter((id) => options[id].valid);

  // Evidence sufficiency: does ANY option's chain attribute enough to this factor?
  const mass = validIds.length ? Math.max(...validIds.map((id) => Math.abs(contrib(id)))) : 0;
  if (!chosen.valid) return { signal: "no_signal", reason: "unavailable_action", basis: { realized: 0, missed: 0, avoided: 0 } };
  if (mass < signals.minAttributionMass) return { signal: "no_signal", reason: "insufficient_evidence", basis: { realized: 0, missed: 0, avoided: 0 } };

  const defensible = validIds.filter((id) => DEFENSIBLE_TIERS.includes(options[id].tier));
  const rejected = validIds.filter((id) => !DEFENSIBLE_TIERS.includes(options[id].tier));
  const chosenDefensible = DEFENSIBLE_TIERS.includes(chosen.tier);

  const realized = contrib(choiceId);
  const bestDefensible = defensible.length ? Math.max(...defensible.map(contrib)) : 0;
  const missed = Math.max(0, bestDefensible - realized);
  const avoided = chosenDefensible ? Math.max(0, ...rejected.map((id) => -contrib(id))) : 0;
  const basis = { realized, missed, avoided };

  let signal = "no_signal";
  if (chosenDefensible) {
    if (realized >= signals.strongMin) signal = "strong_positive";
    else if (realized >= signals.positiveMin || avoided >= signals.avoidedPositiveMin) signal = "positive";
    else if (missed >= signals.missedStrongMin) signal = "negative";
  } else if (realized <= -signals.strongMin || missed >= signals.missedStrongMin) {
    signal = "strong_negative";
  } else if (realized <= -signals.positiveMin || missed >= signals.missedMin) {
    signal = "negative";
  }
  return { signal, reason: signal === "no_signal" ? "below_threshold" : "derived", basis };
}

/** Compare the chosen option's chain with the best option's, stage by stage. */
function outcomeAlignment(choiceId, answerKey) {
  const chosen = answerKey.options[choiceId];
  const bestId = answerKey.best[0];
  if (!chosen.valid || bestId === undefined) return null;
  const best = answerKey.options[bestId];
  const stages = STAGES.map((stage, i) => {
    const c = chosen.outcomeChain[i];
    const b = best.outcomeChain[i];
    return {
      stage,
      chosenOutcome: c.outcome,
      bestOutcome: b.outcome,
      relation: c.valence === b.valence ? "same" : c.valence > b.valence ? "better" : "worse",
    };
  });
  const label = answerKey.best.includes(choiceId) ? "aligned" : DEFENSIBLE_TIERS.includes(chosen.tier) ? "partial" : "divergent";
  return { label, comparedWith: bestId, stages };
}

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isNum = (x) => typeof x === "number" && Number.isFinite(x);

/** Structural problems in the stored scenario and answer key, limited to what
 *  evaluateAnswer reads (bundle_invalid; ERROR_CONTRACT_v1_1.md 5.3, U3).
 *  Semantic validity -- a forged tier or score in a well-shaped document -- is
 *  not checked here: validateScenarioBundle and the serving gate own that. */
function storedBundleIssues(scenario, answerKey) {
  if (!isObj(scenario)) return ["scenario must be an object"];
  if (!isObj(answerKey)) return ["answerKey must be an object"];
  const p = [];
  if (typeof scenario.scenarioRef !== "string") p.push("scenario.scenarioRef must be a string");
  if (!isObj(scenario.provenance) || !isObj(scenario.provenance.registries)) p.push("scenario.provenance must be an object with registries");
  const d = scenario.decision;
  if (!isObj(d) || typeof d.structure !== "string" || typeof d.primaryObjective !== "string") p.push("scenario.decision needs structure and primaryObjective");
  const raw = isObj(scenario.state) ? scenario.state.raw : undefined;
  if (!isObj(raw) || !isObj(raw.gameContext) || !isObj(raw.objectives) || !isObj(d) || !isObj(raw.objectives[d.primaryObjective])) p.push("scenario.state.raw needs gameContext and the primary objective");
  if (!Number.isInteger(scenario.difficulty)) p.push("scenario.difficulty must be an integer");
  if (!isObj(answerKey.versions) || !isObj(answerKey.versions.registries)) p.push("answerKey.versions must be an object with registries");
  const options = answerKey.options;
  if (!isObj(options) || Object.keys(options).length === 0) p.push("answerKey.options must be a non-empty object");
  else {
    for (const [id, o] of Object.entries(options)) {
      if (!isObj(o)) {
        p.push(`answerKey.options.${id} must be an object`);
        continue;
      }
      if (typeof o.valid !== "boolean" || typeof o.actionType !== "string" || !Object.prototype.hasOwnProperty.call(TIER_RANK, o.tier)) p.push(`answerKey.options.${id} needs valid, actionType and a tier`);
      if (!isObj(o.contributions) || Object.values(o.contributions).some((v) => !isNum(v))) p.push(`answerKey.options.${id}.contributions must map factors to numbers`);
      if (!isObj(o.influences) || Object.values(o.influences).some((v) => !isObj(v))) p.push(`answerKey.options.${id}.influences must map factors to objects`);
      if (o.valid === true && (!isNum(o.score) || !Array.isArray(o.outcomeChain) || o.outcomeChain.length !== STAGES.length || o.outcomeChain.some((c) => !isObj(c) || !isNum(c.valence)))) p.push(`answerKey.options.${id}: a valid option needs a score and one outcome per stage`);
    }
  }
  const fe = answerKey.factorEvidence;
  if (!isObj(fe) || FACTOR_IDS.some((f) => !isObj(fe[f]) || typeof fe[f].exposed !== "boolean")) p.push("answerKey.factorEvidence needs an entry with exposed for every factor");
  const ids = isObj(options) ? Object.keys(options) : [];
  for (const list of ["best", "defensible"]) if (!Array.isArray(answerKey[list]) || answerKey[list].some((id) => !ids.includes(id))) p.push(`answerKey.${list} must list option ids`);
  if (!isObj(answerKey.analysis) || !Number.isInteger(answerKey.analysis.defensibleCount)) p.push("answerKey.analysis needs defensibleCount");
  if (!isObj(answerKey.derivedSignals) || !isObj(answerKey.derivedSignals.infoQuality)) p.push("answerKey.derivedSignals needs infoQuality");
  return p;
}

/** Evaluate one answer. Returns { ok: true, evaluation } or
 *  { ok: false, error: { code } }. `template` must be the template (id,
 *  version and rules version) the scenario was built from: template_mismatch
 *  otherwise. When it is omitted (undefined), the trusted registry's template
 *  for the scenario's provenance is used. Either way the template must be
 *  registered (template_unregistered) and carry exactly the registered content
 *  (template_content_mismatch): a copy that keeps the labels but changes the
 *  content is never used to grade a scenario. Never throws
 *  (ERROR_CONTRACT_v1_1.md 5): a request that is not an object is
 *  request_invalid; stored documents missing a field this reads are
 *  bundle_invalid { issues }; any other exception is operation_failed { detail }. */
export function evaluateAnswer(request) {
  if (!isRequestObject(request)) return { ok: false, error: { code: "request_invalid", detail: "the request must be an object" } };
  try {
    return evaluate(request);
  } catch (e) {
    let issues;
    try {
      issues = storedBundleIssues(request.scenario, request.answerKey);
    } catch {
      issues = [];
    }
    return issues.length ? { ok: false, error: { code: "bundle_invalid", issues } } : { ok: false, error: { code: "operation_failed", detail: errorText(e) } };
  }
}

function evaluate({ scenario, answerKey, answer, template: supplied }) {
  if (!answerKey || answerKey.scenarioRef !== scenario.scenarioRef) return { ok: false, error: { code: "answer_key_mismatch" } };
  if (answerKey.versions.rulesVersion !== scenario.provenance.rulesVersion) return { ok: false, error: { code: "rules_version_mismatch" } };
  if (answerKey.versions.templateVersion !== scenario.provenance.templateVersion) return { ok: false, error: { code: "template_version_mismatch" } };
  if (stableStringify(answerKey.versions.registries) !== stableStringify(scenario.provenance.registries)) return { ok: false, error: { code: "registry_version_mismatch" } };
  // Signals are graded with template.rules, so the template must be the one the scenario was built from.
  // Otherwise the evaluation would apply one rule table while its provenance names another.
  const built = scenario.provenance;
  const template = supplied === undefined ? registeredTemplate({ templateId: built.templateId, templateVersion: built.templateVersion, rulesVersion: built.rulesVersion }) : supplied;
  if (supplied === undefined && !template) return { ok: false, error: { code: "template_unregistered" } };
  if (!template || !template.rules || template.id !== built.templateId || template.version !== built.templateVersion || template.rules.version !== built.rulesVersion) return { ok: false, error: { code: "template_mismatch" } };
  const ruleIssues = templateRuleIssues(template);
  if (ruleIssues.length) return { ok: false, error: { code: "rules_invalid", issues: ruleIssues } };
  const trust = templateTrust(template);
  if (trust.issue) return { ok: false, error: trust.issue };
  const choiceId = answer && answer.choice;
  if (typeof choiceId !== "string" || !Object.prototype.hasOwnProperty.call(answerKey.options, choiceId)) return { ok: false, error: { code: "invalid_choice" } };
  const shape = storedBundleIssues(scenario, answerKey);
  if (shape.length) return { ok: false, error: { code: "bundle_invalid", issues: shape } };

  const rules = template.rules;
  const chosen = answerKey.options[choiceId];
  const exposed = FACTOR_IDS.filter((f) => answerKey.factorEvidence[f].exposed);

  const validIds = Object.keys(answerKey.options).filter((id) => answerKey.options[id].valid);
  const compare = validIds
    .filter((id) => id !== choiceId)
    .map((id) => ({
      optionId: id,
      actionType: answerKey.options[id].actionType,
      tier: answerKey.options[id].tier,
      scoreDelta: chosen.valid ? answerKey.options[id].score - chosen.score : null,
    }))
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || (a.optionId < b.optionId ? -1 : 1));
  const bestScore = validIds.length ? Math.max(...validIds.map((id) => answerKey.options[id].score)) : 0;
  const closeToBest = validIds.filter((id) => bestScore - answerKey.options[id].score <= rules.tiering.strongMaxGap);

  const contributionOf = (factor) => {
    const options = {};
    for (const id of validIds) {
      const inf = answerKey.options[id].influences[factor];
      if (inf) options[id] = { effect: inf.effect, scoreDelta: inf.scoreDelta, tier: inf.tier, tierWithout: inf.tierWithout };
    }
    const c = chosen.valid ? chosen.influences[factor] : null;
    return {
      material: Object.keys(options).length > 0,
      chosen: c ? { effect: c.effect, scoreDelta: c.scoreDelta, tier: c.tier, tierWithout: c.tierWithout, stages: c.stages, evidence: c.evidence } : null,
      options,
    };
  };
  const factorSignals = exposed.map((factor) => {
    const s = signalFor({ factor, choiceId, answerKey, signals: rules.signals });
    // `performance` grades the player from evidence mass alone (untouched by the line below): its
    // `reason` answers "why this signal class", never "was the factor material". `contribution` is
    // the separate IDENTIFICATION layer (requirement: a factor is identified as contributing to an
    // option even when it earns no_signal and even when another factor decides the tier).
    const contribution = contributionOf(factor);
    return { factor, exposure: true, valueClass: answerKey.factorEvidence[factor].valueClass, performance: { signal: s.signal, reason: s.reason }, basis: s.basis, contribution };
  });

  const conditions = Object.fromEntries(exposed.map((f) => [f, answerKey.factorEvidence[f].level]));
  const bestActions = answerKey.best.map((id) => answerKey.options[id].actionType).sort();
  const pattern = {
    scenarioType: template.id,
    decisionStructure: scenario.decision.structure,
    primaryObjective: scenario.decision.primaryObjective,
    windowKind: scenario.state.raw.gameContext.windowKind,
    activity: scenario.state.raw.objectives[scenario.decision.primaryObjective].activity,
    factorPattern: exposed.map((f) => `${f}:${conditions[f]}`),
    bestActionTypes: bestActions,
  };

  const escalation = [];
  if (!chosen.valid) escalation.push({ code: "chosen_unavailable_action" });
  if (answerKey.analysis.defensibleCount >= 2 && closeToBest.length >= 2) escalation.push({ code: "multiple_defensible_close", detail: { defensibleCount: answerKey.analysis.defensibleCount } });
  if (chosen.tier === "SITUATIONAL") escalation.push({ code: "chosen_situational" });
  if (answerKey.derivedSignals.infoQuality.level === "poor") escalation.push({ code: "poor_information" });
  if (answerKey.best.length > 0 && answerKey.options[answerKey.best[0]].tier !== "STRONG") escalation.push({ code: "no_strong_option" });

  const p = scenario.provenance;
  const evaluation = {
    evaluationVersion: VERSIONS.evaluator,
    scenarioRef: scenario.scenarioRef,
    mode: "quick",
    decision: {
      optionId: choiceId,
      actionType: chosen.actionType,
      tier: chosen.tier,
      available: chosen.valid,
      bestOptionIds: answerKey.best.slice(),
      defensibleOptionIds: answerKey.defensible.slice(),
      compare,
    },
    factorSignals,
    outcomeAlignment: outcomeAlignment(choiceId, answerKey),
    context: {
      difficulty: scenario.difficulty,
      scenarioType: template.id,
      decisionStructure: scenario.decision.structure,
      conditions,
      relatedFactors: exposed,
    },
    transfer: { pattern, patternKey: hash64(stableStringify(pattern)) },
    complexity: {
      difficulty: scenario.difficulty,
      activeFactorCount: exposed.length,
      conflict: answerKey.analysis.conflict,
      defensibleCount: answerKey.analysis.defensibleCount,
      closeAlternativeCount: Math.max(0, closeToBest.length - (closeToBest.includes(choiceId) ? 1 : 0)),
      backgroundSignals: { infoQuality: answerKey.derivedSignals.infoQuality.level },
    },
    escalation: { signals: escalation },
    reasoning: { provided: typeof answer.reasoning === "string" && answer.reasoning.trim() !== "", analyzed: false },
    provenance: {
      source: "deterministic",
      scenarioVersion: p.scenarioVersion,
      templateId: p.templateId,
      templateVersion: p.templateVersion,
      generatorVersion: p.generatorVersion,
      rulesVersion: p.rulesVersion,
      registries: p.registries,
      constants: p.constants,
      dataFingerprint: p.dataFingerprint,
      evaluatorVersion: VERSIONS.evaluator,
    },
  };
  return { ok: true, evaluation };
}

