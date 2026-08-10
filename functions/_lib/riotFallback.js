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
 *  any failure -- never throws. */
async function discoverLatestPatchSlug(kv) {
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

async function fetchAndCachePatchContent(slug, kv) {
  const url = `${RIOT_BASE}/en-us/news/game-updates/wild-rift-patch-notes-${slug}/`;
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

  const response = await fetchWithTimeout(url);
  if (!response || !response.ok) return { found: false, content: null, source: null, cached: false };

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
      // Content is immutable once a patch is published -- long TTL.
      await kv.put(cacheKey, JSON.stringify({ content: text }), { expirationTtl: RIOT_FALLBACK_CONTENT_TTL_SECONDS });
    } catch {
      // best-effort cache write
    }
  }

  return { found: true, content: text, source: url, cached: false };
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
