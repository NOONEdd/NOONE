// decisionLab -- the rule-table check is total (diff C; contract: ERROR_CONTRACT_v1_1.md).
//
//   node tests/decisionLab.ruleTable.test.mjs
//
//   [1] malformed nested shapes are issues, never exceptions, and every public
//       entry point reports them the same way (rules_invalid / template.rules_valid);
//   [2] exotic values (throwing getters, Proxies, a throwing or lying check) are
//       issues too: templateRuleIssues and validateScenarioBundle never throw;
//   [3] mutation sweep: every node of the shipped table replaced by a malformed
//       value. Under the registered labels no mutated table is ever evaluated;
//       under a custom label the check never throws and nothing it accepts
//       makes generation or validation throw;
//   [4] read coverage: every rule-table path the engine reads at run time is a
//       path the check reads.
// Engineering tests only. Nothing here says the DRAFT rules are good coaching.

import { generateScenario, assembleScenario, FIGHTABILITY_STRATA } from "../functions/_lib/decisionLab/generator.js";
import { validateScenarioBundle, templateRuleIssues } from "../functions/_lib/decisionLab/validator.js";
import { evaluateAnswer } from "../functions/_lib/decisionLab/evaluator.js";
import { recomputeAnswerKey } from "../functions/_lib/decisionLab/scoring.js";
import { OBJECTIVE_TRADE_TEMPLATE as T, OBJECTIVE_TRADE_RULES, checkRuleTable } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { FIXTURE_CONSTANTS as C, copy, createHarness } from "./decisionLab.fixtures.mjs";

const { check, finish } = createHarness();
const g = generateScenario({ seed: 12, constants: C });
const outcome = (f) => { try { return f(); } catch (e) { return { threw: `${e && e.constructor ? e.constructor.name : typeof e}: ${e && e.message}` }; } };
const CUSTOM = "objective_trade.rules.3+engineering";

/** All four public operations on one template; each reduced to a code (or "ok" / "threw ..."). */
function entryPoints(template) {
  const code = (r) => (r && r.threw ? `threw ${r.threw}` : r.ok ? "ok" : r.error ? r.error.code : r.violations ? r.violations.map((v) => v.id).join(",") : "?");
  return {
    generate: code(outcome(() => generateScenario({ seed: 5, constants: C, template }))),
    assemble: code(outcome(() => assembleScenario({ template, constants: C, origin: "coach_crafted", raw: g.scenario.state.raw, structure: g.scenario.decision.structure, primary: g.scenario.decision.primaryObjective, alternative: g.scenario.decision.alternativeObjective, actionTypes: g.scenario.decision.options.map((o) => o.actionType), difficulty: g.scenario.difficulty }))),
    validate: code(outcome(() => validateScenarioBundle({ scenario: g.scenario, answerKey: g.answerKey, publicScenario: g.publicScenario, template, constants: C, dataInputs: {} }))),
    evaluate: code(outcome(() => evaluateAnswer({ scenario: g.scenario, answerKey: g.answerKey, answer: { choice: g.scenario.decision.options[0].id }, template }))),
  };
}
const allRulesInvalid = (e) => e.generate === "rules_invalid" && e.assemble === "rules_invalid" && e.validate === "template.rules_valid" && e.evaluate === "rules_invalid";

