// Deterministic FACT extraction for Patch Notes' multi-stage
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

import { isPunctuatedTitleLabel } from "./patchLabelShape.js";

// detect-v4: an ability name that itself ends in "!" or "?" ("You and Me!") is now recognised as a label (patchLabelShape.js).
export const DETECTOR_VERSION = "detect-v4";

// ---------------------------------------------------------------------
// COMPARISON STATE -- how much weight a fact's OLD/NEW values carry
// against Academy's own data. This is entirely separate from whether
// Riot's own change is real (it always is, by construction -- every
// fact here comes from Riot's own patch text) -- it's about whether
// ACADEMY'S data can be meaningfully compared against it at all.
export const COMPARISON_STATE = Object.freeze({
  CONFIRMED: "CONFIRMED",                     // a clean before/after pair, unambiguous
  POSSIBLE: "POSSIBLE",                       // a low-confidence signal only (e.g. item info text coincidentally matching)
  NOT_COMPARABLE: "NOT_COMPARABLE",           // no structured Academy field exists to compare against (every champion stat)
  UNKNOWN: "UNKNOWN",                         // extraction itself is ambiguous (multiple candidate values, unclear which applies)
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED", // an added/removed signal, or a fact that couldn't be attributed to one entity
  // Explicit lifecycle sections ("Items Removed", "New Champions", ...):
  // Riot's OWN section structure states the entity no longer exists /
  // newly exists. Not a value comparison at all -- the section itself is
  // the fact. See patchLifecycle.js's LIFECYCLE_TITLE_PATTERNS.
  REMOVED: "REMOVED",
  ADDED: "ADDED",
});

// ---------------------------------------------------------------------
// SUPPORT RELEVANCE -- a deterministic, Support-coaching-focused
// classification of how much attention a detected change deserves.
// Computed from structural signals only (does this have a concrete
// fact? an added/removed signal? is it tied to a specific Academy
// entity, or a broader system/objective category?) -- never from
// judging the CONTENT of the change, which is exactly the kind of
// interpretation this whole rebuild moves to the human Coach.
export const RELEVANCE = Object.freeze({
  CORE: "CORE",             // a concrete, extractable fact (or an added/removed signal) tied to a specific Academy entity
  VIABLE: "VIABLE",         // a real, Riot-confirmed mention of a tracked entity, but no concrete value pair extracted (prose-only)
  SITUATIONAL: "SITUATIONAL", // a relevant system/objective/macro change with no single tracked entity to attach it to
  NONE: "NONE",             // detected/mentioned but nothing substantive found -- shown in coverage, never becomes a report entry
});

/** Support-relevance for one entity-attributed unit. Never invents a
 *  reason -- purely: did extraction find a fact, or an added/removed
 *  signal, for this specific tracked entity? */
export function classifyEntityRelevance({ hasFact, hasAddedOrRemoved }) {
  if (hasFact || hasAddedOrRemoved) return RELEVANCE.CORE;
  return RELEVANCE.VIABLE; // detected via a strong match in a gate-eligible unit, but prose-only
}

/** Support-relevance for a gate-eligible unit with NO single owner
 *  entity (a systems/objectives/map/general-gameplay unit -- see
 *  config.js's PATCH_INTEL_RELEVANT_NO_ENTITY_CATEGORIES). These are
 *  always SITUATIONAL: real and worth a look, but not tied to one
 *  Academy-tracked entity the way a champion/item/rune change is. */
export function classifySystemRelevance() {
  return RELEVANCE.SITUATIONAL;
}

/** Comparison state for one fact against a specific entity TYPE.
 *  `academyFlag` is compareItemInfoToPatch()'s own result (item-only),
 *  when one exists for this fact's entity. Champions have no structured
 *  stat field anywhere in the Academy data model (see this file's
 *  header) -- NOT_COMPARABLE is the honest answer for every champion
 *  fact, never a guessed CONFIRMED/POSSIBLE. */
export function classifyComparisonState({ entityType, hasCleanValuePair, ambiguous, academyFlag }) {
  if (ambiguous) return COMPARISON_STATE.UNKNOWN;
  if (entityType === "champion") return COMPARISON_STATE.NOT_COMPARABLE;
  if (entityType === "item" && academyFlag) return COMPARISON_STATE.POSSIBLE;
  if (hasCleanValuePair) return COMPARISON_STATE.CONFIRMED;
  return COMPARISON_STATE.NOT_COMPARABLE;
}

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

