// Patch Notes -- reviewer control over whether a champion subsection shows its ability icon ("Icon / Visual": Auto | Show | Hide).
// Plain Node ESM against the REAL review layer, public view, handlers and UI components (mock KV, no network, no AI, no production data).
// Run directly:
//
//   node tests/patchNotesVisualOverride.test.mjs
//
// The model (kept deliberately small):
//     scope (extraction: what the change IS)  --+
//                                               +--> effectiveVisual(scope, override) --> public subsection.visual ("SHOW"|"HIDE") --> page
//     dataset.subsectionReview[key].visualOverride (review: how it is DISPLAYED) --+
//   ABILITY / PASSIVE -> SHOW by default; BASE_STATS / CHAMPION_MECHANIC -> HIDE by default; an explicit SHOW / HIDE always wins; absent = Auto.
//   scope, scopeBasis, sourceHeading and changeId are never touched by the override, and the override is never touched by scope / heading edits.
//
//   1  policy matrix   the 8 required scope x override cases, end to end: dataset -> public view -> rendered page (an icon file exists for EVERY heading)
//   2  Auto / old data a missing visualOverride behaves as Auto; datasets stored before scope AND visualOverride existed render exactly as before
//   3  independence    scope override <-> visual override <-> heading edit never wipe one another; extraction layer, scope, sourceHeading, changeId untouched
//   4  persistence     regeneration (mergeReviewState + real rescan handlers), publish, section remove/restore
//   5  validation      bad values rejected, Auto stored as "absent", no reviewer field leaks into the public view
//   6  admin UI        the "Icon / Visual" select: Auto / Show / Hide, reflects the stored value, champion subsections only

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestPost as checkPost } from '../functions/api/admin/patch-check.js';
import { onRequestGet as adminGet, onRequestPost as reportsPost } from '../functions/api/admin/patch-reports.js';
import { onRequestGet as publicGet } from '../functions/api/patch-reports.js';
import { createSessionToken } from '../functions/_lib/adminAuth.js';
import { SOURCE_TEXT_VERSION } from '../functions/_lib/patchText.js';
import { applyReviewOps, mergeReviewState, sectionKeyOf, subsectionKeyOf } from '../functions/_lib/patchNotesReview.js';
import { toPublicView, publicPreview } from '../functions/_lib/patchNotesPublic.js';
import { effectiveVisual, defaultVisualForScope, normalizeVisualOverride, VISUAL_OVERRIDE_OPTIONS, CHANGE_SCOPE } from '../src/lib/patchNotesPresentation.js';
import { bundleModule, src } from './helpers/renderBundle.mjs';
import { extract, makeChecker } from './helpers/patchNotesHelpers.mjs';

const { check, done } = makeChecker();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => fs.readFileSync(path.join(ROOT, 'tests/fixtures', name), 'utf8');
const REAL_TEXT = fixture('riot-wild-rift-7-3a-champion-changes.txt');
const KV_BEFORE = JSON.parse(fixture('kv-state-7-3a-before-ability-label-fix.json')); // stored by an engine that had neither `scope` nor `visualOverride`
const SLUG = 'wild-rift-patch-notes-7-3a';
const fetchCalls = [];
globalThis.fetch = async (url) => { fetchCalls.push(String(url)); throw new Error('unexpected network call: ' + url); };

// one champion, one section of each scope. "Crit Mechanics" is a named block Riot gave its own heading; a reviewer marks it a champion mechanic
// (the only way a headed section becomes CHAMPION_MECHANIC) -- the same override the scope feature added.
const ROSTER = { championRoster: [{ id: 'leona', name: 'Leona', tier: 'S' }], itemRoster: [{ id: 'edge-of-night', name: 'Edge of Night', info: '' }] };
const PAGE = `## CHAMPION ADJUSTMENTS\n\n### Leona\n\nBase Stats\n\n- Armor: 28 → 30\n\nPassive - Sunlight\n\n- Damage: 20 → 25\n\nZenith Blade\n\n- Cooldown: 14 → 12\n\nCrit Mechanics\n\n- Critical Strike Damage: 175% → 170%\n\n## ITEM ADJUSTMENTS\n\n### Edge of Night\n\nSpell Shield\n\n- Cooldown: 40 → 35\n`;
const HEADS = { 'Base Stats': 'BASE_STATS', 'Passive - Sunlight': 'PASSIVE', 'Zenith Blade': 'ABILITY', 'Crit Mechanics': 'CHAMPION_MECHANIC' };
const fresh = () => {
  const r = extract(PAGE, { rosters: ROSTER });
  const by = (h) => r.changes.find((c) => c.subsection && c.subsection.sourceHeading === h);
  applyReviewOps(r.dataset, [{ op: 'setSubsectionScope', subsectionKey: subsectionKeyOf(by('Crit Mechanics')), scope: 'CHAMPION_MECHANIC' }]);
  return { ...r, by, key: (h) => subsectionKeyOf(by(h)) };
};
// an icon file exists for EVERY heading (and every spelling the lookup tries), so "no icon" can only come from the policy
const ICONS = { leona: Object.fromEntries(['base-stats', 'passive-sunlight', 'sunlight', 'zenith-blade', 'crit-mechanics'].map((k) => [k, `/assets/abilities/leona/${k}.webp`])) };
const asReport = (dataset) => ({ id: 'p', patch: '7.3a', status: 'published', revision: 1, generatedAt: '2026-10-05T09:00:00.000Z', sourceUrl: 'https://example.test', recommendedTierChanges: [], supportMetaAnalysis: '', patchNotes: dataset });
const pubOf = (dataset) => toPublicView(asReport(dataset), []);
const subOf = (pub, heading) => pub.championChanges.find((e) => e.championId === 'leona').subsections.find((s) => s.sourceHeading === heading);

