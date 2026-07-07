import { useState, useEffect } from "react";

const EXTENSIONS_TO_TRY = ["webp", "jpg", "jpeg", "png", "avif"];

/** Module-level, persists for the life of the page. Once we know which
 *  exact URL works for a given candidate list, every SmartImage anywhere
 *  on the site asking for that same image reuses the answer instantly
 *  instead of re-probing from scratch. Value is the resolved URL, or null
 *  if confirmed missing. */
const resolutionCache = new Map();

function probeImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function resolveSrc(candidates) {
  for (const base of candidates) {
    for (const ext of EXTENSIONS_TO_TRY) {
      const url = `${base}.${ext}`;
      if (await probeImage(url)) return url;
    }
  }
  return null;
}

/**
 * Usage:
 *   <SmartImage basePath="/assets/champions/lulu" alt="Lulu" className="chip-portrait" />
 *   <SmartImage basePath={candidatePaths("i:eclipse")} alt="Eclipse" className="chip-portrait" />
 *
 * Renders nothing until the correct URL is confirmed to actually exist (or
 * confirmed not to) -- so the fallback icon underneath never gets covered
 * by a flash of a broken-image state, and the visible <img> only ever gets
 * exactly one, already-known-good src. Resolution happens via a hidden
 * probe, never by letting the real <img> fail and retry.
 */
export default function SmartImage({ basePath, alt, className, onExhausted }) {
  const candidates = Array.isArray(basePath) ? basePath.filter(Boolean) : basePath ? [basePath] : [];
  const cacheKey = candidates.join("|");

  const [src, setSrc] = useState(() => (resolutionCache.has(cacheKey) ? resolutionCache.get(cacheKey) : undefined));

  useEffect(() => {
    if (candidates.length === 0) return;
    if (resolutionCache.has(cacheKey)) {
      setSrc(resolutionCache.get(cacheKey));
      return;
    }
    let cancelled = false;
    resolveSrc(candidates).then((result) => {
      resolutionCache.set(cacheKey, result);
      if (cancelled) return;
      setSrc(result);
      if (result === null) {
        console.warn(`[SmartImage] No image found for any of: ${candidates.join(", ")} (tried all of ${EXTENSIONS_TO_TRY.join("/")})`);
        if (onExhausted) onExhausted();
      }
    });
    return () => { cancelled = true; };
  }, [cacheKey]);

  if (!src) return null;

  return <img src={src} alt={alt || ""} className={className} loading="lazy" />;
}
