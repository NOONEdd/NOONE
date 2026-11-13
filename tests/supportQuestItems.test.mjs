// Stage 6 -- the support quest items as canonical Academy records (src/data/items.js QUEST_ITEMS), and the regression tests for
// the two cases that started this work: Bulwark of the Mountain (Relic Shield's upgraded form) and Black Mist Scythe (Spectral
// Sickle's upgraded form).
//
//   node tests/supportQuestItems.test.mjs
//
// Pure functions + the real admin/public handlers on an in-memory fake KV. No network, no production KV, nothing written to disk.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ITEMS, QUEST_ITEMS, ALL_ITEMS, BUILDABLE_ITEMS } from '../src/data/items.js';
import { CHAMPIONS, isAcademyCovered } from '../src/data/champions.js';
import { RUNES } from '../src/data/runes.js';
import { candidatePaths, findCanonicalId } from '../src/utils/images.js';
import { parsePatchDocument } from '../functions/_lib/patchParser.js';
import { extractPatchNotes } from '../functions/_lib/patchNotesExtract.js';
import { initReview, applyReviewOps, deriveLegacyReport, sectionKeyOf, mergeReviewState, mergeFreshOntoExisting, applyCoachFieldEdits, applyClassificationRules, isChangePublishable } from '../functions/_lib/patchNotesReview.js';
import { effectiveClassification } from '../src/lib/patchNotesClassification.js';
import { detectItemsAndRunes } from '../functions/_lib/detectItemsRunes.js';
import { academyCatalog, RULES_KEY } from '../functions/_lib/patchClassificationRules.js';
import { onRequestPost as checkPost } from '../functions/api/admin/patch-check.js';
import { onRequestGet as reportsGet } from '../functions/api/admin/patch-reports.js';
import { onRequestGet as publicGet } from '../functions/api/patch-reports.js';
import { createSessionToken } from '../functions/_lib/adminAuth.js';
import { SOURCE_TEXT_VERSION } from '../functions/_lib/patchText.js';
import * as KVS from '../functions/_lib/kvSafety.js';
import { makeChecker } from './helpers/patchNotesHelpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { check, done } = makeChecker();
const T = '2026-11-12T00:00:00.000Z';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const QUEST_IDS = ['relic-shield', 'spectral-sickle', 'bulwark-of-the-mountain', 'black-mist-scythe'];
const rosters = (itemRoster) => ({ championRoster: CHAMPIONS.filter(isAcademyCovered), itemRoster, runeRoster: RUNES });
const build = (text, itemRoster = ALL_ITEMS) => initReview(extractPatchNotes({ units: parsePatchDocument(text, { maxUnitChars: 12000 }).units, ...rosters(itemRoster), patchVersion: '9.7', sourceUrl: 'https://example.test', extractedAt: T }));
const byName = (ds, name) => ds.changes.filter((c) => c.entity && c.entity.name === name);
const QUEST_PAGE = `# Wild Rift Patch Notes 9.7

## ITEM ADJUSTMENTS

### Relic Shield

- Health: 30 → 50

### Bulwark of the Mountain

- Shield: 120 → 140
- Health: 300 → 350

### Spectral Sickle

- Ability Power: 10 → 15

### Black Mist Scythe

- Bonus Damage: 40 → 50

### Sickle

- Damage: 5 → 6

### Relic Shield / Bulwark of the Mountain

- Gold per execute: 20 → 25
`;

