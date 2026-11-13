// Patch Notes -- ROLLBACK COMPATIBILITY of classification decisions with builds that predate them.
//
//   node tests/patchNotesRollbackCompat.test.mjs
//
// main @ 025c15e (and every build before the classification feature) reads a section review entry WITHOUT `state` as HIDDEN.
// Its two readers are pinned below verbatim. Every section entry this build writes for a classification decision (manual Move,
// "Keep automatic", remembered rule) must therefore be read by those readers exactly as this build reads it: visible unless a
// reviewer removed / rejected the section. Real admin handlers against an in-memory fake KV -- no network, no production KV.

import { parsePatchDocument } from '../functions/_lib/patchParser.js';
import { extractPatchNotes } from '../functions/_lib/patchNotesExtract.js';
import { initReview, applyReviewOps, applyClassificationRules, isSectionVisible, reviewSummary, sectionKeyOf } from '../functions/_lib/patchNotesReview.js';
import { effectiveClassification } from '../src/lib/patchNotesClassification.js';
import { CHAMPIONS, isAcademyCovered } from '../src/data/champions.js';
import { ITEMS } from '../src/data/items.js';
import { RUNES } from '../src/data/runes.js';
import { onRequestPost as checkPost } from '../functions/api/admin/patch-check.js';
import { onRequestPost as reportsPost, onRequestGet as reportsGet } from '../functions/api/admin/patch-reports.js';
import { createSessionToken } from '../functions/_lib/adminAuth.js';
import { SOURCE_TEXT_VERSION } from '../functions/_lib/patchText.js';
import * as KVS from '../functions/_lib/kvSafety.js';
import { makeChecker } from './helpers/patchNotesHelpers.mjs';

const { check, done } = makeChecker();
const T = '2026-11-13T00:00:00.000Z';

// ---- main @ 025c15e, functions/_lib/patchNotesReview.js, verbatim ----
//   export function isSectionVisible(dataset, change) { const s = (dataset.sectionReview || {})[sectionKeyOf(change)]; return !s || s.state === SECTION_STATE.VISIBLE; }
//   reviewSummary: sectionsRemoved: Object.values(dataset.sectionReview || {}).filter((s) => s.state !== SECTION_STATE.VISIBLE).length
const legacyVisible = (entry) => !entry || entry.state === 'visible';
const legacySectionsRemoved = (ds) => Object.values(ds.sectionReview || {}).filter((s) => s.state !== 'visible').length;

const PAGE = `# Wild Rift Patch Notes 9.5\n\n## CHAMPION ADJUSTMENTS\n\n### Ezreal\n\n- Base Health: 600 → 620\n\n## ITEM ADJUSTMENTS\n\n### Fimbulwinter\n\n- Shield: 120 → 140\n- Health: 300 → 350\n\n### Mystery Shield\n\n- Shield: 100 → 120\n\n### Ardent Censer\n\n- Attack Speed: 20% → 25%\n\n## GAMEPLAY CHANGES\n\n### Jungle Adjustments\n\n- Gromp Gold: 80 → 90\n`;
const CATALOG = { champion: new Set(CHAMPIONS.map((c) => c.id)), item: new Set(ITEMS.map((i) => i.id)), rune: new Set(RUNES.map((r) => r.id)) };
const build = () => initReview(extractPatchNotes({ units: parsePatchDocument(PAGE, { maxUnitChars: 12000 }).units, championRoster: CHAMPIONS.filter(isAcademyCovered), itemRoster: ITEMS, runeRoster: RUNES, patchVersion: '9.5', sourceUrl: 'https://example.test', extractedAt: T }));
const find = (ds, name) => ds.changes.find((c) => (c.entity ? c.entity.name : c.system.area) === name);
const key = (ds, name) => sectionKeyOf(find(ds, name));
const clone = (x) => JSON.parse(JSON.stringify(x));
/** every section entry that carries a decision, read by main's reader, must agree with this build's reader */
const readersAgree = (ds) => Object.entries(ds.sectionReview).every(([k, e]) => { const c = ds.changes.find((x) => sectionKeyOf(x) === k); return !c || legacyVisible(e) === isSectionVisible(ds, c); });

