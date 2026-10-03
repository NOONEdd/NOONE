// Patch Notes -- presentation + review-persistence regression tests. Plain Node ESM against the REAL pipeline and handlers
// (mock KV, Riot text seeded into the cache, no network, no AI, no production data). Run directly:
//
//   node tests/patchNotesPresentation.test.mjs
//
// Covers the four reported problems and the review-layer guarantees behind them:
//   1  summary consistency   the public summary is derived from the reviewed entries that are actually rendered (one function,
//                            src/lib/patchNotesPresentation.js); a custom summary overrides it; the old contradiction (a count above
//                            "No Support-relevant changes identified") is reproduced on a legacy-shaped report and shown fixed
//   2  structural grouping   entity -> Riot subsection (ability/stat/passive heading, EXACT wording) -> changes; label-style AND
//                            heading-style documents; no Q/W/E/R inference; editable display heading, Riot heading preserved
//   3  notes                 saved in review.reviewerNote, survive save/reload/GET/publish/rescan, shown on the public page, never touch
//                            the original Riot text; a note-only save neither freezes the text nor publishes a pending change
//   4  classification        BUFF/NERF/ADJUSTMENT/NEW/REMOVED/UNKNOWN derived from explicit Riot evidence only; admin override
//                            (per change and per entity) kept beside -- never over -- the extraction value; survives regeneration
//   5/6 removal              a removed change / a removed entity section leaves the public page, stays in the dataset, and stays removed
//                            after regeneration
//   7  review persistence    display text + note + classification + subsection heading + summary all survive regeneration by changeId

import { onRequestPost as checkPost } from '../functions/api/admin/patch-check.js';
import { onRequestGet as adminGet, onRequestPost as reportsPost } from '../functions/api/admin/patch-reports.js';
import { onRequestGet as publicGet } from '../functions/api/patch-reports.js';
import { createSessionToken } from '../functions/_lib/adminAuth.js';
import { SOURCE_TEXT_VERSION } from '../functions/_lib/patchText.js';
import { applyReviewOps, mergeReviewState, sectionKeyOf, subsectionKeyOf } from '../functions/_lib/patchNotesReview.js';
import { toPublicView } from '../functions/_lib/patchNotesPublic.js';
import { buildPatchSummary, normalizeClassification, NO_CHANGES_TEXT } from '../src/lib/patchNotesPresentation.js';
import { extract, makeChecker, CHAMPIONS } from './helpers/patchNotesHelpers.mjs';

const { check, done } = makeChecker();

// ---- harness (same shape as patchRevisionAdminSafety / patchNotesApi) ---------------------------------------------------
function makeMockKV() {
  const store = new Map(); const kv = { store, writes: 0 };
  kv.get = async (k) => (store.has(k) ? store.get(k) : null);
  kv.put = async (k, v) => { kv.writes++; store.set(k, String(v)); };
  kv.delete = async (k) => { store.delete(k); };
  kv.list = async ({ prefix = '' } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: null });
  return kv;
}
globalThis.fetch = async (url) => { throw new Error('unexpected network call: ' + url); };
const adminEnv = async (kv) => { const env = { COACH_KV: kv, ADMIN_SESSION_SECRET: 'test-secret' }; return { env, cookie: `academy_admin_session=${await createSessionToken(env)}` }; };
const post = (url, body, cookie) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie || '' }, body: JSON.stringify(body) });
const seed = (kv, slug, text) => { kv.store.set('riot-latest-patch-meta', JSON.stringify({ slug })); kv.store.set(`riot-fallback-full-content:${slug}:${SOURCE_TEXT_VERSION}`, JSON.stringify({ content: text, truncated: false })); };
const detect = async (env, cookie) => (await checkPost({ request: post('https://x/api/admin/patch-check', { trigger: 'manual' }, cookie), env })).json();
const rescan = async (env, cookie, slug) => (await checkPost({ request: post('https://x/api/admin/patch-check', { action: 'rescan', patchId: slug }, cookie), env })).json();
const act = async (env, cookie, body) => { const r = await reportsPost({ request: post('https://x/api/admin/patch-reports', body, cookie), env }); return { status: r.status, body: await r.json() }; };
const review = (env, cookie, id, ops, revision) => act(env, cookie, { id, action: 'review', ops, ...(revision ? { revision } : {}) });
const adminReport = async (env, cookie, id, revision) => (await (await adminGet({ request: new Request(`https://x/api/admin/patch-reports?id=${id}${revision ? `&revision=${revision}` : ''}`, { headers: { Cookie: cookie } }), env })).json()).report;
const publicReports = async (env) => (await (await publicGet({ request: new Request('https://x/api/patch-reports'), env })).json()).reports;
const publish = async (env, cookie, id, revision) => { await act(env, cookie, { id, action: 'approve', ...(revision ? { revision } : {}) }); return act(env, cookie, { id, action: 'publish', alsoMarkVerified: false, ...(revision ? { revision } : {}) }); };

// Leona + Edge of Night are tracked by Academy's static data. Labels are arbitrary Riot ability names (none is a slot letter).
const PAGE = (extra = '') => `# Wild Rift Patch Notes 7.6

## CHAMPION ADJUSTMENTS

### Leona

Signature of the Visionary

- Passive Damage: 20 / 30 / 40 → 25 / 35 / 45
- Bonus Magic Damage: 5% → 7%

Disaster - Devastating Fire

- Damage: 80 / 120 / 160 → 70 / 110 / 150
- Cooldown: 8 → 9

Disaster - Severing Bolt

- Damage: 70 / 100 / 130 → 60 / 90 / 120

Spiraling Despair

- [New] Spiraling Despair now slows enemies hit.

## ITEM ADJUSTMENTS

### Edge of Night

- Armor Penetration increased from 10% to 15%.
${extra}`;
const SYSTEM_BLOCK = `\n## OBJECTIVES\n\n### Dragon System\n\nElder Dragon buffs now last 30% longer.\n`;

