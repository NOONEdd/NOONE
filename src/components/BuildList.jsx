import { useState } from "react";
import { Pencil, Swords } from "lucide-react";
import { basePath } from "../utils/images.js";
import SmartImage from "./SmartImage.jsx";

function BuildRowIcon({ path, name }) {
  const [failed, setFailed] = useState(false);
  if (!path || failed) {
    return <div className="build-row-icon-placeholder"><Swords size={16} style={{ color: "var(--text-dimmer)" }} /></div>;
  }
  return <SmartImage basePath={path} alt={name} className="build-row-icon" onExhausted={() => setFailed(true)} />;
}

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
        const path = _type ? basePath(`${_type}:${id}`) : null;
        return (
          <div className="build-row" key={i}>
            {_type && <BuildRowIcon path={path} name={e.name} />}
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
