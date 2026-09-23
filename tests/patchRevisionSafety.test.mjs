// Patch Intelligence -- revision-clobbering bug fix + patch deletion
// regression test. Plain Node ESM against the REAL handlers, no test
// framework. Run directly:
//
//   node tests/patchRevisionSafety.test.mjs
//
// Part 1 reproduces the exact data-loss scenario found during the
// pipeline audit: a patch's FIRST detection attempt fails (ai_error),
// so last-known-slug is never advanced; the admin then uses Retry
// Analysis, which succeeds, and publishes it. A LATER "Check for new
// patch" run (e.g. the next scheduled tick) re-detects that same
// still-latest slug -- before the fix, this called saveNewReport()
// unconditionally and reset the revision pointer to
// {latestRevision:1, publishedRevision:null}, silently discarding the
// published revision. This test proves that no longer happens.
//
// Part 2 covers the new admin-only patch deletion action: removes every
// revision of one patch, requires confirm:true, and never touches any
// OTHER patch's data.

import { onRequestPost as checkPost } from '../functions/api/admin/patch-check.js';
import { onRequestPost as reportsPost } from '../functions/api/admin/patch-reports.js';
import { onRequestGet as publicGet } from '../functions/api/patch-reports.js';
import { createSessionToken } from '../functions/_lib/adminAuth.js';

const store = new Map();
const mockKV = {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v) { store.set(k, String(v)); },
  async delete(k) { store.delete(k); },
};
const env = { COACH_KV: mockKV, ADMIN_SESSION_SECRET: 'test-secret', PATCH_CHECK_SECRET: 'sched-secret', ANTHROPIC_API_KEY: 'dummy', AI_PROVIDER: 'anthropic' };

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS -', label); }
  else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail) : ''); }
}

const adminCookie = `academy_admin_session=${await createSessionToken(env)}`;
function post(body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return new Request('https://x.pages.dev/api/admin/patch-check', { method: 'POST', headers, body: JSON.stringify(body) });
}
function postReports(body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return new Request('https://x.pages.dev/api/admin/patch-reports', { method: 'POST', headers, body: JSON.stringify(body) });
}
function getPublic() {
  return new Request('https://x.pages.dev/api/patch-reports', { method: 'GET' });
}

function REPORT(summary) {
  return { supportMetaAnalysis: summary, championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [], entityVerdicts: [] };
}

function mockFetch({ aiOk, aiInput, slug = 'wild-rift-patch-notes-7-3a' }) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('patch-notes/')) {
      return new Response(`<html><body><a href="/en-us/news/game-updates/${slug}/">Patch 7.3A Notes</a></body></html>`, { status: 200 });
    }
    if (u.includes(slug)) {
      return new Response(`<html><body><h1>Patch 7.3a Notes</h1><p>Leona Q, W, and E all received changes this patch.</p></body></html>`, { status: 200 });
    }
    if (u.includes('api.anthropic.com')) {
      if (!aiOk) return new Response(JSON.stringify({ error: { message: 'server error' } }), { status: 502 });
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_structured_response', input: aiInput }], stop_reason: 'end_turn' }), { status: 200 });
    }
    throw new Error('unexpected fetch: ' + u);
  };
}

// =======================================================================
console.log('\n=== Part 1: revision-clobbering bug fix ===');
store.clear();
{
  // 1. First detection attempt: AI fails -> revision 1, status ai_error,
  //    last-known-slug NOT advanced (existing, already-tested behavior).
  mockFetch({ aiOk: false });
  const r1 = await checkPost({ request: post({ action: 'detect' }, adminCookie), env });
  const d1 = await r1.json();
  check('first attempt: ai_error, revision 1', d1.status === 'ai_error' && d1.report.revision === 1, d1);

  // 2. Admin uses Retry Analysis: succeeds -> revision 2.
  mockFetch({ aiOk: true, aiInput: REPORT('RECOVERED_ANALYSIS') });
  const r2 = await checkPost({ request: post({ action: 'retry-analysis', patchId: d1.report.id }, adminCookie), env });
  const d2 = await r2.json();
  check('retry: succeeds, revision 2', d2.ok === true && d2.revision === 2 && d2.status === 'pending_review', d2);

  // 3. Admin publishes revision 2.
  const r3 = await reportsPost({ request: postReports({ id: d1.report.id, action: 'publish', revision: 2 }, adminCookie), env });
  const d3 = await r3.json();
  check('publish revision 2 succeeds', d3.ok === true, d3);

  // Sanity: public page shows the published content right now.
  const pubBefore = (await (await publicGet({ request: getPublic(), env })).json()).reports;
  check('public page shows the published report before the later re-check', pubBefore.some((r) => r.id === d1.report.id && r.supportMetaAnalysis === 'RECOVERED_ANALYSIS'), pubBefore);

  // 4. THE REPRO: last-known-slug was never advanced by step 1 (it only
  //    advances on a successful NORMAL detection, not a retry) -- so a
  //    LATER "Check for new patch" run (same still-latest slug, e.g. the
  //    next scheduled tick) re-detects the identical slug and re-runs
  //    normal detection for it again.
  mockFetch({ aiOk: true, aiInput: REPORT('SECOND_DETECTION_PASS') });
  const r4 = await checkPost({ request: post({ action: 'detect', trigger: 'scheduled' }, adminCookie), env });
  const d4 = await r4.json();
  check('second detection pass runs (same slug re-detected, since last-known-slug was never advanced)', d4.newPatch === true, d4);
  check('second pass creates revision 3 (upsert), NOT a reset back to revision 1', d4.report.revision === 3, d4.report.revision);

  // 5. THE ASSERTION THAT MATTERS: revision 2 (published, reviewed by a
  //    human) must still exist, and must still be what the public page
  //    shows -- creating revision 3 must NOT have reset the pointer.
  const { onRequestGet: reportsGet } = await import('../functions/api/admin/patch-reports.js');
  const revisionsReq = new Request(`https://x.pages.dev/api/admin/patch-reports?id=${encodeURIComponent(d1.report.id)}&allRevisions=1`, { headers: { Cookie: adminCookie } });
  const revList = await (await reportsGet({ request: revisionsReq, env })).json();
  const rev2 = (revList.revisions || []).find((r) => r.revision === 2);
  check('revision 2 still exists after the second detection pass', Boolean(rev2), revList);
  check('revision 2 content is untouched (still RECOVERED_ANALYSIS)', rev2 && rev2.supportMetaAnalysis === 'RECOVERED_ANALYSIS', rev2);

  const pubAfter = (await (await publicGet({ request: getPublic(), env })).json()).reports;
  const stillPublished = pubAfter.find((r) => r.id === d1.report.id);
  check('THE FIX: public page still shows revision 2 (RECOVERED_ANALYSIS), not wiped to null/revision-1', stillPublished && stillPublished.supportMetaAnalysis === 'RECOVERED_ANALYSIS', stillPublished);
}

