// Cloudflare Pages Function — GET/POST /api/coach-overrides
// Real, cross-device persistence for Coach Mode edits (champion tiers,
// item/rune tiers, decision trees, their notes, and the current-patch/
// verification fields), backed by Cloudflare KV.
//
// SETUP (one-time, in the Cloudflare dashboard):
//   1. Workers & Pages → KV → Create a namespace (call it whatever you like,
//      e.g. "vanguard-coach-data")
//   2. Workers & Pages → your Pages project → Settings → Functions →
//      KV namespace bindings → Add binding
//        Variable name:  COACH_KV        (must match exactly, used below)
//        KV namespace:   the one you just created
//      Do this for BOTH the Production and Preview environments in the
//      dashboard -- they're configured separately, and a binding added
//      to only one will work in previews but silently miss in
//      production (or vice versa). See the note in README.md.
//   3. Workers & Pages → your Pages project → Settings → Environment
//      variables → Add variable
//        Variable name:  COACH_PASSWORD  (must match exactly, used below)
//        Value:          whatever password only you should know
//        Mark it as a Secret so it's never shown/logged in plain text.
//      Again, set this for both Production and Preview.
//   4. Redeploy (or trigger a new deployment) so both bindings take effect
//
// Anyone can still READ the tier list (that's the whole point of a public
// site) -- GET below stays fully unauthenticated. WRITES require a valid
// admin session, established by logging in at #/admin (functions/api/admin/login.js)
// -- checked here, server-side, via requireAdminSession(), which is the
// actual security boundary. This replaced sending COACH_PASSWORD itself
// in this endpoint's POST body on every write (the old design): a write
// without a valid session cookie is rejected right here regardless of
// what the client sends, exactly the same guarantee as before, just
// without the password re-traveling the network on every keystroke.
//
// Until COACH_KV is set up, this endpoint returns a clear error instead
// of crashing, and the site automatically falls back to browser-local
// storage (see src/hooks/useCoachOverrides.js) so Coach Mode still works
// locally in the meantime.

import { requireAdminSession } from "../_lib/adminAuth.js";
// Only import needed for the matchup validation added below (see
// validateMatchupOverrides) -- everything else in this file is
// unchanged from before the Champion Matchups redesign.
import { CHAMPIONS } from "../../src/data/champions.js";

const KEY = "coach-overrides";
// Kept in sync with functions/_lib/kv.js's `empty` -- see that file's
// comment for what verifiedPatch/patchStatus are for.
const EMPTY_OVERRIDES = { champions: {}, items: {}, runes: {}, decisionTrees: {}, patch: null, verifiedPatch: null, patchStatus: null };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

const MATCHUP_CATEGORIES = ["hardAgainst", "goodAgainst", "goodWith"];
const VALID_DIFFICULTIES = ["low", "medium", "high"];
const VALID_CHAMPION_IDS = new Set(CHAMPIONS.map((c) => c.id));

/** Server-side validation for matchupRelations specifically (Champion
 *  Matchups redesign spec §10) -- this is the ONE thing this endpoint
 *  didn't already validate for anything (tiers/notes/builds/decision
 *  trees have never had server-side schema checks here, and adding
 *  that for all of them is out of scope for this feature -- see spec
 *  §18 "do not modify unrelated functionality"). Runs only when a
 *  champion override actually contains a `matchupRelations` field;
 *  every other override write (a plain tier change, a build edit, etc.)
 *  skips this entirely and behaves exactly as it always has.
 *
 *  Never trusts the client for which Champion IDs are real -- re-checks
 *  every id against CHAMPIONS (the same canonical import
 *  functions/api/admin/patch-check.js already uses across this exact
 *  functions/ -> src/ boundary), the live source of truth, not
 *  whatever the request claims. Same for difficulty -- checked against
 *  VALID_DIFFICULTIES, never trusted as free text.
 *
 *  Each category entry is normally {championId, difficulty, reason}
 *  (Phase 3's schema), but a bare id string (Phase 2's original schema,
 *  in case an old client/tab is still open) is accepted too and
 *  silently upgraded to {championId: theString, difficulty: "medium",
 *  reason: null} -- the same "safe normalization, not a second schema"
 *  approach src/lib/effectiveData.js's normalizeMatchupRelations()
 *  already uses on the read side (spec §13), applied here on the write
 *  side too so a stale client can't corrupt what gets saved.
 *
 *  Returns { ok: true, sanitized } on success, where `sanitized` is the
 *  same overrides object with every matchupRelations array normalized,
 *  deduplicated by championId, and stripped of self-references (a
 *  champion can't be its own matchup) -- duplicates are "safely
 *  ignored" per spec §10, not a rejection. Returns { ok: false, error }
 *  -- a hard 400 -- for the cases the spec calls out as REQUIRED to
 *  reject outright: an unknown relationship-type key, a Champion ID
 *  (the champion's own, or a target) that doesn't exist in the
 *  canonical roster, or an invalid difficulty value. */
