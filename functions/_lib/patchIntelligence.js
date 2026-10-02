// Patch Notes' report-entry SHAPE and shared normalization/merge
// utilities.
//
// Formerly this file also defined the AI analyst's prompt, JSON schema,
// and response parser (buildBatchSystemPrompt / BATCH_REPORT_JSON_SCHEMA
// / parseAIJson / normalizePatchIntelReport / normalizeEntityVerdicts).
// All of that is gone as of the deterministic rebuild -- there is no AI
// call anywhere in Patch Notes anymore. The deterministic pipeline
// (patchNotesExtract.js -> patchNotesReview.js) replaced the old per-batch
// AI executor and cross-batch merger; it builds every report entry directly
// from patchChangeDetector.js's extracted facts and patchAcademyDetection.js's
// entity detection, using normalizeChangeEntry() below for the entry
// shape so a deterministically-built entry and a human-edited one always
// look the same to the rest of the app (the Admin Coach Review UI, the
// public report page, and patchReportsStore.js).
//
// Trust hierarchy this module still enforces: official Riot patch text
// is the ONLY source of "what changed" (patchChangeDetector.js extracts
// facts straight from it, never invents one). What THAT means for
// Support play, and any actual change to Academy champion/item/rune/
// build data, is a human Coach's job -- every "impact"/"implications"/
// "notes" field below starts empty and is filled in later via
// functions/api/admin/patch-reports.js's "edit" action. Nothing this
// module produces is ever written to public Academy data directly;
// that endpoint's "publish" action is the one human-gated bridge, and
// even that only ever touches the patch-number/verification fields via
// the KV safety layer (functions/_lib/kvSafety.js), never champion/item/
// rune content.

import { SOURCE_TEXT_VERSION } from "./patchText.js";
import { PARSER_VERSION } from "./patchParser.js";
import { PATCH_NOTES_EXTRACT_VERSION } from "./patchNotesExtract.js";
import { DETECTOR_VERSION, COMPARISON_STATE, RELEVANCE } from "./patchChangeDetector.js";

const SEVERITY_VALUES = ["Low", "Medium", "High"];
const CONFIDENCE_VALUES = ["Low", "Medium", "High"];
const TYPE_VALUES = ["Buff", "Nerf", "Adjustment"];
const COMPARISON_STATE_VALUES = Object.values(COMPARISON_STATE);
const RELEVANCE_VALUES = Object.values(RELEVANCE);

// Diagnostic marker -- proves, independent of anything the UI shows,
// that a given report/log line was produced by THIS pipeline shape, not
// an older deployed version or a stale cached result. "report-v1" marks
// the deterministic rebuild (no more AI batch-prompt component, since
// there's no AI call to version).
export const PATCH_INTEL_ENGINE_VERSION = `patch-notes-v1+${SOURCE_TEXT_VERSION}+${PARSER_VERSION}+${DETECTOR_VERSION}+${PATCH_NOTES_EXTRACT_VERSION}`;

function enumOrDefault(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}
function str(value) {
  return typeof value === "string" ? value : "";
}
function strArray(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}
// Structured per-line change records (patchChangeDetector.js's
// extractStructuredChanges): plain JSON objects, passed through as-is.
function recordArray(value) {
  return Array.isArray(value) ? value.filter((v) => v && typeof v === "object" && !Array.isArray(v)) : [];
}

/** Confidence is about how sure we are of the RIOT FACT and its
 *  attribution -- not a judgment about the change's importance (that's
 *  `relevance`, computed separately in patchNotesReview.js).
 *  Derived, never asked-for: a CONFIRMED comparison state (a clean,
 *  unambiguous before/after pair straight from Riot's own text) is
 *  always High; a low-confidence item-info signal (POSSIBLE) or an
 *  ambiguous extraction (UNKNOWN) is Low; everything else (including
 *  NOT_COMPARABLE and HUMAN_REVIEW_REQUIRED, where the fact itself is
 *  solid but nothing further can be confirmed against Academy data) is
 *  Medium -- solid on what Riot said, unresolved on what it means here. */
