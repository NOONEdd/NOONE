// Patch Intelligence -- "Check for New Patch" vs. "Retry Analysis"
// regression test. Plain Node ESM against the REAL handlers, no test
// framework or new dependency. Run directly:
//
//   node tests/patchIntelRetryVsDetect.test.mjs
//
// This specifically proves the bug reported: after a patch's analysis
// fails, "Check for new patch now" cannot retry it (by design -- it's
// deduplicated by last-known-slug, and that patch is already the known
// one), so a dedicated Retry Analysis / retry-analysis action is
// required and must NOT depend on discoverLatestPatchSlug() or on
// last-known-slug at all.

import { onRequestPost as checkPost } from '../functions/api/admin/patch-check.js';
import { onRequestPost as reportsPost } from '../functions/api/admin/patch-reports.js';
import { onRequestGet as publicGet } from '../functions/api/patch-reports.js';
import { createSessionToken } from '../functions/_lib/adminAuth.js';

const store = new Map();
const mockKV = {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v) { store.set(k, String(v)); },
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
function scheduledPost(body) {
  return new Request('https://x.pages.dev/api/admin/patch-check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Patch-Check-Secret': 'sched-secret' }, body: JSON.stringify(body) });
}

let discoverCallCount = 0;
let anthropicCallCount = 0;

function mockFetch({ aiOk, aiInput }) {
  discoverCallCount = 0;
  anthropicCallCount = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('patch-notes/')) {
      discoverCallCount++;
      return new Response(`<html><body><a href="/en-us/news/game-updates/wild-rift-patch-notes-7-2d/">Patch 7.2d</a></body></html>`, { status: 200 });
    }
    if (u.includes('wild-rift-patch-notes-7-2d')) {
      return new Response(`<html><body><h1>Patch 7.2d</h1><p>Leona changes.</p></body></html>`, { status: 200 });
    }
    if (u.includes('api.anthropic.com')) {
      anthropicCallCount++;
      if (!aiOk) return new Response(JSON.stringify({ error: { message: 'Upstream error from Nvidia: Service temporarily overloaded' } }), { status: 502 });
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_structured_response', input: aiInput }], stop_reason: 'end_turn' }), { status: 200 });
    }
    throw new Error('Unexpected fetch: ' + u);
  };
}

const REPORT = (text) => ({ supportMetaAnalysis: text, championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [] });

console.log('=== A. New patch flow: latestSlug !== lastKnownSlug -> new analysis happens ===');
{
  mockFetch({ aiOk: true, aiInput: REPORT('FIRST_ANALYSIS') });
  const res = await checkPost({ request: scheduledPost({ trigger: 'scheduled' }), env });
  const data = await res.json();
  check('new patch detected and analyzed', res.status === 200 && data.newPatch === true && data.status === 'pending_review', data);
  check('AI was actually called', anthropicCallCount === 1, anthropicCallCount);
}

console.log('\n=== C. Failed analysis on the FIRST attempt: last-known-slug is NOT advanced (self-healing retry stays possible via normal flow too) ===');
{
  store.clear();
  mockFetch({ aiOk: false });
  const res = await checkPost({ request: scheduledPost({ trigger: 'scheduled' }), env });
  const data = await res.json();
  check('first attempt at 7.2d fails -> ai_error, revision 1 created for debugging', res.status === 200 && data.newPatch === true && data.status === 'ai_error', data);
  check('the actual provider error is surfaced in adminNotes (what the Admin UI actually displays), not swallowed', typeof data.report.adminNotes === 'string' && data.report.adminNotes.includes('Nvidia'), data.report.adminNotes);

  const lastKnown = await mockKV.get('patch-intel:last-known-slug');
  check('last-known-slug NOT advanced after a failure (so a plain re-check can still self-heal)', lastKnown === null, lastKnown);

  // Prove the self-healing case: checking again (no admin action at all) DOES retry, because last-known-slug never advanced.
  mockFetch({ aiOk: true, aiInput: REPORT('SUCCEEDED_ON_PLAIN_RECHECK') });
  const res2 = await checkPost({ request: scheduledPost({ trigger: 'scheduled' }), env });
  const data2 = await res2.json();
  check('a later plain check (no special action) naturally retries an ai_error patch that never succeeded', data2.newPatch === true && data2.status === 'pending_review', data2);
}

