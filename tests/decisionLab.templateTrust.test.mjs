// decisionLab -- trusted template registry: scenarios are bound to the exact rule content
// (diff C; contract: TEMPLATE_TRUST_CONTRACT.md, ERROR_CONTRACT_v1_1.md).
//
//   node tests/decisionLab.templateTrust.test.mjs
//
//   [1] the registry: one entry, the canonical template, intact against its PINNED digests;
//   [2] regression: changed rule content under an unchanged version string is never used to
//       grade (or build, or validate) a scenario -- in both directions;
//   [3] which parts count: rules, template data and runtime are bound; approval state is not;
//   [4] custom (unregistered) templates: generated and validated, never evaluated;
//   [5] evaluation resolves its template from the registry when none is supplied.
// Engineering tests only: none of this approves the DRAFT content.

import { generateScenario, assembleScenario } from "../functions/_lib/decisionLab/generator.js";
import { validateScenarioBundle } from "../functions/_lib/decisionLab/validator.js";
import { evaluateAnswer } from "../functions/_lib/decisionLab/evaluator.js";
import { stableStringify } from "../functions/_lib/decisionLab/fingerprint.js";
import { registeredTemplate, templateTrust, registryEntries, rulesContentDigest, templateDataDigest, isRegisteredIntactRules } from "../functions/_lib/decisionLab/templates/registry.js";
import { OBJECTIVE_TRADE_TEMPLATE as T, OBJECTIVE_TRADE_RULES } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { FIXTURE_CONSTANTS as C, copy, createHarness } from "./decisionLab.fixtures.mjs";

const { check, finish } = createHarness();
const g = generateScenario({ seed: 12, constants: C });
const choice = g.scenario.decision.options[0].id;
const evaluate = (template, s = g) => evaluateAnswer({ scenario: s.scenario, answerKey: s.answerKey, answer: { choice: s.scenario.decision.options[0].id }, ...(template === "omit" ? {} : { template }) });
const code = (r) => (r.ok ? "ok" : r.error ? r.error.code : r.violations.map((v) => v.id).join(","));
const deepFrozen = (o) => o === null || typeof o !== "object" || (Object.isFrozen(o) && Object.values(o).every(deepFrozen));

console.log("\n[1] The registry and its pins");
{
  const entries = registryEntries();
  check("exactly one registered template: objective_trade v3 with rules objective_trade.rules.3", entries.length === 1 && entries[0].templateId === "objective_trade" && entries[0].templateVersion === 3 && entries[0].rulesVersion === "objective_trade.rules.3", entries);
  check("the canonical template is intact against its pins (an in-place edit without a version bump would make this fail, and would make every entry point refuse it)", entries[0].broken.length === 0, entries[0]);
  check("the pins are literals equal to the canonical content's digests (rules without status/notice; data without status/rules/runtime)", rulesContentDigest(T.rules) === entries[0].rulesDigest && templateDataDigest(T) === entries[0].dataDigest, { rules: rulesContentDigest(T.rules), data: templateDataDigest(T) });
  check("the registered template is the shipped object, deep-frozen (so identity implies unchanged content)", registeredTemplate({ templateId: "objective_trade", templateVersion: 3, rulesVersion: "objective_trade.rules.3" }) === T && Object.isFrozen(T) && Object.entries(T).every(([k, v]) => k === "runtime" ? Object.isFrozen(v) : deepFrozen(v)) && isRegisteredIntactRules(T.rules));
  check("lookups are by exact labels (type included): version '3' or another rules version is not registered", registeredTemplate({ templateId: "objective_trade", templateVersion: "3", rulesVersion: "objective_trade.rules.3" }) === null && registeredTemplate({ templateId: "objective_trade", templateVersion: 3, rulesVersion: "objective_trade.rules.4" }) === null && registeredTemplate() === null);
  const trust = templateTrust(T);
  check("the shipped template is trusted, and so is a plain spread copy (same objects, no digest needed)", trust.registered && trust.issue === null && templateTrust({ ...T }).issue === null);
  check("templateTrust never throws (null, a primitive, a throwing Proxy)", [null, 5, new Proxy({}, { get() { throw new Error("x"); } })].every((x) => { try { const t = templateTrust(x); return t.registered === false && t.issue.code === "template_unregistered"; } catch { return false; } }));
}

