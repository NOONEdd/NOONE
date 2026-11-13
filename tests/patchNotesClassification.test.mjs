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
import { onRequestPost as checkPost } from '../functions/api/admin/patch-check.js';
import { onRequestPost as reportsPost, onRequestGet as reportsGet } from '../functions/api/admin/patch-reports.js';
import { onRequestGet as publicGet } from '../functions/api/patch-reports.js';
import { createSessionToken } from '../functions/_lib/adminAuth.js';
import { SOURCE_TEXT_VERSION } from '../functions/_lib/patchText.js';
import * as KVS from '../functions/_lib/kvSafety.js';

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

// ======================================================================================================================
console.log('\n=== Stage 4.1: "Move to In Academy" -- the per-patch decision (review operation) ===');
const CATALOG = { champion: new Set(CHAMPIONS.map((c) => c.id)), item: new Set(ITEMS.map((i) => i.id)), rune: new Set(RUNES.map((r) => r.id)) };
const RUNE_PAGE = `# Wild Rift Patch Notes 9.4\n\n## RUNE ADJUSTMENTS\n\n### Mystic Echo\n\n- Damage: 10 → 12\n`;
const op = (sectionKey, extra = {}) => ({ op: 'setSectionClassification', sectionKey, status: 'IN_ACADEMY', ...extra });
{
  const ds = build(ALL_PATHS_PAGE);
  const before = clone(ds);
  const bul = find(ds, /^Bulwark/)[0]; const blade = find(ds, /^Mystery Blade/)[0]; const ez = find(ds, /^Ezreal/)[0];
  const sys = find(ds, /^Bulwark/).find((c) => c.kind === 'system'); const ard = find(ds, /^Ardent/)[0];
  const r = applyReviewOps(ds, [op(sectionKeyOf(bul)), op(sectionKeyOf(blade)), op(sectionKeyOf(ez), { academyId: 'ezreal' }), op(sectionKeyOf(sys), { type: 'item' })], { now: T, catalog: CATALOG });
  check('Unmatched item, New candidate item, Unmatched champion (linked) and a System block (as an item): all 4 applied', r.applied.length === 4 && r.errors.length === 0, r.errors);
  check('each section now reads In Academy, origin manual', [bul, blade, ez, sys].every((c) => effectiveClassification(c, ds).status === 'IN_ACADEMY' && effectiveClassification(c, ds).origin === 'manual'));
  check('the stored decision records the match-independent source key and the time', ds.sectionReview[sectionKeyOf(bul)].classification.sourceKey === 'item:bulwarkofthemountain' && ds.sectionReview[sectionKeyOf(bul)].classification.at === T);
  check('the original Riot source, normalized data, provenance, IDs and every review state are untouched', JSON.stringify(ds.changes.map((c) => [c.changeId, c.originalSourceText, c.normalizedData, c.provenance, c.entity, c.system, c.review])) === JSON.stringify(before.changes.map((c) => [c.changeId, c.originalSourceText, c.normalizedData, c.provenance, c.entity, c.system, c.review])));
  check('NOT published by the move (all still pending; nothing new on the public view)', JSON.stringify(pub(ds)) === JSON.stringify(pub(before)));
  check('Ezreal linked to the real champion record "ezreal" (portrait + ability icons resolve): championId in the derived entry', draft(ds).championChanges.find((e) => e.championName === 'Ezreal').championId === 'ezreal');
  check('the System block now has type "item" recorded on the decision (its own extraction has none)', ds.sectionReview[sectionKeyOf(sys)].classification.type === 'item' && !('type' in ds.sectionReview[sectionKeyOf(bul)].classification));

  const keepAll = applyReviewOps(ds, find(ds, /^Bulwark/).map((c) => ({ op: 'keep', changeId: c.changeId })), { now: T });
  const p = pub(ds).itemChanges.find((e) => e.itemName === 'Bulwark of the Mountain');
  check('after an explicit Keep: published under Items with its Riot description intact', keepAll.applied.length === 2 && p && /Shield: 120 → 140/.test(p.whatChanged) && p.changes.length === 2);

  const errs = (ops) => applyReviewOps(clone(ds), ops, { now: T, catalog: CATALOG }).errors.map((e) => e.error);
  check('refused: an entity already In Academy automatically (nothing to move)', /already In Academy automatically/.test(errs([op(sectionKeyOf(ard))])[0] || ''));
  check('refused: changing the type of an entity Riot filed under a typed section', /type comes from Riot/.test(errs([op(sectionKeyOf(bul), { type: 'champion' })])[0] || ''));
  check('refused: a System block without a type', /type \(champion, item or rune\) is required/.test(errs([op(sectionKeyOf(sys), { type: undefined })])[0] || '') || /type/.test(errs([{ op: 'setSectionClassification', sectionKey: sectionKeyOf(sys), status: 'IN_ACADEMY' }])[0] || ''));
  check('refused: a link to an id that is not in the catalog (or not of that type)', /not a item/.test(errs([op(sectionKeyOf(bul), { academyId: 'ezreal' })])[0] || '') && /not a champion/.test(errs([op(sectionKeyOf(ez), { academyId: 'nope' })])[0] || ''));
  check('refused: a link when no catalog is provided', applyReviewOps(clone(ds), [op(sectionKeyOf(bul), { academyId: 'ardent-censer' })], { now: T }).errors.length === 1);
  check('refused: unknown section, unknown status', /unknown sectionKey/.test(errs([op('entity:item:nope')])[0]) && /status must be/.test(errs([{ op: 'setSectionClassification', sectionKey: sectionKeyOf(bul), status: 'MAYBE' }])[0]));
  const forged = clone(build(ALL_PATHS_PAGE));
  applyReviewOps(forged, [op(sectionKeyOf(find(forged, /^Bulwark/)[0]), { origin: 'rule', ruleKey: 'item:x' })], { now: T, catalog: CATALOG });
  check('a client cannot claim the "remembered rule" origin: recorded as manual', forged.sectionReview[sectionKeyOf(find(forged, /^Bulwark/)[0])].classification.origin === 'manual' && !('ruleKey' in forged.sectionReview[sectionKeyOf(find(forged, /^Bulwark/)[0])].classification));

  const twice = build(ALL_PATHS_PAGE);
  applyReviewOps(twice, [op(sectionKeyOf(find(twice, /^Bulwark/)[0])), op(sectionKeyOf(find(twice, /^Bulwark/)[0]))], { now: T, catalog: CATALOG });
  check('the same move twice: one decision, one entry -- no duplicate entries', draft(twice).itemChanges.filter((e) => e.itemName === 'Bulwark of the Mountain').length === 1 && Object.keys(twice.sectionReview).length === 1);

  const rune = build(RUNE_PAGE, '9.4');
  const rr = applyReviewOps(rune, [op(sectionKeyOf(rune.changes[0]))], { now: T, catalog: CATALOG });
  check('a rune: an unmatched rune moves to In Academy and is listed with runes', rr.applied.length === 1 && draft(rune).runeChanges[0].runeName === 'Mystic Echo' && draft(rune).runeChanges[0].academyStatus === 'IN_ACADEMY');
}
{
  // REVERSAL restores the automatic result exactly
  const fresh = build(ALL_PATHS_PAGE);
  const ds = build(ALL_PATHS_PAGE);
  const bul = find(ds, /^Bulwark/)[0];
  applyReviewOps(ds, [op(sectionKeyOf(bul))], { now: T, catalog: CATALOG });
  applyReviewOps(ds, [{ op: 'setSectionClassification', sectionKey: sectionKeyOf(bul), status: null }], { now: T });
  check('revert (status null): the automatic classification is back -- derived view identical to never having moved it', JSON.stringify(draft(ds)) === JSON.stringify(draft(fresh)) && effectiveClassification(bul, ds).status === 'UNMATCHED');
  check('...and the decision is gone (an otherwise-empty section entry is removed, not left behind)', !ds.sectionReview[sectionKeyOf(bul)]);
  applyReviewOps(ds, [{ op: 'impactSection', sectionKey: sectionKeyOf(bul), changeImpact: 'HIGH' }, op(sectionKeyOf(bul)), { op: 'setSectionClassification', sectionKey: sectionKeyOf(bul), status: '' }], { now: T, catalog: CATALOG });
  check('...a revert keeps the section\'s other review settings (impact HIGH)', ds.sectionReview[sectionKeyOf(bul)].changeImpact === 'HIGH' && !ds.sectionReview[sectionKeyOf(bul)].classification);
  applyReviewOps(ds, [{ op: 'setSectionClassification', sectionKey: sectionKeyOf(bul), status: 'AUTO' }], { now: T });
  check('"AUTO" is stored (meaning: ignore a remembered rule in this patch) and reads as the automatic result', ds.sectionReview[sectionKeyOf(bul)].classification.status === 'AUTO' && effectiveClassification(bul, ds).status === 'UNMATCHED');
  // the decision survives a rescan (sectionReview is carried by stable section key)
  const rescanned = mergeReviewState(build(ALL_PATHS_PAGE), (() => { const d = build(ALL_PATHS_PAGE); applyReviewOps(d, [op(sectionKeyOf(find(d, /^Bulwark/)[0]))], { now: T, catalog: CATALOG }); return d; })());
  check('the decision survives a rescan of the same patch', effectiveClassification(find(rescanned, /^Bulwark/)[0], rescanned).status === 'IN_ACADEMY');
}

