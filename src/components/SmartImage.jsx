import { useState, useEffect } from "react";

/**
 * Order matters: put whatever format you use most often first, since it
 * means fewer failed attempts before the real image loads. webp is first
 * here since that's what most of your sourced images have been.
 */
const EXTENSIONS_TO_TRY = ["webp", "jpg", "jpeg", "png", "avif"];

/**
 * SmartImage tries every (basePath × extension) combination in order until
 * one actually loads, then sticks with it. If none load, it renders nothing
 * — so whatever fallback icon sits underneath it in the DOM stays visible.
 *
 * basePath accepts either a single string or an array of candidate base
 * paths (use candidatePaths() from utils/images.js to get the array form,
 * which also tries known aliases for a given id — different filename a
 * source site might have used, common typos, etc). Passing an array means:
 * try candidate 1 in every format, then candidate 2 in every format, and
 * so on, before falling back to the icon.
 *
 * Usage:
 *   <SmartImage basePath="/assets/champions/lulu" alt="Lulu" className="chip-portrait" />
 *   <SmartImage basePath={candidatePaths("i:eclipse")} alt="Eclipse" className="chip-portrait" />
 */
export default function SmartImage({ basePath, alt, className, onExhausted }) {
  const candidates = Array.isArray(basePath) ? basePath.filter(Boolean) : basePath ? [basePath] : [];
  const [attempt, setAttempt] = useState(0);
  const [exhausted, setExhausted] = useState(false);

  const totalAttempts = candidates.length * EXTENSIONS_TO_TRY.length;

  // Reset the attempt chain whenever we're asked to load a different image
  useEffect(() => {
    setAttempt(0);
    setExhausted(false);
  }, [Array.isArray(basePath) ? basePath.join("|") : basePath]);

  if (candidates.length === 0 || exhausted) return null;

  const candidateIndex = Math.floor(attempt / EXTENSIONS_TO_TRY.length);
  const extIndex = attempt % EXTENSIONS_TO_TRY.length;
  const src = `${candidates[candidateIndex]}.${EXTENSIONS_TO_TRY[extIndex]}`;

  return (
    <img
      src={src}
      alt={alt || ""}
      className={className}
      loading="lazy"
      onError={() => {
        if (attempt < totalAttempts - 1) {
          setAttempt((a) => a + 1);
        } else {
          setExhausted(true);
          // Visible in the browser console (F12 → Console) — if you see a wall
          // of these, it almost always means the /public/assets/... folder
          // structure doesn't exactly match what's expected, or the file uses
          // a name not covered by the alias list in utils/images.js yet.
          console.warn(
            `[SmartImage] No image found for any of: ${candidates.join(", ")} (tried all of ${EXTENSIONS_TO_TRY.join("/")})`
          );
          if (onExhausted) onExhausted();
        }
      }}
    />
  );
}
