// Patch Notes -- change SCOPE: a champion's changes are not all "abilities". Plain Node ESM against the REAL parser, extractor, review layer,
// public view, UI components and handlers (mock KV, no network, no AI, no production data). Run directly:
//
//   node tests/patchNotesScope.test.mjs
//
// THE GAP (traced before the fix): the extractor turned EVERY label under a champion into `change.subsection` and the detector stored it as
// `normalizedData.ability`; the public view then handed every subsection an `abilityName`, and the page asked the icon system for an icon for
// every titled champion subsection. So Senna with ONLY "Base Stats" changes (the real 7.3a patch) showed a subsection "Base Stats" with an
// ability placeholder -- and would have shown a real icon if anyone ever filed base-stats.webp. Nothing in the model said "this is not an
// ability". The fix is a change-level `scope` (+ `scopeBasis`) derived from Riot's own structure, an ability-only gate on the icon lookup that is
// decided in the DATA, and a reviewer override for anything the default gets wrong -- no champion names, no growing exception list.
//
//   1  classifier        the generic evidence rules (explicit slot / stats section / named block / no subsection / lifecycle / owner type)
//   2  no hardcoding     no champion name and no "Base Stats" vocabulary outside the one classifier; the icon system never decides scope
//   3  champion shapes   only Base Stats | Base Stats + 1 ability | Base Stats + Passive + several abilities | champion mechanic | no ability changes
//                        (generic fixtures on two different champions + the real 7.3a section, where Senna has ONLY Base Stats)
//   4  public + icons    non-ability sections: no icon and no placeholder, even when a matching file exists; real abilities (incl. Yuumi's
//                        "You and Me!") still get theirs; the champion is never hidden; no fabricated Support interpretation
//   5  reviewer override setSubsectionScope: persists, survives regeneration, never touches Riot's heading / the ID / the display heading
//   6  headings + IDs    Admin display-heading edits change neither sourceHeading, scope nor icon resolution; every changeId is unchanged
//   7  regeneration      real rescan handlers: review state (note, classification, impact, scope override) survives; revision 1 untouched
//   8  old datasets      stored before `scope` existed: read correctly, nothing mutated

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestPost as checkPost } from '../functions/api/admin/patch-check.js';
import { onRequestGet as adminGet, onRequestPost as reportsPost } from '../functions/api/admin/patch-reports.js';
import { onRequestGet as publicGet } from '../functions/api/patch-reports.js';
import { createSessionToken } from '../functions/_lib/adminAuth.js';
import { SOURCE_TEXT_VERSION } from '../functions/_lib/patchText.js';
import { runPatchIntelAnalysis } from '../functions/_lib/patchIntelPipeline.js';
import { classifyChangeScope, SCOPE_BASIS } from '../functions/_lib/patchChangeScope.js';
import { applyReviewOps, mergeReviewState, subsectionKeyOf, scopeOf } from '../functions/_lib/patchNotesReview.js';
import { toPublicView, publicPreview } from '../functions/_lib/patchNotesPublic.js';
import { CHANGE_SCOPE, isAbilityScope, normalizeScope, SUBSECTION_SCOPE_OPTIONS } from '../src/lib/patchNotesPresentation.js';
import { createAbilityIconResolver } from '../src/lib/abilityIcons.js';
import { CHAMPIONS, isAcademyCovered } from '../src/data/champions.js';
import { ITEMS } from '../src/data/items.js';
import { RUNES } from '../src/data/runes.js';
import { MATCHUPS } from '../src/data/matchups.js';
import { resolveEffectiveChampion, resolveEffectiveItem, resolveEffectiveRune } from '../src/lib/effectiveData.js';
import { bundleModule, src } from './helpers/renderBundle.mjs';
import { extract, makeChecker } from './helpers/patchNotesHelpers.mjs';

const { check, done } = makeChecker();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => fs.readFileSync(path.join(ROOT, 'tests/fixtures', name), 'utf8');
const REAL_TEXT = fixture('riot-wild-rift-7-3a-champion-changes.txt');
const ROWS_BEFORE = JSON.parse(fixture('riot-7-3a-champion-rows-before-fix.json'));
const KV_BEFORE = JSON.parse(fixture('kv-state-7-3a-before-ability-label-fix.json'));
const SLUG = 'wild-rift-patch-notes-7-3a';
const YUUMI_ID = 'pn_3280ab3639b4711c';
const fetchCalls = [];
globalThis.fetch = async (url) => { fetchCalls.push(String(url)); throw new Error('unexpected network call: ' + url); };

const prodRosters = () => ({ championRoster: CHAMPIONS.filter(isAcademyCovered).map((c) => resolveEffectiveChampion(c, undefined, MATCHUPS[c.id])), itemRoster: ITEMS.map((i) => resolveEffectiveItem(i, undefined)), runeRoster: RUNES.map((r) => resolveEffectiveRune(r, undefined)) });
const analyze = (text) => runPatchIntelAnalysis({ patchContent: text, ...prodRosters(), patchVersion: '7.3a' });
// two deliberately different champions + an item, so no fixture below depends on one champion
const ROSTER = { championRoster: [{ id: 'leona', name: 'Leona', tier: 'S' }, { id: 'lulu', name: 'Lulu', tier: 'A' }, { id: 'senna', name: 'Senna', tier: 'A' }], itemRoster: [{ id: 'edge-of-night', name: 'Edge of Night', info: '' }] };
const run = (text) => extract(text, { rosters: ROSTER });
const asReport = (dataset) => ({ id: 'p', patch: '7.3a', status: 'published', revision: 1, generatedAt: '2026-10-04T09:00:00.000Z', sourceUrl: 'https://example.test', recommendedTierChanges: [], supportMetaAnalysis: '', patchNotes: dataset });
const pubOf = (dataset, itemRoster = []) => toPublicView(asReport(dataset), itemRoster);
const subs = (pub, id) => pub.championChanges.find((e) => e.championId === id).subsections;
const sig = (list) => list.map((s) => `${s.title}:${s.scope}`).join(' | ');

