// Patch Intelligence report storage -- reuses COACH_KV (no new KV
// namespace). Two kinds of keys:
//
//   patch-intel:reports          one small JSON index: [{id, patch,
//                                 previousPatch, generatedAt, status}, ...],
//                                 newest first, capped at
//                                 PATCH_REPORTS_INDEX_LIMIT entries. This
//                                 is what list views read so they don't
//                                 have to fetch every individual report
//                                 just to show a list of titles/dates.
//   patch-intel:report:{id}      one full report body per patch. Kept
//                                 separate from the index so approving/
//                                 editing/publishing ONE report only
//                                 ever rewrites that one small key, not
//                                 a single ever-growing blob of every
//                                 report ever generated -- the same
//                                 "don't create huge unnecessary KV
//                                 blobs" principle the rest of this
//                                 project's KV usage already follows.
//   patch-intel:last-known-slug  the raw Riot slug Patch Intelligence
//                                 has already generated a report for --
//                                 what functions/api/admin/patch-check.js
//                                 compares discoverLatestPatchSlug()
//                                 against to decide "is this genuinely a
//                                 new patch," so a patch already
//                                 processed is never re-analyzed
//                                 (re-running the AI, re-notifying) just
//                                 because the check ran again.
//
// `id` throughout is the raw Riot slug (e.g. "7-3a") -- stable, unique
// per patch, and already what riotFallback.js keys its own caches by,
// so no separate id scheme is introduced.

import { PATCH_REPORTS_INDEX_LIMIT } from "./config.js";

const INDEX_KEY = "patch-intel:reports";
const LAST_KNOWN_SLUG_KEY = "patch-intel:last-known-slug";

function reportKey(id) {
  return `patch-intel:report:${id}`;
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

async function getIndex(kv) {
  if (!kv) return [];
  try {
    const raw = await kv.get(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function putIndex(kv, index) {
  if (!kv) return;
  try {
    await kv.put(INDEX_KEY, JSON.stringify(index.slice(0, PATCH_REPORTS_INDEX_LIMIT)));
  } catch {
    // best-effort -- the full report body (see saveReport below) is the
    // source of truth; a failed index write just means it's briefly
    // missing from list views, not lost.
  }
}

function indexEntryFor(report) {
  return { id: report.id, patch: report.patch, previousPatch: report.previousPatch, generatedAt: report.generatedAt, status: report.status };
}

/** Stores a brand-new report (functions/api/admin/patch-check.js, after
 *  a successful analysis or a source-unavailable failure) and adds/
 *  updates its index entry. Upserts by id, so re-running a check for a
 *  patch that already has a report (shouldn't normally happen given the
 *  last-known-slug dedup, but kept safe regardless) replaces rather than
 *  duplicates. */
export async function saveReport(kv, report) {
  if (!kv) return false;
  try {
    await kv.put(reportKey(report.id), JSON.stringify(report));
  } catch {
    return false;
  }
  const index = await getIndex(kv);
  const withoutThis = index.filter((e) => e.id !== report.id);
  await putIndex(kv, [indexEntryFor(report), ...withoutThis]);
  return true;
}

export async function getReport(kv, id) {
  if (!kv || !id) return null;
  try {
    const raw = await kv.get(reportKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Merges partial fields into an existing report -- used by
 *  functions/api/admin/patch-reports.js's approve/reject/edit/publish
 *  actions. Returns the updated report, or null if no report with that
 *  id exists (caller returns 404). */
export async function updateReport(kv, id, patchFields) {
  const existing = await getReport(kv, id);
  if (!existing) return null;
  const updated = { ...existing, ...patchFields };
  const saved = await saveReport(kv, updated);
  return saved ? updated : null;
}

/** Full index, newest first -- used by the ADMIN review list (every
 *  status, including pending/rejected). */
export async function listAllReports(kv) {
  return getIndex(kv);
}

/** PUBLIC report list for the Patch Intelligence page -- published
 *  reports only, and with internal-only fields (adminNotes, reviewedBy)
 *  stripped, since those are review-workflow bookkeeping, not something
 *  a visitor needs or should see. Fetches each full report body (the
 *  index alone doesn't carry the analysis content) but only for
 *  published ids, not the whole history. */
export async function listPublicReports(kv) {
  const index = await getIndex(kv);
  const publishedIds = index.filter((e) => e.status === "published").map((e) => e.id);
  const reports = await Promise.all(publishedIds.map((id) => getReport(kv, id)));
  return reports
    .filter(Boolean)
    .map(({ adminNotes, reviewedBy, ...publicFields }) => publicFields);
}
