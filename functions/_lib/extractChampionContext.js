import { MAX_DECISION_TREE_ENTRIES, MAX_DECISION_TREE_CHARS } from "./config.js";

/** Given one championId, returns a compact object with ONLY that
 *  champion's relevant data -- never the whole 30+ champion roster. Merges
 *  in any live Coach Mode override the exact same way App.jsx does for
 *  the actual site display (override wins when present, otherwise the
 *  static baseline from champions.js), so the AI is never grounded in
 *  something different from what visitors are currently looking at.
 *  Falls back to the champion's flat items/runes fields for the handful
 *  of champions that don't have a populated `builds` array yet -- the
 *  exact same fallback ChampionDetailPage.jsx already uses for display. */
export function extractChampionContext(championId, champions, overrides) {
  const champion = champions.find((c) => c.id === championId);
  if (!champion) return null;

  const o = overrides?.champions?.[championId];
  const tier = o?.tier || champion.tier || "Unranked";
  const note = o?.note || champion.blurb || "";
  const builds = o?.builds && o.builds.length > 0
    ? o.builds
    : (champion.builds && champion.builds.length > 0)
      ? champion.builds
      : [{ name: "Default", items: champion.items || [], runes: champion.runes || [] }];

  return {
    id: champion.id,
    name: champion.name,
    role: champion.role,
    tier,
    note,
    builds: builds.map((b) => ({
      name: b.name,
      items: (b.items || []).map((i) => `${i.tag}: ${i.name} — ${i.note || ""}`.trim()),
      runes: (b.runes || []).map((r) => `${r.tag}: ${r.name} — ${r.note || ""}`.trim()),
    })),
    matchups: (champion.matchups || []).map((m) => `${m.tag}: ${m.name} — ${m.note || ""}`.trim()),
  };
}

/** Lighter-weight than extractChampionContext -- the enemy only needs
 *  identification (name, role) plus whatever specific matchup note the
 *  primary champion's own data already has about them, not their entire
 *  build. Keeps the prompt compact instead of pulling two full champions'
 *  worth of data for every matchup question. */
export function extractEnemyContext(enemyId, champions, primaryChampionContext) {
  const enemy = champions.find((c) => c.id === enemyId);
  if (!enemy) return null;

  const relevantMatchupNote = primaryChampionContext?.matchups.find((m) =>
    m.toLowerCase().includes(enemy.name.toLowerCase())
  ) || null;

  return { id: enemy.id, name: enemy.name, role: enemy.role, relevantMatchupNote };
}

/** Live Coach Mode decision-tree entries for this champion (see
 *  src/components/DecisionTreePanel.jsx, src/hooks/useCoachOverrides.js).
 *  These have no static baseline in champions.js -- they exist ONLY as
 *  KV overrides, written freeform in Coach Mode. Capped in count and
 *  per-entry length (functions/_lib/config.js) so one heavily-annotated
 *  champion can't balloon the prompt for a question about them. */
export function extractDecisionTrees(championId, overrides) {
  const entries = overrides?.decisionTrees?.[championId] || [];
  return entries
    .slice(0, MAX_DECISION_TREE_ENTRIES)
    .map((e) => (e.content || "").slice(0, MAX_DECISION_TREE_CHARS).trim())
    .filter(Boolean);
}