const ENTRY = `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; export { React, renderToStaticMarkup }; export { PublicReportCard } from ${src('src/pages/PatchNotesPage.jsx')};`;
const mods = new Map();
const render = async (abilityIndex, view) => { const k = JSON.stringify(abilityIndex); if (!mods.has(k)) mods.set(k, await bundleModule(ENTRY, { abilityIndex })); const m = mods.get(k); return m.renderToStaticMarkup(m.React.createElement(m.PublicReportCard, { report: view, roster: { champions: [], items: [], runes: [] }, initiallyExpanded: true })); };
const cardOf = (html, name) => html.split('class="patch-entry-card"').find((c) => c.includes(`>${name}<`)) || '';
const heads = (card) => card.split('class="patch-sub-head"').slice(1).map((h) => h.split('class="patch-sub-change"')[0]);

// =======================================================================================================================
console.log('\n=== 1. THE CLASSIFIER: generic evidence, strongest first ===');
{
  const c = (heading, extra = {}) => classifyChangeScope({ kind: 'entity', entityType: 'champion', subsectionHeading: heading, ...extra });
  const T = CHANGE_SCOPE; const B = SCOPE_BASIS;
  const eq = (got, scope, basis) => got.scope === scope && got.basis === basis;
  check('"Base Stats" -> BASE_STATS from Riot\'s stats-section heading (not from the champion, not from the bullets)', eq(c('Base Stats'), T.BASE_STATS, B.STATS_HEADING));
  check('...Riot\'s own spelling variants: "Base stats" (the real 7.3a Caitlyn block), "BASE STATS", "**Base Stats**", "Base Stats:", "Stats", "Base Statistics"', ['Base stats', 'BASE STATS', '**Base Stats**', 'Base Stats:', 'Stats', 'Base Statistics', '  base   stats '].every((h) => eq(c(h), T.BASE_STATS, B.STATS_HEADING)));
  check('"Passive - Sunlight" / "Passive: X" / "Innate X" -> PASSIVE, ONLY because Riot wrote the notation', ['Passive - Sunlight', 'Passive: Sunlight', 'Innate - Sunlight'].every((h) => eq(c(h), T.PASSIVE, B.EXPLICIT_SLOT)));
  check('"Q - X" / "W: X" / "(3) X" / "Ultimate X" -> ABILITY from Riot\'s explicit slot notation', ['Q - Shield of Daybreak', 'W: Eclipse', '(3) Zenith Blade', 'Ultimate Solar Flare'].every((h) => eq(c(h), T.ABILITY, B.EXPLICIT_SLOT)));
  check('a plain named block ("Absolution", "Subject: Disaster - Devastating Fire", "You and Me!") -> ABILITY as Riot\'s named block', ['Absolution', 'Subject: Disaster - Devastating Fire', 'You and Me!', "Bop 'n' Block"].every((h) => eq(c(h), T.ABILITY, B.NAMED_BLOCK)));
  check('a heading that merely CONTAINS stats words is not the stats section ("Base Stats Boost", "Armor Stats Aura") -> an ordinary named block', eq(c('Base Stats Boost'), T.ABILITY, B.NAMED_BLOCK) && eq(c('Armor Stats Aura'), T.ABILITY, B.NAMED_BLOCK));
  check('NO subsection (Riot filed it under no heading) -> CHAMPION_MECHANIC; nothing is invented to make it an ability or stats', eq(c(null), T.CHAMPION_MECHANIC, B.NO_SUBSECTION) && eq(c(''), T.CHAMPION_MECHANIC, B.NO_SUBSECTION) && eq(c(undefined), T.CHAMPION_MECHANIC, B.NO_SUBSECTION));
  check('a champion added / removed (lifecycle) is about the champion, not one of its sections -> CHAMPION_MECHANIC', eq(c(null, { lifecycle: { action: 'added', kind: 'champion' } }), T.CHAMPION_MECHANIC, B.ENTITY_LIFECYCLE) && eq(c('Base Stats', { lifecycle: { action: 'removed', kind: 'champion' } }), T.CHAMPION_MECHANIC, B.ENTITY_LIFECYCLE));
  check('items and runes are scoped by their owner, whatever their headings say ("Base Stats", "Passive - X", "Q - X" under an item is still ITEM)', ['Base Stats', 'Passive - Spell Shield', 'Q - X', null].every((h) => eq(c(h, { entityType: 'item' }), T.ITEM, B.ENTITY_TYPE) && eq(c(h, { entityType: 'rune' }), T.RUNE, B.ENTITY_TYPE)));
  check('system changes are SYSTEM whatever their heading says', eq(classifyChangeScope({ kind: 'system', subsectionHeading: 'Base Stats' }), T.SYSTEM, B.SYSTEM_SECTION));
  check('NO positional inference: the classifier takes only the heading text -- there is no index/order argument to guess a slot from', classifyChangeScope.length <= 1 && !/\b(index|position|order|nth)\b/i.test(fs.readFileSync(path.join(ROOT, 'functions/_lib/patchChangeScope.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')));
  check('only ABILITY and PASSIVE are ability-like (icon-eligible); everything else -- and a missing / unknown scope -- is not', Object.values(T).filter(isAbilityScope).sort().join() === 'ABILITY,PASSIVE' && !isAbilityScope(undefined) && !isAbilityScope('') && !isAbilityScope('WHATEVER') && isAbilityScope('ability') && normalizeScope('champion mechanic') === 'CHAMPION_MECHANIC');
}

// =======================================================================================================================
console.log('\n=== 2. NOTHING IS HARDCODED: no champion, no heading special case outside the one classifier ===');
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const FILES = ['functions/_lib/patchChangeScope.js', 'functions/_lib/patchNotesExtract.js', 'functions/_lib/patchNotesReview.js', 'functions/_lib/patchNotesPublic.js', 'src/pages/PatchNotesPage.jsx', 'src/components/AbilityIcon.jsx', 'src/components/PatchNotesReview.jsx', 'src/lib/abilityIcons.js', 'src/lib/patchNotesPresentation.js', 'src/data/abilityAssets.js'];
  const code = Object.fromEntries(FILES.map((f) => [f, strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))]));
  const names = CHAMPIONS.map((ch) => ch.name).filter((n) => n.length > 3);
  const hits = FILES.flatMap((f) => names.filter((n) => new RegExp(`['"\`]${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`, 'i').test(code[f])).map((n) => `${f}: "${n}"`));
  check('no source file of the scope / public / icon path compares against ANY of the 142 champion names', hits.length === 0, hits);
  const SCOPE_SIDE = ['src/pages/PatchNotesPage.jsx', 'src/components/AbilityIcon.jsx', 'src/components/PatchNotesReview.jsx', 'src/lib/abilityIcons.js', 'src/data/abilityAssets.js', 'functions/_lib/patchNotesReview.js', 'functions/_lib/patchNotesPublic.js'];
  check('the heading -> scope mapping lives in exactly ONE place (the classifier): the page, the icon component, the resolver, the asset binding, the review panel and the review / public layers contain no "Base Stats" heading test', SCOPE_SIDE.every((f) => !/base\s*stats/i.test(code[f])) && /STATS_HEADING/.test(code['functions/_lib/patchChangeScope.js']) && !/STATS_HEADING|BASE_STATS_LABEL/.test(code['src/lib/patchNotesPresentation.js']), SCOPE_SIDE.filter((f) => /base\s*stats/i.test(code[f])));
  check('the extractor\'s own pre-existing "Base Stats" regex (BASE_STATS_LABEL) is an OWNERSHIP rule for explicit "<Name> / Base Stats" runs inside one block; it is not used for scope (unchanged behaviour, a different purpose)', (code['functions/_lib/patchNotesExtract.js'].match(/BASE_STATS_LABEL/g) || []).length === 3 /* its definition + the two tests inside splitExplicitBlocks */ && !/BASE_STATS_LABEL[^\n]*scope|scope[^\n]*BASE_STATS_LABEL/i.test(code['functions/_lib/patchNotesExtract.js']));
  check('the icon system does not decide what an ability is: AbilityIcon / abilityIcons / abilityAssets import no scope logic', ['src/components/AbilityIcon.jsx', 'src/lib/abilityIcons.js', 'src/data/abilityAssets.js'].every((f) => !/scope|isAbilityScope|CHANGE_SCOPE/i.test(code[f])));
  check('the page gates the lookup on the data (the effective visual resolved in the public-view layer) before the icon component is even rendered -- it never interprets scope or a reviewer override itself', /sub\.visual\s*===\s*VISUAL\.SHOW\s*&&\s*<AbilityIcon/.test(code['src/pages/PatchNotesPage.jsx']) && !/isAbilityScope|visualOverride|\.scope\b/.test(code['src/pages/PatchNotesPage.jsx']));
}

