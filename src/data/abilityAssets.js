// Ability icons for Patch Notes -- the one place the browser bundle learns which icons exist.
//
// HOW AN ICON GETS FOUND (nothing to register for the normal case):
//   1. Put the image at   public/assets/abilities/<champion-id>/<ability-slug>.webp
//        <champion-id>   = the champion's id in src/data/champions.js            e.g. senna
//        <ability-slug>  = the ability heading exactly as Riot writes it, lower-cased, words joined by "-"
//                          "Piercing Darkness"           -> piercing-darkness.webp
//                          "Disaster - Devastating Fire" -> disaster-devastating-fire.webp
//   2. That's it. The Vite plugin in vite.config.js scans public/assets/abilities/ when the dev server starts (and on every added/removed
//      file) and when `vite build` runs, and hands the result to this module as `virtual:ability-assets`. No runtime file probing: an ability
//      with no file is not requested at all and shows a neutral placeholder, and its change text renders exactly the same.
//
// ONLY IF RIOT RENAMES AN ABILITY (the image on disk keeps its old name): add one alias line below, keyed by the champion id and the NEW
// Riot heading, pointing at the existing file's slug -- or just rename the file to the new slug. Neither touches Patch Notes data.

import discovered from "virtual:ability-assets";
import { createAbilityIconResolver } from "../lib/abilityIcons.js";

/** champion id -> { "Riot heading as written now": "slug of the file that already exists" }. Empty until a rename needs it. Example:
 *    senna: { "Piercing Darkness (Reworked)": "piercing-darkness" },
 */
export const ABILITY_ICON_ALIASES = {};

export const ABILITY_ICON_INDEX = discovered;
export const resolveAbilityIcon = createAbilityIconResolver(ABILITY_ICON_INDEX, ABILITY_ICON_ALIASES);
