import { useState } from "react";
import { ROLE_ICONS, ROLE_COLORS, ITEM_ICONS, ITEM_COLORS, ITEM_CATEGORIES, RUNE_ICONS, RUNE_COLORS, RUNE_PATHS } from "../data/constants.js";
import { TierBoard, CoachToggle } from "../components/TierBoard.jsx";

export function ChampionTierListPage({ champions, editMode, setEditMode, onUpdate, syncStatus, auth }) {
  const entries = champions.map((c) => ({
    id: c.id, name: c.name, tag: c.role, tier: c.tier, note: c.note,
    icon: ROLE_ICONS[c.role], accent: ROLE_COLORS[c.role], clickable: true, _type: "c",
  }));
  return (
    <section className="page-section">
      <div className="wrap">
        <div className="section-head">
          <div className="eyebrow"><span className="dot" />Live Rankings</div>
          <h2>Support Champion Tier List</h2>
          <p>Coach-graded placements — toggle Coach Mode to adjust.</p>
        </div>
        <CoachToggle editMode={editMode} setEditMode={setEditMode} syncStatus={syncStatus} auth={auth} />
        <TierBoard entries={entries} editMode={editMode} onUpdate={onUpdate} />
      </div>
    </section>
  );
}

/** Shared by ItemTierListPage and RuneTierListPage below — both were
 *  previously near-identical copies of the same page shell (header,
 *  category filter pills, Coach Toggle, TierBoard), differing only in
 *  which field counts as the "category" and which icon/color maps apply.
 *  Consolidated here so a future change to that shell only needs to
 *  happen once. */
function FilterableTierListPage({ title, subtitle, entries: rawEntries, categories, iconMap, colorMap, getTag, editMode, setEditMode, onUpdate, syncStatus, auth, _type }) {
  const [filter, setFilter] = useState("All");
  const filtered = filter === "All" ? rawEntries : rawEntries.filter((e) => getTag(e) === filter);
  const entries = filtered.map((e) => ({
    id: e.id, name: e.name, tag: getTag(e), tier: e.tier, note: e.note, info: e.info,
    icon: iconMap[getTag(e)], accent: colorMap[getTag(e)], clickable: false, _type,
  }));
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
        <CoachToggle editMode={editMode} setEditMode={setEditMode} syncStatus={syncStatus} auth={auth} />
        <TierBoard entries={entries} editMode={editMode} onUpdate={onUpdate} />
      </div>
    </section>
  );
}

export function ItemTierListPage({ items, editMode, setEditMode, onUpdate, syncStatus, auth }) {
  return (
    <FilterableTierListPage
      title="Support Item Tier List"
      subtitle="Support, Defense, Boots, Enchant, Magic, and Physical items."
      entries={items}
      categories={ITEM_CATEGORIES}
      iconMap={ITEM_ICONS}
      colorMap={ITEM_COLORS}
      getTag={(i) => i.category}
      editMode={editMode}
      setEditMode={setEditMode}
      onUpdate={onUpdate}
      syncStatus={syncStatus}
      auth={auth}
      _type="i"
    />
  );
}

export function RuneTierListPage({ runes, editMode, setEditMode, onUpdate, syncStatus, auth }) {
  return (
    <FilterableTierListPage
      title="Support Rune Tier List"
      subtitle="Keystones and every minor rune path in Wild Rift."
      entries={runes}
      categories={RUNE_PATHS}
      iconMap={RUNE_ICONS}
      colorMap={RUNE_COLORS}
      getTag={(r) => r.path}
      editMode={editMode}
      setEditMode={setEditMode}
      onUpdate={onUpdate}
      syncStatus={syncStatus}
      auth={auth}
      _type="r"
    />
  );
}
