import { CheckCircle2, RefreshCw, CircleDashed } from "lucide-react";

// Reads the SAME { status, verifiedPatch } shape everywhere --
// src/lib/effectiveData.js's resolvePatchDataStatus() is the one place
// that computes it (from Coach Mode's overrides.verifiedPatch /
// overrides.patchStatus), so this component never re-derives or
// second-guesses that logic; it only renders whatever it's given. Used
// on the three tier list pages, the champion detail page, the AI Coach
// page, and the public Patch Intelligence page -- see App.jsx for where
// `patchStatus` gets threaded down from.
const STATUS_META = {
  verified: { label: "Verified for this patch", Icon: CheckCircle2, color: "var(--cyan)" },
  updating: { label: "Update in progress", Icon: RefreshCw, color: "var(--gold)" },
  not_reviewed: { label: "Not yet reviewed", Icon: CircleDashed, color: "var(--text-dimmer)" },
};

function metaFor(status) {
  return STATUS_META[status] || STATUS_META.not_reviewed;
}

/** Small inline pill -- used inside the Coach Mode patch editor and
 *  anywhere space is tight. */
export function PatchStatusPill({ status }) {
  const { label, Icon, color } = metaFor(status);
  return (
    <span className="patch-status-pill" style={{ "--psc": color }}>
      <Icon size={12} /> {label}
    </span>
  );
}

/** Larger "current patch" header block for public pages -- shows the
 *  centralized patch number plus its verification status together, so
 *  the two are never displayed separately in a way that could imply
 *  more confidence than resolvePatchDataStatus() actually reports (see
 *  that function's comment for why "current patch changed" must never
 *  by itself read as "verified"). */
export function PatchStatusBanner({ patch, status }) {
  const { label, Icon, color } = metaFor(status);
  return (
    <div className="patch-status-banner" style={{ "--psc": color }}>
      <span className="patch-status-banner-patch">Patch {patch || "—"}</span>
      <span className="patch-status-banner-status"><Icon size={13} /> {label}</span>
    </div>
  );
}
