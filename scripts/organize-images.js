#!/usr/bin/env node
/**
 * organize-images.js
 *
 * Run this on YOUR machine, on YOUR own image files. It never touches the
 * network and doesn't know or care what's inside the images — it just reads
 * filenames, compares them to the ids already in src/data/*.js, and copies
 * (never deletes) matches into the right public/assets folder with the
 * right name.
 *
 * USAGE:
 *   node scripts/organize-images.js path/to/your/folder-of-images
 *
 * If you skip the path, it defaults to a folder called "raw-images" in the
 * project root — so you can also just dump everything into
 * vanguard-academy/raw-images/ and run:
 *   node scripts/organize-images.js
 *
 * WHAT IT DOES:
 *   - Scans the source folder (recursively) for image files (.jpg .jpeg
 *     .png .webp .avif)
 *   - Normalizes each filename (lowercase, strips punctuation/spaces) and
 *     compares it against every known champion/item/rune id, also
 *     normalized the same way
 *   - On a match, COPIES (originals untouched) the file into
 *     public/assets/{champions|items|runes}/{id}.{original-extension}
 *   - Prints a clear report: what matched, what's still missing, and any
 *     files it couldn't confidently match to anything
 *
 * If a filename doesn't match cleanly (e.g. "80px-Eclipse_WR_item.png" vs
 * id "eclipse"), it still works — normalization strips the noise and looks
 * for the id as a contained substring, not an exact match.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const sourceDir = path.resolve(process.argv[2] || path.join(ROOT, "raw-images"));

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

const CHAMPION_IDS = [
  "alistar","bard","blitzcrank","braum","galio","gragas","janna","jarvan-iv","karma","leona",
  "lulu","lux","maokai","mel","milio","nami","nautilus","norra","ornn","poppy","pyke","rakan",
  "rell","senna","seraphine","sett","sona","soraka","swain","taliyah","thresh","yuumi","zilean","zyra",
];

const ITEM_IDS = [
  "abyssal-mask","amaranths-twinguard","archangels-staff","ardent-censer","awakened-soulstealer",
  "bandle-fantasy","black-cleaver","boots-of-dynamism","boots-of-mana","bramble-vest","cosmic-drive",
  "dawnshroud","dead-mans-plate","divine-sunderer","duskblade-of-draktharr","eclipse","edge-of-night",
  "essence-reaver","executioners-calling","forbidden-idol","force-of-nature","frozen-heart","galeforce",
  "glacial-shroud","harmonic-echo","heartsteel","hollow-radiance","iceborn-gauntlet","imperial-mandate",
  "infinity-orb","ionian-boots","kaenic-rookern","knights-vow","liandrys-torment","locket",
  "lord-dominiks-regards","ludens-echo","malignance","mercurys-treads","morellonomicon","mortal-reminder",
  "negatron-cloak","oblivion-orb","oceanids-trident","overlords-bloodmail","plated-steelcaps",
  "rabadons-deathcap","radiant-virtue","randuins-omen","redemption","rylais-crystal-scepter",
  "searing-crown","serpents-fang","serylda-grudge","spectres-cowl","staff-of-flowing-water",
  "stasis-enchant","stoneplate-enchant","sunfire-aegis","surging-scales","tear-of-the-goddess",
  "the-collector","thornmail","unending-despair","mikeal's-blessing","wardens-mail","warmogs-armor",
  "winters-approach","yordle-trap","youmuus-ghostblade","zekes-convergence","spellslinger's-shoes","chainlaced-crusher","armored-advance","armor-crusher-boots","crimson-lucidity",
  "Stormsurge","Banshee's Veil","Void Staff","Cryptobloom","Bloodletter's Curse","Blackfire Torch","Protobelt","LichBane",
];

const RUNE_IDS = [
  "absolute-focus","arcane-comet","axiom-arcanist","battle-zeal","bone-plating","botanist","brutal",
  "celerity","chain-assault","cheap-shot","conqueror","coup-de-grace","courage-of-the-colossus",
  "cut-down","dark-harvest","demolish","electrocute","empowered-attack","eyeball-collector",
  "first-strike","fleet-footwork","font-of-life","gathering-storm","grasp-of-the-undying","guardian",
  "hextech-flashtraption","hubris","ice-overlord","ingenious-hunter","ixtali-seedjar","last-stand",
  "legend-bloodline","legend-tenacity","manaflow-band","nimbus-cloak","nullifying-orb","overgrowth",
  "perseverance","phase-rush","relentless-hunter","revitalize","scorch","second-wind","sudden-impact",
  "summon-aery","transcendence","triumph","tyrant","unshakeable","zombie-ward",
];

const GROUPS = [
  { label: "champions", ids: CHAMPION_IDS, destFolder: "champions" },
  { label: "items", ids: ITEM_IDS, destFolder: "items" },
  { label: "runes", ids: RUNE_IDS, destFolder: "runes" },
];

function normalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function walkFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walkFiles(full));
    } else if (IMAGE_EXT.has(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

function main() {
  if (!fs.existsSync(sourceDir)) {
    console.error(`Source folder not found: ${sourceDir}`);
    console.error(`Create it, drop your images inside, and run this again — or pass a path:`);
    console.error(`  node scripts/organize-images.js "C:\\path\\to\\your\\images"`);
    process.exit(1);
  }

  const files = walkFiles(sourceDir);
  console.log(`Found ${files.length} image file(s) in ${sourceDir}\n`);

  const usedFiles = new Set();
  const report = { champions: [], items: [], runes: [] };

  for (const group of GROUPS) {
    const destDir = path.join(ROOT, "public", "assets", group.destFolder);
    fs.mkdirSync(destDir, { recursive: true });

    for (const id of group.ids) {
      const normId = normalize(id);
      const match = files.find((f) => {
        if (usedFiles.has(f)) return false;
        const base = normalize(path.basename(f, path.extname(f)));
        return base.includes(normId) || normId.includes(base);
      });

      if (match) {
        usedFiles.add(match);
        const ext = path.extname(match); // preserves .jpg/.png/.webp as-is
        const destPath = path.join(destDir, `${id}${ext}`);
        fs.copyFileSync(match, destPath);
        report[group.label].push({ id, source: path.relative(ROOT, match), status: "copied" });
      } else {
        report[group.label].push({ id, status: "missing" });
      }
    }
  }

  for (const group of GROUPS) {
    const found = report[group.label].filter((r) => r.status === "copied");
    const missing = report[group.label].filter((r) => r.status === "missing");
    console.log(`--- ${group.label} (${found.length}/${group.label === "champions" ? CHAMPION_IDS.length : group.label === "items" ? ITEM_IDS.length : RUNE_IDS.length} matched) ---`);
    if (found.length) {
      found.forEach((r) => console.log(`  ✓ ${r.id}  ←  ${r.source}`));
    }
    if (missing.length) {
      console.log(`  Missing (${missing.length}): ${missing.map((r) => r.id).join(", ")}`);
    }
    console.log("");
  }

  const unmatched = files.filter((f) => !usedFiles.has(f));
  if (unmatched.length) {
    console.log(`--- Files that didn't match anything (${unmatched.length}) ---`);
    unmatched.forEach((f) => console.log(`  ? ${path.relative(ROOT, f)}`));
    console.log(`\nRename these to match the id shown above (check src/data/*.js) and re-run.`);
  }
}

main();
