// KV Data Protection / Safety Layer regression test. Plain Node ESM
// against the REAL handlers and the real functions/_lib/kvSafety.js
// module, no test framework. Run directly:
//
//   node tests/kvSafetyLayer.test.mjs
//
// Covers all 14 scenarios mandated when this layer was requested, plus
// the recovery endpoint (functions/api/admin/coach-overrides-backups.js)
// and its integration with the two real write paths that now go through
// mutateOverrides(): Coach Mode saves (functions/api/coach-overrides.js)
// and Patch Intelligence publish (functions/api/admin/patch-reports.js).
//
// This supersedes the narrower tests/coachOverridesSafety.test.mjs from
// the previous safety pass (safe publish read-modify-write, the
// approval gate, the empty-overwrite guard) -- all three of those are
// now special cases of the general mechanism tested here, exercised in
// sections 9 and 15-16 below.

import * as S from '../functions/_lib/kvSafety.js';
import { onRequestGet as coachGet, onRequestPost as coachPost } from '../functions/api/coach-overrides.js';
import { onRequestPost as reportsPost } from '../functions/api/admin/patch-reports.js';
import { onRequestGet as backupsGet, onRequestPost as backupsPost } from '../functions/api/admin/coach-overrides-backups.js';
import { saveNewReport } from '../functions/_lib/patchReportsStore.js';
import { createSessionToken } from '../functions/_lib/adminAuth.js';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS -', label); }
  else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail) : ''); }
}

// A mock Cloudflare KV binding: get/put/delete plus list({prefix,
// cursor, limit}) -> {keys:[{name,metadata}], list_complete, cursor},
// matching the real Workers KV API closely enough for this module
// (which only ever uses that subset).
function makeMockKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  const meta = new Map();
  return {
    store, meta,
    async get(key) {
      if (this.__failGet) throw new Error('simulated KV GET failure');
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value, opts) {
      if (this.__failPut) throw new Error('simulated KV PUT failure');
      store.set(key, String(value));
      if (opts && opts.metadata) meta.set(key, opts.metadata); else meta.delete(key);
    },
    async delete(key) { store.delete(key); meta.delete(key); },
    async list({ prefix = '', cursor, limit = 1000 } = {}) {
      const names = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const startIdx = cursor ? Number(cursor) : 0;
      const page = names.slice(startIdx, startIdx + limit);
      const keys = page.map((name) => ({ name, metadata: meta.get(name) }));
      const nextIdx = startIdx + page.length;
      const list_complete = nextIdx >= names.length;
      return { keys, list_complete, cursor: list_complete ? null : String(nextIdx) };
    },
  };
}

function bigOverrides(n = 10) {
  const champions = {};
  for (let i = 0; i < n; i++) champions[`champ-${i}`] = { tier: 'S', note: 'x'.repeat(80), builds: [{ name: 'Default', items: [{ name: 'Item A' }, { name: 'Item B' }] }] };
  const items = {};
  for (let i = 0; i < n; i++) items[`item-${i}`] = { tier: 'A', info: 'y'.repeat(80) };
  const runes = {};
  for (let i = 0; i < n; i++) runes[`rune-${i}`] = { tier: 'B', info: 'z'.repeat(80) };
  const decisionTrees = {};
  for (let i = 0; i < n; i++) decisionTrees[`champ-${i}`] = [{ id: `dt-${i}`, content: 'w'.repeat(80) }];
  return { champions, items, runes, decisionTrees, patch: '7.2', verifiedPatch: '7.2', patchStatus: null };
}

async function adminEnv(kv) {
  const env = { COACH_KV: kv, ADMIN_SESSION_SECRET: 'test-secret' };
  const cookie = `academy_admin_session=${await createSessionToken(env)}`;
  return { env, cookie };
}
function postReq(url, body, cookie) {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie || '' }, body: JSON.stringify(body) });
}

// =====================================================================
console.log('\n=== 1. Normal update succeeds ===');
{
  const kv = makeMockKV();
  await S.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => bigOverrides(5) });
  const r = await S.mutateOverrides(kv, { operation: 'test', source: 'test', mutate: (cur) => ({ ...cur, champions: { ...cur.champions, extra: { tier: 'S' } } }) });
  check('write accepted', r.ok === true, r);
  check('revision incremented', r.revision === 2, r.revision);
  const read = await S.readOverrides(kv);
  check('new entry present, old entries preserved', read.overrides.champions.extra?.tier === 'S' && Object.keys(read.overrides.champions).length === 6, read.overrides.champions);
}

