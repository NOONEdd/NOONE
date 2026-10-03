// Patch Notes -- ability icon assets: folder structure, discovery, resolution and rendering. Plain Node ESM, no framework, no network.
// Run directly:
//
//   node tests/abilityAssets.test.mjs
//
//   1  structure     public/assets/abilities/<champion-id>/ exists for EVERY champion in the Academy roster (src/data/champions.js),
//                    and the real folder has no misnamed files / unknown folders (the same scan the build prints warnings from)
//   2  discovery     scripts/abilityAssetIndex.mjs: what is indexed, what is ignored, what is reported as a problem
//   3  resolution    Riot ability heading -> icon path; Riot's exact heading, never a Q/W/E/R guess; safe null on every miss
//   4  rendering     the REAL public Patch Notes card: icon beside the heading when a file exists, a neutral placeholder when it does
//                    not -- and in BOTH cases every heading and every change is still on the page

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHAMPIONS } from '../src/data/champions.js';
import { scanAbilityAssets, ABILITY_ASSET_DIR, IMAGE_EXTENSIONS } from '../scripts/abilityAssetIndex.mjs';
import { createAbilityIconResolver, abilityIconCandidates, abilitySlug } from '../src/lib/abilityIcons.js';
import { slugify } from '../src/utils/images.js';
import { bundleModule, src, ROOT } from './helpers/renderBundle.mjs';
import { extract, makeChecker } from './helpers/patchNotesHelpers.mjs';
import { applyReviewOps, subsectionKeyOf } from '../functions/_lib/patchNotesReview.js';
import { toPublicView } from '../functions/_lib/patchNotesPublic.js';

const { check, done } = makeChecker();

