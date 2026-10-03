import { useState, useEffect } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Radar } from "lucide-react";
import { PatchStatusBanner } from "../components/PatchStatus.jsx";
import EntityImage from "../components/EntityImage.jsx";
import AbilityIcon from "../components/AbilityIcon.jsx";
import { buildPatchSummary, classificationLabel, normalizeClassification, normalizeChangeImpact, changeImpactLabel } from "../lib/patchNotesPresentation.js";

const SEVERITY_COLOR = { Low: "var(--cyan)", Medium: "var(--gold)", High: "var(--magenta)" };

// How substantial the changes to this entity are, as set by the reviewer (Academy review metadata -- Riot publishes no such rating, and the
// parser's extraction confidence is never shown here). Not rated => no chip at all, rather than a made-up "Medium". Old AI-era revisions
// carry the legacy `impactSeverity` wording, shown the same way.
function ImpactChip({ entry }) {
  const label = changeImpactLabel(entry.changeImpact || normalizeChangeImpact(entry.impactSeverity));
  if (!label) return null;
  return <span className="severity-chip" title="How substantial this patch's changes to it are" style={{ "--sc": SEVERITY_COLOR[label] }}>Impact: {label}</span>;
}

const CLASS_COLOR = { BUFF: "var(--cyan)", NERF: "var(--magenta)", ADJUSTED: "var(--gold)", NEW: "var(--cyan)", REMOVED: "var(--magenta)", UNKNOWN: "var(--text-dimmer)" };
// The reviewed classification (Buff / Nerf / Adjustment / New / Removed / Unknown). Old AI-era revisions only carry the legacy `type`.
const classOf = (entry) => entry.classification || normalizeClassification(entry.type) || "UNKNOWN";

function ChangeBadge({ value }) {
  return <span className="patch-entry-type patch-class" style={{ "--cc": CLASS_COLOR[value] || CLASS_COLOR.UNKNOWN }}>{classificationLabel(value)}</span>;
}

/** One Riot subsection (an ability / stat / passive heading exactly as Riot wrote it, or the admin's display edit of it) with its own
 *  changes and notes. `entry.subsections` is built from the review dataset's structure -- never by splitting a text string. */
function PublicSubsection({ sub, entryClass, championId }) {
  return (
    <div className="patch-sub">
      {sub.title && (
        <div className="patch-sub-head">
          {/* champions only; the icon is looked up by Riot's own heading and is pure decoration -- the title and every change below render with or without it */}
          {championId && <AbilityIcon championId={championId} sourceHeading={sub.sourceHeading || sub.title} abilityName={sub.abilityName} />}
          <div className="patch-sub-title">{sub.title}</div>
        </div>
      )}
      {sub.changes.map((c, j) => (
        <div className="patch-sub-change" key={j}>
          <p className="patch-entry-line">
            {c.text}
            {c.classification && c.classification !== entryClass && c.classification !== "UNKNOWN" && <> <ChangeBadge value={c.classification} /></>}
          </p>
          {c.note && <p className="patch-change-note"><b>Note:</b> {c.note}</p>}
        </div>
      ))}
    </div>
  );
}

function PublicChangeRow({ entry, nameField, entityType, roster }) {
  const cls = classOf(entry);
  return (
    <div className="patch-entry-card">
      <div className="patch-entry-head">
        {entityType && <EntityImage entityType={entityType} entityName={entry[nameField]} roster={roster} />}
        <span className="patch-entry-name">{entry.displayTitle || entry[nameField]}</span>
        <ChangeBadge value={cls} />
        <ImpactChip entry={entry} />
      </div>
      {Array.isArray(entry.subsections) && entry.subsections.length > 0
        ? entry.subsections.map((s, i) => <PublicSubsection key={i} sub={s} entryClass={cls} championId={entityType === "champion" ? entry.championId : null} />)
        : entry.whatChanged && <p className="patch-entry-line">{entry.whatChanged}</p>}
      {entry.supportImpact && <p className="patch-entry-line"><b>Support impact:</b> {entry.supportImpact}</p>}
      {entry.tierListActionNeeded && (
        <p className="patch-entry-footer"><span className="patch-entry-tier-action">Suggested tier action: {entry.recommendedTierAction}</span></p>
      )}
    </div>
  );
}

export function PublicReportCard({ report, roster, initiallyExpanded = false }) {
  const [expanded, setExpanded] = useState(Boolean(initiallyExpanded));
  // ONE summary for the whole card: the server's (custom text, else generated from the visible reviewed entries) or, for a response
  // that predates it, the same function over the same arrays this card renders -- the count and the message cannot disagree.
  const summary = report.summary || buildPatchSummary(report, { legacyText: report.supportMetaAnalysis });

  return (
    <div className="patch-report-card">
      <button className="patch-report-header" onClick={() => setExpanded((v) => !v)}>
        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="patch-report-patch">Patch {report.patch}</span>
        <span className="patch-report-date">{new Date(report.generatedAt).toLocaleDateString()}</span>
        {summary.headline && <span className="storage-note" style={{ margin: 0 }}>{summary.headline}</span>}
      </button>
      {expanded && (
        <div className="patch-report-body">
          <p className="patch-meta-analysis">{summary.text}</p>

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

export default function PatchNotesPage({ currentPatch, patchStatus, champions, items, runes }) {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/patch-reports");
        const data = await res.json();
        setReports(data.reports || []);
      } catch {
        setError("Couldn't load Patch Notes reports right now.");
      }
    })();
  }, []);

  return (
    <section className="page-section">
      <div className="wrap" style={{ maxWidth: 820 }}>
        <div className="section-head">
          <div className="eyebrow"><span className="dot" /><Radar size={12} style={{ marginRight: 2 }} />Patch Notes</div>
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