function validateAndSanitizeMatchups(overrides) {
  const champions = overrides.champions;
  if (!champions || typeof champions !== "object") return { ok: true, sanitized: overrides };

  for (const championId of Object.keys(champions)) {
    const entry = champions[championId];
    if (!entry || typeof entry !== "object" || !("matchupRelations" in entry)) continue;

    const rel = entry.matchupRelations;
    if (!rel || typeof rel !== "object" || Array.isArray(rel)) {
      return { ok: false, error: `matchupRelations for "${championId}" must be an object.` };
    }
    if (!VALID_CHAMPION_IDS.has(championId)) {
      return { ok: false, error: `"${championId}" is not a real Champion ID -- can't save matchup data for a champion that doesn't exist in the canonical roster.` };
    }
    for (const key of Object.keys(rel)) {
      if (!MATCHUP_CATEGORIES.includes(key)) {
        return { ok: false, error: `"${key}" is not a valid matchup relationship type -- must be one of ${MATCHUP_CATEGORIES.join(", ")}.` };
      }
    }

    const sanitizedRel = {};
    for (const category of MATCHUP_CATEGORIES) {
      const list = rel[category];
      if (list === undefined) { sanitizedRel[category] = []; continue; }
      if (!Array.isArray(list)) {
        return { ok: false, error: `matchupRelations.${category} for "${championId}" must be an array.` };
      }

      const seen = new Map(); // championId -> normalized entry, dedupes by last-write-wins
      for (const raw of list) {
        // Backward compat: a bare id string (Phase 2 shape) is upgraded,
        // not rejected -- see function doc above.
        const isBareString = typeof raw === "string";
        const targetId = isBareString ? raw : raw?.championId;
        if (typeof targetId !== "string" || !VALID_CHAMPION_IDS.has(targetId)) {
          return { ok: false, error: `"${targetId}" in ${championId}'s ${category} is not a real Champion ID.` };
        }
        if (targetId === championId) continue; // self-matchup -- silently sanitized away, not rejected

        const difficulty = isBareString ? "medium" : (raw.difficulty || "medium");
        if (!VALID_DIFFICULTIES.includes(difficulty)) {
          return { ok: false, error: `"${difficulty}" in ${championId}'s ${category} (${targetId}) is not a valid difficulty -- must be one of ${VALID_DIFFICULTIES.join(", ")}.` };
        }
        const reason = isBareString ? null : (typeof raw.reason === "string" ? raw.reason : null);

        seen.set(targetId, { championId: targetId, difficulty, reason }); // duplicate target within the category -- safely ignored (last one wins), not rejected
      }
      sanitizedRel[category] = [...seen.values()];
    }
    champions[championId] = { ...entry, matchupRelations: sanitizedRel };
  }

  return { ok: true, sanitized: overrides };
}

export async function onRequestGet(context) {
  const kv = context.env.COACH_KV;
  if (!kv) {
    return json({ error: "COACH_KV binding not set up yet — see comments in functions/api/coach-overrides.js", overrides: null }, 200);
  }
  const value = await kv.get(KEY);
  return json({ overrides: value ? JSON.parse(value) : EMPTY_OVERRIDES });
}

export async function onRequestPost(context) {
  const kv = context.env.COACH_KV;
  if (!kv) {
    return json({ error: "COACH_KV binding not set up yet — see comments in functions/api/coach-overrides.js" }, 500);
  }

  // The real security boundary: a direct POST to this endpoint with no
  // valid session cookie is rejected here regardless of what's in the
  // body -- there is no password field this handler will accept instead.
  // Log in at #/admin (functions/api/admin/login.js) to get a session.
  if (!(await requireAdminSession(context))) {
    return json({ error: "Not authenticated — log in at /#/admin first." }, 401);
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { overrides } = body || {};
  if (!overrides || typeof overrides !== "object") {
    return json({ error: "Missing overrides object" }, 400);
  }

  const validation = validateAndSanitizeMatchups(overrides);
  if (!validation.ok) {
    return json({ error: validation.error }, 400);
  }

  try {
    await kv.put(KEY, JSON.stringify(validation.sanitized));
  } catch (err) {
    // Cloudflare's Workers KV free tier caps out at 1,000 put operations
    // per day; past that, kv.put() itself rejects -- this is exactly the
    // "Daily Workers KV put limit exceeded" email. The client (see
    // src/hooks/useCoachOverrides.js) already falls back to localStorage
    // on any non-ok response, so no edit is lost -- it just won't sync to
    // other devices/visitors until the quota resets at 00:00 UTC.
    return json({ error: "Cloudflare's daily free-tier KV write limit was reached. Your edit is saved in this browser and will sync once the limit resets (00:00 UTC)." }, 429);
  }
  return json({ ok: true });
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
