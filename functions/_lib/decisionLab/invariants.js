// decisionLab -- invariant registry (spec sections 31-32).
//
// Each invariant is { id, layer, description, check(ctx) -> string[] } where
// an empty array means "holds". ids are exactly the ones the template
// declares (template.invariants); tests fail if the two ever disagree.
// A check never throws: validator.js wraps each one and turns an exception
// into a violation, so a malformed scenario can be reported, not crash the
// validator.
//
// ctx = { scenario, answerKey, publicScenario, template, constants, dataInputs }
//
// Layers (spec section 31):
//   structure  shape, versions, identity, immutability, enumerations
//   state      internal consistency of the raw/derived state
//   decision   options, structure, availability, answer-key integrity
//   edu        educational validity: factors, difficulty, evaluability
//   public     what the player receives (no answer-key leakage)

import { STATE_VOCAB, TIERS, CERTAINTY, ORIGINS, STAGES, DEFENSIBLE_TIERS, DIFFICULTY_PROFILES, VERSIONS } from "./config.js";
import { FACTORS, FACTOR_IDS } from "./factors.js";
import { TRACKS } from "./tracks.js";
import { PRINCIPLES } from "./principles.js";
import { deriveState, laneOfZone } from "./relationships.js";
import { projectPublicState, goldCoherentWithItems } from "./stateBuilder.js";
import { recomputeAnswerKey } from "./scoring.js";
import { stableStringify, computeScenarioRef, computeDataFingerprint, collectEntityRefs } from "./fingerprint.js";

const V = STATE_VOCAB;

// --- helpers ---------------------------------------------------------------------

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isInt = (x) => typeof x === "number" && Number.isInteger(x);
const sameKeys = (obj, keys) => {
  const a = Object.keys(obj).sort();
  const b = keys.slice().sort();
  return a.length === b.length && a.every((k, i) => k === b[i]);
};
const eq = (a, b) => stableStringify(a) === stableStringify(b);

export function isDeepFrozen(value) {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Object.keys(value).every((k) => isDeepFrozen(value[k]));
}