console.log('\n=== 2. New KV key initializes safely ===');
{
  const kv = makeMockKV();
  const read0 = await S.readOverrides(kv);
  check('brand-new key reads as KEY_NOT_FOUND, not an error', read0.status === S.READ_STATUS.KEY_NOT_FOUND, read0.status);
  const r = await S.mutateOverrides(kv, { operation: 'test', source: 'test', mutate: (cur) => ({ ...cur, champions: { leona: { tier: 'S' } } }) });
  check('first-ever write succeeds', r.ok === true, r);
  check('revision starts at 1', r.revision === 1, r.revision);
  check('full shape present (champions/items/runes/decisionTrees all objects)', r.overrides.items && r.overrides.runes && r.overrides.decisionTrees, r.overrides);
  check('no backup created for a key that never existed (nothing to back up)', r.backupKey === null, r.backupKey);
}

console.log('\n=== 3. KV read failure -> NO WRITE ===');
{
  const kv = makeMockKV(); await S.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => bigOverrides(5) });
  const before = kv.store.get(S.KEY);
  kv.__failGet = true;
  const r = await S.mutateOverrides(kv, { operation: 'test', source: 'test', mutate: (cur) => ({ ...cur, champions: {} }) });
  check('write rejected', r.ok === false, r);
  check('rejection code is KV_READ_FAILED', r.code === 'KV_READ_FAILED', r.code);
  kv.__failGet = false;
  check('live data completely untouched', kv.store.get(S.KEY) === before, true);
}

console.log('\n=== 4. Invalid JSON -> NO WRITE ===');
{
  const kv = makeMockKV({ [S.KEY]: '{not valid json' });
  const read = await S.readOverrides(kv);
  check('readOverrides reports KV_DATA_INVALID', read.status === S.READ_STATUS.KV_DATA_INVALID, read.status);
  const r = await S.mutateOverrides(kv, { operation: 'test', source: 'test', mutate: (cur) => ({ ...cur, champions: { x: { tier: 'S' } } }) });
  check('write rejected', r.ok === false, r);
  check('rejection code is KV_DATA_INVALID', r.code === 'KV_DATA_INVALID', r.code);
  check('live (corrupted) data left exactly as it was', kv.store.get(S.KEY) === '{not valid json', true);
}

console.log('\n=== 5. Empty payload replacing populated KV -> BLOCKED ===');
{
  const kv = makeMockKV(); await S.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => bigOverrides(5) });
  const before = kv.store.get(S.KEY);
  const r = await S.mutateOverrides(kv, { operation: 'test', source: 'test', mutate: () => ({ champions: {}, items: {}, runes: {}, decisionTrees: {}, patch: '7.2', verifiedPatch: '7.2', patchStatus: null }) });
  check('write blocked', r.ok === false, r);
  check('blocked with the suspicious-change code', r.code === 'KV_WRITE_BLOCKED_SUSPICIOUS_DATA_CHANGE', r.code);
  check('live data untouched', kv.store.get(S.KEY) === before, true);
}

console.log('\n=== 6. Massive size reduction -> BLOCKED (200KB-style example, same counts, gutted content) ===');
{
  const kv = makeMockKV();
  const large = bigOverrides(30); // realistic size, well over the 500-byte floor
  await S.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => large });
  const before = kv.store.get(S.KEY);
  // same champion/item/rune/decisionTree KEYS (so the entity-count check
  // alone would NOT catch this) but every nested note/build/info field
  // gutted to almost nothing -- this is exactly what the size check
  // exists for, on top of the count check.
  const gutted = {
    champions: Object.fromEntries(Object.keys(large.champions).map((k) => [k, { tier: 'S' }])),
    items: Object.fromEntries(Object.keys(large.items).map((k) => [k, { tier: 'A' }])),
    runes: Object.fromEntries(Object.keys(large.runes).map((k) => [k, { tier: 'B' }])),
    decisionTrees: Object.fromEntries(Object.keys(large.decisionTrees).map((k) => [k, []])),
    patch: '7.2', verifiedPatch: '7.2', patchStatus: null,
  };
  check('sanity: gutted keeps every top-level entity key', Object.keys(gutted.champions).length === Object.keys(large.champions).length, true);
  const r = await S.mutateOverrides(kv, { operation: 'test', source: 'test', mutate: () => gutted });
  check('write blocked purely on size', r.ok === false && r.code === 'KV_WRITE_BLOCKED_SUSPICIOUS_DATA_CHANGE', r);
  check('reason cites overall size', r.assessment?.reasons?.some((x) => x.includes('size')), r.assessment);
  check('live data untouched', kv.store.get(S.KEY) === before, true);
}