console.log("\n[1] Malformed nested shapes: issues, never exceptions, the same code at every entry point");
{
  check("(setup) the shipped table has no issues", checkRuleTable(OBJECTIVE_TRADE_RULES).length === 0, checkRuleTable(OBJECTIVE_TRADE_RULES));
  const cases = [
    ["rules.terms.team_access = null", (r) => { r.terms.team_access = null; }, "terms.team_access must be an object"],
    ["rules.actions.CONTEST = null", (r) => { r.actions.CONTEST = null; }, "actions.CONTEST must be an object"],
    ["rules.preconditions.TRADE = null", (r) => { r.preconditions.TRADE = null; }, "preconditions.TRADE must be an object"],
    ["rules.certaintyShift[0] = null", (r) => { r.certaintyShift[0] = null; }, "certaintyShift[0] must be an object"],
    ["a null term inside an action stage", (r) => { r.actions.CONTEST.objective_fight.terms[0] = null; }, "actions.CONTEST.objective_fight: terms[0] must be an object"],
    ["a null band inside an action stage", (r) => { r.actions.CONTEST.objective_fight.bands[1] = null; }, "actions.CONTEST.objective_fight: band 1 must be an object"],
    ["a hole in a stage's terms", (r) => { r.actions.SETUP.objective_fight.terms.length += 1; }, `actions.SETUP.objective_fight: terms[${OBJECTIVE_TRADE_RULES.actions.SETUP.objective_fight.terms.length}] must be an object`],
    ["a primitive stage", (r) => { r.actions.GIVE.objective_fight = 7; }, "actions.GIVE.objective_fight: needs terms[] and a non-empty bands[]"],
    ["a primitive band", (r) => { r.actions.IGNORE.tempo_map_access.bands[0] = "x"; }, "actions.IGNORE.tempo_map_access: band 0 must be an object"],
    ["a primitive certainty shift `when`", (r) => { r.certaintyShift[1].when = 3; }, "certaintyShift[1]: when may only test infoQuality and factorLevel"],
    ["a primitive factorLevel", (r) => { r.certaintyShift[2].when.factorLevel = "behind"; }, "certaintyShift[2]: factorLevel must be an object"],
    ["a primitive term values", (r) => { r.terms.enemy_access.values = 2; }, "terms.enemy_access: a plain term needs a registry factor and values"],
    ["a missing action", (r) => { delete r.actions.GIVE; }, "actions.GIVE: missing (the template offers it)"],
    ["an action the template does not offer", (r) => { r.actions.WAIT = r.actions.IGNORE; }, "actions.WAIT: not an action the template offers"],
    ["a band failure that is not a string", (r) => { r.actions.CONTEST.objective_fight.bands[0].failure = 5; }, "actions.CONTEST.objective_fight: band 0 failure must be a non-empty string when present"],
    ["an infoQuality the state never has", (r) => { r.certaintyShift[0].when.infoQuality = "unknown"; }, "certaintyShift[0]: infoQuality unknown is not an information level"],
    ["a non-boolean situationalRequiresAlternative", (r) => { r.tiering.situationalRequiresAlternative = "yes"; }, "tiering.situationalRequiresAlternative must be a boolean"],
    ["a derived term reading a derived term", (r) => { r.terms.objective_value = { derived: "trade_punish", factor: "objective_value" }; }, "terms.neglect_cost: derived term neglect_cost reads terms.objective_value, which must be a plain term"],
    ["a derived term reading a term of another factor", (r) => { r.terms.objective_value = copy(OBJECTIVE_TRADE_RULES.terms.team_access); }, "terms.trade_gain: derived term trade_gain reads terms.objective_value, which must be a term of factor objective_value"],
    // Prototype keys are not implemented names (the old check accepted several of them).
    ["a stage term named constructor", (r) => { r.actions.CONTEST.objective_fight.terms[0] = { term: "constructor" }; }, "actions.CONTEST.objective_fight: unknown term constructor"],
    ["a precondition rule named constructor", (r) => { r.preconditions.TRADE.rule = "constructor"; }, "preconditions.TRADE: rule constructor is not implemented"],
    ["a precondition rule named hasOwnProperty", (r) => { r.preconditions.SETUP.rule = "hasOwnProperty"; }, "preconditions.SETUP: rule hasOwnProperty is not implemented"],
    ["a term factor named __proto__", (r) => { r.terms.team_access.factor = "__proto__"; }, "terms.team_access: unknown factor __proto__"],
    ["a derived kind named toString", (r) => { r.terms.neglect_cost.derived = "toString"; }, "terms.neglect_cost: derived term toString is not implemented"],
    ["a certainty shift action named toString", (r) => { r.certaintyShift[0].actions = ["toString"]; }, "certaintyShift[0]: actions must name rule-table actions"],
    ["a certainty shift factor named constructor", (r) => { r.certaintyShift[2].when.factorLevel = { constructor: "behind" }; }, "certaintyShift[2]: constructor=behind is not a factor level"],
  ];
  for (const [label, mutate, expected] of cases) {
    const r = copy(OBJECTIVE_TRADE_RULES);
    mutate(r);
    const problems = outcome(() => checkRuleTable(r));
    const e = entryPoints({ ...T, rules: r });
    check(`${label}: reported ("${expected}"), and all four entry points say rules_invalid / template.rules_valid`, Array.isArray(problems) && problems.includes(expected) && allRulesInvalid(e), { problems, e });
  }

  // Container types: each top-level container replaced by every wrong type.
  const containers = { terms: "object", actions: "object", preconditions: "object", tiering: "object", signals: "object", thresholds: "object", certaintyShift: "array" };
  const wrong = { null: null, undefined, zero: 0, string: "x", true: true, array: [], object: {}, nan: NaN };
  let n = 0;
  const bad = [];
  for (const [key, kind] of Object.entries(containers)) {
    for (const [wname, value] of Object.entries(wrong)) {
      if ((kind === "array" && wname === "array") || (kind === "object" && wname === "object")) continue; // right type
      const r = copy(OBJECTIVE_TRADE_RULES);
      if (value === undefined) delete r[key];
      else r[key] = value;
      n += 1;
      const problems = outcome(() => checkRuleTable(r));
      const e = entryPoints({ ...T, rules: r });
      const expected = `${key} must be ${kind === "array" ? "an array" : "an object"}`;
      if (!(Array.isArray(problems) && problems.includes(expected) && allRulesInvalid(e))) bad.push({ key, wname, problems, e });
    }
  }
  check(`malformed container types (terms, actions, preconditions, tiering, signals, thresholds, certaintyShift x ${Object.keys(wrong).length - 1} wrong types each = ${n} tables): each reported, and rules_invalid at all four entry points`, n === 49 && bad.length === 0, bad.slice(0, 3));
  check("a non-object rule table (null, [], 'x', 5) is one issue: 'rule table must be an object'", [null, [], "x", 5].every((x) => stableStringify(checkRuleTable(x)) === stableStringify(["rule table must be an object"])));
  const noRules = entryPoints({ ...T, rules: undefined });
  check("a template without rules: rules_invalid at generate/assemble/validate; evaluateAnswer says template_mismatch first (its label check needs rules.version, contract order)", noRules.generate === "rules_invalid" && noRules.assemble === "rules_invalid" && noRules.validate === "template.rules_valid" && noRules.evaluate === "template_mismatch", noRules);
}

