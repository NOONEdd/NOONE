// Patch Intelligence -- explicit lifecycle sections regression test.
// Plain Node ESM, no framework. Run directly:
//
//   node tests/patchLifecycleSections.test.mjs
//
// Regression for a confirmed bug found while validating real Patch 7.3:
// an "Items Removed" section whose explanatory prose happened to name a
// still-tracked item (Sunfire Aegis) produced NO report entry for the
// items it actually listed (Searing Crown, Surging Scales, Stinger) --
// they fell through both normal item-entry generation and the
// systemChanges fallback. Explicit section semantics (the heading + its
// bullet structure) must beat incidental entity mentions in prose.
// Fixtures below reproduce the STRUCTURE of Riot's real notes with
// paraphrased prose; no AI, no network.

import { parsePatchDocument } from '../functions/_lib/patchParser.js';
import { matchLifecycleTitle, extractLifecycleEntityNames, lifecycleNamesForUnit } from '../functions/_lib/patchLifecycle.js';
import { extractPatchNotes } from '../functions/_lib/patchNotesExtract.js';
import { initReview, deriveLegacyReport } from '../functions/_lib/patchNotesReview.js';
import { htmlToStructuredText } from '../functions/_lib/patchText.js';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS -', label); }
  else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail) : ''); }
}

const ITEM_ROSTER = [
  { id: 'sunfire-aegis', name: 'Sunfire Aegis', info: 'Burns nearby enemies.' },
  { id: 'ardent-censer', name: 'Ardent Censer', info: 'Enchants an ally.' },
];
const CHAMPION_ROSTER = [
  { id: 'senna', name: 'Senna', tier: 'A' },
  { id: 'hwei', name: 'Hwei', tier: 'B' },
];
const RUNE_ROSTER = [{ id: 'legend-haste', name: 'Legend: Haste', info: 'Ability haste from takedowns.' }];

// Ported 2026-09-30: runs the Patch Notes extractor (no planner/report builder any more) and exposes the
// lifecycle changes in the shape the original assertions were written against.
function run(text, { championRoster = CHAMPION_ROSTER, itemRoster = ITEM_ROSTER, runeRoster = RUNE_ROSTER } = {}) {
  const parsed = parsePatchDocument(text, { maxUnitChars: 12000 });
  const dataset = initReview(extractPatchNotes({ units: parsed.units, championRoster, itemRoster, runeRoster, patchVersion: '7.3', sourceUrl: null, extractedAt: '2026-09-30T00:00:00.000Z' }));
  const life = dataset.changes.filter((c) => c.lifecycle).map((c) => ({ name: c.entity.name, type: c.entity.type, id: c.entity.id, status: c.entity.status, action: c.lifecycle.action, comparisonState: c.comparisonState, ownership: c.ownership.source, section: c.provenance.sourcePath, source: c.originalSourceText, change: c }));
  return { dataset, life, parsed, report: deriveLegacyReport(dataset, { itemRoster, mode: 'draft' }), changes: dataset.changes };
}

// Structure copied from Riot's real notes: each top-level bullet is an
// explanation, the ACTUAL name sits one level deeper.
const ITEMS_REMOVED_753 = `## Item Adjustments

### Other Item Adjustments

#### Items Removed

- The jungle-only variant of Sunfire Aegis is no longer needed.
  - Searing Crown
- Surging Scales never found a clear identity.
  - Surging Scales
- Stinger lost its last remaining user.
  - Stinger`;

// =====================================================================
console.log('\n=== 1. One removed item is detected ===');
{
  const { life } = run(`## Item Adjustments\n\n#### Items Removed\n\n- Some explanation.\n  - Searing Crown`);
  check('Searing Crown has a lifecycle change', life.some((l) => l.name === 'Searing Crown'), life);
  check('action is "removed"', life[0] && life[0].action === 'removed');
  check('exactly one change for the one removed item', life.length === 1, life.map((l) => l.name));
}

console.log('\n=== 2. Multiple removed items are detected (real Patch 7.3 structure) ===');
{
  const { life } = run(ITEMS_REMOVED_753);
  const names = life.map((l) => l.name).sort();
  check('all three removed items have changes', JSON.stringify(names) === JSON.stringify(['Searing Crown', 'Stinger', 'Surging Scales']), names);
  check('every one is a "removed" lifecycle change', life.every((l) => l.action === 'removed'));
}

console.log('\n=== 3. An unrelated tracked item named in the explanatory prose never becomes the owner ===');
{
  const { life, changes, report } = run(ITEMS_REMOVED_753);
  check('Sunfire Aegis (mentioned only in prose) owns nothing', !changes.some((c) => c.entity && c.entity.name === 'Sunfire Aegis'));
  check('no removed item is attributed to Sunfire Aegis', life.every((l) => l.id !== 'sunfire-aegis'));
  check('the unit did not ALSO leak into systemChanges (no double-reporting)', report.systemChanges.length === 0, report.systemChanges);
}

