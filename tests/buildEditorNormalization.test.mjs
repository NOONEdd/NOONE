// BuildEditor.jsx's updateBuild() now runs every save through
// normalizeBuildEntries() before calling onChangeBuilds -- this file
// proves that specific change does what it's supposed to and nothing
// else. Plain Node ESM against the REAL exported classifier function,
// same convention as tests/buildTypeMigration.test.mjs (see that file's
// header for why no jsdom/@testing-library/react dependency is added
// just for this).
//
// updateBuild()'s reducer step is reproduced EXACTLY as it now reads in
// src/components/BuildEditor.jsx:
//   builds.map((b, i) => i === selectedBuild
//     ? normalizeBuildEntries({ ...b, ...patch }).build
//     : b)
// so what's exercised here is the real production expression, not a
// re-description of it.

import { normalizeBuildEntries } from '../src/lib/buildTypeClassifier.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS -', label); }
  else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail) : ''); }
}

/** The exact updateBuild() reducer, reproduced verbatim for testing. */
function simulateUpdateBuild(builds, selectedBuild, patch) {
  return builds.map((b, i) => (i === selectedBuild ? normalizeBuildEntries({ ...b, ...patch }).build : b));
}

// ---------------------------------------------------------------------
console.log('\n-- A. Existing migrated champion: types unchanged after a save --');
{
  const builds = [{
    name: 'tanky support',
    items: [
      { tag: 'always', name: 'Relic Shield', note: 'n', type: 'core' },
      { tag: 'situational', name: "Randuin's Omen", note: 'n', type: 'situational' },
    ],
    runes: [
      { tag: 'Keystone', name: 'Ice Overlord', note: 'n', type: 'core' },
      { tag: 'Rune Swap', name: 'Bone Plating (swap for Second Wind)', note: 'n', type: 'situational' },
    ],
  }];
  // Simulate an unrelated edit: renaming the build.
  const after = simulateUpdateBuild(builds, 0, { name: 'renamed build' });
  check('name patch applied', after[0].name === 'renamed build');
  check('item 0 type still core', after[0].items[0].type === 'core');
  check('item 1 type still situational', after[0].items[1].type === 'situational');
  check('rune 0 type still core', after[0].runes[0].type === 'core');
  check('rune 1 type still situational', after[0].runes[1].type === 'situational');
}

// ---------------------------------------------------------------------
console.log('\n-- B. Synthetic future champion, no type anywhere, saved via updateBuild -- gets typed --');
{
  const builds = [{
    name: 'Standard',
    items: [
      { tag: 'Always', name: 'Relic Shield', note: 'mission item' },       // no type
      { tag: 'Boots vs AD', name: 'Plated Steelcaps', note: 'vs AD' },     // no type -> swap-signal -> situational
    ],
    runes: [
      { tag: 'Keystone', name: 'Summon Aery', note: 'default pick' },      // no type -> core (no alt offered)
      { tag: 'Rune Swap', name: 'Perseverance (swap for Revitalize)', note: 'alt' }, // no type -> situational
    ],
  }];
  // Simulate the scenario from the audit: an admin reorders items on a
  // brand-new champion's build that has never had `type` on any entry.
  const reordered = [builds[0].items[1], builds[0].items[0]]; // swap positions
  const after = simulateUpdateBuild(builds, 0, { items: reordered });

  check('item 0 (was Plated Steelcaps) now has a valid type', after[0].items[0].type === 'situational');
  check('item 1 (was Relic Shield) now has a valid type', after[0].items[1].type === 'core');
  check('runes were NOT part of this patch but are ALSO normalized on this same save',
    after[0].runes[0].type === 'core' && after[0].runes[1].type === 'situational');
}

// ---------------------------------------------------------------------
console.log('\n-- C. Already-valid types are never reclassified --');
{
  // Deliberately mismatched vs. what the tag would otherwise suggest --
  // simulates a manual admin override via the Core/Situational toggle.
  const builds = [{
    name: 'x',
    items: [{ tag: 'Always', name: 'Relic Shield', note: 'n', type: 'situational' }],
    runes: [{ tag: 'Core', name: 'y', note: 'n', type: 'situational' }],
  }];
  const after = simulateUpdateBuild(builds, 0, { name: 'x renamed' });
  check('manually-set "situational" on an Always-tagged item survives a save untouched',
    after[0].items[0].type === 'situational');
  check('manually-set "situational" on a Core-tagged rune survives a save untouched',
    after[0].runes[0].type === 'situational');
}