const mods = new Map();
const bundle = async (key, entry, opts) => { if (!mods.has(key)) mods.set(key, await bundleModule(entry, opts)); return mods.get(key); };
const PAGE_ENTRY = `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; export { React, renderToStaticMarkup }; export { PublicReportCard } from ${src('src/pages/PatchNotesPage.jsx')};`;
const renderPage = async (view, abilityIndex = ICONS) => { const m = await bundle(`page:${JSON.stringify(abilityIndex)}`, PAGE_ENTRY, { abilityIndex }); return m.renderToStaticMarkup(m.React.createElement(m.PublicReportCard, { report: view, roster: { champions: [], items: [], runes: [] }, initiallyExpanded: true })); };
const card = (html, name) => html.split('class="patch-entry-card"').find((c) => c.includes(`>${name}<`)) || '';
const headOf = (html, heading, entity = 'Leona') => (card(html, entity).split('class="patch-sub-head"').slice(1).map((h) => h.split('class="patch-sub-change"')[0]).find((h) => h.includes(`>${heading}<`)) || '');
const hasIcon = (head) => head.includes('<img class="ability-icon"');
const hasPlaceholder = (head) => head.includes('ability-icon-fallback');

// =======================================================================================================================
console.log('\n=== 0. the policy function ===');
{
  const S = CHANGE_SCOPE;
  check('defaults: ABILITY / PASSIVE -> SHOW; BASE_STATS / CHAMPION_MECHANIC / ITEM / RUNE / SYSTEM / unknown -> HIDE', [S.ABILITY, S.PASSIVE].every((s) => defaultVisualForScope(s) === 'SHOW') && [S.BASE_STATS, S.CHAMPION_MECHANIC, S.ITEM, S.RUNE, S.SYSTEM, undefined, null, 'WHAT'].every((s) => defaultVisualForScope(s) === 'HIDE'));
  check('an explicit override ALWAYS wins, in both directions, for every scope', Object.values(S).every((s) => effectiveVisual(s, 'SHOW') === 'SHOW' && effectiveVisual(s, 'HIDE') === 'HIDE'));
  check('absent / null / "" / "AUTO" / garbage = Auto = the scope default (override spellings are case-insensitive)', [undefined, null, '', 'AUTO', 'auto', 'maybe', 7, {}].every((o) => effectiveVisual(S.ABILITY, o) === 'SHOW' && effectiveVisual(S.BASE_STATS, o) === 'HIDE') && effectiveVisual(S.BASE_STATS, 'show') === 'SHOW' && normalizeVisualOverride(' Hide ') === 'HIDE');
  check('the admin choices are exactly Auto / Show / Hide (Auto stored as "absent")', JSON.stringify(VISUAL_OVERRIDE_OPTIONS) === '[["","Auto"],["SHOW","Show"],["HIDE","Hide"]]');
}