const entryOf = (reports, id, field, key, value) => reports.find((r) => r.id === id)[field].find((e) => e[key] === value);
const leonaPublic = (reports, id) => entryOf(reports, id, 'championChanges', 'championId', 'leona');
const SLUG = 'wild-rift-patch-notes-7-6';

// =======================================================================================================================
console.log('\n=== 1. SUMMARY CONSISTENCY ===');
{
  // 1a. the ORIGINAL contradiction, reproduced on a legacy-shaped report: entries exist, supportMetaAnalysis is "" (what the deterministic
  //     pipeline always wrote), and the old page printed "N Support-relevant changes" above "No Support-relevant changes identified".
  const legacyShaped = { id: 'x', patch: '7.3', supportMetaAnalysis: '', championChanges: [{ championName: 'A' }, { championName: 'B' }, { championName: 'C' }, { championName: 'D' }], itemChanges: [{ itemName: 'I' }, { itemName: 'J' }], runeChanges: [], systemChanges: [] };
  const s = buildPatchSummary(legacyShaped, { legacyText: legacyShaped.supportMetaAnalysis });
  check('4 champions + 2 items with an empty legacy summary field -> 6 changes, NO "no changes" message', s.total === 6 && s.headline === '6 Support-relevant changes' && !/no support-relevant/i.test(s.text) && s.text.includes('4 champions') && s.text.includes('2 items'), s);
  check('the generated count is a pure function of the entries (nothing hard-coded): 1 champion -> "1 Support-relevant change"', buildPatchSummary({ championChanges: [{}], itemChanges: [], runeChanges: [], systemChanges: [] }).headline === '1 Support-relevant change');
  check('only when NOTHING is visible does the "no changes" message appear', buildPatchSummary({ championChanges: [], itemChanges: [], runeChanges: [], systemChanges: [] }).text === NO_CHANGES_TEXT && buildPatchSummary({}).empty === true);
  check('a legacy (AI-era) summary text is still shown as the summary', buildPatchSummary(legacyShaped, { legacyText: 'AI-era analysis of the patch' }).text === 'AI-era analysis of the patch');

  // 1b. the real pipeline: public summary follows the REVIEWED visible entries
  const kv = makeMockKV(); const { env, cookie } = await adminEnv(kv);
  seed(kv, SLUG, PAGE(SYSTEM_BLOCK));
  const d = await detect(env, cookie);
  check('setup: detected, deterministic dataset, empty legacy summary field', d.ok === true && d.report.supportMetaAnalysis === '' && Boolean(d.report.patchNotes), d.report && d.report.supportMetaAnalysis);
  const sys = d.report.patchNotes.changes.find((c) => c.kind === 'system');
  await publish(env, cookie, SLUG);
  let pub = (await publicReports(env)).find((r) => r.id === SLUG);
  const rendered = pub.championChanges.length + pub.itemChanges.length + pub.runeChanges.length + pub.systemChanges.length;
  check('public summary count equals the number of entries the public page renders (champion + item; pending system change is not public)', pub.summary.total === rendered && rendered === 2 && pub.summary.headline === '2 Support-relevant changes' && pub.summary.text.includes('1 champion') && pub.summary.text.includes('1 item'), pub.summary);
  check('the summary source is "generated" and there is no contradictory message', pub.summary.source === 'generated' && !pub.summary.text.includes('No Support-relevant'));

  // keeping the system change makes it visible -> the generated summary follows (new revision of the same data via review op on a published revision)
  await review(env, cookie, SLUG, [{ op: 'keep', changeId: sys.changeId }]);
  pub = (await publicReports(env)).find((r) => r.id === SLUG);
  check('keeping a change updates the generated summary on the next read (3 entries, system change counted)', pub.summary.total === 3 && pub.summary.counts.system === 1 && pub.summary.text.includes('system / meta'), pub.summary);

  // removing the whole Leona section lowers the count; removing everything flips to the honest "no changes" message
  const rev = await adminReport(env, cookie, SLUG);
  const leonaKey = sectionKeyOf(rev.patchNotes.changes.find((c) => c.entity && c.entity.id === 'leona'));
  const edgeKey = sectionKeyOf(rev.patchNotes.changes.find((c) => c.entity && c.entity.name === 'Edge of Night'));
  await review(env, cookie, SLUG, [{ op: 'removeSection', sectionKey: leonaKey }]);
  pub = (await publicReports(env)).find((r) => r.id === SLUG);
  check('removing the Leona section: count drops to match the visible entries', pub.summary.total === 2 && pub.summary.counts.champions === 0 && pub.championChanges.length === 0, pub.summary);
  await review(env, cookie, SLUG, [{ op: 'removeSection', sectionKey: edgeKey }, { op: 'remove', changeId: sys.changeId }]);
  pub = (await publicReports(env)).find((r) => r.id === SLUG);
  check('with nothing visible the generated summary is the "no changes" message (and then it is TRUE)', pub.summary.empty === true && pub.summary.text === NO_CHANGES_TEXT && pub.summary.headline === 'No Support-relevant changes', pub.summary);
  await review(env, cookie, SLUG, [{ op: 'restoreSection', sectionKey: leonaKey }, { op: 'restoreSection', sectionKey: edgeKey }, { op: 'restore', changeId: sys.changeId }]);

  // custom summary
  const custom = 'This patch contains important changes for 1 champion and 1 item used by Support.';
  const set = await review(env, cookie, SLUG, [{ op: 'setSummary', text: custom }]);
  check('setSummary is a review op (stored in the dataset, response carries the public preview)', set.body.ok === true && set.body.report.patchNotes.summaryReview.text === custom && set.body.report.publicPreview.summary.text === custom, set.body);
  pub = (await publicReports(env)).find((r) => r.id === SLUG);
  check('a custom summary is what the public page gets; the generated count is NOT shown instead (headline suppressed)', pub.summary.source === 'custom' && pub.summary.text === custom && pub.summary.headline === null, pub.summary);
  check('the generated sentence is still available to the admin as the fallback (not lost)', typeof pub.summary.generatedText === 'string' && pub.summary.generatedText.includes('Support-relevant change'));
  await review(env, cookie, SLUG, [{ op: 'setSummary', text: NO_CHANGES_TEXT }]);
  pub = (await publicReports(env)).find((r) => r.id === SLUG);
  check('the admin may explicitly publish the "no support-relevant changes" message (their call; the generated data is untouched)', pub.summary.text === NO_CHANGES_TEXT && pub.summary.source === 'custom' && pub.summary.total >= 1);
  await review(env, cookie, SLUG, [{ op: 'setSummary', text: custom }]);

  // regeneration keeps the custom summary
  seed(kv, SLUG, PAGE(SYSTEM_BLOCK) + '\n');
  const rs = await rescan(env, cookie, SLUG);
  const rev2 = await adminReport(env, cookie, SLUG, rs.report.revision);
  check('a rescan (new revision) keeps the custom summary in the review layer', rs.ok === true && rev2.patchNotes.summaryReview && rev2.patchNotes.summaryReview.text === custom && rev2.publicPreview.summary.text === custom, rev2.patchNotes.summaryReview);
  await review(env, cookie, SLUG, [{ op: 'clearSummary' }], rs.report.revision);
  const rev2b = await adminReport(env, cookie, SLUG, rs.report.revision);
  check('clearSummary returns to the generated summary', !rev2b.patchNotes.summaryReview && rev2b.publicPreview.summary.source === 'generated');
  const bad = await review(env, cookie, SLUG, [{ op: 'setSummary', text: 12345 }]);
  check('a non-string summary is rejected, nothing changes', bad.status === 400);
}