console.log('\n=== 7. Massive entity-count reduction -> BLOCKED (35/87/50/37 -> 0/0/0/0 shape, relative not hardcoded) ===');
{
  const kv = makeMockKV();
  const large = bigOverrides(35); // arbitrary size, well above COUNT_FLOOR -- proves the check is relative, not tied to any specific number
  await S.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => large });
  const before = kv.store.get(S.KEY);
  const r = await S.mutateOverrides(kv, { operation: 'test', source: 'test', mutate: () => ({ champions: {}, items: {}, runes: {}, decisionTrees: {}, patch: '7.2', verifiedPatch: '7.2', patchStatus: null }) });
  check('write blocked', r.ok === false && r.code === 'KV_WRITE_BLOCKED_SUSPICIOUS_DATA_CHANGE', r);
  check('all four categories cited', ['champions', 'items', 'runes', 'decisionTrees'].every((k) => r.assessment.reasons.some((x) => x.includes(`"${k}"`))), r.assessment.reasons);
  check('live data untouched', kv.store.get(S.KEY) === before, true);

  // relative-threshold proof: growing the roster should NOT change
  // whether a proportional drop trips the check -- try again at 3x
  const kv2 = makeMockKV();
  await S.mutateOverrides(kv2, { operation: 'seed', source: 'test', mutate: () => bigOverrides(105) });
  const r2 = await S.mutateOverrides(kv2, { operation: 'test', source: 'test', mutate: () => ({ champions: {}, items: {}, runes: {}, decisionTrees: {}, patch: null, verifiedPatch: null, patchStatus: null }) });
  check('same relative drop blocked at 3x scale too (not hardcoded to today\'s numbers)', r2.ok === false && r2.code === 'KV_WRITE_BLOCKED_SUSPICIOUS_DATA_CHANGE', r2);
}

console.log('\n=== 8. Stale revision -> 409 CONFLICT ===');
{
  const kv = makeMockKV();
  const r1 = await S.mutateOverrides(kv, { operation: 'test', source: 'test', mutate: () => bigOverrides(3) });
  check('seed write ok, revision 1', r1.ok && r1.revision === 1, r1);
  const r2 = await S.mutateOverrides(kv, { operation: 'test', source: 'test', clientRevision: 0, mutate: (cur) => ({ ...cur, champions: { ...cur.champions, extra: { tier: 'S' } } }) });
  check('stale clientRevision rejected', r2.ok === false && r2.code === 'REVISION_CONFLICT', r2);
  check('409 http status', r2.httpStatus === 409, r2.httpStatus);
  const read = await S.readOverrides(kv);
  check('live data unchanged by the rejected write', !('extra' in read.overrides.champions), read.overrides.champions);
}

console.log('\n=== 9. Successful mutation -> backup exists ===');
{
  const kv = makeMockKV();
  await S.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => bigOverrides(3) });
  const beforeSecondWrite = await S.readOverrides(kv);
  const r = await S.mutateOverrides(kv, { operation: 'test', source: 'test', mutate: (cur) => ({ ...cur, champions: { ...cur.champions, extra: { tier: 'S' } } }) });
  check('mutation succeeded', r.ok, r);
  check('a backup key was returned', typeof r.backupKey === 'string' && r.backupKey.startsWith(S.BACKUP_PREFIX), r.backupKey);
  const backups = await S.listBackups(kv);
  check('backup is actually listable', backups.some((b) => b.key === r.backupKey), backups.map((b) => b.key));
  const backupRaw = JSON.parse(kv.store.get(r.backupKey));
  check('backup holds the PRE-mutation state (revision 1, no "extra")', backupRaw.data.revision === beforeSecondWrite.overrides.revision && !('extra' in backupRaw.data.champions), backupRaw.data);
  check('backup metadata includes operation/source/checksum/timestamp', backupRaw.operation === 'test' && typeof backupRaw.checksum === 'string' && typeof backupRaw.timestamp === 'string', backupRaw);
}

