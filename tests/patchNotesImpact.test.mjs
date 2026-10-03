// Patch Notes -- the "MEDIUM" badge: where it came from, and the reviewed change-impact field that replaces it. Plain Node ESM against the
// REAL pipeline and handlers (mock KV, Riot text seeded into the cache, no network, no AI, no production data). Run directly:
//
//   node tests/patchNotesImpact.test.mjs
//
// FINDING (traced in the code, pinned below): the badge was `entry.impactSeverity`, an ENTITY-level legacy "coach field". Nothing ever
// computes or extracts it -- functions/_lib/patchIntelligence.js normalizeChangeEntry() fills it with the placeholder default "Medium", and the
// deterministic pipeline never supplies a value, so EVERY entity showed MEDIUM. It is not Riot data and not extraction confidence (that is
// the separate `confidence` field, derived from the comparison state, admin-only). The public page rendered it as a bare chip.
//
//   1  origin        the placeholder default; confidence is a different field with different logic; derived entries inherit neither
//   2  separation    changeImpact (human review) vs extraction confidence vs comparisonState / classification: independent in both directions
//   3  editability   LOW / MEDIUM / HIGH set by an op; save -> reload -> revision read -> publish -> public; regeneration; section remove/restore
//   4  regression    extraction untouched, notes + grouping + summary still correct next to impact, no master data / production KV touched

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestPost as checkPost } from '../functions/api/admin/patch-check.js';
import { onRequestGet as adminGet, onRequestPost as reportsPost } from '../functions/api/admin/patch-reports.js';
import { onRequestGet as publicGet } from '../functions/api/patch-reports.js';
import { createSessionToken } from '../functions/_lib/adminAuth.js';
import { SOURCE_TEXT_VERSION } from '../functions/_lib/patchText.js';
import { normalizeChangeEntry, confidenceForComparisonState } from '../functions/_lib/patchIntelligence.js';
import { COMPARISON_STATE } from '../functions/_lib/patchChangeDetector.js';
import { applyReviewOps, mergeReviewState, sectionKeyOf, deriveLegacyReport, mergeFreshOntoExisting } from '../functions/_lib/patchNotesReview.js';
import { toPublicView } from '../functions/_lib/patchNotesPublic.js';
import { normalizeChangeImpact, changeImpactLabel, CHANGE_IMPACT_OPTIONS } from '../src/lib/patchNotesPresentation.js';
import { bundleModule, src } from './helpers/renderBundle.mjs';
import { extract, makeChecker } from './helpers/patchNotesHelpers.mjs';

const { check, done } = makeChecker();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- harness -------------------------------------------------------------------------------------------------------------
function makeMockKV() {
  const store = new Map(); const kv = { store, writes: [] };
  kv.get = async (k) => (store.has(k) ? store.get(k) : null);
  kv.put = async (k, v) => { kv.writes.push(k); store.set(k, String(v)); };
  kv.delete = async (k) => { kv.writes.push(`DELETE ${k}`); store.delete(k); };
  kv.list = async ({ prefix = '' } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: null });
  return kv;
}
const fetchCalls = [];
globalThis.fetch = async (url) => { fetchCalls.push(String(url)); throw new Error('unexpected network call: ' + url); };
const adminEnv = async (kv) => { const env = { COACH_KV: kv, ADMIN_SESSION_SECRET: 'test-secret', ANTHROPIC_API_KEY: 'would-be-used-if-AI-ran' }; return { env, cookie: `academy_admin_session=${await createSessionToken(env)}` }; };
const post = (url, body, cookie) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie || '' }, body: JSON.stringify(body) });
const seed = (kv, slug, text) => { kv.store.set('riot-latest-patch-meta', JSON.stringify({ slug })); kv.store.set(`riot-fallback-full-content:${slug}:${SOURCE_TEXT_VERSION}`, JSON.stringify({ content: text, truncated: false })); };
const detect = async (env, cookie) => (await checkPost({ request: post('https://x/api/admin/patch-check', { trigger: 'manual' }, cookie), env })).json();
const rescan = async (env, cookie, slug) => (await checkPost({ request: post('https://x/api/admin/patch-check', { action: 'rescan', patchId: slug }, cookie), env })).json();
const act = async (env, cookie, body) => { const r = await reportsPost({ request: post('https://x/api/admin/patch-reports', body, cookie), env }); return { status: r.status, body: await r.json() }; };
const review = (env, cookie, id, ops, revision) => act(env, cookie, { id, action: 'review', ops, ...(revision ? { revision } : {}) });
const adminReport = async (env, cookie, id, revision) => (await (await adminGet({ request: new Request(`https://x/api/admin/patch-reports?id=${id}${revision ? `&revision=${revision}` : ''}`, { headers: { Cookie: cookie } }), env })).json()).report;
const publicReports = async (env) => (await (await publicGet({ request: new Request('https://x/api/patch-reports'), env })).json()).reports;
const publish = async (env, cookie, id, revision) => { await act(env, cookie, { id, action: 'approve', ...(revision ? { revision } : {}) }); return act(env, cookie, { id, action: 'publish', alsoMarkVerified: false, ...(revision ? { revision } : {}) }); };

