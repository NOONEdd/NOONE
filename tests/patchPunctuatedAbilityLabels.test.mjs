// Patch Notes -- ability headings that END IN PUNCTUATION ("You and Me!"): the exact Yuumi 7.3a failure, the generic rule behind the fix,
// and the guarantee that existing reviews survive it. Plain Node ESM against the REAL parser, extractor, pipeline and handlers
// (mock KV, no network, no AI, no production data). Run directly:
//
//   node tests/patchPunctuatedAbilityLabels.test.mjs
//
// THE FAILURE, reproduced on Riot's real Wild Rift 7.3a page (tests/fixtures/riot-wild-rift-7-3a-champion-changes.txt is that page's
// champion section, verbatim):
//
//     YUUMI
//     Yuumi benefits more than intended from the recent support item changes ... to compensate.
//     You and Me!
//     - Healing and Shield Power: 8%/9%/10%/11% + 0.02% Ability Power → 6%/7%/8%/9% + 0.01%a Ability Power
//
//   The change was extracted correctly, but the line "You and Me!" never became a label: patchChangeDetector.isLabelLine() (and the
//   parser's isLabelLike()) rejected EVERY line ending in . ! or ? as "a sentence". So change.subsection was null, Riot's heading
//   existed nowhere in the dataset, and the public page / ability-icon lookup had nothing to key on. Not Yuumi data, not the icon system:
//   one over-broad sentence heuristic. The fix is generic (patchLabelShape.js): a TITLE-SHAPED line ending in ! or ? that sits directly
//   above a list of changes is an ability name.
//
//   Fixtures generated with the PRE-fix rule on this same tree (nothing hand-edited):
//     riot-7-3a-champion-rows-before-fix.json            every change of the section: entity, status, subsection, stat, state, changeId
//     kv-state-7-3a-before-ability-label-fix.json        the stored patch-intel:* KV state the pre-fix engine wrote for it (revision 1)
//
//   1  exact failure   before-the-fix facts pinned, then every Yuumi field after the fix; all other Yuumi data unchanged
//   2  no collateral   the other 37 changes of the real section are identical before/after (ability, stat, state, changeId, facts)
//   3  generic rule    the same structure for other champions / abilities, and the title-shape rule itself
//   4  prose is prose  sentences ending in ! or ?, title-cased lines that do not introduce a list, "." endings
//   5  public + icon   the public subsection, the rendered heading, a successful icon lookup from RIOT'S heading (never the Admin's display
//                      edit, never Q/W/E/R); the naming convention is unchanged
//   6  review survives stored pre-fix state -> rescan through the real handlers: note / classification / edit / removal follow the change to
//                      its new ID, nothing is orphaned, revision 1 is untouched, no KV key outside patch-intel:* is written
//   7  identity bridge only one-to-one, same scope + same source path + same exact source fingerprint; any ambiguity never guesses

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestPost as checkPost } from '../functions/api/admin/patch-check.js';
import { onRequestGet as adminGet, onRequestPost as reportsPost } from '../functions/api/admin/patch-reports.js';
import { onRequestGet as publicGet } from '../functions/api/patch-reports.js';
import { createSessionToken } from '../functions/_lib/adminAuth.js';
import { SOURCE_TEXT_VERSION } from '../functions/_lib/patchText.js';
import { runPatchIntelAnalysis, PATCH_INTEL_ENGINE_VERSION } from '../functions/_lib/patchIntelPipeline.js';
import { parsePatchDocument } from '../functions/_lib/patchParser.js';
import { extractStructuredChanges } from '../functions/_lib/patchChangeDetector.js';
import { isPunctuatedTitleLabel } from '../functions/_lib/patchLabelShape.js';
import { applyReviewOps, mergeReviewState, subsectionKeyOf } from '../functions/_lib/patchNotesReview.js';
import { toPublicView } from '../functions/_lib/patchNotesPublic.js';
import { createAbilityIconResolver, abilitySlug } from '../src/lib/abilityIcons.js';
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
const ROWS_BEFORE = JSON.parse(fixture('riot-7-3a-champion-rows-before-fix.json')); // [entity, status, subsection, stat, comparisonState, changeId]
const KV_BEFORE = JSON.parse(fixture('kv-state-7-3a-before-ability-label-fix.json'));
const SLUG = 'wild-rift-patch-notes-7-3a';
const YUUMI_ID_BEFORE = 'pn_918e58911c45ee27'; // Yuumi's change ID while the label was not recognised (ability = null in its identity)
const YUUMI_ID_AFTER = 'pn_3280ab3639b4711c';  // the same change once "You and Me!" is its ability (ability = "You and Me!")
const YUUMI_BULLET = '- Healing and Shield Power: 8%/9%/10%/11% + 0.02% Ability Power → 6%/7%/8%/9% + 0.01%a Ability Power';

const fetchCalls = [];
globalThis.fetch = async (url) => { fetchCalls.push(String(url)); throw new Error('unexpected network call: ' + url); };

// production rosters, built exactly like functions/api/admin/patch-check.js
const rosters = () => ({
  championRoster: CHAMPIONS.filter(isAcademyCovered).map((c) => resolveEffectiveChampion(c, undefined, MATCHUPS[c.id])),
  itemRoster: ITEMS.map((i) => resolveEffectiveItem(i, undefined)), runeRoster: RUNES.map((r) => resolveEffectiveRune(r, undefined)),
});
const analyze = (text, previousPatchNotes = null) => runPatchIntelAnalysis({ patchContent: text, ...rosters(), patchVersion: '7.3a', previousPatchNotes });
const yuumiOf = (dataset) => dataset.changes.find((c) => c.entity && c.entity.name === 'Yuumi');
const row = (c) => [c.entity ? c.entity.name : 'SYS', c.entity ? c.entity.status : '', c.subsection ? c.subsection.sourceHeading : null, c.normalizedData.stat || c.normalizedData.effect, c.comparisonState, c.changeId];
const swap = (text, from, to) => { if (!text.includes(from)) throw new Error('fixture does not contain: ' + from); return text.replace(from, to); };