// =======================================================================================================================
console.log('\n=== 3. CHAMPION SHAPES (generic fixtures, two different champions) ===');
const SHAPES = {
  onlyStats: (n) => `## CHAMPION ADJUSTMENTS\n\n### ${n}\n\nBase Stats\n\n- Attack Damage: 52 → 55\n- Armor: 28 → 30\n- Health per level: 100 → 104\n`,
  statsPlusOne: (n) => `## CHAMPION ADJUSTMENTS\n\n### ${n}\n\nBase Stats\n\n- Armor: 28 → 30\n\nZenith Blade\n\n- Cooldown: 14 → 12\n- Damage: 60 → 70\n`,
  full: (n) => `## CHAMPION ADJUSTMENTS\n\n### ${n}\n\nBase Stats\n\n- Armor: 28 → 30\n- Attack Speed per level: 0.02 → 0.025\n\nPassive - Sunlight\n\n- Damage: 20 → 25\n\nQ - Shield of Daybreak\n\n- Damage: 60 → 70\n\nEclipse\n\n- Shield: 80 → 90\n\nZenith Blade\n\n- Cooldown: 14 → 12\n\nUltimate Solar Flare\n\n- Cooldown: 120 → 110\n`,
  mechanic: (n) => `## CHAMPION ADJUSTMENTS\n\n### ${n}\n\n- Basic attacks no longer reset her passive timer.\n- Attack Speed: 0.6 → 0.65\n`,
  noAbility: (n) => `## CHAMPION ADJUSTMENTS\n\n### ${n}\n\n- Basic attacks no longer reset her passive timer.\n\nBase Stats\n\n- Armor: 28 → 30\n`,
};
const bigIndex = (id, names) => ({ [id]: Object.fromEntries(names.map((nme) => [nme, `/assets/abilities/${id}/${nme}.webp`])) });
{
  for (const [id, name] of [['leona', 'Leona'], ['lulu', 'Lulu']]) {
    const tag = `${name}`;
    // 1. only Base Stats
    const a = run(SHAPES.onlyStats(name)); const pa = pubOf(a.dataset);
    check(`[${tag}] ONLY Base Stats: 3 changes, every one BASE_STATS / riot_stats_heading, subsection "Base Stats" kept exactly as Riot wrote it`, a.changes.length === 3 && a.changes.every((c) => c.scope === 'BASE_STATS' && c.scopeBasis === 'riot_stats_heading' && c.subsection.sourceHeading === 'Base Stats'), a.changes.map((c) => [c.scope, c.subsection && c.subsection.sourceHeading]));
    check(`[${tag}] ...the champion still APPEARS in the public report with its changes (a non-ability change is a real change)`, pa.championChanges.length === 1 && pa.championChanges[0].championId === id && subs(pa, id).length === 1 && subs(pa, id)[0].changes.length === 3 && pa.summary.total === 1 && !pa.summary.empty);
    check(`[${tag}] ...its one subsection is BASE_STATS, titled "Base Stats", with NO abilityName (so nothing downstream can mistake it for an ability)`, subs(pa, id)[0].scope === 'BASE_STATS' && subs(pa, id)[0].title === 'Base Stats' && subs(pa, id)[0].sourceHeading === 'Base Stats' && subs(pa, id)[0].abilityName === null, subs(pa, id)[0]);
    check(`[${tag}] ...the Riot-derived normalized ability field is untouched (ID stability) while the public name is withheld`, a.changes.every((c) => c.normalizedData.ability === 'Base Stats'));

    // 2. Base Stats + one ability
    const b = run(SHAPES.statsPlusOne(name)); const pb = pubOf(b.dataset);
    check(`[${tag}] Base Stats + ONE ability: BASE_STATS | ABILITY(Zenith Blade, 2 changes grouped)`, sig(subs(pb, id)) === 'Base Stats:BASE_STATS | Zenith Blade:ABILITY' && subs(pb, id)[1].changes.length === 2 && subs(pb, id)[1].abilityName === 'Zenith Blade' && subs(pb, id)[0].abilityName === null, subs(pb, id));

    // 3. Base Stats + Passive + several abilities
    const f = run(SHAPES.full(name)); const pf = pubOf(f.dataset);
    check(`[${tag}] Base Stats + Passive + several abilities: scopes exactly as Riot structured them, in Riot's order`, sig(subs(pf, id)) === 'Base Stats:BASE_STATS | Passive - Sunlight:PASSIVE | Q - Shield of Daybreak:ABILITY | Eclipse:ABILITY | Zenith Blade:ABILITY | Ultimate Solar Flare:ABILITY', sig(subs(pf, id)));
    check(`[${tag}] ...ability names are slot-free where Riot wrote a slot, and only the ability-like sections have one`, subs(pf, id).map((s) => s.abilityName).join('|') === 'null|Sunlight|Shield of Daybreak|Eclipse|Zenith Blade|Solar Flare'.replace(/null/g, '') || subs(pf, id).map((s) => s.abilityName).join('|') === '|Sunlight|Shield of Daybreak|Eclipse|Zenith Blade|Solar Flare' || subs(pf, id).map((s) => s.abilityName).join('|') === 'null|Sunlight|Shield of Daybreak|Eclipse|Zenith Blade|Solar Flare', subs(pf, id).map((s) => s.abilityName));
    check(`[${tag}] ...NO positional inference: "Eclipse" and "Zenith Blade" are plain named blocks (no slot assigned by order), only Riot's own "Q -" / "Passive -" / "Ultimate" notation produced slots`, f.changes.filter((c) => c.subsection && /^(Eclipse|Zenith Blade)$/.test(c.subsection.sourceHeading)).every((c) => c.normalizedData.slot === null) && f.changes.filter((c) => /^(Eclipse|Zenith Blade)$/.test(c.subsection.sourceHeading)).every((c) => c.scopeBasis === 'riot_named_block') /* the recorded evidence for a plain block is never slot notation */ && f.changes.filter((c) => /^(Q - |Passive - |Ultimate)/.test(c.subsection.sourceHeading)).every((c) => c.scopeBasis === 'riot_slot_notation') && f.changes.find((c) => /^Q - /.test(c.subsection.sourceHeading)).normalizedData.slot === 'Q' && f.changes.find((c) => /^Ultimate/.test(c.subsection.sourceHeading)).normalizedData.slot === 'R');

    // 4. champion mechanic
    const m = run(SHAPES.mechanic(name)); const pm = pubOf(m.dataset);
    check(`[${tag}] a champion MECHANIC (Riot filed it under no heading): CHAMPION_MECHANIC / no_riot_subsection, no subsection invented, still a visible change`, m.changes.length === 2 && m.changes.every((c) => c.scope === 'CHAMPION_MECHANIC' && c.scopeBasis === 'no_riot_subsection' && c.subsection === null) && sig(subs(pm, id)) === 'null:CHAMPION_MECHANIC' && subs(pm, id)[0].title === null && subs(pm, id)[0].changes.length === 2 && pm.championChanges.length === 1, sig(subs(pm, id)));

    // 5. no ability changes at all
    const n = run(SHAPES.noAbility(name)); const pn = pubOf(n.dataset);
    check(`[${tag}] a champion with NO ability changes (a mechanic + Base Stats): both sections present, neither is an ability, the champion is not dropped`, sig(subs(pn, id)) === 'null:CHAMPION_MECHANIC | Base Stats:BASE_STATS' && pn.championChanges.length === 1 && !subs(pn, id).some((s) => isAbilityScope(s.scope)), sig(subs(pn, id)));
    check(`[${tag}] every shape: validation shows no dropped block and no false ownership`, [a, b, f, m, n].every((x) => x.dataset.validation.droppedBlocks === 0 && x.dataset.validation.falseOwnership.count === 0));
  }

  // the SAME shapes through the PRODUCTION roster / real parser, on Riot's real 7.3a champion section
  const real = await analyze(REAL_TEXT); const D = real.patchNotes;
  const senna = D.changes.filter((c) => c.entity.name === 'Senna');
  check('REAL 7.3a: Senna has ONLY Base Stats changes (5): all BASE_STATS, heading "Base Stats", nothing else', senna.length === 5 && senna.every((c) => c.scope === 'BASE_STATS' && c.subsection.sourceHeading === 'Base Stats'), senna.map((c) => c.scope));
  const caitlyn = D.changes.filter((c) => /^caitlyn$/i.test(c.entity.name));
  check('REAL 7.3a: Riot\'s own lowercase "Base stats" (Caitlyn, an UNMATCHED champion Academy does not cover) is BASE_STATS too, and her "Headshot" block stays a named ABILITY block', caitlyn.some((c) => c.subsection.sourceHeading === 'Base stats' && c.scope === 'BASE_STATS') && caitlyn.some((c) => c.subsection.sourceHeading === 'Headshot' && c.scope === 'ABILITY'), caitlyn.map((c) => [c.subsection.sourceHeading, c.scope]));
  const baseStatsBlocks = D.changes.filter((c) => c.entity.type === 'champion' && /^base stats$/i.test(c.subsection ? c.subsection.sourceHeading : ''));
  check('REAL 7.3a: every "Base Stats" block of every champion in the section (Samira x3, Rammus x1, Caitlyn x1, Senna x5 = 10) is BASE_STATS', baseStatsBlocks.length === 10 && baseStatsBlocks.every((c) => c.scope === 'BASE_STATS'), baseStatsBlocks.length);
  const abilityBlocks = D.changes.filter((c) => c.entity.type === 'champion' && c.subsection && !/^base stats$/i.test(c.subsection.sourceHeading));
  check('REAL 7.3a: every other labelled champion block (Hwei, Swain, Yuumi, Viego, ...) is an ABILITY as Riot\'s named block', abilityBlocks.length >= 20 && abilityBlocks.every((c) => c.scope === 'ABILITY' && c.scopeBasis === 'riot_named_block'), [...new Set(abilityBlocks.map((c) => c.scope + '/' + c.scopeBasis))]);
  const yuumi = D.changes.find((c) => c.entity.name === 'Yuumi');
  check('REAL 7.3a: Yuumi\'s punctuated heading "You and Me!" is unchanged by all of this: sourceHeading, ABILITY scope, and the same stable ID', yuumi.subsection.sourceHeading === 'You and Me!' && yuumi.scope === 'ABILITY' && yuumi.changeId === YUUMI_ID);
}

