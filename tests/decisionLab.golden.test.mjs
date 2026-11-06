// decisionLab -- golden tests (Phase 6, revised for rules.2).
//
//   node tests/decisionLab.golden.test.mjs
//
// Hand-specified scenarios with exact expected deterministic evaluations:
// tier and score per option, the outcome chain, the best set, and the factor
// signal for each possible choice. Expected values were derived by hand from
// the rule table and then confirmed against the engine.
//
// WHAT THESE ARE AND ARE NOT. They are ENGINE goldens: behavioural
// regression tests that lock the DRAFT Objective Trade rule table
// (rules.status === "DRAFT") to my reading of the SCENARIOS spec principles.
// They are NOT coach-verified Wild Rift game truth. COACH_GOLDENS below is
// intentionally empty: the template stays DRAFT (and unservable) until the
// coach supplies and approves cases that establish game truth.
//
// "valid: true" cases pass the full validator (usable as coach-crafted
// scenarios). "valid: false" cases are EVALUATION-ONLY: they isolate one
// behaviour and fail only educational (edu.*) invariants -- never structure,
// state, decision or public ones.
//
// Groups: [1] basics  [2] TRADE's four components  [3] fightability
// [4] SETUP's definition  [5] SITUATIONAL and uncertainty  [6] signal
// calibration  [7] relationships  [8] the draft gate.

import { craft, setPath, moveAllies, neutralRaw, FIXTURE_CONSTANTS as C, createHarness } from "./decisionLab.fixtures.mjs";
import { evaluateAnswer } from "../functions/_lib/decisionLab/evaluator.js";
import { isServable } from "../functions/_lib/decisionLab/validator.js";
import { OBJECTIVE_TRADE_TEMPLATE as T, preconditionOf } from "../functions/_lib/decisionLab/templates/objectiveTrade.js";
import { deriveState, accessLevel, crossMapLevel, visionLevel, fightabilityOf, infoQualityOf } from "../functions/_lib/decisionLab/relationships.js";
import { stableStringify } from "../functions/_lib/decisionLab/fingerprint.js";
import { INVARIANT_IDS } from "../functions/_lib/decisionLab/invariants.js";
import { FACTORS } from "../functions/_lib/decisionLab/factors.js";
import { CERTAINTY } from "../functions/_lib/decisionLab/config.js";

const { check, finish } = createHarness();
export const COACH_GOLDENS = []; // to be authored/approved by the coach; see header

// ---- state helpers (all relative to neutralRaw(): every factor neutral) -------------------
const STRONG_ACCESS = (r) => moveAllies(r, ["baron", "jungle"], "mid"); // all 5 arrive (jungler too); holding the pit stays 2 v 1 (even)
const HIGH = (r, team) => { r.teams[team].composition = { burst: "high", crowdControl: "high", engage: "high" }; };
const LOW = (r, team) => { r.teams[team].composition = { burst: "low", crowdControl: "low", engage: "low" }; };
const items = (r, team, n) => { for (const s of Object.keys(r.teams[team].members)) r.teams[team].members[s].completedItems = n; };
const hold = (r) => moveAllies(r, ["baron", "jungle", "mid"], "bot_side"); // allies hold the pit 5 v 1
const takingDragon = (r) => {
  setPath(r, "objectives.dragon.availableInSec", 0); setPath(r, "objectives.dragon.status", "available"); setPath(r, "objectives.dragon.activity", "enemy_taking"); setPath(r, "objectives.riftHerald.availableInSec", 8);
  const E = r.teams.enemies.members;
  for (const s of ["mid", "jungle", "support"]) if (E[s].status === "alive") E[s].zone = "bot_side"; // the enemy who can be there is at the pit
};
// TRADE base: Dragon is low-value; we hold the Herald side with three; the enemy is committed to the pit; nobody can answer at Herald.
const T0 = (r) => {
  setPath(r, "objectives.dragon.stakes", "low"); moveAllies(r, ["baron", "jungle", "mid"], "top_side");
  const E = r.teams.enemies.members;
  E.baron.status = "dead"; E.baron.zone = "base"; E.baron.hpBand = "none";
  E.jungle.status = "recalling"; E.jungle.zone = "base"; E.jungle.hpBand = "low";
  E.mid.zone = "bot_side"; E.support.zone = "bot_side";
};
const CT = ["CONTEST", "TRADE"];
const SG = ["SETUP", "GIVE"];

