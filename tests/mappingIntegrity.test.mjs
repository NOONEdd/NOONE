// Mapping integrity -- every value the Academy data uses must have a complete display mapping (icon + color + position), every
// mapping must be valid, and NO missing / invalid mapping may crash a page (the React #130 regression: Senna's role "Marksman
// Support" had no ROLE_ICONS entry, RankChip rendered <undefined />, and the whole Champion Tier List went blank).
//
// Run directly (also wired as `npm run check:mappings` and in CI):
//
//   node tests/mappingIntegrity.test.mjs
//
// Uses the existing in-memory esbuild bundling helper (tests/helpers/renderBundle.mjs) because src/data/constants.js imports
// JSX icon components. Renders with react-dom/server only. Nothing in the repo is written; no KV, no network.

import fs from 'node:fs';
import path from 'node:path';
import { bundleModule, src, ROOT } from './helpers/renderBundle.mjs';

let pass = 0; let fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  PASS -', label); }
  else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail).slice(0, 500) : ''); }
};

const m = await bundleModule(`
  import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server';
  export { React, renderToStaticMarkup };
  export * as C from ${src('src/data/constants.js')};
  export * as R from ${src('src/lib/displayRegistry.js')};
  export * as V from ${src('src/lib/mappingValidation.js')};
  export { CHAMPIONS, isAcademyCovered } from ${src('src/data/champions.js')};
  export { ITEMS, ALL_ITEMS } from ${src('src/data/items.js')};
  export { RUNES } from ${src('src/data/runes.js')};
  export { MATCHUPS } from ${src('src/data/matchups.js')};
  export { resolveEffectiveChampion, resolveEffectiveItem, resolveEffectiveRune } from ${src('src/lib/effectiveData.js')};
  export { default as RankChip } from ${src('src/components/RankChip.jsx')};
  export { TierBoard } from ${src('src/components/TierBoard.jsx')};
  export { ChampionTierListPage, ItemTierListPage, RuneTierListPage } from ${src('src/pages/TierListPages.jsx')};
  export { GuidesPage } from ${src('src/pages/GuidesPage.jsx')};
  export { default as ChampionDetailPage } from ${src('src/pages/ChampionDetailPage.jsx')};
  export { default as HomePage } from ${src('src/pages/HomePage.jsx')};
  export { default as EntityImage } from ${src('src/components/EntityImage.jsx')};
  export * as Lucide from 'lucide-react';
`);
const { React, renderToStaticMarkup, C, R, V, CHAMPIONS, ITEMS, ALL_ITEMS, RUNES, MATCHUPS, isAcademyCovered } = m;
const h = React.createElement;
const html = (el) => renderToStaticMarkup(el);
const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const tryRender = (el) => { try { return { ok: true, out: html(el) }; } catch (e) { return { ok: false, error: String(e && e.message || e) }; } };

// capture registry diagnostics instead of printing them
const diagnostics = [];
R.setMappingDiagnosticSink((message, details) => diagnostics.push({ message, details }));
const resetDiag = () => { diagnostics.length = 0; R.resetMappingDiagnostics(); };

const { DISPLAY_REGISTRIES } = C;
// every canonical item record, incl. the support quest items (src/data/items.js ALL_ITEMS) -- they are rendered (Patch Notes, builds) too
const report = V.validateAcademyMappings({ registries: DISPLAY_REGISTRIES, champions: CHAMPIONS, items: ALL_ITEMS, runes: RUNES, isCovered: isAcademyCovered });

