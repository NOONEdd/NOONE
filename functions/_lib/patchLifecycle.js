// Explicit LIFECYCLE-section detection (Items Removed / New Items / Runes
// Removed / New Champions / bare "Removed" under "Marksman Item
// Adjustments", ...). Pure structure-based helpers, no I/O.
//
// Lives in its own module so the extractor (patchNotesExtract.js) can ask
// "is this unit an explicit lifecycle section?" before anything else
// decides how to treat the unit -- a lifecycle list ("Removed: Magnetic
// Blaster, Soul Transfer, ...") is an explicit Riot statement and must
// never be dropped just because the section it sits in (Marksman Item
// Adjustments) has a category nothing else carries. The report entries
// themselves are built from these results downstream.
//
// ---------------------------------------------------------------------
// EXPLICIT LIFECYCLE SECTIONS (Items Removed / New Items / Runes Removed
// / New Champions, etc.)
//
// BUG THIS FIXES: a unit whose OWN subject is "here is a list of things
// that no longer exist" can still happen to NAME an unrelated, currently-
// tracked entity in its explanatory prose (Riot's real Patch 7.3 notes:
// the "Items Removed" section explains that Searing Crown is gone
// because its jungle-specific role is no longer needed, referencing
// Sunfire Aegis -- a real, current Academy item, so it gets detected in
// this unit's text). Before this fix, that incidental mention could end
// up as the unit's only signal, while the actual removed items (named
// only as bullet points, with no arrow/prose value pair for
// extractDeterministicFacts to find) produced NOTHING: not an entry, not
// even a line in unattributedFacts. Silently invisible.
//
// THE FIX: explicit section semantics are authoritative over incidental
// entity mentions in explanatory prose. Three deterministic structural
// forms are recognized, all by heading string + bullet/heading layout
// (never by fuzzy text matching, never by AI):
//   1. a heading that names the lifecycle itself: "Items Removed",
//      "Removed Items", "New Items", "Runes Removed", "New Champions"...
//      -> the entities are the section's own bullet names;
//   2. a bare "Removed"/"Added"/"New" heading, whose kind (item / rune /
//      champion) comes from its nearest ancestor heading
//      ("Item Adjustments > Marksman Item Adjustments > Removed");
//   3. a sub-heading directly under a lifecycle heading
//      ("New Champions > Hwei") -> the sub-heading's own title IS the
//      entity.
// A section with NO extractable names is deliberately NOT claimed by this
// pass -- it falls through to normal processing, so this can never
// create a new way for content to become invisible.
const LIFECYCLE_TITLE_PATTERNS = [
  { re: /^items?\s+removed$/i, kind: "item", action: "removed" },
  { re: /^removed\s+items?$/i, kind: "item", action: "removed" },
  { re: /^(new\s+items?|items?\s+added|added\s+items?)$/i, kind: "item", action: "added" },
  { re: /^runes?\s+removed$/i, kind: "rune", action: "removed" },
  { re: /^removed\s+runes?$/i, kind: "rune", action: "removed" },
  { re: /^(new\s+runes?|runes?\s+added|added\s+runes?)$/i, kind: "rune", action: "added" },
  { re: /^champions?\s+removed$/i, kind: "champion", action: "removed" },
  { re: /^removed\s+champions?$/i, kind: "champion", action: "removed" },
  { re: /^(new\s+champions?|champions?\s+added|added\s+champions?)$/i, kind: "champion", action: "added" },
];
const BARE_VERB_ACTION = [
  { re: /^removed$/i, action: "removed" },
  { re: /^(added|new)$/i, action: "added" },
];
const KIND_KEYWORDS = [
  { re: /\bitems?\b/i, kind: "item" },
  { re: /\brunes?\b/i, kind: "rune" },
  { re: /\bchampions?\b/i, kind: "champion" },
];

/** {kind, action} if `title` (a heading string), read in the context of
 *  its `ancestors` (the heading titles above it, outermost first), is an
 *  explicit lifecycle heading; otherwise null. Never guesses: a bare
 *  "Removed" with no item/rune/champion ancestor is not claimed. */
