// Cloudflare Pages Function — GET /api/patch-reports
// PUBLIC, unauthenticated, read-only -- the data source for
// src/pages/PatchNotesPage.jsx. Only ever returns reports an
// admin has explicitly PUBLISHED (see functions/api/admin/patch-reports.js's
// "publish" action); pending/approved/rejected/source_unavailable/
// ai_error reports stay in the private Admin Patch Review area and are
// never exposed here. Internal review fields (adminNotes, reviewedBy)
// are stripped before this responds -- see patchReportsStore.js's
// listPublicReports().

import { listPublicReports } from "../_lib/patchReportsStore.js";
import { toPublicView } from "../_lib/patchNotesPublic.js";
import { ITEMS } from "../../src/data/items.js";
import { resolveEffectiveItem } from "../../src/lib/effectiveData.js";

// The public Patch Notes view is DERIVED at read time from the reviewed dataset (only changes whose review state allows
// publication; see patchNotesReview.js isChangePublishable) by patchNotesPublic.js. The review dataset itself -- original source,
// normalized extraction, provenance -- never leaves the admin API; the presentation fields (display text, the reviewer's note,
// classification, subsection headings, summary) do.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

export async function onRequestGet(context) {
  const kv = context.env.COACH_KV;
  if (!kv) return json({ reports: [] });
  const itemRoster = ITEMS.map((i) => resolveEffectiveItem(i, undefined));
  const reports = (await listPublicReports(kv)).map((r) => toPublicView(r, itemRoster));
  reports.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
  return json({ reports });
}
