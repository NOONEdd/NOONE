// decisionLab -- fail-closed serving gate (diff E; contracts: SERVING_GATE_CONTRACT.md,
// SERVING_FRESHNESS_CONTRACT_STAGE7.md). Every check here holds for E alone and for E+F.
//
//   node tests/decisionLab.serving.test.mjs
//
// Engineering tests of the gate's contract. Nothing here approves content:
// the factor and principle registries stay DRAFT, so no scenario can become
// servable. The approval statuses come only from a trusted registry, so the
// checks that sit behind them are reached through a CONTROLLED test registry
// (decisionLab.testRegistry.mjs: an approved copy under the production pins,
// whose gate always adds registry_not_production). The VERIFIED constants are
// a test copy too.

import { generateScenario } from "../functions/_lib/decisionLab/generator.js";
import { isServable } from "../functions/_lib/decisionLab/validator.js";
import { OBJECTIVE_TRADE_TEMPLATE as T, OBJECTIVE_TRADE_RULES } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { FIXTURE_CONSTANTS as C, withConstants, copy, createHarness } from "./decisionLab.fixtures.mjs";
import { APPROVED_COPY, approvingGate, postApprovalBlockers } from "./decisionLab.testRegistry.mjs";

const { check, finish } = createHarness();
const verified = withConstants((c) => { c.status = "VERIFIED"; c.verifiedForPatch = "P1"; c.version = "fixture.verified"; });
const bundleOf = (r) => ({ scenario: r.scenario, answerKey: r.answerKey, publicScenario: r.publicScenario });
const guarded = (f) => (input) => { try { return f(input); } catch (e) { return { threw: `${e.constructor.name}: ${e.message}` }; } };
const gate = guarded(isServable);
const approvedGate = guarded(approvingGate); // approval from the controlled test registry
const has = (g, prefix) => Array.isArray(g.blockers) && g.blockers.some((b) => b === prefix || b.startsWith(`${prefix}:`) || b.startsWith(prefix));

const g = generateScenario({ seed: 11, constants: C });
const gv = generateScenario({ seed: 11, constants: verified });

console.log("\n[1] The existing blockers keep their names and meaning");
{
  const r = gate({ ...bundleOf(g), template: T, constants: C, dataInputs: {} });
  check("a fixture-built scenario is not servable", r.servable === false, r);
  for (const b of ["template_not_approved:draft", "rule_table_not_approved:DRAFT", "constants_not_verified:TEST_FIXTURE"]) check(`blocker ${b}`, r.blockers.includes(b), r.blockers);
  check("principle and factor blockers are present, computed from the trusted re-derivation", has(r, "principle_not_approved") && has(r, "factor_not_approved"), r.blockers);
  check("engine fixtures are never servable (origin_engine_fixture)", gate({ ...bundleOf(g), scenario: { ...g.scenario, origin: "engine_fixture" }, template: T, constants: C, dataInputs: {} }).blockers.includes("origin_engine_fixture"));
  const legacyCall = gate({ scenario: g.scenario, template: T, constants: C });
  check("the old three-argument call still works, never throws, and is blocked for the missing bundle and missing data", legacyCall.servable === false && legacyCall.blockers.includes("bundle_incomplete") && legacyCall.blockers.includes("freshness_unverifiable:data_inputs_missing"), legacyCall);
}

console.log("\n[2] Fail-open paths of the E-1 gate are closed");
{
  // E-1: a retired scenario had no stale blocker when dataInputs was omitted.
  const old = generateScenario({ seed: 11, constants: C, versionOverrides: { generatorVersion: "1.0.0" } });
  check("without dataInputs, freshness cannot be verified: blocked", gate({ ...bundleOf(old), template: T, constants: C }).blockers.includes("freshness_unverifiable:data_inputs_missing"));
  check("with dataInputs, the retired scenario is blocked as stale:retired", gate({ ...bundleOf(old), template: T, constants: C, dataInputs: {} }).blockers.includes("stale:retired"));

  // E-1: a tampered scenario with empty lists had 0 blockers under approved template, rules and VERIFIED constants.
  const tampered = copy(bundleOf(gv));
  tampered.scenario.activeFactors = [];
  tampered.scenario.learningObjective.principles = [];
  const t = approvedGate({ ...tampered, template: APPROVED_COPY, constants: verified, dataInputs: { effectivePatch: "P1" } });
  check("a scenario whose own factor/principle lists were emptied is blocked (metadata mismatch, invalid bundle, and the trusted factors' DRAFT status)", t.servable === false && t.blockers.includes("scenario_metadata_mismatch:activeFactors") && t.blockers.includes("scenario_metadata_mismatch:principles") && has(t, "invalid_bundle") && has(t, "factor_not_approved") && has(t, "principle_not_approved"), t.blockers);

  // E-1: an unknown origin passed, and an unknown principle id threw.
  check("an unknown origin is blocked (origin_not_servable)", gate({ ...bundleOf(g), scenario: { ...g.scenario, origin: "imported" }, template: T, constants: C, dataInputs: {} }).blockers.includes("origin_not_servable:imported"));
  const unknown = copy(bundleOf(g));
  unknown.scenario.learningObjective.principles = ["no_such_principle"];
  const u = gate({ ...unknown, template: T, constants: C, dataInputs: {} });
  check("an unknown principle id is a blocker, not an exception", !u.threw && u.blockers.includes("scenario_metadata_mismatch:principles"), u);
}

