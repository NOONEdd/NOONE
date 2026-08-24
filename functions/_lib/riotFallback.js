// Priority-2 fallback (see functions/api/coach.js): official Riot Wild
// Rift patch notes, used ONLY when Academy data (static + KV overrides)
// isn't sufficient to answer the specific question -- see
// functions/_lib/academyCoverage.js for that determination. Academy data
// is always primary and is NEVER overridden by anything fetched here --
// see buildPrompt.js, which appends this as a clearly separate, clearly
// labeled section.
//
// IMPORTANT: Academy's effective patch (src/lib/effectiveData.js's
// resolveEffectivePatch()) and "the latest patch Riot has actually
// published" are two INDEPENDENT things and must never be conflated.
// Academy could say 7.2b while Riot has already published 7.3 -- this
// file discovers Riot's latest patch on its own, from Riot's own patch
// index, rather than ever constructing a Riot URL from Academy's patch
// value.
//
// Hard safety rules, all enforced in this one file:
//   - Every fetch target is built ONLY from Riot's own patch-notes index
//     page (wildrift.leagueoflegends.com/en-us/news/tags/patch-notes/)
//     or a URL discovered directly from it -- never a user-supplied URL,
//     never a third-party wiki, never League PC pages, never anything
//     constructed from request/user input.
//   - Two fetches maximum per request (index discovery + one patch
//     page), each with a hard timeout -- a slow/unreachable Riot page
//     can't stall a response; any failure degrades to "no fallback
//     available," never an error surfaced to the visitor.
//   - Two-tier caching in KV: which patch is "latest" is cached briefly
//     (so a newly published Riot patch is picked up within hours, not
//     immediately re-checked on every request); a given patch's actual
//     content is cached much longer, since patch notes don't change
//     once published.
//   - Output is truncated to RIOT_FALLBACK_MAX_CHARS.
//   - This is a fixed, single-purpose fetcher, not a generic proxy --
//     no code path lets a request choose what gets fetched.

import {
  RIOT_FALLBACK_TIMEOUT_MS,
  RIOT_FALLBACK_MAX_CHARS,
  RIOT_LATEST_PATCH_META_TTL_SECONDS,
  RIOT_FALLBACK_CONTENT_TTL_SECONDS,
  PATCH_INTEL_FALLBACK_MAX_CHARS,
} from "./config.js";
import { isPatchChangeQuestion, extractExplicitPatchMention } from "./academyCoverage.js";

const RIOT_BASE = "https://wildrift.leagueoflegends.com";
const RIOT_PATCH_INDEX_URL = `${RIOT_BASE}/en-us/news/tags/patch-notes/`;
const LATEST_PATCH_META_CACHE_KEY = "riot-latest-patch-meta";

function normalizeVersionToken(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Riot's own patch-slug format isn't perfectly consistent -- most are
 *  like "7-2b", but some observed ones are like "71d-" (no dash between
 *  major/minor, trailing dash instead). Rather than guess/construct a
 *  slug, this extracts the REAL slugs Riot's index page actually links
 *  to, in document order -- confirmed newest-first (each entry carries
 *  an explicit ISO date, checked against real fetched content). */
function extractPatchSlugsInOrder(html) {
  const re = /wild-rift-patch-notes-([a-z0-9-]+?)\/?["'<\s)]/gi;
  const seen = new Set();
  const slugs = [];
  let match;
  while ((match = re.exec(html)) !== null) {
    const slug = match[1];
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      slugs.push(slug);
    }
  }
  return slugs;
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RIOT_FALLBACK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "VanguardAcademyCoach/1.0 (+https://noone-3vf.pages.dev)" },
    });
    return response;
  } catch {
    return null; // network error or timeout abort -- caller treats as unavailable
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Discovers the latest published patch slug from Riot's own index,
 *  cached briefly so a newly published patch is picked up within
 *  RIOT_LATEST_PATCH_META_TTL_SECONDS rather than needing a code change
 *  or immediately re-checking on every single request. Returns null on
 *  any failure -- never throws.
 *
 *  Exported (unlike the other internal helpers in this file) because
 *  functions/api/admin/patch-check.js -- Patch Intelligence's automatic
 *  detection step -- needs exactly this same "what's the latest slug"
 *  discovery to compare against the last patch it already generated a
 *  report for. Reusing this function rather than writing a second index
 *  scraper is what makes that comparison share the SAME cache and the
 *  SAME "only Riot's own index, nothing else" safety rule as the AI
 *  Coach's fallback -- one discovery mechanism, two callers. */
export async function discoverLatestPatchSlug(kv) {
  if (kv) {
    try {
      const cached = await kv.get(LATEST_PATCH_META_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.slug) return parsed.slug;
      }
    } catch {
      // fall through to live discovery
    }
  }

  const response = await fetchWithTimeout(RIOT_PATCH_INDEX_URL);
  if (!response || !response.ok) return null;

  let html;
  try {
    html = await response.text();
  } catch {
    return null;
  }

  const slugs = extractPatchSlugsInOrder(html);
  if (slugs.length === 0) return null;
  const latestSlug = slugs[0];

  if (kv) {
    try {
      await kv.put(LATEST_PATCH_META_CACHE_KEY, JSON.stringify({ slug: latestSlug, discoveredAt: Date.now() }), {
        expirationTtl: RIOT_LATEST_PATCH_META_TTL_SECONDS,
      });
    } catch {
      // best-effort cache write
    }
  }
  return latestSlug;
}

