// Cloudflare Pages Function — GET /api/patch-reports
// PUBLIC, unauthenticated, read-only -- the data source for
// src/pages/PatchIntelligencePage.jsx. Only ever returns reports an
// admin has explicitly PUBLISHED (see functions/api/admin/patch-reports.js's
// "publish" action); pending/approved/rejected/source_unavailable/
// ai_error reports stay in the private Admin Patch Review area and are
// never exposed here. Internal review fields (adminNotes, reviewedBy)
// are stripped before this responds -- see patchReportsStore.js's
// listPublicReports().

import { listPublicReports } from "../_lib/patchReportsStore.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

export async function onRequestGet(context) {
  const kv = context.env.COACH_KV;
  if (!kv) return json({ reports: [] });
  const reports = await listPublicReports(kv);
  reports.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
  return json({ reports });
}
