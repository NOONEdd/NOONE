// Patch Notes -- shared identity + classification model. Pure, dependency-free; imported by the server
// (functions/_lib/patchNotesExtract.js / patchNotesReview.js / patchNotesIds.js) AND the admin UI
// (src/components/PatchNotesReview.jsx), so a section key, a source identity or an effective classification can never be
// computed two different ways.
//
// IDENTITY (why this file exists first)
//   changeId / sectionKey   are built from the extractor's entity key, which DEPENDS ON THE MATCH RESULT
//                           ("item:bulwarkofthemountain" while untracked, "item:<catalog id>" once tracked). Their formula
//                           is deliberately left untouched: every stored historical ID stays valid, nothing is rewritten.
//   sourceKey               "<type>:<normalized Riot name>" -- what Riot actually wrote, independent of matching. It is the
//                           same before and after a canonical Academy record is added, so it is what reconnects review
//                           state when a changeId changes (patchNotesReview.js mergeReviewState) and what remembered
//                           classification rules are keyed by.

/** Compact alphanumeric form of an entity/heading name ("Kha'Zix" -> "khazix"). Part of the change-ID formula
 *  (functions/_lib/patchNotesIds.js re-exports this exact function) -- never change its output. */
export function normName(value) {
  return String(value ?? "").toLowerCase().replace(/[‘’`´]/g, "'").replace(/[^a-z0-9]+/g, "");
}

/** The review section a change belongs to (one entity, or one system block). */
export function sectionKeyOf(change) {
  return change.kind === "system" ? `system:${change.system.category}:${normName(change.system.area)}` : `entity:${change.entity.key}`;
}

/** The Riot name a change's owner was written as (provenance.sourceOwnerName). Datasets stored before that field existed derive
 *  it from what they already hold: an untracked entity's name IS Riot's text; a tracked one owned by its own heading has that
 *  heading in provenance; otherwise the matched name (equal to Riot's text up to the matcher's case/plural normalisation). */
export function sourceNameOf(change) {
  if (!change) return null;
  if (change.kind === "system") return change.system ? change.system.area : null;
  const e = change.entity;
  if (!e) return null;
  if (change.provenance && change.provenance.sourceOwnerName) return change.provenance.sourceOwnerName;
  if (!e.academyKey) return e.name;
  if (change.ownership && change.ownership.source === "entity_heading" && change.provenance && change.provenance.sourceHeading) return change.provenance.sourceHeading;
  return e.name;
}

/** "<type>:<normalized Riot name>" -- see the header. Always derived (never stored), so old and new datasets agree. An untracked
 *  entity's key already IS this value (including an ambiguous owner's "unknown:" prefix); System sections use their section key. */
export function sourceKeyOf(change) {
  if (!change) return null;
  if (change.kind === "system") return change.system ? sectionKeyOf(change) : null;
  const e = change.entity;
  if (!e) return null;
  if (!e.academyKey) return e.key;
  return `${e.type}:${normName(sourceNameOf(change))}`;
}

/** What Academy matched a change to: "system", "untracked", or the canonical academy key. Two changes with the same Riot name,
 *  path and wording but a DIFFERENT match result are the same Riot change seen through a changed catalog. */
export function matchResultOf(change) {
  if (!change) return null;
  if (change.kind === "system") return "system";
  return (change.entity && change.entity.academyKey) || "untracked";
}

// ---------------------------------------------------------------------------------------------------------------------------
// CLASSIFICATION -- four separate things, never one field:
//   1. automatic match     change.entity.status (EXISTING / NEW_CANDIDATE / UNMATCHED) or a System change -- the extractor's
//                          result, never rewritten. EXISTING means exactly "matched to a canonical Academy record".
//   2. effective status    IN_ACADEMY / NEW_CANDIDATE / UNMATCHED / SYSTEM -- what the reviewer sees and filters by. A new
//                          vocabulary on purpose: a manual "In Academy" is NOT "EXISTING", so nothing can mistake it for a
//                          canonical record.
//   3. Academy link        { id, type, origin } | null -- the canonical record (if any). "In Academy" without a link is valid
//                          (e.g. Bulwark of the Mountain while the catalog has no record for it).
//   4. publication         the per-change review state (pending / kept / edited / removed / rejected) + section visibility,
//                          handled by functions/_lib/patchNotesReview.js. A manual classification NEVER changes it: pending
//                          changes publish by default only when the AUTOMATIC match is a canonical record (isAutoInAcademy).
// The reviewer's decision for a section lives at dataset.sectionReview[sectionKey].classification:
//   { status: "IN_ACADEMY" | "AUTO", type?, academyId?, origin: "manual" | "rule", ruleKey?, sourceKey, at }
// "AUTO" = "use the automatic result in this patch even if a remembered rule says otherwise".
// Precedence: this patch's manual decision > a remembered rule (snapshotted into the revision with origin "rule") > automatic.
// ---------------------------------------------------------------------------------------------------------------------------

export const ACADEMY_STATUS = Object.freeze({ IN_ACADEMY: "IN_ACADEMY", NEW_CANDIDATE: "NEW_CANDIDATE", UNMATCHED: "UNMATCHED", SYSTEM: "SYSTEM" });
export const ACADEMY_STATUS_LABEL = Object.freeze({ IN_ACADEMY: "In Academy", NEW_CANDIDATE: "New candidate", UNMATCHED: "Unmatched", SYSTEM: "System" });
export const DECISION_ORIGIN = Object.freeze({ AUTO: "auto", MANUAL: "manual", RULE: "rule" });
export const ENTITY_TYPES = Object.freeze(["champion", "item", "rune"]);

/** The automatic classification (from the extraction alone). */
export function autoAcademyStatus(change) {
  if (change.kind === "system") return ACADEMY_STATUS.SYSTEM;
  return change.entity.status === "EXISTING" ? ACADEMY_STATUS.IN_ACADEMY : change.entity.status;
}

/** True only when the EXTRACTOR matched a canonical Academy record -- the one condition under which a still-pending change is
 *  published by default. Manual / remembered classification deliberately does not count (publication stays a separate decision). */
export function isAutoInAcademy(change) {
  return change.kind === "entity" && change.entity.status === "EXISTING";
}

/** The reviewer's (or a remembered rule's) decision stored for a change's section, normalised; null when there is none. */
export function sectionDecisionOf(dataset, change) {
  const d = (((dataset && dataset.sectionReview) || {})[sectionKeyOf(change)] || {}).classification;
  if (!d || (d.status !== ACADEMY_STATUS.IN_ACADEMY && d.status !== "AUTO")) return null;
  return d;
}

/** The owner's display name: the matched entity's name, or a System block's Riot heading. */
export function ownerNameOf(change) {
  return change.kind === "system" ? change.system.area || change.system.category : change.entity.name;
}

/**
 * The effective classification of one change (all changes of a section share it):
 *   { status, origin, auto, type, name, link, decision }
 *   status  effective ACADEMY_STATUS          origin  "auto" | "manual" | "rule"        auto  the automatic ACADEMY_STATUS
 *   type    champion | item | rune | unknown | null (System, unless a decision gave it a type)
 *   link    { id, type, origin: "auto" | "manual" } | null -- independent of status
 */
export function effectiveClassification(change, dataset) {
  const auto = autoAcademyStatus(change);
  const autoType = change.kind === "entity" ? change.entity.type : null;
  const autoLink = change.kind === "entity" && change.entity.id ? { id: change.entity.id, type: change.entity.type, origin: DECISION_ORIGIN.AUTO } : null;
  const name = ownerNameOf(change);
  const d = sectionDecisionOf(dataset, change);
  if (d && d.status === ACADEMY_STATUS.IN_ACADEMY) {
    const type = ENTITY_TYPES.includes(d.type) ? d.type : autoType;
    const link = d.academyId ? { id: d.academyId, type, origin: DECISION_ORIGIN.MANUAL } : autoLink;
    return { status: ACADEMY_STATUS.IN_ACADEMY, origin: d.origin === DECISION_ORIGIN.RULE ? DECISION_ORIGIN.RULE : DECISION_ORIGIN.MANUAL, auto, type, name, link, decision: d };
  }
  return { status: auto, origin: DECISION_ORIGIN.AUTO, auto, type: autoType, name, link: autoLink, decision: d };
}