// =======================================================================================================================
console.log('\n=== 1. STRUCTURE: one folder per Academy champion ===');
{
  const ids = CHAMPIONS.map((c) => c.id);
  const base = path.join(ROOT, ABILITY_ASSET_DIR);
  const dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  check(`the roster source (CHAMPIONS in src/data/champions.js) has ${ids.length} unique champions`, ids.length === 142 && new Set(ids).size === ids.length, ids.length);
  check('every roster champion has public/assets/abilities/<champion-id>/', ids.filter((id) => !dirs.includes(id)).length === 0, ids.filter((id) => !dirs.includes(id)));
  check('there is no folder for anything that is not in the roster (no typos, no strays)', dirs.filter((d) => !ids.includes(d)).length === 0, dirs.filter((d) => !ids.includes(d)));
  check('the folder count equals the roster count exactly', dirs.length === ids.length, [dirs.length, ids.length]);
  check('every folder name is the champion\'s canonical id (the project\'s own slug convention)', ids.every((id) => id === slugify(id)));
  check('multi-word champions use the roster id, e.g. jarvan-iv, dr-mundo, aurelion-sol, nunu-willump', ['jarvan-iv', 'dr-mundo', 'aurelion-sol', 'nunu-willump', 'miss-fortune'].every((id) => dirs.includes(id)));
  check('every folder survives git/zip with a .gitkeep (empty folders would not)', ids.every((id) => fs.existsSync(path.join(base, id, '.gitkeep'))));
  const appSource = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
  check('the site\'s effective roster is built by mapping over CHAMPIONS (KV overrides patch fields of existing champions, they never add ids)', /CHAMPIONS\.map\(\(c\) => resolveEffectiveChampion\(c, overrides\.champions\[c\.id\]/.test(appSource));
  const real = scanAbilityAssets(ROOT);
  check('the real folder scan reports no problems (no misnamed file, unsupported type, stray root file or nested folder)', real.problems.length === 0, real.problems.map((p) => p.message));
  check('the real folder scan lists every champion folder', real.champions.length === ids.length);
  const unknownFolders = real.champions.filter((c) => !ids.includes(c));
  check('and no unknown champion folder', unknownFolders.length === 0, unknownFolders);
}

// =======================================================================================================================
console.log('\n=== 2. DISCOVERY: scripts/abilityAssetIndex.mjs ===');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-abilities-'));
  const dir = path.join(tmp, ABILITY_ASSET_DIR);
  const put = (rel, content = 'x') => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
  put('senna/.gitkeep', ''); put('senna/piercing-darkness.webp'); put('senna/dawning-shadow.png'); put('senna/absolution.webp'); put('senna/absolution.png');
  put('hwei/signature-of-the-visionary.webp'); put('README.txt');
  put('swain/Demonic Ascension.webp'); put('swain/notes.txt'); put('swain/sub/x.webp'); put('stray.webp'); put('Jarvan IV/q.webp');
  const r = scanAbilityAssets(tmp);
  check('a correctly named file is indexed under its slug with its /assets URL', r.index.senna['piercing-darkness'] === '/assets/abilities/senna/piercing-darkness.webp' && r.index.hwei['signature-of-the-visionary'] === '/assets/abilities/hwei/signature-of-the-visionary.webp');
  check('png is accepted too; .gitkeep and README are ignored (never indexed, never a problem)', r.index.senna['dawning-shadow'].endsWith('.png') && !JSON.stringify(r).includes('gitkeep') && !r.problems.some((p) => /README|gitkeep/i.test(p.path)));
  check('two files for the same ability: webp wins and the duplicate is reported', r.index.senna.absolution.endsWith('.webp') && r.problems.some((p) => p.kind === 'duplicate' && p.path === 'senna/absolution'));
  check('a misnamed file ("Demonic Ascension.webp") is still indexed under the right slug (nothing silently disappears)...', r.index.swain['demonic-ascension'] === '/assets/abilities/swain/Demonic%20Ascension.webp', r.index.swain);
  check('...and reported with the exact rename to make', r.problems.some((p) => p.kind === 'non-canonical-name' && p.message.includes('"demonic-ascension.webp"')), r.problems.map((p) => p.message));
  check('an unsupported file type, a nested folder, a stray file in the root and a non-canonical champion folder are each reported', ['unsupported-file', 'nested-folder', 'file-in-root', 'non-canonical-folder'].every((k) => r.problems.some((p) => p.kind === k)), r.problems.map((p) => p.kind));
  check('the nested-folder image and the unsupported file are NOT indexed', !('x' in (r.index.swain || {})) && !JSON.stringify(r.index).includes('notes'));
  check('output is deterministic (same tree -> identical JSON, keys sorted)', JSON.stringify(scanAbilityAssets(tmp)) === JSON.stringify(r) && Object.keys(r.index.senna).join() === [...Object.keys(r.index.senna)].sort().join());
  check('the supported extensions are the same list the site\'s other images use', IMAGE_EXTENSIONS.join() === 'webp,png,jpg,jpeg,avif');
  check('a missing folder is an empty index, not an error', JSON.stringify(scanAbilityAssets(path.join(tmp, 'nope')).index) === '{}');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// =======================================================================================================================
console.log('\n=== 3. RESOLUTION: Riot heading -> icon path (exact Riot wording; no Q/W/E/R) ===');
{
  const index = {
    senna: { 'piercing-darkness': '/assets/abilities/senna/piercing-darkness.webp', 'dawning-shadow': '/assets/abilities/senna/dawning-shadow.webp', absolution: '/assets/abilities/senna/absolution.webp', 'base-stats': '/assets/abilities/senna/base-stats.webp' },
    hwei: { 'signature-of-the-visionary': '/assets/abilities/hwei/signature-of-the-visionary.webp', 'disaster-devastating-fire': '/assets/abilities/hwei/disaster-devastating-fire.webp' },
    braum: { unbreakable: '/assets/abilities/braum/unbreakable.webp' },
    'jarvan-iv': { q: '/assets/abilities/jarvan-iv/q.webp', e: '/assets/abilities/jarvan-iv/e.webp' },
  };
  const resolve = createAbilityIconResolver(index, { senna: { 'Piercing Darkness (Reworked)': 'piercing-darkness', 'Renamed But File Missing': 'no-such-file' } });
  check('"Piercing Darkness" -> senna/piercing-darkness.webp', resolve('senna', { sourceHeading: 'Piercing Darkness' }).src === '/assets/abilities/senna/piercing-darkness.webp');
  check('"Dawning Shadow" -> senna/dawning-shadow.webp', resolve('senna', { sourceHeading: 'Dawning Shadow' }).src === '/assets/abilities/senna/dawning-shadow.webp');
  check('"Signature of the Visionary" -> hwei/signature-of-the-visionary.webp', resolve('hwei', { sourceHeading: 'Signature of the Visionary' }).src === '/assets/abilities/hwei/signature-of-the-visionary.webp');
  check('"Disaster - Devastating Fire" -> hwei/disaster-devastating-fire.webp (the " - " in Riot\'s heading collapses to one hyphen)', resolve('hwei', { sourceHeading: 'Disaster - Devastating Fire' }).src.endsWith('disaster-devastating-fire.webp'));
  check('"Base Stats" (a Riot heading too) resolves like any ability', resolve('senna', { sourceHeading: 'Base Stats' }).src.endsWith('senna/base-stats.webp'));
  check('case and punctuation in Riot\'s heading do not matter, the slug does (apostrophes dropped like every other id in the project)', abilitySlug("Void Seeker's  Mark!") === 'void-seekers-mark' && resolve('senna', { sourceHeading: 'PIERCING darkness' }) !== null);
  check('Riot\'s own slot notation: "E - Unbreakable" finds unbreakable.webp through the parser\'s slot-free ability name', resolve('braum', { sourceHeading: 'E - Unbreakable', abilityName: 'Unbreakable' }).src.endsWith('braum/unbreakable.webp'));
  check('candidates are only slugs of the NAMES GIVEN, in order: alias, exact heading, slot-free name', JSON.stringify(abilityIconCandidates('braum', { sourceHeading: 'E - Unbreakable', abilityName: 'Unbreakable' })) === '["e-unbreakable","unbreakable"]' && JSON.stringify(abilityIconCandidates('senna', { sourceHeading: 'Piercing Darkness' })) === '["piercing-darkness"]');
  check('NO Q/W/E/R inference: jarvan-iv has q.webp and e.webp, yet "Dragon Strike" / "Demacian Standard" never resolve to them', resolve('jarvan-iv', { sourceHeading: 'Dragon Strike' }) === null && resolve('jarvan-iv', { sourceHeading: 'Demacian Standard' }) === null);
  check('...and a heading that Riot itself spells "Q" resolves only because it IS the exact heading', resolve('jarvan-iv', { sourceHeading: 'Q' }).src.endsWith('jarvan-iv/q.webp'));
  check('an alias maps a renamed Riot heading to the existing file', resolve('senna', { sourceHeading: 'Piercing Darkness (Reworked)' }).src.endsWith('senna/piercing-darkness.webp'));
  check('an alias that points at a file that does not exist is a safe null (no throw, no wrong icon)', resolve('senna', { sourceHeading: 'Renamed But File Missing' }) === null);
  check('another champion\'s icon never matches (senna has Absolution, hwei does not)', resolve('hwei', { sourceHeading: 'Absolution' }) === null);
  check('unknown champion / no heading / no index / garbage input -> null, never a throw', [resolve('nobody', { sourceHeading: 'Absolution' }), resolve('senna', {}), resolve('senna'), resolve(undefined, { sourceHeading: 'x' }), createAbilityIconResolver(undefined)('senna', { sourceHeading: 'Absolution' }), createAbilityIconResolver(null, null)('senna', { sourceHeading: 'x' }), resolve('senna', { sourceHeading: 42 })].every((v) => v === null));
  check('prototype names are not abilities ("constructor", "__proto__", "toString")', ['constructor', '__proto__', 'toString', 'hasOwnProperty'].every((h) => resolve('senna', { sourceHeading: h }) === null));
}

// =======================================================================================================================
console.log('\n=== 4. RENDERING: icon beside the Riot heading; a missing icon never hides a change ===');
{
  const HWEI = `## CHAMPION ADJUSTMENTS\n\n### Hwei\n\nSignature of the Visionary\n\n- Passive Damage: 20 / 30 / 40 → 25 / 35 / 45\n- Bonus Magic Damage: 5% → 7%\n\nDisaster - Devastating Fire\n\n- Damage: 80 / 120 / 160 → 70 / 110 / 150\n- Cooldown: 8 → 9\n\nDisaster - Severing Bolt\n\n- Damage: 70 / 100 / 130 → 60 / 90 / 120\n\nSpiraling Despair\n\n- Cooldown: 120 / 100 / 80 → 130 / 110 / 90\n\n## ITEM ADJUSTMENTS\n\n### Edge of Night\n\n- Armor Penetration increased from 10% to 15%.\n`;
  const r = extract(HWEI);
  r.changes.forEach((c) => applyReviewOps(r.dataset, [{ op: 'keep', changeId: c.changeId }]));
  const rep = { id: 'p', patch: '7.6', status: 'published', revision: 1, generatedAt: '2026-10-01T09:00:00.000Z', sourceUrl: 'https://example.test', recommendedTierChanges: [], supportMetaAnalysis: '', patchNotes: r.dataset };
  const view = toPublicView(rep, []);
  const roster = { champions: [], items: [], runes: [] };
  const ENTRY = `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; export { React, renderToStaticMarkup }; export { PublicReportCard } from ${src('src/pages/PatchNotesPage.jsx')};`;
  const render = async (abilityIndex, report = view) => { const m = await bundleModule(ENTRY, { abilityIndex }); return m.renderToStaticMarkup(m.React.createElement(m.PublicReportCard, { report, roster, initiallyExpanded: true })); };
  const heads = (html) => html.split('class="patch-sub-head"').slice(1).map((h) => h.split('class="patch-sub-change"')[0]);
  const lines = (html) => [...html.matchAll(/<p class="patch-entry-line">([^<]*)/g)].map((m) => m[1].trim());
  const TITLES = ['Signature of the Visionary', 'Disaster - Devastating Fire', 'Disaster - Severing Bolt', 'Spiraling Despair'];

  const withIcons = await render({ hwei: { 'signature-of-the-visionary': '/assets/abilities/hwei/signature-of-the-visionary.webp', 'disaster-devastating-fire': '/assets/abilities/hwei/disaster-devastating-fire.webp', 'disaster-severing-bolt': '/assets/abilities/hwei/disaster-severing-bolt.webp', 'spiraling-despair': '/assets/abilities/hwei/spiraling-despair.webp' } });
  const h1 = heads(withIcons);
  check('four Riot subsections, each head carries an <img class="ability-icon"> with its OWN file, immediately before the title', h1.length === 4 && h1.every((h, i) => h.includes(`<img class="ability-icon" src="/assets/abilities/hwei/${abilitySlug(TITLES[i])}.webp"`) && h.indexOf('ability-icon') < h.indexOf('patch-sub-title')), h1.map((h) => h.slice(0, 160)));
  check('the titles are Riot\'s exact subsection names, in order', [...withIcons.matchAll(/class="patch-sub-title">([^<]*)</g)].map((m) => m[1]).join('|') === TITLES.join('|'));
  check('icons are decoration only (aria-hidden, empty alt) -- the heading text is the accessible name', h1.every((h) => h.includes('alt=""') && h.includes('aria-hidden="true"')));

  const noIcons = await render({});
  const h0 = heads(noIcons);
  check('NO icon files at all: every subsection still renders with a neutral placeholder (no <img>, no broken image)', h0.length === 4 && h0.every((h) => h.includes('ability-icon-fallback') && !h.includes('<img')), h0.map((h) => h.slice(0, 100)));
  check('NO icon files: every heading is still on the page, in order', [...noIcons.matchAll(/class="patch-sub-title">([^<]*)</g)].map((m) => m[1]).join('|') === TITLES.join('|'));
  check('MISSING ICONS NEVER HIDE DATA: the change lines are identical with and without icons (6 for Hwei + 1 item)', JSON.stringify(lines(noIcons)) === JSON.stringify(lines(withIcons)) && lines(noIcons).length === 7, lines(noIcons));
  check('...and so is everything else on the card (the only difference is the icon markup)', noIcons.replace(/<span class="ability-icon ability-icon-fallback"[^>]*>.*?<\/span>/g, '').replace(/<img class="ability-icon"[^>]*>/g, '') === withIcons.replace(/<span class="ability-icon ability-icon-fallback"[^>]*>.*?<\/span>/g, '').replace(/<img class="ability-icon"[^>]*>/g, '').replace(/<span class="ability-icon ability-icon-fallback"[^>]*>.*?<\/span>/g, ''));

  const partial = await render({ hwei: { 'disaster-severing-bolt': '/assets/abilities/hwei/disaster-severing-bolt.webp' } });
  const hp = heads(partial);
  check('PARTIAL icons: only the subsection that has a file gets an <img>; the other three keep the placeholder; all four still render', hp.length === 4 && hp.filter((h) => h.includes('<img')).length === 1 && hp[2].includes('<img') && hp.filter((h) => h.includes('ability-icon-fallback')).length === 3);
  const wrongChampion = await render({ senna: { 'signature-of-the-visionary': '/assets/abilities/senna/signature-of-the-visionary.webp' } });
  check('an icon filed under the WRONG champion is not used (placeholder), and nothing is lost', !wrongChampion.includes('<img class="ability-icon"') && lines(wrongChampion).length === 7);
  const qwer = await render({ hwei: { q: '/assets/abilities/hwei/q.webp', w: '/assets/abilities/hwei/w.webp', e: '/assets/abilities/hwei/e.webp', r: '/assets/abilities/hwei/r.webp', passive: '/assets/abilities/hwei/passive.webp' } });
  check('NO Q/W/E/R inference: q/w/e/r/passive files exist for Hwei but none is used for Riot\'s headings', !qwer.includes('<img class="ability-icon"') && !/>\s*[QWER]\s*</.test(qwer));

  // the item entry is not a champion: no ability icon column and no placeholder
  const itemCard = withIcons.split('class="patch-entry-card"').find((c) => c.includes('Edge of Night')) || '';
  check('items (and runes / system changes) get no ability icon or placeholder -- icons are champion abilities only', itemCard.length > 0 && !itemCard.includes('ability-icon'));

  // the display heading is editable; the icon follows RIOT'S heading, so a rename never breaks (or changes) the icon
  const sub = r.changes.find((c) => c.subsection.sourceHeading === 'Spiraling Despair');
  applyReviewOps(r.dataset, [{ op: 'editSubsectionTitle', subsectionKey: subsectionKeyOf(sub), displayHeading: 'Ultimate rework' }]);
  const renamed = await render({ hwei: { 'spiraling-despair': '/assets/abilities/hwei/spiraling-despair.webp' } }, toPublicView(rep, []));
  check('an Admin display-heading edit shows the new text but keeps the icon (resolved from Riot\'s heading)', renamed.includes('>Ultimate rework<') && heads(renamed)[3].includes('spiraling-despair.webp') && !renamed.includes('>Spiraling Despair<'));
  // heading-style document: there is NO parser ability name to fall back on, so the icon can only come from Riot's heading itself
  const HEAD = `## CHAMPION ADJUSTMENTS\n\n### Hwei\n\n#### Disaster - Severing Bolt\n\n- Damage: 70 → 60\n`;
  const h = extract(HEAD);
  h.changes.forEach((c) => applyReviewOps(h.dataset, [{ op: 'keep', changeId: c.changeId }]));
  const hrep = { ...rep, patchNotes: h.dataset };
  const hIdx = { hwei: { 'disaster-severing-bolt': '/assets/abilities/hwei/disaster-severing-bolt.webp' } };
  check('heading-style: the subsection has no parser ability name (the heading is the only Riot text), and its icon is found from it', toPublicView(hrep, []).championChanges[0].subsections[0].abilityName === null && heads(await render(hIdx, toPublicView(hrep, [])))[0].includes('disaster-severing-bolt.webp'));
  applyReviewOps(h.dataset, [{ op: 'editSubsectionTitle', subsectionKey: subsectionKeyOf(h.changes[0]), displayHeading: 'Bolt (reworked)' }]);
  const hRenamed = await render(hIdx, toPublicView(hrep, []));
  check('heading-style + Admin display-heading edit: shows "Bolt (reworked)" and STILL finds the icon (it follows Riot\'s heading, never the display text)', hRenamed.includes('>Bolt (reworked)<') && heads(hRenamed)[0].includes('disaster-severing-bolt.webp'), heads(hRenamed)[0]);
  const pub = JSON.stringify(toPublicView(rep, []));
  check('the server data never contains an icon path (icons are a UI concern: Patch Notes data cannot depend on an asset)', !pub.includes('/assets/abilities'));
  check('public subsections carry Riot\'s exact heading (sourceHeading) separately from the display title', toPublicView(rep, []).championChanges[0].subsections.map((s) => s.sourceHeading).join('|') === TITLES.join('|'));
}

done();