const G = [
  // ---------------------------------------------------------------- [1] basics
  {
    id: "A1", group: 1, principle: "objective_priority_is_access_based", title: "Contest when access and value line up",
    spec: { structure: "CONTEST_VS_TRADE", actions: CT, difficulty: 2, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "high"); STRONG_ACCESS(r); } },
    valid: true, active: { objective_value: "high", team_access: "strong" },
    tiers: { contest: "STRONG", trade: "WEAK" }, scores: { contest: 14, trade: -14 }, best: ["contest"],
    chains: { contest: ["objective_secured", "no_major_change", "map_access_improved"], trade: ["trade_unfavorable", "no_major_change", "map_access_worsened"] },
    signals: { contest: { objective_value: "positive", team_access: "positive" }, trade: { objective_value: "strong_negative", team_access: "negative" } },
    alignment: { contest: "aligned", trade: "divergent" },
  },
  {
    id: "A2", group: 1, principle: "giving_an_objective_can_be_correct", title: "Give a low-value objective the team cannot reach (SETUP is available: nobody has committed yet)",
    spec: { structure: "SETUP_VS_GIVE", actions: SG, difficulty: 2, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "low"); moveAllies(r, ["baron", "jungle", "mid", "dragon"], "top_side"); } },
    valid: true, active: { objective_value: "low", team_access: "weak" },
    tiers: { setup: "WEAK", give: "VIABLE" }, scores: { setup: -14, give: 0 }, best: ["give"],
    chains: { setup: ["setup_punished", "no_major_change", "map_access_worsened"], give: ["objective_conceded_cheaply", "no_major_change", "map_access_unchanged"] },
    signals: { setup: { objective_value: "negative", team_access: "negative" }, give: { objective_value: "positive", team_access: "positive" } },
    alignment: { setup: "divergent", give: "aligned" },
  },
  // ---------------------------------------------------------------- [2] TRADE
  {
    id: "T0", group: 2, principle: "objective_trade", title: "TRADE base: a cheap concession for a real gain nobody can punish",
    spec: { structure: "CONTEST_VS_TRADE", actions: CT, difficulty: 2, mutate: T0 },
    valid: true, active: { objective_value: "low", cross_map_trade: "strong" },
    tiers: { contest: "WEAK", trade: "STRONG" }, scores: { contest: -5, trade: 14 }, best: ["trade"],
    chains: { contest: ["objective_lost_with_losses", "no_major_change", "map_access_worsened"], trade: ["trade_favorable", "no_major_change", "map_access_improved"] },
    tradeTerms: { s1: { trade_gain: 2, objective_value: 0, enemy_access: 0, trade_punish: 0 }, s2: { turret_pressure: 0, wave_consequences: 0, trade_punish_spill: 0 } },
    signals: { contest: { objective_value: "negative", cross_map_trade: "strong_negative" }, trade: { objective_value: "no_signal", cross_map_trade: "strong_positive" } },
  },
  {
    id: "T1", group: 2, principle: "objective_trade", title: "VALUE GIVEN UP: the same trade when the primary is worth more than the alternative (evaluation-only)",
    spec: { structure: "CONTEST_VS_TRADE", actions: CT, difficulty: 2, mutate: (r) => { T0(r); setPath(r, "objectives.dragon.stakes", "high"); } },
    valid: false, active: { objective_value: "high", cross_map_trade: "strong" },
    tiers: { contest: "VIABLE", trade: "WEAK" }, scores: { contest: 5, trade: -14 }, best: ["contest"],
    chains: { contest: ["objective_secured_with_losses", "no_major_change", "map_access_improved"], trade: ["trade_unfavorable", "no_major_change", "map_access_worsened"] },
    tradeTerms: { s1: { trade_gain: 0, objective_value: -2, enemy_access: 0, trade_punish: 0 }, s2: { turret_pressure: 0, wave_consequences: 0, trade_punish_spill: 0 } },
    signals: { contest: { objective_value: "positive", cross_map_trade: "no_signal" }, trade: { objective_value: "strong_negative", cross_map_trade: "no_signal" } },
  },
  {
    id: "T2", group: 2, principle: "objective_trade", title: "VALUE GAINED: only two of us can reach the alternative, so less of it is captured",
    spec: { structure: "CONTEST_VS_TRADE", actions: CT, difficulty: 2, mutate: (r) => { T0(r); moveAllies(r, ["mid"], "bot_side"); } },
    valid: true, active: { objective_value: "low", cross_map_trade: "limited" },
    tiers: { contest: "WEAK", trade: "VIABLE" }, scores: { contest: -5, trade: 5 }, best: ["trade"],
    chains: { contest: ["objective_lost_with_losses", "no_major_change", "map_access_worsened"], trade: ["trade_marginally_favorable", "no_major_change", "map_access_improved"] },
    tradeTerms: { s1: { trade_gain: 1, objective_value: 0, enemy_access: 0, trade_punish: 0 }, s2: { turret_pressure: 0, wave_consequences: 0, trade_punish_spill: 0 } },
    signals: { contest: { objective_value: "negative", cross_map_trade: "negative" }, trade: { objective_value: "no_signal", cross_map_trade: "positive" } },
  },
  {
    id: "T3", group: 2, principle: "objective_trade", title: "ENEMY ABILITY TO PUNISH: two enemies can answer at the alternative (evaluation-only)",
    spec: { structure: "CONTEST_VS_TRADE", actions: CT, difficulty: 2, mutate: (r) => { T0(r); const E = r.teams.enemies.members; E.mid.zone = "mid"; E.dragon.zone = "mid"; } },
    valid: false, active: { objective_value: "low", cross_map_trade: "limited" },
    tiers: { contest: "WEAK", trade: "VIABLE" }, scores: { contest: -5, trade: -4 }, best: ["trade"],
    chains: { contest: ["objective_lost_with_losses", "no_major_change", "map_access_worsened"], trade: ["trade_even", "pressure_lost_while_away", "map_access_unchanged"] },
    tradeTerms: { s1: { trade_gain: 2, objective_value: 0, enemy_access: 0, trade_punish: -2 }, s2: { turret_pressure: 0, wave_consequences: 0, trade_punish_spill: -1 } },
    signals: { contest: { objective_value: "negative", cross_map_trade: "no_signal" }, trade: { objective_value: "no_signal", cross_map_trade: "no_signal" } },
  },
  {
    id: "T4", group: 2, principle: "turret_pressure_creates_map_value", title: "TURRET CONSEQUENCE: our turret is under pressure while the team is away",
    spec: { structure: "CONTEST_VS_TRADE", actions: CT, difficulty: 2, mutate: (r) => { T0(r); r.lanes.top.pressure = "enemy"; r.lanes.top.turret.allied = "damaged"; } },
    valid: true, active: { objective_value: "low", cross_map_trade: "strong", turret_pressure: "unfavorable" },
    tiers: { contest: "WEAK", trade: "STRONG" }, scores: { contest: -9, trade: 10 }, best: ["trade"],
    chains: { contest: ["objective_lost_with_losses", "wave_lost", "map_access_worsened"], trade: ["trade_favorable", "pressure_lost_while_away", "map_access_improved"] },
    tradeTerms: { s1: { trade_gain: 2, objective_value: 0, enemy_access: 0, trade_punish: 0 }, s2: { turret_pressure: -1, wave_consequences: 0, trade_punish_spill: 0 } },
    signals: { contest: { objective_value: "negative", cross_map_trade: "strong_negative", turret_pressure: "negative" }, trade: { objective_value: "no_signal", cross_map_trade: "strong_positive", turret_pressure: "no_signal" } },
  },
  {
    id: "T5", group: 2, principle: "wave_state_changes_rotation_cost", title: "WAVE CONSEQUENCE: trading spares us the wave cost of rotating to the pit",
    spec: { structure: "CONTEST_VS_TRADE", actions: CT, difficulty: 2, mutate: (r) => { T0(r); r.waves.bot = "crashing_into_ally"; } },
    valid: true, active: { objective_value: "low", cross_map_trade: "strong", wave_consequences: "high" },
    tiers: { contest: "WEAK", trade: "STRONG" }, scores: { contest: -17, trade: 18 }, best: ["trade"],
    chains: { contest: ["objective_lost_with_losses", "wave_and_turret_lost", "map_access_worsened"], trade: ["trade_favorable", "lane_value_kept", "map_access_improved"] },
    tradeTerms: { s1: { trade_gain: 2, objective_value: 0, enemy_access: 0, trade_punish: 0 }, s2: { turret_pressure: 0, wave_consequences: 1, trade_punish_spill: 0 } },
    signals: { contest: { objective_value: "negative", cross_map_trade: "strong_negative", wave_consequences: "strong_negative" }, trade: { objective_value: "no_signal", cross_map_trade: "strong_positive", wave_consequences: "positive" } },
  },
  // ---------------------------------------------------------------- [3] fightability
  {
    id: "FA", group: 3, principle: "gold_lead_is_not_fight_advantage", title: "A favourable fight (composition) strengthens the contest (evaluation-only)",
    spec: { structure: "CONTEST_VS_TRADE", actions: CT, difficulty: 3, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "high"); STRONG_ACCESS(r); HIGH(r, "allies"); LOW(r, "enemies"); } },
    valid: false, active: { objective_value: "high", team_access: "strong", fightability: "favorable" },
    tiers: { contest: "STRONG", trade: "WEAK" }, scores: { contest: 20, trade: -14 }, best: ["contest"],
    chains: { contest: ["objective_secured_cleanly", "no_major_change", "map_access_improved"], trade: ["trade_unfavorable", "no_major_change", "map_access_worsened"] },
    signals: { contest: { objective_value: "positive", team_access: "positive", fightability: "positive" }, trade: { objective_value: "strong_negative", team_access: "negative", fightability: "negative" } },
  },
  {
    id: "FB", group: 3, principle: "gold_lead_is_not_fight_advantage", title: "Ahead on gold, same access and value as A1, but an unfavourable fight demotes the contest STRONG -> VIABLE (evaluation-only)",
    spec: { structure: "CONTEST_VS_TRADE", actions: CT, difficulty: 3, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "high"); STRONG_ACCESS(r); LOW(r, "allies"); HIGH(r, "enemies"); setPath(r, "gameContext.goldBand", "ahead"); } },
    valid: false, active: { objective_value: "high", team_access: "strong", fightability: "unfavorable" },
    tiers: { contest: "VIABLE", trade: "WEAK" }, scores: { contest: 5, trade: -14 }, best: ["contest"],
    chains: { contest: ["objective_secured_with_losses", "no_major_change", "map_access_improved"], trade: ["trade_unfavorable", "no_major_change", "map_access_worsened"] },
  },
  {
    id: "FC", group: 3, principle: "gold_lead_is_not_fight_advantage", title: "The fight is the reason contesting fails: fightability earns its own evidence",
    spec: { structure: "CONTEST_VS_TRADE", actions: CT, difficulty: 2, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "low"); LOW(r, "allies"); HIGH(r, "enemies"); } },
    valid: true, active: { objective_value: "low", fightability: "unfavorable" },
    tiers: { contest: "WEAK", trade: "VIABLE" }, scores: { contest: -14, trade: 0 }, best: ["trade"],
    chains: { contest: ["objective_lost", "no_major_change", "map_access_worsened"], trade: ["trade_even", "no_major_change", "map_access_unchanged"] },
    signals: { contest: { objective_value: "negative", fightability: "negative" }, trade: { objective_value: "positive", fightability: "positive" } },
  },
  // ---------------------------------------------------------------- [4] SETUP
  {
    id: "S2", group: 4, principle: "SETUP is pre-commitment preparation", title: "SETUP is still available when the objective is up but nobody has started it (evaluation-only)",
    spec: { structure: "SETUP_VS_GIVE", actions: SG, difficulty: 2, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "low"); moveAllies(r, ["baron", "jungle", "mid", "dragon"], "top_side"); setPath(r, "objectives.dragon.status", "available"); setPath(r, "objectives.dragon.availableInSec", 0); setPath(r, "objectives.riftHerald.availableInSec", 8); } },
    valid: false, active: { objective_value: "low", team_access: "weak", enemy_access: "weak" },
    tiers: { setup: "WEAK", give: "VIABLE" }, scores: { setup: -5, give: 0 }, best: ["give"],
    chains: { setup: ["setup_exposed", "no_major_change", "map_access_worsened"], give: ["objective_conceded_cheaply", "no_major_change", "map_access_unchanged"] },
  },
  {
    id: "S3", group: 4, principle: "SETUP is pre-commitment preparation", title: "SETUP is unavailable (INVALID) once the enemy has committed to taking the objective; TRADE is still the best decision (evaluation-only)",
    spec: { structure: "CONTEST_VS_TRADE", actions: ["CONTEST", "TRADE", "SETUP"], difficulty: 3, mutate: (r) => { T0(r); takingDragon(r); } },
    valid: false, active: { objective_value: "low", cross_map_trade: "strong" },
    tiers: { contest: "WEAK", trade: "STRONG", setup: "INVALID" }, scores: { contest: -5, trade: 14, setup: null }, best: ["trade"],
    chains: { contest: ["objective_lost_with_losses", "no_major_change", "map_access_worsened"], trade: ["trade_favorable", "no_major_change", "map_access_improved"], setup: [] },
  },
  {
    id: "S4a", group: 4, principle: "SETUP prepares a contest, so the contest's fightability counts", title: "SETUP with an even fight: control established (evaluation-only)",
    spec: { structure: "SETUP_VS_GIVE", actions: SG, difficulty: 3, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "high"); STRONG_ACCESS(r); } },
    valid: false, active: { objective_value: "high", team_access: "strong" },
    tiers: { setup: "STRONG", give: "WEAK" }, scores: { setup: 14, give: -20 }, best: ["setup"],
    chains: { setup: ["control_established", "no_major_change", "map_access_improved"], give: ["high_value_objective_conceded", "no_major_change", "map_access_worsened"] },
  },
  {
    id: "S4b", group: 4, principle: "SETUP prepares a contest, so the contest's fightability counts", title: "Same SETUP, but the fight it prepares is unfavourable: less is gained (evaluation-only)",
    spec: { structure: "SETUP_VS_GIVE", actions: SG, difficulty: 3, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "high"); STRONG_ACCESS(r); LOW(r, "allies"); HIGH(r, "enemies"); } },
    valid: false, active: { objective_value: "high", team_access: "strong", fightability: "unfavorable" },
    tiers: { setup: "VIABLE", give: "WEAK" }, scores: { setup: 5, give: -20 }, best: ["setup"],
    chains: { setup: ["control_partly_established", "no_major_change", "map_access_improved"], give: ["high_value_objective_conceded", "no_major_change", "map_access_worsened"] },
  },
  // ---------------------------------------------------------------- [5] SITUATIONAL / uncertainty
  {
    id: "U1", group: 5, principle: "multiple defensible decisions", title: "Marginal SETUP payoff next to a solid GIVE: SITUATIONAL only because a defensible alternative exists (evaluation-only)",
    spec: { structure: "SETUP_VS_GIVE", actions: SG, difficulty: 3, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "low"); STRONG_ACCESS(r); r.vision.allies.bot_side = "none"; r.vision.enemies.bot_side = "full"; r.vision.fogRisk.bot_side = "medium"; r.vision.safeToClear.bot_side = true; } },
    valid: false, active: { objective_value: "low", team_access: "strong", vision_gap: "behind" },
    tiers: { setup: "SITUATIONAL", give: "VIABLE" }, scores: { setup: 5, give: 0 }, best: ["give"],
    chains: { setup: ["control_partly_established", "no_major_change", "map_access_improved"], give: ["objective_conceded_cheaply", "no_major_change", "map_access_unchanged"] },
  },
  {
    id: "U2c", group: 5, principle: "certainty follows the state", title: "A decisive contest with clear information: high certainty (evaluation-only)",
    spec: { structure: "CONTEST_VS_TRADE", actions: CT, difficulty: 3, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "high"); STRONG_ACCESS(r); HIGH(r, "allies"); LOW(r, "enemies"); } },
    valid: false, active: { objective_value: "high", team_access: "strong", fightability: "favorable" }, info: "clear", certainty: { contest: "high" },
    tiers: { contest: "STRONG", trade: "WEAK" }, scores: { contest: 20, trade: -14 }, best: ["contest"],
  },
  {
    id: "U2p", group: 5, principle: "certainty follows the state", title: "Same contest, two stale sightings and the jungler unseen-adjacent: partial information lowers certainty one step (evaluation-only)",
    spec: { structure: "CONTEST_VS_TRADE", actions: CT, difficulty: 3, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "high"); STRONG_ACCESS(r); HIGH(r, "allies"); LOW(r, "enemies"); r.vision.allies.top_side = "none"; const E = r.teams.enemies.members; E.jungle.zone = "mid"; for (const s of ["baron", "support"]) E[s].lastSeenAgoSec = 40; } },
    valid: false, active: { objective_value: "high", team_access: "strong", fightability: "favorable" }, info: "partial", certainty: { contest: "medium" },
    tiers: { contest: "STRONG", trade: "WEAK" }, scores: { contest: 14, trade: -8 }, best: ["contest"],
  },
  {
    id: "U2x", group: 5, principle: "certainty follows the state", title: "Same contest, most sightings stale: poor information lowers certainty two steps; it stays STRONG because it is the only defensible option (evaluation-only)",
    spec: { structure: "CONTEST_VS_TRADE", actions: CT, difficulty: 3, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "high"); STRONG_ACCESS(r); HIGH(r, "allies"); LOW(r, "enemies"); r.vision.allies.top_side = "none"; for (const s of ["baron", "jungle", "support"]) r.teams.enemies.members[s].lastSeenAgoSec = 40; } },
    valid: false, active: { objective_value: "high", team_access: "strong", fightability: "favorable" }, info: "poor", certainty: { contest: "low" },
    tiers: { contest: "STRONG", trade: "WEAK" }, scores: { contest: 8, trade: -8 }, best: ["contest"],
  },
];

