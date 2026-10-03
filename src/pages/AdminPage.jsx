import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Lock, LogOut, Radar, ChevronDown, ChevronRight, CheckCircle2, XCircle, Send, RefreshCw, AlertTriangle, ExternalLink, Download, Database, Trash2 } from "lucide-react";
import { PatchStatusPill } from "../components/PatchStatus.jsx";
import EntityImage from "../components/EntityImage.jsx";
import PatchNotesReview from "../components/PatchNotesReview.jsx";
import { buildPatchSummary } from "../lib/patchNotesPresentation.js";
import { planBuildTypeMigration, verifyAllEntriesTyped } from "../lib/buildTypeClassifier.js";

const SEVERITY_COLOR = { Low: "var(--cyan)", Medium: "var(--gold)", High: "var(--magenta)" };
const CONFIDENCE_COLOR = { Low: "var(--text-dimmer)", Medium: "var(--text-dim)", High: "var(--cyan)" };
const REPORTS_URL = "/api/admin/patch-reports";
const CHECK_URL = "/api/admin/patch-check";
const KV_SAFETY_URL = "/api/admin/coach-overrides-backups";

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
  analysis_error: "Analysis error",
  // ai_error/partial_failure can no longer be produced by a NEW report
  // (there is no AI call left to fail or leave partial) -- kept mapped
  // here only so a historical report saved before this rebuild still
  // displays a real label instead of raw status text.
  ai_error: "Analysis failed (historical)",
  partial_failure: "Incomplete (historical)",
};

