// Patch Notes -- pipeline orchestrator (file name kept for import stability).
//
//   Riot source text
//     -> parsePatchDocument        document structure (headings, hierarchy, blocks)
//     -> extractPatchNotes         ownership, normalized changes, stable IDs, accounting
//     -> mergeReviewState          carry human review over from the previous run (by changeId)
//     -> deriveLegacyReport        the championChanges/itemChanges/runeChanges/systemChanges view
//
// 100% deterministic, no network, no AI/LLM, no writes: it returns data and the
// caller (functions/api/admin/patch-check.js) decides what to save. It never
// touches Academy master data or production KV.

import { parsePatchDocument } from "./patchParser.js";
import { extractPatchNotes } from "./patchNotesExtract.js";
import { mergeReviewState, initReview, deriveLegacyReport, reviewSummary, applyClassificationRules } from "./patchNotesReview.js";
import { PATCH_INTEL_ENGINE_VERSION } from "./patchIntelligence.js";
import { PATCH_INTEL_BATCH_MAX_CHARS } from "./config.js";

export { PATCH_INTEL_ENGINE_VERSION };

/** @returns {{ ok:true, report, patchNotes, engineVersion, pipelineStats, complete:true }} */
// `classificationRules` ({ rules, available, catalog }, from functions/_lib/patchClassificationRules.js, read by the caller): the
// remembered "In Academy" rules are snapshotted into this revision AFTER the previous review is carried over, so this patch's own
// decisions always win. Omitted (older callers / tests) = rules are not consulted at all.
export async function runPatchIntelAnalysis({ patchContent, championRoster, itemRoster, runeRoster, patchVersion = null, sourceUrl = null, extractedAt = new Date().toISOString(), previousPatchNotes = null, classificationRules = null }) {
  const parsed = parsePatchDocument(patchContent, { maxUnitChars: PATCH_INTEL_BATCH_MAX_CHARS });
  const extracted = extractPatchNotes({ units: parsed.units, championRoster, itemRoster, runeRoster, patchVersion, sourceUrl, extractedAt });
  const patchNotes = previousPatchNotes ? mergeReviewState(extracted, previousPatchNotes) : initReview(extracted);
  if (classificationRules) applyClassificationRules(patchNotes, { ...classificationRules, now: extractedAt });
  const legacy = deriveLegacyReport(patchNotes, { itemRoster, mode: "draft" });

  const categoryCounts = {};
  for (const u of parsed.units) if (!u.empty) categoryCounts[u.category] = (categoryCounts[u.category] || 0) + 1;
  const report = {
    ...legacy,
    supportMetaAnalysis: "", recommendedTierChanges: [], unanalyzedFacts: [],
    patchNotes,
    patchNotesSummary: { ...reviewSummary(patchNotes), validation: patchNotes.validation },
    analysisCoverage: { totalBlocks: patchNotes.validation.totalMeaningfulBlocks, unaccountedBlocks: patchNotes.validation.droppedBlocks, entityStatus: reviewSummary(patchNotes).status },
  };
  return { ok: true, report, patchNotes, engineVersion: PATCH_INTEL_ENGINE_VERSION, pipelineStats: { parsedUnits: parsed.stats, categoryCounts }, complete: true };
}
