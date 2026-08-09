// Priority-3 fallback (see functions/api/coach.js): official Riot Wild
// Rift patch notes, used ONLY when Academy grounding (champion/item/rune
// detection against src/data/*.js + Coach Mode overrides) found nothing
// at all for the question. Academy data is always Priority 1 and is
// NEVER overridden by anything fetched here -- see buildPrompt.js, which
// appends this as a clearly separate, clearly labeled section rather
// than merging it into the Academy data block.
//
// Hard safety rules, all enforced in this one file so there's a single
// place to audit:
//   - The fetch target is built ONLY from a fixed URL pattern on
//     wildrift.leagueoflegends.com, from the site's own resolved patch
//     string (never from request/user input) -- never a user-supplied
//     URL, never a third-party wiki, never League PC pages.
//   - One fetch maximum per request, with a hard timeout
//     (RIOT_FALLBACK_TIMEOUT_MS) so a slow/unreachable page can't stall
//     a response -- any failure just means "no fallback available,"
//     never an error surfaced to the visitor.
//   - Cached in KV per patch slug for RIOT_FALLBACK_CACHE_TTL_SECONDS,
//     so many questions about the same patch share one fetch instead of
//     re-fetching Riot's site every time.
//   - Output is truncated to RIOT_FALLBACK_MAX_CHARS -- this can never
//     balloon the prompt the way an ungrounded quantity would.
//   - This is a fixed, single-purpose fetcher, not a generic proxy --
//     there is no code path anywhere that lets a request choose what
//     URL gets fetched.

import { RIOT_FALLBACK_CACHE_TTL_SECONDS, RIOT_FALLBACK_TIMEOUT_MS, RIOT_FALLBACK_MAX_CHARS } from "./config.js";

const RIOT_BASE = "https://wildrift.leagueoflegends.com";

function patchToSlug(patch) {
  // "7.2b" -> "7-2b" -- matches Riot's own URL pattern, e.g.
  // wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-7-2b/
  return String(patch || "").trim().toLowerCase().replace(/[^a-z0-9.]/g, "").replace(/\./g, "-");
}

/** Crude, dependency-free HTML-to-text: this deliberately does NOT try
 *  to precisely parse Riot's page structure (no cheerio/DOM parser
 *  dependency, nothing that breaks if their markup changes) -- it just
 *  strips tags/scripts/styles and collapses whitespace, trading
 *  precision for resilience. The model receiving this text is told
 *  explicitly (see buildPrompt.js) that it's raw external reference
 *  material, not curated Academy data. */
function stripHtmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&ldquo;|&#8221;|&rdquo;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns { found: true, content, source, cached } if official Riot Wild
 * Rift patch notes for `effectivePatch` were available (from cache or a
 * live fetch), or { found: false, content: null, source: null, cached:
 * false } on ANY failure (network, timeout, non-2xx, empty page) --
 * never throws, so a Riot outage degrades to "no fallback" rather than
 * failing the whole coach request.
 */
export async function getRiotPatchNotesFallback(effectivePatch, kv) {
  const slug = patchToSlug(effectivePatch);
  if (!slug) return { found: false, content: null, source: null, cached: false };

  const url = `${RIOT_BASE}/en-us/news/game-updates/wild-rift-patch-notes-${slug}/`;
  const cacheKey = `riot-fallback:${slug}`;

  if (kv) {
    try {
      const cached = await kv.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed.content === "string") {
          return { found: true, content: parsed.content, source: url, cached: true };
        }
      }
    } catch {
      // corrupt cache entry or KV hiccup -- fall through to a live fetch
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RIOT_FALLBACK_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "VanguardAcademyCoach/1.0 (+https://noone-3vf.pages.dev)" },
    });
  } catch {
    // network error OR timeout abort -- either way, no fallback this time
    clearTimeout(timeoutId);
    return { found: false, content: null, source: null, cached: false };
  }
  clearTimeout(timeoutId);

  if (!response.ok) return { found: false, content: null, source: null, cached: false };

  let html;
  try {
    html = await response.text();
  } catch {
    return { found: false, content: null, source: null, cached: false };
  }

  const text = stripHtmlToText(html).slice(0, RIOT_FALLBACK_MAX_CHARS);
  if (!text) return { found: false, content: null, source: null, cached: false };

  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify({ content: text }), { expirationTtl: RIOT_FALLBACK_CACHE_TTL_SECONDS });
    } catch {
      // best-effort cache write -- a failure here just means the next
      // request fetches live again, not a request failure now
    }
  }

  return { found: true, content: text, source: url, cached: false };
}
