import { MAX_ITEMS_PER_REQUEST, MAX_RUNES_PER_REQUEST } from "./config.js";

/** Same intentionally-simple approach as functions/_lib/detectChampion.js
 *  (case-insensitive substring match against the catalog name), applied
 *  to items and runes instead of champions. Same accepted tradeoff: a
 *  rune whose name doubles as an ordinary word (e.g. "Guardian") can
 *  false-positive on an unrelated question. Matches are capped at
 *  MAX_ITEMS_PER_REQUEST / MAX_RUNES_PER_REQUEST -- ranked by where they
 *  appear in the text -- so a question that happens to name many items
 *  can't balloon the prompt. */
/** Strips apostrophes (straight and curly) so "Warmogs" matches
 *  "Warmog's Armor" -- a very natural way to type a possessive item name
 *  without the apostrophe (autocorrect on mobile frequently drops it
 *  too). Applied identically to both the catalog name and the question
 *  text before any comparison, so it can't introduce a mismatch. */
function normalizeApostrophes(s) {
  return s.replace(/['\u2019\u2018`]/g, "");
}

/** First words that are ALSO common English/gaming vocabulary, found by
 *  auditing the real catalog (see PR discussion / commit history) --
 *  e.g. "Armor Crusher Boots" would otherwise let the word "armor" alone
 *  match, which false-positives on almost any item/stat conversation.
 *  "Boots" is excluded for a different reason: several items start with
 *  it ("Boots of Mana", "Boots of Dynamism"), so matching bare "boots"
 *  would silently guess ONE of them rather than correctly recognizing
 *  the question is about the category, not a specific item. Deliberately
 *  a short, evidence-based denylist (built from the real data), not a
 *  general stopword list -- most first words here are distinctive enough
 *  (Ardent, Sunfire, Iceborn...) not to need one. */
const GENERIC_FIRST_WORD_DENYLIST = new Set([
  "armor", "boots", "black", "first", "second", "chain", "battle", "cheap", "force", "staff",
]);

/** Two passes: full-name match first (most precise, existing behavior),
 *  then -- for items/runes not already matched -- a first-word match for
 *  multi-word names, so a common short name like "Locket" (for "Locket
 *  of the Iron Solari") is still found. This directly addresses the
 *  spec's own worked example ("When should I buy Locket instead of
 *  Redemption?" -- nobody types the full item name). Bounded to reduce
 *  false positives: only multi-word names, only first words 5+ letters
 *  long AND not in GENERIC_FIRST_WORD_DENYLIST above, matched on a
 *  whole-word boundary. Full-name matches still take priority when both
 *  would apply to the same entry. */
function findMentions(lowerText, catalog) {
  const normalizedText = normalizeApostrophes(lowerText);
  const mentions = [];
  const matchedIds = new Set();

  for (const entry of catalog) {
    const index = normalizedText.indexOf(normalizeApostrophes(entry.name.toLowerCase()));
    if (index !== -1) {
      mentions.push({ id: entry.id, index });
      matchedIds.add(entry.id);
    }
  }

  for (const entry of catalog) {
    if (matchedIds.has(entry.id)) continue;
    const words = normalizeApostrophes(entry.name.toLowerCase()).split(/\s+/);
    if (words.length < 2) continue; // single-word names are already fully covered above
    const firstWord = words[0];
    if (firstWord.length < 5) continue; // too short to be a safe standalone match
    if (GENERIC_FIRST_WORD_DENYLIST.has(firstWord)) continue;
    const escaped = firstWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`\\b${escaped}\\b`).exec(normalizedText);
    if (match) {
      mentions.push({ id: entry.id, index: match.index });
      matchedIds.add(entry.id);
    }
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

/** Same follow-up-aware pattern as detectChampionsInConversation() in
 *  detectChampion.js, for items/runes: e.g. "Should I buy Locket or
 *  Redemption?" then "What if they have a heavy dive comp?" should keep
 *  grounding Locket + Redemption even though the follow-up names
 *  neither. Latest message wins if it mentions anything at all (so
 *  asking about a different item switches context correctly); only
 *  falls back through a small bounded recent window otherwise. */
export function detectItemsAndRunesInConversation(messages, items, runes, windowSize) {
  const recent = (messages || [])
    .filter((m) => typeof m?.content === "string")
    .slice(-windowSize);
  if (recent.length === 0) return { itemIds: [], runeIds: [] };

  for (let i = recent.length - 1; i >= 0; i--) {
    const result = detectItemsAndRunes(recent[i].content, items, runes);
    if (result.itemIds.length > 0 || result.runeIds.length > 0) return result;
  }
  return { itemIds: [], runeIds: [] };
}