console.log("\n[2] Exotic values: templateRuleIssues and validateScenarioBundle never throw");
{
  const boom = new Proxy({}, { get() { throw new Error("getter exploded"); }, ownKeys() { throw new Error("keys exploded"); } });
  const getterRules = copy(OBJECTIVE_TRADE_RULES);
  Object.defineProperty(getterRules, "terms", { get() { throw new Error("terms getter"); }, enumerable: true });
  const cyclic = copy(OBJECTIVE_TRADE_RULES);
  cyclic.terms.loop = cyclic.terms;
  const exotic = [
    ["a rule table with a throwing getter", { ...T, rules: getterRules }, /^rule table check failed: terms getter$/],
    ["a rule table that is a throwing Proxy", { ...T, rules: boom }, /^rule table check failed: /],
    ["a template that is a throwing Proxy", boom, /^rule table check failed: /],
    ["a check that throws", { ...T, rules: copy(OBJECTIVE_TRADE_RULES), runtime: { ...T.runtime, checkRules: () => { throw new Error("check crashed"); } } }, /^rule table check failed: check crashed$/],
    ["a check that does not return a list", { ...T, rules: copy(OBJECTIVE_TRADE_RULES), runtime: { ...T.runtime, checkRules: () => "fine" } }, /^template runtime.checkRules must return a list of issues$/],
    ["a template without a check", { ...T, runtime: {} }, /^template must provide runtime.checkRules$/],
  ];
  for (const [label, template, re] of exotic) {
    const issues = outcome(() => templateRuleIssues(template));
    const v = outcome(() => validateScenarioBundle({ scenario: g.scenario, answerKey: g.answerKey, publicScenario: g.publicScenario, template, constants: C, dataInputs: {} }));
    check(`${label}: templateRuleIssues reports it (no exception), validateScenarioBundle reports template.rules_valid`, Array.isArray(issues) && issues.length === 1 && re.test(issues[0]) && v.ok === false && v.violations[0].id === "template.rules_valid", { issues, v });
  }
  const cyc = outcome(() => checkRuleTable(cyclic));
  check("a cyclic rule table is checked without recursion or exception (the cycle is reported as a malformed term)", Array.isArray(cyc) && cyc.includes("terms.loop: a plain term needs a registry factor and values"), cyc);
  const odd = [["null", null], ["undefined", undefined], ["a number", 5], ["a string", "x"], ["an array", []], ["a throwing Proxy", boom]];
  const vals = odd.map(([label, b]) => [label, outcome(() => validateScenarioBundle(b))]);
  check("validateScenarioBundle never throws for a non-bundle argument (structure.scenario_shape or a violation, never an exception)", vals.every(([, v]) => v && !v.threw && v.ok === false && v.violations.length >= 1), vals);
  const nullOptions = outcome(() => validateScenarioBundle({ scenario: g.scenario, answerKey: g.answerKey, publicScenario: g.publicScenario, template: T, constants: C, dataInputs: {} }, null));
  check("validateScenarioBundle with options = null validates normally", nullOptions.ok === true, nullOptions);
}

