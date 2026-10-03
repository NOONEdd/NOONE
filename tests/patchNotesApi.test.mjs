// Patch Notes -- API-level integration: detect -> review ops -> rescan (review survives) -> publish (reviewed view only),
// with the KV safety layer intact. No network (Riot content is seeded into the KV cache), no AI, no production KV.
import { onRequestPost as checkPost } from '../functions/api/admin/patch-check.js';
import { onRequestPost as reportsPost } from '../functions/api/admin/patch-reports.js';
import { onRequestGet as publicGet } from '../functions/api/patch-reports.js';
import { createSessionToken } from '../functions/_lib/adminAuth.js';
import { getReportRevision } from '../functions/_lib/patchReportsStore.js';
import * as S from '../functions/_lib/kvSafety.js';
import { SOURCE_TEXT_VERSION } from '../functions/_lib/patchText.js';
import { makeChecker, SENNA_73 } from './helpers/patchNotesHelpers.mjs';

const { check, done } = makeChecker();

function makeMockKV() {
  const store = new Map(); const meta = new Map();
  return {
    store, meta,
    async get(key) { if (this.__failGet) throw new Error('simulated KV GET failure'); return store.has(key) ? store.get(key) : null; },
    async put(key, value, opts) { if (this.__failPut) throw new Error('simulated KV PUT failure'); store.set(key, String(value)); if (opts && opts.metadata) meta.set(key, opts.metadata); else meta.delete(key); },
    async delete(key) { store.delete(key); meta.delete(key); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const names = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0; const page = names.slice(start, start + limit); const next = start + page.length;
      return { keys: page.map((name) => ({ name, metadata: meta.get(name) })), list_complete: next >= names.length, cursor: next >= names.length ? null : String(next) };
    },
  };
}
async function seedRiotCache(kv, slug, text) {
  await kv.put('riot-latest-patch-meta', JSON.stringify({ slug }));
  await kv.put(`riot-fallback-full-content:${slug}:${SOURCE_TEXT_VERSION}`, JSON.stringify({ content: text, truncated: false }));
}
async function adminEnv(kv) { const env = { COACH_KV: kv, ADMIN_SESSION_SECRET: 'test-secret' }; return { env, cookie: `academy_admin_session=${await createSessionToken(env)}` }; }
const req = (url, body, cookie) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie || '' }, body: JSON.stringify(body) });
const CUSTOM = Object.freeze({ champions: { leona: { tier: 'S', note: 'Coach note' } }, items: {}, runes: {}, decisionTrees: {}, patch: '7.2', verifiedPatch: '7.2', patchStatus: null });

// Riot-shaped page: Leona + Edge of Night are tracked by Academy's static data; Mystery Blade is not.
const PAGE = `# Wild Rift Patch Notes 7.5

Patch 7.5 is here.

## CHAMPION ADJUSTMENTS

### Marksman Champion Adjustments

LEONA

Q - Shield of Daybreak

- Damage: 60 / 100 / 140 / 180 → 70 / 110 / 150 / 190
- [New] Leona gains bonus armor.

## Item Adjustments

### Marksman Item Adjustments

New items like Mystery Blade are joining the shop.

#### Mystery Blade

- Price: 3000

## BATTLEFIELD ADJUSTMENTS

### Jungle Adjustments

- [Removed] Monster gold scaling.
`;

