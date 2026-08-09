// Static fallback patch version -- shipped in the codebase, requires a
// rebuild+redeploy to change. This is the FALLBACK, not the source of
// truth: Coach Mode can set a current patch directly in KV (no rebuild
// needed) which src/lib/effectiveData.js's resolveEffectivePatch()
// prefers whenever it's set. Bump this by hand on patches where you
// don't need same-day updates and a normal deploy is fine.
//
// Both src/App.jsx (website) and functions/api/coach.js (AI Coach) import
// this SAME constant -- same reasoning as champions.js/items.js/runes.js
// living here and being imported by both sides, so there's exactly one
// static value to keep current, not two that can drift.
export const STATIC_PATCH_VERSION = "7.2b";
