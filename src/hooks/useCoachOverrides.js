import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "vanguard-coach-overrides";

// NOTE: This uses localStorage, which is per-browser only — edits made in
// Coach Mode on one device will NOT appear on another device or for other
// visitors. That's fine for previewing changes locally, but the source of
// truth for the live public site is the data files in src/data/. To make
// a tier/note change permanent and visible to everyone, edit the relevant
// entry in champions.js / items.js / runes.js directly and redeploy.
//
// A real backend (e.g. Supabase, Firebase) would be the next step if you
// want Coach Mode to edit the live site directly without a redeploy.

export function useCoachOverrides() {
  const [overrides, setOverrides] = useState({ champions: {}, items: {}, runes: {} });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setOverrides(JSON.parse(raw));
    } catch (e) {
      // ignore — nothing saved yet, or storage unavailable
    }
  }, []);

  const update = useCallback((kind, id, patch) => {
    setOverrides((prev) => {
      const next = { ...prev, [kind]: { ...prev[kind], [id]: { ...prev[kind][id], ...patch } } };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        // storage full or unavailable — edit still applies for this session
      }
      return next;
    });
  }, []);

  return [overrides, update];
}
