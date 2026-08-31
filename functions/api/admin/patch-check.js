// Cloudflare Pages Function — POST /api/admin/patch-check
//
// TWO independent operations, both admin-only, sharing one endpoint
// because they share almost all of their logic (fetch official content,
// build the Academy roster snapshot, run the AI analysis, shape a
// report object) and both belong to Patch Intelligence's generation
// step -- they differ only in HOW they pick a slug and what happens to
// that slug/report afterward:
//
//   1. NORMAL DETECTION (default; also reachable via {"trigger":"manual"}
//      or {"trigger":"scheduled"}) -- discovers Riot's LATEST slug,
//      compares against patch-intel:last-known-slug, does nothing if
//      already processed, otherwise analyzes it as a brand-new patch
//      (revision 1), advances last-known-slug, and sends the
//      new-patch notification. Reachable by either an authenticated
//      admin session OR the shared-secret header (unattended
//      scheduling -- see README's "Automatic patch detection" section).
//      Unchanged in every observable way from before this file added
//      re-analysis.
//
//   2. RE-ANALYZE ({"action":"reanalyze","patchId":"7-3a"}) -- analyzes
//      a SPECIFIC, already-known patch id directly (never
//      discoverLatestPatchSlug()), producing a new revision alongside
//      whatever revision(s) already exist for it -- see
//      patchReportsStore.js's saveReanalysisRevision(). Never touches
//      last-known-slug, never sends the new-patch notification (this is
//      explicitly NOT "a new patch was found"), and works identically
//      whether or not patchId is still Riot's latest patch. Admin
//      SESSION only -- the scheduled shared-secret path can never reach
//      this branch, since re-analysis is a deliberate, credit-consuming
//      admin action, never something a cron trigger should do on its
//      own.
//
// Neither operation ever touches public Academy data
// (overrides.champions/items/runes/decisionTrees, or even
// overrides.patch/verifiedPatch) -- only functions/api/admin/
// patch-reports.js's "publish" action can ever change those, and only
// after a human looks at the specific revision this endpoint produced.

import { requireAdminSession, hasValidPatchCheckSecret } from "../../_lib/adminAuth.js";
import { discoverLatestPatchSlug, fetchAndCacheFullPatchContent, extractPatchNumberFromContent } from "../../_lib/riotFallback.js";
import { runPatchIntelAnalysis } from "../../_lib/patchIntelligence.js";
import { saveNewReport, saveReanalysisRevision, getLatestReport, getLastKnownSlug, setLastKnownSlug } from "../../_lib/patchReportsStore.js";
import { sendPatchNotification, sendSourceUnavailableNotification } from "../../_lib/notify.js";
import { resolveActiveProviderAndModel } from "../../_lib/aiProvider.js";
import { fetchOverrides } from "../../_lib/kv.js";
import { logPatchIntelEvent } from "../../_lib/logger.js";
import { resolveEffectiveChampion, resolveEffectiveItem, resolveEffectiveRune, resolveEffectivePatch } from "../../../src/lib/effectiveData.js";
import { CHAMPIONS, isAcademyCovered } from "../../../src/data/champions.js";
import { MATCHUPS } from "../../../src/data/matchups.js";
import { ITEMS } from "../../../src/data/items.js";
import { RUNES } from "../../../src/data/runes.js";
import { STATIC_PATCH_VERSION } from "../../../src/data/patch.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

function adminReviewUrlFor(request) {
  try {
    return `${new URL(request.url).origin}/#/admin`;
  } catch {
    return null;
  }
}

/** Shared by both operations: given a specific slug, produce a full
 *  report object (source_unavailable / ai_error / pending_review),
 *  never persisting or notifying anything itself -- callers decide how
 *  to save it (saveNewReport vs. saveReanalysisRevision) and what else
 *  to do (advance last-known-slug, notify) since those genuinely differ
 *  between normal detection and re-analysis.
 *
 *  Trust-hierarchy note (unchanged): the AI is only ever called AFTER a
 *  successful official-source fetch -- a failed fetch returns a
 *  source_unavailable report WITHOUT reaching runPatchIntelAnalysis at
 *  all, same as always. */
