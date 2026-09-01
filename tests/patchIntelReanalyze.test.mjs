// Patch Intelligence -- Re-analyze / revisions / aggregation regression
// test. Plain Node ESM against the REAL handler functions (not a
// separate mock server) -- no test framework, no new dependency. Run
// directly:
//
//   node tests/patchIntelReanalyze.test.mjs
//
// Exits non-zero on any failure, so it's usable in CI as-is if this
// project ever adds a pipeline step for it.
//
// This specifically covers the scenario reported as broken: clicking
// Re-analyze appeared to return the same analysis as before. This file
// proves the BACKEND half of that (a genuinely new AI call, a genuinely
// new revision, the old revision genuinely untouched) using the real
// functions/api/admin/patch-check.js, functions/api/admin/
// patch-reports.js, and functions/api/patch-reports.js handlers with an
// in-memory mock KV and a mocked AI provider response. It does NOT
// cover the frontend half (AdminPage.jsx actually re-rendering with the
// new content) -- that bug was a React state-caching issue with no
// equivalent at this layer; it was verified separately with a real
// jsdom + React Testing Library render (see the project's delivery
// notes) rather than committed here, since jsdom/@testing-library/react
// aren't dependencies of this project and adding them just for one
// test file isn't warranted.

import { onRequestPost as checkPost } from '../functions/api/admin/patch-check.js';
import { onRequestGet as adminGet, onRequestPost as adminPost } from '../functions/api/admin/patch-reports.js';
import { onRequestGet as publicGet } from '../functions/api/patch-reports.js';
import { createSessionToken } from '../functions/_lib/adminAuth.js';
import { normalizePatchIntelReport } from '../functions/_lib/patchIntelligence.js';
import { CHAMPIONS } from '../src/data/champions.js';

const store = new Map();
const mockKV = {
  async get(k) { return store.has(k) ? store.get(k) : null; },
  async put(k, v) { store.set(k, String(v)); },
};
const env = { COACH_KV: mockKV, ADMIN_SESSION_SECRET: 'test-secret', ANTHROPIC_API_KEY: 'dummy-test-key', AI_PROVIDER: 'anthropic' };

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS -', label); }
  else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail) : ''); }
}

const adminCookie = `academy_admin_session=${await createSessionToken(env)}`;

function post(path, body, cookie) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  return new Request(`https://x.pages.dev${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
function authedGet(path) {
  return new Request(`https://x.pages.dev${path}`, { headers: { Cookie: adminCookie } });
}

function mockAiOnce(input) {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('patch-notes/')) {
      return new Response(`<html><body><a href="/en-us/news/game-updates/wild-rift-patch-notes-7-3a/">Patch 7.3a</a></body></html>`, { status: 200 });
    }
    if (u.includes('wild-rift-patch-notes-7-3a')) {
      return new Response(`<html><body><h1>Patch 7.3a Notes</h1><p>Leona Q, W, and E all received changes this patch.</p></body></html>`, { status: 200 });
    }
    if (u.includes('api.anthropic.com')) {
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_structured_response', input }], stop_reason: 'end_turn' }), { status: 200 });
    }
    throw new Error('Unexpected fetch in test: ' + u);
  };
}

const REPORT_SHAPE = (championName, whatChanged) => ({
  championName, whatChanged, previousValue: '', newValue: '', type: 'Buff', supportImpact: 'x',
  impactSeverity: 'Low', gameplayImplications: '', buildImplications: '', runeImplications: '',
  matchupImplications: '', tierListActionNeeded: false, recommendedTierAction: 'No change', reasoning: '', confidence: 'Low',
});

console.log('=== SEED: revision 1, published, with the ORIGINAL analysis ===');
{
  mockAiOnce({
    supportMetaAnalysis: 'ORIGINAL_ANALYSIS_TEXT',
    championChanges: [REPORT_SHAPE('Leona', 'Q: 80 -> 90')],
    itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [],
  });
  const res = await checkPost({ request: post('/api/admin/patch-check', { trigger: 'manual' }, adminCookie), env });
  const data = await res.json();
  check('revision 1 created, pending_review', res.status === 200 && data.newPatch && data.status === 'pending_review', data.status);

  const pub = await adminPost({ request: post('/api/admin/patch-reports', { id: '7-3a', action: 'publish' }, adminCookie), env });
  check('revision 1 published', pub.status === 200, pub.status);
}

