import { useState } from "react";
import { Plus, X } from "lucide-react";
import { navigate } from "../hooks/useHashRoute.js";
import { candidatePaths } from "../utils/images.js";
import { ChipIcon } from "./BuildBoard.jsx";
import ItemRunePicker from "./ItemRunePicker.jsx";

const CATEGORIES = [
  { key: "hardAgainst", label: "Hard Against", emptyText: "No significant hard matchups recorded yet." },
  { key: "goodAgainst", label: "Good Against", emptyText: "No significant favorable matchups recorded yet." },
  { key: "goodWith", label: "Good With", emptyText: "No synergy partners recorded yet." },
];
const DIFFICULTIES = ["low", "medium", "high"];
// Reused from the site's existing palette (RED already means "aggressive
// /danger" for Assassin Catcher/Physical items/Domination runes; GOLD
// already means "notable" for S-tier/Keystone; CYAN already means
// "mild/defensive" for Warden/Defense items/Precision runes) rather than
// inventing new colors for this one scale.
const DIFFICULTY_COLORS = { high: "#ff6b6b", medium: "#f3c969", low: "#1fd0ff" };

/** One matchup relationship -- a champion pill plus its difficulty and
 *  reason. Two render modes:
 *   - Read (public / Coach Mode toggled off): image, name, a small
 *     difficulty badge, and the reason as smaller/dimmer secondary text
 *     underneath (redesign spec §5 -- "visually secondary to the
 *     Champion name but still easy to read", never admin-only metadata).
 *   - Edit (Coach Mode on): same image/name (still clickable to
 *     navigate), plus a difficulty <select> and a reason <textarea>,
 *     both direct controlled inputs wired straight to onChange -- same
 *     pattern src/components/BuildEditor.jsx's EditableRow already uses
 *     for item/rune notes, so this inherits the exact same debounced
 *     Coach Mode save (src/hooks/useCoachOverrides.js) with no new
 *     persistence code.
 *  Image resolution is identical to every other champion image on the
 *  site: candidatePaths() + <SmartImage> via the shared ChipIcon
 *  (src/components/BuildBoard.jsx), from championId alone -- matchup
 *  data never stores a name or an image path (redesign spec §2/§11). */
function MatchupEntryRow({ entry, roster, editMode, onEdit, onRemove }) {
  const champ = roster.find((c) => c.id === entry.championId);
  const name = champ ? champ.name : entry.championId; // still shows something sane rather than vanishing if the id isn't in the live roster right now
  const color = DIFFICULTY_COLORS[entry.difficulty] || DIFFICULTY_COLORS.medium;

  return (
    <div className="matchup-entry">
      <div className="matchup-entry-head">
        <button type="button" className="matchup-pill-main" onClick={() => navigate(`/guides/${entry.championId}`)}>
          <span className="matchup-pill-icon"><ChipIcon paths={candidatePaths(`c:${entry.championId}`)} size={22} /></span>
          <span className="matchup-pill-name">{name}</span>
        </button>

        {editMode ? (
          <select
            className="matchup-difficulty-select"
            value={entry.difficulty}
            onChange={(e) => onEdit({ ...entry, difficulty: e.target.value })}
            style={{ "--accent": color }}
          >
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        ) : (
          <span className="matchup-difficulty-badge" style={{ "--accent": color }}>{entry.difficulty}</span>
        )}

        {editMode && (
          <button type="button" className="matchup-pill-remove" onClick={onRemove} aria-label={`Remove ${name}`}>
            <X size={13} />
          </button>
        )}
      </div>

      {editMode ? (
        <textarea
          className="matchup-reason-input"
          placeholder="Why? (optional, shown to visitors)"
          value={entry.reason || ""}
          onChange={(e) => onEdit({ ...entry, reason: e.target.value || null })}
          rows={2}
        />
      ) : (
        entry.reason && <p className="matchup-reason-text">{entry.reason}</p>
      )}
    </div>
  );
}