async function analyzePatch({ env, kv, slug, overrides }) {
  const previousPatch = resolveEffectivePatch(overrides.patch, STATIC_PATCH_VERSION);
  const contentResult = await fetchAndCacheFullPatchContent(slug, kv);

  if (!contentResult.found) {
    return {
      status: "source_unavailable",
      report: {
        id: slug, patch: null, patchNumberSource: null, previousPatch,
        status: "source_unavailable", generatedAt: new Date().toISOString(),
        sourceUrl: null, sourceAvailable: false, aiProvider: null, aiModel: null,
        championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [],
        supportMetaAnalysis: "", recommendedTierChanges: [], sourceReferences: [],
        adminNotes: "", reviewedBy: null, reviewedAt: null, notifiedAt: null,
      },
    };
  }

  const { patchNumber, source: patchNumberSource } = extractPatchNumberFromContent(contentResult.content, slug);

  // Academy-covered only -- see isAcademyCovered's own doc comment
  // (src/data/champions.js) for why: this roster is shown directly to
  // the AI as "here's what Academy tracks" (patchIntelligence.js's
  // formatRosterSnapshot/ANALYST_INSTRUCTIONS), not just used for
  // post-hoc id resolution, so a champion Academy doesn't cover simply
  // isn't part of what either operation ever reports on.
  const championRoster = CHAMPIONS.filter(isAcademyCovered).map((c) => resolveEffectiveChampion(c, overrides.champions[c.id], MATCHUPS[c.id]));
  const itemRoster = ITEMS.map((i) => resolveEffectiveItem(i, overrides.items[i.id]));
  const runeRoster = RUNES.map((r) => resolveEffectiveRune(r, overrides.runes[r.id]));

  const { provider: aiProvider, model: aiModel } = resolveActiveProviderAndModel(env);
  const analysis = await runPatchIntelAnalysis({ env, patchContent: contentResult.content, championRoster, itemRoster, runeRoster });

  if (!analysis.ok) {
    // logDetail never contains an API key, password, or session token,
    // only reply length/finish-reason/a truncated raw-reply snippet or
    // a parse-error message -- safe for both Cloudflare's Function logs
    // AND the report's own adminNotes (so the failure reason is visible
    // directly in the Admin UI without needing separate log access).
    logPatchIntelEvent({ stage: "analysis_failed", slug, provider: aiProvider, model: aiModel, code: analysis.code, detail: analysis.logDetail, maxTokens: analysis.maxTokens });
    return {
      status: "ai_error",
      aiError: analysis.error,
      aiErrorCode: analysis.code,
      report: {
        id: slug, patch: patchNumber, patchNumberSource, previousPatch,
        status: "ai_error", generatedAt: new Date().toISOString(),
        sourceUrl: contentResult.source, sourceAvailable: true, aiProvider, aiModel,
        championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [],
        supportMetaAnalysis: "", recommendedTierChanges: [],
        sourceReferences: [contentResult.source].filter(Boolean),
        adminNotes: `[${analysis.code}] ${analysis.error || ""}${analysis.logDetail ? `\n\nDiagnostic detail: ${analysis.logDetail}` : ""}`,
        reviewedBy: null, reviewedAt: null, notifiedAt: null,
      },
    };
  }

  // maxTokens is now always the same fixed PATCH_INTEL_MAX_TOKENS ceiling
  // (functions/_lib/patchIntelligence.js no longer computes a per-patch
  // estimate) -- still logged so Cloudflare's logs show what every
  // generation actually requested, just no longer a variable worth
  // treating as diagnostic in itself.
  logPatchIntelEvent({ stage: "analysis_succeeded", slug, provider: aiProvider, model: aiModel, parseStrategy: analysis.parseStrategy, championChanges: analysis.report.championChanges.length, itemChanges: analysis.report.itemChanges.length, runeChanges: analysis.report.runeChanges.length, systemChanges: analysis.report.systemChanges.length, maxTokens: analysis.maxTokens });

  return {
    status: "pending_review",
    report: {
      id: slug, patch: patchNumber, patchNumberSource, previousPatch,
      status: "pending_review", generatedAt: new Date().toISOString(),
      sourceUrl: contentResult.source, sourceAvailable: true, aiProvider, aiModel,
      ...analysis.report,
      sourceReferences: [contentResult.source].filter(Boolean),
      adminNotes: "", reviewedBy: null, reviewedAt: null, notifiedAt: null,
    },
  };
}

/** Re-analyze: {"action":"reanalyze","patchId":"7-3a"}. Admin session
 *  only (see file header for why the scheduled secret can't reach
 *  this). Requires a report to already exist for patchId -- re-analysis
 *  is "generate another revision of a patch Patch Intelligence already
 *  knows about," not a way to sneak a brand-new patch in through a
 *  side door. */
