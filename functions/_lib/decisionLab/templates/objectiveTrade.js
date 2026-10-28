// decisionLab -- Objective Trade template (the MVP template, spec section 70).
//
// A Template is NOT a scenario. It defines the educational and structural
// space scenarios are generated in: which state sections must exist, which
// factors are required/allowed/forbidden, which decision structures and
// actions exist, difficulty and factor-count ranges, and its data
// dependencies. The generator makes the actual scenarios.
//
// GAME-TRUTH STATUS: everything under OBJECTIVE_TRADE_RULES is a DRAFT
// derived from the principles the coach stated in the SCENARIOS
// specification (sections 19-23). It encodes judgment ("what does strong
// access do to a contest?") and none of it has been reviewed as Wild Rift
// truth. The template therefore stays status "draft", the rule table stays
// "DRAFT", and isServable() (validator.js) refuses to serve scenarios built
// from either until the coach approves them. To approve: review the table,
// set both statuses, and bump the versions.
//
// Structure of the rule table (all plain data, so it can be printed,
// reviewed and hashed):
//   definitions    what each action MEANS (its availability rule is derived
//                  from the definition, not the other way round)
//   thresholds     numeric cut-offs used by relationships.js
//   terms          named integers read from factor levels / derived signals
//   preconditions  when an action is not available at all (tier INVALID)
//   actions        per action, per stage: which terms are summed and how the
//                  sum maps to a qualitative outcome (valence, certainty)
//   certaintyShift information quality and vision lower certainty, never direction
//   tiering        how outcome chains become option tiers
//   signals        thresholds for factor performance signals

import { deepFreeze, STATE_VOCAB } from "../config.js";
import { FACTOR_IDS } from "../factors.js";
import { captureRank, punishRank } from "../relationships.js";

export const OBJECTIVE_TRADE_TEMPLATE_VERSION = 3;
export const OBJECTIVE_TRADE_RULES_VERSION = "objective_trade.rules.3";

const OBJECTIVE_NAMES = { dragon: "Dragon", riftHerald: "Rift Herald" };

// --- Rule table ---------------------------------------------------------------

function band(min, outcome, valence, certainty, failure) {
  return failure ? { min, outcome, valence, certainty, failure } : { min, outcome, valence, certainty };
}
const T = (term, mods) => ({ term, ...(mods || {}) });
const CARRY = { carry: "objective_fight" };

const MAP_BANDS = [
  band(2, "map_access_improved_strongly", 2, "medium"),
  band(1, "map_access_improved", 1, "medium"),
  band(0, "map_access_unchanged", 0, "medium"),
  band(-1, "map_access_worsened", -1, "medium"),
  band(null, "map_access_lost", -2, "medium"),
];