// Prose form of the same before/after fact, for the cases Riot's own
// notes phrase as a sentence instead of a symbolic arrow -- e.g.
// "Armor Penetration increased from 10% to 15%" or "Cooldown reduced
// from 8s to 7s". This is what a purely arrow-based extractor misses
// (a real, previously-reported gap: an item's percent/stat change
// written this way produced zero facts under the old symbolic-only
// version of this function). Anchored to the same VALUE grammar as the
// arrow form, so a leveled list ("60/100/140/180") is still excluded
// from delta math by scalarNumber() exactly the same way. Deliberately
// does NOT match "increased to Y" (no "from") -- without an explicit
// old value stated, there is nothing to safely pair it with; that stays
// a prose-only mention, same as it always was.
const PROSE_CHANGE_LINE = new RegExp(
  `^[\\s>*_-]*(.*?)\\b(?:increased|decreased|reduced|raised|lowered|buffed|nerfed|changed)\\s+(?:from\\s+)?(${VALUE})\\s+to\\s+(${VALUE})(?:\\s|[.,;)]|$)`,
  "iu"
);

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

// ---------------------------------------------------------------------
// STRUCTURED CHANGE EXTRACTION (2026-09-30 fix round)
//
// extractStructuredChanges() walks ONE unit's text line by line and turns
// every change Riot states -- not just the strict "label: 40 -> 45" pairs
// -- into a structured record, purely from notation that is literally on
// the page:
//   * arrow pairs of ANY shape: single numbers, rank lists with or
//     without spaces ("50 / 90 / 130 / 170 -> 50 / 80 / 110 / 140"),
//     ranges / level-scaled values ("1.2%~12% (based on level) -> ..."),
//     compound ratios ("250 / 375 + 120% bonus AD -> ..."), recipes
//     ("Build Path: A (500) + 400 -> B (400) + 500"), and text-only pairs;
//   * explicit add/remove flags: "[New] Lifesteal: 8%", "[Removed] Physical
//     Vamp: 8%", "New: <effect>", "Removed: <stat>: 150%", a bare
//     "[Removed]" under an ability label, "Spectral Haste [Removed]";
//   * new-value-only stat lines ("Attack Speed Ratio: 0.4") -- Riot states
//     the new value with no old one, so oldValue is "" and the record says
//     so (changeType "new_value"), never a guessed comparison;
//   * bullet prose under an ability label (passive/effect changes) as
//     "effect" records, so an entity or system entry never silently loses
//     a passive/effect change just because a numeric fact also exists.
// Each record also carries deterministic structure metadata: `ability`
// (the nearest preceding label line), `group` (an enclosing label / colon-
// terminated parent bullet), `slot` (Passive/Q/W/E/R -- ONLY from explicit
// notation on the page, or a caller-supplied ability->slot table; null
// otherwise, never guessed), `stat`/`effect`, `changeType`, `traits`, and
// `sourceSection`.
//
// Still no AI, no fuzzy matching, no per-entity rules.
// ---------------------------------------------------------------------

const SLOT_LETTER_NAMES = { Q: "Q", W: "W", E: "E", R: "R" };
const SLOT_BY_NUMBER = { 1: "Q", 2: "W", 3: "E", 4: "R" };

// Bullet marker (matches patchParser.js's BULLET), used for line classification.
const BULLET_LINE = /^(\s*)(?:[-*+\u2022]|\d{1,3}[.)])\s+(.*)$/;
// "[New] ...", "[Removed] ...", "[Adjusted] ..." or "New: ..." / "Removed: ..."
const TAG_LINE = /^(?:\[(new|removed|adjusted)\]|(new|removed)\s*:)\s*(.*)$/i;
const INLINE_TAG_SUFFIX = /\s*\[(new|removed|adjusted)\]\s*$/i;
// "Label: value" where the colon is followed by a space (so "5:00" times are never split)
const LABEL_VALUE = /^([^:]{1,70}?):\s+(.+)$/;
const STARTS_WITH_VALUE = /^[-+(]?\s*\d/;
const ARROW_ANY = /(?:\u2192|\u21D2|->|=>)/g;

/** True when the next non-empty line after `index` is a list item (the structural half of the "punctuated ability name" rule). */
function nextNonEmptyIsBullet(lines, index) {
  for (let j = index + 1; j < lines.length; j++) if (lines[j].trim()) return BULLET_LINE.test(lines[j]);
  return false;
}

function stripMarkup(text) {
  return String(text || "").replace(/\*+/g, "").replace(/_{2,}/g, "").trim();
}

function normAbilityName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** A short title-like non-bullet line that names an ability/effect block
 *  ("Absolution", "Piercing Darkness", "Base Stats", "Energized:"). Same
 *  shape test as patchParser.js's isLabelLike (kept local so this module
 *  stays dependency-free). */
