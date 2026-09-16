import { useState } from "react";
import { Plus, Trash2, GripVertical, ChevronUp, ChevronDown } from "lucide-react";
import { candidatePaths, findCanonicalId } from "../utils/images.js";
import { ITEMS } from "../data/items.js";
import { RUNES } from "../data/runes.js";
import { ChipIcon } from "./BuildBoard.jsx";
import ItemRunePicker from "./ItemRunePicker.jsx";
import { normalizeBuildEntries } from "../lib/buildTypeClassifier.js";

const CATALOG_BY_TYPE = { i: ITEMS, r: RUNES };

/** Resolves a row's current (possibly hand-typed) name to an image the
 *  exact same way BuildBoard does for the real, read-only build display --
 *  so the live preview here never lies about what will actually render. */
function rowPaths(_type, name) {
  if (!name) return [];
  const id = findCanonicalId(name, CATALOG_BY_TYPE[_type]);
  return id ? candidatePaths(`${_type}:${id}`) : [];
}

/** Pure array-move helper for drag reordering. `toIndex` is the position
 *  (in the array as it looked BEFORE the move) of the row the dragged
 *  entry was dropped on; `isAfter` says whether the drop landed on that
 *  row's lower half (insert after it) or upper half (insert before it) --
 *  see EditableRow's onDragOver below. The `fromIndex < insertAt`
 *  adjustment accounts for the classic splice off-by-one: removing the
 *  dragged item first shifts every later index down by one, so a target
 *  computed against the original array needs a -1 correction whenever
 *  the drag started above it. Also used for the Move up/down buttons,
 *  which just call this with toIndex = index +/- 1. */
function reorderList(list, fromIndex, toIndex, isAfter) {
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  let insertAt = isAfter ? toIndex + 1 : toIndex;
  if (fromIndex < insertAt) insertAt -= 1;
  insertAt = Math.max(0, Math.min(insertAt, next.length));
  next.splice(insertAt, 0, moved);
  return next;
}

