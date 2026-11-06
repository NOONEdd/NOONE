// decisionLab -- State Builder (spec sections 7, 14-18, 26-30).
//
// Builds the RAW state for one candidate scenario so that it is internally
// coherent BY CONSTRUCTION, not by hoping random values line up:
//
//   * Team positions are chosen by exhaustive enumeration of placements that
//     satisfy the requested access levels, jungler gating, cross-map
//     potential and "enemy is taking it" constraints together. If no
//     placement satisfies them the candidate is infeasible and the generator
//     backtracks (tries another candidate); nothing invalid is ever patched.
//   * Waves are enumerated against the arrivals that were just chosen, so the
//     requested wave-consequence level is realized rather than randomly hit.
//   * Vision controls are chosen jointly with enemy sightings, so an enemy
//     can only be "freshly seen" where we actually have eyes.
//   * Fightability is REALIZED, never generated as a fact: the requested
//     level is met by sampling composition and items (and, when positioning
//     is the driver, by choosing how many members hold the objective's zone),
//     then confirmed by the same derivation the evaluator uses. Gold is
//     sampled afterwards and is deliberately not an input to fightability.
//
// Raw state only asserts what a player could know. Derived state is computed
// elsewhere (relationships.deriveState). The builder does not decide tiers.
//
// Also here: the public state projection (spec section 16).

import { STATE_VOCAB, GENERATION_LIMITS } from "./config.js";
import { memberArrives, crossMapLevel, accessLevel, fightabilityOf, turretPressureOf, waveCostOf, visionLevel } from "./relationships.js";
import { formatClock } from "./templates/objectiveTrade.js";

const { slots, lanerSlots, homeZone, laneZones, lanes } = STATE_VOCAB;

// Candidate (zone, status) placements for one team member.
const PLACEMENTS = Object.freeze([
  { zone: "top_side", status: "alive" },
  { zone: "mid", status: "alive" },
  { zone: "bot_side", status: "alive" },
  { zone: "base", status: "recalling" },
  { zone: "base", status: "dead" },
]);

function placementFlags(zoneX, pX, zoneY, pY, constants) {
  return PLACEMENTS.map((pl) => {
    const probe = { status: pl.status, hpBand: "high", zone: pl.zone };
    return {
      alive: pl.status === "alive",
      arrX: memberArrives(probe, zoneX, pX, constants),
      arrY: zoneY === null ? false : memberArrives(probe, zoneY, pY, constants),
      atX: pl.status === "alive" && pl.zone === zoneX,
    };
  });
}

/** Enumerate every 5-member placement (slot order = STATE_VOCAB.slots) that
 *  respects the unavailable-member cap and satisfies `accept`. */
function enumeratePlacements({ flags, supportAliveOnly, committedMode, accept }) {
  const homeArr = slots.map((slot, k) =>
    PLACEMENTS.map((pl, i) => lanerSlots.includes(slot) && pl.status === "alive" && pl.zone === homeZone[slot] && flags[i].arrX),
  );
  const results = [];
  const choice = new Array(slots.length);
  const jungleIdx = slots.indexOf("jungle");
  const supportIdx = slots.indexOf("support");
  function rec(k, unavailable, countX, jungleX, ourY, resp, home, atX) {
    if (unavailable > GENERATION_LIMITS.maxUnavailablePerTeam) return;
    if (k === slots.length) {
      const c = { countX, jungleX, ourY, resp, home, atX };
      if (accept(c)) results.push(choice.slice());
      return;
    }
    const max = supportAliveOnly && k === supportIdx ? 3 : PLACEMENTS.length;
    for (let i = 0; i < max; i++) {
      choice[k] = i;
      const f = flags[i];
      const committed = committedMode && f.atX;
      rec(
        k + 1,
        unavailable + (f.alive ? 0 : 1),
        countX + (f.arrX ? 1 : 0),
        jungleX || (k === jungleIdx && f.arrX),
        ourY + (f.arrY ? 1 : 0),
        resp + (f.arrY && !committed ? 1 : 0),
        home + (homeArr[k][i] ? 1 : 0),
        atX + (f.atX ? 1 : 0),
      );
    }
  }
  rec(0, 0, 0, false, 0, 0, 0, 0);
  return results;
}

// --- Objectives ---------------------------------------------------------------

/** Pick (primary, alternative) values from an ordered vocabulary so that the
 *  primary is above (+1), equal to (0) or below (-1) the alternative -- the
 *  relative reading the template's detectors use. With no alternative the
 *  primary is read against the middle value. */
