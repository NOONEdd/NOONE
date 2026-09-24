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
// DETERMINISTIC-FIRST ADDITIONS (2026-09-23 refactor), all ADDITIVE --
// none of the five states above or the existing analysisCoverage/report
// fields change shape or meaning:
//   * analysisCoverage.gate: how many units patchPlanner.js's relevance
//     gate set aside before any AI call (see PATCH_INTEL_RELEVANT_NO_
//     ENTITY_CATEGORIES in config.js) -- the concrete "AI requests
//     skipped" number the diagnostics the spec calls for need.
//   * analysisCoverage.academyDataFlags / addedOrRemovedSignals /
//     unattributedFacts: pulled straight from plan.batches (populated at
//     PLANNING time, before any AI call -- see patchChangeDetector.js),
//     so these are present even for a batch whose AI call later failed.
//   * report.unanalyzedFacts: for any entity that ended up
//     detected_unknown or unresolved (no confirmed AI verdict), the
//     deterministic facts already extracted for it, if any -- this is
//     what keeps "AI interpretation unavailable" from also meaning "the
//     facts are gone too" (see patchIntelPipeline.js's total-failure
//     path, which populates this from `plan` alone when NO batch ever
//     even ran).
//
// Pure functions, no I/O, no AI calls.

import { mergeDuplicateEntities, dedupeByEntity } from "./patchIntelligence.js";

export const AGGREGATE_VERSION = "aggregate-v2";

/** Collects the deterministic, pre-AI signals patchPlanner.js already
 *  attached to every batch (entityFacts/academyDataFlags/
 *  addedOrRemovedSignals/unattributedFacts) into flat, dedupe-friendly
 *  structures -- independent of whether any batch's AI call actually
 *  succeeded, since all of this is available before AI is ever called.
 *  Exported so patchIntelPipeline.js's total-failure/no-batches paths
 *  can call it directly on `plan` with no batch results at all. */
export function collectDeterministicFindings(plan) {
  const factsByEntityKey = new Map();
  const academyDataFlags = [];
  const addedOrRemovedSignals = [];
  const unattributedFacts = [];
  for (const b of plan.batches || []) {
    for (const [key, facts] of b.entityFacts || new Map()) {
      if (!factsByEntityKey.has(key)) factsByEntityKey.set(key, facts);
    }
    academyDataFlags.push(...(b.academyDataFlags || []));
    addedOrRemovedSignals.push(...(b.addedOrRemovedSignals || []));
    unattributedFacts.push(...(b.unattributedFacts || []));
  }
  return { factsByEntityKey, academyDataFlags, addedOrRemovedSignals, unattributedFacts };
}

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
  const deterministic = collectDeterministicFindings(plan);

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

  const report = { supportMetaAnalysis, championChanges, itemChanges, runeChanges, systemChanges, recommendedTierChanges, unanalyzedFacts: [] };

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

  // Entities with no confirmed AI verdict (detected_unknown/unresolved)
  // still show their deterministic facts here, if any were extracted --
  // "AI interpretation unavailable" never has to mean "the facts are
  // gone too" (see this file's header and patchIntelPipeline.js's
  // total-failure path, which calls collectDeterministicFindings
  // directly on `plan` with no batch results at all).
  report.unanalyzedFacts = entities
    .filter((e) => (e.state === "detected_unknown" || e.state === "unresolved") && deterministic.factsByEntityKey.has(e.key))
    .map((e) => ({ key: e.key, type: e.type, id: e.id, name: e.name, ...deterministic.factsByEntityKey.get(e.key) }));

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
    // ---- deterministic-first diagnostics (2026-09-23 refactor) ----
    gate: {
      unitsIgnored: plan.stats.ignoredUnits,
      charsIgnored: plan.stats.ignoredChars,
    },
    entitiesWithDeterministicFacts: deterministic.factsByEntityKey.size,
    academyDataFlags: deterministic.academyDataFlags,
    addedOrRemovedSignals: deterministic.addedOrRemovedSignals,
    unattributedFacts: deterministic.unattributedFacts,
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

/** Merges a TARGETED retry's fresh analysis onto the PREVIOUS revision's
 *  already-saved report -- functions/api/admin/patch-check.js's
 *  retry-analysis action uses this whenever the previous revision has a
 *  usable analysisCoverage to target (a total prior failure, or a
 *  legacy revision with no coverage at all, has nothing to target and
 *  falls back to a full, non-targeted retry instead -- see that file).
 *
 *  `targetEntityKeys` is the exact Set<string> passed as onlyEntityKeys
 *  to runPatchIntelAnalysis: every entity in it was previously
 *  unresolved/detected_unknown and is what THIS round tried to resolve.
 *  Everything else is carried forward from `previousReport` completely
 *  untouched -- this round's own plan never even looked at those units
 *  (patchPlanner.js's onlyEntityKeys gate routes them to ignoredUnits),
 *  so treating its own fresh coverage as authoritative for them would
 *  incorrectly downgrade an already-confirmed verdict to
 *  "detected_unknown" just because this particular run didn't re-ask.
 *
 *  `freshReport` is the successful analysis's `report` (with
 *  `analysisCoverage` attached), or null when this round's AI calls all
 *  failed (total failure -- see patchIntelPipeline.js's `!anySucceeded`
 *  branch) -- in that case nothing new was actually learned, so the
 *  previous coverage/report content passes through unchanged except for
 *  `unanalyzedFacts`, which still absorbs whatever deterministic facts
 *  this round's failed-but-still-ran planning stage found
 *  (`freshDeterministicFindings`, from that same branch's
 *  `deterministicFindings` field -- survives even though AI never
 *  responded, per that file's header). */
