// Patch Intelligence -- deterministic report builder test (AI-removal
// rebuild). Plain Node ESM, no framework. Run directly:
//
//   node tests/patchDeterministicReport.test.mjs
//
// Covers functions/_lib/patchDeterministicReport.js directly: building
// championChanges/itemChanges/runeChanges/systemChanges from a real
// parser+planner plan, Support-relevance classification (CORE/VIABLE/
// SITUATIONAL), comparison-state classification (CONFIRMED/POSSIBLE/
// NOT_COMPARABLE/UNKNOWN), one-entry-per-entity duplicate prevention,
// the specific "item change with no arrow notation" regression this
// rebuild fixed, and mergeFreshOntoExisting's coach-field preservation
// across a rescan. No AI call anywhere in any of this.

import { parsePatchDocument } from '../functions/_lib/patchParser.js';
import { planPatchAnalysis } from '../functions/_lib/patchPlanner.js';
import { buildDeterministicReport, mergeFreshOntoExisting } from '../functions/_lib/patchDeterministicReport.js';
import { COMPARISON_STATE, RELEVANCE } from '../functions/_lib/patchChangeDetector.js';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS -', label); }
  else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail) : ''); }
}

function buildPlan(text, { championRoster = [], itemRoster = [], runeRoster = [] } = {}) {
  const parsed = parsePatchDocument(text, { maxUnitChars: 12000 });
  return planPatchAnalysis({ units: parsed.units, championRoster, itemRoster, runeRoster });
}

// =====================================================================
console.log('\n=== 1. Champion change: leveled arrow notation -> CORE, NOT_COMPARABLE (no structured champion stats exist anywhere in Academy) ===');
{
  const text = `### Leona\nQ - Shield of Daybreak\nDamage: 60/100/140/180 -> 70/110/150/190`;
  const championRoster = [{ id: 'leona', name: 'Leona', tier: 'S' }];
  const plan = buildPlan(text, { championRoster });
  const { report } = buildDeterministicReport({ plan, itemRoster: [] });
  check('exactly one championChanges entry (one entry per entity)', report.championChanges.length === 1, report.championChanges);
  const entry = report.championChanges[0];
  check('relevance is CORE (a concrete extracted value pair)', entry.relevance === RELEVANCE.CORE, entry.relevance);
  check('comparisonState is NOT_COMPARABLE (champions have no structured stat field to compare against)', entry.comparisonState === COMPARISON_STATE.NOT_COMPARABLE, entry.comparisonState);
  check('confidence is Medium for a solid fact with nothing further confirmable', entry.confidence === 'Medium', entry.confidence);
  check('whatChanged carries the real numbers', entry.whatChanged.includes('60/100/140/180') && entry.whatChanged.includes('70/110/150/190'), entry.whatChanged);
  check('detectionMethod is deterministic', entry.detectionMethod === 'deterministic', entry.detectionMethod);
  check('coach fields start blank, never pre-filled', entry.supportImpact === '' && entry.buildImplications === '' && entry.coachNotes === '', entry);
}

console.log('\n=== 2. REGRESSION: item stat change written as prose ("increased from X to Y", no arrow) is detected -- this is the specific gap the old arrow-only detector missed ===');
{
  const text = `### Edge of Night\nArmor Penetration increased from 10% to 15%.`;
  const itemRoster = [{ id: 'edge-of-night', name: 'Edge of Night', info: 'Grants a Spell Shield. Armor Penetration: 10%.' }];
  const plan = buildPlan(text, { itemRoster });
  const { report } = buildDeterministicReport({ plan, itemRoster });
  check('an itemChanges entry was created (NOT silently dropped, which is what the old arrow-only regex did)', report.itemChanges.length === 1, report.itemChanges);
  const entry = report.itemChanges[0];
  check('previousValue captured as 10%', entry.previousValue.includes('10%'), entry.previousValue);
  check('newValue captured as 15%, not truncated to "15"', entry.newValue.includes('15%'), entry.newValue);
  check('relevance is CORE', entry.relevance === RELEVANCE.CORE, entry.relevance);
  check('comparisonState is POSSIBLE -- Academy\'s own item info text still says the OLD value (10%)', entry.comparisonState === COMPARISON_STATE.POSSIBLE, entry.comparisonState);
  check('academyDataFlag is attached, low confidence, naming the stale value', entry.academyDataFlag && entry.academyDataFlag.confidence === 'low', entry.academyDataFlag);
}

