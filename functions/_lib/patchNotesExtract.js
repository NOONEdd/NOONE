// Patch Notes -- deterministic extraction core.
//
//   Riot source -> document structure (patchParser units) -> BLOCKS
//     -> OWNERSHIP -> normalized CHANGE records -> stable IDs
//     -> accounting ledger
//
// 100% deterministic: headings, section hierarchy, explicit Riot markers
// ([New]/Removed/...), exact normalized name equality, hashes. No AI, no
// model knowledge, no semantic similarity, no "is this a Support thing"
// guess. NOTHING is filtered for relevance: every meaningful block ends up
// as changes owned by an EXISTING Academy entity, a NEW_CANDIDATE, an
// UNMATCHED block, or an explicit SYSTEM change -- or carries an explicit
// ignoredReason. `validation.unaccountedBlocks` proves it (target 0).
//
// OWNERSHIP (why a change belongs to what it belongs to) is recorded on
// every change as ownership.source:
//   entity_heading  the block's own heading IS a tracked entity's name
//                   (exact normalized equality, never "contains"), inside
//                   a section that lists entities (champion/item/rune/
//                   marksman sections) -- so "Heartsteel" under ARAM
//                   augment sets and "Crystalline Overgrowth" under
//                   Turrets can never become Academy entities
//   explicit_block  a "<Name> / Base Stats / bullets" run INSIDE a block
//                   (Riot's own per-entity list convention) -- how a
//                   heading-less appendix list is split without guessing
//   lifecycle_block an explicit lifecycle list (Items Removed, a bare
//                   Removed list, New Items / New Champions ...)
//   section_structure  the block sits in a system/topic section (jungle,
//                   turrets, minions, objectives, map, systems, ...)
//   unmatched       ownership itself can't be proven: a heading naming
//                   several tracked entities (shared header). Kept and
//                   flagged, never guessed onto anyone. (An entity-shaped
//                   block Academy merely doesn't track is NOT this: its
//                   owner is structurally clear -- entity_heading /
//                   explicit_block -- and only its STATUS is UNMATCHED or
//                   NEW_CANDIDATE.)
// A name merely MENTIONED in prose is recorded as a suspectedReference
// and never as ownership.
//
// ENTITY STATUS
//   EXISTING       a tracked Academy entity owns the change (Academy data
//                  does NOT need a matching field -- every structurally
//                  owned change is kept)
//   NEW_CANDIDATE  not tracked, and Riot's own structure/wording proves it
//                  is new: a lifecycle "added" section, or an explicit
//                  "introducing X" / "the new X" / "new items like X" /
//                  "X is joining" sentence anywhere in the patch text.
//                  Evidence is stored on the change.
//   UNMATCHED      a meaningful entity-shaped block/fact with no proof of
//                  newness or no provable owner.
//   (system changes have no entity and no status.)
// supportScope is ALWAYS "UNKNOWN" for NEW_CANDIDATE/UNMATCHED; "ACADEMY"
// only means "already tracked by Academy" -- never a Support judgement.

import { extractStructuredChanges } from "./patchChangeDetector.js";
import { lifecycleNamesForUnit } from "./patchLifecycle.js";
import { categoryForHeading, PARSER_VERSION } from "./patchParser.js";
import { buildAcademyIndex, detectEntitiesInText, isStrongDetection, tokenize } from "./patchAcademyDetection.js";
import { PATCH_NOTES_SCHEMA, buildChangeId, sourceFingerprint, normName, normText } from "./patchNotesIds.js";

export const PATCH_NOTES_EXTRACT_VERSION = "pn-extract-v1";

export const ENTITY_STATUS = Object.freeze({ EXISTING: "EXISTING", NEW_CANDIDATE: "NEW_CANDIDATE", UNMATCHED: "UNMATCHED" });
export const OWNERSHIP_SOURCE = Object.freeze({
  ENTITY_HEADING: "entity_heading", EXPLICIT_BLOCK: "explicit_block", LIFECYCLE_BLOCK: "lifecycle_block",
  SECTION_STRUCTURE: "section_structure", UNMATCHED: "unmatched",
});
/** Lifecycle/comparison vocabulary for a change. BUFF/NERF only when Riot's own
 *  heading says so; old->new pairs Riot doesn't label are ADJUSTED. */