export const OBJECTIVE_TRADE_RULES = deepFreeze({
  status: "DRAFT",
  version: OBJECTIVE_TRADE_RULES_VERSION,
  notice: "DRAFT rule table awaiting coach review. Encodes coaching judgment, not verified Wild Rift truth.",

  // What each action MEANS. Availability (preconditions, below) is derived
  // from these definitions. All DRAFT: the coach confirms or rewrites them.
  definitions: {
    CONTEST: {
      meaning: "Commit the team to fight for the primary objective now.",
      availableWhen: "always",
    },
    SETUP: {
      meaning:
        "Pre-commitment preparation: establish vision and information control and take position around the primary objective BEFORE any team commits to taking it, so that a later contest (or a safe take) happens on better terms. It ends the moment a team commits: once the enemy is taking the objective, the decision is CONTEST, TRADE, GIVE or IGNORE, not SETUP.",
      availableWhen: "no team has committed to taking the objective (it may be upcoming, or up but not yet started)",
      alternativeReading:
        "NOT ADOPTED -- 'broader preparation for a contest' would also allow SETUP while the enemy is already taking the objective. It overlaps CONTEST, whose evaluation already covers arriving with vision, access and fightability. If the coach prefers it: remove the precondition and re-derive SETUP's bands.",
    },
    TRADE: {
      meaning: "Concede the primary objective and use the team elsewhere to take the alternative objective, weighing what is given up against what is gained, whether the enemy can punish the trade, and the map, turret and wave consequences.",
      availableWhen: "an alternative objective is in the window",
    },
    GIVE: {
      meaning: "Concede the primary objective without contesting and without a compensating target, keeping the team's position and tempo.",
      availableWhen: "always",
    },
    IGNORE: {
      meaning: "Treat the primary objective as not worth attention now and continue the current plan (lane, wave, pressure).",
      availableWhen: "always",
    },
  },

  thresholds: {
    strongMinArrivals: 4, // arrivals (incl. jungler) for "strong" access
    partialMinArrivals: 2,
    compDeadzone: 1, // composition threat difference treated as even
    itemDeadzone: 1, // completed-item difference treated as even
    positionDeadzone: 1, // difference in members already holding the objective's zone treated as even
    crossMap: { strong: { ourMin: 3, enemyMax: 1 }, limited: { ourMin: 2, enemyMax: 2 } },
    enemyTakingMinAtObjective: 3, // enemies at the pit for "enemy is taking it"
    infoPoorStaleCount: 3, // stale enemy sightings for "poor" information
    infoPartialStaleCount: 2,
  },

  // Each term is an integer read from the state. `factor` is the registry
  // factor a term's contribution is attributed to (null = not attributable
  // to any registry factor). `derived` terms are computed in termValue().
  terms: {
    team_access: { factor: "team_access", values: { weak: -1, partial: 0, strong: 1 }, describe: "our access to the primary objective" },
    enemy_access: { factor: "enemy_access", values: { weak: 1, partial: 0, strong: -1 }, describe: "enemy access to the primary objective (weak favours us)" },
    vision_gap: { factor: "vision_gap", values: { behind: -1, even: 0, ahead: 1 }, describe: "vision control around the primary objective" },
    fightability: { factor: "fightability", values: { unfavorable: -1, even: 0, favorable: 1 }, describe: "how favourable a fight at the primary objective is: composition, then items, then positioning; gold is ignored" },
    objective_value: { factor: "objective_value", values: { low: 0, medium: 1, high: 2 }, describe: "what the primary objective is worth relative to the alternative in this scenario (0-2): the cost of conceding it" },
    objective_value_c: { factor: "objective_value", values: { low: -1, medium: 0, high: 1 }, describe: "same, centred: does its value make committing worthwhile" },
    cross_map_trade: { factor: "cross_map_trade", values: { none: 0, limited: 1, strong: 2 }, describe: "what the alternative objective offers" },
    turret_pressure: { factor: "turret_pressure", values: { unfavorable: -1, neutral: 0, favorable: 1 }, describe: "turret pressure across the map" },
    wave_consequences: { factor: "wave_consequences", values: { low: 0, medium: 1, high: 2 }, describe: "cost of pulling lane members out to the primary objective" },
    long_term_map_value: { factor: "long_term_map_value", values: { negative: -1, neutral: 0, positive: 1 }, describe: "lasting map value of committing to the primary objective now, in this scenario" },
    vision_opportunity: { factor: "vision_gap", derived: "vision_opportunity", describe: "derived: +1 behind on vision with a safe way to clear, -1 behind with no safe clear, else 0" },
    neglect_cost: { factor: "objective_value", derived: "neglect_cost", describe: "derived: value rank of the primary objective while the enemy is taking it, else 0" },
    trade_gain: {
      factor: "cross_map_trade",
      derived: "trade_gain",
      describe: "derived, TRADE value gained (0-2): min(what our arrivals at the alternative can capture, how much more the alternative is worth than the primary); 0 when there is no cross-map opportunity",
    },
    trade_punish: {
      factor: "cross_map_trade",
      derived: "trade_punish",
      describe: "derived, TRADE enemy ability to punish (0-2): the number of enemies able to answer at the alternative, capped at 2; 0 when there is no cross-map opportunity",
    },
    trade_punish_spill: {
      factor: "cross_map_trade",
      derived: "trade_punish_spill",
      describe: "derived: 1 when the enemy can answer strongly (2+) at the alternative, else 0 -- the punishment also costs map, wave and turret position",
    },
  },

  // Availability follows the definitions above. An action whose rule fails
  // is not "bad", it is unavailable: tier INVALID.
  preconditions: {
    SETUP: { rule: "no_team_has_committed", definition: "SETUP", describe: "SETUP is pre-commitment preparation, so it is unavailable once a team has committed to taking the objective" },
    TRADE: { rule: "alternative_objective_in_window", definition: "TRADE", describe: "cannot trade without an alternative objective in the window" },
  },

  // Bands are checked top to bottom; the first with min === null or
  // sum >= min applies. valence is -2..+2; certainty is qualitative only.
  //
  // CERTAINTY FOLLOWS THE MARGIN (objective/fight stage of CONTEST, SETUP and
  // TRADE): a decisive sum (|sum| >= 3) is high certainty, |sum| = 2 medium,
  // and a marginal (+-1) or level (0) sum is low -- the factors nearly cancel,
  // so the result depends on how the fight or exchange actually plays out.
  // That is where genuinely different decisions are defensible. Certainty is
  // never set to reach a target share of any tier.
  actions: {
    CONTEST: {
      objective_fight: {
        terms: [T("team_access"), T("enemy_access"), T("vision_gap"), T("fightability"), T("objective_value_c")],
        bands: [
          band(3, "objective_secured_cleanly", 2, "high", "enemy_reinforces_from_fog"),
          band(2, "objective_secured", 2, "medium", "enemy_reinforces_from_fog"),
          band(1, "objective_secured_with_losses", 1, "low", "first_engage_decides_the_fight"),
          band(0, "objective_contested_even", 0, "low", "first_engage_decides_the_fight"),
          band(-1, "objective_lost_with_losses", -1, "low"),
          band(-2, "objective_lost", -2, "medium"),
          band(null, "objective_lost_and_fight_lost", -2, "high"),
        ],
      },
      turret_wave_gold: {
        terms: [T("turret_pressure"), T("wave_consequences", { sign: -1 })],
        bands: [
          band(1, "pressure_kept_or_gained", 1, "medium"),
          band(0, "no_major_change", 0, "high"),
          band(-1, "wave_lost", -1, "medium"),
          band(null, "wave_and_turret_lost", -2, "high"),
        ],
      },
      tempo_map_access: { terms: [T("long_term_map_value"), CARRY], bands: MAP_BANDS },
    },
    SETUP: {
      objective_fight: {
        // Preparation for a contest: the contest is only worth preparing for
        // if it is fightable, so fightability counts here.
        terms: [T("team_access"), T("enemy_access"), T("vision_opportunity"), T("fightability"), T("objective_value_c")],
        bands: [
          band(3, "control_established_contest_ready", 2, "high", "enemy_contests_vision_with_numbers"),
          band(2, "control_established", 2, "medium", "enemy_contests_vision_with_numbers"),
          band(1, "control_partly_established", 1, "low"),
          band(0, "little_gained", 0, "low"),
          band(-1, "setup_exposed", -1, "low"),
          band(-2, "setup_punished", -2, "medium"),
          band(null, "setup_badly_punished", -2, "high"),
        ],
      },
      turret_wave_gold: {
        terms: [T("turret_pressure", { max: 0 })],
        bands: [band(0, "no_major_change", 0, "high"), band(null, "local_pressure_neglected", -1, "low")],
      },
      tempo_map_access: { terms: [T("long_term_map_value"), CARRY], bands: MAP_BANDS },
    },
    TRADE: {
      // The exchange: value gained, minus value given up, adjusted for the
      // enemy's ability to cash in the concession and to punish the trade.
      objective_fight: {
        terms: [T("trade_gain"), T("objective_value", { sign: -1 }), T("enemy_access"), T("trade_punish", { sign: -1 })],
        bands: [
          band(3, "trade_clearly_favorable", 2, "high", "enemy_rotates_to_punish_the_alternative"),
          band(2, "trade_favorable", 2, "medium", "enemy_rotates_to_punish_the_alternative"),
          band(1, "trade_marginally_favorable", 1, "low", "enemy_rotates_to_punish_the_alternative"),
          band(0, "trade_even", 0, "low"),
          band(-1, "trade_marginally_unfavorable", -1, "low"),
          band(-2, "trade_unfavorable", -2, "medium"),
          band(null, "trade_lopsided_loss", -2, "high"),
        ],
      },
      // Map, turret and wave consequences of moving the team cross-map.
      turret_wave_gold: {
        terms: [T("turret_pressure"), T("wave_consequences", { max: 1 }), T("trade_punish_spill", { sign: -1 })],
        bands: [
          band(2, "lane_value_kept_and_pressure", 2, "medium"),
          band(1, "lane_value_kept", 1, "medium"),
          band(0, "no_major_change", 0, "high"),
          band(null, "pressure_lost_while_away", -1, "medium"),
        ],
      },
      tempo_map_access: { terms: [T("long_term_map_value", { sign: -1 }), CARRY], bands: MAP_BANDS },
    },
    GIVE: {
      objective_fight: {
        terms: [T("objective_value", { sign: -1 }), T("enemy_access")],
        bands: [
          band(0, "objective_conceded_cheaply", 0, "medium", "enemy_gains_tempo_from_the_objective"),
          band(-1, "objective_conceded", -1, "high"),
          band(null, "high_value_objective_conceded", -2, "high"),
        ],
      },
      turret_wave_gold: { terms: [], bands: [band(null, "no_major_change", 0, "medium")] },
      tempo_map_access: { terms: [T("long_term_map_value", { sign: -1 }), CARRY], bands: MAP_BANDS },
    },
    IGNORE: {
      objective_fight: {
        terms: [T("neglect_cost", { sign: -1 })],
        bands: [
          band(0, "objective_left_alone", 0, "medium"),
          band(-1, "objective_lost_by_neglect", -1, "high"),
          band(null, "high_value_objective_lost_by_neglect", -2, "high"),
        ],
      },
      turret_wave_gold: {
        terms: [T("turret_pressure"), T("wave_consequences")],
        bands: [
          band(2, "lane_value_kept_and_pressure", 2, "medium"),
          band(1, "lane_value_kept", 1, "medium"),
          band(null, "no_major_change", 0, "medium"),
        ],
      },
      tempo_map_access: { terms: [T("long_term_map_value", { sign: -1 }), CARRY], bands: MAP_BANDS },
    },
  },

  // Uncertainty that comes from the STATE. Each rule lowers the certainty of
  // the objective/fight outcome for the listed actions by `shift` steps
  // (never below "low"); it never changes an outcome's direction. Shifts
  // stack. Where the state says the enemy is unseen (stale sightings, or we
  // are behind on vision), an aggressive option's result really does rest on
  // where the enemy is, while a conceding option does not -- that is what
  // makes SITUATIONAL a meaningful tier.
  certaintyShift: [
    {
      when: { infoQuality: "partial" },
      stage: "objective_fight",
      actions: ["CONTEST", "SETUP", "TRADE"],
      shift: -1,
      describe: "some enemy sightings are stale (or the enemy jungler is unseen): outcomes that depend on where they are are less certain",
    },
    {
      when: { infoQuality: "poor" },
      stage: "objective_fight",
      actions: ["CONTEST", "SETUP", "TRADE"],
      shift: -2,
      describe: "most enemy sightings are stale: outcomes that depend on where they are are much less certain",
    },
    {
      when: { factorLevel: { vision_gap: "behind" } },
      stage: "objective_fight",
      actions: ["CONTEST", "SETUP"],
      shift: -1,
      describe: "behind on vision at the objective: unseen enemies can change a fight or a setup there",
    },
  ],

  // score(option) = sum over stages of valence * certaintyWeight * stageWeight.
  tiering: {
    stageWeights: { objective_fight: 3, turret_wave_gold: 2, tempo_map_access: 1 },
    certaintyWeights: { guaranteed: 4, high: 3, medium: 2, low: 1 },
    strongMaxGap: 5, // gap to the best valid option
    viableMaxGap: 12,
    strongMinScore: 6, // a least-bad option is never STRONG
    viableMinScore: -4,
    situationalLowCertaintyPercent: 40, // share of |score| resting on low-certainty outcomes
    situationalMinScore: 0, // SITUATIONAL means "good if a condition holds", so the option must have a non-negative score
    situationalRequiresAlternative: true, // ...and only where another option is also defensible (multiple defensible decisions)
  },

  // THE SIGNAL CONTRACT (DRAFT, for coach review). A signal grades the strength
  // of the evidence ATTRIBUTABLE TO ONE FACTOR in the player's answer. It is not
  // the option's tier, not whether the answer was correct, not the option's rank
  // and not the raw valence of an outcome. The evaluator implements exactly this.
  signalContract: {
    statement:
      "A signal is the strength of the evidence attributable to one factor, measured in evidence units. It is not the tier, not correctness alone, not the option rank and not the raw outcome valence.",
    evidence:
      "realized = what the chosen option's own outcome chain gained or lost through the factor; missed = a benefit through the factor that a defensible alternative captured; avoided = a harm through the factor that the chosen option steered clear of. Attribution is shared between the factors that drove an outcome, so an identical outcome (same valence, certainty and stage) is strong evidence for a sole driver and moderate evidence for each of two co-drivers.",
    direction:
      "The sign comes from the chain and from the defensible alternatives. Tier is used only to decide which alternatives are defensible comparators; it never grades strength.",
    classes: {
      strong_positive: "realized evidence >= strongMin: the choice's own chain gained decisively through this factor",
      positive: "realized evidence >= positiveMin, or a substantial avoided harm (>= avoidedPositiveMin); avoidance alone never exceeds this",
      negative: "realized loss >= positiveMin, or a forfeited benefit >= missedMin, on a non-defensible choice; or a large forfeited benefit on a defensible one",
      strong_negative: "realized loss or forfeited benefit >= strongMin on a non-defensible choice",
      no_signal: "not enough attributable evidence; this is NOT neutral performance",
    },
    identification:
      "Separately from performance, every MATERIAL contribution of an exposed factor to any option, supporting or opposing, is recorded as factor evidence (an influence) grounded in state paths. A factor is identified as contributing even when another factor decides the tier and even when it yields no signal.",
  },

  // How an influence is measured (deterministic, state-grounded, integer):
  // re-evaluate the option with the factor's terms at the factor's NEUTRAL level
  // and everything else in the final state unchanged. The factor is MATERIAL to
  // the option when that changes at least one stage outcome or its certainty.
  influence: {
    method: "counterfactual: the factor's terms at the neutral level, all other state unchanged",
    material: "at least one stage outcome (or its certainty) differs from the counterfactual",
    roles: { supports: "the counterfactual score is lower", opposes: "the counterfactual score is higher", reshapes: "outcomes change but the score does not" },
    scale: "score units (valence x certainty x stage weight)",
  },

  // Factor contributions are scaled by attribution percent (score * percent),
  // so thresholds below are "score units x 100".
  //
  // CALIBRATION. One EVIDENCE UNIT = 600: a +-1 outcome at medium certainty in
  // the objective/fight stage (1 x 2 x 3 x 100%), fully attributed to one
  // factor. Thresholds are anchored to that unit and checked against
  // representative cases in tests/decisionLab.golden.test.mjs ("signal
  // calibration"), NOT set to reach a share of strong signals:
  //   positiveMin        half a unit: the factor measurably shaped the result
  //   strongMin          ~1.7 units: a decisive outcome mostly owned by ONE
  //                      factor (a +-2 medium outcome fully attributed is 1200;
  //                      the same outcome split between two co-drivers is 600
  //                      each and stays "positive"/"negative")
  //   avoidedPositiveMin one unit: avoiding a harm counts only if the harm was
  //                      substantial; avoidance alone never exceeds "positive"
  //   missedMin / missedStrongMin  the same scale for a forfeited benefit
  //   minAttributionMass below this the outcome chains hold too little evidence
  //                      about the factor to say anything (no_signal)
  signals: {
    positiveMin: 300,
    strongMin: 1000,
    avoidedPositiveMin: 600,
    missedMin: 300,
    missedStrongMin: 1000,
    minAttributionMass: 200,
  },
});

