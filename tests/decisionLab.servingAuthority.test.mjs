// decisionLab -- approval authority of the serving gate (diff G; contract: TEMPLATE_TRUST_CONTRACT.md 5, 5a).
//
//   node tests/decisionLab.servingAuthority.test.mjs
//
// The template's and rule table's approval statuses that the serving gate uses come ONLY from the trusted
// registry entry, never from a template the caller supplies:
//   [1] a copy that approves itself (status / rules.status / notice) is blocked exactly like the registered template;
//   [2] the registry is the authority in both directions (an approving registry clears the blockers whatever the
//       supplied object says), and unregistered labels are never approved;
//   [3] controlled test registries are separate, branded, frozen, captured at construction, and can never serve;
//   [4] the production registry is unchanged by any of this.
// Engineering checks only: nothing here approves content, and nothing can become servable (DRAFT registries).

import { generateScenario } from "../functions/_lib/decisionLab/generator.js";
import { isServable, createServingGate } from "../functions/_lib/decisionLab/validator.js";
import { TEMPLATE_REGISTRY, createTemplateRegistry, isTemplateRegistry, registryEntries, registeredApproval, rulesContentDigest, templateDataDigest } from "../functions/_lib/decisionLab/templates/registry.js";
import { OBJECTIVE_TRADE_TEMPLATE as T } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { stableStringify } from "../functions/_lib/decisionLab/fingerprint.js";
import { FIXTURE_CONSTANTS as C, withConstants, createHarness } from "./decisionLab.fixtures.mjs";
import { APPROVED_COPY, APPROVING_REGISTRY, approvingGate, postApprovalBlockers } from "./decisionLab.testRegistry.mjs";

const { check, finish } = createHarness();
const verified = withConstants((c) => { c.status = "VERIFIED"; c.verifiedForPatch = "P1"; c.version = "fixture.verified"; });
const now = { effectivePatch: "P1" };
const gv = generateScenario({ seed: 11, constants: verified });
const bundle = { scenario: gv.scenario, answerKey: gv.answerKey, publicScenario: gv.publicScenario };
const input = (template, extra = {}) => ({ ...bundle, template, constants: verified, dataInputs: now, ...extra });
const same = (a, b) => stableStringify(a) === stableStringify(b);
const throwsType = (f) => { try { f(); return false; } catch (e) { return e instanceof TypeError; } };

console.log("\n[1] A caller-supplied copy cannot authorize itself by changing only its approval statuses");
{
  const base = isServable(input(T));
  check("(setup) the registered template under VERIFIED constants and current data: blocked as draft, with no trust or bundle problem", base.blockers.includes("template_not_approved:draft") && base.blockers.includes("rule_table_not_approved:DRAFT") && !base.blockers.some((b) => b.startsWith("template_content_mismatch") || b.startsWith("invalid_bundle") || b === "template_unregistered"), base.blockers);
  const variants = [
    ["status approved", { ...T, status: "approved" }],
    ["rules.status APPROVED", { ...T, rules: { ...T.rules, status: "APPROVED" } }],
    ["status approved AND rules.status APPROVED (the regression case)", { ...T, status: "approved", rules: { ...T.rules, status: "APPROVED" } }],
    ["both, plus an approval notice", { ...T, status: "approved", rules: { ...T.rules, status: "APPROVED", notice: "approved by coach" } }],
    ["the deep-frozen approved copy the test registry uses", APPROVED_COPY],
  ];
  for (const [label, copy] of variants) {
    const r = isServable(input(copy));
    check(`${label}: still template_not_approved:draft and rule_table_not_approved:DRAFT, and EXACTLY the registered template's verdict`, r.servable === false && r.blockers.includes("template_not_approved:draft") && r.blockers.includes("rule_table_not_approved:DRAFT") && same(r, base), r.blockers);
  }
  const omitted = isServable({ ...bundle, constants: verified, dataInputs: now });
  check("an omitted template (resolved from the registry) gets the same verdict", same(omitted, base), omitted.blockers);
  const snapshot = { ...gv.scenario, template: { ...gv.scenario.template, status: "approved", rulesStatus: "APPROVED" } };
  const s = isServable({ ...input(T), scenario: snapshot });
  check("a scenario whose own template snapshot claims approval is still blocked as draft (the snapshot is provenance, not authority)", s.blockers.includes("template_not_approved:draft") && s.blockers.includes("rule_table_not_approved:DRAFT"), s.blockers);
  check("the copy's statuses are not even partly used: no blocker names 'approved' or 'APPROVED' as a status", variants.every(([, copy]) => isServable(input(copy)).blockers.every((b) => !/not_approved:(approved|APPROVED)$/.test(b))));
}