// =======================================================================
console.log('\n=== Part 2: admin patch deletion ===');
store.clear();
{
  // Seed TWO separate patches so we can prove deletion never touches
  // the other one.
  mockFetch({ aiOk: true, aiInput: REPORT('PATCH_A_CONTENT'), slug: 'wild-rift-patch-notes-7-3a' });
  const rA = await checkPost({ request: post({ action: 'detect' }, adminCookie), env });
  const dA = await rA.json();
  check('seed patch A created', dA.ok === true, dA);

  mockFetch({ aiOk: true, aiInput: REPORT('PATCH_B_CONTENT'), slug: 'wild-rift-patch-notes-7-4' });
  store.delete('riot-latest-patch-meta'); // force fresh discovery -- otherwise patch A's cached "latest slug" would be reused
  const rB = await checkPost({ request: post({ action: 'detect' }, adminCookie), env });
  const dB = await rB.json();
  check('seed patch B created (different slug)', dB.ok === true && dB.report.id !== dA.report.id, dB);

  // Deletion without confirm:true is rejected.
  const rNoConfirm = await reportsPost({ request: postReports({ id: dA.report.id, action: 'delete' }, adminCookie), env });
  check('delete without confirm:true is rejected (400)', rNoConfirm.status === 400, rNoConfirm.status);

  // Deletion with confirm:true succeeds.
  const rDelete = await reportsPost({ request: postReports({ id: dA.report.id, action: 'delete', confirm: true }, adminCookie), env });
  const dDelete = await rDelete.json();
  check('delete with confirm:true succeeds', dDelete.ok === true && dDelete.revisionsDeleted >= 1, dDelete);

  // Patch A is fully gone.
  const { onRequestGet: reportsGetFn } = await import('../functions/api/admin/patch-reports.js');
  const listRes = (await (await reportsGetFn({ request: new Request('https://x.pages.dev/api/admin/patch-reports', { headers: { Cookie: adminCookie } }), env })).json()).reports;
  check('patch A no longer appears in the admin list', !listRes.some((r) => r.id === dA.report.id), listRes.map((r) => r.id));

  // Patch B is completely untouched.
  check('patch B still appears in the admin list', listRes.some((r) => r.id === dB.report.id), listRes.map((r) => r.id));
  const bStillReq = new Request(`https://x.pages.dev/api/admin/patch-reports?id=${encodeURIComponent(dB.report.id)}`, { headers: { Cookie: adminCookie } });
  const bStill = (await (await reportsGetFn({ request: bStillReq, env })).json()).report;
  check("patch B's own content is untouched", bStill.supportMetaAnalysis === 'PATCH_B_CONTENT', bStill);

  // Deleting an id that doesn't exist (or was already deleted) is a
  // clean 404, not a crash.
  const rDeleteAgain = await reportsPost({ request: postReports({ id: dA.report.id, action: 'delete', confirm: true }, adminCookie), env });
  check('deleting an already-deleted id returns 404', rDeleteAgain.status === 404, rDeleteAgain.status);

  // Unauthenticated delete is rejected same as any other admin action.
  const rNoAuth = await reportsPost({ request: postReports({ id: dB.report.id, action: 'delete', confirm: true }), env });
  check('unauthenticated delete is rejected', rNoAuth.status === 401 || rNoAuth.status === 403, rNoAuth.status);
  const bAfterAuthCheck = (await (await reportsGetFn({ request: bStillReq, env })).json()).report;
  check('patch B unaffected by the rejected unauthenticated attempt', bAfterAuthCheck.supportMetaAnalysis === 'PATCH_B_CONTENT', bAfterAuthCheck);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