console.log("\n[3] What is served must be the scenario's own template and a valid bundle under the current data");
{
  check("another rules version is template_mismatch", gate({ ...bundleOf(g), template: { ...T, rules: { ...T.rules, version: "objective_trade.rules.99" } }, constants: C, dataInputs: {} }).blockers.includes("template_mismatch"));
  check("a missing answer key or public scenario is bundle_incomplete", gate({ scenario: g.scenario, answerKey: g.answerKey, template: T, constants: C, dataInputs: {} }).blockers.includes("bundle_incomplete"));
  const forged = copy(bundleOf(g));
  const id = Object.keys(forged.answerKey.options)[0];
  forged.answerKey.options[id].tier = forged.answerKey.options[id].tier === "STRONG" ? "WEAK" : "STRONG";
  check("a forged answer key fails validation (invalid_bundle)", has(gate({ ...forged, template: T, constants: C, dataInputs: {} }), "invalid_bundle"));
  // Constants values changed under the SAME version label (identity and staleness cannot see it).
  const swapped = withConstants((c) => { const d = c.values.objectives.dragon.zone; c.values.objectives.dragon.zone = c.values.objectives.riftHerald.zone; c.values.objectives.riftHerald.zone = d; });
  const m = gate({ ...bundleOf(g), template: T, constants: swapped, dataInputs: {} });
  check("a constants value change that matters to this scenario blocks serving (re-validation under the current constants)", has(m, "invalid_bundle:state.derived_rebuildable"), m.blockers);
  const near30 = withConstants((c) => { c.values.travelSec.near = 30; });
  const n = gate({ ...bundleOf(g), template: T, constants: near30, dataInputs: {} });
  check("(relevance) a value change that leaves this scenario's derived state and answer key unchanged does not block it", !has(n, "invalid_bundle"), n.blockers);
  const broken = copy(OBJECTIVE_TRADE_RULES);
  delete broken.terms.team_access.values.weak;
  const b = gate({ ...bundleOf(g), template: { ...T, rules: broken }, constants: C, dataInputs: {} });
  check("a malformed rule table is rules_invalid, and the gate does not throw", !b.threw && b.blockers.includes("rules_invalid"), b);
  for (const [label, input] of [["no scenario", { template: T, constants: C, dataInputs: {} }], ["an empty scenario", { scenario: {}, answerKey: {}, publicScenario: {}, template: T, constants: C, dataInputs: {} }], ["no template", { scenario: g.scenario, constants: C, dataInputs: {} }], ["no constants", { ...bundleOf(g), template: T, dataInputs: {} }]]) {
    const r = gate(input);
    check(`${label}: blocked, never thrown`, !r.threw && r.servable === false && r.blockers.length > 0, r);
  }
}

console.log("\n[4] Freshness is mandatory, including the patch for VERIFIED constants");
{
  check("VERIFIED constants with no current patch: freshness_unverifiable:patch_unknown", approvedGate({ ...bundleOf(gv), template: APPROVED_COPY, constants: verified, dataInputs: {} }).blockers.includes("freshness_unverifiable:patch_unknown"));
  check("...and a different current patch is stale:review_required", approvedGate({ ...bundleOf(gv), template: APPROVED_COPY, constants: verified, dataInputs: { effectivePatch: "P2" } }).blockers.includes("stale:review_required"));
  const ready = approvedGate({ ...bundleOf(gv), template: APPROVED_COPY, constants: verified, dataInputs: { effectivePatch: "P1" } });
  const rest = postApprovalBlockers(ready);
  check("with a (test) registry that approves the template and rule table, VERIFIED constants for the current patch and a valid fresh bundle, ONLY the DRAFT factor and principle registries still block (plus registry_not_production)", ready.servable === false && ready.blockers.includes("registry_not_production") && rest.length > 0 && rest.every((x) => x.startsWith("factor_not_approved:") || x.startsWith("principle_not_approved:")), ready.blockers);
  const self = gate({ ...bundleOf(gv), template: APPROVED_COPY, constants: verified, dataInputs: { effectivePatch: "P1" } });
  check("the PRODUCTION gate given the same approved copy still blocks it as draft: approval comes from the registry, not from the copy", self.blockers.includes("template_not_approved:draft") && self.blockers.includes("rule_table_not_approved:DRAFT") && !self.blockers.includes("registry_not_production"), self.blockers);
}

