// Patch Notes -- revision safety: re-detection never clobbers a published revision, the restore/publish approval gate,
// patch deletion, and (most importantly) that VIEWING a revision -- current, historical, legacy AI-era, or empty --
// is strictly read-only. Plain Node ESM against the REAL handlers, no framework. Run directly:
//
//   node tests/patchRevisionAdminSafety.test.mjs
//
// This replaces the retired patchRevisionSafety.test.mjs (whose scenarios were written around the removed AI pipeline:
// ai_error first attempts, AI-mocked retries). Its still-valid coverage is ported here against the deterministic
// pipeline:
//   Part 1  re-detecting a still-latest slug creates the NEXT revision and never resets the pointer; the public page
//           keeps showing the published revision                                 (was: revision-clobbering fix)
//   Part 2  restore / publish gate: only approved|published|archived|unpublished revisions can go public; a rejected or
//           pending one is refused with 409 and NOTHING is written; restoring an older revision archives the current one
//   Part 3  patch deletion: confirm:true required, 404 when already gone, 401 unauthenticated, other patches and
//           coach-overrides untouched                                           (was: Part 2 deletion)
// and new for the revisions-is-not-defined regression (the Admin crashed when opening any patch card):
//   Part 4  opening/loading revisions = GET only: ZERO KV writes/deletes, ZERO outbound fetch (so no AI), for the current
//           revision, a pure-legacy "7.3a" (pre-revision unversioned key, AI-era shape), multi-revision historical
//           patches (ai_error / published / pending), a deterministic report with review state, an unknown id/revision
//           and a completely empty store. Stored bytes are identical before and after.
//   Part 5  static guards: nothing the revision-view endpoints import can reach AI/provider code or any retired module,
//           and no source file imports a retired module.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestGet as adminGet, onRequestPost as reportsPost } from '../functions/api/admin/patch-reports.js';
import { onRequestPost as checkPost } from '../functions/api/admin/patch-check.js';
import { onRequestGet as publicGet } from '../functions/api/patch-reports.js';
import { createSessionToken } from '../functions/_lib/adminAuth.js';
import { SOURCE_TEXT_VERSION } from '../functions/_lib/patchText.js';
import { makeChecker } from './helpers/patchNotesHelpers.mjs';

const { check, done } = makeChecker();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- harness ---------------------------------------------------------------------------------------------------------
/** Mock KV that COUNTS every mutation. Seeding bypasses the counters on purpose (kv.store.set) so a test can plant
 *  "historical" data without going through any app write path, then reset the counters and prove a read leaves it alone. */
function makeMockKV() {
  const store = new Map();
  const kv = {
    store, writes: 0, deletes: 0, lists: 0,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async put(k, v) { kv.writes++; store.set(k, String(v)); },
    async delete(k) { kv.deletes++; store.delete(k); },
    async list({ prefix = '' } = {}) { kv.lists++; return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: null }; },
    resetCounters() { kv.writes = 0; kv.deletes = 0; kv.lists = 0; },
    snapshot() { return JSON.stringify([...store.entries()].sort(([a], [b]) => (a < b ? -1 : 1))); },
  };
  return kv;
}

// Any outbound request (an AI provider, Riot, anything) is recorded AND refused. AI keys are present in env on purpose:
// if any code path were able to call an AI provider it would try to, and show up here.
const fetchCalls = [];
globalThis.fetch = async (url) => { fetchCalls.push(String(url)); throw new Error('unexpected outbound fetch in a no-network test: ' + url); };

async function adminEnv(kv) {
  const env = { COACH_KV: kv, ADMIN_SESSION_SECRET: 'test-secret', ANTHROPIC_API_KEY: 'would-be-used-if-AI-ran', AI_PROVIDER: 'anthropic' };
  return { env, cookie: `academy_admin_session=${await createSessionToken(env)}` };
}
const post = (url, body, cookie) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie || '' }, body: JSON.stringify(body) });
const adminUrl = (qs = '') => `https://x.pages.dev/api/admin/patch-reports${qs}`;
const getAdmin = async (env, cookie, qs = '') => { const res = await adminGet({ request: new Request(adminUrl(qs), { headers: { Cookie: cookie || '' } }), env }); return { status: res.status, body: await res.json() }; };
const getPublic = async (env) => (await (await publicGet({ request: new Request('https://x.pages.dev/api/patch-reports'), env })).json()).reports;
const act = async (env, cookie, body) => { const res = await reportsPost({ request: post(adminUrl(), body, cookie), env }); return { status: res.status, body: await res.json() }; };
const detect = async (env, cookie, body = { trigger: 'manual' }) => (await checkPost({ request: post('https://x.pages.dev/api/admin/patch-check', body, cookie), env })).json();

