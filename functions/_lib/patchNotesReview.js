// Patch Notes -- review layer.
//
// THREE LAYERS per change, never mixed:
//   1. ORIGINAL SOURCE    originalSourceText + provenance   (what Riot said; never edited)
//   2. NORMALIZED         normalizedData, entity, comparisonState, ownership (parser output; refreshed on re-runs)
//   3. HUMAN DISPLAY      review{ state, displayTitle, displayText, reviewerNote, ... }  (what the reviewer wants shown)
// Human operations (applyReviewOps) can only ever touch layer 3. Re-running
// the extractor rebuilds layers 1-2 and mergeReviewState() carries layer 3
// over by stable changeId, so regenerating never destroys a human decision.
//
// WHERE EACH EDITABLE PRESENTATION FIELD LIVES (all layer 3 -- never layer 1/2):
//   change display text / title     change.review.displayText / displayTitle        (+ review.edited.{text,title})
//   change note (shown publicly)    change.review.reviewerNote                      (stored key kept so no stored review is orphaned)
//   change classification override  change.review.comparisonStateOverride           (extraction value stays in change.comparisonState)
//   entity classification override  dataset.sectionReview[sectionKey].comparisonStateOverride
//   entity change impact (LOW/MEDIUM/HIGH)  dataset.sectionReview[sectionKey].changeImpact   (human-only: no extraction value exists; unset = not rated)
//   subsection heading (display)    dataset.subsectionReview[subsectionKey].displayHeading   (Riot's own heading: change.subsection.sourceHeading)
//   subsection scope override       dataset.subsectionReview[subsectionKey].scope            (extraction: change.scope + change.scopeBasis; the override only
//                                                                                              decides whether the section is shown as an ability with an icon)
//   subsection icon override        dataset.subsectionReview[subsectionKey].visualOverride   (SHOW | HIDE; absent = Auto = the scope's default. Display only: independent
//                                                                                              of scope, and never touches scope, Riot's heading or the ID)
//   patch summary text              dataset.summaryReview.text                      (absent => generated from the visible reviewed data)
//   change / section visibility     change.review.state / dataset.sectionReview[sectionKey].state
//
// REVIEW STATES (per change): pending | kept | edited | removed | rejected
//   removed   "don't show this change in the current Patch Notes" (the fact stays known)
//   rejected  "the parser was right, but this is outside the desired Academy/support scope"
//   Both leave publication; they differ for debugging / future parser work.
// SECTIONS (an entity, or one system block) carry their own review:
//   { state: visible | removed | rejected, displayTitle }  -- removing a whole section is
//   presentation state only; every underlying change and its source stay intact.
//
// PUBLICATION: a change is published when its section is visible and it is
// kept/edited, or still pending AND owned by an EXISTING Academy entity.
// NEW_CANDIDATE / UNMATCHED / SYSTEM changes need an explicit "kept"/"edited"
// -- they are never hidden from REVIEW, only from the public page until a
// human decides. Nothing here touches Academy master data.

import { classifyComparisonState, classifyEntityRelevance, classifySystemRelevance, compareItemInfoToPatch, COMPARISON_STATE } from "./patchChangeDetector.js";
import { normalizeChangeEntry, normalizeSystemChangeEntry, mergeDuplicateEntities } from "./patchIntelligence.js";
import { normName } from "./patchNotesIds.js";
import { CLASSIFICATION, normalizeClassification, classificationOrUnknown, classificationLabel, deriveEntityClassification, normalizeChangeImpact, changeImpactLabel, normalizeScope, isAbilityScope, SUBSECTION_SCOPE_OPTIONS, normalizeVisualOverride, effectiveVisual, defaultVisualForScope, VISUAL } from "../../src/lib/patchNotesPresentation.js";
import { classifyChangeScope } from "./patchChangeScope.js";
import { sectionKeyOf, sourceNameOf, sourceKeyOf, matchResultOf, effectiveClassification, autoAcademyStatus, isAutoInAcademy, ruleKeysForSection, ACADEMY_STATUS, DECISION_ORIGIN, ENTITY_TYPES } from "../../src/lib/patchNotesClassification.js";

export const REVIEW_STATE = Object.freeze({ PENDING: "pending", KEPT: "kept", EDITED: "edited", REMOVED: "removed", REJECTED: "rejected" });
export const SECTION_STATE = Object.freeze({ VISIBLE: "visible", REMOVED: "removed", REJECTED: "rejected" });
const STATES = new Set(Object.values(REVIEW_STATE));
const SECTION_STATES = new Set(Object.values(SECTION_STATE));
const LIMITS = { title: 300, text: 4000, note: 2000, summary: 1000 };

// One implementation, shared with the admin UI (src/lib/patchNotesClassification.js).
export { sectionKeyOf };
export function sectionTitleOf(change) {
  return change.kind === "system" ? change.system.area || change.system.category : change.entity.name;
}

function defaultReview(change) {
  return { state: REVIEW_STATE.PENDING, displayTitle: change.displayDefaults.displayTitle, displayText: change.displayDefaults.displayText, reviewerNote: "", comparisonStateOverride: null, reviewedAt: null, edited: { title: false, text: false }, sourceChangedSinceReview: false };
}

/** Adds default (pending) review state to every change of a freshly extracted dataset. */
export function initReview(dataset) {
  for (const c of dataset.changes) if (!c.review) c.review = defaultReview(c);
  if (!dataset.sectionReview) dataset.sectionReview = {};
  if (!dataset.subsectionReview) dataset.subsectionReview = {};
  return dataset;
}

const humanTouched = (c) => Boolean(c.review && (c.review.state !== REVIEW_STATE.PENDING || c.review.edited.title || c.review.edited.text || c.review.reviewerNote || c.review.comparisonStateOverride));

/**
 * Carries human review from `previous` onto a freshly extracted `fresh` dataset by stable changeId.
 *  - review state, reviewer note, edited display title/text: preserved
 *  - unedited display text: refreshed from the new extraction
 *  - source wording changed since review (fingerprint differs): state + edits are KEPT and the change is flagged
 *  - a human-touched change the new run no longer produces is kept as `orphaned` (never silently destroyed)
 *  - section review (removed sections, edited section titles): preserved
 *  - originalSourceText / normalizedData / provenance always come from the NEW extraction
 */
