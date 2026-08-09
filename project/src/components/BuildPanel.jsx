import { X, Swords } from "lucide-react";
import SmartImage from "./SmartImage.jsx";

/** Renders the actual explanation content for whichever item/rune/spell is
 *  currently selected. An entry can carry any combination of:
 *   - `info` -> the factual description from the Item/Rune catalog data,
 *     always rendered first when present. This is the exact same text
 *     RankChip shows under a card in landscape/desktop mode (its
 *     `.chip-info`), so tapping a card on portrait mobile never loses that
 *     description -- it's just relocated into this panel instead.
 *   - Structured: any of `why`, `when`, `replace`, `notes` present -> each
 *     renders as its own labeled block.
 *   - Plain: just a `note` string -> rendered as one block. It only gets a
 *     "Notes" label when it's accompanying an `info` block (so it reads as
 *     a coach's add-on to the description above it); a lone `note` with no
 *     `info` -- the champion build board's only shape -- still renders
 *     exactly as before, no fabricated structure imposed on it.
 *  New champion content can use either shape; nothing needs migrating. */
export default function BuildPanel({ entry, paths, onClose }) {
  if (!entry) {
    return (
      <div className="build-panel build-panel-empty">
        <Swords size={22} style={{ color: "var(--text-dimmer)" }} />
        <p>Tap any item, rune, or spell to see why it's picked, when it's good, and when to swap it out.</p>
      </div>
    );
  }

  const hasStructured = entry.why || entry.when || entry.replace || entry.notes;

  return (
    <div className="build-panel">
      <div className="build-panel-head">
        <div className="build-panel-icon">
          {paths && paths.length > 0
            ? <SmartImage basePath={paths} alt={entry.name} className="build-panel-img" />
            : <Swords size={20} style={{ color: "var(--text-dimmer)" }} />}
        </div>
        <div>
          {entry.tag && <span className="build-row-tag">{entry.tag}</span>}
          <h3 className="build-panel-name">{entry.name}</h3>
        </div>
        {onClose && (
          <button className="build-panel-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="build-panel-body">
        {entry.info && <div className="build-panel-block"><p>{entry.info}</p></div>}
        {hasStructured ? (
          <>
            {entry.why && <div className="build-panel-block"><span className="build-panel-label">Why</span><p>{entry.why}</p></div>}
            {entry.when && <div className="build-panel-block"><span className="build-panel-label">When it's good</span><p>{entry.when}</p></div>}
            {entry.replace && <div className="build-panel-block"><span className="build-panel-label">When to swap it</span><p>{entry.replace}</p></div>}
            {entry.notes && <div className="build-panel-block"><span className="build-panel-label">Notes</span><p>{entry.notes}</p></div>}
          </>
        ) : (
          entry.note && (
            <div className="build-panel-block">
              {entry.info && <span className="build-panel-label">Notes</span>}
              <p>{entry.note}</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
