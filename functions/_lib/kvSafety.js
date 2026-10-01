// KV Data Protection / Safety Layer for the `coach-overrides` key.
//
// Built after a real incident where a transient KV read failure got
// silently treated as "no data" and written back over live Coach Mode
// content. Every write to `coach-overrides` -- Coach Mode saves, Patch
// Intelligence publish, admin restore -- must go through mutateOverrides()
// below instead of calling kv.put() directly. Nothing in this file makes
// a production write on its own; it only runs when something else calls
// it with a real KV binding.
//
// Five things this file guarantees, together:
//   1. A read failure is never treated as "empty" (readOverrides()).
//   2. Every successful write is preceded by an immutable backup of
//      whatever was there before (createBackup()).
//   3. A write that would drop most of the data is blocked outright,
//      not guessed at (assessDestructiveChange()).
//   4. A stale client can't silently clobber a newer write (revision +
//      clientRevision check in mutateOverrides()).
//   5. Every attempt -- accepted, blocked, or failed -- leaves a
//      structured audit record (writeAudit()).
//
// This module knows nothing about HTTP, sessions, or the admin UI --
// callers (functions/api/coach-overrides.js, functions/api/admin/
// patch-reports.js, functions/api/admin/coach-overrides-backups.js)
// translate its results into responses.

export const KEY = "coach-overrides";
export const BACKUP_PREFIX = "coach-overrides-backup:";
export const AUDIT_PREFIX = "coach-overrides-audit:";
const FAIL_MARKER_PREFIX = "coach-overrides-fail:";
const READONLY_FLAG_KEY = "coach-overrides-safety-mode";

// Consecutive KV read failures (across separate requests -- Workers have
// no durable in-memory state between requests, so this counter is itself
// stored in KV) before emergency read-only mode trips automatically.
const READ_FAILURE_TRIP_THRESHOLD = 3;

// The exact five states requested: only KEY_NOT_FOUND may ever be treated
// as "safe to initialize empty" -- every other state means the caller
// cannot tell what's actually live, and must abort rather than guess.
export const READ_STATUS = Object.freeze({
  VALID_DATA: "VALID_DATA",
  KEY_NOT_FOUND: "KEY_NOT_FOUND",
  KV_READ_FAILED: "KV_READ_FAILED",
  KV_DATA_INVALID: "KV_DATA_INVALID",
  KV_UNAVAILABLE: "KV_UNAVAILABLE",
});

// The one canonical "nothing here yet" shape. Every reader/writer uses
// this exact object so a fresh key never comes back missing a field --
// revision/updatedAt are new fields added by this safety layer; every
// other field matches functions/_lib/kv.js's EMPTY_OVERRIDES exactly, so
// this is additive to the existing data model, not a replacement of it.
export const EMPTY_OVERRIDES = Object.freeze({
  champions: {}, items: {}, runes: {}, decisionTrees: {},
  patch: null, verifiedPatch: null, patchStatus: null,
  revision: 0, updatedAt: null,
});

const CONTENT_MAPS = ["champions", "items", "runes", "decisionTrees"];

// ---------------------------------------------------------------------
// Checksums. Web Crypto (crypto.subtle) is available both in the real
// Cloudflare Workers runtime and in plain Node 19+ (which is what the
// test suite runs under) -- same code path in tests and production, no
// environment branching.
export async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function byteSize(str) {
  return new TextEncoder().encode(str).length;
}

function mapEntryCount(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).length : 0;
}

/** { champions, items, runes, decisionTrees } entry counts for one overrides object. */
export function entityCounts(overrides) {
  const out = {};
  for (const k of CONTENT_MAPS) out[k] = mapEntryCount(overrides && overrides[k]);
  return out;
}

/** True when any of the four content maps holds at least one entry.
 *  patch/verifiedPatch/patchStatus/revision/updatedAt are deliberately
 *  NOT counted -- "only the patch fields survived" must read as EMPTY. */
export function overridesHaveContent(overrides) {
  return CONTENT_MAPS.some((k) => mapEntryCount(overrides && overrides[k]) > 0);
}

