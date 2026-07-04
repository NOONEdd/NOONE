import { Pencil, Swords } from "lucide-react";
import { imgPath } from "../utils/images.js";

export default function BuildList({ entries, emptyText, _type }) {
  if (!entries || entries.length === 0) {
    return (
      <div className="placeholder-box">
        <Pencil size={16} />
        <p>{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="build-list">
      {entries.map((e, i) => {
        const id = e.id || e.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const src = _type ? imgPath(`${_type}:${id}`) : null;
        return (
          <div className="build-row" key={i}>
            {src ? (
              <img src={src} alt={e.name} className="build-row-icon" onError={(ev) => { ev.currentTarget.style.display = "none"; }} />
            ) : _type ? (
              <div className="build-row-icon-placeholder"><Swords size={16} style={{ color: "var(--text-dimmer)" }} /></div>
            ) : null}
            {e.tag && <span className="build-row-tag">{e.tag}</span>}
            <div className="build-row-body">
              <div className="build-row-name">{e.name}</div>
              {e.note && <div className="build-row-note">{e.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
