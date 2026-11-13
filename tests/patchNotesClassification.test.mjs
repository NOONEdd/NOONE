// Patch Notes -- manual classification (Stages 2-5): the shared classification model, Support-impact preservation, the per-patch
// "Move to In Academy" decision and remembered rules.
//
//   node tests/patchNotesClassification.test.mjs
//
// Pure functions + the real admin/public handlers against an in-memory fake KV. No network, no production KV, nothing written to disk.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePatchDocument } from '../functions/_lib/patchParser.js';
import { extractPatchNotes } from '../functions/_lib/patchNotesExtract.js';
import { initReview, applyReviewOps, deriveLegacyReport, reviewSummary, sectionKeyOf, isChangePublishable, mergeReviewState, applyCoachFieldEdits, mergeFreshOntoExisting } from '../functions/_lib/patchNotesReview.js';
import { toPublicView } from '../functions/_lib/patchNotesPublic.js';
import { effectiveClassification, isAutoInAcademy } from '../src/lib/patchNotesClassification.js';
import { CHAMPIONS, isAcademyCovered } from '../src/data/champions.js';
import { ITEMS } from '../src/data/items.js';
import { RUNES } from '../src/data/runes.js';
import { ALL_PATHS_PAGE } from './fixtures/patch-notes-identity-pages.mjs';
import * as H from './helpers/patchNotesHelpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { check, done } = H.makeChecker();
const T = '2026-11-12T00:00:00.000Z';
const real = { championRoster: CHAMPIONS.filter(isAcademyCovered), itemRoster: ITEMS, runeRoster: RUNES };
const clone = (x) => JSON.parse(JSON.stringify(x));
const build = (text, pv = '9.1', rosters = real) => initReview(extractPatchNotes({ units: parsePatchDocument(text, { maxUnitChars: 12000 }).units, ...rosters, patchVersion: pv, sourceUrl: 'https://example.test', extractedAt: T }));
const find = (ds, re) => ds.changes.filter((c) => re.test(c.entity ? c.entity.name : c.system.area));
const decide = (ds, change, decision) => { ds.sectionReview[sectionKeyOf(change)] = { ...(ds.sectionReview[sectionKeyOf(change)] || {}), classification: { origin: 'manual', at: T, ...decision } }; return ds; };
const draft = (ds) => deriveLegacyReport(ds, { itemRoster: ITEMS, mode: 'draft' });
const pub = (ds) => deriveLegacyReport(ds, { itemRoster: ITEMS, mode: 'publish' });
const ACADEMY_FIELDS = ['academyStatus', 'academyStatusOrigin', 'academyStatusAuto', 'academyLink', 'sectionKeys'];
const stripAcademy = (legacy) => Object.fromEntries(Object.entries(legacy).map(([k, list]) => [k, list.map((e) => Object.fromEntries(Object.entries(e).filter(([f]) => !ACADEMY_FIELDS.includes(f))))]));

