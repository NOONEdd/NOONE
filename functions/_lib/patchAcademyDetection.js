// Deterministic Academy-entity detection for Patch Intelligence.
//
// PURPOSE: guarantee COVERAGE. Before any AI runs, every Academy-tracked
// champion, item and rune is looked up in the official patch text. An
// entity that appears is put in front of the analyst as "you must give a
// verdict on this one", so it can no longer be overlooked just because a
// single giant request had too much in it.
//
// DETECTION IS NOT A CLAIM OF CHANGE. A name can appear in a skin title,
// a comparison, a lore line, or a list of returning cosmetics. Whether
// Riot actually changed the entity, and whether that matters to Support,
// is decided afterwards (by the analyst, then re-checked deterministically
// -- see patchAnalysis.js / patchAggregate.js). The four diagnostic
// states the brief asks for map to:
//   A  not detected                       (this file: no match in any unit)
//   B  detected, did not change           (verdict changed=false)
//   C  changed, not Support-relevant      (verdict relevance NONE)
//   D  changed, Support-relevant          (verdict + an entry in the report)
//
// MATCHING is generic -- no per-entity rules, no hardcoded aliases:
//   * text is Unicode-normalized (NFKD, diacritics stripped), lower-cased,
//     every apostrophe variant is removed ("Mikael's"/"Mikael’s"/"Mikaels"
//     all become "mikaels"), and all other punctuation is a word break;
//   * each word is lightly stemmed (one trailing "s" dropped) so
//     "Staff of Flowing Water" matches "Staff of Flowing Waters" and
//     possessives match either way;
//   * a name matches when a RUN of adjacent text words, concatenated,
//     equals the concatenation of the entity's words -- which also covers
//     spacing variants ("Lich Bane" / "LichBane", "Battle Song" /
//     "Battlesong"). Runs never span a line break.
//   * whole-word only: "Mel" never matches "melee", "Sett" never matches
//     "setting".
// It deliberately does NOT require a "change signal" (arrow, "increased",
// ...) near the name: that heuristic is what lets real changes slip past.
//
// Pure functions, no I/O. Web-standard JS only.