function relativePair(rng, ordered, direction, hasAlternative) {
  if (!hasAlternative) return [ordered[1 + direction], ordered[1]];
  const pairs = [];
  for (let p = 0; p < ordered.length; p++) {
    for (let a = 0; a < ordered.length; a++) {
      if (Math.sign(p - a) === direction) pairs.push([ordered[p], ordered[a]]);
    }
  }
  return rng.pick(pairs);
}

const DIRECTION = {
  objective_value: { low: -1, medium: 0, high: 1 },
  long_term_map_value: { negative: -1, neutral: 0, positive: 1 },
};

// --- Composition / items / gold ---------------------------------------------------

function drawComposition(rng) {
  const c = {};
  for (const dim of STATE_VOCAB.compositionDims) c[dim] = rng.pick(STATE_VOCAB.compositionLevel);
  return c;
}
function drawItems(rng) {
  const items = {};
  for (const s of slots) items[s] = rng.int(0, STATE_VOCAB.maxCompletedItems);
  return items;
}
function fightProbe(A, E) {
  const members = (items) => Object.fromEntries(slots.map((s) => [s, { completedItems: items[s] }]));
  return { teams: { allies: { composition: A.composition, members: members(A.items) }, enemies: { composition: E.composition, members: members(E.items) } } };
}

const EDGE_OF_LEVEL = { unfavorable: -1, even: 0, favorable: 1 };

/** Fightability drivers a non-even level can be realized through. */
export const FIGHTABILITY_DRIVERS = Object.freeze(["composition", "items", "combo", "positioning"]);

/** Sample composition + items so that fightability (before positioning)
 *  reads as requested:
 *    even         composition, items and combos all level; positioning must
 *                 then be level too (enforced when placing members)
 *    composition  composition alone decides the requested edge
 *    items        composition level, items decide
 *    combo        a burst + crowd-control combination decides
 *    positioning  composition and items level and no combo -- positioning
 *                 (chosen when placing members) will decide
 *  The probe carries no zone, so its positioning edge is 0. */
function sampleBackground(rng, th, targetEdge, driver) {
  const matches = (f) => {
    if (targetEdge === 0 || driver === "positioning") return f.edge === 0 && f.driver === "none";
    if (driver === "combo") return f.edge === targetEdge && (f.driver === "combo_danger" || f.driver === "combo_advantage");
    return f.edge === targetEdge && f.driver === driver;
  };
  for (let i = 0; i < GENERATION_LIMITS.maxCompositionDraws; i++) {
    const A = { composition: drawComposition(rng), items: drawItems(rng) };
    const E = { composition: drawComposition(rng), items: drawItems(rng) };
    const f = fightabilityOf(fightProbe(A, E), th);
    if (matches(f)) return { A, E, fightability: f };
  }
  return null;
}

/** Relationship: item advantage <-> gold. A clear item lead cannot coexist
 *  with being behind on gold (and vice versa). Gold itself is otherwise free,
 *  which is what lets a scenario show "ahead on gold but in a bad fight". */
export function goldCoherentWithItems(goldBand, itemDiff) {
  if (itemDiff >= 2) return goldBand !== "behind";
  if (itemDiff <= -2) return goldBand !== "ahead";
  return true;
}

function sampleGold(rng, itemDiff, fightEdge) {
  const options = STATE_VOCAB.goldBand.filter((g) => goldCoherentWithItems(g, itemDiff));
  // When the fight edge is non-neutral, favour the misleading gold reading.
  const weights = options.map((g) => {
    if (fightEdge < 0) return g === "ahead" ? 3 : 1;
    if (fightEdge > 0) return g === "behind" ? 3 : 1;
    return 1;
  });
  return rng.weightedPick(options, weights);
}

// --- Vision ----------------------------------------------------------------------