function getPath(root, path) {
  let cur = root;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

const membersOf = (raw, team) => V.slots.map((s) => [s, raw.teams[team].members[s]]);
const aliveIn = (raw, team, zone) => V.slots.some((s) => raw.teams[team].members[s].status === "alive" && raw.teams[team].members[s].zone === zone);

/** Effective factor rules for the scenario's decision structure. */
export function effectiveFactorRules(template, structureName) {
  const s = template.structures[structureName] || { requiredFactors: [], forbiddenFactors: [] };
  const required = Array.from(new Set([...template.requiredFactors, ...s.requiredFactors]));
  const forbidden = Array.from(new Set([...template.forbiddenFactors, ...s.forbiddenFactors]));
  const allowed = template.allowedFactors.filter((f) => !forbidden.includes(f));
  return { required, forbidden, allowed };
}

function scan(value, visit, path = "") {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => scan(v, visit, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    for (const k of Object.keys(value)) {
      visit({ kind: "key", key: k, path: `${path}.${k}` });
      scan(value[k], visit, `${path}.${k}`);
    }
    return;
  }
  visit({ kind: "value", value, path });
}

// --- structure -----------------------------------------------------------------------

function rawEnumIssues(raw, constants) {
  const out = [];
  const inV = (v, list, path) => {
    if (!list.includes(v)) out.push(`${path}=${JSON.stringify(v)} not in [${list.join("|")}]`);
  };
  const gc = raw.gameContext || {};
  if (!isInt(gc.gameTimeSec) || gc.gameTimeSec < 0) out.push("gameContext.gameTimeSec must be an integer >= 0");
  inV(gc.windowKind, V.windowKind, "gameContext.windowKind");
  inV(gc.goldBand, V.goldBand, "gameContext.goldBand");
  for (const team of ["allies", "enemies"]) {
    const t = raw.teams[team];
    for (const dim of V.compositionDims) inV(t.composition[dim], V.compositionLevel, `teams.${team}.composition.${dim}`);
    for (const slot of V.slots) {
      const m = t.members[slot];
      const p = `teams.${team}.members.${slot}`;
      inV(m.zone, V.zones, `${p}.zone`);
      inV(m.status, V.status, `${p}.status`);
      inV(m.hpBand, V.hpBand, `${p}.hpBand`);
      if (!isInt(m.completedItems) || m.completedItems < 0 || m.completedItems > V.maxCompletedItems) out.push(`${p}.completedItems out of range`);
      if (team === "enemies" && (!isInt(m.lastSeenAgoSec) || m.lastSeenAgoSec < 0)) out.push(`${p}.lastSeenAgoSec must be an integer >= 0`);
    }
  }
  for (const lane of V.lanes) {
    inV(raw.lanes[lane].pressure, V.lanePressure, `lanes.${lane}.pressure`);
    inV(raw.lanes[lane].turret.allied, V.turretState, `lanes.${lane}.turret.allied`);
    inV(raw.lanes[lane].turret.enemy, V.turretState, `lanes.${lane}.turret.enemy`);
    inV(raw.waves[lane], V.waveState, `waves.${lane}`);
  }
  for (const id of V.objectiveIds) {
    const o = raw.objectives[id];
    const p = `objectives.${id}`;
    inV(o.status, V.objectiveStatus, `${p}.status`);
    inV(o.stakes, V.stakes, `${p}.stakes`);
    inV(o.followUp, V.followUp, `${p}.followUp`);
    inV(o.activity, V.activity, `${p}.activity`);
    if (o.availableInSec !== null && (!isInt(o.availableInSec) || o.availableInSec < 0)) out.push(`${p}.availableInSec must be null or an integer >= 0`);
  }
  for (const zone of V.laneZones) {
    inV(raw.vision.allies[zone], V.visionControl, `vision.allies.${zone}`);
    inV(raw.vision.enemies[zone], V.visionControl, `vision.enemies.${zone}`);
    inV(raw.vision.fogRisk[zone], V.fogRisk, `vision.fogRisk.${zone}`);
    if (typeof raw.vision.safeToClear[zone] !== "boolean") out.push(`vision.safeToClear.${zone} must be boolean`);
  }
  return out;
}

// --- Educational predicates shared with the generator's planner ------------------------------
// The planner predicts an answer key from target levels and uses these SAME
// functions to decide whether a plan can satisfy its difficulty, so the
// generator and the validator can never disagree about what a level means.

/** Problems with how an answer-key analysis fits a difficulty level. */
export function difficultyProfileIssues(difficulty, analysis) {
  const prof = DIFFICULTY_PROFILES[difficulty];
  if (!prof) return [`no difficulty profile for ${difficulty}`];
  const p = [];
  if (prof.conflict === "forbidden" && analysis.conflict) p.push("level forbids conflicting factors but two active factors favour different options");
  if (prof.conflict === "required" && !analysis.conflict) p.push("level requires conflicting information but the factors agree");
  if (analysis.defensibleCount < prof.defensible.min || analysis.defensibleCount > prof.defensible.max) p.push(`${analysis.defensibleCount} defensible options outside ${prof.defensible.min}-${prof.defensible.max}`);
  if (analysis.dominantFactor === null) p.push("no factor drives the decision");
  return p;
}

/** Active factors whose evidence is too thin to ever produce a signal. */
export function evaluabilityIssues(activeFactors, options, minAttributionMass) {
  return activeFactors
    .filter((f) => !Object.values(options).some((o) => o.valid && Math.abs(o.contributions[f] || 0) >= minAttributionMass))
    .map((f) => `${f}: no option's outcome chain attributes enough evidence to this factor`);
}

/** Options must not all be equivalent (unless level 4 has several defensible ones). */
export function tierSpreadIssues(difficulty, options, analysis) {
  const tiers = new Set(Object.values(options).map((o) => o.tier));
  if (tiers.size >= 2) return [];
  return difficulty === 4 && analysis.defensibleCount >= 2 ? [] : ["every option has the same tier"];
}

const INVARIANTS = [];
const def = (id, description, check) => INVARIANTS.push({ id, layer: id.split(".")[0], description, check });

def("structure.scenario_shape", "Scenario has the required top-level fields with the right types", ({ scenario: s }) => {
  const p = [];
  if (!isObj(s)) return ["scenario is not an object"];
  if (typeof s.scenarioRef !== "string" || !/^sc_[0-9a-f]{16}$/.test(s.scenarioRef)) p.push("scenarioRef must match sc_<16 hex>");
  if (!isInt(s.scenarioVersion)) p.push("scenarioVersion must be an integer");
  if (!ORIGINS.includes(s.origin)) p.push("origin must be one of " + ORIGINS.join("|"));
  if (!isObj(s.template) || !["id", "version", "status", "rulesVersion", "rulesStatus"].every((k) => k in s.template)) p.push("template needs id, version, status, rulesVersion, rulesStatus");
  if (!isInt(s.difficulty)) p.push("difficulty must be an integer");
  if (!isObj(s.decision) || !["structure", "primaryObjective", "alternativeObjective", "options"].every((k) => k in s.decision) || !Array.isArray(s.decision.options)) p.push("decision needs structure, primaryObjective, alternativeObjective, options[]");
  if (!isObj(s.learningObjective)) p.push("learningObjective must be an object");
  if (!Array.isArray(s.activeFactors)) p.push("activeFactors must be an array");
  if (!isObj(s.state) || !isObj(s.state.raw) || !isObj(s.state.derived) || !isInt(s.state.schemaVersion)) p.push("state needs schemaVersion, raw, derived");
  if (!isObj(s.provenance)) p.push("provenance must be an object");
  if (!isObj(s.fingerprints) || !isObj(s.fingerprints.material)) p.push("fingerprints.material required");
  return p;
});

def("structure.versions_present", "Provenance records every version and dependency needed to reproduce and audit the scenario", ({ scenario: s }) => {
  const p = [];
  const pr = s.provenance;
  for (const k of ["scenarioVersion", "stateSchemaVersion", "templateVersion", "generatorVersion", "rulesVersion"]) if (pr[k] === undefined || pr[k] === null) p.push(`provenance.${k} missing`);
  if (typeof pr.templateId !== "string") p.push("provenance.templateId missing");
  if (!isObj(pr.registries) || !["factors", "tracks", "principles"].every((k) => pr.registries[k] !== undefined)) p.push("provenance.registries needs factors, tracks, principles");
  if (!isObj(pr.constants) || !["id", "version", "status"].every((k) => typeof pr.constants[k] === "string") || pr.constants.verifiedForPatch === undefined) p.push("provenance.constants needs id, version, status, verifiedForPatch");
  if (typeof pr.dataFingerprint !== "string" || !/^[0-9a-f]{16}$/.test(pr.dataFingerprint)) p.push("provenance.dataFingerprint must be 16 hex");
  if (!Array.isArray(pr.dependencies)) p.push("provenance.dependencies must be an array");
  else if (pr.dataFingerprint !== computeDataFingerprint(pr.dependencies)) p.push("provenance.dataFingerprint does not match provenance.dependencies");
  if (pr.templateId !== s.template.id || pr.templateVersion !== s.template.version || pr.rulesVersion !== s.template.rulesVersion) p.push("provenance and scenario.template disagree");
  if (pr.scenarioVersion !== s.scenarioVersion || pr.stateSchemaVersion !== s.state.schemaVersion) p.push("provenance schema versions disagree with the scenario");
  if (s.origin === "generated") {
    const r = pr.reproduction;
    if (!isObj(r) || !isInt(r.candidateIndex) || typeof r.selectionDigest !== "string" || !("seed" in r) || !("requestedDifficulty" in r)) p.push("generated scenarios need provenance.reproduction {seed, candidateIndex, selectionDigest, requestedDifficulty}");
  }
  return p;
});

def("structure.ref_matches_content", "scenarioRef equals the hash of the scenario's canonical content and versions", ({ scenario: s }) => {
  const pr = s.provenance;
  const ref = computeScenarioRef({
    scenarioVersion: pr.scenarioVersion,
    stateSchemaVersion: pr.stateSchemaVersion,
    template: { id: pr.templateId, version: pr.templateVersion, rulesVersion: pr.rulesVersion },
    generatorVersion: pr.generatorVersion,
    registries: pr.registries,
    constants: pr.constants,
    dataFingerprint: pr.dataFingerprint,
    difficulty: s.difficulty,
    decision: s.decision,
    raw: s.state.raw,
  });
  return ref === s.scenarioRef ? [] : [`scenarioRef ${s.scenarioRef} != recomputed ${ref}`];
});

def("structure.state_immutable", "Scenario state is deep-frozen (immutable once generated)", ({ scenario: s }) => (isDeepFrozen(s.state) ? [] : ["scenario.state is not deeply frozen"]));

def("structure.enums_valid", "Every enumerated raw-state field holds a legal value", ({ scenario: s, constants }) => rawEnumIssues(s.state.raw, constants));

def("structure.answer_key_shape", "Answer key is well-formed and covers exactly the offered options", ({ scenario: s, answerKey: k }) => {
  const p = [];
  if (!isObj(k)) return ["answer key missing"];
  if (k.scenarioRef !== s.scenarioRef) p.push("answerKey.scenarioRef does not match the scenario");
  if (k.answerKeySchema !== VERSIONS.scenarioSchema) p.push("unsupported answerKeySchema");
  const ids = s.decision.options.map((o) => o.id);
  if (!sameKeys(k.options || {}, ids)) p.push("answer key options do not match the offered options");
  for (const id of ids) {
    const o = (k.options || {})[id];
    if (!o) continue;
    if (!TIERS.includes(o.tier)) p.push(`${id}: invalid tier`);
    if (!Array.isArray(o.outcomeChain)) p.push(`${id}: outcomeChain missing`);
    else if (o.valid && o.outcomeChain.length !== STAGES.length) p.push(`${id}: a valid option needs one outcome per stage`);
    else if (!o.valid && (o.outcomeChain.length !== 0 || o.tier !== "INVALID")) p.push(`${id}: an unavailable option must be INVALID with an empty chain`);
    if (o.valid && !isInt(o.score)) p.push(`${id}: score must be an integer`);
    // Two-sided factor evidence: only exposed factors, only material ones, always grounded in cited state.
    if (!isObj(o.influences)) p.push(`${id}: influences must be an object`);
    else if (!o.valid && Object.keys(o.influences).length) p.push(`${id}: an unavailable option has no influences`);
    else {
      for (const [f, inf] of Object.entries(o.influences)) {
        if (!FACTOR_IDS.includes(f)) p.push(`${id}: influences.${f} is not a registered factor`);
        else if (!(k.factorEvidence && k.factorEvidence[f] && k.factorEvidence[f].exposed)) p.push(`${id}: influences.${f} names a factor that is not exposed (neutral factors never contribute)`);
        if (!isObj(inf) || !["supports", "opposes", "reshapes"].includes(inf.effect) || !isInt(inf.scoreDelta) || !isInt(inf.scoreWithout) || !TIERS.includes(inf.tier) || !TIERS.includes(inf.tierWithout)) p.push(`${id}: influences.${f} is malformed`);
        else {
          if (inf.effect !== (inf.scoreDelta > 0 ? "supports" : inf.scoreDelta < 0 ? "opposes" : "reshapes")) p.push(`${id}: influences.${f}.effect disagrees with scoreDelta`);
          if (inf.scoreDelta !== o.score - inf.scoreWithout) p.push(`${id}: influences.${f}.scoreDelta must equal score - scoreWithout`);
          if (inf.tier !== o.tier) p.push(`${id}: influences.${f}.tier must be the option's tier`);
          if (!Array.isArray(inf.stages) || inf.stages.length === 0) p.push(`${id}: influences.${f} must name at least one stage that changes (otherwise the factor is not material)`);
          if (!Array.isArray(inf.evidence) || inf.evidence.length === 0 || inf.evidence.some((e) => typeof e !== "string")) p.push(`${id}: influences.${f} must cite state evidence`);
        }
      }
    }
  }
  const reg = k.versions && k.versions.registries;
  if (!isObj(reg) || !["factors", "tracks", "principles"].every((r) => isInt(reg[r]))) p.push("answerKey.versions.registries must carry the factor, track and principle registry versions");
  for (const list of ["ranking", "best", "defensible"]) if (!Array.isArray(k[list]) || k[list].some((id) => !ids.includes(id))) p.push(`answerKey.${list} must list offered option ids`);
  return p;
});

def("structure.entity_refs_shape", "Optional Academy entity references are well-formed and resolvable", ({ scenario: s, dataInputs }) => {
  const p = [];
  let any = false;
  for (const team of ["allies", "enemies"]) {
    for (const slot of V.slots) {
      const refs = s.state.raw.teams[team].members[slot].refs;
      if (refs === undefined) continue;
      any = true;
      if (!isObj(refs) || Object.keys(refs).some((k) => !["champion", "items", "runes", "spells"].includes(k))) p.push(`${team}.${slot}.refs has unknown keys`);
      const entries = [];
      if (refs.champion !== undefined) entries.push(refs.champion);
      for (const list of ["items", "runes", "spells"]) {
        if (refs[list] !== undefined && !Array.isArray(refs[list])) p.push(`${team}.${slot}.refs.${list} must be an array`);
        else entries.push(...(refs[list] || []));
      }
      for (const e of entries) if (!isObj(e) || typeof e.id !== "string" || e.id === "") p.push(`${team}.${slot}: reference needs a string id`);
    }
  }
  if (any) {
    if (!dataInputs || !dataInputs.entities) p.push("entity references require dataInputs.entities to resolve them");
    else for (const r of collectEntityRefs(s.state.raw)) if (dataInputs.entities.fingerprint(r.kind, r.id, r.fields) === null) p.push(`entity ${r.kind}:${r.id} does not resolve in Academy data`);
  }
  return p;
});

def("structure.raw_state_closed", "Raw state holds only raw facts: no derived signal, factor level or evaluation can be stored as a fact", ({ scenario: s }) => {
  const raw = s.state.raw;
  const p = [];
  const closed = (obj, keys, where) => {
    for (const k of Object.keys(obj)) if (!keys.includes(k)) p.push(`${where}.${k} is not a raw-state field`);
  };
  closed(raw, ["gameContext", "teams", "lanes", "waves", "objectives", "vision"], "raw");
  closed(raw.gameContext, ["gameTimeSec", "windowKind", "goldBand"], "raw.gameContext");
  closed(raw.teams, ["allies", "enemies"], "raw.teams");
  for (const team of ["allies", "enemies"]) {
    const t = raw.teams[team];
    closed(t, ["composition", "members"], `raw.teams.${team}`);
    closed(t.composition, V.compositionDims, `raw.teams.${team}.composition`);
    for (const slot of Object.keys(t.members)) closed(t.members[slot], ["zone", "status", "hpBand", "completedItems", "lastSeenAgoSec", "refs"], `raw.teams.${team}.members.${slot}`);
  }
  for (const lane of Object.keys(raw.lanes)) {
    closed(raw.lanes[lane], ["turret", "pressure"], `raw.lanes.${lane}`);
    closed(raw.lanes[lane].turret, ["allied", "enemy"], `raw.lanes.${lane}.turret`);
  }
  for (const id of Object.keys(raw.objectives)) closed(raw.objectives[id], ["status", "availableInSec", "stakes", "followUp", "activity"], `raw.objectives.${id}`);
  closed(raw.vision, ["allies", "enemies", "fogRisk", "safeToClear"], "raw.vision");
  return p;
});

const PLANNING_KEY = /^(plan|planned|planning|target|targets|targettier|predicted|prediction|expected|stratum|strata|coverage)$/i;
const REPRODUCTION_KEYS = ["seed", "candidateIndex", "selectionDigest", "requestedDifficulty", "focus"];
const SCENARIO_KEYS = ["scenarioRef", "scenarioVersion", "origin", "template", "difficulty", "decision", "learningObjective", "activeFactors", "state", "provenance", "fingerprints"];
const PROVENANCE_KEYS = ["scenarioVersion", "stateSchemaVersion", "templateId", "templateVersion", "generatorVersion", "rulesVersion", "registries", "constants", "dataFingerprint", "dependencies", "reproduction"];
const ANSWER_KEY_KEYS = ["answerKeySchema", "scenarioRef", "versions", "factorEvidence", "derivedSignals", "options", "ranking", "best", "defensible", "analysis"];
const ANSWER_OPTION_KEYS = ["actionType", "valid", "invalidReason", "tier", "score", "lowCertaintyPercent", "outcomeChain", "contributions", "supportedBy", "againstBy", "tradeoffs", "failureConditions", "influences"];

def("structure.no_generation_metadata", "No generator planning, prediction, target tier or stratum is stored anywhere: scenario, provenance, answer key and public scenario are closed schemas", ({ scenario: s, answerKey: k, publicScenario: pub }) => {
  const p = [];
  const closed = (obj, keys, where) => {
    if (!isObj(obj)) return p.push(`${where} must be an object`);
    for (const key of Object.keys(obj)) if (!keys.includes(key)) p.push(`${where}.${key} is not a permitted field (generation metadata cannot be stored)`);
  };
  closed(s, SCENARIO_KEYS, "scenario");
  if (isObj(s.state)) closed(s.state, ["schemaVersion", "raw", "derived"], "scenario.state");
  if (isObj(s.provenance)) {
    closed(s.provenance, PROVENANCE_KEYS, "scenario.provenance");
    const r = s.provenance.reproduction;
    if (r !== null && r !== undefined) {
      closed(r, REPRODUCTION_KEYS, "scenario.provenance.reproduction");
      // A focus is a REQUEST INPUT needed to regenerate the scenario; it can never carry an expected answer.
      const f = isObj(r) ? r.focus : null;
      if (f !== null && f !== undefined) {
        closed(f, ["fightability"], "reproduction.focus");
        if (isObj(f.fightability)) closed(f.fightability, ["level", "driver"], "reproduction.focus.fightability");
      }
    }
  }
  if (isObj(s.fingerprints)) {
    closed(s.fingerprints, ["material"], "scenario.fingerprints");
    if (isObj(s.fingerprints.material)) closed(s.fingerprints.material, ["hash", "key", "signature"], "scenario.fingerprints.material");
  }
  closed(k, ANSWER_KEY_KEYS, "answerKey");
  if (isObj(k) && isObj(k.versions)) closed(k.versions, ["templateVersion", "generatorVersion", "rulesVersion", "registries"], "answerKey.versions");
  if (isObj(k) && isObj(k.options)) for (const [id, o] of Object.entries(k.options)) closed(o, ANSWER_OPTION_KEYS, `answerKey.options.${id}`);
  // Nothing named like a plan, prediction, target tier or stratum may appear at any depth of any document.
  for (const [name, doc] of [["scenario", s], ["answerKey", k], ["publicScenario", pub]]) {
    scan(doc, (n) => {
      if (n.kind === "key" && PLANNING_KEY.test(n.key)) p.push(`${name}${n.path}: planning metadata key`);
    });
  }
  return p;
});

// --- state ------------------------------------------------------------------------------

def("state.members_complete", "Each team has exactly the five role slots", ({ scenario: s }) => {
  const p = [];
  for (const team of ["allies", "enemies"]) if (!sameKeys(s.state.raw.teams[team].members, V.slots)) p.push(`${team} must have exactly ${V.slots.join(", ")}`);
  return p;
});

def("state.member_status_position", "Status, zone and HP agree for every member", ({ scenario: s }) => {
  const p = [];
  for (const team of ["allies", "enemies"]) {
    for (const [slot, m] of membersOf(s.state.raw, team)) {
      const w = `${team}.${slot}`;
      if (m.status === "alive" && !V.laneZones.includes(m.zone)) p.push(`${w}: alive members must be in a lane zone`);
      if (m.status !== "alive" && m.zone !== "base") p.push(`${w}: ${m.status} members must be at base`);
      if (m.status === "dead" && m.hpBand !== "none") p.push(`${w}: dead members have hpBand none`);
      if (m.status !== "dead" && m.hpBand === "none") p.push(`${w}: only dead members have hpBand none`);
    }
  }
  return p;
});

def("state.player_alive", "The player (ally Support) is alive and able to act", ({ scenario: s }) => (s.state.raw.teams.allies.members.support.status === "alive" ? [] : ["the ally support (the player) must be alive"]));

def("state.objective_consistent", "Objective state is internally consistent", ({ scenario: s, template }) => {
  const p = [];
  const th = template.rules.thresholds;
  let taking = 0;
  for (const id of V.objectiveIds) {
    const o = s.state.raw.objectives[id];
    if (o.status === "not_in_window") {
      if (o.availableInSec !== null) p.push(`${id}: not_in_window needs availableInSec null`);
      if (o.activity !== "none") p.push(`${id}: an objective not in the window cannot be taken`);
      continue;
    }
    if (o.availableInSec === null) p.push(`${id}: in-window objectives need availableInSec`);
    else if (o.status === "available" && o.availableInSec !== 0) p.push(`${id}: available means availableInSec 0`);
    else if (o.status === "upcoming" && !(o.availableInSec > 0)) p.push(`${id}: upcoming means availableInSec > 0`);
    if (o.activity === "enemy_taking") {
      taking += 1;
      if (o.status !== "available") p.push(`${id}: cannot be taken before it is available`);
    }
  }
  if (taking > 1) p.push("at most one objective can be in the enemy's hands at once");
  for (const id of V.objectiveIds) {
    const o = s.state.raw.objectives[id];
    if (o.activity === "enemy_taking") {
      const z = s.state.derived.objectives[id] ? s.state.derived.objectives[id].zone : null;
      const there = z ? V.slots.filter((slot) => s.state.raw.teams.enemies.members[slot].status === "alive" && s.state.raw.teams.enemies.members[slot].zone === z).length : 0;
      if (there < th.enemyTakingMinAtObjective) p.push(`${id}: the enemy is taking it with only ${there} member(s) there (needs ${th.enemyTakingMinAtObjective})`);
    }
  }
  return p;
});

def("state.objective_spawn_supported", "An objective cannot be available before it can first spawn", ({ scenario: s, constants }) => {
  const p = [];
  for (const id of V.objectiveIds) {
    const o = s.state.raw.objectives[id];
    if (o.status === "not_in_window") continue;
    const first = constants.values.objectives[id].firstSpawnSec;
    if (s.state.raw.gameContext.gameTimeSec + o.availableInSec < first) p.push(`${id}: available at ${s.state.raw.gameContext.gameTimeSec + o.availableInSec}s but first spawn is ${first}s`);
  }
  return p;
});

def("state.window_consistent", "The objective window agrees with the decision and the shared-window rule", ({ scenario: s, constants }) => {
  const p = [];
  const raw = s.state.raw;
  const d = s.decision;
  const kind = raw.gameContext.windowKind;
  const inWindow = V.objectiveIds.filter((id) => raw.objectives[id].status !== "not_in_window");
  if (!inWindow.includes(d.primaryObjective)) p.push("the primary objective must be in the window");
  if (kind === "shared") {
    if (inWindow.length !== 2) p.push("a shared window has both objectives");
    else {
      const gap = Math.abs(raw.objectives.dragon.availableInSec - raw.objectives.riftHerald.availableInSec);
      if (gap > constants.values.window.sharedWindowMaxGapSec) p.push(`objectives are ${gap}s apart; a shared window allows ${constants.values.window.sharedWindowMaxGapSec}s`);
    }
    const other = V.objectiveIds.find((id) => id !== d.primaryObjective);
    if (d.alternativeObjective !== other) p.push("in a shared window the alternative is the other objective");
  } else {
    if (inWindow.length !== 1) p.push("a primary_only window has exactly one objective");
    if (d.alternativeObjective !== null) p.push("a primary_only window has no alternative");
  }
  return p;
});

def("state.enemy_information_consistent", "Enemy sightings agree with our vision and presence", ({ scenario: s, constants }) => {
  const p = [];
  const raw = s.state.raw;
  const stale = constants.values.info.staleAfterSec;
  for (const [slot, m] of membersOf(raw, "enemies")) {
    const fresh = m.lastSeenAgoSec <= stale;
    if (m.status !== "alive") {
      if (!fresh) p.push(`enemies.${slot}: a dead or recalling enemy is known, not stale`);
      continue;
    }
    const ally = aliveIn(raw, "allies", m.zone);
    const ctl = raw.vision.allies[m.zone];
    if ((ally || ctl === "full") && !fresh) p.push(`enemies.${slot}: stale sighting where we have presence or full control`);
    if (!ally && ctl === "none" && fresh) p.push(`enemies.${slot}: fresh sighting where we have no presence and no vision`);
  }
  for (const [slot, m] of membersOf(raw, "allies")) if (m.lastSeenAgoSec !== undefined) p.push(`allies.${slot}: allies have no sighting age`);
  return p;
});

def("state.vision_flags_consistent", "Vision, fog and safe-to-clear flags are compatible", ({ scenario: s }) => {
  const p = [];
  const v = s.state.raw.vision;
  for (const zone of V.laneZones) {
    if (v.fogRisk[zone] === "high" && v.allies[zone] === "full") p.push(`${zone}: full control leaves no high fog risk`);
    if (v.safeToClear[zone] && v.enemies[zone] === "none") p.push(`${zone}: nothing to clear where the enemy has no vision`);
  }
  return p;
});

def("state.gold_items_coherent", "A clear item lead cannot coexist with the opposite gold reading", ({ scenario: s }) => {
  const sum = (team) => V.slots.reduce((n, slot) => n + s.state.raw.teams[team].members[slot].completedItems, 0);
  const diff = sum("allies") - sum("enemies");
  const g = s.state.raw.gameContext.goldBand;
  return goldCoherentWithItems(g, diff) ? [] : [`goldBand ${g} contradicts an item difference of ${diff}`];
});

def("state.derived_rebuildable", "Derived state equals a fresh derivation from raw state", ({ scenario: s, template, constants }) => {
  const again = deriveState(s.state.raw, constants, template.rules.thresholds);
  return eq(again, s.state.derived) ? [] : ["state.derived does not match deriveState(raw)"];
});

def("state.no_impossible_relationships", "Derived relationships never contradict raw state", ({ scenario: s }) => {
  const p = [];
  const { raw, derived } = s.state;
  for (const id of V.objectiveIds) {
    const inWindow = raw.objectives[id].status !== "not_in_window";
    if (inWindow !== (derived.objectives[id] !== null)) p.push(`${id}: derived presence disagrees with the window`);
    const d = derived.objectives[id];
    if (!d) continue;
    for (const [team, key] of [["allies", "teamAccess"], ["enemies", "enemyAccess"]]) {
      for (const slot of d[key].arrivals) {
        const m = raw.teams[team].members[slot];
        if (m.status !== "alive" || m.hpBand === "low") p.push(`${id}: ${team}.${slot} counted as arriving but is ${m.status}/${m.hpBand}`);
      }
    }
    const cm = derived.crossMap[id];
    const zone = d.zone;
    for (const slot of cm.committed) {
      const m = raw.teams.enemies.members[slot];
      if (m.status !== "alive" || m.zone !== zone) p.push(`${id}: committed enemy ${slot} is not at the objective`);
    }
    for (const slot of V.slots) {
      const m = raw.teams.allies.members[slot];
      if (m.status === "alive" && laneOfZone[m.zone] === undefined) p.push(`allies.${slot}: alive but in a non-lane zone`);
    }
  }
  return p;
});

// --- decision ---------------------------------------------------------------------------------

def("decision.options_allowed", "Every offered action is allowed by the template", ({ scenario: s, template }) => s.decision.options.filter((o) => !template.allowedActions.includes(o.actionType)).map((o) => `${o.id}: ${o.actionType} is not allowed by the template`));

def("decision.structure_matches_actions", "Offered actions match the decision structure and the template's option rules", ({ scenario: s, template }) => {
  const p = [];
  const st = template.structures[s.decision.structure];
  if (!st) return [`unknown decision structure ${s.decision.structure}`];
  const types = s.decision.options.map((o) => o.actionType);
  for (const a of st.actions) if (!types.includes(a)) p.push(`missing structure action ${a}`);
  for (const a of types) if (!st.actions.includes(a) && !st.extraActions.includes(a)) p.push(`${a} is not part of ${s.decision.structure}`);
  const extras = types.filter((a) => !st.actions.includes(a));
  if (extras.length > 1) p.push("at most one extra option");
  if (extras.length > 0 && s.difficulty < template.constraints.extraOptionMinDifficulty) p.push("extra options are only offered from difficulty " + template.constraints.extraOptionMinDifficulty);
  const n = types.length;
  if (n < template.constraints.optionCount.min || n > template.constraints.optionCount.max) p.push(`option count ${n} outside the template range`);
  if (s.difficulty < (st.minDifficulty || template.difficultyRange.min)) p.push(`${s.decision.structure} is not offered below difficulty ${st.minDifficulty}`);
  if (st.requiresAlternative && s.decision.alternativeObjective === null) p.push(`${s.decision.structure} needs an alternative objective`);
  if (st.requiresIdle && s.state.raw.objectives[s.decision.primaryObjective].activity !== "none") p.push(`${s.decision.structure} needs an objective nobody is taking yet`);
  return p;
});

def("decision.option_preconditions_hold", "Option availability matches the state; generated scenarios offer only available options", ({ scenario: s, answerKey: k, template, constants }) => {
  const p = [];
  const ctx = { raw: s.state.raw, derived: s.state.derived, constants, primary: s.decision.primaryObjective, alternative: s.decision.alternativeObjective };
  for (const o of s.decision.options) {
    const pre = template.runtime.preconditionOf(o.actionType, ctx, template.rules);
    const key = k.options[o.id];
    if (key && key.valid !== pre.ok) p.push(`${o.id}: answer key availability disagrees with the state`);
    if (s.origin === "generated" && !pre.ok) p.push(`${o.id}: a generated scenario offered an unavailable action (${pre.reason})`);
  }
  return p;
});

def("decision.option_ids_valid", "Option ids are unique and derived from their action type", ({ scenario: s }) => {
  const p = [];
  const ids = s.decision.options.map((o) => o.id);
  const types = s.decision.options.map((o) => o.actionType);
  if (new Set(ids).size !== ids.length) p.push("duplicate option ids");
  if (new Set(types).size !== types.length) p.push("duplicate action types");
  for (const o of s.decision.options) if (o.id !== String(o.actionType).toLowerCase()) p.push(`${o.id}: id must be the lower-case action type`);
  return p;
});

def("decision.answer_key_recomputes", "The stored answer key equals the authoritative recomputation from the final immutable state alone (no plan, prediction, target tier, stored derived state or fingerprint is consulted)", ({ scenario: s, answerKey: k, template, constants }) => {
  // Deliberately reads ONLY: the final raw state, the decision, the constants, the template
  // (rules and registries) and the version labels to stamp. Derived state is re-derived, factor
  // levels re-detected, every option re-evaluated. If the stored key rested on anything else
  // (a generator prediction, a target, a stale derived block) this would differ.
  const recomputed = recomputeAnswerKey({
    template,
    constants,
    raw: s.state.raw,
    decision: s.decision,
    scenarioRef: s.scenarioRef,
    versions: { templateVersion: s.provenance.templateVersion, generatorVersion: s.provenance.generatorVersion, rulesVersion: s.provenance.rulesVersion },
  });
  return eq(recomputed, k) ? [] : ["stored answer key differs from the authoritative recomputation from the final state"];
});

def("decision.outcomes_supported_by_state", "Every outcome exists in the rule table and cites state that exists", ({ scenario: s, answerKey: k, template }) => {
  const p = [];
  for (const [id, o] of Object.entries(k.options)) {
    for (const c of o.outcomeChain) {
      const spec = template.rules.actions[o.actionType] && template.rules.actions[o.actionType][c.stage];
      if (!spec || !spec.bands.some((b) => b.outcome === c.outcome && b.valence === c.valence)) p.push(`${id}/${c.stage}: outcome ${c.outcome} is not in the rule table for ${o.actionType}`);
      if (!CERTAINTY.includes(c.certainty)) p.push(`${id}/${c.stage}: certainty ${c.certainty} is not qualitative`);
      if (!isInt(c.valence) || c.valence < -2 || c.valence > 2) p.push(`${id}/${c.stage}: valence out of range`);
      if (c.valence !== 0 && c.because.length === 0) p.push(`${id}/${c.stage}: a non-neutral outcome must cite state`);
      for (const path of c.because) if (getPath(s, path) === undefined) p.push(`${id}/${c.stage}: ${path} does not exist in the scenario`);
    }
    // Influences: the outcomes they compare exist in the rule table and the evidence they cite exists in the state.
    for (const [f, inf] of Object.entries(o.influences || {})) {
      for (const st of inf.stages || []) {
        const spec = template.rules.actions[o.actionType] && template.rules.actions[o.actionType][st.stage];
        for (const outcome of [st.outcome, st.outcomeWithout]) if (!spec || !spec.bands.some((b) => b.outcome === outcome)) p.push(`${id}/influences.${f}/${st.stage}: outcome ${outcome} is not in the rule table for ${o.actionType}`);
      }
      for (const path of inf.evidence || []) if (getPath(s, path) === undefined) p.push(`${id}/influences.${f}: evidence ${path} does not exist in the scenario`);
    }
  }
  return p;
});

def("decision.no_numeric_probabilities", "No probabilities anywhere: certainty is qualitative", ({ answerKey: k, publicScenario: pub }) => {
  const p = [];
  const badKey = /probab|likelih|odds|chance/i;
  const badValue = /\d\s*%|percent chance/i;
  for (const [name, doc] of [["answerKey", k], ["publicScenario", pub]]) {
    scan(doc, (n) => {
      if (n.kind === "key" && badKey.test(n.key)) p.push(`${name}${n.path}: probability-like key`);
      if (n.kind === "value" && typeof n.value === "string" && badValue.test(n.value)) p.push(`${name}${n.path}: probability-like text`);
    });
  }
  return p;
});

def("decision.has_defensible_option", "At least one offered option is defensible", ({ answerKey: k }) => (k.defensible.length >= 1 ? [] : ["no option is STRONG, VIABLE or SITUATIONAL"]));

// --- edu ------------------------------------------------------------------------------------------

def("edu.required_factors_present", "Required factors exist in the state and are evaluable", ({ scenario: s, answerKey: k, template }) => {
  const { required } = effectiveFactorRules(template, s.decision.structure);
  const p = [];
  for (const f of required) {
    const fe = k.factorEvidence[f];
    if (!fe || !fe.exposed) p.push(`${f}: required factor is not exposed (level ${fe ? fe.level : "missing"})`);
    else if (!s.activeFactors.includes(f)) p.push(`${f}: required factor is not among the active factors`);
  }
  return p;
});

def("edu.forbidden_factors_absent", "Forbidden factors do not appear", ({ scenario: s, answerKey: k, template }) => {
  const { forbidden } = effectiveFactorRules(template, s.decision.structure);
  return forbidden.filter((f) => s.activeFactors.includes(f) || (k.factorEvidence[f] && k.factorEvidence[f].exposed)).map((f) => `${f}: forbidden factor is present`);
});

def("edu.allowed_factors_only", "Only allowed factors are active", ({ scenario: s, template }) => {
  const { allowed } = effectiveFactorRules(template, s.decision.structure);
  return s.activeFactors.filter((f) => !allowed.includes(f)).map((f) => `${f}: not allowed for ${s.decision.structure}`);
});

def("edu.factor_count_in_range", "Active factor count respects the template and the difficulty", ({ scenario: s, template }) => {
  const prof = DIFFICULTY_PROFILES[s.difficulty];
  if (!prof) return [`no difficulty profile for ${s.difficulty}`];
  const min = Math.max(template.factorCount.min, prof.factorCount.min);
  const max = Math.min(template.factorCount.max, prof.factorCount.max);
  const n = s.activeFactors.length;
  return n >= min && n <= max ? [] : [`${n} active factors outside ${min}-${max} for difficulty ${s.difficulty}`];
});

def("edu.difficulty_in_template_range", "Difficulty is within the template's range", ({ scenario: s, template }) => (s.difficulty >= template.difficultyRange.min && s.difficulty <= template.difficultyRange.max ? [] : [`difficulty ${s.difficulty} outside the template range`]));

def("edu.difficulty_profile_satisfied", "The answer key has the shape the difficulty level promises", ({ scenario: s, answerKey: k }) => difficultyProfileIssues(s.difficulty, k.analysis));

def("edu.learning_objective_valid", "Every scenario has a specific learning objective grounded in the registries", ({ scenario: s }) => {
  const lo = s.learningObjective;
  const p = [];
  if (typeof lo.id !== "string" || typeof lo.summary !== "string" || lo.summary === "") p.push("learning objective needs an id and a summary");
  if (!s.activeFactors.includes(lo.focusFactor)) p.push("focusFactor must be an active factor");
  for (const f of lo.factors || []) if (!s.activeFactors.includes(f)) p.push(`${f}: learning objective factor is not active`);
  for (const id of lo.principles || []) if (!PRINCIPLES[id]) p.push(`${id}: unknown principle`);
  for (const id of lo.tracks || []) if (!TRACKS[id]) p.push(`${id}: unknown track`);
  if (!(lo.principles || []).length) p.push("learning objective cites no principle");
  return p;
});

def("edu.active_factors_evaluable", "Each active factor carries enough attributed evidence to produce a signal", ({ scenario: s, answerKey: k, template }) => evaluabilityIssues(s.activeFactors, k.options, template.rules.signals.minAttributionMass));

def("edu.inactive_factors_neutral", "Exposure equals the active set: every other factor reads neutral", ({ scenario: s, answerKey: k }) => {
  const exposed = FACTOR_IDS.filter((f) => k.factorEvidence[f].exposed);
  const active = FACTOR_IDS.filter((f) => s.activeFactors.includes(f));
  const p = [];
  if (!eq(exposed, active)) p.push(`exposed factors [${exposed}] differ from active factors [${active}]`);
  for (const f of FACTOR_IDS) if (k.factorEvidence[f].exposed !== (k.factorEvidence[f].level !== FACTORS[f].neutral)) p.push(`${f}: exposure flag disagrees with its level`);
  return p;
});

def("edu.background_signals_permitted", "Information quality (the one non-factor driver) is non-clear only where the level allows it", ({ scenario: s }) => {
  const prof = DIFFICULTY_PROFILES[s.difficulty];
  if (!prof) return [`no difficulty profile for ${s.difficulty}`];
  // Fightability used to be checked here. It is a first-class factor now, so it is
  // governed by exposure (edu.inactive_factors_neutral), like every other factor.
  if (s.state.derived.infoQuality.level !== "clear" && !prof.backgroundSignals && !s.activeFactors.includes("vision_gap")) return ["poor information is an unexposed driver at this difficulty"];
  return [];
});

def("edu.tier_spread", "The options are not all equivalent", ({ scenario: s, answerKey: k }) => tierSpreadIssues(s.difficulty, k.options, k.analysis));

// --- public ---------------------------------------------------------------------------------------------

const PUBLIC_TOP = ["publicVersion", "scenarioRef", "provenance", "presentation", "state", "decision"];
const PUBLIC_PROVENANCE = ["scenarioVersion", "templateId", "templateVersion", "generatorVersion", "rulesVersion", "dataFingerprint"];
const DENY_KEYS = /^(tiers?|scores?|supportedBy|againstBy|tradeoffs?|failureConditions?|outcomeChain|outcomes?|contributions?|learningObjective|activeFactors|factorEvidence|factorSignals?|derived|derivedSignals|answerKey|best|defensible|ranking|analysis|signals?|valence|attribution|expectedOutcomes?|quality|correct|dominantFactor|reproduction|dependencies|seed|fingerprints?)$/i;

function sameShape(a, b) {
  if (isObj(a) && isObj(b)) return sameKeys(a, Object.keys(b)) && Object.keys(a).every((k) => sameShape(a[k], b[k]));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameShape(x, b[i]));
  return typeof a === typeof b || a === null || b === null;
}

