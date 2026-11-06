// decisionLab -- Outcome construction (spec sections 24-25).
//
// Turns one action + one state into a SHORT outcome chain (not a game
// simulation):
//
//     Decision -> Objective/Fight -> Turret/Wave/Gold -> Tempo/Map Access
//
// Each link has a qualitative valence (-2..+2) and a qualitative certainty
// (guaranteed/high/medium/low). There are no probabilities anywhere.
//
// The chain is built by executing the template's DATA rule table
// (templates/objectiveTrade.js): per stage, sum the named terms, take the
// first band the sum reaches. This module is generic -- it contains no game
// judgment of its own.
//
// ATTRIBUTION (spec section 25): an outcome may be linked to several factors.
// Weights are integers (0-100) derived from how much each term pushed the
// outcome in the direction it went, so "why did this happen" is explainable
// from the state. Terms that belong to no registry factor (e.g. the derived
// fightability signal) and unattributed remainders are simply not assigned
// to any factor -- weights may sum to less than 100. The "carry" term lets a
// later stage inherit, proportionally, the attribution of an earlier one.
//
// Term mods (data in the rule table): { max: N } caps the term's value
// BEFORE { sign: -1 } negates it.

import { STAGES, CERTAINTY, DecisionLabError } from "./config.js";
import { FACTORS } from "./factors.js";

/** CERTAINTY is ordered guaranteed -> low. A negative delta LOWERS certainty. */
function shiftCertainty(certainty, delta) {
  const i = CERTAINTY.indexOf(certainty);
  return CERTAINTY[Math.max(0, Math.min(CERTAINTY.length - 1, i - delta))];
}

function attribute(entries, valence, chainSoFar) {
  if (valence === 0) return []; // an even outcome is not evidence for or against any factor
  const dir = Math.sign(valence);
  const mass = {};
  let total = 0;
  for (const e of entries) {
    const aligned = Math.max(0, e.value * dir);
    if (aligned === 0) continue;
    total += aligned * 100;
    if (e.term === "carry") {
      const prev = chainSoFar.find((c) => c.stage === e.carryFrom);
      for (const a of prev ? prev.attribution : []) mass[a.factor] = (mass[a.factor] || 0) + aligned * a.weight;
    } else if (e.factor) {
      mass[e.factor] = (mass[e.factor] || 0) + aligned * 100;
    }
  }
  if (total === 0) return [];
  return Object.keys(mass)
    .map((factor) => ({ factor, weight: Math.floor((100 * mass[factor]) / total) }))
    .filter((a) => a.weight > 0)
    .sort((a, b) => b.weight - a.weight || (a.factor < b.factor ? -1 : 1));
}

function unique(list) {
  return Array.from(new Set(list));
}

/** Does a certaintyShift rule's `when` hold in this context? Conditions are
 *  read from the state: `infoQuality` (derived) and `factorLevel` (detected
 *  factor levels). All listed conditions must hold. */
function whenMatches(when, ctx) {
  if (when.infoQuality !== undefined && ctx.derived.infoQuality.level !== when.infoQuality) return false;
  if (when.factorLevel !== undefined) for (const f of Object.keys(when.factorLevel)) if (ctx.levels[f] !== when.factorLevel[f]) return false;
  return true;
}

/** State paths that justify an applied shift. */
function whenEvidence(when, ctx) {
  const out = [];
  if (when.infoQuality !== undefined) out.push("state.derived.infoQuality");
  if (when.factorLevel !== undefined) for (const f of Object.keys(when.factorLevel)) out.push(...ctx.evidence[f]);
  return out;
}

/** Build the outcome chain for one action.
 *  ctx = { raw, derived, constants, primary, alternative, levels, evidence }
 *  Returns { valid, reason, chain }. An action whose precondition fails is
 *  not "bad" -- it is unavailable, and the caller tiers it INVALID. */
export function buildOptionChain(template, actionType, ctx, opts = {}) {
  const rules = template.rules;
  const pre = template.runtime.preconditionOf(actionType, ctx, rules);
  if (!pre.ok) return { valid: false, reason: pre.reason, chain: [] };

  // Counterfactual (used to measure a factor's INFLUENCE, see scoring.js):
  // with opts.neutralFactor set, every TERM that reads that factor is evaluated
  // at the factor's neutral level. Certainty shifts still read the actual
  // state: uncertainty is not a push on the outcome, so it is not ablated.
  const termCtx = opts.neutralFactor ? { ...ctx, levels: { ...ctx.levels, [opts.neutralFactor]: FACTORS[opts.neutralFactor].neutral } } : ctx;

  const chain = [];
  // Last-resort guards (public operations check the table first, see validator.js templateRuleIssues):
  // a malformed table must stop here, never fall through to an outcome band.
  const malformed = (what) => new DecisionLabError("rules_invalid", `${actionType}: ${what}`);
  for (const stage of STAGES) {
    const spec = rules.actions[actionType] && rules.actions[actionType][stage];
    if (!spec) throw malformed(`no rule for stage ${stage}`);
    const entries = [];
    let sum = 0;
    for (const t of spec.terms) {
      if (t.carry) {
        const prev = chain.find((c) => c.stage === t.carry);
        const value = prev ? Math.max(-1, Math.min(1, prev.valence)) : 0;
        entries.push({ term: "carry", carryFrom: t.carry, factor: null, value, evidence: prev ? prev.because : [] }); // a carried effect is explained by the earlier outcome's evidence
        sum += value;
        continue;
      }
      let value = template.runtime.termValue(t.term, termCtx, rules);
      if (t.max !== undefined) value = Math.min(value, t.max);
      if (t.sign === -1) value = 0 - value; // (0 - v, never -v: negating 0 would leave a negative zero in the audit data)
      if (!Number.isInteger(value)) throw malformed(`${stage} term ${t.term} has no integer value (${value})`);
      entries.push({ term: t.term, factor: rules.terms[t.term].factor, value, evidence: template.runtime.termEvidence(t.term, ctx, rules) });
      sum += value;
    }

    const band = spec.bands.find((b) => b.min === null || sum >= b.min);
    if (!band || !CERTAINTY.includes(band.certainty)) throw malformed(`${stage} has no band with a qualitative certainty for sum ${sum}`);
    let certainty = band.certainty;
    const shiftEvidence = [];
    for (const rule of rules.certaintyShift) {
      if (rule.stage === stage && rule.actions.includes(actionType) && whenMatches(rule.when, ctx)) {
        certainty = shiftCertainty(certainty, rule.shift);
        shiftEvidence.push(...whenEvidence(rule.when, ctx));
      }
    }

    const because = unique([...entries.filter((e) => e.value !== 0).flatMap((e) => e.evidence), ...shiftEvidence]);
    chain.push({
      stage,
      outcome: band.outcome,
      valence: band.valence,
      certainty,
      sum,
      terms: entries.map((e) => ({ term: e.term, factor: e.factor, value: e.value })),
      attribution: attribute(entries, band.valence, chain),
      because,
      failureCondition: band.failure || null,
    });
  }
  return { valid: true, reason: null, chain };
}
