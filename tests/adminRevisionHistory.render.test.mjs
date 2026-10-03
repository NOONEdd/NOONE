// Admin Patch Notes page -- render-level regression for `ReferenceError: revisions is not defined`.
// Plain Node ESM, no framework, no jsdom, no new dependency (esbuild ships with vite; react-dom/server ships with react-dom).
// Run directly:
//
//   node tests/adminRevisionHistory.render.test.mjs
//
// What went wrong in production: a deploy dropped two lines from RevisionHistory in src/pages/AdminPage.jsx,
//
//     const [open, setOpen] = useState(false);
//     const [revisions, setRevisions] = useState(null);
//
// while the rest of the component kept using them. Browsers have a global `window.open`, so the undeclared `open` was
// silently truthy, the panel rendered its body, and the first undeclared name it touched was `revisions` ->
// `ReferenceError: revisions is not defined`, which tripped the error boundary for EVERY expanded patch card.
// `vite build` cannot see undeclared identifiers, so the build was green.
//
// How this test works: it bundles the REAL AdminPage.jsx (plus react / react-dom/server / lucide-react, in memory) and
// renders the real ReportCard + RevisionHistory with renderToStaticMarkup, against current-architecture reports and
// legacy AI-era ones. The bundler transforms the source IN MEMORY ONLY (nothing in the repo is modified) to:
//   - export the two un-exported components,
//   - (seam, healthy build only) let a test start RevisionHistory in its open/loaded states -- server rendering cannot click,
//   - (mutants) delete the state declarations again, to PROVE this test would have caught the incident.
// `globalThis.open` is defined for the whole file to mimic the browser global that made the incident look the way it did.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { extract, makeChecker, SENNA_73 } from './helpers/patchNotesHelpers.mjs';
import { reviewSummary } from '../functions/_lib/patchNotesReview.js';

const { check, done } = makeChecker();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN = path.join(ROOT, 'src/pages/AdminPage.jsx');
const SRC = fs.readFileSync(ADMIN, 'utf8');

globalThis.open = function open() { return null; }; // the browser's window.open -- absent in Node, present in every browser

// ---- in-memory source transforms ------------------------------------------------------------------------------------
const OPEN_DECL = /^[ \t]*const \[open, setOpen\] = useState\(false\);[ \t]*\r?\n/m;
const REVISIONS_DECL = /^[ \t]*const \[revisions, setRevisions\] = useState\(null\);[ \t]*\r?\n/m;

function transform(src, { seam = false, dropOpen = false, dropRevisions = false } = {}) {
  let out = src;
  // mutants first (they match the ORIGINAL declarations), then the seam on whatever declarations remain
  if (dropOpen) out = out.replace(OPEN_DECL, '');
  if (dropRevisions) out = out.replace(REVISIONS_DECL, '');
  if (seam) { // start state taken from globals (read at first render only); only the healthy build uses this
    out = out.replace(OPEN_DECL, (m) => m.replace('useState(false)', 'useState(globalThis.__RH_OPEN__ === true)'));
    out = out.replace(REVISIONS_DECL, (m) => m.replace('useState(null)', 'useState(globalThis.__RH_REVISIONS__ === undefined ? null : globalThis.__RH_REVISIONS__)'));
  }
  return out + '\nexport { ReportCard, RevisionHistory };\n';
}

let bundleCounter = 0;
async function loadAdmin(opts) {
  const result = await build({
    stdin: {
      contents: `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; export { React, renderToStaticMarkup }; export * from ${JSON.stringify(ADMIN)};`,
      resolveDir: ROOT, loader: 'js', sourcefile: 'render-entry.js',
    },
    plugins: [{
      name: 'admin-page-transform',
      setup(b) { b.onLoad({ filter: /AdminPage\.jsx$/ }, () => ({ contents: transform(SRC, opts), loader: 'jsx', resolveDir: path.dirname(ADMIN) })); },
    }],
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'node18', jsx: 'automatic', logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: { js: "import { createRequire as __nyxCreateRequire } from 'node:module'; const require = __nyxCreateRequire(import.meta.url);" },
    loader: { '.css': 'empty', '.png': 'empty', '.webp': 'empty', '.jpg': 'empty', '.svg': 'empty' },
  });
  const file = path.join(os.tmpdir(), `nyx-admin-render-${process.pid}-${bundleCounter++}.mjs`);
  fs.writeFileSync(file, result.outputFiles[0].text);
  try { return await import(pathToFileURL(file).href); } finally { fs.rmSync(file, { force: true }); }
}

function tryRender(mod, element) {
  try { return { html: mod.renderToStaticMarkup(element) }; } catch (e) { return { error: e }; }
}

// ---- fixtures: current architecture + legacy AI-era shapes -------------------------------------------------------------
const base = { generatedAt: '2026-09-21T09:00:00.000Z', recommendedTierChanges: [], supportMetaAnalysis: '', adminNotes: '' };
const { dataset, legacy } = extract(SENNA_73, { patchVersion: '7.3a' });
const L = legacy('draft');
const currentReport = { ...base, id: '7-3a', patch: '7.3a', status: 'pending_review', revision: 1, sourceUrl: 'https://example.test/patch-7-3a', aiProvider: null, aiModel: null,
  championChanges: L.championChanges, itemChanges: L.itemChanges, runeChanges: L.runeChanges, systemChanges: L.systemChanges,
  patchNotes: dataset, patchNotesSummary: { ...reviewSummary(dataset), validation: dataset.validation } };
