// Patch Intelligence's AI analysis PRIMITIVES: the analyst prompt rules,
// the JSON schema, and the parse/normalize layer that turns one AI
// response into a report the rest of the app can trust.
//
// This file no longer runs the pipeline itself -- functions/_lib/
// patchIntelPipeline.js is the orchestrator (parse -> plan -> analyze
// every batch -> aggregate), and functions/_lib/patchAnalysis.js is what
// actually calls the AI for one batch, using buildBatchSystemPrompt()
// and BATCH_REPORT_JSON_SCHEMA below. Splitting it this way (rather than
// one file that both defines the prompt AND drives the whole pipeline,
// which was this file's previous shape) avoids a circular import:
// patchAnalysis.js needs the primitives here, and the orchestrator needs
// patchAnalysis.js -- keeping "the prompt/schema/normalize contract" and
// "the pipeline that drives it" in different files means neither has to
// import the other. functions/api/admin/patch-check.js only ever imports
// from patchIntelPipeline.js now; nothing outside this file's own
// directory imports patchIntelligence.js directly except that pipeline
// and patchAnalysis.js, and the regression test that checks
// normalizePatchIntelReport's merge behavior directly.
//
// Reuses functions/_lib/aiProvider.js's callAIProvider() -- the SAME
// provider-agnostic dispatcher functions/api/coach.js uses (called from
// patchAnalysis.js, not here). This file does not know or care whether
// that resolves to Anthropic or an OpenAI-compatible provider; switching
// AI_PROVIDER/AI_BASE_URL/AI_MODEL changes both AI Coach chat AND Patch
// Intelligence analysis together, with no code change here (see
// README's provider-setup section).
//
// Trust hierarchy this module exists to enforce (see the top-level spec
// this feature was built from): official Riot text is the ONLY source
// of "what changed" -- the AI is explicitly instructed never to invent
// a change, and is explicitly told it is an analyst/recommender, not
// the final authority. Nothing this module produces is ever written to
// public Academy data directly; functions/api/admin/patch-reports.js's
// "publish" action is the one and only human-gated bridge, and even
// that only ever touches the patch-number/verification fields, never
// champion/item/rune content (see that file's comment for exactly why).

// The SAME free-text-name -> Academy-entity resolver the rest of the
// site already uses (src/components/BuildBoard.jsx, BuildList.jsx,
// BuildEditor.jsx, ItemRunePicker.jsx for Coach Mode build/rune names;
// src/components/EntityImage.jsx for these reports' own images) --
// see resolveEntityId() below for why Patch Intelligence no longer
// keeps its own copy of this matching logic.
import { findCanonicalId } from "../../src/utils/images.js";
import { SOURCE_TEXT_VERSION } from "./patchText.js";
import { PARSER_VERSION } from "./patchParser.js";
import { PLANNER_VERSION } from "./patchPlanner.js";
import { DETECTOR_VERSION } from "./patchChangeDetector.js";

const SEVERITY_VALUES = ["Low", "Medium", "High"];
const CONFIDENCE_VALUES = ["Low", "Medium", "High"];
const TYPE_VALUES = ["Buff", "Nerf", "Adjustment"];

// Diagnostic marker -- proves, independent of anything the UI shows,
// that a given report/log line was produced by THIS pipeline shape, not
// an older deployed version or a stale cached result. Composed from
// every pipeline stage's own version constant so that changing any ONE
// stage (a new extraction rule in patchText.js, a new splitting rule in
// patchParser.js, a new packing rule in patchPlanner.js, or the batch
// prompt/schema right here) automatically changes the whole engine
// version -- there is no separate number to remember to bump by hand.
// Returned in every result (success AND failure) and threaded through
// to the Cloudflare Function logs and the /api/admin/patch-check
// response, never silently swallowed.
const BATCH_PROMPT_VERSION = "batch-v2";
export const PATCH_INTEL_ENGINE_VERSION = `pipeline-v4+${SOURCE_TEXT_VERSION}+${PARSER_VERSION}+${DETECTOR_VERSION}+${PLANNER_VERSION}+${BATCH_PROMPT_VERSION}`;

