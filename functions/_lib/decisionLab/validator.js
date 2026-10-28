// decisionLab -- Validator (spec sections 31-32, 43-44, 75).
//
// Mandatory stage between generation and use:
//     Generator -> Validator -> PASS: Scenario | FAIL: regenerate
//
// Four spec layers plus the public-leakage layer, all implemented as the
// invariant registry in invariants.js:
//     structure  -> structural validation
//     state      -> state consistency validation
//     decision   -> decision validity validation
//     edu        -> educational validity validation
//     public     -> what the player receives (no answer-key leakage)
//
// The same validation applies to generated and coach-crafted scenarios; a
// coach-crafted scenario does not bypass data integrity (spec section 44).
//
// isServable() is the draft gate. Validation says "this scenario is
// internally sound"; servability additionally says "the game-truth content it
// was built from has been approved and the data it depends on is current".
// Until the coach approves the template, rule table, principles, factors and
// constants, nothing is servable -- by design, not by omission.

import { INVARIANT_LIST, INVARIANT_IDS } from "./invariants.js";
import { checkStaleness } from "./fingerprint.js";
import { FACTORS } from "./factors.js";
import { PRINCIPLES } from "./principles.js";
import { isRegisteredIntactRules, templateTrust } from "./templates/registry.js";

export const LAYERS = Object.freeze(["structure", "state", "decision", "edu", "public"]);

/** Message of a thrown value, even an exotic one (never throws itself). */
function errorText(e) {
  try {
    return e && e.message ? String(e.message) : String(e);
  } catch {
    return "unprintable error";
  }
}

function run(inv, bundle) {
  try {
    return inv.check(bundle);
  } catch (e) {
    return [`internal_error: ${errorText(e)}`];
  }
}

/** THE rule-table check. Every public operation (generateScenario,
 *  assembleScenario, validateScenarioBundle, evaluateAnswer) runs it before it
 *  reads a template's rule table, so a malformed table is reported
 *  (rules_invalid / template.rules_valid) and never evaluated. The template
 *  supplies the check for its own table (runtime.checkRules). Returns the list
 *  of problems; empty when the table is sound. Never throws: an exception
 *  (an exotic object, a throwing check) is itself reported as an issue. The
 *  registered, deep-frozen canonical table was checked once at load, so it is
 *  not re-checked per call. */
export function templateRuleIssues(template) {
  try {
    if (!template || typeof template !== "object" || !template.runtime || typeof template.runtime.checkRules !== "function") return ["template must provide runtime.checkRules"];
    if (isRegisteredIntactRules(template.rules)) return [];
    const issues = template.runtime.checkRules(template.rules);
    return Array.isArray(issues) ? issues.map(String) : ["template runtime.checkRules must return a list of issues"];
  } catch (e) {
    return [`rule table check failed: ${errorText(e)}`];
  }
}

/** Registered labels whose content differs from the registry's pins
 *  (template_content_mismatch, with parts), or null. Unregistered (custom)
 *  templates pass here: they may be generated and validated, but never
 *  evaluated or served (TEMPLATE_TRUST_CONTRACT.md). Never throws. */
export function templateContentIssue(template) {
  const trust = templateTrust(template);
  return trust.registered && trust.issue ? trust.issue : null;
}

/** bundle = { scenario, answerKey, publicScenario, template, constants, dataInputs }
 *  options.layers restricts which layers run (default: all).
 *  Returns { ok, violations: [{ id, layer, message }], checked }.
 *  Two pre-conditions come first, each reported as a single violation (not
 *  scenario invariants, and not skippable through options.layers): a malformed
 *  rule table (template.rules_valid), then registered labels whose content
 *  differs from the registry's pins (template.content_matches_registry). If
 *  the scenario is not even structurally a scenario, only that is reported:
 *  later invariants would only add noise. Never throws: a non-object bundle is
 *  structure.scenario_shape, and any exception is validator.internal_error. */
export function validateScenarioBundle(bundle, options = {}) {
  let checked = 0;
  try {
    if (!bundle || typeof bundle !== "object") return { ok: false, violations: [{ id: "structure.scenario_shape", layer: "structure", message: "bundle must be an object" }], checked: 0 };
    const ruleIssues = templateRuleIssues(bundle.template);
    if (ruleIssues.length) return { ok: false, violations: [{ id: "template.rules_valid", layer: "template", message: ruleIssues.join("; ") }], checked: 0 };
    const content = templateContentIssue(bundle.template);
    if (content) return { ok: false, violations: [{ id: "template.content_matches_registry", layer: "template", message: `the content differs from the registered pins: ${content.parts.join(", ")}` }], checked: 0 };
    const layers = (options && options.layers) || LAYERS;
    const violations = [];
    const shape = INVARIANT_LIST.find((i) => i.id === "structure.scenario_shape");
    const shapeProblems = run(shape, bundle);
    if (shapeProblems.length) {
      return { ok: false, violations: shapeProblems.map((message) => ({ id: shape.id, layer: shape.layer, message })), checked: 1 };
    }
    for (const inv of INVARIANT_LIST) {
      if (!layers.includes(inv.layer)) continue;
      checked += 1;
      for (const message of run(inv, bundle)) violations.push({ id: inv.id, layer: inv.layer, message });
    }
    return { ok: violations.length === 0, violations, checked };
  } catch (e) {
    return { ok: false, violations: [{ id: "validator.internal_error", layer: "validator", message: errorText(e) }], checked };
  }
}

/** The template declares which invariants it relies on; the registry must
 *  implement exactly those. Returns a list of problems (empty when aligned). */
export function checkInvariantRegistry(template) {
  const declared = new Set(template.invariants);
  const implemented = new Set(INVARIANT_IDS);
  const problems = [];
  for (const id of declared) if (!implemented.has(id)) problems.push(`declared but not implemented: ${id}`);
  for (const id of implemented) if (!declared.has(id)) problems.push(`implemented but not declared: ${id}`);
  return problems;
}

/** Serving gate. Uses the CURRENT statuses of the template / rule table /
 *  principles / factors / constants (a scenario's own snapshot of them is
 *  provenance, not authority). Optionally also checks staleness against the
 *  current data.
 *  Returns { servable, blockers: [...] }. */
export function isServable({ scenario, template, constants, dataInputs }) {
  const blockers = [];
  if (template.status !== "approved") blockers.push(`template_not_approved:${template.status}`);
  if (template.rules.status !== "APPROVED") blockers.push(`rule_table_not_approved:${template.rules.status}`);
  if (constants.status !== "VERIFIED") blockers.push(`constants_not_verified:${constants.status}`);
  if (scenario.origin === "engine_fixture") blockers.push("origin_engine_fixture");
  for (const id of scenario.learningObjective.principles) if (PRINCIPLES[id].status !== "APPROVED") blockers.push(`principle_not_approved:${id}`);
  for (const id of scenario.activeFactors) if (FACTORS[id].status !== "APPROVED") blockers.push(`factor_not_approved:${id}`);
  if (dataInputs !== undefined) {
    const st = checkStaleness(scenario, { constants, dataInputs });
    if (st.status !== "fresh") blockers.push(`stale:${st.status}`);
  }
  return { servable: blockers.length === 0, blockers };
}

export { INVARIANT_IDS };