// =======================================================================================================================
console.log('\n=== 2. STRUCTURAL GROUPING (entity -> Riot subsection -> changes) ===');
{
  const HWEI_LABELS = `## CHAMPION ADJUSTMENTS\n\n### Hwei\n\nSignature of the Visionary\n\n- Passive Damage: 20 / 30 / 40 → 25 / 35 / 45\n- Bonus Magic Damage: 5% → 7%\n\nDisaster - Devastating Fire\n\n- Damage: 80 / 120 / 160 → 70 / 110 / 150\n- Cooldown: 8 → 9\n\nDisaster - Severing Bolt\n\n- Damage: 70 / 100 / 130 → 60 / 90 / 120\n\nSpiraling Despair\n\n- Cooldown: 120 / 100 / 80 → 130 / 110 / 90\n`;
  const { dataset } = extract(HWEI_LABELS);
  const rep = { id: 'x', patch: '7.3', patchNotes: dataset, supportMetaAnalysis: '' };
  const view = toPublicView(rep, []);
  const hwei = view.championChanges.find((e) => e.championId === 'hwei');
  const titles = hwei.subsections.map((s) => s.title);
  check('ONE Hwei entry with FOUR subsections, in Riot order, with Riot\'s exact names', hwei.subsections.length === 4 && titles.join('|') === 'Signature of the Visionary|Disaster - Devastating Fire|Disaster - Severing Bolt|Spiraling Despair', titles);
  check('changes stay grouped under their own subsection (2 / 2 / 1 / 1), not one line per number and not one blob', hwei.subsections.map((s) => s.changes.length).join() === '2,2,1,1', hwei.subsections.map((s) => s.changes.length));
  check('no subsection text is a ";"-joined concatenation of several Riot subsections', hwei.subsections.every((s) => s.changes.every((c) => !c.text.includes('; ') && !titles.some((t) => t !== s.title && c.text.includes(t)))), hwei.subsections.map((s) => s.changes.map((c) => c.text)));
  check('the change text under a heading does not repeat that heading as a prefix', hwei.subsections[1].changes[0].text === 'Damage: 80 / 120 / 160 → 70 / 110 / 150', hwei.subsections[1].changes[0].text);
  check('NO Q/W/E/R/passive inference: titles are exactly the source labels, none is a slot letter or "Passive"', titles.every((t) => !/^(?:[QWER]|passive|ultimate)$/i.test(t)));
  check('each normalized change carries the exact Riot heading (extraction layer) and the entity->subsection key', dataset.changes.every((c) => c.subsection && c.subsection.origin === 'label' && titles.includes(c.subsection.sourceHeading) && subsectionKeyOf(c)), dataset.changes.map((c) => c.subsection));
  check('original source text is untouched and per-change', dataset.changes.every((c) => c.originalSourceText && c.originalSourceText.includes(':')) && dataset.changes[0].originalSourceText.includes('Passive Damage'));
  check('legacy flat text is still produced for old readers (whatChanged), but the page renders subsections', hwei.whatChanged.includes('Disaster - Severing Bolt') && Array.isArray(hwei.subsections));

  // Riot's own slot notation is kept (it is Riot's wording), a label without it gets none invented
  const slots = extract(`## CHAMPION ADJUSTMENTS\n\n### Hwei\n\nE - Unbreakable\n\n- Cooldown: 12 → 10\n\nPiercing Darkness\n\n- Damage: 50 → 40\n`);
  const st = toPublicView({ id: 'x', patchNotes: slots.dataset }, []).championChanges[0].subsections.map((s) => s.title);
  check('"E - Unbreakable" keeps Riot\'s own slot notation; "Piercing Darkness" is not given a slot', st.join('|') === 'E - Unbreakable|Piercing Darkness', st);

  // no subsection structure -> fallback, never a fabricated name
  const bare = extract(`## CHAMPION ADJUSTMENTS\n\n### Hwei\n\n- Damage: 50 → 40\n- Cooldown: 10 → 12\n`);
  const bareSubs = toPublicView({ id: 'x', patchNotes: bare.dataset }, []).championChanges[0].subsections;
  check('no Riot subsection -> ONE untitled group directly under the entity (fallback), nothing invented', bareSubs.length === 1 && bareSubs[0].title === null && bareSubs[0].changes.length === 2, bareSubs);

  // heading-style documents: child headings under a tracked entity heading are its subsections, not new entities
  const HEAD = `## CHAMPION ADJUSTMENTS\n\n### Hwei\n\n#### Signature of the Visionary\n\n- Passive Damage: 20 → 25\n\n#### Disaster - Devastating Fire\n\n- Damage: 80 → 70\n- Cooldown: 8 → 9\n\n#### Disaster - Severing Bolt\n\n- Damage: 70 → 60\n`;
  const h = extract(HEAD);
  check('heading-style: every change belongs to the ONE tracked entity Hwei (EXISTING), not to fake UNMATCHED entities named after the abilities', h.changes.every((c) => c.entity.name === 'Hwei' && c.entity.status === 'EXISTING') && h.changes.length === 4, h.changes.map((c) => [c.entity.name, c.entity.status]));
  check('ownership is recorded as entity_subsection with the hierarchy as the reason', h.changes.every((c) => c.ownership.source === 'entity_subsection' && /subsection of the tracked champion/.test(c.ownership.reason)), h.changes[0].ownership);
  const hs = toPublicView({ id: 'x', patchNotes: h.dataset }, []).championChanges[0].subsections;
  check('heading-style: three subsections with the exact heading text, changes grouped', hs.map((s) => s.title).join('|') === 'Signature of the Visionary|Disaster - Devastating Fire|Disaster - Severing Bolt' && hs[1].changes.length === 2, hs.map((s) => s.title));
  check('heading-style: validation shows no dropped blocks and no false ownership', h.dataset.validation.droppedBlocks === 0 && h.dataset.validation.falseOwnership.count === 0, h.dataset.validation);
  const notEntityParent = extract(`## CHAMPION ADJUSTMENTS\n\n### Notes on lanes\n\n#### Zzyzx the Unknown\n\n- Damage: 1 → 2\n`);
  check('a child heading under a NON-entity parent is still its own (unmatched) entity -- grouping needs a provable tracked parent', notEntityParent.changes.every((c) => c.entity && c.entity.name === 'Zzyzx the Unknown' && c.entity.status !== 'EXISTING'), notEntityParent.changes.map((c) => [c.entity && c.entity.name, c.entity && c.entity.status]));

  // editable display heading; Riot's heading preserved; survives regeneration
  const sub = dataset.changes.find((c) => c.subsection.sourceHeading === 'Disaster - Devastating Fire');
  const ids0 = dataset.changes.map((c) => c.changeId);
  const ed = applyReviewOps(dataset, [{ op: 'editSubsectionTitle', subsectionKey: subsectionKeyOf(sub), displayHeading: 'Devastating Fire (reworked)' }]);
  check('editSubsectionTitle applied; unknown subsectionKey rejected', ed.applied.length === 1 && applyReviewOps(dataset, [{ op: 'editSubsectionTitle', subsectionKey: 'nope', displayHeading: 'x' }]).errors.length === 1);
  const after = toPublicView(rep, []).championChanges[0].subsections.map((s) => s.title);
  check('the public heading is the display edit', after[1] === 'Devastating Fire (reworked)' && after[0] === 'Signature of the Visionary', after);
  check('Riot\'s original heading is preserved separately (extraction layer + public sourceHeading)', sub.subsection.sourceHeading === 'Disaster - Devastating Fire' && toPublicView(rep, []).championChanges[0].subsections[1].sourceHeading === 'Disaster - Devastating Fire');
  check('editing a subsection heading does not change any stable change ID', JSON.stringify(dataset.changes.map((c) => c.changeId)) === JSON.stringify(ids0));
  const regen = mergeReviewState(extract(HWEI_LABELS).dataset, dataset);
  check('regeneration keeps the display heading', toPublicView({ id: 'x', patchNotes: regen }, []).championChanges[0].subsections[1].title === 'Devastating Fire (reworked)');
  applyReviewOps(dataset, [{ op: 'editSubsectionTitle', subsectionKey: subsectionKeyOf(sub), displayHeading: '' }]);
  check('an empty heading returns to Riot\'s own', toPublicView(rep, []).championChanges[0].subsections[1].title === 'Disaster - Devastating Fire');
}

