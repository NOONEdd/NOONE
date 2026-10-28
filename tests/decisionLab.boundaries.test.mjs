// decisionLab -- the public operations' input boundaries (diff H; contract: ERROR_CONTRACT_v1_1.md 5).
//
//   node tests/decisionLab.boundaries.test.mjs
//
// Regression coverage for the input classes Stage 7 left unsupported (U1-U5):
//   [1] U1  a request that is not an object: request_invalid at generate, assemble and evaluate;
//   [2] U2  exotic objects (throwing Proxies and getters, revoked Proxies, cycles, deep nesting) at every input
//           position: a structured result, never an exception;
//   [3] U3  malformed STORED documents in evaluateAnswer: every field it reads, removed or mistyped, is
//           bundle_invalid (or an earlier documented code), and a deep sweep of both documents never throws;
//   [4] U4  malformed HAND-CRAFTED assembly input: every raw-state path and every decision field, removed,
//           mistyped or illegal, is refused (assembly_input_invalid or validation violations), never thrown,
//           and well-formed input is assembled exactly as before;
//   [5] U5  malformed non-rule data of an unregistered custom template: never thrown;
//   [6] the guarantee: every public operation returned for every input above.
// Engineering checks only: nothing here says the DRAFT rules are correct Wild Rift coaching.

import { generateScenario, assembleScenario } from "../functions/_lib/decisionLab/generator.js";
import { evaluateAnswer } from "../functions/_lib/decisionLab/evaluator.js";
import { validateScenarioBundle, isServable, checkFreshness, templateRuleIssues } from "../functions/_lib/decisionLab/validator.js";
import { ERROR_CODES, TIER_RANK } from "../functions/_lib/decisionLab/config.js";
import { stableStringify } from "../functions/_lib/decisionLab/fingerprint.js";
import { OBJECTIVE_TRADE_TEMPLATE as T } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { FIXTURE_CONSTANTS as C, copy, createHarness } from "./decisionLab.fixtures.mjs";

const { check, finish } = createHarness();
const g = generateScenario({ seed: 12, constants: C });
const choice = { choice: g.scenario.decision.options[0].id };
const asmInput = (patch = {}) => ({ template: T, constants: C, origin: "coach_crafted", raw: g.scenario.state.raw, structure: g.scenario.decision.structure, primary: g.scenario.decision.primaryObjective, alternative: g.scenario.decision.alternativeObjective, actionTypes: g.scenario.decision.options.map((o) => o.actionType), difficulty: g.scenario.difficulty, ...patch });
const evalInput = (patch = {}) => ({ scenario: g.scenario, answerKey: g.answerKey, answer: choice, template: T, ...patch });

// Every call goes through `call`, which records whether it threw. [6] asserts on all of them.
const calls = [];
const call = (op, label, f) => {
  let r;
  try {
    r = f();
  } catch (e) {
    r = { threw: `${e && e.constructor ? e.constructor.name : typeof e}: ${e && e.message}` };
  }
  calls.push({ op, label, r });
  return r;
};
const codeOf = (r) => (r.threw ? `threw ${r.threw}` : r.ok ? "ok" : r.error ? r.error.code : r.violations ? `violations:${[...new Set(r.violations.map((v) => v.id))].join(",")}` : "?");
const structured = (r) => !r.threw && typeof r.ok === "boolean" && (r.ok || (r.error ? r.error.code in ERROR_CODES : Array.isArray(r.violations) && r.violations.length > 0));
const throwing = () => new Proxy({}, { get() { throw new Error("getter"); }, ownKeys() { throw new Error("keys"); }, has() { throw new Error("has"); }, getOwnPropertyDescriptor() { throw new Error("descriptor"); } });
const revoked = () => { const r = Proxy.revocable({}, {}); r.revoke(); return r.proxy; };
const cyclic = () => { const o = { a: 1 }; o.self = o; return o; };
const deep = () => { let o = {}; const root = o; for (let i = 0; i < 100000; i++) { o.next = {}; o = o.next; } return root; };
const exotics = [["a throwing Proxy", throwing], ["a revoked Proxy", revoked], ["a cyclic object", cyclic], ["a 100000-deep object", deep], ["an object with a throwing getter", () => ({ get x() { throw new Error("getter"); } })]];

