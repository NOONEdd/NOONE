// decisionLab -- Skill Track registry (spec sections 12-13, 59).
//
// Tracks are the middle layer of Factor -> Skill Track -> Global Level.
// All tracks carry equal global weight. A track added in the future starts
// with `initialEvidence: "insufficient_evidence"` and, per the spec, must not
// distort the Global Level until real evidence exists -- Phase 7's Player
// Model reads this field; nothing in the deterministic engine consumes it.
//
// Adding a track: add an entry, bump TRACKS_VERSION. Nothing else changes.

import { deepFreeze } from "./config.js";

export const TRACKS_VERSION = 1;

function track(id, label) {
  return { id, label, weight: 1, initialEvidence: "insufficient_evidence", introducedInTracksVersion: 1 };
}

export const TRACKS = deepFreeze({
  objective_decisions: track("objective_decisions", "Objective Decisions"),
  fightability: track("fightability", "Fightability"),
  vision_information: track("vision_information", "Vision & Information"),
  team_coordination: track("team_coordination", "Team Coordination"),
  tempo_recall: track("tempo_recall", "Tempo & Recall"),
  lane_wave_management: track("lane_wave_management", "Lane & Wave Management"),
  map_pressure: track("map_pressure", "Map & Pressure"),
});

export const TRACK_IDS = deepFreeze(Object.keys(TRACKS));
