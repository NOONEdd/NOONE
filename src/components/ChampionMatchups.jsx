import { useState } from "react";
import { Plus, X } from "lucide-react";
import { navigate } from "../hooks/useHashRoute.js";
import { candidatePaths } from "../utils/images.js";
import { ChipIcon } from "./BuildBoard.jsx";
import ItemRunePicker from "./ItemRunePicker.jsx";

const CATEGORIES = [
  { key: "hardAgainst", label: "Hard Against" },
  { key: "goodAgainst", label: "Good Against" },
  { key: "goodWith", label: "Good With" },
];

/** One clickable champion pill inside a matchup category. Resolves its
 *  image the EXACT same way every other champion image on the site
 *  does -- candidatePaths() + <SmartImage> via the shared ChipIcon
 *  (src/components/BuildBoard.jsx), from the id alone. Matchup data
 *  only ever stores canonical Champion IDs (redesign spec §1/§10), so
 *  there is no name lookup and no second image mapping here at all.
 *  Clicking navigates to that champion's own page via the site's
 *  existing route (#/guides/:id, src/hooks/useHashRoute.js) -- same
 *  navigate() the page's own "All Champions" back-link already uses.
 *  The remove ("x") control is a SIBLING button, not nested inside the
 *  navigate button, so this never produces an invalid <button> inside
 *  a <button>; only rendered at all when `onRemove` is passed (i.e.
 *  only in Coach Mode -- public visitors never see it). */
function MatchupPill({ championId, roster, onRemove }) {
  const champ = roster.find((c) => c.id === championId);
  // Still renders something sane (the raw id) instead of silently
  // vanishing if a stored id somehow isn't in the live roster right
  // now (e.g. a champion later removed from champions.js) -- the
  // relationship stays visible/editable rather than disappearing
  // without explanation.
  const name = champ ? champ.name : championId;
  return (
    <div className="matchup-pill">
      <button type="button" className="matchup-pill-main" onClick={() => navigate(`/guides/${championId}`)}>
        <span className="matchup-pill-icon"><ChipIcon paths={candidatePaths(`c:${championId}`)} size={22} /></span>
        <span className="matchup-pill-name">{name}</span>
      </button>
      {onRemove && (
        <button type="button" className="matchup-pill-remove" onClick={onRemove} aria-label={`Remove ${name}`}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/** "+ Add champion" -- opens the SAME searchable picker BuildEditor
 *  uses for items/runes (src/components/ItemRunePicker.jsx, extended
 *  with a "champion" type rather than duplicated), fed the site's live
 *  champion roster as its catalog. Nothing here is a hardcoded list:
 *  whatever's currently in src/data/champions.js is what's searchable
 *  (redesign spec §2). Excludes champions already in this category
 *  (no duplicate relationship within a category, spec §5/§9) and this
 *  champion itself (a champion can't have a matchup relationship with
 *  itself). */
function AddMatchupButton({ roster, selfId, excludeIds, onAdd }) {
  const [open, setOpen] = useState(false);
  const pickable = roster.filter((c) => c.id !== selfId && !excludeIds.includes(c.id));
  return (
    <>
      <button type="button" className="btn btn-ghost btn-small matchup-add-btn" onClick={() => setOpen(true)}>
        <Plus size={13} /> Add champion
      </button>
      {open && (
        <ItemRunePicker
          type="champion"
          catalog={pickable}
          onPick={(picked) => { onAdd(picked.id); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function MatchupCategory({ label, ids, roster, selfId, editMode, onAdd, onRemove }) {
  return (
    <div className="matchup-relation-group">
      <h4 className="chip-group-label">{label}</h4>
      <div className="matchup-pill-row">
        {ids.map((id) => (
          <MatchupPill key={id} championId={id} roster={roster} onRemove={editMode ? () => onRemove(id) : null} />
        ))}
        {editMode && <AddMatchupButton roster={roster} selfId={selfId} excludeIds={ids} onAdd={onAdd} />}
      </div>
      {!editMode && ids.length === 0 && <p className="matchup-empty-note">None noted yet.</p>}
    </div>
  );
}

/** Structured Champion vs. Champion relationships (Hard Against / Good
 *  Against / Good With) for one champion's Matchups tab -- see
 *  src/pages/ChampionDetailPage.jsx, which renders this ABOVE the
 *  existing free-text matchup notes (src/components/BuildList.jsx +
 *  champions.js's own `matchups` prose array), untouched, not replaced.
 *  This is the NEW structured system the Champion Matchups redesign
 *  asked for: quick-glance, canonical-Champion-ID-only, editable from
 *  Coach Mode without touching source code.
 *
 *  `matchupRelations`: this champion's already-resolved {hardAgainst,
 *  goodAgainst, goodWith} object -- src/lib/effectiveData.js's
 *  resolveEffectiveChampion() already merged the Coach Mode KV override
 *  onto the src/data/matchups.js seed before this component ever sees
 *  it; nothing is merged here.
 *  `roster`: the site's live champion list (same array RankChip/
 *  BuildEditor/etc. already use) -- used only to resolve each id's
 *  name/image, and as the Add-champion picker's dynamic catalog.
 *  `onChange(nextMatchupRelations)`: called with the COMPLETE next
 *  {hardAgainst,goodAgainst,goodWith} object on every add/remove --
 *  the same controlled-component pattern onChangeBuilds already uses
 *  for the Build tab, so this inherits the exact same debounced,
 *  KV-quota-safe Coach Mode sync for free (src/hooks/
 *  useCoachOverrides.js's existing generic update()) -- no new
 *  persistence code anywhere in this file. */
export default function ChampionMatchups({ championId, matchupRelations, roster, editMode, onChange }) {
  const relations = matchupRelations || { hardAgainst: [], goodAgainst: [], goodWith: [] };

  function addTo(categoryKey, targetId) {
    const current = relations[categoryKey] || [];
    if (current.includes(targetId)) return; // duplicate within the same category -- safely ignored, not an error (spec §5/§9)
    onChange({ ...relations, [categoryKey]: [...current, targetId] });
  }
  function removeFrom(categoryKey, targetId) {
    onChange({ ...relations, [categoryKey]: (relations[categoryKey] || []).filter((id) => id !== targetId) });
  }

  return (
    <div className="matchup-relations">
      {CATEGORIES.map(({ key, label }) => (
        <MatchupCategory
          key={key}
          label={label}
          ids={relations[key] || []}
          roster={roster}
          selfId={championId}
          editMode={editMode}
          onAdd={(targetId) => addTo(key, targetId)}
          onRemove={(targetId) => removeFrom(key, targetId)}
        />
      ))}
    </div>
  );
}
