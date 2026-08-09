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

import { resolveEffectiveItem, resolveEffectiveRune } from "../../src/lib/effectiveData.js";

function formatEntry(entry, extraLabel) {
  return `${entry.name} (${extraLabel}, tier ${entry.tier}): ${entry.info}${entry.note ? ` | Coach's note: ${entry.note}` : ""}`;
}

export function extractItemContext(itemIds, items, overrides) {
  return itemIds
    .map((id) => items.find((i) => i.id === id))
    .filter(Boolean)
    .map((base) => formatEntry(resolveEffectiveItem(base, overrides?.items?.[base.id]), base.category));
}

export function extractRuneContext(runeIds, runes, overrides) {
  return runeIds
    .map((id) => runes.find((r) => r.id === id))
    .filter(Boolean)
    .map((base) => formatEntry(resolveEffectiveRune(base, overrides?.runes?.[base.id]), base.path));
}