// --- Template definition --------------------------------------------------------

export const OBJECTIVE_TRADE_DATA = deepFreeze({
  id: "objective_trade",
  version: OBJECTIVE_TRADE_TEMPLATE_VERSION,
  status: "draft",

  educationalGoal: {
    id: "objective_trade.goal.1",
    statement:
      "Choose between contesting, setting up for, trading, giving or ignoring an early objective by reading access, fightability, vision, waves and map consequences in the current state, rather than by proximity or by objective name.",
    principles: [
      "objective_priority_is_access_based",
      "objective_trade",
      "giving_an_objective_can_be_correct",
      "gold_lead_is_not_fight_advantage",
      "vision_is_an_active_decision",
    ],
    tracks: ["objective_decisions", "map_pressure", "fightability", "vision_information", "team_coordination", "lane_wave_management"],
  },

  // State Skeleton: which parts of the state must exist. Concrete values are
  // the generator's job. entitySlots declare where Academy-backed references
  // may be attached in future without changing the state schema (all
  // optional; the MVP leaves them empty).
  stateSkeleton: {
    requiredSections: ["gameContext", "teams", "lanes", "waves", "objectives", "vision"],
    derivedSections: ["objectives", "crossMap", "vision", "turretPressure", "infoQuality"], // objectives[*] includes per-objective fightability
    memberSlots: STATE_VOCAB.slots,
    entitySlots: {
      memberRefs: { optional: true, kinds: ["champion", "item", "rune", "spell"], path: "state.raw.teams.*.members.*.refs" },
    },
  },

  requiredFactors: ["objective_value"],
  allowedFactors: FACTOR_IDS,
  forbiddenFactors: [],

  // Several related decision structures; the generator chooses one per scenario.
  structures: {
    CONTEST_VS_TRADE: {
      actions: ["CONTEST", "TRADE"],
      extraActions: ["SETUP"],
      requiresAlternative: true,
      requiresIdle: false,
      requiredFactors: [],
      forbiddenFactors: [],
      minDifficulty: 1,
      weight: 4,
    },
    SETUP_VS_GIVE: {
      actions: ["SETUP", "GIVE"],
      extraActions: ["CONTEST"],
      requiresAlternative: false,
      requiresIdle: true,
      requiredFactors: [],
      forbiddenFactors: ["cross_map_trade"],
      minDifficulty: 1,
      weight: 3,
    },
    TRADE_VS_IGNORE: {
      actions: ["TRADE", "IGNORE"],
      extraActions: ["CONTEST"],
      requiresAlternative: true,
      requiresIdle: false,
      requiredFactors: ["cross_map_trade"],
      forbiddenFactors: [],
      // History: under the first draft of the rule table this structure could
      // only be offered from difficulty 3, because with two options the two
      // required factors (objective_value, cross_map_trade) could not both
      // carry evidence (the old TRADE rule was "cross_map_trade - objective_value").
      // The four-part TRADE evaluation (value gained, value given up, enemy
      // ability to punish, map/turret/wave consequences) supplies that
      // evidence, so the restriction was lifted. tests/decisionLab.generator
      // .test.mjs keeps a per-(structure, difficulty) feasibility check so a
      // future rule change cannot silently reintroduce it.
      minDifficulty: 1,
      weight: 3,
    },
  },
  allowedActions: ["CONTEST", "SETUP", "TRADE", "GIVE", "IGNORE"],

  difficultyRange: { min: 1, max: 4 },
  factorCount: { min: 1, max: 5 },

  constraints: {
    // A third option is only offered from this difficulty up.
    extraOptionMinDifficulty: 3,
    optionCount: { min: 2, max: 3 },
    // Realization order of factors (dependency-aware; see state builder).
    generationOrder: [
      "objective_value",
      "long_term_map_value",
      "team_access",
      "enemy_access",
      "fightability",
      "cross_map_trade",
      "turret_pressure",
      "wave_consequences",
      "vision_gap",
    ],
  },

  invariants: [
    "structure.scenario_shape",
    "structure.versions_present",
    "structure.ref_matches_content",
    "structure.state_immutable",
    "structure.enums_valid",
    "structure.answer_key_shape",
    "structure.entity_refs_shape",
    "structure.raw_state_closed",
    "structure.no_generation_metadata",
    "state.members_complete",
    "state.member_status_position",
    "state.player_alive",
    "state.objective_consistent",
    "state.objective_spawn_supported",
    "state.window_consistent",
    "state.enemy_information_consistent",
    "state.vision_flags_consistent",
    "state.gold_items_coherent",
    "state.derived_rebuildable",
    "state.no_impossible_relationships",
    "decision.options_allowed",
    "decision.structure_matches_actions",
    "decision.option_preconditions_hold",
    "decision.option_ids_valid",
    "decision.answer_key_recomputes",
    "decision.outcomes_supported_by_state",
    "decision.no_numeric_probabilities",
    "decision.has_defensible_option",
    "edu.required_factors_present",
    "edu.forbidden_factors_absent",
    "edu.allowed_factors_only",
    "edu.factor_count_in_range",
    "edu.difficulty_in_template_range",
    "edu.difficulty_profile_satisfied",
    "edu.learning_objective_valid",
    "edu.active_factors_evaluable",
    "edu.inactive_factors_neutral",
    "edu.background_signals_permitted",
    "edu.tier_spread",
    "public.schema_allowlist",
    "public.no_answer_key_fields",
    "public.no_answer_key_values",
    "public.state_matches_projection",
    "public.options_metadata_only",
    "public.ref_and_provenance",
  ],

  // What a scenario built from this template depends on. `entity` is empty
  // in the MVP; a future scenario that names Academy champions/items/runes/
  // spells contributes them to dataFingerprint via state refs (fingerprint.js)
  // without any change to this contract.
  dataDependencies: [
    { kind: "constants", id: "objective_trade" },
    { kind: "registry", id: "factors" },
    { kind: "registry", id: "tracks" },
    { kind: "registry", id: "principles" },
    { kind: "entity", via: "state.raw.teams.*.members.*.refs", optional: true },
  ],
});