console.log("\n[1-5] Golden scenarios");
const built = {};
for (const g of G) {
  const b = craft(g.spec);
  built[g.id] = b;
  const k = b.answerKey;
  console.log(`  -- ${g.id}: ${g.title}  [${g.principle}]`);
  if (g.valid) check(`${g.id}: valid coach-crafted scenario (passes all ${INVARIANT_IDS.length} invariants)`, b.ok === true, b.violations);
  else check(`${g.id}: evaluation-only; fails ONLY educational invariants (structure, state, decision and public are sound)`, b.ok === false && b.violations.every((v) => v.id.startsWith("edu.")), b.violations);
  check(`${g.id}: exposed factors and levels`, stableStringify(Object.fromEntries(b.scenario.activeFactors.map((f) => [f, k.factorEvidence[f].level]))) === stableStringify(g.active), b.scenario.activeFactors.map((f) => `${f}=${k.factorEvidence[f].level}`));
  check(`${g.id}: option tiers`, stableStringify(Object.fromEntries(Object.entries(k.options).map(([id, o]) => [id, o.tier]))) === stableStringify(g.tiers), Object.fromEntries(Object.entries(k.options).map(([id, o]) => [id, o.tier])));
  check(`${g.id}: option scores`, stableStringify(Object.fromEntries(Object.entries(k.options).map(([id, o]) => [id, o.score]))) === stableStringify(g.scores), Object.fromEntries(Object.entries(k.options).map(([id, o]) => [id, o.score])));
  check(`${g.id}: best option(s)`, stableStringify(k.best.slice().sort()) === stableStringify(g.best.slice().sort()), k.best);
  if (g.chains) check(`${g.id}: outcome chains (Objective/Fight > Turret/Wave/Gold > Tempo/Map Access)`, Object.entries(g.chains).every(([id, ch]) => stableStringify(k.options[id].outcomeChain.map((c) => c.outcome)) === stableStringify(ch)), Object.fromEntries(Object.entries(k.options).map(([id, o]) => [id, o.outcomeChain.map((c) => c.outcome)])));
  if (g.info) check(`${g.id}: derived information quality is ${g.info}`, b.scenario.state.derived.infoQuality.level === g.info, b.scenario.state.derived.infoQuality);
  if (g.certainty) for (const [id, want] of Object.entries(g.certainty)) check(`${g.id}: ${id}'s objective/fight outcome has ${want} certainty`, k.options[id].outcomeChain[0].certainty === want, k.options[id].outcomeChain[0]);
  if (g.tradeTerms) {
    const named = (chainIdx) => Object.fromEntries(k.options.trade.outcomeChain[chainIdx].terms.filter((t) => t.term !== "carry").map((t) => [t.term, t.value]));
    check(`${g.id}: TRADE exchange terms (value gained, value given up, enemy cash-in, enemy punish)`, stableStringify(named(0)) === stableStringify(g.tradeTerms.s1), named(0));
    check(`${g.id}: TRADE consequence terms (turret, wave relief, punish spill)`, stableStringify(named(1)) === stableStringify(g.tradeTerms.s2), named(1));
  }
  if (g.signals) {
    for (const [choice, want] of Object.entries(g.signals)) {
      const e = evaluateAnswer({ scenario: b.scenario, answerKey: k, answer: { choice }, template: T }).evaluation;
      const got = Object.fromEntries(e.factorSignals.map((f) => [f.factor, f.performance.signal]));
      check(`${g.id}: factor signals when choosing ${choice}`, stableStringify(got) === stableStringify(want), got);
    }
  }
  if (g.alignment) for (const [choice, want] of Object.entries(g.alignment)) check(`${g.id}: outcome alignment when choosing ${choice} is '${want}'`, evaluateAnswer({ scenario: b.scenario, answerKey: k, answer: { choice }, template: T }).evaluation.outcomeAlignment.label === want);
}