/** Seeds the exact cache entries riotFallback.js reads BEFORE any network attempt (same approach as patchCheckDeterministic). */
function seedRiotCache(kv, slug, text) {
  kv.store.set('riot-latest-patch-meta', JSON.stringify({ slug }));
  kv.store.set(`riot-fallback-full-content:${slug}:${SOURCE_TEXT_VERSION}`, JSON.stringify({ content: text, truncated: false }));
}
const TEXT = (leonaDamage = '70/110/150/190') => `### Leona\nQ - Shield of Daybreak\nDamage: 60/100/140/180 -> ${leonaDamage}\n\n### Edge of Night\nArmor Penetration increased from 10% to 15%.\n\n### Dragon System\nElder Dragon buffs now last 30% longer.`;
const COACH_OVERRIDES_KEY = 'coach-overrides';

// =======================================================================================================================
console.log('\n=== Part 1: re-detecting a still-latest slug creates the next revision; the published revision is never clobbered ===');
{
  const kv = makeMockKV();
  const { env, cookie } = await adminEnv(kv);
  const slug = 'wild-rift-patch-notes-7-5';
  seedRiotCache(kv, slug, TEXT());

  const d1 = await detect(env, cookie);
  check('first detection: deterministic report, revision 1, pending_review, no AI fields', d1.ok === true && d1.report.revision === 1 && d1.report.status === 'pending_review' && d1.report.aiProvider === null && d1.report.aiModel === null && Boolean(d1.report.patchNotes), d1);
  check('approve + publish revision 1', (await act(env, cookie, { id: slug, action: 'approve' })).body.ok === true && (await act(env, cookie, { id: slug, action: 'publish', alsoMarkVerified: false })).body.ok === true);

  const pubBefore = (await getPublic(env)).find((r) => r.id === slug);
  check('public page shows revision 1 right now', pubBefore && pubBefore.revision === 1 && pubBefore.championChanges.some((c) => c.championId === 'leona'), pubBefore);
  const rev1Before = kv.store.get(`patch-intel:report:${slug}:1`);

  // The scenario of the original bug: last-known-slug never advanced, so a later scheduled run re-detects the same slug.
  kv.store.set('patch-intel:last-known-slug', 'an-older-patch-slug');
  seedRiotCache(kv, slug, TEXT('75/115/155/195'));
  const d2 = await detect(env, cookie, { trigger: 'scheduled' });
  check('re-detection creates revision 2 (upsert), NOT a reset back to revision 1', d2.ok === true && d2.newPatch === true && d2.report.revision === 2, d2.report && d2.report.revision);

  const list = (await getAdmin(env, cookie, `?id=${slug}&allRevisions=1`)).body.revisions;
  check('both revisions are listed, oldest first', list.length === 2 && list[0].revision === 1 && list[1].revision === 2, list.map((r) => [r.revision, r.status]));
  check('revision 1 is byte-for-byte untouched and still published', kv.store.get(`patch-intel:report:${slug}:1`) === rev1Before && list[0].status === 'published', list[0].status);
  check('revision 2 starts pending_review (never auto-published)', list[1].status === 'pending_review', list[1].status);
  const pubAfter = (await getPublic(env)).find((r) => r.id === slug);
  check('THE ASSERTION THAT MATTERS: the public page still shows revision 1 (not wiped, not switched to the pending revision 2)', pubAfter && pubAfter.revision === 1 && JSON.stringify(pubAfter.championChanges).includes('60/100/140/180') && !JSON.stringify(pubAfter).includes('75/115/155/195'), pubAfter && pubAfter.revision);
  check('the admin summary reports latest=2 / published=1', (await getAdmin(env, cookie)).body.reports.some((r) => r.id === slug && r.latestRevision === 2 && r.publishedRevision === 1));
  check('no outbound request happened anywhere in Part 1 (no AI, no network)', fetchCalls.length === 0, fetchCalls);
}