function buildVision({ rng, constants, targetLevel, primaryZone, safeToClearPrimary, allies, enemies, infoMode }) {
  const stale = constants.values.info.staleAfterSec;
  const controls = STATE_VOCAB.visionControl;
  const fogs = STATE_VOCAB.fogRisk;
  const presentAlly = (zone) => slots.some((s) => allies[s].status === "alive" && allies[s].zone === zone);
  const presentEnemy = (zone) => slots.some((s) => enemies[s].status === "alive" && enemies[s].zone === zone);

  const vision = { allies: {}, enemies: {}, fogRisk: {}, safeToClear: {} };
  for (const zone of laneZones) {
    const triples = [];
    for (const a of controls) {
      for (const e of controls) {
        for (const f of fogs) {
          if (f === "high" && a === "full") continue; // full control leaves no fog to fear
          if (infoMode === "clear" && presentEnemy(zone) && !presentAlly(zone) && a === "none") continue;
          if (zone === primaryZone && visionLevel(a, e, f) !== targetLevel) continue;
          if (zone === primaryZone && safeToClearPrimary === true && e === "none") continue; // nothing to clear
          triples.push([a, e, f]);
        }
      }
    }
    if (triples.length === 0) return null;
    const [a, e, f] = rng.pick(triples);
    vision.allies[zone] = a;
    vision.enemies[zone] = e;
    vision.fogRisk[zone] = f;
    vision.safeToClear[zone] = zone === primaryZone && safeToClearPrimary !== null ? safeToClearPrimary && e !== "none" : e !== "none" && rng.chance(1, 2);
  }

  const lastSeen = {};
  for (const s of slots) {
    const m = enemies[s];
    const fresh = () => rng.int(0, Math.min(10, stale));
    const old = () => stale + rng.int(1, stale);
    if (m.status !== "alive") {
      lastSeen[s] = fresh();
      continue;
    }
    const ctl = vision.allies[m.zone];
    const ally = presentAlly(m.zone);
    const mustFresh = ally || ctl === "full";
    const cannotFresh = !ally && ctl === "none";
    if (infoMode === "clear" || mustFresh) lastSeen[s] = fresh();
    else if (cannotFresh) lastSeen[s] = old();
    else lastSeen[s] = rng.chance(1, 2) ? fresh() : old();
  }
  return { vision, lastSeen };
}

// --- Main builder ------------------------------------------------------------------

/** Build the raw state for one candidate.
 *
 *  spec = {
 *    primary, alternative | null, windowKind, activity,
 *    gameTimeSec, availableInSec: { primary, alternative },
 *    targets: { <factorId>: <level> }      (all registry factors),
 *    fightabilityDriver: "composition"|"items"|"combo"|"positioning"   (ignored when targets.fightability is "even"),
 *    crossMapCounts: { ourY, resp }   (exact arrivals at the alternative for us / the enemy's response; required
 *                                      when the alternative exists and targets.cross_map_trade is not "none"),
 *    background: { infoMode: "clear"|"free" },
 *    safeToClearPrimary: true|false|null   (null = free choice),
 *  }
 *  Returns { ok: true, raw } or { ok: false, reason }. */