const ANALYST_INSTRUCTIONS = `You are the Patch Intelligence analyst for Nyx NOONEdd Academy, a Wild Rift Support coaching site. Your input is ONE EXCERPT of the official Wild Rift patch notes (a large patch is analyzed in several excerpts, each handed to you separately -- see the batch context above this block for which one this is), plus a snapshot of the Academy's current Support-relevant champion/item/rune roster and their CURRENT tiers. Your job is to extract and structure whatever in THIS EXCERPT matters to SUPPORT players -- not to rewrite the patch notes in full, and not to invent anything the text doesn't actually say, and not to assume anything about content that isn't in front of you.

HARD RULES -- follow these strictly:
1. FACTS vs. ANALYSIS -- keep these separate and never blur them. The official patch notes text below is the ONLY source of "what changed" -- every reported change must be traceable to it. "whatChanged"/"previousValue"/"newValue" are FACTS: they describe the actual change, straight from the text. "Support impact," "gameplay/build/rune/matchup implications," and "recommended tier action" are your ANALYSIS, clearly reasoned FROM that fact -- but never invent a change, a number, a mechanic, or a champion/item/rune that isn't actually in the text. If you are not sure something is really in the text, leave it out rather than guessing. Do not infer an old/new value the text doesn't explicitly give you.
2. If the patch notes contain no changes relevant to Support, return empty arrays. A quiet patch producing a short, mostly-empty report is the CORRECT output -- do not manufacture relevance or pad the report to seem thorough.
3. Only report changes that are relevant to Support play.

For items, do NOT determine Support relevance from the item's category alone.
An item categorized as Physical, Magic, Defense, Attack, etc. may still have legitimate situational value for a Support.

Use ALL available Academy item information (name, category, tier, and info) when judging Support relevance.

An Academy-tracked item is not automatically a Core Support item.
Distinguish between:
- Core: commonly and directly relevant to Support builds.
- Viable: a legitimate Support option in meaningful situations.
- Situational: relevant only for specific Support champions, matchups, strategies, or unusual builds.
- None: genuinely irrelevant to Support gameplay.

If a changed item is Academy-tracked and its effect can meaningfully affect a Support build, matchup, strategy, or Support champion, it may be reported as Situational or Viable even if it is not a conventional Support item.
4. ONE ENTRY PER ENTITY -- this is critical. A given champion may appear AT MOST ONCE in championChanges for the whole report, no matter how many of its abilities changed. The same applies to items in itemChanges and runes in runeChanges: at most one entry per item, at most one entry per rune. If Leona's Q, W, and E all changed, that is ONE championChanges entry for Leona, not three. Riot's own patch notes format each ability in its own section -- do NOT mirror that structure into separate entries. Combine every change belonging to the same entity into that one entry's whatChanged/previousValue/newValue, organized with short labels so it stays readable when there are several:
   Passive: ...
   Q: ...
   W: ...
   E: ...
   R: ...
   Base Stats: ...
   Example whatChanged for a champion with two ability changes: "Q: damage 80/120/160/200 -> 90/130/170/210; cooldown 9/8/7/6s -> 8/7/6/5s. W: armor 20/30/40/50 -> 25/35/45/55." Also avoid duplicate entries for the same entity in recommendedTierChanges -- one recommendation per entity, same rule.
5. PRESERVE THE NUMBERS -- do not over-summarize. "Leona was buffed" or "Q was buffed" is NOT an acceptable whatChanged/previousValue/newValue -- that describes a category, not the change. Whenever the patch notes give a number, include it: damage, healing, shielding, cooldown, mana/energy cost, range, duration, percentages, ratios, AD/AP scaling, attack speed, movement speed, health, armor, magic resistance, stack counts, thresholds, charges, level scaling -- whatever the text actually specifies, both the OLD value and the NEW value when both are given. "Concise" means cutting repetition and unnecessary prose, NOT cutting factual numbers to save space -- a patch with many changes needs each entry written more economically, not stripped of its actual values. The "type" field (Buff/Nerf/Adjustment) is a classification, never a substitute for describing what actually changed.
6. Use the Academy roster snapshot below for two things ONLY: (a) judging whether a mentioned champion/item/rune is one Academy actually tracks, and (b) using its ACTUAL CURRENT tier as the "from" side of any recommended tier action -- never guess a current tier that isn't in the snapshot, and never invent a roster entity that isn't listed there.
7. You are an analyst/recommender, not the final authority -- a human coach reviews every report before anything about it goes live, and nothing you output is ever applied automatically. Write reasoning a human can quickly judge and disagree with if needed, not reasoning written to sound maximally confident.
8. impactSeverity and confidence must each be exactly one of "Low", "Medium", "High". type/buffNerfAdjustment must be exactly one of "Buff", "Nerf", "Adjustment". Do not use any other values or casing.
9. Respond with ONLY one JSON object matching the schema below. No markdown code fences, no prose before or after it, no comments inside it, no trailing commas.
10. Write for MAXIMUM USEFUL INFORMATION PER TOKEN, not maximum length -- this report needs to be scannable in a couple of minutes, not exhaustive, but "scannable" is about cutting prose and repetition, never about cutting the actual numbers (see rule 5). Specifically:
   - "supportImpact" and "reasoning": one short, decision-oriented sentence each -- state the conclusion, not the full chain of thought behind it.
   - Every other implications field: a compact phrase, or the literal string "None." if genuinely not applicable -- never restate information already given in another field of the same entry.
11. COVERAGE -- you are given a list of "entities to address" below: Academy champions/items/runes a deterministic scan found mentioned somewhere in YOUR excerpt. For EVERY one of them, add exactly one entry to "entityVerdicts" (in addition to a full championChanges/itemChanges/runeChanges entry if it changed and is Support-relevant): "detected" is normally true (the scan already found it; set false only if you believe the scan matched a name that isn't really about this entity, e.g. a skin title reusing a champion's name), "changed" is true only if the patch text actually describes a change to it, "supportRelevant" is only meaningful when changed is true. This lets a genuinely quiet mention (a champion's name appearing only in a skin list, an item mentioned only as a comparison) be recorded as "seen, nothing changed" instead of just silently absent from the report. Do not add entityVerdicts entries for anything NOT in the "entities to address" list.
12. AUTHORITATIVE DETERMINISTIC FACTS -- for some entities, a deterministic system has ALREADY extracted the exact old/new values straight from the patch text before this excerpt ever reached you (see "--- Deterministic facts already established ---" below, when present). Those facts are authoritative and FINAL -- you are not responsible for rediscovering them, must never contradict them, and may leave that entity's whatChanged/previousValue/newValue as empty strings once the given facts already cover the numeric change; put your effort into supportImpact/gameplayImplications/buildImplications/etc for that entity instead. If the entity ALSO has a genuinely separate prose-only change the given facts don't cover (e.g. "Q now also slows briefly" alongside a numeric cooldown change already given), you may add that to whatChanged, but never restate or alter a number already supplied. An entity that is NOT listed there has no deterministic facts at all -- write whatChanged/previousValue/newValue yourself from the excerpt, exactly as you always have.

JSON SCHEMA (every field required; use empty string/array when a field genuinely doesn't apply, never omit the key):
{
  "supportMetaAnalysis": string (2-4 sentences: what THIS EXCERPT means for Support play, or "No Support-relevant changes in this excerpt." if that's genuinely true),
  "championChanges": [ { "championName": string, "whatChanged": string, "previousValue": string, "newValue": string, "type": "Buff"|"Nerf"|"Adjustment", "supportImpact": string, "impactSeverity": "Low"|"Medium"|"High", "gameplayImplications": string, "buildImplications": string, "runeImplications": string, "matchupImplications": string, "tierListActionNeeded": boolean, "recommendedTierAction": string (e.g. "S -> A", or "No change"), "reasoning": string, "confidence": "Low"|"Medium"|"High" } ],
  "itemChanges": [ { "itemName": string, "whatChanged": string, "previousValue": string, "newValue": string, "type": "Buff"|"Nerf"|"Adjustment", "supportImpact": string, "impactSeverity": "Low"|"Medium"|"High", "championsAffected": string[], "gameplayImplications": string, "buildImplications": string, "runeImplications": string, "matchupImplications": string, "tierListActionNeeded": boolean, "recommendedTierAction": string, "reasoning": string, "confidence": "Low"|"Medium"|"High" } ],
  "runeChanges": [ { "runeName": string, "whatChanged": string, "previousValue": string, "newValue": string, "type": "Buff"|"Nerf"|"Adjustment", "supportImpact": string, "impactSeverity": "Low"|"Medium"|"High", "championsAffected": string[], "gameplayImplications": string, "buildImplications": string, "runeImplications": string, "matchupImplications": string, "tierListActionNeeded": boolean, "recommendedTierAction": string, "reasoning": string, "confidence": "Low"|"Medium"|"High" } ],
  "systemChanges": [ { "area": string (one of "Roaming","Vision","Laning","Peel","Engage","Scaling","Teamfight","Summoner Spells","Objectives","Other"), "whatChanged": string, "supportImpact": string, "impactSeverity": "Low"|"Medium"|"High", "championsAffected": string[], "gameplayImplications": string, "reasoning": string, "confidence": "Low"|"Medium"|"High" } ],
  "recommendedTierChanges": [ { "entityType": "champion"|"item"|"rune", "entityName": string, "from": string, "to": string, "reasoning": string, "confidence": "Low"|"Medium"|"High" } ],
  "entityVerdicts": [ { "name": string (must exactly match one "entities to address" name), "detected": boolean, "changed": boolean, "supportRelevant": boolean } ]
}`;

