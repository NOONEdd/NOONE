// Deterministic FACT extraction for Patch Intelligence's multi-stage
// pipeline -- turns Riot's own explicit before/after notation inside a
// unit's text into structured facts BEFORE any AI call, so the analyst
// prompt (patchIntelligence.js) can be told "these are the facts,
// already established" instead of being asked to transcribe them.
//
// SCOPE, DELIBERATELY BOUNDED (see the delivery report for the full
// reasoning): the Academy's own data model (src/lib/effectiveData.js)
// carries a champion's tier/note/builds and an item/rune's tier/note/
// free-text `info` -- NOT per-field structured stats (there is no
// `abilityPower: 50` anywhere, for any entity). So "deterministic
// comparison against Academy data" cannot mean a real field-by-field
// diff for champions -- there is nothing structured to diff against.
// What this module DOES do:
//   1. Extract old->new pairs directly from RIOT'S OWN before/after
//      notation ("Armor: 40 -> 45", "80/120/160/200 -> 90/130/170/210",
//      "9s -> 8s") -- self-contained facts that need no Academy-side
//      comparison at all. This is the primary mechanism and applies to
//      champions, items, and runes alike.
//   2. For ITEMS ONLY, a best-effort, LOW-CONFIDENCE check of whether
//      the entity's CURRENT EFFECTIVE `info` string (already resolved
//      through the KV-then-static hierarchy by the caller --
//      src/lib/effectiveData.js's resolveEffectiveItem, called by
//      functions/api/admin/patch-check.js BEFORE itemRoster ever
//      reaches this pipeline -- this module is never given raw static
//      data directly and never reads src/data/*.js itself, so it can
//      never treat a stale static value as current when a KV override
//      exists) still shows the OLD value for a field the patch just
//      changed. This is a SIGNAL for a human reviewer, never an
//      assertion -- see compareItemInfoToPatch()'s own doc comment for
//      exactly why it can never independently claim "Academy data is
//      outdated."
//   3. Lightweight ADDED/REMOVED pattern detection, independent of the
//      numeric extraction above, always routed to Human Review -- never
//      used to auto-add or auto-remove anything from Academy data.
// No champion stat tracking is added anywhere.
//
// Pure functions, no I/O.

export const DETECTOR_VERSION = "detect-v1";

// Any of these between two numeric expressions counts as an explicit
// before/after pair. Deliberately symbolic-only (the arrows/dashes
// Riot's own notes actually use) -- NOT "increased from X to Y" prose,
// which is far more failure-prone to regex reliably and safer left to
// the analyst to describe in its own words (falls through to the
// existing AI path unchanged, same as any other prose-only change).
const ARROW = "(?:\\u2192|\\u21D2|->|=>)";

// One numeric "value expression": a number (optionally decimal,
// optionally negative), an optional trailing unit letter/percent, and
// optionally MORE of the same joined by "/" (Wild Rift's own
// per-level-scaling notation, e.g. "80/120/160/200" or "9/8/7/6s").
const NUM = "-?\\d+(?:\\.\\d+)?";
const VALUE = `${NUM}%?s?(?:/${NUM}%?s?)*`;

// A full change line: an optional label (free text before the value),
// then VALUE, ARROW, VALUE, anchored to the end of the line. The label
// is captured lazily and WITHOUT requiring a colon, since Riot's own
// line shapes vary ("Armor: 40 -> 45", "Q: damage 60 -> 70", "Cooldown
// 9s -> 8s") -- the lazy `(.*?)` finds the shortest possible label such
// that the rest of the line is still a clean VALUE ARROW VALUE pair.
const CHANGE_LINE = new RegExp(`^[\\s>*_-]*(.*?)\\s*(${VALUE})\\s*${ARROW}\\s*(${VALUE})\\s*$`, "u");

/** True when a VALUE string is a single plain number (no slash list, no
 *  unit) -- only these get a numeric delta/percent computed; a leveled
 *  list ("80/120/160/200") is kept as raw text, never averaged or
 *  reduced to one number, since that would be a guess about which level
 *  matters. */
function scalarNumber(value) {
  // A single number with at most one trailing unit marker (%, s) is
  // still a plain scalar -- "8%" and "20s" get a real delta computed
  // just like "8" would; only a slash-joined leveled list ("60/100/
  // 140/180") is excluded, since that's the case this function exists
  // to keep out of the delta math (see its own doc comment above).
  const m = /^(-?\d+(?:\.\d+)?)%?s?$/.exec(String(value || "").trim());
  return m ? Number(m[1]) : null;
}