// ------------------------------------------------------------------------------------------
console.log("\n[2] TRADE accounts for all four things, and only what the state supports");
{
  const trade = (id) => built[id].answerKey.options.trade;
  const s1 = (id) => Object.fromEntries(trade(id).outcomeChain[0].terms.filter((t) => t.term !== "carry").map((t) => [t.term, t.value]));
  check("value GIVEN UP: raising the primary's value from low (T0) to high (T1) turns a STRONG trade into a WEAK one", trade("T0").tier === "STRONG" && trade("T1").tier === "WEAK" && s1("T1").objective_value < s1("T0").objective_value);
  check("value GAINED: capturing less at the alternative (T2: two of us instead of three) lowers the gain and the tier", s1("T2").trade_gain < s1("T0").trade_gain && trade("T2").score < trade("T0").score && trade("T2").tier === "VIABLE");
  check("value gained is also capped by how much more the alternative is worth: a high-value primary leaves nothing to gain (T1: gain 0 despite strong access to the alternative)", s1("T1").trade_gain === 0);
  check("ENEMY ABILITY TO PUNISH: two enemies able to answer (T3) cost the trade its whole margin and add a map cost", s1("T3").trade_punish === -2 && trade("T3").tier === "VIABLE" && trade("T3").score < trade("T0").score && trade("T3").outcomeChain[1].outcome === "pressure_lost_while_away");
  check("TURRET consequence: turret pressure against us while away lowers the trade's map outcome (T4)", trade("T4").outcomeChain[1].outcome === "pressure_lost_while_away" && trade("T4").score < trade("T0").score);
  check("WAVE consequence: a costly rotation to the pit is avoided by trading (T5: trade gains, contest loses more)", trade("T5").outcomeChain[1].outcome === "lane_value_kept" && trade("T5").score > trade("T0").score && built.T5.answerKey.options.contest.score < built.T0.answerKey.options.contest.score);
  check("the chain stays short: exactly three linked outcomes per option (no game simulation)", ["T0", "T1", "T2", "T3", "T4", "T5"].every((id) => trade(id).outcomeChain.length === 3));
  check("with no cross-map opportunity nothing is gained or punished (no hidden driver): gain, punish and spill are all 0", (() => { const t = built.A1.answerKey.options.trade.outcomeChain; return t[0].terms.filter((x) => ["trade_gain", "trade_punish"].includes(x.term)).every((x) => x.value === 0) && t[1].terms.every((x) => x.term !== "trade_punish_spill" || x.value === 0); })());
  check("every TRADE term is attributed to a registry factor, so evidence about a trade is evidence about a named skill", Object.entries(T.rules.terms).filter(([n]) => n.startsWith("trade_")).every(([, d]) => d.factor !== null && FACTORS[d.factor]));
}