// =======================================================================================================================
console.log('\n=== 3. NOTES: save -> reload -> GET -> publish -> public -> regenerate ===');
{
  const kv = makeMockKV(); const { env, cookie } = await adminEnv(kv);
  seed(kv, SLUG, PAGE());
  const d = await detect(env, cookie);
  const ds0 = d.report.patchNotes;
  const target = ds0.changes.find((c) => c.entity.id === 'leona' && c.subsection.sourceHeading === 'Disaster - Severing Bolt');
  const original = target.originalSourceText; const textBefore = target.review.displayText;
  const NOTE = 'Severing Bolt is the one to watch in lane.';

  // note-only save, exactly as the admin form sends it (title + text + note together)
  const saved = await review(env, cookie, SLUG, [{ op: 'edit', changeId: target.changeId, displayTitle: target.review.displayTitle, displayText: target.review.displayText, reviewerNote: NOTE }]);
  check('save: the review op is applied', saved.status === 200 && saved.body.applied.includes('edit'), saved.body);
  const reloaded = await adminReport(env, cookie, SLUG);
  const rc = reloaded.patchNotes.changes.find((c) => c.changeId === target.changeId);
  check('reload / GET: the note is in the review layer (review.reviewerNote)', rc.review.reviewerNote === NOTE, rc.review);
  check('the note never touches the original Riot source or the normalized extraction', rc.originalSourceText === original && JSON.stringify(rc.normalizedData) === JSON.stringify(target.normalizedData));
  check('a note-only save does NOT mark the display text as edited, so it keeps following the extraction', rc.review.edited.text === false && rc.review.edited.title === false && rc.review.displayText === textBefore, rc.review);
  check('a note-only save on a pending change does not silently change its review state', rc.review.state === 'pending', rc.review.state);

  await publish(env, cookie, SLUG);
  let pub = (await publicReports(env)).find((r) => r.id === SLUG);
  const bolt = leonaPublic([pub], SLUG).subsections.find((s) => s.title === 'Disaster - Severing Bolt');
  check('PUBLIC: the note is rendered data on that change, under that subsection', bolt && bolt.changes[0].note === NOTE, bolt);
  check('public changes without a note carry an empty note (not undefined, not another change\'s note)', leonaPublic([pub], SLUG).subsections.filter((s) => s.title !== 'Disaster - Severing Bolt').every((s) => s.changes.every((c) => c.note === '')));
  check('the public view still never exposes the dataset, provenance, fingerprints or change IDs', !('patchNotes' in pub) && !JSON.stringify(pub).includes('sourceFingerprint') && !JSON.stringify(pub).includes('pn_') && !JSON.stringify(pub).includes('reviewerNote'));

  // regeneration (same stable change ID)
  seed(kv, SLUG, PAGE() + '\n');
  const rs = await rescan(env, cookie, SLUG);
  const rev2 = await adminReport(env, cookie, SLUG, rs.report.revision);
  const t2 = rev2.patchNotes.changes.find((c) => c.changeId === target.changeId);
  check('REGENERATION: the same stable change ID still carries the note', rs.ok === true && t2 && t2.review.reviewerNote === NOTE, t2 && t2.review);
  await publish(env, cookie, SLUG, rs.report.revision);
  pub = (await publicReports(env)).find((r) => r.id === SLUG);
  check('after publishing the regenerated revision the public page still shows the note', leonaPublic([pub], SLUG).subsections.find((s) => s.title === 'Disaster - Severing Bolt').changes[0].note === NOTE && pub.revision === rs.report.revision);

  // clearing and editing
  await review(env, cookie, SLUG, [{ op: 'edit', changeId: target.changeId, reviewerNote: '' }], rs.report.revision);
  pub = (await publicReports(env)).find((r) => r.id === SLUG);
  check('clearing the note removes it from the public page', leonaPublic([pub], SLUG).subsections.find((s) => s.title === 'Disaster - Severing Bolt').changes[0].note === '');

  // a note on a pending change that Academy does not track must not publish it
  const kv2 = makeMockKV(); const e2 = await adminEnv(kv2);
  seed(kv2, 'wild-rift-patch-notes-7-7', `# Notes\n\n## CHAMPION ADJUSTMENTS\n\n### Zzyzx the Unknown\n\n- Damage: 1 → 2\n`);
  const d2 = await detect(e2.env, e2.cookie);
  const unk = d2.report.patchNotes.changes[0];
  await review(e2.env, e2.cookie, 'wild-rift-patch-notes-7-7', [{ op: 'edit', changeId: unk.changeId, displayTitle: unk.review.displayTitle, displayText: unk.review.displayText, reviewerNote: 'thinking about it' }]);
  await publish(e2.env, e2.cookie, 'wild-rift-patch-notes-7-7');
  const p2 = (await publicReports(e2.env)).find((r) => r.id === 'wild-rift-patch-notes-7-7');
  check('adding a note to a pending UNMATCHED change does NOT make it public (only an explicit Keep/real edit does)', p2.championChanges.length + p2.itemChanges.length + p2.runeChanges.length + p2.systemChanges.length === 0, p2.summary);
}

