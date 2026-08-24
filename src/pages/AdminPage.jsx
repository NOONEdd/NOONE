import { useState, useEffect, useCallback } from "react";
import { Lock, LogOut, Radar, ChevronDown, ChevronRight, CheckCircle2, XCircle, Send, RefreshCw, AlertTriangle, ExternalLink } from "lucide-react";
import { PatchStatusPill } from "../components/PatchStatus.jsx";

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
  source_unavailable: "Source unavailable",
  ai_error: "Analysis failed",
};

/** One champion/item/rune/system change entry. Read-only display of the
 *  extracted fact fields; editMode reveals editable controls for the
 *  judgment-call fields most worth a human correcting (severity,
 *  confidence, recommended tier action, reasoning) -- see AdminPage's
 *  top comment for why the raw extracted facts (whatChanged/previousValue/
 *  newValue/etc.) stay read-only rather than every field being editable. */
function ChangeEntryCard({ entry, nameField, editMode, onChange }) {
  const name = entry[nameField];
  return (
    <div className="patch-entry-card">
      <div className="patch-entry-head">
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

function ReportCard({ report, onAction, busy, initiallyExpanded }) {
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
        <span className="patch-report-date">{new Date(report.generatedAt).toLocaleString()}</span>
      </button>

      {expanded && (
        <div className="patch-report-body">
          {isSourceProblem ? (
            <p className="patch-entry-line">
              <AlertTriangle size={14} style={{ verticalAlign: "-2px" }} />{" "}
              {report.status === "source_unavailable"
                ? "The official patch notes page couldn't be retrieved for this patch. No analysis was generated."
                : `The AI analyst couldn't produce a usable report: ${report.adminNotes || "unknown error"}`}
              {" "}Use "Check for new patch now" above to retry.
            </p>
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
                    <ChangeEntryCard key={i} entry={e} nameField="championName" editMode={editMode} onChange={(u) => updateEntryAt("championChanges", i, u)} />
                  ))}
                </>
              )}
              {data.itemChanges.length > 0 && (
                <>
                  <h4 className="patch-section-label">Items</h4>
                  {data.itemChanges.map((e, i) => (
                    <ChangeEntryCard key={i} entry={e} nameField="itemName" editMode={editMode} onChange={(u) => updateEntryAt("itemChanges", i, u)} />
                  ))}
                </>
              )}
              {data.runeChanges.length > 0 && (
                <>
                  <h4 className="patch-section-label">Runes</h4>
                  {data.runeChanges.map((e, i) => (
                    <ChangeEntryCard key={i} entry={e} nameField="runeName" editMode={editMode} onChange={(u) => updateEntryAt("runeChanges", i, u)} />
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
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPage({ auth, currentPatch, onUpdatePatch, patchStatus, patchVerification }) {
  const [passwordInput, setPasswordInput] = useState("");
  const [loginError, setLoginError] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const [reports, setReports] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [busyId, setBusyId] = useState(null);
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
        setCheckResult({ ok: false, message: "A new patch was detected but its official notes page couldn't be fetched. Try again shortly." });
      } else if (data.status === "ai_error") {
        setCheckResult({ ok: false, message: `A new patch was found but analysis failed: ${data.aiError || "unknown error"}` });
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
    } catch (e) {
      setLoadError(e.message || "Action failed.");
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
          {checkResult && (
            <p className={checkResult.ok ? "save-note" : "coach-password-error"} style={{ marginBottom: 16 }}>{checkResult.message}</p>
          )}

          {loadError && <p className="coach-password-error">{loadError}</p>}
          {reports === null && !loadError && <p className="storage-note">Loading reports…</p>}
          {reports && reports.length === 0 && <p className="storage-note">No Patch Intelligence reports yet — click "Check for new patch now," or wait for the next scheduled check (see README).</p>}

          {reports && reports.length > 0 && (
            <div className="patch-report-list">
              {reports.map((summary) => (
                <ReportCardLoader key={summary.id} id={summary.id} summary={summary} onAction={handleAction} busy={busyId === summary.id} />
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
function ReportCardLoader({ id, summary, onAction, busy }) {
  const [full, setFull] = useState(null);
  const [loading, setLoading] = useState(false);

  async function ensureLoaded() {
    if (full || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`${REPORTS_URL}?id=${encodeURIComponent(id)}`, { credentials: "same-origin" });
      const data = await res.json();
      if (res.ok) setFull(data.report);
    } finally {
      setLoading(false);
    }
  }

  if (!full) {
    return (
      <div className="patch-report-card">
        <button className="patch-report-header" onClick={ensureLoaded}>
          <ChevronRight size={16} />
          <span className="patch-report-patch">Patch {summary.patch || summary.id}</span>
          <span className={"patch-report-status status-" + summary.status}>{STATUS_LABEL[summary.status] || summary.status}</span>
          <span className="patch-report-date">{loading ? "Loading…" : new Date(summary.generatedAt).toLocaleString()}</span>
        </button>
      </div>
    );
  }
  return <ReportCard report={full} onAction={onAction} busy={busy} initiallyExpanded />;
}
