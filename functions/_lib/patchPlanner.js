// Adaptive batch planning for Patch Intelligence's multi-stage pipeline.
//
// Takes the units patchParser.js already split at semantic boundaries
// (never mid-change) and packs them into AI-call-sized batches, purely
// from the ACTUAL content of THIS patch -- there is no fixed "N batches"
// or per-category assumption. A quiet patch with three short sections
// gets one batch; a huge patch with forty sections gets as many batches
// as its real content needs, up to the hard PATCH_INTEL_MAX_BATCHES
// ceiling.
//
// Also runs patchAcademyDetection.js over every unit BEFORE any AI call,
// so each batch already carries the exact list of Academy entities a
// deterministic scan found inside it -- this is the "you must address
// every one of these" list patchAnalysis.js hands the analyst, and the
// reason detection can never depend on an AI response actually mentioning
// something for it to be tracked.
//
// DETERMINISTIC-FIRST RELEVANCE GATE (2026-09-23 refactor): a unit with
// zero detected Academy entities is only carried into a batch (i.e. only
// ever sent to AI) when its category is in
// PATCH_INTEL_RELEVANT_NO_ENTITY_CATEGORIES (config.js) -- see that
// constant's own comment for the exact reasoning. Everything else with
// no detected entity (skins/Wild Pass/bug-fix lists/appendix/etc, which
// is routinely a large fraction of a real patch page) is set aside as
// `ignoredUnits`, reported in `stats`, and never batched. This never
// changes WHICH entities are detected (detection still runs over every
// non-empty unit, unchanged) -- it only changes which units are worth an
// AI call. A unit WITH a detected entity is always eligible regardless
// of category.
//
// DETERMINISTIC FACT EXTRACTION (same refactor): for every unit that
// passes the gate, patchChangeDetector.js's extractDeterministicFacts()
// pulls old->new pairs straight out of Riot's own before/after notation,
// and resolveUnitOwnerEntity() decides (heading-only, never guessed)
// which single Academy entity those facts belong to. Each batch carries
// the result as `entityFacts` (Map<entityKey, {whatChanged,
// previousValue, newValue}>, already formatted -- patchAnalysis.js
// overlays these onto the AI's own report after normalization so the
// AI is never asked to rediscover a fact this layer already has),
// `addedOrRemovedSignals` (pattern-based, always routed to Human
// Review), and `academyDataFlags` (item-only, low-confidence "Academy's
// stored info may still show the old value" signal -- never an
// assertion; see patchChangeDetector.js's compareItemInfoToPatch). A
// unit whose heading doesn't cleanly resolve to one entity still has its
// facts extracted, just parked in `unattributedFacts` instead of
// `entityFacts` -- never guessed onto an entity.
//
// Packing rules (greedy, in document order -- order matters: it's what
// keeps a champion's Q/W/E lines and its item interactions in the same
// batch when they're adjacent in the source):
//   * a new batch starts whenever adding the next unit would push the
//     running batch over PATCH_INTEL_BATCH_MAX_CHARS, OR over
//     PATCH_INTEL_BATCH_MAX_ENTITIES worth of strongly-detected entities
//     (see patchAcademyDetection.js's isStrongDetection -- a batch's
//     entity budget is about how many verdicts one response must
//     produce, not raw character count);
//   * adjacent small batches are then coalesced forward up toward
//     PATCH_INTEL_BATCH_MIN_CHARS so a patch with many short sections
//     doesn't fan out into one tiny AI call per section;
//   * hitting PATCH_INTEL_MAX_BATCHES stops planning -- remaining units
//     are returned as `unassignedUnits`, never silently merged into an
//     already-full batch and never dropped from the result. The caller
//     (patchAnalysis.js / patchAggregate.js) is responsible for reporting
//     these as an explicit incomplete-coverage condition, per the "no
//     silent drops" rule this whole rebuild exists to enforce.
//
// Pure functions, no I/O.

import { buildAcademyIndex, detectEntitiesInText, isStrongDetection } from "./patchAcademyDetection.js";
import {
  extractDeterministicFacts,
  formatFacts,
  resolveUnitOwnerEntity,
  detectAddedOrRemovedSignal,
  compareItemInfoToPatch,
} from "./patchChangeDetector.js";
import {
  PATCH_INTEL_BATCH_MAX_CHARS,
  PATCH_INTEL_BATCH_MIN_CHARS,
  PATCH_INTEL_BATCH_MAX_ENTITIES,
  PATCH_INTEL_MAX_BATCHES,
  PATCH_INTEL_RELEVANT_NO_ENTITY_CATEGORIES,
} from "./config.js";

