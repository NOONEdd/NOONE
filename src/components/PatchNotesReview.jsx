import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw, Check, Trash2, Ban, AlertTriangle } from "lucide-react";
import { CLASSIFICATION_OPTIONS, CHANGE_IMPACT_OPTIONS, NO_CHANGES_TEXT, classificationLabel, normalizeClassification, normalizeChangeImpact, classificationOrUnknown } from "../lib/patchNotesPresentation.js";

// Patch Notes review panel (admin).
//
// Three layers are shown side by side and never mixed:
//   1. ORIGINAL RIOT SOURCE  -- read-only, exactly what Riot wrote
//   2. NORMALIZED EXTRACTION -- what the deterministic parser understood (read-only)
//   3. DISPLAY TEXT          -- what Academy will show; the ONLY thing a reviewer edits
// Every action is sent as a small review operation (see functions/_lib/patchNotesReview.js);
// the server never lets one touch layers 1-2. Everything here that is editable (summary, classification, display text, note,
// subsection heading, visibility) is layer 3 and is shown on the public Patch Notes page exactly as saved.
// Remove != Reject: "Remove" hides this change from
// the current Patch Notes; "Reject" says the parser was right but it is outside the Academy/support scope.

const STATUS_LABEL = { EXISTING: "In Academy", NEW_CANDIDATE: "New candidate", UNMATCHED: "Unmatched", SYSTEM: "System" };
const STATUS_COLOR = { EXISTING: "var(--cyan)", NEW_CANDIDATE: "var(--gold)", UNMATCHED: "var(--magenta)", SYSTEM: "var(--text-dim)" };
const STATE_LABEL = { pending: "Pending", kept: "Kept", edited: "Edited", removed: "Removed", rejected: "Rejected" };
const FILTERS = [
  ["needs", "Needs review"], ["all", "All"], ["EXISTING", "In Academy"], ["NEW_CANDIDATE", "New candidates"],
  ["UNMATCHED", "Unmatched"], ["SYSTEM", "System"], ["hidden", "Removed / rejected"],
];

const statusOf = (c) => (c.kind === "system" ? "SYSTEM" : c.entity.status);
const sectionKey = (c) => (c.kind === "system" ? `system:${c.system.category}:${String(c.system.area || "").toLowerCase().replace(/[^a-z0-9]+/g, "")}` : `entity:${c.entity.key}`);
const sectionTitle = (c) => (c.kind === "system" ? c.system.area || c.system.category : c.entity.name);