console.log('\n=== 1-3. Re-analyze reaches the current code, calls the AI again, uses the current prompt/roster ===');
{
  mockAiOnce({
    supportMetaAnalysis: 'DELIBERATELY_DIFFERENT_ANALYSIS_TEXT',
    championChanges: [REPORT_SHAPE('Leona', 'Q: 80 -> 95 (this is the NEW result, not the old one)')],
    itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [],
  });
  const res = await checkPost({ request: post('/api/admin/patch-check', { action: 'reanalyze', patchId: '7-3a' }, adminCookie), env });
  const data = await res.json();

  check('response has ok, success, action, patchId, revision, status, engineVersion', data.ok === true && data.success === true && data.action === 'reanalyze' && data.patchId === '7-3a' && typeof data.revision === 'number' && data.status && data.engineVersion, data);
  check('engineVersion is a real, non-empty marker (proves the current code executed)', typeof data.engineVersion === 'string' && data.engineVersion.length > 0, data.engineVersion);
  check('revision 2 was created', data.revision === 2, data.revision);
  check('DID NOT just return the old report -- content is genuinely different', data.report.supportMetaAnalysis === 'DELIBERATELY_DIFFERENT_ANALYSIS_TEXT', data.report.supportMetaAnalysis);
  check('status is pending_review', data.status === 'pending_review', data.status);
}

console.log('\n=== 4. Patch content came from cache (not discoverLatestPatchSlug, not the previous AI report) ===');
{
  // A second reanalyze call should reuse the CACHED Riot content (no
  // second HTML fetch needed) -- simulate this by making the mocked
  // fetch throw for the patch-notes URLs, so a cache-miss would surface
  // immediately as a hard failure instead of silently succeeding.
  let anthropicCalled = false;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('patch-notes/')) throw new Error('Should not re-fetch the patch index -- must use riotFallback.js cache for an already-known slug');
    if (u.includes('api.anthropic.com')) {
      anthropicCalled = true;
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_structured_response', input: { supportMetaAnalysis: 'THIRD_ANALYSIS', championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [] } }], stop_reason: 'end_turn' }), { status: 200 });
    }
    throw new Error('Unexpected fetch: ' + u);
  };
  const res = await checkPost({ request: post('/api/admin/patch-check', { action: 'reanalyze', patchId: '7-3a' }, adminCookie), env });
  const data = await res.json();
  check('reused cached Riot content (no re-fetch of the patch index)', res.status === 200 && data.ok === true, data);
  check('a genuinely fresh AI call was made', anthropicCalled === true);
  check('revision 3 created', data.revision === 3, data.revision);
}

console.log('\n=== 5. Revision 1 completely untouched by two re-analyses ===');
{
  const rev1 = await (await adminGet({ request: authedGet('/api/admin/patch-reports?id=7-3a&revision=1'), env })).json();
  check('revision 1 still has the ORIGINAL text', rev1.report.supportMetaAnalysis === 'ORIGINAL_ANALYSIS_TEXT', rev1.report.supportMetaAnalysis);
  check('revision 1 status is still published', rev1.report.status === 'published', rev1.report.status);
}

console.log('\n=== Public API still returns revision 1 (unpublished revisions never leak) ===');
{
  const pub = await (await publicGet({ env })).json();
  const entry = pub.reports.find((r) => r.id === '7-3a');
  check('public still shows revision 1 content', entry?.supportMetaAnalysis === 'ORIGINAL_ANALYSIS_TEXT', entry?.supportMetaAnalysis);
}

