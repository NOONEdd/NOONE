// decisionLab -- fingerprints, dependencies and staleness (spec sections 33,
// 43, 62, 75).
//
// Three different things, deliberately kept apart:
//
//  1. scenarioRef        identity of a scenario's CONTENT + every version.
//                        Two seeds that produce the same content are the same
//                        scenario (an exact duplicate).
//  2. material signature "is this a meaningfully different situation?" It
//                        captures structure (template, decision structure,
//                        difficulty, exposed factors and their levels, who has
//                        the access edge, best/defensible actions, ...) and
//                        ignores fake variation such as Dragon in 40s vs 35s
//                        (timers are bucketed) or HP/item noise.
//  3. dataFingerprint    a hash of the DATA a scenario depends on, so stale
//                        scenarios can be detected instead of silently reused.
//
// DATA DEPENDENCY MODEL (extensible on purpose). A dependency is
//   { kind, id, ref }
// with kind in: constants | registry | entity.
//   constants  the coach-verified game constants (id, version, status)
//   registry   factors / tracks / principles registries (their versions)
//   entity     an Academy-backed champion / item / rune / spell REFERENCED BY
//              THE STATE (member.refs). `ref` is a fingerprint of the entity's
//              EFFECTIVE data restricted to the fields the reference declares,
//              supplied by the injected dataInputs.entities resolver.
// The Milestone 1 template never puts entity refs in a state, so it has no
// entity dependencies -- but the collector, fingerprint, validator and
// staleness check already handle them, and adding entity refs to a FUTURE
// scenario version does not change the fingerprint of any existing scenario
// (a scenario with no refs has no entity dependencies, before or after).
//
// Only fields a scenario declares are hashed, so an unrelated Coach Mode edit
// (a blurb typo) does not invalidate scenarios; a change to a referenced
// field does.
//
// dataInputs = {
//   effectivePatch?: string | null,                       // recorded, and compared with constants.verifiedForPatch
//   entities?: { fingerprint(kind, id, fields) -> string | null },
// }
// createAcademyDataInputs() builds one from the repo's real effective-data
// resolvers (src/lib/effectiveData.js) so entity dependencies follow Coach
// Mode overrides exactly as the website and the AI Coach do.

import { STATE_VOCAB, STALENESS, VERSIONS, deepFreeze } from "./config.js";
import { FACTORS_VERSION } from "./factors.js";
import { TRACKS_VERSION } from "./tracks.js";
import { PRINCIPLES_VERSION } from "./principles.js";
import { hash32 } from "./prng.js";
import { constantsIdentity } from "./gameConstants.js";
import { OBJECTIVE_TRADE_TEMPLATE_VERSION, OBJECTIVE_TRADE_RULES_VERSION } from "./templates/objectiveTrade.js";
import { resolveEffectiveChampion, resolveEffectiveItem, resolveEffectiveRune, resolveEffectivePatch, resolvePatchDataStatus } from "../../../src/lib/effectiveData.js";
import { CHAMPIONS } from "../../../src/data/champions.js";
import { ITEMS } from "../../../src/data/items.js";
import { RUNES } from "../../../src/data/runes.js";
import { SPELLS } from "../../../src/data/spells.js";
import { MATCHUPS } from "../../../src/data/matchups.js";
import { STATIC_PATCH_VERSION } from "../../../src/data/patch.js";

// --- Canonical JSON + hash -------------------------------------------------------

/** Canonical JSON: sorted keys, no whitespace, undefined properties dropped.
 *  Throws on anything that cannot be represented deterministically. */
export function stableStringify(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "number") {
    if (!Number.isFinite(value)) throw new TypeError("stableStringify: non-finite number");
    return JSON.stringify(value);
  }
  if (t === "string" || t === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (t === "object") {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
  }
  throw new TypeError(`stableStringify: unsupported type ${t}`);
}

