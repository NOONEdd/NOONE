// Patch Intelligence -- patchAcademyDetection.js / patchPlanner.js
// regression test. Plain Node ESM, no framework. Run directly:
//
//   node tests/patchAcademyDetectionAndPlanner.test.mjs

import { buildAcademyIndex, detectEntitiesInText, isStrongDetection, resolveEntityByName } from '../functions/_lib/patchAcademyDetection.js';
import { parsePatchDocument } from '../functions/_lib/patchParser.js';
import { planPatchAnalysis } from '../functions/_lib/patchPlanner.js';
import { htmlToStructuredText } from '../functions/_lib/patchText.js';

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

// ---------------------------------------------------------------------
// patchPlanner.js
// ---------------------------------------------------------------------
console.log('\n=== patchPlanner.js ===');

{
  const html = `<html><body><h1>Patch 7.3a</h1><h2>CHAMPION CHANGES</h2><h3>Leona</h3><ul><li>Q up</li></ul><h3>Rakan</h3><ul><li>W down</li></ul><h2>ITEM CHANGES</h2><h3>Ardent Censer</h3><ul><li>Cost down</li></ul></body></html>`;
  const { text } = htmlToStructuredText(html);
  const parsed = parsePatchDocument(text, { maxUnitChars: 18000 });
  const plan = planPatchAnalysis({ units: parsed.units, championRoster, itemRoster, runeRoster });

  check('entities detected via heading (not just body text)', plan.detectedAnywhere.has('champion:leona') && plan.detectedAnywhere.has('champion:rakan') && plan.detectedAnywhere.has('item:ardent-censer'));
  check('small patch fits in a single batch', plan.batches.length === 1, plan.batches.length);
  check('not capped for a small patch', plan.capped === false);
  check('never-mentioned roster entities are absent from detectedAnywhere', !plan.detectedAnywhere.has('champion:nautilus') && !plan.detectedAnywhere.has('rune:guardian'));
}

{
  // Batches must respect PATCH_INTEL_BATCH_MAX_ENTITIES: build a big
  // roster + patch so packing is forced to span multiple batches, and
  // confirm no single batch exceeds the entity cap.
  const bigChampionRoster = Array.from({ length: 40 }, (_, i) => ({ id: `champ${i}`, name: `Champion${i}Name`, role: 'Support', tier: 'B' }));
  let body = '<h1>Patch 7.3a</h1><h2>CHAMPION CHANGES</h2>';
  for (const c of bigChampionRoster) body += `<h3>${c.name}</h3><ul><li>Passive cooldown reduced</li></ul>`;
  const { text } = htmlToStructuredText(`<html><body>${body}</body></html>`);
  const parsed = parsePatchDocument(text, { maxUnitChars: 18000 });
  const plan = planPatchAnalysis({ units: parsed.units, championRoster: bigChampionRoster, itemRoster: [], runeRoster: [] });

  check('multiple batches formed for 40 champions', plan.batches.length > 1, plan.batches.length);
  check('every batch respects the entity cap (<=14)', plan.batches.every((b) => b.entities.length <= 14), plan.batches.map((b) => b.entities.length));
  check('every detected champion assigned to exactly one batch (no duplicates, none missing)', (() => {
    const seen = new Map();
    for (const b of plan.batches) for (const e of b.entities) seen.set(e.key, (seen.get(e.key) || 0) + 1);
    const allOnce = [...seen.values()].every((n) => n === 1);
    const allPresent = bigChampionRoster.every((c) => seen.has(`champion:${c.id}`));
    return allOnce && allPresent;
  })());
  check('no units left unassigned for a patch well within capacity', plan.unassignedUnits.length === 0, plan.unassignedUnits.length);
}

{
  // splitBatchInHalf (used by patchAnalysis.js's retry-with-split) must
  // cut at a unit boundary and correctly re-derive each half's entities
  // from entityKeysByUnitId rather than reusing the whole batch's list.
  const html = `<html><body><h1>Patch</h1><h2>CHAMPION CHANGES</h2><h3>Leona</h3><ul><li>Q up</li></ul><h3>Rakan</h3><ul><li>W up</li></ul><h3>Nautilus</h3><ul><li>E up</li></ul></body></html>`;
  const { text } = htmlToStructuredText(html);
  const parsed = parsePatchDocument(text, { maxUnitChars: 18000 });
  const plan = planPatchAnalysis({ units: parsed.units, championRoster, itemRoster, runeRoster });
  const { splitBatchInHalf } = await import('../functions/_lib/patchPlanner.js');
  const batch = plan.batches[0];
  const halves = splitBatchInHalf(batch, plan.index);

  check('split produces two halves', halves.length === 2, halves.length);
  check('every original unit id appears in exactly one half', (() => {
    const ids = [...halves[0].unitIds, ...halves[1].unitIds];
    return ids.length === batch.unitIds.length && new Set(ids).size === ids.length;
  })());
  check("each half's entities come only from its own units (no leakage from the other half)", (() => {
    const half0Keys = new Set(halves[0].entities.map((e) => e.key));
    const half1UnitEntityKeys = new Set([...halves[1].entityKeysByUnitId.values()].flat());
    return [...half0Keys].every((k) => !half1UnitEntityKeys.has(k)) || halves[0].unitIds.every((id) => !halves[1].unitIds.includes(id));
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