export function confidenceForComparisonState(state) {
  if (state === COMPARISON_STATE.CONFIRMED) return "High";
  if (state === COMPARISON_STATE.POSSIBLE || state === COMPARISON_STATE.UNKNOWN) return "Low";
  return "Medium";
}

/** Shapes one championChanges/itemChanges/runeChanges entry. Two kinds
 *  of fields, kept clearly apart (see this file's header):
 *    - FACT fields (whatChanged/previousValue/newValue/sourceRaw/
 *      comparisonState/relevance/detectionMethod/confidence) --
 *      supplied by patchNotesReview.js from Riot's own text,
 *      never hand-typed by a coach.
 *    - COACH fields (supportImpact/gameplayImplications/
 *      buildImplications/runeImplications/matchupImplications/
 *      laneImpact/roamImpact/teamfightImpact/objectiveVisionImpact/
 *      decisionChange/coachNotes/tierListActionNeeded/
 *      recommendedTierAction/reasoning/type/impactSeverity) -- all
 *      start blank/neutral and are filled in later by a human Coach via
 *      the "edit" action; this function's own defaults for them are
 *      just safe placeholders, never a claim about the change's actual
 *      impact.
 *  Called both by patchNotesReview.js (building a fresh entry)
 *  and by functions/api/admin/patch-reports.js's "edit" action
 *  (re-normalizing a coach's saved edits) -- same shape either way. */
export function normalizeChangeEntry(entry, { withChampionsAffected }) {
  const base = {
    // -- fact fields --
    whatChanged: str(entry.whatChanged),
    previousValue: str(entry.previousValue),
    newValue: str(entry.newValue),
    sourceRaw: str(entry.sourceRaw),
    // structured metadata (2026-09-30): where in Riot's notes this came from,
    // and every individual change line with its ability/slot/stat/changeType.
    sourceSection: str(entry.sourceSection),
    sourceSections: strArray(entry.sourceSections),
    changes: recordArray(entry.changes),
    comparisonState: enumOrDefault(entry.comparisonState, COMPARISON_STATE_VALUES, COMPARISON_STATE.UNKNOWN),
    relevance: enumOrDefault(entry.relevance, RELEVANCE_VALUES, RELEVANCE.VIABLE),
    detectionMethod: str(entry.detectionMethod) || "deterministic",
    confidence: enumOrDefault(entry.confidence, CONFIDENCE_VALUES, "Medium"),
    // -- coach fields (blank until a human fills them in) --
    type: enumOrDefault(entry.type, TYPE_VALUES, "Adjustment"),
    supportImpact: str(entry.supportImpact),
    impactSeverity: enumOrDefault(entry.impactSeverity, SEVERITY_VALUES, "Medium"),
    gameplayImplications: str(entry.gameplayImplications),
    buildImplications: str(entry.buildImplications),
    runeImplications: str(entry.runeImplications),
    matchupImplications: str(entry.matchupImplications),
    laneImpact: str(entry.laneImpact),
    roamImpact: str(entry.roamImpact),
    teamfightImpact: str(entry.teamfightImpact),
    objectiveVisionImpact: str(entry.objectiveVisionImpact),
    decisionChange: str(entry.decisionChange),
    coachNotes: str(entry.coachNotes),
    tierListActionNeeded: Boolean(entry.tierListActionNeeded),
    recommendedTierAction: str(entry.recommendedTierAction) || "No change",
    reasoning: str(entry.reasoning),
  };
  if (withChampionsAffected) base.championsAffected = strArray(entry.championsAffected);
  return base;
}

/** Shapes one systemChanges entry (an objective/macro/system change with
 *  no single Academy entity to attach it to). Same fact/coach split as
 *  normalizeChangeEntry, minus the entity-specific implication fields
 *  that don't apply to a systemwide change. */