// =======================================================================================================================
console.log('\n=== 1. POLICY MATRIX, end to end: dataset -> public view -> rendered page ===');
{
  const MATRIX = [
    ['ABILITY', 'AUTO', 'SHOW'], ['PASSIVE', 'AUTO', 'SHOW'], ['BASE_STATS', 'AUTO', 'HIDE'], ['CHAMPION_MECHANIC', 'AUTO', 'HIDE'],
    ['BASE_STATS', 'SHOW', 'SHOW'], ['CHAMPION_MECHANIC', 'SHOW', 'SHOW'], ['ABILITY', 'HIDE', 'HIDE'], ['PASSIVE', 'HIDE', 'HIDE'],
  ];
  const headingFor = (scope) => Object.keys(HEADS).find((h) => HEADS[h] === scope);
  const n = { i: 0 };
  for (const [scope, override, expected] of MATRIX) {
    n.i++;
    const f = fresh(); const heading = headingFor(scope);
    if (override !== 'AUTO') applyReviewOps(f.dataset, [{ op: 'setSubsectionVisual', subsectionKey: f.key(heading), visual: override }]);
    const sub = subOf(pubOf(f.dataset), heading);
    const html = await renderPage(pubOf(f.dataset));
    const head = headOf(html, heading);
    const shown = hasIcon(head);
    check(`${String(n.i)}. ${scope} + ${override.padEnd(4)} -> icon ${expected === 'SHOW' ? 'SHOWN ' : 'HIDDEN'}   (public subsection.visual = ${expected}; scope on the page data = ${scope})`, sub.scope === scope && sub.visual === expected && shown === (expected === 'SHOW') && (expected === 'SHOW' ? head.includes(`src="/assets/abilities/leona/`) && head.indexOf('ability-icon') < head.indexOf('patch-sub-title') : !hasPlaceholder(head) && !head.includes('<img')), { scope: sub.scope, visual: sub.visual, head: head.slice(0, 140) });
    check(`   ...and the heading and the change line under "${heading}" are on the page either way`, head.includes(`>${heading}<`) && card(html, 'Leona').includes(f.by(heading).displayDefaults.displayBody));
  }
  // the whole section at once: each of the four sections independent of the others
  const f = fresh();
  applyReviewOps(f.dataset, [{ op: 'setSubsectionVisual', subsectionKey: f.key('Base Stats'), visual: 'SHOW' }, { op: 'setSubsectionVisual', subsectionKey: f.key('Zenith Blade'), visual: 'HIDE' }]);
  const html = await renderPage(pubOf(f.dataset));
  check('one champion, four sections: Base Stats SHOWN (override), Passive SHOWN (auto), Zenith Blade HIDDEN (override), Crit Mechanics HIDDEN (auto) -- each section decided on its own', [hasIcon(headOf(html, 'Base Stats')), hasIcon(headOf(html, 'Passive - Sunlight')), hasIcon(headOf(html, 'Zenith Blade')), hasIcon(headOf(html, 'Crit Mechanics'))].join() === 'true,true,false,false');
  check('Show uses the EXISTING lookup, keyed on Riot\'s heading: Base Stats -> leona/base-stats.webp; with no such file the placeholder appears (the section still renders)', headOf(html, 'Base Stats').includes('src="/assets/abilities/leona/base-stats.webp"') && hasPlaceholder(headOf(await renderPage(pubOf(f.dataset), {}), 'Base Stats')) && headOf(await renderPage(pubOf(f.dataset), {}), 'Base Stats').includes('>Base Stats<'));
  const itemHtml = await renderPage(pubOf(f.dataset));
  check('items are unaffected: no icon column for an item subsection (icons are champion sections only)', !card(itemHtml, 'Edge of Night').includes('ability-icon'));
}

