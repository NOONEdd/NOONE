// Cross-batch aggregation for Patch Intelligence's multi-stage pipeline.
// Takes every batch's own (already-normalized) report + entityVerdicts
// from patchAnalysis.js and produces exactly TWO things:
//
//   1. ONE final report, in the SAME shape the single-call pipeline
//      always produced (championChanges/itemChanges/runeChanges/
//      systemChanges/recommendedTierChanges/supportMetaAnalysis) --
//      merged with the SAME one-entry-per-entity rules
//      patchIntelligence.js's mergeDuplicateEntities/dedupeByEntity
//      already enforce WITHIN one AI response, now just applied across
//      every batch's response too. This is entirely deterministic: NO
//      extra AI call is made just to summarize the summaries.
//
//   2. analysisCoverage: the 4-state diagnostic the spec asks for, for
//      EVERY Academy-tracked champion/item/rune, not just the ones that
//      ended up with a reported change --
//        not_detected              never mentioned anywhere in the patch
//        detected_no_change        mentioned, analyst confirmed nothing changed
//        changed_not_relevant      changed, analyst judged it not Support-relevant
//        changed_relevant          changed AND Support-relevant (has a report entry)
//      plus two HONEST fallback states for when the pipeline itself
//      couldn't get a clean answer (never silently merged into one of
//      the four above, which would misrepresent a gap as a real verdict):
//        detected_unknown          mentioned, its batch succeeded, but the AI
//                                   never actually gave an explicit verdict for it
//        unresolved                mentioned, but no batch ever successfully
//                                   analyzed the unit(s) it appeared in (a batch
//                                   failed after retries, or the time/capacity
//                                   budget was hit before it was ever attempted)
//
// Pure functions, no I/O, no AI calls.

import { mergeDuplicateEntities, dedupeByEntity } from "./patchIntelligence.js";

export const AGGREGATE_VERSION = "aggregate-v1";

/** A split batch's result carries `parts` (the recursive retry results
 *  for each half) instead of its own report -- this walks the tree down
 *  to the leaves that actually attempted an AI call. */
function flattenLeaves(results) {
  const leaves = [];
  const walk = (r) => {
    if (r.split) r.parts.forEach(walk);
    else leaves.push(r);
  };
  results.forEach(walk);
  return leaves;
}

function allRosterEntities(index) {
  return index.entities; // [{key,type,id,name,tier,...}] -- built by patchAcademyDetection.buildAcademyIndex
}

/**
 * @param {object} args
 * @param {object} args.plan          patchPlanner.planPatchAnalysis(...) result
 * @param {object} args.batchResults  patchAnalysis.runAllBatches(...) result ({results, notStartedBatches})
 * @param {Array}  args.championRoster
 * @param {Array}  args.itemRoster
 * @param {Array}  args.runeRoster
 * @returns {{
 *   report: object,                 // same shape the pipeline has always returned
 *   analysisCoverage: object,       // the manifest described above
 *   complete: boolean,
 *   anySucceeded: boolean,
 *   failedLeaves: Array,
 * }}
 */
