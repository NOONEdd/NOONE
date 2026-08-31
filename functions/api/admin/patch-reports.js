// Cloudflare Pages Function — /api/admin/patch-reports
//
// GET  -> full report index (every status, not just published) for the
//         Admin Patch Review list in src/pages/AdminPage.jsx, via
//         listAllReports() (patchReportsStore.js) -- each entry now
//         carries latestRevision/publishedRevision alongside the
//         latest revision's own status, so the list shows "there's a
//         new pending revision" without a separate fetch.
//         `?id=<slug>` -> one specific revision's full body (defaults
//         to the LATEST revision when `revision` is omitted --
//         matches every pre-revision report's only behavior exactly,
//         since a report that's never been re-analyzed only has one).
//         `?id=<slug>&revision=<n>` -> that exact revision.
//         `?id=<slug>&allRevisions=1` -> every revision for that patch,
//         oldest first (listRevisionsForPatch) -- powers the Admin
//         revision-history view.
// POST -> six admin actions: approve / reject / edit / publish (the
//         original four, now revision-aware -- `revision` in the body
//         is optional, defaults to that patch's latest) / unpublish
//         (new) / restore (new -- "if practical" per spec; just
//         publishRevision() with an older revision number, no separate
//         code path). Every action requires a valid admin session --
//         there is no path here an unauthenticated request can reach.
//
// "publish" (and "restore", which is the same underlying operation) are
// the ONLY actions in this whole feature that can ever touch PUBLIC
// Academy data, and even then only ever write the patch-number/
// verification override fields (overrides.patch / overrides.verifiedPatch
// / overrides.patchStatus) -- never overrides.champions/items/runes/
// decisionTrees. That's deliberate and matches the trust-hierarchy rule
// ("AI recommendations must NEVER automatically overwrite production
// Academy data"): applying a recommended tier change is still a manual
// edit the admin makes the normal way, in place, on the tier list /
// champion pages -- exactly like every Coach Mode edit before this
// feature existed. Publishing a report is "I've reviewed this and I'm
// ready to say the site reflects this patch," not "apply everything the
// AI suggested."

import { requireAdminSession } from "../../_lib/adminAuth.js";
import { listAllReports, getReportRevision, getLatestReport, listRevisionsForPatch, updateReportRevision, publishRevision, unpublishReport } from "../../_lib/patchReportsStore.js";
import { fetchOverrides } from "../../_lib/kv.js";

const KEY = "coach-overrides"; // matches functions/api/coach-overrides.js exactly -- see that file for why

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const kv = env.COACH_KV;
  if (!kv) return json({ error: "COACH_KV binding not set up yet." }, 500);
  if (!(await requireAdminSession(context))) return json({ error: "Not authenticated." }, 401);

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    if (url.searchParams.get("allRevisions")) {
      const revisions = await listRevisionsForPatch(kv, id);
      return json({ revisions });
    }
    const revisionParam = url.searchParams.get("revision");
    const report = revisionParam ? await getReportRevision(kv, id, Number(revisionParam)) : await getLatestReport(kv, id);
    if (!report) return json({ error: "No report with that id/revision." }, 404);
    return json({ report });
  }

  const reports = await listAllReports(kv);
  return json({ reports });
}

/** Resolves which revision number an action should apply to: the body's
 *  explicit `revision` if given, otherwise that patch's latest -- so
 *  every existing caller that never sends `revision` (the original
 *  edit/approve/reject/publish flows, unaware revisions exist at all)
 *  keeps working exactly as before, since a report that's never been
 *  re-analyzed only ever has one revision to default to. */
async function resolveTargetRevision(kv, id, requestedRevision) {
  if (requestedRevision) return requestedRevision;
  const latest = await getLatestReport(kv, id);
  return latest ? (latest.revision || 1) : null;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.COACH_KV;
  if (!kv) return json({ error: "COACH_KV binding not set up yet." }, 500);
  if (!(await requireAdminSession(context))) return json({ error: "Not authenticated." }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { id, action, edits, alsoMarkVerified, revision: requestedRevision } = body || {};
  if (!id || typeof id !== "string") return json({ error: "Missing report id" }, 400);

  if (action === "unpublish") {
    const updated = await unpublishReport(kv, id);
    if (!updated) return json({ error: "Nothing is currently published for that patch." }, 404);
    // last-known-slug and the Riot content cache are untouched by
    // design -- unpublishReport() only ever writes the revision pointer
    // and the (now-former) published revision's own status. The patch
    // can be re-analyzed and published again with no data loss.
    return json({ ok: true, report: updated });
  }

  const revision = await resolveTargetRevision(kv, id, requestedRevision);
  if (!revision) return json({ error: "No report with that id." }, 404);

  if (action === "edit") {
    // Admin corrections to the AI's analysis. Only these specific
    // fields are accepted -- id/status/generatedAt/sourceUrl/etc. are
    // workflow bookkeeping, not something a free-form edit body should
    // be able to overwrite. Nested arrays (championChanges etc.) are
    // replaced wholesale when provided -- the frontend sends the full
    // (admin-edited) array back, not a diff.
    const allowed = ["supportMetaAnalysis", "adminNotes", "championChanges", "itemChanges", "runeChanges", "systemChanges", "recommendedTierChanges"];
    const safeEdits = {};
    for (const field of allowed) {
      if (edits && Object.prototype.hasOwnProperty.call(edits, field)) safeEdits[field] = edits[field];
    }
    const updated = await updateReportRevision(kv, id, revision, safeEdits);
    return json({ ok: true, report: updated });
  }

  if (action === "approve" || action === "reject") {
    const updated = await updateReportRevision(kv, id, revision, {
      status: action === "approve" ? "approved" : "rejected",
      reviewedAt: new Date().toISOString(),
    });
    return json({ ok: true, report: updated });
  }

  if (action === "publish" || action === "restore") {
    // "restore" (an older revision than the current one) and "publish"
    // (normally the latest, pending one) are the exact same operation --
    // publishRevision() doesn't care which direction `revision` moves
    // in, it just makes THAT revision the public one and archives
    // whatever was published before. See patchReportsStore.js.
    const updated = await publishRevision(kv, id, revision, { reviewedAt: new Date().toISOString() });
    if (!updated) return json({ error: "Failed to update report." }, 500);

    // Default true -- publishing a report is the moment in the spec's
    // own workflow ("admin publishes/marks patch verified") where the
    // admin is asserting the manual data review is done. Admins who
    // want to publish the analysis for reference WITHOUT yet declaring
    // the site verified can uncheck this in the UI. Restoring an older
    // revision applies the exact same verification side effect,
    // reusing that revision's own already-recorded `patch` value.
    const shouldMarkVerified = alsoMarkVerified !== false;
    if (shouldMarkVerified && updated.patch) {
      const overrides = await fetchOverrides(kv);
      overrides.patch = updated.patch;
      overrides.verifiedPatch = updated.patch;
      overrides.patchStatus = null; // "verified" is derived from verifiedPatch matching patch -- see resolvePatchDataStatus()
      try {
        await kv.put(KEY, JSON.stringify(overrides));
      } catch {
        return json({ ok: true, report: updated, verifiedWriteFailed: true, error: "Report published, but writing the verified-patch status failed (KV write limit?). Set it manually from the patch editor on any tier list page." });
      }
    }
    return json({ ok: true, report: updated, markedVerified: shouldMarkVerified && Boolean(updated.patch) });
  }

  return json({ error: `Unknown action "${action}". Expected one of: edit, approve, reject, publish, unpublish, restore.` }, 400);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
  });
}