// JSON-Schema mirror of the prose schema above, for providers that
// support native structured output (see providers/anthropic.js's forced
// tool-use, providers/openaiCompatible.js's response_format). Kept as
// data alongside the prose description rather than generated from it --
// the two are simple enough to keep in sync by hand, and a hand-written
// schema is easier to verify against the Anthropic tool-use contract
// (root must be type:"object") than a generated one.
const SEVERITY_SCHEMA = { type: "string", enum: SEVERITY_VALUES };
const CONFIDENCE_SCHEMA = { type: "string", enum: CONFIDENCE_VALUES };
const TYPE_SCHEMA = { type: "string", enum: TYPE_VALUES };

const CHANGE_ENTRY_BASE_PROPERTIES = {
  whatChanged: { type: "string" },
  previousValue: { type: "string" },
  newValue: { type: "string" },
  type: TYPE_SCHEMA,
  supportImpact: { type: "string" },
  impactSeverity: SEVERITY_SCHEMA,
  gameplayImplications: { type: "string" },
  buildImplications: { type: "string" },
  runeImplications: { type: "string" },
  matchupImplications: { type: "string" },
  tierListActionNeeded: { type: "boolean" },
  recommendedTierAction: { type: "string" },
  reasoning: { type: "string" },
  confidence: CONFIDENCE_SCHEMA,
};
const CHANGE_ENTRY_BASE_REQUIRED = Object.keys(CHANGE_ENTRY_BASE_PROPERTIES);