export function normalizeSystemChangeEntry(entry) {
  return {
    area: str(entry.area) || "Other",
    whatChanged: str(entry.whatChanged),
    sourceRaw: str(entry.sourceRaw),
    sourceSection: str(entry.sourceSection),
    sourceSections: strArray(entry.sourceSections),
    changes: recordArray(entry.changes),
    // No Academy field exists to compare a system change against, so this
    // is CONFIRMED only when Riot itself states a clean old->new pair, and
    // NOT_COMPARABLE otherwise (same meaning as for items).
    comparisonState: enumOrDefault(entry.comparisonState, COMPARISON_STATE_VALUES, COMPARISON_STATE.NOT_COMPARABLE),
    relevance: enumOrDefault(entry.relevance, RELEVANCE_VALUES, RELEVANCE.SITUATIONAL),
    detectionMethod: str(entry.detectionMethod) || "deterministic",
    confidence: enumOrDefault(entry.confidence, CONFIDENCE_VALUES, "Medium"),
    supportImpact: str(entry.supportImpact),
    impactSeverity: enumOrDefault(entry.impactSeverity, SEVERITY_VALUES, "Medium"),
    championsAffected: strArray(entry.championsAffected),
    gameplayImplications: str(entry.gameplayImplications),
    roamImpact: str(entry.roamImpact),
    objectiveVisionImpact: str(entry.objectiveVisionImpact),
    decisionChange: str(entry.decisionChange),
    coachNotes: str(entry.coachNotes),
    reasoning: str(entry.reasoning),
  };
}

/** Safety net for "one entry per entity" -- deterministically merges any
 *  entries that resolved to the SAME id (or, if id resolution failed for
 *  both, the same normalized name). First-seen order and position are
 *  kept; whatChanged/previousValue/newValue/sourceRaw from every merged
 *  entry are concatenated so no factual detail is lost; every other
 *  field keeps the first entry's value, and championsAffected (items/
 *  runes only) is unioned rather than overwritten. Used both when
 *  building a fresh report (two units both naming the same champion) and
 *  when re-scanning a patch already under review (merging fresh facts
 *  onto a report that may already have coach edits on some entries --
 *  see functions/api/admin/patch-check.js's rescan action). */
export function mergeDuplicateEntities(entries, idField, nameField) {
  const merged = [];
  const indexByKey = new Map();
  const join = (a, b) => [a, b].map((s) => (s || "").trim()).filter(Boolean).join(" ");

  for (const entry of entries) {
    const key = entry[idField] || `name:${(entry[nameField] || "").trim().toLowerCase()}`;
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push(entry);
      continue;
    }
    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      whatChanged: join(existing.whatChanged, entry.whatChanged),
      previousValue: join(existing.previousValue, entry.previousValue),
      newValue: join(existing.newValue, entry.newValue),
      sourceRaw: join(existing.sourceRaw, entry.sourceRaw),
      // structured metadata is unioned too -- a merge never drops a change record or a source section
      ...(existing.changes || entry.changes ? { changes: [...(existing.changes || []), ...(entry.changes || [])] } : {}),
      ...(existing.sourceSections || entry.sourceSections ? { sourceSections: [...new Set([...(existing.sourceSections || []), ...(entry.sourceSections || [])])] } : {}),
      ...(existing.sourceSection || entry.sourceSection ? { sourceSection: [...new Set([existing.sourceSection, entry.sourceSection].filter(Boolean))].join(" ; ") } : {}),
      ...(existing.championsAffected
        ? { championsAffected: [...new Set([...existing.championsAffected, ...(entry.championsAffected || [])])] }
        : {}),
    };
  }
  return merged;
}

/** Same "one entry per entity" rule applied to recommendedTierChanges --
 *  that shape has no whatChanged/previousValue/newValue to concatenate
 *  (just from/to/reasoning), so a duplicate recommendation for the same
 *  entity is simply dropped (first one kept) rather than merged. */
export function dedupeByEntity(entries, idField, nameField) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const key = entry[idField] || `name:${(entry[nameField] || "").trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}