/** "+ Add champion" -- same searchable picker BuildEditor uses for
 *  items/runes (src/components/ItemRunePicker.jsx, extended with a
 *  "champion" type rather than duplicated), fed the site's live champion
 *  roster. Never a hardcoded list -- whatever's currently in
 *  src/data/champions.js is what's searchable (redesign spec §1/§2 --
 *  now the full multi-role roster, not just Support). Excludes
 *  champions already in this category (no duplicate relationship within
 *  a category) and this champion itself (no self-matchups). New entries
 *  start at difficulty "medium" (the most neutral starting point, not a
 *  guess at severity) with no reason -- edited immediately afterward. */
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
          onPick={(picked) => { onAdd({ championId: picked.id, difficulty: "medium", reason: null }); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function MatchupCategory({ label, emptyText, entries, roster, selfId, editMode, onAdd, onEdit, onRemove }) {
  return (
    <div className="matchup-relation-group">
      <h4 className="chip-group-label">{label}</h4>
      <div className="matchup-entry-list">
        {entries.map((entry, i) => (
          <MatchupEntryRow
            key={entry.championId}
            entry={entry}
            roster={roster}
            editMode={editMode}
            onEdit={(next) => onEdit(i, next)}
            onRemove={() => onRemove(i)}
          />
        ))}
        {!editMode && entries.length === 0 && <p className="matchup-empty-note">{emptyText}</p>}
      </div>
      {editMode && (
        <AddMatchupButton roster={roster} selfId={selfId} excludeIds={entries.map((e) => e.championId)} onAdd={onAdd} />
      )}
    </div>
  );
}

/** Structured Champion vs. Champion relationships (Hard Against / Good
 *  Against / Good With), each with a difficulty and an optional written
 *  reason -- see src/pages/ChampionDetailPage.jsx, where this is the
 *  ONLY Matchups content now (the old free-text prose system and its
 *  rendering were removed project-wide in Phase 3 -- see
 *  src/data/champions.js and src/lib/effectiveData.js).
 *
 *  `matchupRelations`: this champion's already-resolved
 *  {hardAgainst,goodAgainst,goodWith} object, each an array of
 *  {championId, difficulty, reason} -- src/lib/effectiveData.js's
 *  resolveEffectiveChampion() already merged the Coach Mode KV override
 *  onto the src/data/matchups.js seed (and normalized either the current
 *  or Phase 2's older bare-id-array shape to this one) before this
 *  component ever sees it; nothing is merged or normalized here.
 *  `roster`: the site's live champion list (now the full multi-role
 *  roster, not just Support) -- used only to resolve each id's name/
 *  image, and as the Add-champion picker's dynamic catalog.
 *  `onChange(nextMatchupRelations)`: called with the COMPLETE next
 *  {hardAgainst,goodAgainst,goodWith} object on every add/remove/edit --
 *  the same controlled-component pattern onChangeBuilds already uses,
 *  so this inherits the exact same debounced, KV-quota-safe Coach Mode
 *  sync (src/hooks/useCoachOverrides.js's existing generic update())
 *  with no new persistence code anywhere in this file. */
export default function ChampionMatchups({ championId, matchupRelations, roster, editMode, onChange }) {
  const relations = matchupRelations || { hardAgainst: [], goodAgainst: [], goodWith: [] };

  function addTo(categoryKey, entry) {
    const current = relations[categoryKey] || [];
    if (current.some((e) => e.championId === entry.championId)) return; // duplicate within the same category -- safely ignored, not an error
    onChange({ ...relations, [categoryKey]: [...current, entry] });
  }
  function editIn(categoryKey, index, nextEntry) {
    const current = relations[categoryKey] || [];
    onChange({ ...relations, [categoryKey]: current.map((e, i) => (i === index ? nextEntry : e)) });
  }
  function removeFrom(categoryKey, index) {
    const current = relations[categoryKey] || [];
    onChange({ ...relations, [categoryKey]: current.filter((_, i) => i !== index) });
  }

  return (
    <div className="matchup-relations">
      {CATEGORIES.map(({ key, label, emptyText }) => (
        <MatchupCategory
          key={key}
          label={label}
          emptyText={emptyText}
          entries={relations[key] || []}
          roster={roster}
          selfId={championId}
          editMode={editMode}
          onAdd={(entry) => addTo(key, entry)}
          onEdit={(i, next) => editIn(key, i, next)}
          onRemove={(i) => removeFrom(key, i)}
        />
      ))}
    </div>
  );
}