export function mergeReviewState(fresh, previous) {
  initReview(fresh);
  const stats = { preserved: 0, refreshed: 0, sourceChanged: 0, orphaned: 0, newChanges: 0, migrated: 0 };
  if (!previous || !Array.isArray(previous.changes)) { stats.newChanges = fresh.changes.length; stats.sectionsMigrated = 0; fresh.sectionMoves = []; fresh.sectionMigrations = []; fresh.orphanedSectionReviews = []; fresh.mergeStats = stats; return fresh; }
  const prevById = new Map(previous.changes.map((c) => [c.changeId, c]));
  const freshIds = new Set(fresh.changes.map((c) => c.changeId));
  // IDENTITY BRIDGE. A parser improvement can change what feeds a change's ID (e.g. its ability label is now recognised) while the Riot
  // source line is byte-for-byte the same, which would detach every human edit from a change that has not changed. A reviewed change whose
  // ID is gone is therefore carried onto the fresh change that has the SAME scope, the SAME source path and the SAME exact source
  // fingerprint -- but only when that pairing is one-to-one on both sides; any ambiguity falls back to the plain ID rule (orphaned, kept).
  const bridgeKey = (c) => `${c.entity ? c.entity.key : `system:${c.system && c.system.category}`}\u241F${c.provenance.sourcePath}\u241F${c.provenance.sourceFingerprint}`;
  const freshLoose = fresh.changes.filter((c) => !prevById.has(c.changeId));
  const prevLoose = previous.changes.filter((p) => p.review && p.provenance && !freshIds.has(p.changeId) && humanTouched(p));
  const count = (list) => list.reduce((m, c) => m.set(bridgeKey(c), (m.get(bridgeKey(c)) || 0) + 1), new Map());
  const freshCount = count(freshLoose); const prevCount = count(prevLoose);
  const bridge = new Map(); // fresh changeId -> previous change
  for (const c of freshLoose) {
    const k = bridgeKey(c);
    if (freshCount.get(k) === 1 && prevCount.get(k) === 1) bridge.set(c.changeId, prevLoose.find((p) => bridgeKey(p) === k));
  }
  // MATCH-RESULT BRIDGE. The key above contains the entity key, which changes when the MATCH RESULT changes: an untracked
  // "Bulwark of the Mountain" gains a canonical catalog record, a tracked item is retired, a block moves between "system" and "entity".
  // This second pass pairs what is left on Riot's OWN name for the owner (src/lib/patchNotesClassification.js sourceNameOf) + the same
  // source path + the same exact source fingerprint, one-to-one on both sides, and ONLY when the two sides' match results differ
  // (matchResultOf) -- a key change NOT explained by a changed match is never bridged. Untouched previous changes take part in the
  // pairing (so their SECTION can be followed -- section migration below), but only human-touched ones carry review and lineage.
  const identityKey = (c) => `${normName(sourceNameOf(c))}\u241F${c.provenance.sourcePath}\u241F${c.provenance.sourceFingerprint}`;
  const bridgedPrev = new Set([...bridge.values()].map((p) => p.changeId));
  const freshLoose2 = freshLoose.filter((c) => !bridge.has(c.changeId));
  const prevLoose2 = previous.changes.filter((p) => p.provenance && p.kind && !freshIds.has(p.changeId) && !bridgedPrev.has(p.changeId));
  const freshCount2 = count2(freshLoose2, identityKey); const prevCount2 = count2(prevLoose2, identityKey);
  const sectionPair = new Map(bridge); // fresh changeId -> previous change, for following SECTIONS (includes untouched pairs)
  for (const c of freshLoose2) {
    const k = identityKey(c);
    if (freshCount2.get(k) !== 1 || prevCount2.get(k) !== 1) continue;
    const p = prevLoose2.find((x) => identityKey(x) === k);
    if (matchResultOf(p) === matchResultOf(c)) continue;
    sectionPair.set(c.changeId, p);
    if (p.review && humanTouched(p)) bridge.set(c.changeId, p);
  }
  const seen = new Set();
  for (const c of fresh.changes) {
    const p = prevById.get(c.changeId) || bridge.get(c.changeId);
    if (!p || !p.review) { stats.newChanges++; continue; }
    seen.add(p.changeId);
    if (p.changeId !== c.changeId) { c.previousChangeIds = [p.changeId, ...(p.previousChangeIds || [])]; stats.migrated++; }
    const pr = p.review;
    const edited = { title: Boolean(pr.edited && pr.edited.title), text: Boolean(pr.edited && pr.edited.text) };
    const fpChanged = p.provenance && p.provenance.sourceFingerprint !== c.provenance.sourceFingerprint;
    const touched = humanTouched(p);
    c.review = {
      state: pr.state, reviewerNote: pr.reviewerNote || "", comparisonStateOverride: normalizeClassification(pr.comparisonStateOverride), reviewedAt: pr.reviewedAt || null, edited,
      displayTitle: edited.title ? pr.displayTitle : c.displayDefaults.displayTitle,
      displayText: edited.text ? pr.displayText : c.displayDefaults.displayText,
      sourceChangedSinceReview: Boolean(pr.sourceChangedSinceReview || (fpChanged && touched)),
    };
    if (touched) stats.preserved++; else stats.refreshed++;
    if (c.review.sourceChangedSinceReview) stats.sourceChanged++;
  }
  fresh.orphanedChanges = [];
  for (const p of previous.changes) {
    if (seen.has(p.changeId) || !humanTouched(p)) continue;
    fresh.orphanedChanges.push({ ...p, orphaned: true });
    stats.orphaned++;
  }
  fresh.sectionReview = { ...(previous.sectionReview || {}), ...(fresh.sectionReview || {}) };
  // subsection heading edits and the custom patch summary are review-layer state keyed by Riot's own structure, so they ride along too
  fresh.subsectionReview = { ...(previous.subsectionReview || {}), ...(fresh.subsectionReview || {}) };
  if (previous.summaryReview && previous.summaryReview.text) fresh.summaryReview = previous.summaryReview;

  // SECTION MIGRATION. Section-level review (removed/rejected, title, badge, impact, classification) and subsection review are keyed
  // by sectionKey, which changes together with the entity key. A previous section whose key no longer exists, and whose carried changes
  // ALL landed in exactly ONE new section that has no review of its own, is moved there (subsection keys re-prefixed). Anything
  // ambiguous is left exactly where it was and listed in `orphanedSectionReviews` -- never guessed onto a section, never deleted.
  const freshSections = new Set(fresh.changes.map(sectionKeyOf));
  const targets = new Map(); // previous sectionKey -> Set(fresh sectionKey)
  for (const c of fresh.changes) {
    const p = prevById.get(c.changeId) || sectionPair.get(c.changeId);
    if (!p || !p.kind) continue;
    const from = sectionKeyOf(p);
    if (!targets.has(from)) targets.set(from, new Set());
    targets.get(from).add(sectionKeyOf(c));
  }
  const incoming = new Map(); // fresh sectionKey -> previous sectionKeys moving into it
  fresh.sectionMoves = []; // every previous section that no longer exists and whose changes ALL landed in one fresh section
  for (const [from, tos] of targets) {
    if (freshSections.has(from) || tos.size !== 1) continue;
    const to = [...tos][0];
    fresh.sectionMoves.push({ from, to });
    if (!incoming.has(to)) incoming.set(to, []);
    incoming.get(to).push(from);
  }
  fresh.sectionMigrations = [];
  for (const [to, froms] of incoming) {
    if (froms.length !== 1 || fresh.sectionReview[to]) continue; // two old sections claim it, or it already has its own review: ambiguous
    const from = froms[0];
    if (fresh.sectionReview[from]) { fresh.sectionReview[to] = { ...fresh.sectionReview[from], migratedFrom: from }; delete fresh.sectionReview[from]; }
    for (const k of Object.keys(fresh.subsectionReview)) {
      if (!k.startsWith(`${from}|`)) continue;
      const nk = `${to}${k.slice(from.length)}`;
      if (!fresh.subsectionReview[nk]) fresh.subsectionReview[nk] = fresh.subsectionReview[k];
      delete fresh.subsectionReview[k];
    }
    fresh.sectionMigrations.push({ from, to });
  }
  // carried forward untouched (never lost), but surfaced: section review whose section the new extraction no longer produces
  fresh.orphanedSectionReviews = Object.keys(fresh.sectionReview).filter((k) => !freshSections.has(k)).map((sectionKey) => ({ sectionKey, review: fresh.sectionReview[sectionKey] }));
  stats.sectionsMigrated = fresh.sectionMigrations.length;
  fresh.mergeStats = stats;
  return fresh;
}

