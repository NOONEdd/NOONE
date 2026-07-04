// Image lookup — this project intentionally does NOT ship any Wild Rift
// artwork. Every champion/item/rune image is referenced by a plain local
// path under /public/assets/{champions,items,runes}/{id}, with the actual
// file extension auto-detected at runtime by <SmartImage /> (tries webp,
// jpg, jpeg, png, avif in order until one exists).
//
// To add real images: source them yourself (official Wild Rift channels,
// the wiki, or your own screenshots — see Riot's fan content policy) and
// drop them into the matching folder using the exact id below, any of the
// supported extensions. Nothing else needs to change, ever — no code edit
// needed regardless of format, now or for anything you add later.
//
// If no matching file exists in any format, <SmartImage /> renders nothing
// and the stylized icon underneath it stays visible automatically.

const FOLDER_BY_TYPE = { c: "champions", i: "items", r: "runes" };

/** Returns the extension-less base path for a given "type:id" key, e.g.
 *  basePath("i:eclipse") -> "/assets/items/eclipse"
 *  Pass this straight into <SmartImage basePath={...} />. */
export function basePath(key) {
  const [type, id] = key.split(":");
  const folder = FOLDER_BY_TYPE[type];
  if (!folder || !id) return null;
  return `/assets/${folder}/${id}`;
}

