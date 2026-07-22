import { useState, useRef, useEffect } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

// A decision-tree entry is stored as one freeform `content` string --
// no separate title field, so writing one is just "start typing," which
// is the entire point (no VS Code, no per-field form-filling, no lag).
// The first line becomes the heading for display; everything after the
// first newline is the body, rendered with the line breaks the coach
// actually typed (same white-space:pre-wrap convention already used for
// AI Coach chat messages elsewhere in this file's CSS).
function splitTitleAndBody(content) {
  const text = content || "";
  const idx = text.indexOf("\n");
  if (idx === -1) return { title: text, body: "" };
  return { title: text.slice(0, idx), body: text.slice(idx + 1) };
}

export default function DecisionTreePanel({ championName, entries, editMode, onAdd, onUpdate, onDelete }) {
  const list = entries || [];
  const [focusId, setFocusId] = useState(null);
  const textareaRefs = useRef({});

  useEffect(() => {
    if (focusId && textareaRefs.current[focusId]) {
      textareaRefs.current[focusId].focus();
      setFocusId(null);
    }
  }, [focusId, list.length]);

  function handleAdd() {
    setFocusId(onAdd());
  }

  if (!editMode && list.length === 0) {
    return (
      <div className="placeholder-box">
        <Pencil size={16} />
        <p>No decision trees written yet for {championName}.</p>
      </div>
    );
  }

  return (
    <div className="decision-tree-list">
      {list.map((entry) => {
        const { title, body } = splitTitleAndBody(entry.content);
        return (
          <div className="decision-tree-entry" key={entry.id}>
            {editMode ? (
              <div className="decision-tree-edit-row">
                <textarea
                  ref={(el) => { textareaRefs.current[entry.id] = el; }}
                  className="decision-tree-textarea"
                  placeholder={"First line is the heading -- e.g. \"vs heavy poke lane\". Write the branches below: if X, take Y; if Z instead, go W..."}
                  value={entry.content}
                  onChange={(e) => onUpdate(entry.id, e.target.value)}
                />
                <div className="decision-tree-actions">
                  <button type="button" className="btn btn-ghost btn-small decision-tree-delete-btn" onClick={() => onDelete(entry.id)}>
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="decision-tree-title">{title || "Untitled scenario"}</div>
                {body && <div className="decision-tree-body">{body}</div>}
              </>
            )}
          </div>
        );
      })}

      {editMode && (
        <button type="button" className="btn btn-primary btn-small decision-tree-add-btn" onClick={handleAdd}>
          <Plus size={14} /> Add scenario
        </button>
      )}
    </div>
  );
}
