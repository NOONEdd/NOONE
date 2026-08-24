// Cloudflare Pages Function — /api/admin/patch-reports
//
// GET  -> full report index (every status, not just published) for the
//         Admin Patch Review list in src/pages/AdminPage.jsx, plus
//         `?id=<slug>` for one full report body.
// POST -> the four review actions from the spec: approve / reject /
//         edit / publish. Every action requires a valid admin session --
//         there is no path here an unauthenticated request can reach.
//
// "publish" is the ONLY action in this whole feature that can ever touch
// PUBLIC Academy data, and even then it only ever writes the
// patch-number/verification override fields (overrides.patch /
// overrides.verifiedPatch / overrides.patchStatus) -- never
// overrides.champions/items/runes/decisionTrees. That's deliberate and
// matches the spec's explicit rule ("AI recommendations must NEVER
// automatically overwrite production Academy data"): applying a
// recommended tier change is still a manual edit the admin makes the
// normal way, in place, on the tier list / champion pages -- exactly
// like every Coach Mode edit before this feature existed. Publishing a
// report is "I've reviewed this and I'm ready to say the site reflects
// this patch," not "apply everything the AI suggested."

import { requireAdminSession } from "../../_lib/adminAuth.js";
import { listAllReports, getReport, updateReport } from "../../_lib/patchReportsStore.js";
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

  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const report = await getReport(kv, id);
    if (!report) return json({ error: "No report with that id." }, 404);
    return json({ report });
  }

  const reports = await listAllReports(kv);
  return json({ reports });
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

  const { id, action, edits, alsoMarkVerified } = body || {};
  if (!id || typeof id !== "string") return json({ error: "Missing report id" }, 400);

  const existing = await getReport(kv, id);
  if (!existing) return json({ error: "No report with that id." }, 404);

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
    const updated = await updateReport(kv, id, safeEdits);
    return json({ ok: true, report: updated });
  }

  if (action === "approve" || action === "reject") {
    const updated = await updateReport(kv, id, {
      status: action === "approve" ? "approved" : "rejected",
      reviewedAt: new Date().toISOString(),
    });
    return json({ ok: true, report: updated });
  }

  if (action === "publish") {
    const updated = await updateReport(kv, id, { status: "published", reviewedAt: new Date().toISOString() });
    if (!updated) return json({ error: "Failed to update report." }, 500);

    // Default true -- publishing a report is the moment in the spec's
    // own workflow ("admin publishes/marks patch verified") where the
    // admin is asserting the manual data review is done. Admins who
    // want to publish the analysis for reference WITHOUT yet declaring
    // the site verified can uncheck this in the UI.
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

  return json({ error: `Unknown action "${action}". Expected one of: edit, approve, reject, publish.` }, 400);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
  });
}
