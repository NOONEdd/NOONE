// Patch Intelligence -- patchChangeDetector.js / patchPlanner.js's
// relevance gate regression test (2026-09-23 deterministic-first
// refactor). Plain Node ESM, no framework. Run directly:
//
//   node tests/patchDeterministicFacts.test.mjs

import {
  extractDeterministicFacts,
  formatFacts,
  overlayDeterministicFacts,
  detectAddedOrRemovedSignal,
  compareItemInfoToPatch,
} from '../functions/_lib/patchChangeDetector.js';
import { planPatchAnalysis } from '../functions/_lib/patchPlanner.js';
import { parsePatchDocument } from '../functions/_lib/patchParser.js';
import { htmlToStructuredText } from '../functions/_lib/patchText.js';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS -', label); }
  else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail) : ''); }
}

const championRoster = [
  { id: 'leona', name: 'Leona', role: 'Support', tier: 'S' },
  { id: 'rakan', name: 'Rakan', role: 'Support', tier: 'B' },
];
const itemRoster = [
  { id: 'ardent-censer', name: 'Ardent Censer', category: 'Enchant', tier: 'A', info: 'Grants 15 Ability Power and 200 Health. Total cost 2400.' },
];
const runeRoster = [];

// ---------------------------------------------------------------------
// patchChangeDetector.js -- extraction/formatting/overlay in isolation
// ---------------------------------------------------------------------
console.log('\n=== patchChangeDetector.js: extraction ===');

{
  const facts = extractDeterministicFacts('- Passive: cooldown 20s -> 18s\n- Q: damage 60/100/140/180 -> 70/110/150/190\n- Some prose line with no numbers at all\n- Effect strength 8% -> 10%');
  check('finds all 3 real arrow-notation lines, skips the prose line', facts.length === 3, facts.length);
  check('scalar fact gets a computed delta', facts.some((f) => f.label && f.label.includes('Effect strength') && f.change === 2 && f.changePercent === 25), facts);
  check('leveled fact keeps raw slash-list, no fabricated single delta', facts.some((f) => f.oldValue === '60/100/140/180' && f.change === undefined), facts);
}

{
  const facts = extractDeterministicFacts('- Old Relic has been removed from the game.');
  check('a line with no explicit arrow notation extracts nothing (never guesses)', facts.length === 0, facts);
}

{
  const formatted = formatFacts(extractDeterministicFacts('- Total cost 2400 -> 2300'));
  check('formatFacts produces the same 3-string shape the AI has always produced', typeof formatted.whatChanged === 'string' && typeof formatted.previousValue === 'string' && typeof formatted.newValue === 'string');
  check('formatted values are human-readable', formatted.whatChanged.includes('2400') && formatted.whatChanged.includes('2300'), formatted);
}

console.log('\n=== patchChangeDetector.js: overlay ===');
{
  const report = {
    championChanges: [{ championId: 'leona', championName: 'Leona', whatChanged: 'AI-written summary', previousValue: '', newValue: '' }],
    itemChanges: [{ itemId: 'ardent-censer', itemName: 'Ardent Censer', whatChanged: 'AI-written summary', previousValue: '', newValue: '' }],
    runeChanges: [],
  };
  const entityFactsByKey = new Map([
    ['champion:leona', { whatChanged: 'Q: 60 \u2192 70', previousValue: 'Q: 60', newValue: 'Q: 70' }],
  ]);
  const overlaid = overlayDeterministicFacts(report, entityFactsByKey);
  check('entity WITH deterministic facts gets them overlaid', overlaid.championChanges[0].whatChanged === 'Q: 60 \u2192 70', overlaid.championChanges[0]);
  check('entity with NO deterministic facts keeps the AI-written text unchanged (fallback)', overlaid.itemChanges[0].whatChanged === 'AI-written summary', overlaid.itemChanges[0]);
  check('overlay does not mutate its input', report.championChanges[0].whatChanged === 'AI-written summary');
}

console.log('\n=== patchChangeDetector.js: ADDED/REMOVED + item-info signal ===');
{
  const unit = { id: 'u1', title: 'Old Relic', headingPath: ['ITEM CHANGES', 'Old Relic'], text: 'Old Relic has been removed from the game.' };
  const sig = detectAddedOrRemovedSignal(unit, { key: 'item:old-relic', type: 'item', id: 'old-relic', name: 'Old Relic' });
  check('REMOVED pattern detected and cross-checked against the roster entity', sig && sig.signal === 'removed' && sig.entity.key === 'item:old-relic', sig);
}
{
  const unit = { id: 'u2', title: 'New Item: Sunfire Cape', headingPath: ['ITEM CHANGES', 'New Item: Sunfire Cape'], text: 'A brand new item.' };
  const sig = detectAddedOrRemovedSignal(unit, null);
  check('ADDED pattern detected with no entity (nothing to look up yet)', sig && sig.signal === 'added' && sig.entity === null, sig);
}
{
  const facts = extractDeterministicFacts('- Total cost 2400 -> 2300');
  const flag = compareItemInfoToPatch({ info: 'Grants 15 Ability Power. Total cost 2400.' }, facts);
  check('low-confidence flag fires when info still shows the OLD value', flag && flag.signal === 'possibly_outdated_info' && flag.confidence === 'low', flag);
  const noFlag = compareItemInfoToPatch({ info: 'Grants 15 Ability Power. Total cost 2300.' }, facts);
  check('no flag when info already shows the NEW value', noFlag === null, noFlag);
  const champFlag = compareItemInfoToPatch(null, facts);
  check('no champion-equivalent -- null input never throws, returns null', champFlag === null);
}

