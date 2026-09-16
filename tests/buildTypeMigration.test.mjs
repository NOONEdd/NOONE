// Core/Situational KV migration -- regression test for
// src/lib/buildTypeClassifier.js and the AdminPage.jsx migration panel
// built on top of it. Plain Node ESM against the REAL exported functions,
// no test framework, no new dependency. Run directly:
//
//   node tests/buildTypeMigration.test.mjs
//
// Scope note: AdminPage.jsx itself is a React component and this project
// has no jsdom/@testing-library/react dependency (see
// patchIntelReanalyze.test.mjs's header for the same call) -- adding one
// just for this file isn't warranted. What actually needs proving about
// "BuildEditor still supports manual Core/Situational changes after
// migration" is a data-layer guarantee: a manually-set type must never be
// overwritten by a later migration run. That's covered directly below by
// feeding the classifier/migration an entry whose `type` was manually set
// to a value that DISAGREES with what its tag would otherwise suggest, and
// confirming it survives untouched -- which is exactly what a rerun after
// someone uses BuildEditor's toggle would look like.

import {
  classifyBuildEntryType,
  normalizeBuildEntries,
  planBuildTypeMigration,
  verifyAllEntriesTyped,
} from '../src/lib/buildTypeClassifier.js';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS -', label); }
  else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail) : ''); }
}

// ---------------------------------------------------------------------
console.log('\n-- classifyBuildEntryType: legacy entries with no type --');
check('bare "core" tag -> core', classifyBuildEntryType({ tag: 'Core', name: 'x' }) === 'core');
check('bare "situational" tag -> situational', classifyBuildEntryType({ tag: 'Situational', name: 'x' }) === 'situational');
check('typo "situatinal" -> situational', classifyBuildEntryType({ tag: 'situatinal', name: 'x' }) === 'situational');
check('typo "sitatuinal" -> situational', classifyBuildEntryType({ tag: 'sitatuinal', name: 'x' }) === 'situational');
check('typo "situatuinal" -> situational', classifyBuildEntryType({ tag: 'situatuinal', name: 'x' }) === 'situational');
check('"Rune Swap" tag -> situational', classifyBuildEntryType({ tag: 'Rune Swap', name: 'Bone Plating (swap for Second Wind)' }) === 'situational');
check('"Spell Swap" tag -> situational', classifyBuildEntryType({ tag: 'Spell Swap', name: 'Ignite (swap for Heal)' }) === 'situational');
check('"Boots vs AD" tag -> situational', classifyBuildEntryType({ tag: 'Boots vs AD', name: 'Plated Steelcaps' }) === 'situational');
check('"Boots vs AP" tag -> situational', classifyBuildEntryType({ tag: 'boots VS AP', name: "Mercury's Treads" }) === 'situational');
check('name says "(instead of X)" despite bare "Enchant" tag -> situational',
  classifyBuildEntryType({ tag: 'Enchant', name: 'Locket (instead of Mikael\'s Blessing)' }) === 'situational');
check('name says "(swap for X)" despite bare tag -> situational',
  classifyBuildEntryType({ tag: 'summoner spells', name: 'barrier ( swap for ignite)' }) === 'situational');

console.log('\n-- classifyBuildEntryType: approved per-entry batch rule for ambiguous categories --');
check('bare "Always" (mandatory mission item, no swap language) -> core',
  classifyBuildEntryType({ tag: 'Always', name: 'Relic Shield', note: 'Never skip this.' }) === 'core');
check('bare "Boots" (single default, no vs-AD/AP alt) -> core',
  classifyBuildEntryType({ tag: 'Boots', name: 'Ionian Boots of Lucidity', note: 'Default boots.' }) === 'core');
check('bare "Keystone" (sole keystone, no competing alt) -> core',
  classifyBuildEntryType({ tag: 'Keystone', name: 'Ice Overlord', note: 'Non-negotiable.' }) === 'core');
check('bare "Resolve" (default side of a swap pair) -> core',
  classifyBuildEntryType({ tag: 'Resolve', name: 'Second Wind', note: 'Swap to Bone Plating when the enemy has a burst combo.' }) === 'core');
check('bare "Domination" minor-slot pick -> core',
  classifyBuildEntryType({ tag: 'Domination', name: 'Zombie Ward', note: 'Gives vision and AP.' }) === 'core');
check('bare "Inspiration" pick with no swap language -> core',
  classifyBuildEntryType({ tag: 'Inspiration', name: 'Transcendence', note: 'Ability haste at levels 1 and 6.' }) === 'core');
check('bare "Summoner Spells" default combo -> core',
  classifyBuildEntryType({ tag: 'Summoner Spells', name: 'Flash + Heal', note: 'Default setup.' }) === 'core');
check('bare "Enchant" with an explicit Default note -> core',
  classifyBuildEntryType({ tag: 'Enchant', name: "Mikael's Blessing", note: 'Default enchant.' }) === 'core');