// ======================================================================================================================
console.log('\n=== 1. Data model: four separate canonical records; upgrades related, never merged ===');
{
  check('QUEST_ITEMS holds exactly the four support quest items', JSON.stringify(QUEST_ITEMS.map((i) => i.id)) === JSON.stringify(QUEST_IDS));
  check('ids are unique across ALL_ITEMS (= ITEMS + QUEST_ITEMS)', new Set(ALL_ITEMS.map((i) => i.id)).size === ALL_ITEMS.length && ALL_ITEMS.length === ITEMS.length + 4);
  check('Bulwark of the Mountain upgradeOf "relic-shield"; Black Mist Scythe upgradeOf "spectral-sickle"', QUEST_ITEMS.find((i) => i.id === 'bulwark-of-the-mountain').upgradeOf === 'relic-shield' && QUEST_ITEMS.find((i) => i.id === 'black-mist-scythe').upgradeOf === 'spectral-sickle');
  check('every upgradeOf points at a base quest item; base items have no upgradeOf', QUEST_ITEMS.filter((i) => i.upgradeOf).every((i) => QUEST_ITEMS.some((b) => b.id === i.upgradeOf && !b.upgradeOf)) && QUEST_ITEMS.filter((i) => !i.upgradeOf).length === 2);
  check('each has its own name and its own info (no shared record)', new Set(QUEST_ITEMS.map((i) => i.name)).size === 4 && new Set(QUEST_ITEMS.map((i) => i.info)).size === 4);
  check('category "Support" and tier "Unranked" -- both mapped in the display registries (icon + color + tier row)', QUEST_ITEMS.every((i) => i.category === 'Support' && i.tier === 'Unranked'));
}

