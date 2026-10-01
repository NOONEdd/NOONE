// Cloudflare Pages Function — /api/admin/coach-overrides-backups
//
// The Admin-facing half of the KV Data Protection / Safety Layer
// (functions/_lib/kvSafety.js). Everything here is read-only against
// live Coach Mode data EXCEPT the "restore" action, which itself goes
// through mutateOverrides() -- meaning a restore backs up whatever is
// currently live before writing the selected backup over it, exactly
// like every other mutation in this codebase. Nothing here bypasses
// that safety layer.
//
// GET  -> { revision, size, checksum, updatedAt, readOnly, lastBackup,
//           backups: [...], recentAudit: [...] }
// POST -> { action: "restore", backupKey, force? }
//           restores that backup over the current value.
//         { action: "clear-readonly" }
//           clears emergency read-only mode after an admin has
//           confirmed the underlying problem is resolved.

import { requireAdminSession } from "../../_lib/adminAuth.js";
import {
  readOverrides, mutateOverrides, listBackups, getAuditLog,
  isReadOnlyMode, clearReadOnlyMode, sha256Hex, READ_STATUS, KEY,
} from "../../_lib/kvSafety.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

export async function onRequestGet(context) {
  const kv = context.env.COACH_KV;
  if (!kv) return json({ error: "COACH_KV binding not set up yet." }, 500);
  if (!(await requireAdminSession(context))) return json({ error: "Not authenticated." }, 401);

  const [read, backups, recentAudit, readOnly] = await Promise.all([
    readOverrides(kv),
    listBackups(kv, { limit: 30 }),
    getAuditLog(kv, { limit: 30 }),
    isReadOnlyMode(kv),
  ]);

  let current = null;
  if (read.status === READ_STATUS.VALID_DATA) {
    const json_ = JSON.stringify(read.overrides);
    current = {
      status: read.status,
      revision: read.overrides.revision ?? 0,
      updatedAt: read.overrides.updatedAt ?? null,
      size: new TextEncoder().encode(json_).length,
      checksum: await sha256Hex(json_),
    };
  } else {
    current = { status: read.status, revision: null, updatedAt: null, size: null, checksum: null, error: read.error };
  }

  return json({
    key: KEY,
    current,
    readOnly,
    lastBackup: backups[0] || null,
    backups,
    recentAudit,
  });
}

export async function onRequestPost(context) {
  const kv = context.env.COACH_KV;
  if (!kv) return json({ error: "COACH_KV binding not set up yet." }, 500);
  if (!(await requireAdminSession(context))) return json({ error: "Not authenticated." }, 401);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { action } = body || {};

  if (action === "clear-readonly") {
    const ok = await clearReadOnlyMode(kv, "admin");
    if (!ok) return json({ error: "Could not clear read-only mode (KV write failed)." }, 503);
    return json({ ok: true });
  }

  if (action === "restore") {
    const { backupKey, force } = body || {};
    if (!backupKey || typeof backupKey !== "string") {
      return json({ error: "Missing backupKey." }, 400);
    }

    // Read the backup entry itself and verify ITS OWN checksum before
    // ever proposing it as the new live value -- a corrupted or
    // tampered backup must never be restorable, per the safety spec.
    let raw;
    try {
      raw = await kv.get(backupKey);
    } catch (err) {
      return json({ error: `Could not read that backup: ${err && err.message ? err.message : String(err)}` }, 503);
    }
    if (!raw) return json({ error: "That backup no longer exists." }, 404);
    let entry;
    try {
      entry = JSON.parse(raw);
    } catch {
      return json({ error: "That backup's own record is not valid JSON -- refusing to restore a corrupted backup.", code: "BACKUP_CORRUPTED" }, 409);
    }
    if (!entry || typeof entry !== "object" || !entry.data || typeof entry.checksum !== "string") {
      return json({ error: "That backup's record is missing its data or checksum -- refusing to restore a corrupted backup.", code: "BACKUP_CORRUPTED" }, 409);
    }
    const actualChecksum = await sha256Hex(JSON.stringify(entry.data));
    if (actualChecksum !== entry.checksum) {
      return json({ error: `That backup is corrupted: its stored checksum (${entry.checksum.slice(0, 12)}…) does not match its actual content (${actualChecksum.slice(0, 12)}…). Refusing to restore it.`, code: "BACKUP_CORRUPTED" }, 409);
    }

    // Restoring goes through the exact same atomic sequence as every
    // other mutation -- including backing up whatever is CURRENTLY
    // live before writing the restored value over it (Requirement 8:
    // "restoring must itself create a backup of the current state
    // first"). allowDuringReadOnly: true is the one deliberate escape
    // hatch -- restore is how an admin gets OUT of emergency read-only
    // mode, so it can't itself be blocked by that mode.
    const result = await mutateOverrides(kv, {
      operation: "restore",
      source: `POST /api/admin/coach-overrides-backups (from ${backupKey})`,
      force: Boolean(force),
      allowDuringReadOnly: true,
      mutate: () => entry.data,
    });

    if (!result.ok) {
      return json({ error: result.error, code: result.code, ...(result.assessment ? { assessment: result.assessment } : {}) }, result.httpStatus || 500);
    }
    return json({ ok: true, revision: result.revision, restoredFrom: backupKey, backupOfPreviousState: result.backupKey });
  }

  return json({ error: `Unknown action "${action}". Expected "restore" or "clear-readonly".` }, 400);
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