// =======================================================================================================================
console.log('\n=== 4. CLASSIFICATION (extracted truth beside a human override) ===');
{
  // explicit Riot evidence only
  const RIOT = `## CHAMPION ADJUSTMENTS\n\n### Buffs\n\n#### Hwei\n\nA label\n\n- Cooldown: 12 → 10\n\n### Nerfs\n\n#### Braum\n\nAnother label\n\n- Damage: 80 → 70\n\n### Senna\n\nAbsolution\n\n- Critical Rate gained per 20 Mist: 15% → 10%\n\nPiercing Darkness\n\n- [New] Basic attacks now deal bonus damage.\n\nSomething Old\n\n- [Removed] Old passive effect.\n\nProse Only\n\n- Behaviour now differs in some unquantified way.\n`;
  const r = extract(RIOT);
  const byEnt = (name) => r.changes.filter((c) => c.entity.name === name);
  check('Riot "Buffs" heading -> BUFF, "Nerfs" heading -> NERF (explicit Riot wording)', byEnt('Hwei').every((c) => c.comparisonState === 'BUFF') && byEnt('Braum').every((c) => c.comparisonState === 'NERF'));
  check('an unlabeled old -> new pair stays ADJUSTED (neither buff nor nerf is guessed from the numbers)', byEnt('Senna').find((c) => c.normalizedData.stat === 'Critical Rate gained per 20 Mist').comparisonState === 'ADJUSTED');
  check('[New] -> NEW, [Removed] -> REMOVED, prose with no value pair -> UNKNOWN', byEnt('Senna').find((c) => c.normalizedData.effect && /bonus damage/.test(c.normalizedData.effect)).comparisonState === 'NEW' && byEnt('Senna').find((c) => c.normalizedData.effect && /Old passive/.test(c.normalizedData.effect)).comparisonState === 'REMOVED' && byEnt('Senna').find((c) => /unquantified/.test(c.originalSourceText)).comparisonState === 'UNKNOWN');

  // the public badge is no longer the constant default
  const pub = toPublicView({ id: 'x', patchNotes: r.dataset }, []);
  const badge = (name) => pub.championChanges.find((e) => e.championName === name);
  check('public badge: Hwei BUFF, Braum NERF -- NOT "Adjustment" for everything', badge('Hwei').classification === 'BUFF' && badge('Braum').classification === 'NERF' && badge('Hwei').type === 'Buff' && badge('Braum').type === 'Nerf', pub.championChanges.map((e) => [e.championName, e.classification, e.type]));
  check('an entity whose changes disagree reads as the neutral ADJUSTED, and each change keeps its own classification', badge('Senna').classification === 'ADJUSTED' && new Set(badge('Senna').subsections.flatMap((s) => s.changes.map((c) => c.classification))).size >= 3);

  // override: each value, per change
  const target = byEnt('Senna').find((c) => c.normalizedData.stat === 'Critical Rate gained per 20 Mist');
  const extractedBefore = target.comparisonState;
  for (const [input, canon] of [['BUFF', 'BUFF'], ['NERF', 'NERF'], ['ADJUSTMENT', 'ADJUSTED'], ['adjusted', 'ADJUSTED'], ['NEW', 'NEW'], ['REMOVED', 'REMOVED'], ['UNKNOWN', 'UNKNOWN']]) {
    const res = applyReviewOps(r.dataset, [{ op: 'classify', changeId: target.changeId, comparisonState: input }]);
    const shown = toPublicView({ id: 'x', patchNotes: r.dataset }, []).championChanges.find((e) => e.championName === 'Senna').subsections.flatMap((s) => s.changes).find((c) => /Critical Rate/.test(c.text));
    check(`override ${input}: stored canonical ${canon}, shown publicly as ${canon}, extraction value untouched (${extractedBefore})`, res.applied.length === 1 && target.review.comparisonStateOverride === canon && shown.classification === canon && target.comparisonState === extractedBefore, { stored: target.review.comparisonStateOverride, shown: shown.classification });
  }
  const bad = applyReviewOps(r.dataset, [{ op: 'classify', changeId: target.changeId, comparisonState: 'GREAT' }]);
  check('an unsupported classification is rejected and the previous override is kept', bad.errors.length === 1 && bad.applied.length === 0 && target.review.comparisonStateOverride === 'UNKNOWN');
  applyReviewOps(r.dataset, [{ op: 'classify', changeId: target.changeId, comparisonState: 'NERF' }]);

  // entity-level badge override
  const senKey = sectionKeyOf(target);
  applyReviewOps(r.dataset, [{ op: 'classifySection', sectionKey: senKey, comparisonState: 'REMOVED' }]);
  check('an entity-level override sets the badge; per-change classifications stay as they were', toPublicView({ id: 'x', patchNotes: r.dataset }, []).championChanges.find((e) => e.championName === 'Senna').classification === 'REMOVED' && target.review.comparisonStateOverride === 'NERF');
  applyReviewOps(r.dataset, [{ op: 'classifySection', sectionKey: senKey, comparisonState: null }]);

  // survives regeneration (mergeReviewState)
  const regen = mergeReviewState(extract(RIOT).dataset, r.dataset);
  const t2 = regen.changes.find((c) => c.changeId === target.changeId);
  check('REGENERATION: override kept, extraction value refreshed from the new run and still ADJUSTED', t2.review.comparisonStateOverride === 'NERF' && t2.comparisonState === 'ADJUSTED');
  applyReviewOps(r.dataset, [{ op: 'classifySection', sectionKey: senKey, comparisonState: 'BUFF' }]);
  check('REGENERATION: entity-level override kept', mergeReviewState(extract(RIOT).dataset, r.dataset).sectionReview[senKey].comparisonStateOverride === 'BUFF');
  applyReviewOps(r.dataset, [{ op: 'classify', changeId: target.changeId, comparisonState: null }]);
  check('clearing the override returns to the extracted classification', toPublicView({ id: 'x', patchNotes: r.dataset }, []).championChanges.find((e) => e.championName === 'Senna').subsections.flatMap((s) => s.changes).find((c) => /Critical Rate/.test(c.text)).classification === 'ADJUSTED');
  check('normalizeClassification accepts the six values (ADJUSTMENT = ADJUSTED) and nothing else', ['BUFF', 'NERF', 'ADJUSTMENT', 'ADJUSTED', 'NEW', 'REMOVED', 'UNKNOWN'].every((v) => normalizeClassification(v)) && !normalizeClassification('GOOD') && !normalizeClassification(5));

  // through the API: save -> reload -> publish -> public -> rescan -> public
  const kv = makeMockKV(); const { env, cookie } = await adminEnv(kv);
  seed(kv, SLUG, PAGE());
  const d = await detect(env, cookie);
  const edge = d.report.patchNotes.changes.find((c) => c.entity.name === 'Edge of Night');
  check('setup: the unlabeled prose pair on Edge of Night is extracted as ADJUSTED', edge.comparisonState === 'ADJUSTED');
  await review(env, cookie, SLUG, [{ op: 'classify', changeId: edge.changeId, comparisonState: 'NERF' }]);
  const re = (await adminReport(env, cookie, SLUG)).patchNotes.changes.find((c) => c.changeId === edge.changeId);
  check('reload: override stored in review, extraction value still ADJUSTED', re.review.comparisonStateOverride === 'NERF' && re.comparisonState === 'ADJUSTED');
  await publish(env, cookie, SLUG);
  let pub2 = (await publicReports(env)).find((r) => r.id === SLUG);
  check('public: the override is displayed (NERF)', entryOf([pub2], SLUG, 'itemChanges', 'itemName', 'Edge of Night').classification === 'NERF', entryOf([pub2], SLUG, 'itemChanges', 'itemName', 'Edge of Night'));
  seed(kv, SLUG, PAGE() + '\n');
  const rs = await rescan(env, cookie, SLUG);
  await publish(env, cookie, SLUG, rs.report.revision);
  pub2 = (await publicReports(env)).find((r) => r.id === SLUG);
  check('after a rescan + publish of the new revision the override is still displayed', entryOf([pub2], SLUG, 'itemChanges', 'itemName', 'Edge of Night').classification === 'NERF' && pub2.revision === rs.report.revision);
  check('the legacy `type` stored on re-derived entries mirrors the override (a rescan never resurrects the old constant "Adjustment")', (await adminReport(env, cookie, SLUG, rs.report.revision)).itemChanges.find((e) => e.itemName === 'Edge of Night').type === 'Nerf');
}