console.log('\n=== 4. Correct REMOVED comparison state and traceability ===');
{
  const { life } = run(ITEMS_REMOVED_753);
  const e = life.find((l) => l.name === 'Searing Crown');
  check('comparisonState is REMOVED', e.comparisonState === 'REMOVED', e.comparisonState);
  check('ownership is lifecycle_block', e.ownership === 'lifecycle_block');
  check('id is null when the item is not tracked by Academy (not guessed); status UNMATCHED', e.id === null && e.status === 'UNMATCHED', e);
  check('source section preserves the Riot heading path', e.section === 'Item Adjustments > Other Item Adjustments > Items Removed', e.section);
  check('the explaining bullet is kept as the original source text', e.source.includes('jungle-only variant'));
}

console.log('\n=== 4b. A removed item that IS still in the roster resolves to its real id (exact-name, not fuzzy) ===');
{
  const { life } = run(`## Item Adjustments\n\n#### Items Removed\n\n- Ardent Censer is being retired.\n  - Ardent Censer`);
  const e = life.find((l) => l.action === 'removed');
  check('resolved to ardent-censer and EXISTING', e && e.id === 'ardent-censer' && e.status === 'EXISTING', e);
  check('still REMOVED', e && e.comparisonState === 'REMOVED', e);
}

console.log('\n=== 5. Duplicate merging still works ===');
{
  const text = `## Item Adjustments\n\n#### Items Removed\n\n- One.\n  - Stinger\n  - Stinger\n\n## Champion Adjustments\n\n### Senna\n\n- Base Health: 600 -> 570\n\n### Senna\n\n- Critical Rate: 15% -> 10%`;
  const { life, report } = run(text);
  check('a name listed twice yields ONE change (the second line is a recorded duplicate)', life.filter((l) => l.name === 'Stinger').length === 1 && life[0].change.duplicates.length === 1, life);
  const senna = report.championChanges.filter((c) => c.championId === 'senna');
  check('Senna across two units is still ONE entry', senna.length === 1, report.championChanges);
  check('both Senna facts survive', senna[0] && senna[0].whatChanged.includes('600') && senna[0].whatChanged.includes('15%'), senna[0] && senna[0].whatChanged);
}

console.log('\n=== 6. Bare "Removed" heading takes its kind from the nearest ancestor heading ===');
{
  check('matchLifecycleTitle: bare Removed under an Item ancestor -> item/removed', JSON.stringify(matchLifecycleTitle('Removed', ['Item Adjustments'])) === JSON.stringify({ kind: 'item', action: 'removed' }));
  check('matchLifecycleTitle: bare Removed under a Rune ancestor -> rune/removed', JSON.stringify(matchLifecycleTitle('Removed', ['RUNE ADJUSTMENTS'])) === JSON.stringify({ kind: 'rune', action: 'removed' }));
  check('matchLifecycleTitle: nearest ancestor wins', JSON.stringify(matchLifecycleTitle('Removed', ['Champion Adjustments', 'Marksman Item Adjustments'])) === JSON.stringify({ kind: 'item', action: 'removed' }));
  check('matchLifecycleTitle: bare Removed with NO kind ancestor is NOT claimed (never guesses)', matchLifecycleTitle('Removed', ['Battlefield Adjustments']) === null && matchLifecycleTitle('Removed', []) === null);
  check('matchLifecycleTitle: unrelated headings are not claimed', matchLifecycleTitle('Ardent Censer', ['Item Adjustments']) === null && matchLifecycleTitle('Items Adjusted', []) === null);
  const text = `## Item Adjustments\n\n#### Removed\n\n- Gone for good.\n  - Cloak of Agility`;
  const { life } = run(text);
  check('end-to-end: bare "Removed" section yields the removed item', life.some((l) => l.name === 'Cloak of Agility' && l.action === 'removed'), life);
  const marksman = run(`## Item Adjustments\n\n### Marksman Item Adjustments\n\n#### Removed\n\n- Gone.\n  - Magnetic Blaster`).life;
  check('bare "Removed" under Marksman Item Adjustments is kept (no category gate)', marksman.some((l) => l.name === 'Magnetic Blaster' && l.action === 'removed'), marksman);
}