console.log('\n=== 6/9/10/13/14. Publish rev 2 -> public switches; unpublish -> public empty; restore rev 1 -> public switches back ===');
{
  await adminPost({ request: post('/api/admin/patch-reports', { id: '7-3a', action: 'publish', revision: 2 }, adminCookie), env });
  let pub = await (await publicGet({ env })).json();
  check('public now shows revision 2', pub.reports.find((r) => r.id === '7-3a')?.supportMetaAnalysis === 'DELIBERATELY_DIFFERENT_ANALYSIS_TEXT', pub.reports.find((r) => r.id === '7-3a'));

  await adminPost({ request: post('/api/admin/patch-reports', { id: '7-3a', action: 'unpublish' }, adminCookie), env });
  pub = await (await publicGet({ env })).json();
  check('unpublish removes it from public entirely', !pub.reports.some((r) => r.id === '7-3a'), pub.reports.map((r) => r.id));

  await adminPost({ request: post('/api/admin/patch-reports', { id: '7-3a', action: 'restore', revision: 1 }, adminCookie), env });
  pub = await (await publicGet({ env })).json();
  check('restore revision 1 makes it public again with the ORIGINAL content', pub.reports.find((r) => r.id === '7-3a')?.supportMetaAnalysis === 'ORIGINAL_ANALYSIS_TEXT', pub.reports.find((r) => r.id === '7-3a'));
}

console.log('\n=== Failure transparency: AI failure is reported honestly, not hidden as success, and never touches the published revision ===');
{
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('patch-notes/')) return new Response(`<html><body><a href="/en-us/news/game-updates/wild-rift-patch-notes-7-3a/">Patch 7.3a</a></body></html>`, { status: 200 });
    if (u.includes('wild-rift-patch-notes-7-3a')) return new Response(`<html><body><h1>Patch 7.3a</h1></body></html>`, { status: 200 });
    if (u.includes('api.anthropic.com')) return new Response('rate limited', { status: 429 });
    throw new Error('Unexpected: ' + u);
  };
  const res = await checkPost({ request: post('/api/admin/patch-check', { action: 'reanalyze', patchId: '7-3a' }, adminCookie), env });
  const data = await res.json();
  check('success:false surfaced explicitly (not hidden as a successful reanalysis)', data.success === false, data);
  check('an actual error reason is present (not silently swallowed)', typeof data.aiError === 'string' && data.aiError.length > 0, data.aiError);
  check('a failure revision was still recorded for debugging', typeof data.revision === 'number', data.revision);

  const pub = await (await publicGet({ env })).json();
  check('published content (revision 1, restored earlier) is COMPLETELY unaffected by the failed reanalysis', pub.reports.find((r) => r.id === '7-3a')?.supportMetaAnalysis === 'ORIGINAL_ANALYSIS_TEXT', pub.reports.find((r) => r.id === '7-3a'));
}

console.log('\n=== Aggregation: Leona Q/W/E as three separate AI entries MUST merge into ONE championChanges entry ===');
{
  const raw = {
    supportMetaAnalysis: 'x',
    championChanges: [
      { ...REPORT_SHAPE('Leona', 'Q: damage 60/100/140/180 -> 70/110/150/190') },
      { ...REPORT_SHAPE('Leona', 'W: armor 20 -> 25') },
      { ...REPORT_SHAPE('Leona', 'E: cooldown 12s -> 10s') },
    ],
    itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [],
  };
  const normalized = normalizePatchIntelReport(raw, { championRoster: CHAMPIONS.filter((c) => c.id === 'leona'), itemRoster: [], runeRoster: [] });
  check('exactly ONE Leona entry (not three)', normalized.championChanges.length === 1, normalized.championChanges.length);
  const merged = normalized.championChanges[0];
  check('merged entry contains the Q change', merged.whatChanged.includes('60/100/140/180 -> 70/110/150/190'), merged.whatChanged);
  check('merged entry contains the W change', merged.whatChanged.includes('armor 20 -> 25'), merged.whatChanged);
  check('merged entry contains the E change', merged.whatChanged.includes('cooldown 12s -> 10s'), merged.whatChanged);
}

console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
