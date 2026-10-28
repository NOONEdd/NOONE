// decisionLab -- determinism, versioning and extensibility tests.
//
//   node tests/decisionLab.determinism.test.mjs
//
// Proves the reproducibility contract documented in config.js:
//   * same seed + versions + data + selection context => deep-equal output,
//     in-process and across a fresh process;
//   * PRNG behaviour is pinned (known-answer vector) and sub-streams are
//     independent;
//   * the rule table, registries and constants are LOCKED to their versions:
//     changing content without bumping the version fails a test here;
//   * versions, dataFingerprint and provenance move exactly when they should;
//   * stale scenarios are detected, never edited, never deleted;
//   * future Academy-backed entity references (champion/item/rune/spell ids)
//     work without any schema change and without disturbing existing
//     scenarios;
//   * the engine source uses no clock, Math.random, locale, network, storage,
//     LLM, UI or runtime-specific API.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { generateScenario, assembleScenario } from "../functions/_lib/decisionLab/generator.js";
import { validateScenarioBundle } from "../functions/_lib/decisionLab/validator.js";
import { createRng } from "../functions/_lib/decisionLab/prng.js";
import { stableStringify, hash64, checkStaleness, computeDataFingerprint, buildDependencies, registryVersions, createAcademyDataInputs, collectEntityRefs, SUPPORTED_VERSIONS } from "../functions/_lib/decisionLab/fingerprint.js";
import { OBJECTIVE_TRADE_TEMPLATE as T, OBJECTIVE_TRADE_RULES, OBJECTIVE_TRADE_DATA, OBJECTIVE_TRADE_RULES_VERSION, OBJECTIVE_TRADE_TEMPLATE_VERSION } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { FACTORS, FACTORS_VERSION } from "../functions/_lib/decisionLab/factors.js";
import { TRACKS, TRACKS_VERSION } from "../functions/_lib/decisionLab/tracks.js";
import { PRINCIPLES, PRINCIPLES_VERSION } from "../functions/_lib/decisionLab/principles.js";
import { VERSIONS } from "../functions/_lib/decisionLab/config.js";
import { CHAMPIONS } from "../src/data/champions.js";
import { ITEMS } from "../src/data/items.js";
import { RUNES } from "../src/data/runes.js";
import { SPELLS } from "../src/data/spells.js";
import { FIXTURE_CONSTANTS as C, withConstants, makeFakeResolver, craft, setPath, moveAllies, copy, createHarness } from "./decisionLab.fixtures.mjs";

const { check, finish } = createHarness();
const gen = (seed, extra = {}) => generateScenario({ seed, constants: C, ...extra });
const whole = (r) => stableStringify({ s: r.scenario, k: r.answerKey, p: r.publicScenario });