async function handleReanalyze(context, body) {
  const { env } = context;
  const kv = env.COACH_KV;
  if (!kv) return json({ ok: false, code: "kv_not_configured", error: "COACH_KV binding not set up yet." }, 500);

  if (!(await requireAdminSession(context))) {
    return json({ ok: false, code: "unauthorized", error: "Not authenticated." }, 401);
  }

  const patchId = body?.patchId;
  if (!patchId || typeof patchId !== "string") {
    return json({ ok: false, error: "Missing patchId." }, 400);
  }

  const existing = await getLatestReport(kv, patchId);
  if (!existing) {
    return json({ ok: false, error: `No existing report for patch "${patchId}" -- re-analyze only works on a patch Patch Intelligence has already generated at least once.` }, 404);
  }

  const overrides = await fetchOverrides(kv);
  const result = await analyzePatch({ env, kv, slug: patchId, overrides });

  const revision = await saveReanalysisRevision(kv, patchId, result.report);
  if (revision === null) {
    return json({ ok: false, error: "Failed to save the new revision." }, 500);
  }

  // Deliberately NOT calling setLastKnownSlug and NOT calling
  // sendPatchNotification/sendSourceUnavailableNotification anywhere in
  // this function -- this is not a newly discovered patch, so neither
  // of those normal-detection side effects apply. The new revision is
  // pending_review (or ai_error/source_unavailable on failure) either
  // way; whatever revision was already published for this id is
  // completely untouched by everything above -- saveReanalysisRevision
  // carries publishedRevision forward unchanged, and analyzePatch never
  // writes to any existing revision's key at all, only the new one's.
  return json({ ok: true, reanalyzed: true, patchId, revision, status: result.status, report: { ...result.report, revision } });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.COACH_KV;
  if (!kv) {
    return json({ ok: false, code: "kv_not_configured", error: "COACH_KV binding not set up yet." }, 500);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    // no body / not JSON is fine -- trigger just defaults below
  }

  if (body && body.action === "reanalyze") {
    return handleReanalyze(context, body);
  }

  // ---- Normal new-patch detection (unchanged) ----

  const isAdmin = await requireAdminSession(context);
  const isScheduled = !isAdmin && hasValidPatchCheckSecret(request, env);
  if (!isAdmin && !isScheduled) {
    return json({ ok: false, code: "unauthorized", error: "Not authenticated." }, 401);
  }

  const trigger = body && body.trigger === "scheduled" ? "scheduled" : "manual";
  const adminReviewUrl = adminReviewUrlFor(request);

  const latestSlug = await discoverLatestPatchSlug(kv);
  if (!latestSlug) {
    // Couldn't even reach/parse Riot's patch index -- we don't know
    // whether a new patch exists at all, so there's nothing to persist
    // (no slug to key a report by) and nothing was changed. Only
    // notify on the unattended path -- a manual click already shows
    // this error directly in the Admin UI.
    if (trigger === "scheduled") {
      const overrides = await fetchOverrides(kv);
      const previousPatch = resolveEffectivePatch(overrides.patch, STATIC_PATCH_VERSION);
      await sendSourceUnavailableNotification({ env, previousPatch, adminReviewUrl });
    }
    return json({ ok: false, code: "index_unavailable", error: "Couldn't reach Riot's Wild Rift patch notes index right now. Nothing was changed — try again shortly." }, 502);
  }

  const lastKnownSlug = await getLastKnownSlug(kv);
  if (latestSlug === lastKnownSlug) {
    return json({ ok: true, newPatch: false, currentSlug: latestSlug });
  }

  const overrides = await fetchOverrides(kv);
  const result = await analyzePatch({ env, kv, slug: latestSlug, overrides });

  await saveNewReport(kv, result.report);

  if (result.status === "pending_review") {
    // Only advance last-known-slug (and only send the normal new-patch
    // notification) once a real analysis actually succeeded -- a
    // source_unavailable or ai_error result deliberately leaves
    // last-known-slug untouched, so the NEXT check (manual or
    // scheduled) retries this same slug instead of silently skipping a
    // patch that was never actually analyzed.
    await setLastKnownSlug(kv, latestSlug);
    const notifyResult = await sendPatchNotification({ env, report: result.report, patch: result.report.patch, previousPatch: result.report.previousPatch, adminReviewUrl });
    if (notifyResult.sent) {
      result.report.notifiedAt = new Date().toISOString();
      await saveNewReport(kv, result.report);
    }
  } else if (trigger === "scheduled") {
    await sendSourceUnavailableNotification({ env, previousPatch: result.report.previousPatch, adminReviewUrl });
  }

  return json({ ok: true, newPatch: true, status: result.status, report: result.report, ...(result.aiError ? { aiError: result.aiError, aiErrorCode: result.aiErrorCode } : {}) });
}