const count2 = (list, keyOf) => list.reduce((m, c) => m.set(keyOf(c), (m.get(keyOf(c)) || 0) + 1), new Map());

/** Merge fields into dataset.subsectionReview[key]; an `undefined` value removes that field; an entry with no fields left is deleted. */
function setSubsectionReview(dataset, key, patch, now) {
  const next = { ...(dataset.subsectionReview[key] || {}) };
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete next[k]; else next[k] = v; }
  delete next.reviewedAt;
  if (Object.keys(next).length) dataset.subsectionReview[key] = { ...next, reviewedAt: now }; else delete dataset.subsectionReview[key];
}
const CLASSIFY_ERROR = "comparisonState must be one of BUFF, NERF, ADJUSTMENT, NEW, REMOVED, UNKNOWN (or null to clear the override)";
const cleanStr = (v, max) => (typeof v === "string" ? v.replace(/\u0000/g, "").slice(0, max) : null);

/**
 * Applies human review operations. Pure (mutates and returns the same dataset object).
 *   { op:"edit", changeId, displayTitle?, displayText?, reviewerNote? }
 *   { op:"keep"|"remove"|"reject"|"restore", changeId }
 *   { op:"removeSection"|"rejectSection"|"restoreSection", sectionKey }
 *   { op:"editSectionTitle", sectionKey, displayTitle }
 *   { op:"classify", changeId, comparisonState }            BUFF|NERF|ADJUSTMENT|NEW|REMOVED|UNKNOWN, null/"" = back to the extracted value
 *   { op:"classifySection", sectionKey, comparisonState }   the same, for the entity's badge as a whole
 *   { op:"impactSection", sectionKey, changeImpact }         LOW|MEDIUM|HIGH, null/"" = not rated (how substantial the entity's changes are; Academy review metadata)
 *   { op:"editSubsectionTitle", subsectionKey, displayHeading }   "" = back to Riot's own heading
 *   { op:"setSubsectionScope", subsectionKey, scope }       ABILITY|PASSIVE|BASE_STATS|CHAMPION_MECHANIC, null/"" = back to what the extraction found
 *   { op:"setSubsectionVisual", subsectionKey, visual }     SHOW|HIDE, null/""/AUTO = Auto (the scope's default decides whether the section shows its icon)
 *   { op:"setSummary", text } / { op:"clearSummary" }       the public patch summary override (cleared => generated from the visible data)
 *   { op:"setSectionClassification", sectionKey, status, type?, academyId? }
 *        status "IN_ACADEMY" = move the section's entity into Academy (classification only: no change's review state is touched, so
 *        nothing is published by it); "AUTO" = use the automatic result in this patch even if a remembered rule exists; null/"" = no
 *        decision (back to the automatic result / the remembered rule). `type` (champion|item|rune) only for a System block or an
 *        owner with no derivable type -- otherwise the type is Riot's own section's. `academyId` (optional) links a canonical record of
 *        that type and must exist in `catalog`. See src/lib/patchNotesClassification.js.
 * Returns { dataset, applied, errors }. Only review fields are ever written; any
 * originalSourceText / normalizedData / provenance key in an op is ignored by construction.
 * options.catalog: { champion: Set(id), item: Set(id), rune: Set(id) } -- canonical ids an `academyId` may name.
 * options.allowRuleOrigin: only the server (after writing the remembered rule itself) may record origin "rule"; a client-sent
 *   origin / ruleKey is otherwise ignored.
 */