// ======================================================================================================================
console.log('\n=== Manual decisions (setSectionClassification) carry an explicit state ===');
{
  const ds = build();
  const before = clone(ds.sectionReview);
  applyReviewOps(ds, [{ op: 'setSectionClassification', sectionKey: key(ds, 'Fimbulwinter'), status: 'IN_ACADEMY' }], { now: T, catalog: CATALOG });
  const e = ds.sectionReview[key(ds, 'Fimbulwinter')];
  check('Move to In Academy (Unmatched item): entry stored with state "visible" next to the decision', e.state === 'visible' && e.classification.status === 'IN_ACADEMY' && e.classification.origin === 'manual', e);
  check('...main\'s reader sees the section as visible, and counts nothing as removed', legacyVisible(e) && legacySectionsRemoved(ds) === 0 && reviewSummary(ds).sectionsRemoved === 0);
  applyReviewOps(ds, [{ op: 'setSectionClassification', sectionKey: key(ds, 'Ezreal'), status: 'IN_ACADEMY', academyId: 'ezreal' }, { op: 'setSectionClassification', sectionKey: key(ds, 'Jungle Adjustments'), status: 'IN_ACADEMY', type: 'item' }, { op: 'setSectionClassification', sectionKey: key(ds, 'Mystery Shield'), status: 'AUTO' }], { now: T, catalog: CATALOG });
  check('linked champion, System block moved with a type, and an explicit "AUTO" decision: all carry state "visible"', ['Ezreal', 'Jungle Adjustments', 'Mystery Shield'].every((n) => ds.sectionReview[key(ds, n)].state === 'visible'), ['Ezreal', 'Jungle Adjustments', 'Mystery Shield'].map((n) => ds.sectionReview[key(ds, n)]));
  check('...main\'s reader and this build\'s reader agree on every section', readersAgree(ds));
  check('...no section WITHOUT a decision got an entry (Ardent Censer untouched)', ds.sectionReview[key(ds, 'Ardent Censer')] === undefined);
  check('...changes themselves are untouched: every change still pending (a decision never keeps or publishes)', ds.changes.every((c) => c.review.state === 'pending'));
  applyReviewOps(ds, ['Fimbulwinter', 'Ezreal', 'Jungle Adjustments', 'Mystery Shield'].map((n) => ({ op: 'setSectionClassification', sectionKey: key(ds, n), status: null })), { now: T, catalog: CATALOG });
  check('clearing every decision removes the entries again: sectionReview is exactly what it was before (no `state` stub left behind)', JSON.stringify(ds.sectionReview) === JSON.stringify(before), ds.sectionReview);
  check('...and the automatic result is back (Fimbulwinter UNMATCHED, origin auto)', effectiveClassification(find(ds, 'Fimbulwinter'), ds).status === 'UNMATCHED' && effectiveClassification(find(ds, 'Fimbulwinter'), ds).origin === 'auto');
}

console.log('\n=== A removed / rejected section stays hidden: a decision never re-exposes it ===');
{
  const ds = build();
  const kF = key(ds, 'Fimbulwinter'), kM = key(ds, 'Mystery Shield');
  applyReviewOps(ds, [{ op: 'removeSection', sectionKey: kF }, { op: 'rejectSection', sectionKey: kM }], { now: T });
  applyReviewOps(ds, [{ op: 'setSectionClassification', sectionKey: kF, status: 'IN_ACADEMY' }, { op: 'setSectionClassification', sectionKey: kM, status: 'IN_ACADEMY' }], { now: T, catalog: CATALOG });
  check('classifying a REMOVED section keeps state "removed"; a REJECTED one keeps "rejected"', ds.sectionReview[kF].state === 'removed' && ds.sectionReview[kM].state === 'rejected');
  check('...hidden for main\'s reader AND for this build (both count 2 sections removed)', !legacyVisible(ds.sectionReview[kF]) && !isSectionVisible(ds, find(ds, 'Fimbulwinter')) && legacySectionsRemoved(ds) === 2 && reviewSummary(ds).sectionsRemoved === 2);
  applyReviewOps(ds, [{ op: 'setSectionClassification', sectionKey: kF, status: null }], { now: T, catalog: CATALOG });
  check('clearing the decision keeps the removal (entry remains, state "removed")', ds.sectionReview[kF] && ds.sectionReview[kF].state === 'removed' && !ds.sectionReview[kF].classification);
  const rs = build(); applyReviewOps(rs, [{ op: 'removeSection', sectionKey: key(rs, 'Fimbulwinter') }], { now: T });
  applyClassificationRules(rs, { rules: [{ key: 'item:fimbulwinter', type: 'item', name: 'Fimbulwinter', status: 'IN_ACADEMY' }], available: true, catalog: CATALOG, now: T });
  check('a remembered rule applied to a REMOVED section keeps it removed', rs.sectionReview[key(rs, 'Fimbulwinter')].state === 'removed' && rs.sectionReview[key(rs, 'Fimbulwinter')].classification.origin === 'rule');
}