export function buildRawState({ spec, constants, rules, rng }) {
  const th = rules.thresholds;
  const { primary, alternative, windowKind, activity, gameTimeSec, availableInSec, targets, background } = spec;
  const v = constants.values;
  const zoneX = v.objectives[primary].zone;
  const zoneY = alternative ? v.objectives[alternative].zone : null;
  const pX = availableInSec.primary;
  const pY = alternative ? availableInSec.alternative : null;

  if (!alternative && targets.cross_map_trade !== "none") return { ok: false, reason: "cross_map_needs_alternative" };

  // 1. Objectives (state facts the coarse factors read directly).
  const rObj = rng.fork("objectives");
  const [pStakes, aStakes] = relativePair(rObj, STATE_VOCAB.stakes, DIRECTION.objective_value[targets.objective_value], alternative !== null);
  const [pFollow, aFollow] = relativePair(rObj, STATE_VOCAB.followUp, DIRECTION.long_term_map_value[targets.long_term_map_value], alternative !== null);
  const statusOf = (sec) => (sec === 0 ? "available" : "upcoming");
  const objectives = {};
  for (const id of STATE_VOCAB.objectiveIds) {
    if (id === primary) {
      objectives[id] = { status: statusOf(pX), availableInSec: pX, stakes: pStakes, followUp: pFollow, activity };
    } else if (alternative) {
      objectives[id] = { status: statusOf(pY), availableInSec: pY, stakes: aStakes, followUp: aFollow, activity: "none" };
    } else {
      objectives[id] = { status: "not_in_window", availableInSec: null, stakes: "medium", followUp: "neutral", activity: "none" };
    }
  }

  // 2. Composition and items, realizing the requested fightability driver.
  const fightEdge = EDGE_OF_LEVEL[targets.fightability];
  const driver = spec.fightabilityDriver || "composition";
  const bg = sampleBackground(rng.fork("background"), th, fightEdge, driver);
  if (!bg) return { ok: false, reason: "background_infeasible" };
  // Positioning: how many members hold the objective's zone on each side.
  const posMode = fightEdge === 0 ? "even" : driver === "positioning" ? (fightEdge > 0 ? "favorable" : "unfavorable") : "free";
  const positionOk = (allyHolding, enemyHolding) => {
    const d = allyHolding - enemyHolding;
    if (posMode === "even") return Math.abs(d) <= th.positionDeadzone;
    if (posMode === "favorable") return d > th.positionDeadzone;
    if (posMode === "unfavorable") return d < -th.positionDeadzone;
    return true;
  };
  const counts = spec.crossMapCounts || null;
  if (alternative && targets.cross_map_trade !== "none" && !counts) return { ok: false, reason: "cross_map_counts_missing" };

  // 3. Team placements, by exhaustive enumeration.
  const rPlace = rng.fork("placement");
  const flags = placementFlags(zoneX, pX, zoneY, pY, constants);
  const allyMatches = enumeratePlacements({
    flags,
    supportAliveOnly: true, // the player is the Support and is alive
    committedMode: false,
    accept: (c) => {
      if (accessLevel(c.countX, c.jungleX, th) !== targets.team_access) return false;
      if (targets.wave_consequences !== "low" && c.home < 1) return false; // someone must leave a lane to pay a wave cost
      if (alternative) {
        if (targets.cross_map_trade === "none") return c.ourY < th.crossMap.limited.ourMin;
        return c.ourY === counts.ourY;
      }
      return true;
    },
  });
  if (allyMatches.length === 0) return { ok: false, reason: "ally_placement_infeasible" };

  let allyChoice = null;
  let enemyChoice = null;
  const tries = rPlace.shuffle(allyMatches).slice(0, GENERATION_LIMITS.maxAllyCombosTried);
  for (const cand of tries) {
    const ourY = cand.reduce((n, i) => n + (flags[i].arrY ? 1 : 0), 0);
    const allyHolding = cand.reduce((n, i) => n + (flags[i].atX ? 1 : 0), 0);
    const enemyMatches = enumeratePlacements({
      flags,
      supportAliveOnly: false,
      committedMode: activity === "enemy_taking",
      accept: (c) => {
        if (accessLevel(c.countX, c.jungleX, th) !== targets.enemy_access) return false;
        if (activity === "enemy_taking" && c.atX < th.enemyTakingMinAtObjective) return false;
        if (!positionOk(allyHolding, c.atX)) return false;
        if (alternative) {
          if (crossMapLevel(ourY, c.resp, th) !== targets.cross_map_trade) return false;
          return targets.cross_map_trade === "none" || c.resp === counts.resp;
        }
        return true;
      },
    });
    if (enemyMatches.length > 0) {
      allyChoice = cand;
      enemyChoice = rPlace.pick(enemyMatches);
      break;
    }
  }
  if (!allyChoice) return { ok: false, reason: "enemy_placement_infeasible" };

  // 4. HP: anyone who reaches an objective by position must not be low.
  const rHp = rng.fork("hp");
  const makeMembers = (choice, items, isEnemy) => {
    const members = {};
    slots.forEach((slot, k) => {
      const pl = PLACEMENTS[choice[k]];
      const f = flags[choice[k]];
      let hpBand;
      if (pl.status === "dead") hpBand = "none";
      else if (f.arrX || f.arrY) hpBand = rHp.weightedPick(["high", "medium"], [7, 3]);
      else if (pl.status === "recalling") hpBand = rHp.pick(["medium", "low"]);
      else hpBand = rHp.weightedPick(["high", "medium", "low"], [4, 3, 3]);
      const m = { zone: pl.zone, status: pl.status, hpBand, completedItems: items[slot] };
      if (isEnemy) m.lastSeenAgoSec = 0; // set after vision is chosen
      members[slot] = m;
    });
    return members;
  };
  const allies = makeMembers(allyChoice, bg.A.items, false);
  const enemies = makeMembers(enemyChoice, bg.E.items, true);

  // 5. Lanes / turrets / pressure, sampled until the turret-pressure level matches.
  const rLane = rng.fork("lanes");
  const laneOptions = [];
  for (const pressure of STATE_VOCAB.lanePressure) {
    for (const allied of STATE_VOCAB.turretState) {
      for (const enemy of STATE_VOCAB.turretState) laneOptions.push({ turret: { allied, enemy }, pressure });
    }
  }
  let laneState = null;
  for (let i = 0; i < 80 && !laneState; i++) {
    const cand = {};
    for (const lane of lanes) cand[lane] = rLane.pick(laneOptions);
    if (turretPressureOf(cand).level === targets.turret_pressure) laneState = cand;
  }
  if (!laneState) return { ok: false, reason: "turret_pressure_infeasible" };
  const lanesRaw = {};
  for (const lane of lanes) lanesRaw[lane] = { turret: { allied: laneState[lane].turret.allied, enemy: laneState[lane].turret.enemy }, pressure: laneState[lane].pressure };

  // 6. Waves, enumerated against the arrivals just chosen.
  const rWave = rng.fork("waves");
  const arrivals = slots.filter((s) => memberArrives(allies[s], zoneX, pX, constants));
  const waveMatches = [];
  const ws = STATE_VOCAB.waveState;
  for (const top of ws) {
    for (const mid of ws) {
      for (const bot of ws) {
        const probe = { teams: { allies: { members: allies } }, waves: { top, mid, bot }, lanes: lanesRaw };
        if (waveCostOf(probe, arrivals).level === targets.wave_consequences) waveMatches.push({ top, mid, bot });
      }
    }
  }
  if (waveMatches.length === 0) return { ok: false, reason: "wave_infeasible" };
  const waves = rWave.pick(waveMatches);

  // 7. Vision + enemy sightings.
  const visionResult = buildVision({ rng: rng.fork("vision"), constants, targetLevel: targets.vision_gap, primaryZone: zoneX, safeToClearPrimary: spec.safeToClearPrimary === undefined ? null : spec.safeToClearPrimary, allies, enemies, infoMode: background.infoMode });
  if (!visionResult) return { ok: false, reason: "vision_infeasible" };
  for (const s of slots) enemies[s].lastSeenAgoSec = visionResult.lastSeen[s];

  // 8. Gold.
  const goldBand = sampleGold(rng.fork("gold"), bg.fightability.itemDiff, fightEdge);

  const raw = {
    gameContext: { gameTimeSec, windowKind, goldBand },
    teams: {
      allies: { composition: bg.A.composition, members: allies },
      enemies: { composition: bg.E.composition, members: enemies },
    },
    lanes: lanesRaw,
    waves: { top: waves.top, mid: waves.mid, bot: waves.bot },
    objectives,
    vision: visionResult.vision,
  };
  return { ok: true, raw };
}

