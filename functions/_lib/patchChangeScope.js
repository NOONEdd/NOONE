// Patch Notes -- change SCOPE classification (extraction layer). Pure, deterministic, no I/O, no AI, no game knowledge about any champion.
//
// Question answered: "what KIND of thing is this change about?" -- base stats, a passive, an ability, some other champion mechanic, an
// item, a rune or a system rule. It is derived ONLY from evidence in Riot's own document (never from position, never from a champion's
// name, never from Academy data), recorded together with the evidence it rests on (`basis`), and stored on the change as
// `change.scope` / `change.scopeBasis`. Riot's heading is NOT replaced: `change.subsection.sourceHeading` stays exactly as written.
//
// Evidence, strongest first (champion changes):
//   riot_slot_notation   the heading itself carries Riot's explicit slot notation: "Passive - X" -> PASSIVE, "Q - X" / "(2) X" /
//                        "Ultimate X" -> ABILITY. Never inferred from order ("the second block is W" is exactly what this never does).
//   riot_stats_heading   the heading IS Riot's stats section name ("Base Stats", "Stats"; case, markup and a trailing colon ignored)
//                        -> BASE_STATS. A small list of Riot's own structural section names, not a list of champions.
//   riot_named_block     any other heading Riot gives a block of a champion's changes ("Absolution", "You and Me!") -> ABILITY.
//                        This is the one default: Riot's named blocks under a champion ARE its abilities. When a section is not
//                        (a mechanic Riot gives its own heading), a reviewer marks it once (setSubsectionScope) and that override
//                        is review-layer state that survives regeneration; no code change and no growing exception list.
//   no_riot_subsection   Riot filed the change under no heading at all -> CHAMPION_MECHANIC (a champion-specific change that is
//                        neither stats nor an ability *as Riot structured it*; nothing is invented to make it one).
//   entity_lifecycle     a champion added to / removed from the game -> CHAMPION_MECHANIC (it is about the champion, not a section of it)
// Items, runes and system changes are scoped by what owns them (entity_type / system_section); their headings are never "abilities".
//
// The ability-icon system never decides any of this: the page asks isAbilityScope() (src/lib/patchNotesPresentation.js) and only then
// calls the icon lookup.

import { CHANGE_SCOPE } from "../../src/lib/patchNotesPresentation.js";
import { slotFromLabel } from "./patchChangeDetector.js";

export const SCOPE_BASIS = Object.freeze({
  EXPLICIT_SLOT: "riot_slot_notation", STATS_HEADING: "riot_stats_heading", NAMED_BLOCK: "riot_named_block",
  NO_SUBSECTION: "no_riot_subsection", ENTITY_LIFECYCLE: "entity_lifecycle", ENTITY_TYPE: "entity_type", SYSTEM_SECTION: "system_section",
});

// Riot's own names for the stats section of a champion. Matched on the whole heading, case-insensitively, after markup/colon removal.
const STATS_HEADING = /^(?:base\s+)?(?:stats|statistics)$/i;
const clean = (h) => String(h == null ? "" : h).replace(/\*+/g, "").replace(/_{2,}/g, "").replace(/:\s*$/, "").replace(/\s+/g, " ").trim();

/** @param {{kind?:string, entityType?:string|null, lifecycle?:object|null, subsectionHeading?:string|null}} change
 *  @returns {{scope:string, basis:string}} */
export function classifyChangeScope({ kind, entityType, lifecycle, subsectionHeading } = {}) {
  if (kind === "system") return { scope: CHANGE_SCOPE.SYSTEM, basis: SCOPE_BASIS.SYSTEM_SECTION };
  if (entityType === "item") return { scope: CHANGE_SCOPE.ITEM, basis: SCOPE_BASIS.ENTITY_TYPE };
  if (entityType === "rune") return { scope: CHANGE_SCOPE.RUNE, basis: SCOPE_BASIS.ENTITY_TYPE };
  // champion (the only other entity type)
  if (lifecycle) return { scope: CHANGE_SCOPE.CHAMPION_MECHANIC, basis: SCOPE_BASIS.ENTITY_LIFECYCLE };
  const heading = clean(subsectionHeading);
  if (!heading) return { scope: CHANGE_SCOPE.CHAMPION_MECHANIC, basis: SCOPE_BASIS.NO_SUBSECTION };
  const { slot } = slotFromLabel(heading);
  if (slot === "Passive") return { scope: CHANGE_SCOPE.PASSIVE, basis: SCOPE_BASIS.EXPLICIT_SLOT };
  if (slot) return { scope: CHANGE_SCOPE.ABILITY, basis: SCOPE_BASIS.EXPLICIT_SLOT };
  if (STATS_HEADING.test(heading)) return { scope: CHANGE_SCOPE.BASE_STATS, basis: SCOPE_BASIS.STATS_HEADING };
  return { scope: CHANGE_SCOPE.ABILITY, basis: SCOPE_BASIS.NAMED_BLOCK };
}