console.log("\n[5] The template must be the registered one, with its registered content (diff C registry)");
{
  const base = gate({ ...bundleOf(g), template: T, constants: C, dataInputs: {} });
  const omitted = gate({ ...bundleOf(g), constants: C, dataInputs: {} });
  check("an omitted template is resolved from the registry: the same blockers as passing the registered template", JSON.stringify(omitted) === JSON.stringify(base), { omitted, base });
  check("a null template is template_missing (as before)", JSON.stringify(gate({ ...bundleOf(g), template: null, constants: C, dataInputs: {} }).blockers) === JSON.stringify(["template_missing"]));
  const same = gate({ ...bundleOf(g), template: { ...T, rules: { ...T.rules, signals: { ...T.rules.signals, positiveMin: T.rules.signals.positiveMin + 1 } } }, constants: C, dataInputs: {} });
  check("same labels, other rule content: template_content_mismatch:rules, and nothing is re-derived or validated against the untrusted content", same.blockers.includes("template_content_mismatch:rules") && same.blockers.includes("scenario_unreadable") && !has(same, "invalid_bundle") && !same.threw, same.blockers);
  const custom = { ...T, rules: { ...T.rules, version: "objective_trade.rules.3+engineering" } };
  const cg = generateScenario({ seed: 11, constants: C, template: custom });
  const cu = gate({ ...bundleOf(cg), template: custom, constants: C, dataInputs: {} });
  const cuOmitted = gate({ ...bundleOf(cg), constants: C, dataInputs: {} });
  check("a custom (unregistered) template's scenario is never servable: template_unregistered, supplied or omitted", cu.blockers.includes("template_unregistered") && JSON.stringify(cuOmitted.blockers) === JSON.stringify(["template_unregistered"]), { cu: cu.blockers, cuOmitted });
  const runtimeCopy = gate({ ...bundleOf(g), template: { ...T, runtime: { ...T.runtime } }, constants: C, dataInputs: {} });
  check("a template with a copied runtime is template_content_mismatch:runtime", runtimeCopy.blockers.includes("template_content_mismatch:runtime"), runtimeCopy.blockers);
}

console.log("\n[6] The gate never throws: malformed and exotic input is a blocker, never an exception");
{
  const boom = new Proxy({}, { get() { throw new Error("getter"); }, ownKeys() { throw new Error("keys"); }, has() { throw new Error("has"); } });
  const cyclic = { ...g.scenario };
  cyclic.self = cyclic;
  const brokenRules = copy(OBJECTIVE_TRADE_RULES);
  brokenRules.actions.CONTEST = null;
  const inputs = [
    ["undefined", undefined], ["null", null], ["a number", 5], ["a string", "x"], ["an array", []], ["an empty object", {}],
    ["a throwing Proxy as the whole input", boom],
    ["scenario null", { ...bundleOf(g), scenario: null, template: T, constants: C, dataInputs: {} }],
    ["scenario {}", { scenario: {}, answerKey: {}, publicScenario: {}, template: T, constants: C, dataInputs: {} }],
    ["scenario a Proxy", { ...bundleOf(g), scenario: boom, template: T, constants: C, dataInputs: {} }],
    ["template a Proxy", { ...bundleOf(g), template: boom, constants: C, dataInputs: {} }],
    ["constants a Proxy", { ...bundleOf(g), template: T, constants: boom, dataInputs: {} }],
    ["dataInputs a Proxy", { ...bundleOf(g), template: T, constants: C, dataInputs: boom }],
    ["answer key a Proxy", { ...bundleOf(g), answerKey: boom, template: T, constants: C, dataInputs: {} }],
    ["a cyclic scenario", { ...bundleOf(g), scenario: cyclic, template: T, constants: C, dataInputs: {} }],
    ["dataInputs a number", { ...bundleOf(g), template: T, constants: C, dataInputs: 5 }],
    ["a malformed rule table (actions.CONTEST = null)", { ...bundleOf(g), template: { ...T, rules: brokenRules }, constants: C, dataInputs: {} }],
    ["rules a Proxy", { ...bundleOf(g), template: { ...T, rules: boom }, constants: C, dataInputs: {} }],
    ["an answer key without options", { ...bundleOf(g), answerKey: { ...g.answerKey, options: undefined }, template: T, constants: C, dataInputs: {} }],
    ["a public scenario with a leaked tier", { ...bundleOf(g), publicScenario: { ...g.publicScenario, tier: "STRONG" }, template: T, constants: C, dataInputs: {} }],
  ];
  const results = inputs.map(([label, input]) => [label, gate(input)]);
  check(`for all ${inputs.length} malformed or exotic inputs the gate returns { servable: false, blockers: [...] } and never throws`, results.every(([, r]) => !r.threw && r.servable === false && Array.isArray(r.blockers) && r.blockers.length > 0), results.filter(([, r]) => r.threw || r.servable !== false));
  const named = Object.fromEntries(results.map(([label, r]) => [label, r.blockers]));
  check("inputs the gate cannot even read are the single blocker gate_check_failed; readable ones get named blockers", JSON.stringify(named["a throwing Proxy as the whole input"]) === JSON.stringify(["gate_check_failed"]) && named["a malformed rule table (actions.CONTEST = null)"].includes("rules_invalid") && named["an answer key without options"].some((b) => b.startsWith("invalid_bundle:")) && named["a public scenario with a leaked tier"].some((b) => b.startsWith("invalid_bundle:")), named);
}

finish();