// ------------------------------------------------------------------------------------------
console.log("\n[3] Fightability: a first-class factor, derived from state, never a generated fact");
{
  const fight = (mut) => { const r = neutralRaw(); mut(r); return fightabilityOf(r, T.rules.thresholds, "bot_side"); };
  const F = {
    F0: fight(() => {}),
    F1: fight((r) => { HIGH(r, "allies"); LOW(r, "enemies"); items(r, "enemies", 3); items(r, "allies", 0); }),
    F2: fight((r) => { items(r, "allies", 3); items(r, "enemies", 1); }),
    F3: fight((r) => { hold(r); }),
    F4: fight((r) => { hold(r); LOW(r, "allies"); HIGH(r, "enemies"); }),
    F5: fight((r) => { hold(r); items(r, "enemies", 3); items(r, "allies", 1); }),
    F6: fight((r) => { hold(r); items(r, "allies", 3); items(r, "enemies", 1); setPath(r, "gameContext.goldBand", "ahead"); r.teams.allies.composition = { burst: "high", crowdControl: "medium", engage: "high" }; r.teams.enemies.composition = { burst: "high", crowdControl: "high", engage: "low" }; }),
  };
  check("neutral state: fightability is even, driver none", F.F0.level === "even" && F.F0.driver === "none");
  check("order 1/3 -- composition decides first, even against an item lead and the ground", F.F1.level === "favorable" && F.F1.driver === "composition" && F.F1.itemEdge === -1);
  check("order 2/3 -- items decide when composition is level", F.F2.level === "favorable" && F.F2.driver === "items" && F.F2.compEdge === 0);
  check("order 3/3 -- positioning (who holds the ground) decides only when composition and items are level", F.F3.level === "favorable" && F.F3.driver === "positioning" && F.F3.compEdge === 0 && F.F3.itemEdge === 0);
  check("composition beats positioning: we hold the pit 5 v 1 but their composition wins", F.F4.level === "unfavorable" && F.F4.driver === "composition" && F.F4.posEdge === 1);
  check("items beat positioning: we hold the pit 5 v 1 but their item lead wins", F.F5.level === "unfavorable" && F.F5.driver === "items" && F.F5.posEdge === 1);
  check("a burst + chain-CC combination overrides holding the ground, an item lead and a gold lead", F.F6.level === "unfavorable" && F.F6.driver === "combo_danger" && F.F6.posEdge === 1 && F.F6.itemEdge === 1);
  const withGold = (band) => craft({ structure: "CONTEST_VS_TRADE", actions: CT, difficulty: 3, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "high"); STRONG_ACCESS(r); LOW(r, "allies"); HIGH(r, "enemies"); setPath(r, "gameContext.goldBand", band); } });
  const [ga, gb, gc] = ["ahead", "even", "behind"].map(withGold);
  check("GOLD IS NOT AN INPUT: ahead / even / behind give identical option tiers, scores and chains", stableStringify(ga.answerKey.options) === stableStringify(gb.answerKey.options) && stableStringify(gb.answerKey.options) === stableStringify(gc.answerKey.options));
  check("...and identical derived fightability, while the three are still distinct scenarios", ga.scenario.state.derived.objectives.dragon.fightability.level === gc.scenario.state.derived.objectives.dragon.fightability.level && new Set([ga, gb, gc].map((x) => x.scenario.scenarioRef)).size === 3);
  check("headline principle: with gold ahead, an unfavourable fight demotes the same contest from STRONG (A1) to VIABLE (FB)", built.A1.answerKey.options.contest.tier === "STRONG" && built.FB.answerKey.options.contest.tier === "VIABLE" && built.FB.scenario.state.raw.gameContext.goldBand === "ahead");
  check("positioning is not access: our five arrive in A1 without holding the pit (2 v 1), so fightability stays even", built.A1.scenario.state.derived.objectives.dragon.fightability.level === "even" && built.A1.answerKey.factorEvidence.fightability.exposed === false);
  check("fightability lives in DERIVED state, per objective; raw state has no fightability field", built.FC.scenario.state.derived.objectives.dragon.fightability.driver === "composition" && !JSON.stringify(built.FC.scenario.state.raw).includes("fightab"));
  check("fightability produces its own factor-level evidence (FC: positive when avoided, negative when suffered)", evaluateAnswer({ scenario: built.FC.scenario, answerKey: built.FC.answerKey, answer: { choice: "trade" }, template: T }).evaluation.factorSignals.find((f) => f.factor === "fightability").performance.signal === "positive" && evaluateAnswer({ scenario: built.FC.scenario, answerKey: built.FC.answerKey, answer: { choice: "contest" }, template: T }).evaluation.factorSignals.find((f) => f.factor === "fightability").performance.signal === "negative");
  check("fightability contributes to the Fightability skill track (weight 1.0) and is state-derived, not contextual", FACTORS.fightability.trackLinks.some((l) => l.trackId === "fightability" && l.weight === 1.0) && FACTORS.fightability.valueClass === "state_derived");
  check("fightability evidence is attributed through a rule-table term mapped to the factor (no unattributed hidden driver)", T.rules.terms.fightability.factor === "fightability");
}

