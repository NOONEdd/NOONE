import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw, Check, Trash2, Ban, AlertTriangle } from "lucide-react";
import { CLASSIFICATION_OPTIONS, CHANGE_IMPACT_OPTIONS, SUBSECTION_SCOPE_OPTIONS, VISUAL_OVERRIDE_OPTIONS, normalizeVisualOverride, NO_CHANGES_TEXT, classificationLabel, normalizeClassification, normalizeChangeImpact, classificationOrUnknown, scopeLabel, normalizeScope } from "../lib/patchNotesPresentation.js";
import { sectionKeyOf, ownerNameOf, effectiveClassification, isAutoInAcademy, rememberEligibility, ACADEMY_STATUS_LABEL } from "../lib/patchNotesClassification.js";

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

// Classification (which bucket an entity is in -- In Academy / New candidate / Unmatched / System) is resolved by ONE shared function
// (src/lib/patchNotesClassification.js) that the server's derived view and public page also use; this panel keeps no copy of it.
const STATUS_LABEL = ACADEMY_STATUS_LABEL;
const STATUS_COLOR = { IN_ACADEMY: "var(--cyan)", NEW_CANDIDATE: "var(--gold)", UNMATCHED: "var(--magenta)", SYSTEM: "var(--text-dim)" };
const STATE_LABEL = { pending: "Pending", kept: "Kept", edited: "Edited", removed: "Removed", rejected: "Rejected" };
const FILTERS = [
  ["needs", "Needs review"], ["all", "All"], ["IN_ACADEMY", "In Academy"], ["NEW_CANDIDATE", "New candidates"],
  ["UNMATCHED", "Unmatched"], ["SYSTEM", "System"], ["hidden", "Removed / rejected"],
];

const sectionKey = sectionKeyOf;
const sectionTitle = ownerNameOf;
const TYPE_OPTIONS = [["champion", "Champion"], ["item", "Item"], ["rune", "Rune"]];
const ORIGIN_NOTE = { manual: "your decision", rule: "remembered rule" };

/** "Which bucket is this entity in?" -- one control for EVERY section (Unmatched, New candidate, System, any future bucket), driven by
 *  the shared effective classification. Moving an entity into Academy is CLASSIFICATION ONLY: no change's Keep / Remove state is
 *  touched, so nothing becomes public unless you Keep it (the second button does both, explicitly). On the live (published) revision
 *  the server refuses classification changes, so the control is read-only there. */
