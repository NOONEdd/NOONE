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
  PATCH_INTEL_BATCH_MAX_CHARS,
  PATCH_INTEL_BATCH_MIN_CHARS,
  PATCH_INTEL_BATCH_MAX_ENTITIES,
  PATCH_INTEL_MAX_BATCHES,
} from "./config.js";

export const PLANNER_VERSION = "plan-v1";

/** Splits one already-planned batch into two roughly-equal-chars halves,
 *  cutting only at unit boundaries (never inside a unit -- units are
 *  already the smallest safe cut point per patchParser.js). Used by
 *  patchAnalysis.js's retry-with-split when a batch's response comes
 *  back truncated: the batch that was too large for one AI call becomes
 *  two independent, correctly-re-scoped batches (each with its OWN
 *  entities recomputed from entityKeysByUnitId, never the original
 *  combined list) that are retried separately. A batch with only one
 *  unit cannot be split further -- callers check unitIds.length > 1
 *  before calling this. */
export function splitBatchInHalf(batch, index) {
  if (batch.unitIds.length < 2) return [batch];
  const mid = Math.max(1, Math.floor(batch.units.length / 2));
  const halves = [batch.units.slice(0, mid), batch.units.slice(mid)];
  return halves.map((unitsHalf, i) => {
    const unitIds = unitsHalf.map((u) => u.id);
    const entityKeys = new Set();
    for (const uid of unitIds) (batch.entityKeysByUnitId.get(uid) || []).forEach((k) => entityKeys.add(k));
    return {
      id: `${batch.id}.${i + 1}`,
      unitIds,
      units: unitsHalf,
      chars: unitsHalf.reduce((n, u) => n + u.chars + 1, 0),
      entities: [...entityKeys].map((k) => index.byKey.get(k)).filter(Boolean),
      entityKeysByUnitId: new Map(unitIds.map((uid) => [uid, batch.entityKeysByUnitId.get(uid) || []])),
    };
  });
}

/**
 * @param {object} args
 * @param {Array}  args.units           patchParser.parsePatchDocument(...).units
 * @param {Array}  args.championRoster  Academy-covered champions (id/name/...)
 * @param {Array}  args.itemRoster
 * @param {Array}  args.runeRoster
 * @returns {{
 *   index: object,                      // patchAcademyDetection's index (reused for the final "never mentioned anywhere" pass)
 *   batches: Array<{ id, unitIds, units, chars, entities }>,
 *   emptyUnits: Array,                   // units with no body text at all -- not a failure, just nothing to analyze
 *   entityUnits: Map<string, Set<string>>, // entityKey -> unit ids it was detected in, for coverage attribution
 *   detectedAnywhere: Set<string>,       // entity keys detected in ANY unit, batched or not
 *   unassignedUnits: Array,              // units that didn't fit within PATCH_INTEL_MAX_BATCHES
 *   capped: boolean,
 *   stats: { totalUnits, emptyUnits, batchedUnits, unassignedUnits, batches }
 * }}
 */
export function planPatchAnalysis({ units, championRoster, itemRoster, runeRoster }) {
  const index = buildAcademyIndex({ championRoster, itemRoster, runeRoster });

  const emptyUnits = [];
  const perUnit = [];
  const entityUnits = new Map();
  const detectedAnywhere = new Set();

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
    perUnit.push({ unit, strongKeys });
  }

  // ---- pack units into batches, greedily, in document order ----
  // Each batch keeps entityKeysByUnitId (unit id -> that unit's OWN
  // strong entity keys, not the batch total) alongside the aggregated
  // set -- patchAnalysis.js's retry-with-split needs to recompute a
  // correct, smaller entity list for each half of a batch it splits,
  // without re-running detection from scratch.
  const rawBatches = [];
  let cur = null;
  let batchCapped = false;

  for (const { unit, strongKeys } of perUnit) {
    const addChars = unit.chars + 1;
    const wouldEntityCount = cur ? new Set([...cur.entityKeys, ...strongKeys]).size : new Set(strongKeys).size;
    const overChars = cur && cur.chars + addChars > PATCH_INTEL_BATCH_MAX_CHARS;
    const overEntities = cur && cur.unitIds.length > 0 && wouldEntityCount > PATCH_INTEL_BATCH_MAX_ENTITIES;

    if (!cur || overChars || overEntities) {
      if (rawBatches.length >= PATCH_INTEL_MAX_BATCHES) {
        batchCapped = true;
        break;
      }
      cur = { unitIds: [], units: [], chars: 0, entityKeys: new Set(), entityKeysByUnitId: new Map() };
      rawBatches.push(cur);
    }
    cur.unitIds.push(unit.id);
    cur.units.push(unit);
    cur.chars += addChars;
    cur.entityKeysByUnitId.set(unit.id, strongKeys);
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
    } else {
      coalesced.push(b);
    }
  }

  const assignedUnitIds = new Set(coalesced.flatMap((b) => b.unitIds));
  const unassignedUnits = perUnit.map((p) => p.unit).filter((u) => !assignedUnitIds.has(u.id));

  const batches = coalesced.map((b, i) => ({
    id: `B${String(i + 1).padStart(2, "0")}`,
    unitIds: b.unitIds,
    units: b.units,
    chars: b.chars,
    entities: [...b.entityKeys].map((k) => index.byKey.get(k)).filter(Boolean),
    entityKeysByUnitId: b.entityKeysByUnitId,
  }));

  return {
    index,
    batches,
    emptyUnits,
    entityUnits,
    detectedAnywhere,
    unassignedUnits,
    capped: batchCapped || unassignedUnits.length > 0,
    stats: {
      totalUnits: units.length,
      emptyUnits: emptyUnits.length,
      batchedUnits: assignedUnitIds.size,
      unassignedUnits: unassignedUnits.length,
      batches: batches.length,
    },
  };
}
