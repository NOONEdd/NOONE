import { useEffect, useState } from "react";

// Coach Mode's toggle button is hidden from the page by default. A
// password-entry UI that's visible to every visitor -- including
// automated crawlers -- is a plausible contributor to a Safe Browsing
// "social engineering" style flag even when (as here) it's clearly
// labeled and isn't impersonating a login for some other trusted
// service. Hiding it removes that from casual/automated discovery.
//
// IMPORTANT: this is NOT the real access control and was never meant to
// be. It's a client-side React app, so this file's source (including
// the param name below) is visible to anyone who opens devtools -- this
// only stops PASSIVE discovery (a crawler, a casual visitor), not a
// deliberate look at the bundled JS. The actual security boundary is
// unchanged and is still entirely server-side: the COACH_PASSWORD check
// in functions/api/verify-coach.js and functions/api/coach-overrides.js,
// plus their shared brute-force lockout. This hook only decides whether
// the button that leads to that password prompt renders on the page.
//
// Visit the site once with this in the URL, e.g.
//   https://your-site.pages.dev/?coach
// and it's remembered in that browser via localStorage -- you won't
// need to add it again on that device. Change COACH_UI_REVEAL_PARAM to
// anything you like if you'd rather it not be the word "coach".
const COACH_UI_REVEAL_PARAM = "coach";
const COACH_UI_STORAGE_KEY = "vanguardCoachUIUnlocked";

export function useCoachUIVisible() {
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(COACH_UI_STORAGE_KEY) === "1";
    } catch {
      return false; // private browsing / storage blocked -- starts hidden
    }
  });

  useEffect(() => {
    let hasParam = false;
    try {
      hasParam = new URLSearchParams(window.location.search).has(COACH_UI_REVEAL_PARAM);
    } catch {
      hasParam = false;
    }
    if (!hasParam) return;

    setVisible(true);
    try {
      localStorage.setItem(COACH_UI_STORAGE_KEY, "1");
    } catch {
      // storage blocked -- stays revealed for this page load only,
      // won't persist to the next visit, which is a reasonable fallback
    }
  }, []);

  return visible;
}
