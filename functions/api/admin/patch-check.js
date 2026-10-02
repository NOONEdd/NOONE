// Cloudflare Pages Function — POST /api/admin/patch-check
//
// TWO independent operations, both admin-only, sharing one endpoint
// because they share almost all of their logic (fetch official content,
// build the Academy roster snapshot, run the deterministic analysis,
// shape a report object) and both belong to Patch Notes'
// generation step -- they differ only in HOW they pick a slug and what
// happens to that slug/report afterward:
//
//   1. NORMAL DETECTION (default; also reachable via {"trigger":"manual"}
//      or {"trigger":"scheduled"}) -- discovers Riot's LATEST slug,
//      compares against patch-intel:last-known-slug, does nothing if
//      already processed, otherwise analyzes it as a brand-new patch
//      (revision 1), advances last-known-slug, and sends the
//      new-patch notification. Reachable by either an authenticated
//      admin session OR the shared-secret header (unattended
//      scheduling -- see README's "Automatic patch detection" section).
//
//   2. RESCAN ({"action":"rescan","patchId":"7-3a"}; "reanalyze" and
//      "retry-analysis" are accepted as aliases for the same operation,
//      for continuity with older Admin UI builds) -- re-runs
//      deterministic detection for a SPECIFIC, already-known patch id,
//      producing a new revision alongside whatever revision(s) already
//      exist for it -- see patchReportsStore.js's
//      saveReanalysisRevision(). Refreshes every entry's Riot-sourced
//      FACT fields from a fresh pass over the (possibly re-fetched)
//      source text, while preserving every already-written COACH field
//      on any entity that's still detected (see
//      patchNotesReview.js's mergeFreshOntoExisting) -- a rescan
//      is "the source text or Academy data may have changed, refresh
//      what Riot said," never "throw away the Coach's analysis." Never
//      touches last-known-slug, never sends the new-patch notification
//      (this is explicitly NOT "a new patch was found"). Admin SESSION
//      only.
//
// AI REMOVAL (this rebuild): there is no AI call anywhere in this file
// or anything it calls. Every analysis either succeeds deterministically
// or the earlier content FETCH failed (source_unavailable) -- there is
// no ai_error, no partial_failure, no retry-analysis-as-recovery-from-a-
// failed-AI-call concept anymore, because none of those failure modes
// exist once nothing calls out to a model. The one remaining safety net
// is a generic try/catch around the analysis call, for a genuine code
// bug -- never expected to trigger in normal operation.
//
// Neither operation ever touches public Academy data
// (overrides.champions/items/runes/decisionTrees) directly -- only
// functions/api/admin/patch-reports.js's "publish" action can ever
// change overrides.patch/verifiedPatch, through the KV safety layer
// (functions/_lib/kvSafety.js), and only after a human looks at the
// specific revision this endpoint produced.

import { requireAdminSession, hasValidPatchCheckSecret } from "../../_lib/adminAuth.js";
import { discoverLatestPatchSlug, fetchAndCacheFullPatchContent, extractPatchNumberFromContent } from "../../_lib/riotFallback.js";
import { runPatchIntelAnalysis, PATCH_INTEL_ENGINE_VERSION } from "../../_lib/patchIntelPipeline.js";
import { mergeFreshOntoExisting } from "../../_lib/patchNotesReview.js";
import { saveNewReport, saveReanalysisRevision, updateReportRevision, getLatestReport, getLastKnownSlug, setLastKnownSlug } from "../../_lib/patchReportsStore.js";
import { sendPatchNotification, sendSourceUnavailableNotification } from "../../_lib/notify.js";
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

/** A short, safe fingerprint of the fetched patch content -- proves in
 *  logs that a specific analysis run was given specific source text
 *  without ever logging the content itself. */
