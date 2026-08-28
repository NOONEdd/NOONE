// Cloudflare Pages Function — POST /api/admin/patch-check
//
// The detection + generation step of Patch Intelligence. Two ways to
// call it:
//   - An authenticated admin session (the "Check for new patch now"
//     button in src/pages/AdminPage.jsx) -- body { trigger: "manual" }.
//   - A shared-secret header, for unattended scheduling -- see README's
//     "Automatic patch detection" section for why this project needs
//     either a small companion Worker with a Cron Trigger or a free
//     external scheduler here, and exactly how to wire either one up --
//     body { trigger: "scheduled" }, header
//     `X-Patch-Check-Secret: <PATCH_CHECK_SECRET>`.
// Anything else (no session, no/wrong secret) gets 401, same as any
// other admin-mutation endpoint -- this never runs unauthenticated.
//
// Flow (mirrors the spec this was built from, step by step):
//   1. Discover Riot's latest published patch slug (reuses
//      riotFallback.js's existing discovery + its existing cache --
//      does NOT re-implement or duplicate that scraping logic).
//   2. Compare against the last slug Patch Intelligence already
//      processed. Identical -> stop here. No AI call, no new report, no
//      notification -- exactly the spec's "if no new patch: do nothing"
//      requirement.
//   3. Different -> fetch the FULL official patch content. If that
//      fetch fails, store an honest "source_unavailable" report (kept
//      keyed to the real slug we DID discover) and notify -- never
//      fabricate a report from a page we couldn't actually read, and
//      never silently update last-known-slug for a patch we never
//      actually analyzed (so the next check retries the content fetch
//      instead of treating it as already handled).
//   4. Fetch succeeded -> run the AI analysis (patchIntelligence.js),
//      store the resulting report as "pending_review", update
//      last-known-slug, notify.
// Public Academy data (overrides.champions/items/runes/decisionTrees,
// and even overrides.patch/verifiedPatch) is NEVER touched by this
// endpoint -- only functions/api/admin/patch-reports.js's "publish"
// action can ever change those, and only after a human looks at the
// report this endpoint produced.