// ======================================================================================================================
console.log('\n=== 1. The shipped registries are valid (every icon a React component, every color usable, keys unambiguous) ===');
for (const reg of Object.values(DISPLAY_REGISTRIES)) {
  const issues = V.validateRegistry(reg);
  check(`${reg.name}: ${reg.keys.length} entries, no registry issue`, issues.length === 0, issues.map((i) => i.message));
}
for (const [mapName, map] of [['ROLE_ICONS', C.ROLE_ICONS], ['ITEM_ICONS', C.ITEM_ICONS], ['RUNE_ICONS', C.RUNE_ICONS]]) {
  const bad = Object.entries(map).filter(([, v]) => !R.isIconComponent(v)).map(([k]) => k);
  check(`${mapName}: every value is a renderable component (not undefined, not an icon-name string)`, bad.length === 0, bad);
}
const lucideNames = ['Sparkles', 'Shield', 'Swords', 'Target', 'Lightbulb', 'Flame', 'Castle', 'Trees', 'Zap', 'Crosshair', 'CircleHelp'];
check('every lucide-react icon constants.js imports exists in the installed lucide-react', lucideNames.every((n) => R.isIconComponent(m.Lucide[n])), lucideNames.filter((n) => !R.isIconComponent(m.Lucide[n])));
const iconsSrc = fs.readFileSync(path.join(ROOT, 'src/components/icons.jsx'), 'utf8');
const customUsed = ['IconMagnet', 'IconWand', 'IconHeart', 'IconBoot', 'IconGem', 'IconSkull', 'IconDagger'];
check('every custom icon constants.js imports is a named function export of src/components/icons.jsx', customUsed.every((n) => new RegExp(`export function ${n}\\(`).test(iconsSrc)));
check('src/components/icons.jsx imports nothing (no circular dependency can leave an icon half-initialized)', !/^\s*import\s/m.test(iconsSrc));
const everyMappedIcon = Object.values(DISPLAY_REGISTRIES).flatMap((r) => r.keys.map((k) => r.config[k].icon)).filter(Boolean);
check('the fallback icon is valid and is NOT the icon of any real mapping (a fallback can never pass for a mapped value on screen)', R.isIconComponent(C.FALLBACK_DISPLAY.icon) && !everyMappedIcon.includes(C.FALLBACK_DISPLAY.icon));

// ======================================================================================================================
console.log('\n=== 2. Legacy exports are DERIVED from the registries and unchanged (no consumer import breaks) ===');
const nameOf = (v) => (v && (v.displayName || v.name || (v.render && v.render.displayName))) || String(v);
const snapshot = {
  TIER_ORDER: ['S', 'A', 'B', 'C', 'D', 'Unranked'],
  TIER_SELECT: ['Unranked', 'S', 'A', 'B', 'C', 'D'],
  TIER_COLORS: { S: '#f3c969', A: '#ff5fc1', B: '#9b6bff', C: '#1fd0ff', D: '#5c6182', Unranked: '#3a3f5c' },
  ROLE_ICONS: { Enchanter: 'Sparkles', Catcher: 'IconMagnet', 'Assassin Catcher': 'IconDagger', Warden: 'Shield', 'Mage Support': 'IconWand', 'Marksman Support': 'Crosshair', 'Off-Meta Flex': 'Swords', Baron: 'Castle', Jungle: 'Trees', Mid: 'Zap', Dragon: 'Crosshair' },
  ROLE_COLORS: { Enchanter: '#9b6bff', Catcher: '#f3c969', 'Assassin Catcher': '#ff6b6b', Warden: '#1fd0ff', 'Mage Support': '#3df0d8', 'Marksman Support': '#ff6b6b', 'Off-Meta Flex': '#ff5fc1', Baron: '#f3c969', Jungle: '#3df0d8', Mid: '#ff5fc1', Dragon: '#ff6b6b' },
  ITEM_ICONS: { Support: 'IconHeart', Defense: 'Shield', Boots: 'IconBoot', Enchant: 'IconWand', Magic: 'Flame', Physical: 'Swords' },
  ITEM_COLORS: { Support: '#ff5fc1', Defense: '#1fd0ff', Boots: '#f3c969', Enchant: '#9b6bff', Magic: '#3df0d8', Physical: '#ff6b6b' },
  ITEM_CATEGORIES: ['Support', 'Defense', 'Boots', 'Enchant', 'Magic', 'Physical'],
  RUNE_ICONS: { Keystone: 'IconGem', Precision: 'Target', Domination: 'IconSkull', Resolve: 'Shield', Inspiration: 'Lightbulb' },
  RUNE_COLORS: { Keystone: '#f3c969', Precision: '#1fd0ff', Domination: '#ff6b6b', Resolve: '#9b6bff', Inspiration: '#ff5fc1' },
  RUNE_PATHS: ['Keystone', 'Precision', 'Domination', 'Resolve', 'Inspiration'],
};
for (const [exportName, expected] of Object.entries(snapshot)) {
  const actual = C[exportName];
  const shown = Array.isArray(actual) ? [...actual] : Object.fromEntries(Object.entries(actual).map(([k, v]) => [k, /ICONS/.test(exportName) ? nameOf(v) : v]));
  check(`${exportName} still exported with the exact previous keys, order and values`, JSON.stringify(shown) === JSON.stringify(expected), shown);
}
check('SUMMONER_SPELLS and NAV_LINKS still exported', Array.isArray(C.SUMMONER_SPELLS) && Array.isArray(C.NAV_LINKS));

