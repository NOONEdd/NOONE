// SmartImage's resolveSrc() now tries .webp alone first (the overwhelmingly
// common format in public/assets/*/ -- see the comment in SmartImage.jsx
// for the measured per-category breakdown) before falling back to the full
// brute-force parallel probe of the remaining extensions. This tests the
// REAL exported function against a mocked `Image` (no network, no real
// browser) -- same convention as the rest of this project's tests: plain
// Node ESM, no new dependency, exercising production code directly.

import { resolveSrc } from '../src/utils/imageResolution.js';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS -', label); }
  else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail) : ''); }
}

/** Mocks the browser Image() constructor SmartImage's probeImage() uses.
 *  `existing` is a Set of URLs that should "succeed" (fire onload);
 *  everything else "fails" (fires onerror). Also records every URL that
 *  was actually probed, so tests can assert on request COUNT and TIMING,
 *  not just the final answer. */
function installFakeImage(existing) {
  const requested = [];
  global.Image = class {
    set src(url) {
      requested.push(url);
      // Resolve asynchronously (a real Image load is always async) so
      // Promise.all here behaves the same way it does against a real
      // network -- e.g. this is what actually proves the "try webp alone,
      // await it, THEN decide whether to fire the rest" sequencing works,
      // rather than everything just happening to resolve synchronously.
      queueMicrotask(() => {
        if (existing.has(url)) this.onload && this.onload();
        else this.onerror && this.onerror();
      });
    }
  };
  return requested;
}

// ---------------------------------------------------------------------
console.log('\n-- resolveSrc: the common case (webp exists) resolves via ONE tier only --');
{
  const requested = installFakeImage(new Set(['/assets/items/eclipse.webp']));
  const result = await resolveSrc(['/assets/items/eclipse']);
  check('resolves to the webp URL', result === '/assets/items/eclipse.webp', result);
  check('only 1 request was made (webp tier), not all 5 extensions', requested.length === 1, requested);
  check('the one request made was for .webp specifically', requested[0] === '/assets/items/eclipse.webp');
}

// ---------------------------------------------------------------------
console.log('\n-- resolveSrc: multiple candidate base paths, webp exists on the second one --');
{
  const requested = installFakeImage(new Set(['/assets/items/alt-name.webp']));
  const result = await resolveSrc(['/assets/items/primary-name', '/assets/items/alt-name']);
  check('resolves to the working candidate', result === '/assets/items/alt-name.webp', result);
  check('exactly 2 requests made (one .webp probe per candidate, not 2x5=10)', requested.length === 2, requested);
}

// ---------------------------------------------------------------------
console.log('\n-- resolveSrc: webp missing, falls through to the remaining extensions --');
{
  const requested = installFakeImage(new Set(['/assets/champions/oldchamp.png']));
  const result = await resolveSrc(['/assets/champions/oldchamp']);
  check('still finds the real (non-webp) file via fallback', result === '/assets/champions/oldchamp.png', result);
  // Tier 1 (webp) is tried first and fails, THEN tier 2 fires the rest --
  // total requests = 1 (webp) + however many remain (jpg, jpeg, png, avif = 4).
  check('probed webp first, then the remaining 4 extensions (5 total, not fewer)', requested.length === 5, requested);
  check('the webp attempt happened before the fallback batch (sequencing, not one giant parallel probe)',
    requested[0].endsWith('.webp'));
}

// ---------------------------------------------------------------------
console.log('\n-- resolveSrc: genuinely missing image still resolves to null gracefully --');
{
  const requested = installFakeImage(new Set());
  const result = await resolveSrc(['/assets/items/does-not-exist']);
  check('returns null when nothing matches (unchanged fallback behavior)', result === null);
  check('still tried all 5 extensions before giving up', requested.length === 5, requested);
}

// ---------------------------------------------------------------------
console.log('\n-- resolveSrc: ordering preference is unchanged when multiple extensions would match --');
{
  // If somehow both a .webp and a .png existed for the same base (this
  // project only ever ships one file per id, but the resolver's own
  // contract shouldn't silently change), webp must still win -- same
  // most-to-least-likely preference as before this change.
  const requested = installFakeImage(new Set(['/assets/items/dual.webp', '/assets/items/dual.png']));
  const result = await resolveSrc(['/assets/items/dual']);
  check('webp still wins over png when both exist', result === '/assets/items/dual.webp', result);
  check('did not even need to probe png -- webp tier alone was enough', !requested.some((u) => u.endsWith('.png')), requested);
}

console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
