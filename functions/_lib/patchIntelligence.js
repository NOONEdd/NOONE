// Patch Intelligence's AI analysis step. Turns one fetched official
// patch page (functions/_lib/riotFallback.js's fetchAndCacheFullPatchContent)
// into a structured, Support-focused report -- called ONLY from
// functions/api/admin/patch-check.js, and ONLY after a genuinely new
// patch has already been detected there (see that file for the
// dedup/no-new-patch short-circuit; this module never runs speculatively).
//
// Reuses functions/_lib/aiProvider.js's callAIProvider() -- the SAME
// provider-agnostic dispatcher functions/api/coach.js uses. This file
// does not know or care whether that resolves to Anthropic or an
// OpenAI-compatible provider; switching AI_PROVIDER/AI_BASE_URL/AI_MODEL
// changes both AI Coach chat AND Patch Intelligence analysis together,
// with no code change here (see README's provider-setup section).
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

import { PATCH_INTEL_MAX_TOKENS } from "./config.js";
import { callAIProvider } from "./aiProvider.js";
// The SAME free-text-name -> Academy-entity resolver the rest of the
// site already uses (src/components/BuildBoard.jsx, BuildList.jsx,
// BuildEditor.jsx, ItemRunePicker.jsx for Coach Mode build/rune names;
// src/components/EntityImage.jsx for these reports' own images) --
// see resolveEntityId() below for why Patch Intelligence no longer
// keeps its own copy of this matching logic.
import { findCanonicalId } from "../../src/utils/images.js";

const SEVERITY_VALUES = ["Low", "Medium", "High"];
const CONFIDENCE_VALUES = ["Low", "Medium", "High"];
const TYPE_VALUES = ["Buff", "Nerf", "Adjustment"];

// TEMPORARY diagnostic marker -- proves, independent of anything the UI
// shows, that a given report/log line was produced by THIS analysis
// code, not an older deployed version or a stale cached result. Bumped
// whenever runPatchIntelAnalysis's actual behavior changes; returned in
// every result (success AND failure) and threaded through to the
// Cloudflare Function logs and the /api/admin/patch-check response
// (functions/api/admin/patch-check.js), never silently swallowed.
// Remove once Re-analyze's correctness is no longer in question.
export const PATCH_INTEL_ENGINE_VERSION = "reanalyze-v2";