// Mirrors PUBLISHABLE_STATUSES in functions/api/admin/patch-reports.js: the
// server refuses to publish/restore any other status, so the buttons below
// are only enabled for these. "published" is excluded here only because the
// button is hidden for an already-published revision.
const PUBLISHABLE_STATUSES = new Set(["approved", "unpublished", "archived"]);

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
      {(entry.comparisonState || entry.relevance) && (
        // The Riot fact itself, always visible beside the Coach's own
        // fields below -- so writing an analysis never requires
        // re-reading the whole patch page. comparisonState is about how
        // much weight the value pair carries against Academy's own data
        // (see patchChangeDetector.js's COMPARISON_STATE); relevance is
        // a structural Support-focused classification (CORE/VIABLE/
        // SITUATIONAL), not a judgment on the change's content.
        <p className="patch-entry-line" style={{ color: "var(--text-dimmer)" }}>
          <b>Riot fact:</b> {entry.relevance || "—"} · {entry.comparisonState || "—"}
          {entry.academyDataFlag ? <> · Academy's own data may be stale: {entry.academyDataFlag.reason || "check manually"}</> : null}
        </p>
      )}
      {entry.sourceRaw && <p className="patch-entry-line" style={{ color: "var(--text-dimmer)", fontStyle: "italic" }}>“{entry.sourceRaw}”</p>}
      {entry.supportImpact && <p className="patch-entry-line"><b>Support impact:</b> {entry.supportImpact}</p>}
      {entry.championsAffected && entry.championsAffected.length > 0 && (
        <p className="patch-entry-line"><b>Champions affected:</b> {entry.championsAffected.join(", ")}</p>
      )}
      {entry.gameplayImplications && <p className="patch-entry-line"><b>Gameplay:</b> {entry.gameplayImplications}</p>}
      {entry.buildImplications && <p className="patch-entry-line"><b>Build:</b> {entry.buildImplications}</p>}
      {entry.runeImplications && <p className="patch-entry-line"><b>Runes:</b> {entry.runeImplications}</p>}
      {entry.matchupImplications && <p className="patch-entry-line"><b>Matchups:</b> {entry.matchupImplications}</p>}
      {entry.laneImpact && <p className="patch-entry-line"><b>Lane:</b> {entry.laneImpact}</p>}
      {entry.roamImpact && <p className="patch-entry-line"><b>Roaming/macro:</b> {entry.roamImpact}</p>}
      {entry.teamfightImpact && <p className="patch-entry-line"><b>Teamfight:</b> {entry.teamfightImpact}</p>}
      {entry.objectiveVisionImpact && <p className="patch-entry-line"><b>Objective/vision:</b> {entry.objectiveVisionImpact}</p>}
      {entry.decisionChange && <p className="patch-entry-line"><b>Decision change:</b> {entry.decisionChange}</p>}
      {entry.coachNotes && <p className="patch-entry-line"><b>Coach notes:</b> {entry.coachNotes}</p>}

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
          <label className="patch-entry-checkbox">
            <input type="checkbox" checked={Boolean(entry.tierListActionNeeded)} onChange={(e) => onChange({ ...entry, tierListActionNeeded: e.target.checked })} />
            Needs a tier list action
          </label>
          <textarea className="edit-info-field" value={entry.supportImpact || ""} placeholder="Support impact" onChange={(e) => onChange({ ...entry, supportImpact: e.target.value })} />
          <textarea className="edit-info-field" value={entry.gameplayImplications || ""} placeholder="Gameplay impact" onChange={(e) => onChange({ ...entry, gameplayImplications: e.target.value })} />
          <textarea className="edit-info-field" value={entry.buildImplications || ""} placeholder="Itemization / build impact" onChange={(e) => onChange({ ...entry, buildImplications: e.target.value })} />
          <textarea className="edit-info-field" value={entry.laneImpact || ""} placeholder="Lane impact" onChange={(e) => onChange({ ...entry, laneImpact: e.target.value })} />
          <textarea className="edit-info-field" value={entry.roamImpact || ""} placeholder="Roaming / macro impact" onChange={(e) => onChange({ ...entry, roamImpact: e.target.value })} />
          <textarea className="edit-info-field" value={entry.teamfightImpact || ""} placeholder="Teamfight impact" onChange={(e) => onChange({ ...entry, teamfightImpact: e.target.value })} />
          <textarea className="edit-info-field" value={entry.objectiveVisionImpact || ""} placeholder="Objective / vision impact" onChange={(e) => onChange({ ...entry, objectiveVisionImpact: e.target.value })} />
          <textarea className="edit-info-field" value={entry.decisionChange || ""} placeholder="Recommended decision change" onChange={(e) => onChange({ ...entry, decisionChange: e.target.value })} />
          <textarea
            className="edit-info-field"
            value={entry.reasoning || ""}
            placeholder="Reasoning"
            onChange={(e) => onChange({ ...entry, reasoning: e.target.value })}
          />
          <textarea className="edit-info-field" value={entry.coachNotes || ""} placeholder="Coach notes" onChange={(e) => onChange({ ...entry, coachNotes: e.target.value })} />
        </div>
      ) : (
        <div className="patch-entry-footer">
          <span className="patch-entry-tier-action">{entry.tierListActionNeeded ? `Suggested: ${entry.recommendedTierAction}` : "No tier action suggested"}</span>
          <ConfidenceChip confidence={entry.confidence} />
        </div>
      )}
      {editMode && <p className="patch-entry-reasoning-readonly">{entry.tierListActionNeeded ? "Tier action needed (set above)" : "Not flagged for a tier action"}</p>}
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
// KV Data Protection panel -- the Admin-facing half of the safety layer
// in functions/_lib/kvSafety.js. Shows the live coach-overrides
// revision/size/checksum, whether emergency read-only mode is active,
// and the available backups (each restorable, one click plus confirm).
// Every restore itself creates a fresh backup of whatever was live
// first -- see that file's header comment -- this panel never bypasses
// that. Self-contained: fetches its own data, matching RevisionHistory
// above rather than threading more state through AdminPage itself.
function KvSafetyPanel() {
  const [open, setOpen] = useState(true);
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [showAudit, setShowAudit] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(KV_SAFETY_URL, { credentials: "same-origin" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to load KV status");
      setData(body);
    } catch (e) {
      setLoadError(e.message || "Couldn't load KV status.");
    }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  async function handleRestore(backup) {
    if (!window.confirm(`Restore the backup from ${new Date(backup.timestamp).toLocaleString()} (operation: ${backup.operation}, ${backup.size} bytes)? Whatever is live right now will itself be backed up first, then replaced with this.`)) return;
    setBusy(true); setActionError(null);
    try {
      const res = await fetch(KV_SAFETY_URL, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", backupKey: backup.key }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        if (body.code === "KV_WRITE_BLOCKED_SUSPICIOUS_DATA_CHANGE" && window.confirm(`${body.error}\n\nRestore anyway?`)) {
          const forced = await fetch(KV_SAFETY_URL, {
            method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "restore", backupKey: backup.key, force: true }),
          });
          const forcedBody = await forced.json();
          if (!forced.ok || !forcedBody.ok) throw new Error(forcedBody.error || "Restore failed.");
        } else if (body.code !== "KV_WRITE_BLOCKED_SUSPICIOUS_DATA_CHANGE") {
          throw new Error(body.error || "Restore failed.");
        } else {
          setBusy(false);
          return; // admin declined the forced restore
        }
      }
      await load();
    } catch (e) {
      setActionError(e.message || "Restore failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleClearReadOnly() {
    setBusy(true); setActionError(null);
    try {
      const res = await fetch(KV_SAFETY_URL, {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear-readonly" }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error || "Couldn't clear read-only mode.");
      await load();
    } catch (e) {
      setActionError(e.message || "Couldn't clear read-only mode.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel-head">
        <h3><Database size={15} style={{ verticalAlign: -2, marginRight: 6 }} />KV data protection</h3>
        <button type="button" className="btn btn-ghost btn-small" onClick={load} disabled={busy}><RefreshCw size={14} /> Refresh</button>
      </div>

      {loadError && <p className="patch-entry-line" style={{ color: "var(--magenta)" }}>{loadError}</p>}
      {actionError && <p className="patch-entry-line" style={{ color: "var(--magenta)" }}>{actionError}</p>}
      {!data && !loadError && <p className="patch-entry-line">Loading…</p>}

      {data && (
        <>
          {data.readOnly?.active && (
            <p className="patch-entry-line" style={{ color: "var(--gold)" }}>
              <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
              Emergency read-only mode is ACTIVE — Coach Mode saves and Patch Notes publish are blocked. Reason: {data.readOnly.reason}
              {" "}<button type="button" className="btn btn-ghost btn-small" onClick={handleClearReadOnly} disabled={busy}>Clear read-only mode</button>
            </p>
          )}

          <p className="patch-entry-line">
            <b>Live data:</b> revision {data.current.revision ?? "—"} · {data.current.size ?? "—"} bytes · checksum {data.current.checksum ? data.current.checksum.slice(0, 12) + "…" : "—"}
            {data.current.updatedAt ? <> · last updated {new Date(data.current.updatedAt).toLocaleString()}</> : null}
            {data.current.status !== "VALID_DATA" ? <> · <span style={{ color: "var(--magenta)" }}>status: {data.current.status}</span></> : null}
          </p>

          <p className="patch-entry-line" style={{ color: "var(--text-dimmer)" }}>
            Every Coach Mode save and Patch Notes publish backs up the previous state first — restoring one here backs up the current state first, too, so this is never a one-way action.
          </p>

          {(!data.backups || data.backups.length === 0) ? (
            <p className="patch-entry-line">No backups yet — one is created automatically the next time anything writes to Coach Mode data.</p>
          ) : (
            <ul className="revision-list">
              {data.backups.map((b) => (
                <li key={b.key} className="revision-list-item">
                  <span>{new Date(b.timestamp).toLocaleString()}</span>
                  <span style={{ color: "var(--text-dimmer)" }}>{b.operation}{b.source ? ` — ${b.source}` : ""}</span>
                  <span style={{ color: "var(--text-dimmer)" }}>{b.size} bytes</span>
                  <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => handleRestore(b)}>Restore</button>
                </li>
              ))}
            </ul>
          )}

          <button type="button" className="btn btn-ghost btn-small" style={{ marginTop: 10 }} onClick={() => setShowAudit((v) => !v)}>
            {showAudit ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Recent activity ({data.recentAudit?.length ?? 0})
          </button>
          {showAudit && (
            (!data.recentAudit || data.recentAudit.length === 0) ? <p className="patch-entry-line">No recorded activity yet.</p> : (
              <ul className="revision-list">
                {data.recentAudit.map((a) => (
                  <li key={a.key} className="revision-list-item">
                    <span>{new Date(a.timestamp).toLocaleString()}</span>
                    <span>{a.operation}</span>
                    <span style={{ color: a.result === "ACCEPTED" ? "var(--cyan)" : a.result === "CONFLICT" ? "var(--gold)" : "var(--magenta)" }}>{a.result}</span>
                    {a.failureReason ? <span style={{ color: "var(--text-dimmer)" }}>{a.failureReason}</span> : null}
                  </li>
                ))}
              </ul>
            )
          )}
        </>
      )}
    </div>
  );
}

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
                {PUBLISHABLE_STATUSES.has(rev.status) && (
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
      // A report with a Patch Notes dataset is reviewed change-by-change (see PatchNotesReview); the legacy
      // entry arrays are DERIVED from it and must not be sent back wholesale.
      ...(report.patchNotes ? {} : {
        championChanges: report.championChanges || [],
        itemChanges: report.itemChanges || [],
        runeChanges: report.runeChanges || [],
        systemChanges: report.systemChanges || [],
      }),
      recommendedTierChanges: report.recommendedTierChanges || [],
    });
    setEditMode(true);
  }

  function updateEntryAt(field, index, updatedEntry) {
    setDraft((prev) => ({ ...prev, [field]: prev[field].map((e, i) => (i === index ? updatedEntry : e)) }));
  }

  const data = editMode && draft ? { ...report, ...draft } : report;

  const isSourceProblem = report.status === "source_unavailable" || report.status === "ai_error";
  const isPartialFailure = report.status === "partial_failure";
  const coverage = report.analysisCoverage;

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

      {expanded && isPartialFailure && (
        <p className="patch-entry-line" style={{ padding: "0 20px", color: "var(--gold)" }}>
          <AlertTriangle size={14} style={{ verticalAlign: "-2px" }} /> This analysis is INCOMPLETE — not every part of the patch could be analyzed (see details below). The content shown reflects only what succeeded. Use Retry Analysis to resolve the remaining unresolved sections before publishing.
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
                  : `The deterministic extraction couldn't produce a usable report: ${report.adminNotes || "unknown error"}`}
              </p>
              <p className="patch-entry-line" style={{ color: "var(--text-dimmer)" }}>
                "Check for New Patch" won't retry this — it only looks for a Riot patch newer than the last one Patch Notes already knows about, and this one is already known. Use the button below instead, which re-runs the fetch/analysis for THIS specific patch directly.
              </p>
            </div>
          ) : (
            <>
              {/* A revision WITH a Patch Notes dataset edits its public summary inside the review panel below (review layer, survives
                  re-scans). Legacy revisions keep this textarea; when they have no text the summary is generated from the very entries
                  listed below, so the message can never claim "no changes" above a list of changes. */}
              {!report.patchNotes && (editMode ? (
                <textarea
                  className="edit-info-field"
                  value={data.supportMetaAnalysis}
                  onChange={(e) => setDraft((prev) => ({ ...prev, supportMetaAnalysis: e.target.value }))}
                />
              ) : (
                <p className="patch-meta-analysis">{buildPatchSummary(data, { legacyText: data.supportMetaAnalysis }).text}</p>
              ))}

              {report.patchNotes && <PatchNotesReview report={report} busy={busy} onOps={(ops) => onAction(report.id, "review", { ops, revision: report.revision })} />}
              {!report.patchNotes && data.championChanges.length > 0 && (
                <>
                  <h4 className="patch-section-label">Champions</h4>
                  {data.championChanges.map((e, i) => (
                    <ChangeEntryCard key={i} entry={e} nameField="championName" entityType="champion" roster={roster.champions} editMode={editMode} onChange={(u) => updateEntryAt("championChanges", i, u)} />
                  ))}
                </>
              )}
              {!report.patchNotes && data.itemChanges.length > 0 && (
                <>
                  <h4 className="patch-section-label">Items</h4>
                  {data.itemChanges.map((e, i) => (
                    <ChangeEntryCard key={i} entry={e} nameField="itemName" entityType="item" roster={roster.items} editMode={editMode} onChange={(u) => updateEntryAt("itemChanges", i, u)} />
                  ))}
                </>
              )}
              {!report.patchNotes && data.runeChanges.length > 0 && (
                <>
                  <h4 className="patch-section-label">Runes</h4>
                  {data.runeChanges.map((e, i) => (
                    <ChangeEntryCard key={i} entry={e} nameField="runeName" entityType="rune" roster={roster.runes} editMode={editMode} onChange={(u) => updateEntryAt("runeChanges", i, u)} />
                  ))}
                </>
              )}
              {!report.patchNotes && data.systemChanges.length > 0 && (
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
                  Legacy revision from the retired AI analyzer ({report.aiProvider || "unknown provider"}{report.aiModel ? `, ${report.aiModel}` : ""}) · revision {report.revision || 1}
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
            {!editMode && report.status !== "published" && !isSourceProblem && !isPartialFailure && (
              <>
                <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => onAction(report.id, "approve")}>
                  <CheckCircle2 size={14} /> Approve
                </button>
                <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => onAction(report.id, "reject")}>
                  <XCircle size={14} /> Reject
                </button>
              </>
            )}
            {!editMode && report.status !== "published" && !isSourceProblem && !isPartialFailure && (
              <span className="patch-publish-group">
                <label className="save-note" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={alsoVerify} onChange={(e) => setAlsoVerify(e.target.checked)} />
                  Also mark {report.patch} verified
                </label>
                <button className="btn btn-primary btn-small" disabled={busy || !report.patch || !PUBLISHABLE_STATUSES.has(report.status)} title={PUBLISHABLE_STATUSES.has(report.status) ? undefined : "Approve this revision before publishing it."} onClick={() => onAction(report.id, "publish", { alsoMarkVerified: alsoVerify })}>
                  <Send size={14} /> Publish
                </button>
              </span>
            )}
            {!editMode && isPartialFailure && (
              <button
                className="btn btn-ghost btn-small"
                style={{ color: "var(--gold)" }}
                disabled={busy || !report.patch}
                onClick={async () => {
                  if (window.confirm(`Publish patch ${report.patch || report.id} anyway, even though this analysis is INCOMPLETE (see coverage details above)? The public page will show only the changes that WERE successfully analyzed — anything unresolved will simply be missing, with no indication to visitors that the analysis was incomplete. This is not recommended; Retry Analysis is the better option.`)) {
                    // The server requires approval before publishing; choosing "anyway" IS the
                    // approval. If approving fails, the publish below is rejected by the server.
                    await onAction(report.id, "approve");
                    await onAction(report.id, "publish", { alsoMarkVerified: false });
                  }
                }}
              >
                <Send size={14} /> Publish anyway (incomplete)
              </button>
            )}
            {!editMode && report.status === "published" && (
              <>
                <button
                  className="btn btn-ghost btn-small"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Re-scan patch ${report.patch || report.id}? This re-reads the official patch notes and re-runs deterministic detection, creating a new revision pending your review — your existing Coach analysis is preserved for every entity still detected, and the currently published version stays live until you publish the new one.`)) {
                      onReanalyze(report.id, "reanalyze");
                    }
                  }}
                >
                  <RefreshCw size={14} /> Re-scan Patch
                </button>
                <button
                  className="btn btn-ghost btn-small"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Unpublish patch ${report.patch || report.id}? It will disappear from the public Patch Notes page immediately. The report itself is kept and can be published again later.`)) {
                      onAction(report.id, "unpublish");
                    }
                  }}
                >
                  <XCircle size={14} /> Unpublish
                </button>
              </>
            )}
            {!editMode && (isSourceProblem || isPartialFailure) && (
              <button
                className="btn btn-primary btn-small"
                disabled={busy}
                onClick={() => {
                  const label = report.status === "source_unavailable" ? "Retry Source Fetch" : "Re-scan Patch";
                  if (window.confirm(`${label} for patch ${report.patch || report.id}? This fetches the official patch notes again and re-runs deterministic detection as a new revision pending your review.`)) {
                    onReanalyze(report.id, "retry-analysis");
                  }
                }}
              >
                <RefreshCw size={14} /> {report.status === "source_unavailable" ? "Retry Source Fetch" : "Re-scan Patch"}
              </button>
            )}
            {!editMode && (
              <button
                className="btn btn-ghost btn-small"
                style={{ color: "var(--magenta)" }}
                disabled={busy}
                onClick={() => {
                  const publishedWarning = report.status === "published" ? " This patch is CURRENTLY PUBLISHED — it will disappear from the public Patch Notes page immediately." : "";
                  if (window.confirm(`Permanently delete ALL revisions of patch ${report.patch || report.id}? This cannot be undone.${publishedWarning}`)) {
                    onAction(report.id, "delete", { confirm: true });
                  }
                }}
              >
                <Trash2 size={14} /> Delete Patch
              </button>
            )}
          </div>

          <RevisionHistory reportId={report.id} onAction={onAction} busy={busy} refreshToken={refreshToken} />
        </div>
      )}
    </div>
  );
}

