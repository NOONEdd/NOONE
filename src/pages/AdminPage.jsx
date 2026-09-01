import { useState, useEffect, useCallback, useRef } from "react";
import { Lock, LogOut, Radar, ChevronDown, ChevronRight, CheckCircle2, XCircle, Send, RefreshCw, AlertTriangle, ExternalLink } from "lucide-react";
import { PatchStatusPill } from "../components/PatchStatus.jsx";
import EntityImage from "../components/EntityImage.jsx";

const SEVERITY_COLOR = { Low: "var(--cyan)", Medium: "var(--gold)", High: "var(--magenta)" };
const CONFIDENCE_COLOR = { Low: "var(--text-dimmer)", Medium: "var(--text-dim)", High: "var(--cyan)" };
const REPORTS_URL = "/api/admin/patch-reports";
const CHECK_URL = "/api/admin/patch-check";

function SeverityChip({ severity }) {
  return <span className="severity-chip" style={{ "--sc": SEVERITY_COLOR[severity] || "var(--text-dimmer)" }}>{severity}</span>;
}
function ConfidenceChip({ confidence }) {
  return <span className="confidence-chip" style={{ "--cc": CONFIDENCE_COLOR[confidence] || "var(--text-dimmer)" }}>Confidence: {confidence}</span>;
}

const STATUS_LABEL = {
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  published: "Published",
  archived: "Archived (older revision)",
  unpublished: "Unpublished",
  source_unavailable: "Source unavailable",
  ai_error: "Analysis failed",
};

/** One champion/item/rune/system change entry. Read-only display of the
 *  extracted fact fields; editMode reveals editable controls for the
 *  judgment-call fields most worth a human correcting (severity,
 *  confidence, recommended tier action, reasoning) -- see AdminPage's
 *  top comment for why the raw extracted facts (whatChanged/previousValue/
 *  newValue/etc.) stay read-only rather than every field being editable.
 *
 *  `entityType`/`roster` are only passed for champion/item/rune entries
 *  (not systemChanges, which have no single resolvable entity --
 *  `nameField="area"` there is a category like "Roaming", not a real
 *  champion/item/rune name) -- see the four call sites below. When
 *  present, renders the same image+fallback-icon pattern the rest of the
 *  site already uses (src/components/EntityImage.jsx), which resolves
 *  the entity live from its name via the same canonical resolver Coach
 *  Mode's build tools use (src/utils/images.js's findCanonicalId()) --
 *  never an AI-supplied id or URL. */
