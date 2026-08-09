import { useState } from "react";
import { Pencil, Swords } from "lucide-react";
import { candidatePaths, slugify, findCanonicalId } from "../utils/images.js";
import { splitSpellNames } from "../data/spells.js";
import { CHAMPIONS } from "../data/champions.js";
import SmartImage from "./SmartImage.jsx";

const CANONICAL_BY_TYPE = { c: CHAMPIONS };

function BuildRowIcon({ paths, name }) {
  const [failed, setFailed] = useState(false);
  if (!paths || paths.length === 0 || failed) {
    return <div className="build-row-icon-placeholder"><Swords size={16} style={{ color: "var(--text-dimmer)" }} /></div>;
  }
  return <SmartImage basePath={paths} alt={name} className="build-row-icon" onExhausted={() => setFailed(true)} />;
}

function SpellChips({ names }) {
  return (
    <div className="spell-chip-row">
      {names.map((n) => (
        <div className="spell-chip" key={n}>
          <BuildRowIcon paths={candidatePaths(`s:${slugify(n)}`)} name={n} />
          <span>{n}</span>
        </div>
      ))}
    </div>
  );
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
      {entries.map((e) => {
        const spellNames = /spell/i.test(e.tag || "") ? splitSpellNames(e.name) : null;
        const canonicalList = CANONICAL_BY_TYPE[_type];
        const id = e.id || (canonicalList ? findCanonicalId(e.name, canonicalList) : slugify(e.name));
        const paths = _type ? candidatePaths(`${_type}:${id}`) : [];
        return (
          <div className="build-row" key={`${_type || "x"}:${id}`}>
            {spellNames ? (
              <SpellChips names={spellNames} />
            ) : (
              _type && <BuildRowIcon paths={paths} name={e.name} />
            )}
            {e.tag && <span className="build-row-tag">{e.tag}</span>}
            <div className="build-row-body">
              {!spellNames && <div className="build-row-name">{e.name}</div>}
              {e.note && <div className="build-row-note">{e.note}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
