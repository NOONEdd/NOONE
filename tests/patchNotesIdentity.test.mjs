// Patch Notes -- Stage 1: stable source identity + backward-compatible review reconnection.
//
//   node tests/patchNotesIdentity.test.mjs
//
// Proves: (1) no historical change ID is rewritten (byte-identical to a fixture recorded with the pre-change extractor);
// (2) when the MATCH RESULT changes (an untracked entity gains a canonical Academy record, a tracked one is retired, a System
// block becomes an entity) every review decision -- change review AND section/subsection review -- is reconnected, nothing is
// orphaned; (3) ambiguity is never guessed (kept + surfaced instead); (4) datasets stored before `sourceKey` existed reconnect
// the same way. Pure functions only: no KV, no network, nothing written.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePatchDocument } from '../functions/_lib/patchParser.js';
import { extractPatchNotes } from '../functions/_lib/patchNotesExtract.js';
import { initReview, mergeReviewState, applyReviewOps, sectionKeyOf } from '../functions/_lib/patchNotesReview.js';
import { sourceKeyOf, sourceNameOf, normName } from '../src/lib/patchNotesClassification.js';
import { normName as idsNormName } from '../functions/_lib/patchNotesIds.js';
import { CHAMPIONS, isAcademyCovered } from '../src/data/champions.js';
import { ITEMS } from '../src/data/items.js';
import { RUNES } from '../src/data/runes.js';
import { ALL_PATHS_PAGE } from './fixtures/patch-notes-identity-pages.mjs';
import * as H from './helpers/patchNotesHelpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { check, done } = H.makeChecker();
const T = '2026-11-12T00:00:00.000Z';
const run = (text, rosters, patchVersion = '9.1') => {
  const parsed = parsePatchDocument(text, { maxUnitChars: 12000 });
  return extractPatchNotes({ units: parsed.units, ...rosters, patchVersion, sourceUrl: 'https://example.test', extractedAt: T });
};
const real = { championRoster: CHAMPIONS.filter(isAcademyCovered), itemRoster: ITEMS, runeRoster: RUNES };
const withItems = (...extra) => ({ ...real, itemRoster: [...ITEMS, ...extra] });
const BULWARK = { id: 'bulwark-of-the-mountain', name: 'Bulwark of the Mountain', category: 'Support', tier: 'Unranked', info: '' };
const SCYTHE = { id: 'black-mist-scythe', name: 'Black Mist Scythe', category: 'Support', tier: 'Unranked', info: '' };
const clone = (x) => JSON.parse(JSON.stringify(x));
const byName = (ds, re) => ds.changes.filter((c) => re.test(c.entity ? c.entity.name : c.system.area));

// ======================================================================================================================
console.log('\n=== 1. No historical change ID is rewritten (fixture recorded with the pre-change extractor) ===');
{
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/patch-notes-identity-baseline.json'), 'utf8'));
  const api = fs.readFileSync(path.join(ROOT, 'tests/patchNotesApi.test.mjs'), 'utf8');
  const PAGE = api.slice(api.indexOf('const PAGE = `') + 14, api.indexOf('`;', api.indexOf('const PAGE = `')));
  const cases = {
    'riot-7-3a-real-rosters': run(fs.readFileSync(path.join(ROOT, 'tests/fixtures/riot-wild-rift-7-3a-champion-changes.txt'), 'utf8'), real, '7.3a'),
    'all-paths-real-rosters': run(ALL_PATHS_PAGE, real, '9.1'),
    'api-page-real-rosters': run(PAGE, real, '7.5'),
    'senna-73-helper-rosters': run(H.SENNA_73, { championRoster: H.CHAMPIONS, itemRoster: H.ITEMS, runeRoster: H.RUNES }, '7.3'),
  };
  for (const [name, ds] of Object.entries(cases)) {
    const now = ds.changes.map((ch) => ({ changeId: ch.changeId, sectionKey: sectionKeyOf(ch), entityKey: ch.entity ? ch.entity.key : null, status: ch.entity ? ch.entity.status : 'SYSTEM' }));
    check(`${name}: ${now.length} changes -- changeId, sectionKey, entity key and status byte-identical to the baseline`, JSON.stringify(now) === JSON.stringify(base.cases[name]));
  }
  const ds = cases['all-paths-real-rosters'];
  check('every entity change records Riot\'s own name for its owner as a source fact (provenance.sourceOwnerName); the entity object itself is unchanged', ds.changes.filter((c) => c.entity).every((c) => c.provenance.sourceOwnerName && !('sourceName' in c.entity) && !('sourceKey' in c.entity)));
  const k = (re) => byName(ds, re)[0];
  check('untracked: sourceKey equals the entity key ("item:bulwarkofthemountain")', sourceKeyOf(k(/^Bulwark/)) === 'item:bulwarkofthemountain' && sourceKeyOf(k(/^Bulwark/)) === k(/^Bulwark/).entity.key);
  check('tracked: sourceKey is built from Riot\'s text, not the catalog id ("rune:aery", entity key "rune:summon-aery")', sourceKeyOf(k(/^Aery/)) === 'rune:aery' && k(/^Aery/).entity.key === 'rune:summon-aery');
  check('explicit "Name / Base Stats" owner: Riot\'s line is recorded ("Harmonic Echo")', k(/^Harmonic/).provenance.sourceOwnerName === 'Harmonic Echo');
  check('legacy derivation: with provenance.sourceOwnerName stripped, sourceKeyOf() derives the SAME value for every change of every case',
    Object.values(cases).every((d) => d.changes.every((c) => { const s = clone(c); delete s.provenance.sourceOwnerName; return sourceKeyOf(s) === sourceKeyOf(c); })));
  check('normName is ONE implementation (patchNotesIds re-exports the shared one)', idsNormName === normName);
}