def("public.schema_allowlist", "The public scenario contains only allow-listed fields", ({ publicScenario: pub, scenario: s, constants }) => {
  const p = [];
  if (!isObj(pub)) return ["public scenario missing"];
  if (!sameKeys(pub, PUBLIC_TOP)) p.push(`top-level keys must be exactly ${PUBLIC_TOP.join(", ")}`);
  if (isObj(pub.provenance) && !sameKeys(pub.provenance, PUBLIC_PROVENANCE)) p.push(`provenance keys must be exactly ${PUBLIC_PROVENANCE.join(", ")}`);
  if (isObj(pub.presentation) && !sameKeys(pub.presentation, ["title", "prompt"])) p.push("presentation keys must be title, prompt");
  if (isObj(pub.decision) && !sameKeys(pub.decision, ["question", "options"])) p.push("decision keys must be question, options");
  if (isObj(pub.state) && !sameShape(pub.state, projectPublicState(s.state.raw, constants))) p.push("public state shape differs from the projection");
  return p;
});

def("public.no_answer_key_fields", "No answer-key field name appears anywhere in the public scenario", ({ publicScenario: pub }) => {
  const p = [];
  scan(pub, (n) => {
    if (n.kind === "key" && DENY_KEYS.test(n.key)) p.push(`public${n.path}: answer-key field name`);
  });
  return p;
});

