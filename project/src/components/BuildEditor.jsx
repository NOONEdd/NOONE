import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { candidatePaths, findCanonicalId } from "../utils/images.js";
import { ITEMS } from "../data/items.js";
import { RUNES } from "../data/runes.js";
import { ChipIcon } from "./BuildBoard.jsx";
import ItemRunePicker from "./ItemRunePicker.jsx";

const CATALOG_BY_TYPE = { i: ITEMS, r: RUNES };

/** Resolves a row's current (possibly hand-typed) name to an image the
 *  exact same way BuildBoard does for the real, read-only build display --
 *  so the live preview here never lies about what will actually render. */
function rowPaths(_type, name) {
  if (!name) return [];
  const id = findCanonicalId(name, CATALOG_BY_TYPE[_type]);
  return id ? candidatePaths(`${_type}:${id}`) : [];
}

function EditableRow({ entry, _type, onChange, onDelete }) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="build-edit-row">
      <div className="build-edit-row-top">
        <span className="build-edit-row-icon"><ChipIcon paths={rowPaths(_type, entry.name)} /></span>
        <input
          type="text"
          className="build-edit-name"
          placeholder={_type === "i" ? "Item name..." : "Rune name, or a spell combo like 'Flash + Heal'..."}
          value={entry.name || ""}
          onChange={(e) => onChange({ ...entry, name: e.target.value })}
        />
        <button type="button" className="btn btn-ghost btn-small build-edit-pick-btn" onClick={() => setPickerOpen(true)}>
          Pick
        </button>
        <input
          type="text"
          className="build-edit-tag"
          placeholder="Tag"
          value={entry.tag || ""}
          onChange={(e) => onChange({ ...entry, tag: e.target.value })}
        />
        <button type="button" className="build-edit-delete-btn" onClick={onDelete} aria-label="Delete this row">
          <Trash2 size={14} />
        </button>
      </div>
      <textarea
        className="build-edit-note"
        placeholder="Why / when to take this..."
        value={entry.note || ""}
        onChange={(e) => onChange({ ...entry, note: e.target.value })}
      />
      {pickerOpen && (
        <ItemRunePicker
          type={_type === "i" ? "item" : "rune"}
          catalog={CATALOG_BY_TYPE[_type]}
          onPick={(picked) => {
            // Only fill the tag if this row didn't already have one --
            // picking a replacement item shouldn't wipe out a tag you'd
            // already set. Runes default to their real path (Keystone,
            // Resolve, etc.); items default to "Core" as the most common case.
            onChange({ ...entry, name: picked.name, tag: entry.tag || picked.path || "Core" });
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

function AddRowButtons({ _type, onAdd }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="build-edit-add-row">
      <button type="button" className="btn btn-primary btn-small" onClick={() => setPickerOpen(true)}>
        <Plus size={14} /> Add {_type === "i" ? "item" : "rune"}
      </button>
      <button type="button" className="btn btn-ghost btn-small" onClick={() => onAdd({ tag: "", name: "", note: "" })}>
        <Plus size={14} /> Custom entry
      </button>
      {pickerOpen && (
        <ItemRunePicker
          type={_type === "i" ? "item" : "rune"}
          catalog={CATALOG_BY_TYPE[_type]}
          onPick={(picked) => {
            onAdd({ tag: picked.path || "Core", name: picked.name, note: "" });
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/** editMode replacement for BuildBoard on a champion's Build tab. Manages
 *  full add/remove/edit for builds themselves (rename, add a new named
 *  build, delete one) and for each build's item/rune rows. Every change
 *  calls onChangeBuilds(newFullArray) immediately -- same controlled-
 *  component pattern as everything else in Coach Mode, so it inherits the
 *  exact same debounced KV-safe sync for free; nothing new to reason
 *  about there. */
export default function BuildEditor({ builds, selectedBuild, onSelectBuild, onChangeBuilds }) {
  const build = builds[selectedBuild] || builds[0];

  function updateBuild(patch) {
    onChangeBuilds(builds.map((b, i) => (i === selectedBuild ? { ...b, ...patch } : b)));
  }
  function updateRow(section, index, newEntry) {
    const list = [...(build[section] || [])];
    list[index] = newEntry;
    updateBuild({ [section]: list });
  }
  function deleteRow(section, index) {
    updateBuild({ [section]: (build[section] || []).filter((_, i) => i !== index) });
  }
  function addRow(section, entry) {
    updateBuild({ [section]: [...(build[section] || []), entry] });
  }
  function addBuild() {
    onChangeBuilds([...builds, { name: `New Build ${builds.length + 1}`, items: [], runes: [] }]);
    onSelectBuild(builds.length);
  }
  function deleteBuild() {
    if (builds.length <= 1) return; // always keep at least one build so the tab is never empty
    onChangeBuilds(builds.filter((_, i) => i !== selectedBuild));
    onSelectBuild(0);
  }

  return (
    <div className="build-editor">
      <div className="build-editor-name-row">
        <input
          type="text"
          className="build-editor-name-input"
          value={build.name}
          onChange={(e) => updateBuild({ name: e.target.value })}
        />
        <button type="button" className="btn btn-ghost btn-small" onClick={addBuild}>
          <Plus size={14} /> New build
        </button>
        {builds.length > 1 && (
          <button type="button" className="btn btn-ghost btn-small build-edit-delete-btn" onClick={deleteBuild}>
            <Trash2 size={14} /> Delete this build
          </button>
        )}
      </div>

      <h4 className="chip-group-label">Items</h4>
      {(build.items || []).map((entry, i) => (
        <EditableRow key={i} entry={entry} _type="i" onChange={(e) => updateRow("items", i, e)} onDelete={() => deleteRow("items", i)} />
      ))}
      <AddRowButtons _type="i" onAdd={(entry) => addRow("items", entry)} />

      <h4 className="chip-group-label" style={{ marginTop: 24 }}>Runes</h4>
      {(build.runes || []).map((entry, i) => (
        <EditableRow key={i} entry={entry} _type="r" onChange={(e) => updateRow("runes", i, e)} onDelete={() => deleteRow("runes", i)} />
      ))}
      <AddRowButtons _type="r" onAdd={(entry) => addRow("runes", entry)} />
    </div>
  );
}
