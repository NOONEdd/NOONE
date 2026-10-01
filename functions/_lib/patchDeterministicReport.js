// Deterministic Patch Change Report builder -- the module that replaced
// functions/_lib/patchAnalysis.js (per-batch AI execution) and most of
// functions/_lib/patchAggregate.js (cross-batch AI-result merging) in
// the AI-removal rebuild. There is no AI call anywhere in this file, or
// anywhere downstream of it.
//
// Takes functions/_lib/patchPlanner.js's plan (units already split at
// semantic boundaries, Academy entities already detected, deterministic
// facts already extracted -- all of that is UNCHANGED, this file adds
// nothing to detection itself) and builds the final report directly:
//
//   Riot's own before/after notation (patchChangeDetector.js)
//     -> grouped by the single Academy entity each unit's OWN heading
//        names (patchPlanner.js's resolveUnitOwnerEntity -- never
//        guessed onto an ambiguous or wrong entity)
//     -> one championChanges/itemChanges/runeChanges entry per entity,
//        or one systemChanges entry per gate-eligible entity-less unit
//        (an objective/macro/system change -- see patchPlanner.js's
//        RELEVANT_NO_ENTITY_CATEGORIES)
//     -> every entry's FACT fields (whatChanged/previousValue/newValue/
//        sourceRaw/comparisonState/relevance/confidence) are set here;
//        every COACH field (supportImpact, buildImplications, ...) is
//        left blank for a human to fill in via the Admin "edit" action.
//
// A unit whose entity mention couldn't be resolved to exactly one owner
// (an ambiguous heading, or a fact that named no clear subject) is never
// guessed onto an entity's entry -- it goes into `unanalyzedFacts`,
// visible to the Coach, attached to nothing.
//
// Pure functions, no I/O, no AI calls, no randomness.

import { formatFacts, compareItemInfoToPatch, classifyComparisonState, classifyEntityRelevance, classifySystemRelevance, COMPARISON_STATE, RELEVANCE } from "./patchChangeDetector.js";
import { normalizeChangeEntry, normalizeSystemChangeEntry, mergeDuplicateEntities, dedupeByEntity, confidenceForComparisonState } from "./patchIntelligence.js";

export const DETERMINISTIC_REPORT_VERSION = "det-report-v1";

const RAW_EXCERPT_MAX_CHARS = 600;