function changeEntrySchema(nameField, withChampionsAffected) {
  const properties = { [nameField]: { type: "string" }, ...CHANGE_ENTRY_BASE_PROPERTIES };
  const required = [nameField, ...CHANGE_ENTRY_BASE_REQUIRED];
  if (withChampionsAffected) {
    properties.championsAffected = { type: "array", items: { type: "string" } };
    required.push("championsAffected");
  }
  return { type: "object", properties, required };
}

const SYSTEM_CHANGE_SCHEMA = {
  type: "object",
  properties: {
    area: { type: "string" },
    whatChanged: { type: "string" },
    supportImpact: { type: "string" },
    impactSeverity: SEVERITY_SCHEMA,
    championsAffected: { type: "array", items: { type: "string" } },
    gameplayImplications: { type: "string" },
    reasoning: { type: "string" },
    confidence: CONFIDENCE_SCHEMA,
  },
  required: ["area", "whatChanged", "supportImpact", "impactSeverity", "championsAffected", "gameplayImplications", "reasoning", "confidence"],
};

const RECOMMENDED_TIER_CHANGE_SCHEMA = {
  type: "object",
  properties: {
    entityType: { type: "string", enum: ["champion", "item", "rune"] },
    entityName: { type: "string" },
    from: { type: "string" },
    to: { type: "string" },
    reasoning: { type: "string" },
    confidence: CONFIDENCE_SCHEMA,
  },
  required: ["entityType", "entityName", "from", "to", "reasoning", "confidence"],
};

const ENTITY_VERDICT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    detected: { type: "boolean" },
    changed: { type: "boolean" },
    supportRelevant: { type: "boolean" },
  },
  required: ["name", "detected", "changed", "supportRelevant"],
};

const REPORT_JSON_SCHEMA = {
  type: "object",
  properties: {
    supportMetaAnalysis: { type: "string" },
    championChanges: { type: "array", items: changeEntrySchema("championName", false) },
    itemChanges: { type: "array", items: changeEntrySchema("itemName", true) },
    runeChanges: { type: "array", items: changeEntrySchema("runeName", true) },
    systemChanges: { type: "array", items: SYSTEM_CHANGE_SCHEMA },
    recommendedTierChanges: { type: "array", items: RECOMMENDED_TIER_CHANGE_SCHEMA },
  },
  required: ["supportMetaAnalysis", "championChanges", "itemChanges", "runeChanges", "systemChanges", "recommendedTierChanges"],
};