// ======================================================================================================================
console.log('\n=== 2. An untracked entity gains a canonical Academy record -> every decision follows it, nothing orphaned ===');
const PAGE_A = `# Wild Rift Patch Notes 9.2

## ITEM ADJUSTMENTS

### Bulwark of the Mountain

- Shield: 120 → 140
- Health: 300 → 350

### Black Mist Scythe

- Bonus Damage: 40 → 50

### Ardent Censer

- Attack Speed: 20% → 25%
`;
function reviewedBefore() {
  const before = initReview(run(PAGE_A, real, '9.2'));
  const [b1, b2] = byName(before, /^Bulwark/); const [s1] = byName(before, /^Black Mist/);
  const r = applyReviewOps(before, [
    { op: 'keep', changeId: b1.changeId },
    { op: 'edit', changeId: b2.changeId, displayText: 'Bulwark: more health', reviewerNote: 'big for tanks' },
    { op: 'reject', changeId: s1.changeId },
    { op: 'impactSection', sectionKey: sectionKeyOf(b1), changeImpact: 'HIGH' },
    { op: 'editSectionTitle', sectionKey: sectionKeyOf(b1), displayTitle: 'Bulwark (Relic Shield upgrade)' },
    { op: 'classifySection', sectionKey: sectionKeyOf(s1), comparisonState: 'BUFF' },
  ], { now: T });
  check('setup: 6 review operations applied on the untracked entities', r.applied.length === 6, r.errors);
  return { before, b1, b2, s1 };
}
{
  const { before, b1, b2, s1 } = reviewedBefore();
  check('setup: Bulwark / Black Mist Scythe are UNMATCHED before the catalog knows them', b1.entity.status === 'UNMATCHED' && s1.entity.status === 'UNMATCHED');
  const after = mergeReviewState(run(PAGE_A, withItems(BULWARK, SCYTHE), '9.2'), clone(before));
  const [a1, a2] = byName(after, /^Bulwark/); const [as1] = byName(after, /^Black Mist/);
  check('after: both are EXISTING with new keys and NEW change IDs (the match result changed -- expected)', a1.entity.status === 'EXISTING' && a1.entity.key === 'item:bulwark-of-the-mountain' && a1.changeId !== b1.changeId && as1.changeId !== s1.changeId);
  check('...the sourceKey did NOT change (match-independent identity)', sourceKeyOf(a1) === sourceKeyOf(b1) && sourceKeyOf(as1) === sourceKeyOf(s1));
  check('Keep carried over', a1.review.state === 'kept', a1.review);
  check('Edited display text + reviewer note carried over', a2.review.state === 'edited' && a2.review.displayText === 'Bulwark: more health' && a2.review.reviewerNote === 'big for tanks', a2.review);
  check('Reject carried over', as1.review.state === 'rejected', as1.review);
  check('previousChangeIds record the old IDs (traceable history)', (a1.previousChangeIds || [])[0] === b1.changeId && (a2.previousChangeIds || [])[0] === b2.changeId);
  check('section review (impact HIGH, edited title) moved to the new section key', after.sectionReview[sectionKeyOf(a1)]?.changeImpact === 'HIGH' && after.sectionReview[sectionKeyOf(a1)]?.displayTitle === 'Bulwark (Relic Shield upgrade)' && !after.sectionReview[sectionKeyOf(b1)], after.sectionReview);
  check('section badge override (BUFF) moved to the new Black Mist Scythe section', after.sectionReview[sectionKeyOf(as1)]?.comparisonStateOverride === 'BUFF');
  check('0 orphaned changes, 0 orphaned section reviews; migration recorded', after.orphanedChanges.length === 0 && after.orphanedSectionReviews.length === 0 && after.mergeStats.sectionsMigrated === 2 && after.sectionMigrations.some((m) => m.from === sectionKeyOf(b1) && m.to === sectionKeyOf(a1)), after.mergeStats);
  const ard = (d) => byName(d, /^Ardent/)[0];
  check('an entity whose match did not change keeps its change ID untouched', ard(after).changeId === ard(before).changeId && !ard(after).previousChangeIds);

  // the same thing for a dataset stored BEFORE sourceName/sourceKey existed
  const legacy = clone(before);
  for (const c of legacy.changes) delete c.provenance.sourceOwnerName;
  const after2 = mergeReviewState(run(PAGE_A, withItems(BULWARK, SCYTHE), '9.2'), legacy);
  check('stored dataset WITHOUT provenance.sourceOwnerName: same reconnection (kept / edited / rejected, section review moved, 0 orphaned)',
    byName(after2, /^Bulwark/)[0].review.state === 'kept' && byName(after2, /^Bulwark/)[1].review.state === 'edited' && byName(after2, /^Black Mist/)[0].review.state === 'rejected'
    && after2.sectionReview['entity:item:bulwark-of-the-mountain']?.changeImpact === 'HIGH' && after2.orphanedChanges.length === 0 && after2.orphanedSectionReviews.length === 0);
}