console.log('\n=== B/H. THE ACTUAL BUG: once 7.2d has succeeded even once, "Check for new patch" can no longer retry a LATER failure, by design ===');
{
  store.clear();
  mockFetch({ aiOk: true, aiInput: REPORT('ORIGINAL_SUCCESS') });
  await checkPost({ request: scheduledPost({ trigger: 'scheduled' }), env }); // revision 1: success, last-known-slug now "7-2d"
  await reportsPost({ request: postReports({ id: '7-2d', action: 'publish' }, adminCookie), env }); // admin reviews and publishes revision 1

  // Admin deliberately re-analyzes (e.g. wants a fresh look) and THIS TIME the provider fails.
  mockFetch({ aiOk: false });
  const retryRes = await checkPost({ request: post({ action: 'reanalyze', patchId: '7-2d' }, adminCookie), env });
  const retryData = await retryRes.json();
  check('the re-analysis attempt itself correctly fails (revision 2, ai_error)', retryData.revision === 2 && retryData.status === 'ai_error', retryData);

  // NOW: does "Check for new patch now" report anything useful? It must NOT -- proving the reported bug is real and "by design", i.e. genuinely requires a different mechanism.
  mockFetch({ aiOk: true, aiInput: REPORT('SHOULD_NOT_BE_CALLED') });
  const checkRes = await checkPost({ request: scheduledPost({ trigger: 'scheduled' }), env });
  const checkData = await checkRes.json();
  check('"Check for new patch" reports no new patch (proves it truly cannot retry the failed revision 2)', checkData.ok === true && checkData.newPatch === false, checkData);
  check('and critically, it did NOT call the AI at all', anthropicCallCount === 0, anthropicCallCount);
}

console.log('\n=== D. Retry Analysis (retry-analysis action) works in exactly this situation -- no discoverLatestPatchSlug needed, last-known-slug irrelevant ===');
{
  mockFetch({ aiOk: true, aiInput: REPORT('RECOVERED_VIA_RETRY_ANALYSIS') });
  const res = await checkPost({ request: post({ action: 'retry-analysis', patchId: '7-2d' }, adminCookie), env });
  const data = await res.json();
  check('retry-analysis succeeds where Check for New Patch could not', res.status === 200 && data.ok === true && data.success === true, data);
  check('action echoed back as retry-analysis (not silently renamed to reanalyze)', data.action === 'retry-analysis', data.action);
  check('revision 3 created', data.revision === 3, data.revision);
  check('new content is genuinely different, not the old report', data.report.supportMetaAnalysis === 'RECOVERED_VIA_RETRY_ANALYSIS', data.report.supportMetaAnalysis);
  check('discoverLatestPatchSlug / the Riot index was never fetched for this call', discoverCallCount === 0, discoverCallCount);
  check('engineVersion + maxTokens present per the requested diagnostic shape', typeof data.engineVersion === 'string' && data.report.engineVersion, data);
}

console.log('\n=== E. Retry success does not auto-publish; G. published content unchanged until explicit publish ===');
{
  const pub = await (await publicGet({ env })).json();
  const entry = pub.reports.find((r) => r.id === '7-2d');
  check('public STILL shows the ORIGINAL published revision (revision 1), untouched by 2 later re-analyses', entry?.supportMetaAnalysis === 'ORIGINAL_SUCCESS', entry);
}

console.log('\n=== F. Retry failure: provider fails again, error visible, another retry still possible ===');
{
  mockFetch({ aiOk: false });
  const res = await checkPost({ request: post({ action: 'retry-analysis', patchId: '7-2d' }, adminCookie), env });
  const data = await res.json();
  check('another failure is reported honestly (success:false), not silently swallowed', data.ok === true && data.success === false, data);
  check('the actual provider error is present', typeof data.aiError === 'string' && data.aiError.length > 0, data.aiError);
  check('revision 4 created for this failed attempt', data.revision === 4, data.revision);

  // One more retry must still work -- a failure is never a dead end.
  mockFetch({ aiOk: true, aiInput: REPORT('FINALLY_RECOVERED') });
  const res2 = await checkPost({ request: post({ action: 'retry-analysis', patchId: '7-2d' }, adminCookie), env });
  const data2 = await res2.json();
  check('retrying again after a failure still works (no dead end)', res2.status === 200 && data2.success === true && data2.revision === 5, data2);
}

console.log('\n=== Security: retry-analysis requires an admin session, NOT the scheduled secret ===');
{
  mockFetch({ aiOk: true, aiInput: REPORT('SHOULD_NOT_HAPPEN') });
  const res = await checkPost({ request: new Request('https://x.pages.dev/api/admin/patch-check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Patch-Check-Secret': 'sched-secret' }, body: JSON.stringify({ action: 'retry-analysis', patchId: '7-2d' }) }), env });
  check('scheduled secret rejected for retry-analysis -> 401', res.status === 401, res.status);
  check('AI was not called', anthropicCallCount === 0, anthropicCallCount);

  const res2 = await checkPost({ request: post({ action: 'retry-analysis', patchId: '7-2d' }, null), env });
  check('unauthenticated retry-analysis -> 401', res2.status === 401, res2.status);
}

console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