console.log("\n[2] The registry entry is the authority, in both directions; unregistered labels are never approved");
{
  const r = approvingGate(input(T));
  check("a gate whose registry approves the template clears both approval blockers even for the DRAFT object itself", !r.blockers.some((b) => b.startsWith("template_not_approved") || b.startsWith("rule_table_not_approved")), r.blockers);
  const viaCopy = approvingGate(input(APPROVED_COPY));
  const viaOmitted = approvingGate({ ...bundle, constants: verified, dataInputs: now });
  check("...and gives the same verdict for the approved copy and for an omitted template (resolved from THAT registry)", same(viaCopy, r) && same(viaOmitted, r), { viaCopy: viaCopy.blockers, viaOmitted: viaOmitted.blockers });
  const demoted = approvingGate(input({ ...APPROVED_COPY, status: "draft", rules: { ...APPROVED_COPY.rules, status: "DRAFT" } }));
  check("a copy that says draft under an approving registry is still judged approved: the object's fields are not read at all", same(demoted, r), demoted.blockers);
  const custom = { ...APPROVED_COPY, rules: { ...APPROVED_COPY.rules, version: "objective_trade.rules.3+engineering" } };
  const cg = generateScenario({ seed: 11, constants: verified, template: custom });
  const cu = isServable({ scenario: cg.scenario, answerKey: cg.answerKey, publicScenario: cg.publicScenario, template: custom, constants: verified, dataInputs: now });
  check("unregistered (custom) labels with self-approved statuses: template_unregistered, template_not_approved:unregistered, rule_table_not_approved:unregistered", cu.blockers.includes("template_unregistered") && cu.blockers.includes("template_not_approved:unregistered") && cu.blockers.includes("rule_table_not_approved:unregistered"), cu.blockers);
  check("registeredApproval: the entry's statuses for registered labels (whatever the object says), null otherwise; never throws", same(registeredApproval(APPROVED_COPY), { template: "draft", rules: "DRAFT" }) && registeredApproval(custom) === null && [undefined, null, 5, new Proxy({}, { get() { throw new Error("x"); } })].every((x) => registeredApproval(x) === null));
}

