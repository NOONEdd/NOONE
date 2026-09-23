// Semantic parsing of a Riot patch page (the line-oriented text produced by
// patchText.js) into ordered "units" -- the atomic pieces the rest of the
// Patch Intelligence pipeline plans, detects and analyzes.
//
// DESIGN RULES (see the pipeline overview in patchIntelligence.js):
//  * Structure comes from the DOCUMENT, not from a hardcoded section list.
//    A unit is "a heading and the lines directly under it" -- a champion
//    block, an item block, a rune block, a subsection intro, a bug-fix
//    list, whatever headings this particular patch actually has. Riot's
//    layout differs between patches (e.g. "CHAMPION CHANGES / GAMEPLAY
//    CHANGES / ITEMS" in some, "CHAMPION ADJUSTMENTS / Item Adjustments /
//    BATTLEFIELD ADJUSTMENTS / Appendix" in others), so nothing here
//    requires any particular heading to exist.
//  * `category` is only a best-effort HINT (derived from words in the
//    heading path) used to group units into coherent AI batches and to
//    label coverage. An unrecognized heading gets category "other" and is
//    still analyzed -- a missing keyword can never make content disappear.
//  * Every non-empty, non-rule line of the input belongs to exactly one
//    unit (asserted by tests/patchParser.test.mjs). Nothing is dropped and
//    nothing is duplicated.
//  * A single change description is never split: units are only ever cut
//    at heading boundaries, or -- for an oversize unit -- between change
//    groups (an ability/label block, or a whole top-level bullet with its
//    nested bullets), never inside a line.
//
// Pure functions, no I/O.

// Bump when parsing/classification/splitting can produce different units
// for the same text (part of PATCH_INTEL_ENGINE_VERSION's inputs and of
// every batch's input hash, so old batch results can't be reused).
export const PARSER_VERSION = "parse-v1";

const HEADING_MD = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const BULLET = /^(\s*)([-*+\u2022]|\d{1,3}[.)])\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const ITALIC_LABEL = /^\s*(?:\*[^*\s][^*]*\*|_[^_\s][^_]*_)\s*:?\s*$/;

// Words that make an ALL-CAPS line a top-level SECTION title ("CHAMPION
// CHANGES", "BUG FIXES", "SYSTEM") rather than an entity name ("EZREAL",
// "KAI'SA"). Riot's ALL-CAPS section titles and champion names look
// identical in flattened text; this is the one place the distinction is
// drawn, and it only decides nesting depth -- never whether text is kept.
const SECTION_KEYWORDS = /\b(CHANGES?|ADJUSTMENTS?|UPDATES?|FIXES|FIX|NEW|ITEMS?|RUNES?|SYSTEMS?|GAMEPLAY|CHAMPIONS?|BATTLEFIELD|JUNGLE|OBJECTIVES?|MINIONS?|TURRETS?|MODES?|APPENDIX|RANKED|NOTES|BUGS?|OTHER|ARAM|EVENTS?|SEASON)\b/;

function isAllCapsHeading(line) {
  const t = line.trim();
  if (t.length < 2 || t.length > 60) return false;
  if (/\p{Ll}/u.test(t)) return false;
  if ((t.match(/\p{Lu}/gu) || []).length < 2) return false;
  if (/[.:;!?,]$/.test(t)) return false;
  if (/[\u2192]|->|\d+\s*[/%]/.test(t)) return false;
  if (t.split(/\s+/).length > 7) return false;
  return true;
}

function isBulletLine(line) {
  return BULLET.test(line);
}

/** A short title-like line that introduces a group of bullets (an ability
 *  name, "Base Stats", "Energized:", "Garen"). Used ONLY to find safe cut
 *  points inside an oversize unit. */