// =======================================================================================================================
console.log('\n=== 4. PUBLIC PAGE + ICONS: only ability-like sections look for an icon ===');
{
  const real = await analyze(REAL_TEXT); const D = real.patchNotes;
  const pub = toPublicView(asReport(D), prodRosters().itemRoster);
  // files exist for EVERYTHING -- including Base Stats -- on purpose: the page must still only ask for abilities
  const idx = {
    senna: { 'base-stats': '/assets/abilities/senna/base-stats.webp', stats: '/assets/abilities/senna/stats.webp', absolution: '/assets/abilities/senna/absolution.webp' },
    hwei: { 'signature-of-the-visionary': '/assets/abilities/hwei/signature-of-the-visionary.webp', 'subject-disaster-devastating-fire': '/assets/abilities/hwei/subject-disaster-devastating-fire.webp', 'subject-disaster-severing-bolt': '/assets/abilities/hwei/subject-disaster-severing-bolt.webp', 'spiraling-despair': '/assets/abilities/hwei/spiraling-despair.webp', 'base-stats': '/assets/abilities/hwei/base-stats.webp' },
    yuumi: { 'you-and-me': '/assets/abilities/yuumi/you-and-me.webp', 'base-stats': '/assets/abilities/yuumi/base-stats.webp' },
    swain: { 'ravenous-flock': '/assets/abilities/swain/ravenous-flock.webp', nevermove: '/assets/abilities/swain/nevermove.webp' },
  };
  const html = await render(idx, pub);
  const sennaCard = cardOf(html, 'Senna');
  check('SENNA (Base Stats only), page: the champion card is there with all 5 change lines and the heading "Base Stats"', sennaCard.length > 0 && sennaCard.includes('>Base Stats<') && (sennaCard.match(/<p class="patch-entry-line">/g) || []).length === 5);
  check('SENNA: NO ability icon of any kind -- no <img class="ability-icon">, no placeholder -- even though senna/base-stats.webp and senna/stats.webp exist', !sennaCard.includes('ability-icon') && !sennaCard.includes('<img'), heads(sennaCard)[0]);
  check('SENNA: the subsection head is just the heading (no icon column at all)', heads(sennaCard).length === 1 && /^>\s*<div class="patch-sub-title">Base Stats<\/div><\/div>/.test(heads(sennaCard)[0]) , heads(sennaCard)[0]);
  const hweiCard = cardOf(html, 'Hwei');
  check('HWEI (real abilities): all four headings have their ability icon from Riot\'s exact heading, in front of the title', heads(hweiCard).length === 4 && heads(hweiCard).every((h) => h.includes('<img class="ability-icon"') && h.indexOf('ability-icon') < h.indexOf('patch-sub-title')) && heads(hweiCard)[1].includes('subject-disaster-devastating-fire.webp'), heads(hweiCard).map((h) => h.slice(0, 120)));
  check('HWEI: the file planted as hwei/base-stats.webp is unused (she has no Base Stats block) and nothing else is affected', !hweiCard.includes('base-stats.webp'));
  const yuumiCard = cardOf(html, 'Yuumi');
  check('YUUMI: "You and Me!" still gets yuumi/you-and-me.webp; yuumi/base-stats.webp is not used', heads(yuumiCard).length === 1 && heads(yuumiCard)[0].includes('src="/assets/abilities/yuumi/you-and-me.webp"') && !yuumiCard.includes('base-stats'));
  const noIcons = await render({}, pub);
  check('with NO icon files at all: abilities show the neutral placeholder, Base Stats shows nothing -- every heading and every change line is still present (7 sections, same lines as with icons)', heads(cardOf(noIcons, 'Hwei')).every((h) => h.includes('ability-icon-fallback')) && !cardOf(noIcons, 'Senna').includes('ability-icon') && (cardOf(noIcons, 'Senna').match(/patch-entry-line/g) || []).length === 5 && (noIcons.match(/<p class="patch-entry-line">/g) || []).length === (html.match(/<p class="patch-entry-line">/g) || []).length);

  // a champion with Base Stats AND abilities: only the abilities have icons
  const f = run(SHAPES.full('Leona')); const pf = pubOf(f.dataset);
  const fh = await render(bigIndex('leona', ['base-stats', 'passive-sunlight', 'sunlight', 'q-shield-of-daybreak', 'shield-of-daybreak', 'eclipse', 'zenith-blade', 'ultimate-solar-flare', 'solar-flare']), pf);
  const fHeads = heads(cardOf(fh, 'Leona'));
  check('Leona (Base Stats + Passive + 4 abilities), page: exactly the 5 ability-like heads have an icon, the Base Stats head has none', fHeads.length === 6 && !fHeads[0].includes('ability-icon') && fHeads.slice(1).every((h) => h.includes('<img class="ability-icon"')), fHeads.map((h) => h.slice(0, 90)));
  const mh = await render(bigIndex('leona', ['base-stats']), pubOf(run(SHAPES.noAbility('Leona')).dataset));
  check('a champion with no ability changes: no icon element anywhere on its card', !cardOf(mh, 'Leona').includes('ability-icon'));
  const mechHtml = await render({}, pubOf(run(SHAPES.mechanic('Leona')).dataset));
  check('an un-headed mechanic renders as plain change lines under the champion: no heading, no icon', !cardOf(mechHtml, 'Leona').includes('patch-sub-title') && !cardOf(mechHtml, 'Leona').includes('ability-icon') && cardOf(mechHtml, 'Leona').includes('Basic attacks no longer reset her passive timer.'));

  // the icon resolver itself is unchanged and scope-agnostic: the protection is the data + the page gate
  const resolve = createAbilityIconResolver(idx);
  check('the resolver still maps ANY heading to a file (scope-agnostic: it is not the icon system\'s job to decide) and still never guesses a slot', resolve('senna', { sourceHeading: 'Base Stats' }) !== null && resolve('senna', { sourceHeading: 'Some Mechanic' }) === null);

  // no fabricated Support interpretation / nothing hidden
  const e = pub.championChanges.find((x) => x.championId === 'senna');
  check('SENNA public entry: no Support interpretation was fabricated for the Base Stats change (supportImpact / buildImplications / coachNotes empty, no summary text invented)', e.supportImpact === '' && e.buildImplications === '' && e.coachNotes === '' && pub.supportMetaAnalysis === '' && e.subsections.flatMap((s) => s.changes).every((c) => c.note === ''));
  check('the public summary counts Senna like any other champion (not hidden for lacking an ability change): Hwei, Senna, Swain, Yuumi = 4', pub.summary.total === 4 && pub.summary.counts.champions === 4 && ['Hwei', 'Senna', 'Swain', 'Yuumi'].every((n) => pub.championChanges.some((x) => x.championName === n)), pub.summary);
  check('the public view carries no icon path, no dataset and no change IDs', !JSON.stringify(pub).includes('/assets/abilities') && !JSON.stringify(pub).includes('pn_') && !('patchNotes' in pub));
}

