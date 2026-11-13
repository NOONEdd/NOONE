// AI Coach x data quality -- an Academy record whose mechanical data is NOT verified (src/lib/dataQuality.js, `dataStatus:
// "unverified"`) must never be used by the AI Coach as evidence for a stat, number or effect, while staying fully available to
// everything that only needs its identity (Patch Notes, catalog, builds, images).
//
// Regression this guards: the four support quest items entered the canonical catalog with placeholder `info` text (upgrade
// relationship only). The word "Shield" in "Upgraded form of Relic Shield" satisfied the Coach's fact-keyword check for "how much
// shield does Bulwark of the Mountain provide?", so the Coach treated the placeholder as sufficient Academy evidence and stopped
// consulting Riot's patch notes.
//
//   node tests/coachDataQuality.test.mjs
//
// Runs the REAL /api/coach handler with fetch stubbed (the AI provider call is captured, never sent; Riot is either served from
// a seeded fake-KV cache or unreachable). No network, no production KV, nothing written to disk.

import { onRequestPost as coachPost } from '../functions/api/coach.js';
import { extractItemContext, extractRuneContext, extractUnverifiedEntities } from '../functions/_lib/extractItemRuneContext.js';
import { isAcademyDataSufficient, buildAcademyGroundedText } from '../functions/_lib/academyCoverage.js';
import { buildSystemPrompt } from '../functions/_lib/buildPrompt.js';
import { extractChampionContext } from '../functions/_lib/extractChampionContext.js';
import { detectItemsAndRunes } from '../functions/_lib/detectItemsRunes.js';
import { DATA_STATUS, dataStatusOf, hasVerifiedFacts } from '../src/lib/dataQuality.js';
import { ITEMS, QUEST_ITEMS, ALL_ITEMS, BUILDABLE_ITEMS } from '../src/data/items.js';
import { RUNES } from '../src/data/runes.js';
import { CHAMPIONS, isAcademyCovered } from '../src/data/champions.js';
import { candidatePaths, findCanonicalId } from '../src/utils/images.js';
import { parsePatchDocument } from '../functions/_lib/patchParser.js';
import { extractPatchNotes } from '../functions/_lib/patchNotesExtract.js';
import { resolveEffectiveItem } from '../src/lib/effectiveData.js';
import { makeChecker } from './helpers/patchNotesHelpers.mjs';
import fs from 'node:fs';

const { check, done } = makeChecker();
const QUEST_IDS = ['relic-shield', 'spectral-sickle', 'bulwark-of-the-mountain', 'black-mist-scythe'];
const PLACEHOLDER = /quest starter item|granted when the|A separate item: its patch changes/i; // the placeholder `info` wording
const NUMBER = /\d/;
const RIOT_TEXT = fs.readFileSync(new URL('./fixtures/riot-wild-rift-7-3a-champion-changes.txt', import.meta.url), 'utf8');

/** Calls the real handler; returns the system prompt that WOULD have been sent to the AI provider and the grounding log. */
async function ask(question, { riot = 'cached', overrides = null } = {}) {
  const store = new Map();
  if (riot === 'cached') { store.set('riot-latest-patch-meta', JSON.stringify({ slug: 'wild-rift-patch-notes-7-3a' })); store.set('riot-fallback-content:wild-rift-patch-notes-7-3a', JSON.stringify({ content: RIOT_TEXT })); }
  if (riot && riot.content) { store.set('riot-latest-patch-meta', JSON.stringify({ slug: 'wild-rift-patch-notes-9-9' })); store.set('riot-fallback-content:wild-rift-patch-notes-9-9', JSON.stringify({ content: riot.content })); }
  if (overrides) store.set('coach-overrides', JSON.stringify(overrides));
  const kv = { async get(k) { return store.has(k) ? store.get(k) : null; }, async put(k, v) { store.set(k, String(v)); }, async delete(k) { store.delete(k); } };
  let system = null; const logs = [];
  const realFetch = globalThis.fetch; const realLog = console.log;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.anthropic.com')) { system = JSON.parse(init.body).system; return new Response(JSON.stringify({ content: [{ type: 'text', text: 'stub' }], stop_reason: 'end_turn' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    return new Response('unreachable in test', { status: 503 });
  };
  console.log = (line) => { try { logs.push(JSON.parse(line)); } catch { /* not a structured log line */ } };
  try {
    const res = await coachPost({ request: new Request('https://x/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' }, body: JSON.stringify({ messages: [{ role: 'user', content: question }] }) }), env: { COACH_KV: kv, ANTHROPIC_API_KEY: 'test-dummy-key' } });
    return { status: res.status, system: system || '', grounding: logs.find((l) => l.stage === 'grounding') || {} };
  } finally { globalThis.fetch = realFetch; console.log = realLog; }
}
const factsSection = (s) => { const i = s.indexOf('Item data (facts'); return i < 0 ? '' : s.slice(i, s.indexOf('\n\n', i) < 0 ? undefined : s.indexOf('\n\n', i)); };
const unverifiedSection = (s) => { const i = s.indexOf('--- Recognized by Nyx NOONEdd Academy, but WITHOUT verified stats'); if (i < 0) return ''; const j = s.indexOf('\n---', i + 5); return s.slice(i, j < 0 ? undefined : j); };
const hasRiot = (s) => s.includes('--- Official Riot Wild Rift fallback (EXTERNAL');