// =======================================================================================================================
console.log('\n=== 1. THE EXACT YUUMI FAILURE ===');
const after = await analyze(REAL_TEXT);
const D = after.patchNotes;
const yuumi = yuumiOf(D);
{
  const beforeRow = ROWS_BEFORE.find((r) => r[0] === 'Yuumi');
  check('BEFORE the fix (golden rows from the old rule): Yuumi\'s change existed with the right stat but NO subsection, under ID ' + YUUMI_ID_BEFORE, beforeRow && beforeRow[2] === null && beforeRow[3] === 'Healing and Shield Power' && beforeRow[5] === YUUMI_ID_BEFORE, beforeRow);
  const storedBefore = yuumiOf(JSON.parse(KV_BEFORE[`patch-intel:report:${SLUG}:1`]).patchNotes);
  check('BEFORE the fix (what the old engine stored in KV): subsection null AND normalizedData.ability null -- Riot\'s heading was nowhere in the dataset', storedBefore.subsection === null && storedBefore.normalizedData.ability === null && storedBefore.changeId === YUUMI_ID_BEFORE);
  check('the source structure is a normal one: a bullet list under a label line, exactly like every other champion in the same section (control: without the "!" the SAME text yields the label)', extractStructuredChanges(`You and Me\n\n${YUUMI_BULLET}`, {})[0].ability === 'You and Me');

  check('AFTER the fix: change.subsection.sourceHeading is the exact Riot heading "You and Me!" (non-empty), origin "label"', yuumi.subsection && yuumi.subsection.sourceHeading === 'You and Me!' && yuumi.subsection.origin === 'label', yuumi.subsection);
  check('AFTER: the normalized ability and the exact label line carry the same Riot wording; NO slot (no Q/W/E/R) and no group were inferred', yuumi.normalizedData.ability === 'You and Me!' && yuumi.normalizedData.slot === null && yuumi.normalizedData.group === null && !/"slot":"[QWEPR]/.test(JSON.stringify(yuumi)));
  check('AFTER: stable changeId = ' + YUUMI_ID_AFTER + ' (deterministic: same text, same ID, every run)', yuumi.changeId === YUUMI_ID_AFTER && yuumiOf((await analyze(REAL_TEXT)).patchNotes).changeId === YUUMI_ID_AFTER, yuumi.changeId);
  const reworded = yuumiOf((await analyze(swap(REAL_TEXT, 'Yuumi benefits more than intended', 'Yuumi benefits a bit more than intended'))).patchNotes);
  const reordered = yuumiOf((await analyze(`${REAL_TEXT.split('## CHAMPION CHANGES')[0]}## CHAMPION CHANGES\n\n${REAL_TEXT.slice(REAL_TEXT.indexOf('YUUMI'), REAL_TEXT.indexOf('VIEGO'))}${REAL_TEXT.slice(REAL_TEXT.indexOf('HWEI'), REAL_TEXT.indexOf('YUUMI'))}`)).patchNotes);
  const withExtra = yuumiOf((await analyze(swap(REAL_TEXT, 'HWEI\n', 'LULU\n\nLulu got a tweak.\n\nWhimsy\n\n- Cooldown: 14 → 12\n\nHWEI\n'))).patchNotes);
  const edited = JSON.parse(JSON.stringify(D)); const ey = yuumiOf(edited);
  applyReviewOps(edited, [{ op: 'edit', changeId: ey.changeId, displayText: 'Less sustain.', reviewerNote: 'n' }, { op: 'classify', changeId: ey.changeId, comparisonState: 'NERF' }, { op: 'editSubsectionTitle', subsectionKey: subsectionKeyOf(ey), displayHeading: 'Friend zone' }]);
  check('AFTER: the ID does not depend on edits or on unrelated text -- a reworded intro sentence, a different champion order, a new champion block above her, and every kind of review edit all leave it alone', [reworded, reordered, withExtra, ey].every((c) => c && c.changeId === YUUMI_ID_AFTER), [reworded, reordered, withExtra, ey].map((c) => c && c.changeId));

  // every other fact about the change is exactly what it was before the fix
  const storedBeforeFacts = storedBefore;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check('normalized facts unchanged: stat "Healing and Shield Power", old / new values exactly as Riot wrote them (incl. its own "0.01%a" typo -- never "fixed")', yuumi.normalizedData.stat === 'Healing and Shield Power' && yuumi.normalizedData.oldValue === '8%/9%/10%/11% + 0.02% Ability Power' && yuumi.normalizedData.newValue === '6%/7%/8%/9% + 0.01%a Ability Power' && yuumi.normalizedData.changeType === 'expression');
  check('every normalizedData field except `ability` is identical to what the old engine stored', same({ ...storedBeforeFacts.normalizedData, ability: 'You and Me!' }, yuumi.normalizedData), [storedBeforeFacts.normalizedData, yuumi.normalizedData]);
  check('originalSourceText is the untouched Riot bullet and is byte-identical to before; so is the source fingerprint (the thing the review bridge relies on)', yuumi.originalSourceText === YUUMI_BULLET && storedBeforeFacts.originalSourceText === YUUMI_BULLET && yuumi.provenance.sourceFingerprint === storedBeforeFacts.provenance.sourceFingerprint);
  check('ownership, entity, comparison state and source position are unchanged (Yuumi / EXISTING / entity_heading / ADJUSTED / same block + line)', same(yuumi.entity, storedBeforeFacts.entity) && same(yuumi.ownership, storedBeforeFacts.ownership) && yuumi.comparisonState === storedBeforeFacts.comparisonState && yuumi.provenance.sourceBlockIndex === storedBeforeFacts.provenance.sourceBlockIndex && yuumi.provenance.sourceLineIndex === storedBeforeFacts.provenance.sourceLineIndex && yuumi.provenance.sourcePath === storedBeforeFacts.provenance.sourcePath);
  check('display defaults: title "Yuumi — You and Me!", body without the repeated heading', yuumi.displayDefaults.displayTitle === 'Yuumi — You and Me!' && yuumi.displayDefaults.displayBody === 'Healing and Shield Power: 8%/9%/10%/11% + 0.02% Ability Power → 6%/7%/8%/9% + 0.01%a Ability Power');
  check('validation: 0 dropped blocks, 0 false-ownership changes, the "You and Me!" line is accounted for inside its block', D.validation.droppedBlocks === 0 && D.validation.falseOwnership.count === 0 && D.blocks.some((b) => b.changeIds.includes(yuumi.changeId) && b.originalSourceText.includes('You and Me!')));
  check('the engine version records the rule change (detect-v4, parse-v3) so a stored report can be told apart from one extracted with the old rule', /parse-v3/.test(PATCH_INTEL_ENGINE_VERSION) && /detect-v4/.test(PATCH_INTEL_ENGINE_VERSION), PATCH_INTEL_ENGINE_VERSION);
}

// =======================================================================================================================
console.log('\n=== 2. NO COLLATERAL CHANGE: the rest of the real 7.3a champion section is untouched ===');
{
  const rowsAfter = D.changes.map(row);
  check('same number of changes (38) before and after', ROWS_BEFORE.length === 38 && rowsAfter.length === 38);
  const diffs = rowsAfter.map((r, i) => [ROWS_BEFORE[i], r]).filter(([a, b]) => JSON.stringify(a) !== JSON.stringify(b));
  check('EXACTLY ONE of the 38 rows differs (Yuumi), and only in its subsection and its changeId', diffs.length === 1 && diffs[0][0][0] === 'Yuumi' && diffs[0][0][2] === null && diffs[0][1][2] === 'You and Me!' && diffs[0][0].slice(0, 2).join() === diffs[0][1].slice(0, 2).join() && diffs[0][0][3] === diffs[0][1][3] && diffs[0][0][4] === diffs[0][1][4], diffs);
  const storedBefore = JSON.parse(KV_BEFORE[`patch-intel:report:${SLUG}:1`]).patchNotes;
  const others = D.changes.filter((c) => !(c.entity && c.entity.name === 'Yuumi'));
  check('all 37 other changes: normalized facts, original source text, ownership and state are deep-equal to what the old engine stored', others.every((c) => { const p = storedBefore.changes.find((x) => x.changeId === c.changeId); return p && JSON.stringify([p.normalizedData, p.originalSourceText, p.ownership, p.entity, p.comparisonState, p.subsection]) === JSON.stringify([c.normalizedData, c.originalSourceText, c.ownership, c.entity, c.comparisonState, c.subsection]); }));
  check('the real page\'s other punctuation-bearing headings are unchanged ("Subject: Disaster - Devastating Fire" keeps Riot\'s own "Subject:" prefix; "Base Stats" blocks keep their label)', D.changes.filter((c) => c.entity.name === 'Hwei').map((c) => c.subsection.sourceHeading).join('|') === 'Signature of the Visionary|Subject: Disaster - Devastating Fire|Subject: Disaster - Severing Bolt|Spiraling Despair');
  const nonYuumiBlocks = D.blocks.length === storedBefore.blocks.length;
  check('block accounting is unchanged (same number of blocks, 0 dropped)', nonYuumiBlocks && D.validation.droppedBlocks === storedBefore.validation.droppedBlocks);
}

// =======================================================================================================================
console.log('\n=== 3. THE SAME RULE, OTHER CHAMPIONS AND ABILITIES ===');
{
  const ROSTER = { championRoster: [{ id: 'lulu', name: 'Lulu', tier: 'A' }, { id: 'zoe', name: 'Zoe', tier: 'B' }, { id: 'jayce', name: 'Jayce', tier: 'B' }] , itemRoster: [{ id: 'edge-of-night', name: 'Edge of Night', info: '' }] };
  const heads = (text) => extract(text, { rosters: ROSTER }).changes.map((c) => [c.entity.name, c.entity.status, c.subsection ? c.subsection.sourceHeading : null, c.normalizedData.stat]);

  const lulu = heads(`## CHAMPION ADJUSTMENTS\n\n### Lulu\n\nHelp, Pix!\n\n- Shield: 80 → 90\n- Cooldown: 14 → 12\n\nWhimsy\n\n- Damage: 70 → 60\n`);
  check('"Help, Pix!" (a comma and a "!") is a subsection of Lulu; both of its changes group under it; the ordinary label after it still works', JSON.stringify(lulu) === JSON.stringify([['Lulu', 'EXISTING', 'Help, Pix!', 'Shield'], ['Lulu', 'EXISTING', 'Help, Pix!', 'Cooldown'], ['Lulu', 'EXISTING', 'Whimsy', 'Damage']]), lulu);
  const zoe = heads(`## CHAMPION ADJUSTMENTS\n\n### Zoe\n\nPaddle Star!\n\n- Damage: 50 → 40\n`);
  check('"Paddle Star!" under Zoe', JSON.stringify(zoe) === JSON.stringify([['Zoe', 'EXISTING', 'Paddle Star!', 'Damage']]), zoe);
  const jayce = heads(`## CHAMPION ADJUSTMENTS\n\n### Jayce\n\nTo the Skies!\n\n- Cooldown: 14 → 12\n`);
  check('"To the Skies!" (small joining words in the middle) under Jayce', jayce[0][2] === 'To the Skies!', jayce);
  const q = heads(`## CHAMPION ADJUSTMENTS\n\n### Zoe\n\nQ - Paddle Star!\n\n- Damage: 50 → 40\n`);
  const qSub = extract(`## CHAMPION ADJUSTMENTS\n\n### Zoe\n\nQ - Paddle Star!\n\n- Damage: 50 → 40\n`, { rosters: ROSTER }).changes[0];
  check('when RIOT writes the slot ("Q - Paddle Star!") it is kept as Riot\'s heading and slot -- explicit notation only; the ability name is slot-free', q[0][2] === 'Q - Paddle Star!' && qSub.normalizedData.slot === 'Q' && qSub.normalizedData.ability === 'Paddle Star!');
  const question = heads(`## CHAMPION ADJUSTMENTS\n\n### Jayce\n\nWho Goes There?\n\n- Range: 500 → 550\n`);
  check('the same rule for a name ending in "?" (synthetic, to pin the rule)', question[0][2] === 'Who Goes There?', question);
  const item = heads(`## ITEM ADJUSTMENTS\n\n### Edge of Night\n\nSpell Shield!\n\n- Cooldown: 40 → 35\n`);
  check('the rule is not champion-specific: an item\'s punctuated effect name is a subsection too (synthetic)', item[0][0] === 'Edge of Night' && item[0][2] === 'Spell Shield!', item);
  const stacked = heads(`## CHAMPION ADJUSTMENTS\n\n### Lulu\n\nWhimsy\n\nHelp, Pix!\n\n- Shield: 80 → 90\n`);
  check('a punctuated label directly under another label keeps the same grouping behaviour as any label stack', stacked.length === 1 && stacked[0][2] === 'Help, Pix!', stacked);
  const headingStyle = heads(`## CHAMPION ADJUSTMENTS\n\n### Lulu\n\n#### Help, Pix!\n\n- Shield: 80 → 90\n`);
  check('heading-style documents ("#### Help, Pix!") already worked and still do', headingStyle[0][0] === 'Lulu' && headingStyle[0][2] === 'Help, Pix!', headingStyle);

  // the title-shape test itself
  const positives = ['You and Me!', 'Help, Pix!', 'Paddle Star!', 'To the Skies!', "Let's Bounce!", 'Who Goes There?', "Bop 'n' Block!", 'Stompy-Stomp!', 'Q - Paddle Star!', '**You and Me!**', 'Pocket Pistol!', 'R2 Fire!'];
  check('title-shaped names are accepted: ' + positives.join(' | '), positives.every(isPunctuatedTitleLabel), positives.filter((p) => !isPunctuatedTitleLabel(p)));
  const negatives = ["Let's get into it, everyone!", 'Enjoy the new patch!', "We're reducing her sustain to compensate.", 'You and Me.', 'You and Me', 'You and Me!!', 'Stop! Hammer Time!', 'Wow... Nice!', 'Yuumi Is Strong But Needs Some Help Now Please!', "it's ok!", '123!', '!', '', 'Is she strong or weak?  Maybe!', 'Buffs for everyone this week!'];
  check('sentences and non-titles are rejected: ' + negatives.filter(Boolean).join(' | '), negatives.every((n) => !isPunctuatedTitleLabel(n)), negatives.filter((n) => isPunctuatedTitleLabel(n)));

  // the structural half: it must sit directly above a list of changes
  const detect = (t) => extractStructuredChanges(t, {})[0];
  const BULLET = '- Shield: 80 → 90';
  check('directly above a bullet (blank line between them is fine): label', detect(`Help, Pix!\n\n${BULLET}`).ability === 'Help, Pix!' && detect(`Help, Pix!\n${BULLET}`).ability === 'Help, Pix!');
  check('above an INDENTED / numbered bullet: label', detect(`Help, Pix!\n\n  ${BULLET}`).ability === 'Help, Pix!' && detect(`Help, Pix!\n\n1. Shield: 80 → 90`).ability === 'Help, Pix!');
  check('NOT directly above a bullet (prose in between): not a label', detect(`Help, Pix!\n\nShe heals less now.\n\n${BULLET}`).ability === null);
  check('last line of the text / followed by another label: not a label', extractStructuredChanges('Help, Pix!', {}).length === 0 && detect(`Help, Pix!\n\nWhimsy\n\n${BULLET}`).ability === 'Whimsy');

  // parser: a punctuated label is treated EXACTLY like a plain one when an oversize unit has to be cut (same boundaries, line for line)
  const mkBig = (name) => `## CHAMPION ADJUSTMENTS\n\n### Lulu\n\nWhimsy\n- Damage: 70 → 60\n- Cooldown: 9 → 10\n${name}\n- Shield: 80 → 90\n- Cooldown: 14 → 12\nGlitterlance\n- Slow: 80% → 70%\n- Damage: 1 → 2\nWild Growth\n- Heal: 10 → 12\n`;
  const linesOf = (text) => parsePatchDocument(text, { maxUnitChars: 70 }).units.map((u) => String(u.text).split('\n').map((l) => l.trim()).filter(Boolean).join(' / ').replace('Help Pix', 'Help, Pix!'));
  const punct = linesOf(mkBig('Help, Pix!')); const plain = linesOf(mkBig('Help Pix'));
  check('oversize split (compact layout, where the parser\'s own label test picks the cut points): boundaries with "Help, Pix!" are line-for-line identical to the same text with a plain label', punct.length >= 3 && JSON.stringify(punct) === JSON.stringify(plain) && punct.some((u) => u.startsWith('Help, Pix! / - Shield')), [punct, plain]);
  const big = mkBig('Help, Pix!');
  const grouped = extract(big, { rosters: ROSTER });
  check('end to end on the oversize text: four subsections, in order, 2 + 2 + 2 + 1 changes', [...new Set(grouped.changes.map((c) => c.subsection.sourceHeading))].join('|') === 'Whimsy|Help, Pix!|Glitterlance|Wild Growth' && grouped.changes.length === 7, grouped.changes.map((c) => c.subsection.sourceHeading));
}

// =======================================================================================================================
console.log('\n=== 4. PROSE STAYS PROSE ===');
{
  const ROSTER = { championRoster: [{ id: 'lulu', name: 'Lulu', tier: 'A' }] };
  const sub = (text) => extract(text, { rosters: ROSTER }).changes.map((c) => c.subsection ? c.subsection.sourceHeading : null);
  const mk = (line, after = '- Shield: 80 → 90') => `## CHAMPION ADJUSTMENTS\n\n### Lulu\n\n${line}\n\n${after}\n`;
  check('a sentence ending in "!" directly above a bullet is NOT a heading ("Let\'s get into it, everyone!")', sub(mk("Let's get into it, everyone!"))[0] === null);
  check('...nor "Enjoy the new patch!" (ordinary lowercase words)', sub(mk('Enjoy the new patch!'))[0] === null);
  check('...nor a question sentence', sub(mk('Is she too strong now?'))[0] === null);
  check('a title-cased line ending in "." is prose ("You and Me.")', sub(mk('You and Me.'))[0] === null);
  check('a title-cased "!" line that does NOT introduce a list (prose follows) is prose', sub(mk('You and Me!', 'She heals less on her host now.\n\n- Shield: 80 → 90'))[0] === null);
  check('a long title-cased exclamation (more than 6 words) is prose', sub(mk('Lulu Is Very Strong And Needs A Nerf!'))[0] === null);
  check('the champion\'s intro paragraph is never a heading (Riot\'s real Yuumi blurb, followed directly by her label)', yuumi.subsection.sourceHeading === 'You and Me!' && !D.changes.some((c) => c.subsection && /benefits more than intended/.test(c.subsection.sourceHeading)));
  check('every OTHER sentence-like line in the real 7.3a section stayed prose: no subsection of any change reads like a sentence', D.changes.every((c) => !c.subsection || (c.subsection.sourceHeading.split(/\s+/).length <= 6 && !/[.]$/.test(c.subsection.sourceHeading))), D.changes.map((c) => c.subsection && c.subsection.sourceHeading).filter((h) => h && /[.!?]$/.test(h)));
}

// =======================================================================================================================
console.log('\n=== 5. PUBLIC VIEW + ABILITY ICON LOOKUP (from Riot\'s heading) ===');
{
  const report = { id: SLUG, patch: '7.3a', status: 'published', revision: 1, generatedAt: '2026-10-03T09:00:00.000Z', sourceUrl: 'https://example.test', recommendedTierChanges: [], supportMetaAnalysis: '', patchNotes: JSON.parse(JSON.stringify(D)) };
  const pub = toPublicView(report, rosters().itemRoster);
  const entry = pub.championChanges.find((e) => e.championId === 'yuumi');
  check('public entry: Yuumi with ONE subsection whose title and Riot heading are "You and Me!" (and the parser\'s slot-free ability name for the icon)', entry && entry.subsections.length === 1 && entry.subsections[0].title === 'You and Me!' && entry.subsections[0].sourceHeading === 'You and Me!' && entry.subsections[0].abilityName === 'You and Me!', entry && entry.subsections);
  check('public change text is the extracted fact, without repeating the heading', entry.subsections[0].changes.length === 1 && entry.subsections[0].changes[0].text === 'Healing and Shield Power: 8%/9%/10%/11% + 0.02% Ability Power → 6%/7%/8%/9% + 0.01%a Ability Power', entry.subsections[0].changes);
  check('the public view still has no icon path, no change IDs and no dataset (an icon can never be required by the data)', !JSON.stringify(pub).includes('/assets/abilities') && !JSON.stringify(pub).includes('pn_') && !('patchNotes' in pub));

  check('the naming convention is untouched: slug("You and Me!") = "you-and-me" -> public/assets/abilities/yuumi/you-and-me.webp', abilitySlug('You and Me!') === 'you-and-me');
  const idx = { yuumi: { 'you-and-me': '/assets/abilities/yuumi/you-and-me.webp', q: '/assets/abilities/yuumi/q.webp', w: '/assets/abilities/yuumi/w.webp', e: '/assets/abilities/yuumi/e.webp', r: '/assets/abilities/yuumi/r.webp' } };
  const hit = createAbilityIconResolver(idx)('yuumi', { sourceHeading: entry.subsections[0].sourceHeading, abilityName: entry.subsections[0].abilityName });
  check('icon lookup SUCCEEDS from Riot\'s heading: key "you-and-me" -> /assets/abilities/yuumi/you-and-me.webp', hit && hit.key === 'you-and-me' && hit.src === '/assets/abilities/yuumi/you-and-me.webp', hit);
  check('...and a q/w/e/r file next to it is never used for her (no slot guessing): without you-and-me.webp the lookup is null', createAbilityIconResolver({ yuumi: { q: 'q', w: 'w', e: 'e', r: 'r', passive: 'p' } })('yuumi', { sourceHeading: 'You and Me!', abilityName: 'You and Me!' }) === null);

  const ENTRY = `import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server'; export { React, renderToStaticMarkup }; export { PublicReportCard } from ${src('src/pages/PatchNotesPage.jsx')};`;
  const render = async (abilityIndex, view) => { const m = await bundleModule(ENTRY, { abilityIndex }); return m.renderToStaticMarkup(m.React.createElement(m.PublicReportCard, { report: view, roster: { champions: [], items: [], runes: [] }, initiallyExpanded: true })); };
  // the public page lists every published entity of the real section (Hwei, Senna, Swain, Yuumi): look only inside Yuumi's own card
  const yuumiCard = (html) => html.split('class="patch-entry-card"').find((c) => c.includes('>Yuumi<')) || '';
  const head = (html) => (yuumiCard(html).split('class="patch-sub-head"')[1] || '').split('class="patch-sub-change"')[0];
  const withIcon = await render(idx, pub);
  check('RENDERED PAGE: Yuumi\'s subsection head has the ability <img> with her file immediately before the title "You and Me!"', head(withIcon).includes('<img class="ability-icon" src="/assets/abilities/yuumi/you-and-me.webp"') && head(withIcon).indexOf('ability-icon') < head(withIcon).indexOf('patch-sub-title') && head(withIcon).includes('>You and Me!<'), head(withIcon));
  const noIcon = await render({}, pub);
  check('no icon file: the heading and the change are still on the page, with the neutral placeholder', head(noIcon).includes('ability-icon-fallback') && !head(noIcon).includes('<img') && head(noIcon).includes('>You and Me!<') && yuumiCard(noIcon).includes('Healing and Shield Power: 8%/9%/10%/11%'), head(noIcon));

  // Admin display-heading edit: the page shows the edit, the icon follows RIOT'S heading
  const ds = JSON.parse(JSON.stringify(D));
  const y = yuumiOf(ds);
  applyReviewOps(ds, [{ op: 'editSubsectionTitle', subsectionKey: subsectionKeyOf(y), displayHeading: 'Best Friend sustain' }]);
  const editedPub = toPublicView({ ...report, patchNotes: ds }, rosters().itemRoster);
  const editedHtml = await render(idx, editedPub);
  check('ADMIN-EDITED heading: the page shows "Best Friend sustain", Riot\'s "You and Me!" stays in the data, and the icon is STILL found (it never follows the display text)', head(editedHtml).includes('>Best Friend sustain<') && !head(editedHtml).includes('>You and Me!<') && head(editedHtml).includes('you-and-me.webp') && editedPub.championChanges.find((e) => e.championId === 'yuumi').subsections[0].sourceHeading === 'You and Me!' && yuumiOf(ds).subsection.sourceHeading === 'You and Me!');
  const displayOnly = await render({ yuumi: { 'best-friend-sustain': '/assets/abilities/yuumi/best-friend-sustain.webp' } }, editedPub);
  check('an icon filed under the Admin\'s DISPLAY text is never used: with only best-friend-sustain.webp on disk the page shows the placeholder (the lookup keys on Riot\'s heading, not on what the Admin typed)', !head(displayOnly).includes('<img') && head(displayOnly).includes('ability-icon-fallback') && head(displayOnly).includes('>Best Friend sustain<'), head(displayOnly));
  const aliasHit = createAbilityIconResolver({ yuumi: { 'friend-zone': '/x.webp' } }, { yuumi: { 'You and Me!': 'friend-zone' } })('yuumi', { sourceHeading: 'You and Me!', abilityName: 'You and Me!' });
  check('the existing alias mechanism (ABILITY_ICON_ALIASES) still maps a Riot heading to an existing file', aliasHit && aliasHit.src === '/x.webp');
}

// =======================================================================================================================
console.log('\n=== 6. EXISTING REVIEWS SURVIVE: stored pre-fix state -> rescan through the real handlers ===');
{
  const makeKV = () => { const store = new Map(Object.entries(KV_BEFORE)); const kv = { store, writes: [] }; kv.get = async (k) => (store.has(k) ? store.get(k) : null); kv.put = async (k, v) => { kv.writes.push(k); store.set(k, String(v)); }; kv.delete = async (k) => { kv.writes.push(`DELETE ${k}`); store.delete(k); }; kv.list = async ({ prefix = '' } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: null }); return kv; };
  const COACH = JSON.stringify({ revision: 5, champions: { yuumi: { tier: 'B' } }, items: {}, runes: {}, decisionTrees: {}, patch: '7.2b' });
  const setup = async () => {
    const kv = makeKV(); kv.store.set('coach-overrides', COACH);
    kv.store.set('riot-latest-patch-meta', JSON.stringify({ slug: SLUG })); kv.store.set(`riot-fallback-full-content:${SLUG}:${SOURCE_TEXT_VERSION}`, JSON.stringify({ content: REAL_TEXT, truncated: false }));
    const env = { COACH_KV: kv, ADMIN_SESSION_SECRET: 'test-secret', ANTHROPIC_API_KEY: 'would-be-used-if-AI-ran' };
    return { kv, env, cookie: `academy_admin_session=${await createSessionToken(env)}` };
  };
  const post = (url, body, cookie) => new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const act = async (env, cookie, body) => { const r = await reportsPost({ request: post('https://x/api/admin/patch-reports', body, cookie), env }); return { status: r.status, body: await r.json() }; };
  const getRev = async (env, cookie, revision) => (await (await adminGet({ request: new Request(`https://x/api/admin/patch-reports?id=${SLUG}&revision=${revision}`, { headers: { Cookie: cookie } }), env })).json()).report;
  const rescan = async (env, cookie) => (await checkPost({ request: post('https://x/api/admin/patch-check', { action: 'rescan', patchId: SLUG }, cookie), env })).json();
  const pubOf = async (env) => (await (await publicGet({ request: new Request('https://x/api/patch-reports'), env })).json()).reports.find((r) => r.id === SLUG);
  const publish = async (env, cookie, revision) => { await act(env, cookie, { id: SLUG, action: 'approve', revision }); return act(env, cookie, { id: SLUG, action: 'publish', revision, alsoMarkVerified: false }); };

  // --- A. note + classification + edited text carried to the new ID ---
  const A = await setup();
  const rev1 = await getRev(A.env, A.cookie, 1);
  const oldY = yuumiOf(rev1.patchNotes);
  check('setup: the stored revision 1 is the pre-fix one (Yuumi has no subsection, old ID)', oldY.changeId === YUUMI_ID_BEFORE && oldY.subsection === null);
  const saved = await act(A.env, A.cookie, { id: SLUG, action: 'review', revision: 1, ops: [
    { op: 'edit', changeId: YUUMI_ID_BEFORE, displayTitle: oldY.review.displayTitle, displayText: 'Yuumi heals and shields her host less.', reviewerNote: 'Support item nerf knock-on' },
    { op: 'classify', changeId: YUUMI_ID_BEFORE, comparisonState: 'NERF' },
  ] });
  check('setup: the admin\'s review of the OLD Yuumi change is saved (edited text + public note + NERF override)', saved.status === 200 && saved.body.applied.length === 2, saved.body);
  const rev1Stored = A.kv.store.get(`patch-intel:report:${SLUG}:1`);
  const writesBefore = A.kv.writes.length;
  const rs = await rescan(A.env, A.cookie);
  check('rescan creates revision 2 from the same Riot text', rs.ok === true && rs.report.revision === 2, rs.report && rs.report.revision);
  const rev2 = await getRev(A.env, A.cookie, 2);
  const newY = yuumiOf(rev2.patchNotes);
  check('revision 2: Yuumi\'s change has the heading "You and Me!" and the new stable ID', newY.subsection.sourceHeading === 'You and Me!' && newY.changeId === YUUMI_ID_AFTER, [newY.subsection, newY.changeId]);
  check('THE REVIEW FOLLOWED THE CHANGE: edited text, public note and NERF override are all on the new change; the edit flag is kept', newY.review.reviewerNote === 'Support item nerf knock-on' && newY.review.comparisonStateOverride === 'NERF' && newY.review.displayText === 'Yuumi heals and shields her host less.' && newY.review.edited.text === true && newY.review.state === 'edited', newY.review);
  check('the lineage is recorded (previousChangeIds) and nothing was orphaned or flagged as source-changed', JSON.stringify(newY.previousChangeIds) === JSON.stringify([YUUMI_ID_BEFORE]) && rev2.patchNotes.orphanedChanges.length === 0 && rev2.patchNotes.mergeStats.migrated === 1 && rev2.patchNotes.mergeStats.orphaned === 0 && newY.review.sourceChangedSinceReview === false, rev2.patchNotes.mergeStats);
  check('the Riot facts on revision 2 are fresh extraction truth, not the edit: original text and normalized data are the extractor\'s', newY.originalSourceText === YUUMI_BULLET && newY.normalizedData.ability === 'You and Me!' && newY.normalizedData.newValue === '6%/7%/8%/9% + 0.01%a Ability Power');
  check('revision 1 is byte-for-byte untouched by the rescan (history stays exactly as it was)', A.kv.store.get(`patch-intel:report:${SLUG}:1`) === rev1Stored);
  await publish(A.env, A.cookie, 2);
  const pub = await pubOf(A.env);
  const pe = pub.championChanges.find((e) => e.championId === 'yuumi');
  check('PUBLIC after publishing revision 2: heading "You and Me!", the edited text, the note and the NERF badge', pub.revision === 2 && pe.subsections[0].title === 'You and Me!' && pe.subsections[0].changes[0].text === 'Yuumi heals and shields her host less.' && pe.subsections[0].changes[0].note === 'Support item nerf knock-on' && pe.subsections[0].changes[0].classification === 'NERF' && pe.classification === 'NERF', pe);
  check('only patch-intel:* keys were written (no coach-overrides, no Academy data); coach-overrides is byte-identical; nothing was fetched (no AI, no network)', A.kv.writes.slice(writesBefore).every((k) => k.startsWith('patch-intel:')) && A.kv.store.get('coach-overrides') === COACH && fetchCalls.length === 0, A.kv.writes.slice(writesBefore).filter((k) => !k.startsWith('patch-intel:')));

  // --- B. a removed change must STAY removed ---
  const B = await setup();
  await act(B.env, B.cookie, { id: SLUG, action: 'review', revision: 1, ops: [{ op: 'remove', changeId: YUUMI_ID_BEFORE }] });
  const pubBeforeB = await publish(B.env, B.cookie, 1);
  check('setup: with the old Yuumi change removed, Yuumi is not public', pubBeforeB.body.ok === true && !(await pubOf(B.env)).championChanges.some((e) => e.championId === 'yuumi'));
  const rsB = await rescan(B.env, B.cookie);
  const yB = yuumiOf((await getRev(B.env, B.cookie, 2)).patchNotes);
  check('after the rescan the removal is still in force on the NEW ID (it does not come back as a fresh visible change)', rsB.ok === true && yB.changeId === YUUMI_ID_AFTER && yB.review.state === 'removed', yB.review);
  await publish(B.env, B.cookie, 2);
  check('...and Yuumi stays out of the public page', !(await pubOf(B.env)).championChanges.some((e) => e.championId === 'yuumi'));

  // --- C. nothing reviewed -> nothing to carry, and nothing lost ---
  const C = await setup();
  await rescan(C.env, C.cookie);
  const rev2C = await getRev(C.env, C.cookie, 2);
  check('with no review on Yuumi: a plain fresh change (pending, no note), no lineage, nothing orphaned', yuumiOf(rev2C.patchNotes).review.state === 'pending' && !yuumiOf(rev2C.patchNotes).previousChangeIds && rev2C.patchNotes.orphanedChanges.length === 0 && rev2C.patchNotes.mergeStats.migrated === 0);
  check('a second rescan is a no-op for IDs (same ID again, no further migration)', (await rescan(C.env, C.cookie)).ok === true && yuumiOf((await getRev(C.env, C.cookie, 3)).patchNotes).changeId === YUUMI_ID_AFTER && (await getRev(C.env, C.cookie, 3)).patchNotes.mergeStats.migrated === 0);
}