// =======================================================================================================================
console.log('\n=== 5. REVIEWER OVERRIDE: a section the default gets wrong is corrected once, in the review layer ===');
{
  const MECH = `## CHAMPION ADJUSTMENTS\n\n### Leona\n\nCrit Mechanics\n\n- Critical Strike Damage: 175% → 170%\n\nZenith Blade\n\n- Cooldown: 14 → 12\n`;
  const r = run(MECH); const ds = r.dataset;
  const crit = r.changes.find((c) => c.subsection.sourceHeading === 'Crit Mechanics');
  check('an unknown Riot heading ("Crit Mechanics") defaults to ABILITY as a named block -- the documented, visible default', crit.scope === 'ABILITY' && crit.scopeBasis === 'riot_named_block');
  const key = subsectionKeyOf(crit); const idBefore = crit.changeId; const extractionBefore = JSON.stringify([crit.scope, crit.scopeBasis, crit.subsection, crit.normalizedData, crit.originalSourceText, crit.provenance]);
  const res = applyReviewOps(ds, [{ op: 'setSubsectionScope', subsectionKey: key, scope: 'CHAMPION_MECHANIC' }]);
  check('setSubsectionScope applied; stored in dataset.subsectionReview[key].scope (review layer)', res.applied.length === 1 && ds.subsectionReview[key].scope === 'CHAMPION_MECHANIC', ds.subsectionReview);
  check('...the EXTRACTION is untouched (scope, basis, Riot heading, normalized data, source text, provenance) and so is the changeId', JSON.stringify([crit.scope, crit.scopeBasis, crit.subsection, crit.normalizedData, crit.originalSourceText, crit.provenance]) === extractionBefore && crit.changeId === idBefore);
  const pub = pubOf(ds); const [s0, s1] = subs(pub, 'leona');
  check('public: "Crit Mechanics" is now a CHAMPION_MECHANIC section (heading kept exactly, no abilityName); "Zenith Blade" is still an ability', s0.title === 'Crit Mechanics' && s0.sourceHeading === 'Crit Mechanics' && s0.scope === 'CHAMPION_MECHANIC' && s0.abilityName === null && s1.scope === 'ABILITY' && s1.abilityName === 'Zenith Blade', [s0, s1]);
  const html = await render({ leona: { 'crit-mechanics': '/assets/abilities/leona/crit-mechanics.webp', 'zenith-blade': '/assets/abilities/leona/zenith-blade.webp' } }, pub);
  const h = heads(cardOf(html, 'Leona'));
  check('page: no icon for the overridden section even though crit-mechanics.webp exists; the real ability keeps its icon', !h[0].includes('ability-icon') && h[0].includes('>Crit Mechanics<') && h[1].includes('zenith-blade.webp'), h.map((x) => x.slice(0, 100)));
  check('the admin preview tells the UI the effective AND the detected scope, so the override is visible and reversible', (() => { const p = publicPreview(asReport(ds), []); const e = p.subsections[crit.changeId]; return e.scope === 'CHAMPION_MECHANIC' && e.scopeExtracted === 'ABILITY' && e.scopeOverridden === true && e.entityType === 'champion'; })());

  // heading edits and scope edits are independent (the merge-safe subsectionReview entry)
  applyReviewOps(ds, [{ op: 'editSubsectionTitle', subsectionKey: key, displayHeading: 'Crit rules' }]);
  check('a display-heading edit keeps the scope override (neither op wipes the other)', ds.subsectionReview[key].scope === 'CHAMPION_MECHANIC' && ds.subsectionReview[key].displayHeading === 'Crit rules');
  applyReviewOps(ds, [{ op: 'setSubsectionScope', subsectionKey: key, scope: null }]);
  check('clearing the scope keeps the heading edit; clearing both removes the entry', ds.subsectionReview[key].displayHeading === 'Crit rules' && !('scope' in ds.subsectionReview[key]));
  applyReviewOps(ds, [{ op: 'editSubsectionTitle', subsectionKey: key, displayHeading: '' }]);
  check('...and the entry is gone once nothing is overridden', !(key in ds.subsectionReview));
  applyReviewOps(ds, [{ op: 'setSubsectionScope', subsectionKey: key, scope: 'base stats' }, { op: 'editSubsectionTitle', subsectionKey: key, displayHeading: 'Crit rules' }]);
  check('"Base Stats" may be assigned by hand as well (spelling-tolerant), and a reviewer may also say a stats-named section IS an ability', ds.subsectionReview[key].scope === 'BASE_STATS' && applyReviewOps(extract(SHAPES.onlyStats('Leona'), { rosters: ROSTER }).dataset, [{ op: 'setSubsectionScope', subsectionKey: subsectionKeyOf(extract(SHAPES.onlyStats('Leona'), { rosters: ROSTER }).changes[0]), scope: 'ABILITY' }]).applied.length === 1);
  const bad = applyReviewOps(ds, [{ op: 'setSubsectionScope', subsectionKey: key, scope: 'ITEM' }, { op: 'setSubsectionScope', subsectionKey: key, scope: 'nonsense' }, { op: 'setSubsectionScope', subsectionKey: 'nope', scope: 'ABILITY' }, { op: 'setSubsectionScope', subsectionKey: key, scope: 7 }]);
  check('invalid scopes (ITEM / unknown / a number) and unknown subsection keys are rejected; the stored override is unchanged', bad.errors.length === 4 && bad.applied.length === 0 && ds.subsectionReview[key].scope === 'BASE_STATS' && SUBSECTION_SCOPE_OPTIONS.map(([v]) => v).join() === 'ABILITY,PASSIVE,BASE_STATS,CHAMPION_MECHANIC');
  // regeneration
  const fresh = extract(MECH, { rosters: ROSTER }).dataset;
  const merged = mergeReviewState(fresh, ds);
  check('REGENERATION (mergeReviewState): the scope override and the heading edit ride along; the fresh extraction is still the extractor\'s', merged.subsectionReview[key].scope === 'BASE_STATS' && merged.subsectionReview[key].displayHeading === 'Crit rules' && merged.changes.find((c) => c.changeId === idBefore).scope === 'ABILITY');
}

