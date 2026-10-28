// decisionLab -- E+F: the serving gate uses constants-aware freshness (contract: SERVING_FRESHNESS_CONTRACT_STAGE7.md).
//
//   node tests/decisionLab.servingFreshness.test.mjs
//
// End-to-end isServable checks for the combined variant:
//   [1] a relevant constants VALUE change under an unchanged version label blocks serving;
//   [2] a relevant material timing-bucket change is not treated as fresh (E alone cannot see it);
//   [3] an irrelevant value change leaves a ready bundle exactly as it was;
//   [4] missing current data and malformed bundles fail closed, and nothing throws;
//   [5] one owner per check: the gate validates the bundle exactly once, through checkFreshness.
// All constants are synthetic test fixtures; the factor and principle registries stay DRAFT, so nothing is servable.

import { generateScenario } from "../functions/_lib/decisionLab/generator.js";
import { isServable, checkFreshness, validateScenarioBundle } from "../functions/_lib/decisionLab/validator.js";
import { checkStaleness, materialSignature, stableStringify } from "../functions/_lib/decisionLab/fingerprint.js";
import { OBJECTIVE_TRADE_TEMPLATE as T } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { FIXTURE_CONSTANTS as C, withConstants, copy, createHarness } from "./decisionLab.fixtures.mjs";

const { check, finish } = createHarness();
const approvedT = { ...T, status: "approved", rules: { ...T.rules, status: "APPROVED" } };
const verify = (mutate = () => {}) => withConstants((c) => { c.status = "VERIFIED"; c.verifiedForPatch = "P1"; c.version = "fixture.verified"; mutate(c); });
const verified = verify();
const now = { effectivePatch: "P1" };
const bundleOf = (r) => ({ scenario: r.scenario, answerKey: r.answerKey, publicScenario: r.publicScenario });
const gate = (input) => { try { return isServable(input); } catch (e) { return { threw: `${e.constructor.name}: ${e.message}` }; } };
const onlyDraftRegistries = (r) => r.servable === false && r.blockers.length > 0 && r.blockers.every((b) => b.startsWith("factor_not_approved:") || b.startsWith("principle_not_approved:"));
const gv = generateScenario({ seed: 11, constants: verified });

console.log("\n[1] A relevant constants value change under the SAME version label blocks serving");
{
  const ready = gate({ ...bundleOf(gv), template: approvedT, constants: verified, dataInputs: now });
  check("(setup) under the constants it was built with, only the DRAFT factor and principle registries block this bundle", onlyDraftRegistries(ready), ready.blockers);
  const swapped = verify((c) => { const d = c.values.objectives.dragon.zone; c.values.objectives.dragon.zone = c.values.objectives.riftHerald.zone; c.values.objectives.riftHerald.zone = d; });
  check("(setup) the swap keeps the version label, so identity staleness alone still says fresh", swapped.version === verified.version && checkStaleness(gv.scenario, { constants: swapped, dataInputs: now }).status === "fresh");
  const r = gate({ ...bundleOf(gv), template: approvedT, constants: swapped, dataInputs: now });
  check("isServable blocks it: stale:review_required with invalid_bundle:state.derived_rebuildable (from checkFreshness)", r.servable === false && r.blockers.includes("stale:review_required") && r.blockers.includes("invalid_bundle:state.derived_rebuildable"), r.blockers);
}

console.log("\n[2] A relevant material timing-bucket change is not silently fresh");
{
  const widened = verify((c) => { c.values.window.availableInSec = { min: 5, max: 300 }; });
  let found = null;
  for (let seed = 1; seed <= 300 && !found; seed++) {
    const r = generateScenario({ seed, constants: verified });
    if (!r.ok) continue;
    const sig = stableStringify(materialSignature({ scenario: r.scenario, answerKey: r.answerKey, constants: widened })) !== stableStringify(r.scenario.fingerprints.material.signature);
    const stillValid = validateScenarioBundle({ ...bundleOf(r), template: approvedT, constants: widened, dataInputs: now }).ok;
    if (sig && stillValid) found = r;
  }
  check("(setup) a scenario whose bundle stays VALID under the widened window, yet whose material timing bucket moves (so validation alone, as in E without F, would not block it)", !!found);
  if (found) {
    check("(why) identity staleness cannot see it either: fresh", checkStaleness(found.scenario, { constants: widened, dataInputs: now }).status === "fresh");
    const r = gate({ ...bundleOf(found), template: approvedT, constants: widened, dataInputs: now });
    check("isServable blocks it: stale:review_required and freshness:material_signature_changed, with no invalid_bundle", r.servable === false && r.blockers.includes("stale:review_required") && r.blockers.includes("freshness:material_signature_changed") && !r.blockers.some((b) => b.startsWith("invalid_bundle:")), r.blockers);
  }
}

console.log("\n[3] An irrelevant constants value change does not invalidate a valid bundle");
{
  const near30 = verify((c) => { c.values.travelSec.near = 30; });
  const before = gate({ ...bundleOf(gv), template: approvedT, constants: verified, dataInputs: now });
  const after = gate({ ...bundleOf(gv), template: approvedT, constants: near30, dataInputs: now });
  check("(setup) the change keeps the label and leaves this bundle valid and its signature unchanged", stableStringify(checkFreshness(bundleOf(gv), { template: approvedT, constants: near30, dataInputs: now })) === stableStringify({ status: "fresh", reasons: [] }));
  check("the gate's verdict is exactly the same as before the change (only the DRAFT registries block)", stableStringify(after) === stableStringify(before) && onlyDraftRegistries(after), { before: before.blockers, after: after.blockers });
}