check('bare "Precision" single pick -> core',
  classifyBuildEntryType({ tag: 'Precision', name: 'Brutal', note: 'Small amount of damage.' }) === 'core');
check('data-entry slip (tag == item\'s own name) with mandatory-item note -> core',
  classifyBuildEntryType({ tag: ' relic shield', name: 'Relic Shield', note: 'Never skip this.' }) === 'core');

console.log('\n-- classifyBuildEntryType: existing valid type always wins --');
check('existing "core" is preserved even if tag says situational',
  classifyBuildEntryType({ tag: 'Situational', name: 'x', type: 'core' }) === 'core');
check('existing "situational" is preserved even if tag says core',
  classifyBuildEntryType({ tag: 'Core', name: 'x', type: 'situational' }) === 'situational');
check('a manually-set type (simulating a BuildEditor toggle) always wins over the classifier',
  classifyBuildEntryType({ tag: 'Always', name: 'Relic Shield', type: 'situational' }) === 'situational');

// ---------------------------------------------------------------------
console.log('\n-- normalizeBuildEntries: shape and reference-stability --');
{
  const build = {
    name: 'Standard Enchanter',
    items: [
      { tag: 'Always', name: 'Relic Shield', note: 'n' },
      { tag: 'Situational', name: 'Banshee\'s Veil', note: 'n' },
    ],
    runes: [
      { tag: 'Keystone', name: 'Summon Aery', note: 'n' },
      { tag: 'Rune Swap', name: 'Perseverance (swap for Revitalize)', note: 'n' },
    ],
  };
  const result = normalizeBuildEntries(build);
  check('reports changed = true when entries needed typing', result.changed === true);
  check('itemsChanged counts exactly the 2 item entries', result.itemsChanged === 2);
  check('runesChanged counts exactly the 2 rune entries', result.runesChanged === 2);
  check('coreCount is 2 (Relic Shield, Summon Aery)', result.coreCount === 2, result.coreCount);
  check('situationalCount is 2 (Banshee\'s Veil, Perseverance swap)', result.situationalCount === 2, result.situationalCount);
  check('original build object is not mutated', build.items[0].type === undefined);
  check('ordering preserved: item 0 still Relic Shield', result.build.items[0].name === 'Relic Shield');
  check('ordering preserved: item 1 still Banshee\'s Veil', result.build.items[1].name === "Banshee's Veil");
  check('ordering preserved: rune 0 still Summon Aery', result.build.runes[0].name === 'Summon Aery');
  check('tag untouched on a normalized entry', result.build.items[0].tag === 'Always');
  check('note untouched on a normalized entry', result.build.items[0].note === 'n');

  const already = { name: 'x', items: [{ tag: 'Core', name: 'y', type: 'core' }], runes: [] };
  const r2 = normalizeBuildEntries(already);
  check('a build with everything already typed reports changed = false', r2.changed === false);
  check('an unchanged build returns the SAME object reference (cheap no-op)', r2.build === already);
}