// Per-batch schema: everything REPORT_JSON_SCHEMA has, plus the
// entityVerdicts coverage array (see ANALYST_INSTRUCTIONS rule 11).
// REQUIRED for providers with real schema enforcement (Anthropic's
// forced tool-use validates server-side, so a real call is genuinely
// forced to fill this in) -- but normalizeEntityVerdicts() below is
// still defensive about a missing/malformed array regardless, both for
// providers that don't enforce `required` (OpenAI-compatible's
// response_format is "valid JSON", not schema-checked) and so an older
// or hand-built response never hard-fails analysis just for omitting a
// field that only feeds the coverage manifest, never the report itself.
export const BATCH_REPORT_JSON_SCHEMA = {
  type: "object",
  properties: { ...REPORT_JSON_SCHEMA.properties, entityVerdicts: { type: "array", items: ENTITY_VERDICT_SCHEMA } },
  required: [...REPORT_JSON_SCHEMA.required, "entityVerdicts"],
};

export function formatRosterSnapshot(championRoster, itemRoster, runeRoster) {
  const champLines = championRoster.map((c) => `${c.id}|${c.name}|${c.role}|tier:${c.tier}`).join("\n");
 const itemLines = itemRoster.map((i) =>
  `${i.id}|${i.name}|${i.category}|tier:${i.tier}|info:${i.info || ""}`
).join("\n");
  const runeLines = runeRoster.map((r) => `${r.id}|${r.name}|${r.path}|tier:${r.tier}|info:${r.info || ""}`).join("\n");
  return `--- Academy champion roster (id|name|role|current tier) ---\n${champLines}\n\n--- Academy item roster (id|name|category|current tier|info) ---\n${itemLines}\n\n--- Academy rune roster (id|name|path|current tier|info) ---\n${runeLines}`;
}

/** Builds ONE batch's full system prompt: the analyst rules, this
 *  batch's position in the whole patch, the excerpt itself, the
 *  Academy roster NARROWED to this batch's own detected entities (see
 *  patchAnalysis.js's getBatchRosters -- correctly matching on each
 *  entity's `key` since the 2026-09-23 refactor; sending the full
 *  Academy-wide roster on every batch was the exact fixed-overhead
 *  multiplication the token-budget work below was built to remove, and
 *  a batch's analyst only ever needs (a) confirmation an entity is
 *  Academy-tracked -- already established by "entities to address"
 *  below, independent of the roster snapshot -- and (b) that entity's
 *  own current tier/info, which the narrowed snapshot still carries in
 *  full), the explicit "entities to address" list rule 11 requires a
 *  verdict for, and -- new in the same refactor -- any deterministic
 *  facts already established for this batch's entities (see rule 12
 *  above and patchChangeDetector.js), so the analyst is told what's
 *  already known rather than asked to re-derive it. */
export function buildBatchSystemPrompt({ batchIndex, batchTotal, patchTitle, patchIntro, batchText, forcedEntities, championRoster, itemRoster, runeRoster, deterministicFacts }) {
  const rosterSnapshot = formatRosterSnapshot(championRoster, itemRoster, runeRoster);
  const entityList = (forcedEntities || []).map((e) => `${e.name} (${e.type})`).join("\n") || "(none detected in this excerpt)";
  const factsBlock = formatDeterministicFactsBlock(deterministicFacts, forcedEntities);
  const batchContext = `--- Batch context ---\nThis is excerpt ${batchIndex} of ${batchTotal} from patch "${patchTitle || "(untitled)"}". You can see ONLY the excerpt below -- other excerpts cover the rest of the patch and are analyzed separately, then combined deterministically (not by you). Do not assume something didn't change in the patch overall just because it isn't in this excerpt; only report on what IS in front of you.\n${patchIntro ? `\nPatch intro (context only, already covered by its own excerpt if relevant): ${patchIntro.slice(0, 600)}\n` : ""}\n--- Entities to address in entityVerdicts (found by a deterministic scan of THIS excerpt) ---\n${entityList}${factsBlock}`;
  return `${ANALYST_INSTRUCTIONS}\n\n${batchContext}\n\n${rosterSnapshot}\n\n--- Official Wild Rift patch notes excerpt (the ONLY source of "what changed" in this batch -- analyze this) ---\n${batchText}`;
}

/** Renders the "--- Deterministic facts already established ---" block
 *  rule 12 refers to, one line per entity that has any -- entities with
 *  none are simply absent from this block (rule 12 already covers that
 *  case: "not listed there" means "figure it out yourself, as before").
 *  Returns "" (no block at all) when there's nothing to show, so a
 *  batch with no deterministic facts renders an identical prompt to
 *  before this feature existed. */