console.log("\n[1] PRNG: pinned, seeded, and stage-independent");
{
  const a = createRng(12345, "root");
  check("known-answer vector for seed 12345 is unchanged (any PRNG change must bump the generator version)", [a.u32(), a.u32(), a.u32(), a.u32(), a.u32()].join() === "2082966162,3456063581,927988441,999025164,3748644877");
  const b = createRng("abc", "a/b");
  check("known-answer vector for string seed 'abc' / path a/b is unchanged", [b.u32(), b.u32(), b.u32()].join() === "1641518433,3726257991,2891971116");
  check("the same seed and path give the same stream", createRng(9, "x").u32() === createRng(9, "x").u32());
  check("different seeds give different streams", createRng(9, "x").u32() !== createRng(10, "x").u32());
  check("different paths give different streams", createRng(9, "x").u32() !== createRng(9, "y").u32());
  const p1 = createRng(5, "x");
  const c1 = p1.fork("c");
  const first = [c1.u32(), c1.u32()];
  const p2 = createRng(5, "x");
  p2.u32(); p2.u32(); p2.u32(); // consume the parent
  const sibling = p2.fork("other");
  sibling.u32(); sibling.u32(); // consume an unrelated sibling
  const c2 = p2.fork("c");
  check("a named sub-stream is unaffected by draws from its parent or siblings (adding a draw in one stage cannot shift another)", [c2.u32(), c2.u32()].join() === first.join());
  const d = createRng(3, "u");
  const faces = new Array(7).fill(0);
  for (let i = 0; i < 60000; i++) faces[d.int(1, 6)] += 1;
  check("int(1,6) is inclusive at both ends and roughly uniform over 60,000 draws", faces[0] === 0 && faces[1] > 9000 && faces[6] > 9000 && faces.slice(1).every((n) => n > 9300 && n < 10700), faces);
  const w = createRng(4, "w");
  let heavy = 0;
  for (let i = 0; i < 20000; i++) if (w.weightedPick(["a", "b"], [3, 1]) === "a") heavy += 1;
  check("weightedPick honours integer weights (3:1 gives about 75%)", heavy > 14500 && heavy < 15500, heavy);
  check("shuffle is a permutation and deterministic", (() => { const s1 = createRng(8, "s").shuffle([1, 2, 3, 4, 5, 6]); const s2 = createRng(8, "s").shuffle([1, 2, 3, 4, 5, 6]); return s1.join() === s2.join() && [...s1].sort().join() === "1,2,3,4,5,6"; })());
  check("weights must be positive integers (no floating point in selection)", (() => { try { createRng(1, "q").weightedPick(["a"], [1.5]); return false; } catch { return true; } })());
}

console.log("\n[2] Same inputs => identical output");
{
  let same = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const a = gen(seed);
    const b = gen(seed);
    const c = gen(seed);
    if (whole(a) === whole(b) && whole(b) === whole(c)) same += 1;
  }
  check("200 seeds x 3 runs: scenario, answer key and public scenario are identical (deepEqual = true)", same === 200, same);
  check("pinned difficulty is reproducible", [1, 2, 3, 4].every((d) => whole(gen(77, { difficulty: d })) === whole(gen(77, { difficulty: d }))));
  const ctx = { avoidMaterialKeys: ["x"], avoidScenarioRefs: ["y"] };
  check("the same selection context is reproducible", whole(gen(33, { selectionContext: ctx })) === whole(gen(33, { selectionContext: ctx })));
  check("string seeds are reproducible", whole(gen("player-42-session-7")) === whole(gen("player-42-session-7")));
  const refs = new Set();
  for (let seed = 1; seed <= 300; seed++) refs.add(gen(seed).scenario.scenarioRef);
  check("different seeds give different scenarios", refs.size >= 299, refs.size);

  const url = (p) => new URL(p, import.meta.url).href;
  const code = `
    import { generateScenario } from ${JSON.stringify(url("../functions/_lib/decisionLab/generator.js"))};
    import { stableStringify, hash64 } from ${JSON.stringify(url("../functions/_lib/decisionLab/fingerprint.js"))};
    import { FIXTURE_CONSTANTS } from ${JSON.stringify(url("./decisionLab.fixtures.mjs"))};
    let acc = "";
    for (let seed = 1; seed <= 40; seed++) { const r = generateScenario({ seed, constants: FIXTURE_CONSTANTS }); acc += stableStringify({ s: r.scenario, k: r.answerKey, p: r.publicScenario }); }
    console.log(hash64(acc));`;
  const child = execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8" }).trim();
  let acc = "";
  for (let seed = 1; seed <= 40; seed++) acc += whole(gen(seed));
  check("a fresh process produces byte-identical output for seeds 1-40 (no dependence on process state, clock or module load order)", child === hash64(acc), { child, here: hash64(acc) });
}