// ======================================================================================================================
console.log('\n=== Stage 2.1: with NO classification decisions, everything public is byte-identical to before ===');
{
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/patch-notes-public-baseline.json'), 'utf8'));
  // the exact inputs the baseline was recorded from (scratch generator, pre-Stage-2 code)
  const reviewed = build(ALL_PATHS_PAGE, '9.1');
  applyReviewOps(reviewed, [
    { op: 'keep', changeId: find(reviewed, /^Bulwark/)[0].changeId },
    { op: 'keep', changeId: find(reviewed, /^Mystery Blade/)[0].changeId },
    { op: 'keep', changeId: find(reviewed, /^Jungle Adjustments/)[0].changeId },
    { op: 'remove', changeId: find(reviewed, /^Leona/)[0].changeId },
    { op: 'edit', changeId: find(reviewed, /^Ardent/)[0].changeId, displayText: 'Ardent: faster', reviewerNote: 'note' },
    { op: 'impactSection', sectionKey: sectionKeyOf(find(reviewed, /^Ardent/)[0]), changeImpact: 'HIGH' },
    { op: 'classifySection', sectionKey: sectionKeyOf(find(reviewed, /^Senna/)[0]), comparisonState: 'NERF' },
  ], { now: T });
  const cases = { 'all-paths-reviewed': reviewed, 'riot-7-3a-unreviewed': build(fs.readFileSync(path.join(ROOT, 'tests/fixtures/riot-wild-rift-7-3a-champion-changes.txt'), 'utf8'), '7.3a') };
  for (const [name, ds] of Object.entries(cases)) {
    const report = { id: name, patch: '9.1', status: 'published', generatedAt: T, sourceUrl: 'https://example.test', supportMetaAnalysis: '', patchNotes: ds, ...draft(ds) };
    check(`${name}: public Patch Notes view byte-identical to the pre-change baseline`, JSON.stringify(toPublicView(report, ITEMS)) === JSON.stringify(base[name].public));
    check(`${name}: admin draft entries identical apart from the ADDED classification metadata`, JSON.stringify(stripAcademy(draft(ds))) === JSON.stringify(stripAcademy(base[name].draft)));
    const sum = reviewSummary(ds); const { academy, ...rest } = sum;
    check(`${name}: review summary identical apart from the ADDED effective counts (which equal the automatic ones, 0 by decision)`, JSON.stringify(rest) === JSON.stringify(base[name].summary)
      && academy.IN_ACADEMY === sum.status.EXISTING && academy.UNMATCHED === sum.status.UNMATCHED && academy.NEW_CANDIDATE === sum.status.NEW_CANDIDATE && academy.SYSTEM === sum.status.SYSTEM && academy.byDecision === 0);
  }
}