export const PLANNER_VERSION = "plan-v2";

const RELEVANT_NO_ENTITY = new Set(PATCH_INTEL_RELEVANT_NO_ENTITY_CATEGORIES);

/** Derives a batch's entityFacts/addedOrRemovedSignals/academyDataFlags/
 *  unattributedFacts from a list of unit ids plus the batch's
 *  per-unit factDataByUnitId map (see planPatchAnalysis /
 *  splitBatchInHalf below) -- shared so the initial plan and a later
 *  split-in-half produce results by the exact same rule, never two
 *  slightly different ones. */
function deriveBatchFactSummary(unitIds, factDataByUnitId, itemRosterById) {
  const entityFactsRaw = new Map(); // entityKey -> Fact[]
  const addedOrRemovedSignals = [];
  const unattributedFacts = [];

  for (const uid of unitIds) {
    const d = factDataByUnitId.get(uid);
    if (!d) continue;
    if (d.addedOrRemoved) addedOrRemovedSignals.push(d.addedOrRemoved);
    if (d.facts && d.facts.length) {
      if (d.ownerEntityKey) {
        if (!entityFactsRaw.has(d.ownerEntityKey)) entityFactsRaw.set(d.ownerEntityKey, []);
        entityFactsRaw.get(d.ownerEntityKey).push(...d.facts);
      } else {
        unattributedFacts.push({ unitId: uid, facts: d.facts });
      }
    }
  }

  const entityFacts = new Map();
  const academyDataFlags = [];
  for (const [key, facts] of entityFactsRaw) {
    const formatted = formatFacts(facts);
    if (formatted) entityFacts.set(key, formatted);
    if (key.startsWith("item:") && itemRosterById) {
      const flag = compareItemInfoToPatch(itemRosterById.get(key.slice("item:".length)), facts);
      if (flag) academyDataFlags.push({ entityKey: key, ...flag });
    }
  }

  return { entityFacts, addedOrRemovedSignals, academyDataFlags, unattributedFacts };
}

/** Splits one already-planned batch into two roughly-equal-chars halves,
 *  cutting only at unit boundaries (never inside a unit -- units are
 *  already the smallest safe cut point per patchParser.js). Used by
 *  patchAnalysis.js's retry-with-split when a batch's response comes
 *  back truncated: the batch that was too large for one AI call becomes
 *  two independent, correctly-re-scoped batches (each with its OWN
 *  entities AND deterministic facts recomputed from the batch's
 *  per-unit maps, never the original combined batch's totals) that are
 *  retried separately. A batch with only one unit cannot be split
 *  further -- callers check unitIds.length > 1 before calling this.
 *  `itemRoster` is optional (defaults to none -- only needed to re-derive
 *  the low-confidence academyDataFlags signal for the item entities in
 *  each half; omitting it never affects entities/entityFacts). */
export function splitBatchInHalf(batch, index, itemRoster = []) {
  if (batch.unitIds.length < 2) return [batch];
  const itemRosterById = new Map(itemRoster.map((it) => [it.id, it]));
  const mid = Math.max(1, Math.floor(batch.units.length / 2));
  const halves = [batch.units.slice(0, mid), batch.units.slice(mid)];
  return halves.map((unitsHalf, i) => {
    const unitIds = unitsHalf.map((u) => u.id);
    const entityKeys = new Set();
    for (const uid of unitIds) (batch.entityKeysByUnitId.get(uid) || []).forEach((k) => entityKeys.add(k));
    const factSummary = batch.factDataByUnitId
      ? deriveBatchFactSummary(unitIds, batch.factDataByUnitId, itemRosterById)
      : { entityFacts: new Map(), addedOrRemovedSignals: [], academyDataFlags: [], unattributedFacts: [] };
    return {
      id: `${batch.id}.${i + 1}`,
      unitIds,
      units: unitsHalf,
      chars: unitsHalf.reduce((n, u) => n + u.chars + 1, 0),
      entities: [...entityKeys].map((k) => index.byKey.get(k)).filter(Boolean),
      entityKeysByUnitId: new Map(unitIds.map((uid) => [uid, batch.entityKeysByUnitId.get(uid) || []])),
      factDataByUnitId: batch.factDataByUnitId
        ? new Map(unitIds.map((uid) => [uid, batch.factDataByUnitId.get(uid)]))
        : new Map(),
      ...factSummary,
    };
  });
}

