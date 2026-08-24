import { useState, useEffect, useCallback, useRef } from "react";

const STORAGE_KEY = "vanguard-coach-overrides";
const API_URL = "/api/coach-overrides";
const LOGIN_URL = "/api/admin/login";
const LOGOUT_URL = "/api/admin/logout";
const SESSION_URL = "/api/admin/session";
const EMPTY = { champions: {}, items: {}, runes: {}, decisionTrees: {}, patch: null, verifiedPatch: null, patchStatus: null };

function readLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // storage full or unavailable -- edit still applies for this session
  }
}

/**
 * Coach Mode persistence, in order of preference:
 *   1. Real backend (Cloudflare KV via /api/coach-overrides) -- synced across
 *      every device and visitor once the COACH_KV binding is set up (see
 *      functions/api/coach-overrides.js for the one-time setup steps).
 *   2. localStorage -- used instantly on load so the UI never flashes empty,
 *      and used as the fallback whenever the API isn't reachable (e.g.
 *      local `npm run dev`, which doesn't run Cloudflare Functions -- use
 *      `npx wrangler pages dev` instead if you want the real API locally).
 *
 * AUTH: writes require a valid admin session -- a signed, HttpOnly cookie
 * set by POST /api/admin/login (functions/api/admin/login.js) after the
 * correct COACH_PASSWORD is supplied at #/admin (src/pages/AdminPage.jsx).
 * Unlike the old design, this hook never stores the password itself
 * anywhere (no sessionStorage) and never re-sends it with every write --
 * every fetch below uses `credentials: "same-origin"` so the browser
 * attaches that cookie automatically, and the server (requireAdminSession()
 * in functions/_lib/adminAuth.js) is what actually enforces the boundary.
 * On mount, this hook asks the server whether a session cookie is already
 * present and valid (GET /api/admin/session) -- the only way to know that,
 * since page JS can never read an HttpOnly cookie directly.
 *
 * The network write is debounced (see SYNC_DEBOUNCE_MS below): local state
 * and localStorage update on every call so the UI never lags, but the
 * actual POST -> Workers KV put only fires once ~1.2s pass with no further
 * edits. Without this, every keystroke in a note field (or every tier
 * dropdown change) fired its own KV put -- typing out a few real coaching
 * notes in one sitting is enough to blow through Cloudflare's free-tier
 * cap of 1,000 KV writes/day on its own. pendingSyncRef always holds the
 * latest accumulated overrides, so even if ten edits land inside one
 * debounce window, the eventual single write still contains all of them.
 *
 * Returns [overrides, update, syncStatus, auth, decisionTreeActions,
 * updatePatch, patchVerification] where syncStatus is one of "checking" |
 * "syncing" | "synced" | "local-only", auth is { isAuthorized,
 * verify(password), logout() }, decisionTreeActions is { add(championId),
 * update(championId, entryId, content), remove(championId, entryId) } --
 * add() returns the new entry's id synchronously so the caller can focus
 * it immediately -- updatePatch(newPatch) sets the site-wide current-patch
 * override, and patchVerification is { markVerified(patch), setUpdating(bool) }
 * for the data-verification-status fields (see src/lib/effectiveData.js's
 * resolvePatchDataStatus()).
 */
const SYNC_DEBOUNCE_MS = 1200;