export function applyReviewOps(dataset, ops, { now = new Date().toISOString(), catalog = null, allowRuleOrigin = false } = {}) {
  initReview(dataset);
  const byId = new Map((dataset.changes || []).concat(dataset.orphanedChanges || []).map((c) => [c.changeId, c]));
  const sections = new Set((dataset.changes || []).map(sectionKeyOf));
  const firstOfSection = new Map();
  for (const c of dataset.changes || []) if (!firstOfSection.has(sectionKeyOf(c))) firstOfSection.set(sectionKeyOf(c), c);
  const subsections = new Set((dataset.changes || []).filter((c) => subsectionOf(c)).map(subsectionKeyOf));
  const applied = []; const errors = [];
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || typeof op.op !== "string") { errors.push({ op, error: "malformed operation" }); continue; }
    if (op.op === "editSubsectionTitle") {
      if (!subsections.has(op.subsectionKey)) { errors.push({ op, error: "unknown subsectionKey" }); continue; }
      const h = cleanStr(op.displayHeading, LIMITS.title);
      if (h === null) { errors.push({ op, error: "displayHeading must be a string" }); continue; }
      setSubsectionReview(dataset, op.subsectionKey, { displayHeading: h.trim() || undefined }, now);
      applied.push(op.op);
      continue;
    }
    if (op.op === "setSubsectionVisual") {
      if (!subsections.has(op.subsectionKey)) { errors.push({ op, error: "unknown subsectionKey" }); continue; }
      const auto = op.visual === null || op.visual === "" || (typeof op.visual === "string" && op.visual.trim().toUpperCase() === "AUTO");
      const v = auto ? null : normalizeVisualOverride(op.visual);
      if (!auto && v === null) { errors.push({ op, error: "visual must be SHOW, HIDE or AUTO (null)" }); continue; }
      setSubsectionReview(dataset, op.subsectionKey, { visualOverride: v || undefined }, now);
      applied.push(op.op);
      continue;
    }
    if (op.op === "setSubsectionScope") {
      if (!subsections.has(op.subsectionKey)) { errors.push({ op, error: "unknown subsectionKey" }); continue; }
      const clear = op.scope === null || op.scope === "";
      const v = clear ? null : normalizeScope(op.scope);
      if (!clear && !SUBSECTION_SCOPE_OPTIONS.some(([o]) => o === v)) { errors.push({ op, error: "scope must be one of ABILITY, PASSIVE, BASE_STATS, CHAMPION_MECHANIC (or null to clear)" }); continue; }
      setSubsectionReview(dataset, op.subsectionKey, { scope: v || undefined }, now);
      applied.push(op.op);
      continue;
    }
    if (op.op === "setSummary" || op.op === "clearSummary") {
      const t = op.op === "clearSummary" ? "" : cleanStr(op.text, LIMITS.summary);
      if (t === null) { errors.push({ op, error: "summary text must be a string" }); continue; }
      if (t.trim()) dataset.summaryReview = { text: t.trim(), reviewedAt: now };
      else delete dataset.summaryReview;
      applied.push(op.op);
      continue;
    }
    if (op.op === "setSectionClassification") {
      const first = firstOfSection.get(op.sectionKey);
      if (!first) { errors.push({ op, error: "unknown sectionKey" }); continue; }
      const clear = op.status === null || op.status === undefined || op.status === "";
      const status = clear ? null : String(op.status).trim().toUpperCase();
      if (!clear && status !== ACADEMY_STATUS.IN_ACADEMY && status !== "AUTO") { errors.push({ op, error: "status must be IN_ACADEMY, AUTO or null (no decision)" }); continue; }
      const entry = { ...(dataset.sectionReview[op.sectionKey] || {}) };
      if (clear) {
        delete entry.classification;
      } else {
        const origin = allowRuleOrigin && op.origin === DECISION_ORIGIN.RULE ? DECISION_ORIGIN.RULE : DECISION_ORIGIN.MANUAL;
        const decision = { status, sourceKey: sourceKeyOf(first), origin, at: now };
        if (origin === DECISION_ORIGIN.RULE && typeof op.ruleKey === "string") decision.ruleKey = op.ruleKey;
        if (status === ACADEMY_STATUS.IN_ACADEMY) {
          const ownType = first.kind === "entity" && ENTITY_TYPES.includes(first.entity.type) ? first.entity.type : null;
          const type = op.type === undefined || op.type === null || op.type === "" ? null : String(op.type).trim().toLowerCase();
          if (ownType && type && type !== ownType) { errors.push({ op, error: `type comes from Riot's own section here (${ownType}); it can only be chosen for a System block or an owner with no type` }); continue; }
          if (!ownType && !ENTITY_TYPES.includes(type)) { errors.push({ op, error: "type (champion, item or rune) is required to move a System block or an untyped owner into Academy" }); continue; }
          const effectiveType = ownType || type;
          const academyId = op.academyId === undefined || op.academyId === null || op.academyId === "" ? null : String(op.academyId);
          if (academyId && !(catalog && catalog[effectiveType] && catalog[effectiveType].has(academyId))) { errors.push({ op, error: `academyId "${academyId}" is not a ${effectiveType} in the Academy catalog` }); continue; }
          if (autoAcademyStatus(first) === ACADEMY_STATUS.IN_ACADEMY && !academyId) { errors.push({ op, error: "this entity is already In Academy automatically (matched to its Academy record)" }); continue; }
          if (!ownType) decision.type = effectiveType;
          decision.academyId = academyId;
        }
        entry.classification = decision;
      }
      withCompatSectionState(entry);
      const { reviewedAt, ...rest } = entry;
      if (Object.keys(rest).length) dataset.sectionReview[op.sectionKey] = { ...rest, reviewedAt: now }; else delete dataset.sectionReview[op.sectionKey];
      applied.push(op.op);
      continue;
    }
    if (op.op.endsWith("Section") || op.op === "editSectionTitle") {
      if (!sections.has(op.sectionKey)) { errors.push({ op, error: "unknown sectionKey" }); continue; }
      const cur = dataset.sectionReview[op.sectionKey] || { state: SECTION_STATE.VISIBLE, displayTitle: null };
      if (op.op === "removeSection") cur.state = SECTION_STATE.REMOVED;
      else if (op.op === "rejectSection") cur.state = SECTION_STATE.REJECTED;
      else if (op.op === "restoreSection") cur.state = SECTION_STATE.VISIBLE;
      else if (op.op === "classifySection") {
        const v = op.comparisonState === null || op.comparisonState === "" ? null : normalizeClassification(op.comparisonState);
        if (op.comparisonState !== null && op.comparisonState !== "" && v === null) { errors.push({ op, error: CLASSIFY_ERROR }); continue; }
        cur.comparisonStateOverride = v;
      }
      else if (op.op === "impactSection") {
        const v = op.changeImpact === null || op.changeImpact === "" ? null : normalizeChangeImpact(op.changeImpact);
        if (op.changeImpact !== null && op.changeImpact !== "" && v === null) { errors.push({ op, error: "changeImpact must be LOW, MEDIUM or HIGH (or null to clear)" }); continue; }
        cur.changeImpact = v;
      }
      else if (op.op === "editSectionTitle") { const t = cleanStr(op.displayTitle, LIMITS.title); if (t === null) { errors.push({ op, error: "displayTitle must be a string" }); continue; } cur.displayTitle = t || null; }
      else { errors.push({ op, error: "unknown operation" }); continue; }
      cur.reviewedAt = now;
      dataset.sectionReview[op.sectionKey] = cur;
      applied.push(op.op);
      continue;
    }
    const c = byId.get(op.changeId);
    if (!c) { errors.push({ op, error: "unknown changeId" }); continue; }
    const r = c.review;
    if (op.op === "edit") {
      const t = op.displayTitle !== undefined ? cleanStr(op.displayTitle, LIMITS.title) : undefined;
      const x = op.displayText !== undefined ? cleanStr(op.displayText, LIMITS.text) : undefined;
      const n = op.reviewerNote !== undefined ? cleanStr(op.reviewerNote, LIMITS.note) : undefined;
      if (t === null || x === null || n === null) { errors.push({ op, error: "edit fields must be strings" }); continue; }
      // Only a REAL display change pins the text against re-extraction and counts as "edited": the admin form always sends title+text+note
      // together, so a note-only save must neither freeze the display text nor (for a pending NEW_CANDIDATE / UNMATCHED change)
      // quietly turn into publication. Sending the extracted wording back means "follow the extraction" again.
      let displayChanged = false;
      if (t !== undefined) { displayChanged = displayChanged || t !== r.displayTitle; r.displayTitle = t; r.edited.title = t !== c.displayDefaults.displayTitle; }
      if (x !== undefined) { displayChanged = displayChanged || x !== r.displayText; r.displayText = x; r.edited.text = x !== c.displayDefaults.displayText; }
      if (n !== undefined) r.reviewerNote = n;
      if (displayChanged && (r.state === REVIEW_STATE.PENDING || r.state === REVIEW_STATE.KEPT)) r.state = REVIEW_STATE.EDITED;
      else if (r.state === REVIEW_STATE.EDITED && !r.edited.title && !r.edited.text) r.state = REVIEW_STATE.KEPT;
    } else if (op.op === "classify") {
      const v = op.comparisonState === null || op.comparisonState === "" ? null : normalizeClassification(op.comparisonState);
      if (op.comparisonState !== null && op.comparisonState !== "" && v === null) { errors.push({ op, error: CLASSIFY_ERROR }); continue; }
      r.comparisonStateOverride = v; // review layer only: c.comparisonState (the extraction value) is never written
    } else if (op.op === "keep") r.state = r.edited.title || r.edited.text ? REVIEW_STATE.EDITED : REVIEW_STATE.KEPT;
    else if (op.op === "remove") r.state = REVIEW_STATE.REMOVED;
    else if (op.op === "reject") r.state = REVIEW_STATE.REJECTED;
    else if (op.op === "restore") r.state = r.edited.title || r.edited.text ? REVIEW_STATE.EDITED : REVIEW_STATE.PENDING;
    else if (op.op === "resetDisplay") { r.displayTitle = c.displayDefaults.displayTitle; r.displayText = c.displayDefaults.displayText; r.edited = { title: false, text: false }; if (r.state === REVIEW_STATE.EDITED) r.state = REVIEW_STATE.KEPT; }
    else { errors.push({ op, error: "unknown operation" }); continue; }
    r.reviewedAt = now;
    r.sourceChangedSinceReview = false; // the reviewer has now looked at the current wording
    applied.push(op.op);
  }
  return { dataset, applied, errors };
}

