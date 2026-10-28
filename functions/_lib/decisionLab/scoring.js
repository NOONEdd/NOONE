// decisionLab -- scoring, tiering and answer-key construction (spec sections
// 35, 36, 39, 60).
//
// Everything here is integer arithmetic over the outcome chains built by
// outcome.js, using the numbers in the template's DRAFT rule table
// (rules.tiering, rules.signals). This module is generic: it interprets the
// table, it does not contain game judgment.
//
//   score(option)  = sum over stages of  valence * certaintyWeight * stageWeight
//   contribution   = per factor, sum over stages of
//                    valence * certaintyWeight * stageWeight * attributionWeight
//                    (so it is in "score units x 100"; see rules.signals)
//
// Tiers (spec section 35). Relative, never a single "correct" answer:
//   INVALID      the action is unavailable in this state (precondition failed)
//   STRONG       within strongMaxGap of the best valid option AND score >= strongMinScore
//   VIABLE       within viableMaxGap AND score >= viableMinScore
//   WEAK         everything else that is valid
//   SITUATIONAL  a STRONG/VIABLE option with a non-negative score whose
//                result rests mostly on low-certainty outcomes -- it works
//                only if an uncertain condition holds -- and which has a
//                defensible alternative (multiple defensible decisions)
//
// The answer key is server-side only; it is never sent to the player.

import { DEFENSIBLE_TIERS, TIER_RANK, VERSIONS, STAGES } from "./config.js";
import { FACTORS, FACTOR_IDS, FACTORS_VERSION } from "./factors.js";
import { TRACKS_VERSION } from "./tracks.js";
import { PRINCIPLES_VERSION } from "./principles.js";
import { buildOptionChain } from "./outcome.js";
import { deriveState } from "./relationships.js";

/** { score, lowCertaintyPercent } for one chain. */
export function scoreChain(chain, tiering) {
  let score = 0;
  let abs = 0;
  let low = 0;
  for (const c of chain) {
    const v = c.valence * tiering.certaintyWeights[c.certainty] * tiering.stageWeights[c.stage];
    score += v;
    abs += Math.abs(v);
    if (c.certainty === "low") low += Math.abs(v);
  }
  return { score, lowCertaintyPercent: abs === 0 ? 0 : Math.floor((100 * low) / abs) };
}

/** Per-factor contribution of a chain, in score units x 100. */
export function chainContributions(chain, tiering) {
  const out = {};
  for (const c of chain) {
    const base = c.valence * tiering.certaintyWeights[c.certainty] * tiering.stageWeights[c.stage];
    for (const a of c.attribution) out[a.factor] = (out[a.factor] || 0) + base * a.weight;
  }
  return out;
}

/** Assign tiers. `entries` is [{ id, valid, score, lowCertaintyPercent }].
 *
 *  Base tiers come from the score and the gap to the best valid option.
 *  SITUATIONAL is then a refinement of a defensible base tier: the option is
 *  good only if an uncertain condition holds (a large share of its weight is on
 *  low-certainty outcomes) AND it has a non-negative score AND -- when
 *  tiering.situationalRequiresAlternative -- the state genuinely supports
 *  multiple defensible decisions, i.e. at least one OTHER option is also
 *  defensible on its base tier. An option that is the only defensible choice
 *  keeps its base tier: an uncertain payoff is not a choice between decisions. */
export function assignTiers(entries, tiering) {
  const valid = entries.filter((e) => e.valid);
  const best = valid.length ? Math.max(...valid.map((e) => e.score)) : 0;
  const base = {};
  for (const e of valid) {
    const gap = best - e.score;
    if (e.score >= tiering.strongMinScore && gap <= tiering.strongMaxGap) base[e.id] = "STRONG";
    else if (e.score >= tiering.viableMinScore && gap <= tiering.viableMaxGap) base[e.id] = "VIABLE";
    else base[e.id] = "WEAK";
  }
  const defensibleBase = valid.filter((e) => base[e.id] === "STRONG" || base[e.id] === "VIABLE").length;
  const tiers = {};
  for (const e of entries) {
    if (!e.valid) {
      tiers[e.id] = "INVALID";
      continue;
    }
    let tier = base[e.id];
    const conditional = (tier === "STRONG" || tier === "VIABLE") && e.score >= tiering.situationalMinScore && e.lowCertaintyPercent >= tiering.situationalLowCertaintyPercent;
    const hasAlternative = defensibleBase >= 2;
    if (conditional && (!tiering.situationalRequiresAlternative || hasAlternative)) tier = "SITUATIONAL";
    tiers[e.id] = tier;
  }
  return tiers;
}

/** Which factors are exposed (detected level differs from neutral). */
export function exposedFactors(levels) {
  return FACTOR_IDS.filter((id) => levels[id] !== FACTORS[id].neutral);
}

/** Conflict / dominance / defensibility analysis over valid options, for the
 *  exposed factors only (spec section 49: difficulty is not just factor
 *  count). A factor "favours" an option when that option has the strictly
 *  highest contribution for the factor and the spread is at least
 *  signals.positiveMin. */