/** Scans one unit's raw text line-by-line for explicit before/after
 *  notation. Returns one fact record per matched line:
 *    { label, oldValue, newValue, change?, changePercent?, raw,
 *      source: "riot_patch_notes", detection: "deterministic" }
 *  `change`/`changePercent` are only present when BOTH sides are a
 *  single plain number (scalarNumber above). Never throws; an empty
 *  array means nothing matched, which is the normal, common case for
 *  prose-only changes ("W now also slows briefly") this regex layer
 *  was never meant to catch -- those stay entirely up to the analyst,
 *  same as today. */
export function extractDeterministicFacts(unitText) {
  const facts = [];
  const lines = String(unitText || "").split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = CHANGE_LINE.exec(line);
    if (!m) continue;
    const label = m[1].replace(/\*+/g, "").replace(/[:\-]+$/, "").trim();
    const oldValue = m[2].trim();
    const newValue = m[3].trim();
    if (!oldValue || !newValue || oldValue === newValue) continue;
    const fact = {
      label: label || null,
      oldValue,
      newValue,
      raw: line,
      source: "riot_patch_notes",
      detection: "deterministic",
    };
    const oldNum = scalarNumber(oldValue);
    const newNum = scalarNumber(newValue);
    if (oldNum !== null && newNum !== null) {
      fact.change = Math.round((newNum - oldNum) * 1000) / 1000;
      fact.changePercent = oldNum !== 0 ? Math.round(((newNum - oldNum) / Math.abs(oldNum)) * 1000) / 10 : null;
    }
    facts.push(fact);
  }
  return facts;
}

/** Formats a list of facts into the SAME three-string shape the AI has
 *  always produced (whatChanged/previousValue/newValue), labelled the
 *  same way HARD RULE 4 already asks the AI to write them ("Q: ...",
 *  "W: ...") when a label was captured -- so the report/UI/publish
 *  schema stays byte-identical in SHAPE (normalizePatchIntelReport in
 *  patchIntelligence.js is untouched); only the SOURCE of these three
 *  strings changes, for entities where extraction found something.
 *  Returns null for an empty/missing fact list (caller's cue to leave
 *  the AI's own text alone). */
export function formatFacts(facts) {
  if (!facts || !facts.length) return null;
  const parts = facts.map((f) => ({
    whatChanged: f.label ? `${f.label}: ${f.oldValue} \u2192 ${f.newValue}` : `${f.oldValue} \u2192 ${f.newValue}`,
    previousValue: f.label ? `${f.label}: ${f.oldValue}` : f.oldValue,
    newValue: f.label ? `${f.label}: ${f.newValue}` : f.newValue,
  }));
  return {
    whatChanged: parts.map((p) => p.whatChanged).join("; "),
    previousValue: parts.map((p) => p.previousValue).join("; "),
    newValue: parts.map((p) => p.newValue).join("; "),
  };
}

/** Overlays deterministically-formatted facts onto an ALREADY-NORMALIZED
 *  report's championChanges/itemChanges/runeChanges entries, keyed by
 *  the same id field normalizePatchIntelReport already resolved
 *  (championId/itemId/runeId). Only entries the AI already decided to
 *  CREATE are touched -- this never adds a report entry and never
 *  changes "changed"/"supportRelevant"/severity/confidence/etc; it only
 *  replaces the FACT fields (whatChanged/previousValue/newValue) of an
 *  entry that already exists with the deterministic version, when one
 *  is available for that entity. An entity with no deterministic facts
 *  keeps whatever the AI itself wrote, unchanged -- the fallback this
 *  design depends on for never losing coverage on prose-only changes.
 *  Pure; does not mutate its input. Called from patchAnalysis.js AFTER
 *  normalizePatchIntelReport, never from inside it (that function is
 *  exercised directly, with no facts map, by
 *  tests/patchIntelReanalyze.test.mjs's merge-dedupe test and must stay
 *  usable standalone). */
export function overlayDeterministicFacts(report, entityFactsByKey) {
  if (!entityFactsByKey || entityFactsByKey.size === 0) return report;
  const overlayList = (list, idField, typePrefix) =>
    (list || []).map((entry) => {
      const key = entry[idField] ? `${typePrefix}:${entry[idField]}` : null;
      const formatted = key ? entityFactsByKey.get(key) : null;
      return formatted ? { ...entry, ...formatted } : entry;
    });
  return {
    ...report,
    championChanges: overlayList(report.championChanges, "championId", "champion"),
    itemChanges: overlayList(report.itemChanges, "itemId", "item"),
    runeChanges: overlayList(report.runeChanges, "runeId", "rune"),
  };
}

// ---- unit-level entity ownership (for attributing facts) ------------