export function useCoachOverrides() {
  const [overrides, setOverrides] = useState(() => readLocal() || EMPTY);
  const [syncStatus, setSyncStatus] = useState("checking");
  const [isAuthorized, setIsAuthorized] = useState(false);
  const pendingSyncRef = useRef(null); // latest overrides object awaiting a debounced write
  const debounceTimerRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error("bad status");
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setOverrides(data.overrides || EMPTY);
        writeLocal(data.overrides || EMPTY);
        setSyncStatus("synced");
      } catch {
        setSyncStatus("local-only");
      }
    })();

    // Independent of the overrides load above -- finds out whether this
    // browser already has a valid admin session (e.g. logged in earlier
    // today) so Coach Mode's on-page controls can appear without a fresh
    // login. A failed/unreachable check just leaves isAuthorized false,
    // same as "not logged in."
    (async () => {
      try {
        const res = await fetch(SESSION_URL, { credentials: "same-origin" });
        const data = await res.json();
        setIsAuthorized(Boolean(data && data.authenticated));
      } catch {
        setIsAuthorized(false);
      }
    })();
  }, []);

  const flushSync = useCallback(() => {
    debounceTimerRef.current = null;
    const payload = pendingSyncRef.current;
    if (!payload) return;
    pendingSyncRef.current = null;
    fetch(API_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overrides: payload }),
    })
      .then((res) => res.json())
      .then((data) => setSyncStatus(data.ok ? "synced" : "local-only"))
      .catch(() => setSyncStatus("local-only"));
  }, []);

  // Best-effort: if the tab closes or backgrounds mid-debounce (e.g. the
  // note was typed less than 1.2s before the tab closed), flush whatever's
  // pending immediately via sendBeacon rather than losing that last edit --
  // a plain fetch can get cancelled mid-flight when the page is unloading,
  // sendBeacon is the browser-native way to deliver one last small POST.
  // sendBeacon sends same-origin cookies automatically, same as fetch's
  // credentials:"same-origin" above -- no extra config needed here for
  // the admin session to ride along.
  useEffect(() => {
    function flushOnUnload() {
      if (!pendingSyncRef.current) return;
      const body = JSON.stringify({ overrides: pendingSyncRef.current });
      pendingSyncRef.current = null;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      navigator.sendBeacon?.(API_URL, new Blob([body], { type: "application/json" }));
    }
    function handleVisibility() {
      if (document.visibilityState === "hidden") flushOnUnload();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", flushOnUnload);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", flushOnUnload);
    };
  }, []);

  // Shared by every write path below: apply writeLocal + queue the
  // debounced network sync. Kept in one place so update() and the other
  // write functions can't drift out of sync with each other on how the
  // KV-safety debounce actually works.
  const queueSync = useCallback((next) => {
    writeLocal(next);
    pendingSyncRef.current = next;
    setSyncStatus("syncing");
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(flushSync, SYNC_DEBOUNCE_MS);
  }, [flushSync]);

  const update = useCallback((kind, id, patch) => {
    setOverrides((prev) => {
      const next = { ...prev, [kind]: { ...prev[kind], [id]: { ...prev[kind][id], ...patch } } };
      queueSync(next);
      return next;
    });
  }, [queueSync]);

  // Decision Trees are different in shape from the tier/note overrides
  // above: those only ever *patch* an entry that already exists in the
  // static data files (a champion/item/rune that already has a code-
  // authored id). Decision trees have no code-authored baseline at all --
  // they're entirely new entries the coach writes on the live site, so
  // they need real add/remove, not just patch. Each is stored as one
  // freeform `content` string per champion (see DecisionTreePanel.jsx for
  // how that's split into a heading + body for display), and -- same as
  // update() above -- every write here goes through queueSync, so writing
  // several scenarios back-to-back still collapses into a single KV put
  // once typing pauses.
  const addDecisionTree = useCallback((championId) => {
    const entryId = `dt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setOverrides((prev) => {
      const existing = prev.decisionTrees[championId] || [];
      const next = { ...prev, decisionTrees: { ...prev.decisionTrees, [championId]: [...existing, { id: entryId, content: "" }] } };
      queueSync(next);
      return next;
    });
    return entryId; // returned synchronously so the UI can auto-focus the new entry
  }, [queueSync]);

  const updateDecisionTree = useCallback((championId, entryId, content) => {
    setOverrides((prev) => {
      const existing = prev.decisionTrees[championId] || [];
      const next = { ...prev, decisionTrees: { ...prev.decisionTrees, [championId]: existing.map((e) => (e.id === entryId ? { ...e, content } : e)) } };
      queueSync(next);
      return next;
    });
  }, [queueSync]);

  const removeDecisionTree = useCallback((championId, entryId) => {
    setOverrides((prev) => {
      const existing = prev.decisionTrees[championId] || [];
      const next = { ...prev, decisionTrees: { ...prev.decisionTrees, [championId]: existing.filter((e) => e.id !== entryId) } };
      queueSync(next);
      return next;
    });
  }, [queueSync]);

  // Sets the site-wide current-patch override (see src/lib/effectiveData.js's
  // resolveEffectivePatch(), used by both this website and the AI Coach
  // backend). Passing an empty string clears the override, falling back
  // to the static STATIC_PATCH_VERSION in src/data/patch.js again. Same
  // debounced-write path as update() above. Deliberately does NOT touch
  // verifiedPatch/patchStatus -- see resolvePatchDataStatus() in
  // src/lib/effectiveData.js: verification is derived purely from
  // whether verifiedPatch still matches the (possibly just-changed)
  // patch value, so there's nothing extra to reset here for that
  // guarantee to hold.
  const updatePatch = useCallback((newPatch) => {
    setOverrides((prev) => {
      const next = { ...prev, patch: newPatch };
      queueSync(next);
      return next;
    });
  }, [queueSync]);

  // Marks `patchValue` (the CURRENT effective patch, passed in by the
  // caller -- see src/components/TierBoard.jsx's CoachToggle) as
  // reviewed/verified, and clears any "updating" flag. Marking verified
  // for a DIFFERENT patch later (or bumping the current patch again)
  // naturally falls back out of "verified" on its own -- see
  // resolvePatchDataStatus() -- nothing else needs to change for that.
  const markPatchVerified = useCallback((patchValue) => {
    setOverrides((prev) => {
      const next = { ...prev, verifiedPatch: patchValue || null, patchStatus: null };
      queueSync(next);
      return next;
    });
  }, [queueSync]);

  // Explicit "actively updating" flag -- see PatchStatus.jsx for how this
  // reads on the public site. Toggling it off returns to "not yet
  // reviewed" (patchStatus: null), not to "verified" -- verified can only
  // ever be set via markPatchVerified above.
  const setPatchUpdating = useCallback((isUpdating) => {
    setOverrides((prev) => {
      const next = { ...prev, patchStatus: isUpdating ? "updating" : null };
      queueSync(next);
      return next;
    });
  }, [queueSync]);

  const verify = useCallback(async (candidate) => {
    try {
      const res = await fetch(LOGIN_URL, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: candidate }),
      });
      const data = await res.json();
      if (data.ok) {
        setIsAuthorized(true);
        return { ok: true };
      }
      return { ok: false, error: data.error || "Incorrect password" };
    } catch {
      return { ok: false, error: "Couldn't reach the server to check the password. Try again." };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(LOGOUT_URL, { method: "POST", credentials: "same-origin" });
    } catch {
      // even if the request fails, drop the client-side flag -- worst
      // case the (still-valid) cookie just sits unused until it expires
    }
    setIsAuthorized(false);
  }, []);

  const auth = { isAuthorized, verify, logout };
  const decisionTreeActions = { add: addDecisionTree, update: updateDecisionTree, remove: removeDecisionTree };
  const patchVerification = { markVerified: markPatchVerified, setUpdating: setPatchUpdating };

  return [overrides, update, syncStatus, auth, decisionTreeActions, updatePatch, patchVerification];
}
