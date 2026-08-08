import { MAX_ITEMS_PER_REQUEST, MAX_RUNES_PER_REQUEST } from "./config.js";

/** Same intentionally-simple approach as functions/_lib/detectChampion.js
 *  (case-insensitive substring match against the catalog name), applied
 *  to items and runes instead of champions. Same accepted tradeoff: a
 *  rune whose name doubles as an ordinary word (e.g. "Guardian") can
 *  false-positive on an unrelated question. Matches are capped at
 *  MAX_ITEMS_PER_REQUEST / MAX_RUNES_PER_REQUEST -- ranked by where they
 *  appear in the text -- so a question that happens to name many items
 *  can't balloon the prompt. */
function findMentions(lowerText, catalog) {
  const mentions = [];
  for (const entry of catalog) {
    const index = lowerText.indexOf(entry.name.toLowerCase());
    if (index !== -1) mentions.push({ id: entry.id, index });
  }
  mentions.sort((a, b) => a.index - b.index);
  return mentions.map((m) => m.id);
}

export function detectItemsAndRunes(question, items, runes) {
  const text = (question || "").toLowerCase();
  if (!text) return { itemIds: [], runeIds: [] };

  return {
    itemIds: findMentions(text, items).slice(0, MAX_ITEMS_PER_REQUEST),
    runeIds: findMentions(text, runes).slice(0, MAX_RUNES_PER_REQUEST),
  };
}