// A section review entry may carry only non-visibility fields (e.g. a classification decision, an impact rating): no `state`
// means the section was never removed/rejected, i.e. visible.
const sectionStateOf = (entry) => (entry && entry.state) || SECTION_STATE.VISIBLE;
/**
 * ROLLBACK COMPATIBILITY for the two writers of classification decisions (setSectionClassification and applyClassificationRules).
 * Builds from before classification existed (main @ 025c15e) read a section entry WITHOUT `state` as hidden
 * (`!s || s.state === "visible"`), whereas this build reads a missing state as visible (sectionStateOf). So an entry that carries a
 * classification decision is always stored with an explicit `state`: the one it already has (removed / rejected are never touched)
 * or "visible" -- which is exactly what a missing state already means here, so this build's behaviour does not change.
 * When the decision is removed and a bare `state: "visible"` is all that is left (besides reviewedAt), that state is dropped again,
 * so clearing a decision leaves the entry in the shape it had before (no entry and `state: "visible"` mean the same in every build).
 * Mutates and returns `entry`.
 */
function withCompatSectionState(entry) {
  if (entry.classification) {
    if (!entry.state) entry.state = SECTION_STATE.VISIBLE;
  } else if (entry.state === SECTION_STATE.VISIBLE && Object.keys(entry).every((k) => k === "state" || k === "reviewedAt")) {
    delete entry.state;
  }
  return entry;
}
/**
 * Snapshots the remembered classification rules into this dataset's review layer (functions/_lib/patchClassificationRules.js).
 *   - a section with its OWN decision in this patch (origin "manual", including an explicit "AUTO") is never touched;
 *   - a section an active rule matches (exactly one rule) and that is not already In Academy automatically gets
 *     { status: IN_ACADEMY, origin: "rule", ruleKey, academyId? } -- a link whose record no longer exists is dropped (linkDropped);
 *   - a rule-origin decision whose rule is gone (forgotten) or no longer needed (now matched automatically) is removed.
 * `available: false` (the rules could not be read with certainty) changes NOTHING and flags the dataset, so an unreadable registry
 * can never silently erase earlier rule decisions. Idempotent: re-applying the same rules leaves the dataset unchanged.
 */
export function applyClassificationRules(dataset, { rules = null, available = true, catalog = null, now = new Date().toISOString() } = {}) {
  initReview(dataset);
  if (!available || !Array.isArray(rules)) { dataset.classificationRules = { status: "unavailable", checkedAt: now }; return dataset; }
  const byKey = new Map(rules.map((r) => [r.key, r]));
  const firsts = new Map();
  for (const c of dataset.changes || []) if (!firsts.has(sectionKeyOf(c))) firsts.set(sectionKeyOf(c), c);
  let applied = 0; let removed = 0;
  for (const [key, first] of firsts) {
    const entry = { ...(dataset.sectionReview[key] || {}) };
    const d = entry.classification;
    if (d && d.origin !== DECISION_ORIGIN.RULE) continue; // this patch's own decision always wins
    const hits = ruleKeysForSection(first).map((k) => byKey.get(k)).filter(Boolean);
    const rule = hits.length === 1 && autoAcademyStatus(first) !== ACADEMY_STATUS.IN_ACADEMY ? hits[0] : null;
    if (rule) {
      const ownType = first.kind === "entity" && ENTITY_TYPES.includes(first.entity.type) ? first.entity.type : null;
      const linkOk = Boolean(rule.academyId && catalog && catalog[rule.type] && catalog[rule.type].has(rule.academyId));
      const next = { status: ACADEMY_STATUS.IN_ACADEMY, sourceKey: sourceKeyOf(first), origin: DECISION_ORIGIN.RULE, ruleKey: rule.key, academyId: linkOk ? rule.academyId : null, at: d && d.ruleKey === rule.key ? d.at : now };
      if (!ownType) next.type = rule.type;
      if (rule.academyId && !linkOk) next.linkDropped = rule.academyId;
      entry.classification = next;
      applied++;
    } else if (d) {
      delete entry.classification;
      removed++;
    } else continue;
    withCompatSectionState(entry);
    if (Object.keys(entry).length) dataset.sectionReview[key] = entry; else delete dataset.sectionReview[key];
  }
  dataset.classificationRules = { status: "applied", activeRules: rules.length, appliedSections: applied, removedSections: removed, checkedAt: now };
  return dataset;
}