def("public.no_answer_key_values", "No answer-key vocabulary appears in any public string", ({ publicScenario: pub, template }) => {
  const outcomes = new Set();
  for (const action of Object.values(template.rules.actions)) for (const stage of Object.values(action)) for (const b of stage.bands) outcomes.add(b.outcome);
  const failures = new Set();
  for (const action of Object.values(template.rules.actions)) for (const stage of Object.values(action)) for (const b of stage.bands) if (b.failure) failures.add(b.failure);
  const words = [...FACTOR_IDS, ...Object.keys(PRINCIPLES), ...Object.keys(TRACKS), ...outcomes, ...failures];
  const tierRe = /\b(STRONG|VIABLE|SITUATIONAL|WEAK|INVALID)\b/;
  const p = [];
  // Scan what the player READS. provenance is metadata (ids, versions, a
  // hash) and is already pinned to an allow-list by public.schema_allowlist.
  const readable = { presentation: pub.presentation, state: pub.state, decision: pub.decision };
  scan(readable, (n) => {
    if (n.kind !== "value" || typeof n.value !== "string") return;
    if (tierRe.test(n.value)) p.push(`public${n.path}: contains a tier name`);
    for (const w of words) if (n.value.includes(w)) p.push(`public${n.path}: contains "${w}"`);
  });
  return p;
});