console.log("\n[3] Mutation sweep over every node of the shipped table");
{
  // Every path in the table (objects and arrays, all depths), replaced by each malformed value or deleted.
  const paths = [];
  const walk = (v, path) => { if (v !== null && typeof v === "object") for (const k of Object.keys(v)) { paths.push([...path, k]); walk(v[k], [...path, k]); } };
  walk(OBJECTIVE_TRADE_RULES, []);
  const replacements = [["delete"], ["null", null], ["NaN", NaN], ["1.5", 1.5], ["string", "x"], ["true", true], ["array", []], ["object", {}]];
  const mutated = (path, rep) => {
    const r = copy(OBJECTIVE_TRADE_RULES);
    let o = r;
    for (const k of path.slice(0, -1)) o = o[k];
    const last = path[path.length - 1];
    if (rep[0] === "delete") delete o[last];
    else o[last] = rep[1];
    return r;
  };
  let total = 0, refusedEverywhere = 0, threw = 0, evaluatedOrOk = [];
  const approval = [], label = [], contentNotRefused = [];
  const codes = {};
  let customTotal = 0, customReported = 0, customThrew = [], customUnreported = 0, customRunThrew = [], customEvaluated = [];
  for (const path of paths) {
    for (const rep of replacements) {
      const r = mutated(path, rep);
      if (JSON.stringify(r) === JSON.stringify(OBJECTIVE_TRADE_RULES) && rep[0] !== "NaN") continue; // not a change (NaN serializes as null)
      // (a) under the registered labels: refused at every entry point, never evaluated, never thrown.
      total += 1;
      const e = entryPoints({ ...T, rules: r });
      const vals = Object.values(e);
      if (vals.some((x) => x.startsWith("threw"))) threw += 1;
      if (vals.some((x) => x === "ok") && !["status", "notice", "version"].includes(path[0])) evaluatedOrOk.push({ path: path.join("."), rep: rep[0], e });
      const refused = ["rules_invalid", "template_content_mismatch"].includes(e.generate) && ["rules_invalid", "template_content_mismatch"].includes(e.assemble) && ["template.rules_valid", "template.content_matches_registry"].includes(e.validate) && ["rules_invalid", "template_content_mismatch"].includes(e.evaluate);
      const shapeOk = outcome(() => checkRuleTable(r)).length === 0;
      if (path[0] === "status" || path[0] === "notice") {
        // Approval state is deliberately outside the pins (TEMPLATE_TRUST_CONTRACT.md 2): a well-formed change is accepted, a malformed one is rules_invalid.
        approval.push({ path: path.join("."), rep: rep[0], ok: shapeOk ? vals.every((x) => x === "ok") : allRulesInvalid(e) });
      } else if (path[0] === "version") {
        // The label: another (non-empty) version makes this a custom template, which the registered scenario's evaluation refuses (template_mismatch).
        label.push({ rep: rep[0], ok: e.evaluate === "template_mismatch" && (shapeOk ? e.generate === "ok" : e.generate === "rules_invalid") });
      } else if (refused) refusedEverywhere += 1;
      else contentNotRefused.push({ path: path.join("."), rep: rep[0], e });
      codes[e.evaluate] = (codes[e.evaluate] || 0) + 1;
      // (b) under a custom label: the check is total; whatever it accepts must not make generation or validation throw.
      if (path[0] === "version") continue; // the label itself
      const rc = { ...r, version: CUSTOM };
      customTotal += 1;
      const issues = outcome(() => checkRuleTable(rc));
      if (!Array.isArray(issues)) { customThrew.push({ path: path.join("."), rep: rep[0], issues }); continue; }
      if (issues.length) { customReported += 1; continue; }
      customUnreported += 1;
      const tc = { ...T, rules: rc };
      for (const seed of [1, 2]) {
        const gr = outcome(() => generateScenario({ seed, constants: C, template: tc }));
        const vr = gr.ok ? outcome(() => validateScenarioBundle({ scenario: gr.scenario, answerKey: gr.answerKey, publicScenario: gr.publicScenario, template: tc, constants: C, dataInputs: {} })) : null;
        if (gr.threw || (vr && vr.threw)) customRunThrew.push({ path: path.join("."), rep: rep[0], seed, gr: gr.threw, vr: vr && vr.threw });
        if (gr.ok) {
          const ev = outcome(() => evaluateAnswer({ scenario: gr.scenario, answerKey: gr.answerKey, answer: { choice: gr.scenario.decision.options[0].id }, template: tc }));
          if (ev.threw || ev.ok || ev.error.code !== "template_unregistered") customEvaluated.push({ path: path.join("."), rep: rep[0], ev: ev.threw || (ev.ok ? "ok" : ev.error.code) });
        }
      }
    }
  }
  console.log(`  STATS paths=${paths.length} mutated tables=${total} evaluateAnswer codes=${JSON.stringify(codes)} custom-label: total=${customTotal} reported=${customReported} accepted=${customUnreported}`);
  check(`(setup) the sweep covers every node of the table (${paths.length} paths) with up to ${replacements.length} malformed replacements each`, paths.length > 600 && total > 4000, { paths: paths.length, total });
  check("registered labels: no public entry point throws for any mutated table", threw === 0, threw);
  const contentTotal = total - approval.length - label.length;
  check(`registered labels: no mutated CONTENT is ever accepted or evaluated (all ${contentTotal} content mutations are refused at every entry point: rules_invalid or template_content_mismatch)`, evaluatedOrOk.length === 0 && contentNotRefused.length === 0 && refusedEverywhere === contentTotal, { refusedEverywhere, contentTotal, sample: contentNotRefused.slice(0, 3) });
  check(`approval state (status, notice; ${approval.length} mutations): a well-formed change is accepted (not pinned), a malformed status is rules_invalid at every entry point`, approval.length > 0 && approval.every((x) => x.ok), approval.filter((x) => !x.ok));
  check(`the version label (${label.length} mutations): a changed label is a custom template; the registered scenario's evaluation refuses it (template_mismatch)`, label.length > 0 && label.every((x) => x.ok), label.filter((x) => !x.ok));
  check("custom label: checkRuleTable never throws", customThrew.length === 0, customThrew.slice(0, 3));
  check("custom label: no table the check accepts makes generateScenario or validateScenarioBundle throw (seeds 1-2)", customRunThrew.length === 0, customRunThrew.slice(0, 5));
  check("custom label: no scenario of an accepted custom table is ever evaluated (template_unregistered)", customEvaluated.length === 0, customEvaluated.slice(0, 3));
}