export function isSectionVisible(dataset, change) {
  return sectionStateOf((dataset.sectionReview || {})[sectionKeyOf(change)]) === SECTION_STATE.VISIBLE;
}
/** Not removed/rejected (change or section) -- what the admin draft report shows. */
export function isChangeInDraft(change, dataset) {
  const st = change.review ? change.review.state : REVIEW_STATE.PENDING;
  return st !== REVIEW_STATE.REMOVED && st !== REVIEW_STATE.REJECTED && isSectionVisible(dataset, change);
}
/** What the PUBLIC Patch Notes may show (see the header comment). */
export function isChangePublishable(change, dataset) {
  if (!isChangeInDraft(change, dataset)) return false;
  const st = change.review ? change.review.state : REVIEW_STATE.PENDING;
  if (st === REVIEW_STATE.KEPT || st === REVIEW_STATE.EDITED) return true;
  // pending changes publish by default ONLY when the automatic match is a canonical Academy record; a manual / remembered
  // "In Academy" classification never publishes anything on its own (src/lib/patchNotesClassification.js)
  return isAutoInAcademy(change);
}

export function reviewSummary(dataset) {
  const counts = { pending: 0, kept: 0, edited: 0, removed: 0, rejected: 0 };
  const status = { EXISTING: 0, NEW_CANDIDATE: 0, UNMATCHED: 0, SYSTEM: 0 }; // the AUTOMATIC match (unchanged shape, read by older code)
  const academy = { IN_ACADEMY: 0, NEW_CANDIDATE: 0, UNMATCHED: 0, SYSTEM: 0, byDecision: 0 }; // the EFFECTIVE classification
  let needsReview = 0; let sourceChanged = 0;
  for (const c of dataset.changes || []) {
    counts[c.review.state]++;
    status[c.kind === "system" ? "SYSTEM" : c.entity.status]++;
    const eff = effectiveClassification(c, dataset);
    academy[eff.status]++;
    if (eff.origin !== DECISION_ORIGIN.AUTO) academy.byDecision++;
    if (c.review.state === REVIEW_STATE.PENDING && !isAutoInAcademy(c)) needsReview++; // still needs a publication decision
    if (c.review.sourceChangedSinceReview) sourceChanged++;
  }
  return { counts, status, academy, needsReview, sourceChanged, orphaned: (dataset.orphanedChanges || []).length, sectionsRemoved: Object.values(dataset.sectionReview || {}).filter((s) => sectionStateOf(s) !== SECTION_STATE.VISIBLE).length };
}

// ---------------------------------------------------------------------
// Legacy report view (championChanges / itemChanges / runeChanges /
// systemChanges) DERIVED from the reviewed dataset, so everything that
// already consumes that shape (public page, patch-reports store, Coach
// read paths) keeps working. `mode`: "draft" (admin) or "publish" (public).
// ---------------------------------------------------------------------
const cap = (s, n) => (s.length > n ? `${s.slice(0, n)}\u2026` : s);
const isStatChange = (n) => n.kind === "stat";

function legacyFacts(changes) {
  return changes.filter((c) => isStatChange(c.normalizedData) && !["added", "removed", "new_value"].includes(c.normalizedData.changeType) && c.normalizedData.oldValue && c.normalizedData.newValue)
    .map((c) => ({ label: c.normalizedData.stat, oldValue: c.normalizedData.oldValue, newValue: c.normalizedData.newValue, raw: c.originalSourceText }));
}
function legacyValues(changes) {
  const prev = []; const next = [];
  for (const c of changes) {
    const n = c.normalizedData; if (n.kind !== "stat") continue;
    const tag = (v) => (n.stat ? `${n.stat}: ${v}` : v);
    if (n.changeType === "added" || n.changeType === "new_value") next.push(tag(n.newValue));
    else if (n.changeType === "removed") prev.push(tag(n.oldValue));
    else { prev.push(tag(n.oldValue)); next.push(tag(n.newValue)); }
  }
  return { previousValue: prev.join("; "), newValue: next.join("; ") };
}
// ---- subsection / classification helpers (read-side, pure) ----
/** Riot's own subsection heading for a change: the label line above it, or (heading-style documents) its own heading under a
 *  tracked entity heading. Datasets stored before `change.subsection` existed fall back to the label they already extracted.
 *  null = Riot gave no subsection structure; the change then sits directly under its entity (never a fabricated name). */
export function subsectionOf(change) {
  if (change.subsection && change.subsection.sourceHeading) return change.subsection;
  const n = change.normalizedData || {};
  return n.ability ? { sourceHeading: n.ability, origin: "label" } : null;
}
export function subsectionKeyOf(change) {
  const s = subsectionOf(change);
  return s ? `${sectionKeyOf(change)}|sub:${normName(s.sourceHeading)}` : null;
}
/** The classification shown for one change: the reviewer's override if set, else what the extraction found (kept untouched). */
export function effectiveComparison(change) {
  const extracted = classificationOrUnknown(change.comparisonState);
  const override = change.review ? normalizeClassification(change.review.comparisonStateOverride) : null;
  return { value: override || extracted, extracted, overridden: Boolean(override) };
}
/** The scope of one change: what the extraction recorded; for datasets stored before `scope` existed, the same classifier over the fields they
 *  already hold (so nothing needs re-extracting or migrating to be read correctly). */
export function scopeOf(change) {
  if (change.scope) return { scope: normalizeScope(change.scope) || change.scope, basis: change.scopeBasis || null };
  const sub = subsectionOf(change);
  return classifyChangeScope({ kind: change.kind, entityType: change.entity ? change.entity.type : null, lifecycle: change.lifecycle, subsectionHeading: sub ? sub.sourceHeading : null });
}

/** The text shown for one change under its own subsection heading: an edited text as written; otherwise the extracted line WITHOUT
 *  the ability prefix (the heading already says it). Older datasets without displayBody fall back to the full display text. */
function changeBody(c) {
  if (c.review.edited && c.review.edited.text) return c.review.displayText;
  return (c.displayDefaults && c.displayDefaults.displayBody) || c.review.displayText;
}
const liteFor = (dataset) => (c) => {
  const sub = subsectionOf(c); const eff = effectiveComparison(c);
  return {
    changeId: c.changeId, ability: c.normalizedData.ability, slot: c.normalizedData.slot, group: c.normalizedData.group, stat: c.normalizedData.stat, effect: c.normalizedData.effect, changeType: c.normalizedData.changeType, oldValue: c.normalizedData.oldValue, newValue: c.normalizedData.newValue,
    comparisonState: c.comparisonState, displayText: c.review.displayText, raw: c.originalSourceText,
    text: changeBody(c), note: c.review.reviewerNote || "",
    classification: eff.value, classificationExtracted: eff.extracted, classificationOverridden: eff.overridden,
    subsectionKey: sub ? subsectionKeyOf(c) : null, subsectionHeading: sub ? sub.sourceHeading : null, subsectionOrigin: sub ? sub.origin : null,
    scope: scopeOf(c).scope, scopeBasis: scopeOf(c).basis,
  };
};

