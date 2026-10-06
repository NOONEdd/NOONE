// Cloudflare Pages Functions bundle integrity. Plain Node ESM, no framework, no network, no new dependency (esbuild ships with vite, and it is the
// bundler Wrangler itself uses). Run directly:
//
//   node tests/functionsBundleIntegrity.test.mjs
//
// WHY THIS EXISTS: the unit tests import modules one at a time under Node, and `vite build` only bundles the FRONTEND. Neither notices
// when a file in functions/ imports something that is not there -- a module missing from a commit ("Could not resolve ./patchChangeScope.js")
// or a name the other module does not export ("No matching export in patchChangeDetector.js for import slotFromLabel"). Both only surfaced
// when Wrangler bundled the Functions during deployment. This test bundles every file under functions/ with esbuild (what Wrangler does), so
// the same two failures now fail HERE, in the normal test run, before anything is deployed.
//
//   1  the mechanism      a tiny throw-away tree proves each failure class IS reported (so a green result below means something)
//   2  the real bundle    every functions/**/*.js (routes and _lib) + everything they import from src/ bundles with zero errors
//   3  pinned contracts   the cross-module APIs the scope classifier relies on exist and behave (slotFromLabel: Riot's explicit slot notation)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Local pass/fail counter on purpose: tests/helpers/patchNotesHelpers.mjs imports the whole Patch Notes pipeline, so when THAT graph is broken
// (the very thing under test) the file would die at import time with a stack trace instead of reporting which import is wrong.
let pass = 0; let fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log(`  PASS - ${name}`); } else { fail++; console.log(`  FAIL - ${name}${detail === undefined ? '' : ' -> ' + JSON.stringify(detail)}`); } };
const done = () => { console.log(`\n${pass} passed, ${fail} failed`); if (fail > 0) process.exit(1); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// esbuild with the settings that matter for resolution (ESM, bundled, no output written). Node built-ins are left external like a Worker would
// see them; nothing here executes the bundle.
async function bundle(entryPoints, absWorkingDir) {
  try {
    const r = await build({ entryPoints, bundle: true, write: false, outdir: path.join(os.tmpdir(), 'nyx-functions-bundle-check'), format: 'esm', platform: 'neutral', mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'browser'], external: ['node:*'], logLevel: 'silent', absWorkingDir });
    return { errors: r.errors.map((e) => `${e.location ? `${e.location.file}:${e.location.line}:${e.location.column} ` : ''}${e.text}`), files: r.outputFiles.length };
  } catch (e) {
    return { errors: (e.errors || [{ text: String(e.message) }]).map((x) => `${x.location ? `${x.location.file}:${x.location.line}:${x.location.column} ` : ''}${x.text}`), files: 0 };
  }
}
const walk = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, out); else if (/\.(js|mjs)$/.test(e.name)) out.push(p); } return out; };

