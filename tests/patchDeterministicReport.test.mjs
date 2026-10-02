// Patch Notes -- derived legacy view + rescan coach-field merge. Plain Node ESM, no framework. Run directly:
//
//   node tests/patchDeterministicReport.test.mjs
//
// History: this file used to cover the retired interim report builder and the retired AI-era batch planner. Those
// modules are gone. Everything here that still describes LIVE behaviour has been
// kept and re-pointed at the current pipeline:
//
//   parsePatchDocument -> extractPatchNotes -> initReview -> deriveLegacyReport     (patchNotesReview.js)
//   mergeFreshOntoExisting                                                          (patchNotesReview.js)
//
// Covered: Support-relevance classification (CORE / VIABLE / SITUATIONAL), comparison-state classification
// (NOT_COMPARABLE / POSSIBLE with the Academy stale-value flag), the "item change written as prose, no arrow"
// regression, prose-only changes falling back to Riot's own text, system changes, rune ownership, and
// mergeFreshOntoExisting's coach-field preservation across a rescan. No AI call anywhere in any of this.
// (The old "analysisCoverage 4 honest states" section described the retired builder's coverage object and was dropped;
// accounting for every source block is covered by validation.droppedBlocks in patchNotes.test.mjs.)

import { extract, makeChecker } from './helpers/patchNotesHelpers.mjs';
import { deriveLegacyReport, mergeFreshOntoExisting } from '../functions/_lib/patchNotesReview.js';
import { COMPARISON_STATE, RELEVANCE } from '../functions/_lib/patchChangeDetector.js';

const { check, done } = makeChecker();

/** Extract with the given rosters and derive the DRAFT legacy view against THE SAME item roster (the shared helper's own
 *  legacy() uses its fixed default roster, which would hide the Academy stale-value flag for custom items). */
function build(text, { championRoster = [], itemRoster = [], runeRoster = [] } = {}) {
  const { dataset, changes } = extract(text, { rosters: { championRoster, itemRoster, runeRoster } });
  return { dataset, changes, report: deriveLegacyReport(dataset, { itemRoster, mode: 'draft' }) };
}

// =====================================================================
console.log('\n=== 1. Champion change: leveled arrow notation -> CORE, NOT_COMPARABLE (no structured champion stats exist anywhere in Academy) ===');
{
  const { report } = build(`### Leona\nQ - Shield of Daybreak\nDamage: 60/100/140/180 -> 70/110/150/190`, { championRoster: [{ id: 'leona', name: 'Leona', tier: 'S' }] });
  check('exactly one championChanges entry (one entry per entity)', report.championChanges.length === 1, report.championChanges);
  const entry = report.championChanges[0];
  check('relevance is CORE (a concrete extracted value pair)', entry.relevance === RELEVANCE.CORE, entry.relevance);
  check('comparisonState is NOT_COMPARABLE (champions have no structured stat field to compare against)', entry.comparisonState === COMPARISON_STATE.NOT_COMPARABLE, entry.comparisonState);
  check('whatChanged carries the real numbers', entry.whatChanged.includes('60/100/140/180') && entry.whatChanged.includes('70/110/150/190'), entry.whatChanged);
  check('previous/new values are the real pair', entry.previousValue.includes('60/100/140/180') && entry.newValue.includes('70/110/150/190'), entry);
  check('detectionMethod is deterministic', entry.detectionMethod === 'deterministic', entry.detectionMethod);
  check('coach fields start blank, never pre-filled', entry.supportImpact === '' && entry.buildImplications === '' && entry.coachNotes === '', entry);
}

console.log('\n=== 2. REGRESSION: item stat change written as prose ("increased from X to Y", no arrow) is detected, and the stale Academy value is flagged ===');
{
  const itemRoster = [{ id: 'edge-of-night', name: 'Edge of Night', info: 'Grants a Spell Shield. Armor Penetration: 10%.' }];
  const { report } = build(`### Edge of Night\nArmor Penetration increased from 10% to 15%.`, { itemRoster });
  check('an itemChanges entry was created (NOT silently dropped, which is what the old arrow-only regex did)', report.itemChanges.length === 1, report.itemChanges);
  const entry = report.itemChanges[0];
  check('previousValue captured as 10%', entry.previousValue.includes('10%'), entry.previousValue);
  check('newValue captured as 15%, not truncated to "15"', entry.newValue.includes('15%'), entry.newValue);
  check('relevance is CORE', entry.relevance === RELEVANCE.CORE, entry.relevance);
  check("comparisonState is POSSIBLE -- Academy's own item info text still says the OLD value (10%)", entry.comparisonState === COMPARISON_STATE.POSSIBLE, entry.comparisonState);
  check('academyDataFlag is attached, low confidence, naming the stale value', entry.academyDataFlag && entry.academyDataFlag.confidence === 'low', entry.academyDataFlag);
}

