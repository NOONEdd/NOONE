import { useState, useEffect } from "react";

/**
 * Order matters: put whatever format you use most often first, since it
 * means fewer failed attempts before the real image loads. webp is first
 * here since that's what most of your sourced images have been.
 */
const EXTENSIONS_TO_TRY = ["webp", "jpg", "jpeg", "png", "avif"];

/**
 * SmartImage tries every extension in EXTENSIONS_TO_TRY against the given
 * basePath until one actually loads, then sticks with it. If none load, it
 * renders nothing — so whatever fallback icon sits underneath it in the
 * DOM stays visible.
 *
 * This means: drop a new file in as lulu.webp, lulu.png, or lulu.jpg —
 * doesn't matter which — and it'll be found automatically. No code change
 * needed when you add images later, regardless of format.
 *
 * Usage:
 *   <SmartImage basePath="/assets/champions/lulu" alt="Lulu" className="chip-portrait" />
 */
export default function SmartImage({ basePath, alt, className, onExhausted }) {
  const [extIndex, setExtIndex] = useState(0);
  const [exhausted, setExhausted] = useState(false);

  // Reset the attempt chain whenever we're asked to load a different image
  useEffect(() => {
    setExtIndex(0);
    setExhausted(false);
  }, [basePath]);

  if (!basePath || exhausted) return null;

  const src = `${basePath}.${EXTENSIONS_TO_TRY[extIndex]}`;

  return (
    <img
      src={src}
      alt={alt || ""}
      className={className}
      loading="lazy"
      onError={() => {
        if (extIndex < EXTENSIONS_TO_TRY.length - 1) {
          setExtIndex((i) => i + 1);
        } else {
          setExhausted(true);
          // Visible in the browser console (F12 → Console) — if you see a wall
          // of these, it almost always means the /public/assets/... folder
          // structure doesn't exactly match what's expected, or the deployed
          // build predates these images being added. Check the exact failed
          // path below against your actual repo structure.
          console.warn(
            `[SmartImage] No image found for "${basePath}" — tried: ${EXTENSIONS_TO_TRY.map((e) => `${basePath}.${e}`).join(", ")}`
          );
          if (onExhausted) onExhausted();
        }
      }}
    />
  );
}