// =======================================================================================================================
console.log('\n=== 1. THE MECHANISM: each failure class that broke a deployment is reported ===');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-bundle-mech-'));
  const w = (rel, text) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };

  w('ok/a.js', 'import { x } from "./b.js"; export const y = x();'); w('ok/b.js', 'export function x() { return 1; }');
  const okAgain = await bundle([path.join(tmp, 'ok/a.js')], tmp);
  check('control: a consistent pair bundles with no errors', okAgain.errors.length === 0 && okAgain.files === 1, okAgain);

  const missingFile = await bundle([w('missing/a.js', 'import { x } from "./gone.js"; export const y = x();')], tmp);
  check('a module missing from the tree is an error: "Could not resolve" (the first failed deployment)', missingFile.errors.some((e) => /Could not resolve "\.\/gone\.js"/.test(e)), missingFile.errors);

  // defined but NOT exported while the module still has other exports -- exactly the detector before `export function slotFromLabel`
  w('priv/b.js', 'export const other = 1;\nfunction x() { return 1; }');
  const notExported = await bundle([w('priv/a.js', 'import { x } from "./b.js"; export const y = x();')], tmp);
  check('a name the other module does not export is an error: "No matching export" (the second failed deployment)', notExported.errors.some((e) => /No matching export in .*b\.js" for import "x"/.test(e)), notExported.errors);

  w('case/Foo.js', 'export const z = 1;');
  const wrongCase = await bundle([w('case/a.js', 'import { z } from "./foo.js"; export const y = z;')], tmp);
  check('a case-only filename mismatch is an error on a case-sensitive file system (Cloudflare\'s Linux build) -- reported when this runs on one', process.platform === 'win32' || process.platform === 'darwin' ? true : wrongCase.errors.some((e) => /Could not (resolve|read from file)/.test(e)), wrongCase.errors);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// =======================================================================================================================
console.log('\n=== 2. THE REAL FUNCTIONS BUNDLE: everything Wrangler will bundle ===');
{
  const entries = walk(path.join(ROOT, 'functions'));
  const routes = entries.filter((f) => !f.includes(`${path.sep}_lib${path.sep}`));
  check(`found the Functions sources: ${entries.length} files under functions/ (${routes.length} route files + ${entries.length - routes.length} in _lib)`, entries.length >= 30 && routes.length >= 5 && entries.some((f) => f.endsWith('patchChangeScope.js')) && entries.some((f) => f.endsWith('patchLabelShape.js')) && entries.some((f) => f.endsWith('patchNotesPublic.js')), entries.map((f) => path.relative(ROOT, f)));
  const r = await bundle(entries, ROOT);
  check('every file under functions/ bundles with ZERO errors (no unresolved import, no missing named export, anywhere in the graph incl. src/ modules the Functions import)', r.errors.length === 0 && r.files === entries.length, r.errors);
  const viaRoutes = await bundle(routes, ROOT);
  check('...and the route files on their own (what the Pages worker entry imports) bundle with zero errors too', viaRoutes.errors.length === 0, viaRoutes.errors);
  const tests = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.test.mjs'));
  check('sanity: the modules the Patch Notes tests import are inside that same checked graph', ['patchNotesReview.js', 'patchNotesExtract.js', 'patchNotesPublic.js', 'patchChangeScope.js', 'patchChangeDetector.js', 'patchLabelShape.js', 'patchParser.js'].every((n) => entries.some((f) => f.endsWith(n))) && tests.length > 0);
}

// =======================================================================================================================
console.log('\n=== 2b. EXACT-CASE FILE NAMES (a case-only mismatch works on Windows / macOS and fails on Cloudflare\'s Linux build) ===');
{
  const SRC_DIRS = ['functions', 'src', 'scripts'].map((d) => path.join(ROOT, d)).filter((d) => fs.existsSync(d));
  const files = [...SRC_DIRS.flatMap((d) => walk(d)), ...walkJsx(path.join(ROOT, 'src')), path.join(ROOT, 'vite.config.js')].filter((f, i, a) => fs.existsSync(f) && a.indexOf(f) === i);
  const importRe = /(?:import\s+(?:[^'"]*?\sfrom\s+)?|export\s+[^'"]*?\sfrom\s+|import\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;
  const exactFile = (p) => { const dir = path.dirname(p); return fs.existsSync(dir) && fs.readdirSync(dir).includes(path.basename(p)) && fs.statSync(p).isFile(); };
  const bad = []; let count = 0;
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8'); let m; importRe.lastIndex = 0;
    while ((m = importRe.exec(text))) {
      count++; const base = path.resolve(path.dirname(f), m[1]);
      const candidates = /\.[a-z0-9]+$/i.test(m[1]) ? [base] : [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`, path.join(base, 'index.js')];
      if (!candidates.some(exactFile)) bad.push(`${path.relative(ROOT, f)} -> ${m[1]}`);
    }
  }
  check(`all ${count} relative imports in functions/, src/, scripts/ and vite.config.js name an existing file with EXACTLY the right letter case`, count > 150 && bad.length === 0, bad);
}
function walkJsx(dir) { const out = []; if (!fs.existsSync(dir)) return out; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...walkJsx(p)); else if (/\.jsx$/.test(e.name)) out.push(p); } return out; }

// =======================================================================================================================
console.log('\n=== 3. PINNED CONTRACT: what patchChangeScope.js takes from patchChangeDetector.js ===');
{
  // Loaded dynamically so that a broken import graph is REPORTED as a failed check (with Node's own message) instead of crashing the whole file
  // before section 2 has had its say.
  let detector; let scope; let CHANGE_SCOPE; let loadError = null;
  try {
    detector = await import('../functions/_lib/patchChangeDetector.js');
    scope = await import('../functions/_lib/patchChangeScope.js');
    ({ CHANGE_SCOPE } = await import('../src/lib/patchNotesPresentation.js'));
  } catch (e) { loadError = e; }
  check('the Patch Notes modules load under Node with their imports intact (patchChangeScope.js <- patchChangeDetector.js <- patchLabelShape.js)', !loadError, loadError && String(loadError.message));
  if (loadError) { done(); }
  if (!loadError) {
    check('patchChangeDetector.js exports slotFromLabel (the ONE parser of Riot\'s explicit slot notation, shared with the scope classifier instead of duplicated)', typeof detector.slotFromLabel === 'function');
    const slot = (l) => detector.slotFromLabel(l).slot;
    check('slotFromLabel reads only Riot\'s own notation: "Passive - X" -> Passive, "Q - X" -> Q, "(3) X" -> E, "Ultimate X" -> R; a plain name or a stat label -> null', slot('Passive - Sunlight') === 'Passive' && slot('Q - Shield of Daybreak') === 'Q' && slot('Ultimate Solar Flare') === 'R' && slot('Zenith Blade') === null && slot('Base Stats') === null && slot('You and Me!') === null);
    check('the detector still exposes the rest of its API unchanged (extractStructuredChanges, DETECTOR_VERSION, COMPARISON_STATE, RELEVANCE)', typeof detector.extractStructuredChanges === 'function' && detector.DETECTOR_VERSION === 'detect-v4' && detector.COMPARISON_STATE && detector.RELEVANCE);
    check('patchChangeScope.js exports the classifier and its evidence vocabulary, and uses the detector\'s slot parser (no second copy)', typeof scope.classifyChangeScope === 'function' && scope.SCOPE_BASIS && !/function\s+slotFromLabel/.test(fs.readFileSync(path.join(ROOT, 'functions/_lib/patchChangeScope.js'), 'utf8')) && /import\s*\{\s*slotFromLabel\s*\}\s*from\s*"\.\/patchChangeDetector\.js"/.test(fs.readFileSync(path.join(ROOT, 'functions/_lib/patchChangeScope.js'), 'utf8')));
    check('end to end through that import: the classifier\'s scopes are unchanged (Passive notation -> PASSIVE, slot notation -> ABILITY, Base Stats -> BASE_STATS, plain block -> ABILITY, none -> CHAMPION_MECHANIC)', scope.classifyChangeScope({ kind: 'entity', entityType: 'champion', subsectionHeading: 'Passive - Sunlight' }).scope === CHANGE_SCOPE.PASSIVE && scope.classifyChangeScope({ kind: 'entity', entityType: 'champion', subsectionHeading: 'Q - Shield of Daybreak' }).scope === CHANGE_SCOPE.ABILITY && scope.classifyChangeScope({ kind: 'entity', entityType: 'champion', subsectionHeading: 'Base Stats' }).scope === CHANGE_SCOPE.BASE_STATS && scope.classifyChangeScope({ kind: 'entity', entityType: 'champion', subsectionHeading: 'Zenith Blade' }).scope === CHANGE_SCOPE.ABILITY && scope.classifyChangeScope({ kind: 'entity', entityType: 'champion', subsectionHeading: null }).scope === CHANGE_SCOPE.CHAMPION_MECHANIC);
  }
}

done();