// =======================================================================================================================
console.log('\n=== 2. AUTO IS THE DEFAULT; OLD DATA WITHOUT THE FIELD RENDERS AS BEFORE ===');
{
  const f = fresh();
  check('a freshly extracted dataset has no visualOverride anywhere (nothing is written until a reviewer chooses)', !JSON.stringify(f.dataset.subsectionReview).includes('visualOverride') && !JSON.stringify(f.dataset.changes).includes('visualOverride'));
  const pub = pubOf(f.dataset);
  check('missing visualOverride = Auto: the four sections resolve to SHOW / SHOW / SHOW / HIDE exactly as the scope defaults say (Base Stats HIDE, Passive SHOW, Zenith Blade SHOW, Crit Mechanics HIDE)', [subOf(pub, 'Base Stats').visual, subOf(pub, 'Passive - Sunlight').visual, subOf(pub, 'Zenith Blade').visual, subOf(pub, 'Crit Mechanics').visual].join() === 'HIDE,SHOW,SHOW,HIDE');
  applyReviewOps(f.dataset, [{ op: 'setSubsectionVisual', subsectionKey: f.key('Base Stats'), visual: 'SHOW' }, { op: 'setSubsectionVisual', subsectionKey: f.key('Base Stats'), visual: 'AUTO' }]);
  check('choosing Auto again REMOVES the field (back to exactly the untouched state, not a stored "AUTO")', !('visualOverride' in (f.dataset.subsectionReview[f.key('Base Stats')] || {})) && subOf(pubOf(f.dataset), 'Base Stats').visual === 'HIDE');

  // data stored by the previous engine: no `scope`, no `visualOverride`, no subsectionReview entries for these sections
  const old = JSON.parse(KV_BEFORE[`patch-intel:report:${SLUG}:1`]).patchNotes;
  const snapshot = JSON.stringify(old);
  check('setup: the stored 7.3a dataset (written before scope AND visualOverride existed) carries neither field', old.changes.every((c) => c.scope === undefined) && !JSON.stringify(old.subsectionReview || {}).includes('visualOverride'));
  const pubOld = toPublicView({ ...asReport(old), id: SLUG }, []);
  const idx = { hwei: { 'signature-of-the-visionary': '/h1.webp', 'subject-disaster-devastating-fire': '/h2.webp', 'subject-disaster-severing-bolt': '/h3.webp', 'spiraling-despair': '/h4.webp', 'base-stats': '/hbs.webp' }, senna: { 'base-stats': '/assets/abilities/senna/base-stats.webp' }, swain: { 'ravenous-flock': '/s1.webp', nevermove: '/s2.webp' } };
  const html = await renderPage(pubOld, idx);
  check('old data, public view: Hwei\'s four ability sections and Swain\'s two get their icons; Senna\'s Base Stats section (file present!) gets none -- exactly the behaviour before this feature', ['Signature of the Visionary', 'Subject: Disaster - Devastating Fire', 'Subject: Disaster - Severing Bolt', 'Spiraling Despair'].every((h) => hasIcon(headOf(html, h, 'Hwei'))) && ['Ravenous Flock', 'Nevermove'].every((h) => hasIcon(headOf(html, h, 'Swain'))) && !card(html, 'Senna').includes('ability-icon') && card(html, 'Senna').includes('>Base Stats<'));
  check('...every public subsection carries an effective `visual`, and no reviewer field (visualOverride) is public', pubOld.championChanges.every((e) => e.subsections.every((s) => s.visual === 'SHOW' || s.visual === 'HIDE')) && !JSON.stringify(pubOld).includes('visualOverride'));
  check('reading it changed nothing in the stored data (pure derivation, no migration, nothing rewritten)', JSON.stringify(old) === snapshot);
  const pre = publicPreview({ ...asReport(old), id: SLUG }, []);
  check('the admin preview derives visual + default for old data too (override null), so the review UI works on it with no rescan', Object.values(pre.subsections).every((s) => s.visualOverride === null && (s.visual === 'SHOW' || s.visual === 'HIDE') && s.visualDefault === s.visual));
}