/** Finds the real slug for an EXPLICITLY named historical patch (e.g.
 *  "7.1d" from "what changed in patch 7.1d?") by matching against the
 *  index page's actual listed slugs -- normalized (letters+digits only)
 *  so "7.1d" correctly matches either a regular slug like "7-1d" or an
 *  irregular one like "71d-" without needing to guess which format a
 *  given patch uses. Returns null if the requested patch isn't in the
 *  index's visible list (e.g. old enough to be paginated away) -- this
 *  is a soft miss, not a failure, and the caller just proceeds without
 *  a fallback for that case. NOT cached separately from the index
 *  fetch itself -- reuses discoverLatestPatchSlug()'s index HTML by
 *  doing its own fetch of the same (cheap, cached-by-Cloudflare-CDN-in-
 *  practice) index URL; this file doesn't try to cache "the whole list"
 *  as a third cache tier for what should be a rare path (most questions
 *  are about the current patch, not a specifically-named old one). */
async function findExplicitPatchSlug(explicitPatch) {
  const response = await fetchWithTimeout(RIOT_PATCH_INDEX_URL);
  if (!response || !response.ok) return null;
  let html;
  try {
    html = await response.text();
  } catch {
    return null;
  }
  const slugs = extractPatchSlugsInOrder(html);
  const target = normalizeVersionToken(explicitPatch);
  return slugs.find((slug) => normalizeVersionToken(slug) === target) || null;
}

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

function patchPageUrl(slug) {
  return `${RIOT_BASE}/en-us/news/game-updates/wild-rift-patch-notes-${slug}/`;
}

/** One live fetch + HTML-to-text strip of a patch page, shared by both
 *  cached-content functions below. No truncation, no caching -- those
 *  differ between the two callers (a short prompt-injection snippet for
 *  the AI Coach vs. the much larger text Patch Intelligence needs to
 *  analyze), so each wraps this with its own cap and its own cache
 *  entry rather than one trying to reuse the other's (already-truncated)
 *  cached copy. Returns null on any failure -- never throws. */
async function fetchPatchPageText(slug) {
  const response = await fetchWithTimeout(patchPageUrl(slug));
  if (!response || !response.ok) return null;
  try {
    const html = await response.text();
    const text = stripHtmlToText(html);
    return text || null;
  } catch {
    return null;
  }
}

async function fetchAndCachePatchContent(slug, kv) {
  const url = patchPageUrl(slug);
  const cacheKey = `riot-fallback-content:${slug}`;

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
      // fall through to a live fetch
    }
  }

  const fullText = await fetchPatchPageText(slug);
  if (!fullText) return { found: false, content: null, source: null, cached: false };
  const text = fullText.slice(0, RIOT_FALLBACK_MAX_CHARS);

  if (kv) {
    try {
      // Content is immutable once a patch is published -- long TTL.
      await kv.put(cacheKey, JSON.stringify({ content: text }), { expirationTtl: RIOT_FALLBACK_CONTENT_TTL_SECONDS });
    } catch {
      // best-effort cache write
    }
  }

  return { found: true, content: text, source: url, cached: false };
}