console.log("\n[3] Controlled test registries: separate, branded, captured at construction, never servable");
{
  const r = approvingGate(input(APPROVED_COPY));
  const rest = postApprovalBlockers(r);
  check("every verdict of a non-production gate carries registry_not_production, so it is never servable", r.servable === false && r.blockers.includes("registry_not_production") && rest.length > 0 && rest.every((b) => b.startsWith("factor_not_approved:") || b.startsWith("principle_not_approved:")), r.blockers);
  check("the production gate never reports registry_not_production", !isServable(input(T)).blockers.includes("registry_not_production"));
  const forged = { name: "forged", registeredTemplate: () => APPROVED_COPY, isRegisteredIntactRules: () => true, templateTrust: () => ({ registered: true, issue: null }), registeredApproval: () => ({ template: "approved", rules: "APPROVED" }), registryEntries: () => [] };
  check("createServingGate refuses anything not built by the registry module (a forged lookalike, a spread copy of the production registry, null)", throwsType(() => createServingGate(forged)) && throwsType(() => createServingGate({ ...TEMPLATE_REGISTRY })) && throwsType(() => createServingGate(null)) && !isTemplateRegistry(forged) && isTemplateRegistry(TEMPLATE_REGISTRY) && isTemplateRegistry(APPROVING_REGISTRY));
  check("createTemplateRegistry needs its own name: missing, empty or \"production\" is refused", throwsType(() => createTemplateRegistry([])) && throwsType(() => createTemplateRegistry([], { name: "" })) && throwsType(() => createTemplateRegistry([], { name: "production" })) && throwsType(() => createTemplateRegistry(null, { name: "x" })));
  check("registries and their entries are frozen", Object.isFrozen(TEMPLATE_REGISTRY) && Object.isFrozen(APPROVING_REGISTRY) && Object.isFrozen(registeredApproval(T)) && Object.isFrozen(APPROVING_REGISTRY.registeredApproval(T)));
  const mutable = { ...T, status: "approved", rules: { ...T.rules, status: "APPROVED" } };
  const pin = { template: mutable, templateId: T.id, templateVersion: T.version, rulesVersion: T.rules.version, rulesDigest: rulesContentDigest(T.rules), dataDigest: templateDataDigest(T) };
  const captured = createTemplateRegistry([pin], { name: "test:captured" });
  mutable.status = "draft";
  mutable.rules.status = "DRAFT";
  check("approval is captured when the registry is built: changing the object afterwards changes nothing", same(captured.registeredApproval(T), { template: "approved", rules: "APPROVED" }));
  const other = { ...APPROVED_COPY, rules: { ...APPROVED_COPY.rules, signals: { ...APPROVED_COPY.rules.signals, positiveMin: APPROVED_COPY.rules.signals.positiveMin + 1 } } };
  const wrongPins = createTemplateRegistry([{ ...pin, template: other }], { name: "test:wrong-pins" });
  const w = createServingGate(wrongPins)(input(other));
  check("a test registry whose approved copy does not match its pins is broken like a production entry: template_content_mismatch", w.blockers.includes("template_content_mismatch:rules") && w.blockers.includes("registry_not_production") && w.servable === false, w.blockers);
  const customT = Object.freeze({ ...APPROVED_COPY, rules: Object.freeze({ ...APPROVED_COPY.rules, version: "objective_trade.rules.3+engineering" }) });
  const customReg = createTemplateRegistry([{ template: customT, templateId: customT.id, templateVersion: customT.version, rulesVersion: customT.rules.version, rulesDigest: rulesContentDigest(customT.rules), dataDigest: templateDataDigest(customT) }], { name: "test:custom-labels" });
  const cg = generateScenario({ seed: 11, constants: verified, template: customT });
  const omittedInput = { scenario: cg.scenario, answerKey: cg.answerKey, publicScenario: cg.publicScenario, constants: verified, dataInputs: now };
  const own = createServingGate(customReg)(omittedInput);
  check("a gate resolves an omitted template from ITS OWN registry (labels production does not know), and still reports registry_not_production; production refuses the same scenario as template_unregistered", !own.blockers.includes("template_unregistered") && !own.blockers.some((b) => b.startsWith("template_not_approved")) && own.blockers.includes("registry_not_production") && same(isServable(omittedInput).blockers, ["template_unregistered"]), own.blockers);
  const exotic = [undefined, null, 7, "x", new Proxy({}, { get() { throw new Error("getter"); } })];
  check("a test-registry gate never throws either", exotic.every((x) => { try { const v = approvingGate(x); return v.servable === false && v.blockers.length > 0; } catch { return false; } }));
}

console.log("\n[4] The production registry is unchanged");
{
  const [entry] = registryEntries();
  check("the production entry's approval is the canonical template's own statuses (draft / DRAFT)", same(entry.approval, { template: T.status, rules: T.rules.status }) && T.status === "draft" && T.rules.status === "DRAFT", entry.approval);
  check("its pins are the literal pins, and it is not broken", entry.rulesDigest === "642835aed280b6f7" && entry.dataDigest === "c30cc4eff657b232" && entry.broken.length === 0, entry);
  check("the production registry still resolves the registered labels to the canonical object, not to a test copy", TEMPLATE_REGISTRY.registeredTemplate({ templateId: T.id, templateVersion: T.version, rulesVersion: T.rules.version }) === T && APPROVING_REGISTRY.registeredTemplate({ templateId: T.id, templateVersion: T.version, rulesVersion: T.rules.version }) === APPROVED_COPY);
  check("TEMPLATE_REGISTRY is named production, and the module functions read it", TEMPLATE_REGISTRY.name === "production" && registeredApproval === TEMPLATE_REGISTRY.registeredApproval && registryEntries === TEMPLATE_REGISTRY.registryEntries);
}

finish();