function isLabelLine(line, followedByBullet = false) {
  const t = String(line || "").trim();
  if (!t || t.length > 64) return false;
  // A line ending in . ! or ? is a sentence -- EXCEPT a title-shaped ability name that itself ends in ! or ? ("You and Me!") sitting
  // directly above its list of changes (see patchLabelShape.js). Both conditions are required, so prose can never become a label.
  if (/[.!?]$/.test(t)) return followedByBullet && isPunctuatedTitleLabel(t);
  if (t.split(/\s+/).length > 9) return false;
  return /^[\p{Lu}\p{N}\[*_(]/u.test(t);
}

/** Slot from EXPLICIT notation in a label: "Passive - X", "Q - X", "Q: x",
 *  "(2) X", "Ultimate ...". Returns { slot, rest } (rest = label with the
 *  notation removed) -- slot null when the label carries no such notation. */
function slotFromLabel(label) {
  const t = stripMarkup(label).replace(/:$/, "").trim();
  let m = /^(?:passive|innate)\b\s*[-\u2013\u2014:]?\s*(.*)$/i.exec(t);
  if (m) return { slot: "Passive", rest: m[1].trim() };
  m = /^\(?([QWER])\)?\s*(?:[-\u2013\u2014:.)]\s*|$)(.*)$/.exec(t);
  if (m) return { slot: SLOT_LETTER_NAMES[m[1]], rest: m[2].trim() };
  m = /^\(([1-4])\)\s*(.*)$/.exec(t);
  if (m) return { slot: SLOT_BY_NUMBER[m[1]], rest: m[2].trim() };
  m = /^ultimate\b\s*[-\u2013\u2014:]?\s*(.*)$/i.exec(t);
  if (m) return { slot: "R", rest: m[1].trim() };
  return { slot: null, rest: t };
}

/** Structural traits of a value expression (never a judgement about it). */
function traitsOf(...sides) {
  const joined = sides.join(" ");
  const traits = [];
  if (/(?:^|[^\d.])\d+(?:\.\d+)?%?s?\s*\/\s*-?\d/.test(joined)) traits.push("rank_list");
  if (/\d\s*%?s?\s*[~\u2013\u2014]\s*\d|\d\s+-\s+\d|\(\s*(?:based on|scales? with|scaling)/i.test(joined)) traits.push("range");
  if (/[+\u00D7*]/.test(joined.replace(/\d\s*\/\s*\d/g, ""))) traits.push("expression");
  return traits;
}

function classifyArrowChange(label, oldValue, newValue) {
  if (/^build\s*path$/i.test(String(label || "").trim())) return { changeType: "recipe", traits: [] };
  const hasDigit = /\d/.test(oldValue) || /\d/.test(newValue);
  if (!hasDigit) return { changeType: "text", traits: [] };
  const traits = traitsOf(oldValue, newValue);
  let changeType = "value";
  if (traits.includes("expression")) changeType = "expression";
  else if (traits.includes("range")) changeType = "range";
  else if (traits.includes("rank_list")) changeType = "rank_list";
  return { changeType, traits };
}

/** Splits an arrow line that the strict legacy patterns did not match.
 *  Exactly one arrow, both sides non-empty and different. The label is
 *  the text before the first ": " on the left side, only when that text
 *  is label-like (no digits, no arrow) -- otherwise the whole left side is
 *  the old value. */
function splitGeneralArrowLine(line) {
  const cleaned = line.replace(/^[\s>*_-]+/, "").replace(/^\d{1,3}[.)]\s+/, "");
  const arrows = cleaned.match(ARROW_ANY) || [];
  if (arrows.length !== 1) return null;
  const idx = cleaned.search(ARROW_ANY);
  const left = cleaned.slice(0, idx).trim();
  const right = cleaned.slice(idx + arrows[0].length).trim();
  if (!left || !right) return null;
  let label = null;
  let oldValue = left;
  const lv = LABEL_VALUE.exec(left);
  if (lv && !/\d/.test(lv[1]) && !/[\u2192>]/.test(lv[1])) {
    label = stripMarkup(lv[1]);
    oldValue = lv[2].trim();
  }
  const newValue = right.replace(/[.;]$/, "").trim();
  if (!oldValue || !newValue || oldValue === newValue) return null;
  return { label, oldValue: oldValue.replace(/[.;]$/, "").trim(), newValue };
}

/**
 * Extracts every structured change from one unit's raw text.
 * @param {string} unitText
 * @param {object} [opts]
 * @param {string} [opts.sourceSection]  the unit's heading path, stamped on every record
 * @param {Map<string,string>|null} [opts.abilitySlots]  OPTIONAL caller-supplied table,
 *   normalized ability name -> "Passive"|"Q"|"W"|"E"|"R", used ONLY when the page itself
 *   carries no slot notation for that ability. Nothing in the repo supplies one today, so
 *   slot stays null for abilities Riot names without a slot letter (Senna's "Piercing
 *   Darkness") -- documented gap, not a guess.
 * @returns {Array<object>} records in document order (see the block comment above)
 */
export function extractStructuredChanges(unitText, opts = {}) {
  const { sourceSection = "", abilitySlots = null } = opts;
  const out = [];
  const lines = String(unitText || "").split("\n");

  let ability = null;      // nearest preceding label line (markup/colon stripped, inline tag removed)
  let abilityRaw = null;   // the label line as written (for slot notation)
  let group = null;        // an earlier label directly above the current one, or a colon-terminated parent bullet
  let labelStreak = 0;     // consecutive label lines with no bullet between them
  let parentBullet = null; // { indent, text } of the last bullet that ends with ":"

  const slotFor = (labelText, statLabel) => {
    const fromStat = statLabel ? slotFromLabel(statLabel) : { slot: null, rest: statLabel };
    if (fromStat.slot) return { slot: fromStat.slot, stat: fromStat.rest || null };
    const fromAbility = abilityRaw ? slotFromLabel(abilityRaw) : { slot: null };
    let slot = fromAbility.slot;
    if (!slot && abilitySlots && ability) slot = abilitySlots.get(normAbilityName(ability)) || null;
    return { slot, stat: statLabel || null };
  };

  // "[New] Lifesteal: 8%" -> added stat; "[Removed] Physical Vamp: 8%" -> removed stat;
  // "[New] <sentence>" / bare "[Removed]" -> added/removed effect. Returns false for
  // "[Adjusted]" (no add/remove claim -- falls through to normal handling).
  const handleTag = (tag, line, mk) => {
    const kindWord = (tag[1] || tag[2]).toLowerCase();
    if (kindWord === "adjusted") return false;
    const rest = stripMarkup(tag[3] || "").replace(/\.$/, "");
    const removed = kindWord === "removed";
    const lv = rest ? LABEL_VALUE.exec(rest) : null;
    if (lv && STARTS_WITH_VALUE.test(lv[2]) && lv[1].split(/\s+/).length <= 8 && !/[.!?]/.test(lv[1])) {
      const { slot, stat } = slotFor(null, stripMarkup(lv[1]));
      out.push(mk({ kind: "stat", changeType: removed ? "removed" : "added", traits: traitsOf(lv[2]), stat, effect: null, slot, label: stripMarkup(lv[1]), oldValue: removed ? lv[2].trim() : "", newValue: removed ? "" : lv[2].trim(), raw: line }));
    } else {
      const effectText = rest || ability || "";
      out.push(mk({ kind: "effect", changeType: removed ? "effect_removed" : "effect_added", traits: [], stat: null, effect: effectText, slot: slotFor(null, null).slot, label: null, oldValue: removed ? effectText : "", newValue: removed ? "" : effectText, raw: line }));
    }
    return true;
  };

  let currentLine = 0;
  // abilityLabel = the label line exactly as Riot wrote it (markup/colon/inline tag stripped, slot notation like "E -" KEPT): the
  // source heading a Patch Notes subsection is named after. `ability` (slot notation removed) stays what it always was.
  const base = (extra) => ({ ability, abilityLabel: abilityRaw, group, ...extra, source: "riot_patch_notes", detection: "deterministic", sourceSection, lineIndex: currentLine });

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    currentLine = lineIndex;
    const rawLine = lines[lineIndex];
    const line = rawLine.trim();
    if (!line) continue;
    const bullet = BULLET_LINE.exec(rawLine);
    const bulletIndent = bullet ? bullet[1].length : 0;
    const bulletText = bullet ? stripMarkup(bullet[2]) : "";

    // ---- non-bullet label line ("Absolution", "Base Stats", "Spectral Haste [Removed]") ----
    if (!bullet) {
      const arrowish = (line.match(ARROW_ANY) || []).length > 0;
      if (!arrowish && isLabelLine(line, nextNonEmptyIsBullet(lines, lineIndex))) {
        const inline = INLINE_TAG_SUFFIX.exec(line);
        const clean = stripMarkup(line.replace(INLINE_TAG_SUFFIX, "")).replace(/:$/, "").trim();
        group = labelStreak > 0 ? ability : null;
        ability = slotFromLabel(clean).rest || clean;
        abilityRaw = clean;
        labelStreak++;
        parentBullet = null;
        if (inline) {
          const removed = inline[1].toLowerCase() === "removed";
          out.push(base({ kind: "effect", changeType: removed ? "effect_removed" : "effect_added", traits: [], stat: null, effect: ability, label: null, oldValue: removed ? ability : "", newValue: removed ? "" : ability, raw: line, ...slotFor(clean, null) }));
        }
        continue;
      }
      // a non-bullet "[New] ..." / "[Removed] ..." line is an explicit flag too
      const tagNB = TAG_LINE.exec(stripMarkup(line));
      if (tagNB && handleTag(tagNB, line, base)) continue;
      // otherwise a non-bullet line is only a change when it is itself an explicit arrow pair
      const legacy = matchLegacyPair(line);
      const general = legacy ? null : splitGeneralArrowLine(line);
      if (!legacy && !general) continue; // ordinary prose paragraph: not a change
      pushArrowRecord(out, base, slotFor, legacy || general, line);
      continue;
    }

    labelStreak = 0;
    // track colon-terminated parent bullets so nested bullets keep their subject
    if (parentBullet && bulletIndent <= parentBullet.indent) parentBullet = null;
    const nestedGroup = parentBullet ? parentBullet.text : null;
    const recBase = (extra) => { const r = base(extra); if (nestedGroup) r.group = nestedGroup; return r; };

    // ---- arrow pair (legacy strict shapes first, then the general splitter) ----
    const legacy = matchLegacyPair(line);
    const general = legacy ? null : splitGeneralArrowLine(bulletText);
    if (legacy || general) {
      pushArrowRecord(out, recBase, slotFor, legacy || general, line);
      continue;
    }

    // ---- explicit [New]/[Removed]/New:/Removed: tag ----
    const tag = TAG_LINE.exec(bulletText);
    if (tag && handleTag(tag, line, recBase)) continue;

    // ---- new-value-only stat line: "Attack Speed Ratio: 0.4" ----
    const lv = LABEL_VALUE.exec(bulletText.replace(/\.$/, ""));
    if (lv && STARTS_WITH_VALUE.test(lv[2]) && lv[1].split(/\s+/).length <= 8 && !/[.!?]/.test(lv[1]) && !/\d/.test(lv[1])) {
      const { slot, stat } = slotFor(null, stripMarkup(lv[1]));
      out.push(recBase({ kind: "stat", changeType: "new_value", traits: traitsOf(lv[2]), stat, effect: null, slot, label: stripMarkup(lv[1]), oldValue: "", newValue: lv[2].trim(), raw: line }));
      continue;
    }

    // ---- colon-terminated bullet: a sub-label for the bullets nested under it, not a change itself ----
    if (/:$/.test(bulletText) && bulletText.length <= 90) {
      parentBullet = { indent: bulletIndent, text: bulletText.replace(/:$/, "") };
      continue;
    }

    // ---- everything else under an ability label: an effect/passive statement, preserved as text ----
    out.push(recBase({ kind: "effect", changeType: "effect", traits: [], stat: null, effect: bulletText, slot: slotFor(null, null).slot, label: null, oldValue: "", newValue: "", raw: line }));
  }
  return out;
}