/** 64-bit (two independent 32-bit lanes) hex hash of a string. */
export function hash64(str) {
  const a = hash32(`A|${str}`);
  const b = hash32(`B|${str}`);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

// --- Versions -------------------------------------------------------------------------

export function registryVersions() {
  return { factors: FACTORS_VERSION, tracks: TRACKS_VERSION, principles: PRINCIPLES_VERSION };
}

/** Versions this build can still interpret. A scenario outside these sets is
 *  "retired": kept for audit, never silently re-interpreted. */
export const SUPPORTED_VERSIONS = deepFreeze({
  scenarioSchema: [VERSIONS.scenarioSchema],
  stateSchema: [VERSIONS.stateSchema],
  generator: [VERSIONS.generator],
  templates: { objective_trade: [OBJECTIVE_TRADE_TEMPLATE_VERSION] },
  rules: { objective_trade: [OBJECTIVE_TRADE_RULES_VERSION] },
});

// --- Entity references (the extension point) ----------------------------------------

const ENTITY_FIELD_DEFAULTS = deepFreeze({ champion: ["role", "tier"], item: ["tier", "info"], rune: ["tier", "info"], spell: ["name"] });

function normalizeRef(kind, entry) {
  if (!entry || typeof entry !== "object" || typeof entry.id !== "string") return null;
  const fields = Array.isArray(entry.fields) && entry.fields.length ? entry.fields.slice().sort() : ENTITY_FIELD_DEFAULTS[kind].slice();
  return { kind, id: entry.id, fields };
}

/** Every Academy entity a raw state references, deduplicated and sorted.
 *  Members carry optional `refs: { champion?, items?, runes?, spells? }`. */
export function collectEntityRefs(raw) {
  const found = new Map();
  const add = (kind, entry) => {
    const ref = normalizeRef(kind, entry);
    if (ref) found.set(`${kind}:${ref.id}:${ref.fields.join(",")}`, ref);
  };
  for (const team of ["allies", "enemies"]) {
    for (const slot of STATE_VOCAB.slots) {
      const refs = raw.teams[team].members[slot].refs;
      if (!refs) continue;
      if (refs.champion) add("champion", refs.champion);
      for (const e of refs.items || []) add("item", e);
      for (const e of refs.runes || []) add("rune", e);
      for (const e of refs.spells || []) add("spell", e);
    }
  }
  return Array.from(found.keys())
    .sort()
    .map((k) => found.get(k));
}

/** Dependency list for a scenario: constants + registries + referenced entities. */
export function buildDependencies({ constants, raw, dataInputs }) {
  const c = constantsIdentity(constants);
  const deps = [
    { kind: "constants", id: c.id, ref: `${c.version}|${c.status}` },
    { kind: "registry", id: "factors", ref: String(FACTORS_VERSION) },
    { kind: "registry", id: "tracks", ref: String(TRACKS_VERSION) },
    { kind: "registry", id: "principles", ref: String(PRINCIPLES_VERSION) },
  ];
  for (const r of collectEntityRefs(raw)) {
    const resolver = dataInputs && dataInputs.entities;
    const fp = resolver ? resolver.fingerprint(r.kind, r.id, r.fields) : null;
    deps.push({ kind: "entity", id: `${r.kind}:${r.id}`, ref: fp === undefined ? null : fp, fields: r.fields });
  }
  return deps.sort((a, b) => (a.kind + a.id < b.kind + b.id ? -1 : a.kind + a.id > b.kind + b.id ? 1 : 0));
}

export function computeDataFingerprint(dependencies) {
  return hash64(stableStringify(dependencies));
}

// --- scenarioRef ----------------------------------------------------------------------------

/** Content identity. Excludes how the scenario was produced (seed, candidate
 *  index, selection digest, origin) so identical content is one scenario. */
export function computeScenarioRef({ scenarioVersion, stateSchemaVersion, template, generatorVersion, registries, constants, dataFingerprint, difficulty, decision, raw }) {
  const body = { scenarioVersion, stateSchemaVersion, template, generatorVersion, registries, constants, dataFingerprint, difficulty, decision, raw };
  return `sc_${hash64(stableStringify(body))}`;
}

// --- Material fingerprint ---------------------------------------------------------------------

function timingBucket(raw, primary, constants) {
  const o = raw.objectives[primary];
  if (o.activity === "enemy_taking") return "taking";
  if (o.availableInSec === 0) return "live";
  const w = constants.values.window.availableInSec;
  const third = Math.max(1, Math.ceil((w.max - w.min + 1) / 3));
  return `t${Math.min(2, Math.max(0, Math.floor((o.availableInSec - w.min) / third)))}`;
}

/** Flat map of the fields that make a scenario materially different. Values
 *  are short strings so neighbours can be compared field by field. */
export function materialSignature({ scenario, answerKey, constants }) {
  const raw = scenario.state.raw;
  const d = scenario.decision;
  const options = answerKey.options;
  const actionOf = (id) => options[id].actionType;
  const exposed = Object.keys(answerKey.factorEvidence)
    .filter((f) => answerKey.factorEvidence[f].exposed)
    .map((f) => `${f}:${answerKey.factorEvidence[f].level}`)
    .sort();
  return {
    template: scenario.template.id,
    structure: d.structure,
    difficulty: String(scenario.difficulty),
    primary: d.primaryObjective,
    window: raw.gameContext.windowKind,
    timing: timingBucket(raw, d.primaryObjective, constants),
    factors: exposed.join(","),
    options: d.options.map((o) => o.actionType).sort().join(","),
    tiers: Object.keys(options).map((id) => `${actionOf(id)}=${options[id].tier}`).sort().join(","),
    best: answerKey.best.map(actionOf).sort().join(","),
    info: scenario.state.derived.infoQuality.level,
    shape: answerKey.analysis.conflict ? "conflicting" : "aligned",
  };
}

export function materialKey(signature) {
  return stableStringify(signature);
}

export function materialFingerprint(signature) {
  return hash64(materialKey(signature));
}

/** Number of signature fields in which two signatures differ. */
export function signatureDistance(a, b) {
  let n = 0;
  for (const k of Object.keys(a)) if (a[k] !== b[k]) n += 1;
  return n;
}

// --- Staleness -------------------------------------------------------------------------------------

/** Compare a stored scenario with the CURRENT data.
 *  current = { constants, dataInputs }
 *  Returns { status: fresh | review_required | retired, reasons: [...] }.
 *  Never mutates the scenario. `retired` = built with versions this build no
 *  longer supports; `review_required` = a dependency changed. */
export function checkStaleness(scenario, current) {
  const reasons = [];
  const p = scenario.provenance;
  const s = SUPPORTED_VERSIONS;
  const retire = [];
  if (!s.scenarioSchema.includes(p.scenarioVersion)) retire.push(`version_unavailable:scenarioSchema:${p.scenarioVersion}`);
  if (!s.stateSchema.includes(p.stateSchemaVersion)) retire.push(`version_unavailable:stateSchema:${p.stateSchemaVersion}`);
  if (!s.generator.includes(p.generatorVersion)) retire.push(`version_unavailable:generator:${p.generatorVersion}`);
  if (!(s.templates[p.templateId] || []).includes(p.templateVersion)) retire.push(`version_unavailable:template:${p.templateId}@${p.templateVersion}`);
  if (!(s.rules[p.templateId] || []).includes(p.rulesVersion)) retire.push(`version_unavailable:rules:${p.rulesVersion}`);
  if (retire.length) return { status: STALENESS[2], reasons: retire };

  const now = buildDependencies({ constants: current.constants, raw: scenario.state.raw, dataInputs: current.dataInputs });
  const before = new Map(p.dependencies.map((d) => [`${d.kind}:${d.id}`, d]));
  const after = new Map(now.map((d) => [`${d.kind}:${d.id}`, d]));
  for (const key of Array.from(new Set([...before.keys(), ...after.keys()])).sort()) {
    const b = before.get(key);
    const a = after.get(key);
    if (!b || !a || b.ref !== a.ref) reasons.push(`dependency_changed:${key}`);
  }
  for (const d of now) if (d.kind === "entity" && d.ref === null) reasons.push(`dependency_unresolved:${d.kind}:${d.id}`);
  const c = current.constants;
  const patch = current.dataInputs && current.dataInputs.effectivePatch;
  if (c.status === "VERIFIED" && typeof patch === "string" && c.verifiedForPatch !== patch) reasons.push("constants_not_verified_for_current_patch");
  return { status: reasons.length ? STALENESS[1] : STALENESS[0], reasons };
}

// --- Academy adapter (real effective data) --------------------------------------------------------------

function pickFields(record, fields) {
  const out = {};
  for (const f of fields) out[f] = record[f] === undefined ? null : record[f];
  return out;
}

/** dataInputs backed by the repo's real effective-data resolvers, so entity
 *  dependencies follow Coach Mode overrides exactly as the site does.
 *  `overrides` is the same object functions/_lib/kv.js fetchOverrides returns. */
export function createAcademyDataInputs({ overrides = {} } = {}) {
  const effectivePatch = resolveEffectivePatch(overrides.patch, STATIC_PATCH_VERSION);
  const patchStatus = resolvePatchDataStatus(overrides, effectivePatch);
  const lookup = {
    champion: (id) => {
      const base = CHAMPIONS.find((c) => c.id === id);
      return base ? resolveEffectiveChampion(base, (overrides.champions || {})[id], MATCHUPS[id]) : null;
    },
    item: (id) => {
      const base = ITEMS.find((i) => i.id === id);
      return base ? resolveEffectiveItem(base, (overrides.items || {})[id]) : null;
    },
    rune: (id) => {
      const base = RUNES.find((r) => r.id === id);
      return base ? resolveEffectiveRune(base, (overrides.runes || {})[id]) : null;
    },
    spell: (id) => SPELLS.find((s) => s.id === id) || null,
  };
  return {
    effectivePatch,
    patchDataStatus: patchStatus.status,
    entities: {
      fingerprint(kind, id, fields) {
        const find = lookup[kind];
        if (!find) return null;
        const record = find(id);
        return record ? hash64(stableStringify(pickFields(record, fields || ENTITY_FIELD_DEFAULTS[kind]))) : null;
      },
    },
  };
}