console.log('\n=== 10. Restore -> current state backed up first ===');
{
  const kv = makeMockKV();
  const seed = await S.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => bigOverrides(3) }); // revision 1
  const oldGoodBackupKey = seed.backupKey; // null (fresh key) -- take a real backup explicitly instead
  const explicitBackup = await S.createBackup(kv, { data: (await S.readOverrides(kv)).overrides, operation: 'manual', source: 'test setup' });
  await S.mutateOverrides(kv, { operation: 'test', source: 'test', mutate: () => ({ champions: {}, items: {}, runes: {}, decisionTrees: {}, patch: null, verifiedPatch: null, patchStatus: null }), force: true }); // revision 2, deliberately emptied

  const beforeRestore = await S.readOverrides(kv);
  check('sanity: current state is the emptied one before restore', !S.overridesHaveContent(beforeRestore.overrides), beforeRestore.overrides);

  const restore = await S.mutateOverrides(kv, { operation: 'restore', source: 'test', mutate: () => JSON.parse(kv.store.get(explicitBackup.key)).data });
  check('restore succeeded', restore.ok, restore);
  check('restored content matches the backup (3 champions back)', Object.keys(restore.overrides.champions).length === 3, restore.overrides.champions);
  check('restore itself created a NEW backup of the (emptied) current state first', typeof restore.backupKey === 'string' && restore.backupKey !== explicitBackup.key, restore.backupKey);
  const preRestoreBackup = JSON.parse(kv.store.get(restore.backupKey));
  check('that new backup holds the EMPTIED state, not the restored one', !S.overridesHaveContent(preRestoreBackup.data), preRestoreBackup.data);
}

console.log('\n=== 11. Corrupted backup -> restore rejected (via the real recovery endpoint) ===');
{
  const kv = makeMockKV();
  await S.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => bigOverrides(3) });
  const goodBackup = await S.createBackup(kv, { data: (await S.readOverrides(kv)).overrides, operation: 'manual', source: 'test' });
  // tamper with the stored backup's data WITHOUT updating its checksum
  const entry = JSON.parse(kv.store.get(goodBackup.key));
  entry.data.champions['injected'] = { tier: 'S' };
  kv.store.set(goodBackup.key, JSON.stringify(entry));

  const { env, cookie } = await adminEnv(kv);
  const res = await backupsPost({ env, request: postReq('https://x/api/admin/coach-overrides-backups', { action: 'restore', backupKey: goodBackup.key }, cookie) });
  const body = await res.json();
  check('restore rejected', res.status !== 200 || body.ok !== true, { status: res.status, body });
  check('rejection identifies backup corruption', body.code === 'BACKUP_CORRUPTED', body.code);
  const stillLive = await S.readOverrides(kv);
  check('live data was never touched by the rejected restore', !('injected' in stillLive.overrides.champions), stillLive.overrides.champions);
}

console.log('\n=== 12. Processing failure mid-mutation -> existing KV untouched (models an AI/patch-processing failure) ===');
{
  const kv = makeMockKV();
  await S.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => bigOverrides(5) });
  const before = kv.store.get(S.KEY);
  const r = await S.mutateOverrides(kv, {
    operation: 'patch-intel-write', source: 'test (simulated patch processing failure)',
    mutate: () => { throw new Error('simulated: AI/API call failed mid-processing'); },
  });
  check('mutation reports failure', r.ok === false && r.code === 'MUTATE_FAILED', r);
  check('live data completely untouched', kv.store.get(S.KEY) === before, true);
}