// =======================================================================================================================
console.log('\n=== Part 2: restore / publish approval gate (enforced server-side) ===');
{
  const kv = makeMockKV();
  const { env, cookie } = await adminEnv(kv);
  const slug = 'wild-rift-patch-notes-7-6';
  seedRiotCache(kv, slug, TEXT());
  await detect(env, cookie);
  await act(env, cookie, { id: slug, action: 'approve' });
  await act(env, cookie, { id: slug, action: 'publish', alsoMarkVerified: false });
  kv.store.set('patch-intel:last-known-slug', 'an-older-patch-slug');
  seedRiotCache(kv, slug, TEXT('75/115/155/195'));
  const d2 = await detect(env, cookie, { trigger: 'scheduled' });
  check('setup: revision 2 exists and is pending_review', d2.report.revision === 2 && d2.report.status === 'pending_review');
  const overridesBefore = kv.store.get(COACH_OVERRIDES_KEY) ?? null;

  // pending_review cannot be published OR restored -- and the refusal writes nothing.
  kv.resetCounters(); const snap = kv.snapshot();
  const refusedPending = await act(env, cookie, { id: slug, action: 'restore', revision: 2, alsoMarkVerified: false });
  check('restoring a pending_review revision is refused with 409 APPROVAL_REQUIRED', refusedPending.status === 409 && refusedPending.body.code === 'APPROVAL_REQUIRED' && refusedPending.body.published === false, refusedPending);
  check('the refusal wrote nothing (0 puts, 0 deletes, identical store)', kv.writes === 0 && kv.deletes === 0 && kv.snapshot() === snap, { writes: kv.writes, deletes: kv.deletes });
  check('and the public page is unchanged (still revision 1)', (await getPublic(env)).find((r) => r.id === slug).revision === 1);

  // a rejected revision cannot be restored either
  await act(env, cookie, { id: slug, action: 'reject', revision: 2 });
  kv.resetCounters(); const snapRejected = kv.snapshot();
  const refusedRejected = await act(env, cookie, { id: slug, action: 'publish', revision: 2, alsoMarkVerified: false });
  check('a rejected revision cannot be published/restored (409), nothing written', refusedRejected.status === 409 && refusedRejected.body.code === 'APPROVAL_REQUIRED' && kv.writes === 0 && kv.snapshot() === snapRejected, refusedRejected);

  // approve revision 2 and publish it: revision 1 is archived (kept), revision 2 goes public
  await act(env, cookie, { id: slug, action: 'approve', revision: 2 });
  const pub2 = await act(env, cookie, { id: slug, action: 'publish', revision: 2, alsoMarkVerified: false });
  const revs = (await getAdmin(env, cookie, `?id=${slug}&allRevisions=1`)).body.revisions;
  check('publishing approved revision 2 works; revision 1 is archived, not deleted', pub2.body.ok === true && revs[0].status === 'archived' && revs[1].status === 'published', revs.map((r) => r.status));
  check('public page now shows revision 2', (await getPublic(env)).find((r) => r.id === slug).revision === 2);

  // restore the OLDER (archived) revision 1 -- allowed, and both bodies stay intact
  const rev1Body = JSON.stringify((await getAdmin(env, cookie, `?id=${slug}&revision=1`)).body.report.patchNotes);
  const restored = await act(env, cookie, { id: slug, action: 'restore', revision: 1, alsoMarkVerified: false });
  const revs2 = (await getAdmin(env, cookie, `?id=${slug}&allRevisions=1`)).body.revisions;
  check('restoring archived revision 1 succeeds; revision 2 becomes archived', restored.body.ok === true && revs2[0].status === 'published' && revs2[1].status === 'archived', revs2.map((r) => r.status));
  check('public page is back on revision 1', (await getPublic(env)).find((r) => r.id === slug).revision === 1);
  check('the restored revision\'s review dataset is untouched by the restore', JSON.stringify(revs2[0].patchNotes) === rev1Body);
  check('restore/publish with alsoMarkVerified:false never touched coach-overrides', (kv.store.get(COACH_OVERRIDES_KEY) ?? null) === overridesBefore);
  check('restore of a revision that does not exist is a clean 404 (nothing written)', await (async () => { kv.resetCounters(); const r = await act(env, cookie, { id: slug, action: 'restore', revision: 99, alsoMarkVerified: false }); return r.status === 404 && kv.writes === 0 && kv.deletes === 0; })());
  // unpublish (ported from the retired patchIntelReanalyze test): reversible, never destructive
  const publishedBody = JSON.stringify((await getAdmin(env, cookie, `?id=${slug}&revision=1`)).body.report.patchNotes);
  const unpub = await act(env, cookie, { id: slug, action: 'unpublish' });
  check('unpublish removes the patch from the public page entirely', unpub.body.ok === true && !(await getPublic(env)).some((r) => r.id === slug));
  const revs3 = (await getAdmin(env, cookie, `?id=${slug}&allRevisions=1`)).body.revisions;
  check('the unpublished revision is kept (status "unpublished"), not destroyed', revs3[0].status === 'unpublished' && JSON.stringify(revs3[0].patchNotes) === publishedBody, revs3.map((r) => r.status));
  const reRestored = await act(env, cookie, { id: slug, action: 'restore', revision: 1, alsoMarkVerified: false });
  check('an unpublished revision can be restored later with its content intact', reRestored.body.ok === true && (await getPublic(env)).find((r) => r.id === slug).revision === 1);
  check('no outbound request happened anywhere in Part 2', fetchCalls.length === 0, fetchCalls);
}