// --- Detectors: how each factor level is read out of a state --------------------
// ctx = { raw, derived, constants, primary, alternative, levels }

const STAKES_RANK = { low: 0, medium: 1, high: 2 };
const FOLLOW_RANK = { negative: 0, neutral: 1, positive: 2 };

function relativeLevel(diff, high, low, mid) {
  return diff > 0 ? high : diff < 0 ? low : mid;
}

const DETECTORS = {
  objective_value(ctx) {
    const p = ctx.raw.objectives[ctx.primary];
    const a = ctx.alternative ? ctx.raw.objectives[ctx.alternative] : null;
    const diff = STAKES_RANK[p.stakes] - (a ? STAKES_RANK[a.stakes] : 1);
    const evidence = [`state.raw.objectives.${ctx.primary}.stakes`];
    if (ctx.alternative) evidence.push(`state.raw.objectives.${ctx.alternative}.stakes`);
    return { level: relativeLevel(diff, "high", "low", "medium"), evidence };
  },
  long_term_map_value(ctx) {
    const p = ctx.raw.objectives[ctx.primary];
    const a = ctx.alternative ? ctx.raw.objectives[ctx.alternative] : null;
    const diff = FOLLOW_RANK[p.followUp] - (a ? FOLLOW_RANK[a.followUp] : 1);
    const evidence = [`state.raw.objectives.${ctx.primary}.followUp`];
    if (ctx.alternative) evidence.push(`state.raw.objectives.${ctx.alternative}.followUp`);
    return { level: relativeLevel(diff, "positive", "negative", "neutral"), evidence };
  },
  team_access(ctx) {
    return { level: ctx.derived.objectives[ctx.primary].teamAccess.level, evidence: [`state.derived.objectives.${ctx.primary}.teamAccess`, "state.raw.teams.allies.members"] };
  },
  enemy_access(ctx) {
    return { level: ctx.derived.objectives[ctx.primary].enemyAccess.level, evidence: [`state.derived.objectives.${ctx.primary}.enemyAccess`, "state.raw.teams.enemies.members"] };
  },
  fightability(ctx) {
    const f = ctx.derived.objectives[ctx.primary].fightability;
    const own = `state.derived.objectives.${ctx.primary}.fightability`;
    const slots = STATE_VOCAB.slots;
    const perSlot = (field) => ["allies", "enemies"].flatMap((team) => slots.map((s) => `state.raw.teams.${team}.members.${s}.${field}`));
    const compositions = ["state.raw.teams.allies.composition", "state.raw.teams.enemies.composition"];
    // Evidence names the raw fields that DECIDED the level (composition -> items -> positioning; gold is never among them),
    // so it is distinguishable from team_access / enemy_access evidence, which rests on arrivals, HP and timers.
    let raw;
    if (f.driver === "items") raw = perSlot("completedItems");
    else if (f.driver === "positioning") raw = [...perSlot("zone"), ...perSlot("status")];
    else raw = compositions; // composition, combo_danger, combo_advantage, and the level (even) case
    return { level: f.level, evidence: [own, ...raw] };
  },
  cross_map_trade(ctx) {
    const evidence = [`state.derived.crossMap.${ctx.primary}`];
    if (ctx.alternative) evidence.push(`state.raw.objectives.${ctx.alternative}`);
    return { level: ctx.derived.crossMap[ctx.primary].level, evidence };
  },
  turret_pressure(ctx) {
    return { level: ctx.derived.turretPressure.level, evidence: ["state.derived.turretPressure", "state.raw.lanes"] };
  },
  vision_gap(ctx) {
    const zone = ctx.constants.values.objectives[ctx.primary].zone;
    return { level: ctx.derived.vision[zone].level, evidence: [`state.derived.vision.${zone}`, `state.raw.vision.allies.${zone}`, `state.raw.vision.enemies.${zone}`, `state.raw.vision.fogRisk.${zone}`] };
  },
  wave_consequences(ctx) {
    return { level: ctx.derived.objectives[ctx.primary].waveCost.level, evidence: [`state.derived.objectives.${ctx.primary}.waveCost`, "state.raw.waves"] };
  },
};