/** Same idea as fetchAndCachePatchContent above, but for Patch
 *  Intelligence: a MUCH larger cap (PATCH_INTEL_FALLBACK_MAX_CHARS, not
 *  RIOT_FALLBACK_MAX_CHARS) and its OWN cache key, so generating a full
 *  Support-impact analysis never gets short-changed by content that was
 *  already truncated down to chat-answer size for a different caller,
 *  and a visitor's chat question never pulls in the much larger blob
 *  meant for the analyst prompt. Same immutable-once-published long TTL.
 *  Returns { found, content, source } -- found:false on any failure,
 *  never throws. Exported for functions/_lib/patchIntelligence.js. */
export async function fetchAndCacheFullPatchContent(slug, kv) {
  const url = patchPageUrl(slug);
  const cacheKey = `riot-fallback-full-content:${slug}`;

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
      // fall through to a live fetch
    }
  }

  const fullText = await fetchPatchPageText(slug);
  if (!fullText) return { found: false, content: null, source: null, cached: false };
  const text = fullText.slice(0, PATCH_INTEL_FALLBACK_MAX_CHARS);

  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify({ content: text }), { expirationTtl: RIOT_FALLBACK_CONTENT_TTL_SECONDS });
    } catch {
      // best-effort cache write
    }
  }

  return { found: true, content: text, source: url, cached: false };
}

// Riot's Wild Rift patch-note pages consistently open with a heading
// like "Patch Notes 7.3a" (sometimes "Wild Rift Patch Notes 7.3a") --
// this looks for that near the START of the stripped text (title/H1
// area, not "match anywhere," since a patch page can also mention OTHER
// patch numbers in passing, e.g. "reverted in 7.2b"). Deliberately
// narrow: this is used to get a clean, human-readable "7.3a"-style
// display value for a report instead of Riot's sometimes-irregular URL
// slug ("73a-") -- see extractPatchNumberFromContent below.
const PATCH_NUMBER_NEAR_TITLE = /patch\s+notes\s+(\d+\.\d+[a-z]?)/i;

/** Best-effort extraction of a clean "7.3a"-style patch number from a
 *  patch page's stripped text. Only searches the first 500 characters
 *  (the title/intro area) -- deliberately does NOT scan the whole page,
 *  since later sections can mention older patch numbers in passing
 *  ("reverted from 7.2b") that would be wrong to report as THIS patch's
 *  number. Falls back to the raw discovered slug (with dashes turned
 *  into dots as a light best-effort cleanup, e.g. "7-3a" -> "7.3a") if
 *  no confident match is found -- callers that store the result also
 *  record which path was used (see patchIntelligence.js's
 *  `patchNumberSource`) rather than presenting a guess as equally
 *  reliable as a real match, per the "never fabricate, flag
 *  uncertainty" rule this whole feature follows. */
export function extractPatchNumberFromContent(text, fallbackSlug) {
  const titleArea = (text || "").slice(0, 500);
  const match = PATCH_NUMBER_NEAR_TITLE.exec(titleArea);
  if (match) return { patchNumber: match[1], source: "extracted" };
  const cleaned = String(fallbackSlug || "").replace(/-+$/, "").replace(/-/g, ".");
  return { patchNumber: cleaned || String(fallbackSlug || "unknown"), source: "slug_fallback" };
}

/**
 * Resolves which patch to fetch (an explicitly-named historical patch if
 * the question asks for one, otherwise Riot's independently-discovered
 * latest patch) and returns its content.
 *
 * Returns { found, content, source, cached, patchSlug } -- found:false
 * on ANY failure (network, timeout, non-2xx, empty page, patch not
 * found), never throws.
 */
export async function getRiotPatchNotesFallback(question, kv) {
  let slug = null;

  if (isPatchChangeQuestion(question)) {
    const explicitPatch = extractExplicitPatchMention(question);
    if (explicitPatch) {
      slug = await findExplicitPatchSlug(explicitPatch);
    }
  }

  if (!slug) {
    slug = await discoverLatestPatchSlug(kv);
  }

  if (!slug) return { found: false, content: null, source: null, cached: false, patchSlug: null };

  const result = await fetchAndCachePatchContent(slug, kv);
  return { ...result, patchSlug: slug };
}