const aiEraBody = { championChanges: [{ championName: 'Leona', whatChanged: 'Q damage up', previousValue: '60', newValue: '70', type: 'Buff', supportImpact: 'x', impactSeverity: 'High', confidence: 'High' }],
  itemChanges: [{ itemName: 'Ardent Censer', whatChanged: 'Price down', type: 'Buff', championsAffected: ['Soraka'], impactSeverity: 'Low' }],
  runeChanges: [], systemChanges: [{ area: 'Objectives', whatChanged: 'Dragon timer', impactSeverity: 'Medium' }],
  recommendedTierChanges: [{ entityType: 'champion', entityName: 'Leona', from: 'A', to: 'S', confidence: 'High' }] };
const legacyReport = { ...base, ...aiEraBody, id: '7-3a', patch: '7.3a', status: 'published', revision: 1, aiProvider: 'anthropic', aiModel: 'claude-sonnet-4', analysisCoverage: { batches: { total: 2, failed: 0, notStarted: 0 } }, supportMetaAnalysis: 'AI-era analysis' };
const partialFailure = { ...base, ...aiEraBody, id: '7-2d', patch: '7.2d', status: 'partial_failure', revision: 3, aiProvider: 'anthropic', aiModel: 'claude-sonnet-4' };
const aiError = { ...base, id: '7-1', patch: '7.1', status: 'ai_error', revision: 2, championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [], adminNotes: 'AI provider timed out' };
const sourceUnavailable = { ...base, id: '7-0', patch: '7.0', status: 'source_unavailable', revision: 1, championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [] };
const emptyReport = { ...base, id: 'x', patch: null, status: 'pending_review', revision: 1, championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [] };

const CASES = [
  // (PatchNotesReview's default filter is "needs review" = pending AND not already in Academy, so a fully tracked entity like Senna is intentionally not listed; the panel header + accounting line prove the review panel itself rendered)
  ['current-architecture 7.3a (deterministic dataset)', currentReport, ['Patch 7.3a', 'Extracted deterministically from Riot', 'unaccounted blocks']],
  ['legacy AI-era 7.3a (published, flat arrays)', legacyReport, ['Patch 7.3a', 'Leona', 'Ardent Censer', 'Objectives', 'Legacy revision from the retired AI analyzer']],
  ['legacy partial_failure (rev 3)', partialFailure, ['Patch 7.2d', 'INCOMPLETE', 'Leona']],
  ['legacy ai_error (rev 2)', aiError, ['Patch 7.1', 'Re-scan Patch']],
  ['legacy source_unavailable', sourceUnavailable, ['Patch 7.0', 'Retry Source Fetch']],
  ['empty report (no changes, no patch number)', emptyReport, ['No Support-relevant changes identified in this patch.']],
];
const roster = { champions: [], items: [], runes: [] };

// ======================================================================================================================
console.log('\n=== 0. The component still declares its own open / revisions state (the two lines the deploy dropped) ===');
check('RevisionHistory declares `const [open, setOpen] = useState(false)`', OPEN_DECL.test(SRC));
check('RevisionHistory declares `const [revisions, setRevisions] = useState(null)`', REVISIONS_DECL.test(SRC));

const healthy = await loadAdmin({ seam: true });
const actions = [];
const props = (report, extra = {}) => ({ report, onAction: (...a) => actions.push(a), onReanalyze: (...a) => actions.push(a), busy: false, initiallyExpanded: true, roster, publishedRevision: 1, refreshToken: 0, ...extra });

console.log('\n=== 1. ReportCard (which embeds RevisionHistory) renders for current, legacy, partial_failure, ai_error and empty reports ===');
for (const [label, report, expected] of CASES) {
  const r = tryRender(healthy, healthy.React.createElement(healthy.ReportCard, props(report)));
  check(`${label}: renders without throwing${r.error ? ` (${r.error.name}: ${r.error.message})` : ''}`, !r.error, r.error && String(r.error));
  if (r.html) {
    check(`${label}: the "Revision history" panel is present`, r.html.includes('Revision history'));
    check(`${label}: shows its own content (${expected.join(' | ')})`, expected.every((t) => r.html.includes(t)), expected.filter((t) => !r.html.includes(t)));
  }
}

console.log('\n=== 2. RevisionHistory itself, closed (the default) ===');
for (const [label, report] of CASES) {
  const r = tryRender(healthy, healthy.React.createElement(healthy.RevisionHistory, { reportId: report.id, onAction: (...a) => actions.push(a), busy: false, refreshToken: 0 }));
  check(`${label}: RevisionHistory renders closed, no ReferenceError`, !r.error && r.html.includes('Revision history'), r.error && String(r.error));
}