// ======================================================================================================================
console.log('\n=== Stage 2.2: classification, Academy link, decision origin and publication are four separate things ===');
{
  const ds = build(ALL_PATHS_PAGE);
  const ard = find(ds, /^Ardent/)[0]; const bul = find(ds, /^Bulwark/)[0]; const sys = find(ds, /^Bulwark/).find((c) => c.kind === 'system');
  const e0 = effectiveClassification(ard, ds);
  check('automatic Academy match: IN_ACADEMY / auto / linked to its canonical record (ardent-censer)', e0.status === 'IN_ACADEMY' && e0.origin === 'auto' && e0.auto === 'IN_ACADEMY' && e0.link && e0.link.id === 'ardent-censer' && e0.link.origin === 'auto');
  check('untracked item: UNMATCHED / auto / NO link', effectiveClassification(bul, ds).status === 'UNMATCHED' && effectiveClassification(bul, ds).link === null);
  check('System block: SYSTEM, no type, no link', effectiveClassification(sys, ds).status === 'SYSTEM' && effectiveClassification(sys, ds).type === null);

  decide(ds, bul, { status: 'IN_ACADEMY' });
  const e1 = effectiveClassification(bul, ds);
  check('classification WITHOUT a canonical Academy id: In Academy, origin manual, link null, automatic value still UNMATCHED', e1.status === 'IN_ACADEMY' && e1.origin === 'manual' && e1.link === null && e1.auto === 'UNMATCHED');
  check('...the extraction itself is untouched (entity.status / key / id)', bul.entity.status === 'UNMATCHED' && bul.entity.key === 'item:bulwarkofthemountain' && bul.entity.id === null);
  check('...NOT published: classification never bypasses the Keep / Remove workflow (still pending)', bul.review.state === 'pending' && !isChangePublishable(bul, ds) && !isAutoInAcademy(bul) && !pub(ds).itemChanges.some((e) => e.itemName === 'Bulwark of the Mountain'));
  check('...still counted as needing review (a publication decision is outstanding)', reviewSummary(ds).needsReview === reviewSummary(build(ALL_PATHS_PAGE)).needsReview);
  const entry = draft(ds).itemChanges.find((e) => e.itemName === 'Bulwark of the Mountain');
  check('...listed as an item, itemId null (no record is assumed), entityStatus still the automatic UNMATCHED, academyStatus IN_ACADEMY / manual', entry && entry.itemId === null && entry.entityStatus === 'UNMATCHED' && entry.academyStatus === 'IN_ACADEMY' && entry.academyStatusOrigin === 'manual' && entry.academyLink === null && !entry.academyDataFlag);
  check('...review summary: one more In Academy entity "by your decision"', reviewSummary(ds).academy.byDecision === 1 && reviewSummary(ds).academy.IN_ACADEMY === reviewSummary(build(ALL_PATHS_PAGE)).academy.IN_ACADEMY + 1);
  applyReviewOps(ds, [{ op: 'keep', changeId: bul.changeId }], { now: T });
  const p = pub(ds).itemChanges.find((e) => e.itemName === 'Bulwark of the Mountain');
  check('once KEPT it is published under Items -- and the public entry carries no review metadata', Boolean(p) && !('academyStatus' in toPublicView({ patchNotes: ds, id: 'x', generatedAt: T }, ITEMS).itemChanges.find((e) => e.itemName === 'Bulwark of the Mountain')));

  decide(ds, bul, { status: 'IN_ACADEMY', academyId: 'ardent-censer' });
  const e2 = effectiveClassification(bul, ds);
  check('a manual LINK is independent of the status: link { id, origin: manual }', e2.status === 'IN_ACADEMY' && e2.link.id === 'ardent-censer' && e2.link.origin === 'manual');
  decide(ds, bul, { status: 'AUTO' });
  check('an explicit "AUTO" decision = the automatic result (UNMATCHED), recorded as such', effectiveClassification(bul, ds).status === 'UNMATCHED' && effectiveClassification(bul, ds).origin === 'auto' && effectiveClassification(bul, ds).decision.status === 'AUTO');
  decide(ds, bul, { status: 'IN_ACADEMY', origin: 'rule', ruleKey: 'item:bulwarkofthemountain' });
  check('a remembered-rule decision reports origin "rule"', effectiveClassification(bul, ds).origin === 'rule');

  const ds2 = build(ALL_PATHS_PAGE);
  const sys2 = find(ds2, /^Bulwark/).find((c) => c.kind === 'system');
  decide(ds2, sys2, { status: 'IN_ACADEMY', type: 'item' });
  applyReviewOps(ds2, [{ op: 'keep', changeId: sys2.changeId }], { now: T });
  const d2 = draft(ds2);
  const bulEntries = d2.itemChanges.filter((e) => e.itemName === 'Bulwark of the Mountain');
  check('a System block classified as an item leaves System / Meta', !d2.systemChanges.some((e) => (e.sectionKeys || [e.sectionKey]).includes(sectionKeyOf(sys2))));
  check('...and joins the ONE "Bulwark of the Mountain" item entry (no duplicate entry), which records both changes and both review sections',
    bulEntries.length === 1 && bulEntries[0].itemId === null && bulEntries[0].changeIds.includes(sys2.changeId) && bulEntries[0].changeIds.includes(find(ds2, /^Bulwark/)[0].changeId) && bulEntries[0].sectionKeys.includes(sectionKeyOf(sys2)) && bulEntries[0].sectionKeys.length === 2, bulEntries);
  check('...its original System extraction is untouched', sys2.kind === 'system' && sys2.system.category === 'other');
  // a heading equal to TWO tracked names (an item and a rune both called "Overgrowth") under a section with no entity type
  const unk = build(`# T\n## GAMEPLAY CHANGES\n### Overgrowth\n- Health: 1 → 2\n`, '9.1', { ...real, itemRoster: [...ITEMS, { id: 'overgrowth-item', name: 'Overgrowth', category: 'Support' }] });
  check('an ambiguous owner with no derivable type, without a decision, is still listed as an unmatched System row (unchanged)', unk.changes[0].ownership.source === 'unmatched' && unk.changes[0].entity.type === 'unknown' && draft(unk).systemChanges.some((e) => e.systemCategory === 'unmatched'));
  check('a section review entry holding ONLY a classification decision (no state) is visible, not "removed"', (() => { const d = build(ALL_PATHS_PAGE); decide(d, find(d, /^Bulwark/)[0], { status: 'IN_ACADEMY' }); return reviewSummary(d).sectionsRemoved === 0 && draft(d).itemChanges.some((e) => e.itemName === 'Bulwark of the Mountain'); })());
}