// =======================================================================================================================
console.log('\n=== 3. INDEPENDENCE: scope, visual override, heading edit and the extraction layer never touch one another ===');
{
  const f = fresh();
  const target = f.by('Base Stats'); const key = f.key('Base Stats');
  const extractionOf = () => JSON.stringify(f.dataset.changes.map((c) => [c.changeId, c.scope, c.scopeBasis, c.subsection, c.normalizedData, c.originalSourceText, c.provenance, c.ownership, c.comparisonState]));
  const before = extractionOf(); const idBefore = target.changeId; const headingBefore = target.subsection.sourceHeading;

  applyReviewOps(f.dataset, [{ op: 'setSubsectionScope', subsectionKey: key, scope: 'CHAMPION_MECHANIC' }]);
  applyReviewOps(f.dataset, [{ op: 'setSubsectionVisual', subsectionKey: key, visual: 'SHOW' }]);
  check('setting the visual override leaves the scope override exactly as it was; both are stored in the one subsection entry', f.dataset.subsectionReview[key].scope === 'CHAMPION_MECHANIC' && f.dataset.subsectionReview[key].visualOverride === 'SHOW', f.dataset.subsectionReview[key]);
  check('(12) ...and the reverse: changing the scope override afterwards leaves the visual override alone', (() => { applyReviewOps(f.dataset, [{ op: 'setSubsectionScope', subsectionKey: key, scope: 'ABILITY' }]); const e = f.dataset.subsectionReview[key]; applyReviewOps(f.dataset, [{ op: 'setSubsectionScope', subsectionKey: key, scope: 'CHAMPION_MECHANIC' }]); return e.scope === 'ABILITY' && e.visualOverride === 'SHOW'; })());
  check('(14) the extraction layer is byte-identical after every override: changeId, scope, scopeBasis, subsection.sourceHeading, normalized data, source text, provenance, ownership', extractionOf() === before);
  check('(13)/(14) ...spelled out for the target change: same changeId, scope BASE_STATS / riot_stats_heading, sourceHeading "Base Stats"', target.changeId === idBefore && target.scope === 'BASE_STATS' && target.scopeBasis === 'riot_stats_heading' && target.subsection.sourceHeading === headingBefore && headingBefore === 'Base Stats');

  // heading rename (the op that used to replace the whole entry)
  applyReviewOps(f.dataset, [{ op: 'editSubsectionTitle', subsectionKey: key, displayHeading: 'Stat tweaks' }]);
  check('(11) a heading RENAME keeps both the scope override and the visual override', f.dataset.subsectionReview[key].displayHeading === 'Stat tweaks' && f.dataset.subsectionReview[key].scope === 'CHAMPION_MECHANIC' && f.dataset.subsectionReview[key].visualOverride === 'SHOW', f.dataset.subsectionReview[key]);
  applyReviewOps(f.dataset, [{ op: 'editSubsectionTitle', subsectionKey: key, displayHeading: '' }]);
  check('...clearing the heading (back to Riot\'s) keeps both overrides too', !('displayHeading' in f.dataset.subsectionReview[key]) && f.dataset.subsectionReview[key].scope === 'CHAMPION_MECHANIC' && f.dataset.subsectionReview[key].visualOverride === 'SHOW');
  applyReviewOps(f.dataset, [{ op: 'editSubsectionTitle', subsectionKey: key, displayHeading: 'Stat tweaks' }, { op: 'setSubsectionVisual', subsectionKey: key, visual: null }]);
  check('clearing the visual override keeps the heading edit and the scope override', f.dataset.subsectionReview[key].displayHeading === 'Stat tweaks' && f.dataset.subsectionReview[key].scope === 'CHAMPION_MECHANIC' && !('visualOverride' in f.dataset.subsectionReview[key]));
  applyReviewOps(f.dataset, [{ op: 'setSubsectionVisual', subsectionKey: key, visual: 'SHOW' }, { op: 'setSubsectionScope', subsectionKey: key, scope: null }, { op: 'editSubsectionTitle', subsectionKey: key, displayHeading: '' }]);
  check('an entry that still holds a visual override is NOT deleted when the scope and heading are cleared; clearing the last field removes the entry', f.dataset.subsectionReview[key].visualOverride === 'SHOW' && Object.keys(f.dataset.subsectionReview[key]).sort().join() === 'reviewedAt,visualOverride' && (applyReviewOps(f.dataset, [{ op: 'setSubsectionVisual', subsectionKey: key, visual: '' }]), !(key in f.dataset.subsectionReview)));

  // public: a renamed section keeps its icon decision AND its icon lookup stays on Riot's heading
  applyReviewOps(f.dataset, [{ op: 'setSubsectionVisual', subsectionKey: key, visual: 'SHOW' }, { op: 'editSubsectionTitle', subsectionKey: key, displayHeading: 'Stat tweaks' }]);
  const html = await renderPage(pubOf(f.dataset), { leona: { ...ICONS.leona, 'stat-tweaks': '/assets/abilities/leona/stat-tweaks.webp' } });
  const head = headOf(html, 'Stat tweaks');
  check('renamed + Show: the page shows "Stat tweaks" WITH the icon, and the icon is the one for Riot\'s heading (base-stats.webp), never for the display text (stat-tweaks.webp exists and is not used)', hasIcon(head) && head.includes('src="/assets/abilities/leona/base-stats.webp"') && !html.includes('stat-tweaks.webp') && subOf(pubOf(f.dataset), 'Base Stats').title === 'Stat tweaks' && subOf(pubOf(f.dataset), 'Base Stats').sourceHeading === 'Base Stats');
  check('the Base Stats section\'s OTHER sections are unaffected by this section\'s override (Passive still SHOW, Crit Mechanics still HIDE)', subOf(pubOf(f.dataset), 'Passive - Sunlight').visual === 'SHOW' && subOf(pubOf(f.dataset), 'Crit Mechanics').visual === 'HIDE');
}

