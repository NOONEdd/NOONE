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
// Change SCOPE: what kind of thing a change is about. Extraction-layer fact (change.scope, with change.scopeBasis saying what it rests on),
// never a Support judgement and never the ability-icon system's business: the icon lookup only ever runs for the two ability-like scopes
// below, and this file is the single definition of which those are.
//   BASE_STATS         Riot's own stats section ("Base Stats")
//   PASSIVE            Riot's explicit passive notation ("Passive - X")
//   ABILITY            a named ability block under a champion (explicit Q/W/E/R notation, or Riot's named block)
//   CHAMPION_MECHANIC  any other champion-specific change: no Riot subsection, a champion lifecycle line, or a section a reviewer marked so
//   ITEM / RUNE / SYSTEM   by what owns the change
// ---------------------------------------------------------------------------------------------------------------
export const CHANGE_SCOPE = Object.freeze({ BASE_STATS: "BASE_STATS", PASSIVE: "PASSIVE", ABILITY: "ABILITY", CHAMPION_MECHANIC: "CHAMPION_MECHANIC", ITEM: "ITEM", RUNE: "RUNE", SYSTEM: "SYSTEM" });
const SCOPE_SET = new Set(Object.values(CHANGE_SCOPE));
const SCOPE_LABELS = { BASE_STATS: "Base stats", PASSIVE: "Passive", ABILITY: "Ability", CHAMPION_MECHANIC: "Champion mechanic", ITEM: "Item", RUNE: "Rune", SYSTEM: "System" };
/** The scopes a reviewer may assign to a champion's Riot subsection when the extractor's default is wrong. */
export const SUBSECTION_SCOPE_OPTIONS = Object.freeze([CHANGE_SCOPE.ABILITY, CHANGE_SCOPE.PASSIVE, CHANGE_SCOPE.BASE_STATS, CHANGE_SCOPE.CHAMPION_MECHANIC].map((v) => [v, SCOPE_LABELS[v]]));
export function normalizeScope(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return SCOPE_SET.has(v) ? v : null;
}
export const scopeLabel = (value) => SCOPE_LABELS[normalizeScope(value)] || null;
/** True only for scopes that are an ability's own section (it has an icon). Anything else -- including a missing/unknown scope -- is not. */
export const isAbilityScope = (value) => { const v = normalizeScope(value); return v === CHANGE_SCOPE.ABILITY || v === CHANGE_SCOPE.PASSIVE; };

// ---------------------------------------------------------------------------------------------------------------
// Visual (the existing ability icon) -- HOW a section is displayed, independent of WHAT it is (scope). The scope gives the default; a reviewer's
// explicit SHOW / HIDE (dataset.subsectionReview[key].visualOverride) always wins; absent / null / "AUTO" = use the default. Resolved once, in
// the public-view layer, so the page just renders the result.
//   ABILITY, PASSIVE -> SHOW        BASE_STATS, CHAMPION_MECHANIC (and everything else) -> HIDE
// ---------------------------------------------------------------------------------------------------------------
export const VISUAL = Object.freeze({ SHOW: "SHOW", HIDE: "HIDE" });
/** Choices for the reviewer, in display order: [stored value ("" = Auto), label]. */
export const VISUAL_OVERRIDE_OPTIONS = Object.freeze([["", "Auto"], [VISUAL.SHOW, "Show"], [VISUAL.HIDE, "Hide"]]);
/** "show" / "Hide" -> "SHOW" / "HIDE"; anything else (incl. "AUTO", "", null, undefined) -> null = Auto. */
export const normalizeVisualOverride = (value) => { const v = typeof value === "string" ? value.trim().toUpperCase() : ""; return v === VISUAL.SHOW || v === VISUAL.HIDE ? v : null; };
export const defaultVisualForScope = (scope) => (isAbilityScope(scope) ? VISUAL.SHOW : VISUAL.HIDE);
/** The policy: an explicit reviewer override always wins; otherwise the scope's default. */
export const effectiveVisual = (scope, override) => normalizeVisualOverride(override) || defaultVisualForScope(scope);

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