function truncate(text, max) {
  const t = (text || "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

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
 *  names it yields. `null` when the unit is not part of an explicit
 *  lifecycle section OR yields no names (never claimed in that case --
 *  see the block comment above). */
export function lifecycleNamesForUnit(unit) {
  const path = unit.headingPath || [];
  // Form 1/2: the unit's own heading is the lifecycle heading.
  const own = matchLifecycleTitle(unit.title, path.slice(0, -1));
  if (own) {
    const names = extractLifecycleEntityNames(unit);
    return names.length ? { ...own, names } : null;
  }
  // Form 3: the unit's immediate parent heading is a lifecycle heading,
  // so THIS unit's own title is the entity ("New Champions > Hwei").
  if (path.length >= 2) {
    const parent = matchLifecycleTitle(path[path.length - 2], path.slice(0, -2));
    if (parent && (unit.title || "").trim()) return { ...parent, names: [unit.title.trim()] };
  }
  return null;
}

/** Resolves a lifecycle-section entity NAME against whatever Academy
 *  currently knows (plan.index.entities) by exact case-insensitive name
 *  match -- deliberately not fuzzy: a removed item is very often no
 *  longer in the roster at all (that's the whole point), so "not found"
 *  is an expected, valid, and informative outcome (id: null), not a
 *  failure to paper over with a guess. */
function resolveLifecycleEntity(name, kind, planIndex) {
  const lower = name.trim().toLowerCase();
  const match = (planIndex.entities || []).find((e) => e.type === kind && e.name.trim().toLowerCase() === lower);
  return match ? { id: match.id, name: match.name, inCurrentRoster: true } : { id: null, name, inCurrentRoster: false };
}

function buildLifecycleEntry(entity, action, unit) {
  const verb = action === "removed" ? "Removed" : "Added";
  const rosterNote = entity.inCurrentRoster ? "" : " Not in Academy's currently tracked roster.";
  const whatChanged = `${verb} in this patch, per the "${unit.title}" section.${rosterNote}`;
  const fields = {
    whatChanged, previousValue: "", newValue: "",
    sourceRaw: truncate(unit.text, RAW_EXCERPT_MAX_CHARS),
    comparisonState: action === "removed" ? COMPARISON_STATE.REMOVED : COMPARISON_STATE.ADDED,
    relevance: RELEVANCE.CORE,
    detectionMethod: "deterministic-section",
    confidence: "High", // the SECTION'S claim (this was added/removed) is unambiguous -- confidence is about the fact, not about Academy's own data
    championsAffected: [],
  };
  const entry = normalizeChangeEntry(fields, { withChampionsAffected: true });
  entry.lifecycleAction = action; // not part of normalizeChangeEntry's fixed field list -- attached the same way buildEntityEntry attaches academyDataFlag
  entry.sourceSection = (unit.headingPath || []).join(" > ");
  return entry;
}

/** Builds one championChanges/itemChanges/runeChanges entry for an
 *  entity that had at least one gate-eligible unit resolve to it as sole
 *  owner (see patchPlanner.js's resolveUnitOwnerEntity). `facts` may be
 *  empty -- a real, Riot-confirmed mention with no extractable value
 *  pair (prose-only, e.g. "W now also slows briefly") still gets an
 *  entry, falling back to Riot's own raw text so it's never silently
 *  dropped from the report; that fallback is exactly what makes this
 *  entity VIABLE rather than CORE (see classifyEntityRelevance). */
function buildEntityEntry(entity, { facts, addedOrRemoved, rawTexts }, { itemRosterById }) {
  const formatted = facts.length ? formatFacts(facts) : null;
  let whatChanged, previousValue, newValue, sourceRaw;
  if (formatted) {
    ({ whatChanged, previousValue, newValue } = formatted);
    sourceRaw = facts.map((f) => f.raw).join(" | ");
  } else {
    const excerpt = truncate(rawTexts.join("\n\n"), RAW_EXCERPT_MAX_CHARS);
    whatChanged = excerpt;
    previousValue = "";
    newValue = "";
    sourceRaw = excerpt;
  }
  if (addedOrRemoved) {
    const note = addedOrRemoved.signal === "removed"
      ? "Riot's own notes indicate this may have been removed -- confirm before treating it as gone from the live game."
      : "Riot's own notes indicate this may be newly added.";
    whatChanged = whatChanged ? `${whatChanged}\n\n${note}` : note;
  }

  const hasCleanValuePair = facts.some((f) => f.oldValue && f.newValue);
  const academyFlag = entity.type === "item" ? compareItemInfoToPatch(itemRosterById.get(entity.id), facts) : null;
  const comparisonState = facts.length
    ? classifyComparisonState({ entityType: entity.type, hasCleanValuePair, ambiguous: false, academyFlag })
    : entity.type === "champion" ? COMPARISON_STATE.NOT_COMPARABLE
    : academyFlag ? COMPARISON_STATE.POSSIBLE
    : COMPARISON_STATE.NOT_COMPARABLE;
  const relevance = classifyEntityRelevance({ hasFact: facts.length > 0, hasAddedOrRemoved: Boolean(addedOrRemoved) });
  const confidence = confidenceForComparisonState(comparisonState);

  const fields = { whatChanged, previousValue, newValue, sourceRaw, comparisonState, relevance, detectionMethod: "deterministic", confidence, championsAffected: [] };
  const entry = normalizeChangeEntry(fields, { withChampionsAffected: entity.type !== "champion" });
  if (academyFlag) entry.academyDataFlag = academyFlag;
  return entry;
}

/** Runs the whole deterministic pipeline over an already-built plan
 *  (patchPlanner.planPatchAnalysis's result) and produces the exact same
 *  overall report shape the old AI-driven pipeline did --
 *  supportMetaAnalysis/championChanges/itemChanges/runeChanges/
 *  systemChanges/recommendedTierChanges/unanalyzedFacts/
 *  analysisCoverage -- so functions/_lib/patchIntelPipeline.js and
 *  everything downstream (patchReportsStore.js, the Admin/public UI)
 *  needs no shape change to consume it. Never throws: deterministic
 *  extraction has no external failure mode (no network call, no token
 *  limit, no timeout) -- the only way this whole patch check can fail is
 *  the earlier content FETCH, handled entirely before this function is
 *  ever called (see functions/api/admin/patch-check.js). `entityVerdicts`
 *  is returned alongside the report for callers that want the raw
 *  per-entity coverage list (currently just this module's own tests). */
export function buildDeterministicReport({ plan, itemRoster = [] }) {
  const itemRosterById = new Map(itemRoster.map((it) => [it.id, it]));

  const unitById = new Map();
  const entityKeysByUnit = new Map();
  const factDataByUnit = new Map();
  for (const b of plan.batches || []) {
    for (const u of b.units) unitById.set(u.id, u);
    for (const [uid, keys] of b.entityKeysByUnitId || new Map()) entityKeysByUnit.set(uid, keys);
    for (const [uid, fd] of b.factDataByUnitId || new Map()) factDataByUnit.set(uid, fd);
  }

  // ---- EXPLICIT LIFECYCLE SECTIONS pass -- runs FIRST, and its units
  // are excluded from every pass below. A unit's own heading ("Items
  // Removed") is authoritative over anything patchAcademyDetection.js
  // happened to weakly match inside its body text -- see this file's
  // comment above matchLifecycleSection for the exact bug this closes. ----
  const lifecycleChampionEntries = [];
  const lifecycleItemEntries = [];
  const lifecycleRuneEntries = [];
  const handledUnitIds = new Set();
  for (const [uid, unit] of unitById) {
    const lifecycle = lifecycleNamesForUnit(unit);
    if (!lifecycle) continue; // not a lifecycle section, or yielded no names -- left to normal processing, never claimed
    handledUnitIds.add(uid);
    for (const name of lifecycle.names) {
      const resolved = resolveLifecycleEntity(name, lifecycle.kind, plan.index);
      const entry = buildLifecycleEntry(resolved, lifecycle.action, unit);
      if (lifecycle.kind === "champion") lifecycleChampionEntries.push({ championId: resolved.id, championName: resolved.name, ...entry });
      else if (lifecycle.kind === "item") lifecycleItemEntries.push({ itemId: resolved.id, itemName: resolved.name, ...entry });
      else if (lifecycle.kind === "rune") lifecycleRuneEntries.push({ runeId: resolved.id, runeName: resolved.name, ...entry });
    }
  }

  const factsByEntityKey = new Map();
  const rawTextByEntityKey = new Map();
  const addedOrRemovedByEntityKey = new Map();
  const unattributedFacts = [];
  const systemUnits = [];

  for (const [uid, fd] of factDataByUnit) {
    if (handledUnitIds.has(uid)) continue; // already fully accounted for by the lifecycle pass above
    const keys = entityKeysByUnit.get(uid) || [];
    const unit = unitById.get(uid);
    if (keys.length === 0) {
      systemUnits.push({ unit, fd });
      continue;
    }
    if (fd.ownerEntityKey) {
      if (fd.facts && fd.facts.length) {
        if (!factsByEntityKey.has(fd.ownerEntityKey)) factsByEntityKey.set(fd.ownerEntityKey, []);
        factsByEntityKey.get(fd.ownerEntityKey).push(...fd.facts);
      } else if (unit && unit.text && unit.text.trim()) {
        if (!rawTextByEntityKey.has(fd.ownerEntityKey)) rawTextByEntityKey.set(fd.ownerEntityKey, []);
        rawTextByEntityKey.get(fd.ownerEntityKey).push(unit.text);
      }
      if (fd.addedOrRemoved) addedOrRemovedByEntityKey.set(fd.ownerEntityKey, fd.addedOrRemoved);
    } else {
      // Strongly detected in this unit, but the heading didn't resolve
      // to exactly one owner (patchPlanner.js's resolveUnitOwnerEntity)
      // -- never guessed onto any of the candidates.
      if (fd.facts && fd.facts.length) unattributedFacts.push({ unitId: uid, facts: fd.facts });
    }
  }

  const allEntityKeys = new Set([...factsByEntityKey.keys(), ...rawTextByEntityKey.keys(), ...addedOrRemovedByEntityKey.keys()]);
  const championEntries = [];
  const itemEntries = [];
  const runeEntries = [];

  for (const key of allEntityKeys) {
    const entity = plan.index.byKey.get(key);
    if (!entity) continue;
    const facts = factsByEntityKey.get(key) || [];
    const rawTexts = rawTextByEntityKey.get(key) || [];
    const addedOrRemoved = addedOrRemovedByEntityKey.get(key) || null;
    const entry = buildEntityEntry(entity, { facts, addedOrRemoved, rawTexts }, { itemRosterById });

    if (entity.type === "champion") championEntries.push({ championId: entity.id, championName: entity.name, ...entry });
    else if (entity.type === "item") itemEntries.push({ itemId: entity.id, itemName: entity.name, ...entry });
    else if (entity.type === "rune") runeEntries.push({ runeId: entity.id, runeName: entity.name, ...entry });
  }

  const championChanges = mergeDuplicateEntities([...championEntries, ...lifecycleChampionEntries], "championId", "championName");
  const itemChanges = mergeDuplicateEntities([...itemEntries, ...lifecycleItemEntries], "itemId", "itemName");
  const runeChanges = mergeDuplicateEntities([...runeEntries, ...lifecycleRuneEntries], "runeId", "runeName");

  // ---- systemChanges: one entry per gate-eligible entity-less unit ----
  const systemChanges = systemUnits.map(({ unit, fd }) => {
    const facts = fd.facts || [];
    const formatted = facts.length ? formatFacts(facts) : null;
    const heading = unit.headingPath[unit.headingPath.length - 1] || unit.title || "Other";
    const whatChanged = formatted ? formatted.whatChanged : truncate(unit.text, RAW_EXCERPT_MAX_CHARS);
    const sourceRaw = formatted ? facts.map((f) => f.raw).join(" | ") : truncate(unit.text, RAW_EXCERPT_MAX_CHARS);
    return normalizeSystemChangeEntry({
      area: heading,
      whatChanged,
      sourceRaw,
      relevance: classifySystemRelevance(),
      detectionMethod: "deterministic",
      confidence: formatted ? "Medium" : "Low",
    });
  });

  // recommendedTierChanges is never auto-populated -- an actual change
  // to Academy's tier list is a human Coach decision, made through Coach
  // Mode itself, never inferred from a patch note (see this file's
  // header and functions/api/admin/patch-reports.js's publish comment).
  const recommendedTierChanges = dedupeByEntity([], "entityId", "entityName");

  const totalEntries = championChanges.length + itemChanges.length + runeChanges.length + systemChanges.length;
  const coreCount = [...championChanges, ...itemChanges, ...runeChanges].filter((e) => e.relevance === RELEVANCE.CORE).length;
  const viableCount = [...championChanges, ...itemChanges, ...runeChanges].filter((e) => e.relevance === RELEVANCE.VIABLE).length;
  const supportMetaAnalysis = totalEntries === 0
    ? "No Support-relevant changes were confirmed for any Academy-tracked champion, item, or rune in this patch."
    : `${totalEntries} change${totalEntries === 1 ? "" : "s"} detected: ${coreCount} with a confirmed value change or addition/removal, ${viableCount} mentioned with no extractable value, ${systemChanges.length} system/objective change${systemChanges.length === 1 ? "" : "s"}. Coach review is required before any of this reaches the public report.`;

  const report = {
    supportMetaAnalysis,
    championChanges, itemChanges, runeChanges, systemChanges, recommendedTierChanges,
    unanalyzedFacts: unattributedFacts.map((u) => ({ unitId: u.unitId, facts: u.facts })),
  };

  // ---- coverage + entityVerdicts: 4 honest states, no AI-failure
  // states (detected_unknown/unresolved) -- deterministic extraction has
  // no partial-failure mode, so every detected entity gets a definite
  // answer immediately. changed_not_relevant is kept in the shape for
  // consistency with the pre-existing analysisCoverage contract, but is
  // structurally always 0 here: Academy's own roster already only
  // tracks Support-relevant entities, so nothing this module detects
  // could be judged "changed but not relevant" the way an AI verdict
  // once could. ----
  const stateCounts = { not_detected: 0, detected_no_change: 0, changed_not_relevant: 0, changed_relevant: 0 };
  const entityVerdicts = [];
  const entities = (plan.index.entities || []).map((e) => {
    let state;
    if (!plan.detectedAnywhere.has(e.key)) {
      state = "not_detected";
    } else if (allEntityKeys.has(e.key)) {
      state = "changed_relevant";
    } else {
      state = "detected_no_change";
    }
    stateCounts[state]++;
    entityVerdicts.push({
      key: e.key, type: e.type, id: e.id, name: e.name,
      detected: state !== "not_detected",
      changed: state === "changed_relevant" ? true : state === "detected_no_change" ? false : null,
      supportRelevant: state === "changed_relevant" ? true : state === "detected_no_change" ? false : null,
    });
    return { key: e.key, type: e.type, id: e.id, name: e.name, state };
  });

  const analysisCoverage = {
    version: DETERMINISTIC_REPORT_VERSION,
    complete: true, // deterministic extraction runs over the WHOLE plan in one pass -- always complete, never partial
    totalEntities: entities.length,
    detectedEntities: plan.detectedAnywhere.size,
    states: stateCounts,
    entities,
    gate: { unitsIgnored: plan.stats.ignoredUnits, charsIgnored: plan.stats.ignoredChars },
    entitiesWithDeterministicFacts: factsByEntityKey.size,
    academyDataFlags: [...championEntries, ...itemEntries, ...runeEntries].filter((e) => e.academyDataFlag).map((e) => ({ entityKey: e.championId ? `champion:${e.championId}` : e.itemId ? `item:${e.itemId}` : `rune:${e.runeId}`, ...e.academyDataFlag })),
    addedOrRemovedSignals: [...addedOrRemovedByEntityKey.values()],
    unattributedFacts,
  };

  report.analysisCoverage = analysisCoverage;
  return { report, analysisCoverage, entityVerdicts, complete: true };
}

// Coach fields ONLY -- see normalizeChangeEntry's header comment for the
// fact/coach split. Never includes a fact field (whatChanged, etc.):
// those always come from the run that just re-scanned the patch, never
// from what was there before.
const COACH_FIELDS = [
  "type", "supportImpact", "impactSeverity", "gameplayImplications", "buildImplications",
  "runeImplications", "matchupImplications", "laneImpact", "roamImpact", "teamfightImpact",
  "objectiveVisionImpact", "decisionChange", "coachNotes", "tierListActionNeeded",
  "recommendedTierAction", "reasoning",
];

function mergeEntryArray(freshArr, existingArr, idField) {
  const existingById = new Map((existingArr || []).filter((e) => e[idField]).map((e) => [e[idField], e]));
  return freshArr.map((fresh) => {
    const old = fresh[idField] ? existingById.get(fresh[idField]) : null;
    if (!old) return fresh; // newly detected this run -- nothing to carry forward
    const merged = { ...fresh };
    for (const field of COACH_FIELDS) if (field in old) merged[field] = old[field];
    return merged;
  });
}

/** Re-scanning an already-reviewed patch (functions/api/admin/
 *  patch-check.js's rescan action) must refresh the FACTS from a fresh
 *  deterministic pass without throwing away a Coach's already-written
 *  analysis. For every champion/item/rune entry the fresh pass and the
 *  existing report both have (matched by id), the fresh entry's fact
 *  fields win (whatChanged/previousValue/newValue/sourceRaw/
 *  comparisonState/relevance/confidence/detectionMethod) and the
 *  existing entry's COACH fields are carried forward untouched. An
 *  entity newly detected this run that the existing report didn't have
 *  is added as-is (nothing to carry forward). An entity the existing
 *  report had that this run's fresh pass no longer detects is dropped
 *  -- the source text this run saw doesn't mention it anymore.
 *  systemChanges have no stable per-run identity (no entity id) and are
 *  always taken fresh, with no coach-field carryover; recommendedTierChanges
 *  is untouched (never auto-populated in the first place, see
 *  buildDeterministicReport's own comment) -- carried over from the
 *  existing report exactly as it was, since a rescan is about refreshing
 *  Riot facts, never about touching a Coach's own tier decisions. */
export function mergeFreshOntoExisting(freshReport, existingReport) {
  return {
    ...freshReport,
    championChanges: mergeEntryArray(freshReport.championChanges, existingReport?.championChanges, "championId"),
    itemChanges: mergeEntryArray(freshReport.itemChanges, existingReport?.itemChanges, "itemId"),
    runeChanges: mergeEntryArray(freshReport.runeChanges, existingReport?.runeChanges, "runeId"),
    recommendedTierChanges: existingReport?.recommendedTierChanges || freshReport.recommendedTierChanges,
  };
}
