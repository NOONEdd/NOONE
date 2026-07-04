import { Lock, Unlock } from "lucide-react";
import { TIER_ORDER, TIER_COLORS } from "../data/constants.js";
import RankChip from "./RankChip.jsx";

export function TierBoard({ entries, editMode, onUpdate }) {
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
                <RankChip key={e.id} {...e} editMode={editMode} onUpdate={(patch) => onUpdate(e.id, patch)} mini />
              ))}
            </div>
          </div>
        );
      })}
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