/** Legacy strict shapes (exactly the behaviour extractDeterministicFacts
 *  always had): a labelled numeric pair, or the "increased from X to Y"
 *  prose form. Returned as { label, oldValue, newValue } or null. */
function matchLegacyPair(line) {
  let m = CHANGE_LINE.exec(line);
  if (!m) m = PROSE_CHANGE_LINE.exec(line);
  if (!m) return null;
  const [, labelRaw, oldValueRaw, newValueRaw] = m;
  const label = labelRaw.replace(/\*+/g, "").replace(/[:\-]+$/, "").trim();
  const oldValue = oldValueRaw.trim();
  const newValue = newValueRaw.trim();
  if (!oldValue || !newValue || oldValue === newValue) return null;
  return { label: label || null, oldValue, newValue };
}

function pushArrowRecord(out, base, slotFor, pair, raw) {
  const { label, oldValue, newValue } = pair;
  const { changeType, traits } = classifyArrowChange(label, oldValue, newValue);
  const { slot, stat } = slotFor(null, label);
  const rec = base({ kind: "stat", changeType, traits, stat: stat || null, effect: null, slot, label: label || null, oldValue, newValue, raw });
  const oldNum = scalarNumber(oldValue);
  const newNum = scalarNumber(newValue);
  if (oldNum !== null && newNum !== null) {
    rec.change = Math.round((newNum - oldNum) * 1000) / 1000;
    rec.changePercent = oldNum !== 0 ? Math.round(((newNum - oldNum) / Math.abs(oldNum)) * 1000) / 10 : null;
  }
  out.push(rec);
}