// ======================================================================================================================
console.log('\n=== 3. The REAL data: every value used has a complete mapping (this is the release gate) ===');
if (!report.ok || report.counts.warning) console.log(V.formatMappingReport(report));
check(`validateAcademyMappings over the real data: ok, 0 fatal (${report.counts.fatal}), 0 recoverable (${report.counts.recoverable}), 0 warning (${report.counts.warning})`,
  report.ok && report.counts.recoverable === 0 && report.counts.warning === 0, report.issues.filter((i) => i.severity !== 'info').map((i) => i.message));
console.log('\n  Coverage (computed from src/data/*.js):');
for (const c of report.coverage) console.log(`    ${c.registry.padEnd(13)} values=${c.values.length} mapped=${c.mapped.length} missing=${JSON.stringify(c.missing)} unused=${JSON.stringify(c.unused)}`);

const actualRoles = [...new Set(CHAMPIONS.map((c) => c.role))];
for (const role of ['Enchanter', 'Catcher', 'Assassin Catcher', 'Warden', 'Mage Support', 'Marksman Support', 'Off-Meta Flex', 'Baron', 'Jungle', 'Mid', 'Dragon', ...actualRoles.filter((r) => !['Enchanter', 'Catcher', 'Assassin Catcher', 'Warden', 'Mage Support', 'Marksman Support', 'Off-Meta Flex', 'Baron', 'Jungle', 'Mid', 'Dragon'].includes(r))]) {
  const e = DISPLAY_REGISTRIES.championRole.config[role];
  check(`role "${role}" has a valid icon (${e ? nameOf(e.icon) : 'none'}) and color (${e ? e.color : 'none'})`, Boolean(e) && R.isIconComponent(e.icon) && R.isColorValue(e.color));
}
check('every actual champion role is one of those (no role in the data that the list above missed)', actualRoles.every((r) => Object.prototype.hasOwnProperty.call(DISPLAY_REGISTRIES.championRole.config, r)), actualRoles);

console.log('\n  -- specific regressions --');
const champ = (id) => CHAMPIONS.find((c) => c.id === id);
for (const [id, role] of [['senna', 'Marksman Support'], ['camille', 'Catcher'], ['hwei', 'Mage Support']]) {
  const c = champ(id);
  const d = C.roleDisplay(c.role);
  check(`${c.name}: role is "${role}" and resolves to its OWN icon + color (not the fallback)`, c.role === role && d.known && d.icon === DISPLAY_REGISTRIES.championRole.config[role].icon && d.icon !== C.FALLBACK_DISPLAY.icon, { role: c.role, known: d.known });
}
check('no champion still uses the obsolete role "Fighter" (Camille\'s old value) or any role outside the registry', CHAMPIONS.every((c) => c.role !== 'Fighter') && report.issues.filter((i) => i.field === 'role' && i.dataset === 'champions').length === 0);
check('role vocabularies are consistent: all 38 coached champions use a support archetype, every roster-only champion a lane tag',
  CHAMPIONS.every((c) => DISPLAY_REGISTRIES.championRole.config[c.role].group === (isAcademyCovered(c) ? 'support' : 'lane')));

for (const cat of [...new Set(ALL_ITEMS.map((i) => i.category))]) {
  const e = DISPLAY_REGISTRIES.itemCategory.config[cat];
  check(`item category "${cat}": valid icon, valid color, and a filter pill (ITEM_CATEGORIES)`, Boolean(e) && R.isIconComponent(e.icon) && R.isColorValue(e.color) && C.ITEM_CATEGORIES.includes(cat));
}
for (const p of [...new Set(RUNES.map((r) => r.path))]) {
  const e = DISPLAY_REGISTRIES.runePath.config[p];
  check(`rune path "${p}": valid icon, valid color, and a filter pill (RUNE_PATHS)`, Boolean(e) && R.isIconComponent(e.icon) && R.isColorValue(e.color) && C.RUNE_PATHS.includes(p));
}
for (const t of [...new Set([...CHAMPIONS, ...ALL_ITEMS, ...RUNES].map((x) => x.tier))]) {
  check(`tier "${t}": valid color, a row in TIER_ORDER, and an option in TIER_SELECT`, R.isColorValue(C.TIER_COLORS[t]) && C.TIER_ORDER.includes(t) && C.TIER_SELECT.includes(t));
}
check('TIER_ORDER and TIER_SELECT hold exactly the same tiers (every selectable tier has a row, every row is selectable)', [...C.TIER_ORDER].sort().join() === [...C.TIER_SELECT].sort().join());
const difficulties = Object.values(MATCHUPS).flatMap((rel) => ['hardAgainst', 'goodAgainst', 'goodWith'].flatMap((k) => (rel[k] || []).map((e) => (typeof e === 'string' ? 'medium' : e.difficulty))));
check(`matchup difficulties in src/data/matchups.js (${difficulties.length}) are all low/medium/high (ChampionMatchups DIFFICULTY_COLORS / server validation)`, difficulties.every((d) => ['low', 'medium', 'high'].includes(d)), [...new Set(difficulties)]);
const appSrc = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
check('every NAV_LINKS page has a route in App.jsx (home is the default branch)', C.NAV_LINKS.every((l) => l.page === 'home' || appSrc.includes(`route.page === "${l.page}"`)), C.NAV_LINKS.map((l) => l.page));