// ---------------------------------------------------------------------
// patchPlanner.js -- the deterministic-first relevance gate
// ---------------------------------------------------------------------
console.log('\n=== patchPlanner.js: relevance gate ===');

{
  const html = `<html><body>
    <h1>Patch 7.3</h1>
    <h2>CHAMPION CHANGES</h2><h3>Leona</h3><ul><li>Q: damage 60 -> 70</li></ul>
    <h2>WILD PASS</h2><h3>New Emotes</h3><ul><li>Three new emotes added to the shop.</li></ul>
    <h2>BUG FIXES</h2><ul><li>Fixed a visual bug on the loading screen.</li></ul>
    <h2>BATTLEFIELD ADJUSTMENTS</h2><h3>Jungle Camps</h3><ul><li>Gromp health adjusted.</li></ul>
    <h2>RANKED SYSTEM</h2><ul><li>Adjusted priority role selection weighting for the upcoming season.</li></ul>
  </body></html>`;
  const { text } = htmlToStructuredText(html);
  const parsed = parsePatchDocument(text, { maxUnitChars: 18000 });
  const plan = planPatchAnalysis({ units: parsed.units, championRoster, itemRoster, runeRoster });

  check('unit WITH a detected entity is always batched', plan.batches.some((b) => b.entities.some((e) => e.key === 'champion:leona')));
  check('entity-less nongameplay unit (Wild Pass emotes) is gated out, never batched', plan.ignoredUnits.some((u) => u.headingPath.includes('New Emotes')), plan.ignoredUnits.map((u) => u.headingPath));
  check('entity-less bug-fix unit is gated out', plan.ignoredUnits.some((u) => u.category === 'bugfixes'));
  check('entity-less jungle unit is gated out (matches the doc\'s own jungle example)', plan.ignoredUnits.some((u) => u.category === 'jungle'));
  check('entity-less SYSTEMS unit stays eligible (general system change carve-out)', plan.batches.some((b) => b.units.some((u) => u.category === 'systems')), plan.batches.map((b) => b.units.map((u) => u.category)));
  check('stats.ignoredUnits reflects the gated-out count', plan.stats.ignoredUnits === plan.ignoredUnits.length && plan.stats.ignoredUnits >= 3, plan.stats);
  check('detection itself is unaffected by the gate (detectedAnywhere still complete)', plan.detectedAnywhere.has('champion:leona'));
}

console.log('\n=== patchPlanner.js: deterministic facts attached to batches ===');
{
  const html = `<html><body><h1>Patch</h1><h2>CHAMPION CHANGES</h2><h3>Leona</h3><ul><li>Passive: cooldown 20s -> 18s</li><li>Q: damage 60 -> 70</li></ul><h2>ITEM CHANGES</h2><h3>Ardent Censer</h3><ul><li>Total cost 2400 -> 2300</li></ul></body></html>`;
  const { text } = htmlToStructuredText(html);
  const parsed = parsePatchDocument(text, { maxUnitChars: 18000 });
  const plan = planPatchAnalysis({ units: parsed.units, championRoster, itemRoster, runeRoster });
  const batch = plan.batches[0];

  check('batch carries entityFacts for Leona, combining both her bullets into one formatted fact', batch.entityFacts.has('champion:leona') && batch.entityFacts.get('champion:leona').whatChanged.includes('20s') && batch.entityFacts.get('champion:leona').whatChanged.includes('60'), batch.entityFacts.get('champion:leona'));
  check('batch carries entityFacts for the item too', batch.entityFacts.has('item:ardent-censer'), [...batch.entityFacts.keys()]);
  check('batch carries a low-confidence academyDataFlag for the item (info still says 2400)', batch.academyDataFlags.some((f) => f.entityKey === 'item:ardent-censer'), batch.academyDataFlags);
}

console.log('\n=== patchPlanner.js: onlyEntityKeys (targeted retry) ===');
{
  const html = `<html><body><h1>Patch</h1><h2>CHAMPION CHANGES</h2><h3>Leona</h3><ul><li>Q up</li></ul><h3>Rakan</h3><ul><li>W up</li></ul></body></html>`;
  const { text } = htmlToStructuredText(html);
  const parsed = parsePatchDocument(text, { maxUnitChars: 18000 });
  const plan = planPatchAnalysis({ units: parsed.units, championRoster, itemRoster, runeRoster, onlyEntityKeys: new Set(['champion:rakan']) });

  check('only the targeted entity is batched', plan.batches.some((b) => b.entities.some((e) => e.key === 'champion:rakan')));
  check('the untargeted entity\'s unit is routed to ignoredUnits, not re-batched', !plan.batches.some((b) => b.entities.some((e) => e.key === 'champion:leona')) && plan.ignoredUnits.some((u) => u.headingPath.includes('Leona')));
  check('detection still finds BOTH entities regardless of targeting (coverage accounting stays accurate)', plan.detectedAnywhere.has('champion:leona') && plan.detectedAnywhere.has('champion:rakan'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