function formatDeterministicFactsBlock(deterministicFacts, forcedEntities) {
  if (!deterministicFacts || deterministicFacts.size === 0) return "";
  const nameByKey = new Map((forcedEntities || []).map((e) => [e.key, e.name]));
  const lines = [];
  for (const [key, facts] of deterministicFacts) {
    const name = nameByKey.get(key) || key;
    lines.push(`${name}: ${facts.whatChanged}`);
  }
  if (!lines.length) return "";
  return `\n\n--- Deterministic facts already established (see HARD RULE 12 -- authoritative, do not rediscover or contradict) ---\n${lines.join("\n")}`;
}

/** Deterministic, bounded extraction of the first complete top-level
 *  JSON object from a string that may have stray text around it (a
 *  model occasionally adding a short preamble or trailing remark
 *  despite being told not to -- this happens even with the fence check
 *  above, since there's no fence to strip if the wrapping is just plain
 *  prose). Walks the string tracking brace depth AND whether we're
 *  inside a JSON string literal, so a "{" or "}" that's part of a text
 *  field's actual content (e.g. reasoning mentioning "the {50} shield")
 *  never confuses the depth count. Stops at the FIRST balanced object.
 *
 *  Deliberately NOT "match anything between the outermost braces" --
 *  that would happily accept a truncated or malformed fragment as if it
 *  were complete. This only ever returns a substring whose braces are
 *  genuinely balanced from the scanner's own count, so truncated JSON
 *  (depth never returns to 0) correctly yields null here, same as
 *  malformed JSON (yields a substring that then fails JSON.parse). Both
 *  are still rejected, never guessed at or repaired. */
function extractFirstJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null; // depth never returned to 0 -- unbalanced, i.e. truncated
}

/** Layered parse, cheapest/strictest first -- stops at the first
 *  strategy that produces valid JSON:
 *   1. raw            the whole trimmed reply, as-is. Covers native
 *                      structured output (already clean JSON) and any
 *                      provider that just followed instructions exactly.
 *   2. fenced          the entire trimmed reply is exactly one markdown
 *                      code fence wrapping JSON.
 *   3. bounded-extraction   a brace-balanced scan (extractFirstJsonObject
 *                      above) for the first complete JSON object
 *                      anywhere in the text -- covers a stray preamble
 *                      or trailing remark around otherwise-valid JSON.
 *  Genuinely truncated or malformed JSON fails every strategy (that's
 *  the correct, intentional outcome -- see extractFirstJsonObject's
 *  comment). Returns { parsed, strategy } on success, null if every
 *  strategy failed -- the caller treats null as a hard failure, never a
 *  reason to guess at a repair. */
export function parseAIJson(rawReply) {
  const trimmed = (rawReply || "").trim();

  try {
    return { parsed: JSON.parse(trimmed), strategy: "raw" };
  } catch {
    // fall through
  }

  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenceMatch) {
    try {
      return { parsed: JSON.parse(fenceMatch[1].trim()), strategy: "fenced" };
    } catch {
      // fall through -- an opening fence with something unparseable inside is still worth the bounded-extraction attempt below
    }
  }

  const extracted = extractFirstJsonObject(trimmed);
  if (extracted) {
    try {
      return { parsed: JSON.parse(extracted), strategy: "bounded-extraction" };
    } catch {
      // fall through to final failure
    }
  }

  return null;
}

