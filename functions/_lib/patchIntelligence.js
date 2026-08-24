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

const SEVERITY_VALUES = ["Low", "Medium", "High"];
const CONFIDENCE_VALUES = ["Low", "Medium", "High"];
const TYPE_VALUES = ["Buff", "Nerf", "Adjustment"];

const ANALYST_INSTRUCTIONS = `You are the Patch Intelligence analyst for Nyx NOONEdd Academy, a Wild Rift Support coaching site. Your only input is the official Wild Rift patch notes text provided below, plus a snapshot of the Academy's current Support-relevant champion/item/rune roster and their CURRENT tiers. Your job is to extract and structure whatever in this specific patch matters to SUPPORT players -- not to rewrite the patch notes in full, and not to invent anything the patch notes don't actually say.

HARD RULES -- follow these strictly:
1. Every change you report must be traceable to the official patch notes text below. Never invent a change, a number, or a champion/item/rune that isn't actually mentioned in that text. If you are not sure something is really in the text, leave it out rather than guessing.
2. If the patch notes contain no changes relevant to Support, return empty arrays. A quiet patch producing a short, mostly-empty report is the CORRECT output -- do not manufacture relevance or pad the report to seem thorough.
3. "Support impact," "gameplay/build/rune/matchup implications," and "recommended tier action" are your analysis, clearly reasoned FROM the raw change -- but the raw change itself (what changed, the previous value, the new value) must come from the text, not be inferred.
4. Use the Academy roster snapshot below for two things ONLY: (a) judging whether a mentioned champion/item/rune is one Academy actually tracks, and (b) using its ACTUAL CURRENT tier as the "from" side of any recommended tier action -- never guess a current tier that isn't in the snapshot.
5. You are an analyst/recommender, not the final authority -- a human coach reviews every report before anything about it goes live, and nothing you output is ever applied automatically. Write reasoning a human can quickly judge and disagree with if needed, not reasoning written to sound maximally confident.
6. impactSeverity and confidence must each be exactly one of "Low", "Medium", "High". type/buffNerfAdjustment must be exactly one of "Buff", "Nerf", "Adjustment". Do not use any other values or casing.
7. Respond with ONLY one JSON object matching the schema below. No markdown code fences, no prose before or after it, no comments inside it, no trailing commas.

JSON SCHEMA (every field required; use empty string/array when a field genuinely doesn't apply, never omit the key):
{
  "supportMetaAnalysis": string (2-4 sentences: what this patch means for Support play overall, or "No Support-relevant changes in this patch." if that's genuinely true),
  "championChanges": [ { "championName": string, "whatChanged": string, "previousValue": string, "newValue": string, "type": "Buff"|"Nerf"|"Adjustment", "supportImpact": string, "impactSeverity": "Low"|"Medium"|"High", "gameplayImplications": string, "buildImplications": string, "runeImplications": string, "matchupImplications": string, "tierListActionNeeded": boolean, "recommendedTierAction": string (e.g. "S -> A", or "No change"), "reasoning": string, "confidence": "Low"|"Medium"|"High" } ],
  "itemChanges": [ { "itemName": string, "whatChanged": string, "previousValue": string, "newValue": string, "type": "Buff"|"Nerf"|"Adjustment", "supportImpact": string, "impactSeverity": "Low"|"Medium"|"High", "championsAffected": string[], "gameplayImplications": string, "buildImplications": string, "runeImplications": string, "matchupImplications": string, "tierListActionNeeded": boolean, "recommendedTierAction": string, "reasoning": string, "confidence": "Low"|"Medium"|"High" } ],
  "runeChanges": [ { "runeName": string, "whatChanged": string, "previousValue": string, "newValue": string, "type": "Buff"|"Nerf"|"Adjustment", "supportImpact": string, "impactSeverity": "Low"|"Medium"|"High", "championsAffected": string[], "gameplayImplications": string, "buildImplications": string, "runeImplications": string, "matchupImplications": string, "tierListActionNeeded": boolean, "recommendedTierAction": string, "reasoning": string, "confidence": "Low"|"Medium"|"High" } ],
  "systemChanges": [ { "area": string (one of "Roaming","Vision","Laning","Peel","Engage","Scaling","Teamfight","Summoner Spells","Objectives","Other"), "whatChanged": string, "supportImpact": string, "impactSeverity": "Low"|"Medium"|"High", "championsAffected": string[], "gameplayImplications": string, "reasoning": string, "confidence": "Low"|"Medium"|"High" } ],
  "recommendedTierChanges": [ { "entityType": "champion"|"item"|"rune", "entityName": string, "from": string, "to": string, "reasoning": string, "confidence": "Low"|"Medium"|"High" } ]
}`;

function formatRosterSnapshot(championRoster, itemRoster, runeRoster) {
  const champLines = championRoster.map((c) => `${c.id}|${c.name}|${c.role}|tier:${c.tier}`).join("\n");
  const itemLines = itemRoster.map((i) => `${i.id}|${i.name}|${i.category}|tier:${i.tier}`).join("\n");
  const runeLines = runeRoster.map((r) => `${r.id}|${r.name}|${r.path}|tier:${r.tier}`).join("\n");
  return `--- Academy champion roster (id|name|role|current tier) ---\n${champLines}\n\n--- Academy item roster (id|name|category|current tier) ---\n${itemLines}\n\n--- Academy rune roster (id|name|path|current tier) ---\n${runeLines}`;
}

function stripJsonFences(text) {
  const trimmed = (text || "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
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
 *  Exact case-insensitive match first, then a light substring match;
 *  returns null (not a guess) if nothing reasonably matches -- the raw
 *  name the AI gave is always preserved separately regardless, so a
 *  failed match never loses information, it just can't deep-link. */
function resolveEntityId(name, roster) {
  if (!name) return null;
  const target = name.trim().toLowerCase();
  const exact = roster.find((e) => e.name.toLowerCase() === target);
  if (exact) return exact.id;
  const partial = roster.find((e) => target.includes(e.name.toLowerCase()) || e.name.toLowerCase().includes(target));
  return partial ? partial.id : null;
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
 * Runs the full analysis: builds the analyst prompt from the fetched
 * patch text + Academy roster snapshot, calls the active AI provider,
 * and validates/normalizes the result.
 *
 * Returns one of:
 *   { ok: true, report: {...normalized fields above...} }
 *   { ok: false, code: "ai_error" | "ai_invalid_output", error, logDetail }
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
  });

  if (!result.ok) {
    return { ok: false, code: "ai_error", error: result.error, logDetail: result.logDetail };
  }

  let parsed;
  try {
    parsed = JSON.parse(stripJsonFences(result.reply));
  } catch (err) {
    return {
      ok: false,
      code: "ai_invalid_output",
      error: "The AI analyst didn't return valid JSON for this patch.",
      logDetail: `JSON.parse failed: ${err && err.message ? err.message : String(err)}. Raw reply (first 300 chars): ${(result.reply || "").slice(0, 300)}`,
    };
  }

  const normalized = normalizePatchIntelReport(parsed, { championRoster, itemRoster, runeRoster });
  if (!normalized) {
    return {
      ok: false,
      code: "ai_invalid_output",
      error: "The AI analyst's response didn't match the expected report shape.",
      logDetail: `Parsed JSON was not a usable object: ${JSON.stringify(parsed).slice(0, 300)}`,
    };
  }

  return { ok: true, report: normalized };
}
