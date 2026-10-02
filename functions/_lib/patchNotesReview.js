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

export const REVIEW_STATE = Object.freeze({ PENDING: "pending", KEPT: "kept", EDITED: "edited", REMOVED: "removed", REJECTED: "rejected" });
export const SECTION_STATE = Object.freeze({ VISIBLE: "visible", REMOVED: "removed", REJECTED: "rejected" });
const STATES = new Set(Object.values(REVIEW_STATE));
const SECTION_STATES = new Set(Object.values(SECTION_STATE));
const LIMITS = { title: 300, text: 4000, note: 2000 };

export function sectionKeyOf(change) {
  return change.kind === "system" ? `system:${change.system.category}:${normName(change.system.area)}` : `entity:${change.entity.key}`;
}
export function sectionTitleOf(change) {
  return change.kind === "system" ? change.system.area || change.system.category : change.entity.name;
}

function defaultReview(change) {
  return { state: REVIEW_STATE.PENDING, displayTitle: change.displayDefaults.displayTitle, displayText: change.displayDefaults.displayText, reviewerNote: "", reviewedAt: null, edited: { title: false, text: false }, sourceChangedSinceReview: false };
}

/** Adds default (pending) review state to every change of a freshly extracted dataset. */
export function initReview(dataset) {
  for (const c of dataset.changes) if (!c.review) c.review = defaultReview(c);
  if (!dataset.sectionReview) dataset.sectionReview = {};
  return dataset;
}

