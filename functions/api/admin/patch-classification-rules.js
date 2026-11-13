// Cloudflare Pages Function -- /api/admin/patch-classification-rules
//
// GET  -> the remembered classification rules ("Remember for future patches"): active and forgotten.
// POST -> { action: "forget", key } -- soft-deletes one rule (it stops applying from the next patch check / re-scan; no revision is
//         rewritten, a published one least of all). Re-remembering is done from a patch's review panel.
// Admin session only. Storage and read discipline: functions/_lib/patchClassificationRules.js.

import { requireAdminSession } from "../../_lib/adminAuth.js";
import { readRules, isUsable, mutateRules, forgetRule } from "../../_lib/patchClassificationRules.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

export async function onRequestGet(context) {
  const kv = context.env.COACH_KV;
  if (!kv) return json({ error: "COACH_KV binding not set up yet." }, 500);
  if (!(await requireAdminSession(context))) return json({ error: "Not authenticated." }, 401);
  const read = await readRules(kv);
  if (!isUsable(read)) return json({ error: `The remembered rules could not be read (${read.status}).`, code: read.status }, 503);
  const all = Object.values(read.doc.rules).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return json({ revision: read.doc.revision, rules: all.filter((r) => !r.forgottenAt), forgotten: all.filter((r) => r.forgottenAt) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.COACH_KV;
  if (!kv) return json({ error: "COACH_KV binding not set up yet." }, 500);
  if (!(await requireAdminSession(context))) return json({ error: "Not authenticated." }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  if (!body || body.action !== "forget" || typeof body.key !== "string" || !body.key) return json({ error: 'Expected { action: "forget", key }.' }, 400);
  const read = await readRules(kv);
  if (!isUsable(read)) return json({ error: `The remembered rules could not be read (${read.status}). Nothing was changed.`, code: read.status }, 503);
  const existing = read.doc.rules[body.key];
  if (!existing || existing.forgottenAt) return json({ error: "No active rule with that key." }, 404);
  const res = await mutateRules(kv, (doc) => { forgetRule(doc, body.key, new Date().toISOString()); return doc; });
  if (!res.ok) return json({ error: `The remembered rules could not be updated safely (${res.code}). Nothing was changed.`, code: res.code }, 503);
  return json({ ok: true, key: body.key, revision: res.doc.revision });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
