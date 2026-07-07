import { useState, useEffect, useRef } from "react";

const EXTENSIONS_TO_TRY = ["webp", "jpg", "jpeg", "png", "avif"];

/** Module-level, persists for the life of the page. Once we know which
 *  exact URL works for a given candidate list, every SmartImage anywhere
 *  on the site asking for that same image reuses the answer instantly
 *  instead of re-probing from scratch — this is what makes the same item
 *  icon appearing on a tier list AND a champion's build page free after
 *  the first time. Value is the resolved URL, or null if confirmed missing. */
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
 * confirmed not to) — so the fallback icon underneath never gets covered
 * by a flash of a broken-image state, and the visible <img> only ever gets
 * exactly one, already-known-good src.
 */
export default function SmartImage({ basePath, alt, className, onExhausted }) {
  const candidates = Array.isArray(basePath) ? basePath.filter(Boolean) : basePath ? [basePath] : [];
  const cacheKey = candidates.join("|");
  const containerRef = useRef(null);

  const [src, setSrc] = useState(() => (resolutionCache.has(cacheKey) ? resolutionCache.get(cacheKey) : undefined));
  const [inView, setInView] = useState(() => resolutionCache.has(cacheKey));

  // Don't even start probing until this is actually near the viewport —
  // keeps a 70-item tier list from firing 70 sets of probes on mount.
  // Already-cached images skip this entirely since there's nothing to wait for.
  useEffect(() => {
    if (inView || candidates.length === 0) return;
    const node = containerRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cacheKey, inView]);

  useEffect(() => {
    if (!inView || candidates.length === 0) return;
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
        // Visible in the browser console (F12 → Console) — if you see a wall
        // of these, it almost always means the /public/assets/... folder
        // structure doesn't exactly match what's expected, or the file uses
        // a name not covered by the alias list in utils/images.js yet.
        console.warn(`[SmartImage] No image found for any of: ${candidates.join(", ")} (tried all of ${EXTENSIONS_TO_TRY.join("/")})`);
        if (onExhausted) onExhausted();
      }
    });
    return () => { cancelled = true; };
  }, [inView, cacheKey]);

  if (candidates.length === 0) return null;

  // The wrapper only exists to give the IntersectionObserver something to
  // watch before an image is resolved; display:contents means it has zero
  // effect on layout, so it's safe inside flex/grid parents that expect
  // the <img> to behave like a direct child.
  return (
    <span ref={containerRef} style={{ display: "contents" }}>
      {src && <img src={src} alt={alt || ""} className={className} />}
    </span>
  );
}
