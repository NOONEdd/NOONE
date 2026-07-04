import { useState } from "react";
import { useHashRoute } from "./hooks/useHashRoute.js";
import { useCoachOverrides } from "./hooks/useCoachOverrides.js";
import { CHAMPIONS } from "./data/champions.js";
import { ITEMS } from "./data/items.js";
import { RUNES } from "./data/runes.js";
import { NavBar, MobileMenu, Footer, BackToTop } from "./components/Layout.jsx";
import HomePage from "./pages/HomePage.jsx";
import { ChampionTierListPage, ItemTierListPage, RuneTierListPage } from "./pages/TierListPages.jsx";
import { GuidesPage, NotFoundPage } from "./pages/GuidesPage.jsx";
import ChampionDetailPage from "./pages/ChampionDetailPage.jsx";
import CoachingPage from "./pages/CoachingPage.jsx";
import AICoachPage from "./pages/AICoachPage.jsx";

export default function App() {
  const route = useHashRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [overrides, updateOverride] = useCoachOverrides();

  const champions = CHAMPIONS.map((c) => {
    const o = overrides.champions[c.id];
    return { ...c, tier: o?.tier || c.tier || "Unranked", note: o?.note || c.blurb, items: c.items || [], runes: c.runes || [], matchups: c.matchups || [] };
  });
  const items = ITEMS.map((i) => {
    const o = overrides.items[i.id];
    return { ...i, tier: o?.tier || "Unranked", note: o?.note || "" };
  });
  const runes = RUNES.map((r) => {
    const o = overrides.runes[r.id];
    return { ...r, tier: o?.tier || "Unranked", note: o?.note || "" };
  });

  let content;
  if (route.page === "tierlist") {
    content = <ChampionTierListPage champions={champions} editMode={editMode} setEditMode={setEditMode}
      onUpdate={(id, patch) => updateOverride("champions", id, patch)} />;
  } else if (route.page === "items") {
    content = <ItemTierListPage items={items} editMode={editMode} setEditMode={setEditMode}
      onUpdate={(id, patch) => updateOverride("items", id, patch)} />;
  } else if (route.page === "runes") {
    content = <RuneTierListPage runes={runes} editMode={editMode} setEditMode={setEditMode}
      onUpdate={(id, patch) => updateOverride("runes", id, patch)} />;
  } else if (route.page === "guides") {
    content = <GuidesPage champions={champions} />;
  } else if (route.page === "guide-detail") {
    const champ = champions.find((c) => c.id === route.id);
    content = champ ? <ChampionDetailPage champion={champ} /> : <NotFoundPage />;
  } else if (route.page === "coaching") {
    content = <CoachingPage />;
  } else if (route.page === "ai-coach") {
    content = <AICoachPage />;
  } else {
    content = <HomePage champions={champions} />;
  }

  return (
    <div className="app-root">
      <NavBar currentPage={route.page} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      {menuOpen && <MobileMenu onNavigate={() => setMenuOpen(false)} />}
      <main>{content}</main>
      <Footer />
      <BackToTop />
    </div>
  );
}