function ChangeEntryCard({ entry, nameField, entityType, roster, editMode, onChange }) {
  const name = entry[nameField];
  return (
    <div className="patch-entry-card">
      <div className="patch-entry-head">
        {entityType && <EntityImage entityType={entityType} entityName={name} roster={roster} />}
        <span className="patch-entry-name">{name}</span>
        <span className="patch-entry-type">{entry.type}</span>
        <SeverityChip severity={entry.impactSeverity} />
      </div>
      {entry.whatChanged && <p className="patch-entry-line"><b>What changed:</b> {entry.whatChanged}</p>}
      {(entry.previousValue || entry.newValue) && (
        <p className="patch-entry-line"><b>Previous → New:</b> {entry.previousValue || "—"} → {entry.newValue || "—"}</p>
      )}
      {entry.supportImpact && <p className="patch-entry-line"><b>Support impact:</b> {entry.supportImpact}</p>}
      {entry.championsAffected && entry.championsAffected.length > 0 && (
        <p className="patch-entry-line"><b>Champions affected:</b> {entry.championsAffected.join(", ")}</p>
      )}
      {entry.gameplayImplications && <p className="patch-entry-line"><b>Gameplay:</b> {entry.gameplayImplications}</p>}
      {entry.buildImplications && <p className="patch-entry-line"><b>Build:</b> {entry.buildImplications}</p>}
      {entry.runeImplications && <p className="patch-entry-line"><b>Runes:</b> {entry.runeImplications}</p>}
      {entry.matchupImplications && <p className="patch-entry-line"><b>Matchups:</b> {entry.matchupImplications}</p>}

      {editMode ? (
        <div className="patch-entry-edit-row">
          <select value={entry.impactSeverity} onChange={(e) => onChange({ ...entry, impactSeverity: e.target.value })}>
            <option value="Low">Severity: Low</option>
            <option value="Medium">Severity: Medium</option>
            <option value="High">Severity: High</option>
          </select>
          <select value={entry.confidence} onChange={(e) => onChange({ ...entry, confidence: e.target.value })}>
            <option value="Low">Confidence: Low</option>
            <option value="Medium">Confidence: Medium</option>
            <option value="High">Confidence: High</option>
          </select>
          <input
            type="text"
            value={entry.recommendedTierAction || ""}
            placeholder="Recommended tier action, e.g. S -> A"
            onChange={(e) => onChange({ ...entry, recommendedTierAction: e.target.value })}
          />
          <textarea
            className="edit-info-field"
            value={entry.reasoning || ""}
            placeholder="Reasoning"
            onChange={(e) => onChange({ ...entry, reasoning: e.target.value })}
          />
        </div>
      ) : (
        <div className="patch-entry-footer">
          <span className="patch-entry-tier-action">{entry.tierListActionNeeded ? `Suggested: ${entry.recommendedTierAction}` : "No tier action suggested"}</span>
          <ConfidenceChip confidence={entry.confidence} />
        </div>
      )}
      {editMode && <p className="patch-entry-reasoning-readonly">{entry.tierListActionNeeded ? "Tier action flagged by AI" : "Not flagged for a tier action"}</p>}
    </div>
  );
}

/** Revision history for one patch -- fetched on demand (only when
 *  expanded) via GET ?id=X&allRevisions=1, never as part of the normal
 *  report load, so a patch that's never been re-analyzed (the common
 *  case) never pays for this extra request. Restoring an older
 *  revision reuses the exact same server-side operation as Publish
 *  (publishRevision() with that revision's number, see
 *  patchReportsStore.js) -- there is no separate restore code path,
 *  just a different revision number in the same request. */
