// decisionLab -- constants-aware freshness (diff F; proposal: CONSTANTS_IDENTITY_PROPOSAL.md;
// Stage 7 hardening: SERVING_FRESHNESS_CONTRACT_STAGE7.md).
//
//   node tests/decisionLab.freshness.test.mjs
//
// checkFreshness adds the constants' VALUES to freshness detection without
// changing scenario identity. All constants below are synthetic test fixtures.

import { generateScenario } from "../functions/_lib/decisionLab/generator.js";
import { checkFreshness } from "../functions/_lib/decisionLab/validator.js";
import { checkStaleness, stableStringify } from "../functions/_lib/decisionLab/fingerprint.js";
import { OBJECTIVE_TRADE_TEMPLATE as T } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { FIXTURE_CONSTANTS as C, withConstants, copy, createHarness } from "./decisionLab.fixtures.mjs";

const { check, finish } = createHarness();
const bundleOf = (r) => ({ scenario: r.scenario, answerKey: r.answerKey, publicScenario: r.publicScenario });
const fresh = (r, constants, dataInputs = {}) => checkFreshness(bundleOf(r), { template: T, constants, dataInputs });
const g = generateScenario({ seed: 11, constants: C });

console.log("\n[1] Same answers as checkStaleness wherever the values did not change");
{
  let agree = 0, n = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const r = generateScenario({ seed, constants: C });
    n += 1;
    if (stableStringify(fresh(r, C)) === stableStringify(checkStaleness(r.scenario, { constants: C, dataInputs: {} }))) agree += 1;
  }
  check(`unchanged constants: checkFreshness equals checkStaleness (fresh) for all ${n} scenarios of seeds 1-300`, agree === n, { agree, n });
  const bumped = withConstants((c) => { c.version = "fixture.2"; });
  const a = fresh(g, bumped), b = checkStaleness(g.scenario, { constants: bumped, dataInputs: {} });
  check("a version bump alone (same values) is still review_required for the same dependency reason", a.status === "review_required" && b.reasons.every((x) => a.reasons.includes(x)) && a.reasons.every((x) => b.reasons.includes(x)), { a, b });
  const old = generateScenario({ seed: 11, constants: C, versionOverrides: { generatorVersion: "1.0.0" } });
  check("a retired scenario is still retired, with the same reasons", stableStringify(fresh(old, C)) === stableStringify(checkStaleness(old.scenario, { constants: C, dataInputs: {} })) && fresh(old, C).status === "retired");
}

console.log("\n[2] A value change under the SAME version label: invisible to identity and to checkStaleness, visible here when it matters");
{
  const swapped = withConstants((c) => { const d = c.values.objectives.dragon.zone; c.values.objectives.dragon.zone = c.values.objectives.riftHerald.zone; c.values.objectives.riftHerald.zone = d; });
  const regen = generateScenario({ seed: 11, constants: swapped });
  check("(why) identity cannot see it: the same version label gives the same dataFingerprint as before", regen.ok && regen.scenario.provenance.dataFingerprint === g.scenario.provenance.dataFingerprint);
  check("(why) checkStaleness cannot see it: still fresh", checkStaleness(g.scenario, { constants: swapped, dataInputs: {} }).status === "fresh");
  const f = fresh(g, swapped);
  check("checkFreshness sees it: review_required, naming the invariant that no longer holds under the current constants", f.status === "review_required" && f.reasons.includes("revalidation_failed:state.derived_rebuildable"), f);
  const near30 = withConstants((c) => { c.values.travelSec.near = 30; });
  check("a value change that leaves this scenario unchanged keeps it fresh (only relevant values count)", fresh(g, near30).status === "fresh", fresh(g, near30));

  // The material signature is the one stored field that reads a constant (the window range) outside validation.
  const widened = withConstants((c) => { c.values.window.availableInSec = { min: 5, max: 300 }; });
  let found = null;
  for (let seed = 1; seed <= 200 && !found; seed++) {
    const r = generateScenario({ seed, constants: C });
    const fr = fresh(r, widened);
    if (fr.reasons.includes("material_signature_changed")) found = { seed, fr };
  }
  check("a window-range change that moves a scenario's timing bucket is reported as material_signature_changed", !!found && found.fr.status === "review_required", found);
}

