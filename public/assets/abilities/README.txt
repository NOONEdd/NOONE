ABILITY ICONS FOR PATCH NOTES
=============================

Layout:   public/assets/abilities/<champion-id>/<ability-slug>.webp

  <champion-id>   the champion's id in src/data/champions.js (the folders already exist for every champion),
                  e.g. senna, hwei, swain, jarvan-iv, dr-mundo, nunu-willump
  <ability-slug>  the ability heading EXACTLY as Riot writes it in the patch notes, lower-case, words joined by "-",
                  apostrophes dropped, no spaces, no numbers added, no Q/W/E/R unless Riot's own heading has it:

      "Piercing Darkness"            ->  senna/piercing-darkness.webp
      "Dawning Shadow"               ->  senna/dawning-shadow.webp
      "Signature of the Visionary"   ->  hwei/signature-of-the-visionary.webp
      "Disaster - Devastating Fire"  ->  hwei/disaster-devastating-fire.webp

ABILITIES ONLY. Patch Notes asks for an icon only for a champion's ability-like sections (Riot's named ability blocks and explicit
"Passive - X" / "Q - X" headings). "Base Stats" and other non-ability sections (a champion mechanic, items, runes, system rows) never
look for an icon, so do not add files for them: a base-stats.webp would simply never be used -- unless a reviewer sets that section's "Icon / Visual" to Show
in the Patch Notes review panel (Auto = the section type's default; Show / Hide = the reviewer's explicit choice, display only).

Extension: .webp is the standard (png, jpg, jpeg and avif also work; if two exist for the same ability, webp wins).

Is dropping the file in enough?  YES. The dev server / `vite build` scans this folder (see vite.config.js and
scripts/abilityAssetIndex.mjs) and Patch Notes picks the icon up on the next page load. No manifest to edit.
The scan prints a warning for any misnamed file, and `node tests/abilityAssets.test.mjs` fails on it.

Missing image: the ability and its changes still render; a neutral placeholder icon is shown instead.

If Riot renames an ability but you keep the old file: add one line to ABILITY_ICON_ALIASES in src/data/abilityAssets.js
(or just rename the file to the new slug). Riot's heading is never changed by any of this.