// ---------------------------------------------------------------------
console.log('\n-- planBuildTypeMigration: full scenario --');
{
  const overridesChampions = {
    // real champion, legacy entries, no type anywhere
    galio: {
      tier: 'A',
      note: 'Excellent at engaging and disengaging.',
      matchupRelations: { hardAgainst: [{ championId: 'nami', difficulty: 'high' }] },
      builds: [
        {
          name: 'tanky support',
          items: [
            { tag: 'always', name: 'Relic Shield', note: 'mission item' },
            { tag: 'situational', name: "Randuin's Omen", note: 'anti-crit' },
          ],
          runes: [
            { tag: 'Keystone', name: 'Ice Overlord', note: 'non-negotiable' },
            { tag: 'Rune Swap', name: 'Bone Plating (swap for Second Wind)', note: 'vs burst' },
          ],
        },
      ],
    },
    // real champion, ALREADY fully typed -- must be left alone entirely
    lulu: {
      tier: 'S',
      builds: [
        {
          name: 'Standard',
          items: [{ tag: 'Core', name: 'Staff of Flowing Water', note: 'n', type: 'core' }],
          runes: [{ tag: 'Resolve', name: 'Font of Life', note: 'n', type: 'core' }],
        },
      ],
    },
    // real champion, no builds override at all -- must be skipped entirely
    thresh: { matchupRelations: {} },
    // stale/orphaned key -- does not match any real champion id
    Morgana: {
      builds: [{ name: 'x', items: [{ tag: 'Core', name: 'Rabadon\'s Deathcap', note: 'n' }], runes: [] }],
    },
  };
  const validChampionIds = new Set(['galio', 'lulu', 'thresh', 'morgana', 'milio']);

  const plan1 = planBuildTypeMigration(overridesChampions, validChampionIds);

  check('exactly one champion needs changes (galio)', plan1.champions.length === 1, plan1.champions.map((c) => c.id));
  check('galio items changed = 2', plan1.champions[0]?.itemsChanged === 2);
  check('galio runes changed = 2', plan1.champions[0]?.runesChanged === 2);
  check('galio core count = 2 (Relic Shield, Ice Overlord)', plan1.champions[0]?.coreCount === 2);
  check('galio situational count = 2 (Randuin\'s Omen, Bone Plating swap)', plan1.champions[0]?.situationalCount === 2);
  check('stale "Morgana" key reported separately, not in champions to write', plan1.staleKeys.some((s) => s.id === 'Morgana'));
  check('stale "Morgana" key NOT present in champions-to-write list', !plan1.champions.some((c) => c.id === 'Morgana'));
  check('lulu (already fully typed) produces no change', !plan1.champions.some((c) => c.id === 'lulu'));
  check('thresh (no builds override) produces no change', !plan1.champions.some((c) => c.id === 'thresh'));
  check('totals match per-champion sums', plan1.totals.itemsChanged === 2 && plan1.totals.runesChanged === 2);

  // Unrelated fields on the untouched raw override object survive --
  // planBuildTypeMigration never mutates its input, so this is really a
  // "never mutates" check, but it's the exact concern the safety
  // requirement is about.
  check('galio\'s raw override.tier/.note/.matchupRelations are untouched by planning',
    overridesChampions.galio.tier === 'A' &&
    overridesChampions.galio.note === 'Excellent at engaging and disengaging.' &&
    overridesChampions.galio.matchupRelations.hardAgainst[0].championId === 'nami');

  // Simulate Apply: merge plan1's newBuilds into the override map the way
  // AdminPage.jsx's handleApplyMigration does, preserving every other field.
  const afterApply = { ...overridesChampions };
  for (const c of plan1.champions) {
    afterApply[c.id] = { ...afterApply[c.id], builds: c.newBuilds };
  }
  check('after apply, galio.tier survives unchanged', afterApply.galio.tier === 'A');
  check('after apply, galio.note survives unchanged', afterApply.galio.note === 'Excellent at engaging and disengaging.');
  check('after apply, galio.matchupRelations survives unchanged',
    afterApply.galio.matchupRelations.hardAgainst[0].championId === 'nami');
  check('after apply, galio item ORDER is unchanged (Relic Shield still first)',
    afterApply.galio.builds[0].items[0].name === 'Relic Shield');
  check('after apply, galio rune ORDER is unchanged (Ice Overlord still first)',
    afterApply.galio.builds[0].runes[0].name === 'Ice Overlord');
  check('after apply, galio\'s "tag" fields are completely untouched (AI Coach grounding depends on this)',
    afterApply.galio.builds[0].items[0].tag === 'always' &&
    afterApply.galio.builds[0].items[1].tag === 'situational' &&
    afterApply.galio.builds[0].runes[0].tag === 'Keystone' &&
    afterApply.galio.builds[0].runes[1].tag === 'Rune Swap');
  check('after apply, galio entries now carry the expected type',
    afterApply.galio.builds[0].items[0].type === 'core' &&
    afterApply.galio.builds[0].items[1].type === 'situational' &&
    afterApply.galio.builds[0].runes[0].type === 'core' &&
    afterApply.galio.builds[0].runes[1].type === 'situational');
  check('Morgana (stale) was never written and is byte-identical to the original',
    JSON.stringify(afterApply.Morgana) === JSON.stringify(overridesChampions.Morgana));

  const invalidAfter = verifyAllEntriesTyped(afterApply, validChampionIds);
  check('verification finds zero untyped entries among real champions after apply', invalidAfter.length === 0, invalidAfter);

  // --- idempotency: running the plan again against the post-apply state
  const plan2 = planBuildTypeMigration(afterApply, validChampionIds);
  check('running the migration a second time finds ZERO champions needing changes', plan2.champions.length === 0, plan2.champions);
  check('a second run would perform zero updateOverride calls (writesQueued would be 0)', plan2.champions.length === 0);
}

// ---------------------------------------------------------------------
console.log('\n-- Full-scale sanity check against the real audited rule --');
{
  // A representative slice of the actual ambiguous rune-tree categories
  // from the live audit, each checked against the approved per-entry rule.
  const cases = [
    ['Resolve', 'Courage of the Colossus', 'core'],   // fixed pick, no alt offered anywhere
    ['Resolve', 'Overgrowth', 'core'],                // default side of a swap pair (Perseverance is the alt, already tagged Rune Swap)
    ['Domination', 'Chain Assault', 'core'],
    ['Inspiration', 'Hextech Flashtraption', 'core'],
    ['Summoner Spells', 'Flash + Ignite', 'core'],
    ['Rune Swap', 'Perseverance (swap for Overgrowth)', 'situational'],
    ['Spell Swap', 'Ignite (swap for Heal)', 'situational'],
  ];
  for (const [tag, name, expected] of cases) {
    check(`"${tag}" / "${name}" -> ${expected}`, classifyBuildEntryType({ tag, name, note: '' }) === expected);
  }
}

console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
