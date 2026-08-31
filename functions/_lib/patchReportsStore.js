// Patch Intelligence report storage -- reuses COACH_KV (no new KV
// namespace). Key structure:
//
//   patch-intel:reports              one small JSON index: [{id, patch,
//                                     previousPatch, generatedAt, status,
//                                     latestRevision, publishedRevision},
//                                     ...], newest-activity-first, capped
//                                     at PATCH_REPORTS_INDEX_LIMIT
//                                     entries. What list views read so
//                                     they don't have to fetch every
//                                     individual report body just to
//                                     show a list of titles/dates/
//                                     statuses. `status` here always
//                                     mirrors the LATEST revision's own
//                                     status (so "there's a new pending
//                                     revision to review" is visible at
//                                     a glance even when an older
//                                     revision is still the one that's
//                                     actually published --
//                                     `publishedRevision` is what tells
//                                     you THAT).
//   patch-intel:report:{id}:{rev}    one full report body for one
//                                     specific revision of one patch.
//                                     Kept separate from both the index
//                                     AND from other revisions of the
//                                     same patch, so reviewing/editing/
//                                     publishing/re-analyzing ONE
//                                     revision only ever reads/writes
//                                     that one small key -- same
//                                     "don't create huge unnecessary KV
//                                     blobs" principle the rest of this
//                                     project's KV usage already
//                                     follows, extended to "don't create
//                                     one blob per PATCH either, let
//                                     alone one blob for every revision
//                                     of every patch ever generated."
//   patch-intel:revisions:{id}       tiny per-patch pointer: exactly
//                                     { latestRevision: number,
//                                     publishedRevision: number|null }.
//                                     The ONLY place "which revision is
//                                     currently public" is tracked --
//                                     each revision's own report body
//                                     still carries its own `status`
//                                     (pending_review/published/
//                                     archived/unpublished/rejected/
//                                     ai_error/source_unavailable) as
//                                     the record of what THAT revision
//                                     is, so this pointer and a
//                                     revision's own status can never
//                                     silently disagree about anything
//                                     except which ONE revision is
//                                     currently the public one.
//   patch-intel:last-known-slug      unchanged -- the raw Riot slug
//                                     Patch Intelligence has already
//                                     generated a report for, compared
//                                     against discoverLatestPatchSlug()
//                                     by the NORMAL detection flow only
//                                     (functions/api/admin/patch-check.js).
//                                     Re-analysis never reads or writes
//                                     this key.
//
// `id` throughout is the raw Riot slug (e.g. "7-3a") -- stable, unique
// per patch, and already what riotFallback.js keys its own caches by,
// so no separate id scheme is introduced. `revision` is a 1-based
// integer, unique per patch id, assigned in generation order.
//
// BACKWARD COMPATIBILITY: reports created before revisions existed are
// stored at the OLD unversioned key, `patch-intel:report:{id}` (no
// `:{rev}` suffix, no patch-intel:revisions:{id} pointer at all). That
// key is NEVER written by this file anymore, but every read path below
// transparently falls back to it as "revision 1" when no versioned
// revision-1 key or pointer exists yet -- so nothing needs to be
// migrated, rewritten, or manually touched in KV for old reports to
// keep working exactly as before. The first re-analysis of an old
// report is what naturally moves it onto the new key scheme (revision 2
// gets a real versioned key + a real pointer; the original stays
// exactly where it already was, at the legacy key, still readable as
// revision 1 forever).

import { PATCH_REPORTS_INDEX_LIMIT } from "./config.js";

const INDEX_KEY = "patch-intel:reports";
const LAST_KNOWN_SLUG_KEY = "patch-intel:last-known-slug";

function legacyReportKey(id) {
  return `patch-intel:report:${id}`;
}
function reportKey(id, revision) {
  return `patch-intel:report:${id}:${revision}`;
}
function revisionsMetaKey(id) {
  return `patch-intel:revisions:${id}`;
}

