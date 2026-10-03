// Patch Notes -- render-level tests for the PUBLIC page (PublicReportCard) and the ADMIN review panel (PatchNotesReview).
// react-dom/server only (no jsdom, no new dependency); the real components are bundled in memory by tests/helpers/renderBundle.mjs.
// Run directly:
//
//   node tests/patchNotesPage.render.test.mjs
//
// The public-page checks are fed with the output of the REAL server code (extract -> review ops -> toPublicView), not hand-written
// fixtures, so a mismatch between what the server produces and what the page renders would show up here.

import { bundleModule, src } from './helpers/renderBundle.mjs';
import { extract, makeChecker } from './helpers/patchNotesHelpers.mjs';
import { applyReviewOps, subsectionKeyOf, sectionKeyOf } from '../functions/_lib/patchNotesReview.js';
import { toPublicView, publicPreview } from '../functions/_lib/patchNotesPublic.js';

const { check, done } = makeChecker();
const mod = await bundleModule(`
  import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server';
  export { React, renderToStaticMarkup };
  export { PublicReportCard } from ${src('src/pages/PatchNotesPage.jsx')};
  export { default as PatchNotesReview } from ${src('src/components/PatchNotesReview.jsx')};
`);
const { React, renderToStaticMarkup } = mod;
const roster = { champions: [], items: [], runes: [] };
const renderCard = (report) => renderToStaticMarkup(React.createElement(mod.PublicReportCard, { report, roster, initiallyExpanded: true }));
const renderReview = (report) => renderToStaticMarkup(React.createElement(mod.PatchNotesReview, { report, onOps() {}, busy: false, initialFilter: 'all' }));
const blocks = (html) => html.split('class="patch-sub"').length - 1;
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const base = { id: 'p', patch: '7.6', status: 'published', revision: 1, generatedAt: '2026-10-01T09:00:00.000Z', sourceUrl: 'https://example.test', recommendedTierChanges: [], impactSeverity: undefined };

const HWEI = `## CHAMPION ADJUSTMENTS\n\n### Hwei\n\nSignature of the Visionary\n\n- Passive Damage: 20 / 30 / 40 → 25 / 35 / 45\n- Bonus Magic Damage: 5% → 7%\n\nDisaster - Devastating Fire\n\n- Damage: 80 / 120 / 160 → 70 / 110 / 150\n- Cooldown: 8 → 9\n\nDisaster - Severing Bolt\n\n- Damage: 70 / 100 / 130 → 60 / 90 / 120\n\nSpiraling Despair\n\n- Cooldown: 120 / 100 / 80 → 130 / 110 / 90\n`;

// ======================================================================================================================
console.log('\n=== 1. The reported contradiction: a count above "No Support-relevant changes identified" ===');
{
  // exactly the report shape that produced it: entries present, supportMetaAnalysis "" (what the deterministic pipeline writes), no summary field
  const entries = (n, nameField) => Array.from({ length: n }, (_, i) => ({ [nameField]: `${nameField}-${i}`, type: 'Adjustment', whatChanged: 'x → y', impactSeverity: 'Low' }));
  const legacyShaped = { ...base, supportMetaAnalysis: '', championChanges: entries(4, 'championName'), itemChanges: entries(2, 'itemName'), runeChanges: [], systemChanges: [] };
  const html = renderCard(legacyShaped);
  check('6 entries, empty legacy summary field: header says "6 Support-relevant changes"', text(html).includes('6 Support-relevant changes'));
  check('...and the body NEVER says "No Support-relevant changes" (the old internal contradiction)', !/No Support-relevant/.test(text(html)), text(html).slice(0, 300));
  check('...the body is the generated breakdown from the same entries (4 champions, 2 items)', text(html).includes('4 champions, 2 items'));

  const none = { ...legacyShaped, championChanges: [], itemChanges: [] };
  check('with NO entries the page says "No Support-relevant changes identified in this patch." (true this time) and shows no count chip', text(renderCard(none)).includes('No Support-relevant changes identified in this patch.') && !/\d+ Support-relevant change/.test(text(renderCard(none))));

  const withLegacyText = renderCard({ ...legacyShaped, supportMetaAnalysis: 'AI-era analysis text' });
  check('a legacy AI-era summary text is still displayed (as the custom summary) and no generated count sits beside it', text(withLegacyText).includes('AI-era analysis text') && !text(withLegacyText).includes('6 Support-relevant changes'));
}

