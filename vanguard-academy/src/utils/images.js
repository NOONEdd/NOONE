// Image lookup — this project intentionally does NOT ship any Wild Rift
// artwork. Every champion/item/rune image is referenced by a plain local
// path under /public/assets/{champions,items,runes}/{id}.{ext}.
//
// To add real images: source them yourself (official Wild Rift channels,
// the wiki, or your own screenshots — see Riot's fan content policy) and
// drop them into the matching folder using the exact id below. Nothing
// else needs to change — the path already resolves once the file exists.
//
// If a file isn't present, components fall back to a stylized icon
// automatically (see RankChip.jsx / BuildList.jsx onError handling).

const FOLDER_BY_TYPE = { c: "champions", i: "items", r: "runes" };
const EXT_BY_TYPE_ID = {
  // Populate here if a specific asset uses a non-.jpg extension, e.g.:
  // "i:eclipse": "png",
};

export function imgPath(key) {
  const [type, id] = key.split(":");
  const folder = FOLDER_BY_TYPE[type];
  if (!folder || !id) return null;
  const ext = EXT_BY_TYPE_ID[key] || "jpg";
  return `/assets/${folder}/${id}.${ext}`;
}