// ======================================================================================================================
console.log('\n=== Stage 4.2: end to end through the real admin + public handlers (fake KV): detect -> move -> reload -> publish -> rescan -> revert ===');
function makeMockKV() {
  const store = new Map();
  return { store, async get(k) { if (this.__failGet && this.__failGet(k)) throw new Error('simulated KV GET failure'); return store.has(k) ? store.get(k) : null; }, async put(k, v) { if (this.__failPut && this.__failPut(k)) throw new Error('simulated KV PUT failure'); store.set(k, String(v)); }, async delete(k) { store.delete(k); }, async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true, cursor: null }; } };
}
const SLUG = 'wild-rift-patch-notes-9-5';
const E2E_PAGE = `# Wild Rift Patch Notes 9.5\n\n## CHAMPION ADJUSTMENTS\n\n### Ezreal\n\n- Base Health: 600 → 620\n\n## ITEM ADJUSTMENTS\n\n### Bulwark of the Mountain\n\n- Shield: 120 → 140\n- Health: 300 → 350\n\n### Ardent Censer\n\n- Attack Speed: 20% → 25%\n`;
async function e2eSetup(page = E2E_PAGE, slug = SLUG) {
  const kv = makeMockKV();
  await KVS.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => ({ champions: {}, items: {}, runes: {}, decisionTrees: {}, patch: '9.4', verifiedPatch: '9.4', patchStatus: null }) });
  await kv.put('riot-latest-patch-meta', JSON.stringify({ slug }));
  await kv.put(`riot-fallback-full-content:${slug}:${SOURCE_TEXT_VERSION}`, JSON.stringify({ content: page, truncated: false }));
  const env = { COACH_KV: kv, ADMIN_SESSION_SECRET: 'test-secret' };
  const cookie = `academy_admin_session=${await createSessionToken(env)}`;
  const post = async (url, body, handler) => { const res = await handler({ request: new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) }), env }); return { status: res.status, body: await res.json() }; };
  const reports = (body) => post('https://x/api/admin/patch-reports', { id: slug, ...body }, reportsPost);
  const check_ = (body) => post('https://x/api/admin/patch-check', body, checkPost);
  const getRev = async (revision) => (await (await reportsGet({ request: new Request(`https://x/api/admin/patch-reports?id=${slug}&revision=${revision}`, { headers: { Cookie: cookie } }), env })).json()).report;
  const publicView = async () => (await (await publicGet({ request: new Request('https://x/api/patch-reports'), env })).json()).reports.find((r) => r.id === slug);
  return { kv, env, cookie, reports, check: check_, getRev, publicView };
}
const sk = (report, re) => sectionKeyOf(report.patchNotes.changes.find((c) => re.test(c.entity ? c.entity.name : c.system.area)));
const idsOf = (report, re) => report.patchNotes.changes.filter((c) => re.test(c.entity ? c.entity.name : c.system.area)).map((c) => c.changeId);
{
  const A = await e2eSetup();
  const d = await A.check({ trigger: 'manual' });
  check('1. Check for New Patch: detected, revision 1 pending review, Bulwark UNMATCHED', d.body.ok && d.body.status === 'pending_review' && d.body.report.patchNotes.changes.some((c) => c.entity && c.entity.name === 'Bulwark of the Mountain' && c.entity.status === 'UNMATCHED'));
  const r1 = await A.getRev(1);
  const mv = await A.reports({ action: 'review', revision: 1, ops: [{ op: 'setSectionClassification', sectionKey: sk(r1, /^Bulwark/), status: 'IN_ACADEMY' }, { op: 'setSectionClassification', sectionKey: sk(r1, /^Ezreal/), status: 'IN_ACADEMY', academyId: 'ezreal' }] });
  check('2. Move to In Academy (Bulwark unlinked, Ezreal linked to the real champion): accepted', mv.status === 200 && mv.body.applied.length === 2, mv.body);
  const reloaded = await A.getRev(1);
  check('3. reload: the decisions are persisted in the revision, with origin manual', reloaded.patchNotes.sectionReview[sk(reloaded, /^Bulwark/)].classification.status === 'IN_ACADEMY' && reloaded.patchNotes.sectionReview[sk(reloaded, /^Ezreal/)].classification.academyId === 'ezreal');
  check('...the stored admin entries show it (academyStatus IN_ACADEMY, Ezreal championId "ezreal"); the summary counts 3 changes (2 Bulwark + 1 Ezreal) as classified by decision', reloaded.itemChanges.find((e) => e.itemName === 'Bulwark of the Mountain').academyStatus === 'IN_ACADEMY' && reloaded.championChanges.find((e) => e.championName === 'Ezreal').championId === 'ezreal' && reloaded.patchNotesSummary.academy.byDecision === 3, { item: reloaded.itemChanges.find((e) => e.itemName === 'Bulwark of the Mountain')?.academyStatus, ez: reloaded.championChanges.find((e) => e.championName === 'Ezreal')?.championId, academy: reloaded.patchNotesSummary.academy });
  check('...Riot\'s original text is unchanged in storage', reloaded.patchNotes.changes.find((c) => c.entity && c.entity.name === 'Bulwark of the Mountain').originalSourceText === '- Shield: 120 → 140');
  await A.reports({ action: 'approve', revision: 1 }); const pub1 = await A.reports({ action: 'publish', revision: 1 });
  const v1 = await A.publicView();
  check('4. published WITHOUT a Keep: Bulwark and Ezreal are NOT on the public page (classification never publishes); Ardent Censer is', pub1.status === 200 && !v1.itemChanges.some((e) => e.itemName === 'Bulwark of the Mountain') && !v1.championChanges.some((e) => e.championName === 'Ezreal') && v1.itemChanges.some((e) => e.itemId === 'ardent-censer'));
  const keyBefore = A.kv.store.get(`patch-intel:report:${SLUG}:1`);
  const live = await A.reports({ action: 'review', revision: 1, ops: [{ op: 'setSectionClassification', sectionKey: sk(r1, /^Bulwark/), status: null }] });
  check('5. classification on the LIVE (published) revision is refused (409 CLASSIFICATION_ON_PUBLISHED) and nothing is written', live.status === 409 && live.body.code === 'CLASSIFICATION_ON_PUBLISHED' && A.kv.store.get(`patch-intel:report:${SLUG}:1`) === keyBefore);
  const keepOnLive = await A.reports({ action: 'review', revision: 1, ops: [{ op: 'impactSection', sectionKey: sk(r1, /^Ardent/), changeImpact: 'LOW' }] });
  check('...other review operations on the live revision behave exactly as before (accepted)', keepOnLive.status === 200);
  const again = await A.check({ trigger: 'manual' });
  check('6. Check for New Patch again: "no new patch", nothing rewritten, the decisions are still there', again.body.ok && again.body.newPatch === false && (await A.getRev(1)).patchNotes.sectionReview[sk(r1, /^Bulwark/)].classification.status === 'IN_ACADEMY');
  const rs = await A.check({ action: 'rescan', patchId: SLUG });
  const r2 = await A.getRev(2);
  check('7. Re-scan: revision 2 (draft) carries both decisions; the published revision 1 is untouched', rs.body.ok && rs.body.revision === 2 && effectiveClassification(r2.patchNotes.changes.find((c) => c.entity && c.entity.name === 'Bulwark of the Mountain'), r2.patchNotes).status === 'IN_ACADEMY' && r2.patchNotes.sectionReview[sk(r2, /^Ezreal/)].classification.academyId === 'ezreal' && (await A.getRev(1)).status === 'published');
  check('...no duplicate entities after detection + rescan (one Bulwark, one Ezreal)', r2.itemChanges.filter((e) => e.itemName === 'Bulwark of the Mountain').length === 1 && r2.championChanges.filter((e) => e.championName === 'Ezreal').length === 1 && r2.patchNotes.changes.length === r1.patchNotes.changes.length);
  const kp = await A.reports({ action: 'review', revision: 2, ops: [...idsOf(r2, /^Bulwark/), ...idsOf(r2, /^Ezreal/)].map((changeId) => ({ op: 'keep', changeId })) });
  await A.reports({ action: 'approve', revision: 2 }); await A.reports({ action: 'publish', revision: 2 });
  const v2 = await A.publicView();
  const pb = v2.itemChanges.find((e) => e.itemName === 'Bulwark of the Mountain'); const pe = v2.championChanges.find((e) => e.championName === 'Ezreal');
  check('8. after Keep + publish: Bulwark under Items, Ezreal under Champions with championId "ezreal"', kp.status === 200 && Boolean(pb) && pe && pe.championId === 'ezreal');
  check('9. the patch description is preserved on the public page (both Bulwark lines, as Riot wrote them)', pb && JSON.stringify(pb.subsections.flatMap((x) => x.changes.map((c) => c.text))) === JSON.stringify(['Shield: 120 → 140', 'Health: 300 → 350']));
  check('...and the public entry carries no review metadata', pb && !('academyStatus' in pb) && !('academyLink' in pb) && !('sectionKeys' in pb));
  await A.check({ action: 'rescan', patchId: SLUG });
  const r3 = await A.getRev(3);
  const rv = await A.reports({ action: 'review', revision: 3, ops: [{ op: 'setSectionClassification', sectionKey: sk(r3, /^Bulwark/), status: null }] });
  const r3b = await A.getRev(3);
  check('10. reversal on a draft: Bulwark is back to its automatic classification (Unmatched); Ezreal is unaffected', rv.status === 200 && effectiveClassification(r3b.patchNotes.changes.find((c) => c.entity && c.entity.name === 'Bulwark of the Mountain'), r3b.patchNotes).status === 'UNMATCHED' && effectiveClassification(r3b.patchNotes.changes.find((c) => c.entity && c.entity.name === 'Ezreal'), r3b.patchNotes).status === 'IN_ACADEMY');
  check('...its Keep decision is a separate (publication) decision and stays as it was', r3b.patchNotes.changes.filter((c) => c.entity && c.entity.name === 'Bulwark of the Mountain').every((c) => c.review.state === 'kept'));
  check('...and the live public page (revision 2) did not change', JSON.stringify(await A.publicView()) === JSON.stringify(v2));
}

done();
