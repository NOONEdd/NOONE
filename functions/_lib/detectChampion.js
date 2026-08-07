/** Scans free-text question for champion mentions, case-insensitive,
 *  matching against both id (hyphens treated as spaces or removed) and
 *  display name. If two distinct champions are mentioned with a
 *  vs/against/into-style word between them, the second is treated as the
 *  enemy; if only one is mentioned, there's no enemy. This is intentionally
 *  simple substring matching, not real NLP -- it correctly handles the
 *  common phrasings ("I play Lulu against Nautilus", "Lulu vs Nautilus")
 *  without trying to parse arbitrary sentence structure. One known,
 *  accepted tradeoff: a champion whose name is also an ordinary English
 *  word (e.g. Karma) can false-positive on unrelated questions containing
 *  that word -- a real limitation of substring matching, not worth solving
 *  with heavier NLP for what this feature needs. */
export function detectChampions(question, champions) {
  const text = (question || "").toLowerCase();
  if (!text) return { championId: null, enemyId: null };

  const mentions = [];
  for (const c of champions) {
    const candidates = [c.id.replace(/-/g, " "), c.id.replace(/-/g, ""), c.name.toLowerCase()];
    for (const candidate of candidates) {
      const index = text.indexOf(candidate);
      if (index !== -1) {
        mentions.push({ champion: c, index });
        break; // one match per champion is enough, don't double-count
      }
    }
  }

  if (mentions.length === 0) return { championId: null, enemyId: null };

  mentions.sort((a, b) => a.index - b.index);
  if (mentions.length === 1) return { championId: mentions[0].champion.id, enemyId: null };

  const between = text.slice(mentions[0].index, mentions[1].index);
  const isMatchup = /\bvs\b|\bversus\b|\bagainst\b|\binto\b/.test(between);

  return {
    championId: mentions[0].champion.id,
    enemyId: isMatchup ? mentions[1].champion.id : null,
  };
}