function Chip({ children, color }) {
  return <span style={{ border: `1px solid ${color || "var(--line)"}`, color: color || "var(--text-dim)", borderRadius: 999, padding: "1px 8px", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>{children}</span>;
}

function ChangeCard({ change, onOps, busy }) {
  const override = normalizeClassification(change.review.comparisonStateOverride);
  const effective = override || classificationOrUnknown(change.comparisonState);
  const r = change.review;
  const [title, setTitle] = useState(r.displayTitle);
  const [text, setText] = useState(r.displayText);
  const [note, setNote] = useState(r.reviewerNote || "");
  const [open, setOpen] = useState(false);
  const n = change.normalizedData;
  const dirty = title !== r.displayTitle || text !== r.displayText || note !== (r.reviewerNote || "");
  const hidden = r.state === "removed" || r.state === "rejected";
  const id = change.changeId;
  const p = change.provenance;
  return (
    <div className="pn-change" style={hidden ? { opacity: 0.6 } : undefined}>
      <div className="pn-change-head">
        <Chip color={STATUS_COLOR[statusOf(change)]}>{STATUS_LABEL[statusOf(change)]}</Chip>
        <Chip>{STATE_LABEL[r.state]}</Chip>
        <Chip color={override ? "var(--gold)" : undefined}>{classificationLabel(effective)}{override ? " (your override)" : ""}</Chip>
        {change.ownership.source === "unmatched" && <Chip color="var(--magenta)">owner not provable</Chip>}
        {r.sourceChangedSinceReview && <Chip color="var(--gold)"><AlertTriangle size={11} style={{ verticalAlign: "-1px" }} /> Riot text changed since you reviewed this</Chip>}
        {change.orphaned && <Chip color="var(--gold)">No longer produced by the latest extraction</Chip>}
      </div>

      <div className="pn-label">Original Riot source (read-only)</div>
      <pre className="pn-source">{change.originalSourceText}</pre>

      <div className="pn-label">Shown on the public Patch Notes (editable)</div>
      <input type="text" className="pn-input" value={title} maxLength={300} disabled={busy || change.orphaned} onChange={(e) => setTitle(e.target.value)} aria-label="Display title" />
      <textarea className="pn-input" rows={3} value={text} maxLength={4000} disabled={busy || change.orphaned} onChange={(e) => setText(e.target.value)} aria-label="Display text" />
      <input type="text" className="pn-input" placeholder="Note shown publicly under this change (optional)" value={note} maxLength={2000} disabled={busy || change.orphaned} onChange={(e) => setNote(e.target.value)} aria-label="Note shown publicly" />
      <div className="pn-label">Classification — detected from Riot: <b>{classificationLabel(change.comparisonState)}</b></div>
      <select className="pn-input" value={override || ""} disabled={busy || change.orphaned} aria-label="Classification override"
        onChange={(e) => onOps([{ op: "classify", changeId: id, comparisonState: e.target.value || null }])}>
        <option value="">Use detected ({classificationLabel(change.comparisonState)})</option>
        {CLASSIFICATION_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>

      {!change.orphaned && (
        <div className="pn-actions">
          <button className="btn btn-primary btn-small" disabled={busy || !dirty} onClick={() => onOps([{ op: "edit", changeId: id, displayTitle: title, displayText: text, reviewerNote: note }])}>Save edit</button>
          {(r.edited.title || r.edited.text) && <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => onOps([{ op: "resetDisplay", changeId: id }])}><RotateCcw size={13} /> Reset text</button>}
          {!hidden && r.state !== "kept" && r.state !== "edited" && <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => onOps([{ op: "keep", changeId: id }])}><Check size={13} /> Keep</button>}
          {!hidden && <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => onOps([{ op: "remove", changeId: id }])}><Trash2 size={13} /> Remove</button>}
          {!hidden && <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => onOps([{ op: "reject", changeId: id }])}><Ban size={13} /> Reject (out of scope)</button>}
          {hidden && <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => onOps([{ op: "restore", changeId: id }])}><RotateCcw size={13} /> Restore</button>}
        </div>
      )}

      <button className="pn-toggle" onClick={() => setOpen((v) => !v)}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Extraction details &amp; provenance</button>
      {open && (
        <div className="pn-details">
          <div><b>Ownership:</b> {change.ownership.source} — {change.ownership.reason}</div>
          {change.ownership.suspectedReferences.length > 0 && <div><b>Mentioned (not owned):</b> {change.ownership.suspectedReferences.join(", ")}</div>}
          {change.entity && <div><b>Entity:</b> {change.entity.name} ({change.entity.type}) · {change.entity.status} · support scope {change.entity.supportScope}{change.entity.newnessEvidence ? ` · evidence: “${change.entity.newnessEvidence.sentence}”` : ""}</div>}
          <div><b>Normalized:</b> {n.changeType}{n.ability ? ` · ability ${n.ability}` : ""}{n.slot ? ` (${n.slot})` : ""}{n.group ? ` · ${n.group}` : ""}{n.stat ? ` · stat ${n.stat}` : ""}{n.effect ? ` · effect “${n.effect}”` : ""}{n.oldValue || n.newValue ? ` · ${n.oldValue || "∅"} → ${n.newValue || "∅"}` : ""}{n.traits.length ? ` · ${n.traits.join("+")}` : ""}</div>
          <div><b>Source:</b> {p.sourceNodePath}</div>
          <div><b>Patch</b> {p.patchVersion ?? "null"} · block {p.sourceBlockIndex} · line {p.sourceLineIndex ?? "null"} · order {p.sourceOrder} · parser {p.parserVersion} / {p.extractorVersion} · extracted {p.extractedAt}</div>
          <div><b>Fingerprint:</b> {p.sourceFingerprint} · <b>Change ID:</b> {id}{change.duplicates.length ? ` · ${change.duplicates.length} identical duplicate(s) merged` : ""}</div>
        </div>
      )}
    </div>
  );
}

/** The subsection heading as visitors will see it: your edit if any, else Riot's own heading. Renaming never touches Riot's heading. */
function SubsectionHead({ subKey, riotHeading, displayHeading, onOps, busy }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(displayHeading || riotHeading);
  return (
    <div className="pn-sub-head">
      <b>{displayHeading || riotHeading}</b>
      {displayHeading && displayHeading !== riotHeading && <span className="pn-count">Riot heading: {riotHeading}</span>}
      <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => setEditing((v) => !v)}>Rename</button>
      {editing && (
        <span className="pn-actions">
          <input type="text" className="pn-input" value={val} maxLength={300} onChange={(e) => setVal(e.target.value)} aria-label="Subsection heading shown publicly" />
          <button className="btn btn-primary btn-small" disabled={busy} onClick={() => { onOps([{ op: "editSubsectionTitle", subsectionKey: subKey, displayHeading: val === riotHeading ? "" : val }]); setEditing(false); }}>Save heading</button>
        </span>
      )}
    </div>
  );
}

