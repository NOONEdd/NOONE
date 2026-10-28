// decisionLab -- relationships and derived state (spec sections 15, 28-29).
//
// Raw state is what the scenario asserts (positions, HP, waves, vision...).
// Derived state is computed from raw state here and nowhere else. It is never
// an independent source of truth: deriveState(raw, constants, thresholds) is
// a pure function, the validator re-runs it and requires the stored derived
// block to match (invariant state.derived_rebuildable), and nothing derived
// is ever mutated.
//
// Relationships modelled as first-class rules (not independent randomness):
//   position + timing + HP + status   -> whether a member can reach an objective
//   jungler presence                  -> whether a team's access is "strong"
//   lane wave state + turret state    -> what rotating out of a lane costs
//   ally + enemy arrivals elsewhere   -> cross-map trade potential
//   vision control + fog risk         -> vision gap, and the setup opportunity
//   composition, items, positioning   -> fightability at an objective (gold is deliberately ignored)
//   stale enemy sightings             -> information quality
//
// `thresholds` is the coach-reviewable part of these rules and comes from
// the template's rule table (templates/objectiveTrade.js), not from here.

import { STATE_VOCAB } from "./config.js";

const { slots, lanerSlots, laneOfZone } = STATE_VOCAB;

export { laneOfZone };

const CONTROL_RANK = { none: 0, partial: 1, full: 2 };
const LEVEL_RANK = { low: 0, medium: 1, high: 2 };

/** Wave state -> what pulling the laner out of that lane costs (0 none, 1 some, 2 severe). */
const WAVE_LANE_COST = {
  crashing_into_enemy: 0,
  pushed_to_enemy: 0,
  neutral: 1,
  pushed_to_ally: 1,
  crashing_into_ally: 2,
};

export function travelDelaySec(fromZone, toZone, constants) {
  const cls = constants.values.distance[fromZone][toZone];
  return constants.values.travelSec[cls];
}

/** Relationship: status + HP + position + timing -> can this member be at the
 *  objective by the time it is available (plus the contest grace period)? */
export function memberArrives(member, objectiveZone, availableInSec, constants) {
  if (member.status !== "alive") return false;
  if (member.hpBand === "low") return false; // too hurt to contest
  const delay = travelDelaySec(member.zone, objectiveZone, constants);
  return delay <= availableInSec + constants.values.window.contestGraceSec;
}

export function accessLevel(count, jungleArrives, th) {
  // Relationship: jungler position gates "strong" access.
  if (count >= th.strongMinArrivals && jungleArrives) return "strong";
  if (count >= th.partialMinArrivals) return "partial";
  return "weak";
}

export function accessOf(members, zone, availableInSec, constants, th) {
  const arrivals = slots.filter((s) => memberArrives(members[s], zone, availableInSec, constants));
  const jungleArrives = arrivals.includes("jungle");
  return { arrivals, count: arrivals.length, jungleArrives, level: accessLevel(arrivals.length, jungleArrives, th) };
}

/** Relationship: wave -> rotation cost. Only lane members who are still in
 *  their home lane pay it (someone who already left has sunk that cost). */
export function waveCostOf(raw, arrivals) {
  let cost = 0;
  const drivers = [];
  for (const slot of arrivals) {
    if (!lanerSlots.includes(slot)) continue;
    const home = STATE_VOCAB.homeZone[slot];
    if (raw.teams.allies.members[slot].zone !== home) continue;
    const lane = laneOfZone[home];
    let c = WAVE_LANE_COST[raw.waves[lane]];
    if (c >= 1 && raw.lanes[lane].turret.allied === "vulnerable") c = Math.min(2, c + 1);
    if (c > 0) drivers.push({ slot, lane, cost: c });
    if (c > cost) cost = c;
  }
  return { cost, level: ["low", "medium", "high"][cost], drivers };
}

export function crossMapLevel(ourArrivals, enemyResponse, th) {
  if (ourArrivals >= th.crossMap.strong.ourMin && enemyResponse <= th.crossMap.strong.enemyMax) return "strong";
  if (ourArrivals >= th.crossMap.limited.ourMin && enemyResponse <= th.crossMap.limited.enemyMax) return "limited";
  return "none";
}