const humanTouched = (c) => Boolean(c.review && (c.review.state !== REVIEW_STATE.PENDING || c.review.edited.title || c.review.edited.text || c.review.reviewerNote));

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
  const stats = { preserved: 0, refreshed: 0, sourceChanged: 0, orphaned: 0, newChanges: 0 };
  if (!previous || !Array.isArray(previous.changes)) { stats.newChanges = fresh.changes.length; fresh.mergeStats = stats; return fresh; }
  const prevById = new Map(previous.changes.map((c) => [c.changeId, c]));
  const seen = new Set();
  for (const c of fresh.changes) {
    const p = prevById.get(c.changeId);
    if (!p || !p.review) { stats.newChanges++; continue; }
    seen.add(c.changeId);
    const pr = p.review;
    const edited = { title: Boolean(pr.edited && pr.edited.title), text: Boolean(pr.edited && pr.edited.text) };
    const fpChanged = p.provenance && p.provenance.sourceFingerprint !== c.provenance.sourceFingerprint;
    const touched = humanTouched(p);
    c.review = {
      state: pr.state, reviewerNote: pr.reviewerNote || "", reviewedAt: pr.reviewedAt || null, edited,
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
  fresh.mergeStats = stats;
  return fresh;
}

const cleanStr = (v, max) => (typeof v === "string" ? v.replace(/\u0000/g, "").slice(0, max) : null);

/**
 * Applies human review operations. Pure (mutates and returns the same dataset object).
 *   { op:"edit", changeId, displayTitle?, displayText?, reviewerNote? }
 *   { op:"keep"|"remove"|"reject"|"restore", changeId }
 *   { op:"removeSection"|"rejectSection"|"restoreSection", sectionKey }
 *   { op:"editSectionTitle", sectionKey, displayTitle }
 * Returns { dataset, applied, errors }. Only review fields are ever written; any
 * originalSourceText / normalizedData / provenance key in an op is ignored by construction.
 */
export function applyReviewOps(dataset, ops, { now = new Date().toISOString() } = {}) {
  initReview(dataset);
  const byId = new Map((dataset.changes || []).concat(dataset.orphanedChanges || []).map((c) => [c.changeId, c]));
  const sections = new Set((dataset.changes || []).map(sectionKeyOf));
  const applied = []; const errors = [];
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || typeof op.op !== "string") { errors.push({ op, error: "malformed operation" }); continue; }
    if (op.op.endsWith("Section") || op.op === "editSectionTitle") {
      if (!sections.has(op.sectionKey)) { errors.push({ op, error: "unknown sectionKey" }); continue; }
      const cur = dataset.sectionReview[op.sectionKey] || { state: SECTION_STATE.VISIBLE, displayTitle: null };
      if (op.op === "removeSection") cur.state = SECTION_STATE.REMOVED;
      else if (op.op === "rejectSection") cur.state = SECTION_STATE.REJECTED;
      else if (op.op === "restoreSection") cur.state = SECTION_STATE.VISIBLE;
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
      if (t !== undefined) { r.displayTitle = t; r.edited.title = true; }
      if (x !== undefined) { r.displayText = x; r.edited.text = true; }
      if (n !== undefined) r.reviewerNote = n;
      if (r.state === REVIEW_STATE.PENDING || r.state === REVIEW_STATE.KEPT) r.state = REVIEW_STATE.EDITED;
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

export function isSectionVisible(dataset, change) {
  const s = (dataset.sectionReview || {})[sectionKeyOf(change)];
  return !s || s.state === SECTION_STATE.VISIBLE;
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
  return change.kind === "entity" && change.entity.status === "EXISTING";
}

export function reviewSummary(dataset) {
  const counts = { pending: 0, kept: 0, edited: 0, removed: 0, rejected: 0 };
  const status = { EXISTING: 0, NEW_CANDIDATE: 0, UNMATCHED: 0, SYSTEM: 0 };
  let needsReview = 0; let sourceChanged = 0;
  for (const c of dataset.changes || []) {
    counts[c.review.state]++;
    status[c.kind === "system" ? "SYSTEM" : c.entity.status]++;
    if (c.review.state === REVIEW_STATE.PENDING && !(c.kind === "entity" && c.entity.status === "EXISTING")) needsReview++;
    if (c.review.sourceChangedSinceReview) sourceChanged++;
  }
  return { counts, status, needsReview, sourceChanged, orphaned: (dataset.orphanedChanges || []).length, sectionsRemoved: Object.values(dataset.sectionReview || {}).filter((s) => s.state !== SECTION_STATE.VISIBLE).length };
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
const lite = (c) => ({ changeId: c.changeId, ability: c.normalizedData.ability, slot: c.normalizedData.slot, group: c.normalizedData.group, stat: c.normalizedData.stat, effect: c.normalizedData.effect, changeType: c.normalizedData.changeType, oldValue: c.normalizedData.oldValue, newValue: c.normalizedData.newValue, comparisonState: c.comparisonState, displayText: c.review.displayText, raw: c.originalSourceText });

export function deriveLegacyReport(dataset, { itemRoster = [], mode = "draft" } = {}) {
  const itemById = new Map(itemRoster.map((i) => [i.id, i]));
  const include = (c) => (mode === "publish" ? isChangePublishable(c, dataset) : isChangeInDraft(c, dataset));
  const groups = new Map();
  for (const c of dataset.changes || []) {
    if (!include(c)) continue;
    const key = c.kind === "entity" && c.entity.type !== "unknown" ? `entity:${c.entity.key}` : c.kind === "entity" ? `system:unknown:${normName(c.entity.name)}` : sectionKeyOf(c);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const championEntries = []; const itemEntries = []; const runeEntries = []; const systemChanges = [];
  for (const [key, list] of groups) {
    const first = list[0];
    const sectionOverride = (dataset.sectionReview || {})[sectionKeyOf(first)];
    const display = list.map((c) => c.review.displayText).filter(Boolean);
    const sourceSections = [...new Set(list.map((c) => c.provenance.sourcePath))];
    const common = {
      whatChanged: cap(display.join("; "), 3000), sourceRaw: cap(list.map((c) => c.originalSourceText).join(" | "), 6000),
      sourceSection: sourceSections.join(" ; "), sourceSections, changes: list.map(lite), detectionMethod: "deterministic",
    };
    if (first.kind === "entity" && first.entity.type !== "unknown") {
      const e = first.entity;
      const facts = legacyFacts(list);
      const academyFlag = e.type === "item" && e.id ? compareItemInfoToPatch(itemById.get(e.id), facts) : null;
      const lifecycle = list.find((c) => c.lifecycle);
      const hasFact = list.some((c) => c.normalizedData.kind === "stat" && c.normalizedData.changeType !== "textual_change");
      const comparisonState = classifyComparisonState({ entityType: e.type, hasCleanValuePair: facts.length > 0, ambiguous: false, academyFlag });
      const fields = { ...common, ...legacyValues(list), comparisonState, relevance: classifyEntityRelevance({ hasFact, hasAddedOrRemoved: Boolean(lifecycle) }), confidence: comparisonState === COMPARISON_STATE.CONFIRMED ? "High" : "Low", championsAffected: [] };
      const entry = normalizeChangeEntry(fields, { withChampionsAffected: e.type !== "champion" });
      if (academyFlag) entry.academyDataFlag = academyFlag;
      if (lifecycle) entry.lifecycleAction = lifecycle.lifecycle.action;
      entry.entityStatus = e.status; entry.supportScope = e.supportScope; entry.changeIds = list.map((c) => c.changeId);
      if (sectionOverride && sectionOverride.displayTitle) entry.displayTitle = sectionOverride.displayTitle;
      if (e.type === "champion") championEntries.push({ championId: e.id, championName: e.name, ...entry });
      else if (e.type === "item") itemEntries.push({ itemId: e.id, itemName: e.name, ...entry });
      else runeEntries.push({ runeId: e.id, runeName: e.name, ...entry });
    } else {
      const area = first.kind === "entity" ? first.entity.name : first.system.area || first.system.category;
      const facts = legacyFacts(list);
      const entry = normalizeSystemChangeEntry({ ...common, area: (sectionOverride && sectionOverride.displayTitle) || area, comparisonState: classifyComparisonState({ entityType: "system", hasCleanValuePair: facts.length > 0, ambiguous: false, academyFlag: null }), relevance: classifySystemRelevance(), confidence: facts.length ? "High" : "Low" });
      entry.systemCategory = first.kind === "system" ? first.system.category : "unmatched";
      entry.changeIds = list.map((c) => c.changeId);
      systemChanges.push(entry);
    }
  }
  return {
    championChanges: mergeDuplicateEntities(championEntries, "championId", "championName"),
    itemChanges: mergeDuplicateEntities(itemEntries, "itemId", "itemName"),
    runeChanges: mergeDuplicateEntities(runeEntries, "runeId", "runeName"),
    systemChanges,
  };
}

// ---- coach-field preservation on rescan (moved here from the retired interim report builder, semantics unchanged) ----
// Coach fields ONLY -- never a fact field; facts always come from the run that just re-scanned the patch.
const COACH_FIELDS = [
  "type", "supportImpact", "impactSeverity", "gameplayImplications", "buildImplications",
  "runeImplications", "matchupImplications", "laneImpact", "roamImpact", "teamfightImpact",
  "objectiveVisionImpact", "decisionChange", "coachNotes", "tierListActionNeeded",
  "recommendedTierAction", "reasoning",
];

/** Admin/Coach "edit" of a report that HAS a Patch Notes dataset: the incoming entries may only carry Coach fields.
 *  Each is merged onto the server's CURRENT entry (matched by id) -- fact fields, source text and review state are never
 *  taken from the request, so a stale or hand-built payload can't overwrite what Riot said or what the reviewer decided. */
export function applyCoachFieldEdits(currentArr = [], incomingArr = [], idField) {
  const incoming = new Map((incomingArr || []).filter((e) => e && e[idField]).map((e) => [e[idField], e]));
  return (currentArr || []).map((cur) => {
    const inc = cur[idField] ? incoming.get(cur[idField]) : null;
    if (!inc) return cur;
    const merged = { ...cur };
    for (const f of COACH_FIELDS) if (f in inc) merged[f] = inc[f];
    return merged;
  });
}

function mergeEntryArray(freshArr, existingArr, idField) {
  const existingById = new Map((existingArr || []).filter((e) => e[idField]).map((e) => [e[idField], e]));
  return freshArr.map((fresh) => {
    const old = fresh[idField] ? existingById.get(fresh[idField]) : null;
    if (!old) return fresh; // newly detected this run -- nothing to carry forward
    const merged = { ...fresh };
    for (const field of COACH_FIELDS) if (field in old) merged[field] = old[field];
    return merged;
  });
}

/** A rescan refreshes Riot-derived facts but carries every Coach-written field on each entry (matched by id)
 *  and recommendedTierChanges forward. systemChanges are always taken fresh. */
export function mergeFreshOntoExisting(freshReport, existingReport) {
  return {
    ...freshReport,
    championChanges: mergeEntryArray(freshReport.championChanges, existingReport?.championChanges, "championId"),
    itemChanges: mergeEntryArray(freshReport.itemChanges, existingReport?.itemChanges, "itemId"),
    runeChanges: mergeEntryArray(freshReport.runeChanges, existingReport?.runeChanges, "runeId"),
    recommendedTierChanges: existingReport?.recommendedTierChanges || freshReport.recommendedTierChanges,
  };
}
