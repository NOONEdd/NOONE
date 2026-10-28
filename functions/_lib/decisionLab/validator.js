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

export const LAYERS = Object.freeze(["structure", "state", "decision", "edu", "public"]);

function run(inv, bundle) {
  try {
    return inv.check(bundle);
  } catch (e) {
    return [`internal_error: ${e && e.message ? e.message : String(e)}`];
  }
}

/** bundle = { scenario, answerKey, publicScenario, template, constants, dataInputs }
 *  options.layers restricts which layers run (default: all).
 *  Returns { ok, violations: [{ id, layer, message }], checked }.
 *  If the scenario is not even structurally a scenario, only that is
 *  reported: later invariants would only add noise. */
export function validateScenarioBundle(bundle, options = {}) {
  const layers = options.layers || LAYERS;
  const violations = [];
  let checked = 0;
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
