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
// only ever fetches Riot's own patch-notes index and a page it directly
// links to, NEVER a user-supplied URL. Two-tier cache: which patch is
// "latest" is rechecked periodically (short TTL, so a newly published
// patch is discovered within hours); a given patch's actual content is
// cached far longer since it's immutable once published.
export const RIOT_FALLBACK_TIMEOUT_MS = 5000;
export const RIOT_FALLBACK_MAX_CHARS = 4000; // bounds prompt size the same way the other MAX_* caps do
export const RIOT_LATEST_PATCH_META_TTL_SECONDS = 12 * 60 * 60; // 12h
export const RIOT_FALLBACK_CONTENT_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

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

// Brute-force protection for the admin password, shared by
// functions/api/admin/login.js and functions/api/coach-overrides.js (the
// latter only hits this on the legacy/defensive path -- see that file).
// Separate from RATE_LIMIT_PER_HOUR above, which only applies to the AI
// Coach chat endpoint, not the password check.
export const MAX_PASSWORD_ATTEMPTS = 5;
export const PASSWORD_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------
// Admin session (functions/_lib/adminAuth.js) -- replaces the old
// "send the Coach Mode password on every write" pattern. A successful
// POST /api/admin/login exchanges COACH_PASSWORD for a signed, HttpOnly
// session cookie; every admin-mutation endpoint verifies that cookie
// instead of re-checking a password. See adminAuth.js for the actual
// signing logic (Web Crypto HMAC-SHA256, no new dependency).
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60; // 12h -- long enough for one real coaching/admin session, short enough that a stolen cookie doesn't stay valid indefinitely
export const ADMIN_SESSION_COOKIE_NAME = "academy_admin_session";

// ---------------------------------------------------------------------
// Patch Intelligence (functions/_lib/patchIntelligence.js,
// functions/_lib/riotFallback.js's full-content fetch, functions/api/admin/patch-check.js).
// Deliberately separate from the AI-Coach-chat constants above -- a
// structured Support-impact analysis covering every changed champion/
// item/rune in a patch is a fundamentally bigger, rarer, admin-triggered
// generation than a single chat reply, so it gets its own token budget
// and its own (larger, separately cached) content cap rather than
// borrowing MAX_TOKENS/RIOT_FALLBACK_MAX_CHARS and silently truncating a
// real patch's worth of changes.
//
// PATCH_INTEL_MAX_TOKENS was originally a single fixed value, raised
// from 4096 to 8192 after a production failure ("the AI analyst didn't
// return valid JSON") traced to output truncation: the report schema
// has ~14 fields per change entry across 5 arrays, and a real patch
// with a double-digit number of Support-relevant changes can genuinely
// need more output tokens to finish the JSON object than a quiet patch
// -- stop_reason "max_tokens" was confirmed as the failure mode (see
// providers/anthropic.js's and providers/openaiCompatible.js's
// `truncated`/`finishReason` fields, and patchIntelligence.js's
// dedicated "truncated_output" error code).
//
// A single fixed value is still the wrong shape for this, though: a
// quiet patch (one champion tweak) and a huge one (a full rework wave)
// don't need the same budget, and picking one fixed number always means
// either wasting budget on small patches or eventually re-hitting this
// same truncation failure on a big one. functions/_lib/patchIntelligence.js's
// estimatePatchIntelTokenBudget() now computes a per-patch estimate from
// two signals available BEFORE the AI call -- never from asking the
// model -- and clamps it between the two constants below:
//
//   PATCH_INTEL_MIN_TOKENS   a floor generous enough that even a
//                            genuinely quiet patch (empty arrays, one
//                            short supportMetaAnalysis sentence) is
//                            never starved by an under-estimate -- the
//                            JSON skeleton plus one full change entry
//                            costs a few hundred tokens at most, so
//                            1024 leaves real headroom without wasting
//                            much on a small patch.
//   PATCH_INTEL_MAX_TOKENS   the HARD ceiling -- estimates are always
//                            clamped to this regardless of how large a
//                            patch looks, so a mis-estimate can make a
//                            request smaller than ideal but never
//                            larger than this. Chosen as a considered,
//                            conservative value rather than an
//                            arbitrarily huge one (requirement: "do not
//                            solve the problem by making the maximum
//                            enormous") -- 16384 is comfortably within
//                            the STANDARD (non-beta) output-token limit
//                            of every current Claude Sonnet/Opus-class
//                            model this project's Anthropic adapter
//                            targets, and within the range most
//                            OpenAI-compatible backends (OpenAI itself,
//                            OpenRouter, Groq, Together, etc.) support
//                            for max_tokens without special
//                            configuration. It cannot be verified against
//                            every possible AI_MODEL string someone
//                            might configure (openai-compatible allows
//                            literally any backend) -- if a specific
//                            configured model is confirmed to support a
//                            verified higher limit, this constant is the
//                            one place to raise it, deliberately kept as
//                            a single easy-to-find ceiling rather than a
//                            speculative per-model lookup table this
//                            codebase has no reliable way to keep
//                            accurate.
//
// These estimation constants (also in patchIntelligence.js's
// estimatePatchIntelTokenBudget(), kept alongside the MIN/MAX above
// since they're the other half of the same clamp formula):
//   PATCH_INTEL_BASE_TOKENS         fixed overhead per report: the JSON
//                                   skeleton itself (empty arrays, keys,
//                                   braces) plus a short
//                                   supportMetaAnalysis sentence -- ~500
//                                   tokens covers this comfortably even
//                                   before a single change entry is
//                                   added.
//   PATCH_INTEL_TOKENS_PER_ENTRY    ~130 tokens per estimated change
//                                   entry -- reasoned from the schema's
//                                   ~14 fields once the prompt asks for
//                                   concise phrases rather than
//                                   sentences (short values: ~75-85
//                                   tokens, plus JSON key/quote/comma
//                                   structural overhead: ~40-50 tokens).
//   PATCH_INTEL_CHARS_PER_EXTRA_ENTRY   used as a secondary, input-size-based
//                                   signal (raw official patch-notes
//                                   character count / this value) for
//                                   change entries the name-matching
//                                   signal can't see -- untitled system/
//                                   meta changes (roaming, vision,
//                                   objectives) that don't name a
//                                   specific champion/item/rune but
//                                   still cost systemChanges[] output.
//                                   300 chars/entry is an approximate,
//                                   deliberately conservative (i.e.
//                                   erring toward a HIGHER entry count,
//                                   not a lower one) read of how much
//                                   text Wild Rift's patch notes
//                                   typically spend describing one
//                                   change.
export const PATCH_INTEL_MIN_TOKENS = 1024;
export const PATCH_INTEL_MAX_TOKENS = 16384;
export const PATCH_INTEL_BASE_TOKENS = 500;
export const PATCH_INTEL_TOKENS_PER_ENTRY = 130;
export const PATCH_INTEL_CHARS_PER_EXTRA_ENTRY = 300;
export const PATCH_INTEL_FALLBACK_MAX_CHARS = 16000; // full patch notes text handed to the AI analyst, not the ~4000-char snippet used for a single chat answer
export const PATCH_REPORTS_INDEX_LIMIT = 100; // caps patch-intel:reports so that one index key can't grow unbounded across years of patches
