import { useState, useEffect, useCallback, useRef } from "react";

const STORAGE_KEY = "vanguard-coach-overrides";
const PASSWORD_KEY = "vanguard-coach-password"; // sessionStorage -- cleared when the browser tab closes
const API_URL = "/api/coach-overrides";
const VERIFY_URL = "/api/verify-coach";
const EMPTY = { champions: {}, items: {}, runes: {} };

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
 * Returns [overrides, update, syncStatus, auth] where syncStatus is one of
 * "checking" | "synced" | "local-only", and auth is
 * { isAuthorized, verify(password), logout() }.
 */
export function useCoachOverrides() {
  const [overrides, setOverrides] = useState(() => readLocal() || EMPTY);
  const [syncStatus, setSyncStatus] = useState("checking");
  const [password, setPassword] = useState(() => readStoredPassword());
  const hasLoadedFromServer = useRef(false);

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

  const update = useCallback((kind, id, patch) => {
    setOverrides((prev) => {
      const next = { ...prev, [kind]: { ...prev[kind], [id]: { ...prev[kind][id], ...patch } } };
      writeLocal(next);
      fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: next, password }),
      })
        .then((res) => res.json())
        .then((data) => setSyncStatus(data.ok ? "synced" : "local-only"))
        .catch(() => setSyncStatus("local-only"));
      return next;
    });
  }, [password]);

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

  return [overrides, update, syncStatus, auth];
}