// =======================================================================================================================
console.log('\n=== 4. PERSISTENCE: regeneration, rescan, publish, remove / restore ===');
{
  const f = fresh();
  applyReviewOps(f.dataset, [{ op: 'setSubsectionVisual', subsectionKey: f.key('Base Stats'), visual: 'SHOW' }, { op: 'setSubsectionVisual', subsectionKey: f.key('Zenith Blade'), visual: 'HIDE' }, { op: 'editSubsectionTitle', subsectionKey: f.key('Zenith Blade'), displayHeading: 'Blade' }]);
  const regen = mergeReviewState(extract(PAGE, { rosters: ROSTER }).dataset, f.dataset);
  check('(10) REGENERATION (mergeReviewState): both visual overrides, the scope override and the heading edit ride along', regen.subsectionReview[f.key('Base Stats')].visualOverride === 'SHOW' && regen.subsectionReview[f.key('Zenith Blade')].visualOverride === 'HIDE' && regen.subsectionReview[f.key('Zenith Blade')].displayHeading === 'Blade' && regen.subsectionReview[f.key('Crit Mechanics')].scope === 'CHAMPION_MECHANIC');
  const pubRegen = pubOf(regen);
  check('...and the regenerated dataset renders them (Base Stats SHOW, Zenith Blade HIDE) with the fresh extraction underneath', subOf(pubRegen, 'Base Stats').visual === 'SHOW' && subOf(pubRegen, 'Zenith Blade').visual === 'HIDE' && regen.changes.every((c) => f.dataset.changes.some((o) => o.changeId === c.changeId)));

  // section remove / restore (sectionReview is a different map; the subsection entries must not be disturbed)
  const secKey = sectionKeyOf(f.by('Base Stats'));
  applyReviewOps(f.dataset, [{ op: 'removeSection', sectionKey: secKey }]);
  const removedPub = pubOf(f.dataset);
  applyReviewOps(f.dataset, [{ op: 'restoreSection', sectionKey: secKey }]);
  check('remove / restore of the whole entity section keeps every subsection override (and the section is hidden while removed, back afterwards)', removedPub.championChanges.length === 0 && f.dataset.subsectionReview[f.key('Base Stats')].visualOverride === 'SHOW' && f.dataset.subsectionReview[f.key('Zenith Blade')].visualOverride === 'HIDE' && subOf(pubOf(f.dataset), 'Base Stats').visual === 'SHOW');
  const chg = f.by('Base Stats');
  applyReviewOps(f.dataset, [{ op: 'remove', changeId: chg.changeId }]);
  applyReviewOps(f.dataset, [{ op: 'restore', changeId: chg.changeId }]);
  check('remove / restore of an individual change keeps the section\'s override', f.dataset.subsectionReview[f.key('Base Stats')].visualOverride === 'SHOW');

  // real handlers: stored pre-feature revision 1 -> review -> rescan -> publish
  const store = new Map(Object.entries(KV_BEFORE)); const writes = [];
  const kv = { get: async (k) => (store.has(k) ? store.get(k) : null), put: async (k, v) => { writes.push(k); store.set(k, String(v)); }, delete: async (k) => { writes.push(`DELETE ${k}`); store.delete(k); }, list: async ({ prefix = '' } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: null }) };
  const COACH = JSON.stringify({ revision: 4, champions: { senna: { tier: 'A' } }, items: {}, runes: {}, decisionTrees: {}, patch: '7.2b' });
  store.set('coach-overrides', COACH);
  store.set('riot-latest-patch-meta', JSON.stringify({ slug: SLUG })); store.set(`riot-fallback-full-content:${SLUG}:${SOURCE_TEXT_VERSION}`, JSON.stringify({ content: REAL_TEXT, truncated: false }));
  const env = { COACH_KV: kv, ADMIN_SESSION_SECRET: 'test-secret', ANTHROPIC_API_KEY: 'would-be-used-if-AI-ran' };
  const cookie = `academy_admin_session=${await createSessionToken(env)}`;
  const post = (url, body) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const act = async (body) => { const r = await reportsPost({ request: post('https://x/api/admin/patch-reports', body), env }); return { status: r.status, body: await r.json() }; };
  const getRev = async (revision) => (await (await adminGet({ request: new Request(`https://x/api/admin/patch-reports?id=${SLUG}&revision=${revision}`, { headers: { Cookie: cookie } }), env })).json()).report;
  const pubApi = async () => (await (await publicGet({ request: new Request('https://x/api/patch-reports'), env })).json()).reports.find((r) => r.id === SLUG);

  const rev1 = await getRev(1);
  const sen = rev1.patchNotes.changes.find((c) => c.entity && c.entity.name === 'Senna'); const yu = rev1.patchNotes.changes.find((c) => c.entity && c.entity.name === 'Yuumi');
  const sKey = subsectionKeyOf(sen); const hKey = subsectionKeyOf(rev1.patchNotes.changes.find((c) => c.subsection && c.subsection.sourceHeading === 'Spiraling Despair'));
  const saved = await act({ id: SLUG, action: 'review', revision: 1, ops: [
    { op: 'setSubsectionVisual', subsectionKey: sKey, visual: 'SHOW' },
    { op: 'setSubsectionScope', subsectionKey: sKey, scope: 'CHAMPION_MECHANIC' },
    { op: 'editSubsectionTitle', subsectionKey: sKey, displayHeading: 'Stat tweaks' },
    { op: 'setSubsectionVisual', subsectionKey: hKey, visual: 'HIDE' },
  ] });
  check('SAVE: the review request applies all four ops on the stored (pre-feature) revision 1', saved.status === 200 && saved.body.applied.length === 4 && saved.body.errors.length === 0, saved.body);
  const rel = await getRev(1);
  check('RELOAD / GET: the overrides are in the revision, scope + visual + heading together in one entry; the admin preview shows effective + default + override', rel.patchNotes.subsectionReview[sKey].visualOverride === 'SHOW' && rel.patchNotes.subsectionReview[sKey].scope === 'CHAMPION_MECHANIC' && rel.patchNotes.subsectionReview[sKey].displayHeading === 'Stat tweaks' && rel.publicPreview.subsections[sen.changeId].visual === 'SHOW' && rel.publicPreview.subsections[sen.changeId].visualDefault === 'HIDE' && rel.publicPreview.subsections[sen.changeId].visualOverride === 'SHOW', rel.publicPreview.subsections[sen.changeId]);
  const rev1Stored = store.get(`patch-intel:report:${SLUG}:1`);
  const rs = await (await checkPost({ request: post('https://x/api/admin/patch-check', { action: 'rescan', patchId: SLUG }), env })).json();
  const rev2 = await getRev(2);
  check('(10) REVISION CREATION + RESCAN: revision 2 carries the visual overrides, the scope override and the heading edit; same changeIds; nothing orphaned', rs.ok === true && rs.report.revision === 2 && rev2.patchNotes.subsectionReview[sKey].visualOverride === 'SHOW' && rev2.patchNotes.subsectionReview[sKey].scope === 'CHAMPION_MECHANIC' && rev2.patchNotes.subsectionReview[sKey].displayHeading === 'Stat tweaks' && rev2.patchNotes.subsectionReview[hKey].visualOverride === 'HIDE' && rev2.patchNotes.orphanedChanges.length === 0 && rev2.patchNotes.changes.find((c) => c.changeId === sen.changeId).scope === 'BASE_STATS', rev2.patchNotes.subsectionReview);
  check('revision 1 is byte-for-byte untouched by the rescan; Yuumi\'s change and every ID are the same', store.get(`patch-intel:report:${SLUG}:1`) === rev1Stored && rev2.patchNotes.changes.find((c) => c.entity && c.entity.name === 'Yuumi').changeId === 'pn_3280ab3639b4711c');
  await act({ id: SLUG, action: 'approve', revision: 2 }); await act({ id: SLUG, action: 'publish', revision: 2, alsoMarkVerified: false });
  const pub = await pubApi();
  const idx = { senna: { 'base-stats': '/assets/abilities/senna/base-stats.webp' }, hwei: { 'signature-of-the-visionary': '/h1.webp', 'subject-disaster-devastating-fire': '/h2.webp', 'subject-disaster-severing-bolt': '/h3.webp', 'spiraling-despair': '/assets/abilities/hwei/spiraling-despair.webp' } };
  const html = await renderPage(pub, idx);
  const sSub = pub.championChanges.find((e) => e.championId === 'senna').subsections[0];
  check('PUBLISH: the public view for revision 2 has visual SHOW on Senna\'s overridden Base Stats section (icon from Riot\'s heading), HIDE on Hwei\'s "Spiraling Despair" even though its file exists, and the other three Hwei abilities still SHOW', pub.revision === 2 && sSub.visual === 'SHOW' && hasIcon(headOf(html, 'Stat tweaks', 'Senna')) && headOf(html, 'Stat tweaks', 'Senna').includes('senna/base-stats.webp') && !hasIcon(headOf(html, 'Spiraling Despair', 'Hwei')) && !hasPlaceholder(headOf(html, 'Spiraling Despair', 'Hwei')) && ['Signature of the Visionary', 'Subject: Disaster - Devastating Fire', 'Subject: Disaster - Severing Bolt'].every((h) => hasIcon(headOf(html, h, 'Hwei'))));
  check('...the scope override itself (CHAMPION_MECHANIC) is public as scope while the visual is the reviewer\'s SHOW -- two independent facts', sSub.scope === 'CHAMPION_MECHANIC' && sSub.visual === 'SHOW' && sSub.sourceHeading === 'Base Stats' && !JSON.stringify(pub).includes('visualOverride'));
  check('only patch-intel:* keys were written; coach-overrides is byte-identical; nothing was fetched (no AI, no network)', writes.every((k) => k.startsWith('patch-intel:')) && store.get('coach-overrides') === COACH && fetchCalls.length === 0, writes.filter((k) => !k.startsWith('patch-intel:')));
}