console.log('\n=== 2. Summary from the real server pipeline: generated, then custom ===');
{
  const r = extract(`${HWEI}\n## ITEM ADJUSTMENTS\n\n### Edge of Night\n\n- Armor Penetration increased from 10% to 15%.\n`);
  r.changes.forEach((c) => applyReviewOps(r.dataset, [{ op: 'keep', changeId: c.changeId }]));
  const rep = { ...base, supportMetaAnalysis: '', patchNotes: r.dataset };
  const gen = toPublicView(rep, []);
  const g = text(renderCard(gen));
  check('generated: header count + body breakdown match the entries the page renders (1 champion + 1 item = 2)', g.includes('2 Support-relevant changes') && g.includes('1 champion, 1 item') && !g.includes('No Support-relevant'), g.slice(0, 260));
  applyReviewOps(r.dataset, [{ op: 'setSummary', text: 'Hwei and Edge of Night both moved this patch.' }]);
  const cust = renderCard(toPublicView(rep, []));
  check('custom summary: rendered as the body', text(cust).includes('Hwei and Edge of Night both moved this patch.'));
  check('custom summary: the generated count is NOT shown instead of / beside it', !text(cust).includes('2 Support-relevant changes') && !text(cust).includes('1 champion, 1 item'));
  applyReviewOps(r.dataset, [{ op: 'setSummary', text: 'No Support-relevant changes identified in this patch.' }]);
  check('an explicit admin "no changes" message is honoured even though entries exist (their call)', text(renderCard(toPublicView(rep, []))).includes('No Support-relevant changes identified in this patch.'));
}

// ======================================================================================================================
console.log('\n=== 3. Grouping on the page: one block per Riot subsection ===');
{
  const r = extract(HWEI);
  r.changes.forEach((c) => applyReviewOps(r.dataset, [{ op: 'keep', changeId: c.changeId }]));
  const rep = { ...base, supportMetaAnalysis: '', patchNotes: r.dataset };
  const html = renderCard(toPublicView(rep, []));
  check('four Riot subsections -> four separate visual blocks', blocks(html) === 4, blocks(html));
  const titles = [...html.matchAll(/class="patch-sub-title">([^<]*)</g)].map((m) => m[1]);
  check('the block titles are Riot\'s exact subsection names, in Riot\'s order', titles.join('|') === 'Signature of the Visionary|Disaster - Devastating Fire|Disaster - Severing Bolt|Spiraling Despair', titles);
  const lines = [...html.matchAll(/<p class="patch-entry-line">([^<]*)/g)].map((m) => m[1].trim());
  check('every change is its own line under its subsection; none is a concatenation of several subsections', lines.length === 6 && lines.every((l) => !l.includes('; ') && !/Signature of the Visionary|Disaster - |Spiraling Despair/.test(l)), lines);
  check('NO Q/W/E/R/Passive labels were invented anywhere on the page', !/>\s*[QWER]\s*</.test(html) && !/>\s*(Passive|Ultimate)\s*</.test(html));
  check('the changes under ONE subsection stay in ONE block (2 + 2 + 1 + 1)', html.split('class="patch-sub"').slice(1).map((b) => (b.split('class="patch-sub-change"').length - 1)).join() === '2,2,1,1');

  // edited heading shown; no heading structure -> no heading element, fallback to the flat text
  const sub = r.changes.find((c) => c.subsection.sourceHeading === 'Spiraling Despair');
  applyReviewOps(r.dataset, [{ op: 'editSubsectionTitle', subsectionKey: subsectionKeyOf(sub), displayHeading: 'Ultimate rework' }]);
  const edited = renderCard(toPublicView(rep, []));
  check('an edited display heading is what the page shows', edited.includes('>Ultimate rework<') && !edited.includes('>Spiraling Despair<'));
  const bare = extract(`## CHAMPION ADJUSTMENTS\n\n### Hwei\n\n- Damage: 50 → 40\n`);
  bare.changes.forEach((c) => applyReviewOps(bare.dataset, [{ op: 'keep', changeId: c.changeId }]));
  const bareHtml = renderCard(toPublicView({ ...base, supportMetaAnalysis: '', patchNotes: bare.dataset }, []));
  check('no Riot subsection -> no fabricated heading, just the change under the entity (fallback)', !bareHtml.includes('patch-sub-title') && bareHtml.includes('Damage: 50 → 40'));
  const legacyHtml = renderCard({ ...base, supportMetaAnalysis: 'x', championChanges: [{ championName: 'Leona', type: 'Buff', whatChanged: 'Q damage up', impactSeverity: 'Low' }], itemChanges: [], runeChanges: [], systemChanges: [] });
  check('a legacy (AI-era) entry without subsections still renders its flat text and its legacy type', legacyHtml.includes('Q damage up') && /Buff/.test(legacyHtml));
}