const SLUG = 'wild-rift-patch-notes-7-8';
const PAGE = `# Wild Rift Patch Notes 7.8\n\n## CHAMPION ADJUSTMENTS\n\n### Hwei\n\nSignature of the Visionary\n\n- Passive Damage: 20 / 30 / 40 → 25 / 35 / 45\n\nDisaster - Devastating Fire\n\n- Damage: 80 / 120 / 160 → 70 / 110 / 150\n- Cooldown: 8 → 9\n\nSpiraling Despair\n\n- [New] Spiraling Despair now slows enemies hit.\n\n## ITEM ADJUSTMENTS\n\n### Edge of Night\n\n- Armor Penetration increased from 10% to 15%.\n`;
const leonaOf = (r) => r.championChanges.find((e) => e.championId === 'hwei'); // (named leonaOf historically: the champion under test is Hwei)
const edgeOf = (r) => r.itemChanges.find((e) => e.itemName === 'Edge of Night');

// =======================================================================================================================
console.log('\n=== 1. ORIGIN OF "MEDIUM" ===');
{
  const legacyNormalized = normalizeChangeEntry({}, { withChampionsAffected: false });
  check('the legacy entry normalizer fills `impactSeverity` with the PLACEHOLDER default "Medium" when nothing supplies a value -- this is the badge', legacyNormalized.impactSeverity === 'Medium');
  const normalizerSource = fs.readFileSync(path.join(ROOT, 'functions/_lib/patchIntelligence.js'), 'utf8').replace(/\s*(?:\*|\/\/)\s*/g, ' ').replace(/\s+/g, ' ');
  check('...it is documented in the code as a hand-filled coach field whose defaults are "just safe placeholders, never a claim about the change\'s actual impact"', /just safe placeholders, never a claim about the change's actual impact/.test(normalizerSource) && /COACH fields/.test(normalizerSource));
  check('extraction CONFIDENCE is a different field with different logic: derived from the comparison state (CONFIRMED -> High, POSSIBLE/UNKNOWN -> Low, else Medium)', confidenceForComparisonState(COMPARISON_STATE.CONFIRMED) === 'High' && confidenceForComparisonState(COMPARISON_STATE.POSSIBLE) === 'Low' && confidenceForComparisonState(COMPARISON_STATE.NOT_COMPARABLE) === 'Medium');
  check('the legacy normalizer keeps them as two separate fields (`confidence` and `impactSeverity`)', 'confidence' in legacyNormalized && 'impactSeverity' in legacyNormalized && legacyNormalized.confidence === 'Medium' && legacyNormalized.impactSeverity === 'Medium');

  const r = extract(PAGE);
  r.changes.forEach((c) => applyReviewOps(r.dataset, [{ op: 'keep', changeId: c.changeId }]));
  const view = deriveLegacyReport(r.dataset, { itemRoster: [], mode: 'publish' });
  const entries = [...view.championChanges, ...view.itemChanges];
  check('an entry derived from a Patch Notes dataset does NOT inherit the placeholder: with no review it is "not rated" (null), not MEDIUM', entries.length === 2 && entries.every((e) => e.changeImpact === null && e.impactSeverity === null), entries.map((e) => [e.changeImpact, e.impactSeverity]));
  check('...while its extraction confidence is untouched and independently derived', entries.every((e) => ['Low', 'Medium', 'High'].includes(e.confidence)));
  const pub = toPublicView({ id: 'p', patch: '7.8', supportMetaAnalysis: '', patchNotes: r.dataset }, []);
  check('the public entries carry changeImpact:null and NO `confidence` field at all (internal extraction metadata is never public)', [...pub.championChanges, ...pub.itemChanges].every((e) => e.changeImpact === null && !('confidence' in e)));

  const ReportCard = await bundleModule(`import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; export { React, renderToStaticMarkup }; export { PublicReportCard } from ${src('src/pages/PatchNotesPage.jsx')};`);
  const html = (report) => ReportCard.renderToStaticMarkup(ReportCard.React.createElement(ReportCard.PublicReportCard, { report, roster: { champions: [], items: [], runes: [] }, initiallyExpanded: true }));
  check('PUBLIC PAGE: an unrated entity shows NO impact chip (the old page showed MEDIUM for every entity)', !html(pub).includes('severity-chip') && !/MEDIUM|Medium/.test(html(pub).replace(/<[^>]+>/g, ' ')));
  const legacyAi = html({ id: 'p', patch: '7.0', status: 'published', revision: 1, generatedAt: '2026-01-01T00:00:00Z', supportMetaAnalysis: 'x', recommendedTierChanges: [], championChanges: [{ championName: 'Hwei', type: 'Buff', whatChanged: 'x', impactSeverity: 'High' }], itemChanges: [], runeChanges: [], systemChanges: [] });
  check('an old AI-era revision still shows the impact it was stored with, now labelled "Impact: High" instead of a bare "High"', legacyAi.includes('Impact: High'));
}

// =======================================================================================================================
console.log('\n=== 2. CHANGE IMPACT vs CONFIDENCE vs CLASSIFICATION: three different things ===');
{
  const r = extract(PAGE);
  r.changes.forEach((c) => applyReviewOps(r.dataset, [{ op: 'keep', changeId: c.changeId }]));
  const leonaKey = sectionKeyOf(r.changes.find((c) => c.entity.id === 'hwei'));
  const before = deriveLegacyReport(r.dataset, { itemRoster: [], mode: 'publish' });
  const confBefore = leonaOf(before).confidence; const clsBefore = leonaOf(before).classification; const extractionBefore = JSON.stringify(r.dataset.changes.map((c) => [c.changeId, c.comparisonState, c.originalSourceText, c.normalizedData, c.provenance, c.ownership]));
  applyReviewOps(r.dataset, [{ op: 'impactSection', sectionKey: leonaKey, changeImpact: 'HIGH' }]);
  const after = deriveLegacyReport(r.dataset, { itemRoster: [], mode: 'publish' });
  check('setting the impact changes ONLY the impact: confidence, classification and the whole extraction layer are byte-identical', leonaOf(after).changeImpact === 'HIGH' && leonaOf(after).confidence === confBefore && leonaOf(after).classification === clsBefore && JSON.stringify(r.dataset.changes.map((c) => [c.changeId, c.comparisonState, c.originalSourceText, c.normalizedData, c.provenance, c.ownership])) === extractionBefore);
  applyReviewOps(r.dataset, [{ op: 'classifySection', sectionKey: leonaKey, comparisonState: 'NERF' }, { op: 'classify', changeId: r.changes[0].changeId, comparisonState: 'BUFF' }]);
  const cls = deriveLegacyReport(r.dataset, { itemRoster: [], mode: 'publish' });
  check('and the reverse: re-classifying (entity badge and change chip) leaves the impact exactly as the reviewer set it', leonaOf(cls).classification === 'NERF' && leonaOf(cls).changeImpact === 'HIGH' && leonaOf(cls).impactSeverity === 'High');
  check('the entity-level impact lives in dataset.sectionReview[sectionKey].changeImpact; NO change carries an impact (not per-number)', r.dataset.sectionReview[leonaKey].changeImpact === 'HIGH' && r.dataset.changes.every((c) => !('changeImpact' in c) && !('changeImpact' in c.review) && !('changeImpact' in c.displayDefaults)));
  check('the extraction has no impact at all (Riot publishes none): `extractedChangeImpact` does not exist, so the system makes no claim', r.dataset.changes.every((c) => !JSON.stringify(c).toLowerCase().includes('changeimpact')));

  const pubView = toPublicView({ id: 'p', patchNotes: r.dataset, supportMetaAnalysis: '' }, []);
  check('the legacy `impactSeverity` mirrors the reviewed impact in the old Low/Medium/High wording (notify.js reads it) and is null when unrated', leonaOf(pubView).impactSeverity === 'High' && edgeOf(pubView).impactSeverity === null);
  check('a rescan / review re-derive must not resurrect a stored legacy "Medium" over a reviewed value or over "not rated"', (() => {
    const fresh = deriveLegacyReport(r.dataset, { itemRoster: [], mode: 'draft' });
    const stale = { championChanges: [{ championId: 'hwei', championName: 'Hwei', impactSeverity: 'Medium', type: 'Adjustment' }], itemChanges: [{ itemId: 'edge-of-night', itemName: 'Edge of Night', impactSeverity: 'Medium', type: 'Adjustment' }], runeChanges: [], systemChanges: [], recommendedTierChanges: [] };
    const merged = mergeFreshOntoExisting(fresh, stale);
    return merged.championChanges.find((e) => e.championId === 'hwei').impactSeverity === 'High' && merged.itemChanges[0].impactSeverity === null;
  })());
}

// =======================================================================================================================
console.log('\n=== 3. EDITABLE: LOW / MEDIUM / HIGH survive save, reload, revision reads, regeneration, publish ===');
{
  const kv = makeMockKV(); const { env, cookie } = await adminEnv(kv);
  const COACH = JSON.stringify({ revision: 3, champions: { leona: { tier: 'S' } }, items: {}, runes: {}, decisionTrees: {}, patch: '7.7' });
  kv.store.set('coach-overrides', COACH);
  seed(kv, SLUG, PAGE);
  const d = await detect(env, cookie);
  const leonaKey = sectionKeyOf(d.report.patchNotes.changes.find((c) => c.entity.id === 'hwei'));
  const edgeKey = sectionKeyOf(d.report.patchNotes.changes.find((c) => c.entity.name === 'Edge of Night'));
  check('setup: a detected report with no impact set anywhere', d.ok === true && !JSON.stringify(d.report.patchNotes.sectionReview).includes('changeImpact'));

  // every allowed value, in the spellings an admin might send
  for (const [input, canon, label] of [['LOW', 'LOW', 'Low'], ['medium', 'MEDIUM', 'Medium'], ['High', 'HIGH', 'High']]) {
    const res = await review(env, cookie, SLUG, [{ op: 'impactSection', sectionKey: leonaKey, changeImpact: input }]);
    const stored = (await adminReport(env, cookie, SLUG)).patchNotes.sectionReview[leonaKey].changeImpact;
    check(`set ${input}: applied, stored canonically as ${canon}, returned by the admin GET`, res.status === 200 && res.body.applied.includes('impactSection') && stored === canon, { status: res.status, stored });
  }
  const bad = await review(env, cookie, SLUG, [{ op: 'impactSection', sectionKey: leonaKey, changeImpact: 'EXTREME' }]);
  check('an unsupported value is rejected (400) and the previous value is kept', bad.status === 400 && (await adminReport(env, cookie, SLUG)).patchNotes.sectionReview[leonaKey].changeImpact === 'HIGH');
  check('an unknown sectionKey is rejected', (await review(env, cookie, SLUG, [{ op: 'impactSection', sectionKey: 'nope', changeImpact: 'LOW' }])).status === 400);
  check('the dropdown vocabulary is exactly Low / Medium / High (+ "Not rated" = null)', JSON.stringify(CHANGE_IMPACT_OPTIONS) === '[["LOW","Low"],["MEDIUM","Medium"],["HIGH","High"]]' && normalizeChangeImpact('') === null && changeImpactLabel(null) === null);

  // save -> reload / revision read
  await review(env, cookie, SLUG, [{ op: 'impactSection', sectionKey: leonaKey, changeImpact: 'HIGH' }, { op: 'impactSection', sectionKey: edgeKey, changeImpact: 'LOW' }]);
  const reloaded = await adminReport(env, cookie, SLUG);
  const byRevision = await adminReport(env, cookie, SLUG, 1);
  check('RELOAD: both entities carry their reviewed impact', reloaded.patchNotes.sectionReview[leonaKey].changeImpact === 'HIGH' && reloaded.patchNotes.sectionReview[edgeKey].changeImpact === 'LOW');
  check('REVISION READ (?revision=1): the same values', byRevision.patchNotes.sectionReview[leonaKey].changeImpact === 'HIGH' && byRevision.patchNotes.sectionReview[edgeKey].changeImpact === 'LOW');
  check('the admin preview of the public view already shows the reviewed values (legacy entries re-derived on save)', leonaOf(reloaded).impactSeverity === 'High' && edgeOf(reloaded).impactSeverity === 'Low');

  // publish -> public page
  await publish(env, cookie, SLUG);
  let pub = (await publicReports(env)).find((r) => r.id === SLUG);
  check('PUBLISH / READ: the public view carries the reviewed impact per entity', leonaOf(pub).changeImpact === 'HIGH' && edgeOf(pub).changeImpact === 'LOW', [leonaOf(pub).changeImpact, edgeOf(pub).changeImpact]);
  const m = await bundleModule(`import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; export { React, renderToStaticMarkup }; export { PublicReportCard } from ${src('src/pages/PatchNotesPage.jsx')};`);
  const page = m.renderToStaticMarkup(m.React.createElement(m.PublicReportCard, { report: pub, roster: { champions: [], items: [], runes: [] }, initiallyExpanded: true }));
  check('PUBLIC PAGE: the entity header reads  Hwei · classification · "Impact: High"  and  Edge of Night · … · "Impact: Low"', /<span class="patch-entry-name">Hwei<\/span><span class="patch-entry-type patch-class"[^>]*>[^<]+<\/span><span class="severity-chip"[^>]*>Impact: High</.test(page) && /Edge of Night<\/span><span class="patch-entry-type patch-class"[^>]*>[^<]+<\/span><span class="severity-chip"[^>]*>Impact: Low</.test(page));
  check('the public page never shows extraction confidence anywhere', !/confidence/i.test(page));

  // regeneration
  seed(kv, SLUG, PAGE + '\n');
  const rs = await rescan(env, cookie, SLUG);
  const rev2 = await adminReport(env, cookie, SLUG, rs.report.revision);
  check('REGENERATION (rescan -> revision 2): both reviewed impacts carried to the new revision', rs.ok === true && rs.report.revision === 2 && rev2.patchNotes.sectionReview[leonaKey].changeImpact === 'HIGH' && rev2.patchNotes.sectionReview[edgeKey].changeImpact === 'LOW');
  check('...and the regenerated legacy entries show them (no stored "Medium" resurrected)', leonaOf(rev2).impactSeverity === 'High' && edgeOf(rev2).impactSeverity === 'Low');
  check('...revision 1 is untouched and still has its own values', (await adminReport(env, cookie, SLUG, 1)).patchNotes.sectionReview[leonaKey].changeImpact === 'HIGH');
  await publish(env, cookie, SLUG, rs.report.revision);
  pub = (await publicReports(env)).find((r) => r.id === SLUG);
  check('the regenerated, published revision serves the reviewed impact', pub.revision === 2 && leonaOf(pub).changeImpact === 'HIGH' && edgeOf(pub).changeImpact === 'LOW');
  check('a pure dataset regeneration (mergeReviewState) keeps it too', mergeReviewState(extract(PAGE).dataset, reloaded.patchNotes).sectionReview[leonaKey].changeImpact === 'HIGH');

  // removing / restoring the section keeps the review; clearing returns to "not rated"
  await review(env, cookie, SLUG, [{ op: 'removeSection', sectionKey: leonaKey }], 2);
  await review(env, cookie, SLUG, [{ op: 'restoreSection', sectionKey: leonaKey }], 2);
  check('removing then restoring the section does not lose the impact', (await adminReport(env, cookie, SLUG, 2)).patchNotes.sectionReview[leonaKey].changeImpact === 'HIGH');
  await review(env, cookie, SLUG, [{ op: 'impactSection', sectionKey: leonaKey, changeImpact: null }], 2);
  check('clearing it (null) returns the entity to "not rated" -- it does not fall back to MEDIUM', (await adminReport(env, cookie, SLUG, 2)).patchNotes.sectionReview[leonaKey].changeImpact === null && leonaOf(await adminReport(env, cookie, SLUG, 2)).impactSeverity === null);
  await publish(env, cookie, SLUG, 2);
  const cleared = m.renderToStaticMarkup(m.React.createElement(m.PublicReportCard, { report: (await publicReports(env)).find((r) => r.id === SLUG), roster: { champions: [], items: [], runes: [] }, initiallyExpanded: true }));
  check('...and the public page then shows no chip for Hwei (but still Low for Edge of Night)', !/Hwei<\/span><span class="patch-entry-type patch-class"[^>]*>[^<]+<\/span><span class="severity-chip"/.test(cleared) && cleared.includes('Impact: Low'));

  // safety
  check('every KV write went to patch-intel:* (revisions/index) -- never coach-overrides, never Academy data', kv.writes.length > 0 && kv.writes.every((k) => /^(patch-intel:|riot-)/.test(k)), kv.writes.filter((k) => !/^(patch-intel:|riot-)/.test(k)));
  check('coach-overrides (Academy master data) is byte-for-byte unchanged', kv.store.get('coach-overrides') === COACH);
  check('no outbound request happened (no AI provider, no network)', fetchCalls.length === 0, fetchCalls);
}

// =======================================================================================================================
console.log('\n=== 4. REGRESSION: extraction, notes, grouping and summary still hold next to impact ===');
{
  const kv = makeMockKV(); const { env, cookie } = await adminEnv(kv);
  seed(kv, SLUG, PAGE);
  const d = await detect(env, cookie);
  const ds = d.report.patchNotes;
  const leonaChanges = ds.changes.filter((c) => c.entity.id === 'hwei');
  check('extraction is unchanged: Hwei has 4 changes under 3 Riot subsections, in Riot order, with exact headings', leonaChanges.length === 4 && [...new Set(leonaChanges.map((c) => c.subsection.sourceHeading))].join('|') === 'Signature of the Visionary|Disaster - Devastating Fire|Spiraling Despair');
  check('...classification evidence unchanged: arrow pair -> ADJUSTED, [New] -> NEW', leonaChanges.filter((c) => c.comparisonState === 'ADJUSTED').length === 3 && leonaChanges.filter((c) => c.comparisonState === 'NEW').length === 1);
  const key = sectionKeyOf(leonaChanges[0]);
  const note = 'Watch Devastating Fire in lane.';
  const target = leonaChanges.find((c) => c.subsection.sourceHeading === 'Disaster - Devastating Fire');
  await review(env, cookie, SLUG, [
    { op: 'edit', changeId: target.changeId, displayTitle: target.review.displayTitle, displayText: target.review.displayText, reviewerNote: note },
    { op: 'impactSection', sectionKey: key, changeImpact: 'HIGH' },
    { op: 'setSummary', text: 'Hwei and Edge of Night both move.' },
  ]);
  await publish(env, cookie, SLUG);
  seed(kv, SLUG, PAGE + '\n');
  const rs = await rescan(env, cookie, SLUG);
  await publish(env, cookie, SLUG, rs.report.revision);
  const pub = (await publicReports(env)).find((r) => r.id === SLUG);
  const leona = leonaOf(pub);
  check('after save + publish + regeneration: impact HIGH, the note, the custom summary and the 3-subsection grouping are all still there', leona.changeImpact === 'HIGH' && leona.subsections.length === 3 && leona.subsections.find((s) => s.title === 'Disaster - Devastating Fire').changes.map((c) => c.note).join('|') === `${note}|` /* the note sits on ONE of its two changes, not both */ && pub.summary.source === 'custom' && pub.summary.text === 'Hwei and Edge of Night both move.');
  check('the generated summary (when no custom text) still counts the visible entries: 1 champion + 1 item', (() => { const r2 = extract(PAGE); r2.changes.forEach((c) => applyReviewOps(r2.dataset, [{ op: 'keep', changeId: c.changeId }])); const v = toPublicView({ id: 'p', patchNotes: r2.dataset, supportMetaAnalysis: '' }, []); return v.summary.total === 2 && v.summary.headline === '2 Support-relevant changes'; })());
  check('Academy master data is never an input to these paths: patchNotesReview / patchNotesPublic / abilityIcons import nothing from src/data or coach-overrides', ['functions/_lib/patchNotesReview.js', 'functions/_lib/patchNotesPublic.js', 'src/lib/abilityIcons.js', 'src/lib/patchNotesPresentation.js'].every((f) => !/from\s+["'][^"']*(src\/data|\.\.\/data|coach-overrides|kvSafety)[^"']*["']/.test(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
  check('AI Coach is not imported by anything Patch Notes touches (api/coach.js, aiProvider)', ['functions/_lib/patchNotesReview.js', 'functions/_lib/patchNotesPublic.js', 'functions/api/admin/patch-reports.js', 'functions/api/patch-reports.js'].every((f) => !/coach\.js|aiProvider|providers\//.test(fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter((l) => /^\s*import /.test(l)).join('\n'))));
  check('no outbound request happened (no AI provider, no network)', fetchCalls.length === 0, fetchCalls);
}

done();