console.log('\n=== Detect: dataset + provenance + accounting land in the stored report; legacy view derived ===');
const kv = makeMockKV();
await S.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => CUSTOM });
const slug = 'wild-rift-patch-notes-7-5';
await seedRiotCache(kv, slug, PAGE);
const { env, cookie } = await adminEnv(kv);
const detect = await (await checkPost({ request: req('https://x/api/admin/patch-check', { trigger: 'manual' }, cookie), env })).json();
const rep = detect.report;
check('detect ok, report has a patchNotes dataset', detect.ok === true && rep.patchNotes && rep.patchNotes.changes.length > 0, Object.keys(rep));
if (false) console.log('   provenance sample:', JSON.stringify({ v: rep.patchNotes.changes[0].provenance.patchVersion, u: rep.patchNotes.changes[0].provenance.sourceUrl, reportSource: rep.sourceUrl, patch: rep.patch }));
check('provenance carries the real patch version (7.5) + the real source URL', rep.patch === '7.5' && rep.patchNotes.changes.every((c) => c.provenance.patchVersion === '7.5' && c.provenance.sourceUrl === rep.sourceUrl && /^https:\/\//.test(c.provenance.sourceUrl)), rep.patch);
check('accounting: 0 unaccounted blocks', rep.patchNotes.validation.droppedBlocks === 0, rep.patchNotes.validation);
check('Leona is EXISTING with her changes in the legacy championChanges view', rep.championChanges.some((c) => c.championId === 'leona' && c.entityStatus === 'EXISTING'));
check('Mystery Blade is NEW_CANDIDATE (kept in the dataset, visible to review)', rep.patchNotes.changes.some((c) => c.entity && c.entity.name === 'Mystery Blade' && c.entity.status === 'NEW_CANDIDATE'));
check('no AI fields carry values', rep.aiProvider === null && rep.aiModel === null);

console.log('\n=== Review ops via the admin API; original source cannot be written; legacy view re-derived ===');
const dq = rep.patchNotes.changes.find((c) => c.normalizedData.stat === 'Damage');
const bonus = rep.patchNotes.changes.find((c) => c.normalizedData.changeType === 'effect_added');
const blade = rep.patchNotes.changes.find((c) => c.entity && c.entity.name === 'Mystery Blade');
const jungle = rep.patchNotes.changes.find((c) => c.kind === 'system');
const review = async (ops, extra = {}) => { const r = await reportsPost({ env, request: req('https://x/api/admin/patch-reports', { id: slug, action: 'review', ops, ...extra }, cookie) }); return { status: r.status, body: await r.json() }; };
let r1 = await review([
  { op: 'edit', changeId: dq.changeId, displayText: 'Leona Q damage up at every rank.', reviewerNote: 'verified' },
  { op: 'reject', changeId: bonus.changeId },
  { op: 'keep', changeId: blade.changeId },
  { op: 'remove', changeId: jungle.changeId },
  { op: 'edit', changeId: dq.changeId, originalSourceText: 'HACKED', normalizedData: { newValue: 'x' } },
]);
check('review action applies', r1.status === 200 && r1.body.ok && r1.body.applied.length >= 4, r1.body);
const stored1 = await getReportRevision(kv, slug, 1);
const dq1 = stored1.patchNotes.changes.find((c) => c.changeId === dq.changeId);
check('original Riot source + normalized data unchanged by review ops (even with malicious fields)', dq1.originalSourceText === dq.originalSourceText && dq1.normalizedData.newValue === dq.normalizedData.newValue && !JSON.stringify(dq1).includes('HACKED'));
check('display edit + review state stored in the review layer', dq1.review.displayText === 'Leona Q damage up at every rank.' && dq1.review.state === 'edited');
check('draft legacy view reflects the reviewed dataset (edited text shown, rejected bonus gone)', stored1.championChanges.find((c) => c.championId === 'leona').whatChanged.includes('Leona Q damage up at every rank.') && !stored1.championChanges.find((c) => c.championId === 'leona').whatChanged.includes('bonus armor'));
check('unknown revision/malformed ops are rejected without writing', (await review([{ op: 'nope' }])).status === 400 && (await review([{ op: 'remove', changeId: 'pn_missing' }])).status === 400);

console.log('\n=== Coach edit flow still works on a Patch Notes report, but cannot overwrite facts/review ===');
const coachEdit = await reportsPost({ env, request: req('https://x/api/admin/patch-reports', { id: slug, action: 'edit', edits: { championChanges: stored1.championChanges.map((c) => ({ ...c, supportImpact: 'Coach says: strong.', whatChanged: 'OVERWRITE ATTEMPT', sourceRaw: 'OVERWRITE' })), systemChanges: [] } }, cookie) });
const stored2 = await getReportRevision(kv, slug, 1);
const leona2 = stored2.championChanges.find((c) => c.championId === 'leona');
check('Coach field merged', coachEdit.status === 200 && leona2.supportImpact === 'Coach says: strong.');
check('fact fields from the request were ignored (cannot overwrite Riot facts)', !leona2.whatChanged.includes('OVERWRITE') && !leona2.sourceRaw.includes('OVERWRITE'));
check('system rows are not wiped by a legacy edit', stored2.patchNotes.changes.some((c) => c.kind === 'system'));

console.log('\n=== Rescan (regeneration) preserves every human review decision ===');
await seedRiotCache(kv, slug, PAGE.replace('70 / 110 / 150 / 190', '75 / 115 / 155 / 195'));
const rescan = await (await checkPost({ env, request: req('https://x/api/admin/patch-check', { action: 'rescan', patchId: slug }, cookie) })).json();
const ds2 = rescan.report.patchNotes;
const dq2 = ds2.changes.find((c) => c.changeId === dq.changeId);
check('rescan ok and produced the same stable change IDs', rescan.ok === true && Boolean(dq2));
check('display edit + reviewer note survived the rescan', dq2.review.displayText === 'Leona Q damage up at every rank.' && dq2.review.reviewerNote === 'verified');
check('Riot value refreshed in the normalized layer + original source, and the change is flagged "source changed since review"', dq2.normalizedData.newValue.includes('75 / 115') && dq2.originalSourceText.includes('75 / 115') && dq2.review.sourceChangedSinceReview === true);
check('rejected / kept / removed states survived', ds2.changes.find((c) => c.changeId === bonus.changeId).review.state === 'rejected' && ds2.changes.find((c) => c.changeId === blade.changeId).review.state === 'kept' && ds2.changes.find((c) => c.changeId === jungle.changeId).review.state === 'removed');
check('Coach field survived the rescan too', rescan.report.championChanges.find((c) => c.championId === 'leona').supportImpact === 'Coach says: strong.');
check('rescan report notes the review carry-forward and reports merge stats', /review decision/i.test(rescan.report.adminNotes) && ds2.mergeStats.preserved >= 4, ds2.mergeStats);

console.log('\n=== Section removal survives a rescan ===');
const sec = 'entity:champion:leona';
await review([{ op: 'removeSection', sectionKey: sec }], { revision: rescan.revision });
await seedRiotCache(kv, slug, PAGE);
const rescan2 = await (await checkPost({ env, request: req('https://x/api/admin/patch-check', { action: 'rescan', patchId: slug }, cookie) })).json();
check('section still removed after another rescan', rescan2.report.patchNotes.sectionReview[sec].state === 'removed' && !rescan2.report.championChanges.some((c) => c.championId === 'leona'));
check('the underlying Leona extraction is intact', rescan2.report.patchNotes.changes.filter((c) => c.entity && c.entity.id === 'leona').length >= 2);

console.log('\n=== Publish uses the REVIEWED dataset; Academy master data and coach-overrides untouched ===');
const latestRev = rescan2.revision;
await review([{ op: 'restoreSection', sectionKey: sec }], { revision: latestRev });
await reportsPost({ env, request: req('https://x/api/admin/patch-reports', { id: slug, action: 'approve', revision: latestRev }, cookie) });
const before = await S.readOverrides(kv);
const pub = await reportsPost({ env, request: req('https://x/api/admin/patch-reports', { id: slug, action: 'publish', revision: latestRev }, cookie) });
check('publish succeeds once approved', pub.status === 200);
const after = await S.readOverrides(kv);
check('champion/item/rune/decision-tree overrides byte-identical after publish (only patch markers change)', JSON.stringify(after.overrides.champions) === JSON.stringify(before.overrides.champions) && JSON.stringify(after.overrides.items) === JSON.stringify(before.overrides.items) && JSON.stringify(after.overrides.runes) === JSON.stringify(before.overrides.runes) && JSON.stringify(after.overrides.decisionTrees) === JSON.stringify(before.overrides.decisionTrees));
const publicRes = await publicGet({ env, request: new Request('https://x/api/patch-reports') });
const publicBody = await publicRes.json();
const pr = (publicBody.reports || publicBody)[0];
check('public view exists and never leaks the review dataset / provenance / fingerprints (the reviewer note is PUBLIC by design, as presentation field `note`; its storage key never appears)', pr && !('patchNotes' in pr) && !JSON.stringify(pr).includes('reviewerNote') && !JSON.stringify(pr).includes('sourceFingerprint'), pr && Object.keys(pr));
check('public view shows the EXISTING Leona entry', pr.championChanges.some((c) => c.championId === 'leona'));
check('public view hides the rejected change', !JSON.stringify(pr.championChanges).includes('bonus armor'));
check('public view shows the kept NEW_CANDIDATE and hides the removed system change', pr.itemChanges.some((i) => i.itemName === 'Mystery Blade') && pr.systemChanges.length === 0, { items: pr.itemChanges.map((i) => i.itemName), sys: pr.systemChanges.length });

console.log('\n=== KV safety: a failed KV read during review writes nothing ===');
const kv2 = makeMockKV();
await S.mutateOverrides(kv2, { operation: 'seed', source: 'test', mutate: () => CUSTOM });
await seedRiotCache(kv2, slug, PAGE);
const e2 = await adminEnv(kv2);
const d2 = await (await checkPost({ request: req('https://x/api/admin/patch-check', { trigger: 'manual' }, e2.cookie), env: e2.env })).json();
const snapshot = JSON.stringify([...kv2.store.entries()]);
kv2.__failGet = true;
const failed = await reportsPost({ env: e2.env, request: req('https://x/api/admin/patch-reports', { id: slug, action: 'review', ops: [{ op: 'remove', changeId: d2.report.patchNotes.changes[0].changeId }] }, e2.cookie) });
kv2.__failGet = false;
check('review during a failed KV read is refused (not a silent empty write)', failed.status >= 400 && failed.status < 600);
check('nothing in KV changed', JSON.stringify([...kv2.store.entries()]) === snapshot);

done();
