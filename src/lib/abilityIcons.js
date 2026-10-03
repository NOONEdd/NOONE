// Ability icon resolution -- pure, deterministic, no I/O. Maps (champion id + the ability heading Riot wrote) to an image URL.
//
//   champion id          entry.championId (the Academy id: "senna", "jarvan-iv")
//   Riot ability heading the subsection's source heading, exactly as extracted ("Piercing Darkness", "Disaster - Devastating Fire")
//        -> slugify() -> "piercing-darkness"  -> index["senna"]["piercing-darkness"]  -> "/assets/abilities/senna/piercing-darkness.webp"
//
// `index` is what scripts/abilityAssetIndex.mjs found on disk at build time (see src/data/abilityAssets.js). Nothing here guesses a slot
// (Q/W/E/R), an order, or a name: only Riot's own wording is turned into a file name. A miss returns null -- callers MUST treat that as
// "no icon", never as "no ability": the change renders either way.

import { slugify } from "../utils/images.js";

export const abilitySlug = (name) => slugify(String(name == null ? "" : name));

/** Candidate file slugs for one ability, best first, without duplicates:
 *   1. an explicit alias for this exact Riot heading (src/data/abilityAssets.js ABILITY_ICON_ALIASES)
 *   2. the slug of the heading exactly as Riot wrote it ("e-unbreakable" for Riot's own slot notation "E - Unbreakable")
 *   3. the slug of the same name with Riot's slot notation removed, as the parser already extracted it ("unbreakable")
 *  so a file named after either spelling of the heading is found. */
export function abilityIconCandidates(championId, { sourceHeading, abilityName } = {}, aliases = {}) {
  const out = [];
  const add = (v) => { const s = abilitySlug(v); if (s && !out.includes(s)) out.push(s); };
  const forChampion = (aliases && aliases[championId]) || {};
  const headingSlug = abilitySlug(sourceHeading);
  for (const [riotName, fileSlug] of Object.entries(forChampion)) if (headingSlug && abilitySlug(riotName) === headingSlug) add(fileSlug);
  add(sourceHeading);
  add(abilityName);
  return out;
}

/** @param {Record<string, Record<string,string>>} index  champion id -> ability slug -> URL
 *  @param {Record<string, Record<string,string>>} [aliases]  champion id -> Riot heading -> ability slug (only for renamed abilities)
 *  @returns {(championId:string, names:{sourceHeading?:string, abilityName?:string}) => ({src:string, key:string}|null)} */
export function createAbilityIconResolver(index, aliases = {}) {
  const idx = index && typeof index === "object" ? index : {};
  return function resolveAbilityIcon(championId, names = {}) {
    const files = championId && idx[championId];
    if (!files) return null;
    for (const key of abilityIconCandidates(championId, names || {}, aliases)) {
      if (Object.prototype.hasOwnProperty.call(files, key)) return { src: files[key], key };
    }
    return null;
  };
}