function Section({ title, sectionState, changes, onOps, busy, defaultOpen, preview, subsectionReview }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [editing, setEditing] = useState(false);
  const first = changes[0];
  const key = sectionKey(first);
  const [name, setName] = useState(sectionState.displayTitle || title);
  const state = sectionState.state || "visible";
  const counts = changes.reduce((a, c) => { a[c.review.state] = (a[c.review.state] || 0) + 1; return a; }, {});
  // changes grouped by their Riot subsection exactly like the public page (keys come from the server: one implementation)
  const groups = []; const byKey = new Map();
  for (const c of changes) {
    const sub = (preview && preview.subsections && preview.subsections[c.changeId]) || null;
    const k = sub ? sub.key : "";
    if (!byKey.has(k)) { const g = { key: sub ? sub.key : null, heading: sub ? sub.sourceHeading : null, changes: [] }; byKey.set(k, g); groups.push(g); }
    byKey.get(k).changes.push(c);
  }
  return (
    <div className="pn-section" style={state !== "visible" ? { opacity: 0.65 } : undefined}>
      <div className="pn-section-head">
        <button className="pn-toggle" onClick={() => setOpen((v) => !v)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} <b>{sectionState.displayTitle || title}</b></button>
        <Chip color={STATUS_COLOR[statusOf(first)]}>{STATUS_LABEL[statusOf(first)]}</Chip>
        <span className="pn-count">{changes.length} change{changes.length === 1 ? "" : "s"}{counts.pending ? ` · ${counts.pending} pending` : ""}</span>
        {state !== "visible" && <Chip color="var(--gold)">Section {state}</Chip>}
        <span className="pn-section-actions">
          {state === "visible" ? (
            <>
              <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => setEditing((v) => !v)}>Rename</button>
              <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => onOps([{ op: "removeSection", sectionKey: key }])}><Trash2 size={13} /> Remove section</button>
              <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => onOps([{ op: "rejectSection", sectionKey: key }])}><Ban size={13} /> Reject</button>
            </>
          ) : (
            <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => onOps([{ op: "restoreSection", sectionKey: key }])}><RotateCcw size={13} /> Restore section</button>
          )}
        </span>
      </div>
      {editing && (
        <div className="pn-actions">
          <input type="text" className="pn-input" value={name} maxLength={300} onChange={(e) => setName(e.target.value)} aria-label="Section title" />
          <button className="btn btn-primary btn-small" disabled={busy} onClick={() => { onOps([{ op: "editSectionTitle", sectionKey: key, displayTitle: name }]); setEditing(false); }}>Save title</button>
        </div>
      )}
      {state === "visible" && (
        <div className="pn-actions">
          <span className="pn-label" style={{ margin: 0 }}>Badge on the public page:</span>
          <select className="pn-input" value={normalizeClassification(sectionState.comparisonStateOverride) || ""} disabled={busy} aria-label="Entity classification override"
            onChange={(e) => onOps([{ op: "classifySection", sectionKey: key, comparisonState: e.target.value || null }])}>
            <option value="">Derived from its changes</option>
            {CLASSIFICATION_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <span className="pn-label" style={{ margin: 0 }}>Overall impact (shown publicly):</span>
          <select className="pn-input" value={normalizeChangeImpact(sectionState.changeImpact) || ""} disabled={busy} aria-label="Overall change impact"
            onChange={(e) => onOps([{ op: "impactSection", sectionKey: key, changeImpact: e.target.value || null }])}>
            <option value="">Not rated</option>
            {CHANGE_IMPACT_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>
      )}
      {open && groups.map((g) => (
        <div className="pn-sub" key={g.key || "none"}>
          {g.key && <SubsectionHead subKey={g.key} riotHeading={g.heading} displayHeading={(subsectionReview[g.key] || {}).displayHeading} onOps={onOps} busy={busy} />}
          {g.changes.map((c) => <ChangeCard key={c.changeId} change={c} onOps={onOps} busy={busy} />)}
        </div>
      ))}
    </div>
  );
}

/** The public patch summary: what visitors will read, whether it is the generated sentence (always derived from the entries they can
 *  actually see) or your own text. Saving empty text goes back to the generated one. */
function SummaryEditor({ ds, preview, onOps, busy }) {
  const custom = (ds.summaryReview && ds.summaryReview.text) || "";
  const [text, setText] = useState(custom);
  const s = preview && preview.summary;
  return (
    <div className="pn-summary">
      <div className="pn-label">Public patch summary {s ? (s.source === "custom" ? "— using your custom text" : "— generated from the changes visitors can see") : ""}</div>
      {s && <p className="patch-meta-analysis" style={{ margin: "2px 0 6px" }}>{s.text}</p>}
      <textarea className="pn-input" rows={2} value={text} maxLength={1000} disabled={busy} placeholder={s ? `Leave empty to use: ${s.generatedText}` : "Custom summary (optional)"} onChange={(e) => setText(e.target.value)} aria-label="Custom patch summary" />
      <div className="pn-actions">
        <button className="btn btn-primary btn-small" disabled={busy || text.trim() === custom} onClick={() => onOps([text.trim() ? { op: "setSummary", text } : { op: "clearSummary" }])}>Save summary</button>
        <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => setText(NO_CHANGES_TEXT)}>Use "no changes" message</button>
        {custom && <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => onOps([{ op: "clearSummary" }])}><RotateCcw size={13} /> Use generated summary</button>}
      </div>
    </div>
  );
}

