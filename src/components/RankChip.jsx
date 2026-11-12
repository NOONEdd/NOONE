import { navigate } from "../hooks/useHashRoute.js";
import { TIER_SELECT, FALLBACK_DISPLAY, tierDisplay } from "../data/constants.js";
import { safeIcon } from "../lib/displayRegistry.js";
import { candidatePaths } from "../utils/images.js";
import SmartImage from "./SmartImage.jsx";

export default function RankChip({ id, name, tag, tier, note, info, icon, accent, editMode, onUpdate, clickable, mini, _type, onTapForDetail, hideTierBadge }) {
  const badgeDark = tier === "Unranked" ? "#aab0d4" : "#04050c";
  const paths = _type ? candidatePaths(`${_type}:${id}`) : [];

  function handleClick() {
    if (editMode) return;
    if (clickable) { navigate(`/guides/${id}`); return; }
    if (onTapForDetail) onTapForDetail({ id, name, tag, tier, note, info, paths });
  }
  // Callers resolve `icon` / `accent` through the display registries (src/data/constants.js), which already guarantee a
  // valid component -- this is defense in depth: an invalid `icon` prop (undefined, an icon NAME string, ...) renders the
  // neutral fallback and is reported once, instead of crashing the whole page with React error #130.
  const context = { entityId: id, entityName: name, type: _type };
  const Icon = safeIcon(icon, FALLBACK_DISPLAY.icon, { component: "RankChip", subject: tag ?? "(no tag)", context });
  const tierBadge = tierDisplay(tier, context);
  const tierKnown = TIER_SELECT.includes(tier);
  return (
    <div
      className={"rank-chip" + (mini ? " mini" : "") + (clickable && !editMode ? "" : " not-clickable")}
      style={{ "--accent": accent || FALLBACK_DISPLAY.color }}
      onClick={editMode ? undefined : handleClick}
    >
      {!hideTierBadge && (
        <span className="tier-badge" style={{ background: tierBadge.color, color: badgeDark }}>
          {tier === "Unranked" ? "—" : tier}
        </span>
      )}
      <span className="chip-tag">{tag}</span>
      <div className="chip-icon-wrap">
        <Icon size={26} />
        {paths.length > 0 && <SmartImage basePath={paths} alt={name} className="chip-portrait" />}
      </div>
      <div className="chip-name">{name}</div>
      {!editMode && info && <div className="chip-info">{info}</div>}
      {!editMode && note ? <div className="chip-note">{note}</div> : null}
      {editMode && (
        <div className="edit-fields" onClick={(e) => e.stopPropagation()}>
          <select value={tier ?? ""} onChange={(e) => onUpdate({ tier: e.target.value, note, info })}>
            {/* a tier this select does not offer (e.g. a hand-edited override) stays visible and selectable, so it can be corrected here */}
            {!tierKnown && <option value={tier ?? ""}>{tier ?? "(none)"} (unrecognized)</option>}
            {TIER_SELECT.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {(_type === "i" || _type === "r") && (
            <textarea
              className="edit-info-field"
              placeholder="Passive / stats — update this the moment a patch changes the numbers, no rebuild needed"
              value={info || ""}
              onChange={(e) => onUpdate({ tier, note, info: e.target.value })}
            />
          )}
          <input
            type="text"
            placeholder="Quick note..."
            value={note || ""}
            onChange={(e) => onUpdate({ tier, note: e.target.value, info })}
          />
        </div>
      )}
    </div>
  );
}