/**
 * @param {object} args
 * @param {Array}  args.units           patchParser.parsePatchDocument(...).units
 * @param {Array}  args.championRoster  Academy-covered champions (id/name/...), already
 *                                       resolved through the KV-then-static effective-data
 *                                       hierarchy by the caller -- this module never reads
 *                                       src/data/*.js itself.
 * @param {Array}  args.itemRoster      likewise, already-effective item records (tier/info)
 * @param {Array}  args.runeRoster      likewise, already-effective rune records
 * @param {Set<string>|null} [args.onlyEntityKeys] when provided, restricts batching to units
 *   that touch at least one of these entity keys (targeted retry -- see
 *   functions/api/admin/patch-check.js). Units with none of these entities are treated as
 *   already-resolved and routed to `ignoredUnits` (not re-sent to AI), regardless of the
 *   normal relevance gate. `detectedAnywhere`/`entityUnits` are unaffected -- detection still
 *   runs over every unit either way, so coverage accounting stays accurate.
 * @returns {{
 *   index: object,                      // patchAcademyDetection's index (reused for the final "never mentioned anywhere" pass)
 *   batches: Array<{ id, unitIds, units, chars, entities, entityFacts, addedOrRemovedSignals, academyDataFlags }>,
 *   emptyUnits: Array,                   // units with no body text at all -- not a failure, just nothing to analyze
 *   entityUnits: Map<string, Set<string>>, // entityKey -> unit ids it was detected in, for coverage attribution
 *   detectedAnywhere: Set<string>,       // entity keys detected in ANY unit, batched or not
 *   unassignedUnits: Array,              // units that didn't fit within PATCH_INTEL_MAX_BATCHES
 *   ignoredUnits: Array,                 // units gated out (no detected entity, not a relevant category) -- never sent to AI
 *   capped: boolean,
 *   stats: { totalUnits, emptyUnits, batchedUnits, unassignedUnits, ignoredUnits, ignoredChars, batches }
 * }}
 */