// ======================================================================================================================
console.log('\n=== 4. The validator CATCHES what it must (synthetic data -- a new value without its mapping is a clear, actionable error) ===');
{
  const champs = [
    { id: 'newbie', name: 'Newbie', role: 'Tank Support', tier: 'A' },
    { id: 'padded', name: 'Padded', role: ' Catcher', tier: 'B' },
    { id: 'lower', name: 'Lower', role: 'catcher', tier: 'C' },
    { id: 'proto', name: 'Proto', role: 'constructor', tier: 'D' },
    { id: 'numeric', name: 'Numeric', role: 7, tier: 'S' },
    { id: 'noRole', name: 'No Role', tier: 'S' },
    { id: 'tiered', name: 'Tiered', role: 'Enchanter', tier: 'S+' },
  ];
  const r = V.validateAcademyMappings({ registries: DISPLAY_REGISTRIES, champions: champs, items: [{ id: 'x', name: 'Quest Thing', category: 'Quest', tier: 'Unranked' }], runes: [{ id: 'y', name: 'Sorcery Rune', path: 'Sorcery', tier: 'Unranked' }] });
  const find = (id, field) => r.issues.find((i) => i.entityId === id && i.field === field);
  const nb = find('newbie', 'role');
  check('new role "Tank Support" without a mapping -> FATAL missing-mapping-key, naming dataset, entity id, entity name, field, value and what is missing',
    nb && nb.severity === 'fatal' && nb.kind === 'missing-mapping-key' && nb.dataset === 'champions' && nb.entityName === 'Newbie' && nb.value === 'Tank Support' && nb.registry === 'championRole' && nb.missing.join() === 'icon,color', nb);
  check('...and the report as a whole is NOT ok', r.ok === false);
  check('leading whitespace " Catcher" -> FATAL mapping-key-mismatch with suggestion "Catcher"', find('padded', 'role')?.kind === 'mapping-key-mismatch' && find('padded', 'role')?.suggestion === 'Catcher');
  check('case mismatch "catcher" -> FATAL mapping-key-mismatch with suggestion "Catcher"', find('lower', 'role')?.suggestion === 'Catcher' && find('lower', 'role')?.severity === 'fatal');
  check('a prototype key ("constructor") is NOT treated as mapped', find('proto', 'role')?.kind === 'missing-mapping-key');
  check('a non-string role (7) -> invalid-value-type', find('numeric', 'role')?.kind === 'invalid-value-type');
  check('a missing role field -> missing-value', find('noRole', 'role')?.kind === 'missing-value');
  check('an unknown tier "S+" in canonical data -> FATAL (no row, no color, no option)', find('tiered', 'tier')?.severity === 'fatal');
  check('an unmapped item category "Quest" -> FATAL (no icon / color / filter pill)', find('x', 'category')?.severity === 'fatal');
  check('an unmapped rune path "Sorcery" -> FATAL', find('y', 'path')?.severity === 'fatal');
  const fmt = V.formatMappingReport(r);
  check('the formatted report names the dataset, entity and the fix', /champions "newbie" \(Newbie\): role "Tank Support" has no icon \/ color mapping in championRole/.test(fmt) && /did you mean "Catcher"/.test(fmt), fmt.split('\n').slice(0, 4));

  const badRegistry = R.defineRegistry({ name: 'broken', entries: [['A', { icon: undefined, color: '#fff' }], ['B', { icon: 'Sparkles', color: '#123456' }], ['C', { icon: m.Lucide.Shield, color: 'red' }], ['c', { icon: m.Lucide.Shield, color: '#000' }], [' D', { icon: m.Lucide.Shield, color: '#000' }]], fallback: C.FALLBACK_DISPLAY });
  const kinds = V.validateRegistry(badRegistry).map((i) => `${i.value}:${i.kind}`);
  check('registry self-check: undefined icon -> missing-icon', kinds.includes('A:missing-icon'), kinds);
  check('registry self-check: an icon NAME string instead of a component -> invalid-icon', kinds.includes('B:invalid-icon'), kinds);
  check('registry self-check: an unusable color ("red") -> invalid-color', kinds.includes('C:invalid-color'), kinds);
  check('registry self-check: keys differing only by case ("C" / "c") -> ambiguous-registry-key', kinds.includes('c:ambiguous-registry-key'), kinds);
  check('registry self-check: whitespace-padded key -> invalid-registry-key', kinds.includes(' D:invalid-registry-key'), kinds);

  const ov = V.validateAcademyMappings({ registries: DISPLAY_REGISTRIES, champions: CHAMPIONS, items: ITEMS, runes: RUNES, isCovered: isAcademyCovered,
    overrides: { champions: { senna: { tier: 'S+' }, lulu: { tier: '' }, ghost: { tier: 'A' } }, items: { 'ardent-censer': { tier: 7 } }, runes: 'oops' } });
  const ovFind = (id) => ov.issues.filter((i) => i.entityId === id).map((i) => `${i.severity}:${i.kind}`);
  check('runtime override tier "S+" -> RECOVERABLE (UI shows it, never crashes) -- not fatal', ovFind('senna').includes('recoverable:missing-mapping-key') && ov.ok === true, ovFind('senna'));
  check('an empty override tier ("" = use the base tier) is not an issue', ovFind('lulu').length === 0, ovFind('lulu'));
  check('an override for an id not in the catalog -> WARNING (the site ignores it)', ovFind('ghost').includes('warning:override-unknown-entity'), ovFind('ghost'));
  check('a non-string override tier -> RECOVERABLE invalid-value-type', ovFind('ardent-censer').includes('recoverable:invalid-value-type'), ovFind('ardent-censer'));
  check('a malformed overrides map -> RECOVERABLE invalid-override-map', ov.issues.some((i) => i.kind === 'invalid-override-map' && i.dataset === 'overrides.runes'));

  const mixed = V.validateAcademyMappings({ registries: DISPLAY_REGISTRIES, champions: [{ id: 'lulu', name: 'Lulu', role: 'Mid', tier: 'S' }, { id: 'ahri', name: 'Ahri', role: 'Enchanter', tier: 'Unranked' }], isCovered: isAcademyCovered });
  check('a coached champion filed under a lane tag, and a roster-only champion under a support archetype -> WARNING role-vocabulary-mismatch',
    mixed.issues.filter((i) => i.kind === 'role-vocabulary-mismatch').map((i) => i.entityId).join() === 'lulu,ahri');
  check('unused registry keys are reported as INFO only', mixed.issues.filter((i) => i.kind === 'unused-registry-key').every((i) => i.severity === 'info'));
}