export const COMPARISON = Object.freeze({ NEW: "NEW", BUFF: "BUFF", NERF: "NERF", ADJUSTED: "ADJUSTED", REMOVED: "REMOVED", UNCHANGED: "UNCHANGED", UNKNOWN: "UNKNOWN" });

const ENTITY_SECTION_CATEGORIES = new Set(["champions", "items", "runes", "marksmen"]);
// Sections Riot uses for systems/live-service content. A heading INSIDE one of these that happens to equal a
// tracked entity's name ("Heartsteel" under ARAM augment sets) is never entity ownership -- that is exactly
// the false-ownership case. Sections with no recognised category ("other", "preamble", "appendix") still allow an
// exact-name entity heading: a bare "### Leona" has no section context to contradict it.
const NON_ENTITY_CATEGORIES = new Set(["nongameplay", "jungle", "turrets", "minions", "objectives", "map", "systems", "bugfixes"]);
const SYSTEM_LABEL = {
  jungle: "jungle", turrets: "turret", minions: "minion", objectives: "objective", map: "map", systems: "system",
  nongameplay: "live_service", bugfixes: "bug_fix", appendix: "appendix", preamble: "overview", other: "other",
  champions: "champion_system", items: "item_system", runes: "rune_system", marksmen: "marksman_system",
};
const BULLET = /^\s*(?:[-*+\u2022]|\d{1,3}[.)])\s+/;
const BASE_STATS_LABEL = /^\**_*base stats_*\**:?$/i;

const isBulletLine = (l) => BULLET.test(l);
const stripMarkup = (s) => String(s || "").replace(/\*+/g, "").replace(/_{2,}/g, "").trim();
function isLabelLine(line) {
  const t = String(line || "").trim();
  return Boolean(t) && t.length <= 64 && !/[.!?]$/.test(t) && t.split(/\s+/).length <= 9 && /^[\p{Lu}\p{N}\[*_(]/u.test(t);
}

const lines_trim = (text, i) => String(text).split("\n")[i].trim();
// `titleDepth` is 1 when the document has an H1 page title (Riot's pages do): the title is then
// not a "section", so the section is the next heading down. Without an H1 the first heading is the section.
function sectionFields(headingPath, titleDepth = 0) {
  const p = headingPath || [];
  const secIdx = Math.min(titleDepth, Math.max(p.length - 1, 0));
  return {
    sourceSection: p[secIdx] || null,
    sourceSubsection: p.length > secIdx + 2 ? p.slice(secIdx + 1, -1).join(" > ") : null,
    sourceHeading: p[p.length - 1] || null,
    sourcePath: p.join(" > "),
  };
}

/** Explicit "<Name> / Base Stats" sub-blocks inside one unit's lines. Returns
 *  [{ startLine, ownerName|null, lines }]. Text before the first marker is the unit's own block. */
function splitExplicitBlocks(lines) {
  const segs = [{ startLine: 0, ownerName: null, lines: [] }];
  const nextNonEmpty = (i) => { for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j].trim(); return ""; };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (t && !isBulletLine(raw) && isLabelLine(t) && !BASE_STATS_LABEL.test(t) && BASE_STATS_LABEL.test(nextNonEmpty(i))) {
      segs.push({ startLine: i, ownerName: stripMarkup(t), lines: [] });
    }
    segs[segs.length - 1].lines.push(raw);
  }
  return segs;
}

