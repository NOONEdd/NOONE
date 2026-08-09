import { useState, useMemo } from "react";
import { useHashRoute } from "./hooks/useHashRoute.js";
import { useCoachOverrides } from "./hooks/useCoachOverrides.js";
import { CHAMPIONS } from "./data/champions.js";
import { ITEMS } from "./data/items.js";
import { RUNES } from "./data/runes.js";
import { STATIC_PATCH_VERSION } from "./data/patch.js";
import { resolveEffectiveChampion, resolveEffectiveItem, resolveEffectiveRune, resolveEffectivePatch } from "./lib/effectiveData.js";
import { NavBar, MobileMenu, Footer, BackToTop } from "./components/Layout.jsx";
import HomePage from "./pages/HomePage.jsx";
import { ChampionTierListPage, ItemTierListPage, RuneTierListPage } from "./pages/TierListPages.jsx";
import { GuidesPage, NotFoundPage } from "./pages/GuidesPage.jsx";
import ChampionDetailPage from "./pages/ChampionDetailPage.jsx";
import CoachingPage from "./pages/CoachingPage.jsx";
import AICoachPage from "./pages/AICoachPage.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

export default function App() {
  const route = useHashRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [overrides, updateOverride, syncStatus, auth, decisionTreeActions, updatePatch] = useCoachOverrides();

  // Same resolveEffective*() functions the AI Coach backend uses (see
  // functions/_lib/extractChampionContext.js, extractItemRuneContext.js)
  // -- one shared merge implementation, not two that can drift apart.
  // Only recompute when the actual override data changes — not on every
  // App render (menu open/close, route changes, editMode toggling, etc.
  // all used to force a full re-map of all 34/71/50 entries for no reason).
  const champions = useMemo(() => CHAMPIONS.map((c) => resolveEffectiveChampion(c, overrides.champions[c.id])), [overrides.champions]);
  const items = useMemo(() => ITEMS.map((i) => resolveEffectiveItem(i, overrides.items[i.id])), [overrides.items]);
  const runes = useMemo(() => RUNES.map((r) => resolveEffectiveRune(r, overrides.runes[r.id])), [overrides.runes]);
  const effectivePatch = useMemo(() => resolveEffectivePatch(overrides.patch, STATIC_PATCH_VERSION), [overrides.patch]);

  let content;
  if (route.page === "tierlist") {
    content = <ChampionTierListPage champions={champions} editMode={editMode} setEditMode={setEditMode} syncStatus={syncStatus} auth={auth}
      currentPatch={effectivePatch} onUpdatePatch={updatePatch}
      onUpdate={(id, patch) => updateOverride("champions", id, patch)} />;
  } else if (route.page === "items") {
    content = <ItemTierListPage items={items} editMode={editMode} setEditMode={setEditMode} syncStatus={syncStatus} auth={auth}
      currentPatch={effectivePatch} onUpdatePatch={updatePatch}
      onUpdate={(id, patch) => updateOverride("items", id, patch)} />;
  } else if (route.page === "runes") {
    content = <RuneTierListPage runes={runes} editMode={editMode} setEditMode={setEditMode} syncStatus={syncStatus} auth={auth}
      currentPatch={effectivePatch} onUpdatePatch={updatePatch}
      onUpdate={(id, patch) => updateOverride("runes", id, patch)} />;
  } else if (route.page === "guides") {
    content = <GuidesPage champions={champions} />;
  } else if (route.page === "guide-detail") {
    const champ = champions.find((c) => c.id === route.id);
    content = champ ? (
      <ChampionDetailPage
        champion={champ}
        editMode={editMode}
        setEditMode={setEditMode}
        syncStatus={syncStatus}
        auth={auth}
        decisionTrees={overrides.decisionTrees[champ.id] || []}
        onAddDecisionTree={() => decisionTreeActions.add(champ.id)}
        onUpdateDecisionTree={(entryId, content) => decisionTreeActions.update(champ.id, entryId, content)}
        onDeleteDecisionTree={(entryId) => decisionTreeActions.remove(champ.id, entryId)}
        onUpdateChampionBuilds={(newBuilds) => updateOverride("champions", champ.id, { builds: newBuilds })}
      />
    ) : <NotFoundPage />;
  } else if (route.page === "coaching") {
    content = <CoachingPage />;
  } else if (route.page === "ai-coach") {
    content = <AICoachPage currentPatch={effectivePatch} />;
  } else {
    content = <HomePage champions={champions} />;
  }

  return (
    <div className="app-root">
      <NavBar currentPage={route.page} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
      {menuOpen && <MobileMenu onNavigate={() => setMenuOpen(false)} />}
      <main><ErrorBoundary resetKey={JSON.stringify(route)}>{content}</ErrorBoundary></main>
      <Footer />
      <BackToTop />
    </div>
  );
}