// =======================================================================================================================
console.log('\n=== Part 3: admin patch deletion (ported) ===');
{
  const kv = makeMockKV();
  const { env, cookie } = await adminEnv(kv);
  kv.store.set(COACH_OVERRIDES_KEY, JSON.stringify({ revision: 1, champions: { leona: { tier: 'S' } }, items: {}, runes: {}, decisionTrees: {}, patch: '7.2' }));
  const coachBefore = kv.store.get(COACH_OVERRIDES_KEY);
  const slugA = 'wild-rift-patch-notes-7-3a', slugB = 'wild-rift-patch-notes-7-4';
  seedRiotCache(kv, slugA, TEXT());
  const dA = await detect(env, cookie);
  seedRiotCache(kv, slugB, TEXT('80/120/160/200'));
  const dB = await detect(env, cookie);
  check('setup: patch A and patch B exist as separate patches', dA.ok === true && dB.ok === true && dA.report.id === slugA && dB.report.id === slugB, [dA.report && dA.report.id, dB.report && dB.report.id]);
  const bBefore = kv.store.get(`patch-intel:report:${slugB}:1`);

  kv.resetCounters(); const snap = kv.snapshot();
  const noConfirm = await act(env, cookie, { id: slugA, action: 'delete' });
  check('delete without confirm:true is rejected (400) and writes/deletes nothing', noConfirm.status === 400 && kv.writes === 0 && kv.deletes === 0 && kv.snapshot() === snap, noConfirm);
  const noAuth = await reportsPost({ request: post(adminUrl(), { id: slugB, action: 'delete', confirm: true }), env });
  check('unauthenticated delete is rejected (401) and writes/deletes nothing', noAuth.status === 401 && kv.writes === 0 && kv.deletes === 0 && kv.snapshot() === snap, noAuth.status);

  const del = await act(env, cookie, { id: slugA, action: 'delete', confirm: true });
  check('delete with confirm:true succeeds', del.body.ok === true && del.body.revisionsDeleted >= 1, del.body);
  const adminList = (await getAdmin(env, cookie)).body.reports;
  check('patch A is gone from the admin list; patch B remains', !adminList.some((r) => r.id === slugA) && adminList.some((r) => r.id === slugB), adminList.map((r) => r.id));
  check("patch B's stored revision is byte-for-byte untouched", kv.store.get(`patch-intel:report:${slugB}:1`) === bBefore);
  check('coach-overrides (Academy master data) is byte-for-byte untouched by a patch deletion', kv.store.get(COACH_OVERRIDES_KEY) === coachBefore);
  check('deleting an already-deleted id is a clean 404', (await act(env, cookie, { id: slugA, action: 'delete', confirm: true })).status === 404);
}