console.log('\n=== 3. RevisionHistory open: loading / empty / current + 7.3a + older revisions of every historical status ===');
{
  const render = (open, revisions) => { globalThis.__RH_OPEN__ = open; globalThis.__RH_REVISIONS__ = revisions; try { return tryRender(healthy, healthy.React.createElement(healthy.RevisionHistory, { reportId: '7-3a', onAction: (...a) => actions.push(a), busy: false, refreshToken: 0 })); } finally { delete globalThis.__RH_OPEN__; delete globalThis.__RH_REVISIONS__; } };

  const loading = render(true, undefined);
  check('seam sanity: open=true really opens the panel (otherwise sections 3 would prove nothing)', loading.html && loading.html.includes('Loading'), loading.error ? String(loading.error) : loading.html);
  const none = render(true, []);
  check('EMPTY revision list renders the "no earlier revisions" state', none.html && none.html.includes('No earlier revisions'), none.error ? String(none.error) : none.html);
  const one = render(true, [{ revision: 1, status: 'published', generatedAt: '2026-09-21T09:00:00.000Z' }]);
  check('a single (current) revision renders the same safe state, no list', one.html && one.html.includes('No earlier revisions') && !one.html.includes('Revision 1'), one.error ? String(one.error) : one.html);

  const statuses = ['archived', 'published', 'ai_error', 'partial_failure', 'pending_review', 'approved', 'unpublished', 'source_unavailable'];
  const many = render(true, statuses.map((status, i) => ({ revision: i + 1, status, generatedAt: '2026-09-21T09:00:00.000Z', patch: '7.3a' })));
  check('current + 7.3a + older revisions all render as list rows (one per revision)', many.html && statuses.every((_, i) => many.html.includes(`Revision ${i + 1}`)), many.error ? String(many.error) : many.html);
  check('historical statuses ai_error / partial_failure render with a label (not blank, not a crash)', many.html && /ai.?error/i.test(many.html) && /partial/i.test(many.html), many.html);
  const restoreButtons = (many.html.match(/>Restore</g) || []).length;
  check('Restore is offered ONLY for approved / unpublished / archived revisions (3), never for published, ai_error, partial_failure, pending_review or source_unavailable', restoreButtons === 3, restoreButtons);
  check('rendering the list is read-only: no action callback fired while rendering any state above', actions.length === 0, actions);
}

// ======================================================================================================================
console.log('\n=== 4. THIS TEST CATCHES THE INCIDENT: rebuild the page with the state declarations removed again ===');
{
  const incident = await loadAdmin({ dropOpen: true, dropRevisions: true });
  const r = tryRender(incident, incident.React.createElement(incident.ReportCard, props(legacyReport)));
  check('both declarations removed (the exact deploy regression) -> render throws ReferenceError: revisions is not defined', r.error instanceof ReferenceError && /revisions is not defined/.test(r.error.message), r.error ? String(r.error) : 'rendered fine -- the test would have MISSED the incident');
  const r2 = tryRender(incident, incident.React.createElement(incident.ReportCard, props(currentReport)));
  check('...and it fails for a current-architecture report too (the crash was never specific to legacy data)', r2.error instanceof ReferenceError && /revisions is not defined/.test(r2.error.message), r2.error ? String(r2.error) : 'rendered fine');

  const onlyRevisions = await loadAdmin({ seam: true, dropRevisions: true });
  globalThis.__RH_OPEN__ = true;
  const r3 = tryRender(onlyRevisions, onlyRevisions.React.createElement(onlyRevisions.RevisionHistory, { reportId: '7-3a', onAction() {}, busy: false, refreshToken: 0 }));
  delete globalThis.__RH_OPEN__;
  check('only `revisions` removed (panel opened) -> still caught as ReferenceError: revisions is not defined', r3.error instanceof ReferenceError && /revisions is not defined/.test(r3.error.message), r3.error ? String(r3.error) : 'rendered fine');
}

// ======================================================================================================================
console.log('\n=== 5. Opening a revision in the UI only ever issues GET requests ===');
{
  const sliceFn = (name) => { const start = SRC.indexOf(`function ${name}(`); const next = SRC.indexOf('\nfunction ', start + 1); const nextExport = SRC.indexOf('\nexport default function', start + 1); const end = [next, nextExport].filter((i) => i > -1).sort((a, b) => a - b)[0]; return SRC.slice(start, end > -1 ? end : undefined); };
  for (const name of ['RevisionHistory', 'ReportCardLoader']) {
    const body = sliceFn(name);
    const fetches = body.match(/fetch\([^;]*;/g) || [];
    check(`${name}: has fetch calls and none of them sets a method or body (GET only)`, fetches.length > 0 && fetches.every((f) => !/method\s*:|body\s*:/.test(f)), fetches);
  }
  const rh = sliceFn('RevisionHistory');
  const actionCalls = rh.match(/onAction\(/g) || [];
  check('RevisionHistory\'s only mutation is the explicit, window.confirm-guarded Restore button (one onAction call, "restore")', actionCalls.length === 1 && /window\.confirm\([^)]*Restore revision[\s\S]*?onAction\(reportId, "restore"/.test(rh), actionCalls.length);
}

done();