console.log("\n[3] Version locks: content cannot change without a version bump");
{
  check("template version, rules version and registry versions are the ones these pins were taken at", OBJECTIVE_TRADE_TEMPLATE_VERSION === 3 && OBJECTIVE_TRADE_RULES_VERSION === "objective_trade.rules.3" && FACTORS_VERSION === 2 && TRACKS_VERSION === 1 && PRINCIPLES_VERSION === 2);
  check("rule table content is locked to objective_trade.rules.3 (edit it => bump the version and re-pin)", hash64(stableStringify(OBJECTIVE_TRADE_RULES)) === "66b10b3f6a1a3958", hash64(stableStringify(OBJECTIVE_TRADE_RULES)));
  check("template data is locked to template version 3", hash64(stableStringify(OBJECTIVE_TRADE_DATA)) === "70e5aa0a0a1f7cc3", hash64(stableStringify(OBJECTIVE_TRADE_DATA)));
  check("factor registry is locked to factors v2", hash64(stableStringify(FACTORS)) === "9d80042282c66916", hash64(stableStringify(FACTORS)));
  check("track registry is locked to tracks v1", hash64(stableStringify(TRACKS)) === "40d14776330029c2", hash64(stableStringify(TRACKS)));
  check("principle registry is locked to principles v2", hash64(stableStringify(PRINCIPLES)) === "560ef41694da8628", hash64(stableStringify(PRINCIPLES)));
  check("the test fixture constants are locked (their version string cannot drift silently)", hash64(stableStringify(C)) === "20559154379af6e1", hash64(stableStringify(C)));
  check("stableStringify is key-order independent", stableStringify({ b: 1, a: { d: [1, 2], c: null } }) === stableStringify({ a: { c: null, d: [1, 2] }, b: 1 }));
  check("stableStringify refuses non-finite numbers and functions", (() => { try { stableStringify({ a: NaN }); return false; } catch { /* ok */ } try { stableStringify({ f() {} }); return false; } catch { return true; } })());
}