// =======================================================================================================================
console.log('\n=== 5/6. REMOVAL: one change, and a whole entity section ===');
{
  const kv = makeMockKV(); const { env, cookie } = await adminEnv(kv);
  seed(kv, SLUG, PAGE());
  const d = await detect(env, cookie);
  const ds = d.report.patchNotes;
  const bolt = ds.changes.find((c) => c.subsection && c.subsection.sourceHeading === 'Disaster - Severing Bolt');
  const fire = ds.changes.filter((c) => c.subsection && c.subsection.sourceHeading === 'Disaster - Devastating Fire');
  await publish(env, cookie, SLUG);
  const titlesOf = async () => leonaPublic(await publicReports(env), SLUG).subsections.map((s) => s.title);
  check('setup: all four subsections are public', (await titlesOf()).length === 4);

  // 5. one change
  await review(env, cookie, SLUG, [{ op: 'remove', changeId: bolt.changeId }]);
  check('REMOVE one change: its subsection disappears from the public page (it had only that change)', !(await titlesOf()).includes('Disaster - Severing Bolt') && (await titlesOf()).length === 3);
  const rv = (await adminReport(env, cookie, SLUG)).patchNotes.changes.find((c) => c.changeId === bolt.changeId);
  check('...but the extraction remains: source text, normalized data and provenance are all still there; state is "removed" (not "rejected")', rv.review.state === 'removed' && rv.originalSourceText === bolt.originalSourceText && JSON.stringify(rv.normalizedData) === JSON.stringify(bolt.normalizedData) && rv.provenance.sourceFingerprint === bolt.provenance.sourceFingerprint);
  await review(env, cookie, SLUG, [{ op: 'remove', changeId: fire[0].changeId }]);
  const afterOne = leonaPublic(await publicReports(env), SLUG).subsections.find((s) => s.title === 'Disaster - Devastating Fire');
  check('removing ONE of two changes under a subsection keeps the subsection with the other change', afterOne && afterOne.changes.length === 1, afterOne);
  seed(kv, SLUG, PAGE() + '\n');
  const rs = await rescan(env, cookie, SLUG);
  const r2 = await adminReport(env, cookie, SLUG, rs.report.revision);
  check('REGENERATION does not restore a removed change to visible', r2.patchNotes.changes.find((c) => c.changeId === bolt.changeId).review.state === 'removed' && r2.patchNotes.changes.find((c) => c.changeId === fire[0].changeId).review.state === 'removed');
  await publish(env, cookie, SLUG, rs.report.revision);
  check('...and the regenerated, published revision still hides it', !(await titlesOf()).includes('Disaster - Severing Bolt'));
  await review(env, cookie, SLUG, [{ op: 'reject', changeId: fire[1].changeId }], rs.report.revision);
  check('Reject is a different state from Remove (parser right, out of scope); both leave publication', (await adminReport(env, cookie, SLUG, rs.report.revision)).patchNotes.changes.find((c) => c.changeId === fire[1].changeId).review.state === 'rejected' && !(await titlesOf()).includes('Disaster - Devastating Fire'));

  // 6. a whole entity section
  const leonaKey = sectionKeyOf(ds.changes.find((c) => c.entity.id === 'leona'));
  const pubBefore = (await publicReports(env)).find((r) => r.id === SLUG);
  check('setup: Leona is public before the section removal', pubBefore.championChanges.length === 1);
  await review(env, cookie, SLUG, [{ op: 'removeSection', sectionKey: leonaKey }], rs.report.revision);
  const pubAfter = (await publicReports(env)).find((r) => r.id === SLUG);
  check('REMOVE SECTION: the whole Leona section disappears from the public Patch Notes (and the summary follows)', pubAfter.championChanges.length === 0 && pubAfter.itemChanges.length === 1 && pubAfter.summary.counts.champions === 0 && pubAfter.summary.total === 1, pubAfter.summary);
  const r3 = await adminReport(env, cookie, SLUG, rs.report.revision);
  const leonaChanges = r3.patchNotes.changes.filter((c) => c.entity && c.entity.id === 'leona');
  check('...the underlying extraction of every Leona change remains intact', leonaChanges.length === ds.changes.filter((c) => c.entity.id === 'leona').length && leonaChanges.every((c) => c.originalSourceText && c.normalizedData && c.provenance), leonaChanges.length);
  check('...the section is recorded as removed in the review layer', r3.patchNotes.sectionReview[leonaKey].state === 'removed');
  seed(kv, SLUG, PAGE() + '\n\n');
  const rs2 = await rescan(env, cookie, SLUG);
  const r4 = await adminReport(env, cookie, SLUG, rs2.report.revision);
  check('REGENERATION preserves the section removal', r4.patchNotes.sectionReview[leonaKey].state === 'removed');
  await publish(env, cookie, SLUG, rs2.report.revision);
  check('...and the published regenerated revision still has no Leona section', (await publicReports(env)).find((r) => r.id === SLUG).championChanges.length === 0);
  await review(env, cookie, SLUG, [{ op: 'restoreSection', sectionKey: leonaKey }], rs2.report.revision);
  check('restoring the section brings it back', (await publicReports(env)).find((r) => r.id === SLUG).championChanges.length === 1);
}