console.log("\n[1] U1: a request that is not an object is request_invalid at every operation");
{
  const kinds = [["undefined", undefined], ["null", null], ["0", 0], ["5", 5], ["NaN", NaN], ["''", ""], ["'x'", "x"], ["true", true], ["a symbol", Symbol("s")], ["a bigint", 5n], ["an array", []], ["a function", () => ({})], ["a revoked Proxy", revoked()]];
  for (const [op, f] of [["generateScenario", generateScenario], ["assembleScenario", assembleScenario], ["evaluateAnswer", evaluateAnswer]]) {
    const rs = kinds.map(([label, x]) => [label, call(op, `request ${label}`, () => f(x))]);
    check(`${op}: all ${kinds.length} non-object requests are request_invalid { detail }`, rs.every(([, r]) => !r.ok && r.error && r.error.code === "request_invalid" && typeof r.error.detail === "string"), rs.filter(([, r]) => codeOf(r) !== "request_invalid").map(([l, r]) => [l, codeOf(r)]));
  }
  const a = call("assembleScenario", "request null (violation)", () => assembleScenario(null));
  check("assembleScenario's refusal keeps its documented shape: one violation (assembly.input_valid) and null documents", a.violations?.length === 1 && a.violations[0].id === "assembly.input_valid" && a.scenario === null && a.answerKey === null && a.publicScenario === null, a);
  check("an object request is still checked field by field as before (generateScenario({}) is seed_invalid)", codeOf(call("generateScenario", "request {}", () => generateScenario({}))) === "seed_invalid");
}

console.log("\n[2] U2: exotic objects at every input position give a structured result, never an exception");
{
  const genFields = ["seed", "constants", "template", "dataInputs", "difficulty", "selectionContext", "focus", "origin", "versionOverrides"];
  const asmFields = ["template", "constants", "dataInputs", "origin", "raw", "structure", "primary", "alternative", "actionTypes", "difficulty", "reproduction", "versionOverrides"];
  const evalFields = ["scenario", "answerKey", "answer", "template"];
  for (const [label, make] of exotics) {
    const gen = genFields.map((f) => call("generateScenario", `${f}: ${label}`, () => generateScenario({ seed: 3, constants: C, [f]: make() })));
    const asm = asmFields.map((f) => call("assembleScenario", `${f}: ${label}`, () => assembleScenario(asmInput({ [f]: make() }))));
    const ev = evalFields.map((f) => call("evaluateAnswer", `${f}: ${label}`, () => evaluateAnswer(evalInput({ [f]: make() }))));
    const whole = [call("generateScenario", `whole request: ${label}`, () => generateScenario(make())), call("assembleScenario", `whole input: ${label}`, () => assembleScenario(make())), call("evaluateAnswer", `whole request: ${label}`, () => evaluateAnswer(make()))];
    const all = [...gen, ...asm, ...ev, ...whole];
    check(`${label}: every position at generate (${genFields.length}), assemble (${asmFields.length}) and evaluate (${evalFields.length}), and the whole request: structured, not thrown`, all.every(structured), all.filter((r) => !structured(r)).map(codeOf));
  }
  // Nested positions inside otherwise genuine documents.
  const nested = [
    ["scenario.provenance", (b) => { b.scenario.provenance = throwing(); }],
    ["scenario.state.raw", (b) => { b.scenario.state.raw = throwing(); }],
    ["answerKey.options", (b) => { b.answerKey.options = throwing(); }],
    ["one answer-key option", (b) => { b.answerKey.options[choice.choice] = throwing(); }],
    ["answerKey.factorEvidence", (b) => { b.answerKey.factorEvidence = throwing(); }],
    ["answerKey.versions", (b) => { b.answerKey.versions = throwing(); }],
  ];
  const rs = nested.map(([label, mutate]) => { const b = copy({ scenario: g.scenario, answerKey: g.answerKey }); mutate(b); return [label, call("evaluateAnswer", `nested ${label}`, () => evaluateAnswer(evalInput(b)))]; });
  check("a throwing Proxy nested at six places of the stored documents: structured (operation_failed or bundle_invalid), not thrown", rs.every(([, r]) => structured(r) && ["operation_failed", "bundle_invalid", "answer_key_mismatch", "rules_version_mismatch", "template_version_mismatch", "registry_version_mismatch", "template_mismatch"].includes(codeOf(r))), rs.map(([l, r]) => [l, codeOf(r)]));
  const rawProxy = call("assembleScenario", "raw.teams a throwing Proxy", () => assembleScenario(asmInput({ raw: { ...g.scenario.state.raw, teams: throwing() } })));
  check("a throwing Proxy inside a hand-crafted raw state: structured, not thrown", structured(rawProxy) && !rawProxy.ok, codeOf(rawProxy));
  const op = call("evaluateAnswer", "template a throwing Proxy", () => evaluateAnswer(evalInput({ template: throwing() })));
  check("operation_failed carries the exception message as detail, and nothing else", !op.ok && op.error?.code === "operation_failed" && op.error.detail === "getter" && Object.keys(op.error).length === 2, op);
}

