// Shared fixtures for the Patch Notes tests (not a test file itself).
import { parsePatchDocument } from '../../functions/_lib/patchParser.js';
import { extractPatchNotes } from '../../functions/_lib/patchNotesExtract.js';
import { initReview, deriveLegacyReport } from '../../functions/_lib/patchNotesReview.js';

export const FIXED_TIME = '2026-09-30T12:00:00.000Z';

// Deliberately INCOMPLETE Academy data: no abilities, no passives, no stats -- just identities.
export const CHAMPIONS = [{ id: 'senna', name: 'Senna', tier: 'A' }, { id: 'hwei', name: 'Hwei', tier: 'B' }, { id: 'braum', name: 'Braum', tier: 'S' }];
export const ITEMS = [
  { id: 'sunfire-aegis', name: 'Sunfire Aegis', info: 'Burns nearby enemies.' },
  { id: 'ardent-censer', name: 'Ardent Censer', info: 'Enchants an ally.' },
  { id: 'heartsteel', name: 'Heartsteel', info: 'Tank item.' },
];
export const RUNES = [{ id: 'overgrowth', name: 'Overgrowth', info: 'Max health from nearby deaths.' }, { id: 'legend-haste', name: 'Legend: Haste', info: 'Ability haste.' }];

export function extract(text, { patchVersion = '7.3', rosters = {} } = {}) {
  const parsed = parsePatchDocument(text, { maxUnitChars: 12000 });
  const dataset = extractPatchNotes({
    units: parsed.units, championRoster: rosters.championRoster || CHAMPIONS, itemRoster: rosters.itemRoster || ITEMS, runeRoster: rosters.runeRoster || RUNES,
    patchVersion, sourceUrl: 'https://example.test/patch-7-3', extractedAt: FIXED_TIME,
  });
  initReview(dataset);
  return { dataset, parsed, changes: dataset.changes, legacy: (mode = 'draft') => deriveLegacyReport(dataset, { itemRoster: ITEMS, mode }) };
}

export function makeChecker() {
  let pass = 0, fail = 0;
  const check = (label, cond, detail) => {
    if (cond) { pass++; console.log('  PASS -', label); }
    else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail).slice(0, 400) : ''); }
  };
  const done = () => { console.log(`\n${pass} passed, ${fail} failed`); if (fail > 0) process.exit(1); };
  return { check, done };
}

// Senna block exactly as Riot published it in Patch 7.3 (Marksman Champion Adjustments + Durability list).
export const SENNA_73 = `## CHAMPION ADJUSTMENTS

### Marksman Champion Adjustments

SENNA

Absolution

- Attack Speed Ratio: 0.4
- Base Attack Speed: 0.4
- Base Bonus Attack Speed: 0.6
- Attack Speed per Level: 0.05
- Damage based on Current Health: 1.2%~12% (based on level) → 1%~10% (based on level)
- Critical Rate gained per 20 Mist: 15% → 10%
- [New] Basic attacks now deal 90% of normal critical strike damage when they critical strike.

Piercing Darkness

- Base Damage: 50 / 90 / 130 / 170 → 50 / 80 / 110 / 140

Dawning Shadow

- Damage: 250 / 375 / 500 + 120% bonus Attack Damage + 50% Ability Power → 250 / 400 / 550 + 120% bonus Attack Damage + 70% Ability Power
- Shield: 120 / 160 / 200 + 40% Ability Power + Mist × 4 → 120 / 160 / 200 + 50% Ability Power + Mist × 2

### Champion Durability Adjustments Detailed List

#### Senna

*Base Stats*

- Base Health: 600 → 570
`;