/** Relationship: vision control + fog risk -> where we stand around a zone. */
export function visionLevel(allyControl, enemyControl, fog) {
  const diff = CONTROL_RANK[allyControl] - CONTROL_RANK[enemyControl];
  if (diff < 0) return "behind";
  if (fog === "high" && allyControl !== "full") return diff >= 1 ? "even" : "behind";
  if (diff > 0) return "ahead";
  return "even";
}

/** A Support can only usefully set up vision when behind AND it is safe to
 *  clear; being behind with no safe way to clear makes a vision check unsafe. */
export function setupOpportunity(level, safeToClear) {
  if (level !== "behind") return 0;
  return safeToClear ? 1 : -1;
}

export function turretPressureOf(lanes) {
  let score = 0;
  for (const lane of STATE_VOCAB.lanes) {
    const l = lanes[lane];
    if (l.pressure === "ally" && (l.turret.enemy === "damaged" || l.turret.enemy === "vulnerable")) score += 1;
    else if (l.pressure === "enemy" && (l.turret.allied === "damaged" || l.turret.allied === "vulnerable")) score -= 1;
  }
  return { score, level: score > 0 ? "favorable" : score < 0 ? "unfavorable" : "neutral" };
}

function threat(comp) {
  return LEVEL_RANK[comp.burst] + LEVEL_RANK[comp.crowdControl] + LEVEL_RANK[comp.engage];
}
function comboDanger(attacker, defender) {
  return attacker.burst === "high" && attacker.crowdControl === "high" && defender.crowdControl !== "high";
}
function edgeOf(diff, deadzone) {
  return Math.abs(diff) <= deadzone ? 0 : diff > 0 ? 1 : -1;
}

/** Fightability at an objective (spec section 21): champion composition
 *  first, then item advantage, then POSITIONING. A burst + crowd-control
 *  combination the other side cannot match caps the result. GOLD IS NOT AN
 *  INPUT -- a gold lead is not a fight advantage.
 *
 *  Positioning means who already holds the ground at the objective: the
 *  number of members standing in the objective's zone right now. It is a
 *  different question from ACCESS, which counts who can ARRIVE in time
 *  (someone arriving from a neighbouring zone does not hold the ground).
 *  Positioning only decides when composition and items are level, so the
 *  spec's order (composition -> items -> positioning) holds by construction.
 *
 *  Pass `zone` for a fight at an objective. Without a zone (used only when
 *  sampling composition and items) the positioning edge is 0. */
export function fightabilityOf(raw, th, zone = null) {
  const A = raw.teams.allies;
  const E = raw.teams.enemies;
  const compDiff = threat(A.composition) - threat(E.composition);
  const sum = (t) => slots.reduce((n, s) => n + t.members[s].completedItems, 0);
  const itemDiff = sum(A) - sum(E);
  const holding = (t) => (zone === null ? 0 : slots.filter((s) => t.members[s].status === "alive" && t.members[s].zone === zone).length);
  const posDiff = holding(A) - holding(E);
  const compEdge = edgeOf(compDiff, th.compDeadzone);
  const itemEdge = edgeOf(itemDiff, th.itemDeadzone);
  const posEdge = edgeOf(posDiff, th.positionDeadzone);
  let edge = compEdge !== 0 ? compEdge : itemEdge !== 0 ? itemEdge : posEdge;
  let driver = compEdge !== 0 ? "composition" : itemEdge !== 0 ? "items" : posEdge !== 0 ? "positioning" : "none";
  const enemyCombo = comboDanger(E.composition, A.composition);
  const allyCombo = comboDanger(A.composition, E.composition);
  if (enemyCombo && !allyCombo && edge > -1) {
    edge = -1;
    driver = "combo_danger";
  } else if (allyCombo && !enemyCombo && edge < 1) {
    edge = 1;
    driver = "combo_advantage";
  }
  return { level: edge > 0 ? "favorable" : edge < 0 ? "unfavorable" : "even", edge, driver, compDiff, itemDiff, posDiff, compEdge, itemEdge, posEdge, enemyCombo, allyCombo };
}

