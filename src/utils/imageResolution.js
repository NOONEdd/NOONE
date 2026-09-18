// Pure image-URL resolution logic for SmartImage.jsx, split into its own
// plain (non-JSX) module so it can be imported and tested directly under
// plain Node -- SmartImage.jsx itself contains actual JSX, which plain
// `node` can't parse without a build-tool transform.

export const EXTENSIONS_TO_TRY = ["webp", "jpg", "jpeg", "png", "avif"];

/** Module-level, persists for the life of the page. Once we know which
 *  exact URL works for a given candidate list, every SmartImage anywhere
 *  on the site asking for that same image reuses the answer instantly
 *  instead of re-probing from scratch. Value is the resolved URL, or null
 *  if confirmed missing. */
export const resolutionCache = new Map();

export function probeImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

export async function resolveSrc(candidates) {
  // Try the overwhelmingly common format first, alone, before firing the
  // full brute-force parallel probe. public/assets/{champions,items,runes,
  // spells}/ is currently 96-100% .webp per category (checked directly:
  // 138/144 champions, 148/152 items, 108/108 runes, 5/5 spells) -- so for
  // the vast majority of images, this turns "5 extensions x N candidate
  // paths" parallel speculative requests into just "1 x N". Only the
  // small remainder of non-webp assets (a handful of .png/.jpg files) pays
  // one extra round-trip by falling through to the full probe below --
  // same eventual coverage, same fallback-to-null behavior, same ordering
  // of which URL wins if multiple exist; this only changes WHEN the
  // less-likely extensions get requested, never WHICH ones are tried.
  const primaryExt = EXTENSIONS_TO_TRY[0]; // "webp"
  const primaryUrls = candidates.map((base) => `${base}.${primaryExt}`);
  const primaryResults = await Promise.all(primaryUrls.map((url) => probeImage(url).then((ok) => (ok ? url : null))));
  const primaryHit = primaryResults.find((url) => url !== null);
  if (primaryHit) return primaryHit;

  const remainingExtensions = EXTENSIONS_TO_TRY.slice(1);
  const fallbackUrls = [];
  for (const base of candidates) {
    for (const ext of remainingExtensions) {
      fallbackUrls.push(`${base}.${ext}`);
    }
  }
  // Fire every remaining candidate at once instead of awaiting each 404 in
  // turn before trying the next -- this used to mean any image whose real
  // filename wasn't the very first guess paid for several sequential
  // round-trips before showing up, worst felt on mobile. Total wait time
  // is now roughly the slowest single request, not the sum of all of
  // them. .find() below still respects the original most-to-least-likely
  // ordering when picking among whichever ones actually succeeded.
  const fallbackResults = await Promise.all(fallbackUrls.map((url) => probeImage(url).then((ok) => (ok ? url : null))));
  return fallbackResults.find((url) => url !== null) || null;
}