// ======================================================================================================================
console.log('\n=== 2. Where they appear -- and where they deliberately do NOT ===');
{
  check('NOT in ITEMS (so not on the Item Tier List, not in the Home "Items Tracked" count, not in any ITEMS consumer)', QUEST_IDS.every((id) => !ITEMS.some((i) => i.id === id)));
  const app = read('src/App.jsx');
  check('App: the Item Tier List is still fed from ITEMS only; Patch Notes and Admin get ALL_ITEMS', /const items = useMemo\(\(\) => ITEMS\.map/.test(app) && /<ItemTierListPage items=\{items\}/.test(app) && /<PatchNotesPage [^>]*items=\{allItems\}/.test(app) && /<AdminPage [^>]*items=\{allItems\}/.test(app));
  check('Home page "Items Tracked" still counts ITEMS', /ITEMS\.length/.test(read('src/pages/HomePage.jsx')) && !/ALL_ITEMS/.test(read('src/pages/HomePage.jsx')));
  check('build picker (Coach Mode): Relic Shield + Spectral Sickle offered; the upgraded forms never', BUILDABLE_ITEMS.some((i) => i.id === 'relic-shield') && BUILDABLE_ITEMS.some((i) => i.id === 'spectral-sickle') && !BUILDABLE_ITEMS.some((i) => i.upgradeOf) && /BUILDABLE_ITEMS/.test(read('src/components/BuildEditor.jsx')));
  check('opt-in consumers use ALL_ITEMS: Patch Notes detection, admin + public Patch Notes, links catalog, AI Coach, build chip images',
    ['functions/api/admin/patch-check.js', 'functions/api/admin/patch-reports.js', 'functions/api/patch-reports.js', 'functions/_lib/patchClassificationRules.js', 'functions/api/coach.js', 'src/components/BuildBoard.jsx'].every((f) => /ALL_ITEMS/.test(read(f)) && !/import \{ ITEMS \}/.test(read(f))));
  const names = [...new Set(CHAMPIONS.flatMap((c) => [...(c.items || []), ...((c.builds || []).flatMap((b) => b.items || []))]).map((e) => e.name))];
  const changed = names.filter((n) => findCanonicalId(n, ITEMS) !== findCanonicalId(n, ALL_ITEMS));
  check(`build chips: all ${names.length} written item names resolve to the SAME image id as before (Relic Shield / Spectral Sickle already guessed their id)`, changed.length === 0, changed);
  check('...and "Relic Shield" / "spectral sickle" now resolve to a REAL record instead of a guess', findCanonicalId('Relic Shield', ALL_ITEMS) === 'relic-shield' && ALL_ITEMS.some((i) => i.id === findCanonicalId('spectral sickle', ALL_ITEMS)));
  const ai = detectItemsAndRunes('should i buy relic shield or spectral sickle, and when does bulwark of the mountain kick in?', ALL_ITEMS, RUNES).itemIds;
  check('AI Coach: grounds Relic Shield, Spectral Sickle and Bulwark of the Mountain as separate items', ['relic-shield', 'spectral-sickle', 'bulwark-of-the-mountain'].every((id) => ai.includes(id)), ai);
  check('AI Coach: the generic word "black" does not pull in Black Mist Scythe; its full name does', !detectItemsAndRunes('black ward placement', ALL_ITEMS, RUNES).itemIds.includes('black-mist-scythe') && detectItemsAndRunes('is black mist scythe good?', ALL_ITEMS, RUNES).itemIds.includes('black-mist-scythe'));
}

// ======================================================================================================================
console.log('\n=== 3. REGRESSION: Bulwark of the Mountain and Black Mist Scythe are matched -- as THEMSELVES ===');
{
  const ds = build(QUEST_PAGE);
  const st = (name) => byName(ds, name).map((c) => `${c.entity.status}:${c.entity.id}`);
  check('Bulwark of the Mountain: EXISTING, its own id (both changes)', JSON.stringify(st('Bulwark of the Mountain')) === JSON.stringify(['EXISTING:bulwark-of-the-mountain', 'EXISTING:bulwark-of-the-mountain']));
  check('Black Mist Scythe: EXISTING, its own id', JSON.stringify(st('Black Mist Scythe')) === JSON.stringify(['EXISTING:black-mist-scythe']));
  check('Relic Shield and Spectral Sickle: EXISTING, their own ids', st('Relic Shield')[0] === 'EXISTING:relic-shield' && st('Spectral Sickle')[0] === 'EXISTING:spectral-sickle');
  check('no Bulwark change is attributed to Relic Shield, no Black Mist Scythe change to Spectral Sickle', byName(ds, 'Relic Shield').length === 1 && byName(ds, 'Spectral Sickle').length === 1);
  const sickle = ds.changes.find((c) => c.provenance.sourceHeading === 'Sickle');
  check('"Sickle" alone is NOT Spectral Sickle (no alias, no containment): Unmatched', sickle.entity.status === 'UNMATCHED' && sickle.entity.id === null);
  const combined = ds.changes.find((c) => /Relic Shield \/ Bulwark/.test(c.provenance.sourceHeading));
  check('a combined "Relic Shield / Bulwark of the Mountain" heading is NOT guessed onto either: Unmatched (and can be moved manually)', combined.entity.status === 'UNMATCHED');
  const items = deriveLegacyReport(ds, { itemRoster: ALL_ITEMS, mode: 'draft' }).itemChanges;
  check('four separate Patch Notes entries, each linked to its OWN record (upgradeOf never merges)', ['relic-shield', 'bulwark-of-the-mountain', 'spectral-sickle', 'black-mist-scythe'].every((id) => items.filter((e) => e.itemId === id).length === 1) && items.find((e) => e.itemId === 'bulwark-of-the-mountain').academyLink.id === 'bulwark-of-the-mountain');
  check('they are Academy items now: pending changes publish by default, like every catalogued item', byName(ds, 'Bulwark of the Mountain').every((c) => isChangePublishable(c, ds)) && deriveLegacyReport(ds, { itemRoster: ALL_ITEMS, mode: 'publish' }).itemChanges.some((e) => e.itemId === 'black-mist-scythe'));
  check('a remembered rule for the upgrade does not touch the base item (exact name + type)', (() => { const d = build(QUEST_PAGE, ITEMS); applyClassificationRules(d, { rules: [{ key: 'item:bulwarkofthemountain', type: 'item', name: 'Bulwark of the Mountain', status: 'IN_ACADEMY' }], available: true, catalog: academyCatalog(), now: T }); return effectiveClassification(byName(d, 'Relic Shield')[0], d).status === 'UNMATCHED' && effectiveClassification(byName(d, 'Bulwark of the Mountain')[0], d).status === 'IN_ACADEMY'; })());
}

// ======================================================================================================================
console.log('\n=== 4. Work done BEFORE the catalog knew them reconnects (Stage 1 identity + Stage 3 Coach fields + Stage 5 rules) ===');
{
  // the state a reviewer could have reached before Stage 6: Bulwark untracked, kept, Coach text written, remembered as In Academy
  const before = build(QUEST_PAGE, ITEMS);
  const bul0 = byName(before, 'Bulwark of the Mountain');
  applyReviewOps(before, [...bul0.map((c) => ({ op: 'keep', changeId: c.changeId })), { op: 'impactSection', sectionKey: sectionKeyOf(bul0[0]), changeImpact: 'HIGH' }], { now: T });
  applyClassificationRules(before, { rules: [{ key: 'item:bulwarkofthemountain', type: 'item', name: 'Bulwark of the Mountain', status: 'IN_ACADEMY' }], available: true, catalog: academyCatalog(), now: T });
  let stored = { patchNotes: before, ...mergeFreshOntoExisting(deriveLegacyReport(before, { itemRoster: ITEMS, mode: 'draft' }), {}) };
  stored.itemChanges = applyCoachFieldEdits(stored.itemChanges, stored.itemChanges.filter((e) => e.itemName === 'Bulwark of the Mountain').map((e) => ({ ...e, supportImpact: 'Rush the quest' })), 'itemId');
  check('setup: untracked Bulwark, kept, impact HIGH, remembered In Academy, Support impact written', bul0.every((c) => c.review.state === 'kept') && effectiveClassification(bul0[0], before).origin === 'rule' && stored.itemChanges.find((e) => e.itemName === 'Bulwark of the Mountain').supportImpact === 'Rush the quest');
  // a re-scan now that the catalog knows it
  const fresh = mergeReviewState(build(QUEST_PAGE, ALL_ITEMS), JSON.parse(JSON.stringify(before)));
  applyClassificationRules(fresh, { rules: [{ key: 'item:bulwarkofthemountain', type: 'item', name: 'Bulwark of the Mountain', status: 'IN_ACADEMY' }], available: true, catalog: academyCatalog(), now: T });
  const after = mergeFreshOntoExisting({ ...deriveLegacyReport(fresh, { itemRoster: ALL_ITEMS, mode: 'draft' }), patchNotes: fresh }, stored);
  const bul1 = byName(fresh, 'Bulwark of the Mountain');
  check('Bulwark is now matched automatically to its own record (new key, new change IDs)', bul1.every((c) => c.entity.status === 'EXISTING' && c.entity.id === 'bulwark-of-the-mountain') && bul1[0].changeId !== bul0[0].changeId);
  check('...its Keep decisions followed it (lineage recorded), nothing orphaned', bul1.every((c) => c.review.state === 'kept' && c.previousChangeIds && c.previousChangeIds.length === 1) && fresh.orphanedChanges.length === 0 && fresh.orphanedSectionReviews.length === 0);
  check('...its section review (impact HIGH) moved to the new section', fresh.sectionReview[sectionKeyOf(bul1[0])].changeImpact === 'HIGH');
  check('...its Support impact text followed it', after.itemChanges.find((e) => e.itemId === 'bulwark-of-the-mountain').supportImpact === 'Rush the quest');
  check('...the remembered rule is now redundant and no longer applied (automatic Academy match)', effectiveClassification(bul1[0], fresh).origin === 'auto' && !fresh.sectionReview[sectionKeyOf(bul1[0])].classification);
}

// ======================================================================================================================
console.log('\n=== 5. Images: existing art is reused for display WITHOUT merging identities ===');
{
  const bp = candidatePaths('i:bulwark-of-the-mountain'); const sp = candidatePaths('i:black-mist-scythe');
  check('Bulwark: its OWN file names are tried first (a dedicated image added later wins automatically)', bp[0] === '/assets/items/bulwark-of-the-mountain');
  check('...then Relic Shield\'s art, which exists on disk (Relic_Shield.webp)', bp.includes('/assets/items/Relic_Shield') && fs.existsSync(path.join(ROOT, 'public/assets/items/Relic_Shield.webp')) && bp.indexOf('/assets/items/Relic_Shield') > bp.indexOf('/assets/items/bulwark-of-the-mountain'));
  check('Black Mist Scythe: own names first, then Spectral Sickle\'s art (Spectral_Sickle.webp exists)', sp[0] === '/assets/items/black-mist-scythe' && sp.includes('/assets/items/Spectral_Sickle') && fs.existsSync(path.join(ROOT, 'public/assets/items/Spectral_Sickle.webp')));
  check('base items are unchanged: Relic Shield / Spectral Sickle never try an upgrade\'s file names', !candidatePaths('i:relic-shield').some((p) => /bulwark/i.test(p)) && !candidatePaths('i:spectral-sickle').some((p) => /scythe/i.test(p)));
  check('no ordinary item gets a fallback (every ITEMS key resolves only its own id + its own aliases)', ITEMS.every((i) => candidatePaths(`i:${i.id}`).every((p) => !/relic|sickle/i.test(p) || /relic|sickle/i.test(i.id))));
  check('identity is untouched by the image fallback: the name still resolves to the upgrade\'s OWN id', findCanonicalId('Bulwark of the Mountain', ALL_ITEMS) === 'bulwark-of-the-mountain' && findCanonicalId('Black Mist Scythe', ALL_ITEMS) === 'black-mist-scythe');
  check('the image fallback is declared on the record (display only), equal to its upgradeOf', QUEST_ITEMS.filter((i) => i.imageFallbackId).every((i) => i.imageFallbackId === i.upgradeOf));
}

// ======================================================================================================================
console.log('\n=== 6. End to end through the real handlers (fake KV): Check for New Patch -> In Academy -> public ===');
{
  const store = new Map();
  const kv = { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, String(v)); }, async delete(k) { store.delete(k); }, async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; } };
  await KVS.mutateOverrides(kv, { operation: 'seed', source: 'test', mutate: () => ({ champions: {}, items: {}, runes: {}, decisionTrees: {}, patch: '9.6', verifiedPatch: '9.6', patchStatus: null }) });
  const slug = 'wild-rift-patch-notes-9-7';
  await kv.put('riot-latest-patch-meta', JSON.stringify({ slug }));
  await kv.put(`riot-fallback-full-content:${slug}:${SOURCE_TEXT_VERSION}`, JSON.stringify({ content: QUEST_PAGE, truncated: false }));
  const env = { COACH_KV: kv, ADMIN_SESSION_SECRET: 'test-secret' };
  const cookie = `academy_admin_session=${await createSessionToken(env)}`;
  const det = await (await checkPost({ request: new Request('https://x/api/admin/patch-check', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ trigger: 'manual' }) }), env })).json();
  const rep = (await (await reportsGet({ request: new Request(`https://x/api/admin/patch-reports?id=${slug}`, { headers: { Cookie: cookie } }), env })).json()).report;
  const cls = (name) => effectiveClassification(byName(rep.patchNotes, name)[0], rep.patchNotes);
  check('Check for New Patch: Bulwark of the Mountain and Black Mist Scythe land In Academy automatically, linked to their own records', det.ok && cls('Bulwark of the Mountain').status === 'IN_ACADEMY' && cls('Bulwark of the Mountain').origin === 'auto' && cls('Black Mist Scythe').link.id === 'black-mist-scythe');
  check('...no remembered rule and no manual step was needed (rules store untouched)', !store.has(RULES_KEY));
  for (const action of ['approve', 'publish']) {
    const { onRequestPost } = await import('../functions/api/admin/patch-reports.js');
    await onRequestPost({ request: new Request('https://x/api/admin/patch-reports', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ id: slug, action }) }), env });
  }
  const pub = (await (await publicGet({ request: new Request('https://x/api/patch-reports'), env })).json()).reports.find((r) => r.id === slug);
  const pb = pub.itemChanges.find((e) => e.itemName === 'Bulwark of the Mountain');
  check('public Patch Notes: Bulwark of the Mountain listed under Items with its own id and Riot\'s description intact', pb && pb.itemId === 'bulwark-of-the-mountain' && JSON.stringify(pb.subsections.flatMap((s) => s.changes.map((c) => c.text))) === JSON.stringify(['Shield: 120 → 140', 'Health: 300 → 350']));
  check('...Black Mist Scythe and the two base items are separate public entries', ['black-mist-scythe', 'relic-shield', 'spectral-sickle'].every((id) => pub.itemChanges.filter((e) => e.itemId === id).length === 1));
  check('...the unmatched "Sickle" and the combined heading are NOT public (no Keep yet)', !pub.itemChanges.some((e) => e.itemName === 'Sickle' || /\//.test(e.itemName)));
}

done();
