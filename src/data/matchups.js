// Base/default Champion Matchup relationships -- structured, canonical-
// Champion-ID-only edges (never names, never prose), keyed by championId
// exactly the same way functions/_lib/kv.js's overrides.champions is
// keyed, so the Coach Mode override layer below merges onto this with a
// simple object lookup, no scanning.
//
// This is a NEW, separate file from src/data/champions.js on purpose --
// champions.js's own per-champion `matchups` array (free-text {tag,
// name, note} prose, e.g. "Hard Into: Senna -- a skilled Senna
// outranges you...") is Academy's existing hand-written coaching
// commentary and stays exactly as-is; this file is the NEW structured
// system this project's Matchup redesign asked for (quick-glance
// Hard Against / Good Against / Good With tags, editable from Coach
// Mode without touching source code -- see src/components/
// ChampionMatchups.jsx and functions/api/coach-overrides.js).
//
// SEEDED, not duplicated: the entries below were migrated by parsing
// champions.js's existing "Hard Into"/"Strong With"-tagged prose
// entries (case/whitespace variants included) through the SAME
// findCanonicalId() resolver used everywhere else in the project
// (src/utils/images.js), keeping only entries where every name in the
// (comma-or-"and"-separated) list resolved to a REAL id already in
// CHAMPIONS. Two categories were deliberately left out of this
// migration, on purpose, not by omission:
//   1. Entries mixing a category description with a couple of
//      illustrative names in one prose sentence (e.g. "high mobility
//      champions or disengagers and enchanters like Janna or Karma") --
//      flattening that into a literal [janna, karma] list would
//      misrepresent a category as an exhaustive one, so these stayed
//      only in champions.js's prose, not duplicated here.
//   2. Names that ARE real, current Wild Rift champions (Lucian,
//      Draven, Miss Fortune, Samira, Vayne, Ezreal, Jinx, Kog'Maw,
//      Varus, Jhin, Camille, Orianna, Amumu, Brand, Syndra -- all
//      confirmed in the Phase 1 champion audit) but aren't in this
//      project's own 36-champion roster yet -- almost all of them
//      "Strong With" ADC/marksman synergy partners, which is exactly
//      why goodWith below is sparse compared to hardAgainst (support-
//      vs-support lane opponents ARE mostly already in the roster;
//      support-with-ADC synergy partners mostly aren't yet). These
//      will naturally become migratable the moment those champions are
//      added to src/data/champions.js -- nothing here needs to change
//      for that, since resolution already happens against the live
//      CHAMPIONS list, not a frozen snapshot.
//   3. `Catchers` (6 mentions) -- Academy's own role-category name
//      (compare CHAMPIONS' `role: "Catcher"` values), not a specific
//      champion, so it was never a valid target for a single-ID edge.
//
// goodAgainst has no seed data: no existing prose tag maps onto it
// cleanly (nothing in champions.js's matchups array was ever framed as
// "this matchup favors me"), so every champion starts with an empty
// goodAgainst list -- entirely new coaching judgment for Coach Mode to
// add going forward, not something to guess at from old data.
//
// Directional, not reciprocal (Champion Matchups redesign spec §7):
// leona.hardAgainst including "morgana" does NOT imply
// morgana.goodAgainst includes "leona" -- each champion's entry below
// was migrated independently from that champion's OWN prose, and
// Coach Mode edits (functions/api/coach-overrides.js) never auto-write
// the reverse side either.
export const MATCHUPS = {
  alistar: {"hardAgainst":["Morgana","janna","sett","thresh"],"goodAgainst":[],"goodWith":[]},
  blitzcrank: {"hardAgainst":["Morgana","janna","sett","zyra"],"goodAgainst":[],"goodWith":[]},
  braum: {"hardAgainst":["Morgana","karma","sett","zyra"],"goodAgainst":[],"goodWith":[]},
  galio: {"hardAgainst":[],"goodAgainst":[],"goodWith":["jarvan-iv"]},
  janna: {"hardAgainst":["senna"],"goodAgainst":[],"goodWith":[]},
  leona: {"hardAgainst":["Morgana","janna","sett","zyra"],"goodAgainst":[],"goodWith":[]},
  lulu: {"hardAgainst":["bard","senna"],"goodAgainst":[],"goodWith":[]},
  maokai: {"hardAgainst":["Morgana","janna","karma","sett"],"goodAgainst":[],"goodWith":[]},
  milio: {"hardAgainst":["senna"],"goodAgainst":[],"goodWith":[]},
  nami: {"hardAgainst":["senna"],"goodAgainst":[],"goodWith":[]},
  nautilus: {"hardAgainst":["Morgana","janna","sett","zyra"],"goodAgainst":[],"goodWith":[]},
  pyke: {"hardAgainst":["nautilus","thresh"],"goodAgainst":[],"goodWith":[]},
  rakan: {"hardAgainst":["janna","nautilus","thresh"],"goodAgainst":[],"goodWith":[]},
  rell: {"hardAgainst":["Morgana","janna","karma","sett","zyra"],"goodAgainst":[],"goodWith":[]},
  senna: {"hardAgainst":["nautilus","rakan","thresh"],"goodAgainst":[],"goodWith":[]},
  seraphine: {"hardAgainst":["nautilus","rakan","thresh"],"goodAgainst":[],"goodWith":[]},
  sona: {"hardAgainst":["senna"],"goodAgainst":[],"goodWith":[]},
  soraka: {"hardAgainst":["senna"],"goodAgainst":[],"goodWith":[]},
  swain: {"hardAgainst":["nautilus"],"goodAgainst":[],"goodWith":[]},
  thresh: {"hardAgainst":["Morgana","janna","sett","zyra"],"goodAgainst":[],"goodWith":[]},
  yuumi: {"hardAgainst":["senna"],"goodAgainst":[],"goodWith":[]},
};