function ClassificationControl({ sectionKey: key, first, eff, allChanges, catalog, published, onOps, busy }) {
  const ownType = first.kind === "entity" && TYPE_OPTIONS.some(([t]) => t === first.entity.type) ? first.entity.type : null;
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(ownType || "");
  const [link, setLink] = useState("");
  const eligibility = rememberEligibility(first);
  const [remember, setRemember] = useState(eligibility.ok);   // default ON where allowed: the decision then also applies to future patches
  const [forget, setForget] = useState(true);                  // reverting a REMEMBERED decision: also stop applying it in future patches
  const t = ownType || type;
  const records = (t && catalog && catalog[`${t}s`]) || [];
  const options = [...records].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const linkedName = eff.link ? ((catalog && catalog[`${eff.type}s`]) || []).find((e) => e.id === eff.link.id)?.name || eff.link.id : null;
  const pending = allChanges.filter((c) => c.review.state === "pending");
  const decided = eff.origin !== "auto";
  const ruleIgnored = Boolean(eff.decision && eff.decision.status === "AUTO");
  const revert = () => onOps([eff.origin === "rule"
    ? (forget ? { op: "setSectionClassification", sectionKey: key, status: null, forget: true } : { op: "setSectionClassification", sectionKey: key, status: "AUTO" })
    : { op: "setSectionClassification", sectionKey: key, status: null }]);
  const promote = (keepAll) => {
    onOps([
      { op: "setSectionClassification", sectionKey: key, status: "IN_ACADEMY", ...(ownType ? {} : { type }), ...(link ? { academyId: link } : {}), ...(remember && eligibility.ok ? { remember: true } : {}) },
      ...(keepAll ? pending.map((c) => ({ op: "keep", changeId: c.changeId })) : []),
    ]);
    setOpen(false);
  };
  return (
    <>
      <div className="pn-actions">
        <span className="pn-label" style={{ margin: 0 }}>Academy classification:</span>
        <b>{STATUS_LABEL[eff.status]}</b>
        <span className="pn-count">{decided ? `${ORIGIN_NOTE[eff.origin]} · detected: ${STATUS_LABEL[eff.auto]}` : ruleIgnored ? "remembered rule ignored in this patch" : "detected automatically"}{eff.link ? ` · Academy record: ${linkedName}` : eff.status === "IN_ACADEMY" ? " · no Academy record linked" : ""}{eff.decision && eff.decision.linkDropped ? ` · remembered link "${eff.decision.linkDropped}" no longer exists` : ""}</span>
        {published ? (
          <span className="pn-count">This revision is live — re-scan to change its classification in a draft.</span>
        ) : ruleIgnored ? (
          <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => onOps([{ op: "setSectionClassification", sectionKey: key, status: null }])}><RotateCcw size={13} /> Use the remembered rule again</button>
        ) : eff.status !== "IN_ACADEMY" ? (
          <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => setOpen((v) => !v)}><Check size={13} /> Move to In Academy</button>
        ) : decided ? (
          <>
            {eff.origin === "rule" && (
              <label className="pn-count"><input type="checkbox" checked={forget} disabled={busy} onChange={(e) => setForget(e.target.checked)} /> Also forget the remembered rule for future patches</label>
            )}
            <button className="btn btn-ghost btn-small" disabled={busy} onClick={revert}><RotateCcw size={13} /> Revert to detected ({STATUS_LABEL[eff.auto]})</button>
          </>
        ) : null}
      </div>
      {open && !published && eff.status !== "IN_ACADEMY" && (
        <div className="pn-actions">
          {!ownType && (
            <select className="pn-input" value={type} disabled={busy} aria-label="Entity type" onChange={(e) => { setType(e.target.value); setLink(""); }}>
              <option value="">Type…</option>
              {TYPE_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          )}
          <select className="pn-input" value={link} disabled={busy || !t} aria-label="Academy record" onChange={(e) => setLink(e.target.value)}>
            <option value="">No Academy record (not linked)</option>
            {options.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <label className="pn-count" title={eligibility.ok ? undefined : eligibility.reason}>
            <input type="checkbox" checked={remember && eligibility.ok} disabled={busy || !eligibility.ok} onChange={(e) => setRemember(e.target.checked)} /> Also apply to future patches (remembered rule)
          </label>
          {!eligibility.ok && <span className="pn-count">{eligibility.reason}</span>}
          <button className="btn btn-primary btn-small" disabled={busy || !t} onClick={() => promote(false)}>Move to In Academy</button>
          {pending.length > 0 && <button className="btn btn-ghost btn-small" disabled={busy || !t} onClick={() => promote(true)}>Move and Keep its {pending.length} pending change{pending.length === 1 ? "" : "s"}</button>}
          <span className="pn-count">Classification only — its changes stay off the public page until you Keep them.{remember && eligibility.ok ? " Remembered: future patches that name it exactly the same way start In Academy too (you can forget the rule any time)." : ""}</span>
        </div>
      )}
    </>
  );
}