console.log("\n[4] Provenance and version metadata move exactly when they should");
{
  const base = gen(11);
  const p = base.scenario.provenance;
  check("provenance records every version the spec requires", p.scenarioVersion === VERSIONS.scenarioSchema && p.stateSchemaVersion === VERSIONS.stateSchema && p.templateVersion === 3 && p.generatorVersion === VERSIONS.generator && p.rulesVersion === "objective_trade.rules.3" && /^[0-9a-f]{16}$/.test(p.dataFingerprint));
  check("registries and constants identity are recorded", JSON.stringify(p.registries) === JSON.stringify(registryVersions()) && p.constants.status === "TEST_FIXTURE" && p.constants.version === "fixture.1" && p.constants.id === "objective_trade");
  check("dataFingerprint is the hash of the recorded dependency list", computeDataFingerprint(p.dependencies) === p.dataFingerprint && p.dependencies.some((d) => d.kind === "constants") && p.dependencies.filter((d) => d.kind === "registry").length === 3);
  check("how to reproduce it is recorded (seed, candidate index, selection digest, requested difficulty)", p.reproduction.seed === 11 && Number.isInteger(p.reproduction.candidateIndex) && typeof p.reproduction.selectionDigest === "string" && p.reproduction.requestedDifficulty === null);
  const replay = gen(p.reproduction.seed, { difficulty: p.reproduction.requestedDifficulty });
  check("a scenario can be regenerated from its own provenance (same scenarioRef)", replay.scenario.scenarioRef === base.scenario.scenarioRef);
  check("origin and immutability fields are present", base.scenario.origin === "generated" && Object.isFrozen(base.scenario));

  const bumped = gen(11, {});
  const v2 = generateScenario({ seed: 11, constants: withConstants((c) => { c.version = "fixture.2"; }) });
  check("bumping constants.version: same situation (state unchanged)...", stableStringify(v2.scenario.state.raw) === stableStringify(base.scenario.state.raw));
  check("...but a new dataFingerprint, a new scenarioRef, and the new version in provenance", v2.scenario.provenance.dataFingerprint !== p.dataFingerprint && v2.scenario.scenarioRef !== base.scenario.scenarioRef && v2.scenario.provenance.constants.version === "fixture.2");
  const ver = generateScenario({ seed: 11, constants: withConstants((c) => { c.status = "VERIFIED"; c.verifiedForPatch = "fixture-patch"; c.version = "fixture.verified"; }) });
  check("constants status is part of the dependency (VERIFIED vs TEST_FIXTURE changes the fingerprint)", ver.ok && ver.scenario.provenance.dataFingerprint !== p.dataFingerprint && ver.scenario.provenance.constants.status === "VERIFIED");
  check("unchanged inputs keep the identical scenarioRef", bumped.scenario.scenarioRef === base.scenario.scenarioRef);

  const overrides = { generatorVersion: "9.9.9", rulesVersion: "objective_trade.rules.9", templateVersion: 9 };
  for (const [name, ov, reasonPrefix] of [["generatorVersion", { generatorVersion: "9.9.9" }, "version_unavailable:generator"], ["rulesVersion", { rulesVersion: "objective_trade.rules.9" }, "version_unavailable:rules"], ["templateVersion", { templateVersion: 9 }, "version_unavailable:template"]]) {
    const r = gen(11, { versionOverrides: ov });
    check(`changing ${name} changes provenance and scenarioRef`, r.scenario.provenance[name] === Object.values(ov)[0] && r.scenario.scenarioRef !== base.scenario.scenarioRef);
    const st = checkStaleness(r.scenario, { constants: C, dataInputs: {} });
    check(`a scenario built under an unsupported ${name} is retired (kept for audit, not re-interpreted)`, st.status === "retired" && st.reasons.some((x) => x.startsWith(reasonPrefix)), st);
  }
  void overrides;
  const prev = gen(11, { versionOverrides: { generatorVersion: "1.0.0", rulesVersion: "objective_trade.rules.1", templateVersion: 1 } });
  const prevSt = checkStaleness(prev.scenario, { constants: C, dataInputs: {} });
  check("a scenario stamped with the PREVIOUS milestone's versions (generator 1.0.0, rules.1, template 1) is retired -- kept for audit, never silently reinterpreted under the new rules", prevSt.status === "retired" && prevSt.reasons.length === 3 && prevSt.reasons.every((x) => x.startsWith("version_unavailable")), prevSt);
  check("the state schema is 2 (fightability derived per objective); the scenario schema is 3 (answer keys carry per-option factor influences and registry versions)", VERSIONS.stateSchema === 2 && base.scenario.state.schemaVersion === 2 && VERSIONS.scenarioSchema === 3 && base.answerKey.answerKeySchema === 3);
  const sel1 = gen(11, { selectionContext: { avoidMaterialKeys: ["a"] } });
  const sel2 = gen(11, { selectionContext: { avoidMaterialKeys: ["b"] } });
  check("the selection-context digest is recorded and differs when the context differs", sel1.scenario.provenance.reproduction.selectionDigest !== sel2.scenario.provenance.reproduction.selectionDigest);
  check("supported versions are declared for the staleness check", SUPPORTED_VERSIONS.templates.objective_trade.includes(3) && SUPPORTED_VERSIONS.generator.includes(VERSIONS.generator));
}

console.log("\n[5] Staleness: detected, never edited, never deleted");
{
  const r = gen(21);
  const s = r.scenario;
  const before = stableStringify(s);
  check("unchanged data => fresh", checkStaleness(s, { constants: C, dataInputs: {} }).status === "fresh");
  const st = checkStaleness(s, { constants: withConstants((c) => { c.version = "fixture.2"; }), dataInputs: {} });
  check("changed constants => review_required, naming the dependency", st.status === "review_required" && st.reasons.includes("dependency_changed:constants:objective_trade"), st);
  check("checking staleness does not mutate the scenario (original State preserved for audit)", stableStringify(s) === before && Object.isFrozen(s.state));
  check("the scenario can be mutated by nobody", (() => { try { s.state.raw.gameContext.gameTimeSec = 1; return false; } catch (e) { return e instanceof TypeError; } })());
  check("its state is unchanged after the failed mutation", stableStringify(s) === before);
  const verified = generateScenario({ seed: 21, constants: withConstants((c) => { c.status = "VERIFIED"; c.verifiedForPatch = "P1"; c.version = "fixture.verified"; }) });
  const cVer = withConstants((c) => { c.status = "VERIFIED"; c.verifiedForPatch = "P1"; c.version = "fixture.verified"; });
  check("verified constants + same patch => fresh", checkStaleness(verified.scenario, { constants: cVer, dataInputs: { effectivePatch: "P1" } }).status === "fresh");
  const patchMove = checkStaleness(verified.scenario, { constants: cVer, dataInputs: { effectivePatch: "P2" } });
  check("a patch bump makes scenarios built on constants verified for the OLD patch review_required (mirrors resolvePatchDataStatus's exact-match rule)", patchMove.status === "review_required" && patchMove.reasons.includes("constants_not_verified_for_current_patch"), patchMove);
  check("no patch ordering is assumed (equality only)", checkStaleness(verified.scenario, { constants: cVer, dataInputs: { effectivePatch: "0.0" } }).status === "review_required");
  const fixtureUnderPatch = checkStaleness(s, { constants: C, dataInputs: { effectivePatch: "anything" } });
  check("TEST_FIXTURE constants are not patch-verified and are not flagged for it", fixtureUnderPatch.status === "fresh");
}

