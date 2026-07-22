import { useState, useEffect, useCallback, useRef } from "react";

const STORAGE_KEY = "vanguard-coach-overrides";
const PASSWORD_KEY = "vanguard-coach-password"; // sessionStorage -- cleared when the browser tab closes
const API_URL = "/api/coach-overrides";
const VERIFY_URL = "/api/verify-coach";
const EMPTY = { champions: {}, items: {}, runes: {}, decisionTrees: {} };

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

function readStoredPassword() {
  try {
    return sessionStorage.getItem(PASSWORD_KEY) || null;
  } catch {
    return null;
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
 * Writes now require a password, checked server-side in
 * functions/api/coach-overrides.js -- this hook just carries that password
 * along with each request. See functions/api/coach-overrides.js for the
 * one-time COACH_PASSWORD setup.
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
 * Returns [overrides, update, syncStatus, auth, decisionTreeActions] where
 * syncStatus is one of "checking" | "syncing" | "synced" | "local-only",
 * auth is { isAuthorized, verify(password), logout() }, and
 * decisionTreeActions is { add(championId), update(championId, entryId,
 * content), remove(championId, entryId) } -- add() returns the new entry's
 * id synchronously so the caller can focus it immediately.
 */
const SYNC_DEBOUNCE_MS = 1200;

export function useCoachOverrides() {
  const [overrides, setOverrides] = useState(() => readLocal() || EMPTY);
  const [syncStatus, setSyncStatus] = useState("checking");
  const [password, setPassword] = useState(() => readStoredPassword());
  const hasLoadedFromServer = useRef(false);
  const pendingSyncRef = useRef(null); // latest { overrides, password } awaiting a debounced write
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
        hasLoadedFromServer.current = true;
        setSyncStatus("synced");
      } catch {
        setSyncStatus("local-only");
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
  useEffect(() => {
    function flushOnUnload() {
      if (!pendingSyncRef.current) return;
      const body = JSON.stringify(pendingSyncRef.current);
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
  // debounced network sync. Kept in one place so update() and the three
  // decision-tree functions can't drift out of sync with each other on
  // how the KV-safety debounce actually works.
  const queueSync = useCallback((next) => {
    writeLocal(next);
    pendingSyncRef.current = { overrides: next, password };
    setSyncStatus("syncing");
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(flushSync, SYNC_DEBOUNCE_MS);
  }, [password, flushSync]);

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

  const verify = useCallback(async (candidate) => {
    try {
      const res = await fetch(VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: candidate }),
      });
      const data = await res.json();
      if (data.ok) {
        setPassword(candidate);
        try { sessionStorage.setItem(PASSWORD_KEY, candidate); } catch { /* ignore */ }
        return { ok: true };
      }
      return { ok: false, error: data.error || "Incorrect password" };
    } catch {
      return { ok: false, error: "Couldn't reach the server to check the password. Try again." };
    }
  }, []);

  const logout = useCallback(() => {
    setPassword(null);
    try { sessionStorage.removeItem(PASSWORD_KEY); } catch { /* ignore */ }
  }, []);

  const auth = { isAuthorized: Boolean(password), verify, logout };
  const decisionTreeActions = { add: addDecisionTree, update: updateDecisionTree, remove: removeDecisionTree };

  return [overrides, update, syncStatus, auth, decisionTreeActions];
}