console.log("\n[3] Never throws; never changes the scenario");
{
  for (const [label, bundle] of [["an empty scenario", { scenario: {}, answerKey: {}, publicScenario: {} }], ["no answer key", { scenario: g.scenario }], ["a scenario with no provenance", { scenario: { ...g.scenario, provenance: undefined }, answerKey: g.answerKey, publicScenario: g.publicScenario }]]) {
    let r;
    try { r = checkFreshness(bundle, { template: T, constants: C, dataInputs: {} }); } catch (e) { r = { threw: e.message }; }
    check(`${label}: review_required with reasons, not an exception`, !r.threw && r.status === "review_required" && r.reasons.length > 0, r);
  }
  const before = stableStringify(bundleOf(g));
  fresh(g, withConstants((c) => { c.values.info.staleAfterSec = 3; }));
  check("the stored bundle is unchanged after checking (deep-frozen, never edited)", stableStringify(bundleOf(g)) === before && Object.isFrozen(g.scenario.state));
}

console.log("\n[4] The current template: registered content only; resolved from the registry when omitted");
{
  check("an omitted template is resolved from the registry: the same verdict as passing it", stableStringify(checkFreshness(bundleOf(g), { constants: C, dataInputs: {} })) === stableStringify(fresh(g, C)) && fresh(g, C).status === "fresh");
  const same = checkFreshness(bundleOf(g), { template: { ...T, rules: { ...T.rules, signals: { ...T.rules.signals, positiveMin: T.rules.signals.positiveMin + 1 } } }, constants: C, dataInputs: {} });
  check("same labels, other rule content: review_required with revalidation_failed:template.content_matches_registry (nothing is validated against untrusted content)", same.status === "review_required" && stableStringify(same.reasons) === stableStringify(["revalidation_failed:template.content_matches_registry"]), same);
  const broken = copy(T.rules);
  broken.certaintyShift[0] = null;
  const b = checkFreshness(bundleOf(g), { template: { ...T, rules: broken }, constants: C, dataInputs: {} });
  check("a malformed current rule table: review_required with revalidation_failed:template.rules_valid", b.status === "review_required" && b.reasons.includes("revalidation_failed:template.rules_valid"), b);
}

console.log("\n[5] Never throws, for any arguments");
{
  const boom = new Proxy({}, { get() { throw new Error("getter"); }, ownKeys() { throw new Error("keys"); } });
  const cyclic = { ...g.scenario };
  cyclic.self = cyclic;
  const cur = { template: T, constants: C, dataInputs: {} };
  const calls = [
    ["no arguments", []], ["undefined bundle", [undefined, cur]], ["undefined current", [bundleOf(g), undefined]], ["null, null", [null, null]], ["primitives", [5, "x"]],
    ["a throwing Proxy bundle", [boom, cur]], ["a throwing Proxy current", [bundleOf(g), boom]], ["a Proxy scenario", [{ ...bundleOf(g), scenario: boom }, cur]],
    ["a Proxy template", [bundleOf(g), { ...cur, template: boom }]], ["Proxy constants", [bundleOf(g), { ...cur, constants: boom }]], ["Proxy dataInputs", [bundleOf(g), { ...cur, dataInputs: boom }]],
    ["a cyclic scenario", [{ ...bundleOf(g), scenario: cyclic }, cur]], ["an answer key without options", [{ ...bundleOf(g), answerKey: { ...g.answerKey, options: undefined } }, cur]],
    ["a scenario without fingerprints", [{ ...bundleOf(g), scenario: { ...g.scenario, fingerprints: undefined } }, cur]],
  ];
  const results = calls.map(([label, args]) => { try { return [label, checkFreshness(...args)]; } catch (e) { return [label, { threw: e.message }]; } });
  check(`for all ${calls.length} malformed or exotic argument sets: { status: review_required, reasons: [...] }, never an exception`, results.every(([, r]) => !r.threw && r.status === "review_required" && Array.isArray(r.reasons) && r.reasons.length > 0), results.filter(([, r]) => r.threw || r.status !== "review_required"));
  const named = Object.fromEntries(results);
  check("unreadable arguments are the single reason freshness_check_failed; readable but broken ones get named reasons", stableStringify(named["a throwing Proxy current"].reasons) === stableStringify(["freshness_check_failed"]) && named["an answer key without options"].reasons.some((x) => x.startsWith("revalidation_failed:")) && named["a scenario without fingerprints"].reasons.some((x) => x.startsWith("revalidation_failed:") || x === "material_signature_unverifiable"), named);
}

finish();