// =======================================================================================================================
console.log('\n=== Part 4: opening / loading revisions is READ-ONLY (zero KV writes, zero outbound fetch, no AI) ===');
{
  const kv = makeMockKV();
  const { env, cookie } = await adminEnv(kv);

  // (a) one REAL deterministic report with real human review state, created through the real handlers
  const detSlug = 'wild-rift-patch-notes-7-5';
  seedRiotCache(kv, detSlug, TEXT());
  const det = await detect(env, cookie);
  const leonaChange = det.report.patchNotes.changes.find((c) => c.entity && c.entity.id === 'leona');
  const reviewed = await act(env, cookie, { id: detSlug, action: 'review', revision: 1, ops: [{ op: 'edit', changeId: leonaChange.changeId, displayText: 'Leona Q damage up at every rank.', reviewerNote: 'checked vs Riot' }] });
  check('setup: a deterministic revision exists with a saved human review edit', reviewed.status === 200 && reviewed.body.ok === true, reviewed.body);

  // (b) HISTORICAL data planted straight into KV (bypassing every app write path), in the shapes the retired AI-era pipeline stored
  const aiEra = (id, patch, status, extra = {}) => ({
    id, patch, previousPatch: '7.2', status, generatedAt: '2026-08-20T09:00:00.000Z', sourceUrl: `https://wildrift.leagueoflegends.com/en-us/news/game-updates/wild-rift-patch-notes-${id}/`, sourceAvailable: true,
    aiProvider: 'anthropic', aiModel: 'claude-sonnet-4', supportMetaAnalysis: `AI-era analysis for ${patch}`,
    championChanges: [{ championId: 'leona', championName: 'Leona', whatChanged: 'Q damage up', previousValue: '60', newValue: '70', type: 'Buff', supportImpact: 'x', impactSeverity: 'High', confidence: 'High' }],
    itemChanges: [{ itemId: 'ardent-censer', itemName: 'Ardent Censer', whatChanged: 'Price down', type: 'Buff', championsAffected: ['Soraka'], impactSeverity: 'Low' }],
    runeChanges: [], systemChanges: [{ area: 'Objectives', whatChanged: 'Dragon timer', impactSeverity: 'Medium' }],
    recommendedTierChanges: [{ entityType: 'champion', entityName: 'Leona', from: 'A', to: 'S', confidence: 'High' }],
    analysisCoverage: { batches: { total: 2, failed: 0, notStarted: 0 } }, adminNotes: 'private note', reviewedBy: null, ...extra,
  });
  // 7.3a: PURE LEGACY -- unversioned key, no revisions pointer at all, old index entry without latestRevision/publishedRevision
  kv.store.set('patch-intel:report:7-3a', JSON.stringify(aiEra('7-3a', '7.3a', 'published')));
  // 7.2d: older multi-revision history on the revision scheme: rev1 ai_error, rev2 published (AI-era), rev3 partial_failure
  kv.store.set('patch-intel:report:7-2d:1', JSON.stringify({ ...aiEra('7-2d', '7.2d', 'ai_error', { revision: 1, championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [], adminNotes: 'provider timeout' }) }));
  kv.store.set('patch-intel:report:7-2d:2', JSON.stringify(aiEra('7-2d', '7.2d', 'published', { revision: 2 })));
  kv.store.set('patch-intel:report:7-2d:3', JSON.stringify(aiEra('7-2d', '7.2d', 'partial_failure', { revision: 3 })));
  kv.store.set('patch-intel:revisions:7-2d', JSON.stringify({ latestRevision: 3, publishedRevision: 2 }));
  // 7.1: an old report with NO changes at all (the "empty report" case)
  kv.store.set('patch-intel:report:7-1', JSON.stringify(aiEra('7-1', '7.1', 'pending_review', { championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [], supportMetaAnalysis: '' })));
  const index = JSON.parse(kv.store.get('patch-intel:reports'));
  kv.store.set('patch-intel:reports', JSON.stringify([
    ...index,
    { id: '7-3a', patch: '7.3a', previousPatch: '7.2', generatedAt: '2026-08-20T09:00:00.000Z', status: 'published' }, // OLD index entry shape
    { id: '7-2d', patch: '7.2d', previousPatch: '7.2', generatedAt: '2026-08-19T09:00:00.000Z', status: 'partial_failure', latestRevision: 3, publishedRevision: 2 },
    { id: '7-1', patch: '7.1', previousPatch: '7.0', generatedAt: '2026-08-01T09:00:00.000Z', status: 'pending_review' },
  ]));

  // ---- snapshot, then do every kind of "open / select / load" the Admin UI and public page can do ----
  const before = kv.snapshot();
  kv.resetCounters(); const fetchesBefore = fetchCalls.length;

  const list = await getAdmin(env, cookie);
  check('admin list loads every patch incl. pure-legacy 7.3a (pointer fields normalized at READ time)', list.status === 200 && ['7-3a', '7-2d', '7-1', detSlug].every((id) => list.body.reports.some((r) => r.id === id)), list.body.reports.map((r) => r.id));
  const row73a = list.body.reports.find((r) => r.id === '7-3a');
  check('legacy 7.3a is presented as latest=1 / published=1 without rewriting the stored index', row73a.latestRevision === 1 && row73a.publishedRevision === 1, row73a);

  const cur = await getAdmin(env, cookie, `?id=${detSlug}`);
  check('CURRENT revision (deterministic) opens with its review dataset', cur.status === 200 && cur.body.report.revision === 1 && Array.isArray(cur.body.report.patchNotes.changes), cur.body.report && cur.body.report.revision);
  const leonaNow = cur.body.report.patchNotes.changes.find((c) => c.changeId === leonaChange.changeId);
  check('existing review state is intact after opening it (edit + reviewer note)', leonaNow.review.state === 'edited' && leonaNow.review.displayText === 'Leona Q damage up at every rank.' && leonaNow.review.reviewerNote === 'checked vs Riot', leonaNow.review);

  const legacy = await getAdmin(env, cookie, '?id=7-3a');
  check('HISTORICAL 7.3a (pure legacy, unversioned key) opens as revision 1 with its AI-era body', legacy.status === 200 && legacy.body.report.patch === '7.3a' && legacy.body.report.status === 'published' && legacy.body.report.championChanges.length === 1 && !legacy.body.report.patchNotes, legacy.body);
  const legacyRev1 = await getAdmin(env, cookie, '?id=7-3a&revision=1');
  check('7.3a ?revision=1 resolves through the legacy fallback', legacyRev1.status === 200 && legacyRev1.body.report.patch === '7.3a');
  const legacyHist = await getAdmin(env, cookie, '?id=7-3a&allRevisions=1');
  check('7.3a revision history lists exactly its one implicit revision', legacyHist.body.revisions.length === 1 && legacyHist.body.revisions[0].patch === '7.3a', legacyHist.body);

  const hist = await getAdmin(env, cookie, '?id=7-2d&allRevisions=1');
  check('OLDER multi-revision history lists revisions 1..3 oldest first with their original statuses', hist.body.revisions.map((r) => `${r.revision}:${r.status}`).join() === '1:ai_error,2:published,3:partial_failure', hist.body.revisions.map((r) => `${r.revision}:${r.status}`));
  for (const n of [1, 2, 3]) {
    const r = await getAdmin(env, cookie, `?id=7-2d&revision=${n}`);
    check(`older revision ${n} opens individually (${r.body.report && r.body.report.status})`, r.status === 200 && r.body.report.revision === n);
  }
  const latest72d = await getAdmin(env, cookie, '?id=7-2d');
  check('no ?revision opens the LATEST revision (3, partial_failure) -- not the published one', latest72d.body.report.revision === 3 && latest72d.body.report.status === 'partial_failure');
  const emptyReport = await getAdmin(env, cookie, '?id=7-1');
  check('an old report with no changes at all opens fine (empty arrays, not undefined)', emptyReport.status === 200 && ['championChanges', 'itemChanges', 'runeChanges', 'systemChanges', 'recommendedTierChanges'].every((k) => Array.isArray(emptyReport.body.report[k]) && emptyReport.body.report[k].length === 0));
  check('an unknown id is a clean 404 (no throw, no write)', (await getAdmin(env, cookie, '?id=does-not-exist')).status === 404);
  check('an unknown revision is a clean 404', (await getAdmin(env, cookie, '?id=7-2d&revision=99')).status === 404);
  check('an unknown id has an EMPTY revision list ({revisions: []}) -- the empty/no-revision state', JSON.stringify((await getAdmin(env, cookie, '?id=does-not-exist&allRevisions=1')).body) === '{"revisions":[]}');
  check('an unauthenticated viewer is refused (401) without touching KV', (await getAdmin(env, '', `?id=${detSlug}`)).status === 401);

  const pub = await getPublic(env);
  check('public list: published legacy 7.3a and published older 7.2d (revision 2) are served; pending / ai_error ones are NOT', pub.some((r) => r.id === '7-3a') && pub.find((r) => r.id === '7-2d').revision === 2 && !pub.some((r) => r.id === '7-1') && !pub.some((r) => r.id === detSlug), pub.map((r) => [r.id, r.revision]));
  check('public view never leaks admin-only fields', pub.every((r) => !('adminNotes' in r) && !('reviewedBy' in r) && !('patchNotes' in r)));

  check('ZERO KV writes while opening/selecting every current, historical, legacy, empty and unknown revision', kv.writes === 0, kv.writes);
  check('ZERO KV deletes', kv.deletes === 0, kv.deletes);
  check('stored bytes are IDENTICAL before and after (nothing migrated, rewritten, restored, published or reviewed)', kv.snapshot() === before);
  check('ZERO outbound fetches while viewing -> no AI provider and no network was touched', fetchCalls.length === fetchesBefore, fetchCalls.slice(fetchesBefore));
  check('the legacy unversioned key for 7.3a is still the only copy (no versioned key was created, no pointer was added)', kv.store.has('patch-intel:report:7-3a') && !kv.store.has('patch-intel:report:7-3a:1') && !kv.store.has('patch-intel:revisions:7-3a'));

  // the completely empty store
  const empty = makeMockKV(); const e = await adminEnv(empty);
  const emptyList = await getAdmin(e.env, e.cookie);
  check('EMPTY store: admin list is [] (the no-reports state), not an error', emptyList.status === 200 && JSON.stringify(emptyList.body) === '{"reports":[]}', emptyList.body);
  check('EMPTY store: public list is []', (await getPublic(e.env)).length === 0);
  check('EMPTY store: viewing wrote nothing', empty.writes === 0 && empty.deletes === 0 && empty.store.size === 0);
}