console.log("\n=== 3. Prose-only mention with no extractable value pair -> VIABLE, falls back to Riot's own raw text (never silently dropped) ===");
{
  const { report } = build(`### Karma\nW - Focused Resolve\nThis ability now travels through units instead of stopping on the first one hit.`, { championRoster: [{ id: 'karma', name: 'Karma', tier: 'A' }] });
  check('an entry was still created for a prose-only change', report.championChanges.length === 1, report.championChanges);
  const entry = report.championChanges[0];
  check('relevance is VIABLE (real mention, no concrete value)', entry.relevance === RELEVANCE.VIABLE, entry.relevance);
  check("whatChanged falls back to Riot's own text, not left blank", entry.whatChanged.includes('travels through units'), entry.whatChanged);
  check('previousValue/newValue are empty (nothing to extract)', entry.previousValue === '' && entry.newValue === '', entry);
}

console.log('\n=== 4. A champion merely named inside another champion\'s section never gets an entry ===');
{
  const { report } = build(`### Leona\nQ deals bonus damage, similar to Nautilus's passive.\nDamage: 60 -> 70`, { championRoster: [{ id: 'leona', name: 'Leona', tier: 'S' }, { id: 'nautilus', name: 'Nautilus', tier: 'S' }] });
  const ids = report.championChanges.map((c) => c.championId);
  check('Leona has an entry', ids.includes('leona'), ids);
  check("Nautilus does NOT get an entry just for being named in someone else's section", !ids.includes('nautilus'), ids);
}

console.log('\n=== 5. Duplicate entity prevention: two sections for the same champion merge into ONE legacy entry ===');
{
  const { report } = build(`### Leona\nQ - Shield of Daybreak\nDamage: 60 -> 70\n\n### Leona (continued)\nE - Zenith Blade\nCooldown: 14s -> 12s`, { championRoster: [{ id: 'leona', name: 'Leona', tier: 'S' }] });
  check('exactly ONE Leona entry, not two', report.championChanges.filter((c) => c.championId === 'leona').length === 1, report.championChanges);
  const entry = report.championChanges.find((c) => c.championId === 'leona');
  const all = JSON.stringify(entry);
  check('both facts are present in the merged entry (nothing lost in the merge)', ['60', '70', '14s', '12s'].every((v) => all.includes(v)), entry);
}

console.log('\n=== 6. System/objective change with no single Academy entity -> systemChanges, SITUATIONAL ===');
{
  const { report, changes } = build(`### Dragon System\nElder Dragon buffs now last 30% longer.`);
  check('one systemChanges entry created', report.systemChanges.length === 1, report.systemChanges);
  const entry = report.systemChanges[0];
  check('relevance is SITUATIONAL', entry.relevance === RELEVANCE.SITUATIONAL, entry.relevance);
  check('area reflects the section heading', entry.area.toLowerCase().includes('dragon'), entry.area);
  check('the underlying change is a SYSTEM change, not an entity-owned one', changes.every((c) => c.kind === 'system'), changes.map((c) => c.kind));
}

console.log('\n=== 7. Rune detection works the same way as champion/item ===');
{
  const { report } = build(`### Font of Life\nHealing amplification increased from 20% to 25%.`, { runeRoster: [{ id: 'font-of-life', name: 'Font of Life', info: 'Marks the enemy, healing allies who damage them.' }] });
  check('a runeChanges entry was created', report.runeChanges.length === 1, report.runeChanges);
  check('rune id resolved correctly', report.runeChanges[0].runeId === 'font-of-life', report.runeChanges[0]);
  check('values extracted', report.runeChanges[0].previousValue.includes('20%') && report.runeChanges[0].newValue.includes('25%'), report.runeChanges[0]);
}

console.log('\n=== 8. mergeFreshOntoExisting: refreshes facts, preserves Coach-written fields, drops entities no longer detected ===');
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

console.log('\n=== 9. mergeFreshOntoExisting: a newly-detected entity (not in the existing report at all) is added as-is, no coach fields to carry ===');
{
  const existingReport = { championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [] };
  const freshReport = { championChanges: [{ championId: 'hwei', championName: 'Hwei', whatChanged: 'new fact', previousValue: '', newValue: '', supportImpact: '' }], itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [] };
  const merged = mergeFreshOntoExisting(freshReport, existingReport);
  check('new entity entry is present, unchanged', merged.championChanges.length === 1 && merged.championChanges[0].championId === 'hwei', merged.championChanges);
}

done();