// ======================================================================================================================
console.log('\n=== 1. Data quality is declared on the record, generically ===');
{
  check('all four support quest items are dataStatus "unverified"', QUEST_ITEMS.every((i) => QUEST_IDS.includes(i.id) && dataStatusOf(i) === DATA_STATUS.UNVERIFIED));
  check('every other champion / item / rune record is verified (no field = verified; existing data untouched)', [...ITEMS, ...RUNES, ...CHAMPIONS].every((r) => r.dataStatus === undefined && hasVerifiedFacts(r)));
  check('the only value the data uses is "unverified" (no typo silently meaning "verified")', [...ALL_ITEMS, ...RUNES, ...CHAMPIONS].every((r) => r.dataStatus === undefined || r.dataStatus === DATA_STATUS.UNVERIFIED));
  check('records without the field, null and undefined are verified; only the exact value marks unverified', hasVerifiedFacts({}) && hasVerifiedFacts(null) && !hasVerifiedFacts({ dataStatus: 'unverified' }) && hasVerifiedFacts({ dataStatus: 'Unverified ' }) === true);
}

// ======================================================================================================================
console.log('\n=== 2. The Coach\'s evidence selection: unverified text is never a fact, verified items are unchanged ===');
{
  const fmt = (i) => `${i.name} (${i.category}, tier ${i.tier}): ${i.info}`;
  check(`extractItemContext: every verified item (${ITEMS.length}) still formatted exactly as before`, ITEMS.every((i) => JSON.stringify(extractItemContext([i.id], ALL_ITEMS, { items: {} })) === JSON.stringify([fmt(resolveEffectiveItem(i, undefined))])));
  check(`extractRuneContext: every rune (${RUNES.length}) unchanged`, RUNES.every((r) => extractRuneContext([r.id], RUNES, { runes: {} }).length === 1));
  check('extractItemContext: the four unverified items produce NO fact lines', extractItemContext(QUEST_IDS, ALL_ITEMS, { items: {} }).length === 0);
  check('...not even when a Coach Mode override gives them text (verification is a reviewed data change, not an override)', extractItemContext(['bulwark-of-the-mountain'], ALL_ITEMS, { items: { 'bulwark-of-the-mountain': { info: 'Shield 999' } } }).length === 0);
  const un = extractUnverifiedEntities(QUEST_IDS, ALL_ITEMS, 'item');
  const rel = (id) => un.find((e) => e.id === id).relationships.join(' | ');
  check('extractUnverifiedEntities: identity + STRUCTURED relationships, in both directions', rel('bulwark-of-the-mountain') === 'upgraded form of Relic Shield' && rel('relic-shield') === 'upgrades into Bulwark of the Mountain' && rel('black-mist-scythe') === 'upgraded form of Spectral Sickle' && rel('spectral-sickle') === 'upgrades into Black Mist Scythe');
  check('...and never any descriptive text or number', un.every((e) => Object.keys(e).sort().join() === 'id,name,relationships,type' && !PLACEHOLDER.test(JSON.stringify(e)) && !NUMBER.test(JSON.stringify(e))));
  check('...verified records are never listed as unverified', extractUnverifiedEntities(ITEMS.map((i) => i.id), ALL_ITEMS, 'item').length === 0);
  const grounded = buildAcademyGroundedText({ itemContext: extractItemContext(['bulwark-of-the-mountain'], ALL_ITEMS, {}) });
  check('THE REGRESSION: the placeholder ("...Relic Shield...") can no longer satisfy the "shield" fact check -- it is not in the grounded text', !/shield/i.test(grounded));
  const q = 'How much shield does Bulwark of the Mountain provide?';
  check('...and a referenced unverified entity makes Academy INSUFFICIENT (Riot fallback eligible), whatever else is grounded', isAcademyDataSufficient(q, true, 'shield shield shield', { unverifiedEntities: [{ name: 'x' }] }) === false);
  const battery = [['When should I buy Locket?', true, 'x'], ["What's Redemption's cooldown?", true, 'cooldown 60s'], ['how much heal?', true, 'no'], ['hello', false, ''], ['what changed in the patch', true, 'x'], ["what does lulu's w do", true, 'x']];
  check('isAcademyDataSufficient is unchanged for every call without unverified entities (with and without the new argument)', battery.every(([qq, g, t]) => isAcademyDataSufficient(qq, g, t) === isAcademyDataSufficient(qq, g, t, { unverifiedEntities: [] })));
  const lulu = extractChampionContext('lulu', CHAMPIONS, { champions: {} });
  const sample = { championContext: lulu, itemContext: extractItemContext(['redemption'], ALL_ITEMS, {}), runeContext: [], effectivePatch: '9.9', patchDataStatus: 'verified' };
  check('buildSystemPrompt is byte-identical with an empty unverified list (the new section is inert for verified data)', buildSystemPrompt(sample) === buildSystemPrompt({ ...sample, unverifiedEntities: [] }) && buildSystemPrompt({ effectivePatch: '9.9' }) === buildSystemPrompt({ effectivePatch: '9.9', unverifiedEntities: [] }));
}