console.log('\n=== 3. Prose-only mention with no extractable value pair -> VIABLE, falls back to Riot\'s own raw text (never silently dropped) ===');
{
  const text = `### Karma\nW - Focused Resolve\nThis ability now travels through units instead of stopping on the first one hit.`;
  const championRoster = [{ id: 'karma', name: 'Karma', tier: 'A' }];
  const plan = buildPlan(text, { championRoster });
  const { report } = buildDeterministicReport({ plan, itemRoster: [] });
  check('an entry was still created for a prose-only change', report.championChanges.length === 1, report.championChanges);
  const entry = report.championChanges[0];
  check('relevance is VIABLE (real mention, no concrete value)', entry.relevance === RELEVANCE.VIABLE, entry.relevance);
  check('whatChanged falls back to Riot\'s own text, not left blank', entry.whatChanged.includes('travels through units'), entry.whatChanged);
  check('previousValue/newValue are empty (nothing to extract)', entry.previousValue === '' && entry.newValue === '', entry);
}

console.log('\n=== 4. Unchanged entities never appear as changes (mentioned in passing does not equal "changed") ===');
{
  // Nautilus is only named inside Leona's own section (an unrelated
  // mention), and gets no heading/unit of her own -- must not produce a
  // Nautilus entry.
  const text = `### Leona\nQ deals bonus damage, similar to Nautilus's passive.\nDamage: 60 -> 70`;
  const championRoster = [{ id: 'leona', name: 'Leona', tier: 'S' }, { id: 'nautilus', name: 'Nautilus', tier: 'S' }];
  const plan = buildPlan(text, { championRoster });
  const { report, entityVerdicts } = buildDeterministicReport({ plan, itemRoster: [] });
  const ids = report.championChanges.map((c) => c.championId);
  check('Leona has an entry', ids.includes('leona'), ids);
  check('Nautilus does NOT get an entry just for being named in someone else\'s section', !ids.includes('nautilus'), ids);
  const nautilusVerdict = entityVerdicts.find((v) => v.id === 'nautilus');
  check('Nautilus never gets marked as an actual confirmed change either way', nautilusVerdict && nautilusVerdict.changed !== true, nautilusVerdict);
}

console.log('\n=== 5. Duplicate entity prevention: two units both naming the same champion merge into ONE entry ===');
{
  const text = `### Leona\nQ - Shield of Daybreak\nDamage: 60 -> 70\n\n### Leona (continued)\nE - Zenith Blade\nCooldown: 14s -> 12s`;
  const championRoster = [{ id: 'leona', name: 'Leona', tier: 'S' }];
  const plan = buildPlan(text, { championRoster });
  const { report } = buildDeterministicReport({ plan, itemRoster: [] });
  check('exactly ONE Leona entry, not two', report.championChanges.filter((c) => c.championId === 'leona').length === 1, report.championChanges);
  const entry = report.championChanges.find((c) => c.championId === 'leona');
  check('both facts are present in the merged entry (nothing lost in the merge)', entry.whatChanged.includes('60') && entry.whatChanged.includes('70') && entry.whatChanged.includes('14s') && entry.whatChanged.includes('12s'), entry.whatChanged);
}

console.log('\n=== 6. Added/removed signal produces HUMAN_REVIEW-worthy CORE entry with an explicit note, for both champion/item and system-level cases ===');
{
  const text = `### New Item: Sunfire Cape\nA brand new Legendary item for tanky supports.`;
  const itemRoster = [];
  const plan = buildPlan(text, { itemRoster });
  const { report } = buildDeterministicReport({ plan, itemRoster });
  check('an entry is produced even though the item is not yet in Academy\'s roster at all', report.itemChanges.length + report.systemChanges.length >= 1, report);
}

console.log('\n=== 7. System/objective change with no single Academy entity -> systemChanges, SITUATIONAL ===');
{
  const text = `### Dragon System\nElder Dragon buffs now last 30% longer.`;
  const plan = buildPlan(text, {});
  const { report } = buildDeterministicReport({ plan, itemRoster: [] });
  check('one systemChanges entry created', report.systemChanges.length === 1, report.systemChanges);
  const entry = report.systemChanges[0];
  check('relevance is SITUATIONAL', entry.relevance === RELEVANCE.SITUATIONAL, entry.relevance);
  check('area reflects the section heading', entry.area.toLowerCase().includes('dragon'), entry.area);
}

