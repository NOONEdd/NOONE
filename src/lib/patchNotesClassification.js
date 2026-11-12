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