// ======================================================================================================================
console.log('\n=== 3. End to end (real /api/coach, Riot patch notes reachable from cache): the four quest items ===');
const QUESTIONS = [
  ['How much shield does Bulwark of the Mountain provide?', 'Bulwark of the Mountain', 'upgraded form of Relic Shield'],
  ['What are the stats of Black Mist Scythe?', 'Black Mist Scythe', 'upgraded form of Spectral Sickle'],
  ['What does Relic Shield provide?', 'Relic Shield', 'upgrades into Bulwark of the Mountain'],
  ['What does Spectral Sickle provide?', 'Spectral Sickle', 'upgrades into Black Mist Scythe'],
];
for (const [q, name, relation] of QUESTIONS) {
  const r = await ask(q);
  const u = unverifiedSection(r.system);
  check(`"${q}" -> 200; the placeholder text appears NOWHERE in what the AI receives`, r.status === 200 && !PLACEHOLDER.test(r.system));
  check('...not listed under "Item data (facts...)"', !factsSection(r.system).includes(name));
  check(`...listed in the "WITHOUT verified stats or effects" section with its structured relationship ("${relation}") and no number`, u.includes(`- ${name} (item): ${relation}`) && !NUMBER.test(u.split('\n').filter((l) => l.startsWith('- ')).join('\n')));
  check('...the rule forbids numbers / stats / effects unless Riot states them, then explicit uncertainty + tooltip + Coaching page', /never state a number, stat, value or mechanical effect/.test(u) && /only where it explicitly states it/.test(u) && /verified data for it isn't available yet/.test(u) && /Coaching page/.test(u));
  check('...Academy treated as insufficient: the authoritative Riot source is consulted (it was NOT for Bulwark / Relic Shield before the fix)', hasRiot(r.system) && r.grounding.academySufficient === false && r.grounding.riotFallbackUsed === true);
  check('...the grounding log names the unverified entity', (r.grounding.unverifiedEntities || []).includes(ALL_ITEMS.find((i) => i.name === name).id));
}

console.log('\n=== 4. Riot source unreachable: explicit uncertainty, never an invented number ===');
{
  const r = await ask('How much shield does Bulwark of the Mountain provide?', { riot: null });
  check('no Riot section (the source could not be reached) -- and the unverified section with its uncertainty rule is still there', !hasRiot(r.system) && /verified data for it isn't available yet/.test(unverifiedSection(r.system)) && r.grounding.riotFallbackUsed === false);
  check('...and Academy did not pretend to be sufficient', r.grounding.academySufficient === false);
  const r2 = await ask('How much shield does Bulwark of the Mountain provide?', { riot: { content: 'Bulwark of the Mountain\n- Shield: 120 -> 140' } });
  check('Riot DOES state the value: its section is provided so the answer can cite Riot (Academy -> Riot -> uncertainty)', hasRiot(r2.system) && r2.system.includes('Bulwark of the Mountain\n- Shield: 120 -> 140'));
}

console.log('\n=== 5. Mixed questions and existing Coach behaviour ===');
{
  const mixed = await ask('How much shield does Bulwark of the Mountain give on Lulu?');
  check('with a champion grounded too: Lulu\'s Academy coaching is still provided, Bulwark is still unverified, Riot consulted', mixed.system.includes('Champion: Lulu') && unverifiedSection(mixed.system).includes('- Bulwark of the Mountain (item)') && hasRiot(mixed.system) && !PLACEHOLDER.test(mixed.system));
  const both = await ask('Is Black Mist Scythe better than Bulwark of the Mountain for Senna?');
  check('two unverified items in one question: both listed, no placeholder', ['Black Mist Scythe', 'Bulwark of the Mountain'].every((n) => unverifiedSection(both.system).includes(`- ${n} (item)`)) && !PLACEHOLDER.test(both.system));
  const w = await ask("How much health does Warmog's Armor give?");
  check('a fully documented item (Warmog\'s Armor): its verified info is a fact line, Academy sufficient, no Riot, no unverified section', factsSection(w.system).includes("Warmog's Armor (Defense") && w.grounding.academySufficient === true && !hasRiot(w.system) && !unverifiedSection(w.system));
  const l = await ask('When should I buy Locket instead of Redemption?');
  check('a coaching question about verified items: unchanged (both fact lines, no Riot, no unverified section)', factsSection(l.system).includes('Locket of the Iron Solari') && factsSection(l.system).includes('Redemption') && !hasRiot(l.system) && !unverifiedSection(l.system));
  const ab = await ask("What does Lulu's W do?");
  check('ability-detail and patch-change questions keep their existing behaviour (Riot consulted, ability reminder)', hasRiot(ab.system) && /Reminder: this question asks about a specific ability/.test(ab.system) && !unverifiedSection(ab.system));
  check('detection still RECOGNISES the quest items (the Coach knows what the player is asking about)', QUEST_IDS.every((id) => detectItemsAndRunes(`tell me about ${ALL_ITEMS.find((i) => i.id === id).name}`, ALL_ITEMS, RUNES).itemIds.includes(id)));
}

// ======================================================================================================================
console.log('\n=== 6. Everything that only needs identity is unaffected ===');
{
  check('Academy catalog: the four records stay in ALL_ITEMS with their ids, names and upgradeOf relationships', QUEST_IDS.every((id) => ALL_ITEMS.some((i) => i.id === id)) && ALL_ITEMS.find((i) => i.id === 'bulwark-of-the-mountain').upgradeOf === 'relic-shield');
  check('Item Tier List source (ITEMS): unchanged -- 84 records, none of the quest items', ITEMS.length === 84 && QUEST_IDS.every((id) => !ITEMS.some((i) => i.id === id)));
  check('build picker still offers Relic Shield + Spectral Sickle, never the upgraded forms', ['relic-shield', 'spectral-sickle'].every((id) => BUILDABLE_ITEMS.some((i) => i.id === id)) && !BUILDABLE_ITEMS.some((i) => i.upgradeOf));
  check('existing Build entries still resolve their images ("Relic Shield", "spectral sickle")', findCanonicalId('Relic Shield', ALL_ITEMS) === 'relic-shield' && candidatePaths('i:relic-shield').includes('/assets/items/Relic_Shield'));
  check('image fallback for upgraded forms unchanged', candidatePaths('i:bulwark-of-the-mountain').includes('/assets/items/Relic_Shield'));
  const ds = extractPatchNotes({ units: parsePatchDocument('# T\n## ITEM ADJUSTMENTS\n### Bulwark of the Mountain\n- Shield: 120 → 140\n', { maxUnitChars: 12000 }).units, championRoster: CHAMPIONS.filter(isAcademyCovered), itemRoster: ALL_ITEMS, runeRoster: RUNES, patchVersion: '9.9' });
  check('Patch Notes matching: Bulwark of the Mountain is still matched to its own record', ds.changes[0].entity.status === 'EXISTING' && ds.changes[0].entity.id === 'bulwark-of-the-mountain');
}

done();
