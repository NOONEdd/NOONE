// End-to-end proof that retry-analysis is genuinely TARGETED (2026-09-23
// deterministic-first refactor, doc section 12): after a real partial
// failure across two separate batches, retrying must call the AI for
// ONLY the still-unresolved entity's batch -- never re-spending a call
// on entities that already succeeded -- and the final merged report
// must still contain every entity's result. Plain Node ESM against the
// real handlers, no test framework or new dependency:
//
//   node tests/patchTargetedRetryEndToEnd.test.mjs

import { onRequestPost as checkPost } from '../functions/api/admin/patch-check.js';
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
function post(body) {
  return new Request('https://x.pages.dev/api/admin/patch-check', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify(body) });
}
function scheduledPost(body) {
  return new Request('https://x.pages.dev/api/admin/patch-check', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Patch-Check-Secret': 'sched-secret' }, body: JSON.stringify(body) });
}

// Nine Academy-covered champions, one line each -- deliberately driven
// by patchPlanner.js's PATCH_INTEL_BATCH_MAX_ENTITIES cap (8, config.js)
// rather than character count: the first 8 pack into one batch, and the
// 9th (Karma) forces a genuinely separate second batch (the coalescing
// step that merges small adjacent batches never fires here, since
// combining all 9 would exceed the entity cap -- see patchPlanner.js's
// own coalescing condition). This is what makes a REAL two-batch
// partial failure possible, not a hand-constructed one.
const OTHERS = ['Leona', 'Nami', 'Rakan', 'Braum', 'Thresh', 'Nautilus', 'Alistar', 'Rell'];
const ALL = [...OTHERS, 'Karma'];
const patchHtml = `<html><body>
<h1>Patch 7.5</h1>
<h2>CHAMPIONS</h2>
${ALL.map((n, i) => `<h3>${n}</h3>\n<p>Q: damage ${70 + i} -> ${75 + i}.</p>`).join('\n')}
</body></html>`;

let anthropicCalls = [];
function mockFetch({ karmaOk, othersOk }) {
  anthropicCalls = [];
  globalThis.fetch = async (url, options) => {
    const u = String(url);
    if (u.includes('patch-notes/')) {
      return new Response(`<html><body><a href="/en-us/news/game-updates/wild-rift-patch-notes-7-5/">Patch 7.5</a></body></html>`, { status: 200 });
    }
    if (u.includes('wild-rift-patch-notes-7-5')) {
      return new Response(patchHtml, { status: 200 });
    }
    if (u.includes('api.anthropic.com')) {
      const body = JSON.parse(options.body);
      const isKarma = body.system.includes('Karma (champion)');
      const isOthers = OTHERS.some((n) => body.system.includes(`${n} (champion)`));
      anthropicCalls.push({ isKarma, isOthers, namedEntities: OTHERS.filter((n) => body.system.includes(`${n} (champion)`)).concat(isKarma ? ['Karma'] : []) });
      const ok = isKarma ? karmaOk : othersOk;
      if (!ok) return new Response(JSON.stringify({ error: { message: 'Upstream error from Nvidia: Service temporarily overloaded' } }), { status: 502 });
      const names = isKarma ? ['Karma'] : OTHERS;
      const input = {
        supportMetaAnalysis: `${names.join(', ')} analyzed.`,
        championChanges: names.map((championName) => ({
          championName, whatChanged: '', previousValue: '', newValue: '',
          type: 'Buff', supportImpact: `${championName} got stronger.`, impactSeverity: 'Medium',
          gameplayImplications: 'None.', buildImplications: 'None.', runeImplications: 'None.', matchupImplications: 'None.',
          tierListActionNeeded: false, recommendedTierAction: 'No change', reasoning: 'Numbers went up.', confidence: 'Medium',
        })),
        itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [],
        entityVerdicts: names.map((name) => ({ name, detected: true, changed: true, supportRelevant: true })),
      };
      return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_structured_response', input }], stop_reason: 'end_turn' }), { status: 200 });
    }
    throw new Error('Unexpected fetch: ' + u);
  };
}

console.log('=== Initial analysis: Karma\'s batch fails, the other 8 champions\' batch succeeds -> a REAL partial_failure across two batches ===');
let firstReport;
{
  mockFetch({ karmaOk: false, othersOk: true });
  const res = await checkPost({ request: scheduledPost({ trigger: 'scheduled' }), env });
  const data = await res.json();
  // PATCH_INTEL_BATCH_MAX_ATTEMPTS (config.js) bounded-retry logic --
  // pre-existing, unrelated to this refactor -- retries a failing batch
  // up to 3 times before giving up, so Karma's batch (which fails every
  // attempt here) accounts for 3 of these calls, not 1.
  check('two independent batches were planned: others succeeded in 1 call, Karma failed all 3 of its retries', anthropicCalls.filter((c) => c.isOthers).length === 1 && anthropicCalls.filter((c) => c.isKarma).length === 3, anthropicCalls);
  check('one call was the 8-champion batch, one was Karma alone', anthropicCalls.some((c) => c.isOthers) && anthropicCalls.some((c) => c.isKarma), anthropicCalls);
  check('status is partial_failure (Karma batch genuinely failed, the rest genuinely succeeded)', data.status === 'partial_failure', data.status);
  const cov = data.report.analysisCoverage;
  check('Karma is unresolved', cov.entities.find((e) => e.key === 'champion:karma')?.state === 'unresolved', cov.entities.find((e) => e.key === 'champion:karma'));
  check('all 8 others are changed_relevant', OTHERS.every((n) => cov.entities.find((e) => e.name === n)?.state === 'changed_relevant'), cov.entities.filter((e) => OTHERS.includes(e.name)));
  check('all 8 others already have real championChanges entries after round 1', OTHERS.every((n) => data.report.championChanges.some((c) => c.championName === n)), data.report.championChanges.map((c) => c.championName));
  check('Karma has no championChanges entry yet', !data.report.championChanges.some((c) => c.championName === 'Karma'), data.report.championChanges);
  firstReport = data.report;
}

console.log('\n=== retry-analysis: must call AI for ONLY Karma\'s batch, never re-spend a call on the other 8 ===');
{
  mockFetch({ karmaOk: true, othersOk: false }); // othersOk:false proves that batch is never even attempted -- if it were, this run would fail
  const res = await checkPost({ request: post({ action: 'retry-analysis', patchId: '7-5' }), env });
  const data = await res.json();
  check('retry reports itself as targeted, exactly 1 entity', data.targeted === true && data.targetedEntityCount === 1, data);
  check('exactly ONE AI call was made this round', anthropicCalls.length === 1, anthropicCalls);
  check('that one call was for Karma, not the other 8', anthropicCalls[0]?.isKarma === true && anthropicCalls[0]?.isOthers === false, anthropicCalls);
  check('retry succeeded -- the whole patch is now fully resolved', data.ok === true && data.success === true && data.status === 'pending_review', data);

  const cov = data.report.analysisCoverage;
  check('all 9 champions are now changed_relevant, nothing unresolved', cov.states.changed_relevant === 9 && cov.states.unresolved === 0, cov.states);
  check('final report has all 9 champions -- Karma newly resolved, the other 8 carried over from round 1 untouched',
    data.report.championChanges.length === 9 && ALL.every((n) => data.report.championChanges.some((c) => c.championName === n)),
    data.report.championChanges.map((c) => c.championName));
  check('the whole-patch summary is still the ORIGINAL one (a targeted retry\'s own tiny summary never overwrites it)',
    data.report.supportMetaAnalysis === firstReport.supportMetaAnalysis, data.report.supportMetaAnalysis);
}

console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