function RevisionHistory({ reportId, onAction, busy, refreshToken }) {
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`${REPORTS_URL}?id=${encodeURIComponent(reportId)}&allRevisions=1`, { credentials: "same-origin" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load revision history");
      setRevisions(data.revisions || []);
    } catch (e) {
      setLoadError(e.message || "Couldn't load revision history.");
    }
  }, [reportId]);

  // Fetches when first expanded, and re-fetches whenever any action
  // completes anywhere in the admin panel WHILE this panel is open
  // (restoring an older revision from right here being the main case --
  // without this, the list would keep showing the pre-restore state
  // indefinitely, since nothing else prompts a re-fetch once it's
  // already open).
  const mounted = useRef(false);
  useEffect(() => {
    if (!open) return;
    if (!mounted.current) { mounted.current = true; load(); return; }
    load();
  }, [open, refreshToken, load]);

  return (
    <div className="revision-history">
      <button type="button" className="btn btn-ghost btn-small" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Revision history
      </button>
      {open && (
        loadError ? <p className="patch-entry-line">{loadError}</p> :
        !revisions ? <p className="patch-entry-line">Loading…</p> :
        revisions.length <= 1 ? <p className="patch-entry-line">No earlier revisions — this patch has only ever been analyzed once.</p> : (
          <ul className="revision-list">
            {revisions.map((rev) => (
              <li key={rev.revision} className="revision-list-item">
                <span>Revision {rev.revision}</span>
                <span className={"patch-report-status status-" + rev.status}>{STATUS_LABEL[rev.status] || rev.status}</span>
                <span className="patch-report-date">{new Date(rev.generatedAt).toLocaleString()}</span>
                {rev.status !== "published" && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Restore revision ${rev.revision}? This will replace whatever is currently published for this patch.`)) {
                        onAction(reportId, "restore", { revision: rev.revision });
                      }
                    }}
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

function ReportCard({ report, onAction, onReanalyze, busy, initiallyExpanded, roster, publishedRevision, refreshToken }) {
  const [expanded, setExpanded] = useState(Boolean(initiallyExpanded));
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState(null);
  const [alsoVerify, setAlsoVerify] = useState(true);

  function startEdit() {
    setDraft({
      supportMetaAnalysis: report.supportMetaAnalysis || "",
      adminNotes: report.adminNotes || "",
      championChanges: report.championChanges || [],
      itemChanges: report.itemChanges || [],
      runeChanges: report.runeChanges || [],
      systemChanges: report.systemChanges || [],
      recommendedTierChanges: report.recommendedTierChanges || [],
    });
    setEditMode(true);
  }

  function updateEntryAt(field, index, updatedEntry) {
    setDraft((prev) => ({ ...prev, [field]: prev[field].map((e, i) => (i === index ? updatedEntry : e)) }));
  }

  const data = editMode && draft ? { ...report, ...draft } : report;

  const isSourceProblem = report.status === "source_unavailable" || report.status === "ai_error";

  return (
    <div className="patch-report-card">
      <button className="patch-report-header" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="patch-report-patch">Patch {report.patch || report.id}</span>
        <span className={"patch-report-status status-" + report.status}>{STATUS_LABEL[report.status] || report.status}</span>
        {report.revision > 1 && <span className="patch-revision-badge">Rev {report.revision}</span>}
        <span className="patch-report-date">{new Date(report.generatedAt).toLocaleString()}</span>
      </button>

      {expanded && publishedRevision && publishedRevision !== report.revision && (
        <p className="patch-entry-line" style={{ padding: "0 20px" }}>
          <AlertTriangle size={14} style={{ verticalAlign: "-2px" }} /> Revision {publishedRevision} is currently the one shown publicly — this is revision {report.revision}. See revision history below to compare or restore.
        </p>
      )}

      {expanded && (
        <div className="patch-report-body">
          {isSourceProblem ? (
            <div>
              <p className="patch-entry-line">
                <AlertTriangle size={14} style={{ verticalAlign: "-2px" }} />{" "}
                {report.status === "source_unavailable"
                  ? "The official patch notes page couldn't be retrieved for this patch. No analysis was generated."
                  : `The AI analyst couldn't produce a usable report: ${report.adminNotes || "unknown error"}`}
              </p>
              <p className="patch-entry-line" style={{ color: "var(--text-dimmer)" }}>
                "Check for New Patch" won't retry this — it only looks for a Riot patch newer than the last one Patch Intelligence already knows about, and this one is already known. Use the button below instead, which re-runs the fetch/analysis for THIS specific patch directly.
              </p>
            </div>
          ) : (
            <>
              {editMode ? (
                <textarea
                  className="edit-info-field"
                  value={data.supportMetaAnalysis}
                  onChange={(e) => setDraft((prev) => ({ ...prev, supportMetaAnalysis: e.target.value }))}
                />
              ) : (
                <p className="patch-meta-analysis">{data.supportMetaAnalysis || "No Support-relevant changes identified."}</p>
              )}

              {data.championChanges.length > 0 && (
                <>
                  <h4 className="patch-section-label">Champions</h4>
                  {data.championChanges.map((e, i) => (
                    <ChangeEntryCard key={i} entry={e} nameField="championName" entityType="champion" roster={roster.champions} editMode={editMode} onChange={(u) => updateEntryAt("championChanges", i, u)} />
                  ))}
                </>
              )}
              {data.itemChanges.length > 0 && (
                <>
                  <h4 className="patch-section-label">Items</h4>
                  {data.itemChanges.map((e, i) => (
                    <ChangeEntryCard key={i} entry={e} nameField="itemName" entityType="item" roster={roster.items} editMode={editMode} onChange={(u) => updateEntryAt("itemChanges", i, u)} />
                  ))}
                </>
              )}
              {data.runeChanges.length > 0 && (
                <>
                  <h4 className="patch-section-label">Runes</h4>
                  {data.runeChanges.map((e, i) => (
                    <ChangeEntryCard key={i} entry={e} nameField="runeName" entityType="rune" roster={roster.runes} editMode={editMode} onChange={(u) => updateEntryAt("runeChanges", i, u)} />
                  ))}
                </>
              )}
              {data.systemChanges.length > 0 && (
                <>
                  <h4 className="patch-section-label">System / Meta</h4>
                  {data.systemChanges.map((e, i) => (
                    <ChangeEntryCard key={i} entry={e} nameField="area" editMode={editMode} onChange={(u) => updateEntryAt("systemChanges", i, u)} />
                  ))}
                </>
              )}
              {data.recommendedTierChanges.length > 0 && (
                <>
                  <h4 className="patch-section-label">Recommended tier changes ({data.recommendedTierChanges.length})</h4>
                  <ul className="patch-tier-rec-list">
                    {data.recommendedTierChanges.map((r, i) => (
                      <li key={i}><b>{r.entityName}</b> ({r.entityType}): {r.from} → {r.to} <ConfidenceChip confidence={r.confidence} /></li>
                    ))}
                  </ul>
                </>
              )}

              {report.sourceUrl && (
                <p className="patch-entry-line">
                  <a href={report.sourceUrl} target="_blank" rel="noopener noreferrer" className="contact-row" style={{ fontSize: 13 }}>
                    Official source <ExternalLink size={12} />
                  </a>
                </p>
              )}
              {(report.aiProvider || report.aiModel) && (
                <p className="patch-entry-line" style={{ color: "var(--text-dimmer)", fontSize: 12.5 }}>
                  Generated by {report.aiProvider || "unknown provider"}{report.aiModel ? ` (${report.aiModel})` : ""} · revision {report.revision || 1}
                </p>
              )}

              <label className="save-note" htmlFor={`notes-${report.id}`}>Admin notes:</label>
              {editMode ? (
                <textarea
                  id={`notes-${report.id}`}
                  className="edit-info-field"
                  value={data.adminNotes}
                  placeholder="Private notes for your own review — never shown publicly"
                  onChange={(e) => setDraft((prev) => ({ ...prev, adminNotes: e.target.value }))}
                />
              ) : (
                <p className="patch-entry-line">{report.adminNotes || "—"}</p>
              )}
            </>
          )}

          <div className="patch-report-actions">
            {!isSourceProblem && !editMode && (
              <button className="btn btn-ghost btn-small" onClick={startEdit} disabled={busy}>Edit</button>
            )}
            {editMode && (
              <>
                <button
                  className="btn btn-primary btn-small"
                  disabled={busy}
                  onClick={() => { onAction(report.id, "edit", { edits: draft }); setEditMode(false); }}
                >
                  Save changes
                </button>
                <button className="btn btn-ghost btn-small" onClick={() => setEditMode(false)} disabled={busy}>Cancel</button>
              </>
            )}
            {!editMode && report.status !== "published" && !isSourceProblem && (
              <>
                <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => onAction(report.id, "approve")}>
                  <CheckCircle2 size={14} /> Approve
                </button>
                <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => onAction(report.id, "reject")}>
                  <XCircle size={14} /> Reject
                </button>
              </>
            )}
            {!editMode && report.status !== "published" && !isSourceProblem && (
              <span className="patch-publish-group">
                <label className="save-note" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={alsoVerify} onChange={(e) => setAlsoVerify(e.target.checked)} />
                  Also mark {report.patch} verified
                </label>
                <button className="btn btn-primary btn-small" disabled={busy || !report.patch} onClick={() => onAction(report.id, "publish", { alsoMarkVerified: alsoVerify })}>
                  <Send size={14} /> Publish
                </button>
              </span>
            )}
            {!editMode && report.status === "published" && (
              <>
                <button
                  className="btn btn-ghost btn-small"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Re-analyze patch ${report.patch || report.id}? This runs a fresh AI analysis (uses AI/API credits) and creates a new revision pending your review — the currently published version stays live until you publish the new one.`)) {
                      onReanalyze(report.id, "reanalyze");
                    }
                  }}
                >
                  <RefreshCw size={14} /> Re-analyze
                </button>
                <button
                  className="btn btn-ghost btn-small"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Unpublish patch ${report.patch || report.id}? It will disappear from the public Patch Intelligence page immediately. The report itself is kept and can be published again later.`)) {
                      onAction(report.id, "unpublish");
                    }
                  }}
                >
                  <XCircle size={14} /> Unpublish
                </button>
              </>
            )}
            {!editMode && isSourceProblem && (
              <button
                className="btn btn-primary btn-small"
                disabled={busy}
                onClick={() => {
                  const label = report.status === "source_unavailable" ? "Retry Source Fetch" : "Retry Analysis";
                  if (window.confirm(`${label} for patch ${report.patch || report.id}? This fetches the official patch notes again and runs a fresh AI analysis (uses AI/API credits) as a new revision pending your review.`)) {
                    onReanalyze(report.id, "retry-analysis");
                  }
                }}
              >
                <RefreshCw size={14} /> {report.status === "source_unavailable" ? "Retry Source Fetch" : "Retry Analysis"}
              </button>
            )}
          </div>

          <RevisionHistory reportId={report.id} onAction={onAction} busy={busy} refreshToken={refreshToken} />
        </div>
      )}
    </div>
  );
}