// ======================================================================================================================
console.log('\n=== 4. Notes and classification on the page ===');
{
  const r = extract(`## CHAMPION ADJUSTMENTS\n\n### Buffs\n\n#### Hwei\n\nSome Ability\n\n- Cooldown: 12 → 10\n\n### Nerfs\n\n#### Braum\n\nOther Ability\n\n- Damage: 80 → 70\n\nThird Ability\n\n- [New] Now also slows.\n`);
  r.changes.forEach((c) => applyReviewOps(r.dataset, [{ op: 'keep', changeId: c.changeId }]));
  const hweiChange = r.changes.find((c) => c.entity.name === 'Hwei');
  applyReviewOps(r.dataset, [{ op: 'edit', changeId: hweiChange.changeId, reviewerNote: 'Big for Support lanes.' }]);
  const rep = { ...base, supportMetaAnalysis: '', patchNotes: r.dataset };
  let html = renderCard(toPublicView(rep, []));
  check('the admin\'s note is rendered under its change, labelled', html.includes('class="patch-change-note"') && text(html).includes('Note: Big for Support lanes.'));
  check('a change without a note renders no note element', html.split('patch-change-note').length - 1 === 1);
  const badges = [...html.matchAll(/patch-entry-head[\s\S]*?<span class="patch-entry-name">([^<]*)<\/span><span class="patch-entry-type patch-class"[^>]*>([^<]*)</g)].map((m) => `${m[1]}:${m[2]}`);
  check('entity badges are Buff / Nerf from Riot\'s headings -- not "Adjustment" for everything', badges.join('|') === 'Hwei:Buff|Braum:Adjustment' || badges.join('|') === 'Hwei:Buff|Braum:Nerf', badges);
  // Braum has a NERF-heading change and a [New] change -> disagreeing -> neutral Adjustment with the per-change chip for the NEW one
  check('Braum (a NERF change + a NEW change) reads Adjustment overall and the NEW change carries its own chip', badges.includes('Braum:Adjustment') && text(html).includes('New: Now also slows New'), badges);
  const braumChange = r.changes.find((c) => c.entity.name === 'Braum' && c.comparisonState === 'NERF');
  applyReviewOps(r.dataset, [{ op: 'classify', changeId: braumChange.changeId, comparisonState: 'BUFF' }, { op: 'classifySection', sectionKey: sectionKeyOf(braumChange), comparisonState: 'NERF' }]);
  html = renderCard(toPublicView(rep, []));
  check('an entity-level admin override is the badge on the page (Nerf)', /<span class="patch-entry-name">Braum<\/span><span class="patch-entry-type patch-class"[^>]*>Nerf</.test(html));
  for (const [v, label] of [['BUFF', 'Buff'], ['NERF', 'Nerf'], ['ADJUSTMENT', 'Adjustment'], ['NEW', 'New'], ['REMOVED', 'Removed'], ['UNKNOWN', 'Unknown']]) {
    applyReviewOps(r.dataset, [{ op: 'classifySection', sectionKey: sectionKeyOf(hweiChange), comparisonState: v }]);
    const h = renderCard(toPublicView(rep, []));
    check(`override ${v} is displayed as "${label}" on the page`, new RegExp(`<span class="patch-entry-name">Hwei</span><span class="patch-entry-type patch-class"[^>]*>${label}<`).test(h));
  }
}

