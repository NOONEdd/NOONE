import { useState, useEffect } from "react";
import { Lock, Unlock } from "lucide-react";
import { TIER_ORDER, TIER_COLORS } from "../data/constants.js";
import { PatchStatusPill } from "./PatchStatus.jsx";
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

/** Coach Mode's on-page toggle + (when unlocked) the live patch editor.
 *
 * SECURITY NOTE (see README's "Safe Browsing cleanup" section for the
 * full story): this used to also contain a hidden-by-default reveal
 * (`?coach` in the URL, remembered via localStorage) and its own
 * password-prompt form, both rendered directly on public tier list
 * pages. Both are gone. There is now exactly ONE place a password is
 * ever entered anywhere in this app: the login form at #/admin
 * (src/pages/AdminPage.jsx), which posts to a real server-side session
 * endpoint (functions/api/admin/login.js). This component now does
 * nothing but read `auth.isAuthorized` (itself only ever true because
 * the server already verified a valid session cookie -- see
 * src/hooks/useCoachOverrides.js) and, if so, show the same in-place
 * editing controls Coach Mode always had. A visitor who never logs in
 * at #/admin never sees so much as a lock icon on any public page. */
export function CoachToggle({ editMode, setEditMode, syncStatus, auth, currentPatch, onUpdatePatch, patchStatus, patchVerification }) {
  const [patchInput, setPatchInput] = useState(currentPatch || "");

  // Stay in sync if the effective patch changes from elsewhere (e.g. a
  // page reload after another device set it).
  useEffect(() => {
    setPatchInput(currentPatch || "");
  }, [currentPatch]);

  function handlePatchChange(e) {
    const value = e.target.value;
    setPatchInput(value);
    onUpdatePatch?.(value);
  }

  const statusText = {
    checking: "Checking sync status...",
    syncing: "Saving...",
    synced: "Synced to the live site for everyone",
    "local-only": "Saved to this browser only — see README to enable real syncing",
  }[syncStatus] || "Saved to this browser only — see README to enable real syncing";

  function handleToggleClick() {
    setEditMode(!editMode); // no password prompt here anymore -- being here at all already means auth.isAuthorized is true
  }

  // The one and only gate: a verified admin session. No reveal
  // mechanism, no hidden URL param, no on-page password form -- see the
  // component comment above. `|| editMode` is a defensive fallback so
  // an active edit session's own off-switch (and the sync-status note)
  // can never disappear mid-use even in an edge case where the session
  // check on load raced with something else.
  if (!auth?.isAuthorized && !editMode) return null;

  return (
    <>
      <div className="edit-toggle-row">
        <button className={"btn btn-ghost btn-small" + (editMode ? " is-active" : "")} onClick={handleToggleClick}>
          {editMode ? <Unlock size={15} /> : <Lock size={15} />}
          {editMode ? "Coach Mode: On" : "Coach Mode: Off"}
        </button>
        {editMode && <span className="save-note">{statusText}</span>}
      </div>

      {editMode && onUpdatePatch && (
        <div className="coach-password-prompt patch-editor-row">
          <label htmlFor="coach-patch-input" className="save-note">Current patch:</label>
          <input
            id="coach-patch-input"
            type="text"
            value={patchInput}
            onChange={handlePatchChange}
            placeholder="e.g. 7.3"
          />
          {patchStatus && <PatchStatusPill status={patchStatus} />}
          {patchVerification && (
            <div className="patch-verify-actions">
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => patchVerification.markVerified(patchInput)}
                disabled={!patchInput || patchStatus === "verified"}
                title="Confirms Academy data has been manually reviewed for this exact patch"
              >
                Mark verified
              </button>
              <button
                type="button"
                className={"btn btn-ghost btn-small" + (patchStatus === "updating" ? " is-active" : "")}
                onClick={() => patchVerification.setUpdating(patchStatus !== "updating")}
              >
                {patchStatus === "updating" ? "Updating: On" : "Mark as updating"}
              </button>
            </div>
          )}
          <span className="storage-note" style={{ margin: 0 }}>
            Shown site-wide and used by the AI Coach. Clear the field to fall back to the version shipped in the code. Changing the patch number always drops verification back to "not yet reviewed" until you explicitly mark it verified again — see Patch Intelligence at #/patch-intelligence for a Support-focused breakdown of what changed.
          </span>
        </div>
      )}

      {editMode && syncStatus === "local-only" && (
        <p className="storage-note">Not synced yet — edits only show in this browser until the COACH_KV binding is set up (see functions/api/coach-overrides.js for the one-time setup).</p>
      )}
    </>
  );
}
