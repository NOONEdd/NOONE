// The ONE data-resolution layer for the whole project. Both the website
// (src/App.jsx, running in the browser) and the AI Coach backend
// (functions/api/coach.js, running as a Cloudflare Function) import
// these same functions -- so "what does the site currently say about
// Redemption" and "what does the AI currently say about Redemption"
// can never drift apart, because they're computed by literally the same
// code, not two hand-maintained copies of the same merge logic.
//
// Base/static data (src/data/champions.js, items.js, runes.js, patch.js)
// is the FALLBACK dataset, not the source of truth -- Wild Rift changes
// between patches faster than this project gets rebuilt and redeployed.
// Cloudflare KV (Coach Mode overrides) holds whatever is currently more
// current. "Effective" data below always means: KV override where one
// exists, static baseline everywhere else, merged field-by-field so a
// partial edit (e.g. just a new `note`) doesn't blow away the rest of
// the entity's baseline fields.
//
// This file must stay a plain, dependency-free ES module (no React, no
// Cloudflare-specific APIs) so it can be imported unchanged by both a
// Vite browser bundle and a Cloudflare Pages Function.

/** Field-level merge for one champion. Fields not present in `override`
 *  fall through to `base` untouched -- this is what makes a partial
 *  Coach Mode edit (e.g. just changing `tier`) safe, instead of
 *  requiring every edit to restate the champion's entire record. */
export function resolveEffectiveChampion(base, override) {
  return {
    ...base,
    tier: override?.tier || base.tier || "Unranked",
    note: override?.note || base.blurb || "",
    builds: override?.builds && override.builds.length > 0 ? override.builds : (base.builds || []),
    items: base.items || [],
    runes: base.runes || [],
    matchups: base.matchups || [],
  };
}

/** Field-level merge for one item. `info` is the item's factual
 *  description (what it does); `note` is Academy coaching commentary
 *  about when/why to buy it. Keeping them as separate fields -- rather
 *  than one blended blob of text -- is what lets the prompt builder
 *  label facts and coaching opinion separately instead of mixing them
 *  into one undifferentiated block the model has to guess how to weigh. */
export function resolveEffectiveItem(base, override) {
  return {
    ...base,
    tier: override?.tier || base.tier || "Unranked",
    note: override?.note || "",
    info: override?.info || base.info || "",
  };
}

/** Same shape/reasoning as resolveEffectiveItem, for runes. */
export function resolveEffectiveRune(base, override) {
  return {
    ...base,
    tier: override?.tier || base.tier || "Unranked",
    note: override?.note || "",
    info: override?.info || base.info || "",
  };
}

/** The site's current patch: whatever Coach Mode has set in KV, if
 *  anything valid is set, otherwise the hardcoded fallback shipped in
 *  the codebase (src/data/patch.js). Deterministic, single rule, no
 *  version comparison logic -- KV wins when present, full stop. This
 *  is what functions/api/coach.js and src/App.jsx BOTH call, so the
 *  website footer and the AI's own system prompt can never disagree
 *  about what patch is current. */
export function resolveEffectivePatch(kvPatch, staticPatch) {
  const trimmed = typeof kvPatch === "string" ? kvPatch.trim() : "";
  return trimmed || staticPatch;
}
