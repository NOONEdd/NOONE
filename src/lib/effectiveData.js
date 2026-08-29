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

const MATCHUP_CATEGORIES = ["hardAgainst", "goodAgainst", "goodWith"];

/** Normalizes one matchup relations object to the current
 *  {championId, difficulty, reason} entry shape (Phase 3 -- Champion
 *  Matchups redesign spec §2/§13), whether it's already in that shape,
 *  still in Phase 2's original bare-id-string-array shape (any Coach
 *  Mode override saved before this phase), or missing a category
 *  entirely. Never throws on a malformed/partial shape -- worst case an
 *  unrecognized entry is dropped, never left half-formed for a
 *  component to choke on. Backward compatibility, not a second schema:
 *  the OUTPUT is always today's shape; nothing downstream of this
 *  function ever needs to know the old shape existed. */
function normalizeMatchupRelations(relations) {
  const out = {};
  for (const category of MATCHUP_CATEGORIES) {
    const list = relations?.[category];
    out[category] = Array.isArray(list)
      ? list.map((entry) => {
          if (typeof entry === "string") return { championId: entry, difficulty: "medium", reason: null }; // Phase 2 shape
          if (entry && typeof entry === "object" && typeof entry.championId === "string") {
            return { championId: entry.championId, difficulty: entry.difficulty || "medium", reason: entry.reason ?? null };
          }
          return null;
        }).filter(Boolean)
      : [];
  }
  return out;
}

/** Field-level merge for one champion. Fields not present in `override`
 *  fall through to `base` untouched -- this is what makes a partial
 *  Coach Mode edit (e.g. just changing `tier`) safe, instead of
 *  requiring every edit to restate the champion's entire record. */
export function resolveEffectiveChampion(base, override, matchupSeed) {
  return {
    ...base,
    tier: override?.tier || base.tier || "Unranked",
    note: override?.note || base.blurb || "",
    builds: override?.builds && override.builds.length > 0 ? override.builds : (base.builds || []),
    items: base.items || [],
    runes: base.runes || [],
    // The structured Hard Against / Good Against / Good With system
    // (src/components/ChampionMatchups.jsx) is the ONLY Champion
    // Matchup data now -- src/data/champions.js's old free-text
    // `matchups` field (and this file's own `matchups: base.matchups
    // || []` line that used to resolve it) was removed project-wide in
    // Phase 3; nothing reads a champion's `.matchups` anymore. `reason`
    // text that used to live in that prose was carried forward into the
    // entries below at migration time (src/data/matchups.js), not
    // duplicated here.
    // `matchupSeed` is src/data/matchups.js's MATCHUPS[base.id] -- the
    // caller passes it in (rather than this file importing it directly)
    // so this stays usable from a plain object in tests without a real
    // data file, same reasoning as base/override already being
    // parameters. An override object is trusted WHOLESALE the instant
    // it's present (even with every array empty -- that's a real,
    // intentional "coach cleared this category" state, not "no
    // override"), exactly like `builds` above; there's no partial
    // per-category merge here because Coach Mode (functions/api/
    // coach-overrides.js, src/hooks/useCoachOverrides.js's existing
    // generic update()) always computes and saves the complete next
    // object on every add/remove/edit, the same controlled-component
    // pattern `builds` already uses. Both the seed and any override are
    // run through normalizeMatchupRelations() so a champion's effective
    // data is always today's {championId,difficulty,reason} shape
    // regardless of which shape it was actually stored in.
    matchupRelations: normalizeMatchupRelations(override?.matchupRelations || matchupSeed || { hardAgainst: [], goodAgainst: [], goodWith: [] }),
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

/** The Academy's DATA VERIFICATION STATUS for whatever the effective
 *  patch currently is -- deliberately a SEPARATE question from "what is
 *  the current patch" above. Changing the current patch (Coach Mode's
 *  patch field, or a Patch Intelligence publish) must never, by itself,
 *  make the site claim its data has been verified for that patch --
 *  that would silently misrepresent unreviewed data as reviewed. The
 *  only way `status` can ever come back "verified" is if
 *  `overrides.verifiedPatch` is a non-empty string that EXACTLY matches
 *  `effectivePatch` -- so the instant an admin bumps the current patch
 *  to something new, this function structurally falls back to
 *  "updating"/"not_reviewed" on its own, with no separate reset step
 *  required anywhere else in the codebase.
 *
 *  `overrides.verifiedPatch`: the patch number an admin last explicitly
 *  marked verified (via the Coach Mode patch editor's "Mark verified"
 *  action, or via publishing a Patch Intelligence report with "also mark
 *  verified" checked) -- see functions/api/admin/patch-reports.js and
 *  src/components/TierBoard.jsx's CoachToggle.
 *  `overrides.patchStatus`: an optional explicit "updating" flag an
 *  admin can set the moment they start manually reviewing a new patch,
 *  distinguishing "actively being worked on" from "not yet reviewed at
 *  all" -- both are equally "not verified," but they read very
 *  differently on the public site (see PatchStatus.jsx).
 *
 *  Called by both the website (src/App.jsx) and the AI Coach backend
 *  (functions/api/coach.js) -- same reasoning as resolveEffectivePatch
 *  above: one function, so the footer badge and the AI's own awareness
 *  of whether its data is current can never disagree. */
export function resolvePatchDataStatus(overrides, effectivePatch) {
  const verifiedPatch = overrides && typeof overrides.verifiedPatch === "string" ? overrides.verifiedPatch.trim() : "";
  if (verifiedPatch && verifiedPatch === effectivePatch) {
    return { status: "verified", verifiedPatch };
  }
  const explicitStatus = overrides && overrides.patchStatus === "updating" ? "updating" : "not_reviewed";
  return { status: explicitStatus, verifiedPatch: verifiedPatch || null };
}