// ======================================================================================================================
{
  // an UNREVIEWED entity whose match changed: section review follows (it is keyed by section), but no review/lineage is invented
  const before = initReview(run(PAGE_A, real, '9.2'));
  const b = byName(before, /^Bulwark/)[0];
  applyReviewOps(before, [{ op: 'impactSection', sectionKey: sectionKeyOf(b), changeImpact: 'MEDIUM' }], { now: T });
  const after = mergeReviewState(run(PAGE_A, withItems(BULWARK), '9.2'), clone(before));
  const a = byName(after, /^Bulwark/)[0];
  check('untouched changes: no lineage and no invented review (still pending), yet their section review moved', a.review.state === 'pending' && !a.previousChangeIds && after.mergeStats.migrated === 0 && after.sectionReview[sectionKeyOf(a)]?.changeImpact === 'MEDIUM' && after.orphanedSectionReviews.length === 0, after.mergeStats);
}

console.log('\n=== 3. The reverse: a tracked entity leaves the catalog -> its review follows it to the untracked key ===');
{
  const before = initReview(run(PAGE_A, real, '9.2'));
  const ard = byName(before, /^Ardent/)[0];
  applyReviewOps(before, [{ op: 'remove', changeId: ard.changeId }, { op: 'impactSection', sectionKey: sectionKeyOf(ard), changeImpact: 'LOW' }], { now: T });
  const after = mergeReviewState(run(PAGE_A, { ...real, itemRoster: ITEMS.filter((i) => i.id !== 'ardent-censer') }, '9.2'), clone(before));
  const a = byName(after, /^Ardent/)[0];
  check('Ardent Censer is now UNMATCHED under "item:ardentcenser"', a.entity.status === 'UNMATCHED' && a.entity.key === 'item:ardentcenser');
  check('...its Remove decision and section impact followed it; nothing orphaned', a.review.state === 'removed' && after.sectionReview['entity:item:ardentcenser']?.changeImpact === 'LOW' && after.orphanedChanges.length === 0 && after.orphanedSectionReviews.length === 0);
}