/** Detect every registry factor for this state and decision. Returns
 *  { levels, evidence } keyed by factor id. */
export function detectFactors(ctx) {
  const levels = {};
  const evidence = {};
  for (const id of FACTOR_IDS) {
    const d = DETECTORS[id](ctx);
    levels[id] = d.level;
    evidence[id] = d.evidence;
  }
  return { levels, evidence };
}

// --- Terms ------------------------------------------------------------------------

/** Integer value of a named term for this context (levels must be detected). */
export function termValue(name, ctx) {
  const def = OBJECTIVE_TRADE_RULES.terms[name];
  const th = OBJECTIVE_TRADE_RULES.thresholds;
  switch (def.derived) {
    case undefined:
      return def.values[ctx.levels[def.factor]];
    case "vision_opportunity": {
      if (ctx.levels.vision_gap !== "behind") return 0; // a term of the vision_gap factor: neutral factor, no contribution
      const zone = ctx.constants.values.objectives[ctx.primary].zone;
      return ctx.derived.vision[zone].setupOpportunity;
    }
    case "neglect_cost":
      return ctx.raw.objectives[ctx.primary].activity === "enemy_taking" ? OBJECTIVE_TRADE_RULES.terms.objective_value.values[ctx.levels.objective_value] : 0;
    case "trade_gain": {
      if (ctx.levels.cross_map_trade === "none") return 0;
      const worth = OBJECTIVE_TRADE_RULES.terms.objective_value.values[ctx.levels.objective_value]; // value rank of the primary, 0-2
      return Math.min(captureRank(ctx.derived.crossMap[ctx.primary].ourArrivals, th), 2 - worth);
    }
    case "trade_punish":
      return ctx.levels.cross_map_trade === "none" ? 0 : punishRank(ctx.derived.crossMap[ctx.primary].enemyResponse);
    case "trade_punish_spill":
      return ctx.levels.cross_map_trade === "none" ? 0 : punishRank(ctx.derived.crossMap[ctx.primary].enemyResponse) >= 2 ? 1 : 0;
    default:
      throw new Error(`unknown derived term ${def.derived}`);
  }
}