const ANALYST_INSTRUCTIONS = `You are the Patch Intelligence analyst for Nyx NOONEdd Academy, a Wild Rift Support coaching site. Your only input is the official Wild Rift patch notes text provided below, plus a snapshot of the Academy's current Support-relevant champion/item/rune roster and their CURRENT tiers. Your job is to extract and structure whatever in this specific patch matters to SUPPORT players -- not to rewrite the patch notes in full, and not to invent anything the patch notes don't actually say.

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

JSON SCHEMA (every field required; use empty string/array when a field genuinely doesn't apply, never omit the key):
{
  "supportMetaAnalysis": string (2-4 sentences: what this patch means for Support play overall, or "No Support-relevant changes in this patch." if that's genuinely true),
  "championChanges": [ { "championName": string, "whatChanged": string, "previousValue": string, "newValue": string, "type": "Buff"|"Nerf"|"Adjustment", "supportImpact": string, "impactSeverity": "Low"|"Medium"|"High", "gameplayImplications": string, "buildImplications": string, "runeImplications": string, "matchupImplications": string, "tierListActionNeeded": boolean, "recommendedTierAction": string (e.g. "S -> A", or "No change"), "reasoning": string, "confidence": "Low"|"Medium"|"High" } ],
  "itemChanges": [ { "itemName": string, "whatChanged": string, "previousValue": string, "newValue": string, "type": "Buff"|"Nerf"|"Adjustment", "supportImpact": string, "impactSeverity": "Low"|"Medium"|"High", "championsAffected": string[], "gameplayImplications": string, "buildImplications": string, "runeImplications": string, "matchupImplications": string, "tierListActionNeeded": boolean, "recommendedTierAction": string, "reasoning": string, "confidence": "Low"|"Medium"|"High" } ],
  "runeChanges": [ { "runeName": string, "whatChanged": string, "previousValue": string, "newValue": string, "type": "Buff"|"Nerf"|"Adjustment", "supportImpact": string, "impactSeverity": "Low"|"Medium"|"High", "championsAffected": string[], "gameplayImplications": string, "buildImplications": string, "runeImplications": string, "matchupImplications": string, "tierListActionNeeded": boolean, "recommendedTierAction": string, "reasoning": string, "confidence": "Low"|"Medium"|"High" } ],
  "systemChanges": [ { "area": string (one of "Roaming","Vision","Laning","Peel","Engage","Scaling","Teamfight","Summoner Spells","Objectives","Other"), "whatChanged": string, "supportImpact": string, "impactSeverity": "Low"|"Medium"|"High", "championsAffected": string[], "gameplayImplications": string, "reasoning": string, "confidence": "Low"|"Medium"|"High" } ],
  "recommendedTierChanges": [ { "entityType": "champion"|"item"|"rune", "entityName": string, "from": string, "to": string, "reasoning": string, "confidence": "Low"|"Medium"|"High" } ]
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

function formatRosterSnapshot(championRoster, itemRoster, runeRoster) {
  const champLines = championRoster.map((c) => `${c.id}|${c.name}|${c.role}|tier:${c.tier}`).join("\n");
 const itemLines = itemRoster.map((i) =>
  `${i.id}|${i.name}|${i.category}|tier:${i.tier}|info:${i.info || ""}`
).join("\n");
  const runeLines = runeRoster.map((r) => `${r.id}|${r.name}|${r.path}|tier:${r.tier}|info:${r.info || ""}`).join("\n");
  return `--- Academy champion roster (id|name|role|current tier) ---\n${champLines}\n\n--- Academy item roster (id|name|category|current tier|info) ---\n${itemLines}\n\n--- Academy rune roster (id|name|path|current tier|info) ---\n${runeLines}`;
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
function parseAIJson(rawReply) {
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
function mergeDuplicateEntities(entries, idField, nameField) {
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
function dedupeByEntity(entries, idField, nameField) {
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

/**
 * Runs the full analysis: builds the analyst prompt from the fetched
 * patch text + Academy roster snapshot, calls the active AI provider
 * (requesting native structured output when the provider supports it --
 * see aiProvider.js) with maxTokens ALWAYS SET TO THE FIXED
 * PATCH_INTEL_MAX_TOKENS CEILING -- no per-patch estimate, no heuristic
 * derived from mentioned-entity count or patch-content length. This
 * file previously computed an adaptive per-patch budget
 * (estimatePatchIntelTokenBudget(), clamped between a MIN floor and the
 * MAX ceiling) specifically to avoid "wasting" budget on a quiet patch
 * -- but an estimate that runs LOW is exactly the failure mode that
 * caused real truncated reports in production (stop_reason
 * "max_tokens" well below the hard ceiling), so the estimator is gone,
 * not tuned. A quiet patch still naturally produces a short response
 * and costs about the same regardless of the requested ceiling; a
 * heavy patch can now use as much of that ceiling as it actually needs
 * every time, not just when an estimate happened to guess high enough.
 * functions/_lib/aiProvider.js and the AI Coach chat path at
 * functions/api/coach.js are untouched by this -- coach.js still passes
 * its own separate, fixed MAX_TOKENS constant (config.js), same as
 * always; this function has always been the only caller that ever
 * touched PATCH_INTEL_MAX_TOKENS, and still is.
 *
 * Returns one of:
 *   { ok: true, report: {...normalized fields above...}, parseStrategy, maxTokens }
 *   { ok: false, code: "ai_error" | "truncated_output" | "ai_invalid_output", error, logDetail, maxTokens }
 * Never throws. Never called with fabricated patch content -- the
 * caller (functions/api/admin/patch-check.js) only invokes this after a
 * successful official-source fetch; a failed fetch produces a
 * "source_unavailable" report WITHOUT ever reaching this function, per
 * the trust-hierarchy rule that the AI never runs without real source
 * text to analyze.
 */
export async function runPatchIntelAnalysis({ env, patchContent, championRoster, itemRoster, runeRoster }) {
  const rosterSnapshot = formatRosterSnapshot(championRoster, itemRoster, runeRoster);
  const systemPrompt = `${ANALYST_INSTRUCTIONS}\n\n${rosterSnapshot}\n\n--- Official Wild Rift patch notes (the ONLY source of "what changed" -- analyze this) ---\n${patchContent}`;

  const result = await callAIProvider({
    env,
    systemPrompt,
    messages: [{ role: "user", content: "Analyze this patch now and return ONLY the JSON object described in your instructions." }],
    maxTokens: PATCH_INTEL_MAX_TOKENS,
    jsonSchema: REPORT_JSON_SCHEMA,
  });

  if (!result.ok) {
    return {
      ok: false,
      code: result.code === "truncated_output" ? "truncated_output" : "ai_error",
      error: result.error,
      logDetail: result.logDetail,
      maxTokens: PATCH_INTEL_MAX_TOKENS,
      engineVersion: PATCH_INTEL_ENGINE_VERSION,
    };
  }

  // Checked BEFORE attempting to parse -- a truncated reply is
  // deterministically not valid JSON (it was cut off mid-object), so
  // there's no point running it through the parser just to get a
  // confusing generic "invalid JSON" error; this gives a specific,
  // actionable one instead. Since every request already uses the fixed
  // hard ceiling, a truncation now unambiguously means the patch
  // genuinely produced more output than the ceiling allows -- it can no
  // longer mean "the estimate for this patch happened to guess too
  // low" (there is no estimate anymore). See providers/anthropic.js /
  // providers/openaiCompatible.js for how `truncated` is computed from
  // the provider's own stop/finish reason.
  if (result.truncated) {
    return {
      ok: false,
      code: "truncated_output",
      error: `The AI analyst's response was cut off before it finished (hit the ${PATCH_INTEL_MAX_TOKENS}-token hard maximum) -- this patch has more Support-relevant changes than the current ceiling allows.`,
      logDetail: `finishReason: ${result.finishReason}. Reply length: ${(result.reply || "").length} chars. Reply tail (last 300 chars): ${JSON.stringify((result.reply || "").slice(-300))}.`,
      maxTokens: PATCH_INTEL_MAX_TOKENS,
      engineVersion: PATCH_INTEL_ENGINE_VERSION,
    };
  }

  const parseResult = parseAIJson(result.reply);
  if (!parseResult) {
    return {
      ok: false,
      code: "ai_invalid_output",
      error: "The AI analyst didn't return valid JSON for this patch.",
      logDetail: `All parse strategies failed (raw, fenced, bounded-extraction). finishReason: ${result.finishReason}. Reply length: ${(result.reply || "").length} chars. Raw reply (first 500 chars): ${JSON.stringify((result.reply || "").slice(0, 500))}`,
      maxTokens: PATCH_INTEL_MAX_TOKENS,
      engineVersion: PATCH_INTEL_ENGINE_VERSION,
    };
  }

  const normalized = normalizePatchIntelReport(parseResult.parsed, { championRoster, itemRoster, runeRoster });
  if (!normalized) {
    return {
      ok: false,
      code: "ai_invalid_output",
      error: "The AI analyst's response didn't match the expected report shape.",
      logDetail: `Parsed via "${parseResult.strategy}" strategy but the shape was unusable: ${JSON.stringify(parseResult.parsed).slice(0, 300)}`,
      maxTokens: PATCH_INTEL_MAX_TOKENS,
      engineVersion: PATCH_INTEL_ENGINE_VERSION,
    };
  }

  return { ok: true, report: normalized, parseStrategy: parseResult.strategy, maxTokens: PATCH_INTEL_MAX_TOKENS, engineVersion: PATCH_INTEL_ENGINE_VERSION };
}