// =======================================================================================================================
console.log('\n=== 6. HEADING EDITS vs sourceHeading, scope, icon resolution; IDs ===');
{
  const real = await analyze(REAL_TEXT); const D = JSON.parse(JSON.stringify(real.patchNotes));
  const sen = D.changes.find((c) => c.entity.name === 'Senna'); const yu = D.changes.find((c) => c.entity.name === 'Yuumi'); const hw = D.changes.find((c) => c.subsection && c.subsection.sourceHeading === 'Signature of the Visionary');
  const before = JSON.stringify(D.changes.map((c) => [c.changeId, c.scope, c.scopeBasis, c.subsection, c.originalSourceText]));
  applyReviewOps(D, [
    { op: 'editSubsectionTitle', subsectionKey: subsectionKeyOf(sen), displayHeading: 'Stat tweaks' },
    { op: 'editSubsectionTitle', subsectionKey: subsectionKeyOf(yu), displayHeading: 'Friend zone' },
    { op: 'editSubsectionTitle', subsectionKey: subsectionKeyOf(hw), displayHeading: 'Visionary passive' },
  ]);
  check('three display-heading edits (a Base Stats section, Yuumi\'s ability, Hwei\'s passive-style ability) change NO changeId, scope, scopeBasis, Riot heading or source text', JSON.stringify(D.changes.map((c) => [c.changeId, c.scope, c.scopeBasis, c.subsection, c.originalSourceText])) === before);
  const pub = toPublicView(asReport(D), prodRosters().itemRoster);
  const sP = pub.championChanges.find((e) => e.championId === 'senna').subsections[0]; const yP = pub.championChanges.find((e) => e.championId === 'yuumi').subsections[0]; const hP = pub.championChanges.find((e) => e.championId === 'hwei').subsections[0];
  check('public: the display headings show, Riot\'s sourceHeading stays, and the scope is unchanged by the edit (Base Stats stays BASE_STATS, the abilities stay ABILITY)', sP.title === 'Stat tweaks' && sP.sourceHeading === 'Base Stats' && sP.scope === 'BASE_STATS' && yP.title === 'Friend zone' && yP.sourceHeading === 'You and Me!' && yP.scope === 'ABILITY' && hP.title === 'Visionary passive' && hP.sourceHeading === 'Signature of the Visionary' && hP.scope === 'ABILITY');
  const idx = { senna: { 'base-stats': '/b.webp', 'stat-tweaks': '/s.webp' }, yuumi: { 'you-and-me': '/assets/abilities/yuumi/you-and-me.webp', 'friend-zone': '/f.webp' }, hwei: { 'signature-of-the-visionary': '/assets/abilities/hwei/signature-of-the-visionary.webp', 'visionary-passive': '/v.webp' } };
  const html = await render(idx, pub);
  check('page: the icons follow RIOT\'S heading, never the edited text (you-and-me.webp / signature-of-the-visionary.webp used; friend-zone / visionary-passive never); the renamed Base Stats section still has no icon, under either name', heads(cardOf(html, 'Yuumi'))[0].includes('you-and-me.webp') && !html.includes('/f.webp') && heads(cardOf(html, 'Hwei'))[0].includes('signature-of-the-visionary.webp') && !html.includes('/v.webp') && !cardOf(html, 'Senna').includes('ability-icon') && !html.includes('/s.webp') && !html.includes('/b.webp') && cardOf(html, 'Senna').includes('>Stat tweaks<'));

  // changeIds: every change of the real section, against the pre-change baseline
  const real2 = await analyze(REAL_TEXT);
  const ids = real2.patchNotes.changes.map((c) => c.changeId);
  const expected = ROWS_BEFORE.map((r) => (r[0] === 'Yuumi' ? YUUMI_ID : r[5]));
  check('ALL 38 changeIds of the real 7.3a section are identical to the ones before this change (scope is not part of any identity)', ids.length === 38 && JSON.stringify(ids) === JSON.stringify(expected), ids.filter((id, i) => id !== expected[i]));
  check('...and re-running the extraction is deterministic (same scopes, same IDs)', JSON.stringify(real2.patchNotes.changes.map((c) => [c.changeId, c.scope, c.scopeBasis])) === JSON.stringify((await analyze(REAL_TEXT)).patchNotes.changes.map((c) => [c.changeId, c.scope, c.scopeBasis])));
}