console.log("\n[3] U3: malformed stored documents in evaluateAnswer");
{
  // Every field evaluateAnswer reads, removed and mistyped: bundle_invalid, or an earlier documented code.
  const EARLIER = ["answer_key_mismatch", "rules_version_mismatch", "template_version_mismatch", "registry_version_mismatch", "template_mismatch", "invalid_choice"];
  const read = [
    "scenario.scenarioRef", "scenario.provenance", "scenario.provenance.registries", "scenario.decision", "scenario.decision.structure", "scenario.decision.primaryObjective",
    "scenario.state", "scenario.state.raw", "scenario.state.raw.gameContext", "scenario.state.raw.objectives", "scenario.difficulty",
    "answerKey.versions", "answerKey.versions.registries", "answerKey.options", "answerKey.factorEvidence", "answerKey.best", "answerKey.defensible", "answerKey.analysis",
    "answerKey.analysis.defensibleCount", "answerKey.derivedSignals", "answerKey.derivedSignals.infoQuality",
    `answerKey.options.${choice.choice}.valid`, `answerKey.options.${choice.choice}.tier`, `answerKey.options.${choice.choice}.actionType`, `answerKey.options.${choice.choice}.score`,
    `answerKey.options.${choice.choice}.outcomeChain`, `answerKey.options.${choice.choice}.contributions`, `answerKey.options.${choice.choice}.influences`,
  ];
  const setAt = (root, path, value) => { const keys = path.split("."); let o = root; for (const k of keys.slice(0, -1)) o = o[k]; if (value === undefined) delete o[keys[keys.length - 1]]; else o[keys[keys.length - 1]] = value; };
  const getAt = (root, path) => path.split(".").reduce((o, k) => o[k], root);
  const kind = (x) => (x === null ? "null" : Array.isArray(x) ? "array" : typeof x);
  const outcomes = [];
  for (const path of read) {
    const original = getAt({ scenario: g.scenario, answerKey: g.answerKey }, path);
    for (const [how, value] of [["removed", undefined], ["null", null], ["a number", 7], ["a string", "x"], ["a list", []]]) {
      if (kind(value) === kind(original)) continue; // same type: a semantic change, outside evaluateAnswer's contract (see the scope check below)
      const b = copy({ scenario: g.scenario, answerKey: g.answerKey });
      setAt(b, path, value);
      const r = call("evaluateAnswer", `stored ${path} ${how}`, () => evaluateAnswer(evalInput(b)));
      outcomes.push([`${path} ${how}`, r]);
    }
  }
  const bad = outcomes.filter(([, r]) => r.threw || r.ok || !(r.error?.code === "bundle_invalid" || EARLIER.includes(r.error?.code)));
  check(`${outcomes.length} removed or mistyped (type-changing) fields that evaluateAnswer reads: each is bundle_invalid or an earlier documented code, never thrown, never evaluated`, bad.length === 0, bad.map(([l, r]) => [l, codeOf(r)]));
  const bi = outcomes.filter(([, r]) => !r.threw && !r.ok && r.error?.code === "bundle_invalid");
  check(`...and bundle_invalid always names its issues (${bi.length} cases)`, bi.length > 0 && bi.every(([, r]) => Array.isArray(r.error.issues) && r.error.issues.length > 0 && r.error.issues.every((x) => typeof x === "string")));

  // A deep sweep: every path of both stored documents, removed or replaced. Never thrown; an evaluation
  // that still succeeds is well formed (documents evaluateAnswer does not read may change without effect).
  const paths = [];
  const walk = (o, path) => { if (o === null || typeof o !== "object") return; for (const k of Object.keys(o)) { paths.push(`${path}.${k}`); walk(o[k], `${path}.${k}`); } };
  walk(g.answerKey, "answerKey");
  walk({ provenance: g.scenario.provenance, decision: g.scenario.decision }, "scenario");
  let threw = 0;
  let malformedEvaluations = 0;
  for (const path of paths) {
    for (const value of [undefined, null, "x"]) {
      const b = copy({ scenario: g.scenario, answerKey: g.answerKey });
      setAt(b, path, value);
      const r = call("evaluateAnswer", `deep ${path}=${String(value)}`, () => evaluateAnswer(evalInput(b)));
      if (r.threw) threw += 1;
      else if (r.ok && !(r.evaluation?.decision?.tier in TIER_RANK && r.evaluation.factorSignals?.every((s) => typeof s.performance?.signal === "string"))) malformedEvaluations += 1;
    }
  }
  check(`deep sweep over ${paths.length} stored paths x 3 replacements: none throws, and no evaluation that succeeds is malformed`, threw === 0 && malformedEvaluations === 0, { threw, malformedEvaluations });
  const forged = copy(g.answerKey);
  forged.options[choice.choice].tier = forged.options[choice.choice].tier === "STRONG" ? "WEAK" : "STRONG";
  const fe = call("evaluateAnswer", "forged but well-shaped tier", () => evaluateAnswer(evalInput({ answerKey: forged })));
  const gate = isServable({ scenario: g.scenario, answerKey: forged, publicScenario: g.publicScenario, template: T, constants: C, dataInputs: {} });
  check("(scope) a forged but well-shaped tier is outside evaluateAnswer's contract (it evaluates), and the serving gate refuses the bundle (invalid_bundle)", fe.ok === true && gate.servable === false && gate.blockers.some((x) => x.startsWith("invalid_bundle:")), { evaluate: codeOf(fe), gate: gate.blockers.filter((x) => x.startsWith("invalid_bundle")) });
}

