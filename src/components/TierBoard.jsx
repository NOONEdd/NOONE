import { useState } from "react";
import { Lock, Unlock } from "lucide-react";
import { TIER_ORDER, TIER_COLORS } from "../data/constants.js";
import RankChip from "./RankChip.jsx";
import BuildPanel from "./BuildPanel.jsx";

export function TierBoard({ entries, editMode, onUpdate }) {
  const [active, setActive] = useState(null);

  return (
    <>
      {TIER_ORDER.map((tier) => {
        const list = entries.filter((e) => e.tier === tier);
        return (
          <div className="tier-row" key={tier}>
            <div className="tier-label" style={{ color: TIER_COLORS[tier], borderColor: TIER_COLORS[tier] }}>
              {tier === "Unranked" ? "—" : tier}
            </div>
            <div className="tier-champs">
              {list.length === 0 && <span className="tier-empty">— empty —</span>}
              {list.map((e) => (
                <RankChip key={e.id} {...e} editMode={editMode} onUpdate={(patch) => onUpdate(e.id, patch)}
                  onTapForDetail={setActive} hideTierBadge mini />
              ))}
            </div>
          </div>
        );
      })}

      {/* Mobile-only: tapping a compact chip reveals its info here instead of
          every card permanently showing its full description text, which is
          what was forcing single-column, endless-scroll behavior on phones.
          Desktop already shows the info inline on the card itself, so this
          never appears there. */}
      {active && (
        <div className="build-sheet-backdrop tier-detail-backdrop" onClick={() => setActive(null)}>
          <div className="build-sheet" onClick={(e) => e.stopPropagation()}>
            <BuildPanel entry={active} paths={active.paths} onClose={() => setActive(null)} />
          </div>
        </div>
      )}
    </>
  );
}

export function CoachToggle({ editMode, setEditMode, syncStatus }) {
  const statusText = {
    checking: "Checking sync status...",
    synced: "Synced to the live site for everyone",
    "local-only": "Saved to this browser only — see README to enable real syncing",
  }[syncStatus] || "Saved to this browser only — see README to enable real syncing";

  return (
    <>
      <div className="edit-toggle-row">
        <button className={"btn btn-ghost btn-small" + (editMode ? " is-active" : "")} onClick={() => setEditMode(!editMode)}>
          {editMode ? <Unlock size={15} /> : <Lock size={15} />}
          {editMode ? "Coach Mode: On" : "Coach Mode: Off"}
        </button>
        {editMode && <span className="save-note">{statusText}</span>}
      </div>
      {editMode && syncStatus === "local-only" && (
        <p className="storage-note">Not synced yet — edits only show in this browser until the COACH_KV binding is set up (see functions/api/coach-overrides.js for the one-time setup).</p>
      )}
    </>
  );
}