// =======================================================================================================================
console.log('\n=== 7. IDENTITY BRIDGE: one-to-one only; ambiguity never guesses ===');
{
  const fresh0 = () => { const f = JSON.parse(JSON.stringify(D)); f.changes = f.changes.filter((c) => c.entity && c.entity.name === 'Yuumi'); return f; };
  const touched = (c, id, note = 'kept note') => { const p = JSON.parse(JSON.stringify(c)); p.changeId = id; p.review = { ...p.review, state: 'kept', reviewerNote: note }; return p; };
  const base = yuumi;
  const prevWith = (...changes) => ({ changes, sectionReview: {}, subsectionReview: {} });

  const one = mergeReviewState(fresh0(), prevWith(touched(base, 'pn_old_1')));
  check('CONTROL one-to-one (same entity, same path, same exact fingerprint, new ID): the review moves, the lineage is recorded, nothing orphaned', one.changes[0].review.reviewerNote === 'kept note' && one.changes[0].previousChangeIds[0] === 'pn_old_1' && one.mergeStats.migrated === 1 && one.orphanedChanges.length === 0, one.mergeStats);

  const twoPrev = mergeReviewState(fresh0(), prevWith(touched(base, 'pn_old_1', 'A'), touched(base, 'pn_old_2', 'B')));
  check('AMBIGUOUS (two reviewed previous changes share the key): no bridge -- both are kept as orphaned, the fresh change gets no one\'s review', twoPrev.changes[0].review.reviewerNote === '' && twoPrev.mergeStats.migrated === 0 && twoPrev.orphanedChanges.map((c) => c.review.reviewerNote).sort().join() === 'A,B', twoPrev.mergeStats);

  const twoFresh = fresh0(); const dup = JSON.parse(JSON.stringify(twoFresh.changes[0])); dup.changeId = 'pn_dup_fresh'; twoFresh.changes.push(dup);
  const mTwoFresh = mergeReviewState(twoFresh, prevWith(touched(base, 'pn_old_1')));
  check('AMBIGUOUS (two fresh changes share the key): no bridge, the reviewed change is orphaned, not given to either', mTwoFresh.changes.every((c) => c.review.reviewerNote === '') && mTwoFresh.mergeStats.migrated === 0 && mTwoFresh.orphanedChanges.length === 1);

  const otherEntity = touched(base, 'pn_old_1'); otherEntity.entity = { ...otherEntity.entity, key: 'champion:swain' };
  check('different entity, same text: never bridged', mergeReviewState(fresh0(), prevWith(otherEntity)).changes[0].review.reviewerNote === '' && mergeReviewState(fresh0(), prevWith(otherEntity)).orphanedChanges.length === 1);
  const otherPath = touched(base, 'pn_old_1'); otherPath.provenance = { ...otherPath.provenance, sourcePath: 'Wild Rift Patch Notes 7.3a > ITEMS > YUUMI' };
  check('different source path, same text: never bridged', mergeReviewState(fresh0(), prevWith(otherPath)).changes[0].review.reviewerNote === '');
  const otherText = touched(base, 'pn_old_1'); otherText.provenance = { ...otherText.provenance, sourceFingerprint: 'fp_0000000000000000' };
  const mOther = mergeReviewState(fresh0(), prevWith(otherText));
  check('different source wording (fingerprint): never bridged -- Riot rewording a line is a different change, handled as before (orphaned with its review kept)', mOther.changes[0].review.reviewerNote === '' && mOther.orphanedChanges.length === 1);

  const untouched = JSON.parse(JSON.stringify(base)); untouched.changeId = 'pn_old_1';
  const mUntouched = mergeReviewState(fresh0(), prevWith(untouched));
  check('an UNREVIEWED previous change is not bridged (nothing to carry) and not orphaned', mUntouched.mergeStats.migrated === 0 && mUntouched.orphanedChanges.length === 0);

  const sameId = mergeReviewState(fresh0(), prevWith(touched(base, base.changeId, 'by id'), touched(base, 'pn_old_9', 'stray')));
  check('an ID match always wins; the bridge never reassigns a change that already matched by ID', sameId.changes[0].review.reviewerNote === 'by id' && !sameId.changes[0].previousChangeIds && sameId.mergeStats.migrated === 0 && sameId.orphanedChanges.map((c) => c.review.reviewerNote).join() === 'stray');

  check('the bridge writes ONLY review-layer state: originalSourceText, normalizedData, provenance and the new changeId are the fresh extraction\'s, byte for byte', (() => { const f = fresh0(); const snap = JSON.stringify([f.changes[0].originalSourceText, f.changes[0].normalizedData, f.changes[0].provenance, f.changes[0].changeId]); const m = mergeReviewState(f, prevWith(touched(base, 'pn_old_1'))); return JSON.stringify([m.changes[0].originalSourceText, m.changes[0].normalizedData, m.changes[0].provenance, m.changes[0].changeId]) === snap; })());
  check('no outbound request happened anywhere in this file (no AI provider, no network)', fetchCalls.length === 0, fetchCalls);
}

done();
