// decisionLab -- Training Principle registry (spec sections 3, 19-23).
//
// This is the TRAINING PRINCIPLE layer: what the system is trying to teach.
// It is kept separate from FACT (state, constants, Academy data) and from
// EVALUATION (tiers, signals). A principle never asserts a game fact; it
// states a coaching judgment, and every one is DRAFT until the coach
// approves it.
//
// Every statement below paraphrases something the coach stated in the
// SCENARIOS specification (the `source` field names the section). Nothing
// here was invented from outside that specification. `factors` and `tracks`
// say where the principle is exercised; they are referenced by id only.

import { deepFreeze } from "./config.js";

export const PRINCIPLES_VERSION = 2;

function principle(id, label, source, statement, factors, tracks) {
  return { id, label, status: "DRAFT", source, statement, factors, tracks };
}

export const PRINCIPLES = deepFreeze({
  objective_priority_is_access_based: principle(
    "objective_priority_is_access_based",
    "Objective priority follows access",
    "spec section 20",
    "Objective priority depends on access and team state -- own and enemy team position, own and enemy junglers, mid, bot, item state, HP, vision and wave -- not on an intrinsic ranking of objectives or on how close an objective is.",
    ["team_access", "enemy_access", "objective_value"],
    ["objective_decisions", "team_coordination"],
  ),
  objective_trade: principle(
    "objective_trade",
    "Objective trade",
    "spec sections 19, 70",
    "Trading one objective for another (for example Dragon for Rift Herald) can be the strongest decision in the right state. Objective nearby does not mean automatic contest.",
    ["cross_map_trade", "objective_value", "long_term_map_value"],
    ["objective_decisions", "map_pressure"],
  ),
  giving_an_objective_can_be_correct: principle(
    "giving_an_objective_can_be_correct",
    "Giving is not automatically wrong",
    "spec section 19",
    "Giving an objective is not automatically bad; whether it is right depends on what conceding it costs and what the team keeps or gains by not contesting.",
    ["objective_value", "enemy_access", "wave_consequences", "long_term_map_value"],
    ["objective_decisions", "tempo_recall"],
  ),
  gold_lead_is_not_fight_advantage: principle(
    "gold_lead_is_not_fight_advantage",
    "Gold is not fightability",
    "spec section 21",
    "Fightability is decided by champion composition first, then item advantages, then positioning. A gold advantage does not by itself make a fight favorable: composition can create burst and crowd-control interactions that make a fight dangerous even for the team that is ahead.",
    ["fightability"],
    ["fightability"],
  ),
  vision_is_an_active_decision: principle(
    "vision_is_an_active_decision",
    "Vision is an active decision",
    "spec section 22",
    "Vision is an active decision factor: own vision, enemy vision, fog threats, safe clearing opportunities, the ability to establish control and to deny enemy vision. A Support may need to clear enemy vision, establish their own, or avoid an unsafe vision check. Lack of vision is not just a ward count.",
    ["vision_gap"],
    ["vision_information", "fightability"],
  ),
  wave_state_changes_rotation_cost: principle(
    "wave_state_changes_rotation_cost",
    "Wave state changes what rotating costs",
    "spec sections 26, 29",
    "Wave state determines whether a lane member can rotate and what leaving costs. The consequence of committing to an objective depends on the waves left behind.",
    ["wave_consequences"],
    ["lane_wave_management"],
  ),
  turret_pressure_creates_map_value: principle(
    "turret_pressure_creates_map_value",
    "Turret pressure creates map value",
    "spec sections 28-29",
    "Existing turret pressure -- ours or the enemy's -- changes what trading or ignoring an objective is worth, and creates cross-map value.",
    ["turret_pressure", "cross_map_trade"],
    ["map_pressure", "lane_wave_management"],
  ),
  cross_map_trade_needs_real_access: principle(
    "cross_map_trade_needs_real_access",
    "A cross-map trade needs real access",
    "spec sections 28-29",
    "A cross-map trade is only worth something if the team can actually reach the alternative in time and the enemy cannot easily punish it; objectives and turrets elsewhere on the map are only leverage when there is access to them.",
    ["cross_map_trade", "team_access", "enemy_access"],
    ["map_pressure", "team_coordination"],
  ),
  long_term_map_value_matters: principle(
    "long_term_map_value_matters",
    "Long-term map value",
    "spec sections 9, 24",
    "The value of a decision extends past the objective itself into tempo and future map access. A decision that wins the immediate objective can still worsen map access, and a concession can improve it.",
    ["long_term_map_value"],
    ["map_pressure", "tempo_recall"],
  ),
});

export const PRINCIPLE_IDS = deepFreeze(Object.keys(PRINCIPLES));