// =======================================================================================================================
console.log('\n=== 5. VALIDATION ===');
{
  const f = fresh(); const key = f.key('Zenith Blade');
  const bad = applyReviewOps(f.dataset, [{ op: 'setSubsectionVisual', subsectionKey: key, visual: 'MAYBE' }, { op: 'setSubsectionVisual', subsectionKey: key, visual: 7 }, { op: 'setSubsectionVisual', subsectionKey: key, visual: true }, { op: 'setSubsectionVisual', subsectionKey: 'nope', visual: 'SHOW' }, { op: 'setSubsectionVisual', subsectionKey: key }]);
  check('invalid values (MAYBE / number / boolean), an unknown subsectionKey and a missing value are all rejected; nothing is stored', bad.errors.length === 5 && bad.applied.length === 0 && !(key in f.dataset.subsectionReview), bad);
  const ok = applyReviewOps(f.dataset, [{ op: 'setSubsectionVisual', subsectionKey: key, visual: ' hide ' }]);
  check('case / whitespace tolerant: " hide " stores "HIDE"', ok.applied.length === 1 && f.dataset.subsectionReview[key].visualOverride === 'HIDE');
  check('the public view carries ONLY the resolved result: `visual` per subsection; no `visualOverride`, no reviewer map, no change IDs', (() => { const j = JSON.stringify(pubOf(f.dataset)); return j.includes('"visual":"HIDE"') && !j.includes('visualOverride') && !j.includes('subsectionReview') && !j.includes('pn_'); })());
  check('the dataset stays serialisable and the override is a plain string field (no schema change for existing data)', JSON.parse(JSON.stringify(f.dataset)).subsectionReview[key].visualOverride === 'HIDE');
}