console.log("\n[4] Missing current data and malformed bundles fail closed; nothing throws");
{
  const base = { ...bundleOf(gv), template: approvedT, constants: verified, dataInputs: now };
  const cases = [
    ["no dataInputs", { ...base, dataInputs: undefined }, (b) => b.includes("freshness_unverifiable:data_inputs_missing")],
    ["no current patch", { ...base, dataInputs: {} }, (b) => b.includes("freshness_unverifiable:patch_unknown")],
    ["another current patch", { ...base, dataInputs: { effectivePatch: "P2" } }, (b) => b.includes("stale:review_required")],
    ["no answer key", { ...base, answerKey: undefined }, (b) => b.includes("bundle_incomplete")],
    ["no public scenario", { ...base, publicScenario: null }, (b) => b.includes("bundle_incomplete")],
    ["a forged tier in the answer key", { ...base, answerKey: (() => { const k = copy(gv.answerKey); const id = Object.keys(k.options)[0]; k.options[id].tier = k.options[id].tier === "STRONG" ? "WEAK" : "STRONG"; return k; })() }, (b) => b.includes("stale:review_required") && b.some((x) => x.startsWith("invalid_bundle:decision."))],
    ["a public scenario leaking a tier", { ...base, publicScenario: { ...gv.publicScenario, tier: "STRONG" } }, (b) => b.some((x) => x.startsWith("invalid_bundle:public."))],
    ["a scenario without its material fingerprint", { ...base, scenario: { ...gv.scenario, fingerprints: {} } }, (b) => b.includes("stale:review_required") && (b.includes("freshness:material_signature_unverifiable") || b.some((x) => x.startsWith("invalid_bundle:")))],
    ["an empty scenario", { ...base, scenario: {} }, (b) => b.length > 0],
    ["a malformed rule table", { ...base, template: { ...approvedT, rules: { ...approvedT.rules, terms: null } } }, (b) => b.includes("rules_invalid")],
  ];
  for (const [label, input, expect] of cases) {
    const r = gate(input);
    check(`${label}: blocked with the named blocker, not thrown`, !r.threw && r.servable === false && expect(r.blockers), r);
  }
  const boom = new Proxy({}, { get() { throw new Error("getter"); } });
  const exotic = [undefined, null, 7, "x", boom, { ...base, scenario: boom }, { ...base, template: boom }, { ...base, constants: boom }, { ...base, dataInputs: boom }];
  check("the gate never throws for undefined, primitives or Proxies anywhere in its input", exotic.map(gate).every((r) => !r.threw && r.servable === false && r.blockers.length > 0));
  const fresh = [[undefined, undefined], [null, base], [{ ...bundleOf(gv), scenario: boom }, base], [bundleOf(gv), { ...base, template: boom }], [bundleOf(gv), boom]];
  check("checkFreshness never throws for the same kinds of input", fresh.every((args) => { try { const r = checkFreshness(...args); return r.status === "review_required" && r.reasons.length > 0; } catch { return false; } }));
}

console.log("\n[5] One owner per check: the gate validates exactly once, through checkFreshness");
{
  // Count every property read on the stored answer key: a validation reads it a fixed number of times, the material
  // signature a fixed number, and the gate itself reads nothing of it (it only tests that it is present).
  const counting = (obj) => { let n = 0; const cache = new WeakMap(); const wrap = (o) => { if (o === null || typeof o !== "object") return o; if (cache.has(o)) return cache.get(o); const p = new Proxy(o, { get(t, k, r) { if (typeof k !== "symbol") n += 1; return wrap(Reflect.get(t, k, r)); } }); cache.set(o, p); return p; }; return { key: wrap(copy(obj)), reads: () => n }; };
  const v = counting(gv.answerKey);
  validateScenarioBundle({ ...bundleOf(gv), answerKey: v.key, template: approvedT, constants: verified, dataInputs: now });
  const s = counting(gv.answerKey);
  materialSignature({ scenario: gv.scenario, answerKey: s.key, constants: verified });
  const gk = counting(gv.answerKey);
  const r = gate({ ...bundleOf(gv), answerKey: gk.key, template: approvedT, constants: verified, dataInputs: now });
  check("(setup) the counted bundle gets the same verdict as the plain one", onlyDraftRegistries(r), r.blockers);
  check(`the gate reads the answer key exactly as often as ONE validation plus ONE material signature (${v.reads()} + ${s.reads()} = ${gk.reads()}): no duplicate validation`, gk.reads() === v.reads() + s.reads(), { validate: v.reads(), signature: s.reads(), gate: gk.reads() });
  // The gate's invalid_bundle blockers are exactly checkFreshness's revalidation failures (same source, same names).
  const forged = copy(gv.answerKey);
  forged.options[Object.keys(forged.options)[0]].score += 1;
  const fr = checkFreshness({ ...bundleOf(gv), answerKey: forged }, { template: approvedT, constants: verified, dataInputs: now });
  const gr = gate({ ...bundleOf(gv), answerKey: forged, template: approvedT, constants: verified, dataInputs: now });
  const fromFreshness = fr.reasons.filter((x) => x.startsWith("revalidation_failed:")).map((x) => x.replace("revalidation_failed:", "invalid_bundle:"));
  check("the gate's invalid_bundle blockers are exactly checkFreshness's revalidation failures, renamed", fromFreshness.length > 0 && stableStringify(gr.blockers.filter((x) => x.startsWith("invalid_bundle:"))) === stableStringify(fromFreshness), { fr, gate: gr.blockers });
}

finish();
