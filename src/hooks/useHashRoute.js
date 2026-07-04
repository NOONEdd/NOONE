import { useState, useEffect } from "react";

export function parseHash() {
  const parts = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts.length === 0) return { page: "home" };
  if (parts[0] === "guides" && parts[1]) return { page: "guide-detail", id: parts[1] };
  return { page: parts[0] };
}

export function navigate(path) {
  window.location.hash = path;
  window.scrollTo({ top: 0, behavior: "auto" });
}

export function useHashRoute() {
  const [route, setRoute] = useState(() => parseHash());
  useEffect(() => {
    function onHashChange() { setRoute(parseHash()); }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route;
}