export function planPatchAnalysis({ units, championRoster, itemRoster, runeRoster, onlyEntityKeys = null }) {
  const index = buildAcademyIndex({ championRoster, itemRoster, runeRoster });
  const itemRosterById = new Map((itemRoster || []).map((it) => [it.id, it]));

  const emptyUnits = [];
  const ignoredUnits = [];
  const perUnit = [];
  const entityUnits = new Map();
  const detectedAnywhere = new Set();
  let ignoredChars = 0;

  for (const unit of units) {
    if (unit.empty) {
      emptyUnits.push(unit);
      continue;
    }
    // Detect over the heading path AS WELL AS the body: Riot commonly
    // names the entity only in its own heading ("### Leona") and never
    // repeats it in the bullets underneath, so scanning unit.text alone
    // would miss every such unit entirely.
    const detectionText = `${unit.headingPath.join("\n")}\n${unit.text}`;
    const detected = detectEntitiesInText(detectionText, index);
    const strongKeys = [];
    for (const [key, rec] of detected.entries()) {
      detectedAnywhere.add(key);
      if (!entityUnits.has(key)) entityUnits.set(key, new Set());
      entityUnits.get(key).add(unit.id);
      const entity = index.byKey.get(key);
      if (entity && isStrongDetection(entity, rec)) strongKeys.push(key);
    }

    const hasEntity = strongKeys.length > 0;
    const targeted = onlyEntityKeys ? strongKeys.some((k) => onlyEntityKeys.has(k)) : true;
    const gateEligible = hasEntity ? targeted : RELEVANT_NO_ENTITY.has(unit.category) && targeted;

    if (!gateEligible) {
      ignoredUnits.push(unit);
      ignoredChars += unit.chars;
      continue;
    }

    const ownerEntity = resolveUnitOwnerEntity(unit, index, detectEntitiesInText, isStrongDetection);
    const facts = extractDeterministicFacts(unit.text);
    const addedOrRemoved = detectAddedOrRemovedSignal(unit, ownerEntity);

    perUnit.push({
      unit,
      strongKeys,
      factData: { ownerEntityKey: ownerEntity ? ownerEntity.key : null, facts, addedOrRemoved },
    });
  }

  // ---- pack units into batches, greedily, in document order ----
  // Each batch keeps entityKeysByUnitId / factDataByUnitId (unit id ->
  // that unit's OWN strong entity keys / deterministic fact data, not
  // the batch total) alongside the aggregated set -- patchAnalysis.js's
  // retry-with-split needs to recompute a correct, smaller entity list
  // AND fact summary for each half of a batch it splits, without
  // re-running detection or extraction from scratch.
  const rawBatches = [];
  let cur = null;
  let batchCapped = false;

  for (const { unit, strongKeys, factData } of perUnit) {
    const addChars = unit.chars + 1;
    const wouldEntityCount = cur ? new Set([...cur.entityKeys, ...strongKeys]).size : new Set(strongKeys).size;
    const overChars = cur && cur.chars + addChars > PATCH_INTEL_BATCH_MAX_CHARS;
    const overEntities = cur && cur.unitIds.length > 0 && wouldEntityCount > PATCH_INTEL_BATCH_MAX_ENTITIES;

    if (!cur || overChars || overEntities) {
      if (rawBatches.length >= PATCH_INTEL_MAX_BATCHES) {
        batchCapped = true;
        break;
      }
      cur = { unitIds: [], units: [], chars: 0, entityKeys: new Set(), entityKeysByUnitId: new Map(), factDataByUnitId: new Map() };
      rawBatches.push(cur);
    }
    cur.unitIds.push(unit.id);
    cur.units.push(unit);
    cur.chars += addChars;
    cur.entityKeysByUnitId.set(unit.id, strongKeys);
    cur.factDataByUnitId.set(unit.id, factData);
    strongKeys.forEach((k) => cur.entityKeys.add(k));
  }

  // ---- coalesce small adjacent batches up toward MIN_CHARS ----
  const coalesced = [];
  for (const b of rawBatches) {
    const prev = coalesced[coalesced.length - 1];
    const combinedEntities = prev ? new Set([...prev.entityKeys, ...b.entityKeys]).size : Infinity;
    if (
      prev &&
      prev.chars < PATCH_INTEL_BATCH_MIN_CHARS &&
      prev.chars + b.chars <= PATCH_INTEL_BATCH_MAX_CHARS &&
      combinedEntities <= PATCH_INTEL_BATCH_MAX_ENTITIES
    ) {
      prev.unitIds.push(...b.unitIds);
      prev.units.push(...b.units);
      prev.chars += b.chars;
      b.entityKeys.forEach((k) => prev.entityKeys.add(k));
      for (const [uid, keys] of b.entityKeysByUnitId) prev.entityKeysByUnitId.set(uid, keys);
      for (const [uid, fd] of b.factDataByUnitId) prev.factDataByUnitId.set(uid, fd);
    } else {
      coalesced.push(b);
    }
  }

  const assignedUnitIds = new Set(coalesced.flatMap((b) => b.unitIds));
  const unassignedUnits = perUnit.map((p) => p.unit).filter((u) => !assignedUnitIds.has(u.id));

  const batches = coalesced.map((b, i) => {
    const factSummary = deriveBatchFactSummary(b.unitIds, b.factDataByUnitId, itemRosterById);
    return {
      id: `B${String(i + 1).padStart(2, "0")}`,
      unitIds: b.unitIds,
      units: b.units,
      chars: b.chars,
      entities: [...b.entityKeys].map((k) => index.byKey.get(k)).filter(Boolean),
      entityKeysByUnitId: b.entityKeysByUnitId,
      factDataByUnitId: b.factDataByUnitId,
      ...factSummary,
    };
  });

  return {
    index,
    batches,
    emptyUnits,
    entityUnits,
    detectedAnywhere,
    unassignedUnits,
    ignoredUnits,
    capped: batchCapped || unassignedUnits.length > 0,
    stats: {
      totalUnits: units.length,
      emptyUnits: emptyUnits.length,
      batchedUnits: assignedUnitIds.size,
      unassignedUnits: unassignedUnits.length,
      ignoredUnits: ignoredUnits.length,
      ignoredChars,
      batches: batches.length,
    },
  };
}