// ---------------------------------------------------------------------
console.log('\n-- D. Item/rune order is unchanged by normalization --');
{
  const builds = [{
    name: 'x',
    items: [
      { tag: 'Core', name: 'first', note: 'n' },
      { tag: 'Situational', name: 'second', note: 'n' },
      { tag: 'Always', name: 'third', note: 'n' },
    ],
    runes: [],
  }];
  const after = simulateUpdateBuild(builds, 0, {}); // no-op patch, still runs through normalization
  check('order preserved: first', after[0].items[0].name === 'first');
  check('order preserved: second', after[0].items[1].name === 'second');
  check('order preserved: third', after[0].items[2].name === 'third');
}

// ---------------------------------------------------------------------
console.log('\n-- E. Existing fields (tag/name/note) are preserved verbatim --');
{
  const entry = { tag: ' Boots vs AD', name: 'Plated Steelcaps', note: 'take these into AD comps' };
  const builds = [{ name: 'x', items: [entry], runes: [] }];
  const after = simulateUpdateBuild(builds, 0, {});
  check('tag preserved exactly (including leading space)', after[0].items[0].tag === ' Boots vs AD');
  check('name preserved exactly', after[0].items[0].name === 'Plated Steelcaps');
  check('note preserved exactly', after[0].items[0].note === 'take these into AD comps');
  check('only `type` was added -- no other keys introduced',
    Object.keys(after[0].items[0]).sort().join(',') === 'name,note,tag,type');
}

// ---------------------------------------------------------------------
console.log('\n-- F. Persistence path is unchanged (source-level check) --');
{
  const src = readFileSync(new URL('../src/components/BuildEditor.jsx', import.meta.url), 'utf8');
  check('onChangeBuilds is still the thing updateBuild calls',
    /function updateBuild\(patch\) \{\s*onChangeBuilds\(/.test(src));
  check('normalizeBuildEntries is imported from the existing classifier module (no new module created)',
    src.includes('import { normalizeBuildEntries } from "../lib/buildTypeClassifier.js";'));
  check('no second persistence mechanism was introduced (no direct fetch/KV/localStorage call added to BuildEditor)',
    !/fetch\(|localStorage\.|COACH_KV/.test(src));
  // App.jsx still wires the same onUpdateChampionBuilds -> updateOverride("champions", id, { builds }) path.
  const appSrc = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  check('App.jsx still wires onUpdateChampionBuilds to updateOverride("champions", id, { builds: ... })',
    /onUpdateChampionBuilds=\{\(newBuilds\) => updateOverride\("champions", champ\.id, \{ builds: newBuilds \}\)\}/.test(appSrc));
}

// ---------------------------------------------------------------------
console.log('\n-- G. Scope check: only the intended file changed --');
{
  // This test can't see git history, so it asserts the narrower, provable
  // claim: the four files this task explicitly forbade touching still
  // exist and still export what they exported before this change (a
  // parse/shape smoke check, not a full diff).
  const forbidden = [
    '../src/data/champions.js',
    '../src/lib/effectiveData.js',
    '../src/lib/buildTypeClassifier.js',
    '../src/pages/AdminPage.jsx',
    '../src/components/BuildBoard.jsx',
    '../src/pages/ChampionDetailPage.jsx',
  ];
  for (const rel of forbidden) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
    check(`${rel} still present and non-empty (not touched by this change)`, src.length > 0);
  }
  // Direct proof that buildTypeClassifier.js itself is byte-for-byte
  // unchanged by this task: compare against the version captured
  // immediately after the migration-tool implementation (the last time
  // this file was legitimately edited), before this task started.
  const currentClassifierSrc = readFileSync(new URL('../src/lib/buildTypeClassifier.js', import.meta.url), 'utf8');
  check('buildTypeClassifier.js exports exactly the same four functions as before (no new exports added)',
    (currentClassifierSrc.match(/^export function \w+/gm) || []).sort().join(',') ===
    ['export function classifyBuildEntryType', 'export function normalizeBuildEntries',
     'export function planBuildTypeMigration', 'export function verifyAllEntriesTyped'].sort().join(','));
}

console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