export default function AdminPage({ auth, currentPatch, onUpdatePatch, patchStatus, patchVerification, champions, items, runes, overrides, updateOverride }) {
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

  // ---- Core/Situational KV migration (see src/lib/buildTypeClassifier.js
  // for the classification rule itself) -------------------------------
  // `validChampionIds` distinguishes a real champion queued for
  // normalization from a stale/orphaned override key (e.g. a capitalization
  // mismatch) -- derived from the same `champions` roster already passed
  // into this page, no new data source.
  const validChampionIds = useMemo(() => new Set((champions || []).map((c) => c.id)), [champions]);
  const [migrationPlan, setMigrationPlan] = useState(null); // Preview result -- never written
  const [migrationApplyResult, setMigrationApplyResult] = useState(null);
  const [migrationVerification, setMigrationVerification] = useState(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const [showBackupJson, setShowBackupJson] = useState(false);
  const [backupCopied, setBackupCopied] = useState(false);

  function handlePreviewMigration() {
    // Pure read: planBuildTypeMigration never calls updateOverride and never
    // mutates `overrides` -- Preview performs zero writes by construction.
    setMigrationPlan(planBuildTypeMigration(overrides.champions, validChampionIds));
    setMigrationApplyResult(null);
    setMigrationVerification(null);
    setBackupAcknowledged(false);
    setShowBackupJson(false);
  }

  function backupJsonText() {
    return JSON.stringify({ champions: overrides.champions }, null, 2);
  }
  function handleDownloadBackup() {
    const blob = new Blob([backupJsonText()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coach-overrides-champions-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function handleCopyBackup() {
    navigator.clipboard?.writeText(backupJsonText()).then(() => {
      setBackupCopied(true);
      setTimeout(() => setBackupCopied(false), 2500);
    });
  }

  function handleApplyMigration() {
    setMigrationBusy(true);
    // Recomputed fresh against the CURRENT live overrides -- never trusts
    // the Preview snapshot, so Apply is always correct even if something
    // else changed overrides between Preview and this click.
    const plan = planBuildTypeMigration(overrides.champions, validChampionIds);

    // Only champions with an actual change are ever in plan.champions (see
    // planBuildTypeMigration's `anyChanged` check) -- an already-migrated
    // champion is simply absent here, so a second Apply run performs zero
    // updateOverride calls, which is what makes this idempotent.
    for (const c of plan.champions) {
      updateOverride("champions", c.id, { builds: c.newBuilds });
    }

    // Verify against exactly the objects just handed to updateOverride.
    // useCoachOverrides.js's update() is a pure shallow merge
    // ({...prev.champions[id], ...patch}) with no further transform of
    // `builds`, so overrides.champions[id].builds will equal c.newBuilds
    // verbatim once React re-renders -- checking these objects directly,
    // right now, is equivalent to re-reading post-write state and avoids
    // a render-timing race.
    const merged = { ...overrides.champions };
    for (const c of plan.champions) {
      merged[c.id] = { ...merged[c.id], builds: c.newBuilds };
    }
    const invalid = verifyAllEntriesTyped(merged, validChampionIds);

    setMigrationApplyResult({
      changedChampions: plan.champions.length,
      itemsChanged: plan.totals.itemsChanged,
      runesChanged: plan.totals.runesChanged,
      changedEntries: plan.totals.itemsChanged + plan.totals.runesChanged,
      coreCount: plan.totals.coreCount,
      situationalCount: plan.totals.situationalCount,
      staleKeys: plan.staleKeys,
      writesQueued: plan.champions.length,
    });
    setMigrationVerification({ invalid });
    setMigrationPlan(null);
    setMigrationBusy(false);
  }

  const loadReports = useCallback(async () => {
    try {
      const res = await fetch(REPORTS_URL, { credentials: "same-origin" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load reports");
      setReports(data.reports || []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e.message || "Couldn't load Patch Notes reports.");
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
      } else if (data.status === "analysis_error") {
        setCheckResult({ ok: false, message: `A new patch was found but the deterministic analysis hit an unexpected error: ${data.report?.adminNotes || "unknown error"}. A report was created below — use its "Re-scan Patch" button to try again, not this button again (this one only looks for a newer patch than ${data.report.patch}, which won't exist yet).` });
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
    const verb = action === "retry-analysis" ? "Retry" : "Re-scan";
    try {
      const res = await fetch(CHECK_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, patchId }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error || `${verb} failed`);
      if (data.status === "source_unavailable" || data.status === "analysis_error") {
        // A new revision WAS created (for debugging/history), but this
        // particular run didn't produce a fresh, usable analysis --
        // deterministic detection itself can't fail, so this only
        // happens if the source page couldn't be re-fetched, or a
        // genuine code bug was hit (see patch-check.js's analyzePatch).
        setCheckResult({ ok: false, message: `${verb} ran but didn't produce a fresh analysis (revision ${data.revision}, ${STATUS_LABEL[data.status] || data.status}): ${data.report?.adminNotes || "unknown error"}. The published version is unchanged.` });
      } else {
        setCheckResult({ ok: true, message: `${verb} complete: revision ${data.revision} (${STATUS_LABEL[data.status] || data.status}) is ready for review — Riot facts refreshed, your existing Coach analysis was preserved for every entity still detected. The published version is unchanged until you publish it.` });
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
            <p>Sign in to manage Coach Mode content and review Patch Notes reports.</p>
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
          <p>Patch status, Patch Notes detection, and review — Coach Mode content editing still happens in place on the public pages.</p>
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

        <KvSafetyPanel />

        <div className="admin-panel">
          <div className="admin-panel-head">
            <h3>Core/Situational data migration</h3>
          </div>
          <p className="patch-entry-line" style={{ color: "var(--text-dimmer)", marginTop: -8, marginBottom: 12 }}>
            One-time fix for champions whose Coach Mode build overrides predate the Core/Situational badge
            feature. Adds a <code>type</code> to any item/rune entry that's missing one — tag, name, note,
            order, and every other field are left exactly as they are. Nothing here runs automatically; it
            only writes to KV when you click Apply below, and only for champions that actually need it.
          </p>

          <div className="admin-migration-actions">
            <button type="button" className="btn btn-primary btn-small" onClick={handlePreviewMigration} disabled={migrationBusy}>
              <Radar size={14} /> Preview migration
            </button>
            {migrationApplyResult && (
              <button type="button" className="btn btn-ghost btn-small" onClick={handlePreviewMigration}>
                <RefreshCw size={14} /> Preview again
              </button>
            )}
          </div>

          {migrationPlan && (
            <div className="admin-migration-summary">
              <h4>Preview — nothing has been written</h4>
              <p className="patch-entry-line">
                Champions affected: <b>{migrationPlan.champions.length}</b> · Item entries to type: <b>{migrationPlan.totals.itemsChanged}</b> · Rune entries to type: <b>{migrationPlan.totals.runesChanged}</b> · Core: <b>{migrationPlan.totals.coreCount}</b> · Situational: <b>{migrationPlan.totals.situationalCount}</b>
              </p>
              {migrationPlan.staleKeys.length > 0 && (
                <p className="patch-entry-line" style={{ color: "var(--gold)" }}>
                  <AlertTriangle size={13} /> Stale/unreachable champion key(s) — left untouched: {migrationPlan.staleKeys.map((s) => `${s.id} (${s.buildCount} entries)`).join(", ")}
                </p>
              )}
              {migrationPlan.champions.length === 0 ? (
                <p className="storage-note">Every champion already has valid types on every entry — nothing to change. (Expected if this has already run.)</p>
              ) : (
                <>
                  <div className="admin-migration-table-wrap">
                    <table className="admin-migration-table">
                      <thead><tr><th>Champion</th><th>Items</th><th>Runes</th><th>Core</th><th>Situational</th></tr></thead>
                      <tbody>
                        {migrationPlan.champions.map((c) => (
                          <tr key={c.id}><td>{c.id}</td><td>{c.itemsChanged}</td><td>{c.runesChanged}</td><td>{c.coreCount}</td><td>{c.situationalCount}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="admin-migration-backup">
                    <h4><Database size={14} /> Save a backup before applying</h4>
                    <p className="patch-entry-line">
                      This is the exact champion override data currently live in KV, before anything changes.
                      Save it somewhere — this migration is additive and never deletes data, but the export
                      itself is the actual safety net here, not a promise.
                    </p>
                    <div className="admin-migration-actions">
                      <button type="button" className="btn btn-ghost btn-small" onClick={handleDownloadBackup}><Download size={14} /> Download backup JSON</button>
                      <button type="button" className="btn btn-ghost btn-small" onClick={handleCopyBackup}><Send size={14} /> Copy JSON</button>
                      <button type="button" className="btn btn-ghost btn-small" onClick={() => setShowBackupJson((v) => !v)}>{showBackupJson ? "Hide" : "Show"} raw JSON</button>
                      {backupCopied && <span className="save-note">Copied.</span>}
                    </div>
                    {showBackupJson && (
                      <textarea readOnly className="admin-migration-backup-json" value={backupJsonText()} onFocus={(e) => e.target.select()} />
                    )}
                    <label className="admin-migration-ack">
                      <input type="checkbox" checked={backupAcknowledged} onChange={(e) => setBackupAcknowledged(e.target.checked)} />
                      I've saved a copy of the current override data.
                    </label>
                  </div>

                  <button type="button" className="btn btn-primary btn-small" onClick={handleApplyMigration} disabled={!backupAcknowledged || migrationBusy}>
                    <CheckCircle2 size={14} /> {migrationBusy ? "Applying…" : `Apply — write ${migrationPlan.champions.length} champion(s)`}
                  </button>
                </>
              )}
            </div>
          )}

          {migrationApplyResult && (
            <div className="admin-migration-summary">
              <h4>Apply result</h4>
              <p className="patch-entry-line">
                Champions changed: <b>{migrationApplyResult.changedChampions}</b> · Build entries changed: <b>{migrationApplyResult.changedEntries}</b> (items {migrationApplyResult.itemsChanged}, runes {migrationApplyResult.runesChanged}) · Core: <b>{migrationApplyResult.coreCount}</b> · Situational: <b>{migrationApplyResult.situationalCount}</b> · Champion override updates queued: <b>{migrationApplyResult.writesQueued}</b>
              </p>
              <p className="patch-entry-line" style={{ color: "var(--text-dimmer)" }}>
                These went through the same update path (and the same debounced KV sync) as every other Coach Mode edit — no second persistence mechanism was used.
              </p>
              {migrationApplyResult.staleKeys.length > 0 && (
                <p className="patch-entry-line" style={{ color: "var(--gold)" }}>Stale key(s) left untouched: {migrationApplyResult.staleKeys.map((s) => s.id).join(", ")}</p>
              )}
              <h4>Verification</h4>
              {migrationVerification.invalid.length === 0 ? (
                <p className="save-note"><CheckCircle2 size={13} /> Every processed entry now has a valid type.</p>
              ) : (
                <>
                  <p className="coach-password-error">{migrationVerification.invalid.length} entries still lack a valid type:</p>
                  <ul className="admin-migration-invalid-list">
                    {migrationVerification.invalid.map((e, i) => (
                      <li key={i}>{e.champion} / {e.build} / {e.section}[{e.index}] — {e.name} (tag: {e.tag})</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

        <div className="admin-panel">
          <div className="admin-panel-head">
            <h3>Patch Notes</h3>
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
          {reports && reports.length === 0 && <p className="storage-note">No Patch Notes reports yet — click "Check for new patch now," or wait for the next scheduled check (see README).</p>}

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