console.log('\n=== Remembered rules (applyClassificationRules) carry an explicit state; unrelated entries are untouched ===');
{
  const ds = build();
  applyReviewOps(ds, [{ op: 'impactSection', sectionKey: key(ds, 'Ardent Censer'), changeImpact: 'HIGH' }, { op: 'editSectionTitle', sectionKey: key(ds, 'Jungle Adjustments'), displayTitle: 'Jungle' }], { now: T });
  const unrelated = clone({ a: ds.sectionReview[key(ds, 'Ardent Censer')], j: ds.sectionReview[key(ds, 'Jungle Adjustments')] });
  const rules = [{ key: 'item:fimbulwinter', type: 'item', name: 'Fimbulwinter', status: 'IN_ACADEMY' }, { key: 'champion:ezreal', type: 'champion', name: 'Ezreal', status: 'IN_ACADEMY', academyId: 'ezreal' }];
  applyClassificationRules(ds, { rules, available: true, catalog: CATALOG, now: T });
  check('rule-applied entries carry state "visible" (origin rule)', ['Fimbulwinter', 'Ezreal'].every((n) => ds.sectionReview[key(ds, n)].state === 'visible' && ds.sectionReview[key(ds, n)].classification.origin === 'rule'));
  check('...entries without a decision are byte-identical (no state injected into them)', JSON.stringify({ a: ds.sectionReview[key(ds, 'Ardent Censer')], j: ds.sectionReview[key(ds, 'Jungle Adjustments')] }) === JSON.stringify(unrelated));
  check('...main\'s reader and this build\'s reader agree on every section', readersAgree(ds) && legacySectionsRemoved(ds) === 0);
  const once = JSON.stringify(ds);
  applyClassificationRules(ds, { rules, available: true, catalog: CATALOG, now: '2027-01-01T00:00:00.000Z' });
  check('re-applying the same rules is idempotent (dataset unchanged apart from the run\'s checkedAt)', JSON.stringify({ ...ds, classificationRules: null }) === JSON.stringify({ ...JSON.parse(once), classificationRules: null }));
  applyClassificationRules(ds, { rules: [], available: true, catalog: CATALOG, now: T });
  check('forgetting every rule removes the rule entries entirely (no `state` stub left behind)', ds.sectionReview[key(ds, 'Fimbulwinter')] === undefined && ds.sectionReview[key(ds, 'Ezreal')] === undefined);
  // a pre-fix rule entry (no state) is healed the next time the rules are applied
  const old = build();
  old.sectionReview[key(old, 'Fimbulwinter')] = { classification: { status: 'IN_ACADEMY', sourceKey: 'item:fimbulwinter', origin: 'rule', ruleKey: 'item:fimbulwinter', academyId: null, at: T } };
  check('(pre-fix data: a stateless rule entry is HIDDEN for main\'s reader)', !legacyVisible(old.sectionReview[key(old, 'Fimbulwinter')]));
  applyClassificationRules(old, { rules: [rules[0]], available: true, catalog: CATALOG, now: T });
  check('...the next rule application adds the state, keeping the decision\'s original timestamp', old.sectionReview[key(old, 'Fimbulwinter')].state === 'visible' && old.sectionReview[key(old, 'Fimbulwinter')].classification.at === T);
  const unavailable = build(); unavailable.sectionReview[key(unavailable, 'Fimbulwinter')] = clone(old.sectionReview[key(old, 'Fimbulwinter')]); delete unavailable.sectionReview[key(unavailable, 'Fimbulwinter')].state;
  const snapshot = JSON.stringify(unavailable.sectionReview);
  applyClassificationRules(unavailable, { rules: null, available: false, now: T });
  check('rules UNAVAILABLE: nothing is written at all, not even the compatibility state', JSON.stringify(unavailable.sectionReview) === snapshot);
}

