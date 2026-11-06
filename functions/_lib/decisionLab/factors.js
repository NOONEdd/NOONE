// decisionLab -- global Factor registry (spec sections 9-12).
//
// A factor has ONE global identity, reused by every template. This file
// holds identity, the ordered level vocabulary, which level means "not in
// play" (`neutral`), and the factor -> Skill Track links. It does NOT hold
// detection logic: how a level is read out of a state depends on the
// decision being asked (which objective is primary, etc.), so detectors live
// with the template (templates/objectiveTrade.js). That keeps one identity
// per concept without pretending every template detects it the same way.
//
// Exposure (spec section 37): a factor is EXPOSED in a scenario exactly when
// its detected level differs from `neutral`. Level order is stable and only
// used for vocabulary/validation; the direction in which a level pushes a
// decision is defined in the rule table, not here.
//
// trackLinks weights are DRAFT registry metadata for Phase 7 aggregation.
// The one weight set the spec gave (vision_gap) is used verbatim; the rest
// are proposals awaiting coach approval.

import { deepFreeze } from "./config.js";
import { TRACKS } from "./tracks.js";
import { PRINCIPLES } from "./principles.js";

export const FACTORS_VERSION = 2;

// valueClass says what KIND of fact a factor's level is, so evidence built on
// it is never mistaken for something it is not:
//   state_derived        read from positions, timers, vision, waves, turrets,
//                        composition, items... i.e. computed from the state
//   scenario_contextual  a coarse tag the SCENARIO asserts about its own
//                        situation (how much is at stake, how much lasting
//                        map value is in play). It is NOT a universal Wild
//                        Rift game fact, the repository holds no data to
//                        derive it from, and evidence built on it says
//                        "this player read this scenario's stated stakes",
//                        nothing more. MVP classification; revisit when
//                        richer state can derive these.
export const VALUE_CLASSES = deepFreeze(["state_derived", "scenario_contextual"]);

function factor(def) {
  return { status: "DRAFT", dependsOnFactors: [], valueClass: "state_derived", ...def };
}

export const FACTORS = deepFreeze({
  objective_value: factor({
    id: "objective_value",
    label: "Objective value",
    description: "How much more (or less) is at stake in the primary objective than in the alternative in THIS scenario. A scenario-contextual tag for the MVP, not a universal Wild Rift game fact.",
    valueClass: "scenario_contextual",
    levels: ["low", "medium", "high"],
    neutral: "medium",
    trackLinks: [
      { trackId: "objective_decisions", weight: 1.0 },
      { trackId: "map_pressure", weight: 0.4 },
    ],
    principles: ["objective_priority_is_access_based", "objective_trade", "giving_an_objective_can_be_correct"],
  }),
  team_access: factor({
    id: "team_access",
    label: "Team access",
    description: "How much of our team can reach the primary objective in time.",
    levels: ["weak", "partial", "strong"],
    neutral: "partial",
    trackLinks: [
      { trackId: "team_coordination", weight: 1.0 },
      { trackId: "objective_decisions", weight: 0.7 },
      { trackId: "fightability", weight: 0.4 },
    ],
    principles: ["objective_priority_is_access_based", "cross_map_trade_needs_real_access"],
  }),
  enemy_access: factor({
    id: "enemy_access",
    label: "Enemy access",
    description: "How much of the enemy team can reach the primary objective in time.",
    levels: ["weak", "partial", "strong"],
    neutral: "partial",
    trackLinks: [
      { trackId: "objective_decisions", weight: 0.7 },
      { trackId: "vision_information", weight: 0.5 },
      { trackId: "fightability", weight: 0.4 },
    ],
    principles: ["objective_priority_is_access_based", "cross_map_trade_needs_real_access", "giving_an_objective_can_be_correct"],
  }),
  fightability: factor({
    id: "fightability",
    label: "Fightability",
    description:
      "How favourable a fight at the primary objective is, derived from the state: champion composition first, then item advantages, then positioning (who already holds the ground). Gold is deliberately not an input. It is computed from the state, never generated as a fact of its own.",
    levels: ["unfavorable", "even", "favorable"],
    neutral: "even",
    trackLinks: [
      { trackId: "fightability", weight: 1.0 },
      { trackId: "objective_decisions", weight: 0.6 },
      { trackId: "team_coordination", weight: 0.3 },
    ],
    principles: ["gold_lead_is_not_fight_advantage"],
    // Positioning is realized together with the placements that also decide access.
    dependsOnFactors: ["team_access", "enemy_access"],
  }),
  cross_map_trade: factor({
    id: "cross_map_trade",
    label: "Cross-map trade",
    description: "Whether the team can realistically take the alternative objective elsewhere while the enemy commits here.",
    levels: ["none", "limited", "strong"],
    neutral: "none",
    trackLinks: [
      { trackId: "map_pressure", weight: 1.0 },
      { trackId: "objective_decisions", weight: 0.8 },
    ],
    principles: ["objective_trade", "turret_pressure_creates_map_value", "cross_map_trade_needs_real_access"],
    dependsOnFactors: ["team_access", "enemy_access"],
  }),
  turret_pressure: factor({
    id: "turret_pressure",
    label: "Turret pressure",
    description: "Existing turret pressure across the map, ours or the enemy's.",
    levels: ["unfavorable", "neutral", "favorable"],
    neutral: "neutral",
    trackLinks: [
      { trackId: "map_pressure", weight: 1.0 },
      { trackId: "lane_wave_management", weight: 0.5 },
    ],
    principles: ["turret_pressure_creates_map_value"],
  }),
  vision_gap: factor({
    id: "vision_gap",
    label: "Vision gap",
    description: "Our vision control compared with the enemy's around the primary objective, including fog threats.",
    levels: ["behind", "even", "ahead"],
    neutral: "even",
    trackLinks: [
      { trackId: "vision_information", weight: 1.0 },
      { trackId: "objective_decisions", weight: 0.6 },
      { trackId: "fightability", weight: 0.4 },
    ],
    principles: ["vision_is_an_active_decision"],
  }),
  wave_consequences: factor({
    id: "wave_consequences",
    label: "Wave consequences",
    description: "What rotating to the primary objective would cost in lane waves and turrets left behind.",
    levels: ["low", "medium", "high"],
    neutral: "low",
    trackLinks: [
      { trackId: "lane_wave_management", weight: 1.0 },
      { trackId: "tempo_recall", weight: 0.5 },
    ],
    principles: ["wave_state_changes_rotation_cost", "giving_an_objective_can_be_correct"],
    dependsOnFactors: ["team_access"],
  }),
  long_term_map_value: factor({
    id: "long_term_map_value",
    label: "Long-term map value",
    description: "Whether committing to the primary objective now has more or less lasting map value than the alternative in THIS scenario. A scenario-contextual tag for the MVP, not a universal Wild Rift game fact.",
    valueClass: "scenario_contextual",
    levels: ["negative", "neutral", "positive"],
    neutral: "neutral",
    trackLinks: [
      { trackId: "map_pressure", weight: 0.8 },
      { trackId: "objective_decisions", weight: 0.6 },
      { trackId: "tempo_recall", weight: 0.3 },
    ],
    principles: ["objective_trade", "long_term_map_value_matters", "giving_an_objective_can_be_correct"],
  }),
});