function EditableRow({
  entry, _type, index, total, onChange, onDelete,
  isDragging, dropIndicator, onDragHandleStart, onRowDragOver, onRowDrop, onDragEnd, onMoveUp, onMoveDown,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const rowClass = "build-edit-row"
    + (isDragging ? " dragging" : "")
    + (dropIndicator === "before" ? " drag-over-top" : "")
    + (dropIndicator === "after" ? " drag-over-bottom" : "");

  return (
    <div className={rowClass} onDragOver={onRowDragOver} onDrop={onRowDrop} onDragEnd={onDragEnd}>
      <div className="build-edit-row-top">
        <span
          className="build-edit-drag-handle"
          draggable
          onDragStart={onDragHandleStart}
          onDragEnd={onDragEnd}
          aria-label="Drag to reorder"
          title="Drag to reorder"
        >
          <GripVertical size={15} />
        </span>
        <span className="build-edit-reorder-btns">
          <button type="button" className="build-edit-reorder-btn" onClick={onMoveUp} disabled={index === 0} aria-label="Move up">
            <ChevronUp size={13} />
          </button>
          <button type="button" className="build-edit-reorder-btn" onClick={onMoveDown} disabled={index === total - 1} aria-label="Move down">
            <ChevronDown size={13} />
          </button>
        </span>
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
        <div className="build-edit-type-toggle" role="group" aria-label="Core or situational">
          <button
            type="button"
            className={"build-edit-type-btn core" + (entry.type === "core" ? " active" : "")}
            onClick={() => onChange({ ...entry, type: "core" })}
          >
            Core
          </button>
          <button
            type="button"
            className={"build-edit-type-btn situational" + (entry.type === "situational" ? " active" : "")}
            onClick={() => onChange({ ...entry, type: "situational" })}
          >
            Situational
          </button>
        </div>
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
      <button type="button" className="btn btn-ghost btn-small" onClick={() => onAdd({ tag: "", type: "core", name: "", note: "" })}>
        <Plus size={14} /> Custom entry
      </button>
      {pickerOpen && (
        <ItemRunePicker
          type={_type === "i" ? "item" : "rune"}
          catalog={CATALOG_BY_TYPE[_type]}
          onPick={(picked) => {
            onAdd({ tag: picked.path || "Core", type: "core", name: picked.name, note: "" });
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
 *  about there.
 *
 *  Items and Runes reordering: `drag` tracks which row is currently being
 *  dragged as { section, from }; `dragOver` tracks the row currently
 *  hovered as { section, index, isAfter }. Both are scoped by `section`
 *  ("items" | "runes") so a row from one list is never a valid drop
 *  target for the other -- handleRowDragOver bails out immediately (no
 *  preventDefault, so the browser shows its native "not droppable"
 *  cursor) whenever the active drag's section doesn't match the row
 *  being hovered. Reordering always calls updateBuild(), the exact same
 *  path every other build edit already uses, so a drag/drop (or a Move
 *  up/down click) is persisted through Coach Mode's existing debounced
 *  KV sync with no new storage mechanism. */
export default function BuildEditor({ builds, selectedBuild, onSelectBuild, onChangeBuilds }) {
  const build = builds[selectedBuild] || builds[0];
  const [drag, setDrag] = useState(null); // { section, from } -- row currently being dragged
  const [dragOver, setDragOver] = useState(null); // { section, index, isAfter } -- current hover target

  function updateBuild(patch) {
    onChangeBuilds(
      builds.map((b, i) => {
        if (i !== selectedBuild) return b;
        // Every save is run through the exact same classifier the admin
        // migration uses (src/lib/buildTypeClassifier.js) -- not just when
        // a row is added. This is what stops a future champion's static
        // entries (added without `type`) from getting permanently baked
        // into a fresh, typeless KV override the first time anyone edits
        // that build for an unrelated reason (a reorder, a note fix, a
        // rename). normalizeBuildEntries always preserves an already-valid
        // `type` untouched -- it only ever fills a gap, never overwrites a
        // manual Core/Situational choice or reclassifies an already-typed
        // entry. Same function, same rule, same updateOverride persistence
        // path below -- nothing new introduced here.
        return normalizeBuildEntries({ ...b, ...patch }).build;
      })
    );
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
  function moveRow(section, index, delta) {
    const list = build[section] || [];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    // Moving down should land the row just after its new neighbor (isAfter
    // true), moving up just before it (isAfter false) -- passing the same
    // isAfter for both directions was a no-op on "move down" (it re-landed
    // the row back where it started; caught by a manual reorderList test
    // against the A/B/C/D spec example before shipping this).
    updateBuild({ [section]: reorderList(list, index, target, delta > 0) });
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

  function handleDragHandleStart(section, index, e) {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    setDrag({ section, from: index });
  }
  function handleRowDragOver(section, index, e) {
    if (!drag || drag.section !== section) return; // different list (or nothing being dragged) -- not a valid drop target
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const isAfter = e.clientY - rect.top > rect.height / 2;
    setDragOver({ section, index, isAfter });
  }
  function handleRowDrop(section, index, e) {
    e.preventDefault();
    if (drag && drag.section === section) {
      const isAfter = dragOver && dragOver.section === section && dragOver.index === index ? dragOver.isAfter : false;
      updateBuild({ [section]: reorderList(build[section] || [], drag.from, index, isAfter) });
    }
    setDrag(null);
    setDragOver(null);
  }
  function handleDragEnd() {
    setDrag(null);
    setDragOver(null);
  }

  function renderRows(section, _type) {
    const list = build[section] || [];
    return list.map((entry, i) => {
      const showIndicator = drag && drag.section === section && dragOver && dragOver.section === section && dragOver.index === i;
      return (
        <EditableRow
          key={i}
          entry={entry}
          _type={_type}
          index={i}
          total={list.length}
          onChange={(e) => updateRow(section, i, e)}
          onDelete={() => deleteRow(section, i)}
          isDragging={Boolean(drag && drag.section === section && drag.from === i)}
          dropIndicator={showIndicator ? (dragOver.isAfter ? "after" : "before") : null}
          onDragHandleStart={(e) => handleDragHandleStart(section, i, e)}
          onRowDragOver={(e) => handleRowDragOver(section, i, e)}
          onRowDrop={(e) => handleRowDrop(section, i, e)}
          onDragEnd={handleDragEnd}
          onMoveUp={() => moveRow(section, i, -1)}
          onMoveDown={() => moveRow(section, i, 1)}
        />
      );
    });
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
      {renderRows("items", "i")}
      <AddRowButtons _type="i" onAdd={(entry) => addRow("items", entry)} />

      <h4 className="chip-group-label" style={{ marginTop: 24 }}>Runes</h4>
      {renderRows("runes", "r")}
      <AddRowButtons _type="r" onAdd={(entry) => addRow("runes", entry)} />
    </div>
  );
}