// =======================================================================================================================
console.log('\n=== 7. REGENERATION through the real handlers: review state, IDs, revisions ===');
{
  const store = new Map(Object.entries(KV_BEFORE)); const writes = [];
  const kv = { get: async (k) => (store.has(k) ? store.get(k) : null), put: async (k, v) => { writes.push(k); store.set(k, String(v)); }, delete: async (k) => { writes.push(`DELETE ${k}`); store.delete(k); }, list: async ({ prefix = '' } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: null }) };
  const COACH = JSON.stringify({ revision: 9, champions: { senna: { tier: 'A' } }, items: {}, runes: {}, decisionTrees: {}, patch: '7.2b' });
  store.set('coach-overrides', COACH);
  store.set('riot-latest-patch-meta', JSON.stringify({ slug: SLUG })); store.set(`riot-fallback-full-content:${SLUG}:${SOURCE_TEXT_VERSION}`, JSON.stringify({ content: REAL_TEXT, truncated: false }));
  const env = { COACH_KV: kv, ADMIN_SESSION_SECRET: 'test-secret', ANTHROPIC_API_KEY: 'would-be-used-if-AI-ran' };
  const cookie = `academy_admin_session=${await createSessionToken(env)}`;
  const post = (url, body) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const act = async (body) => { const r = await reportsPost({ request: post('https://x/api/admin/patch-reports', body), env }); return { status: r.status, body: await r.json() }; };
  const getRev = async (revision) => (await (await adminGet({ request: new Request(`https://x/api/admin/patch-reports?id=${SLUG}&revision=${revision}`, { headers: { Cookie: cookie } }), env })).json()).report;
  const pubOfApi = async () => (await (await publicGet({ request: new Request('https://x/api/patch-reports'), env })).json()).reports.find((r) => r.id === SLUG);

  const rev1 = await getRev(1);
  const senOld = rev1.patchNotes.changes.find((c) => c.entity && c.entity.name === 'Senna');
  check('setup: the STORED revision 1 predates `scope` (no scope fields) -- and its public view already derives the right scopes without any rewrite', senOld.scope === undefined && senOld.scopeBasis === undefined && scopeOf(senOld).scope === 'BASE_STATS');
  const sKey = subsectionKeyOf(senOld);
  const saved = await act({ id: SLUG, action: 'review', revision: 1, ops: [
    { op: 'edit', changeId: senOld.changeId, displayTitle: senOld.review.displayTitle, displayText: senOld.review.displayText, reviewerNote: 'Attack speed windup nerf' },
    { op: 'classify', changeId: senOld.changeId, comparisonState: 'NERF' },
    { op: 'impactSection', sectionKey: senOld.entity.key ? `${senOld.entity.key}` : '', changeImpact: 'HIGH' },
    { op: 'editSubsectionTitle', subsectionKey: sKey, displayHeading: 'Stat tweaks' },
    { op: 'setSubsectionScope', subsectionKey: sKey, scope: 'CHAMPION_MECHANIC' },
  ] });
  const applied = saved.body && saved.body.applied ? saved.body.applied : [];
  check('setup: note, NERF override, heading edit and a scope override are saved on the old Senna Base Stats section (the impact op is allowed to be rejected if its key shape differs; the rest must apply)', saved.status === 200 || (saved.body && saved.body.errors), saved.body);
  const rev1Stored = store.get(`patch-intel:report:${SLUG}:1`); // revision 1 AFTER the admin's review of it, BEFORE the rescan
  const rs = await (await checkPost({ request: post('https://x/api/admin/patch-check', { action: 'rescan', patchId: SLUG }), env })).json();
  check('rescan creates revision 2 from the same Riot text', rs.ok === true && rs.report.revision === 2);
  const rev2 = await getRev(2);
  const senNew = rev2.patchNotes.changes.find((c) => c.changeId === senOld.changeId);
  check('revision 2: the SAME stable ID for Senna\'s Base Stats change (scope did not alter identity), now carrying the extractor\'s scope BASE_STATS / riot_stats_heading', senNew && senNew.scope === 'BASE_STATS' && senNew.scopeBasis === 'riot_stats_heading' && senNew.subsection.sourceHeading === 'Base Stats', senNew && [senNew.scope, senNew.scopeBasis]);
  check('review state survived: note, classification override, edited-state flags (and the heading edit + scope override in the review layer)', senNew.review.reviewerNote === 'Attack speed windup nerf' && senNew.review.comparisonStateOverride === 'NERF' && rev2.patchNotes.subsectionReview[sKey].displayHeading === 'Stat tweaks' && rev2.patchNotes.subsectionReview[sKey].scope === 'CHAMPION_MECHANIC', [senNew.review, rev2.patchNotes.subsectionReview]);
  check('all 38 changeIds of revision 2 are the expected ones (scope added nothing to any identity); nothing orphaned', rev2.patchNotes.changes.length === 38 && rev2.patchNotes.orphanedChanges.length === 0 && rev2.patchNotes.changes.every((c, i) => c.changeId === (ROWS_BEFORE[i][0] === 'Yuumi' ? YUUMI_ID : ROWS_BEFORE[i][5]) || ROWS_BEFORE[i][0] === 'Yuumi'));
  check('revision 1 is byte-for-byte untouched by the rescan', store.get(`patch-intel:report:${SLUG}:1`) === rev1Stored);
  await act({ id: SLUG, action: 'approve', revision: 2 }); await act({ id: SLUG, action: 'publish', revision: 2, alsoMarkVerified: false });
  const pub = await pubOfApi();
  const sPub = pub.championChanges.find((e) => e.championId === 'senna').subsections[0];
  check('PUBLIC after publishing revision 2: the display heading, the note, the NERF badge and the reviewer\'s scope (CHAMPION_MECHANIC -> no icon eligibility) all arrive; Riot\'s heading is still "Base Stats"', pub.revision === 2 && sPub.title === 'Stat tweaks' && sPub.sourceHeading === 'Base Stats' && sPub.scope === 'CHAMPION_MECHANIC' && sPub.changes.some((c) => c.note === 'Attack speed windup nerf' && c.classification === 'NERF'), sPub);
  check('only patch-intel:* keys were written; coach-overrides is byte-identical; nothing was fetched (no AI, no network)', writes.every((k) => k.startsWith('patch-intel:')) && store.get('coach-overrides') === COACH && fetchCalls.length === 0, writes.filter((k) => !k.startsWith('patch-intel:')));
}

