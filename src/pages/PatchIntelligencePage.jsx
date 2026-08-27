import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Radar } from "lucide-react";
import { PatchStatusBanner } from "../components/PatchStatus.jsx";
import EntityImage from "../components/EntityImage.jsx";

const SEVERITY_COLOR = { Low: "var(--cyan)", Medium: "var(--gold)", High: "var(--magenta)" };

function SeverityChip({ severity }) {
  return <span className="severity-chip" style={{ "--sc": SEVERITY_COLOR[severity] || "var(--text-dimmer)" }}>{severity}</span>;
}

function PublicChangeRow({ entry, nameField, entityType, roster }) {
  return (
    <div className="patch-entry-card">
      <div className="patch-entry-head">
        {entityType && <EntityImage entityType={entityType} entityName={entry[nameField]} roster={roster} />}
        <span className="patch-entry-name">{entry[nameField]}</span>
        <span className="patch-entry-type">{entry.type}</span>
        <SeverityChip severity={entry.impactSeverity} />
      </div>
      {entry.whatChanged && <p className="patch-entry-line">{entry.whatChanged}</p>}
      {entry.supportImpact && <p className="patch-entry-line"><b>Support impact:</b> {entry.supportImpact}</p>}
      {entry.tierListActionNeeded && (
        <p className="patch-entry-footer"><span className="patch-entry-tier-action">Suggested tier action: {entry.recommendedTierAction}</span></p>
      )}
    </div>
  );
}

function PublicReportCard({ report, roster }) {
  const [expanded, setExpanded] = useState(false);
  const totalChanges = report.championChanges.length + report.itemChanges.length + report.runeChanges.length + report.systemChanges.length;

  return (
    <div className="patch-report-card">
      <button className="patch-report-header" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="patch-report-patch">Patch {report.patch}</span>
        <span className="patch-report-date">{new Date(report.generatedAt).toLocaleDateString()}</span>
        <span className="storage-note" style={{ margin: 0 }}>{totalChanges} Support-relevant change{totalChanges === 1 ? "" : "s"}</span>
      </button>
      {expanded && (
        <div className="patch-report-body">
          <p className="patch-meta-analysis">{report.supportMetaAnalysis || "No Support-relevant changes identified in this patch."}</p>

          {report.championChanges.length > 0 && (
            <>
              <h4 className="patch-section-label">Champions</h4>
              {report.championChanges.map((e, i) => <PublicChangeRow key={i} entry={e} nameField="championName" entityType="champion" roster={roster.champions} />)}
            </>
          )}
          {report.itemChanges.length > 0 && (
            <>
              <h4 className="patch-section-label">Items</h4>
              {report.itemChanges.map((e, i) => <PublicChangeRow key={i} entry={e} nameField="itemName" entityType="item" roster={roster.items} />)}
            </>
          )}
          {report.runeChanges.length > 0 && (
            <>
              <h4 className="patch-section-label">Runes</h4>
              {report.runeChanges.map((e, i) => <PublicChangeRow key={i} entry={e} nameField="runeName" entityType="rune" roster={roster.runes} />)}
            </>
          )}
          {report.systemChanges.length > 0 && (
            <>
              <h4 className="patch-section-label">System / Meta</h4>
              {report.systemChanges.map((e, i) => <PublicChangeRow key={i} entry={e} nameField="area" />)}
            </>
          )}
          {report.sourceUrl && (
            <p className="patch-entry-line" style={{ marginTop: 14 }}>
              <a href={report.sourceUrl} target="_blank" rel="noopener noreferrer" className="contact-row" style={{ fontSize: 13 }}>
                Official Riot patch notes <ExternalLink size={12} />
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function PatchIntelligencePage({ currentPatch, patchStatus, champions, items, runes }) {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/patch-reports");
        const data = await res.json();
        setReports(data.reports || []);
      } catch {
        setError("Couldn't load Patch Intelligence reports right now.");
      }
    })();
  }, []);

  return (
    <section className="page-section">
      <div className="wrap" style={{ maxWidth: 820 }}>
        <div className="section-head">
          <div className="eyebrow"><span className="dot" /><Radar size={12} style={{ marginRight: 2 }} />Patch Intelligence</div>
          <h2>What Changed For Support</h2>
          <p>A coach-reviewed, Support-focused breakdown of each Wild Rift patch — not a copy of Riot's patch notes, just what actually matters for the role.</p>
        </div>

        <PatchStatusBanner patch={currentPatch} status={patchStatus} />

        {error && <p className="coach-error">{error}</p>}
        {reports === null && !error && <p className="storage-note" style={{ marginTop: 24 }}>Loading reports…</p>}
        {reports && reports.length === 0 && (
          <div className="placeholder-box" style={{ marginTop: 24 }}>
            <Radar size={16} />
            <p>No patches analyzed yet — check back after the next Wild Rift update, or ask in the AI Coach in the meantime.</p>
          </div>
        )}

        {reports && reports.length > 0 && (
          <div className="patch-report-list" style={{ marginTop: 24 }}>
            {reports.map((r) => <PublicReportCard key={r.id} report={r} roster={{ champions, items, runes }} />)}
          </div>
        )}
      </div>
    </section>
  );
}
