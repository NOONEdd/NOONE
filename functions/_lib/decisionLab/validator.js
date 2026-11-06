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
import { checkStaleness, materialSignature, stableStringify } from "./fingerprint.js";
import { STALENESS } from "./config.js";
import { FACTORS, FACTOR_IDS } from "./factors.js";
import { PRINCIPLES } from "./principles.js";
import { recomputeAnswerKey } from "./scoring.js";
import { isRegisteredIntactRules, templateTrust, registeredTemplate, TEMPLATE_REGISTRY, isTemplateRegistry } from "./templates/registry.js";

export const LAYERS = Object.freeze(["structure", "state", "decision", "edu", "public"]);

/** Message of a thrown value, even an exotic one (never throws itself). */
export function errorText(e) {
  try {
    return e && e.message ? String(e.message) : String(e);
  } catch {
    return "unprintable error";
  }
}

/** True when a public operation's request argument is a non-null, non-array
 *  object (request_invalid otherwise; ERROR_CONTRACT_v1_1.md 5). Never throws:
 *  a revoked Proxy is not a request. */
export function isRequestObject(x) {
  try {
    return x !== null && typeof x === "object" && !Array.isArray(x);
  } catch {
    return false;
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

/** The template judged against: the supplied one, or -- when it is omitted
 *  (undefined) -- the trusted registry's template for the scenario's
 *  provenance (null when there is none). */
function currentTemplate(scenario, supplied, lookup = registeredTemplate) {
  if (supplied !== undefined) return supplied;
  const p = scenario && scenario.provenance;
  return p ? lookup({ templateId: p.templateId, templateVersion: p.templateVersion, rulesVersion: p.rulesVersion }) : null;
}

/** Freshness of a stored bundle against the CURRENT data, including the
 *  constants' VALUES. checkStaleness (fingerprint.js) compares versions and
 *  dependency identities only, so a value edit made without a version bump is
 *  invisible to it. This also re-validates the bundle under the current
 *  template and constants and re-derives its material signature: a change that
 *  matters to THIS scenario (its derived state, its answer key, a
 *  constants-dependent invariant, its material timing bucket) makes it
 *  review_required; a change that does not leaves it fresh. Scenario identity
 *  (scenarioRef, dataFingerprint) and stored documents are untouched.
 *  bundle = { scenario, answerKey, publicScenario }; current = { template?, constants, dataInputs }
 *  (an omitted template is resolved from the registry).
 *  Returns { status, reasons } as checkStaleness does. Never throws: any
 *  exception (an exotic or malformed input) is review_required with the single
 *  reason freshness_check_failed. The serving gate owns no validation of its
 *  own: it calls this once (SERVING_FRESHNESS_CONTRACT_STAGE7.md 4). */
export function checkFreshness(bundle, current) {
  try {
    return freshnessVerdict(bundle, current);
  } catch {
    return { status: STALENESS[1], reasons: ["freshness_check_failed"] };
  }
}

function freshnessVerdict({ scenario, answerKey, publicScenario }, { template: supplied, constants, dataInputs }) {
  let base;
  try {
    base = checkStaleness(scenario, { constants, dataInputs });
  } catch {
    return { status: STALENESS[1], reasons: ["staleness_check_failed"] };
  }
  if (base.status === STALENESS[2]) return base;
  const reasons = base.reasons.slice();
  const template = currentTemplate(scenario, supplied);
  const v = validateScenarioBundle({ scenario, answerKey, publicScenario, template, constants, dataInputs: dataInputs || {} });
  for (const id of new Set(v.violations.map((x) => x.id))) reasons.push(`revalidation_failed:${id}`);
  try {
    if (stableStringify(materialSignature({ scenario, answerKey, constants })) !== stableStringify(scenario.fingerprints.material.signature)) reasons.push("material_signature_changed");
  } catch {
    reasons.push("material_signature_unverifiable");
  }
  return { status: reasons.length ? STALENESS[1] : STALENESS[0], reasons };
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

/** Origins that may be served once everything else is approved. */
const SERVABLE_ORIGINS = Object.freeze(["generated", "coach_crafted"]);

const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

/** A serving gate bound to one template registry (the production gate is
 *  isServable, below). A gate bound to any other registry -- a controlled test
 *  registry -- always adds registry_not_production, so it can never serve
 *  (TEMPLATE_TRUST_CONTRACT.md 5a). Throws TypeError at construction for
 *  anything that is not a registry built by templates/registry.js. */
export function createServingGate(registry) {
  if (!isTemplateRegistry(registry)) throw new TypeError("createServingGate needs a registry built by templates/registry.js");
  return function isServable(input) {
    try {
      return servingVerdict(input, registry);
    } catch {
      return { servable: false, blockers: ["gate_check_failed"] };
    }
  };
}

/** Serving gate, fail-closed.
 *  input = { scenario, answerKey, publicScenario, template?, constants, dataInputs }
 *  Returns { servable, blockers: [...] }; servable only when nothing blocks.
 *  Every check that cannot be completed is a blocker, and it never throws: any
 *  exception (an exotic or malformed input) is the single blocker
 *  gate_check_failed. The template must be registered with intact content
 *  (template_unregistered / template_content_mismatch:<parts>); omitted, it is
 *  resolved from the registry. The template and rule-table approval statuses
 *  come ONLY from the trusted registry entry for the template's labels, never
 *  from the supplied template or the scenario's snapshot (unregistered labels:
 *  template_not_approved:unregistered). The constants status comes from the
 *  CURRENT constants, and factor and principle statuses from the server-side
 *  registries. The scenario's own factor and principle lists are compared with
 *  a re-derivation from its state, never trusted. The bundle must validate
 *  under the current template, constants and data, and freshness is always
 *  checked: dataInputs is required. */
export const isServable = createServingGate(TEMPLATE_REGISTRY);

function servingVerdict({ scenario, answerKey, publicScenario, template: supplied, constants, dataInputs }, registry) {
  const template = currentTemplate(scenario, supplied, registry.registeredTemplate);
  if (supplied === undefined && !template) return { servable: false, blockers: ["template_unregistered"] };
  if (!template || !template.rules) return { servable: false, blockers: ["template_missing"] };
  const blockers = [];
  if (registry !== TEMPLATE_REGISTRY) blockers.push("registry_not_production");
  const rulesOk = templateRuleIssues(template).length === 0;
  if (!rulesOk) blockers.push("rules_invalid");
  const trust = rulesOk ? registry.templateTrust(template) : { issue: null };
  if (trust.issue) blockers.push(trust.issue.code === "template_content_mismatch" ? `template_content_mismatch:${trust.issue.parts.join(",")}` : trust.issue.code);
  const usable = rulesOk && !trust.issue; // never re-derive or validate against content the engine does not trust
  // Approval: only the registry entry's statuses. The supplied object's status fields are never read.
  const approval = registry.registeredApproval(template);
  if (!approval || approval.template !== "approved") blockers.push(`template_not_approved:${approval ? approval.template : "unregistered"}`);
  if (!approval || approval.rules !== "APPROVED") blockers.push(`rule_table_not_approved:${approval ? approval.rules : "unregistered"}`);
  if (!constants || constants.status !== "VERIFIED") blockers.push(`constants_not_verified:${constants ? constants.status : "missing"}`);
  const p = scenario && scenario.provenance;
  if (!p || template.id !== p.templateId || template.version !== p.templateVersion || template.rules.version !== p.rulesVersion) blockers.push("template_mismatch");
  const origin = scenario && scenario.origin;
  if (origin === "engine_fixture") blockers.push("origin_engine_fixture");
  else if (!SERVABLE_ORIGINS.includes(origin)) blockers.push(`origin_not_servable:${origin}`);

  // Trusted factors and principles: the exposed factors of a recomputed answer key and their
  // principles from the registry (the generator's own learning-objective derivation).
  let trusted = null;
  if (usable && constants) {
    try {
      const versions = { templateVersion: p.templateVersion, generatorVersion: p.generatorVersion, rulesVersion: p.rulesVersion };
      const key = recomputeAnswerKey({ template, constants, raw: scenario.state.raw, decision: scenario.decision, scenarioRef: scenario.scenarioRef, versions });
      const factors = FACTOR_IDS.filter((f) => key.factorEvidence[f].exposed);
      trusted = { factors, principles: Array.from(new Set(factors.flatMap((f) => FACTORS[f].principles))).sort() };
    } catch {
      trusted = null;
    }
  }
  if (!trusted) blockers.push("scenario_unreadable");
  else {
    if (!sameList(scenario.activeFactors, trusted.factors)) blockers.push("scenario_metadata_mismatch:activeFactors");
    if (!sameList(scenario.learningObjective && scenario.learningObjective.principles, trusted.principles)) blockers.push("scenario_metadata_mismatch:principles");
    for (const id of trusted.principles) if (PRINCIPLES[id].status !== "APPROVED") blockers.push(`principle_not_approved:${id}`);
    for (const id of trusted.factors) if (FACTORS[id].status !== "APPROVED") blockers.push(`factor_not_approved:${id}`);
  }

  // Freshness is mandatory, and validity under the current data is part of it: checkFreshness owns
  // staleness, re-validation (every invariant, once) and the material signature. Without the full
  // bundle only identity staleness can be checked, and bundle_incomplete already blocks.
  const complete = Boolean(answerKey && publicScenario);
  if (!complete) blockers.push("bundle_incomplete");
  if (dataInputs === undefined || dataInputs === null) blockers.push("freshness_unverifiable:data_inputs_missing");
  else {
    if (complete && usable) {
      const f = checkFreshness({ scenario, answerKey, publicScenario }, { template, constants, dataInputs });
      if (f.status !== "fresh") blockers.push(`stale:${f.status}`);
      for (const r of f.reasons) blockers.push(r.startsWith("revalidation_failed:") ? `invalid_bundle:${r.slice("revalidation_failed:".length)}` : `freshness:${r}`);
    } else {
      try {
        const st = checkStaleness(scenario, { constants, dataInputs });
        if (st.status !== "fresh") blockers.push(`stale:${st.status}`);
      } catch {
        blockers.push("freshness_unverifiable:staleness_check_failed");
      }
    }
    if (constants && constants.status === "VERIFIED" && typeof dataInputs.effectivePatch !== "string") blockers.push("freshness_unverifiable:patch_unknown");
  }
  return { servable: blockers.length === 0, blockers };
}

export { INVARIANT_IDS };