async function kvGetJson(kv, key) {
  if (!kv) return null;
  try {
    const raw = await kv.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
async function kvPutJson(kv, key, value) {
  if (!kv) return false;
  try {
    await kv.put(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function getLastKnownSlug(kv) {
  if (!kv) return null;
  try {
    return await kv.get(LAST_KNOWN_SLUG_KEY);
  } catch {
    return null;
  }
}

export async function setLastKnownSlug(kv, slug) {
  if (!kv) return;
  try {
    await kv.put(LAST_KNOWN_SLUG_KEY, slug);
  } catch {
    // best-effort -- worst case, the next check re-detects the same
    // patch and just re-reads its already-cached content rather than
    // silently missing a real new one.
  }
}

/** The per-patch revision pointer, ALWAYS returned in the current shape
 *  regardless of whether this id has ever been touched by the revision
 *  system. If no patch-intel:revisions:{id} key exists yet, this is a
 *  pure-legacy patch: synthesizes { latestRevision: 1, publishedRevision:
 *  1-or-null } by reading the OLD unversioned key's own `status` field
 *  once (published -> 1, anything else -> null) -- this single function
 *  is what lets every other function in this file treat "brand new
 *  legacy report" and "already on the new revision scheme" identically,
 *  with no caller ever needing its own legacy special-case. Returns
 *  null only when the id doesn't exist at all (neither a pointer nor a
 *  legacy report). */
async function getRevisionsMeta(kv, id) {
  const meta = await kvGetJson(kv, revisionsMetaKey(id));
  if (meta && typeof meta.latestRevision === "number") return meta;

  const legacy = await kvGetJson(kv, legacyReportKey(id));
  if (!legacy) return null;
  return { latestRevision: 1, publishedRevision: legacy.status === "published" ? 1 : null };
}

async function putRevisionsMeta(kv, id, meta) {
  return kvPutJson(kv, revisionsMetaKey(id), meta);
}

/** Reads ONE specific revision's full report body. Revision 1 falls
 *  back to the legacy unversioned key if no versioned revision-1 key
 *  exists (see file header) -- this is the one place that fallback
 *  lives; every other function reads through this instead of touching
 *  either key directly. */
export async function getReportRevision(kv, id, revision) {
  if (!kv || !id || !revision) return null;
  const direct = await kvGetJson(kv, reportKey(id, revision));
  if (direct) return direct;
  if (revision === 1) return kvGetJson(kv, legacyReportKey(id));
  return null;
}

/** The latest revision's full report body, whatever its status --
 *  "give me the current thing to look at for this patch" (used by the
 *  Admin review UI's default view, and by re-analysis to know what
 *  revision NUMBER comes next). */
export async function getLatestReport(kv, id) {
  const meta = await getRevisionsMeta(kv, id);
  if (!meta) return null;
  return getReportRevision(kv, id, meta.latestRevision);
}

/** The CURRENTLY PUBLISHED revision's full report body, or null if
 *  nothing for this id is published right now. THE function anything
 *  public-facing must use -- never getReportRevision/getLatestReport,
 *  both of which can return a pending/rejected/archived/error revision
 *  that must never be shown to a visitor. */
export async function getPublishedReport(kv, id) {
  const meta = await getRevisionsMeta(kv, id);
  if (!meta || !meta.publishedRevision) return null;
  return getReportRevision(kv, id, meta.publishedRevision);
}

/** All revisions for one patch, oldest first, each as its own full
 *  report body -- bounded by however many revisions that one patch
 *  actually has (never more than a handful in practice), never every
 *  revision of every patch. Powers the Admin revision-history view
 *  (src/pages/AdminPage.jsx) and the "restore an older revision" action
 *  (just publishRevision() with an older number -- see below). */
export async function listRevisionsForPatch(kv, id) {
  const meta = await getRevisionsMeta(kv, id);
  if (!meta) return [];
  const revisions = await Promise.all(
    Array.from({ length: meta.latestRevision }, (_, i) => i + 1).map((rev) => getReportRevision(kv, id, rev))
  );
  return revisions.filter(Boolean);
}

async function getIndex(kv) {
  const parsed = await kvGetJson(kv, INDEX_KEY);
  return Array.isArray(parsed) ? parsed : [];
}
async function putIndex(kv, index) {
  await kvPutJson(kv, INDEX_KEY, index.slice(0, PATCH_REPORTS_INDEX_LIMIT));
}

/** Recomputes and upserts this id's index entry from its CURRENT
 *  latest-revision body + revision pointer -- called at the end of
 *  every mutation below instead of each one duplicating index-update
 *  logic. `status` in the index always mirrors the latest revision
 *  (matches every pre-revision report's existing behavior exactly, when
 *  there's only ever been one revision). */
async function refreshIndexEntry(kv, id) {
  const meta = await getRevisionsMeta(kv, id);
  if (!meta) return;
  const latest = await getReportRevision(kv, id, meta.latestRevision);
  if (!latest) return;

  const entry = {
    id,
    patch: latest.patch,
    previousPatch: latest.previousPatch,
    generatedAt: latest.generatedAt,
    status: latest.status,
    latestRevision: meta.latestRevision,
    publishedRevision: meta.publishedRevision,
  };
  const index = await getIndex(kv);
  await putIndex(kv, [entry, ...index.filter((e) => e.id !== id)]);
}

/** Creates the FIRST revision of a brand-new patch -- the normal
 *  new-patch-detection flow's only write (functions/api/admin/
 *  patch-check.js), whether the analysis succeeded (status
 *  "pending_review") or failed (status "ai_error"/"source_unavailable").
 *  Writes the versioned revision-1 key directly (not the legacy key --
 *  that key is only ever read, for pre-existing data, never written
 *  again) plus a fresh pointer, then refreshes the index. */
export async function saveNewReport(kv, report) {
  if (!kv) return false;
  const ok = await kvPutJson(kv, reportKey(report.id, 1), { ...report, revision: 1 });
  if (!ok) return false;
  await putRevisionsMeta(kv, report.id, { latestRevision: 1, publishedRevision: null });
  await refreshIndexEntry(kv, report.id);
  return true;
}

/** Creates the NEXT revision for a patch that may already have 1+
 *  revisions (or may still be pure-legacy, single-implicit-revision) --
 *  the Re-analyze action's only write. `publishedRevision` is carried
 *  forward UNCHANGED (re-analysis never touches what's currently
 *  public -- see functions/api/admin/patch-check.js's reanalyze
 *  handler for the full failure-safety reasoning); the new revision
 *  always starts at whatever status the fresh analysis actually
 *  produced (pending_review, or ai_error/source_unavailable on
 *  failure), never "published". Returns the new revision number, or
 *  null if this id doesn't exist yet (re-analysis of a patch that was
 *  never generated in the first place isn't a valid call -- the caller
 *  is expected to have already loaded the existing report to get here). */
export async function saveReanalysisRevision(kv, id, report) {
  if (!kv) return null;
  const meta = await getRevisionsMeta(kv, id);
  if (!meta) return null;
  const nextRevision = meta.latestRevision + 1;

  const ok = await kvPutJson(kv, reportKey(id, nextRevision), { ...report, id, revision: nextRevision });
  if (!ok) return null;
  await putRevisionsMeta(kv, id, { latestRevision: nextRevision, publishedRevision: meta.publishedRevision });
  await refreshIndexEntry(kv, id);
  return nextRevision;
}

/** Merges partial fields into ONE SPECIFIC revision -- the revision-
 *  aware replacement for the old blanket updateReport(), used by
 *  functions/api/admin/patch-reports.js's "edit" action. Returns the
 *  updated report, or null if that id/revision doesn't exist. */
export async function updateReportRevision(kv, id, revision, patchFields) {
  const existing = await getReportRevision(kv, id, revision);
  if (!existing) return null;
  const updated = { ...existing, ...patchFields };
  const ok = await kvPutJson(kv, reportKey(id, revision), updated);
  if (!ok) return null;
  await refreshIndexEntry(kv, id);
  return updated;
}

/** Publishes ONE SPECIFIC revision: sets the pointer's publishedRevision
 *  to it, sets that revision's own body status to "published", and --
 *  if a DIFFERENT revision was previously published -- demotes that
 *  one's own body status to "archived" (never deleted, never
 *  overwritten with anything else; it stays fully readable via
 *  getReportRevision/listRevisionsForPatch forever, satisfying "keep it
 *  available for rollback"). Also used for "restore a previous
 *  revision" -- that's just this same function called with an older
 *  revision number; there is no separate restore code path. Returns
 *  the newly-published revision's updated body, or null if that
 *  revision doesn't exist. */
export async function publishRevision(kv, id, revision, extraFields = {}) {
  const target = await getReportRevision(kv, id, revision);
  if (!target) return null;

  const meta = await getRevisionsMeta(kv, id);
  const previouslyPublished = meta?.publishedRevision;
  if (previouslyPublished && previouslyPublished !== revision) {
    const prev = await getReportRevision(kv, id, previouslyPublished);
    if (prev) await kvPutJson(kv, reportKey(id, previouslyPublished), { ...prev, status: "archived" });
  }

  const updated = { ...target, ...extraFields, status: "published" };
  const ok = await kvPutJson(kv, reportKey(id, revision), updated);
  if (!ok) return null;
  await putRevisionsMeta(kv, id, { latestRevision: meta.latestRevision, publishedRevision: revision });
  await refreshIndexEntry(kv, id);
  return updated;
}

/** Unpublishes whatever revision is currently public: sets the
 *  pointer's publishedRevision to null and that revision's own body
 *  status to "unpublished" (reversible, not destroyed -- same
 *  reasoning as "archived" above; an unpublished revision can be
 *  re-published later via publishRevision() with no data loss). A
 *  no-op returning null if nothing is currently published for this id. */
export async function unpublishReport(kv, id) {
  const meta = await getRevisionsMeta(kv, id);
  if (!meta || !meta.publishedRevision) return null;

  const published = await getReportRevision(kv, id, meta.publishedRevision);
  if (!published) return null;
  const updated = { ...published, status: "unpublished" };
  const ok = await kvPutJson(kv, reportKey(id, meta.publishedRevision), updated);
  if (!ok) return null;
  await putRevisionsMeta(kv, id, { latestRevision: meta.latestRevision, publishedRevision: null });
  await refreshIndexEntry(kv, id);
  return updated;
}

/** Full index, newest-activity first -- used by the ADMIN review list
 *  (every status, including pending/rejected/archived/unpublished).
 *  Old (pre-revision) index entries are missing latestRevision/
 *  publishedRevision -- normalized here, at READ time, to
 *  {latestRevision: 1, publishedRevision: status==='published' ? 1 :
 *  null} so the Admin UI never needs its own legacy special-case
 *  either; the stored index blob itself is never rewritten just to add
 *  these fields. */
export async function listAllReports(kv) {
  const index = await getIndex(kv);
  return index.map((entry) =>
    typeof entry.latestRevision === "number"
      ? entry
      : { ...entry, latestRevision: 1, publishedRevision: entry.status === "published" ? 1 : null }
  );
}

/** PUBLIC report list for the Patch Intelligence page -- for each
 *  patch id, the CURRENTLY PUBLISHED revision only (via
 *  getPublishedReport above), with internal-only fields (adminNotes,
 *  reviewedBy) stripped. An id with no published revision right now
 *  (never published, or unpublished) is simply absent -- not included
 *  with any other status, ever. */
export async function listPublicReports(kv) {
  const index = await getIndex(kv);
  const reports = await Promise.all(index.map((e) => getPublishedReport(kv, e.id)));
  return reports
    .filter(Boolean)
    .map(({ adminNotes, reviewedBy, ...publicFields }) => publicFields);
}