// ------------------------------------------------------------------------------------------
console.log("\n[4] SETUP: the definition comes first, the validity rule follows from it");
{
  const D = T.rules.definitions;
  check("every allowed action has an explicit DRAFT definition (meaning + availableWhen)", T.allowedActions.every((a) => D[a] && typeof D[a].meaning === "string" && typeof D[a].availableWhen === "string"));
  check("SETUP is defined as PRE-COMMITMENT preparation: it ends when a team commits, after which the decision is CONTEST/TRADE/GIVE/IGNORE", /BEFORE any team commits/.test(D.SETUP.meaning) && /ends the moment a team commits/.test(D.SETUP.meaning) && /CONTEST, TRADE, GIVE or IGNORE/.test(D.SETUP.meaning));
  check("the alternative reading ('broader preparation for a contest') is recorded, marked NOT ADOPTED, with what would change", /NOT ADOPTED/.test(D.SETUP.alternativeReading) && /remove the precondition/.test(D.SETUP.alternativeReading));
  check("every precondition names the definition it implements", Object.values(T.rules.preconditions).every((p) => D[p.definition]));
  check("the SETUP decision structure is only built where the definition holds (requiresIdle)", T.structures.SETUP_VS_GIVE.requiresIdle === true);
  const avail = (status, activity, secs) => {
    const raw = neutralRaw();
    setPath(raw, "objectives.dragon.status", status); setPath(raw, "objectives.dragon.availableInSec", secs); setPath(raw, "objectives.dragon.activity", activity);
    return preconditionOf("SETUP", { raw, primary: "dragon", alternative: "riftHerald" });
  };
  const upcoming = avail("upcoming", "none", 20), upNoStart = avail("available", "none", 0), taking = avail("available", "enemy_taking", 0);
  check("SETUP is available while the objective is upcoming and nobody has committed", upcoming.ok === true);
  check("SETUP is available when the objective is up now but nobody has started it (commitment, not spawn time, ends preparation)", upNoStart.ok === true);
  check("SETUP is unavailable once the enemy is taking it, with a reason that names the definition's rule", taking.ok === false && taking.reason === "no_team_has_committed");
  check("no other action's availability depends on commitment (CONTEST, GIVE, IGNORE are always available)", ["CONTEST", "GIVE", "IGNORE"].every((a) => preconditionOf(a, { raw: (() => { const r = neutralRaw(); setPath(r, "objectives.dragon.activity", "enemy_taking"); return r; })(), primary: "dragon", alternative: null }).ok));
  check("TRADE availability follows its definition: available only with an alternative in the window", preconditionOf("TRADE", { raw: neutralRaw(), primary: "dragon", alternative: "riftHerald" }).ok && !preconditionOf("TRADE", { raw: neutralRaw(), primary: "dragon", alternative: null }).ok);
  check("G S2 (objective up, not started) offers a valid SETUP and G S3 (enemy taking) marks it INVALID", built.S2.answerKey.options.setup.valid === true && built.S3.answerKey.options.setup.tier === "INVALID" && built.S3.answerKey.options.setup.invalidReason === "no_team_has_committed");
  check("SETUP counts fightability: preparing a contest we would lose is worth less (S4a even fight STRONG 14 -> S4b unfavourable VIABLE 5)", built.S4a.answerKey.options.setup.score > built.S4b.answerKey.options.setup.score && built.S4a.answerKey.options.setup.tier === "STRONG" && built.S4b.answerKey.options.setup.tier === "VIABLE" && T.rules.actions.SETUP.objective_fight.terms.some((t) => t.term === "fightability"));
}

// ------------------------------------------------------------------------------------------
console.log("\n[5] SITUATIONAL and uncertainty follow the state, not a target share");
{
  const cert = (id, opt) => built[id].answerKey.options[opt].outcomeChain[0].certainty;
  check("information levels lower certainty of the SAME contest step by step: clear high -> partial medium -> poor low", cert("U2c", "contest") === "high" && cert("U2p", "contest") === "medium" && cert("U2x", "contest") === "low");
  check("...and the score falls with it (20 -> 14 -> 8) while the option stays STRONG, because it is the only defensible one", built.U2c.answerKey.options.contest.score === 20 && built.U2p.answerKey.options.contest.score === 14 && built.U2x.answerKey.options.contest.score === 8 && ["U2c", "U2p", "U2x"].every((id) => built[id].answerKey.options.contest.tier === "STRONG"));
  check("poor information records that most of the contest's weight is low-certainty, without relabelling a lone option SITUATIONAL", built.U2x.answerKey.options.contest.lowCertaintyPercent >= T.rules.tiering.situationalLowCertaintyPercent && built.U2x.answerKey.defensible.length === 1);
  check("SITUATIONAL needs a defensible alternative: U1's marginal SETUP is SITUATIONAL next to a VIABLE GIVE", built.U1.answerKey.options.setup.tier === "SITUATIONAL" && built.U1.answerKey.options.give.tier === "VIABLE" && T.rules.tiering.situationalRequiresAlternative === true);
  check("...it has a non-negative score and mostly low-certainty weight", built.U1.answerKey.options.setup.score >= T.rules.tiering.situationalMinScore && built.U1.answerKey.options.setup.lowCertaintyPercent >= T.rules.tiering.situationalLowCertaintyPercent);
  check("the reliable option is the best one; the conditional one is a defensible alternative (best = GIVE, defensible = both)", built.U1.answerKey.best[0] === "give" && built.U1.answerKey.defensible.length === 2);
  check("certainty follows the MARGIN of the fight/exchange: decisive sums are high, +-1 or level sums are low (all three contested/trade ladders)", ["CONTEST", "SETUP", "TRADE"].every((a) => { const b = T.rules.actions[a].objective_fight.bands; const at = (v) => b.find((x) => x.min === null || v >= x.min); return at(3).certainty === "high" && at(1).certainty === "low" && at(0).certainty === "low" && at(-1).certainty === "low"; }));
  check("conceding options are not made less certain by unseen enemies: GIVE/IGNORE are outside every certainty shift", T.rules.certaintyShift.every((r) => !r.actions.includes("GIVE") && !r.actions.includes("IGNORE")));
  check("the shifts are the ones the state supports: partial and poor information, and being behind on vision", T.rules.certaintyShift.map((r) => JSON.stringify(r.when)).join("|") === '{"infoQuality":"partial"}|{"infoQuality":"poor"}|{"factorLevel":{"vision_gap":"behind"}}');
  // Vision-behind lowers certainty: setup_badly_punished is a HIGH band; with vision behind its chain certainty is one step lower.
  const v = craft({ structure: "SETUP_VS_GIVE", actions: SG, difficulty: 2, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "low"); moveAllies(r, ["baron", "jungle", "mid", "dragon"], "top_side"); r.vision.allies.bot_side = "none"; r.vision.enemies.bot_side = "full"; r.vision.fogRisk.bot_side = "medium"; r.vision.safeToClear.bot_side = false; } });
  const band = T.rules.actions.SETUP.objective_fight.bands.find((b) => b.outcome === "setup_badly_punished");
  const c0 = v.answerKey.options.setup.outcomeChain[0];
  check("being behind on vision lowers certainty one step (the outcome's own band is HIGH, the chain says MEDIUM)", v.answerKey.factorEvidence.vision_gap.level === "behind" && c0.outcome === "setup_badly_punished" && band.certainty === "high" && CERTAINTY.indexOf(c0.certainty) === CERTAINTY.indexOf(band.certainty) + 1, c0);
  check("...and the shift cites the vision evidence in the chain's `because`", c0.because.some((p) => p.includes("state.raw.vision")));
  // Conceding options' certainty is identical whatever we can see. Only information differs between these two states:
  // enemy access, positions and every factor level are the same.
  const layout = (r) => { setPath(r, "objectives.dragon.stakes", "high"); STRONG_ACCESS(r); HIGH(r, "allies"); LOW(r, "enemies"); };
  const seen = craft({ structure: "SETUP_VS_GIVE", actions: SG, difficulty: 3, mutate: layout });
  const unseen = craft({ structure: "SETUP_VS_GIVE", actions: SG, difficulty: 3, mutate: (r) => { layout(r); r.vision.allies.top_side = "none"; for (const s of ["baron", "jungle", "support"]) r.teams.enemies.members[s].lastSeenAgoSec = 40; } });
  check("(setup) only information differs: clear vs poor, with every factor at the same level", seen.scenario.state.derived.infoQuality.level === "clear" && unseen.scenario.state.derived.infoQuality.level === "poor" && Object.keys(seen.answerKey.factorEvidence).every((f) => seen.answerKey.factorEvidence[f].level === unseen.answerKey.factorEvidence[f].level));
  const certs = (b, id) => b.answerKey.options[id].outcomeChain.map((c) => c.certainty);
  check("GIVE's chain certainty is identical whether or not the enemy is seen", stableStringify(certs(seen, "give")) === stableStringify(certs(unseen, "give")), [certs(seen, "give"), certs(unseen, "give")]);
  check("SETUP's objective outcome is high certainty when we can see, and two steps lower (low) when most sightings are stale", seen.answerKey.options.setup.outcomeChain[0].certainty === "high" && unseen.answerKey.options.setup.outcomeChain[0].certainty === "low", [seen.answerKey.options.setup.outcomeChain[0], unseen.answerKey.options.setup.outcomeChain[0]]);
}