// ======================================================================================================================
console.log('\n=== 5. lookupDisplay never returns an unrenderable value, and reports each miss exactly once ===');
{
  resetDiag();
  for (const key of [undefined, null, '', 'Tank Support', 'constructor', 'toString', '__proto__', 'hasOwnProperty', 42]) {
    const d = C.roleDisplay(key, { dataset: 'champions', entityId: 'probe' });
    check(`roleDisplay(${JSON.stringify(key)}) -> fallback icon component + neutral color, known=false`, d.known === false && d.icon === C.FALLBACK_DISPLAY.icon && R.isIconComponent(d.icon) && d.color === C.FALLBACK_DISPLAY.color);
  }
  resetDiag();
  for (let i = 0; i < 50; i++) C.roleDisplay('Tank Support', { dataset: 'champions', entityId: `e${i}` });
  check('50 lookups of the same unknown role -> exactly ONE diagnostic (no console flood)', diagnostics.length === 1, diagnostics.length);
  check('...and it identifies the registry, the key, what is missing and the first entity that hit it', diagnostics[0] && diagnostics[0].details.registry === 'championRole' && diagnostics[0].details.key === 'Tank Support' && diagnostics[0].details.missing.join() === 'icon,color' && diagnostics[0].details.entityId === 'e0', diagnostics[0] && diagnostics[0].details);
  resetDiag();
  const valid = C.roleDisplay('Enchanter');
  check('a mapped value resolves to its own icon/color and reports nothing', valid.known && valid.icon === C.ROLE_ICONS.Enchanter && valid.color === C.ROLE_COLORS.Enchanter && diagnostics.length === 0);
  const partial = R.defineRegistry({ name: 'partial', entries: [['X', { icon: undefined, color: '#abcdef' }]], fallback: C.FALLBACK_DISPLAY });
  const p = R.lookupDisplay(partial, 'X');
  check('an entry with an invalid icon but a valid color -> fallback icon, KEEPS its own color, reports "icon" only', p.icon === C.FALLBACK_DISPLAY.icon && p.color === '#abcdef' && diagnostics.at(-1).details.missing.join() === 'icon');
  check('tierDisplay("S+") -> neutral fallback color', C.tierDisplay('S+').color === C.FALLBACK_DISPLAY.color);
}