export default function AdminPage({ auth, currentPatch, onUpdatePatch, patchStatus, patchVerification, champions, items, runes }) {
  const [passwordInput, setPasswordInput] = useState("");
  const [loginError, setLoginError] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const [reports, setReports] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [patchInput, setPatchInput] = useState(currentPatch || "");

  useEffect(() => { setPatchInput(currentPatch || ""); }, [currentPatch]);

  const loadReports = useCallback(async () => {
    try {
      const res = await fetch(REPORTS_URL, { credentials: "same-origin" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load reports");
      setReports(data.reports || []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e.message || "Couldn't load Patch Intelligence reports.");
    }
  }, []);

  useEffect(() => {
    if (auth?.isAuthorized) loadReports();
  }, [auth?.isAuthorized, loadReports]);

  async function handleLogin(e) {
    e.preventDefault();
    setVerifying(true);
    setLoginError(null);
    const result = await auth.verify(passwordInput);
    setVerifying(false);
    if (result.ok) {
      setPasswordInput("");
    } else {
      setLoginError(result.error);
    }
  }

  async function handleCheckNow() {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch(CHECK_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual" }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setCheckResult({ ok: false, message: data.error || "Check failed." });
      } else if (!data.newPatch) {
        setCheckResult({ ok: true, message: `No new patch — still on ${data.currentSlug}.` });
      } else if (data.status === "pending_review") {
        setCheckResult({ ok: true, message: `New patch detected: ${data.report.patch}. Report generated below.` });
      } else if (data.status === "source_unavailable") {
        setCheckResult({ ok: false, message: "A new patch was detected but its official notes page couldn't be fetched. A report was created below — use its \"Retry Source Fetch\" button once the source is reachable, not this button again (this one only looks for a newer patch, which won't exist yet)." });
      } else if (data.status === "ai_error") {
        setCheckResult({ ok: false, message: `A new patch was found but analysis failed: ${data.aiError || "unknown error"}. A report was created below — use its "Retry Analysis" button to try again, not this button again (this one only looks for a newer patch than ${data.report.patch}, which won't exist yet).` });
      }
      await loadReports();
    } catch {
      setCheckResult({ ok: false, message: "Couldn't reach the patch-check endpoint." });
    } finally {
      setChecking(false);
    }
  }

  async function handleAction(id, action, extra = {}) {
    setBusyId(id);
    try {
      const res = await fetch(REPORTS_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      await loadReports();
      setRefreshToken((t) => t + 1);
    } catch (e) {
      setLoadError(e.message || "Action failed.");
    } finally {
      setBusyId(null);
    }
  }

  /** ROOT CAUSE of "Re-analyze doesn't appear to do anything": each
   *  expanded report card's full body is loaded and cached in
   *  ReportCardLoader's own local state (`full`), keyed by report id.
   *  Re-analyze doesn't change that id -- it's still the same patch --
   *  so React reuses the SAME component instance (same `key`) after
   *  loadReports() refreshes the summary list, and that instance's
   *  already-set `full` state is untouched by a prop update. The card
   *  kept rendering revision 1's cached content forever, even though
   *  revision 2 was correctly created on the server the whole time
   *  (confirmed independently via the backend test suite in tests/
   *  patchIntelReanalyze.test.mjs, which talks to the real handlers
   *  directly and has no React tree to go stale in). `refreshToken`
   *  fixes this generically: every already-loaded card refetches its
   *  full body whenever ANY action completes, not just the one that was
   *  acted on -- see ReportCardLoader's effect below. */
  async function handleReanalyze(patchId, action = "reanalyze") {
    setBusyId(patchId);
    setCheckResult(null);
    const verb = action === "retry-analysis" ? "Retry" : "Re-analysis";
    try {
      const res = await fetch(CHECK_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, patchId }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || `${verb} failed`);
      if (data.success === false) {
        // A new revision WAS created (for debugging/history), but the
        // actual AI analysis failed -- this must read as a failure, not
        // "re-analysis complete." See functions/api/admin/patch-check.js's
        // handleReanalyze doc comment for the ok-vs-success distinction.
        setCheckResult({ ok: false, message: `${verb} ran but did not produce a usable result (revision ${data.revision}, ${STATUS_LABEL[data.status] || data.status}): ${data.aiError || "unknown error"}. ${action === "retry-analysis" ? "You can press Retry again." : "The published version is unchanged."}` });
      } else {
        setCheckResult({ ok: true, message: `${verb} complete: revision ${data.revision} (${STATUS_LABEL[data.status] || data.status}) is ready for review. The published version is unchanged until you publish it.` });
      }
      await loadReports();
      setRefreshToken((t) => t + 1);
    } catch (e) {
      setLoadError(e.message || `${verb} failed.`);
    } finally {
      setBusyId(null);
    }
  }

  if (!auth?.isAuthorized) {
    return (
      <section className="page-section">
        <div className="wrap" style={{ maxWidth: 420 }}>
          <div className="section-head">
            <div className="eyebrow"><span className="dot" />Private Area</div>
            <h2>NOONEdd Academy — Admin</h2>
            <p>Sign in to manage Coach Mode content and review Patch Intelligence reports.</p>
          </div>
          <form className="admin-login-form" onSubmit={handleLogin}>
            <label htmlFor="admin-password" className="save-note">Admin password</label>
            <input
              id="admin-password"
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              autoFocus
              placeholder="••••••••"
            />
            <button type="submit" className="btn btn-primary" disabled={verifying || !passwordInput} style={{ width: "100%", justifyContent: "center" }}>
              <Lock size={15} /> {verifying ? "Checking..." : "Sign in"}
            </button>
            {loginError && <span className="coach-password-error">{loginError}</span>}
          </form>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section">
      <div className="wrap">
        <div className="section-head" style={{ marginBottom: 30 }}>
          <div className="eyebrow"><span className="dot" />Private Area</div>
          <h2>Admin</h2>
          <p>Patch status, Patch Intelligence detection, and review — Coach Mode content editing still happens in place on the public pages.</p>
        </div>

        <div className="admin-panel">
          <div className="admin-panel-head">
            <h3>Patch status</h3>
            <button className="btn btn-ghost btn-small" onClick={auth.logout}><LogOut size={14} /> Log out</button>
          </div>
          <div className="patch-editor-row coach-password-prompt">
            <label htmlFor="admin-patch-input" className="save-note">Current patch:</label>
            <input id="admin-patch-input" type="text" value={patchInput} onChange={(e) => { setPatchInput(e.target.value); onUpdatePatch?.(e.target.value); }} placeholder="e.g. 7.3" />
            <PatchStatusPill status={patchStatus} />
            <div className="patch-verify-actions">
              <button className="btn btn-ghost btn-small" disabled={!patchInput || patchStatus === "verified"} onClick={() => patchVerification.markVerified(patchInput)}>Mark verified</button>
              <button className={"btn btn-ghost btn-small" + (patchStatus === "updating" ? " is-active" : "")} onClick={() => patchVerification.setUpdating(patchStatus !== "updating")}>
                {patchStatus === "updating" ? "Updating: On" : "Mark as updating"}
              </button>
            </div>
          </div>
        </div>

        <div className="admin-panel">
          <div className="admin-panel-head">
            <h3>Patch Intelligence</h3>
            <button className="btn btn-primary btn-small" onClick={handleCheckNow} disabled={checking}>
              <Radar size={14} className={checking ? "spin" : ""} /> {checking ? "Checking..." : "Check for new patch now"}
            </button>
          </div>
          <p className="patch-entry-line" style={{ color: "var(--text-dimmer)", marginTop: -8, marginBottom: 12 }}>
            Looks for a Riot patch newer than the last one processed — it will report "no new patch" if the latest is already known, even if that patch's own analysis failed. To re-run analysis for an existing patch (new or failed), use that report's own Re-analyze / Retry Analysis button below instead.
          </p>
          {checkResult && (
            <p className={checkResult.ok ? "save-note" : "coach-password-error"} style={{ marginBottom: 16 }}>{checkResult.message}</p>
          )}

          {loadError && <p className="coach-password-error">{loadError}</p>}
          {reports === null && !loadError && <p className="storage-note">Loading reports…</p>}
          {reports && reports.length === 0 && <p className="storage-note">No Patch Intelligence reports yet — click "Check for new patch now," or wait for the next scheduled check (see README).</p>}

          {reports && reports.length > 0 && (
            <div className="patch-report-list">
              {reports.map((summary) => (
                <ReportCardLoader key={summary.id} id={summary.id} summary={summary} onAction={handleAction} onReanalyze={handleReanalyze} busy={busyId === summary.id} roster={{ champions, items, runes }} refreshToken={refreshToken} />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** GET /api/admin/patch-reports only returns lightweight summaries in
 *  its list response (see functions/_lib/patchReportsStore.js's
 *  listAllReports) -- this fetches the ONE full report body lazily,
 *  only for whichever card the admin actually expands, rather than the
 *  list view pulling every report's full analysis up front. */
function ReportCardLoader({ id, summary, onAction, onReanalyze, busy, roster, refreshToken }) {
  const [full, setFull] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${REPORTS_URL}?id=${encodeURIComponent(id)}`, { credentials: "same-origin" });
      const data = await res.json();
      if (res.ok) setFull(data.report);
    } finally {
      setLoading(false);
    }
  }, [id]);

  function ensureLoaded() {
    if (full || loading) return;
    load();
  }

  // Re-fetches this card's full body after any mutation completes
  // elsewhere in the admin panel (see handleAction/handleReanalyze's
  // refreshToken bump in the parent) -- but ONLY if this card is
  // already expanded/loaded. Skipped on first mount (refreshToken
  // starts at 0 and this card may not even be loaded yet) so a
  // page-load doesn't trigger a redundant extra fetch on top of
  // ensureLoaded's own.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    if (full) load();
  }, [refreshToken, load]);

  if (!full) {
    return (
      <div className="patch-report-card">
        <button className="patch-report-header" onClick={ensureLoaded}>
          <ChevronRight size={16} />
          <span className="patch-report-patch">Patch {summary.patch || summary.id}</span>
          <span className={"patch-report-status status-" + summary.status}>{STATUS_LABEL[summary.status] || summary.status}</span>
          {summary.latestRevision > 1 && <span className="patch-revision-badge">Rev {summary.latestRevision}</span>}
          <span className="patch-report-date">{loading ? "Loading…" : new Date(summary.generatedAt).toLocaleString()}</span>
        </button>
      </div>
    );
  }
  return <ReportCard report={full} onAction={onAction} onReanalyze={onReanalyze} busy={busy} initiallyExpanded roster={roster} publishedRevision={summary.publishedRevision} refreshToken={refreshToken} />;
}