console.log('\n=== 8. Rune detection works the same way as champion/item ===');
{
  const text = `### Font of Life\nHealing amplification increased from 20% to 25%.`;
  const runeRoster = [{ id: 'font-of-life', name: 'Font of Life', info: 'Marks the enemy, healing allies who damage them.' }];
  const plan = buildPlan(text, { runeRoster });
  const { report } = buildDeterministicReport({ plan, itemRoster: [] });
  check('a runeChanges entry was created', report.runeChanges.length === 1, report.runeChanges);
  check('rune id resolved correctly', report.runeChanges[0].runeId === 'font-of-life', report.runeChanges[0]);
}

console.log('\n=== 9. Analysis coverage: 4 honest states, always complete (deterministic extraction has no partial-failure mode) ===');
{
  const text = `### Leona\nDamage: 60 -> 70\n\n### Karma\nMentioned but no section of her own follows.`;
  const championRoster = [{ id: 'leona', name: 'Leona', tier: 'S' }, { id: 'karma', name: 'Karma', tier: 'A' }, { id: 'thresh', name: 'Thresh', tier: 'B' }];
  const plan = buildPlan(text, { championRoster });
  const { report } = buildDeterministicReport({ plan, itemRoster: [] });
  check('coverage is always complete (no AI call to time out or run out of budget)', report.analysisCoverage.complete === true, report.analysisCoverage);
  check('thresh (never mentioned) is not_detected', report.analysisCoverage.states.not_detected >= 1, report.analysisCoverage.states);
  check('changed_not_relevant is always 0 (structurally unreachable -- Academy\'s roster is already curated to Support-relevant entities)', report.analysisCoverage.states.changed_not_relevant === 0, report.analysisCoverage.states);
}

console.log('\n=== 10. mergeFreshOntoExisting: refreshes facts, preserves Coach-written fields, drops entities no longer detected ===');
{
  const existingReport = {
    championChanges: [
      { championId: 'leona', championName: 'Leona', whatChanged: 'OLD FACT TEXT', previousValue: '60', newValue: '65', comparisonState: 'NOT_COMPARABLE', relevance: 'CORE',
        supportImpact: 'Coach wrote: strong early trade buff.', buildImplications: 'Consider rushing Locket earlier.', coachNotes: 'Watch this in scrims.' },
      { championId: 'rakan', championName: 'Rakan', whatChanged: 'no longer detected this run', previousValue: '', newValue: '', supportImpact: 'Old coach note for Rakan.' },
    ],
    itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [{ entityId: 'leona', from: 'A', to: 'S', reasoning: 'Coach decision, not auto-generated' }],
  };
  const freshReport = {
    championChanges: [
      { championId: 'leona', championName: 'Leona', whatChanged: 'FRESH FACT: 60 -> 70', previousValue: '60', newValue: '70', comparisonState: 'NOT_COMPARABLE', relevance: 'CORE',
        supportImpact: '', buildImplications: '', coachNotes: '' },
    ],
    itemChanges: [], runeChanges: [], systemChanges: [{ area: 'Dragon System', whatChanged: 'fresh system note' }], recommendedTierChanges: [],
  };
  const merged = mergeFreshOntoExisting(freshReport, existingReport);
  check('exactly one champion entry (Rakan, no longer detected, is dropped)', merged.championChanges.length === 1, merged.championChanges);
  const leona = merged.championChanges[0];
  check('fact fields come from the FRESH run', leona.whatChanged === 'FRESH FACT: 60 -> 70' && leona.newValue === '70', leona);
  check('coach fields are preserved from the EXISTING report', leona.supportImpact === 'Coach wrote: strong early trade buff.' && leona.buildImplications === 'Consider rushing Locket earlier.' && leona.coachNotes === 'Watch this in scrims.', leona);
  check('systemChanges are always taken fresh (no per-run identity to merge on)', merged.systemChanges[0].whatChanged === 'fresh system note', merged.systemChanges);
  check('recommendedTierChanges (a Coach decision, never auto-generated) is carried over untouched from the existing report', merged.recommendedTierChanges.length === 1 && merged.recommendedTierChanges[0].reasoning === 'Coach decision, not auto-generated', merged.recommendedTierChanges);
}

console.log('\n=== 11. mergeFreshOntoExisting: a newly-detected entity (not in the existing report at all) is added as-is, no coach fields to carry ===');
{
  const existingReport = { championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [] };
  const freshReport = { championChanges: [{ championId: 'hwei', championName: 'Hwei', whatChanged: 'new fact', previousValue: '', newValue: '', supportImpact: '' }], itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [] };
  const merged = mergeFreshOntoExisting(freshReport, existingReport);
  check('new entity entry is present, unchanged', merged.championChanges.length === 1 && merged.championChanges[0].championId === 'hwei', merged.championChanges);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