import { requireAdminSession, hasValidPatchCheckSecret } from "../../_lib/adminAuth.js";
import { discoverLatestPatchSlug, fetchAndCacheFullPatchContent, extractPatchNumberFromContent } from "../../_lib/riotFallback.js";
import { runPatchIntelAnalysis } from "../../_lib/patchIntelligence.js";
import { saveReport, getLastKnownSlug, setLastKnownSlug } from "../../_lib/patchReportsStore.js";
import { sendPatchNotification, sendSourceUnavailableNotification } from "../../_lib/notify.js";
import { resolveActiveProviderAndModel } from "../../_lib/aiProvider.js";
import { fetchOverrides } from "../../_lib/kv.js";
import { logPatchIntelEvent } from "../../_lib/logger.js";
import { resolveEffectiveChampion, resolveEffectiveItem, resolveEffectiveRune, resolveEffectivePatch } from "../../../src/lib/effectiveData.js";
import { CHAMPIONS } from "../../../src/data/champions.js";
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

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.COACH_KV;
  if (!kv) {
    return json({ ok: false, code: "kv_not_configured", error: "COACH_KV binding not set up yet." }, 500);
  }

  const isAdmin = await requireAdminSession(context);
  const isScheduled = !isAdmin && hasValidPatchCheckSecret(request, env);
  if (!isAdmin && !isScheduled) {
    return json({ ok: false, code: "unauthorized", error: "Not authenticated." }, 401);
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    // no body / not JSON is fine -- trigger just defaults below
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
  const previousPatch = resolveEffectivePatch(overrides.patch, STATIC_PATCH_VERSION);

  const contentResult = await fetchAndCacheFullPatchContent(latestSlug, kv);
  if (!contentResult.found) {
    const report = {
      id: latestSlug,
      patch: null,
      patchNumberSource: null,
      previousPatch,
      status: "source_unavailable",
      generatedAt: new Date().toISOString(),
      sourceUrl: null,
      sourceAvailable: false,
      aiProvider: null,
      aiModel: null,
      championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [],
      supportMetaAnalysis: "",
      recommendedTierChanges: [],
      sourceReferences: [],
      adminNotes: "",
      reviewedBy: null,
      reviewedAt: null,
      notifiedAt: null,
    };
    await saveReport(kv, report);
    // Deliberately NOT calling setLastKnownSlug here -- this patch was
    // detected but never actually analyzed, so the next check (manual
    // or scheduled) should retry fetching its content rather than
    // treating it as already handled.
    if (trigger === "scheduled") {
      await sendSourceUnavailableNotification({ env, previousPatch, adminReviewUrl });
    }
    return json({ ok: true, newPatch: true, status: "source_unavailable", report });
  }

  const { patchNumber, source: patchNumberSource } = extractPatchNumberFromContent(contentResult.content, latestSlug);

  const championRoster = CHAMPIONS.map((c) => resolveEffectiveChampion(c, overrides.champions[c.id], MATCHUPS[c.id]));
  const itemRoster = ITEMS.map((i) => resolveEffectiveItem(i, overrides.items[i.id]));
  const runeRoster = RUNES.map((r) => resolveEffectiveRune(r, overrides.runes[r.id]));

  const { provider: aiProvider, model: aiModel } = resolveActiveProviderAndModel(env);
  const analysis = await runPatchIntelAnalysis({ env, patchContent: contentResult.content, championRoster, itemRoster, runeRoster });

  if (!analysis.ok) {
    // Surfaced in two places, both safe/bounded (see patchIntelligence.js
    // and the two provider adapters -- logDetail never contains an API
    // key, password, or session token, only reply length/finish-reason/
    // a truncated raw-reply snippet or a parse-error message):
    //   1. Cloudflare's real-time Function logs, for deep debugging.
    //   2. The report's own adminNotes, so the failure reason is visible
    //      directly in the Admin UI without needing separate log access.
    // Previously this diagnostic detail was computed by
    // patchIntelligence.js but discarded here entirely -- the Admin UI
    // only ever showed the generic top-level error message, with no way
    // to tell "truncated output" apart from "the model wrote prose
    // around the JSON" apart from "the provider returned something else
    // entirely." That gap, not the parser itself, was the main reason
    // this failure was hard to diagnose.
    logPatchIntelEvent({ stage: "analysis_failed", slug: latestSlug, provider: aiProvider, model: aiModel, code: analysis.code, detail: analysis.logDetail, tokenBudget: analysis.tokenBudget });

    const report = {
      id: latestSlug,
      patch: patchNumber,
      patchNumberSource,
      previousPatch,
      status: "ai_error",
      generatedAt: new Date().toISOString(),
      sourceUrl: contentResult.source,
      sourceAvailable: true,
      aiProvider,
      aiModel,
      championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [],
      supportMetaAnalysis: "",
      recommendedTierChanges: [],
      sourceReferences: [contentResult.source].filter(Boolean),
      adminNotes: `[${analysis.code}] ${analysis.error || ""}${analysis.logDetail ? `\n\nDiagnostic detail: ${analysis.logDetail}` : ""}`,
      reviewedBy: null,
      reviewedAt: null,
      notifiedAt: null,
    };
    await saveReport(kv, report);
    // last-known-slug still not advanced -- same reasoning as the
    // source_unavailable branch: we found the patch but don't yet have
    // a real analysis of it, so a retry should try again, not skip it.
    if (trigger === "scheduled") {
      await sendSourceUnavailableNotification({ env, previousPatch, adminReviewUrl });
    }
    return json({ ok: true, newPatch: true, status: "ai_error", report, aiError: analysis.error, aiErrorCode: analysis.code });
  }

  const report = {
    id: latestSlug,
    patch: patchNumber,
    patchNumberSource,
    previousPatch,
    status: "pending_review",
    generatedAt: new Date().toISOString(),
    sourceUrl: contentResult.source,
    sourceAvailable: true,
    aiProvider,
    aiModel,
    ...analysis.report,
    sourceReferences: [contentResult.source].filter(Boolean),
    adminNotes: "",
    reviewedBy: null,
    reviewedAt: null,
    notifiedAt: null,
  };

  // tokenBudget carries the adaptive-budget diagnostics from
  // estimatePatchIntelTokenBudget() (functions/_lib/patchIntelligence.js) --
  // estimated entry count and the resulting maxTokens actually used for
  // THIS patch, safe to log (no secrets, just counts/numbers).
  logPatchIntelEvent({ stage: "analysis_succeeded", slug: latestSlug, provider: aiProvider, model: aiModel, parseStrategy: analysis.parseStrategy, championChanges: report.championChanges.length, itemChanges: report.itemChanges.length, runeChanges: report.runeChanges.length, systemChanges: report.systemChanges.length, tokenBudget: analysis.tokenBudget });

  await saveReport(kv, report);
  await setLastKnownSlug(kv, latestSlug);

  const notifyResult = await sendPatchNotification({ env, report, patch: patchNumber, previousPatch, adminReviewUrl });
  if (notifyResult.sent) {
    report.notifiedAt = new Date().toISOString();
    await saveReport(kv, report);
  }

  return json({ ok: true, newPatch: true, status: "pending_review", report });
}
