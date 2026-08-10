// Deterministic (no LLM call) logic for "does Academy's grounded data
// actually answer THIS question," as distinct from "did entity detection
// find something at all." An entity existing in Academy data doesn't
// mean Academy has the specific fact being asked about -- see
// functions/api/coach.js for where this decides whether Riot fallback
// is even attempted.
//
// This is intentionally a bounded keyword heuristic, not real NLU: it
// can be wrong in both directions (missing a real gap, or flagging a
// false one), but it's deterministic, fast, testable, and explainable --
// which is what was asked for instead of a second model call just to
// judge the first one's grounding.

// Words that signal the question wants a SPECIFIC numeric/mechanical
// fact. If the question uses one of these and the grounded Academy text
// doesn't mention it anywhere, Academy is treated as insufficient for
// THIS question even though an entity was found.
const FACT_KEYWORDS = [
  "cooldown", "cost", "price", "duration", "range", "radius",
  "damage", "heal", "healing", "shield", "mana cost", "mana",
  "attack speed", "movement speed", "armor", "magic resist",
  "health", "ability power", "attack damage", "stats", "stack",
  "haste", "scaling", "percentage",
];

// Words that mean the question is about what CHANGED -- Academy only
// ever holds CURRENT effective data (static baseline + current KV
// overrides), never a diff against a previous patch, so it structurally
// can't answer this regardless of how complete it is for the CURRENT
// state.
const PATCH_CHANGE_KEYWORDS = [
  "change", "changed", "changes", "nerf", "nerfed", "buff", "buffed",
  "rework", "reworked", "update", "updated", "patch notes",
  "new patch", "latest patch", "this patch", "last patch",
  "differ", "different from", "used to", "before the patch",
];

// Matches a version-shaped token like "7.2b" or "7.1" -- used to detect
// an EXPLICIT historical patch request (see functions/_lib/riotFallback.js).
const VERSION_TOKEN = /\b(\d+\.\d+[a-z]?)\b/i;

function containsAny(text, keywords) {
  const lower = (text || "").toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

/** True if the question is asking what changed / patch history, rather
 *  than the current state. */
export function isPatchChangeQuestion(question) {
  return containsAny(question, PATCH_CHANGE_KEYWORDS);
}

/** Returns the explicit patch version mentioned in the question (e.g.
 *  "7.2b" from "what changed to Redemption in patch 7.2b?"), or null if
 *  none is present. Only meaningful when isPatchChangeQuestion() is also
 *  true -- a stray number in an unrelated question isn't a patch
 *  request; see riotFallback.js for how the two are combined. */
export function extractExplicitPatchMention(question) {
  const match = VERSION_TOKEN.exec(question || "");
  return match ? match[1] : null;
}

/** True if the question uses a specific-fact keyword (e.g. "cooldown")
 *  that the grounded Academy text doesn't contain anywhere. Questions
 *  that don't use any such keyword (general coaching questions like
 *  "when should I buy X") skip this check entirely -- Academy's
 *  coaching notes are exactly what's meant to answer those, and this
 *  heuristic has no vocabulary for judging coaching-advice quality, only
 *  presence/absence of specific mechanical terms. */
export function hasSpecificFactGap(question, groundedText) {
  const lowerQuestion = (question || "").toLowerCase();
  const lowerGrounded = (groundedText || "").toLowerCase();
  const askedKeywords = FACT_KEYWORDS.filter((k) => lowerQuestion.includes(k));
  if (askedKeywords.length === 0) return false;
  return askedKeywords.some((k) => !lowerGrounded.includes(k));
}

/**
 * The single decision functions/api/coach.js needs: is Academy's
 * resolved data sufficient to answer this question on its own, or is
 * Riot fallback eligible? `hasAnyGrounding` is whether entity detection
 * found anything at all; `groundedText` is the concatenated text of
 * whatever Academy context WAS resolved (item info/notes, champion
 * note/builds/matchups, decision-tree entries).
 *
 * Order matters: a patch-change question is never answerable from
 * Academy regardless of grounding, checked first; then "found nothing
 * at all" (the original, simpler check); then the keyword-gap check
 * against what WAS found.
 */
export function isAcademyDataSufficient(question, hasAnyGrounding, groundedText) {
  if (isPatchChangeQuestion(question)) return false;
  if (!hasAnyGrounding) return false;
  if (hasSpecificFactGap(question, groundedText)) return false;
  return true;
}

/** Flattens whatever Academy context was resolved into one plain-text
 *  blob for hasSpecificFactGap() to search -- built directly from the
 *  already-resolved context objects functions/api/coach.js has on hand,
 *  not a re-fetch or re-resolution of anything. */
export function buildAcademyGroundedText({ championContext, itemContext, runeContext, decisionTreeEntries }) {
  const parts = [];
  if (championContext) {
    parts.push(championContext.note || "");
    for (const build of championContext.builds || []) {
      parts.push(...(build.items || []), ...(build.runes || []));
    }
    parts.push(...(championContext.matchups || []));
  }
  parts.push(...(decisionTreeEntries || []));
  parts.push(...(itemContext || []));
  parts.push(...(runeContext || []));
  return parts.join(" ");
}