export function matchLifecycleTitle(title, ancestors = []) {
  const t = (title || "").trim();
  for (const p of LIFECYCLE_TITLE_PATTERNS) if (p.re.test(t)) return { kind: p.kind, action: p.action };
  const bare = BARE_VERB_ACTION.find((b) => b.re.test(t));
  if (!bare) return null;
  for (let i = ancestors.length - 1; i >= 0; i--) { // nearest ancestor wins
    const kw = KIND_KEYWORDS.find((k) => k.re.test(ancestors[i]));
    if (kw) return { kind: kw.kind, action: bare.action };
  }
  return null;
}

const INDENTED_BULLET = /^\s+[*+-]\s+(.+)$/;
const TOPLEVEL_BULLET = /^[*+-]\s+(.+)$/;
// A stat line ("Price: 900", "Health: 100 -> 200"), not a name. Deliberately
// requires a digit/sign right after the colon so a real name that contains
// a colon ("Legend: Haste") is still a name.
const STAT_LINE = /:\s*[\d%+\-\[]|->|→/;

/** Reads the entity names an explicit lifecycle section lists, straight
 *  from its bullet structure. Riot's real notes nest the actual item/
 *  rune/champion name one level under an explanatory top-level bullet
 *  ("- <why>", "  - <name>") -- when any such nested bullets exist,
 *  THOSE are the names (the parent lines are prose, not entities, even
 *  when a parent line happens to name something else entirely). Only
 *  when a section has no nesting at all (a flat "- Name" list) do the
 *  top-level bullets themselves count as names. Either way this reads
 *  bullet structure only -- never the free-text sentences around it. */
export function extractLifecycleEntityNames(unit) {
  const lines = unit.lines || String(unit.text || "").split("\n");
  const nested = [];
  const topLevel = [];
  for (const line of lines) {
    const nestedMatch = INDENTED_BULLET.exec(line);
    if (nestedMatch) { nested.push(nestedMatch[1].trim()); continue; }
    const topMatch = TOPLEVEL_BULLET.exec(line);
    if (topMatch) topLevel.push(topMatch[1].trim());
  }
  const raw = nested.length > 0 ? nested : topLevel;
  const seen = new Set();
  const names = [];
  for (const r of raw) {
    const cleaned = r.replace(/\*+/g, "").trim();
    // Drop anything that reads as a sentence or a stat line rather than
    // a name -- leaving it out is always safer than guessing.
    if (!cleaned || cleaned.length > 60 || /[.!?]$/.test(cleaned) || STAT_LINE.test(cleaned)) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(cleaned);
  }
  return names;
}

/** For one unit: which lifecycle form (if any) applies, and the entity
 *  names it yields. `form` is "own" when the unit's OWN heading is the
 *  lifecycle heading (Items Removed / a bare Removed list) and "child"
 *  when its parent heading is (New Champions > Hwei). Only "own" units
 *  are kept by the planner regardless of category -- a "child" is one
 *  heading among possibly unrelated siblings (e.g. Adventure Mode's
 *  "Augment pool Adjustments" sits under "New Items"), so it is still
 *  subject to the normal relevance gate. `null` when the unit is not part of an explicit
 *  lifecycle section OR yields no names (never claimed in that case --
 *  see the block comment above). */
export function lifecycleNamesForUnit(unit) {
  const path = unit.headingPath || [];
  // Form 1/2: the unit's own heading is the lifecycle heading.
  const own = matchLifecycleTitle(unit.title, path.slice(0, -1));
  if (own) {
    const names = extractLifecycleEntityNames(unit);
    return names.length ? { ...own, names, form: "own" } : null;
  }
  // Form 3: the unit's immediate parent heading is a lifecycle heading,
  // so THIS unit's own title is the entity ("New Champions > Hwei").
  if (path.length >= 2) {
    const parent = matchLifecycleTitle(path[path.length - 2], path.slice(0, -2));
    if (parent && (unit.title || "").trim()) return { ...parent, names: [unit.title.trim()], form: "child" };
  }
  return null;
}