export function analyzeOptions(options, exposed, signals) {
  const validIds = Object.keys(options).filter((id) => options[id].valid);
  const spreads = {};
  const favored = {};
  for (const f of exposed) {
    const vals = validIds.map((id) => options[id].contributions[f] || 0);
    if (vals.length === 0) {
      spreads[f] = 0;
      favored[f] = null;
      continue;
    }
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    spreads[f] = max - min;
    const winners = validIds.filter((id) => (options[id].contributions[f] || 0) === max);
    favored[f] = spreads[f] >= signals.positiveMin && winners.length === 1 ? winners[0] : null;
  }
  const favouredOptions = new Set(Object.values(favored).filter((x) => x !== null));
  let dominantFactor = null;
  for (const f of exposed) if (dominantFactor === null || spreads[f] > spreads[dominantFactor]) dominantFactor = f;
  if (dominantFactor !== null && spreads[dominantFactor] === 0) dominantFactor = null;
  const defensibleCount = validIds.filter((id) => DEFENSIBLE_TIERS.includes(options[id].tier)).length;
  const tiersPresent = Array.from(new Set(Object.values(options).map((o) => o.tier))).sort((a, b) => TIER_RANK[b] - TIER_RANK[a]);
  return { conflict: favouredOptions.size >= 2, dominantFactor, spreads, favored, defensibleCount, tiersPresent };
}

/** TWO-SIDED FACTOR EVIDENCE (identification, separate from performance signals).
 *
 *  Attribution (outcome.js) explains an outcome through the terms that pushed it
 *  in the direction it went, so a factor that only OPPOSES an option earns no
 *  attribution. That is right for grading a player, but it hides a factor that
 *  materially shapes an option -- for example an unfavourable fight that turns
 *  a clean win into a marginal one. So each exposed factor's INFLUENCE on each
 *  option is measured separately and deterministically: re-evaluate the option
 *  with the factor's terms at the factor's NEUTRAL level and everything else in
 *  the final state unchanged. The factor is material to the option when that
 *  changes at least one stage outcome (or its certainty). Nothing here is
 *  inferred from whether the outcome was good or bad, and neutral factors are
 *  never exposed, so exposure is not inflated.
 *
 *  Returns { [optionId]: { [factor]: { effect, scoreDelta, scoreWithout, tier,
 *  tierWithout, stages, evidence } } }, factors in registry order. */
function computeInfluences({ template, ctx, decision, options, exposed, tiering }) {
  const out = Object.fromEntries(decision.options.map((o) => [o.id, {}]));
  for (const factor of exposed) {
    const counter = {};
    const entries = [];
    for (const opt of decision.options) {
      const built = buildOptionChain(template, opt.actionType, ctx, { neutralFactor: factor });
      const sc = built.valid ? scoreChain(built.chain, tiering) : { score: null, lowCertaintyPercent: 0 };
      counter[opt.id] = { built, sc };
      entries.push({ id: opt.id, valid: built.valid, score: sc.score, lowCertaintyPercent: sc.lowCertaintyPercent });
    }
    const tiersWithout = assignTiers(entries, tiering);
    for (const opt of decision.options) {
      const actual = options[opt.id];
      if (!actual.valid) continue;
      const { built, sc } = counter[opt.id];
      const stages = [];
      STAGES.forEach((stage, i) => {
        const a = actual.outcomeChain[i];
        const b = built.chain[i];
        if (a.outcome !== b.outcome || a.certainty !== b.certainty) stages.push({ stage, outcome: a.outcome, outcomeWithout: b.outcome, certainty: a.certainty, certaintyWithout: b.certainty });
      });
      if (stages.length === 0) continue; // not material: the option reads the same without this factor
      const scoreDelta = actual.score - sc.score;
      const paths = [];
      // Every term the chain read from this factor grounds the influence, including terms whose value is 0
      // because of the factor's level (conceding a low-value objective costs 0 where a neutral one costs 1).
      for (const c of actual.outcomeChain) for (const t of c.terms) if (t.factor === factor && t.term !== "carry") paths.push(...template.runtime.termEvidence(t.term, ctx));
      out[opt.id][factor] = {
        effect: scoreDelta > 0 ? "supports" : scoreDelta < 0 ? "opposes" : "reshapes",
        scoreDelta,
        scoreWithout: sc.score,
        tier: actual.tier,
        tierWithout: tiersWithout[opt.id],
        stages,
        evidence: Array.from(new Set(paths)),
      };
    }
  }
  return out;
}

/** Build the ScenarioAnswerKey for a scenario core. Deterministic and pure.
 *  base = { template, scenarioRef, raw, derived, constants, decision, versions }
 *  `detection` ({ levels, evidence }) may be passed to avoid re-detecting.
 *  `withInfluences: false` skips the counterfactual pass (the generator's
 *  planner does not need it; every final key includes it).
 *  Returns { answerKey, detection }. */
