// Ability icon discovery -- the ONE place that knows how public/assets/abilities/ is laid out. Pure Node (fs + path), no dependencies.
//
//   public/assets/abilities/<champion-id>/<ability-slug>.<ext>
//
// Used at BUILD / DEV-SERVER time by the Vite plugin in vite.config.js (which turns the result into the `virtual:ability-assets` module the
// browser bundle imports) and by tests/abilityAssets.test.mjs. There is no filesystem lookup at runtime in the browser: the page only ever
// asks "is this slug in the index?", and an icon that is not in the index is simply not requested (the change still renders).
//
// Naming rules (the SAME slug function the rest of the project uses for ids -- src/utils/images.js slugify):
//   - champion folder  = the champion's id in src/data/champions.js  (senna, jarvan-iv, dr-mundo, ...)
//   - ability file     = slugify(the ability heading exactly as Riot writes it) + extension
//                        "Piercing Darkness" -> piercing-darkness.webp      "Disaster - Devastating Fire" -> disaster-devastating-fire.webp
//   - extension        = webp (recommended), png, jpg, jpeg or avif -- the same list the site's other images already use
// A file that breaks a rule is still indexed when it can be (so nothing silently disappears) but is reported in `problems`, which the
// dev server / build print as warnings and the test suite fails on.

import fs from "node:fs";
import path from "node:path";
import { slugify } from "../src/utils/images.js";

export const ABILITY_ASSET_DIR = "public/assets/abilities";
export const ABILITY_URL_BASE = "/assets/abilities";
/** Preference order when two files share a stem (e.g. both .webp and .png): the first wins. */
export const IMAGE_EXTENSIONS = ["webp", "png", "jpg", "jpeg", "avif"];

const IGNORED = /^(?:\.gitkeep|\.keep|readme(?:\.[a-z]+)?|thumbs\.db|\.ds_store)$/i;
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** @returns {{ index: Record<string, Record<string,string>>, problems: {kind:string, path:string, message:string}[], champions: string[] }} */
export function scanAbilityAssets(rootDir) {
  const base = path.join(rootDir, ABILITY_ASSET_DIR);
  const index = {}; const problems = []; const champions = [];
  if (!fs.existsSync(base)) return { index, problems, champions };
  const problem = (kind, p, message) => problems.push({ kind, path: p, message: `${p}: ${message}` });

  for (const dirent of fs.readdirSync(base, { withFileTypes: true }).sort(byName)) {
    if (!dirent.isDirectory()) {
      if (!IGNORED.test(dirent.name)) problem("file-in-root", dirent.name, "files must live inside a champion folder (public/assets/abilities/<champion-id>/)");
      continue;
    }
    const champ = dirent.name;
    champions.push(champ);
    if (champ !== slugify(champ)) problem("non-canonical-folder", champ, `champion folder must be the champion's id ("${slugify(champ)}")`);
    const files = fs.readdirSync(path.join(base, champ), { withFileTypes: true }).sort(byName);
    const byKey = new Map(); // slug -> [{ file, ext }]
    for (const f of files) {
      if (IGNORED.test(f.name)) continue;
      const rel = `${champ}/${f.name}`;
      if (!f.isFile()) { problem("nested-folder", rel, "no sub-folders: put the image directly in the champion folder"); continue; }
      const ext = path.extname(f.name).slice(1).toLowerCase();
      if (!IMAGE_EXTENSIONS.includes(ext)) { problem("unsupported-file", rel, `not an image type the site loads (${IMAGE_EXTENSIONS.join(", ")})`); continue; }
      const stem = path.basename(f.name, path.extname(f.name));
      const key = slugify(stem);
      if (!key) { problem("empty-name", rel, "file name has no usable letters or digits"); continue; }
      if (stem !== key || path.extname(f.name) !== `.${ext}`) problem("non-canonical-name", rel, `rename to "${key}.${ext}" (lowercase slug of the heading, no spaces)`);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ file: f.name, ext });
    }
    if (byKey.size) index[champ] = {};
    for (const [key, list] of [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      list.sort((a, b) => IMAGE_EXTENSIONS.indexOf(a.ext) - IMAGE_EXTENSIONS.indexOf(b.ext));
      if (list.length > 1) problem("duplicate", `${champ}/${key}`, `several files for the same ability (${list.map((l) => l.file).join(", ")}); using ${list[0].file}`);
      index[champ][key] = `${ABILITY_URL_BASE}/${champ}/${encodeURIComponent(list[0].file)}`;
    }
  }
  return { index, problems, champions };
}