// ---------------------------------------------------------------------
// STRICT READ. Never throws, never substitutes an empty object for a
// state that isn't actually "empty". Also maintains the consecutive-
// failure counter that can trip emergency read-only mode (see below).
export async function readOverrides(kv) {
  if (!kv) return { status: READ_STATUS.KV_UNAVAILABLE, overrides: null, raw: null, error: "COACH_KV binding is not available." };
  let raw;
  try {
    raw = await kv.get(KEY);
  } catch (err) {
    await bumpFailureCounter(kv);
    return { status: READ_STATUS.KV_READ_FAILED, overrides: null, raw: null, error: `KV read failed: ${err && err.message ? err.message : String(err)}` };
  }
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    await resetFailureCounter(kv);
    return { status: READ_STATUS.KEY_NOT_FOUND, overrides: null, raw: null, error: `KV key "${KEY}" is missing or blank.` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    await bumpFailureCounter(kv);
    return { status: READ_STATUS.KV_DATA_INVALID, overrides: null, raw, error: `KV key "${KEY}" is not valid JSON: ${err && err.message ? err.message : String(err)}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    await bumpFailureCounter(kv);
    return { status: READ_STATUS.KV_DATA_INVALID, overrides: null, raw, error: `KV key "${KEY}" parsed, but is not a JSON object.` };
  }
  await resetFailureCounter(kv);
  return { status: READ_STATUS.VALID_DATA, overrides: parsed, raw, error: null };
}

// Best-effort consecutive-failure tracking. Deliberately does NOT read
// a counter to increment it -- if kv.get() is the thing that's failing
// (the exact situation this exists to detect), a bump mechanism that
// itself needs a successful get() first would never fire. Instead each
// failure drops a new marker key (a plain put(), no read involved) and
// counts how many exist via list(); a success clears them all. Put/
// list/delete failing too (a total outage) just means this heuristic
// can't fire -- the caller's own real read result is never affected
// either way, and that's the guarantee that actually matters.
async function bumpFailureCounter(kv) {
  try {
    await kv.put(`${FAIL_MARKER_PREFIX}${Date.now()}-${crypto.randomUUID().slice(0, 8)}`, "1");
    const page = await kv.list({ prefix: FAIL_MARKER_PREFIX, limit: READ_FAILURE_TRIP_THRESHOLD + 10 });
    const n = (page.keys || []).length;
    if (n >= READ_FAILURE_TRIP_THRESHOLD) {
      await tripReadOnlyMode(kv, `${n} consecutive KV read failures on "${KEY}".`);
    }
  } catch { /* best-effort only */ }
}
async function resetFailureCounter(kv) {
  try {
    const page = await kv.list({ prefix: FAIL_MARKER_PREFIX, limit: 1000 });
    for (const entry of page.keys || []) {
      try { await kv.delete(entry.name); } catch { /* best-effort */ }
    }
  } catch { /* best-effort only */ }
}

// ---------------------------------------------------------------------
// SHAPE VALIDATION. Checked on both the current value (defense in depth
// -- a read that parsed as JSON but drifted from the expected shape
// should still be caught) and the proposed next value (before it's ever
// written).
export function validateShape(overrides) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return { ok: false, error: "Overrides value is not a JSON object." };
  }
  for (const key of CONTENT_MAPS) {
    const v = overrides[key];
    if (v !== undefined && (typeof v !== "object" || v === null || Array.isArray(v))) {
      return { ok: false, error: `"${key}" must be an object (got ${Array.isArray(v) ? "array" : typeof v}).` };
    }
  }
  for (const key of ["patch", "verifiedPatch", "patchStatus"]) {
    const v = overrides[key];
    if (v !== undefined && v !== null && typeof v !== "string") {
      return { ok: false, error: `"${key}" must be a string or null (got ${typeof v}).` };
    }
  }
  if (overrides.revision !== undefined && (typeof overrides.revision !== "number" || !Number.isFinite(overrides.revision) || overrides.revision < 0)) {
    return { ok: false, error: `"revision" must be a non-negative number (got ${typeof overrides.revision}).` };
  }
  return { ok: true, error: null };
}

// ---------------------------------------------------------------------
// DESTRUCTIVE-CHANGE DETECTION. Relative to the PREVIOUS value, never
// hardcoded -- so this keeps working as the Academy grows. Two
// independent signals: overall byte size (catches a write that keeps
// every top-level key but wipes what's nested inside them -- builds,
// matchup relations, decision-tree entries) and per-category entity
// count (catches a write that drops whole champions/items/runes/
// decisionTrees entries even if the byte size happens to land in range,
// e.g. many short entries replaced by few long ones). Either one
// tripping is enough to block.
const SIZE_DROP_RATIO = 0.5;      // new must be < 50% of previous to flag
const SIZE_FLOOR_BYTES = 500;     // below this, previous was already trivial -- nothing meaningful to lose
const COUNT_DROP_RATIO = 0.5;     // new count must be < 50% of previous to flag
const COUNT_FLOOR = 3;            // below this, previous had too few entries for a ratio to mean anything

export function assessDestructiveChange(previousOverrides, nextOverrides) {
  const previousJson = JSON.stringify(previousOverrides ?? {});
  const nextJson = JSON.stringify(nextOverrides ?? {});
  const previousSize = byteSize(previousJson);
  const newSize = byteSize(nextJson);
  const previousCounts = entityCounts(previousOverrides);
  const newCounts = entityCounts(nextOverrides);

  const reasons = [];
  if (previousSize >= SIZE_FLOOR_BYTES && newSize < previousSize * SIZE_DROP_RATIO) {
    reasons.push(`overall size dropped from ${previousSize} to ${newSize} bytes (more than ${Math.round((1 - SIZE_DROP_RATIO) * 100)}% smaller).`);
  }
  for (const key of CONTENT_MAPS) {
    const prev = previousCounts[key];
    const next = newCounts[key];
    if (prev >= COUNT_FLOOR && next < prev * COUNT_DROP_RATIO) {
      reasons.push(`"${key}" dropped from ${prev} to ${next} entries (more than ${Math.round((1 - COUNT_DROP_RATIO) * 100)}% smaller).`);
    }
  }
  return { blocked: reasons.length > 0, reasons, previousSize, newSize, previousCounts, newCounts };
}

// ---------------------------------------------------------------------
// BACKUPS. Stored under coach-overrides-backup:<epoch-ms>-<random>, the
// full previous value plus metadata, using KV's own `metadata` option so
// listBackups() can show every backup's timestamp/operation/size/
// checksum from ONE list() call -- no need to fetch each backup's full
// body just to list them.
export async function createBackup(kv, { data, operation, source, previousRevision }) {
  const json = JSON.stringify(data);
  const checksum = await sha256Hex(json);
  const timestamp = new Date().toISOString();
  const meta = { timestamp, operation, source: source || null, previousRevision: previousRevision ?? null, checksum, size: byteSize(json) };

  // "Never overwrite an existing backup key" -- the epoch-ms+random
  // suffix already makes a collision astronomically unlikely, but this
  // loop is the actual guarantee, not the randomness.
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const key = `${BACKUP_PREFIX}${suffix}`;
    const existing = await kv.get(key);
    if (existing !== null && existing !== undefined) continue; // extremely unlikely, but honor "never overwrite" literally
    await kv.put(key, JSON.stringify({ ...meta, data }), { metadata: meta });
    return { key, ...meta };
  }
  throw new Error("Could not allocate a unique backup key after 5 attempts.");
}

/** Cheap listing via KV metadata -- does not fetch each backup's full
 *  body. Newest first. */
export async function listBackups(kv, { limit = 50 } = {}) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: BACKUP_PREFIX, cursor, limit: Math.min(limit, 1000) });
    for (const entry of page.keys || []) {
      out.push({ key: entry.name, ...(entry.metadata || {}) });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && out.length < limit);
  out.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  return out.slice(0, limit);
}

/** Prune backups beyond the retention count, oldest first. Best-effort
 *  and NEVER touches the single newest backup -- called only after a
 *  new backup already exists, so "don't delete the newest before a
 *  newer one exists" is satisfied by construction (prune runs strictly
 *  after createBackup returns). A pruning failure never affects the
 *  mutation's own result. */
const BACKUP_RETENTION_COUNT = 30;
export async function pruneOldBackups(kv, { keep = BACKUP_RETENTION_COUNT } = {}) {
  try {
    const all = await listBackups(kv, { limit: 1000 });
    if (all.length <= keep) return { pruned: 0 };
    const toRemove = all.slice(keep); // listBackups is newest-first; this is everything past the retention count
    for (const entry of toRemove) {
      try { await kv.delete(entry.key); } catch { /* best-effort */ }
    }
    return { pruned: toRemove.length };
  } catch {
    return { pruned: 0 };
  }
}

// ---------------------------------------------------------------------
// AUDIT LOG. One record per mutation ATTEMPT, accepted or not -- this is
// how "what tried to modify my KV, and why was it accepted or rejected"
// gets answered later. Best-effort: a logging failure is swallowed here
// (never turns a real mutation result into a failure) but every write
// path that calls this already returned its own real result to the
// caller by this point.
export async function writeAudit(kv, record) {
  try {
    const timestamp = new Date().toISOString();
    const key = `${AUDIT_PREFIX}${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const full = { timestamp, ...record };
    await kv.put(key, JSON.stringify(full), { metadata: full });
  } catch { /* best-effort -- see comment above */ }
}

const AUDIT_RETENTION_COUNT = 200;
export async function pruneOldAudit(kv, { keep = AUDIT_RETENTION_COUNT } = {}) {
  try {
    const all = await getAuditLog(kv, { limit: 1000 });
    if (all.length <= keep) return { pruned: 0 };
    for (const entry of all.slice(keep)) {
      try { await kv.delete(entry.key); } catch { /* best-effort */ }
    }
    return { pruned: all.length - keep };
  } catch {
    return { pruned: 0 };
  }
}

export async function getAuditLog(kv, { limit = 50 } = {}) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: AUDIT_PREFIX, cursor, limit: Math.min(limit, 1000) });
    for (const entry of page.keys || []) out.push({ key: entry.name, ...(entry.metadata || {}) });
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && out.length < limit);
  out.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  return out.slice(0, limit);
}