// =======================================================================================================================
console.log('\n=== 7. ALL review fields together survive regeneration by stable change ID ===');
{
  const SRC = `## CHAMPION ADJUSTMENTS\n\n### Hwei\n\nSignature of the Visionary\n\n- Passive Damage: 20 → 25\n\nDisaster - Severing Bolt\n\n- Damage: 70 → 60\n`;
  const a = extract(SRC);
  const [c1, c2] = a.changes;
  applyReviewOps(a.dataset, [
    { op: 'edit', changeId: c1.changeId, displayText: 'Passive damage is higher at every rank.', displayTitle: 'Hwei passive', reviewerNote: 'worth a mention' },
    { op: 'classify', changeId: c1.changeId, comparisonState: 'BUFF' },
    { op: 'editSubsectionTitle', subsectionKey: subsectionKeyOf(c2), displayHeading: 'Severing Bolt' },
    { op: 'remove', changeId: c2.changeId },
    { op: 'setSummary', text: 'Hwei got touched.' },
  ]);
  const idsBefore = a.changes.map((c) => c.changeId);
  // regenerate with different surrounding text but the same two changes
  const b = extract(SRC.replace('### Hwei', '### Hwei'));
  const m = mergeReviewState(b.dataset, a.dataset);
  const m1 = m.changes.find((c) => c.changeId === c1.changeId); const m2 = m.changes.find((c) => c.changeId === c2.changeId);
  check('stable IDs are identical across regeneration and across every review edit', JSON.stringify(m.changes.map((c) => c.changeId)) === JSON.stringify(idsBefore));
  check('display text, display title, note, classification override and edited flags all survive', m1.review.displayText === 'Passive damage is higher at every rank.' && m1.review.displayTitle === 'Hwei passive' && m1.review.reviewerNote === 'worth a mention' && m1.review.comparisonStateOverride === 'BUFF' && m1.review.edited.text && m1.review.state === 'edited', m1.review);
  check('the removed change stays removed; the subsection heading edit and the custom summary survive', m2.review.state === 'removed' && m.subsectionReview[subsectionKeyOf(c2)].displayHeading === 'Severing Bolt' && m.summaryReview.text === 'Hwei got touched.');
  check('the extraction layer of the regenerated change is the NEW extraction (same truth), review fields untouched by it', m1.originalSourceText === c1.originalSourceText && m1.comparisonState === c1.comparisonState);
  // even when Riot rewords the line (same slot => same ID) the human work is kept and flagged
  const reworded = extract(SRC.replace('20 → 25', '20 → 28'));
  const m3 = mergeReviewState(reworded.dataset, a.dataset).changes.find((c) => c.changeId === c1.changeId);
  check('Riot rewording the same slot keeps note + override + edit and flags sourceChangedSinceReview', m3 && m3.review.reviewerNote === 'worth a mention' && m3.review.comparisonStateOverride === 'BUFF' && m3.review.sourceChangedSinceReview === true, m3 && m3.review);
  // a reviewed change the new run no longer produces is kept as orphaned with its note/override
  const dropped = extract(`## CHAMPION ADJUSTMENTS\n\n### Hwei\n\nDisaster - Severing Bolt\n\n- Damage: 70 → 60\n`);
  const m4 = mergeReviewState(dropped.dataset, a.dataset);
  check('a reviewed change that disappears is kept as orphaned with its note and override (never silently destroyed)', m4.orphanedChanges.some((c) => c.changeId === c1.changeId && c.review.reviewerNote === 'worth a mention' && c.review.comparisonStateOverride === 'BUFF'));
}