console.log('\n=== End to end through the real handlers (fake KV): what is STORED is readable by main ===');
{
  const store = new Map();
  const kv = { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, String(v)); }, async delete(k) { store.delete(k); }, async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true, cursor: null }; } };
  await KVS.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => ({ champions: {}, items: {}, runes: {}, decisionTrees: {}, patch: '9.4', verifiedPatch: '9.4', patchStatus: null }) });
  const seed = async (slug, page) => { await kv.put('riot-latest-patch-meta', JSON.stringify({ slug })); await kv.put(`riot-fallback-full-content:${slug}:${SOURCE_TEXT_VERSION}`, JSON.stringify({ content: page, truncated: false })); };
  const env = { COACH_KV: kv, ADMIN_SESSION_SECRET: 'test-secret' };
  const cookie = `academy_admin_session=${await createSessionToken(env)}`;
  const post = async (h, url, body) => { const res = await h({ request: new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) }), env }); return { status: res.status, body: await res.json() }; };
  const stored = (slug, rev) => JSON.parse(store.get(`patch-intel:report:${slug}:${rev}`)).patchNotes;
  const getRev = async (slug, rev) => (await (await reportsGet({ request: new Request(`https://x/api/admin/patch-reports?id=${slug}&revision=${rev}`, { headers: { Cookie: cookie } }), env })).json()).report;
  await seed('patch-a', PAGE);
  await post(checkPost, 'https://x/api/admin/patch-check', { trigger: 'manual' });
  const a1 = await getRev('patch-a', 1);
  const mv = await post(reportsPost, 'https://x/api/admin/patch-reports', { id: 'patch-a', action: 'review', revision: 1, ops: [{ op: 'setSectionClassification', sectionKey: key(a1.patchNotes, 'Fimbulwinter'), status: 'IN_ACADEMY', remember: true }, { op: 'setSectionClassification', sectionKey: key(a1.patchNotes, 'Mystery Shield'), status: 'IN_ACADEMY' }] });
  const sa = stored('patch-a', 1);
  check('remember (Fimbulwinter) + Move (Mystery Shield) through the admin API: both STORED entries carry state "visible"', mv.status === 200 && sa.sectionReview[key(sa, 'Fimbulwinter')].state === 'visible' && sa.sectionReview[key(sa, 'Mystery Shield')].state === 'visible', mv.body);
  check('...main\'s reader on the stored revision: both visible, nothing removed', readersAgree(sa) && legacySectionsRemoved(sa) === 0);
  await seed('patch-b', PAGE.replace('9.5', '9.6').replace('120 → 140', '140 → 150'));
  const det = await post(checkPost, 'https://x/api/admin/patch-check', { trigger: 'manual' });
  const sb = stored('patch-b', 1);
  check('the NEXT patch picks the rule up at detection: STORED rule entry carries state "visible"', det.body.newPatch === true && sb.sectionReview[key(sb, 'Fimbulwinter')].classification.origin === 'rule' && sb.sectionReview[key(sb, 'Fimbulwinter')].state === 'visible');
  check('...main\'s reader on the stored new-patch revision agrees with this build', readersAgree(sb) && legacySectionsRemoved(sb) === 0);
  check('...the rule-classified changes are still pending (nothing published by the rule)', sb.changes.filter((c) => c.entity && c.entity.name === 'Fimbulwinter').every((c) => c.review.state === 'pending'));
}

done();