// ------------------------------------------------------------------------------------------
console.log("\n[6] Signal calibration: thresholds are anchored to representative cases, not to a target share");
{
  const S = T.rules.signals;
  const signalOf = (id, choice, factor) => {
    const e = evaluateAnswer({ scenario: built[id].scenario, answerKey: built[id].answerKey, answer: { choice }, template: T }).evaluation;
    return e.factorSignals.find((f) => f.factor === factor);
  };
  // [case, choice, factor, intended signal, evidence kind, why]
  const K = [
    ["A1", "contest", "objective_value", "positive", "realized", "K1 shared credit: a clear right call with two co-drivers earns 'positive' for each, not 'strong'"],
    ["A1", "trade", "objective_value", "strong_negative", "realized", "K2 sole culprit: choosing the option that concedes a high-value objective is decisive evidence against the factor"],
    ["A1", "trade", "team_access", "negative", "missed", "K3 a moderate forfeited benefit is 'negative', not 'strong_negative'"],
    ["A2", "give", "objective_value", "positive", "avoided", "K4 avoiding a substantial harm earns 'positive' (avoidance never earns 'strong')"],
    ["T0", "trade", "objective_value", "no_signal", "avoided", "K4b a smaller avoided harm is not enough evidence for anything"],
    ["T2", "trade", "cross_map_trade", "positive", "realized", "K5 a marginal but real gain is 'positive'"],
    ["T0", "trade", "cross_map_trade", "strong_positive", "realized", "K7 sole driver of a decisive success is 'strong_positive'"],
    ["T0", "contest", "cross_map_trade", "strong_negative", "missed", "K8 forfeiting a decisive, single-factor benefit is 'strong_negative'"],
    ["T2", "contest", "cross_map_trade", "negative", "missed", "K9 forfeiting a marginal benefit is 'negative'"],
    ["T4", "trade", "turret_pressure", "no_signal", "realized", "K10 a defensible choice is not penalised for a cost it knowingly paid"],
    ["FC", "trade", "fightability", "positive", "avoided", "K11 fightability earns evidence like any other factor"],
  ];
  const rows = [];
  for (const [id, choice, factor, want, kind, why] of K) {
    const f = signalOf(id, choice, factor);
    const magnitude = kind === "realized" ? Math.abs(f.basis.realized) : f.basis[kind];
    rows.push({ id, choice, factor, kind, magnitude, got: f.performance.signal });
    check(`${why}  [${id} ${choice} ${factor}: ${kind} ${magnitude}]`, f.performance.signal === want, f.performance);
  }
  console.log("  STATS calibration evidence (score x100): " + rows.map((r) => `${r.id}/${r.choice}/${r.factor.slice(0, 6)}=${r.kind[0]}${r.magnitude}->${r.got}`).join("  "));
  check("no calibration case sits exactly on a threshold (each is strictly inside a class)", rows.every((r) => ![S.positiveMin, S.strongMin, S.avoidedPositiveMin, S.missedMin, S.missedStrongMin].includes(r.magnitude)));
  check("K1-K2 separation: shared credit (700) is below strongMin and a sole-culprit loss (1400) is above it", 700 < S.strongMin && S.strongMin < 1400);
  check("avoidance threshold sits between the avoided harms that should and should not count (500 no, 700 yes)", 500 < S.avoidedPositiveMin && S.avoidedPositiveMin < 700);
  check("positiveMin is half an evidence unit and strongMin about 1.7 units (unit = 600)", S.positiveMin === 300 && S.strongMin === 1000);
  check("avoidance alone never exceeds 'positive' even when the avoided harm is huge (A1 contest: avoided 1400 on objective_value, still 'positive')", signalOf("A1", "contest", "objective_value").basis.avoided >= 1400 && signalOf("A1", "contest", "objective_value").performance.signal === "positive");
  check("no evidence, no signal: a tie (both options do nothing) yields no_signal for every factor", (() => {
    const tie = craft({ structure: "SETUP_VS_GIVE", actions: SG, difficulty: 2, mutate: (r) => { setPath(r, "objectives.dragon.stakes", "low"); STRONG_ACCESS(r); r.vision.allies.bot_side = "none"; r.vision.enemies.bot_side = "full"; r.vision.fogRisk.bot_side = "medium"; r.vision.safeToClear.bot_side = true; setPath(r, "objectives.dragon.followUp", "neutral"); r.teams.allies.members.baron.zone = "top_side"; r.teams.allies.members.jungle.zone = "top_side"; } });
    return ["setup", "give"].every((c) => evaluateAnswer({ scenario: tie.scenario, answerKey: tie.answerKey, answer: { choice: c }, template: T }).evaluation.factorSignals.every((f) => f.performance.signal === "no_signal" || Math.abs(f.basis.realized) < 1000));
  })());
}