// ======================================================================================================================
console.log('\n=== 4. A SYSTEM block becomes an entity (Bulwark under GAMEPLAY CHANGES) -> reconnected across kinds ===');
{
  const PAGE_D = `# Wild Rift Patch Notes 9.3\n\n## GAMEPLAY CHANGES\n\n### Bulwark of the Mountain\n\n- Shield: 120 → 140\n`;
  const before = initReview(run(PAGE_D, real, '9.3'));
  const sys = before.changes[0];
  check('setup: the block is a SYSTEM change (category "other")', sys.kind === 'system' && sys.system.category === 'other');
  applyReviewOps(before, [{ op: 'keep', changeId: sys.changeId }, { op: 'editSectionTitle', sectionKey: sectionKeyOf(sys), displayTitle: 'Bulwark buff' }], { now: T });
  const after = mergeReviewState(run(PAGE_D, withItems(BULWARK), '9.3'), clone(before));
  const ent = after.changes[0];
  check('after: an EXISTING item entity owned by its heading', ent.kind === 'entity' && ent.entity.status === 'EXISTING' && ent.entity.key === 'item:bulwark-of-the-mountain');
  check('...Keep and the section title followed it; nothing orphaned', ent.review.state === 'kept' && after.sectionReview[sectionKeyOf(ent)]?.displayTitle === 'Bulwark buff' && after.orphanedChanges.length === 0 && after.orphanedSectionReviews.length === 0);
}

// ======================================================================================================================
console.log('\n=== 5. Ambiguity is never guessed: two old sections collapsing into one new section ===');
{
  // ALL_PATHS has Bulwark twice: an explicit "Name / Base Stats" block (entity) AND a heading under GAMEPLAY CHANGES (system).
  // Once the catalog knows Bulwark, BOTH become the same entity section -> which old section review wins is not provable.
  const before = initReview(run(ALL_PATHS_PAGE, real, '9.1'));
  const [ent, sys] = [before.changes.find((c) => c.entity && /^Bulwark/.test(c.entity.name)), before.changes.find((c) => c.system && /^Bulwark/.test(c.system.area))];
  applyReviewOps(before, [
    { op: 'keep', changeId: ent.changeId }, { op: 'keep', changeId: sys.changeId },
    { op: 'impactSection', sectionKey: sectionKeyOf(ent), changeImpact: 'HIGH' }, { op: 'impactSection', sectionKey: sectionKeyOf(sys), changeImpact: 'LOW' },
  ], { now: T });
  const after = mergeReviewState(run(ALL_PATHS_PAGE, withItems(BULWARK), '9.1'), clone(before));
  const bul = after.changes.filter((c) => c.entity && c.entity.key === 'item:bulwark-of-the-mountain');
  check('both changes now belong to ONE entity section, and BOTH Keep decisions were carried (change-level identity is unambiguous)', bul.length === 2 && bul.every((c) => c.review.state === 'kept'));
  check('...but the two conflicting section reviews (HIGH vs LOW) were NOT merged or guessed: neither moved', !after.sectionReview['entity:item:bulwark-of-the-mountain'] && after.sectionMigrations.length === 0);
  check('...both are kept and surfaced as orphaned section reviews (never deleted)', after.orphanedSectionReviews.map((o) => o.sectionKey).sort().join() === [sectionKeyOf(ent), sectionKeyOf(sys)].sort().join() && after.sectionReview[sectionKeyOf(ent)].changeImpact === 'HIGH');
  check('the unrelated entities in the same patch keep their IDs', after.changes.filter((c) => c.entity && /^(Leona|Ardent Censer|Aery)$/.test(c.entity.name)).every((c) => !c.previousChangeIds));
}

// ======================================================================================================================
console.log('\n=== 6. Plain rescans are unaffected ===');
{
  const before = initReview(run(ALL_PATHS_PAGE, real, '9.1'));
  applyReviewOps(before, [{ op: 'keep', changeId: before.changes[3].changeId }, { op: 'impactSection', sectionKey: sectionKeyOf(before.changes[3]), changeImpact: 'MEDIUM' }], { now: T });
  const after = mergeReviewState(run(ALL_PATHS_PAGE, real, '9.1'), clone(before));
  check('same text + same catalog: every change ID identical, nothing migrated, nothing orphaned', after.changes.every((c, i) => c.changeId === before.changes[i].changeId && !c.previousChangeIds) && after.mergeStats.migrated === 0 && after.sectionMigrations.length === 0 && after.orphanedChanges.length === 0 && after.orphanedSectionReviews.length === 0);
  check('...review and section review carried exactly as before', after.changes[3].review.state === 'kept' && after.sectionReview[sectionKeyOf(after.changes[3])].changeImpact === 'MEDIUM');
  check('a brand-new dataset (no previous) has empty migration bookkeeping', (() => { const d = mergeReviewState(run(ALL_PATHS_PAGE, real), null); return d.sectionMigrations.length === 0 && d.orphanedSectionReviews.length === 0; })());
  check('sourceNameOf: a System section\'s Riot name is its area heading', sourceNameOf(before.changes.find((c) => c.kind === 'system' && c.system.category === 'jungle')) === 'Jungle Adjustments');
}

done();
