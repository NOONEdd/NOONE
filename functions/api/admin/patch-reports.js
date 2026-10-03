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
// POST -> seven admin actions: approve / reject / edit / publish (the
//         original four, now revision-aware -- `revision` in the body
//         is optional, defaults to that patch's latest) / unpublish
//         (new) / restore (new -- "if practical" per spec; just
//         publishRevision() with an older revision number, no separate
//         code path) / delete (new -- irreversibly removes every
//         revision of one patch; requires confirm:true, see below).
//         Every action requires a valid admin session -- there is no
//         path here an unauthenticated request can reach.
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
import { listAllReports, getReportRevision, getLatestReport, listRevisionsForPatch, updateReportRevision, publishRevision, unpublishReport, deletePatchCompletely } from "../../_lib/patchReportsStore.js";
import { mutateOverrides } from "../../_lib/kvSafety.js";
import { applyReviewOps, applyCoachFieldEdits, deriveLegacyReport, mergeFreshOntoExisting, reviewSummary } from "../../_lib/patchNotesReview.js";
import { publicPreview } from "../../_lib/patchNotesPublic.js";
import { ITEMS } from "../../../src/data/items.js";
import { resolveEffectiveItem } from "../../../src/lib/effectiveData.js";

// Server-side approval gate for publish/restore. A revision can only become
// public if a human already approved it -- or it has already been public
// before (published/archived/unpublished: that is what Restore and
// re-publish operate on). pending_review, rejected, partial_failure,
// ai_error and source_unavailable revisions are never publishable
// directly; approve first.
const PUBLISHABLE_STATUSES = new Set(["approved", "published", "archived", "unpublished"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

/** The summary visitors would get for this revision if it were published now (custom text, else generated from the visible reviewed
 *  data) -- computed at READ time by the same function the public endpoint uses and attached to the response only; never stored. */
function withPublicPreview(report) {
  if (!report) return report;
  const itemRoster = ITEMS.map((i) => resolveEffectiveItem(i, undefined));
  return { ...report, publicPreview: publicPreview(report, itemRoster) };
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
    return json({ report: withPublicPreview(report) });
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

  if (action === "delete") {
    // Irreversible -- every revision of this ONE patch is gone for
    // good, so this requires an explicit confirm:true in the body (the
    // Admin UI pairs this with its own window.confirm() before ever
    // sending it) rather than firing on a bare {action:"delete"}.
    // deletePatchCompletely() only ever touches this exact id's own
    // keys (see patchReportsStore.js) -- never Academy champion/item/
    // rune/decisionTree data, never another patch, never a KV scan.
    if (body?.confirm !== true) {
      return json({ error: "Deleting a patch requires confirm:true in the request body." }, 400);
    }
    const result = await deletePatchCompletely(kv, id);
    if (!result.deleted) return json({ error: "No report with that id." }, 404);
    return json({ ok: true, id, revisionsDeleted: result.revisionsDeleted });
  }

  const revision = await resolveTargetRevision(kv, id, requestedRevision);
  if (!revision) return json({ error: "No report with that id." }, 404);

  if (action === "review") {
    // Patch Notes human review: small, targeted operations on the per-change / per-section REVIEW layer only
    // (see patchNotesReview.js). The original Riot source, the normalized extraction and the provenance are
    // never writable here -- applyReviewOps ignores any such key. Each op is applied against a FRESH read of
    // the revision (a delta, never a whole-report replacement), then the draft legacy view is re-derived.
    // Only this revision's own key is written; coach-overrides / Academy master data are never touched.
    const target = await getReportRevision(kv, id, revision);
    if (!target) return json({ error: "No report with that id/revision." }, 404);
    if (!target.patchNotes || !Array.isArray(target.patchNotes.changes)) {
      return json({ error: "This revision predates Patch Notes review (it has no extracted change dataset). Re-scan the patch to generate one.", code: "NO_PATCH_NOTES_DATASET" }, 409);
    }
    const ops = Array.isArray(body?.ops) ? body.ops.slice(0, 500) : [];
    const { dataset, applied, errors } = applyReviewOps(target.patchNotes, ops);
    if (!applied.length) return json({ error: "No valid review operation was applied.", errors }, 400);
    const itemRoster = ITEMS.map((i) => resolveEffectiveItem(i, undefined));
    const legacy = mergeFreshOntoExisting(deriveLegacyReport(dataset, { itemRoster, mode: "draft" }), target);
    const updated = await updateReportRevision(kv, id, revision, {
      patchNotes: dataset, patchNotesSummary: { ...reviewSummary(dataset), validation: dataset.validation },
      championChanges: legacy.championChanges, itemChanges: legacy.itemChanges, runeChanges: legacy.runeChanges, systemChanges: legacy.systemChanges,
    });
    if (!updated) return json({ error: "Failed to save the review." }, 500);
    return json({ ok: true, applied, errors, report: withPublicPreview(updated) });
  }

  if (action === "edit") {
    // Admin corrections to the AI's analysis. Only these specific
    // fields are accepted -- id/status/generatedAt/sourceUrl/etc. are
    // workflow bookkeeping, not something a free-form edit body should
    // be able to overwrite. Nested arrays (championChanges etc.) are
    // replaced wholesale when provided -- the frontend sends the full
    // (admin-edited) array back, not a diff.
    // A report that has a Patch Notes dataset keeps its facts, source text and review state in that dataset
    // (changed only through action "review"). A wholesale array edit is therefore reduced to the Coach fields
    // it carries, merged onto the server's current entries -- see applyCoachFieldEdits.
    const current = await getReportRevision(kv, id, revision);
    if (current && current.patchNotes && edits) {
      const reduced = { ...edits };
      for (const [field, idField] of [["championChanges", "championId"], ["itemChanges", "itemId"], ["runeChanges", "runeId"]]) {
        if (Object.prototype.hasOwnProperty.call(edits, field)) reduced[field] = applyCoachFieldEdits(current[field], edits[field], idField);
      }
      delete reduced.systemChanges; // system rows are derived; they carry no Coach fields
      body.edits = reduced;
    }
    const editsIn = body.edits;
    const allowed = ["supportMetaAnalysis", "adminNotes", "championChanges", "itemChanges", "runeChanges", "systemChanges", "recommendedTierChanges"];
    const safeEdits = {};
    for (const field of allowed) {
      if (editsIn && Object.prototype.hasOwnProperty.call(editsIn, field)) safeEdits[field] = editsIn[field];
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

    // ---- Gate 1: human approval, enforced HERE, not just in the UI ----
    const target = await getReportRevision(kv, id, revision);
    if (!target) return json({ error: "No report with that id/revision." }, 404);
    if (!PUBLISHABLE_STATUSES.has(target.status)) {
      return json({
        error: `Revision ${revision} of this patch is "${target.status}" and cannot be published -- approve it first. Nothing was changed.`,
        code: "APPROVAL_REQUIRED", status: target.status, revision, published: false,
      }, 409);
    }

    // Default true -- publishing a report is the moment in the spec's
    // own workflow ("admin publishes/marks patch verified") where the
    // admin is asserting the manual data review is done. Admins who
    // want to publish the analysis for reference WITHOUT yet declaring
    // the site verified can uncheck this in the UI. Restoring an older
    // revision applies the exact same verification side effect,
    // reusing that revision's own already-recorded `patch` value.
    const shouldMarkVerified = alsoMarkVerified !== false && Boolean(target.patch);

    // ---- Gate 2: the Coach Mode blob must be safe to touch BEFORE
    // anything is published. Marking a patch verified is a read-modify-
    // write of the whole `coach-overrides` blob -- mutateOverrides()
    // (functions/_lib/kvSafety.js) does the full read/verify/validate/
    // backup/apply/validate/destructive-check/write/verify sequence
    // atomically; if ANY step of that fails, nothing is written and the
    // publish is aborted outright rather than published-without-
    // verification or (worse) written over a guessed empty state. This
    // write only ever touches 3 scalar fields (patch/verifiedPatch/
    // patchStatus) and carries every other key through unchanged, so it
    // can never trip the destructive-change check. ----
    if (shouldMarkVerified) {
      const preflight = await mutateOverrides(kv, {
        operation: `patch-publish:${action}`,
        source: `POST /api/admin/patch-reports (id=${id}, revision=${revision})`,
        mutate: (current) => ({ ...current, patch: target.patch, verifiedPatch: target.patch, patchStatus: null }), // "verified" is derived from verifiedPatch matching patch -- see resolvePatchDataStatus()
      });
      if (!preflight.ok) {
        return json({
          error: `Publish aborted: the live Coach Mode data could not be safely updated (${preflight.code}). Nothing was published and no Coach Mode data was changed. ${preflight.error || ""}`.trim(),
          code: preflight.code, published: false,
        }, preflight.httpStatus || 503);
      }
    }

    const updated = await publishRevision(kv, id, revision, { reviewedAt: new Date().toISOString() });
    if (!updated) return json({ error: "Failed to update report." }, 500);
    return json({ ok: true, report: updated, markedVerified: shouldMarkVerified && Boolean(updated.patch) });
  }

  return json({ error: `Unknown action "${action}". Expected one of: edit, review, approve, reject, publish, unpublish, restore, delete.` }, 400);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
  });
}