// Explicit, narrow boilerplate: a block whose every line is a publication timestamp or a
// byline/category tag. Anything with real wording is content and is never matched here.
const BOILERPLATE_LINE = /^(?:\d{4}-\d{2}-\d{2}(?:[t ][\d:.]+z?)?|game updates|wild rift game design team|patch notes|share|read more)$/i;
export function isBoilerplateText(text) {
  const lines = String(text || "").split("\n").map((l) => stripMarkup(l).replace(BULLET, "").trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => BOILERPLATE_LINE.test(l));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Explicit newness wording about a NAMED entity anywhere in the document. */
export function findNewnessEvidence(name, unitsWithText) {
  const n = escapeRe(String(name).trim());
  if (!n) return null;
  const pats = [
    new RegExp(`\\bintroduc(?:ing|es|ed)\\s+(?:the\\s+)?(?:new\\s+)?(?:item\\s+|champion\\s+|rune\\s+)?${n}\\b`, "i"),
    new RegExp(`\\b(?:the\\s+)?new\\s+(?:item\\s+|champion\\s+|rune\\s+)?${n}\\b`, "i"),
    new RegExp(`\\bnew\\s+(?:items?|champions?|runes?)\\b[^.\\n]{0,120}\\b${n}\\b`, "i"),
    new RegExp(`\\b${n}\\b[^.\\n]{0,40}\\b(?:is|are)\\s+(?:now\\s+)?(?:joining|being added|new)\\b`, "i"),
  ];
  for (const u of unitsWithText) {
    for (const sentence of String(u.text || "").split(/(?<=[.!?])\s+|\n+/)) {
      if (pats.some((re) => re.test(sentence))) return { unitId: u.id, sentence: sentence.trim().slice(0, 300) };
    }
  }
  return null;
}

// ---- display formatting (human-readable summary of one change; never the source of truth) ----
export function formatChangeLine(c) {
  const prefix = [c.ability, c.group].filter(Boolean).join(" \u203A ");
  let body;
  switch (c.changeType) {
    case "added": body = `New ${c.stat || c.label || "stat"}: ${c.newValue}`; break;
    case "removed": body = `Removed ${c.stat || c.label || "stat"}: ${c.oldValue}`; break;
    case "new_value": body = `${c.stat || c.label}: ${c.newValue}`; break;
    case "effect_added": body = `New: ${c.effect}`; break;
    case "effect_removed": body = `Removed: ${c.effect}`; break;
    case "effect": case "textual_change": body = c.effect; break;
    default: body = c.label ? `${c.label}: ${c.oldValue} \u2192 ${c.newValue}` : `${c.oldValue} \u2192 ${c.newValue}`;
  }
  const showPrefix = prefix && !(c.effect && c.effect === c.ability);
  return showPrefix ? `${prefix} \u00B7 ${body}` : body;
}

function comparisonFor(rec, headingPath, entityStatus) {
  if (rec.changeType === "added" || rec.changeType === "effect_added") return COMPARISON.NEW;
  if (rec.changeType === "removed" || rec.changeType === "effect_removed") return COMPARISON.REMOVED;
  if (rec.changeType === "new_value") return entityStatus === ENTITY_STATUS.NEW_CANDIDATE ? COMPARISON.NEW : COMPARISON.UNKNOWN;
  if (rec.changeType === "effect" || rec.changeType === "textual_change") return COMPARISON.UNKNOWN;
  const path = (headingPath || []).join(" ");
  if (/\bbuff(?:s|ed)?\b/i.test(path)) return COMPARISON.BUFF;
  if (/\bnerf(?:s|ed)?\b/i.test(path)) return COMPARISON.NERF;
  return COMPARISON.ADJUSTED; // an explicit old -> new pair Riot didn't label good/bad
}

function identityOf(rec) {
  if (rec.lifecycle) return `life|${rec.lifecycle.action}|${rec.lifecycle.kind}|${normName(rec.lifecycle.name)}`;
  const slot = [rec.ability, rec.group].map(normText).join("|");
  switch (rec.changeType) {
    case "added": case "removed": case "new_value": return `${rec.changeType}|${slot}|${normText(rec.stat || rec.label)}`;
    case "effect": case "effect_added": case "effect_removed": case "textual_change": return `${rec.changeType}|${slot}|${normText(rec.effect).slice(0, 200)}`;
    default: return `change|${slot}|${normText(rec.stat || rec.label)}`; // every old->new shape (value/rank/range/expression/recipe/text) is ONE slot class
  }
}

/** Finds the source lines of a lifecycle name bullet plus its explaining parent bullet. */
function lifecycleSourceText(unit, name) {
  const lines = String(unit.text || "").split("\n");
  const target = normName(name);
  const indent = (l) => l.match(/^\s*/)[0].length;
  for (let i = 0; i < lines.length; i++) {
    if (normName(stripMarkup(lines[i].replace(BULLET, ""))) !== target) continue;
    let parent = null;
    for (let j = i - 1; j >= 0; j--) if (lines[j].trim() && indent(lines[j]) < indent(lines[i])) { parent = lines[j].trim(); break; }
    return { text: (parent ? parent + "\n" : "") + lines[i].trim(), lineIndex: i };
  }
  return { text: name, lineIndex: null };
}

/**
 * @param {object} args
 * @param {Array} args.units  parsePatchDocument(...).units (document order)
 * @param {Array} args.championRoster/itemRoster/runeRoster  Academy rosters (may be incomplete)
 * @param {string|null} args.patchVersion, args.sourceUrl
 * @param {string} args.extractedAt  ISO timestamp (caller-supplied so runs are reproducible in tests)
 * @returns {{ schema, patchVersion, sourceUrl, parserVersion, extractorVersion, extractedAt, changes, blocks, validation }}
 *   (review state is added by patchNotesReview.js)
 */
export function extractPatchNotes({ units, championRoster = [], itemRoster = [], runeRoster = [], patchVersion = null, sourceUrl = null, extractedAt = null, abilitySlotsByEntity = null }) {
  const index = buildAcademyIndex({ championRoster, itemRoster, runeRoster });
  // whole-name equality on STEMMED tokens ("Staff of Flowing Waters" == "Staff of Flowing Water"),
  // never containment: "Crystalline Overgrowth" does not equal the rune "Overgrowth".
  const stemKey = (name) => tokenize(String(name || "").replace(/\([^)]*\)|\[[^\]]*\]/g, " ")).map((t) => t.stem).join("");
  const byName = new Map();
  for (const e of index.byKey.values()) {
    const k = stemKey(e.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(e);
  }
  const exactEntity = (name) => { const l = byName.get(stemKey(name)); return l && l.length === 1 ? l[0] : null; };
  const exactEntities = (name) => byName.get(stemKey(name)) || [];
  const unitsWithText = units.filter((u) => u.text && u.text.trim());
  const titleDepth = units.some((u) => u.level === 1) ? 1 : 0;

  const changes = [];
  const blocks = [];
  const idSeen = new Map(); // changeId -> { change, fingerprints:Set }
  const newnessCache = new Map();
  let duplicateMerges = 0;

  const newness = (name) => {
    const k = normName(name);
    if (!newnessCache.has(k)) newnessCache.set(k, findNewnessEvidence(name, unitsWithText));
    return newnessCache.get(k);
  };

  function typeFromCategory(unit) {
    if (unit.category === "champions") return "champion";
    if (unit.category === "items") return "item";
    if (unit.category === "runes") return "rune";
    if (unit.category === "marksmen") return /\bitems?\b/i.test((unit.headingPath || []).join(" ")) ? "item" : "champion";
    return "unknown";
  }

  function pushChange({ unit, blockIndex, rec, lineOffset = 0, owner, originalSourceText }) {
    const sec = sectionFields(unit.headingPath, titleDepth);
    const lineIndex = rec.lineIndex != null ? rec.lineIndex + lineOffset : null;
    const original = originalSourceText ?? rec.raw;
    const scopeKey = owner.kind === "system" ? `system:${owner.category}` : owner.entityKey;
    const identity = identityOf(rec);
    const pathBelowTitle = (unit.headingPath || []).slice(titleDepth);
    const fingerprint = sourceFingerprint(original);
    let changeId = buildChangeId({ patchVersion, scopeKey, sectionPath: pathBelowTitle, identity });

    const seen = idSeen.get(changeId);
    if (seen && seen.fingerprints.has(fingerprint)) { // same structural slot AND same wording -> deterministic duplicate
      seen.change.duplicates.push({ blockIndex, sourceLineIndex: lineIndex, sourcePath: sec.sourcePath });
      duplicateMerges++;
      return seen.change;
    }
    if (seen) { // same slot, different wording: a genuinely different change -> ordinal suffix
      let n = 2; while (idSeen.has(`${changeId}~${n}`)) n++;
      changeId = `${changeId}~${n}`;
    }
    const comparisonState = rec.lifecycle ? (rec.lifecycle.action === "added" ? COMPARISON.NEW : COMPARISON.REMOVED) : comparisonFor(rec, unit.headingPath, owner.status);
    const entityLabel = owner.kind === "entity" ? owner.name : null;
    const displayText = rec.lifecycle ? `${rec.lifecycle.action === "added" ? "New" : "Removed"} ${rec.lifecycle.kind}: ${rec.lifecycle.name}` : formatChangeLine(rec);
    const change = {
      changeId,
      kind: owner.kind, // "entity" | "system"
      entity: owner.kind === "entity"
        ? { key: owner.entityKey, academyKey: owner.academy ? owner.academy.key : null, id: owner.academy ? owner.academy.id : null, name: owner.name, type: owner.type, status: owner.status, supportScope: owner.academy ? "ACADEMY" : "UNKNOWN", newnessEvidence: owner.evidence || null }
        : null,
      system: owner.kind === "system" ? { category: owner.category, area: sec.sourceHeading } : null,
      ownership: { source: owner.ownershipSource, reason: owner.reason, suspectedReferences: owner.suspectedReferences || [] },
      comparisonState,
      lifecycle: rec.lifecycle ? { action: rec.lifecycle.action, kind: rec.lifecycle.kind } : null,
      originalSourceText: original,
      normalizedData: {
        kind: rec.kind || "effect", changeType: rec.changeType, ability: rec.ability ?? null, slot: rec.slot ?? null, group: rec.group ?? null,
        stat: rec.stat ?? rec.label ?? null, effect: rec.effect ?? null, traits: rec.traits || [],
        oldValue: rec.oldValue ?? "", newValue: rec.newValue ?? "",
        ...(rec.change !== undefined ? { change: rec.change, changePercent: rec.changePercent } : {}),
      },
      provenance: {
        patchVersion, sourceUrl, sourceSection: sec.sourceSection, sourceSubsection: sec.sourceSubsection, sourceHeading: sec.sourceHeading,
        sourceOrder: changes.length, sourcePath: sec.sourcePath,
        sourceBlockIndex: blockIndex, sourceLineIndex: lineIndex, sourceNodePath: `${sec.sourcePath} #${blockIndex}${lineIndex != null ? `:${lineIndex}` : ""}`,
        sourceAnchor: null, // the structured text carries no anchors; never invented
        sourceFingerprint: fingerprint, parserVersion: PARSER_VERSION, extractorVersion: PATCH_NOTES_EXTRACT_VERSION, extractedAt,
      },
      duplicates: [],
      displayDefaults: { displayTitle: [entityLabel || sec.sourceHeading, rec.ability && rec.ability !== entityLabel ? rec.ability : null].filter(Boolean).join(" \u2014 "), displayText },
    };
    changes.push(change);
    idSeen.set(changeId, { change, fingerprints: new Set([fingerprint]) });
    return change;
  }

  blocks.length = 0;
  units.forEach((unit, blockIndex) => {
    const text = unit.text || "";
    const sec = sectionFields(unit.headingPath, titleDepth);
    const block = { blockIndex, unitId: unit.id, sourcePath: sec.sourcePath, sourceHeading: sec.sourceHeading, category: unit.category, chars: unit.chars ?? text.length, originalSourceText: text, classification: null, ignoredReason: null, changeIds: [], suspectedReferences: [] };
    blocks.push(block);
    if (!text.trim()) { block.classification = "ignored"; block.ignoredReason = "non-content"; return; }
    if (isBoilerplateText(text)) { block.classification = "ignored"; block.ignoredReason = "boilerplate"; return; }

    const heading = sec.sourceHeading || unit.title || "";
    const entityBearing = ENTITY_SECTION_CATEGORIES.has(unit.category);
    const entityMatchAllowed = !NON_ENTITY_CATEGORIES.has(unit.category);
    const lifecycle = lifecycleNamesForUnit(unit);

    // entities only MENTIONED in this block (measured; never ownership)
    const mentioned = [...detectEntitiesInText(`${heading}\n${text}`, index).entries()].filter(([k, r]) => isStrongDetection(index.byKey.get(k), r)).map(([k]) => k);

    // ---------- 1. explicit lifecycle lists ----------
    // a child of a lifecycle heading (New Champions > Hwei) is a lifecycle entity only when its OWN title is entity-shaped
    // (names no topic like "Augment pool Adjustments"); an own-heading list (Items Removed / bare Removed) always is.
    if (lifecycle && (lifecycle.form !== "child" || categoryForHeading(heading) === null)) {
      const seenNames = new Set();
      for (const name of lifecycle.names) {
        const nk = normName(name);
        if (seenNames.has(nk)) { // "Searing Crown" listed twice inside one list: one fact, the second wording is recorded as a duplicate below
          continue;
        }
        seenNames.add(nk);
        const academy = exactEntity(name);
        const accepted = academy && academy.type === lifecycle.kind;
        const added = lifecycle.action === "added";
        const evidence = !accepted && added ? { unitId: unit.id, sentence: `explicit lifecycle section: ${(unit.headingPath || []).slice(-2).join(" > ")}` } : null;
        const src = lifecycle.form === "child" ? { text: text.trim() || name, lineIndex: null } : lifecycleSourceText(unit, name); // sub-heading form (New Champions > Hwei): Riot's own description is the source
        const owner = accepted
          ? { kind: "entity", entityKey: academy.key, academy, name: academy.name, type: academy.type, status: ENTITY_STATUS.EXISTING, ownershipSource: OWNERSHIP_SOURCE.LIFECYCLE_BLOCK, reason: `explicit lifecycle list "${heading}"` }
          : { kind: "entity", entityKey: `${lifecycle.kind}:${normName(name)}`, academy: null, name, type: lifecycle.kind, status: added ? ENTITY_STATUS.NEW_CANDIDATE : ENTITY_STATUS.UNMATCHED, ownershipSource: OWNERSHIP_SOURCE.LIFECYCLE_BLOCK, reason: `explicit lifecycle list "${heading}"`, evidence };
        const ch = pushChange({ unit, blockIndex, rec: { lifecycle: { action: lifecycle.action, kind: lifecycle.kind, name }, raw: src.text, lineIndex: src.lineIndex, changeType: lifecycle.action === "added" ? "effect_added" : "effect_removed", effect: name, kind: "effect", traits: [] }, owner, originalSourceText: src.text });
        if (!block.changeIds.includes(ch.changeId)) block.changeIds.push(ch.changeId);
      }
      // a name listed more than once inside the SAME list is one fact: the extra lines are recorded on it as duplicates
      for (const name of lifecycle.names) {
        const target = normName(name);
        const dupLines = String(text).split("\n").map((l, i) => ({ l, i })).filter(({ l }) => normName(stripMarkup(l.replace(BULLET, ""))) === target);
        if (dupLines.length > 1) {
          const ch = changes.find((c) => c.lifecycle && normName(c.entity.name) === target && c.provenance.sourceBlockIndex === blockIndex);
          if (ch) for (const { i } of dupLines.slice(1)) { ch.duplicates.push({ blockIndex, sourceLineIndex: i, sourcePath: sec.sourcePath, sourceText: lines_trim(text, i) }); duplicateMerges++; }
        }
      }
      block.classification = "lifecycle";
      block.suspectedReferences = mentioned.filter((k) => !block.changeIds.some((id) => changes.find((c) => c.changeId === id)?.entity?.key === k));
      return;
    }

    // ---------- 2. who owns the block itself? ----------
    const headingEntities = entityMatchAllowed ? exactEntities(heading) : [];
    let blockOwner;
    if (entityMatchAllowed && headingEntities.length === 1) {
      const a = headingEntities[0];
      blockOwner = { kind: "entity", entityKey: a.key, academy: a, name: a.name, type: a.type, status: ENTITY_STATUS.EXISTING, ownershipSource: OWNERSHIP_SOURCE.ENTITY_HEADING, reason: `heading "${heading}" equals the tracked ${a.type} name` };
    } else if (entityMatchAllowed && headingEntities.length > 1) {
      blockOwner = { kind: "entity", entityKey: `unknown:${normName(heading)}`, academy: null, name: heading, type: typeFromCategory(unit), status: ENTITY_STATUS.UNMATCHED, ownershipSource: OWNERSHIP_SOURCE.UNMATCHED, reason: `heading "${heading}" equals more than one tracked entity name (ambiguous owner)`, suspectedReferences: headingEntities.map((e) => e.key) };
    } else if (entityBearing && categoryForHeading(heading) === null && typeFromCategory(unit) !== "unknown") {
      const ev = newness(heading);
      blockOwner = { kind: "entity", entityKey: `${typeFromCategory(unit)}:${normName(heading)}`, academy: null, name: heading, type: typeFromCategory(unit), status: ev ? ENTITY_STATUS.NEW_CANDIDATE : ENTITY_STATUS.UNMATCHED, ownershipSource: OWNERSHIP_SOURCE.ENTITY_HEADING, reason: ev ? `entity-shaped block "${heading}" not tracked by Academy; newness proven by Riot wording` : `entity-shaped block "${heading}" not tracked by Academy; newness not provable`, evidence: ev };
    } else {
      const category = SYSTEM_LABEL[unit.category] || "other";
      blockOwner = { kind: "system", category, ownershipSource: OWNERSHIP_SOURCE.SECTION_STRUCTURE, reason: `section "${sec.sourceSection || heading}" is a ${category} section; heading "${heading}" names no tracked entity` };
    }
    blockOwner.suspectedReferences = blockOwner.suspectedReferences || mentioned.filter((k) => k !== blockOwner.entityKey);

    // ---------- 3. changes (per explicit sub-block) ----------
    const lines = text.split("\n");
    const segs = entityMatchAllowed ? splitExplicitBlocks(lines) : [{ startLine: 0, ownerName: null, lines }];
    for (const seg of segs) {
      let owner = blockOwner;
      if (seg.ownerName) {
        const a = exactEntity(seg.ownerName);
        const type = a ? a.type : typeFromCategory(unit);
        const ev = a ? null : newness(seg.ownerName);
        owner = a
          ? { kind: "entity", entityKey: a.key, academy: a, name: a.name, type: a.type, status: ENTITY_STATUS.EXISTING, ownershipSource: OWNERSHIP_SOURCE.EXPLICIT_BLOCK, reason: `"${seg.ownerName} / Base Stats" sub-block inside "${heading}"`, suspectedReferences: [] }
          : { kind: "entity", entityKey: `${type}:${normName(seg.ownerName)}`, academy: null, name: seg.ownerName, type, status: ev ? ENTITY_STATUS.NEW_CANDIDATE : ENTITY_STATUS.UNMATCHED, ownershipSource: OWNERSHIP_SOURCE.EXPLICIT_BLOCK, reason: `"${seg.ownerName} / Base Stats" sub-block inside "${heading}"; not tracked by Academy`, evidence: ev, suspectedReferences: [] };
      }
      const segText = seg.lines.join("\n");
      const abilitySlots = owner.kind === "entity" && owner.academy && abilitySlotsByEntity ? abilitySlotsByEntity.get(owner.academy.key) || null : null;
      let recs = extractStructuredChanges(segText, { sourceSection: sec.sourcePath, abilitySlots });
      if (!recs.length && segText.trim()) { // prose only: preserved as a textual change, never dropped
        recs = [{ kind: "effect", changeType: "textual_change", effect: stripMarkup(segText).replace(/\s+/g, " ").slice(0, 1500), ability: null, group: null, slot: null, traits: [], oldValue: "", newValue: "", raw: segText.trim(), lineIndex: 0 }];
      }
      for (const rec of recs) {
        const ch = pushChange({ unit, blockIndex, rec, lineOffset: seg.startLine, owner });
        if (!block.changeIds.includes(ch.changeId)) block.changeIds.push(ch.changeId);
      }
    }
    const statuses = new Set(block.changeIds.map((id) => changes.find((c) => c.changeId === id)));
    const kinds = new Set([...statuses].map((c) => (c.kind === "system" ? "system" : c.entity.status.toLowerCase())));
    block.classification = kinds.size === 1 ? [...kinds][0] : "mixed";
    block.suspectedReferences = blockOwner.suspectedReferences;
  });

  return { schema: PATCH_NOTES_SCHEMA, patchVersion, sourceUrl, parserVersion: PARSER_VERSION, extractorVersion: PATCH_NOTES_EXTRACT_VERSION, extractedAt, changes, blocks, validation: validate({ changes, blocks, duplicateMerges, units }) };
}

