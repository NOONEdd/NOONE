// Patch notification -- see functions/api/admin/patch-check.js for where
// this gets called.
//
// IMPORTANT CONTEXT: the feature spec this was built from says to reuse
// "the existing email/notification Worker." This project has no such
// Worker (confirmed by inspecting the uploaded codebase -- no email
// sending, no webhook, no notification code anywhere prior to this
// change). Rather than silently inventing a specific email vendor
// integration (a new paid-service account NOONEdd never asked for and
// might not want), this implements the smallest genuinely
// provider-agnostic option: ONE outbound webhook POST, configured
// entirely through a single optional env var. That single mechanism
// already covers Discord (native webhook support, zero extra setup),
// Slack (native webhook support), Telegram (via a tiny bot-relay
// webhook), ntfy.sh, or a Zapier/Make "catch webhook -> send email"
// automation if email specifically is wanted -- see README for exact
// setup steps for each. This mirrors this codebase's existing
// provider-agnostic pattern (functions/_lib/aiProvider.js) at a much
// smaller scale: one clear contract, any service that speaks it works,
// nothing vendor-specific hard-coded.
//
// Fails open, same posture as rateLimiter.js/passwordAttempts.js: a
// notification that can't be sent (not configured, endpoint down,
// timeout) NEVER blocks or fails patch detection/report generation --
// the report is already safely stored in KV and visible in Admin Patch
// Review regardless of whether this succeeds.

const NOTIFY_TIMEOUT_MS = 5000;

function formatChangeLine(entry, nameField) {
  return `- ${entry[nameField]} (${entry.impactSeverity}): ${entry.whatChanged}`;
}

/** Builds the concise text described in the spec: new patch, previous
 *  patch, the most important Support changes (top few by High severity,
 *  falling back to whatever exists), overall meta take, a tier-change
 *  count, and a link to Admin Patch Review -- NOT the full raw patch
 *  notes (deliberately -- an admin reads the full report in the review
 *  UI; this message is just enough to know it's worth opening). */
function buildMessageText({ report, patch, previousPatch, adminReviewUrl }) {
  const allChanges = [...report.championChanges, ...report.itemChanges, ...report.runeChanges];
  const highlights = allChanges
    .filter((e) => e.impactSeverity === "High")
    .slice(0, 5)
    .map((e) => formatChangeLine(e, e.championName ? "championName" : e.itemName ? "itemName" : "runeName"));

  const lines = [
    `Wild Rift patch ${patch} detected (previously ${previousPatch || "unknown"}) — Patch Intelligence report ready for review.`,
    "",
    report.supportMetaAnalysis || "(No Support meta summary generated.)",
  ];
  if (highlights.length > 0) {
    lines.push("", "Highest-impact changes:", ...highlights);
  }
  if (report.recommendedTierChanges.length > 0) {
    lines.push("", `${report.recommendedTierChanges.length} recommended tier change(s) suggested — nothing applied automatically.`);
  }
  if (adminReviewUrl) {
    lines.push("", `Review: ${adminReviewUrl}`);
  }
  return lines.join("\n");
}

function buildSourceUnavailableText({ previousPatch, adminReviewUrl }) {
  const lines = [
    `Patch Intelligence: a new Wild Rift patch may be available, but the official patch notes page couldn't be retrieved.`,
    `Academy's last known patch was ${previousPatch || "unknown"}. No report was generated and no data was changed.`,
  ];
  if (adminReviewUrl) lines.push("", `Check manually: ${adminReviewUrl}`);
  return lines.join("\n");
}

async function postWebhook(url, text) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      // Both `content` (Discord's field name) and `text` (Slack/most
      // other webhook consumers' field name) carry the identical
      // message -- harmless extra key for whichever service ignores it,
      // and means the SAME payload works unmodified for either without
      // this file needing to know which one NOTIFY_WEBHOOK_URL points
      // at.
      body: JSON.stringify({ content: text, text }),
    });
    return response.ok;
  } catch {
    return false; // network error, timeout, or non-2xx handled above -- always fails open
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Sends the "new report ready" notification. No-ops (returns
 *  {sent:false, reason:"not_configured"}) if NOTIFY_WEBHOOK_URL isn't
 *  set -- this is expected and fine until it's configured; the report
 *  itself is unaffected either way. */
export async function sendPatchNotification({ env, report, patch, previousPatch, adminReviewUrl }) {
  if (!env || !env.NOTIFY_WEBHOOK_URL) return { sent: false, reason: "not_configured" };
  const text = buildMessageText({ report, patch, previousPatch, adminReviewUrl });
  const ok = await postWebhook(env.NOTIFY_WEBHOOK_URL, text);
  return { sent: ok, reason: ok ? null : "delivery_failed" };
}

/** Sent instead of the above when the official source couldn't be
 *  fetched at all (see functions/api/admin/patch-check.js) -- per the
 *  trust-hierarchy requirement to notify the admin rather than silently
 *  doing nothing when Patch Intelligence can't do its job. Only fires
 *  for the SCHEDULED/automatic trigger path, not a manually-clicked
 *  "check now" (which already shows the same failure inline in the
 *  Admin UI immediately, so a duplicate webhook ping adds no value). */
export async function sendSourceUnavailableNotification({ env, previousPatch, adminReviewUrl }) {
  if (!env || !env.NOTIFY_WEBHOOK_URL) return { sent: false, reason: "not_configured" };
  const text = buildSourceUnavailableText({ previousPatch, adminReviewUrl });
  const ok = await postWebhook(env.NOTIFY_WEBHOOK_URL, text);
  return { sent: ok, reason: ok ? null : "delivery_failed" };
}