// ======================================================================================================================
console.log('\n=== 6. Component safety: missing / invalid mappings never crash a component (React #130) ===');
// the fallback icon is recognised by its lucide class (any size); it is used by no real mapping (asserted in section 1)
const FALLBACK_CLASS = 'lucide-circle-help';
const fallbackUsed = (s) => s.includes(FALLBACK_CLASS);
const sparklesSvg = html(h(m.Lucide.Sparkles, { size: 26 }));
{
  resetDiag();
  const base = { id: 'senna', name: 'Senna', tag: 'Marksman Support', tier: 'S', _type: 'c' };
  const r1 = tryRender(h(m.RankChip, { ...base, icon: undefined, accent: undefined }));
  check('RankChip with icon=undefined (the exact Senna regression) renders instead of throwing', r1.ok, r1.error);
  check('...shows the neutral fallback icon, the name and the role text', r1.ok && fallbackUsed(r1.out) && text(r1.out).includes('Senna') && text(r1.out).includes('Marksman Support'));
  check('...uses the neutral accent color when none was mapped', r1.ok && r1.out.includes('--accent:var(--text-dimmer)'));
  check('...and reports it once, with the entity id', diagnostics.some((d) => d.details.registry === 'RankChip' && d.details.entityId === 'senna'));
  const r2 = tryRender(h(m.RankChip, { ...base, icon: 'Sparkles' }));
  check('RankChip with an icon NAME string instead of a component renders the fallback (no crash)', r2.ok && fallbackUsed(r2.out), r2.error);
  const r3 = tryRender(h(m.RankChip, { ...base, icon: { not: 'a component' } }));
  check('RankChip with an arbitrary object as icon renders the fallback (no crash)', r3.ok && fallbackUsed(r3.out), r3.error);
  const r4 = tryRender(h(m.RankChip, { ...base, icon: m.Lucide.Sparkles, accent: '#9b6bff' }));
  check('RankChip with a valid icon renders THAT icon and THAT accent (unchanged visual behavior)', r4.ok && r4.out.includes(sparklesSvg) && !fallbackUsed(r4.out) && r4.out.includes('--accent:#9b6bff'));
  check('...and the tier badge keeps its tier color', r4.ok && r4.out.includes('background:#f3c969'));
  const r5 = tryRender(h(m.RankChip, { ...base, icon: m.Lucide.Sparkles, tier: 'S+', editMode: true, onUpdate() {} }));
  check('RankChip with an unknown tier renders (neutral badge) and Coach Mode\'s select still offers the unrecognized value so it can be fixed', r5.ok && r5.out.includes('S+ (unrecognized)') && r5.out.includes('background:var(--text-dimmer)'), r5.error);
  const r6 = tryRender(h(m.RankChip, { id: 'x', name: 'Bare', icon: undefined }));
  check('RankChip with almost no metadata (no tag, tier, note, info, type) still renders', r6.ok && text(r6.out).includes('Bare'), r6.error);

  const entries = [
    { id: 'a', name: 'Alpha', tag: 'Enchanter', tier: 'S', icon: m.Lucide.Sparkles, accent: '#9b6bff' },
    { id: 'b', name: 'Bravo', tag: 'Mystery', tier: 'S+', icon: undefined },
    { id: 'c', name: 'Charlie', tag: 'Warden', tier: undefined, icon: m.Lucide.Shield },
  ];
  const tb = tryRender(h(m.TierBoard, { entries, editMode: false, onUpdate() {} }));
  check('TierBoard with an unknown tier, a missing tier and a missing icon renders', tb.ok, tb.error);
  check('...and NO entry silently disappears: all three names are on the board', tb.ok && ['Alpha', 'Bravo', 'Charlie'].every((n) => text(tb.out).includes(n)), tb.ok && text(tb.out));
  check('...the unknown tier gets its own labelled row after the known ones', tb.ok && /title="Unrecognized tier[^"]*"[^>]*>S\+</.test(tb.out));
  check('...the six known rows are unchanged and in order', tb.ok && (tb.out.match(/class="tier-label"/g) || []).length === 8 && tb.out.indexOf('>S<') < tb.out.indexOf('>A<'));
}