// =======================================================================================================================
console.log('\n=== 8. COMPATIBILITY: datasets already stored (before these fields existed) still read, edit and regenerate ===');
{
  const SRC = `## CHAMPION ADJUSTMENTS\n\n### Hwei\n\nSignature of the Visionary\n\n- Passive Damage: 20 → 25\n\nDisaster - Severing Bolt\n\n- Damage: 70 → 60\n`;
  const fresh = extract(SRC).dataset;
  const old = JSON.parse(JSON.stringify(fresh)); // what production KV holds today: no subsection / displayBody / override / subsectionReview / summaryReview
  delete old.subsectionReview; delete old.summaryReview;
  for (const c of old.changes) { delete c.subsection; delete c.displayDefaults.displayBody; delete c.review.comparisonStateOverride; }
  const view = toPublicView({ id: 'p', patch: '7.3', supportMetaAnalysis: '', patchNotes: old }, []);
  check('an OLD stored dataset renders publicly with subsections recovered from its stored ability labels (no re-scan, no rewrite needed)', view.championChanges[0].subsections.map((s) => s.title).join('|') === 'Signature of the Visionary|Disaster - Severing Bolt', view.championChanges[0].subsections.map((s) => s.title));
  check('...with a generated summary, a derived classification (not a constant), and no crash', view.summary.headline === '1 Support-relevant change' && view.championChanges[0].classification === 'ADJUSTED');
  const before = JSON.stringify(old);
  toPublicView({ id: 'p', patchNotes: old }, []);
  check('reading never mutates the stored dataset (read-only view)', JSON.stringify(old) === before);
  const ops = applyReviewOps(JSON.parse(JSON.stringify(old)), [{ op: 'setSummary', text: 'x' }, { op: 'classify', changeId: old.changes[0].changeId, comparisonState: 'NERF' }, { op: 'editSubsectionTitle', subsectionKey: subsectionKeyOf(old.changes[0]), displayHeading: 'Renamed' }]);
  check('every new review op works on an old dataset', ops.applied.length === 3 && ops.errors.length === 0, ops);
  const merged = mergeReviewState(fresh, old);
  check('regenerating from an old dataset adds the new fields with safe defaults and keeps every old review', merged.changes.every((c) => c.review.comparisonStateOverride === null) && JSON.stringify(merged.changes.map((c) => c.changeId)) === JSON.stringify(old.changes.map((c) => c.changeId)));
}

done();
