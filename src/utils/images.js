// Image lookup — this project intentionally does NOT ship any Wild Rift
// artwork. Every champion/item/rune/spell image is referenced by a plain
// local path under /public/assets/{champions,items,runes,spells}/, with the
// actual file extension auto-detected at runtime by <SmartImage /> (tries
// webp, jpg, jpeg, png, avif in order until one exists).
//
// To add real images: source them yourself (official Wild Rift channels,
// the wiki, or your own screenshots — see Riot's fan content policy) and
// drop them into the matching folder. The MOST RELIABLE filename is always
// the exact id shown in src/data/*.js (e.g. "lord-dominiks-regards.webp").
//
// That said, files sourced directly from the wiki or other sites rarely
// come pre-named that way — wikis often use a different display name
// entirely (the rune "Summon Aery" is filed on the wiki as just "Aery"),
// and manual downloads often carry extra junk ("80px-Eclipse_WR_item.png")
// or small typos. Rather than fail silently on every variant, each id below
// can list ALIASES — alternate filename stems that get tried too, in order,
// before giving up and showing the fallback icon.

const FOLDER_BY_TYPE = { c: "champions", i: "items", r: "runes", s: "spells" };

/** Turns a display name into the same id format used throughout the data
 *  files — e.g. "Serylda's Grudge" -> "serylda-grudge" (apostrophes are
 *  dropped outright, not turned into a stray hyphen; everything else
 *  collapses to single hyphens). Use this anywhere an id needs to be
 *  derived from a name instead of read directly from data. */