/** Groups an entry's changes by their Riot subsection (document order; first appearance fixes the order). Changes with no Riot
 *  subsection form one untitled group where they first appear. Adds the entry's classification badge and `type`. */
function decorateEntry(entry, dataset) {
  const lites = entry.changes || [];
  const map = new Map(); const order = [];
  for (const l of lites) {
    const k = l.subsectionKey || "";
    if (!map.has(k)) {
      const rv = (l.subsectionKey && (dataset.subsectionReview || {})[l.subsectionKey]) || {};
      const override = normalizeScope(rv.scope);
      const scope = override || l.scope;
      // abilityName (the parser's slot-free label) is only meaningful for an ability-like section; for stats / mechanics it is withheld so nothing
      // downstream can mistake "Base Stats" for an ability name
      const visualOverride = normalizeVisualOverride(rv.visualOverride);
      map.set(k, { key: l.subsectionKey, sourceHeading: l.subsectionHeading, origin: l.subsectionOrigin, title: l.subsectionKey ? rv.displayHeading || l.subsectionHeading : null, scope, scopeExtracted: l.scope, scopeBasis: l.scopeBasis, scopeOverridden: Boolean(override), visual: effectiveVisual(scope, visualOverride), visualOverride, abilityName: isAbilityScope(scope) ? (l.ability || null) : null, changes: [] });
      order.push(k);
    }
    map.get(k).changes.push(l);
  }
  entry.subsections = order.map((k) => map.get(k));
  const sectionOverride = ((dataset.sectionReview || {})[entry.sectionKey] || {}).comparisonStateOverride;
  const forced = normalizeClassification(sectionOverride);
  entry.classification = forced || deriveEntityClassification(lites.map((l) => l.classification));
  entry.classificationExtracted = deriveEntityClassification(lites.map((l) => l.classificationExtracted));
  entry.classificationOverridden = Boolean(forced) || lites.some((l) => l.classificationOverridden);
  // legacy `type` (Buff/Nerf/Adjustment, formerly a constant default) now mirrors the real classification for any old reader
  entry.type = classificationLabel(entry.classification);
  // Change impact: the reviewer's call only. The legacy normalizer's placeholder default ("Medium" on EVERY entity -- the badge people saw)
  // is never inherited: with no review the entity is simply not rated. `impactSeverity` mirrors it in the legacy Low/Medium/High wording
  // for old readers (notify.js). Extraction confidence (`confidence`) is a different, internal field and is not touched here.
  entry.changeImpact = normalizeChangeImpact(((dataset.sectionReview || {})[entry.sectionKey] || {}).changeImpact);
  entry.impactSeverity = changeImpactLabel(entry.changeImpact);
}