// =======================================================================================================================
console.log('\n=== 6. ADMIN UI: the "Icon / Visual" select ===');
{
  const m = await bundle('review', `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; export { React, renderToStaticMarkup }; export { default as PatchNotesReview } from ${src('src/components/PatchNotesReview.jsx')};`);
  const renderReview = (dataset) => { const rep = { ...asReport(dataset), status: 'pending_review', patchNotesSummary: { sections: 2 } }; rep.publicPreview = publicPreview(rep, []); return m.renderToStaticMarkup(m.React.createElement(m.PatchNotesReview, { report: rep, onOps() {}, busy: false, initialFilter: 'all' })); };
  const f = fresh();
  const html = renderReview(f.dataset);
  const labels = html.match(/<label[^>]*>Icon \/ Visual [\s\S]*?<\/label>/g) || [];
  check('one labelled "Icon / Visual" select per CHAMPION subsection (4), next to the existing "Section type" select (4)', labels.length === 4 && (html.match(/aria-label="Icon \/ Visual"/g) || []).length === 4 && (html.match(/aria-label="Section type"/g) || []).length === 4);
  check('each offers exactly Auto / Show / Hide, in that order, and every one starts on Auto (nothing stored yet)', labels.every((l) => /<option value="" selected="">Auto<\/option><option value="SHOW">Show<\/option><option value="HIDE">Hide<\/option>/.test(l)), labels.map((l) => l.slice(0, 220)));
  check('items get no such control: the item section (Edge of Night) has no "Icon / Visual" select, exactly like "Section type"', !/Edge of Night[\s\S]*Icon \/ Visual/.test(html));
  applyReviewOps(f.dataset, [{ op: 'setSubsectionVisual', subsectionKey: f.key('Base Stats'), visual: 'SHOW' }, { op: 'setSubsectionVisual', subsectionKey: f.key('Zenith Blade'), visual: 'HIDE' }, { op: 'setSubsectionScope', subsectionKey: f.key('Base Stats'), scope: 'BASE_STATS' }]);
  const html2 = renderReview(f.dataset);
  const sel = (heading) => { const part = html2.split(`<b>${heading}</b>`)[1] || ''; return (part.match(/<label[^>]*>Icon \/ Visual [\s\S]*?<\/label>/) || [''])[0]; };
  check('the select reflects the stored value: Base Stats = Show, Zenith Blade = Hide, Passive and Crit Mechanics stay on Auto', sel('Base Stats').includes('<option value="SHOW" selected="">Show</option>') && sel('Zenith Blade').includes('<option value="HIDE" selected="">Hide</option>') && sel('Passive - Sunlight').includes('<option value="" selected="">Auto</option>') && sel('Crit Mechanics').includes('<option value="" selected="">Auto</option>'), [sel('Base Stats'), sel('Zenith Blade')]);
  check('the existing "Section type" select is unchanged by the visual choice (Base Stats still detected as Base stats, scope override still shown as chosen)', html2.includes('Detected: Base stats') && /aria-label="Section type"/.test(html2));
}

done();
