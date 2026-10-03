// Patch Notes -- shared presentation helpers. Pure, deterministic, no I/O, no dependencies, no AI.
//
// Imported by BOTH the server (functions/_lib/patchNotesReview.js / patchNotesPublic.js, which build the public view)
// and the UI (PatchNotesPage.jsx, PatchNotesReview.jsx), the same way src/lib/effectiveData.js is shared -- so the
// headline count, the summary sentence and the classification badge can never be computed two different ways.

// ---------------------------------------------------------------------------------------------------------------
// Classification vocabulary. The canonical stored value for "Riot gave an old -> new pair with no buff/nerf wording"
// stays ADJUSTED (it is what the extractor has always stored); it is DISPLAYED as "Adjustment" and the admin may type
// either spelling. UNKNOWN is the honest answer whenever the source supports no deterministic classification.
// ---------------------------------------------------------------------------------------------------------------
export const CLASSIFICATION = Object.freeze({ BUFF: "BUFF", NERF: "NERF", ADJUSTED: "ADJUSTED", NEW: "NEW", REMOVED: "REMOVED", UNKNOWN: "UNKNOWN" });
const CLASSIFICATION_SET = new Set(Object.values(CLASSIFICATION));
const LABELS = { BUFF: "Buff", NERF: "Nerf", ADJUSTED: "Adjustment", NEW: "New", REMOVED: "Removed", UNKNOWN: "Unknown" };

/** Options the admin may pick, in display order: [canonical value, label]. */
export const CLASSIFICATION_OPTIONS = Object.freeze(Object.values(CLASSIFICATION).map((v) => [v, LABELS[v]]));

/** "ADJUSTMENT" and "ADJUSTED" (any case) both mean ADJUSTED. Anything else that is not in the vocabulary -> null. */
export function normalizeClassification(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  if (v === "ADJUSTMENT") return CLASSIFICATION.ADJUSTED;
  return CLASSIFICATION_SET.has(v) ? v : null;
}
/** Extraction values outside the vocabulary (e.g. the never-produced UNCHANGED) read as UNKNOWN, never as a guess. */
export const classificationOrUnknown = (value) => normalizeClassification(value) || CLASSIFICATION.UNKNOWN;
export const classificationLabel = (value) => LABELS[classificationOrUnknown(value)];

/** One badge for a whole entity from its visible changes' EFFECTIVE (override-aware) states.
 *  UNKNOWN never outvotes a real state; a single distinct real state is used as-is; disagreeing states read as the
 *  neutral Adjustment (the per-change chips keep the detail). No game knowledge involved. */
export function deriveEntityClassification(states) {
  const list = (states || []).map(classificationOrUnknown);
  const real = [...new Set(list.filter((s) => s !== CLASSIFICATION.UNKNOWN))];
  if (real.length === 0) return CLASSIFICATION.UNKNOWN;
  return real.length === 1 ? real[0] : CLASSIFICATION.ADJUSTED;
}

// ---------------------------------------------------------------------------------------------------------------
// Change impact: how substantial the changes to ONE entity are in this patch, as judged by the human reviewer.
// It is Academy review metadata -- Riot publishes no such rating and nothing is extracted or computed for it, so an entity
// is simply "not rated" (null) until the Admin sets it. It is NOT the extraction confidence (`confidence` on a derived
// entry: how sure the parser is of the fact/ownership), which stays internal and is never shown as gameplay impact.
// ---------------------------------------------------------------------------------------------------------------
export const CHANGE_IMPACT = Object.freeze({ LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" });
const IMPACT_LABELS = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };
/** Options the admin may pick, in display order: [canonical value, label]. */
export const CHANGE_IMPACT_OPTIONS = Object.freeze(Object.values(CHANGE_IMPACT).map((v) => [v, IMPACT_LABELS[v]]));
/** "low" / "Low" / "LOW" -> "LOW"; anything else (incl. "" and null) -> null = not rated. */
export function normalizeChangeImpact(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(IMPACT_LABELS, v) ? v : null;
}
/** Label for the public/admin chip, or null when not rated (the page then shows no impact chip at all). */
export const changeImpactLabel = (value) => { const v = normalizeChangeImpact(value); return v ? IMPACT_LABELS[v] : null; };

// ---------------------------------------------------------------------------------------------------------------
// Patch summary. ONE function, fed with the arrays the page actually renders, so the count and the message cannot
// disagree. A custom (human-written) text always wins; otherwise the text is generated from the same arrays.
// ---------------------------------------------------------------------------------------------------------------
export const NO_CHANGES_TEXT = "No Support-relevant changes identified in this patch.";
const arr = (v) => (Array.isArray(v) ? v : []);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * @param {{championChanges?:any[], itemChanges?:any[], runeChanges?:any[], systemChanges?:any[]}} view  the VISIBLE entries
 * @param {{customText?:string|null, legacyText?:string|null}} [opts]
 *   customText  the reviewer's summary override (patchNotes.summaryReview.text)
 *   legacyText  report.supportMetaAnalysis: the AI-era summary of old revisions / a hand-typed legacy edit. Treated as a
 *               custom text when non-empty; the deterministic pipeline itself always writes "" there.
 * @returns {{ source:"custom"|"generated", text:string, headline:string|null, generatedText:string, generatedHeadline:string,
 *             total:number, counts:{champions:number,items:number,runes:number,system:number}, empty:boolean }}
 *   headline is null when a custom text is in use (the generated count must not sit beside a human message that may differ).
 */
export function buildPatchSummary(view, { customText = null, legacyText = null } = {}) {
  const counts = { champions: arr(view && view.championChanges).length, items: arr(view && view.itemChanges).length, runes: arr(view && view.runeChanges).length, system: arr(view && view.systemChanges).length };
  const total = counts.champions + counts.items + counts.runes + counts.system;
  const parts = [];
  if (counts.champions) parts.push(plural(counts.champions, "champion"));
  if (counts.items) parts.push(plural(counts.items, "item"));
  if (counts.runes) parts.push(plural(counts.runes, "rune"));
  if (counts.system) parts.push(`${counts.system} ${counts.system === 1 ? "system / meta change" : "system / meta changes"}`);
  const generatedHeadline = total ? `${total} Support-relevant change${total === 1 ? "" : "s"}` : "No Support-relevant changes";
  const generatedText = total ? `${generatedHeadline}: ${parts.join(", ")}.` : NO_CHANGES_TEXT;
  const custom = [customText, legacyText].map((t) => (typeof t === "string" ? t.trim() : "")).find(Boolean) || "";
  return custom
    ? { source: "custom", text: custom, headline: null, generatedText, generatedHeadline, total, counts, empty: total === 0 }
    : { source: "generated", text: generatedText, headline: generatedHeadline, generatedText, generatedHeadline, total, counts, empty: total === 0 };
}