export function deriveLegacyReport(dataset, { itemRoster = [], mode = "draft" } = {}) {
  const lite = liteFor(dataset);
  const itemById = new Map(itemRoster.map((i) => [i.id, i]));
  const include = (c) => (mode === "publish" ? isChangePublishable(c, dataset) : isChangeInDraft(c, dataset));
  // one group per review SECTION (= one entity, or one System block), in document order
  const groups = new Map();
  for (const c of dataset.changes || []) {
    if (!include(c)) continue;
    const key = sectionKeyOf(c);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const championEntries = []; const itemEntries = []; const runeEntries = []; const systemChanges = [];
  for (const [, list] of groups) {
    const first = list[0];
    const sectionOverride = (dataset.sectionReview || {})[sectionKeyOf(first)];
    const display = list.map((c) => c.review.displayText).filter(Boolean);
    const sourceSections = [...new Set(list.map((c) => c.provenance.sourcePath))];
    const common = {
      whatChanged: cap(display.join("; "), 3000), sourceRaw: cap(list.map((c) => c.originalSourceText).join(" | "), 6000),
      sourceSection: sourceSections.join(" ; "), sourceSections, changes: list.map(lite), detectionMethod: "deterministic",
    };
    // placement by the EFFECTIVE classification's type (a System block a reviewer classified as an item is listed with items);
    // the canonical id comes ONLY from the Academy link -- never assumed from the status
    const eff = effectiveClassification(first, dataset);
    if (ENTITY_TYPES.includes(eff.type)) {
      const id = eff.link ? eff.link.id : null;
      const facts = legacyFacts(list);
      const academyFlag = eff.type === "item" && id ? compareItemInfoToPatch(itemById.get(id), facts) : null;
      const lifecycle = list.find((c) => c.lifecycle);
      const hasFact = list.some((c) => c.normalizedData.kind === "stat" && c.normalizedData.changeType !== "textual_change");
      const comparisonState = classifyComparisonState({ entityType: eff.type, hasCleanValuePair: facts.length > 0, ambiguous: false, academyFlag });
      const fields = { ...common, ...legacyValues(list), comparisonState, relevance: classifyEntityRelevance({ hasFact, hasAddedOrRemoved: Boolean(lifecycle) }), confidence: comparisonState === COMPARISON_STATE.CONFIRMED ? "High" : "Low", championsAffected: [] };
      const entry = normalizeChangeEntry(fields, { withChampionsAffected: eff.type !== "champion" });
      if (academyFlag) entry.academyDataFlag = academyFlag;
      if (lifecycle) entry.lifecycleAction = lifecycle.lifecycle.action;
      // entityStatus / supportScope keep their old meaning: the AUTOMATIC match (read by older code)
      entry.entityStatus = first.kind === "entity" ? first.entity.status : null; entry.supportScope = first.kind === "entity" ? first.entity.supportScope : "UNKNOWN";
      entry.changeIds = list.map((c) => c.changeId); entry.sectionKey = sectionKeyOf(first); entry.sectionKeys = [entry.sectionKey];
      // the effective classification, its origin and the Academy link -- review metadata, never part of the public view
      entry.academyStatus = eff.status; entry.academyStatusOrigin = eff.origin; entry.academyStatusAuto = eff.auto; entry.academyLink = eff.link ? { id: eff.link.id, origin: eff.link.origin } : null;
      if (sectionOverride && sectionOverride.displayTitle) entry.displayTitle = sectionOverride.displayTitle;
      if (eff.type === "champion") championEntries.push({ championId: id, championName: eff.name, ...entry });
      else if (eff.type === "item") itemEntries.push({ itemId: id, itemName: eff.name, ...entry });
      else runeEntries.push({ runeId: id, runeName: eff.name, ...entry });
    } else {
      const area = first.kind === "entity" ? first.entity.name : first.system.area || first.system.category;
      const facts = legacyFacts(list);
      const entry = normalizeSystemChangeEntry({ ...common, area: (sectionOverride && sectionOverride.displayTitle) || area, comparisonState: classifyComparisonState({ entityType: "system", hasCleanValuePair: facts.length > 0, ambiguous: false, academyFlag: null }), relevance: classifySystemRelevance(), confidence: facts.length ? "High" : "Low" });
      entry.systemCategory = first.kind === "system" ? first.system.category : "unmatched";
      entry.changeIds = list.map((c) => c.changeId); entry.sectionKey = sectionKeyOf(first); entry.sectionKeys = [entry.sectionKey];
      entry.academyStatus = eff.status; entry.academyStatusOrigin = eff.origin; entry.academyStatusAuto = eff.auto; entry.academyLink = null;
      systemChanges.push(entry);
    }
  }
  const out = {
    championChanges: mergeDuplicateEntities(championEntries, "championId", "championName"),
    itemChanges: mergeDuplicateEntities(itemEntries, "itemId", "itemName"),
    runeChanges: mergeDuplicateEntities(runeEntries, "runeId", "runeName"),
    systemChanges,
  };
  for (const list of Object.values(out)) for (const e of list) decorateEntry(e, dataset); // after the merge, so merged entries group ALL their changes
  return out;
}

// ---- coach-field preservation on rescan (moved here from the retired interim report builder, semantics unchanged) ----
// Coach fields ONLY -- never a fact field; facts always come from the run that just re-scanned the patch.
const COACH_FIELDS = [
  "type", "supportImpact", "impactSeverity", "gameplayImplications", "buildImplications",
  "runeImplications", "matchupImplications", "laneImpact", "roamImpact", "teamfightImpact",
  "objectiveVisionImpact", "decisionChange", "coachNotes", "tierListActionNeeded",
  "recommendedTierAction", "reasoning",
];

// `type` and `impactSeverity` are Coach fields only on LEGACY entries. On an entry derived from a Patch Notes dataset they mirror the derived
// classification / the reviewer's change impact (override-aware), so a rescan / review re-derive must never carry an older stored value
// (the old constant "Adjustment" / "Medium") back over them.
const coachFieldsFor = (entry) => (entry && entry.classification ? COACH_FIELDS.filter((f) => f !== "type" && f !== "impactSeverity") : COACH_FIELDS);

// ---- which stored entry a derived entry IS, for carrying Coach fields ----
// Coach fields (Support impact, notes, ...) belong to the ENTITY an entry stands for, not to its Academy id: an entity with no
// canonical record (unmatched, a new candidate, a manually promoted one) has no id at all, a classification change can move an
// entry to another list (a System block promoted to an item), and a catalog change moves its section key (Stage 1 migration).
// So entries are matched on the review SECTIONS they stand for (entry.sectionKeys; one entry can stand for several after a merge),
// following recorded section migrations, across the champion / item / rune lists; the Academy id is only the fallback for
// entries stored before entries carried section keys.
const ENTRY_LISTS = [["championChanges", "championId"], ["itemChanges", "itemId"], ["runeChanges", "runeId"]];
const sectionKeysOfEntry = (e) => (Array.isArray(e && e.sectionKeys) && e.sectionKeys.length ? e.sectionKeys : e && e.sectionKey ? [e.sectionKey] : []);

/** Index of stored entries: by section key across all lists -- following `moves` (patchNotesReview mergeReviewState's
 *  sectionMoves: old section -> the one new section all its changes landed in) -- and by id within a list (legacy fallback).
 *  If two DIFFERENT stored entries end up claiming the same section key, that key is ambiguous and carries nothing: Coach text is
 *  never guessed onto an entity (it stays readable on the previous revision). */
function indexEntries(report, moves = []) {
  const moved = new Map((moves || []).map((m) => [m.from, m.to]));
  const AMBIGUOUS = Symbol("ambiguous");
  const bySection = new Map(); const byId = new Map();
  for (const [field, idField] of ENTRY_LISTS) {
    for (const e of (report && report[field]) || []) {
      for (const k of sectionKeysOfEntry(e)) {
        const key = moved.get(k) || k;
        if (!bySection.has(key)) bySection.set(key, e);
        else if (bySection.get(key) !== e) bySection.set(key, AMBIGUOUS);
      }
      if (e && e[idField]) byId.set(`${field}\u241F${e[idField]}`, e);
    }
  }
  return { find(entry, field, idField) {
    const keys = sectionKeysOfEntry(entry);
    for (const k of keys) { const hit = bySection.get(k); if (hit && hit !== AMBIGUOUS) return hit; }
    if (keys.some((k) => bySection.get(k) === AMBIGUOUS)) return null;
    return entry[idField] ? byId.get(`${field}\u241F${entry[idField]}`) || null : null;
  } };
}

/** Admin/Coach "edit" of a report that HAS a Patch Notes dataset: the incoming entries may only carry Coach fields.
 *  Each is merged onto the server's CURRENT entry (matched by the review section(s) it stands for, else by id) -- fact fields,
 *  source text and review state are never taken from the request, so a stale or hand-built payload can't overwrite what Riot
 *  said or what the reviewer decided. */
export function applyCoachFieldEdits(currentArr = [], incomingArr = [], idField) {
  const field = (ENTRY_LISTS.find(([, f]) => f === idField) || [])[0];
  const index = indexEntries({ [field]: (incomingArr || []).filter((e) => e && typeof e === "object") });
  return (currentArr || []).map((cur) => {
    const inc = index.find(cur, field, idField);
    if (!inc) return cur;
    const merged = { ...cur };
    for (const f of coachFieldsFor(cur)) if (f in inc) merged[f] = inc[f];
    return merged;
  });
}

function carryCoachFields(freshArr, field, idField, index) {
  return (freshArr || []).map((fresh) => {
    const old = index.find(fresh, field, idField);
    if (!old) return fresh; // newly detected this run -- nothing to carry forward
    const merged = { ...fresh };
    for (const f of coachFieldsFor(fresh)) if (f in old) merged[f] = old[f];
    return merged;
  });
}

/** A rescan / review re-derive refreshes Riot-derived facts but carries every Coach-written field on each entry (matched as
 *  described above, following `freshReport.patchNotes.sectionMoves` when the fresh report has them) and
 *  recommendedTierChanges forward. systemChanges are always taken fresh (their Coach fields cannot be edited on a dataset report). */
export function mergeFreshOntoExisting(freshReport, existingReport) {
  const index = indexEntries(existingReport, freshReport && freshReport.patchNotes && freshReport.patchNotes.sectionMoves);
  return {
    ...freshReport,
    championChanges: carryCoachFields(freshReport.championChanges, "championChanges", "championId", index),
    itemChanges: carryCoachFields(freshReport.itemChanges, "itemChanges", "itemId", index),
    runeChanges: carryCoachFields(freshReport.runeChanges, "runeChanges", "runeId", index),
    recommendedTierChanges: existingReport?.recommendedTierChanges || freshReport.recommendedTierChanges,
  };
}
