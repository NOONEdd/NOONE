// Patch Intelligence -- patchChangeDetector.js / patchPlanner.js's
// relevance gate regression test (2026-09-23 deterministic-first
// refactor). Plain Node ESM, no framework. Run directly:
//
//   node tests/patchDeterministicFacts.test.mjs

import {
  extractDeterministicFacts,
  formatFacts,
  detectAddedOrRemovedSignal,
  compareItemInfoToPatch,
} from '../functions/_lib/patchChangeDetector.js';
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
// (the relevance gate / planner sections of this file were retired with patchPlanner.js on 2026-09-30:
//  nothing is gated out any more -- see tests/patchNotes.test.mjs for the accounting + ownership suite)

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