// =======================================================================================================================
console.log('\n=== Part 5: static guards -- no AI/provider/retired code reachable from revision viewing; no imports of retired modules ===');
{
  const RETIRED = ['patchAnalysis', 'patchAggregate', 'patchPlanner', 'patchDeterministicReport', 'PatchIntelligencePage'];
  const AI = /(^|\/)(aiProvider|providers\/[^/]+)\.js$/;
  const importRe = /(?:import\s+(?:[^'"]*?\sfrom\s+)?|export\s+[^'"]*?\sfrom\s+|import\s*\(\s*)['"]([^'"]+)['"]/g;
  const resolveImport = (from, spec) => { if (!spec.startsWith('.')) return null; const base = path.resolve(path.dirname(from), spec); return [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`].find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || null; };
  const depsOf = (f) => { const src = fs.readFileSync(f, 'utf8'); const out = []; let m; importRe.lastIndex = 0; while ((m = importRe.exec(src))) { out.push({ spec: m[1], file: resolveImport(f, m[1]) }); } return out; };
  const reach = (entry) => { const seen = new Set(); const stack = [path.join(ROOT, entry)]; while (stack.length) { const f = stack.pop(); if (seen.has(f)) continue; seen.add(f); for (const d of depsOf(f)) if (d.file) stack.push(d.file); } return [...seen].map((f) => path.relative(ROOT, f).replace(/\\/g, '/')); };

  for (const entry of ['functions/api/admin/patch-reports.js', 'functions/api/patch-reports.js', 'functions/_lib/patchReportsStore.js', 'functions/api/admin/patch-check.js']) {
    const files = reach(entry);
    const bad = files.filter((f) => AI.test(f) || RETIRED.some((r) => f.includes(r)));
    check(`${entry}: nothing it imports (transitively, ${files.length} files) is an AI provider or a retired module`, bad.length === 0, bad);
  }

  const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', 'dist', '.git', '.wrangler', 'raw-images', 'public'].includes(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(js|jsx|mjs)$/.test(p)) out.push(p); } return out; };
  const offenders = [];
  for (const f of walk(ROOT)) for (const d of depsOf(f)) if (RETIRED.some((r) => d.spec.includes(r))) offenders.push(`${path.relative(ROOT, f)} -> ${d.spec}`);
  check('no source/test file imports (static or dynamic) a retired module', offenders.length === 0, offenders);
  const stillOnDisk = ['functions/_lib/patchAnalysis.js', 'functions/_lib/patchAggregate.js', 'functions/_lib/patchPlanner.js', 'functions/_lib/patchDeterministicReport.js', 'src/pages/PatchIntelligencePage.jsx'].filter((f) => fs.existsSync(path.join(ROOT, f)));
  check('the retired modules/pages are gone from disk', stillOnDisk.length === 0, stillOnDisk);
}

done();
