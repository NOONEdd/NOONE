// Single source of truth for anything the AI Coach backend needs tuned.
// Nothing in services/detectors/extractors should hardcode any of these
// values directly -- import them from here so there's exactly one place
// to change a number.

export const MODEL = "claude-sonnet-4-6";
export const MAX_TOKENS = 1000;

// Bump this by hand whenever champion/item/rune/build data gets updated
// for a new patch. It's surfaced two places: the AI's own system prompt
// (so it explicitly defers to this data over its own possibly-stale
// general knowledge) and the AI Coach page footer (so visitors see it too).
export const PATCH_VERSION = "7.2b";

// This endpoint calls the Anthropic API using YOUR key, billed to YOUR
// account, and the client controls the entire `messages` array in the
// request body. Without these three caps, one visitor (or a bot doing it
// automatically) can rack up real cost by looping the endpoint or sending
// an enormous fabricated conversation history. None of this affects a
// normal coaching conversation.
export const MAX_MESSAGES = 40; // a real session rarely needs more before starting fresh is better anyway
export const MAX_TOTAL_CHARS = 12000; // bounds the worst-case cost of any single request, independent of the rate limit below
export const RATE_LIMIT_PER_HOUR = 20; // generous for genuine use, still bounds the damage from one IP looping the endpoint
