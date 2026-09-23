// Patch Intelligence's pipeline entry point: the ONE function
// functions/api/admin/patch-check.js calls to turn one fetched, already
// structure-preserving patch text (functions/_lib/riotFallback.js's
// fetchAndCacheFullPatchContent, via patchText.js's htmlToStructuredText)
// into a finished report. Ties together every other new module:
//
//   patchParser.js        text -> ordered semantic units
//   patchPlanner.js        units -> adaptive AI-call-sized batches +
//                          deterministic Academy entity detection
//   patchAnalysis.js       runs every batch (bounded retry, split-on-
//                          truncation, wall-clock budget)
//   patchAggregate.js      merges every batch's output into one report
//                          + builds the analysisCoverage manifest
//   patchIntelligence.js   the prompt/schema/parse/normalize primitives
//                          all of the above are built on
//
// Kept as its own file (rather than living in patchIntelligence.js,
// which is where the single-call version of this used to live) to avoid
// a circular import: patchAnalysis.js needs patchIntelligence.js's
// primitives, and this file needs patchAnalysis.js -- so the
// orchestrator can't also live inside patchIntelligence.js without the
// two files importing each other.
//
// Return contract is UNCHANGED from the old single-call
// runPatchIntelAnalysis() so functions/api/admin/patch-check.js's
// existing success/failure handling keeps working with only the import
// path changed:
//   { ok: true, report: {...}, parseStrategy, maxTokens, engineVersion, complete, pipelineStats }
//   { ok: false, code, error, logDetail, maxTokens, engineVersion, pipelineStats }
// `report` now ALSO carries `analysisCoverage` (patchAggregate.js's
// manifest) -- additive, every field the old shape had is still there.
// `complete` is new and is what patch-check.js uses to tell a genuinely
// clean pass from "succeeded, but not every section could be resolved"
// (see that file's handling of PARTIAL_FAILURE_STATUS).

import { parsePatchDocument } from "./patchParser.js";
import { planPatchAnalysis } from "./patchPlanner.js";
import { runAllBatches } from "./patchAnalysis.js";
import { aggregateResults } from "./patchAggregate.js";
import { PATCH_INTEL_ENGINE_VERSION } from "./patchIntelligence.js";
import { PATCH_INTEL_MAX_TOKENS, PATCH_INTEL_BATCH_MAX_CHARS } from "./config.js";

export { PATCH_INTEL_ENGINE_VERSION };

function emptyCoverage(index) {
  return {
    version: "aggregate-v1", complete: false,
    totalEntities: index.entities.length, detectedEntities: 0,
    states: { not_detected: index.entities.length, detected_no_change: 0, changed_not_relevant: 0, changed_relevant: 0, detected_unknown: 0, unresolved: 0 },
    entities: index.entities.map((e) => ({ key: e.key, type: e.type, id: e.id, name: e.name, state: "not_detected" })),
    batches: { planned: 0, succeeded: 0, failed: 0, notStarted: 0 },
    failures: [], unresolvedUnits: [],
  };
}

/**
 * Runs the full multi-stage analysis for one already-fetched patch text.
 * Never throws. `patchContent` is the structure-preserving text
 * riotFallback.js's fetchAndCacheFullPatchContent produces -- this
 * function does no fetching of its own, same as the previous single-call
 * version.
 */
export async function runPatchIntelAnalysis({ env, patchContent, championRoster, itemRoster, runeRoster }) {
  const parsed = parsePatchDocument(patchContent, { maxUnitChars: PATCH_INTEL_BATCH_MAX_CHARS });
  const plan = planPatchAnalysis({ units: parsed.units, championRoster, itemRoster, runeRoster });
  // "batch count/categories" diagnostic (spec section 23): how many
  // non-empty units fall in each patchParser.js category, independent
  // of how the planner ends up packing them into batches.
  const categoryCounts = {};
  for (const u of parsed.units) {
    if (u.empty) continue;
    categoryCounts[u.category] = (categoryCounts[u.category] || 0) + 1;
  }
  const pipelineStats = { parsedUnits: parsed.stats, plan: plan.stats, categoryCounts };

  if (plan.batches.length === 0) {
    // Nothing analyzable was parsed at all (an essentially empty or
    // malformed fetch) -- reported plainly, never silently presented as
    // either a crash or a confidently-reached "quiet patch."
    return {
      ok: true,
      report: {
        supportMetaAnalysis: "No analyzable content was found in the fetched patch page.",
        championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [],
        analysisCoverage: emptyCoverage(plan.index),
      },
      parseStrategy: "no_batches",
      maxTokens: PATCH_INTEL_MAX_TOKENS,
      engineVersion: PATCH_INTEL_ENGINE_VERSION,
      pipelineStats,
      complete: false,
    };
  }

  const batchResults = await runAllBatches({ env, plan, patchTitle: parsed.title, patchIntro: parsed.intro, championRoster, itemRoster, runeRoster });
  const { report, analysisCoverage, complete, anySucceeded, failedLeaves, retryStats } = aggregateResults({ plan, batchResults, championRoster, itemRoster, runeRoster });

  if (!anySucceeded) {
    // Every batch failed -- same contract as the old single-call
    // failure path (ok:false + a specific code), so patch-check.js's
    // existing `if (!analysis.ok)` branch handles this exactly as it
    // always has; no caller change needed for this case specifically.
    const first = failedLeaves[0] || {};
    return {
      ok: false,
      code: first.code || "ai_error",
      error: first.error || "Analysis failed for every excerpt of this patch.",
      logDetail: failedLeaves.map((l) => `[${l.batchId}] ${l.code}: ${l.logDetail || l.error}`).join(" | ").slice(0, 2000),
      maxTokens: PATCH_INTEL_MAX_TOKENS,
      engineVersion: PATCH_INTEL_ENGINE_VERSION,
      pipelineStats: { ...pipelineStats, batchesAttempted: batchResults.results.length, batchesNotStarted: batchResults.notStartedBatches.length, retryStats },
    };
  }

  const strategies = [...new Set(batchResults.results.filter((r) => !r.split && r.ok).map((r) => r.parseStrategy).filter(Boolean))];

  return {
    ok: true,
    report: { ...report, analysisCoverage },
    parseStrategy: strategies.join("+") || "raw",
    maxTokens: PATCH_INTEL_MAX_TOKENS,
    engineVersion: PATCH_INTEL_ENGINE_VERSION,
    pipelineStats: { ...pipelineStats, batchesAttempted: batchResults.results.length, batchesNotStarted: batchResults.notStartedBatches.length, durationMs: batchResults.durationMs, retryStats },
    complete,
  };
}