async function fingerprintContent(content) {
  const bytes = new TextEncoder().encode(content || "");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

/** Shared by both operations: given a specific slug, produce a full
 *  report object (source_unavailable / analysis_error / pending_review),
 *  never persisting or notifying anything itself -- callers decide how
 *  to save it (saveNewReport vs. saveReanalysisRevision) and what else
 *  to do (advance last-known-slug, notify).
 *
 *  `mergeOnto` (optional, rescan only): an existing report whose COACH
 *  fields should be preserved on any entity this run still detects --
 *  see patchNotesReview.js's mergeFreshOntoExisting. Normal
 *  detection never passes this (there's nothing to merge onto -- it's a
 *  brand-new patch). aiProvider/aiModel fields are kept in the saved
 *  report shape (always null) purely so older stored revisions that DO
 *  have real values there stay readable without a schema migration --
 *  nothing reads them as meaningful anymore. */
async function analyzePatch({ kv, slug, overrides, logContext = {}, mergeOnto = null }) {
  const previousPatch = resolveEffectivePatch(overrides.patch, STATIC_PATCH_VERSION);
  const contentResult = await fetchAndCacheFullPatchContent(slug, kv);
  const contentFingerprint = contentResult.found ? await fingerprintContent(contentResult.content) : null;

  logPatchIntelEvent({
    stage: "content_fetched", slug, ...logContext,
    found: contentResult.found,
    contentSource: contentResult.found ? (contentResult.cached ? "cache" : "fresh_fetch") : "unavailable",
    contentFingerprint, contentLength: contentResult.content ? contentResult.content.length : 0,
    sourceTruncated: Boolean(contentResult.truncated), sourceOriginalLength: contentResult.originalLength || 0,
  });

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
  // (src/data/champions.js): this roster is exactly what Academy tracks
  // curated content for, so a champion Academy doesn't cover isn't part
  // of what this pipeline reports on either.
  const championRoster = CHAMPIONS.filter(isAcademyCovered).map((c) => resolveEffectiveChampion(c, overrides.champions[c.id], MATCHUPS[c.id]));
  const itemRoster = ITEMS.map((i) => resolveEffectiveItem(i, overrides.items[i.id]));
  const runeRoster = RUNES.map((r) => resolveEffectiveRune(r, overrides.runes[r.id]));

  const startedAt = Date.now();
  logPatchIntelEvent({ stage: "analysis_start", slug, ...logContext, engineVersion: PATCH_INTEL_ENGINE_VERSION, startedAt: new Date(startedAt).toISOString() });

  let analysis;
  try {
    // patchVersion/sourceUrl are provenance stamped on every extracted change; previousPatchNotes
    // carries the human review (kept/edited/removed/rejected + display edits + removed sections)
    // of the report being regenerated forward by stable change ID -- a rescan can never reset it.
    analysis = await runPatchIntelAnalysis({
      patchContent: contentResult.content, championRoster, itemRoster, runeRoster,
      patchVersion: patchNumber, sourceUrl: contentResult.source,
      previousPatchNotes: (mergeOnto && mergeOnto.patchNotes) || null,
    });
  } catch (err) {
    // Belt-and-braces: deterministic extraction has no I/O and no
    // external dependency, so this should never actually throw in
    // normal operation -- if it does, it's a real code bug, and this
    // must produce a visible, saved failure record (never a bare 500
    // with no trace) rather than silently pretending nothing happened.
    logPatchIntelEvent({ stage: "analysis_unexpected_error", slug, ...logContext, error: String((err && err.message) || err) });
    return {
      status: "analysis_error",
      report: {
        id: slug, patch: patchNumber, patchNumberSource, previousPatch,
        status: "analysis_error", generatedAt: new Date().toISOString(),
        sourceUrl: contentResult.source, sourceAvailable: true, aiProvider: null, aiModel: null,
        championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [],
        supportMetaAnalysis: "", recommendedTierChanges: [],
        sourceReferences: [contentResult.source].filter(Boolean),
        adminNotes: `Deterministic analysis raised an unexpected error: ${err && err.message ? err.message : String(err)}`,
        reviewedBy: null, reviewedAt: null, notifiedAt: null,
        engineVersion: PATCH_INTEL_ENGINE_VERSION, contentFingerprint,
      },
    };
  }
  const durationMs = Date.now() - startedAt;

  const effectiveReport = mergeOnto ? mergeFreshOntoExisting(analysis.report, mergeOnto) : analysis.report;

  logPatchIntelEvent({
    stage: "analysis_finish", slug, ...logContext, ok: true, complete: true,
    rescan: Boolean(mergeOnto), reviewMerge: analysis.patchNotes?.mergeStats || null, accounting: analysis.patchNotes?.validation ? { blocks: analysis.patchNotes.validation.totalMeaningfulBlocks, unaccounted: analysis.patchNotes.validation.droppedBlocks, changes: analysis.patchNotes.validation.totalChanges } : null,
    championChanges: effectiveReport.championChanges.length, itemChanges: effectiveReport.itemChanges.length,
    runeChanges: effectiveReport.runeChanges.length, systemChanges: effectiveReport.systemChanges.length,
    engineVersion: analysis.engineVersion, durationMs,
    parsedUnits: analysis.pipelineStats?.parsedUnits?.units, categoryCounts: analysis.pipelineStats?.categoryCounts,
  });

  return {
    status: "pending_review",
    report: {
      id: slug, patch: patchNumber, patchNumberSource, previousPatch,
      status: "pending_review", generatedAt: new Date().toISOString(),
      sourceUrl: contentResult.source, sourceAvailable: true, aiProvider: null, aiModel: null,
      ...effectiveReport,
      sourceReferences: [contentResult.source].filter(Boolean),
      adminNotes: mergeOnto ? "Re-scanned: Riot facts refreshed; every Patch Notes review decision (kept/edited/removed/rejected, display edits, removed sections) and Coach field was carried forward by stable change ID." : "",
      reviewedBy: null, reviewedAt: null, notifiedAt: null,
      engineVersion: analysis.engineVersion, contentFingerprint,
    },
  };
}

/** Rescan / Refresh Detection -- re-runs deterministic analysis for a
 *  patch Patch Notes already has at least one report for,
 *  producing a new revision that refreshes Riot-sourced facts while
 *  preserving every Coach-written field (see analyzePatch's mergeOnto
 *  and patchNotesReview.js's mergeFreshOntoExisting). Admin
 *  session only (see file header). Works identically regardless of the
 *  existing report's status.
 *
 *  `ok` is true whenever the operation itself completed (a new revision
 *  was successfully created and any already-published revision is
 *  untouched) -- there is no longer a separate `success` axis for "the
 *  analysis step itself failed," since deterministic analysis has no
 *  partial-failure mode; `ok:false` now only means the rescan couldn't
 *  even run (bad request, no existing report, save failed). */
async function handleRescan(context, body) {
  const { env } = context;
  const kv = env.COACH_KV;
  if (!kv) return json({ ok: false, code: "kv_not_configured", error: "COACH_KV binding not set up yet." }, 500);

  if (!(await requireAdminSession(context))) {
    return json({ ok: false, code: "unauthorized", error: "Not authenticated." }, 401);
  }

  const action = "rescan";
  const patchId = body?.patchId;
  if (!patchId || typeof patchId !== "string") {
    return json({ ok: false, action, error: "Missing patchId." }, 400);
  }

  const existing = await getLatestReport(kv, patchId);
  if (!existing) {
    return json({ ok: false, action, error: `No existing report for patch "${patchId}" -- rescan only works on a patch Patch Notes has already generated at least one report for.` }, 404);
  }
  const currentRevision = existing.revision || 1;

  let result;
  try {
    const overrides = await fetchOverrides(kv);
    result = await analyzePatch({ kv, slug: patchId, overrides, logContext: { action, currentRevision }, mergeOnto: existing });
  } catch (err) {
    logPatchIntelEvent({ stage: `${action}_unexpected_error`, slug: patchId, action, currentRevision, error: String((err && err.message) || err) });
    return json({ ok: false, action, patchId, error: `Unexpected error during rescan: ${err && err.message ? err.message : String(err)}` }, 500);
  }

  const revision = await saveReanalysisRevision(kv, patchId, result.report);
  if (revision === null) {
    return json({ ok: false, action, patchId, error: "Failed to save the new revision." }, 500);
  }

  // Deliberately NOT calling setLastKnownSlug and NOT sending any
  // notification -- this is not a newly discovered patch. Whatever
  // revision was already published for this id is completely untouched
  // by everything above.
  return json({
    ok: true,
    action, patchId,
    previousRevision: currentRevision,
    revision,
    status: result.status,
    engineVersion: result.report.engineVersion || null,
    contentFingerprint: result.report.contentFingerprint || null,
    report: { ...result.report, revision },
  });
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

  // "rescan" is the canonical action name; "reanalyze" and
  // "retry-analysis" are accepted as aliases for continuity with older
  // Admin UI builds and existing integrations -- all three run the
  // exact same implementation now that there is no AI call to
  // distinguish "a deliberate fresh look" from "recovering from a
  // failure" (see file header).
  if (body && (body.action === "rescan" || body.action === "reanalyze" || body.action === "retry-analysis")) {
    return handleRescan(context, body);
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
    // and nothing was changed. Only notify on the unattended path -- a
    // manual click already shows this error directly in the Admin UI.
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

  // ROOT-CAUSE FIX (data-loss bug found during an earlier pipeline
  // audit -- unrelated to AI removal, still applies exactly as before):
  // a report can already exist for `latestSlug` even though
  // last-known-slug never advanced to it -- this happens whenever the
  // FIRST detection attempt for a patch failed (source_unavailable,
  // formerly also ai_error), since last-known-slug is only ever
  // advanced below on a successful (pending_review) result. If a LATER
  // "check for new patch" run then re-detects that same
  // still-not-yet-confirmed slug, calling saveNewReport() unconditionally
  // would reset this patch's revision pointer straight back to
  // {latestRevision:1, publishedRevision:null} -- silently discarding
  // every later revision, INCLUDING a currently published one an admin
  // already reviewed and approved. Checking for an existing report
  // first and routing to the same upsert saveReanalysisRevision() uses
  // makes that impossible: nothing this endpoint does can ever destroy
  // a revision that already exists.
  const existingForSlug = await getLatestReport(kv, latestSlug);
  const result = await analyzePatch({ kv, slug: latestSlug, overrides, logContext: { action: "detect", trigger }, mergeOnto: existingForSlug || null });

  const revision = existingForSlug
    ? await saveReanalysisRevision(kv, latestSlug, result.report)
    : (await saveNewReport(kv, result.report)) ? 1 : null;
  result.report.revision = revision;

  if (result.status === "pending_review") {
    // Only advance last-known-slug (and only send the normal new-patch
    // notification) once a real analysis actually succeeded -- a
    // source_unavailable or analysis_error result deliberately leaves
    // last-known-slug untouched, so the NEXT check (manual or
    // scheduled) retries this same slug instead of silently skipping a
    // patch that was never actually analyzed.
    await setLastKnownSlug(kv, latestSlug);
    const notifyResult = await sendPatchNotification({ env, report: result.report, patch: result.report.patch, previousPatch: result.report.previousPatch, adminReviewUrl });
    if (notifyResult.sent && revision) {
      result.report.notifiedAt = new Date().toISOString();
      await updateReportRevision(kv, latestSlug, revision, { notifiedAt: result.report.notifiedAt });
    }
  } else if (trigger === "scheduled") {
    await sendSourceUnavailableNotification({ env, previousPatch: result.report.previousPatch, adminReviewUrl });
  }

  return json({ ok: true, newPatch: true, status: result.status, report: result.report });
}