console.log('\n=== 7. Analogous sections: Items Added, Runes Removed/Added, Champions Added/Removed ===');
{
  const items = run(`## Items\n\n#### New Items\n\n- Fresh.\n  - Bandleglass Mirror`).life;
  check('New Items -> item added, NEW_CANDIDATE, state NEW', items.some((l) => l.name === 'Bandleglass Mirror' && l.action === 'added' && l.status === 'NEW_CANDIDATE' && l.comparisonState === 'NEW'), items);
  const runesRemoved = run(`## Runes\n\n#### Runes Removed\n\n- Retired.\n  - Ingenious Hunter`).life;
  check('Runes Removed -> rune REMOVED', runesRemoved.some((l) => l.name === 'Ingenious Hunter' && l.type === 'rune' && l.comparisonState === 'REMOVED'), runesRemoved);
  const runesAdded = run(`## Runes\n\n#### New Runes\n\n- Introduced.\n  - Legend: Haste`).life;
  const lh = runesAdded.find((l) => l.name === 'Legend: Haste');
  check('New Runes -> rune added; a name containing a colon is still a name', lh && lh.comparisonState === 'NEW', runesAdded);
  check('and it resolved to the tracked rune id (exact-name match) as EXISTING', lh && lh.id === 'legend-haste' && lh.status === 'EXISTING', lh);
  const champsRemoved = run(`## Champions\n\n#### Champions Removed\n\n- Sunset.\n  - Old Champ`).life;
  check('Champions Removed -> champion REMOVED', champsRemoved.some((l) => l.name === 'Old Champ' && l.type === 'champion' && l.comparisonState === 'REMOVED'), champsRemoved);
  const { life: champsAdded, changes } = run(`## NEW\n\n### NEW CHAMPIONS\n\n#### Hwei\n\nHwei is a painter.`);
  const hwei = champsAdded.find((l) => l.id === 'hwei');
  check('New Champions > Hwei (sub-heading form) -> champion added, EXISTING', hwei && hwei.action === 'added' && hwei.status === 'EXISTING', champsAdded);
  check('the sub-heading form keeps Riot\'s own text as the original source', hwei && hwei.source.includes('painter'), hwei);
  check('exactly one Hwei change (not one from lifecycle plus one from normal extraction)', changes.filter((c) => c.entity && c.entity.id === 'hwei').length === 1, changes.map((c) => c.entity && c.entity.name));
}

console.log('\n=== 8. A lifecycle heading with NO extractable names is not claimed -- it can never become a new way to hide content ===');
{
  const text = `## Item Adjustments\n\n#### Items Removed\n\nNothing was removed in this patch.`;
  const { report, parsed } = run(text);
  check('no lifecycle entries invented', report.itemChanges.length === 0, report.itemChanges);
  const unit = parsed.units.find((u) => u.title === 'Items Removed');
  check('lifecycleNamesForUnit returns null (falls through to normal processing)', unit && lifecycleNamesForUnit(unit) === null, unit);
}

console.log('\n=== 9. Stat lines and sentences under a lifecycle heading are never mistaken for names ===');
{
  const unit = { title: 'New Items', headingPath: ['Items', 'New Items'], lines: ['- Price: 900', '- Ability Power: 20', '- Health: 100 -> 200', '- This item is great for supports.', '- Real Item Name'] };
  check('only the real name survives', JSON.stringify(extractLifecycleEntityNames(unit)) === JSON.stringify(['Real Item Name']), extractLifecycleEntityNames(unit));
  const nested = { title: 'Items Removed', headingPath: ['Items Removed'], lines: ['- Parent prose naming Sunfire Aegis.', '  - Real Removed Item'] };
  check('nested bullets beat top-level prose bullets', JSON.stringify(extractLifecycleEntityNames(nested)) === JSON.stringify(['Real Removed Item']), extractLifecycleEntityNames(nested));
  const flat = { title: 'Items Removed', headingPath: ['Items Removed'], lines: ['- Alpha Blade', '- Beta Shield'] };
  check('a flat list with no nesting uses its top-level bullets', JSON.stringify(extractLifecycleEntityNames(flat)) === JSON.stringify(['Alpha Blade', 'Beta Shield']), extractLifecycleEntityNames(flat));
}

console.log('\n=== 10. Production ingestion path: real HTML -> htmlToStructuredText -> parser -> lifecycle ===');
{
  const html = '<h2>Item Adjustments</h2><h4>Items Removed</h4><ul>' +
    '<li>The jungle-only variant of Sunfire Aegis is no longer needed.<ul><li>Searing Crown</li></ul></li>' +
    '<li>Stinger lost its last user.<ul><li>Stinger</li></ul></li></ul>';
  const { text } = htmlToStructuredText(html);
  const { life, changes } = run(text);
  const names = life.map((l) => l.name).sort();
  check('nested <ul> markup survives the real converter and yields both removed items', JSON.stringify(names) === JSON.stringify(['Searing Crown', 'Stinger']), { text, names });
  check('Sunfire Aegis still not misattributed on the production path', !changes.some((c) => c.entity && c.entity.name === 'Sunfire Aegis'));
}

console.log('\n=== 11. Non-lifecycle content is untouched by this pass ===');
{
  const text = `## Item Adjustments\n\n#### Ardent Censer\n\nHeal and Shield Power: 5% -> 8%\nPrice: 2700 -> 2400`;
  const { changes } = run(text);
  const cs = changes.filter((c) => c.entity && c.entity.id === 'ardent-censer');
  check('a normal item change still produces normal EXISTING changes (not lifecycle)', cs.length === 2 && cs.every((c) => !c.lifecycle && c.entity.status === 'EXISTING' && c.ownership.source === 'entity_heading'), cs.map((c) => c.ownership));
  check('with the real value pair', cs.some((c) => c.normalizedData.oldValue === '5%' && c.normalizedData.newValue === '8%'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
