// Patch Intelligence -- patchAcademyDetection.js regression test. Plain Node ESM, no framework. Run directly:
//
//   node tests/patchAcademyDetectionAndPlanner.test.mjs
//
// (The filename is historical: this file used to ALSO cover the AI-era batch planner, which has been
// retired together with its planPatchAnalysis / splitBatchInHalf sections. Only the live Academy-detection coverage remains.)

import { buildAcademyIndex, detectEntitiesInText, isStrongDetection, resolveEntityByName } from '../functions/_lib/patchAcademyDetection.js';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS -', label); }
  else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail) : ''); }
}

const championRoster = [
  { id: 'leona', name: 'Leona', role: 'Support', tier: 'S' },
  { id: 'nautilus', name: "Nautilus", role: 'Support', tier: 'A' },
  { id: 'rakan', name: 'Rakan', role: 'Support', tier: 'B' },
];
const itemRoster = [
  { id: 'ardent-censer', name: 'Ardent Censer', category: 'Enchant', tier: 'A', info: '' },
  { id: 'locket-of-the-iron-solari', name: 'Locket of the Iron Solari', category: 'Enchant', tier: 'B', info: '' },
];
const runeRoster = [
  { id: 'guardian', name: 'Guardian', path: 'Resolve', tier: 'A', info: '' },
];

// ---------------------------------------------------------------------
// patchAcademyDetection.js
// ---------------------------------------------------------------------
console.log('\n=== patchAcademyDetection.js ===');

const index = buildAcademyIndex({ championRoster, itemRoster, runeRoster });

{
  const detected = detectEntitiesInText("Leona's Q damage was increased. Nautilus' passive now applies slow.", index);
  check('possessive apostrophe-s matched (Leona\'s)', detected.has('champion:leona'));
  check("possessive trailing-apostrophe matched (Nautilus')", detected.has('champion:nautilus'));
}

{
  const detected = detectEntitiesInText('leona q buffed, ARDENT CENSER cost reduced, ardent  censer heal power up', index);
  check('case-insensitive champion match', detected.has('champion:leona'));
  check('case-insensitive multi-word item match (all caps)', detected.has('item:ardent-censer'));
  const rec = detected.get('item:ardent-censer');
  check('double-space between words still matches', rec && rec.mentions >= 2, rec);
}

{
  // "Guardian" is both an Academy rune name AND a common English word --
  // this is exactly the false-positive risk isStrongDetection exists to
  // guard against for single-word names.
  const proseText = 'Every support player should be a guardian for their team, protecting their carries.';
  const detected = detectEntitiesInText(proseText, index);
  const rec = detected.get('rune:guardian');
  check('lowercase common-word usage of "guardian" is NOT a strong detection', !rec || !isStrongDetection(index.byKey.get('rune:guardian'), rec), rec);

  const realMention = 'Guardian: shield strength increased from 80 to 100.';
  const detected2 = detectEntitiesInText(realMention, index);
  const rec2 = detected2.get('rune:guardian');
  check('capitalized/standalone "Guardian" (the rune) IS a strong detection', rec2 && isStrongDetection(index.byKey.get('rune:guardian'), rec2), rec2);
}

{
  const detected = detectEntitiesInText('No champions mentioned here, just some jungle pacing notes.', index);
  check('no false positives on unrelated text', detected.size === 0, [...detected.keys()]);
}

{
  const detected = detectEntitiesInText('Rakan and Nautilus both received buffs this patch.', index);
  check('two distinct champions in one line both detected', detected.has('champion:rakan') && detected.has('champion:nautilus'));
  check('champion not mentioned is NOT detected', !detected.has('champion:leona'));
}

{
  check('resolveEntityByName exact match', resolveEntityByName('Leona', championRoster)?.id === 'leona');
  check('resolveEntityByName is case-insensitive', resolveEntityByName('leona', championRoster)?.id === 'leona');
  check('resolveEntityByName returns null for no match', resolveEntityByName('Nonexistent Champion', championRoster) === null || resolveEntityByName('Nonexistent Champion', championRoster) === undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
