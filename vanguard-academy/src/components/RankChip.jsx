import { navigate } from "../hooks/useHashRoute.js";
import { TIER_COLORS, TIER_SELECT } from "../data/constants.js";
import { imgPath } from "../utils/images.js";

export default function RankChip({ id, name, tag, tier, note, info, icon: Icon, accent, editMode, onUpdate, clickable, mini, _type }) {
  const badgeDark = tier === "Unranked" ? "#aab0d4" : "#04050c";
  const src = _type ? imgPath(`${_type}:${id}`) : null;

  return (
    <div
      className={"rank-chip" + (mini ? " mini" : "") + (clickable && !editMode ? "" : " not-clickable")}
      style={{ "--accent": accent }}
      onClick={editMode || !clickable ? undefined : () => navigate(`/guides/${id}`)}
    >
      <span className="tier-badge" style={{ background: TIER_COLORS[tier], color: badgeDark }}>
        {tier === "Unranked" ? "—" : tier}
      </span>
      <span className="chip-tag">{tag}</span>
      <div className="chip-icon-wrap">
        <Icon size={26} />
        {src && (
          <img
            src={src}
            alt=""
            className="chip-portrait"
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        )}
      </div>
      <div className="chip-name">{name}</div>
      {info && <div className="chip-info">{info}</div>}
      {!editMode && note ? <div className="chip-note">{note}</div> : null}
      {editMode && (
        <div className="edit-fields" onClick={(e) => e.stopPropagation()}>
          <select value={tier} onChange={(e) => onUpdate({ tier: e.target.value, note })}>
            {TIER_SELECT.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input
            type="text"
            placeholder="Quick note..."
            value={note || ""}
            onChange={(e) => onUpdate({ tier, note: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