/** Resolves the single Academy entity a unit's OWN heading (not its
 *  body) names, if exactly one strong match exists -- Riot's own
 *  per-champion/per-item heading convention ("### Leona", "### Ardent
 *  Censer") is the same signal patchAnalysis.js's renderUnit() already
 *  leans on to convey which entity a bullet belongs to; this decides
 *  which entity a unit's deterministic facts belong to. Zero or
 *  multiple heading-level matches (a shared section header, or a unit
 *  whose heading doesn't name a tracked entity) return null -- the
 *  unit's facts are still carried into the AI batch as context either
 *  way (see patchPlanner.js), just without a confident deterministic
 *  attribution; never guessed. */
export function resolveUnitOwnerEntity(unit, index, detectEntitiesInText, isStrongDetection) {
  const heading = unit.headingPath[unit.headingPath.length - 1] || unit.title || "";
  const detected = detectEntitiesInText(heading, index);
  const strong = [...detected.entries()].filter(([key, rec]) => isStrongDetection(index.byKey.get(key), rec));
  return strong.length === 1 ? index.byKey.get(strong[0][0]) : null;
}

// ---- ADDED / REMOVED pattern detection (independent of numeric facts) ----

const REMOVED_PATTERN = /\b(?:has been removed|is being removed|removed from the game|no longer (?:available|exists|in the game)|has been (?:disabled|retired))\b/i;
const ADDED_PATTERN = /^(?:new (?:champion|item|rune)s?\s*:?|introducing)\b/i;

/** Best-effort, pattern-only signal -- never a claim of certainty, and
 *  never used to add/remove anything from Academy data itself (that
 *  stays entirely a human, Coach-Mode action). REMOVED is cross-checked
 *  against the roster (ownerEntity), so it's only surfaced when it's
 *  actually actionable ("Academy still tracks X, but the patch says X
 *  was removed"); ADDED has no roster to check against by definition
 *  (an Academy-doesn't-yet-track entity can't be looked up), so it's
 *  reported as a raw text signal for Human Review to evaluate, keyed to
 *  the unit, not to any entity id. Returns null when neither pattern
 *  matches (the normal case). */
export function detectAddedOrRemovedSignal(unit, ownerEntity) {
  const text = `${unit.headingPath.join(" ")}\n${unit.text}`;
  if (REMOVED_PATTERN.test(text)) {
    return {
      signal: "removed",
      unitId: unit.id,
      unitTitle: unit.title,
      entity: ownerEntity ? { key: ownerEntity.key, type: ownerEntity.type, id: ownerEntity.id, name: ownerEntity.name } : null,
    };
  }
  const lastHeading = unit.headingPath[unit.headingPath.length - 1] || "";
  if (ADDED_PATTERN.test(unit.title) || ADDED_PATTERN.test(lastHeading)) {
    return { signal: "added", unitId: unit.id, unitTitle: unit.title, entity: null };
  }
  return null;
}

// ---- item info vs. patch value: low-confidence signal only ----------

/** Best-effort ONLY. Looks for a number in the item's CURRENT EFFECTIVE
 *  `info` string (see this file's header -- already resolved through
 *  the KV-then-static hierarchy by the caller) that plausibly
 *  corresponds to one of `facts`' OLD values. This can NEVER
 *  independently assert "Academy data is outdated": it can only ever
 *  return a LOW-CONFIDENCE signal for a human to check, because
 *  free-text `info` has no field boundaries -- a coincidentally
 *  matching number proves nothing on its own. Returns null when no
 *  plausible match is found (the normal case), never a guess.
 *  Champions have no equivalent -- no structured or reliably-parseable
 *  numeric field exists on a champion's Academy record at all, so this
 *  is item-only by design (see this file's header). */
export function compareItemInfoToPatch(effectiveItem, facts) {
  if (!effectiveItem || typeof effectiveItem.info !== "string" || !effectiveItem.info.trim() || !facts || !facts.length) return null;
  const infoNumbers = new Set((effectiveItem.info.match(/-?\d+(?:\.\d+)?/g) || []).map(Number));
  const matches = [];
  for (const f of facts) {
    const oldNum = scalarNumber(f.oldValue);
    const newNum = scalarNumber(f.newValue);
    if (oldNum === null || newNum === null) continue;
    if (infoNumbers.has(oldNum) && !infoNumbers.has(newNum)) {
      matches.push({ label: f.label, infoValue: oldNum, patchOldValue: oldNum, patchNewValue: newNum });
    }
  }
  if (!matches.length) return null;
  return {
    signal: "possibly_outdated_info",
    confidence: "low",
    matches,
    note: "Academy's stored item info contains the patch's OLD value and not the new one -- worth a human check, not a confirmed mismatch (free-text info has no field boundaries, so this can coincidentally match).",
  };
}
