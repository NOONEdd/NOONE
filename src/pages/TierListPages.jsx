import { useState } from "react";
import { ROLE_ICONS, ROLE_COLORS, ITEM_ICONS, ITEM_COLORS, ITEM_CATEGORIES, RUNE_ICONS, RUNE_COLORS, RUNE_PATHS } from "../data/constants.js";
import { TierBoard, CoachToggle } from "../components/TierBoard.jsx";

export function ChampionTierListPage({ champions, editMode, setEditMode, onUpdate }) {
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
        <CoachToggle editMode={editMode} setEditMode={setEditMode} />
        <TierBoard entries={entries} editMode={editMode} onUpdate={onUpdate} />
      </div>
    </section>
  );
}

export function ItemTierListPage({ items, editMode, setEditMode, onUpdate }) {
  const [filter, setFilter] = useState("All");
  const filtered = filter === "All" ? items : items.filter((i) => i.category === filter);
  const entries = filtered.map((i) => ({
    id: i.id, name: i.name, tag: i.category, tier: i.tier, note: i.note, info: i.info,
    icon: ITEM_ICONS[i.category], accent: ITEM_COLORS[i.category], clickable: false, _type: "i",
  }));
  return (
    <section className="page-section">
      <div className="wrap">
        <div className="section-head">
          <div className="eyebrow"><span className="dot" />Live Rankings</div>
          <h2>Support Item Tier List</h2>
          <p>Support, Defense, Boots, Enchant, Magic, and Physical items.</p>
        </div>
        <div className="filter-pills">
          <button className={"filter-pill" + (filter === "All" ? " active" : "")} onClick={() => setFilter("All")}>All</button>
          {ITEM_CATEGORIES.map((c) => (
            <button key={c} className={"filter-pill" + (filter === c ? " active" : "")} onClick={() => setFilter(c)}>{c}</button>
          ))}
        </div>
        <CoachToggle editMode={editMode} setEditMode={setEditMode} />
        <TierBoard entries={entries} editMode={editMode} onUpdate={onUpdate} />
      </div>
    </section>
  );
}

export function RuneTierListPage({ runes, editMode, setEditMode, onUpdate }) {
  const [filter, setFilter] = useState("All");
  const filtered = filter === "All" ? runes : runes.filter((r) => r.path === filter);
  const entries = filtered.map((r) => ({
    id: r.id, name: r.name, tag: r.path, tier: r.tier, note: r.note, info: r.info,
    icon: RUNE_ICONS[r.path], accent: RUNE_COLORS[r.path], clickable: false, _type: "r",
  }));
  return (
    <section className="page-section">
      <div className="wrap">
        <div className="section-head">
          <div className="eyebrow"><span className="dot" />Live Rankings</div>
          <h2>Support Rune Tier List</h2>
          <p>Keystones and every minor rune path in Wild Rift.</p>
        </div>
        <div className="filter-pills">
          <button className={"filter-pill" + (filter === "All" ? " active" : "")} onClick={() => setFilter("All")}>All</button>
          {RUNE_PATHS.map((p) => (
            <button key={p} className={"filter-pill" + (filter === p ? " active" : "")} onClick={() => setFilter(p)}>{p}</button>
          ))}
        </div>
        <CoachToggle editMode={editMode} setEditMode={setEditMode} />
        <TierBoard entries={entries} editMode={editMode} onUpdate={onUpdate} />
      </div>
    </section>
  );
}