/** State paths that explain a term's value (for explainability/audit). */
export function termEvidence(name, ctx) {
  const def = OBJECTIVE_TRADE_RULES.terms[name];
  switch (def.derived) {
    case undefined:
      return ctx.evidence[def.factor];
    case "vision_opportunity": {
      const zone = ctx.constants.values.objectives[ctx.primary].zone;
      return [`state.derived.vision.${zone}`, `state.raw.vision.safeToClear.${zone}`];
    }
    case "neglect_cost":
      return [`state.raw.objectives.${ctx.primary}.activity`, ...ctx.evidence.objective_value];
    case "trade_gain":
      return [...ctx.evidence.cross_map_trade, ...ctx.evidence.objective_value];
    case "trade_punish":
    case "trade_punish_spill":
      return [...ctx.evidence.cross_map_trade, "state.raw.teams.enemies.members"];
    default:
      throw new Error(`unknown derived term ${def.derived}`);
  }
}

// --- Preconditions (INVALID tier) -------------------------------------------------

// Each rule implements the `availableWhen` of the definition it names.
const PRECONDITION_IMPLS = {
  // SETUP is pre-commitment preparation: unavailable once a team has committed.
  // (Only the enemy can commit in the current state vocabulary; the rule is
  // phrased as "nobody has" so a future ally commitment needs no rule change.)
  no_team_has_committed: (ctx) => ctx.raw.objectives[ctx.primary].activity === "none",
  alternative_objective_in_window: (ctx) => ctx.alternative !== null,
};