console.log("\n[2] Regression: changed rule content under an unchanged version string is never used silently");
{
  const raised = { ...T, rules: { ...T.rules, signals: { ...T.rules.signals, positiveMin: T.rules.signals.positiveMin + 1 } } };
  check("(setup) the copy keeps every label of the scenario's template and changes only rules.signals.positiveMin", raised.id === g.scenario.provenance.templateId && raised.version === g.scenario.provenance.templateVersion && raised.rules.version === g.scenario.provenance.rulesVersion && raised.rules.signals.positiveMin !== T.rules.signals.positiveMin);
  const ev = evaluate(raised);
  check("direction 1 -- a scenario created under the registered content is NOT graded with the changed thresholds: template_content_mismatch, parts [rules]", ev.ok === false && ev.error.code === "template_content_mismatch" && stableStringify(ev.error.parts) === stableStringify(["rules"]), ev);
  const gen = generateScenario({ seed: 12, constants: C, template: raised });
  const asm = assembleScenario({ template: raised, constants: C, origin: "coach_crafted", raw: g.scenario.state.raw, structure: g.scenario.decision.structure, primary: g.scenario.decision.primaryObjective, alternative: g.scenario.decision.alternativeObjective, actionTypes: g.scenario.decision.options.map((o) => o.actionType), difficulty: g.scenario.difficulty });
  check("direction 2 -- no scenario can be CREATED under the changed content with the registered labels: generateScenario and assembleScenario refuse (template_content_mismatch)", code(gen) === "template_content_mismatch" && code(asm) === "template_content_mismatch" && asm.scenario === null && asm.violations[0].id === "template.content_matches_registry", { gen: code(gen), asm: code(asm) });
  const val = validateScenarioBundle({ scenario: g.scenario, answerKey: g.answerKey, publicScenario: g.publicScenario, template: raised, constants: C, dataInputs: {} });
  check("validation under the changed content is refused too (template.content_matches_registry, checked 0)", val.ok === false && val.checked === 0 && val.violations.length === 1 && val.violations[0].id === "template.content_matches_registry", val.violations);
  // Every kind of rule content, one at a time: a term value, a threshold, a band, a tiering weight, a precondition, a certainty shift.
  const edits = {
    "a term value": (r) => { r.terms.team_access.values.strong += 1; },
    "a derivation threshold": (r) => { r.thresholds.strongMinArrivals += 1; },
    "an outcome band": (r) => { r.actions.CONTEST.objective_fight.bands[0].valence = 1; },
    "a tiering weight": (r) => { r.tiering.stageWeights.objective_fight += 1; },
    "a precondition's documentation": (r) => { r.preconditions.TRADE.describe = "edited"; },
    "a certainty shift": (r) => { r.certaintyShift[0].shift = -2; },
    "a signal threshold": (r) => { r.signals.missedMin += 1; },
  };
  const results = Object.entries(edits).map(([label, edit]) => { const r = copy(OBJECTIVE_TRADE_RULES); edit(r); const t = { ...T, rules: r }; return [label, code(evaluate(t)), code(generateScenario({ seed: 3, constants: C, template: t }))]; });
  check("each kind of same-label rule edit is refused at evaluation and at generation", results.every(([, e, gg]) => e === "template_content_mismatch" && gg === "template_content_mismatch"), results);
  const order = evaluate({ ...raised, rules: { ...raised.rules, terms: null } });
  check("precedence: a malformed table under the registered labels is rules_invalid, not template_content_mismatch (the shape check comes first, at every entry point)", code(order) === "rules_invalid", order);
  const labelsFirst = evaluate({ ...raised, rules: { ...raised.rules, version: "objective_trade.rules.99" } });
  check("precedence: other labels are still template_mismatch (diff B) before any content comparison", code(labelsFirst) === "template_mismatch", labelsFirst);
}