/** True for the record kinds that are an explicit old->new pair. */
export function isArrowFact(rec) {
  return rec && rec.kind === "stat" && rec.changeType !== "added" && rec.changeType !== "removed" && rec.changeType !== "new_value";
}

/** Scans one unit's raw text line-by-line for explicit before/after
 *  notation. Returns one fact record per matched line (label, oldValue,
 *  newValue, change?, changePercent?, raw, source, detection -- plus the
 *  structure metadata described above). `change`/`changePercent` are only
 *  present when BOTH sides are a single plain number. Never throws; an
 *  empty array means no explicit old->new pair -- prose-only changes
 *  ("W now also slows briefly") are NOT facts (they surface as `effect`
 *  records through extractStructuredChanges instead). */
export function extractDeterministicFacts(unitText, opts = {}) {
  return extractStructuredChanges(unitText, opts).filter(isArrowFact);
}

/** Formats a list of facts into a three-string shape
 *  (whatChanged/previousValue/newValue), labelled as "Q: ...", "W: ..."
 *  when a label was captured -- this is the FACT half of a report entry
 *  (see patchIntelligence.js's normalizeChangeEntry / this file's header
 *  for the fact/coach split). Returns null for an empty/missing fact
 *  list -- the report builder's (patchNotesReview.js) cue to fall back to Riot's own
 *  raw unit text instead (a real, confirmed mention with no extractable
 *  value pair -- prose-only, still worth an entry). */
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