// ---------------------------------------------------------------------
// EMERGENCY READ-ONLY MODE. A flag stored in KV itself (checked by
// every mutation path via mutateOverrides). Reading the flag fails OPEN
// (an unreadable flag is treated as "not tripped") so a KV hiccup on
// this ONE key can't brick every write forever -- the actual live data
// is still protected by readOverrides()'s own strict states regardless
// of this flag. Writing to coach-overrides itself only ever fails
// CLOSED, via that separate mechanism.
export async function isReadOnlyMode(kv) {
  try {
    const raw = await kv.get(READONLY_FLAG_KEY);
    if (!raw) return { active: false, reason: null, since: null };
    const parsed = JSON.parse(raw);
    return { active: Boolean(parsed && parsed.active), reason: parsed?.reason ?? null, since: parsed?.since ?? null };
  } catch {
    return { active: false, reason: null, since: null };
  }
}

export async function tripReadOnlyMode(kv, reason) {
  try {
    await kv.put(READONLY_FLAG_KEY, JSON.stringify({ active: true, reason, since: new Date().toISOString() }));
  } catch { /* best-effort -- if we can't even write the flag, the individual mutation's own checks still protect the data */ }
}

export async function clearReadOnlyMode(kv, actor) {
  try {
    await kv.put(READONLY_FLAG_KEY, JSON.stringify({ active: false, reason: null, since: null, clearedBy: actor || null, clearedAt: new Date().toISOString() }));
    await resetFailureCounter(kv);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// THE ATOMIC MUTATION SEQUENCE.
//
//   read current -> verify read -> validate current -> create backup ->
//   apply change -> validate result -> check destructive change ->
//   write -> verify write
//
// Any step failing means NO WRITE and a clear error -- this function
// either returns { ok: true, ... } after a real, verified write, or
// { ok: false, code, error, httpStatus } having written nothing.
//
// `mutate` is a pure function (current) => next, where `current` is
// EMPTY_OVERRIDES for a brand-new key (KEY_NOT_FOUND) or the parsed
// current value otherwise. It must not have side effects -- it may run
// zero or one times per call, never more.
//
// `clientRevision`, if passed, must equal the CURRENT revision or the
// mutation is rejected with a 409 CONFLICT and nothing is written --
// this is the stale-client protection. Omit it (undefined) to skip the
// check entirely (used by server-internal mutations like Patch
// Intelligence publish, which read-then-write within one request and
// have no separate client revision to compare).
//
// `allowDuringReadOnly` is the one escape hatch for admin restore, so a
// tripped safety mode doesn't lock out the one operation that fixes it.
export async function mutateOverrides(kv, { operation, source, mutate, clientRevision, force = false, allowDuringReadOnly = false }) {
  if (!kv) return fail("KV_UNAVAILABLE", "COACH_KV binding is not available.", 503);

  if (!allowDuringReadOnly) {
    const ro = await isReadOnlyMode(kv);
    if (ro.active) return fail("SAFE_MODE_ACTIVE", `Coach Mode data is in emergency read-only mode: ${ro.reason || "a prior safety check failed"}. An admin must clear this from the recovery panel before further edits are accepted.`, 503);
  }

  // 1. READ CURRENT KV / 2. VERIFY READ SUCCESS
  const read = await readOverrides(kv);
  let current;
  if (read.status === READ_STATUS.VALID_DATA) {
    current = read.overrides;
  } else if (read.status === READ_STATUS.KEY_NOT_FOUND) {
    current = { ...EMPTY_OVERRIDES }; // the one case allowed to initialize empty
  } else {
    await writeAudit(kv, auditRecord({ operation, source, result: "REJECTED", failureReason: `read failed: ${read.status}`, previousRevision: null, newRevision: null, previousSize: null, newSize: null, previousChecksum: null, newChecksum: null }));
    return fail(read.status, read.error, read.status === READ_STATUS.KV_DATA_INVALID ? 409 : 503);
  }

  // 3. VALIDATE CURRENT DATA
  const currentShape = validateShape(current);
  if (!currentShape.ok) {
    await writeAudit(kv, auditRecord({ operation, source, result: "REJECTED", failureReason: `current data failed shape validation: ${currentShape.error}`, previousRevision: current.revision ?? null }));
    return fail("KV_DATA_INVALID", `Live data failed validation, refusing to build on it: ${currentShape.error}`, 409);
  }

  // Optimistic concurrency -- stale client protection.
  if (clientRevision !== undefined && clientRevision !== (current.revision ?? 0)) {
    await writeAudit(kv, auditRecord({ operation, source, result: "CONFLICT", failureReason: `clientRevision ${clientRevision} != current revision ${current.revision ?? 0}`, previousRevision: current.revision ?? 0 }));
    return fail("REVISION_CONFLICT", `Someone else's change was saved first (server is at revision ${current.revision ?? 0}, you had ${clientRevision}). Refresh and reapply your edit.`, 409);
  }

  const previousJson = JSON.stringify(current);
  const previousChecksum = await sha256Hex(previousJson);

  // 4. CREATE BACKUP -- skipped only for a genuinely brand-new key
  // (nothing to back up), never skipped otherwise. A backup failure
  // aborts the whole mutation -- no write happens without one.
  let backupKey = null;
  if (read.status === READ_STATUS.VALID_DATA) {
    try {
      const backup = await createBackup(kv, { data: current, operation, source, previousRevision: current.revision ?? null });
      backupKey = backup.key;
      pruneOldBackups(kv).catch(() => {}); // best-effort, never awaited into the critical path's failure mode
    } catch (err) {
      await writeAudit(kv, auditRecord({ operation, source, result: "REJECTED", failureReason: `backup creation failed: ${err && err.message ? err.message : String(err)}`, previousRevision: current.revision ?? 0 }));
      return fail("BACKUP_FAILED", "Could not create a safety backup before writing -- nothing was changed.", 503);
    }
  }

  // 5. APPLY INTENDED CHANGE
  let next;
  try {
    next = await mutate(current);
  } catch (err) {
    await writeAudit(kv, auditRecord({ operation, source, result: "REJECTED", failureReason: `mutate() threw: ${err && err.message ? err.message : String(err)}`, previousRevision: current.revision ?? 0 }));
    return fail("MUTATE_FAILED", `Building the new value failed: ${err && err.message ? err.message : String(err)}`, 500);
  }
  if (!next || typeof next !== "object") {
    await writeAudit(kv, auditRecord({ operation, source, result: "REJECTED", failureReason: "mutate() did not return an object", previousRevision: current.revision ?? 0 }));
    return fail("MUTATE_FAILED", "Building the new value produced nothing usable -- nothing was changed.", 500);
  }

  // 6. VALIDATE RESULT
  const nextShape = validateShape(next);
  if (!nextShape.ok) {
    await writeAudit(kv, auditRecord({ operation, source, result: "REJECTED", failureReason: `proposed data failed shape validation: ${nextShape.error}`, previousRevision: current.revision ?? 0 }));
    return fail("INVALID_PAYLOAD", nextShape.error, 400);
  }

  // 7. CHECK FOR DESTRUCTIVE CHANGE
  const assessment = assessDestructiveChange(current, next);
  if (assessment.blocked && !force) {
    await writeAudit(kv, auditRecord({
      operation, source, result: "BLOCKED", failureReason: `suspicious data reduction: ${assessment.reasons.join(" ")}`,
      previousRevision: current.revision ?? 0, previousSize: assessment.previousSize, newSize: assessment.newSize, previousChecksum,
    }));
    return fail("KV_WRITE_BLOCKED_SUSPICIOUS_DATA_CHANGE", `Refusing to write: ${assessment.reasons.join(" ")} If this reduction is intentional, it must be confirmed explicitly (force).`, 409, { assessment });
  }

  const revision = (current.revision ?? 0) + 1;
  const updatedAt = new Date().toISOString();
  const toWrite = { ...next, revision, updatedAt };
  const newJson = JSON.stringify(toWrite);
  const newChecksum = await sha256Hex(newJson);

  // 8. WRITE NEW KV
  try {
    await kv.put(KEY, newJson);
  } catch (err) {
    await writeAudit(kv, auditRecord({
      operation, source, result: "REJECTED", failureReason: `kv.put failed: ${err && err.message ? err.message : String(err)}`,
      previousRevision: current.revision ?? 0, newRevision: null, previousSize: assessment.previousSize, newSize: assessment.newSize, previousChecksum, newChecksum,
    }));
    return fail("KV_WRITE_FAILED", "The write to KV itself failed (quota or outage) -- nothing was changed.", 503);
  }

  // 9. VERIFY WRITE / RESULT -- best-effort read-back. A mismatch here
  // is reported (verified: false) but the write itself already
  // succeeded (kv.put didn't throw), so this does not undo it -- real
  // Cloudflare KV is eventually consistent at the edge, so a strict
  // read-after-write check would produce false negatives under normal
  // operation. This is a diagnostic, not a second gate.
  let verified = false;
  try {
    const readBack = await kv.get(KEY);
    verified = readBack === newJson;
  } catch { /* best-effort */ }

  await writeAudit(kv, auditRecord({
    operation, source, result: "ACCEPTED", failureReason: null,
    previousRevision: current.revision ?? 0, newRevision: revision,
    previousSize: assessment.previousSize, newSize: assessment.newSize, previousChecksum, newChecksum,
  }));

  return { ok: true, overrides: toWrite, revision, backupKey, verified, assessment };
}

function auditRecord(fields) {
  return { previousRevision: null, newRevision: null, previousSize: null, newSize: null, previousChecksum: null, newChecksum: null, ...fields };
}

function fail(code, error, httpStatus, extra) {
  return { ok: false, code, error, httpStatus, ...(extra || {}) };
}