// ======================================================================================================================
console.log('\n=== Stage 3: Support-impact (Coach) fields survive review actions, rescans, classification, rules and identity changes ===');
{
  const BULWARK = { id: 'bulwark-of-the-mountain', name: 'Bulwark of the Mountain', category: 'Support', tier: 'Unranked', info: '' };
  // a stored report: dataset + derived entries, with Coach fields written the way the "edit" action writes them
  const stored = (ds) => ({ patchNotes: ds, ...mergeFreshOntoExisting(draft(ds), {}) });
  const coachEdit = (report, field, idField, pick, fields) => {
    const incoming = report[field].filter(pick).map((e) => ({ ...e, ...fields }));
    return { ...report, [field]: applyCoachFieldEdits(report[field], incoming, idField) };
  };
  // the exact sequence functions/api/admin/patch-reports.js "review" runs: ops on the dataset, re-derive, carry Coach fields
  const reviewAction = (report, ops) => { const ds = clone(report.patchNotes); applyReviewOps(ds, ops(ds), { now: T }); return { ...report, patchNotes: ds, ...mergeFreshOntoExisting(draft(ds), report) }; };
  // the exact sequence functions/api/admin/patch-check.js runs on a rescan (fresh extraction -> carry review -> carry Coach fields)
  const rescan = (report, rosters = real) => { const fresh = mergeReviewState(build(ALL_PATHS_PAGE, '9.1', rosters), clone(report.patchNotes)); const legacy = draft(fresh); return { ...report, patchNotes: fresh, ...mergeFreshOntoExisting({ ...legacy, patchNotes: fresh }, report) }; };
  const bulEntry = (r) => r.itemChanges.find((e) => e.itemName === 'Bulwark of the Mountain');
  const ezEntry = (r) => r.championChanges.find((e) => e.championName === 'Ezreal');
  const COACH = { supportImpact: 'Huge for tank supports', coachNotes: 'Rush it', tierListActionNeeded: true, recommendedTierAction: 'Raise' };
  const hasCoach = (e) => Boolean(e) && e.supportImpact === COACH.supportImpact && e.coachNotes === COACH.coachNotes && e.tierListActionNeeded === true && e.recommendedTierAction === 'Raise';

  let r = stored(build(ALL_PATHS_PAGE));
  r = coachEdit(r, 'itemChanges', 'itemId', (e) => e.itemName === 'Bulwark of the Mountain', COACH);
  r = coachEdit(r, 'championChanges', 'championId', (e) => e.championName === 'Ezreal', COACH);
  check('an edit reaches entities WITHOUT an Academy id (unmatched Bulwark, uncoached Ezreal) -- matched by review section, not id', hasCoach(bulEntry(r)) && hasCoach(ezEntry(r)) && bulEntry(r).itemId === null && ezEntry(r).championId === null);
  check('...and never touches fact fields (what Riot said)', bulEntry(r).whatChanged === bulEntry(stored(build(ALL_PATHS_PAGE))).whatChanged);

  r = reviewAction(r, (ds) => [{ op: 'keep', changeId: find(ds, /^Leona/)[0].changeId }, { op: 'impactSection', sectionKey: sectionKeyOf(find(ds, /^Ardent/)[0]), changeImpact: 'LOW' }]);
  check('1. survives unrelated REVIEW ACTIONS', hasCoach(bulEntry(r)) && hasCoach(ezEntry(r)));
  r = reviewAction(r, (ds) => [{ op: 'keep', changeId: find(ds, /^Bulwark/)[0].changeId }]);
  check('...and a review action on the entity itself', hasCoach(bulEntry(r)));

  r = reviewAction(r, (ds) => { decide(ds, find(ds, /^Bulwark/)[0], { status: 'IN_ACADEMY' }); return [{ op: 'keep', changeId: find(ds, /^Leona/)[0].changeId }]; });
  check('2. survives a CLASSIFICATION change (Bulwark moved to In Academy)', hasCoach(bulEntry(r)) && bulEntry(r).academyStatus === 'IN_ACADEMY');
  r = reviewAction(r, (ds) => { decide(ds, find(ds, /^Bulwark/).find((c) => c.kind === 'system'), { status: 'IN_ACADEMY', type: 'item' }); return [{ op: 'keep', changeId: find(ds, /^Bulwark/).find((c) => c.kind === 'system').changeId }]; });
  check('...and a second section (the System block) joining that entry', hasCoach(bulEntry(r)) && bulEntry(r).sectionKeys.length === 2);
  r = reviewAction(r, (ds) => { decide(ds, find(ds, /^Bulwark/)[0], { status: 'IN_ACADEMY', origin: 'rule', ruleKey: 'item:bulwarkofthemountain' }); return [{ op: 'keep', changeId: find(ds, /^Leona/)[0].changeId }]; });
  check('3. survives a REMEMBERED-RULE decision being applied', hasCoach(bulEntry(r)) && bulEntry(r).academyStatusOrigin === 'rule');
  r = reviewAction(r, (ds) => { delete ds.sectionReview[sectionKeyOf(find(ds, /^Bulwark/)[0])].classification; delete ds.sectionReview[sectionKeyOf(find(ds, /^Bulwark/).find((c) => c.kind === 'system'))].classification; return [{ op: 'keep', changeId: find(ds, /^Leona/)[0].changeId }]; });
  check('...and the classification being reverted to automatic', hasCoach(bulEntry(r)) && bulEntry(r).academyStatus === 'UNMATCHED');
  check('...and an entry moving to another list: Ezreal\'s Coach fields are still on Ezreal', hasCoach(ezEntry(r)));

  r = rescan(r);
  check('4. survives a RESCAN (same catalog)', hasCoach(bulEntry(r)) && hasCoach(ezEntry(r)));
  r = rescan(r, { ...real, itemRoster: [...ITEMS, BULWARK] });
  check('5. survives an IDENTITY change: Bulwark gains a canonical record, its section key changes, its Coach fields follow', hasCoach(bulEntry(r)) && bulEntry(r).itemId === 'bulwark-of-the-mountain' && bulEntry(r).sectionKey === 'entity:item:bulwark-of-the-mountain');

  // two DIFFERENT stored entries collapsing into one new section: their Coach text is never guessed onto it
  {
    const PAGE2 = `# T\n## ITEM ADJUSTMENTS\n### Bulwark of the Mountain\n- Shield: 1 → 2\n## GAMEPLAY CHANGES\n### Bulwark of the Mountain\n- Health: 3 → 4\n`;
    let a = { patchNotes: build(PAGE2), ...mergeFreshOntoExisting(draft(build(PAGE2)), {}) };
    a = reviewAction(a, (ds) => { decide(ds, ds.changes.find((c) => c.kind === 'system'), { status: 'IN_ACADEMY', type: 'champion' }); return [{ op: 'keep', changeId: ds.changes[1].changeId }]; });
    a = coachEdit(a, 'itemChanges', 'itemId', () => true, { supportImpact: 'item text' });
    a = coachEdit(a, 'championChanges', 'championId', () => true, { supportImpact: 'champion text' });
    check('setup: two separate entries (an item and a reclassified champion) with different Coach text', a.itemChanges[0].supportImpact === 'item text' && a.championChanges[0].supportImpact === 'champion text');
    const fresh = mergeReviewState(build(PAGE2, '9.1', { ...real, itemRoster: [...ITEMS, BULWARK] }), clone(a.patchNotes));
    const merged = mergeFreshOntoExisting({ ...draft(fresh), patchNotes: fresh }, a);
    const e = merged.itemChanges.find((x) => x.itemId === 'bulwark-of-the-mountain');
    check('both collapse into one catalog entity: the two conflicting texts are NOT guessed onto it (left blank; still on the old revision)', e && e.supportImpact === '' && fresh.sectionMoves.length === 2);
  }

  // entries stored before entries carried section keys (legacy): the id fallback still works for tracked entities
  const legacy = stored(build(ALL_PATHS_PAGE));
  legacy.itemChanges = legacy.itemChanges.map((e) => { const { sectionKey, sectionKeys, ...rest } = e; return e.itemId === 'ardent-censer' ? { ...rest, supportImpact: 'legacy text' } : e; });
  const after = mergeFreshOntoExisting(draft(build(ALL_PATHS_PAGE)), legacy);
  check('legacy stored entry with no section keys: still matched by its Academy id', after.itemChanges.find((e) => e.itemId === 'ardent-censer').supportImpact === 'legacy text');
  const nothing = mergeFreshOntoExisting(draft(build(ALL_PATHS_PAGE)), stored(build(ALL_PATHS_PAGE)));
  check('no Coach field is ever invented: a fresh entry with no stored counterpart keeps its blank defaults', nothing.itemChanges.every((e) => e.supportImpact === '' && e.coachNotes === ''));
}

done();