// ---- unit-level entity ownership (for attributing facts) ------------

/** Resolves who a unit BELONGS to from its OWN heading only (never its
 *  body): { owner, status, headingKeys }.
 *    status "owner"     -- exactly one strong Academy entity is named by the
 *                          heading -> `owner` is that entity;
 *    status "none"      -- the heading names no tracked entity. The unit is
 *                          a system/topic section or a block about an entity
 *                          Academy doesn't track (JHIN, At Wit's End,
 *                          Manamune...). Entities named only in the BODY
 *                          are incidental mentions and NEVER make the unit
 *                          theirs, never make it ambiguous, and never
 *                          decide whether it is kept;
 *    status "ambiguous" -- the heading itself names two or more tracked
 *                          entities (a shared header) -> no owner, facts
 *                          are parked as unattributed, never guessed.
 *  This is the ownership half of "explicit structure beats incidental
 *  prose mentions" (see patchLifecycle.js for the section-semantics half). */
export function resolveUnitOwnership(unit, index, detectEntitiesInText, isStrongDetection) {
  const heading = unit.headingPath[unit.headingPath.length - 1] || unit.title || "";
  const detected = detectEntitiesInText(heading, index);
  const strong = [...detected.entries()].filter(([key, rec]) => isStrongDetection(index.byKey.get(key), rec));
  const headingKeys = strong.map(([key]) => key);
  if (strong.length === 1) return { owner: index.byKey.get(strong[0][0]), status: "owner", headingKeys };
  return { owner: null, status: strong.length === 0 ? "none" : "ambiguous", headingKeys };
}

/** Resolves the single Academy entity a unit's OWN heading (not its
 *  body) names, if exactly one strong match exists -- Riot's own
 *  per-champion/per-item heading convention (\"### Leona\", \"### Ardent
 *  Censer\") is what the report builder (patchNotesReview.js) relies on to attribute a
 *  unit's facts to exactly one entity's report entry. Zero or
 *  multiple heading-level matches return null. Thin wrapper over
 *  resolveUnitOwnership, kept for existing callers. */
export function resolveUnitOwnerEntity(unit, index, detectEntitiesInText, isStrongDetection) {
  return resolveUnitOwnership(unit, index, detectEntitiesInText, isStrongDetection).owner;
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