// --- Public projection (spec section 16) ------------------------------------------

function copyMember(m) {
  const out = { zone: m.zone, status: m.status, hpBand: m.hpBand, completedItems: m.completedItems };
  if (m.lastSeenAgoSec !== undefined) out.lastSeenAgoSec = m.lastSeenAgoSec;
  if (m.refs !== undefined) out.refs = JSON.parse(JSON.stringify(m.refs)); // future Academy-backed references pass through
  return out;
}

/** Internal state -> what the player may see. Exposes everything the player
 *  reasons from (positions, HP, waves, vision, objective timers, coarse
 *  stakes/follow-up tags, composition, gold) and nothing derived or
 *  evaluative: no derived block, no factor levels, no tiers. */
export function projectPublicState(raw, constants) {
  const team = (t) => ({
    composition: { ...t.composition },
    members: Object.fromEntries(slots.map((s) => [s, copyMember(t.members[s])])),
  });
  const objectives = {};
  for (const id of STATE_VOCAB.objectiveIds) {
    const o = raw.objectives[id];
    objectives[id] = { zone: constants.values.objectives[id].zone, status: o.status, availableInSec: o.availableInSec, stakes: o.stakes, followUp: o.followUp, activity: o.activity };
  }
  return {
    gameContext: { gameClock: formatClock(raw.gameContext.gameTimeSec), gameTimeSec: raw.gameContext.gameTimeSec, windowKind: raw.gameContext.windowKind, goldBand: raw.gameContext.goldBand },
    teams: { allies: team(raw.teams.allies), enemies: team(raw.teams.enemies) },
    lanes: JSON.parse(JSON.stringify(raw.lanes)),
    waves: { ...raw.waves },
    objectives,
    vision: JSON.parse(JSON.stringify(raw.vision)),
  };
}