export const FACTOR_IDS = deepFreeze(Object.keys(FACTORS));

export function isNeutralLevel(factorId, level) {
  return FACTORS[factorId].neutral === level;
}

export function nonNeutralLevels(factorId) {
  return FACTORS[factorId].levels.filter((l) => l !== FACTORS[factorId].neutral);
}

/** Factor ids in dependency order (a factor after everything it depends
 *  on; ties keep registry order). Used by the state builder so a dependent
 *  factor is realized after the state it reads. Throws on a cycle. */
export function factorDependencyOrder(ids = FACTOR_IDS) {
  const wanted = new Set(ids);
  const done = new Set();
  const order = [];
  const visiting = new Set();
  function visit(id) {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new Error(`factor dependency cycle at ${id}`);
    visiting.add(id);
    for (const dep of FACTORS[id].dependsOnFactors) if (wanted.has(dep)) visit(dep);
    visiting.delete(id);
    done.add(id);
    order.push(id);
  }
  for (const id of ids) visit(id);
  return order;
}

/** Registry self-check; returns a list of problems (empty when healthy).
 *  Exercised by tests, and cheap enough to call at startup. */
export function checkRegistryIntegrity() {
  const problems = [];
  for (const [key, f] of Object.entries(FACTORS)) {
    if (f.id !== key) problems.push(`factor key/id mismatch: ${key} vs ${f.id}`);
    if (!f.levels.includes(f.neutral)) problems.push(`${key}: neutral level not in levels`);
    if (new Set(f.levels).size !== f.levels.length) problems.push(`${key}: duplicate levels`);
    if (f.trackLinks.length === 0) problems.push(`${key}: no track links`);
    if (!VALUE_CLASSES.includes(f.valueClass)) problems.push(`${key}: unknown valueClass ${f.valueClass}`);
    if (f.valueClass === "scenario_contextual" && !/scenario-contextual/.test(f.description)) problems.push(`${key}: a scenario-contextual factor must say so in its description`);
    for (const link of f.trackLinks) {
      if (!TRACKS[link.trackId]) problems.push(`${key}: unknown track ${link.trackId}`);
      if (!(link.weight > 0 && link.weight <= 1)) problems.push(`${key}: track weight out of (0,1] for ${link.trackId}`);
    }
    for (const p of f.principles) if (!PRINCIPLES[p]) problems.push(`${key}: unknown principle ${p}`);
    for (const d of f.dependsOnFactors) if (!FACTORS[d]) problems.push(`${key}: unknown dependency ${d}`);
  }
  for (const [pid, p] of Object.entries(PRINCIPLES)) {
    for (const fid of p.factors) if (!FACTORS[fid]) problems.push(`principle ${pid}: unknown factor ${fid}`);
    for (const tid of p.tracks) if (!TRACKS[tid]) problems.push(`principle ${pid}: unknown track ${tid}`);
  }
  try {
    factorDependencyOrder();
  } catch (e) {
    problems.push(String(e.message));
  }
  return problems;
}