console.log("\n[6] Extensibility: Academy-backed entity references, no redesign, no breakage");
{
  const facts = {
    "champion:fixture_champion_a": { tier: "S", role: "Enchanter", blurb: "one" },
    "item:fixture_item_a": { tier: "A", info: "x" },
    "spell:fixture_spell_a": { name: "n" },
  };
  const mutate = (r) => {
    setPath(r, "objectives.dragon.stakes", "high"); moveAllies(r, ["baron"], "mid"); moveAllies(r, ["jungle"], "bot_side");
  };
  const withRefs = (r) => {
    mutate(r);
    r.teams.allies.members.support.refs = { champion: { id: "fixture_champion_a", fields: ["tier"] }, items: [{ id: "fixture_item_a" }], spells: [{ id: "fixture_spell_a" }] };
  };
  const plain = craft({ structure: "CONTEST_VS_TRADE", actions: ["CONTEST", "TRADE"], difficulty: 2, mutate, dataInputs: { entities: makeFakeResolver(facts) } });
  const rich = craft({ structure: "CONTEST_VS_TRADE", actions: ["CONTEST", "TRADE"], difficulty: 2, mutate: withRefs, dataInputs: { entities: makeFakeResolver(facts) } });
  check("(setup) both scenarios are valid", plain.ok && rich.ok, [plain.violations, rich.violations]);
  check("the state schema accepts entity references with no schema change (same schema versions)", rich.scenario.provenance.stateSchemaVersion === plain.scenario.provenance.stateSchemaVersion && rich.scenario.provenance.scenarioVersion === plain.scenario.provenance.scenarioVersion);
  check("references become data dependencies (champion, item, spell)", rich.scenario.provenance.dependencies.filter((d) => d.kind === "entity").map((d) => d.id).join() === "champion:fixture_champion_a,item:fixture_item_a,spell:fixture_spell_a", rich.scenario.provenance.dependencies);
  check("...which changes the dataFingerprint relative to the same situation without references", rich.scenario.provenance.dataFingerprint !== plain.scenario.provenance.dataFingerprint);
  check("the answer key is unchanged by references (rules consume archetypes, not entities)", stableStringify(rich.answerKey.options) === stableStringify(plain.answerKey.options));
  check("references pass through the public projection and leak nothing", rich.publicScenario.state.teams.allies.members.support.refs.champion.id === "fixture_champion_a" && validateScenarioBundle({ scenario: rich.scenario, answerKey: rich.answerKey, publicScenario: rich.publicScenario, template: T, constants: C, dataInputs: { entities: makeFakeResolver(facts) } }).ok);

  const resolverNow = (patch) => ({ constants: C, dataInputs: { entities: makeFakeResolver({ ...facts, ...patch }) } });
  check("unchanged entity data => fresh", checkStaleness(rich.scenario, resolverNow({})).status === "fresh");
  const tierMove = checkStaleness(rich.scenario, resolverNow({ "champion:fixture_champion_a": { ...facts["champion:fixture_champion_a"], tier: "B" } }));
  check("a change to a DECLARED field (champion tier) => review_required naming the entity", tierMove.status === "review_required" && tierMove.reasons.includes("dependency_changed:entity:champion:fixture_champion_a"), tierMove);
  const blurbMove = checkStaleness(rich.scenario, resolverNow({ "champion:fixture_champion_a": { ...facts["champion:fixture_champion_a"], blurb: "typo fixed" } }));
  check("a change to an UNDECLARED field (a blurb edit) does not invalidate the scenario", blurbMove.status === "fresh", blurbMove);
  const itemMove = checkStaleness(rich.scenario, resolverNow({ "item:fixture_item_a": { tier: "A", info: "rebalanced" } }));
  check("a change to a referenced item's default fields => review_required", itemMove.status === "review_required" && itemMove.reasons.includes("dependency_changed:entity:item:fixture_item_a"));
  const gone = checkStaleness(rich.scenario, { constants: C, dataInputs: { entities: makeFakeResolver({ "item:fixture_item_a": facts["item:fixture_item_a"], "spell:fixture_spell_a": facts["spell:fixture_spell_a"] }) } });
  check("a referenced entity that no longer resolves is reported", gone.status === "review_required" && gone.reasons.some((x) => x.startsWith("dependency_unresolved:entity:champion")), gone);
  const noResolver = craft({ structure: "CONTEST_VS_TRADE", actions: ["CONTEST", "TRADE"], difficulty: 2, mutate: withRefs, dataInputs: {} });
  check("references without a resolver are a validation failure (never silently accepted)", noResolver.ok === false && noResolver.violations.some((v) => v.id === "structure.entity_refs_shape"), noResolver.violations);
  const unknown = craft({ structure: "CONTEST_VS_TRADE", actions: ["CONTEST", "TRADE"], difficulty: 2, mutate: withRefs, dataInputs: { entities: makeFakeResolver({}) } });
  check("references to entities that do not exist are a validation failure", unknown.ok === false && unknown.violations.some((v) => v.id === "structure.entity_refs_shape"));

  // Backward compatibility: scenarios that predate references are untouched.
  const gen1 = gen(31);
  const gen1b = generateScenario({ seed: 31, constants: C, dataInputs: { entities: makeFakeResolver(facts), effectivePatch: "whatever" } });
  check("a scenario with no references has the same dataFingerprint whether or not a resolver exists (existing versions are unaffected)", gen1.scenario.provenance.dataFingerprint === gen1b.scenario.provenance.dataFingerprint && gen1.scenario.scenarioRef === gen1b.scenario.scenarioRef);
  check("...and stays fresh once entity support is present", checkStaleness(gen1.scenario, { constants: C, dataInputs: { entities: makeFakeResolver(facts) } }).status === "fresh");
  check("collectEntityRefs finds none in an MVP scenario", collectEntityRefs(gen1.scenario.state.raw).length === 0);

  // The real adapter: effective Academy data, following Coach Mode overrides.
  const champ = CHAMPIONS.find((c) => c.tier) || CHAMPIONS[0];
  const otherTier = champ.tier === "S" ? "A" : "S";
  const live = createAcademyDataInputs({ overrides: {} });
  const edited = createAcademyDataInputs({ overrides: { champions: { [champ.id]: { tier: otherTier } } } });
  const fpTier = (d) => d.entities.fingerprint("champion", champ.id, ["tier"]);
  check("the real adapter resolves real Academy champions, items, runes and spells by id", [live.entities.fingerprint("champion", champ.id, ["tier"]), live.entities.fingerprint("item", ITEMS[0].id, ["tier", "info"]), live.entities.fingerprint("rune", RUNES[0].id, ["tier", "info"]), live.entities.fingerprint("spell", SPELLS[0].id, ["name"])].every((x) => typeof x === "string" && x.length > 0));
  check("an id that is not in Academy data resolves to null", live.entities.fingerprint("champion", "no_such_champion", ["tier"]) === null);
  check("a Coach Mode override of a declared field changes the entity fingerprint", fpTier(live) !== fpTier(edited));
  check("...but not the fingerprint of a field the override did not touch (field-scoped)", live.entities.fingerprint("champion", champ.id, ["role"]) === edited.entities.fingerprint("champion", champ.id, ["role"]));
  const academyScenario = craft({ structure: "CONTEST_VS_TRADE", actions: ["CONTEST", "TRADE"], difficulty: 2, dataInputs: live, mutate: (r) => { mutate(r); r.teams.allies.members.support.refs = { champion: { id: champ.id, fields: ["tier"] } }; } });
  check("a scenario referencing a REAL Academy champion id is valid and depends on it", academyScenario.ok && academyScenario.scenario.provenance.dependencies.some((d) => d.id === `champion:${champ.id}`), academyScenario.violations);
  check("end to end: a Coach Mode edit to that champion makes the scenario review_required", checkStaleness(academyScenario.scenario, { constants: C, dataInputs: edited }).status === "review_required");
  check("...and an unrelated edit (a different champion) does not", (() => { const other = CHAMPIONS.find((c) => c.id !== champ.id); return checkStaleness(academyScenario.scenario, { constants: C, dataInputs: createAcademyDataInputs({ overrides: { champions: { [other.id]: { tier: "B" } } } }) }).status === "fresh"; })());
  void buildDependencies;
}