/** Accounting + false-ownership measurement. The target is unaccountedBlocks = 0. */
export function validate({ changes, blocks, duplicateMerges = 0, units = [] }) {
  const meaningful = blocks.filter((b) => b.originalSourceText && b.originalSourceText.trim());
  const ignored = blocks.filter((b) => b.classification === "ignored");
  const unaccounted = meaningful.filter((b) => !b.changeIds.length && !b.ignoredReason).map((b) => ({ blockIndex: b.blockIndex, sourcePath: b.sourcePath }));
  const byStatus = (s) => new Set(changes.filter((c) => c.entity && c.entity.status === s).map((c) => c.provenance.sourceBlockIndex)).size;
  const ignoredByReason = {};
  for (const b of ignored) ignoredByReason[b.ignoredReason] = (ignoredByReason[b.ignoredReason] || 0) + 1;
  // false ownership invariants: an entity_heading/explicit_block owner must sit in an entity section
  const falseOwnership = changes.filter((c) => c.entity && c.entity.status === ENTITY_STATUS.EXISTING && (c.ownership.source === OWNERSHIP_SOURCE.ENTITY_HEADING || c.ownership.source === OWNERSHIP_SOURCE.EXPLICIT_BLOCK)
    && NON_ENTITY_CATEGORIES.has((blocks[c.provenance.sourceBlockIndex] || {}).category)).map((c) => ({ changeId: c.changeId, entity: c.entity.name }));
  const incidental = blocks.reduce((n, b) => n + (b.suspectedReferences || []).length, 0);
  return {
    totalBlocks: blocks.length, totalMeaningfulBlocks: meaningful.length,
    entityOwnedBlocks: byStatus(ENTITY_STATUS.EXISTING), systemBlocks: new Set(changes.filter((c) => c.kind === "system").map((c) => c.provenance.sourceBlockIndex)).size,
    newCandidateBlocks: byStatus(ENTITY_STATUS.NEW_CANDIDATE), unmatchedBlocks: byStatus(ENTITY_STATUS.UNMATCHED),
    ignoredBlocks: ignored.length, ignoredByReason,
    droppedBlocks: unaccounted.length, unaccountedBlocks: unaccounted,
    duplicateMerges, lifecycleChanges: changes.filter((c) => c.lifecycle).length,
    totalChanges: changes.length,
    falseOwnership: { count: falseOwnership.length, cases: falseOwnership },
    incidentalMentionsNotOwned: incidental,
  };
}
