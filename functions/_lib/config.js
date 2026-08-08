// Single source of truth for anything the AI Coach backend needs tuned.
// Nothing in services/detectors/extractors should hardcode any of these
// values directly -- import them from here so there's exactly one place
// to change a number.

// Defaults used only when AI_PROVIDER / AI_MODEL aren't set as Cloudflare
// environment variables (Settings -> Environment variables). Setting
// those overrides these without touching any code -- see
// functions/_lib/aiProvider.js.
export const DEFAULT_PROVIDER = "anthropic";
export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const MAX_TOKENS = 1000;

// Bump this by hand whenever champion/item/rune/build data gets updated
// for a new patch. It's surfaced two places: the AI's own system prompt
// (so it explicitly defers to this data over its own possibly-stale
// general knowledge) and the AI Coach page footer (so visitors see it too).
export const PATCH_VERSION = "7.2b";

// This endpoint calls the AI provider using YOUR key, billed to YOUR
// account, and the client controls the entire `messages` array in the
// request body. Without these three caps, one visitor (or a bot doing it
// automatically) can rack up real cost by looping the endpoint or sending
// an enormous fabricated conversation history. None of this affects a
// normal coaching conversation.
export const MAX_MESSAGES = 40; // a real session rarely needs more before starting fresh is better anyway
export const MAX_TOTAL_CHARS = 12000; // bounds the worst-case cost of any single request, independent of the rate limit below
export const RATE_LIMIT_PER_HOUR = 20; // generous for genuine use, still bounds the damage from one IP looping the endpoint

// Grounding caps -- same reasoning as the three above, applied to the
// item/rune/decision-tree context pulled into the prompt (see
// functions/_lib/detectItemsRunes.js, extractItemRuneContext.js,
// extractChampionContext.js). A question that happens to name a lot of
// items, or a champion with a lot of Coach Mode decision-tree entries,
// still can't balloon the prompt -- earliest mentions in the text win,
// and each decision-tree entry is truncated rather than dropped whole.
export const MAX_ITEMS_PER_REQUEST = 5;
export const MAX_RUNES_PER_REQUEST = 5;
export const MAX_DECISION_TREE_ENTRIES = 6;
export const MAX_DECISION_TREE_CHARS = 400;

// Brute-force protection for the Coach Mode password, shared by
// functions/api/verify-coach.js and functions/api/coach-overrides.js.
// Separate from RATE_LIMIT_PER_HOUR above, which only applies to the AI
// Coach chat endpoint, not the password check.
export const MAX_PASSWORD_ATTEMPTS = 5;
export const PASSWORD_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