function isLabelLike(line) {
  const t = line.trim();
  if (!t || t.length > 64) return false;
  if (isBulletLine(line) || HEADING_MD.test(t) || RULE.test(t)) return false;
  if (/[.!?]$/.test(t) && !/^\*.*\*$/.test(t)) return false;
  if (t.split(/\s+/).length > 9) return false;
  return /^[\p{Lu}\p{N}\[*_]/u.test(t);
}

// ---- category hints -------------------------------------------------------
// Ordered; first matching rule wins for a given heading. Non-gameplay is
// checked first so "Collection System and Wild Pass Emporium Revamp" is
// classified by "Wild Pass" and not by the word "System".
const CATEGORY_RULES = [
  ["nongameplay", /\b(wild\s*pass|mini\s*pass|wild\s*stars?|battlefest|adventure\s*mode|aram|augments?|skins?|chromas?|emotes?|ensigns?|new\s*player|login\s*event|emporium|promotions?|related\s+articles|newsletter|training\s*camp|custom\s*mode|sonic\s*waves|legendary\s*collection|loot|trove|battle\s*pass)\b/i],
  ["marksmen", /\bmarksm[ae]n\b/i],
  ["jungle", /\b(jungl\w*|smite|monsters?|camps?)\b/i],
  ["objectives", /\b(epic|dragons?|baron|herald|elder|objectives?|nexus)\b/i],
  ["minions", /\b(minions?|waves?)\b/i],
  ["turrets", /\b(turrets?|towers?|plating|inhibitors?)\b/i],
  ["runes", /\brunes?\b/i],
  ["items", /\b(items?|enchant\w*|boots)\b/i],
  ["champions", /\b(champions?|abilit\w*|base stats|durability|attack speed)\b/i],
  ["map", /\b(battlefield|map|pacing|tempo|economy|gold|experience|xp)\b/i],
  ["systems", /\b(ranked|legendary|season|priority role|autofill|bans?|pick|matchmaking|draft|champion score|mvp|rating|system|roles?|lifesteal|vamp|omnivamp|stats?)\b/i],
  ["bugfixes", /\b(bug\s*fix\w*|fixes)\b/i],
  ["appendix", /\bappendix\b/i],
];

export function categoryForHeading(title) {
  for (const [category, re] of CATEGORY_RULES) {
    if (re.test(title)) return category;
  }
  return null;
}

/** Category of a unit: the deepest heading in its path that matches a
 *  rule (so "Smite Adjustments" beats its parent "BATTLEFIELD
 *  ADJUSTMENTS"), else "other". */
export function categoryForPath(headingPath) {
  for (let i = headingPath.length - 1; i >= 0; i--) {
    const c = categoryForHeading(headingPath[i]);
    if (c) return c;
  }
  return "other";
}

/** Splits `text` into raw lines, trimming trailing whitespace only (leading
 *  indentation is what encodes bullet nesting). */
function toLines(text) {
  return String(text || "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
}

function trimBlankEdges(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

/**
 * Parses structured patch text into ordered units.
 *
 * @param {string} text           output of htmlToStructuredText()
 * @param {object} [opts]
 * @param {number} [opts.maxUnitChars=18000]  units above this are split on change-block boundaries
 * @returns {{ title: string, intro: string, units: Unit[], stats: object }}
 *   Unit: { id, title, level, headingPath, lines, text, chars, category,
 *           gameplay, empty, part? }
 */
export function parsePatchDocument(text, opts = {}) {
  const maxUnitChars = opts.maxUnitChars || 18000;
  const lines = toLines(text);

  const stack = []; // { level, title, implicitEntity }
  const raw = []; // { title, level, headingPath, lines }
  let current = { title: "(document start)", level: 0, headingPath: [], lines: [] };
  let docTitle = "";
  let headingCount = 0;

  function openUnit(level, title, implicitEntity) {
    raw.push(current);
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    stack.push({ level, title, implicitEntity });
    current = { title, level, headingPath: stack.map((s) => s.title), lines: [] };
    headingCount++;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (RULE.test(trimmed)) continue; // separators carry no patch content

    const md = HEADING_MD.exec(trimmed);
    if (md) {
      const level = md[1].length;
      if (level === 1 && !docTitle) docTitle = md[2];
      openUnit(level, md[2].trim(), false);
      continue;
    }
    if (trimmed && !isBulletLine(line) && isAllCapsHeading(trimmed)) {
      if (SECTION_KEYWORDS.test(trimmed)) {
        openUnit(2, trimmed, false);
      } else {
        const top = stack[stack.length - 1];
        const level = top && top.implicitEntity ? top.level : Math.min(6, (top ? top.level : 1) + 1);
        openUnit(level, trimmed, true);
      }
      continue;
    }
    current.lines.push(line);
  }
  raw.push(current);

  // ---- finalize raw blocks into units -------------------------------------
  const units = [];
  let seq = 0;
  for (const block of raw) {
    const bodyLines = trimBlankEdges(block.lines);
    const isPreamble = block.level === 0;
    if (isPreamble && bodyLines.length === 0) continue; // nothing before the first heading
    const bodyText = bodyLines.join("\n");
    const headingPath = block.headingPath;
    const category = isPreamble ? "preamble" : categoryForPath(headingPath);
    seq++;
    units.push({
      id: `U${String(seq).padStart(3, "0")}`,
      title: block.title,
      level: block.level,
      headingPath,
      lines: bodyLines,
      text: bodyText,
      chars: bodyText.length,
      category,
      gameplay: category !== "nongameplay",
      empty: bodyLines.filter((l) => l.trim()).length === 0,
    });
  }

  const expanded = units.flatMap((u) => (u.chars > maxUnitChars ? splitOversizeUnit(u, maxUnitChars) : [u]));

  const totalChars = expanded.reduce((n, u) => n + u.chars, 0);
  const warnings = [];
  let quality = "ok";
  if (totalChars > 12000 && headingCount < 3) {
    quality = "flat";
    warnings.push(`Only ${headingCount} heading(s) found in ${totalChars} characters of patch text -- page structure may not have been recognized; content was split on paragraph boundaries instead.`);
  } else if (totalChars > 0 && totalChars < 600) {
    quality = "short";
    warnings.push(`Patch text is unusually short (${totalChars} characters) -- verify the official page rendered fully.`);
  }

  // Intro = everything before the first level-2+ heading (Riot's "Patch X is
  // here..." summary paragraph). Used ONLY as context for the final summary;
  // it is still analyzed like any other unit.
  const introUnits = [];
  for (const u of expanded) {
    if (u.level >= 2 && u.headingPath.length > 0 && u.level !== 0) break;
    introUnits.push(u);
  }
  const intro = introUnits.map((u) => u.text).join("\n").trim().slice(0, 2500);

  return {
    title: docTitle,
    intro,
    units: expanded,
    stats: {
      chars: totalChars,
      lines: lines.length,
      headings: headingCount,
      units: expanded.length,
      quality,
      warnings,
    },
  };
}

// ---- oversize splitting -------------------------------------------------------

/** Splits one oversize unit into parts <= maxChars, cutting only between
 *  change groups. A group starts at a label-like line (ability name, "Base
 *  Stats", a champion name in an appendix list) that is followed by
 *  bullets, or at a blank-line-separated paragraph. If a single group is
 *  still too large (one giant bullet list) it is cut between TOP-LEVEL
 *  bullets, keeping each bullet together with its nested sub-bullets. A
 *  single line longer than maxChars is kept whole rather than cut. */
export function splitOversizeUnit(unit, maxChars) {
  const lines = unit.lines;
  const nextNonEmpty = (i) => {
    for (let k = i + 1; k < lines.length; k++) if (lines[k].trim()) return lines[k];
    return null;
  };
  const introducesGroup = (i) => {
    const n = nextNonEmpty(i);
    return Boolean(n) && (isBulletLine(n) || ITALIC_LABEL.test(n.trim()) || isLabelLike(n));
  };
  const lastNonEmpty = (arr) => {
    for (let k = arr.length - 1; k >= 0; k--) if (arr[k].trim()) return arr[k];
    return null;
  };

  // Change groups: a label line that introduces bullets starts a new group
  // (unless we are still inside a stack of labels, e.g. "Garen" followed by
  // "*Base Stats*"), and a blank line closes the paragraph it follows.
  const groups = [];
  let cur = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const blank = !line.trim();
    const last = lastNonEmpty(cur);
    const insideLabelStack = last !== null && !isBulletLine(last) && (isLabelLike(last) || ITALIC_LABEL.test(last.trim()));
    if (!blank && last !== null && isLabelLike(line) && introducesGroup(i) && !insideLabelStack) {
      groups.push(cur);
      cur = [];
    }
    cur.push(line);
    if (blank && last !== null) {
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.some((l) => l.trim())) groups.push(cur);

  // Any group that is still too big gets cut between top-level bullets.
  const atoms = [];
  for (const g of groups) {
    const gChars = g.join("\n").length;
    if (gChars <= maxChars) { atoms.push(g); continue; }
    let piece = [];
    let pieceChars = 0;
    for (const line of g) {
      const isTopBullet = isBulletLine(line) && BULLET.exec(line)[1].length === 0;
      if (isTopBullet && piece.length && pieceChars + line.length + 1 > maxChars) {
        atoms.push(piece); piece = []; pieceChars = 0;
      }
      piece.push(line); pieceChars += line.length + 1;
    }
    if (piece.length) atoms.push(piece);
  }

  const parts = [];
  let acc = [];
  let accChars = 0;
  for (const atom of atoms) {
    const c = atom.join("\n").length + 1;
    if (acc.length && accChars + c > maxChars) { parts.push(acc); acc = []; accChars = 0; }
    acc.push(...atom); accChars += c;
  }
  if (acc.length) parts.push(acc);

  const total = parts.length;
  return parts.map((partLines, i) => {
    const body = trimBlankEdges(partLines);
    const t = body.join("\n");
    return {
      ...unit,
      id: `${unit.id}.${i + 1}`,
      title: total > 1 ? `${unit.title} (part ${i + 1}/${total})` : unit.title,
      lines: body,
      text: t,
      chars: t.length,
      empty: body.filter((l) => l.trim()).length === 0,
      part: { index: i + 1, total },
    };
  });
}

/** Plain-text rendering of one unit for an AI batch prompt: an id + the
 *  heading path (so the model knows which champion/item a bullet belongs
 *  to even when units from several sections share a batch) followed by
 *  the unit's own lines, verbatim. */
export function renderUnit(unit) {
  const path = unit.headingPath.length ? unit.headingPath.join(" > ") : unit.title;
  return `[${unit.id}] ${path}\n${unit.text}`;
}