// ======================================================================================================================
console.log('\n=== 5. Admin review panel: every editable presentation field is reachable ===');
{
  const r = extract(HWEI);
  const rep = { ...base, supportMetaAnalysis: '', status: 'pending_review', patchNotes: r.dataset, patchNotesSummary: { sections: 1 } };
  rep.publicPreview = publicPreview(rep, []);
  // initialFilter "all": Academy-tracked (EXISTING) entities are auto-published and so are not in the default "needs review" list
  const html = renderReview(rep);
  check('summary editor: shows the effective public summary and a textarea for a custom one', html.includes('Public patch summary') && html.includes('aria-label="Custom patch summary"') && text(html).includes('1 Support-relevant change'));
  check('summary editor: can set the "no changes" message and (when custom) go back to generated', html.includes('Use &quot;no changes&quot; message') || html.includes('Use "no changes" message'));
  check('the note field says it is shown publicly (no more "Reviewer note (private)")', html.includes('Note shown publicly') && !html.includes('Reviewer note (private)'));
  check('each change has a classification override select with the six values and a "use detected" option', (html.match(/aria-label="Classification override"/g) || []).length === 6 && ['Buff', 'Nerf', 'Adjustment', 'New', 'Removed', 'Unknown'].every((l) => html.includes(`>${l}</option>`)) && html.includes('Use detected'));
  check('the entity has a badge override select', html.includes('aria-label="Entity classification override"'));
  check('the entity has an overall change-impact select: Not rated / Low / Medium / High (human-set; unset by default)', html.includes('aria-label="Overall change impact"') && html.includes('>Not rated</option>') && ['Low', 'Medium', 'High'].every((l) => html.includes(`>${l}</option>`)) && /Overall impact \(shown publicly\)/.test(html));
  check('changes are grouped under their Riot subsection headings with a Rename control (the grouping the public page uses)', ['Signature of the Visionary', 'Disaster - Devastating Fire', 'Disaster - Severing Bolt', 'Spiraling Despair'].every((t) => html.includes(`<b>${t}</b>`)) && (html.match(/class="pn-sub-head"/g) || []).length === 4 && (html.match(/>Rename</g) || []).length === 5 /* 4 subsections + the entity's own title */);
  check('the detected classification is shown beside the override (extraction value visible, not replaced)', text(html).includes('detected from Riot: Adjustment'));
  check('original Riot source stays available per change', text(html).includes('Passive Damage'));

  applyReviewOps(r.dataset, [{ op: 'setSummary', text: 'My own summary.' }, { op: 'classify', changeId: r.changes[0].changeId, comparisonState: 'NERF' }]);
  rep.publicPreview = publicPreview(rep, []);
  const html2 = renderReview(rep);
  check('with a custom summary the panel says so and offers "Use generated summary"', html2.includes('using your custom text') && html2.includes('Use generated summary') && text(html2).includes('My own summary.'));
  check('an override is labelled as the admin\'s next to the detected value', text(html2).includes('Nerf (your override)'));
}

done();