function enumOrDefault(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function str(value) {
  return typeof value === "string" ? value : "";
}

function strArray(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
}

/** Resolves a free-text name from the AI's output back to a real Academy
 *  id, so the frontend/report never has to trust the model's spelling
 *  or guesswork about ids it was never actually given (the prompt above
 *  only hands it id|name pairs for CONTEXT, not asks it to invent ids).
 *
 *  Delegates entirely to src/utils/images.js's findCanonicalId() -- this
 *  file used to hand-roll its own copy of that exact matching logic
 *  (including its own apostrophe-style normalization for the common
 *  case of the AI rendering "Mikael's Blessing" with a curly quote
 *  against a roster entry that spells it with a straight one). That was
 *  precisely the kind of second, drift-prone resolver this project's
 *  image architecture is meant to avoid -- findCanonicalId() now carries
 *  that same apostrophe-insensitivity for every caller (Coach Mode's
 *  build/rune tools included), not just this one, so there's exactly one
 *  place that logic can ever need fixing again.
 *
 *  The one thing this wrapper adds on top of findCanonicalId(): that
 *  function always returns SOMETHING, falling back to a bare slugify
 *  guess when nothing in the list matches (its other callers build a
 *  display id either way). A report's championId/itemId/runeId needs a
 *  stricter contract -- null, not a guess, when nothing in Academy's own
 *  roster actually matches -- so a mentioned-but-untracked name resolves
 *  to nothing rather than to a plausible-looking but fabricated id.
 *  Checking the result against the real roster is what enforces that.
 *  The raw name the AI gave is always preserved separately regardless
 *  (itemName/championName/runeName below), so a failed match never
 *  loses information -- see src/components/EntityImage.jsx, which
 *  re-resolves from that same name independently at render time rather
 *  than trusting this value forever, so a report is never permanently
 *  stuck showing the fallback icon just because resolution happened to
 *  miss once at generation time. */
function resolveEntityId(name, roster) {
  if (!name) return null;
  const id = findCanonicalId(name, roster);
  return roster.some((entity) => entity.id === id) ? id : null;
}

function normalizeChangeEntry(entry, { withChampionsAffected }) {
  const base = {
    whatChanged: str(entry.whatChanged),
    previousValue: str(entry.previousValue),
    newValue: str(entry.newValue),
    type: enumOrDefault(entry.type, TYPE_VALUES, "Adjustment"),
    supportImpact: str(entry.supportImpact),
    impactSeverity: enumOrDefault(entry.impactSeverity, SEVERITY_VALUES, "Medium"),
    gameplayImplications: str(entry.gameplayImplications),
    buildImplications: str(entry.buildImplications),
    runeImplications: str(entry.runeImplications),
    matchupImplications: str(entry.matchupImplications),
    tierListActionNeeded: Boolean(entry.tierListActionNeeded),
    recommendedTierAction: str(entry.recommendedTierAction) || "No change",
    reasoning: str(entry.reasoning),
    confidence: enumOrDefault(entry.confidence, CONFIDENCE_VALUES, "Medium"),
  };
  if (withChampionsAffected) base.championsAffected = strArray(entry.championsAffected);
  return base;
}

/** Safety net for ANALYST_INSTRUCTIONS' "one entry per entity" rule --
 *  even with an explicit instruction, a model can still occasionally
 *  split one entity's changes across multiple entries (e.g. mirroring
 *  the patch notes' own per-ability section structure). This
 *  deterministically merges any entries that resolved to the SAME id
 *  (or, if id resolution failed for both, the same normalized name) --
 *  it never asks the AI to retry, it just combines what's already
 *  there. First-seen order and position are kept; whatChanged/
 *  previousValue/newValue from every merged entry are concatenated so
 *  no factual detail from either entry is lost (this is the one thing
 *  that must never be silently dropped -- see HARD RULE 5); every other
 *  field keeps the first entry's value, and championsAffected (items/
 *  runes only) is unioned rather than overwritten. */
export function mergeDuplicateEntities(entries, idField, nameField) {
  const merged = [];
  const indexByKey = new Map();
  const join = (a, b) => [a, b].map((s) => (s || "").trim()).filter(Boolean).join(" ");

  for (const entry of entries) {
    const key = entry[idField] || `name:${(entry[nameField] || "").trim().toLowerCase()}`;
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push(entry);
      continue;
    }
    const existing = merged[existingIndex];
    merged[existingIndex] = {
      ...existing,
      whatChanged: join(existing.whatChanged, entry.whatChanged),
      previousValue: join(existing.previousValue, entry.previousValue),
      newValue: join(existing.newValue, entry.newValue),
      ...(existing.championsAffected
        ? { championsAffected: [...new Set([...existing.championsAffected, ...(entry.championsAffected || [])])] }
        : {}),
    };
  }
  return merged;
}

/** Same "one entry per entity" rule applied to recommendedTierChanges --
 *  that shape has no whatChanged/previousValue/newValue to concatenate
 *  (just from/to/reasoning), so a duplicate recommendation for the same
 *  entity is simply dropped (first one kept) rather than merged. */
