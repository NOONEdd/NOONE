// Compact item/rune context for the prompt. Resolution itself (merging
// any live Coach Mode override with the items.js/runes.js baseline) is
// delegated to resolveEffectiveItem()/resolveEffectiveRune() in
// src/lib/effectiveData.js -- the SAME functions src/App.jsx uses for
// the real Item/Rune Tier List pages, so the AI is never grounded in
// something different from what a visitor looking at those pages would
// see right now. Only the items/runes the caller asks for are included
// (see detectItemsRunes.js) -- this never iterates the full 80+/50+
// catalogs into a prompt.
//
// `info` (factual: what the item/rune does) and `note` (Academy coaching
// commentary: when/why to buy it) are kept as two separate labeled
// pieces in the formatted string below rather than one blended blob --
// see buildPrompt.js, which surfaces this same facts/coaching separation
// in the final prompt structure.

//
// DATA QUALITY (src/lib/dataQuality.js): a record marked `dataStatus: "unverified"` is a real entity whose mechanical text is
// not verified. It is NEVER formatted into the item/rune "facts" lines below (so its text can neither reach the prompt as a
// fact nor satisfy academyCoverage.js's fact-keyword check); extractUnverifiedEntities() describes it by identity and
// structured relationships only, for buildPrompt.js's separate "no verified stats" section.

import { resolveEffectiveItem, resolveEffectiveRune } from "../../src/lib/effectiveData.js";
import { hasVerifiedFacts } from "../../src/lib/dataQuality.js";

function formatEntry(entry, extraLabel) {
  return `${entry.name} (${extraLabel}, tier ${entry.tier}): ${entry.info}${entry.note ? ` | Coach's note: ${entry.note}` : ""}`;
}

export function extractItemContext(itemIds, items, overrides) {
  return itemIds
    .map((id) => items.find((i) => i.id === id))
    .filter(Boolean)
    .filter(hasVerifiedFacts)
    .map((base) => formatEntry(resolveEffectiveItem(base, overrides?.items?.[base.id]), base.category));
}

export function extractRuneContext(runeIds, runes, overrides) {
  return runeIds
    .map((id) => runes.find((r) => r.id === id))
    .filter(Boolean)
    .filter(hasVerifiedFacts)
    .map((base) => formatEntry(resolveEffectiveRune(base, overrides?.runes?.[base.id]), base.path));
}

/** The referenced records whose mechanical data is NOT verified, described by identity + structured relationships only --
 *  never by their `info` text. `type` is the entity type label ("item" / "rune"); relationships come from `upgradeOf` in both
 *  directions within the same catalog. @returns {{ id, type, name, relationships: string[] }[]} */
export function extractUnverifiedEntities(ids, catalog, type) {
  const byId = new Map((catalog || []).map((e) => [e.id, e]));
  return (ids || [])
    .map((id) => byId.get(id))
    .filter((e) => e && !hasVerifiedFacts(e))
    .map((e) => {
      const relationships = [];
      if (e.upgradeOf && byId.has(e.upgradeOf)) relationships.push(`upgraded form of ${byId.get(e.upgradeOf).name}`);
      for (const other of catalog) if (other.upgradeOf === e.id) relationships.push(`upgrades into ${other.name}`);
      return { id: e.id, type, name: e.name, relationships };
    });
}
