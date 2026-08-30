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

import { PATCH_INTEL_MIN_TOKENS, PATCH_INTEL_MAX_TOKENS, PATCH_INTEL_BASE_TOKENS, PATCH_INTEL_TOKENS_PER_ENTRY, PATCH_INTEL_CHARS_PER_EXTRA_ENTRY } from "./config.js";
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

const ANALYST_INSTRUCTIONS = `You are the Patch Intelligence analyst for Nyx NOONEdd Academy, a Wild Rift Support coaching site. Your only input is the official Wild Rift patch notes text provided below, plus a snapshot of the Academy's current Support-relevant champion/item/rune roster and their CURRENT tiers. Your job is to extract and structure whatever in this specific patch matters to SUPPORT players -- not to rewrite the patch notes in full, and not to invent anything the patch notes don't actually say.

HARD RULES -- follow these strictly:
1. Every change you report must be traceable to the official patch notes text below. Never invent a change, a number, or a champion/item/rune that isn't actually mentioned in that text. If you are not sure something is really in the text, leave it out rather than guessing.
2. If the patch notes contain no changes relevant to Support, return empty arrays. A quiet patch producing a short, mostly-empty report is the CORRECT output -- do not manufacture relevance or pad the report to seem thorough.
3. Only report changes that are actually relevant to Support play. Skip changes to non-Support-relevant champions/items/runes entirely -- do not include an entry just because a name was mentioned in the patch notes if it has no real bearing on Support.
4. "Support impact," "gameplay/build/rune/matchup implications," and "recommended tier action" are your analysis, clearly reasoned FROM the raw change -- but the raw change itself (what changed, the previous value, the new value) must come from the text, not be inferred.
5. Use the Academy roster snapshot below for two things ONLY: (a) judging whether a mentioned champion/item/rune is one Academy actually tracks, and (b) using its ACTUAL CURRENT tier as the "from" side of any recommended tier action -- never guess a current tier that isn't in the snapshot.
6. You are an analyst/recommender, not the final authority -- a human coach reviews every report before anything about it goes live, and nothing you output is ever applied automatically. Write reasoning a human can quickly judge and disagree with if needed, not reasoning written to sound maximally confident.
7. impactSeverity and confidence must each be exactly one of "Low", "Medium", "High". type/buffNerfAdjustment must be exactly one of "Buff", "Nerf", "Adjustment". Do not use any other values or casing.
8. Respond with ONLY one JSON object matching the schema below. No markdown code fences, no prose before or after it, no comments inside it, no trailing commas.
9. Write for MAXIMUM USEFUL INFORMATION PER TOKEN, not maximum length -- this report needs to be scannable in a couple of minutes, not exhaustive. Specifically:
  - "whatChanged"/"previousValue"/"newValue": report the ACTUAL changes from the official patch notes, including important numerical and mechanical details. NEVER summarize a concrete change only as "buffed", "nerfed", or "adjusted". If a value changes, show the OLD and NEW values explicitly. This includes damage, healing, shielding, cooldown, mana/energy cost, range, duration, attack speed, movement speed, health, armor, AD/AP, ratios, percentages, stack counts, thresholds, scaling, and any other meaningful numerical value. For multiple changes to the same entity, include ALL important changes using concise labels such as "Q: damage 80→90; cooldown 10s→8s; W: shield 60→80". Do not omit important numbers or mechanics merely to make the response shorter.
  - "supportImpact" and "reasoning": keep these concise and decision-oriented, but they MUST NOT replace the factual details of the actual changes. The factual numbers and mechanics belong in whatChanged/previousValue/newValue.
  - Conciseness means removing repetition and unnecessary wording, NOT removing important patch information. Prefer dense factual summaries over vague statements such as "Q buffed" or "this makes the champion stronger."
  10. AGGREGATE ALL CHANGES FOR THE SAME ENTITY INTO ONE ENTRY. Each champion may appear at most ONCE in championChanges. If a champion has multiple changes in this patch, combine ALL of them into that champion's single entry. This includes Passive, Q, W, E, R, base stats, scaling, cooldowns, damage, ratios, costs, durations, ranges, and any other changes. NEVER create separate entries for Q, W, E, R, Passive, or individual changes of the same champion. Put all changes together in the same whatChanged, previousValue, and newValue fields, using concise labels such as "Q:", "W:", "E:", "R:", and "Passive:" to keep them organized. The same rule applies to items and runes: each item or rune may appear at most ONCE, with all of its changes combined into that single entry.
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
  const itemLines = itemRoster.map((i) => `${i.id}|${i.name}|${i.category}|tier:${i.tier}`).join("\n");
  const runeLines = runeRoster.map((r) => `${r.id}|${r.name}|${r.path}|tier:${r.tier}`).join("\n");
  return `--- Academy champion roster (id|name|role|current tier) ---\n${champLines}\n\n--- Academy item roster (id|name|category|current tier) ---\n${itemLines}\n\n--- Academy rune roster (id|name|path|current tier) ---\n${runeLines}`;
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
    championChanges: championChanges.map((e) => ({
      championName: str(e.championName),
      championId: resolveEntityId(e.championName, championRoster),
      ...normalizeChangeEntry(e, { withChampionsAffected: false }),
    })),
    itemChanges: itemChanges.map((e) => ({
      itemName: str(e.itemName),
      itemId: resolveEntityId(e.itemName, itemRoster),
      ...normalizeChangeEntry(e, { withChampionsAffected: true }),
    })),
    runeChanges: runeChanges.map((e) => ({
      runeName: str(e.runeName),
      runeId: resolveEntityId(e.runeName, runeRoster),
      ...normalizeChangeEntry(e, { withChampionsAffected: true }),
    })),
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
    recommendedTierChanges: recommendedTierChanges.map((e) => {
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
    }),
  };
}

/**
 * Deterministic, explainable estimate of how many output tokens THIS
 * specific patch's analysis will likely need -- computed BEFORE calling
 * the AI (never asks the model itself). Two signals, both available
 * from data already in hand at call time:
 *
 *   1. Name-matching: how many of Academy's own champion/item/rune
 *      names actually appear in the official patch text -- a genuine
 *      proxy for "how many change entries this patch will likely
 *      produce," since the analyst is instructed (HARD RULE 5 above) to
 *      only report entities Academy actually tracks.
 *   2. Length-based: raw official-patch-notes character count divided
 *      by PATCH_INTEL_CHARS_PER_EXTRA_ENTRY. Catches change categories
 *      the name-matching signal can't see -- system/meta changes
 *      (roaming, vision, objectives) that don't name a specific
 *      champion/item/rune but still cost systemChanges[] output tokens.
 *
 * The LARGER of the two signals wins (not averaged) -- underestimating
 * is the exact failure mode this exists to prevent (the original
 * production truncation bug), so erring toward a bigger request is the
 * safe direction; erring smaller risks reintroducing it. The result is
 * then clamped to [PATCH_INTEL_MIN_TOKENS, PATCH_INTEL_MAX_TOKENS] --
 * MAX_TOKENS is a HARD ceiling this estimate can never exceed, no
 * matter how large a patch looks (see config.js's comment for why that
 * specific number).
 *
 * Returns the full breakdown, not just the final number, so
 * functions/api/admin/patch-check.js can log safe, explainable
 * diagnostic metadata (estimated entries, chosen budget) without
 * recomputing anything, and so a truncation error message can cite the
 * actual budget that was used for that specific patch.
 */
export function estimatePatchIntelTokenBudget({ patchContent, championRoster, itemRoster, runeRoster }) {
  const content = patchContent || "";
  const lowerContent = content.toLowerCase();

  const allNames = [...championRoster, ...itemRoster, ...runeRoster].map((e) => e.name).filter(Boolean);
  const mentionedCount = allNames.filter((name) => lowerContent.includes(name.toLowerCase())).length;

  const lengthBasedEntries = Math.floor(content.length / PATCH_INTEL_CHARS_PER_EXTRA_ENTRY);

  const estimatedEntries = Math.max(mentionedCount, lengthBasedEntries);
  const estimatedBudget = PATCH_INTEL_BASE_TOKENS + estimatedEntries * PATCH_INTEL_TOKENS_PER_ENTRY;
  const maxTokens = Math.min(Math.max(estimatedBudget, PATCH_INTEL_MIN_TOKENS), PATCH_INTEL_MAX_TOKENS);

  return { maxTokens, estimatedEntries, mentionedCount, lengthBasedEntries, estimatedBudget };
}

/**
 * Runs the full analysis: builds the analyst prompt from the fetched
 * patch text + Academy roster snapshot, calls the active AI provider
 * (requesting native structured output when the provider supports it --
 * see aiProvider.js) with an ADAPTIVE per-patch token budget (see
 * estimatePatchIntelTokenBudget above -- functions/_lib/aiProvider.js
 * and the AI Coach chat path at functions/api/coach.js are untouched by
 * this: coach.js still passes its own fixed MAX_TOKENS constant, this
 * function is the only caller that ever computes an adaptive value),
 * and validates/normalizes the result.
 *
 * Returns one of:
 *   { ok: true, report: {...normalized fields above...}, parseStrategy, tokenBudget }
 *   { ok: false, code: "ai_error" | "truncated_output" | "ai_invalid_output", error, logDetail, tokenBudget }
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

  const tokenBudget = estimatePatchIntelTokenBudget({ patchContent, championRoster, itemRoster, runeRoster });

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
      tokenBudget,
    };
  }

  // Checked BEFORE attempting to parse -- a truncated reply is
  // deterministically not valid JSON (it was cut off mid-object), so
  // there's no point running it through the parser just to get a
  // confusing generic "invalid JSON" error; this gives a specific,
  // actionable one instead, citing the ACTUAL adaptive budget this
  // patch got (not just the hard ceiling), so a report that's truncated
  // well below PATCH_INTEL_MAX_TOKENS clearly reads as an estimation
  // miss, not as "even the hard maximum wasn't enough." See
  // providers/anthropic.js / providers/openaiCompatible.js for how
  // `truncated` is computed from the provider's own stop/finish reason.
 if (result.truncated) {
  return {
    ok: false,
    code: "truncated_output",
    error: `The AI analyst's response was cut off because it reached the ${PATCH_INTEL_MAX_TOKENS}-token output limit.`,
    logDetail: `finishReason: ${result.finishReason}. Reply length: ${(result.reply || "").length} chars. Reply tail (last 300 chars): ${JSON.stringify((result.reply || "").slice(-300))}. Token budget diagnostics: ${JSON.stringify(tokenBudget)}. Actual maxTokens sent: ${PATCH_INTEL_MAX_TOKENS}`,
    tokenBudget: {
      ...tokenBudget,
      maxTokens: PATCH_INTEL_MAX_TOKENS,
    },
  };
}

  const parseResult = parseAIJson(result.reply);
  if (!parseResult) {
    return {
      ok: false,
      code: "ai_invalid_output",
      error: "The AI analyst didn't return valid JSON for this patch.",
      logDetail: `All parse strategies failed (raw, fenced, bounded-extraction). finishReason: ${result.finishReason}. Reply length: ${(result.reply || "").length} chars. Raw reply (first 500 chars): ${JSON.stringify((result.reply || "").slice(0, 500))}`,
      tokenBudget,
    };
  }

  const normalized = normalizePatchIntelReport(parseResult.parsed, { championRoster, itemRoster, runeRoster });
  if (!normalized) {
    return {
      ok: false,
      code: "ai_invalid_output",
      error: "The AI analyst's response didn't match the expected report shape.",
      logDetail: `Parsed via "${parseResult.strategy}" strategy but the shape was unusable: ${JSON.stringify(parseResult.parsed).slice(0, 300)}`,
      tokenBudget,
    };
  }

  return { ok: true, report: normalized, parseStrategy: parseResult.strategy, tokenBudget };
}
