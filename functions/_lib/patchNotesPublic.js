// Patch Notes -- the PUBLIC view of a report. One function, used by the public endpoint (GET /api/patch-reports) AND by the admin
// endpoint's preview, so "what the admin sees as the public summary" and "what visitors get" are the same computation.
//
//   reviewed dataset (patchNotes)  --deriveLegacyReport(mode:"publish")-->  visible entries (+ subsections, classification, notes)
//                                  --buildPatchSummary-->                   summary (custom text, else generated from THOSE entries)
//
// The review dataset itself -- original Riot source per change, normalized extraction, provenance, fingerprints, change IDs --
// never leaves the admin API; only presentation fields do: display text, the reviewer's note, the classification badge, the
// subsection headings and the summary. Nothing here writes anything.

import { deriveLegacyReport, subsectionOf, subsectionKeyOf, scopeOf } from "./patchNotesReview.js";
import { normalizeScope, normalizeVisualOverride, defaultVisualForScope, effectiveVisual } from "../../src/lib/patchNotesPresentation.js";
import { buildPatchSummary } from "../../src/lib/patchNotesPresentation.js";

const publicSubsections = (subsections) => (subsections || []).map((s) => ({
  // scope = what kind of section this is (ABILITY / PASSIVE / BASE_STATS / CHAMPION_MECHANIC / ITEM / ...): the page shows an ability icon only for
  // the ability-like ones. abilityName is withheld (null) for everything else.
  title: s.title || null, sourceHeading: s.sourceHeading || null, abilityName: s.abilityName || null, scope: s.scope || null,
  // visual = the EFFECTIVE icon policy ("SHOW" | "HIDE"): the scope's default unless a reviewer forced it either way. The page renders this and
  // never sees (or interprets) the reviewer's override itself.
  visual: s.visual,
  changes: s.changes.map((c) => ({ text: c.text, note: c.note || "", classification: c.classification })),
}));
// `confidence` = extraction confidence (how sure the parser is of the fact/ownership): internal, never part of the public view, so it
// can never be mistaken for how big a change is. The reviewed change impact (changeImpact) is the only impact the public page gets.
const publicEntry = ({ changes, changeIds, sectionKey, subsections, classificationExtracted, classificationOverridden, confidence, ...entry }) => ({ ...entry, subsections: publicSubsections(subsections) });

/** @param {object} report  a stored report revision (published)  @param {Array} itemRoster  effective Academy items (for the info-vs-patch flag) */
export function toPublicView(report, itemRoster = []) {
  if (!report.patchNotes || !Array.isArray(report.patchNotes.changes)) {
    // legacy (AI-era) revision: no dataset. Its stored summary text is shown as-is; when it has none the summary is generated from
    // the very arrays the page renders -- the same function, so a count and a message can never disagree.
    return { ...report, summary: buildPatchSummary(report, { legacyText: report.supportMetaAnalysis }) };
  }
  const { patchNotes, patchNotesSummary, analysisCoverage, ...rest } = report;
  const view = deriveLegacyReport(patchNotes, { itemRoster, mode: "publish" });
  const pub = {
    championChanges: view.championChanges.map(publicEntry), itemChanges: view.itemChanges.map(publicEntry),
    runeChanges: view.runeChanges.map(publicEntry), systemChanges: view.systemChanges.map(publicEntry),
  };
  const custom = patchNotes.summaryReview && patchNotes.summaryReview.text;
  return { ...rest, ...pub, summary: buildPatchSummary(pub, { customText: custom, legacyText: report.supportMetaAnalysis }) };
}

/** What the admin panel shows next to its editors: the summary visitors would get for this revision if it were published now, and
 *  which Riot subsection each change sits under (so the UI groups exactly like the public page, with ONE implementation of the keys). */
export function publicPreview(report, itemRoster = []) {
  const preview = { summary: toPublicView(report, itemRoster).summary, subsections: {} };
  const changes = report.patchNotes && Array.isArray(report.patchNotes.changes) ? report.patchNotes.changes.concat(report.patchNotes.orphanedChanges || []) : [];
  const sr = (report.patchNotes && report.patchNotes.subsectionReview) || {};
  for (const c of changes) {
    const s = subsectionOf(c); if (!s) continue;
    const key = subsectionKeyOf(c); const extracted = scopeOf(c); const override = normalizeScope((sr[key] || {}).scope);
    const visualOverride = normalizeVisualOverride((sr[key] || {}).visualOverride);
    preview.subsections[c.changeId] = { key, sourceHeading: s.sourceHeading, scope: override || extracted.scope, scopeExtracted: extracted.scope, scopeBasis: extracted.basis, scopeOverridden: Boolean(override), visualOverride, visualDefault: defaultVisualForScope(override || extracted.scope), visual: effectiveVisual(override || extracted.scope, visualOverride), entityType: c.entity ? c.entity.type : null };
  }
  return preview;
}
