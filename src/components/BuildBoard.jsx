import { useState } from "react";
import { Pencil, Swords } from "lucide-react";
import { candidatePaths, slugify } from "../utils/images.js";
import { splitSpellNames } from "../data/spells.js";
import SmartImage from "./SmartImage.jsx";
import BuildPanel from "./BuildPanel.jsx";

function ChipIcon({ paths, size = 22 }) {
  const [failed, setFailed] = useState(false);
  if (!paths || paths.length === 0 || failed) {
    return <Swords size={size} style={{ color: "var(--text-dimmer)" }} />;
  }
  return <SmartImage basePath={paths} alt="" className="build-chip-img" onExhausted={() => setFailed(true)} />;
}

/** A single group (e.g. "Items" or "Runes & Spells") of compact, tappable
 *  chips. Spell-combo entries ("Flash + Ignite") expand into one chip per
 *  spell so each spell is independently clickable and shows its own icon. */
function ChipGroup({ label, entries, _type, activeKey, onSelect }) {
  if (!entries || entries.length === 0) return null;

  const chips = [];
  entries.forEach((e, i) => {
    const spellNames = e.tag === "Summoner Spells" ? splitSpellNames(e.name) : null;
    if (spellNames) {
      spellNames.forEach((n) => {
        const key = `spell:${i}:${n}`;
        chips.push({ key, name: n, tag: e.tag, note: e.note, paths: candidatePaths(`s:${slugify(n)}`) });
      });
    } else {
      const id = e.id || slugify(e.name);
      chips.push({ key: `${_type}:${i}:${id}`, ...e, paths: _type ? candidatePaths(`${_type}:${id}`) : [] });
    }
  });

  return (
    <div className="chip-group">
      {label && <h4 className="chip-group-label">{label}</h4>}
      <div className="chip-grid">
        {chips.map((c) => (
          <button
            key={c.key}
            className={"build-chip" + (activeKey === c.key ? " active" : "")}
            onClick={() => onSelect(c)}
          >
            <span className="build-chip-icon"><ChipIcon paths={c.paths} /></span>
            <span className="build-chip-name">{c.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function BuildBoard({ items, runes, emptyText }) {
  const [active, setActive] = useState(null); // the currently-selected chip's full data
  const [mobileOpen, setMobileOpen] = useState(false);

  const isEmpty = (!items || items.length === 0) && (!runes || runes.length === 0);

  function handleSelect(chip) {
    setActive(chip);
    setMobileOpen(true);
  }

  if (isEmpty) {
    return (
      <div className="placeholder-box">
        <Pencil size={16} />
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="build-board">
      <div className="build-board-chips">
        <ChipGroup label="Items" entries={items} _type="i" activeKey={active?.key} onSelect={handleSelect} />
        <ChipGroup label="Runes & Spells" entries={runes} _type="r" activeKey={active?.key} onSelect={handleSelect} />
      </div>

      {/* Desktop: sticky panel beside the grid, always visible, updates on click */}
      <div className="build-board-panel-desktop">
        <BuildPanel entry={active} paths={active?.paths} />
      </div>

      {/* Mobile: bottom-sheet overlay, only present once something's selected */}
      {mobileOpen && active && (
        <div className="build-sheet-backdrop" onClick={() => setMobileOpen(false)}>
          <div className="build-sheet" onClick={(e) => e.stopPropagation()}>
            <BuildPanel entry={active} paths={active?.paths} onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
