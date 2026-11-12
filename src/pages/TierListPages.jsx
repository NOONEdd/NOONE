import { useState } from "react";
import { ITEM_CATEGORIES, RUNE_PATHS, roleDisplay, itemCategoryDisplay, runePathDisplay } from "../data/constants.js";
import { TierBoard, CoachToggle } from "../components/TierBoard.jsx";

export function ChampionTierListPage({ champions, editMode, setEditMode, onUpdate, syncStatus, auth, currentPatch, onUpdatePatch, patchStatus, patchVerification }) {
  // roleDisplay() always returns a renderable icon + color (neutral fallback for a role with no registry entry, reported once)
  const entries = champions.map((c) => {
    const role = roleDisplay(c.role, { dataset: "champions", entityId: c.id, entityName: c.name });
    return {
      id: c.id, name: c.name, tag: c.role, tier: c.tier, note: c.note,
      icon: role.icon, accent: role.color, clickable: true, _type: "c",
    };
  });
  return (
    <section className="page-section">
      <div className="wrap">
        <div className="section-head">
          <div className="eyebrow"><span className="dot" />Live Rankings</div>
          <h2>Support Champion Tier List</h2>
          <p>Coach-graded placements — toggle Coach Mode to adjust.</p>
        </div>
        <CoachToggle editMode={editMode} setEditMode={setEditMode} syncStatus={syncStatus} auth={auth} currentPatch={currentPatch} onUpdatePatch={onUpdatePatch} patchStatus={patchStatus} patchVerification={patchVerification} />
        <TierBoard entries={entries} editMode={editMode} onUpdate={onUpdate} />
      </div>
    </section>
  );
}

/** Shared by ItemTierListPage and RuneTierListPage below — both were
 *  previously near-identical copies of the same page shell (header,
 *  category filter pills, Coach Toggle, TierBoard), differing only in
 *  which field counts as the "category" and which display registry applies
 *  (`display`: itemCategoryDisplay / runePathDisplay from src/data/constants.js).
 *  Consolidated here so a future change to that shell only needs to
 *  happen once. */
function FilterableTierListPage({ title, subtitle, entries: rawEntries, categories: registeredCategories, display, dataset, getTag, editMode, setEditMode, onUpdate, syncStatus, auth, currentPatch, onUpdatePatch, patchStatus, patchVerification, _type }) {
  const [filter, setFilter] = useState("All");
  // A category present in the data but missing from the registry still gets a filter pill (after the registered ones), so
  // no entry is ever unreachable by filtering; the registry miss itself is reported by display() and by the mapping tests.
  const categories = [...registeredCategories, ...new Set(rawEntries.map(getTag).filter((c) => typeof c === "string" && c && !registeredCategories.includes(c)))];
  const filtered = filter === "All" ? rawEntries : rawEntries.filter((e) => getTag(e) === filter);
  const entries = filtered.map((e) => {
    const shown = display(getTag(e), { dataset, entityId: e.id, entityName: e.name });
    return {
      id: e.id, name: e.name, tag: getTag(e), tier: e.tier, note: e.note, info: e.info,
      icon: shown.icon, accent: shown.color, clickable: false, _type,
    };
  });
  return (
    <section className="page-section">
      <div className="wrap">
        <div className="section-head">
          <div className="eyebrow"><span className="dot" />Live Rankings</div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="filter-pills">
          <button className={"filter-pill" + (filter === "All" ? " active" : "")} onClick={() => setFilter("All")}>All</button>
          {categories.map((c) => (
            <button key={c} className={"filter-pill" + (filter === c ? " active" : "")} onClick={() => setFilter(c)}>{c}</button>
          ))}
        </div>
        <CoachToggle editMode={editMode} setEditMode={setEditMode} syncStatus={syncStatus} auth={auth} currentPatch={currentPatch} onUpdatePatch={onUpdatePatch} patchStatus={patchStatus} patchVerification={patchVerification} />
        <TierBoard entries={entries} editMode={editMode} onUpdate={onUpdate} />
      </div>
    </section>
  );
}

export function ItemTierListPage({ items, editMode, setEditMode, onUpdate, syncStatus, auth, currentPatch, onUpdatePatch, patchStatus, patchVerification }) {
  return (
    <FilterableTierListPage
      title="Support Item Tier List"
      subtitle="Support, Defense, Boots, Enchant, Magic, and Physical items."
      entries={items}
      categories={ITEM_CATEGORIES}
      display={itemCategoryDisplay}
      dataset="items"
      getTag={(i) => i.category}
      editMode={editMode}
      setEditMode={setEditMode}
      onUpdate={onUpdate}
      syncStatus={syncStatus}
      auth={auth}
      currentPatch={currentPatch}
      onUpdatePatch={onUpdatePatch}
      patchStatus={patchStatus}
      patchVerification={patchVerification}
      _type="i"
    />
  );
}

export function RuneTierListPage({ runes, editMode, setEditMode, onUpdate, syncStatus, auth, currentPatch, onUpdatePatch, patchStatus, patchVerification }) {
  return (
    <FilterableTierListPage
      title="Support Rune Tier List"
      subtitle="Keystones and every minor rune path in Wild Rift."
      entries={runes}
      categories={RUNE_PATHS}
      display={runePathDisplay}
      dataset="runes"
      getTag={(r) => r.path}
      editMode={editMode}
      setEditMode={setEditMode}
      onUpdate={onUpdate}
      syncStatus={syncStatus}
      auth={auth}
      currentPatch={currentPatch}
      onUpdatePatch={onUpdatePatch}
      patchStatus={patchStatus}
      patchVerification={patchVerification}
      _type="r"
    />
  );
}