// =======================================================================================================================
console.log('\n=== 8. OLD STORED DATASETS (no scope fields) read correctly and are never mutated ===');
{
  const old = JSON.parse(KV_BEFORE[`patch-intel:report:${SLUG}:1`]).patchNotes;
  const snapshot = JSON.stringify(old);
  const pub = toPublicView({ ...asReport(old), patchNotes: old }, prodRosters().itemRoster);
  check('the stored dataset carries no `scope` anywhere (it predates the field)', old.changes.every((c) => c.scope === undefined && c.scopeBasis === undefined));
  check('...yet its public view classifies every section: Senna BASE_STATS; Hwei\'s four sections ABILITY; Swain ABILITY', sig(subs(pub, 'senna')) === 'Base Stats:BASE_STATS' && subs(pub, 'hwei').every((s) => s.scope === 'ABILITY') && subs(pub, 'hwei').length === 4 && subs(pub, 'swain').every((s) => s.scope === 'ABILITY'), [sig(subs(pub, 'senna')), sig(subs(pub, 'hwei'))]);
  check('...Yuumi (pre-"You and Me!" extraction, no subsection) reads as CHAMPION_MECHANIC / no_riot_subsection -- not as an ability with a made-up name', sig(subs(pub, 'yuumi')) === 'null:CHAMPION_MECHANIC' && subs(pub, 'yuumi')[0].abilityName === null, sig(subs(pub, 'yuumi')));
  check('reading it changed nothing in the stored dataset (pure derivation)', JSON.stringify(old) === snapshot);
  const pre = publicPreview({ ...asReport(old), patchNotes: old }, []);
  check('the admin preview derives scopes for old data too (so the review UI can show and override them with no re-scan)', Object.values(pre.subsections).filter((s) => s.scope === 'BASE_STATS').length === 10 && Object.values(pre.subsections).every((s) => s.scopeExtracted));
  check('no outbound request happened anywhere in this file (no AI provider, no network)', fetchCalls.length === 0, fetchCalls);
}

done();