const WORD = /[\p{L}\p{N}]+(?:['\u2018\u2019\u02BC`\u00B4][\p{L}\p{N}]+)*/gu;
const APOS = /['\u2018\u2019\u02BC`\u00B4]/g;
// what may sit between two words of one entity name ("Legend: Tenacity",
// "Coup de Grace", "Kai Sa") -- never a line break.
const NAME_GAP = /^[ \t\-\u2013\u2014:&.,]*$/;

export function stemWord(word) {
  let w = String(word).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(APOS, "");
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

export function tokenize(text) {
  const out = [];
  const src = String(text || "");
  WORD.lastIndex = 0;
  let m;
  while ((m = WORD.exec(src)) !== null) {
    const stem = stemWord(m[0]);
    if (stem) out.push({ stem, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

function stripAnnotation(name) {
  return String(name || "").replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ").trim();
}

function stemsOf(name) {
  return tokenize(stripAnnotation(name)).map((t) => t.stem);
}

const TYPES = ["champion", "item", "rune"];

/** Builds the lookup structure used by detection and by name resolution.
 *  Each entity keeps only what later stages need (never the whole roster
 *  object), so the index is cheap to hold and easy to serialize. */
export function buildAcademyIndex({ championRoster = [], itemRoster = [], runeRoster = [] }) {
  const entities = [];
  const add = (type, e, meta) => {
    const stems = stemsOf(e.name);
    if (!stems.length) return;
    entities.push({
      key: `${type}:${e.id}`,
      type,
      id: e.id,
      name: e.name,
      tier: e.tier || "Unranked",
      stems,
      compact: stems.join(""),
      meta,
      info: typeof e.info === "string" ? e.info : "",
    });
  };
  championRoster.forEach((c) => add("champion", c, { role: c.role || "" }));
  itemRoster.forEach((i) => add("item", i, { category: i.category || "" }));
  runeRoster.forEach((r) => add("rune", r, { path: r.path || "" }));

  const byPrefix = new Map();
  for (const e of entities) {
    const k = e.compact.slice(0, 3);
    if (!byPrefix.has(k)) byPrefix.set(k, []);
    byPrefix.get(k).push(e);
  }
  const byKey = new Map(entities.map((e) => [e.key, e]));
  return { entities, byPrefix, byKey };
}

/** Finds every Academy entity mentioned in `text`.
 *  Returns Map<entityKey, { mentions, proper }> where `proper` counts the
 *  mentions that start with a capital letter. A single-word entity whose
 *  only mentions are lowercase ("guardian", "triumph" in ordinary prose)
 *  is reported with proper=0 so callers can treat it as weak. */
export function detectEntitiesInText(text, index) {
  const src = String(text || "");
  const toks = tokenize(src);
  const found = new Map();
  for (let i = 0; i < toks.length; i++) {
    const first = toks[i].stem;
    const cands = index.byPrefix.get(first.slice(0, 3));
    if (!cands) continue;
    for (const cand of cands) {
      if (!cand.compact.startsWith(first)) continue;
      let acc = first;
      let j = i;
      let matched = acc === cand.compact;
      const maxJ = Math.min(toks.length - 1, i + cand.stems.length + 2);
      while (!matched && j < maxJ) {
        const gap = src.slice(toks[j].end, toks[j + 1].start);
        if (!NAME_GAP.test(gap)) break;
        j++;
        acc += toks[j].stem;
        if (acc === cand.compact) matched = true;
        else if (!cand.compact.startsWith(acc)) break;
      }
      if (!matched) continue;
      const rec = found.get(cand.key) || { mentions: 0, proper: 0 };
      rec.mentions++;
      if (/\p{Lu}/u.test(src.charAt(toks[i].start))) rec.proper++;
      found.set(cand.key, rec);
    }
  }
  return found;
}

/** True when a detection should force the analyst to give a verdict.
 *  Multi-word names always do. A single-word name only does if it was
 *  ever written with a capital letter (Riot capitalizes champion/item/
 *  rune names; a lowercase-only "guardian" is the ordinary word). Weak
 *  detections are still recorded in diagnostics -- just not required. */
export function isStrongDetection(entity, rec) {
  return entity.stems.length > 1 || rec.proper > 0;
}

/** Resolves a free-text entity name (as an AI wrote it) to a tracked
 *  Academy entity of the given type, or null. STRICT on purpose: this is a
 *  membership test ("is this something Academy tracks?"), so it must never
 *  guess. Order: exact word-sequence match; then a tracked name that
 *  CONTAINS the given words as a contiguous run (shorthand such as
 *  "Locket" for "Locket of the Iron Solari"); then a given name that
 *  contains a tracked name as a contiguous run ("Yordle Trap Device" for
 *  "Yordle Trap"). Ambiguity (two different tracked entities fit equally)
 *  resolves to null rather than to a guess.
 *
 *  (src/utils/images.js's findCanonicalId() is a DISPLAY resolver -- it
 *  always returns something, falling back to a slug, and matches on raw
 *  substrings, so e.g. an untracked "Guardian Angel" would resolve to the
 *  tracked rune "Guardian". That is fine for choosing an icon and wrong for
 *  deciding what Academy tracks, which is why this exists.) */
export function resolveEntityByName(name, roster) {
  const stems = stemsOf(name);
  if (!stems.length || !Array.isArray(roster)) return null;
  const compact = stems.join("");

  const rosterStems = roster.map((e) => ({ e, stems: stemsOf(e.name) }));
  const exact = rosterStems.filter((r) => r.stems.join("") === compact);
  if (exact.length === 1) return exact[0].e;
  if (exact.length > 1) return null;

  const containsRun = (haystack, needle) => {
    if (!needle.length || needle.length > haystack.length) return false;
    for (let i = 0; i + needle.length <= haystack.length; i++) {
      let ok = true;
      for (let k = 0; k < needle.length; k++) if (haystack[i + k] !== needle[k]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  };
  const shorthand = compact.length >= 4 ? rosterStems.filter((r) => r.stems.length > stems.length && containsRun(r.stems, stems)) : [];
  if (shorthand.length === 1) return shorthand[0].e;
  if (shorthand.length > 1) return null;

  const wrapped = rosterStems.filter((r) => r.stems.join("").length >= 4 && r.stems.length < stems.length && containsRun(stems, r.stems));
  if (wrapped.length === 1) return wrapped[0].e;
  if (wrapped.length > 1) {
    const longest = Math.max(...wrapped.map((r) => r.stems.length));
    const best = wrapped.filter((r) => r.stems.length === longest);
    return best.length === 1 ? best[0].e : null;
  }
  return null;
}

export function entityTypeList() {
  return TYPES.slice();
}