console.log("\n[4] Read coverage: every path the runtime reads is a path the check reads");
{
  // A recording Proxy over a JSON clone of the table; array indices are normalized to []. A read of an ABSENT key (an
  // optional entry, e.g. preconditions.CONTEST) is covered when the check enumerates that container (it then validates
  // whatever is present). Phase A (generation, assembly, validation, recomputation) uses a custom label, so the registry
  // reads nothing, and a check wrapper attributes the check's own reads. Phase B (evaluation) must use the registered
  // labels; there the reads inside the registry's content digest are told apart by the call stack.
  const norm = (path) => path.replace(/\.\d+(?=\.|$)/g, "[]");
  const runtime = new Set(), runtimeAbsent = new Set(), checked = new Set();
  let inCheck = 0, useStack = false;
  const attribute = (key) => {
    if (!useStack) return inCheck > 0 ? "check" : "runtime";
    const stack = new Error().stack;
    return /templates\/registry\.js/.test(stack) ? "trust" : /checkRuleTable/.test(stack) ? "check" : "runtime";
  };
  const wrap = (obj, path, cache) => {
    if (obj === null || typeof obj !== "object") return obj;
    if (cache.has(obj)) return cache.get(obj);
    const p = new Proxy(obj, {
      get(t, k, rcv) {
        const v = Reflect.get(t, k, rcv);
        if (typeof k === "symbol") return v;
        const full = path ? `${path}.${k}` : String(k);
        if (Array.isArray(t) && (k === "length" || typeof Array.prototype[k] === "function")) return wrap(v, full, cache);
        const who = attribute();
        if (who === "check") checked.add(norm(full));
        else if (who === "runtime") (Object.prototype.hasOwnProperty.call(t, k) ? runtime : runtimeAbsent).add(norm(full));
        return wrap(v, full, cache);
      },
      ownKeys(t) {
        if (attribute() === "check") checked.add(norm(path ? `${path}.*` : "*"));
        return Reflect.ownKeys(t);
      },
    });
    cache.set(obj, p);
    return p;
  };
  const flaggedCheck = (r) => { inCheck += 1; try { return checkRuleTable(r); } finally { inCheck -= 1; } };
  // Phase A
  const tA = { ...T, rules: wrap({ ...copy(OBJECTIVE_TRADE_RULES), version: CUSTOM }, "", new WeakMap()), runtime: { ...T.runtime, checkRules: flaggedCheck } };
  const requests = [];
  for (let seed = 1; seed <= 40; seed++) requests.push({ seed });
  for (let seed = 1; seed <= 4; seed++) for (const st of FIGHTABILITY_STRATA) requests.push({ seed, focus: { fightability: { level: st.level, driver: st.driver } } });
  for (const d of [1, 2, 3, 4]) for (const seed of [7, 8]) requests.push({ seed, difficulty: d });
  let generated = 0;
  for (const req of requests) {
    const r = generateScenario({ ...req, constants: C, template: tA });
    if (!r.ok) continue;
    generated += 1;
    validateScenarioBundle({ scenario: r.scenario, answerKey: r.answerKey, publicScenario: r.publicScenario, template: tA, constants: C, dataInputs: {} });
    const pv = r.scenario.provenance;
    recomputeAnswerKey({ template: tA, constants: C, raw: r.scenario.state.raw, decision: r.scenario.decision, scenarioRef: r.scenario.scenarioRef, versions: { templateVersion: pv.templateVersion, generatorVersion: pv.generatorVersion, rulesVersion: pv.rulesVersion } });
  }
  // Phase B
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 25;
  useStack = true;
  const tB = { ...T, rules: wrap(copy(OBJECTIVE_TRADE_RULES), "", new WeakMap()) };
  let evaluated = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const r = generateScenario({ seed, constants: C });
    for (const o of r.scenario.decision.options) if (evaluateAnswer({ scenario: r.scenario, answerKey: r.answerKey, answer: { choice: o.id }, template: tB }).ok) evaluated += 1;
  }
  useStack = false;
  Error.stackTraceLimit = limit;
  checkRuleTable(wrap(copy(OBJECTIVE_TRADE_RULES), "", new WeakMap()));
  flaggedCheck(wrap(copy(OBJECTIVE_TRADE_RULES), "", new WeakMap()));
  const parentOf = (x) => x.slice(0, x.lastIndexOf(".")) || "";
  const gaps = [...runtime].filter((x) => !checked.has(x)).sort();
  const absentGaps = [...runtimeAbsent].filter((x) => !checked.has(x) && !checked.has(`${parentOf(x)}.*`)).sort();
  check(`(setup) the audit generated, validated and recomputed ${generated} scenarios and evaluated ${evaluated} answers through the recording table, seeing ${runtime.size} runtime paths`, generated >= 60 && evaluated >= 40 && runtime.size > 300, { generated, evaluated, runtime: runtime.size });
  check("every rule-table path the runtime reads is also read by checkRuleTable (no unvalidated read)", gaps.length === 0, gaps);
  check("every optional entry the runtime looks up (absent keys) lives in a container the check enumerates", absentGaps.length === 0, absentGaps);
}

import { stableStringify } from "../functions/_lib/decisionLab/fingerprint.js";
finish();