/** Cross-map trade, in ranks (used by the TRADE rules). */
export function captureRank(ourArrivals, th) {
  return ourArrivals >= th.crossMap.strong.ourMin ? 2 : ourArrivals >= th.crossMap.limited.ourMin ? 1 : 0;
}
export function punishRank(enemyResponse) {
  return Math.min(2, enemyResponse);
}

/** Information quality: how many enemy sightings are stale. Affects the
 *  CERTAINTY of outcomes, never their direction. */
export function infoQualityOf(raw, constants, th) {
  const stale = constants.values.info.staleAfterSec;
  let staleCount = 0;
  for (const s of slots) {
    const m = raw.teams.enemies.members[s];
    if (m.status === "alive" && m.lastSeenAgoSec > stale) staleCount += 1;
  }
  const j = raw.teams.enemies.members.jungle;
  const junglerStale = j.status === "alive" && j.lastSeenAgoSec > stale;
  let level = "clear";
  if (staleCount >= th.infoPoorStaleCount) level = "poor";
  else if (staleCount >= th.infoPartialStaleCount || junglerStale) level = "partial";
  return { level, staleCount, junglerStale };
}

/** Everything derived from raw state. Pure. */
export function deriveState(raw, constants, th) {
  const objectives = {};
  const crossMap = {};
  const vision = {};
  for (const zone of STATE_VOCAB.laneZones) {
    const level = visionLevel(raw.vision.allies[zone], raw.vision.enemies[zone], raw.vision.fogRisk[zone]);
    vision[zone] = { level, setupOpportunity: setupOpportunity(level, raw.vision.safeToClear[zone]) };
  }

  for (const id of STATE_VOCAB.objectiveIds) {
    const o = raw.objectives[id];
    if (o.status === "not_in_window") {
      objectives[id] = null;
      continue;
    }
    const zone = constants.values.objectives[id].zone;
    const teamAccess = accessOf(raw.teams.allies.members, zone, o.availableInSec, constants, th);
    objectives[id] = {
      zone,
      availableInSec: o.availableInSec,
      teamAccess,
      enemyAccess: accessOf(raw.teams.enemies.members, zone, o.availableInSec, constants, th),
      waveCost: waveCostOf(raw, teamAccess.arrivals),
      vision: vision[zone],
      fightability: fightabilityOf(raw, th, zone),
    };
  }

  for (const id of STATE_VOCAB.objectiveIds) {
    if (objectives[id] === null) {
      crossMap[id] = null;
      continue;
    }
    const altId = STATE_VOCAB.objectiveIds.find((x) => x !== id);
    const alt = raw.objectives[altId];
    if (alt.status === "not_in_window") {
      crossMap[id] = { alternative: null, ourArrivals: 0, enemyResponse: 0, committed: [], level: "none" };
      continue;
    }
    const altZone = constants.values.objectives[altId].zone;
    const primary = raw.objectives[id];
    const primaryZone = constants.values.objectives[id].zone;
    const ourArrivals = slots.filter((s) => memberArrives(raw.teams.allies.members[s], altZone, alt.availableInSec, constants));
    // Relationship: enemies already committed to the primary objective are
    // not available to punish a trade elsewhere.
    const committed =
      primary.activity === "enemy_taking"
        ? slots.filter((s) => raw.teams.enemies.members[s].status === "alive" && raw.teams.enemies.members[s].zone === primaryZone)
        : [];
    const enemyResponse = slots.filter((s) => !committed.includes(s) && memberArrives(raw.teams.enemies.members[s], altZone, alt.availableInSec, constants));
    crossMap[id] = {
      alternative: altId,
      ourArrivals: ourArrivals.length,
      enemyResponse: enemyResponse.length,
      committed,
      level: crossMapLevel(ourArrivals.length, enemyResponse.length, th),
    };
  }

  return {
    objectives,
    crossMap,
    vision,
    turretPressure: turretPressureOf(raw.lanes),
    infoQuality: infoQualityOf(raw, constants, th),
  };
}