function Chip({ children, color }) {
  return <span style={{ border: `1px solid ${color || "var(--line)"}`, color: color || "var(--text-dim)", borderRadius: 999, padding: "1px 8px", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>{children}</span>;
}

function ChangeCard({ change, eff, onOps, busy }) {
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
        <Chip color={STATUS_COLOR[eff.status]}>{STATUS_LABEL[eff.status]}</Chip>
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
function SubsectionHead({ subKey, riotHeading, displayHeading, scope, scopeExtracted, scopeOverridden, visualOverride, championSection, onOps, busy }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(displayHeading || riotHeading);
  return (
    <div className="pn-sub-head">
      <b>{displayHeading || riotHeading}</b>
      {displayHeading && displayHeading !== riotHeading && <span className="pn-count">Riot heading: {riotHeading}</span>}
      <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => setEditing((v) => !v)}>Rename</button>
      {/* what KIND of section Riot's heading is, as found in Riot's structure; only ability-like sections get an icon on the public page. A reviewer can correct it. */}
      {championSection && scope && (
        <select className="pn-input" value={scopeOverridden ? normalizeScope(scope) : ""} disabled={busy} aria-label="Section type"
          onChange={(e) => onOps([{ op: "setSubsectionScope", subsectionKey: subKey, scope: e.target.value || null }])}>
          <option value="">Detected: {scopeLabel(scopeExtracted || scope)}</option>
          {SUBSECTION_SCOPE_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      )}
      {/* whether the section shows its ability icon on the public page: Auto = what its type implies; Show / Hide = the reviewer's call. Display only -- the type above is untouched. */}
      {championSection && scope && (
        <label className="pn-label" style={{ margin: 0 }}>Icon / Visual{" "}
          <select className="pn-input" value={normalizeVisualOverride(visualOverride) || ""} disabled={busy} aria-label="Icon / Visual"
            onChange={(e) => onOps([{ op: "setSubsectionVisual", subsectionKey: subKey, visual: e.target.value || null }])}>
            {VISUAL_OVERRIDE_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
      )}
      {editing && (
        <span className="pn-actions">
          <input type="text" className="pn-input" value={val} maxLength={300} onChange={(e) => setVal(e.target.value)} aria-label="Subsection heading shown publicly" />
          <button className="btn btn-primary btn-small" disabled={busy} onClick={() => { onOps([{ op: "editSubsectionTitle", subsectionKey: subKey, displayHeading: val === riotHeading ? "" : val }]); setEditing(false); }}>Save heading</button>
        </span>
      )}
    </div>
  );
}

function Section({ title, sectionState, changes, allChanges, eff, catalog, published, onOps, busy, defaultOpen, preview, subsectionReview }) {
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
    if (!byKey.has(k)) { const g = { key: sub ? sub.key : null, heading: sub ? sub.sourceHeading : null, scope: sub ? sub.scope : null, scopeExtracted: sub ? sub.scopeExtracted : null, scopeOverridden: Boolean(sub && sub.scopeOverridden), visualOverride: sub ? sub.visualOverride : null, championSection: Boolean(sub && sub.entityType === "champion"), changes: [] }; byKey.set(k, g); groups.push(g); }
    byKey.get(k).changes.push(c);
  }
  return (
    <div className="pn-section" style={state !== "visible" ? { opacity: 0.65 } : undefined}>
      <div className="pn-section-head">
        <button className="pn-toggle" onClick={() => setOpen((v) => !v)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} <b>{sectionState.displayTitle || title}</b></button>
        <span title={`Detected automatically: ${STATUS_LABEL[eff.auto]}`}><Chip color={STATUS_COLOR[eff.status]}>{STATUS_LABEL[eff.status]}{eff.origin === "manual" ? " · manual" : eff.origin === "rule" ? " · remembered" : ""}</Chip></span>
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
      <ClassificationControl sectionKey={key} first={first} eff={eff} allChanges={allChanges || changes} catalog={catalog} published={published} onOps={onOps} busy={busy} />
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
          {g.key && <SubsectionHead subKey={g.key} riotHeading={g.heading} displayHeading={(subsectionReview[g.key] || {}).displayHeading} scope={g.scope} scopeExtracted={g.scopeExtracted} scopeOverridden={g.scopeOverridden} visualOverride={g.visualOverride} championSection={g.championSection} onOps={onOps} busy={busy} />}
          {g.changes.map((c) => <ChangeCard key={c.changeId} change={c} eff={eff} onOps={onOps} busy={busy} />)}
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

export default function PatchNotesReview({ report, onOps, busy, initialFilter = "needs", catalog = null }) {
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
    return order.map((k) => {
      const all = map.get(k);
      const eff = effectiveClassification(all[0], ds); // one classification per section
      const keep = (c) => {
        const hidden = c.review.state === "removed" || c.review.state === "rejected";
        if (filter === "hidden") return hidden;
        // "needs review" = still needs a PUBLICATION decision: pending and not published by default (only an automatic Academy match is)
        if (filter === "needs") return c.review.state === "pending" && !isAutoInAcademy(c);
        if (filter === "all") return true;
        return eff.status === filter && !hidden;
      };
      const shown = all.filter(keep).filter((c) => !q || `${sectionTitle(c)} ${c.review.displayText} ${c.originalSourceText}`.toLowerCase().includes(q));
      return { key: k, title: sectionTitle(all[0]), changes: shown, all, total: all.length, eff };
    }).filter((s) => s.changes.length > 0);
  }, [ds, ds.changes, ds.sectionReview, filter, query]);

  const counts = useMemo(() => {
    const status = { IN_ACADEMY: 0, NEW_CANDIDATE: 0, UNMATCHED: 0, SYSTEM: 0 }; let pending = 0; let byDecision = 0;
    for (const c of ds.changes) {
      const eff = effectiveClassification(c, ds);
      status[eff.status]++;
      if (eff.origin !== "auto") byDecision++;
      if (c.review.state === "pending" && !isAutoInAcademy(c)) pending++;
    }
    return { status, pending, byDecision };
  }, [ds, ds.changes, ds.sectionReview]);

  return (
    <div className="pn-root">
      <p className="patch-entry-line" style={{ color: "var(--text-dimmer)", fontSize: 13 }}>
        Extracted deterministically from Riot's notes — no AI. Original Riot text is never edited; your edits, removals and rejections are kept
        separately and survive re-scans. New candidates, unmatched blocks and system changes stay out of the public page until you Keep them.
      </p>
      <p className="patch-entry-line pn-accounting">
        {ds.changes.length} changes from {v.totalMeaningfulBlocks} source blocks · {counts.status.IN_ACADEMY} in Academy{counts.byDecision ? ` (${counts.byDecision} by your decision)` : ""} · {counts.status.NEW_CANDIDATE} new candidates · {counts.status.UNMATCHED} unmatched · {counts.status.SYSTEM} system ·
        {" "}<b style={{ color: v.droppedBlocks === 0 ? "var(--cyan)" : "var(--magenta)" }}>{v.droppedBlocks} unaccounted blocks</b> · {v.duplicateMerges} duplicate merges · {v.lifecycleChanges} lifecycle · {v.ignoredBlocks} ignored (heading-only/boilerplate)
        {counts.pending > 0 ? ` · ${counts.pending} awaiting your review` : ""}
      </p>
      <SummaryEditor key={(ds.summaryReview && ds.summaryReview.text) || ""} ds={ds} preview={preview} onOps={onOps} busy={busy} />
      <div className="pn-filters">
        {FILTERS.map(([k, label]) => <button key={k} className={"pn-filter" + (filter === k ? " active" : "")} onClick={() => setFilter(k)}>{label}</button>)}
        <input type="text" className="pn-input pn-search" placeholder="Search entity or text…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search changes" />
      </div>
      {sections.length === 0 && <p className="patch-entry-line">Nothing in this view.</p>}
      {sections.map((s, i) => <Section key={s.key + filter} title={s.title} sectionState={sectionReview[s.key] || {}} changes={s.changes} allChanges={s.all} eff={s.eff} catalog={catalog} published={report.status === "published"} onOps={onOps} busy={busy} defaultOpen={sections.length <= 3 && i === 0} preview={preview} subsectionReview={subsectionReview} />)}
      {ds.classificationRules && ds.classificationRules.status === "unavailable" && (
        <p className="patch-entry-line" style={{ color: "var(--gold)", fontSize: 13 }}>
          <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> The remembered classification rules could not be read when this revision was generated, so they were not applied (earlier remembered decisions were kept as they were). Re-scan to apply them.
        </p>
      )}
      {(ds.orphanedSectionReviews || []).length > 0 && (
        <p className="patch-entry-line" style={{ color: "var(--gold)", fontSize: 13 }}>
          <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> {ds.orphanedSectionReviews.length} section-level review setting{ds.orphanedSectionReviews.length === 1 ? "" : "s"} (title, badge, impact or classification) no longer match{ds.orphanedSectionReviews.length === 1 ? "es" : ""} a section in this extraction, because the sections they belonged to could not be followed unambiguously. They are kept, not applied — re-apply them on the current sections if still wanted.
        </p>
      )}
      {(ds.orphanedChanges || []).length > 0 && (
        <>
          <h4 className="patch-section-label">No longer produced by the latest extraction ({ds.orphanedChanges.length})</h4>
          <p className="patch-entry-line" style={{ color: "var(--text-dimmer)", fontSize: 13 }}>You had reviewed these; the parser no longer yields them. They are kept so your work is never silently destroyed.</p>
          {ds.orphanedChanges.map((c) => <ChangeCard key={c.changeId} change={c} eff={effectiveClassification(c, ds)} onOps={onOps} busy />)}
        </>
      )}
    </div>
  );
}