// ======================================================================================================================
console.log('\n=== 7. Page integration with the REAL data (and with broken runtime data) ===');
const effChampions = CHAMPIONS.map((c) => m.resolveEffectiveChampion(c, undefined, MATCHUPS[c.id]));
const academy = effChampions.filter(isAcademyCovered);
const effItems = ITEMS.map((i) => m.resolveEffectiveItem(i, undefined));
const effRunes = RUNES.map((r) => m.resolveEffectiveRune(r, undefined));
const common = { editMode: false, setEditMode() {}, onUpdate() {}, syncStatus: 'synced', auth: null };
const countChips = (s) => (s.match(/class="rank-chip/g) || []).length;
{
  resetDiag();
  const ct = tryRender(h(m.ChampionTierListPage, { ...common, champions: academy }));
  check(`Champion Tier List renders every one of the ${academy.length} coached champions`, ct.ok && countChips(ct.out) === academy.length && academy.every((c) => text(ct.out).includes(c.name)), ct.error);
  check('...with no fallback icon anywhere (every role mapped) and no diagnostic', ct.ok && !fallbackUsed(ct.out) && diagnostics.length === 0, diagnostics.map((d) => d.message));
  const senna = ct.ok && ct.out.slice(ct.out.indexOf('Senna') - 1200, ct.out.indexOf('Senna'));
  check('...Senna\'s chip carries the Marksman Support accent (#ff6b6b)', Boolean(senna) && senna.includes('--accent:#ff6b6b'));

  const gp = tryRender(h(m.GuidesPage, { champions: academy }));
  check(`Champion Guides renders every coached champion (${academy.length}) with no fallback icon`, gp.ok && countChips(gp.out) === academy.length && !fallbackUsed(gp.out), gp.error);

  const it = tryRender(h(m.ItemTierListPage, { ...common, items: effItems }));
  check(`Item Tier List renders every item (${effItems.length}) with no fallback icon`, it.ok && countChips(it.out) === effItems.length && !fallbackUsed(it.out), it.error);
  check('...with exactly the registered category filter pills, in order', it.ok && JSON.stringify([...it.out.matchAll(/class="filter-pill[^"]*">([^<]+)</g)].map((x) => x[1])) === JSON.stringify(['All', ...C.ITEM_CATEGORIES]));

  const rt = tryRender(h(m.RuneTierListPage, { ...common, runes: effRunes }));
  check(`Rune Tier List renders every rune (${effRunes.length}) with no fallback icon`, rt.ok && countChips(rt.out) === effRunes.length && !fallbackUsed(rt.out), rt.error);
  check('...with exactly the registered rune path filter pills, in order', rt.ok && JSON.stringify([...rt.out.matchAll(/class="filter-pill[^"]*">([^<]+)</g)].map((x) => x[1])) === JSON.stringify(['All', ...C.RUNE_PATHS]));

  const ce = tryRender(h(m.ItemTierListPage, { ...common, editMode: true, items: effItems }));
  check('Coach Mode (edit mode) Item Tier List renders a tier select for every item', ce.ok && (ce.out.match(/<select/g) || []).length === effItems.length, ce.error);

  const detailRuns = effChampions.map((c) => [c, tryRender(h(m.ChampionDetailPage, { champion: c, ...common, roster: effChampions, decisionTrees: [], patchStatus: 'verified' }))]);
  const detailErrors = detailRuns.filter(([c, r]) => !r.ok || !text(r.out).includes(c.name)).map(([c, r]) => `${c.id}: ${r.ok ? 'name missing' : r.error}`);
  check(`Champion detail page renders for all ${effChampions.length} champions (name shown), incl. Hwei/Camille whose builds have no items/runes`, detailErrors.length === 0, detailErrors);
  const hp = tryRender(h(m.HomePage, { champions: academy }));
  check('Home page roster teaser renders', hp.ok && countChips(hp.out) > 0 && !fallbackUsed(hp.out), hp.error);
}
{
  console.log('\n  -- broken RUNTIME data must degrade, not crash --');
  resetDiag();
  const overrides = { champions: { senna: { tier: 'S+' }, lulu: { tier: 'Z' } }, items: { 'ardent-censer': { tier: 'Top' } }, runes: { conqueror: { tier: 'SS' } } };
  const champs2 = CHAMPIONS.map((c) => m.resolveEffectiveChampion(c, overrides.champions[c.id], MATCHUPS[c.id])).filter(isAcademyCovered);
  const ct = tryRender(h(m.ChampionTierListPage, { ...common, champions: champs2 }));
  check('Champion Tier List with override tiers "S+"/"Z" renders and still shows every champion (Senna, Lulu included)', ct.ok && countChips(ct.out) === champs2.length && text(ct.out).includes('Senna') && text(ct.out).includes('Lulu'), ct.error);
  const it = tryRender(h(m.ItemTierListPage, { ...common, items: ITEMS.map((i) => m.resolveEffectiveItem(i, overrides.items[i.id])) }));
  check('Item Tier List with an override tier "Top" renders every item', it.ok && countChips(it.out) === ITEMS.length, it.error);
  const rt = tryRender(h(m.RuneTierListPage, { ...common, runes: RUNES.map((r) => m.resolveEffectiveRune(r, overrides.runes[r.id])) }));
  check('Rune Tier List with an override tier "SS" renders every rune', rt.ok && countChips(rt.out) === RUNES.length, rt.error);
  check('...each unknown tier was reported (once each)', ['S+', 'Z', 'Top', 'SS'].every((t) => diagnostics.filter((d) => d.details.registry === 'tier' && d.details.key === t).length === 1), diagnostics.map((d) => d.details.key));

  const weird = [...academy.slice(0, 2), { ...academy[2], role: 'Tank Support' }];
  const ct2 = tryRender(h(m.ChampionTierListPage, { ...common, champions: weird }));
  check('Champion Tier List with an unmapped role renders that champion with the fallback icon and its role text', ct2.ok && countChips(ct2.out) === 3 && fallbackUsed(ct2.out) && text(ct2.out).includes('Tank Support'), ct2.error);
  const gp2 = tryRender(h(m.GuidesPage, { champions: weird }));
  check('Champion Guides with an unmapped role renders', gp2.ok && countChips(gp2.out) === 3, gp2.error);
  const det = tryRender(h(m.ChampionDetailPage, { champion: { ...academy[0], role: 'Tank Support', tier: 'S+', builds: [], items: undefined, runes: undefined }, ...common, roster: effChampions, decisionTrees: [], patchStatus: 'verified' }));
  check('Champion detail with an unmapped role, an unknown tier and no build data renders', det.ok && fallbackUsed(det.out), det.error);
  const items2 = [...effItems.slice(0, 3), { id: 'quest', name: 'Quest Thing', category: 'Quest', tier: 'Unranked', info: '' }];
  const it2 = tryRender(h(m.ItemTierListPage, { ...common, items: items2 }));
  check('Item Tier List with an unmapped category renders it (fallback icon) and adds a "Quest" filter pill after the registered ones', it2.ok && countChips(it2.out) === 4 && fallbackUsed(it2.out) && /class="filter-pill[^"]*">Physical<\/button><button[^>]*>Quest</.test(it2.out), it2.error);
  const runes2 = [...effRunes.slice(0, 2), { id: 'sorc', name: 'Sorcery Rune', path: 'Sorcery', tier: 'Unranked', info: '' }];
  const rt2 = tryRender(h(m.RuneTierListPage, { ...common, runes: runes2 }));
  check('Rune Tier List with an unmapped path renders it (fallback icon) with its own filter pill', rt2.ok && countChips(rt2.out) === 3 && fallbackUsed(rt2.out) && rt2.out.includes('>Sorcery<'), rt2.error);
  const ei = tryRender(h(m.EntityImage, { entityType: 'champion', entityName: 'Nobody', roster: [{ id: 'n', name: 'Nobody', role: 'Tank Support' }] }));
  check('EntityImage (Patch Notes, unchanged) with an unmapped role keeps its own existing Shield fallback', ei.ok && ei.out.includes('lucide-shield'), ei.error);
}

// ======================================================================================================================
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
