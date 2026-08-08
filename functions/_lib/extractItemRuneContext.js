/** Compact item/rune context for the prompt, merged with live Coach Mode
 *  overrides using the EXACT same tier/note/info fallback chain
 *  src/App.jsx uses for the real Item/Rune Tier List pages (`o?.tier ||
 *  i.tier || "Unranked"`, `o?.info || i.info`, `o?.note || ""`) -- so the
 *  AI is never grounded in something different from what a visitor
 *  looking at those pages would see right now. Only the items/runes the
 *  caller asks for are included (see detectItemsAndRunes.js) -- this
 *  never iterates the full 80+/50+ catalogs into a prompt. */

function formatEntry(entry, override, extraLabel) {
  const tier = override?.tier || entry.tier || "Unranked";
  const info = override?.info || entry.info || "";
  const note = override?.note || "";
  return `${entry.name} (${extraLabel}, tier ${tier}): ${info}${note ? ` | Coach's note: ${note}` : ""}`;
}

export function extractItemContext(itemIds, items, overrides) {
  return itemIds
    .map((id) => items.find((i) => i.id === id))
    .filter(Boolean)
    .map((item) => formatEntry(item, overrides?.items?.[item.id], item.category));
}

export function extractRuneContext(runeIds, runes, overrides) {
  return runeIds
    .map((id) => runes.find((r) => r.id === id))
    .filter(Boolean)
    .map((rune) => formatEntry(rune, overrides?.runes?.[rune.id], rune.path));
}