console.log("\n[7] Source purity: no clock, Math.random, locale, network, storage, LLM, UI or runtime-specific API");
{
  const root = new URL("../functions/_lib/decisionLab/", import.meta.url).pathname.replace(/%20/g, " ");
  const files = [];
  const walk = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") && files.push(p); } };
  walk(root);
  const banned = [
    ["Math.random", /\bMath\.random\b/], ["Date", /\bDate\b/], ["performance.now", /\bperformance\s*\.\s*(now|mark|measure)\b/], ["Intl", /\bIntl\b/], ["toLocale*", /toLocale\w*/], ["localeCompare", /localeCompare/],
    ["process", /\bprocess\b/], ["fetch", /\bfetch\s*\(/], ["XMLHttpRequest", /XMLHttpRequest/], ["crypto", /\bcrypto\b/], ["require", /\brequire\s*\(/], ["dynamic import", /\bimport\s*\(/],
    ["browser storage/DOM", /\b(localStorage|sessionStorage|indexedDB)\b|(?<![.\w"'])(window|document|navigator|globalThis)\s*[.\[]/], ["timers", /\b(setTimeout|setInterval|queueMicrotask)\b/], ["async/await", /\b(async|await)\b/],
    ["LLM/provider", /callAIProvider|anthropic|openai|aiProvider/i], ["worker env/KV", /\b(env\.\w+|COACH_KV|KVNamespace)\b/], ["react/lucide", /\b(react|lucide)\b/i],
  ];
  const hits = [];
  const badImports = [];
  for (const f of files) {
    const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const [name, re] of banned) if (re.test(code)) hits.push(`${f.replace(root, "")}: ${name}`);
    for (const m of code.matchAll(/from\s+"([^"]+)"/g)) {
      const spec = m[1];
      const rel = f.replace(root, "");
      const ok = /^\.\.?\//.test(spec) && (!spec.includes("src/") || rel === "fingerprint.js") && !spec.startsWith("node:");
      if (!ok) badImports.push(`${rel} imports ${spec}`);
    }
  }
  check(`scanned all ${files.length} engine source files`, files.length === 16, files.length);
  check("no banned API appears in any engine file", hits.length === 0, hits);
  check("engine files import only each other (plus fingerprint.js, which reads repo Academy data), never node:, API, UI or provider code", badImports.length === 0, badImports);
  check("only fingerprint.js reaches into src/ (the effective-data resolvers)", files.filter((f) => /from\s+"[^"]*src\//.test(readFileSync(f, "utf8"))).map((f) => f.replace(root, "")).join() === "fingerprint.js");
}

finish();