export function buildAnswerKey({ template, scenarioRef, raw, derived, constants, decision, versions, detection, withInfluences = true }) {
  const primary = decision.primaryObjective;
  const alternative = decision.alternativeObjective;
  const det = detection || template.runtime.detectFactors({ raw, derived, constants, primary, alternative });
  const ctx = { raw, derived, constants, primary, alternative, levels: det.levels, evidence: det.evidence };
  const tiering = template.rules.tiering;
  const signals = template.rules.signals;

  const options = {};
  const entries = [];
  for (const opt of decision.options) {
    const built = buildOptionChain(template, opt.actionType, ctx);
    const scored = built.valid ? scoreChain(built.chain, tiering) : { score: null, lowCertaintyPercent: 0 };
    const contributions = built.valid ? chainContributions(built.chain, tiering) : {};
    options[opt.id] = {
      actionType: opt.actionType,
      valid: built.valid,
      invalidReason: built.reason,
      tier: null,
      score: scored.score,
      lowCertaintyPercent: scored.lowCertaintyPercent,
      outcomeChain: built.chain,
      contributions,
      supportedBy: Object.keys(contributions).filter((f) => contributions[f] >= signals.positiveMin).sort(),
      againstBy: Object.keys(contributions).filter((f) => contributions[f] <= -signals.positiveMin).sort(),
      tradeoffs: built.chain
        .filter((c) => c.valence < 0)
        .map((c) => ({ stage: c.stage, outcome: c.outcome, valence: c.valence, certainty: c.certainty, factors: c.attribution.map((a) => a.factor) })),
      failureConditions: built.chain
        .filter((c) => c.failureCondition)
        .map((c) => ({ id: c.failureCondition, stage: c.stage, outcome: c.outcome, because: c.because })),
    };
    entries.push({ id: opt.id, valid: built.valid, score: scored.score, lowCertaintyPercent: scored.lowCertaintyPercent });
  }
  const tiers = assignTiers(entries, tiering);
  for (const id of Object.keys(options)) options[id].tier = tiers[id];
  const exposed = exposedFactors(det.levels);
  const influences = withInfluences ? computeInfluences({ template, ctx, decision, options, exposed, tiering }) : null;
  for (const id of Object.keys(options)) options[id].influences = influences ? influences[id] : {};

  const validIds = Object.keys(options).filter((id) => options[id].valid);
  const ranking = validIds.slice().sort((a, b) => options[b].score - options[a].score || (a < b ? -1 : 1));
  const topRank = validIds.length ? Math.max(...validIds.map((id) => TIER_RANK[options[id].tier])) : 0;
  const best = ranking.filter((id) => TIER_RANK[options[id].tier] === topRank);
  const defensible = ranking.filter((id) => DEFENSIBLE_TIERS.includes(options[id].tier));

  const factorEvidence = {};
  for (const f of FACTOR_IDS) factorEvidence[f] = { level: det.levels[f], exposed: exposed.includes(f), valueClass: FACTORS[f].valueClass, evidence: det.evidence[f] };

  const answerKey = {
    answerKeySchema: VERSIONS.scenarioSchema,
    scenarioRef,
    versions: { templateVersion: versions.templateVersion, generatorVersion: versions.generatorVersion, rulesVersion: versions.rulesVersion, registries: { factors: FACTORS_VERSION, tracks: TRACKS_VERSION, principles: PRINCIPLES_VERSION } },
    factorEvidence,
    // Non-factor state signals. (Fightability is a factor now: see factorEvidence.)
    derivedSignals: {
      infoQuality: { level: derived.infoQuality.level },
    },
    options,
    ranking,
    best,
    defensible,
    analysis: analyzeOptions(options, exposed, signals),
  };
  return { answerKey, detection: det };
}

/** THE AUTHORITATIVE ANSWER-KEY RECOMPUTATION.
 *
 *  The only path that produces a final Answer Key, used for generated,
 *  coach-crafted and fixture scenarios alike and by the validator:
 *
 *    final immutable state (raw)
 *      -> derive state             (relationships.deriveState)
 *      -> derive factor levels     (template detectors)
 *      -> evaluate every available option
 *      -> stage outcomes -> certainty -> scores -> tiers
 *      -> the Answer Key (with each exposed factor's influence)
 *
 *  Its inputs are ONLY the immutable state, the decision, the constants and the
 *  template (rules, registries), plus version labels to stamp. It reads no
 *  planning metadata, no predicted answer, no target tier, no stored derived
 *  state, no fingerprint and no learning objective: the generator's plan is a
 *  construction aid that decides WHICH state gets built, never what the key says. */
export function recomputeAnswerKey({ template, constants, raw, decision, scenarioRef, versions }) {
  const derived = deriveState(raw, constants, template.rules.thresholds);
  return buildAnswerKey({ template, scenarioRef, raw, derived, constants, decision, versions }).answerKey;
}