export default function PatchNotesReview({ report, onOps, busy, initialFilter = "needs" }) {
  const ds = report.patchNotes;
  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState("");
  const v = ds.validation;
  const sectionReview = ds.sectionReview || {};
  const subsectionReview = ds.subsectionReview || {};
  const preview = report.publicPreview || null;

  const sections = useMemo(() => {
    const order = []; const map = new Map();
    for (const c of ds.changes) {
      const k = sectionKey(c);
      if (!map.has(k)) { map.set(k, []); order.push(k); }
      map.get(k).push(c);
    }
    const q = query.trim().toLowerCase();
    const keep = (c) => {
      const st = statusOf(c);
      const hidden = c.review.state === "removed" || c.review.state === "rejected";
      if (filter === "hidden") return hidden;
      if (filter === "needs") return c.review.state === "pending" && st !== "EXISTING";
      if (filter === "all") return true;
      return st === filter && !hidden;
    };
    return order.map((k) => {
      const all = map.get(k);
      const shown = all.filter(keep).filter((c) => !q || `${sectionTitle(c)} ${c.review.displayText} ${c.originalSourceText}`.toLowerCase().includes(q));
      return { key: k, title: sectionTitle(all[0]), changes: shown, total: all.length };
    }).filter((s) => s.changes.length > 0);
  }, [ds.changes, filter, query]);

  const counts = useMemo(() => {
    const status = { EXISTING: 0, NEW_CANDIDATE: 0, UNMATCHED: 0, SYSTEM: 0 }; let pending = 0;
    for (const c of ds.changes) { status[statusOf(c)]++; if (c.review.state === "pending" && statusOf(c) !== "EXISTING") pending++; }
    return { status, pending };
  }, [ds.changes]);

  return (
    <div className="pn-root">
      <p className="patch-entry-line" style={{ color: "var(--text-dimmer)", fontSize: 13 }}>
        Extracted deterministically from Riot's notes — no AI. Original Riot text is never edited; your edits, removals and rejections are kept
        separately and survive re-scans. New candidates, unmatched blocks and system changes stay out of the public page until you Keep them.
      </p>
      <p className="patch-entry-line pn-accounting">
        {ds.changes.length} changes from {v.totalMeaningfulBlocks} source blocks · {counts.status.EXISTING} in Academy · {counts.status.NEW_CANDIDATE} new candidates · {counts.status.UNMATCHED} unmatched · {counts.status.SYSTEM} system ·
        {" "}<b style={{ color: v.droppedBlocks === 0 ? "var(--cyan)" : "var(--magenta)" }}>{v.droppedBlocks} unaccounted blocks</b> · {v.duplicateMerges} duplicate merges · {v.lifecycleChanges} lifecycle · {v.ignoredBlocks} ignored (heading-only/boilerplate)
        {counts.pending > 0 ? ` · ${counts.pending} awaiting your review` : ""}
      </p>
      <SummaryEditor key={(ds.summaryReview && ds.summaryReview.text) || ""} ds={ds} preview={preview} onOps={onOps} busy={busy} />
      <div className="pn-filters">
        {FILTERS.map(([k, label]) => <button key={k} className={"pn-filter" + (filter === k ? " active" : "")} onClick={() => setFilter(k)}>{label}</button>)}
        <input type="text" className="pn-input pn-search" placeholder="Search entity or text…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search changes" />
      </div>
      {sections.length === 0 && <p className="patch-entry-line">Nothing in this view.</p>}
      {sections.map((s, i) => <Section key={s.key + filter} title={s.title} sectionState={sectionReview[s.key] || {}} changes={s.changes} onOps={onOps} busy={busy} defaultOpen={sections.length <= 3 && i === 0} preview={preview} subsectionReview={subsectionReview} />)}
      {(ds.orphanedChanges || []).length > 0 && (
        <>
          <h4 className="patch-section-label">No longer produced by the latest extraction ({ds.orphanedChanges.length})</h4>
          <p className="patch-entry-line" style={{ color: "var(--text-dimmer)", fontSize: 13 }}>You had reviewed these; the parser no longer yields them. They are kept so your work is never silently destroyed.</p>
          {ds.orphanedChanges.map((c) => <ChangeCard key={c.changeId} change={c} onOps={onOps} busy />)}
        </>
      )}
    </div>
  );
}