console.log("\n[4] U4: malformed hand-crafted assembly input (raw state and decision fields)");
{
  const ok = call("assembleScenario", "well formed", () => assembleScenario(asmInput()));
  check("(control) the genuine state, hand-crafted, still assembles: the same scenarioRef, answer key and public scenario as the generated one", ok.ok === true && ok.scenario.scenarioRef === g.scenario.scenarioRef && stableStringify(ok.answerKey) === stableStringify(g.answerKey) && stableStringify(ok.publicScenario) === stableStringify(g.publicScenario), codeOf(ok));
  // Every raw path: removed, null, a number, a string, a list, an object, and (for strings) an illegal enum.
  const rawPaths = [];
  const walk = (o, path) => { if (o === null || typeof o !== "object") return; for (const k of Object.keys(o)) { rawPaths.push([...path, k]); walk(o[k], [...path, k]); } };
  walk(g.scenario.state.raw, []);
  const setRaw = (raw, path, value) => { let o = raw; for (const k of path.slice(0, -1)) o = o[k]; if (value === undefined) delete o[path[path.length - 1]]; else o[path[path.length - 1]] = value; };
  const leafOf = (path) => path.reduce((o, k) => o[k], g.scenario.state.raw);
  const rows = [];
  for (const path of rawPaths) {
    const original = leafOf(path);
    const variants = [["removed", undefined], ["null", null], ["a number", 7], ["a string", "not_a_value"], ["a list", []], ["an object", {}]];
    for (const [how, value] of variants) {
      if (JSON.stringify(value) === JSON.stringify(original)) continue; // not a change
      const raw = copy(g.scenario.state.raw);
      setRaw(raw, path, value);
      rows.push([`raw.${path.join(".")} ${how}`, call("assembleScenario", `raw.${path.join(".")} ${how}`, () => assembleScenario(asmInput({ raw })))]);
    }
  }
  const extra = copy(g.scenario.state.raw);
  extra.teams.allies.members.support.secretTier = "STRONG";
  rows.push(["an extra raw field", call("assembleScenario", "an extra raw field", () => assembleScenario(asmInput({ raw: extra })))]);
  const thrown = rows.filter(([, r]) => r.threw);
  check(`${rows.length} raw-state mutations over ${rawPaths.length} paths: none throws`, thrown.length === 0, thrown.map(([l]) => l));
  const accepted = rows.filter(([, r]) => !r.threw && r.ok);
  // Some replacements are legal states (a number where any integer is allowed): those must validate.
  check(`...every mutation that is still accepted (${accepted.length}) is a legal state: it re-validates`, accepted.every(([, r]) => validateScenarioBundle({ scenario: r.scenario, answerKey: r.answerKey, publicScenario: r.publicScenario, template: T, constants: C, dataInputs: {} }).ok), accepted.map(([l]) => l));
  const containers = rows.filter(([l]) => /^raw\.(gameContext|teams|teams\.(allies|enemies)|teams\.(allies|enemies)\.(composition|members)|teams\.(allies|enemies)\.members\.\w+|lanes|lanes\.\w+|lanes\.\w+\.turret|waves|objectives|objectives\.\w+|vision|vision\.\w+) (removed|null|a number|a string|a list)$/.test(l));
  check(`...every removed or non-object CONTAINER (${containers.length} cases) is refused, never assembled`, containers.length > 0 && containers.every(([, r]) => !r.threw && !r.ok), containers.filter(([, r]) => r.ok).map(([l]) => l));
  const aii = rows.filter(([, r]) => !r.threw && !r.ok && r.error?.code === "assembly_input_invalid");
  check(`...assembly_input_invalid (${aii.length} cases) names its issues and carries one assembly.input_valid violation`, aii.length > 0 && aii.every(([, r]) => r.error.issues?.length > 0 && r.violations?.length === 1 && r.violations[0].id === "assembly.input_valid"));
  check("...every refusal is assembly_input_invalid, operation_failed, or validation violations (the v1.1 outcome for states the build survives)", rows.every(([, r]) => r.threw || r.ok || (r.error ? ["assembly_input_invalid", "operation_failed"].includes(r.error.code) : r.violations?.length > 0)), rows.filter(([, r]) => !r.ok && r.error && !["assembly_input_invalid", "operation_failed"].includes(r.error.code)).map(([l, r]) => [l, codeOf(r)]));
  const named = Object.fromEntries(rows.map(([l, r]) => [l, r]));
  // The two refusal paths: the build cannot read the state (assembly_input_invalid), or it can and validation refuses it.
  const team = named["raw.teams.allies removed"];
  const gc = named["raw.gameContext a number"];
  const zone = named["raw.teams.allies.members.support.zone a string"];
  check("a missing team is assembly_input_invalid naming raw.teams.allies; a number for gameContext, which the build survives, is refused by validation (structure.enums_valid) as in v1.1", team.error?.code === "assembly_input_invalid" && team.error.issues?.includes("raw.teams.allies must be an object") && !gc.threw && !gc.error && gc.violations?.some((v) => v.id === "structure.enums_valid"), { team: codeOf(team), gameContext: codeOf(gc) });
  check("an illegal member zone (the build reads it) is assembly_input_invalid, and its issue is the validator's own enum check", zone.error?.code === "assembly_input_invalid" && zone.error.issues?.some((x) => x.startsWith("raw (structure.enums_valid): teams.allies.members.support.zone=")), codeOf(zone));
  // Decision fields and other non-rule input.
  const fields = [
    ["raw undefined", { raw: undefined }], ["raw a cyclic object", { raw: cyclic() }], ["raw with a 100000-deep extra field", { raw: { ...g.scenario.state.raw, extra: deep() } }],
    ["structure unknown", { structure: "no_such_structure" }], ["structure a number", { structure: 5 }], ["structure null", { structure: null }],
    ["primary unknown", { primary: "baron" }], ["primary null", { primary: null }], ["alternative = primary", { alternative: g.scenario.decision.primaryObjective }], ["alternative a number", { alternative: 5 }],
    ["actionTypes empty", { actionTypes: [] }], ["actionTypes unknown", { actionTypes: ["NOPE"] }], ["actionTypes a number entry", { actionTypes: [5] }], ["actionTypes a string", { actionTypes: "CONTEST" }], ["actionTypes null", { actionTypes: null }], ["actionTypes duplicated", { actionTypes: ["CONTEST", "CONTEST"] }],
    ["difficulty 1.5", { difficulty: 1.5 }], ["difficulty '1'", { difficulty: "1" }], ["difficulty null", { difficulty: null }], ["difficulty 99", { difficulty: 99 }],
    ["origin a number", { origin: 5 }], ["origin unknown", { origin: "imported" }], ["origin null", { origin: null }],
    ["constants null", { constants: null }], ["constants {}", { constants: {} }],
  ];
  const fr = fields.map(([label, patch]) => [label, call("assembleScenario", label, () => assembleScenario(asmInput(patch)))]);
  check(`${fields.length} malformed decision fields and other non-rule inputs: none throws, none is assembled`, fr.every(([, r]) => !r.threw && !r.ok), fr.filter(([, r]) => r.threw || r.ok).map(([l, r]) => [l, codeOf(r)]));
  const codeFor = (l) => codeOf(fr.find(([x]) => x === l)[1]);
  const unreadable = ["raw undefined", "raw a cyclic object", "raw with a 100000-deep extra field", "structure a number", "primary unknown", "alternative a number", "actionTypes unknown", "actionTypes a string", "constants null"];
  const survivable = ["structure unknown", "alternative = primary", "actionTypes empty", "actionTypes duplicated", "difficulty 1.5", "difficulty 99", "origin unknown"];
  check("...inputs the build cannot read are assembly_input_invalid; inputs it can read are refused by validation as in v1.1", unreadable.every((l) => codeFor(l) === "assembly_input_invalid") && survivable.every((l) => codeFor(l).startsWith("violations:")), Object.fromEntries(fr.map(([l, r]) => [l, codeOf(r)])));
  const r1 = fr.find(([x]) => x === "structure a number")[1];
  check("...and the issue names the field", r1.error?.issues?.includes("structure must name one of the template's decision structures") === true, codeOf(r1));
  const tolerated = [["dataInputs a number", { dataInputs: 5 }], ["versionOverrides a string", { versionOverrides: "x" }]].map(([label, patch]) => [label, call("assembleScenario", label, () => assembleScenario(asmInput(patch)))]);
  check("tolerated as in v1.1 (unchanged): a number for dataInputs (no entity resolver) and a string for versionOverrides (no override) assemble the same scenario", tolerated.every(([, r]) => r.ok === true && r.scenario.scenarioRef === ok.scenario.scenarioRef), tolerated.map(([l, r]) => [l, codeOf(r)]));
}