console.log('\n=== 13. Two concurrent updates -> one is rejected, not silently overwritten ===');
{
  const kv = makeMockKV();
  await S.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => bigOverrides(3) }); // revision 1
  const baseRevision = (await S.readOverrides(kv)).overrides.revision;

  // Two "clients" both read at revision 1, then both try to write
  // DIFFERENT changes built on that same base.
  const writeA = await S.mutateOverrides(kv, { operation: 'test', source: 'client-A', clientRevision: baseRevision, mutate: (cur) => ({ ...cur, champions: { ...cur.champions, fromA: { tier: 'S' } } }) });
  const writeB = await S.mutateOverrides(kv, { operation: 'test', source: 'client-B', clientRevision: baseRevision, mutate: (cur) => ({ ...cur, champions: { ...cur.champions, fromB: { tier: 'A' } } }) });

  check('first writer (A) succeeds', writeA.ok === true, writeA);
  check('second writer (B), now stale, is rejected rather than silently overwriting A', writeB.ok === false && writeB.code === 'REVISION_CONFLICT', writeB);
  const final = await S.readOverrides(kv);
  check("A's change is live", 'fromA' in final.overrides.champions, final.overrides.champions);
  check("B's change did NOT silently land", !('fromB' in final.overrides.champions), final.overrides.champions);
}

console.log('\n=== 14. Stale-localStorage client cannot overwrite newer server state (through the real /api/coach-overrides handler) ===');
{
  const kv = makeMockKV();
  const { env, cookie } = await adminEnv(kv);
  await coachPost({ env, request: postReq('https://x/api/coach-overrides', { overrides: { champions: { leona: { tier: 'S' } }, items: {}, runes: {}, decisionTrees: {} } }, cookie) }); // revision 1
  const g1 = await coachGet({ env });
  const revAfterFirstSave = (await g1.json()).overrides.revision;

  // Someone else's device saves next (server moves to revision 2) while
  // a stale client is still holding revision 1 in memory (its
  // localStorage-cached copy from before this second save happened).
  await coachPost({ env, request: postReq('https://x/api/coach-overrides', { overrides: { champions: { leona: { tier: 'S' }, nautilus: { tier: 'A' } }, items: {}, runes: {}, decisionTrees: {} } }, cookie) }); // revision 2

  // The stale client now tries to save, still believing it's revision 1.
  const staleRes = await coachPost({ env, request: postReq('https://x/api/coach-overrides', { overrides: { champions: { leona: { tier: 'B' } }, items: {}, runes: {}, decisionTrees: {} }, clientRevision: revAfterFirstSave }, cookie) });
  const staleBody = await staleRes.json();
  check('stale client write rejected with 409', staleRes.status === 409 && staleBody.code === 'REVISION_CONFLICT', { status: staleRes.status, body: staleBody });

  const finalRes = await coachGet({ env });
  const finalBody = await finalRes.json();
  check('live data still reflects the newer (2nd) save, not the stale client\'s overwrite', finalBody.overrides.champions.nautilus?.tier === 'A' && finalBody.overrides.champions.leona?.tier === 'S', finalBody.overrides.champions);
}

// =====================================================================
// Beyond the 14 mandated scenarios: emergency read-only mode, and the
// two real write paths (Coach Mode save, Patch Intelligence publish)
// actually going through this layer end-to-end.
console.log('\n=== 15. Emergency read-only mode: auto-trips after repeated read failures, blocks writes, restore is the escape hatch ===');
{
  const kv = makeMockKV();
  await S.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => bigOverrides(3) });
  const backupForLater = await S.createBackup(kv, { data: (await S.readOverrides(kv)).overrides, operation: 'manual', source: 'test' });

  kv.__failGet = true;
  for (let i = 0; i < 3; i++) await S.readOverrides(kv); // 3 consecutive failures trips it
  kv.__failGet = false;

  const ro = await S.isReadOnlyMode(kv);
  check('read-only mode auto-tripped after repeated read failures', ro.active === true, ro);

  const blocked = await S.mutateOverrides(kv, { operation: 'test', source: 'test', mutate: (cur) => ({ ...cur, champions: { ...cur.champions, x: { tier: 'S' } } }) });
  check('an ordinary mutation is blocked while read-only mode is active', blocked.ok === false && blocked.code === 'SAFE_MODE_ACTIVE', blocked);

  const restoreDuringRO = await S.mutateOverrides(kv, { operation: 'restore', source: 'test', allowDuringReadOnly: true, mutate: () => JSON.parse(kv.store.get(backupForLater.key)).data });
  check('restore (allowDuringReadOnly) still works while tripped -- the escape hatch', restoreDuringRO.ok === true, restoreDuringRO);

  const { env, cookie } = await adminEnv(kv);
  const clearRes = await backupsPost({ env, request: postReq('https://x/api/admin/coach-overrides-backups', { action: 'clear-readonly' }, cookie) });
  check('admin can clear read-only mode via the recovery endpoint', clearRes.status === 200, clearRes.status);
  const roAfter = await S.isReadOnlyMode(kv);
  check('read-only mode is now off', roAfter.active === false, roAfter);
  const normalAfter = await S.mutateOverrides(kv, { operation: 'test', source: 'test', mutate: (cur) => ({ ...cur, champions: { ...cur.champions, y: { tier: 'A' } } }) });
  check('ordinary mutations work again after clearing', normalAfter.ok === true, normalAfter);
}

