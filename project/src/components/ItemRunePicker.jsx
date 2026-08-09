import { useState, useMemo } from "react";
import { X, Search } from "lucide-react";
import { candidatePaths } from "../utils/images.js";
import { ChipIcon } from "./BuildBoard.jsx";

/** Searchable modal for picking a real item or rune from the catalog --
 *  used by BuildEditor's "Add item"/"Add rune" buttons and each row's
 *  "Pick" button. Always hands back the catalog entry's own `name` field
 *  verbatim (never a typed/guessed string), so findCanonicalId() (in
 *  images.js) resolves it with an exact match every time. The image
 *  shown here during picking is resolved the exact same way the real
 *  build page resolves it, so what you see here is what actually shows
 *  up afterward -- no surprises once you save. */
export default function ItemRunePicker({ type, catalog, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const typeChar = type === "item" ? "i" : "r";
  const label = type === "item" ? "items" : "runes";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((e) =>
      e.name.toLowerCase().includes(q) || (e.category || e.path || "").toLowerCase().includes(q)
    );
  }, [query, catalog]);

  return (
    <div className="build-sheet-backdrop picker-backdrop" onClick={onClose}>
      <div className="build-sheet picker-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <div className="picker-search">
            <Search size={15} />
            <input
              autoFocus
              type="text"
              placeholder={`Search ${label}...`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button type="button" className="picker-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="picker-grid">
          {filtered.map((entry) => (
            <button key={entry.id} type="button" className="picker-item" onClick={() => onPick(entry)}>
              <span className="picker-item-icon">
                <ChipIcon paths={candidatePaths(`${typeChar}:${entry.id}`)} />
              </span>
              <span className="picker-item-name">{entry.name}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="picker-empty">No {label} match "{query}".</p>}
        </div>
      </div>
    </div>
  );
}