export function mergeTargetedRetry({ previousReport, freshReport, freshDeterministicFindings, targetEntityKeys }) {
  const prevCoverage = previousReport.analysisCoverage || null;
  const freshCoverage = freshReport ? freshReport.analysisCoverage : null;

  let entities;
  if (freshCoverage) {
    const prevByKey = new Map((prevCoverage?.entities || []).map((e) => [e.key, e]));
    entities = freshCoverage.entities.map((e) => (targetEntityKeys.has(e.key) ? e : prevByKey.get(e.key) || e));
  } else {
    entities = prevCoverage?.entities || [];
  }
  const states = { not_detected: 0, detected_no_change: 0, changed_not_relevant: 0, changed_relevant: 0, detected_unknown: 0, unresolved: 0 };
  for (const e of entities) states[e.state] = (states[e.state] || 0) + 1;
  // Matches patchAggregate.js's aggregateResults(): completeness is
  // about whether every BATCH succeeded (no permanent failure, nothing
  // left unattempted by capacity/budget), never about whether every
  // entity got an explicit AI verdict. "detected_unknown" (mentioned,
  // batch succeeded, but the AI just didn't include a verdict for it --
  // rule 11's soft gap, not a failure) has never blocked "complete"
  // anywhere else in this pipeline; it must not start doing so here
  // either, or a targeted retry could loop forever chasing a verdict
  // gap that isn't actually a failure.
  const complete = states.unresolved === 0;

  const analysisCoverage = {
    ...(freshCoverage || prevCoverage || {}),
    entities,
    states,
    totalEntities: entities.length,
    detectedEntities: entities.filter((e) => e.state !== "not_detected").length,
    complete,
    // This round's own gate/flag signals are additive information about
    // the small slice of units it actually looked at -- combined with
    // whatever the previous run already found, never replacing it (a
    // targeted retry only ever looks at a fraction of the patch, so its
    // own numbers alone would understate the whole patch's totals).
    gate: {
      unitsIgnored: (prevCoverage?.gate?.unitsIgnored || 0) + (freshCoverage?.gate?.unitsIgnored || 0),
      charsIgnored: (prevCoverage?.gate?.charsIgnored || 0) + (freshCoverage?.gate?.charsIgnored || 0),
    },
    academyDataFlags: [...(prevCoverage?.academyDataFlags || []), ...(freshCoverage?.academyDataFlags || [])],
    addedOrRemovedSignals: [...(prevCoverage?.addedOrRemovedSignals || []), ...(freshCoverage?.addedOrRemovedSignals || [])],
    unattributedFacts: [...(prevCoverage?.unattributedFacts || []), ...(freshCoverage?.unattributedFacts || [])],
  };

  const championChanges = mergeDuplicateEntities([...(previousReport.championChanges || []), ...((freshReport && freshReport.championChanges) || [])], "championId", "championName");
  const itemChanges = mergeDuplicateEntities([...(previousReport.itemChanges || []), ...((freshReport && freshReport.itemChanges) || [])], "itemId", "itemName");
  const runeChanges = mergeDuplicateEntities([...(previousReport.runeChanges || []), ...((freshReport && freshReport.runeChanges) || [])], "runeId", "runeName");
  // No entity id to key systemChanges by -- but the units this round
  // analyzed were, by construction, ones with NO prior confirmed
  // systemChanges (they were unresolved/detected_unknown), so a fresh
  // one is always net-new; a plain concat is correct, not a guess.
  const systemChanges = [...(previousReport.systemChanges || []), ...((freshReport && freshReport.systemChanges) || [])];
  const recommendedTierChanges = dedupeByEntity([...(previousReport.recommendedTierChanges || []), ...((freshReport && freshReport.recommendedTierChanges) || [])], "entityId", "entityName");

  // unanalyzedFacts: only for entities STILL open (detected_unknown/
  // unresolved) after this merge -- one that just got resolved this
  // round drops out, whether it landed a real report entry or the fresh
  // verdict was "no change"/"not relevant"; either way it is no longer
  // "unanalyzed".
  const stillOpenKeys = new Set(entities.filter((e) => e.state === "detected_unknown" || e.state === "unresolved").map((e) => e.key));
  const priorUnanalyzed = new Map((previousReport.unanalyzedFacts || []).map((f) => [f.key, f]));
  const freshUnanalyzed = new Map(((freshReport && freshReport.unanalyzedFacts) || []).map((f) => [f.key, f]));
  const freshFindingsFacts = freshDeterministicFindings ? freshDeterministicFindings.factsByEntityKey : new Map();
  const unanalyzedFacts = [...stillOpenKeys]
    .map((key) => {
      const known = freshUnanalyzed.get(key) || priorUnanalyzed.get(key);
      if (known) return known;
      if (freshFindingsFacts.has(key)) {
        const e = entities.find((x) => x.key === key);
        return { key, type: e?.type, id: e?.id, name: e?.name, ...freshFindingsFacts.get(key) };
      }
      return null;
    })
    .filter(Boolean);

  return {
    // Describes the WHOLE patch; a targeted retry's own summary only
    // covers the tiny re-analyzed slice, so overwriting this with it
    // would be a regression, not an update -- the original stands.
    supportMetaAnalysis: previousReport.supportMetaAnalysis,
    championChanges,
    itemChanges,
    runeChanges,
    systemChanges,
    recommendedTierChanges,
    unanalyzedFacts,
    analysisCoverage,
  };
}