console.log('\n=== 16. End-to-end: Coach Mode save is backed up, revisioned, and audited through the real handler ===');
{
  const kv = makeMockKV();
  const { env, cookie } = await adminEnv(kv);
  const res = await coachPost({ env, request: postReq('https://x/api/coach-overrides', { overrides: { champions: { leona: { tier: 'S' } }, items: {}, runes: {}, decisionTrees: {} } }, cookie) });
  const body = await res.json();
  check('save succeeds and reports the new revision', res.status === 200 && body.ok === true && body.revision === 1, body);
  const audit = await S.getAuditLog(kv);
  check('an ACCEPTED audit record exists for it', audit.some((a) => a.result === 'ACCEPTED' && a.operation === 'coach-save'), audit);
}

console.log('\n=== 17. End-to-end: Patch Intelligence publish updates patch fields via the safety layer, blocked publish leaves KV untouched ===');
{
  const kv = makeMockKV();
  await S.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => bigOverrides(3) }); // real Coach Mode content present
  const { env, cookie } = await adminEnv(kv);
  await saveNewReport(kv, { id: 'wr-7-9', patch: '7.9', status: 'pending_review', supportMetaAnalysis: 'x', championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [], recommendedTierChanges: [], entityVerdicts: [] });

  const unapproved = await reportsPost({ env, request: postReq('https://x/api/admin/patch-reports', { id: 'wr-7-9', action: 'publish' }, cookie) });
  check('publish without approval still rejected (approval gate preserved)', unapproved.status === 409, unapproved.status);
  const stillOld = await S.readOverrides(kv);
  check('coach-overrides untouched by the rejected publish', stillOld.overrides.patch === '7.2', stillOld.overrides.patch);

  await reportsPost({ env, request: postReq('https://x/api/admin/patch-reports', { id: 'wr-7-9', action: 'approve' }, cookie) });
  const published = await reportsPost({ env, request: postReq('https://x/api/admin/patch-reports', { id: 'wr-7-9', action: 'publish' }, cookie) });
  const publishedBody = await published.json();
  check('publish succeeds once approved', published.status === 200 && publishedBody.ok === true, publishedBody);
  const after = await S.readOverrides(kv);
  check('patch/verifiedPatch updated to 7.9', after.overrides.patch === '7.9' && after.overrides.verifiedPatch === '7.9', after.overrides);
  check('champion content from before publish is completely untouched', Object.keys(after.overrides.champions).length === 3, after.overrides.champions);
  check('revision advanced (publish went through mutateOverrides, not a raw put)', after.overrides.revision === 2, after.overrides.revision);
}

console.log('\n=== 18. GET /api/admin/coach-overrides-backups reports status, backups, and audit together ===');
{
  const kv = makeMockKV();
  await S.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => bigOverrides(3) });
  await S.mutateOverrides(kv, { operation: 'test', source: 'test', mutate: (cur) => ({ ...cur, champions: { ...cur.champions, extra: { tier: 'S' } } }) });
  const { env, cookie } = await adminEnv(kv);
  const res = await backupsGet({ env, request: new Request('https://x/api/admin/coach-overrides-backups', { headers: { Cookie: cookie } }) });
  const body = await res.json();
  check('reports current revision/size/checksum', body.current.revision === 2 && typeof body.current.size === 'number' && typeof body.current.checksum === 'string', body.current);
  check('lists at least one backup', Array.isArray(body.backups) && body.backups.length >= 1, body.backups);
  check('includes recent audit entries', Array.isArray(body.recentAudit) && body.recentAudit.length >= 2, body.recentAudit?.length);
  check('reports read-only status', body.readOnly && body.readOnly.active === false, body.readOnly);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