def("public.state_matches_projection", "The public state is exactly the projection of the raw state", ({ publicScenario: pub, scenario: s, constants }) => (eq(pub.state, projectPublicState(s.state.raw, constants)) ? [] : ["public.state differs from projectPublicState(raw)"]));

def("public.options_metadata_only", "Public options carry presentation metadata only", ({ publicScenario: pub, scenario: s, template }) => {
  const p = [];
  const opts = pub.decision && pub.decision.options;
  if (!Array.isArray(opts) || opts.length !== s.decision.options.length) return ["public options do not match the offered options"];
  opts.forEach((o, i) => {
    const real = s.decision.options[i];
    if (!sameKeys(o, ["id", "label", "actionType"])) p.push(`option ${i}: keys must be id, label, actionType`);
    if (o.id !== real.id || o.actionType !== real.actionType) p.push(`option ${i}: id/actionType disagree with the scenario`);
    if (o.label !== template.runtime.optionLabel(real.actionType, s.decision.primaryObjective, s.decision.alternativeObjective)) p.push(`option ${i}: label is not the deterministic label`);
  });
  return p;
});

def("public.ref_and_provenance", "Public identity matches the scenario and exposes no reproduction details", ({ publicScenario: pub, scenario: s }) => {
  const p = [];
  if (pub.scenarioRef !== s.scenarioRef) p.push("public scenarioRef differs");
  for (const k of PUBLIC_PROVENANCE) if (pub.provenance && pub.provenance[k] !== s.provenance[k]) p.push(`public provenance.${k} differs`);
  return p;
});

export const INVARIANT_LIST = Object.freeze(INVARIANTS.slice());
export const INVARIANT_IDS = Object.freeze(INVARIANTS.map((i) => i.id));
