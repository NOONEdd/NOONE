// Patch Notes -- render-level checks of the admin review panel's classification control (react-dom/server only, real components
// bundled in memory by tests/helpers/renderBundle.mjs; the datasets come from the REAL extractor + review operations).
//
//   node tests/patchNotesClassification.render.test.mjs

import { bundleModule, src } from './helpers/renderBundle.mjs';
import { parsePatchDocument } from '../functions/_lib/patchParser.js';
import { extractPatchNotes } from '../functions/_lib/patchNotesExtract.js';
import { initReview, applyReviewOps, sectionKeyOf } from '../functions/_lib/patchNotesReview.js';
import { CHAMPIONS, isAcademyCovered } from '../src/data/champions.js';
import { ITEMS } from '../src/data/items.js';
import { RUNES } from '../src/data/runes.js';
import { ALL_PATHS_PAGE } from './fixtures/patch-notes-identity-pages.mjs';
import { makeChecker } from './helpers/patchNotesHelpers.mjs';

const { check, done } = makeChecker();
const mod = await bundleModule(`
  import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server';
  export { React, renderToStaticMarkup };
  export { default as PatchNotesReview } from ${src('src/components/PatchNotesReview.jsx')};
`);
const { React, renderToStaticMarkup } = mod;
const T = '2026-11-12T00:00:00.000Z';
const CATALOG = { champion: new Set(CHAMPIONS.map((c) => c.id)), item: new Set(ITEMS.map((i) => i.id)), rune: new Set(RUNES.map((r) => r.id)) };
const roster = { champions: CHAMPIONS, items: ITEMS, runes: RUNES };
const build = () => initReview(extractPatchNotes({ units: parsePatchDocument(ALL_PATHS_PAGE, { maxUnitChars: 12000 }).units, championRoster: CHAMPIONS.filter(isAcademyCovered), itemRoster: ITEMS, runeRoster: RUNES, patchVersion: '9.1', sourceUrl: 'https://example.test', extractedAt: T }));
const find = (ds, re) => ds.changes.find((c) => re.test(c.entity ? c.entity.name : c.system.area));
const render = (ds, { status = 'pending_review', filter = 'all' } = {}) => renderToStaticMarkup(React.createElement(mod.PatchNotesReview, { report: { id: 'p', status, revision: 1, patchNotes: ds }, onOps() {}, busy: false, initialFilter: filter, catalog: roster }));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
/** the markup of ONE section (from its title to the next section) */
const sectionOf = (html, title) => { const parts = html.split('class="pn-section"'); return text(parts.find((p) => p.includes(`<b>${title}</b>`)) || ''); };

console.log('\n=== One classification control in EVERY section, whatever its bucket ===');
{
  const ds = build();
  const html = render(ds);
  const sections = html.split('class="pn-section"').length - 1;
  check(`every rendered section (${sections}) has an "Academy classification" row`, (html.match(/Academy classification:/g) || []).length === sections && sections > 5);
  check('Unmatched item (Bulwark): "Move to In Academy" offered, "detected automatically"', /Unmatched detected automatically.*Move to In Academy/.test(sectionOf(html, 'Bulwark of the Mountain')));
  check('New candidate (Mystery Blade): offered', /New candidate detected automatically.*Move to In Academy/.test(sectionOf(html, 'Mystery Blade')));
  check('System block (Jungle Adjustments): offered', /System detected automatically.*Move to In Academy/.test(sectionOf(html, 'Jungle Adjustments')));
  check('Unmatched champion (Ezreal): offered', /Move to In Academy/.test(sectionOf(html, 'Ezreal')));
  const ard = sectionOf(html, 'Ardent Censer');
  check('an automatic Academy match (Ardent Censer): In Academy, no move and no revert button', /In Academy detected automatically/.test(ard) && !/Move to In Academy|Revert to detected/.test(ard));
  check('the inline form is closed until asked for (no type / record selects rendered)', !/aria-label="Academy record"/.test(html));
}

console.log('\n=== After a decision: visibly manual, reversible, and the counts say so ===');
{
  const ds = build();
  applyReviewOps(ds, [
    { op: 'setSectionClassification', sectionKey: sectionKeyOf(find(ds, /^Bulwark/)), status: 'IN_ACADEMY' },
    { op: 'setSectionClassification', sectionKey: sectionKeyOf(find(ds, /^Ezreal/)), status: 'IN_ACADEMY', academyId: 'ezreal' },
  ], { now: T, catalog: CATALOG });
  const html = render(ds);
  const bul = sectionOf(html, 'Bulwark of the Mountain');
  check('header chip: "In Academy · manual"', /In Academy · manual/.test(bul));
  check('row: "your decision · detected: Unmatched · no Academy record linked" + "Revert to detected (Unmatched)"', /your decision · detected: Unmatched · no Academy record linked/.test(bul) && /Revert to detected \(Unmatched\)/.test(bul));
  check('a linked entity names its Academy record ("Academy record: Ezreal")', /Academy record: Ezreal/.test(sectionOf(html, 'Ezreal')));
  check('accounting line counts the moved CHANGES: "8 in Academy (2 by your decision)" (Bulwark 1 + Ezreal 1)', /8 in Academy \(2 by your decision\)/.test(text(html)));
  const filtered = render(ds, { filter: 'IN_ACADEMY' });
  check('the "In Academy" filter includes the moved entities', /Bulwark of the Mountain/.test(text(filtered)) && /Ezreal/.test(text(filtered)));
  check('the "Unmatched" filter no longer lists Bulwark', !/<b>Bulwark of the Mountain<\/b>/.test(render(ds, { filter: 'UNMATCHED' })));
  check('"Needs review" still lists Bulwark: its changes have no publication decision yet', /<b>Bulwark of the Mountain<\/b>/.test(render(ds, { filter: 'needs' })));
}

console.log('\n=== The live (published) revision is read-only for classification ===');
{
  const ds = build();
  applyReviewOps(ds, [{ op: 'setSectionClassification', sectionKey: sectionKeyOf(find(ds, /^Bulwark/)), status: 'IN_ACADEMY' }], { now: T, catalog: CATALOG });
  const html = render(ds, { status: 'published' });
  check('no Move / Revert buttons anywhere; each row says the revision is live', !/Move to In Academy|Revert to detected/.test(text(html)) && /This revision is live/.test(text(html)));
  check('...but the current classification is still shown', /In Academy · manual/.test(sectionOf(html, 'Bulwark of the Mountain')));
}

console.log('\n=== Orphaned section-level review settings are surfaced, not silently kept ===');
{
  const ds = build();
  ds.orphanedSectionReviews = [{ sectionKey: 'entity:item:gone', review: { changeImpact: 'HIGH' } }];
  check('a notice explains 1 setting no longer matches a section (kept, not applied)', /1 section-level review setting .* no longer matches a section/.test(text(render(ds))));
}

done();