// ------------------------------------------------------------------------------------------
console.log("\n[7] Relationship goldens: derived state follows from raw state");
{
  const derive = (mutate) => { const r = neutralRaw(); mutate(r); return deriveState(r, C, T.rules.thresholds); };
  const D = (d) => d.objectives.dragon;
  const base = derive(() => {});
  check("neutral baseline: partial access both ways, no cross-map, low wave cost, even vision, even fight, clear information", D(base).teamAccess.level === "partial" && D(base).enemyAccess.level === "partial" && base.crossMap.dragon.level === "none" && D(base).waveCost.level === "low" && D(base).fightability.level === "even" && base.infoQuality.level === "clear");
  const four = derive((r) => { moveAllies(r, ["baron"], "mid"); });
  check("jungle -> objective access: four allies arriving WITHOUT the jungler is only 'partial'", D(four).teamAccess.arrivals.length === 4 && D(four).teamAccess.jungleArrives === false && D(four).teamAccess.level === "partial", D(four).teamAccess);
  const five = derive((r) => { moveAllies(r, ["baron"], "mid"); moveAllies(r, ["jungle"], "bot_side"); });
  check("...and becomes 'strong' once the jungler can also arrive", D(five).teamAccess.level === "strong" && D(five).teamAccess.jungleArrives === true);
  const hurt = derive((r) => { r.teams.allies.members.dragon.hpBand = "low"; r.teams.allies.members.support.hpBand = "low"; });
  check("HP -> access: low-HP members do not count as arriving", !D(hurt).teamAccess.arrivals.includes("dragon") && !D(hurt).teamAccess.arrivals.includes("support") && D(hurt).teamAccess.level === "weak", D(hurt).teamAccess);
  const dead = derive((r) => { const m = r.teams.allies.members.mid; m.status = "dead"; m.zone = "base"; m.hpBand = "none"; });
  check("a dead member cannot arrive", !D(dead).teamAccess.arrivals.includes("mid"));
  check("access is not positioning: all five arrive but only three hold the pit (posDiff 3 v 1 = 2), and four arrive holding two (2 v 1 = 1)", D(five).teamAccess.arrivals.length === 5 && D(five).fightability.posDiff === 2 && D(four).teamAccess.arrivals.length === 4 && D(four).fightability.posDiff === 1, [D(five).fightability.posDiff, D(four).fightability.posDiff]);
  const wave = (state, zone) => derive((r) => { r.waves.mid = state; if (zone) moveAllies(r, ["mid"], zone); });
  check("wave -> rotation cost: mid rotating from a wave crashing INTO the enemy is free (low)", D(wave("crashing_into_enemy")).waveCost.level === "low");
  check("...from a neutral wave costs something (medium)", D(wave("neutral")).waveCost.level === "medium");
  check("...from a wave crashing into OUR turret costs a lot (high)", D(wave("crashing_into_ally")).waveCost.level === "high");
  check("...but only members who actually rotate pay: the same wave is irrelevant if mid is not arriving", D(wave("crashing_into_ally", "top_side")).waveCost.level === "low");
  const turret = derive((r) => { r.waves.mid = "neutral"; r.lanes.mid.turret.allied = "vulnerable"; });
  check("a vulnerable allied turret raises an existing rotation cost (medium -> high)", D(turret).waveCost.level === "high");
  const tk = derive((r) => { takingDragon(r); });
  check("cross-map: enemies already at the pit are committed and cannot answer elsewhere", stableStringify(tk.crossMap.dragon.committed.slice().sort()) === stableStringify(["dragon", "jungle", "mid", "support"]) && tk.objectives.dragon.enemyAccess.level === "strong", tk.crossMap.dragon);
  check("accessLevel: 4 arrivals incl. jungler = strong; 4 without = partial; 2 = partial; 1 = weak", accessLevel(4, true, T.rules.thresholds) === "strong" && accessLevel(4, false, T.rules.thresholds) === "partial" && accessLevel(2, false, T.rules.thresholds) === "partial" && accessLevel(1, true, T.rules.thresholds) === "weak");
  check("crossMapLevel thresholds: (3 ours, 1 theirs) strong; (2, 2) limited; (3, 4) none; (1, 0) none", crossMapLevel(3, 1, T.rules.thresholds) === "strong" && crossMapLevel(2, 2, T.rules.thresholds) === "limited" && crossMapLevel(3, 4, T.rules.thresholds) === "none" && crossMapLevel(1, 0, T.rules.thresholds) === "none");
  check("visionLevel: enemy control beats ours = behind; ours beats theirs = ahead; equal = even", visionLevel("none", "full", "low") === "behind" && visionLevel("full", "none", "low") === "ahead" && visionLevel("partial", "partial", "low") === "even");
  check("visionLevel: high fog risk makes a partial-vs-partial picture 'behind' (fog is a threat, not just wards)", visionLevel("partial", "partial", "high") === "behind" && visionLevel("partial", "none", "high") === "even");
  const stale = (n, jungler) => derive((r) => { const order = jungler ? ["jungle", "baron", "mid", "dragon", "support"] : ["baron", "mid", "dragon", "support", "jungle"]; for (const s of order.slice(0, n)) r.teams.enemies.members[s].lastSeenAgoSec = 40; }).infoQuality.level;
  check("information quality: 0-1 stale sightings clear; 2 partial; 3+ poor", stale(0, false) === "clear" && stale(1, false) === "clear" && stale(2, false) === "partial" && stale(3, false) === "poor");
  check("...a stale enemy jungler alone already makes it partial", stale(1, true) === "partial");
  check("infoQualityOf agrees with deriveState", infoQualityOf(neutralRaw(), C, T.rules.thresholds).level === "clear");
}

// ------------------------------------------------------------------------------------------
console.log("\n[8] The draft gate holds");
{
  check("there are no coach-verified golden cases yet (COACH_GOLDENS is empty by design)", COACH_GOLDENS.length === 0);
  check("the template and its rule table remain DRAFT until the coach approves them", T.status === "draft" && T.rules.status === "DRAFT");
  check("every golden above is unservable (fixture constants, draft content, engine_fixture origin)", G.every((g) => isServable({ scenario: built[g.id].scenario, template: T, constants: C }).servable === false));
  check("every golden scenario is an engine_fixture", G.every((g) => built[g.id].scenario.origin === "engine_fixture"));
}

finish();