export function slugify(name) {
  return name
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Coach notes often write entries like "Perseverance (swap for Revitalize)"
 *  or "Locket (instead of Veil)" — the parenthetical is guidance for the
 *  reader, not part of the actual item/rune name. Strip it before trying
 *  to resolve an id from the name, or it poisons the match. */
export function stripAnnotation(name) {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Resolves a hand-written name (e.g. "Locket" or "Ionian Boots of
 *  Lucidity") to the real id used in the canonical items/runes list, so
 *  build entries don't need an explicit `id` field to display correctly.
 *  Tries, in order: exact match, then substring match in either
 *  direction (covers shorthand like "Locket" matching "Locket of the
 *  Iron Solari"). Falls back to a plain slugify of the cleaned name if
 *  nothing in the list matches, so behavior never gets worse than before. */
export function findCanonicalId(rawName, canonicalList) {
  const cleaned = stripAnnotation(rawName);
  const normalized = cleaned.toLowerCase();
  const exact = canonicalList.find((c) => c.name.toLowerCase() === normalized);
  if (exact) return exact.id;
  const partial = canonicalList.find((c) => {
    const cName = c.name.toLowerCase();
    return cName.includes(normalized) || normalized.includes(cName);
  });
  if (partial) return partial.id;
  return slugify(cleaned);
}

// Known alternate names/filenames for specific ids — covers cases where the
// wiki's own filename differs from the display name used on this site, or
// where a manually-downloaded file is likely to carry a different stem.
// Add to this any time a real image still won't show up under the plain id.
const ALIASES = {
  "i:relic-shield": ["relic_shield", "relicshield"],
  "i:essence-reaver": ["essence_reaver", "essencereaver"],
  "r:eyeball-collector": ["eyeball-collection", "eyeball_collection", "eyeballcollection"], // wiki files this rune as "Eyeball Collection"
  "i:serylda-grudge": ["seryldas-grudge", "serylda_s_grudge", "seryldasgrudge", "seryldas_grudge"],
  "r:summon-aery": ["aery"], // wiki files this rune as just "Aery"
  "i:eclipse": ["80px-eclipse_wr_item", "80px-Eclipse_WR_item"],
  "i:lord-dominiks-regards": ["lord_dominc_s_regard", "lord-dominiks-regard", "lorddominiksregards", "lord_dominiks_regards"],
  "i:hollow-radiance": ["hallow-radiance", "hallow_radiance", "hallow radiance"], // common misspelling on the source file
  "i:heartsteel": ["80px-heartsteel_wr_item", "80px-Heartsteel_WR_item"],
  "i:boots-of-dynamism": ["boots_of_dynamism", "bootsofdynamism"],
  "i:negatron-cloak": ["negatron_cloack", "negatroncloack", "negatron-cloack"], // common misspelling on the source file
  "r:hextech-flashtraption": ["hexflash", "hextechflash", "hextech-flash"], // wiki files this rune as just "Hexflash"
  "i:overlords-bloodmail": ["overlord_s_bloodmail", "overlords_bloodmail"],
  "i:wardens-mail": ["warden_s_mail", "wardens_mail"],
  "i:glacial-shroud": ["glacial_shroud"],
  "i:surging-scales": ["surging_scales"],
  "i:executioners-calling": ["80px-executioner_s_calling_wr_item", "executioners_calling"],
  "i:forbidden-idol": ["80px-forbidden_idol_wr_item"],
  "i:oblivion-orb": ["80px-oblivion_orb_wr_item"],
  "i:searing-crown": ["80px-searing_crown_wr_item"],
  "i:spectres-cowl": ["80px-spectre_s_cowl_wr_item", "spectres_cowl"],
  "i:tear-of-the-goddess": ["80px-tear_of_the_goddess_wr_item", "tear_of_the_goddess"],
  "i:stormsurge": ["storm_surge", "stormsurge"],
  "i:mikeal's-blessing": ["mikeal's-blessing", "mikeal's-blessing"],
  "i:banshee's-veil": ["banshee's-veil", "banshees-veil"],
  "i:cryptobloom": ["cryptobloom"],
  "i:bloodletter's-curse": ["bloodletter's-curse", "bloodletters-curse"],
  "i:blackfire-torch": ["blackfire-torch", "blackfiretorch"],
  "i:armored-advance": ["armored-advance", "armoredadvance"],
  "i:armor-crusher-boots": ["armor-crusher-boots", "armorcrusherboots"],
  "i:crimson-lucidity": ["crimson-lucidity", "crimsonlucidity"],
  "i:void-staff": ["void-staff", "voidstaff"],
  "i:chainlaced-crusher": ["chainlaced-crusher", "chainlacedcrusher"],
  "i:spellslinger's-shoes": ["spellslinger's-shoes", "spellslinger's-shoes"],
};

/** Given a lowercase-hyphenated stem, generates the handful of capitalization
 *  patterns a person is most likely to have actually used when naming a
 *  file by hand — since Cloudflare's Linux-based hosting treats "eclipse"
 *  and "Eclipse" as two entirely different files, even though Windows
 *  (where these files are usually prepared) does not draw that
 *  distinction, so the mismatch is invisible until it's already deployed. */
function caseVariants(stem) {
  const words = stem.split(/[-_]/).filter(Boolean);
  if (words.length === 0) return [];
  const sep = stem.includes("_") ? "_" : "-";
  const titleWords = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return [
    stem, // as-is
    titleWords.join(sep), // Title_Case or Title-Case, matching whichever separator the stem used
    titleWords.join(" "), // Title Case With Spaces
    titleWords.join(""), // PascalCaseNoSeparator
    words[0].charAt(0).toUpperCase() + words[0].slice(1) + words.slice(1).join(""), // just the first word capitalized
  ];
}

/** Returns an ARRAY of extension-less base paths to try in order for a
 *  given "type:id" key — the canonical id and its known aliases, each
 *  expanded into likely capitalization variants, in roughly most-to-least
 *  likely order. SmartImage tries every one of these against every
 *  supported extension before falling back to the icon. e.g.
 *  candidatePaths("i:eclipse") -> ["/assets/items/eclipse", "/assets/items/Eclipse", ...]
 */
export function candidatePaths(key) {
  const [type, id] = key.split(":");
  const folder = FOLDER_BY_TYPE[type];
  if (!folder || !id) return [];
  const baseStems = [id, ...(ALIASES[key] || [])];
  const allStems = [];
  const seen = new Set();
  for (const stem of baseStems) {
    for (const variant of caseVariants(stem)) {
      if (!seen.has(variant)) {
        seen.add(variant);
        allStems.push(variant);
      }
    }
  }
  return allStems.map((stem) => `/assets/${folder}/${stem}`);
}

// Kept for any code that still expects a single path — returns just the
// first (canonical) candidate. Prefer candidatePaths() for new code since
// it also tries known aliases.
export function basePath(key) {
  const paths = candidatePaths(key);
  return paths.length ? paths[0] : null;
}