console.log("\n[3] Which parts are bound: rules, template data, runtime; not approval state");
{
  const trustOf = (t) => templateTrust(t).issue;
  const dataEdit = trustOf({ ...T, difficultyRange: { ...T.difficultyRange, max: T.difficultyRange.max + 1 } });
  check("non-rule template data (difficultyRange) is bound: parts [template]", dataEdit && dataEdit.code === "template_content_mismatch" && stableStringify(dataEdit.parts) === stableStringify(["template"]), dataEdit);
  const extraKey = trustOf({ ...T, extra: 1 });
  check("an extra template field is a data change: parts [template]", extraKey && stableStringify(extraKey.parts) === stableStringify(["template"]), extraKey);
  const runtimeEdit = trustOf({ ...T, runtime: { ...T.runtime } });
  check("the runtime must be the registered runtime object (a copy with the same functions is still refused: parts [runtime])", runtimeEdit && stableStringify(runtimeEdit.parts) === stableStringify(["runtime"]), runtimeEdit);
  const lyingCheck = { ...T, runtime: { ...T.runtime, checkRules: () => [] }, rules: { ...T.rules, signals: { ...T.rules.signals, strongMin: 0 } } };
  check("a runtime that lies about its rules cannot launder a content change (parts [runtime, rules]; evaluation refused)", stableStringify(trustOf(lyingCheck).parts) === stableStringify(["runtime", "rules"]) && code(evaluate(lyingCheck)) === "template_content_mismatch");
  const approved = { ...T, status: "approved", rules: { ...T.rules, status: "APPROVED", notice: "approved" } };
  check("approval state (template.status, rules.status, rules.notice) is NOT pinned: an otherwise identical copy is trusted and evaluates identically", trustOf(approved) === null && stableStringify(evaluate(approved)) === stableStringify(evaluate(T)));
  const deepCopy = { ...T, rules: copy(OBJECTIVE_TRADE_RULES) };
  check("a deep copy of the rule table with identical content is trusted (content, not identity, is what is bound)", trustOf(deepCopy) === null && stableStringify(evaluate(deepCopy)) === stableStringify(evaluate(T)));
  const unserializable = { ...T, rules: { ...copy(OBJECTIVE_TRADE_RULES), signals: { ...T.rules.signals, positiveMin: NaN } } };
  check("content that cannot be digested (NaN) is never equal to a pin", code(evaluate(unserializable)) === "rules_invalid" && trustOf(unserializable).code === "template_content_mismatch");
}

console.log("\n[4] Custom (unregistered) templates: an engineering tool, never evaluated");
{
  const custom = { ...T, rules: { ...copy(OBJECTIVE_TRADE_RULES), version: "objective_trade.rules.3+engineering", signals: { ...T.rules.signals, positiveMin: 9 } } };
  const cg = generateScenario({ seed: 12, constants: C, template: custom });
  check("a custom template generates (its rule table is shape-checked like any other)", cg.ok === true && cg.scenario.provenance.rulesVersion === "objective_trade.rules.3+engineering");
  const cv = validateScenarioBundle({ scenario: cg.scenario, answerKey: cg.answerKey, publicScenario: cg.publicScenario, template: custom, constants: C, dataInputs: {} });
  check("and validates (structural validation only)", cv.ok === true, cv.violations);
  check("but its scenarios are never evaluated: template_unregistered, whether the template is supplied or omitted", code(evaluate(custom, cg)) === "template_unregistered" && code(evaluate("omit", cg)) === "template_unregistered");
  check("and a registered scenario cannot be evaluated with it either (template_mismatch: its labels are not the scenario's)", code(evaluate(custom)) === "template_mismatch");
}

console.log("\n[5] Evaluation resolves its template from the registry");
{
  const explicit = evaluate(T), omitted = evaluate("omit");
  check("omitting the template evaluates with the registered one: byte-identical to passing it", explicit.ok && stableStringify(omitted) === stableStringify(explicit));
  check("an explicitly undefined template is the same as an omitted one; a null template is template_mismatch", stableStringify(evaluate(undefined)) === stableStringify(explicit) && code(evaluate(null)) === "template_mismatch");
  const forged = { ...g.scenario, provenance: { ...g.scenario.provenance, rulesVersion: "objective_trade.rules.0" } };
  const fk = { ...g.answerKey, versions: { ...g.answerKey.versions, rulesVersion: "objective_trade.rules.0" } };
  const r = evaluateAnswer({ scenario: forged, answerKey: fk, answer: { choice } });
  check("a scenario whose provenance names labels the registry does not know cannot be evaluated by omission: template_unregistered", code(r) === "template_unregistered", r);
}

finish();