export function aggregateResults({ plan, batchResults, championRoster, itemRoster, runeRoster }) {
  const { results, notStartedBatches } = batchResults;
  const leaves = flattenLeaves(results);
  const succeeded = leaves.filter((l) => l.ok);
  const failed = leaves.filter((l) => !l.ok);

  // ---- merge report content across every succeeded leaf ----
  const championChanges = mergeDuplicateEntities(succeeded.flatMap((l) => l.report.championChanges), "championId", "championName");
  const itemChanges = mergeDuplicateEntities(succeeded.flatMap((l) => l.report.itemChanges), "itemId", "itemName");
  const runeChanges = mergeDuplicateEntities(succeeded.flatMap((l) => l.report.runeChanges), "runeId", "runeName");
  const systemChanges = succeeded.flatMap((l) => l.report.systemChanges);
  const recommendedTierChanges = dedupeByEntity(succeeded.flatMap((l) => l.report.recommendedTierChanges), "entityId", "entityName");

  // supportMetaAnalysis: a single batch's own summary is used verbatim
  // (this is the common case -- most patches plan to one batch, and
  // this keeps that case byte-for-byte identical to the old single-call
  // behavior). More than one distinct non-empty summary is joined
  // deterministically; never a separate AI call just to write one
  // paragraph (see the file header).
  const uniqueSummaries = [...new Set(succeeded.map((l) => (l.report.supportMetaAnalysis || "").trim()).filter(Boolean))];
  const supportMetaAnalysis =
    uniqueSummaries.length === 0 ? "No Support-relevant changes in this patch." :
    uniqueSummaries.length === 1 ? uniqueSummaries[0] :
    uniqueSummaries.join(" ");

  const report = { supportMetaAnalysis, championChanges, itemChanges, runeChanges, systemChanges, recommendedTierChanges };

  // ---- entityVerdicts, OR-combined across every succeeded leaf that
  // touched this entity (an entity mentioned in more than one unit --
  // e.g. a champion referenced inside an item's own writeup -- can be
  // forced in more than one batch; "it changed" from any one of them is
  // never masked by another batch correctly reporting "no change" for a
  // DIFFERENT mention) ----
  const verdictAcc = new Map(); // key -> { changed: bool|null, supportRelevant: bool|null }
  for (const leaf of succeeded) {
    for (const v of leaf.entityVerdicts || []) {
      const acc = verdictAcc.get(v.key) || { changed: null, supportRelevant: null };
      if (v.changed === true) acc.changed = true;
      else if (v.changed === false && acc.changed !== true) acc.changed = false;
      if (v.supportRelevant === true) acc.supportRelevant = true;
      else if (v.supportRelevant === false && acc.supportRelevant !== true) acc.supportRelevant = false;
      verdictAcc.set(v.key, acc);
    }
  }

  const failedEntityKeys = new Set(failed.flatMap((l) => (l.entities || []).map((e) => e.key)));

  const neverExecutedUnitIds = new Set([
    ...plan.unassignedUnits.map((u) => u.id),
    ...notStartedBatches.flatMap((b) => b.unitIds),
  ]);
  const capacityUnresolvedKeys = new Set();
  for (const [key, unitIds] of plan.entityUnits) {
    if ([...unitIds].every((uid) => neverExecutedUnitIds.has(uid))) capacityUnresolvedKeys.add(key);
  }

  const stateCounts = {
    not_detected: 0, detected_no_change: 0, changed_not_relevant: 0,
    changed_relevant: 0, detected_unknown: 0, unresolved: 0,
  };
  const entities = allRosterEntities(plan.index).map((e) => {
    let state;
    if (!plan.detectedAnywhere.has(e.key)) {
      state = "not_detected";
    } else {
      const acc = verdictAcc.get(e.key);
      if (acc && acc.changed === true) {
        state = acc.supportRelevant === false ? "changed_not_relevant" : "changed_relevant";
      } else if (acc && acc.changed === false) {
        state = "detected_no_change";
      } else if (failedEntityKeys.has(e.key) || capacityUnresolvedKeys.has(e.key)) {
        state = "unresolved";
      } else {
        state = "detected_unknown";
      }
    }
    stateCounts[state]++;
    return { key: e.key, type: e.type, id: e.id, name: e.name, state };
  });

  const complete = failed.length === 0 && notStartedBatches.length === 0 && plan.unassignedUnits.length === 0;

  // Diagnostic-logging support (spec: retry attempts and batch/category
  // counts must be visible in Cloudflare's logs, not just inferable) --
  // walked from the same leaves/results already computed above, so this
  // never re-derives anything patch-check.js couldn't otherwise see.
  const totalAttempts = leaves.reduce((n, l) => n + (l.attempts || 0), 0);
  const batchesSplit = results.filter((r) => r.split).length;
  const maxAttemptsForOneBatch = leaves.reduce((n, l) => Math.max(n, l.attempts || 0), 0);

  const unresolvedUnits = [
    ...plan.unassignedUnits.map((u) => ({ id: u.id, title: u.title, reason: "batch_capacity_exceeded" })),
    ...notStartedBatches.flatMap((b) => b.unitIds.map((uid) => ({ id: uid, title: b.id, reason: "time_budget_exceeded" }))),
    ...failed.flatMap((l) => l.unitIds.map((uid) => ({ id: uid, title: l.batchId, reason: "ai_analysis_failed", code: l.code, error: l.error }))),
  ];

  const analysisCoverage = {
    version: AGGREGATE_VERSION,
    complete,
    totalEntities: entities.length,
    detectedEntities: plan.detectedAnywhere.size,
    states: stateCounts,
    entities,
    batches: {
      planned: plan.batches.length,
      succeeded: succeeded.length,
      failed: failed.length,
      notStarted: notStartedBatches.length,
    },
    failures: failed.map((l) => ({ batchId: l.batchId, unitIds: l.unitIds, code: l.code, error: l.error, attempts: l.attempts, splitDepth: l.splitDepth })),
    unresolvedUnits,
  };

  return {
    report,
    analysisCoverage,
    complete,
    anySucceeded: succeeded.length > 0,
    failedLeaves: failed,
    retryStats: { totalAttempts, batchesSplit, maxAttemptsForOneBatch },
  };
}
