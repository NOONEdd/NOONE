// Patch Notes -- remembered classification rules ("Remember for future patches").
//
// ONE small JSON document in the existing COACH_KV namespace, next to the other patch-intel:* keys (no new store):
//   patch-intel:classification-rules  { version: 1, revision, updatedAt, rules: { [ruleKey]: rule } }
//   rule = { key, type, name, status: "IN_ACADEMY", academyId|null, sourcePatch, sourceSectionKey, createdAt, updatedAt, forgottenAt|null }
//
// IDENTITY: ruleKey = "<type>:<normalized Riot name>" -- exactly src/lib/patchNotesClassification.js sourceKeyOf() of the section
// it was created from. Exact match only: no fuzzy/containment matching, so a rule can only ever apply to an entity Riot writes
// under that exact name and type.
//
// HOW RULES REACH A PATCH: functions/api/admin/patch-check.js reads them for every analysis (new patch or rescan) and
// patchNotesReview.js applyClassificationRules() SNAPSHOTS the matching ones into that revision's review layer (origin "rule").
// A published revision is never rewritten because a rule changed -- only new / draft revisions see it.
//
// READ DISCIPLINE (same lesson as functions/_lib/kvSafety.js): only a genuinely ABSENT key means "no rules". A failed or corrupt
// read is never treated as empty: writes abort, and an analysis leaves existing rule decisions untouched and flags the revision.
// Forgetting a rule is a soft delete (forgottenAt) -- the record of what was decided stays.

import { normName } from "../../src/lib/patchNotesClassification.js";
import { CHAMPIONS } from "../../src/data/champions.js";
import { ALL_ITEMS } from "../../src/data/items.js";
import { RUNES } from "../../src/data/runes.js";

export const RULES_KEY = "patch-intel:classification-rules";
export const RULES_STATUS = Object.freeze({ OK: "OK", NOT_FOUND: "NOT_FOUND", FAILED: "FAILED", INVALID: "INVALID", UNAVAILABLE: "UNAVAILABLE" });

const emptyDoc = () => ({ version: 1, revision: 0, updatedAt: null, rules: {} });

export const ruleKeyFor = (type, name) => `${type}:${normName(name)}`;

/** Canonical ids a classification may link to: the full catalog of each type (an uncoached champion is still a real record). */
export function academyCatalog() {
  return { champion: new Set(CHAMPIONS.map((c) => c.id)), item: new Set(ALL_ITEMS.map((i) => i.id)), rune: new Set(RUNES.map((r) => r.id)) };
}

/** @returns {Promise<{status: string, doc: object|null, error?: string}>} doc is a usable document only for OK / NOT_FOUND. */
export async function readRules(kv) {
  if (!kv) return { status: RULES_STATUS.UNAVAILABLE, doc: null, error: "COACH_KV binding not set up" };
  let raw;
  try { raw = await kv.get(RULES_KEY); } catch (err) { return { status: RULES_STATUS.FAILED, doc: null, error: String((err && err.message) || err) }; }
  if (raw === null || raw === undefined) return { status: RULES_STATUS.NOT_FOUND, doc: emptyDoc() };
  try {
    const doc = JSON.parse(raw);
    if (!doc || typeof doc !== "object" || !doc.rules || typeof doc.rules !== "object" || Array.isArray(doc.rules) || typeof doc.revision !== "number") throw new Error("unexpected shape");
    return { status: RULES_STATUS.OK, doc };
  } catch (err) {
    return { status: RULES_STATUS.INVALID, doc: null, error: `stored rules are unreadable (${String((err && err.message) || err)})` };
  }
}

export const isUsable = (read) => read.status === RULES_STATUS.OK || read.status === RULES_STATUS.NOT_FOUND;

/** Active (not forgotten) rules as an array. */
export function activeRules(doc) {
  return Object.values((doc && doc.rules) || {}).filter((r) => r && !r.forgottenAt && r.status === "IN_ACADEMY");
}

/**
 * Read -> mutate -> write. Aborts (writes nothing) unless the current document was read with certainty.
 * @param {(doc) => object} mutate  receives a deep copy, returns the next document (rules map edited)
 * @returns {Promise<{ok: true, doc} | {ok: false, code: string, error: string}>}
 */
export async function mutateRules(kv, mutate, { now = new Date().toISOString() } = {}) {
  const read = await readRules(kv);
  if (!isUsable(read)) return { ok: false, code: `RULES_${read.status}`, error: read.error || "remembered rules could not be read" };
  const next = mutate(JSON.parse(JSON.stringify(read.doc)));
  const doc = { ...next, version: 1, revision: read.doc.revision + 1, updatedAt: now };
  try { await kv.put(RULES_KEY, JSON.stringify(doc)); } catch (err) { return { ok: false, code: "RULES_WRITE_FAILED", error: String((err && err.message) || err) }; }
  return { ok: true, doc };
}

/** Upsert an active rule (re-remembering a forgotten one revives it, keeping its createdAt). */
export function upsertRule(doc, { key, type, name, academyId = null, sourcePatch = null, sourceSectionKey = null }, now) {
  const prev = doc.rules[key];
  doc.rules[key] = { key, type, name, status: "IN_ACADEMY", academyId: academyId || null, sourcePatch, sourceSectionKey, createdAt: (prev && prev.createdAt) || now, updatedAt: now, forgottenAt: null };
  return doc;
}

/** Soft-delete. Returns whether an active rule was found. */
export function forgetRule(doc, key, now) {
  const r = doc.rules[key];
  if (!r || r.forgottenAt) return false;
  doc.rules[key] = { ...r, forgottenAt: now, updatedAt: now };
  return true;
}
