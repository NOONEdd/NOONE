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

// The static patch fallback (STATIC_PATCH_VERSION) now lives in
// src/data/patch.js, alongside champions.js/items.js/runes.js -- it's
// imported by both src/App.jsx (website) and functions/api/coach.js (AI
// Coach) so there's one shared static value, not two that can drift.
// The site's actual EFFECTIVE patch (KV override if set, that static
// value otherwise) is computed by src/lib/effectiveData.js's
// resolveEffectivePatch(), also shared by both sides.

// How many of the most recent messages entity detection is allowed to
// look back through for a follow-up question that doesn't repeat any
// entity name itself (e.g. "what if they have a heavy dive comp?" after
// "should I buy Locket or Redemption?"). Deliberately small and bounded
// -- see functions/_lib/detectChampion.js / detectItemsRunes.js -- this
// is NOT "send the whole conversation into detection," just a short
// look-back window, capped well below MAX_MESSAGES below.
export const CONVERSATION_LOOKBACK_MESSAGES = 6;

// Official Riot Wild Rift fallback (functions/_lib/riotFallback.js) --
// only ever fetches a fixed, code-defined URL pattern on
// wildrift.leagueoflegends.com, NEVER a user-supplied URL. Cached in KV
// so the same patch's notes aren't re-fetched on every question that
// needs them, with a hard timeout so a slow/unreachable Riot page can't
// stall a response.
export const RIOT_FALLBACK_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24h
export const RIOT_FALLBACK_TIMEOUT_MS = 5000;
export const RIOT_FALLBACK_MAX_CHARS = 4000; // bounds prompt size the same way the other MAX_* caps do

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