console.log("\n[5] U5: malformed non-rule data of an unregistered custom template");
{
  const custom = { ...T, rules: { ...T.rules, version: "objective_trade.rules.3+engineering" } };
  check("(setup) the custom template is unregistered and generates", generateScenario({ seed: 3, constants: C, template: custom }).ok === true);
  const keys = Object.keys(T).filter((k) => k !== "rules" && k !== "runtime");
  const rs = [];
  for (const k of keys) {
    for (const [how, value] of [["removed", undefined], ["null", null], ["a number", 7], ["a string", "x"], ["a list", []], ["an object", {}]]) {
      const t = { ...custom };
      if (value === undefined) delete t[k];
      else t[k] = value;
      rs.push([`${k} ${how} (generate)`, call("generateScenario", `custom ${k} ${how}`, () => generateScenario({ seed: 3, constants: C, template: t }))]);
      rs.push([`${k} ${how} (assemble)`, call("assembleScenario", `custom ${k} ${how}`, () => assembleScenario(asmInput({ template: t })))]);
    }
  }
  for (const s of Object.keys(T.structures)) {
    for (const [how, value] of [["null", null], ["a number", 7], ["an empty object", {}]]) {
      const t = { ...custom, structures: { ...T.structures, [s]: value } };
      rs.push([`structures.${s} ${how} (generate)`, call("generateScenario", `custom structures.${s} ${how}`, () => generateScenario({ seed: 3, constants: C, template: t }))]);
    }
  }
  check(`${rs.length} malformed non-rule fields of a custom template at generate and assemble: none throws; each result is structured`, rs.every(([, r]) => structured(r)), rs.filter(([, r]) => !structured(r)).map(([l, r]) => [l, codeOf(r)]));
  const codes = [...new Set(rs.map(([, r]) => codeOf(r)))].sort();
  // An exception inside a candidate's assembly surfaces as operation_failed; it is not retried as a rejected candidate.
  const presenting = { ...custom, runtime: { ...T.runtime, buildPresentation() { throw new Error("presentation failed"); } } };
  const pf = call("generateScenario", "custom runtime whose buildPresentation throws", () => generateScenario({ seed: 3, constants: C, template: presenting }));
  check("an exception inside a candidate's assembly is operation_failed with its message (not retried into generation_exhausted)", pf.ok === false && pf.error?.code === "operation_failed" && pf.error.detail === "presentation failed", codeOf(pf));
  check("...the custom template's own rule table is still fully checked first: an unregistered table with a null action is rules_invalid", codeOf(call("generateScenario", "custom null action", () => generateScenario({ seed: 3, constants: C, template: { ...custom, rules: { ...custom.rules, actions: { ...custom.rules.actions, CONTEST: null } } } }))) === "rules_invalid", codes);
}

console.log("\n[6] The guarantee: every public operation returned, for every input above");
{
  const others = [
    call("validateScenarioBundle", "throwing Proxy", () => validateScenarioBundle(throwing())),
    call("isServable", "throwing Proxy", () => isServable(throwing())),
    call("checkFreshness", "throwing Proxy", () => checkFreshness(throwing(), throwing())),
    call("templateRuleIssues", "throwing Proxy", () => templateRuleIssues(throwing())),
  ];
  check("(the four operations that were already total stay so)", others.every((r) => !r.threw), others);
  const threw = calls.filter((c) => c.r.threw);
  const byOp = calls.reduce((m, c) => ({ ...m, [c.op]: (m[c.op] || 0) + 1 }), {});
  check(`no exception in ${calls.length} calls (${Object.entries(byOp).map(([k, v]) => `${k} ${v}`).join(", ")})`, threw.length === 0, threw.slice(0, 10).map((c) => [c.op, c.label, c.r.threw]));
}

finish();