export function dedupeByEntity(entries, idField, nameField) {
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    const key = entry[idField] || `name:${(entry[nameField] || "").trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

/** Validates and normalizes the AI's raw JSON into a shape the rest of
 *  the app can trust: every enum clamped to its allowed set, every
 *  array actually an array, every id cross-checked against the real
 *  roster instead of taken on faith -- so a slightly malformed or
 *  creatively-worded AI response degrades gracefully (missing/default
 *  fields) instead of breaking report storage or the review UI. Returns
 *  null if the top-level parse doesn't even resemble the schema (e.g.
 *  the model returned prose instead of JSON) -- that's the one case the
 *  caller treats as a hard failure rather than a best-effort repair. */
export function normalizePatchIntelReport(raw, { championRoster, itemRoster, runeRoster }) {
  if (!raw || typeof raw !== "object") return null;

  const championChanges = Array.isArray(raw.championChanges) ? raw.championChanges : [];
  const itemChanges = Array.isArray(raw.itemChanges) ? raw.itemChanges : [];
  const runeChanges = Array.isArray(raw.runeChanges) ? raw.runeChanges : [];
  const systemChanges = Array.isArray(raw.systemChanges) ? raw.systemChanges : [];
  const recommendedTierChanges = Array.isArray(raw.recommendedTierChanges) ? raw.recommendedTierChanges : [];

  return {
    supportMetaAnalysis: str(raw.supportMetaAnalysis),
    championChanges: mergeDuplicateEntities(championChanges.map((e) => ({
      championName: str(e.championName),
      championId: resolveEntityId(e.championName, championRoster),
      ...normalizeChangeEntry(e, { withChampionsAffected: false }),
    })), "championId", "championName"),
    itemChanges: mergeDuplicateEntities(itemChanges.map((e) => ({
      itemName: str(e.itemName),
      itemId: resolveEntityId(e.itemName, itemRoster),
      ...normalizeChangeEntry(e, { withChampionsAffected: true }),
    })), "itemId", "itemName"),
    runeChanges: mergeDuplicateEntities(runeChanges.map((e) => ({
      runeName: str(e.runeName),
      runeId: resolveEntityId(e.runeName, runeRoster),
      ...normalizeChangeEntry(e, { withChampionsAffected: true }),
    })), "runeId", "runeName"),
    systemChanges: systemChanges.map((e) => ({
      area: str(e.area) || "Other",
      whatChanged: str(e.whatChanged),
      supportImpact: str(e.supportImpact),
      impactSeverity: enumOrDefault(e.impactSeverity, SEVERITY_VALUES, "Medium"),
      championsAffected: strArray(e.championsAffected),
      gameplayImplications: str(e.gameplayImplications),
      reasoning: str(e.reasoning),
      confidence: enumOrDefault(e.confidence, CONFIDENCE_VALUES, "Medium"),
    })),
    recommendedTierChanges: dedupeByEntity(recommendedTierChanges.map((e) => {
      const entityType = enumOrDefault(e.entityType, ["champion", "item", "rune"], "champion");
      const roster = entityType === "item" ? itemRoster : entityType === "rune" ? runeRoster : championRoster;
      return {
        entityType,
        entityName: str(e.entityName),
        entityId: resolveEntityId(e.entityName, roster),
        from: str(e.from),
        to: str(e.to),
        reasoning: str(e.reasoning),
        confidence: enumOrDefault(e.confidence, CONFIDENCE_VALUES, "Medium"),
      };
    }), "entityId", "entityName"),
  };
}

/** Normalizes the AI's entityVerdicts array against THIS batch's own
 *  forced entity list (see ANALYST_INSTRUCTIONS rule 11): matches each
 *  verdict to a forced entity by exact name, and for anything the AI
 *  omitted entirely, records it honestly as "detected [by the
 *  deterministic scan], no AI verdict" (changed/supportRelevant: null)
 *  rather than assuming either answer -- the coverage manifest
 *  (patchAggregate.js) is what turns null into a visible, honest gap
 *  instead of a silently-assumed "nothing happened." An entry whose
 *  name doesn't match anything on the forced list is dropped: the
 *  prompt tells the model never to invent one, and an unmatched name
 *  isn't attributable to a real planned entity anyway. */
export function normalizeEntityVerdicts(raw, forcedEntities) {
  const byName = new Map((forcedEntities || []).map((e) => [e.name.trim().toLowerCase(), e]));
  const seen = new Set();
  const verdicts = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    if (!v || typeof v !== "object") continue;
    const entity = byName.get(str(v.name).trim().toLowerCase());
    if (!entity || seen.has(entity.key)) continue;
    seen.add(entity.key);
    verdicts.push({
      key: entity.key,
      type: entity.type,
      id: entity.id,
      name: entity.name,
      detected: typeof v.detected === "boolean" ? v.detected : true,
      changed: typeof v.changed === "boolean" ? v.changed : null,
      supportRelevant: typeof v.supportRelevant === "boolean" ? v.supportRelevant : null,
    });
  }
  for (const entity of forcedEntities || []) {
    if (seen.has(entity.key)) continue;
    verdicts.push({ key: entity.key, type: entity.type, id: entity.id, name: entity.name, detected: true, changed: null, supportRelevant: null });
  }
  return verdicts;
}