/** { ok, reason } for an action in this state. */
export function preconditionOf(actionType, ctx) {
  const pre = OBJECTIVE_TRADE_RULES.preconditions[actionType];
  if (!pre) return { ok: true, reason: null };
  return PRECONDITION_IMPLS[pre.rule](ctx) ? { ok: true, reason: null } : { ok: false, reason: pre.rule };
}

// --- Presentation (deterministic strings; no LLM) ---------------------------------

export function formatClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function objectiveName(id) {
  return OBJECTIVE_NAMES[id];
}

export function optionLabel(actionType, primary, alternative) {
  const p = OBJECTIVE_NAMES[primary];
  switch (actionType) {
    case "CONTEST":
      return `Contest ${p}`;
    case "SETUP":
      return `Set up vision and position around ${p}`;
    case "TRADE":
      return `Trade ${p} for ${OBJECTIVE_NAMES[alternative]}`;
    case "GIVE":
      return `Give ${p}`;
    case "IGNORE":
      return `Ignore ${p} and keep your current plan`;
    default:
      throw new Error(`unknown action ${actionType}`);
  }
}

function availabilityText(o) {
  return o.availableInSec === 0 ? "is up now" : `is available in ${o.availableInSec} seconds`;
}

export function buildPresentation(raw, primary, alternative) {
  const p = raw.objectives[primary];
  let prompt = `It is ${formatClock(raw.gameContext.gameTimeSec)}. ${OBJECTIVE_NAMES[primary]} ${availabilityText(p)}.`;
  if (p.activity === "enemy_taking") prompt += " The enemy team has started taking it.";
  if (alternative) prompt += ` ${OBJECTIVE_NAMES[alternative]} ${availabilityText(raw.objectives[alternative])}.`;
  prompt += " You are the Support. What do you do?";
  return { title: "Objective window", prompt };
}

// --- Assembled template ------------------------------------------------------------

export const OBJECTIVE_TRADE_TEMPLATE = Object.freeze({
  ...OBJECTIVE_TRADE_DATA,
  rules: OBJECTIVE_TRADE_RULES,
  runtime: Object.freeze({ detectFactors, termValue, termEvidence, preconditionOf, optionLabel, buildPresentation }),
});

/** The template's data-only view (no functions) -- what gets hashed. */
export function templateData(template) {
  const { runtime, ...data } = template;
  return data;
}

/** Statuses that gate serving. */
export function templateStatuses(template) {
  return { template: template.status, rules: template.rules.status };
}
