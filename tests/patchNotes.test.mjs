// Patch Notes (deterministic extraction + review) -- regression suite A..L from the spec, plus the
// earlier Phase B regressions (Senna, Items Removed, gate/ownership/system coverage, fact shapes).
import { extract, makeChecker, CHAMPIONS, ITEMS, RUNES, SENNA_73, FIXED_TIME } from './helpers/patchNotesHelpers.mjs';
import { extractPatchNotes, findNewnessEvidence } from '../functions/_lib/patchNotesExtract.js';
import { mergeReviewState, applyReviewOps, sectionKeyOf, isChangePublishable, REVIEW_STATE, deriveLegacyReport } from '../functions/_lib/patchNotesReview.js';
import { parsePatchDocument } from '../functions/_lib/patchParser.js';
import { buildChangeId, sourceFingerprint } from '../functions/_lib/patchNotesIds.js';
import { extractStructuredChanges } from '../functions/_lib/patchChangeDetector.js';

const { check, done } = makeChecker();
const entity = (changes, name) => changes.filter((c) => c.entity && c.entity.name === name);

console.log('\n=== A. Existing entity with INCOMPLETE Academy data: every structurally owned change is extracted ===');
{
  const { changes } = extract(SENNA_73);
  const senna = entity(changes, 'Senna');
  const nd = (c) => c.normalizedData;
  check('Academy knows Senna only by name (no ability/stat fields) yet Senna is EXISTING', senna.length > 0 && senna.every((c) => c.entity.status === 'EXISTING' && c.entity.supportScope === 'ACADEMY'));
  check('Passive: current-health damage (range/level-scaled) extracted', senna.some((c) => nd(c).ability === 'Absolution' && /current health/i.test(nd(c).stat) && nd(c).oldValue.includes('1.2%~12%') && nd(c).newValue.includes('1%~10%')), senna.map(nd));
  check('Passive: Crit Rate per 20 Mist 15% -> 10%', senna.some((c) => /20 mist/i.test(nd(c).stat) && nd(c).oldValue === '15%' && nd(c).newValue === '10%'));
  check('Passive: [New] 90% critical-damage effect extracted as an added effect', senna.some((c) => nd(c).changeType === 'effect_added' && /90% of normal critical/i.test(nd(c).effect) && c.comparisonState === 'NEW'));
  check('Q (Piercing Darkness) rank list 50/90/130/170 -> 50/80/110/140', senna.some((c) => nd(c).ability === 'Piercing Darkness' && nd(c).changeType === 'rank_list' && nd(c).oldValue === '50 / 90 / 130 / 170' && nd(c).newValue === '50 / 80 / 110 / 140'));
  check('R (Dawning Shadow) damage extracted separately', senna.some((c) => nd(c).ability === 'Dawning Shadow' && nd(c).stat === 'Damage' && nd(c).newValue.includes('70% Ability Power')));
  check('R (Dawning Shadow) shield extracted separately', senna.some((c) => nd(c).ability === 'Dawning Shadow' && nd(c).stat === 'Shield' && nd(c).newValue.includes('Mist × 2')));
  const as = senna.filter((c) => nd(c).changeType === 'new_value' && /attack speed/i.test(nd(c).stat));
  check('all four new attack-speed stat lines extracted (ratio, base, base bonus, per level)', as.length === 4 && as.map((c) => nd(c).stat).join('|') === 'Attack Speed Ratio|Base Attack Speed|Base Bonus Attack Speed|Attack Speed per Level', as.map((c) => nd(c).stat));
  check('Base Health 600 -> 570 from the second Riot section', senna.some((c) => /base health/i.test(nd(c).stat) && nd(c).oldValue === '600' && nd(c).newValue === '570' && c.provenance.sourceSection === 'CHAMPION ADJUSTMENTS' && c.provenance.sourceSubsection === 'Champion Durability Adjustments Detailed List'));
  check('every Senna change keeps its own ability (Passive/Q/R are not collapsed into one summary)', new Set(senna.map((c) => nd(c).ability)).size >= 4, [...new Set(senna.map((c) => nd(c).ability))]);
  check('Senna has 11 distinct changes (nothing lost)', senna.length === 11, senna.length);
  check('numeric single-value change carries delta + percent', senna.some((c) => nd(c).changeType === 'value' && nd(c).change === -30 && nd(c).changePercent === -5));
}

console.log('\n=== B/C/D. NEW_CANDIDATE vs UNMATCHED: newness needs explicit Riot evidence, anywhere in the document ===');
{
  const text = `## Item Adjustments

### Marksman Item Adjustments

New items like Hexoptics C44 and Yun Tal Wildarrows are joining the shop.

#### Hexoptics C44

*Base Stats*

- Price: 2900
- Attack Damage: 55

#### Zeal

*Base Stats*

- Movement Speed: 5% → 4%

### Other Item Adjustments

The new Bandleglass Mirror will serve as the go-to component.

#### Bandleglass Mirror

*Base Stats*

- Ability power: 20

#### Mystery Blade

*Base Stats*

- Attack Damage: 30
`;
  const { changes } = extract(text);
  const status = (name) => { const c = entity(changes, name)[0]; return c && c.entity.status; };
  check('B: Hexoptics C44 (not in Academy, parent intro says "joining the shop") -> NEW_CANDIDATE', status('Hexoptics C44') === 'NEW_CANDIDATE', status('Hexoptics C44'));
  check('C: Bandleglass Mirror introduced inside Item Adjustments, newness proven by "The new Bandleglass Mirror" in a SIBLING block -> NEW_CANDIDATE', status('Bandleglass Mirror') === 'NEW_CANDIDATE');
  check('evidence sentence is stored on the change', entity(changes, 'Bandleglass Mirror')[0].entity.newnessEvidence.sentence.includes('The new Bandleglass Mirror'));
  check('D: Mystery Blade (entity-shaped block, no proof of newness) -> UNMATCHED, still present', status('Mystery Blade') === 'UNMATCHED' && entity(changes, 'Mystery Blade').length === 1);
  check('Zeal has numeric change, no newness wording -> UNMATCHED not NEW (Do NOT assume every unknown entity is new)', status('Zeal') === 'UNMATCHED');
  check('supportScope is UNKNOWN for NEW_CANDIDATE and UNMATCHED (never guessed from game knowledge)', ['Hexoptics C44', 'Bandleglass Mirror', 'Mystery Blade', 'Zeal'].every((n) => entity(changes, n)[0].entity.supportScope === 'UNKNOWN'));
  check('Academy master data is untouched: no id invented for a candidate', entity(changes, 'Hexoptics C44')[0].entity.id === null && entity(changes, 'Hexoptics C44')[0].entity.academyKey === null);
  check('new-value-only stat lines of a NEW_CANDIDATE are comparison NEW', entity(changes, 'Hexoptics C44').every((c) => c.comparisonState === 'NEW'));
  check('findNewnessEvidence is exact-name, never substring ("Mirror" alone proves nothing)', findNewnessEvidence('Mirror', [{ id: 'U1', text: 'The new Bandleglass Mirror will serve.' }]) === null);
}

console.log('\n=== E. False mentions never become ownership (Heartsteel / Overgrowth / prose mentions) ===');
{
  const text = `## BATTLEFIELD ADJUSTMENTS

### Battlefield system Adjustments

#### Turrets

Turret plating changes. Crystalline Overgrowth works with Demolish and Sunfire Aegis.

#### Crystalline Overgrowth

- Cooldown: 50 seconds
- Minimum damage: 2% → 3%

## Adventure Mode

### AAA ARAM

#### Heartsteel

Earn Steelbuff through various means.

## Item Adjustments

#### Ardent Censer

- Price: 2700 → 2400

The Censer pairs with Sunfire Aegis and Heartsteel in builds.
`;
  const { changes, dataset } = extract(text);
  check('Crystalline Overgrowth (turret section) is a SYSTEM change, not the rune Overgrowth', changes.filter((c) => /overgrowth/i.test(c.provenance.sourceHeading)).every((c) => c.kind === 'system'));
  check('no change is owned by the tracked rune Overgrowth', !changes.some((c) => c.entity && c.entity.name === 'Overgrowth'));
  check('Heartsteel under ARAM Augments is a SYSTEM (live service) change, not the item Heartsteel', changes.filter((c) => c.provenance.sourceHeading === 'Heartsteel').every((c) => c.kind === 'system'));
  check('no change is owned by the tracked item Heartsteel', !changes.some((c) => c.entity && c.entity.name === 'Heartsteel'));
  const censer = entity(changes, 'Ardent Censer');
  check('Ardent Censer owns only its own change', censer.length >= 1 && censer.every((c) => c.ownership.source === 'entity_heading'));
  check('Sunfire Aegis mentioned in prose is NOT owner of anything', !changes.some((c) => c.entity && c.entity.name === 'Sunfire Aegis'));
  check('mentions are recorded as suspected references on the block, not as ownership', dataset.blocks.some((b) => (b.suspectedReferences || []).includes('item:sunfire-aegis')));
  check('validation reports 0 false-ownership cases', dataset.validation.falseOwnership.count === 0);
}

console.log('\n=== F/H. Lifecycle: bare "Removed" and the Items Removed regression ===');
{
  const text = `## Item Adjustments

### Marksman Item Adjustments

#### Zeal

- Movement Speed: 5% → 4%

#### Removed

- As mentioned above, Magnetic Blaster has been removed due to being too much of an all-purpose item.
  * Magnetic Blaster
- Soul Transfer has struggled to find its intended audience.
  * Soul Transfer

### Other Item Adjustments

#### Items Removed

- Like Shimmering Spark, with the new jungle system, we no longer need a jungle-specific version of Sunfire Aegis.
  * Searing Crown
- Surging Scales has always struggled to find a clear identity.
  * Surging Scales
- Stinger has also lost its last remaining user, so we're removing it for now.
  * Stinger
  * See above.
  * Searing Crown
`;
  const { changes, dataset } = extract(text);
  const removed = changes.filter((c) => c.lifecycle && c.lifecycle.action === 'removed');
  const names = removed.map((c) => c.entity.name).sort();
  check('F: bare Removed under Marksman Item Adjustments is kept (no category gate) and names its entities', names.includes('Magnetic Blaster') && names.includes('Soul Transfer'), names);
  check('H: Searing Crown, Surging Scales and Stinger -> REMOVED', ['Searing Crown', 'Surging Scales', 'Stinger'].every((n) => removed.some((c) => c.entity.name === n && c.comparisonState === 'REMOVED')));
  check('H: exactly 5 removed entities (Searing Crown duplicate collapsed)', removed.length === 5, names);
  check('H: the duplicate Searing Crown line is recorded on the one change as a duplicate', removed.find((c) => c.entity.name === 'Searing Crown').duplicates.length === 1);
  check('H: "See above." is not an entity', !changes.some((c) => c.entity && /see above/i.test(c.entity.name)));
  check('H: Sunfire Aegis prose does not own Searing Crown', !changes.some((c) => c.entity && c.entity.name === 'Sunfire Aegis'));
  check('lifecycle entities carry ownership.source lifecycle_block', removed.every((c) => c.ownership.source === 'lifecycle_block'));
  check('original source of a removed item keeps the explaining bullet', removed.find((c) => c.entity.name === 'Surging Scales').originalSourceText.includes('clear identity'));
  check('duplicate merge is counted in validation', dataset.validation.duplicateMerges >= 1);
  check('Zeal (a normal block next to the removed list) is unaffected', entity(changes, 'Zeal').length === 1);
  const tracked = extract(`## Item Adjustments\n\n#### Items Removed\n\n- Retired.\n  - Ardent Censer`).changes.find((c) => c.lifecycle);
  check('a removed item that IS tracked resolves to EXISTING with its Academy id (exact name)', tracked.entity.status === 'EXISTING' && tracked.entity.id === 'ardent-censer' && tracked.comparisonState === 'REMOVED');
}

console.log('\n=== I. System changes stay system; non-roster entity blocks are UNMATCHED, never fake system rows ===');
{
  const text = `## BATTLEFIELD ADJUSTMENTS

### Jungle Adjustments

Monster levels will now scale with the average level of both teams. Sunfire Aegis is no longer required for clear speed.

#### Smite Adjustments

- [New] Champions with Smite deal true damage.
- [Removed] Casting Smite restores Health.

### Battlefield system Adjustments

#### Turret Adjustments

- Outer turret Health: 3000 → 7000

## CHAMPION ADJUSTMENTS

### Marksman Systematic Adjustments

- Base Critical Strike Damage: 175% → 200%

### Marksman Champion Adjustments

JHIN

We're adjusting Jhin, Yasuo, Yone, and Senna.

- Base Attack Damage: 58 → 60
`;
  const { changes } = extract(text);
  const sys = changes.filter((c) => c.kind === 'system');
  check('Jungle overview prose that names Sunfire Aegis is kept as a jungle SYSTEM change (not hijacked, not lost)', sys.some((c) => c.system.category === 'jungle' && c.provenance.sourceHeading === 'Jungle Adjustments' && /Monster levels/.test(c.originalSourceText)));
  check('Smite [New]/[Removed] lines extracted with NEW/REMOVED states', sys.some((c) => c.comparisonState === 'NEW' && /Smite deal true damage/.test(c.normalizedData.effect)) && sys.some((c) => c.comparisonState === 'REMOVED' && /restores Health/.test(c.normalizedData.effect)));
  check('Turret Health 3000 -> 7000 kept as turret system change', sys.some((c) => c.system.category === 'turret' && c.normalizedData.oldValue === '3000' && c.normalizedData.newValue === '7000'));
  check('Base Crit Damage 175% -> 200% detected as a system change', sys.some((c) => c.normalizedData.oldValue === '175%' && c.normalizedData.newValue === '200%'));
  check('system changes carry a comparisonState (ADJUSTED for an unlabeled old->new pair)', sys.every((c) => typeof c.comparisonState === 'string') && sys.find((c) => c.normalizedData.oldValue === '3000').comparisonState === 'ADJUSTED');
  const jhin = changes.filter((c) => c.provenance.sourceHeading === 'JHIN');
  check('JHIN (not tracked) is UNMATCHED entity-owned, NOT a system change', jhin.length > 0 && jhin.every((c) => c.kind === 'entity' && c.entity.status === 'UNMATCHED'));
  check('Senna named in JHIN\'s prose does not own JHIN\'s changes', !changes.some((c) => c.entity && c.entity.name === 'Senna'));
}

console.log('\n=== K/L-adjacent. Heading-less appendix lists: explicit "<Name> / Base Stats" sub-blocks, never guessed ===');
{
  const text = `## Appendix

### Champion Durability Adjustments Detailed List

#### Nocturne

*Base Stats*

- Health per Level: 120 → 134

Braum

*Base Stats*

- Attack Speed Ratio: 0.644
- Base Attack Speed: 0.644

Garen

*Base Stats*

- Attack Speed Ratio: 0.625
`;
  const { changes, dataset } = extract(text);
  const braum = entity(changes, 'Braum');
  check('Braum sub-block inside the Nocturne block is owned by Braum via explicit_block', braum.length === 2 && braum.every((c) => c.entity.status === 'EXISTING' && c.ownership.source === 'explicit_block'));
  check('Nocturne keeps only its own change', entity(changes, 'Nocturne').length === 1);
  check('Garen (untracked) sub-block is UNMATCHED, visible, owner still structurally clear (explicit_block)', entity(changes, 'Garen').length === 1 && entity(changes, 'Garen')[0].entity.status === 'UNMATCHED' && entity(changes, 'Garen')[0].ownership.source === 'explicit_block');
  check('nothing in the block is unaccounted', dataset.validation.droppedBlocks === 0);
}

console.log('\n=== D2. Ambiguous owner: a heading naming TWO tracked entities is UNMATCHED with ownership unproven, never guessed ===');
{
  const dup = [{ id: 'senna', name: 'Twin', tier: 'A' }, { id: 'braum', name: 'Twin', tier: 'B' }];
  const { changes } = extract(`## CHAMPION ADJUSTMENTS\n\n### Twin\n\n- Base Health: 600 → 570`, { rosters: { championRoster: dup } });
  const t = changes.filter((c) => c.provenance.sourceHeading === 'Twin');
  check('ambiguous heading -> UNMATCHED, ownership.source "unmatched", suspected references listed', t.length === 1 && t[0].entity.status === 'UNMATCHED' && t[0].ownership.source === 'unmatched' && t[0].ownership.suspectedReferences.length === 2, t[0] && t[0].ownership);
  check('and it is not attributed to either tracked champion', !t[0].entity.academyKey);
}

console.log('\n=== Fact shapes (rank lists, ranges, expressions, recipes, [New]/[Removed], effects, abilities) ===');
{
  const t = `Absolution

- Base Damage: 50 / 90 / 130 / 170 → 50 / 80 / 110 / 140
- Range: 1.2%~12% (based on level) → 1%~10% (based on level)
- Damage: 250 / 375 + 120% bonus AD → 250 / 400 + 70% AP
- Build Path: Dagger (500) + 400 → Dagger (400) + 500
- Price: 900 → 700
- Cooldown: 4.5/4/3.5/3s → 5.5/5/4.5/4s
- [New] Lifesteal: 8%
- [Removed] Physical Vamp: 8%
- Wind Blade [Removed]
- Seething Strike now also applies on-hit effects to a second target.

Wind Blade [Removed]

Spectral Haste

- [Removed]`;
  const r = extractStructuredChanges(t, { sourceSection: 'X' });
  const by = (f) => r.find(f);
  check('rank list', by((x) => x.changeType === 'rank_list' && x.stat === 'Base Damage'));
  check('rank list WITHOUT spaces (4.5/4/3.5/3s)', by((x) => x.stat === 'Cooldown' && x.traits.includes('rank_list')));
  check('range / level-scaled', by((x) => x.stat === 'Range' && x.traits.includes('range')));
  check('compound expression', by((x) => x.changeType === 'expression' && x.stat === 'Damage'));
  check('recipe change', by((x) => x.changeType === 'recipe'));
  check('plain single value keeps change + percent', by((x) => x.stat === 'Price' && x.change === -200 && x.changePercent === -22.2));
  check('[New] stat line', by((x) => x.changeType === 'added' && x.stat === 'Lifesteal' && x.newValue === '8%'));
  check('[Removed] stat line', by((x) => x.changeType === 'removed' && x.stat === 'Physical Vamp' && x.oldValue === '8%'));
  check('trailing "[Removed]" suffix on a label line is an effect_removed', r.filter((x) => x.changeType === 'effect_removed').length >= 2);
  check('bare "[Removed]" under an ability label removes that ability effect', by((x) => x.changeType === 'effect_removed' && x.ability === 'Spectral Haste'));
  check('passive/effect bullet preserved as an effect record', by((x) => x.changeType === 'effect' && /second target/.test(x.effect)));
  check('every record carries ability + sourceSection + lineIndex', r.every((x) => x.ability && x.sourceSection === 'X' && Number.isInteger(x.lineIndex)));
  check('slot is only set from explicit notation (never guessed): none here', r.every((x) => x.slot === null));
  const slotted = extractStructuredChanges('Q - Shield of Daybreak\n\n- Shield: 50 → 60\n\nPassive - Innate\n\n- Armor: 1 → 2');
  check('explicit slot notation on a label is honoured (Q / Passive)', slotted[0].slot === 'Q' && slotted[1].slot === 'Passive', slotted.map((x) => x.slot));
}

console.log('\n=== Stable IDs, provenance, original source ===');
{
  const a = extract(SENNA_73).changes; const b = extract(SENNA_73).changes;
  check('IDs are deterministic across runs', a.map((c) => c.changeId).join() === b.map((c) => c.changeId).join());
  check('IDs are unique within a patch', new Set(a.map((c) => c.changeId)).size === a.length);
  const prefixed = extract('## Intro\n\nA paragraph.\n\n' + SENNA_73).changes;
  check('IDs survive unrelated content being added before the entity', a.map((c) => c.changeId).join() === prefixed.filter((c) => c.entity && c.entity.name === 'Senna').map((c) => c.changeId).join());
  check('changing the patch version changes the ID (different patch, different change)', extract(SENNA_73, { patchVersion: '7.4' }).changes[0].changeId !== a[0].changeId);
  const p = a[0].provenance;
  check('provenance: patchVersion, sourceUrl, section, heading, order, block/line index, node path, parserVersion, extractedAt', p.patchVersion === '7.3' && p.sourceUrl.startsWith('https://') && p.sourceSection && p.sourceHeading && Number.isInteger(p.sourceOrder) && Number.isInteger(p.sourceBlockIndex) && p.sourceNodePath && p.parserVersion && p.extractedAt === FIXED_TIME, p);
  check('unavailable provenance is null, never invented (no anchors in the structured text)', p.sourceAnchor === null);
  check('every change preserves its original Riot line verbatim', a.every((c) => c.originalSourceText && c.originalSourceText.trim().length > 0) && a.some((c) => c.originalSourceText.includes('1.2%~12% (based on level) → 1%~10% (based on level)')));
  check('buildChangeId is value-free: same slot, different numbers -> same ID, different fingerprint', buildChangeId({ patchVersion: '7.3', scopeKey: 'k', sectionPath: ['A'], identity: 'x' }) === buildChangeId({ patchVersion: '7.3', scopeKey: 'k', sectionPath: ['A'], identity: 'x' }) && sourceFingerprint('Damage: 1 → 2') !== sourceFingerprint('Damage: 1 → 3'));
}

console.log('\n=== L. Duplicate handling: deterministic merge only on identical slot AND wording ===');
{
  const text = `## Item Adjustments

#### Ardent Censer

- Price: 2700 → 2400

#### Ardent Censer

- Price: 2700 → 2400

#### Ardent Censer

- Price: 2700 → 2500
`;
  const { changes, dataset } = extract(text);
  const prices = entity(changes, 'Ardent Censer');
  check('identical slot + identical wording -> merged (one change, duplicate recorded)', prices.length === 2 && prices[0].duplicates.length === 1, prices.map((c) => [c.changeId, c.duplicates.length]));
  check('same slot but DIFFERENT wording is a distinct change (not merged by similarity)', prices[1].originalSourceText.includes('2500') && prices[1].changeId !== prices[0].changeId);
  check('merge is counted in validation', dataset.validation.duplicateMerges === 1);
}

console.log('\n=== J/K. Review persistence: edit / remove / reject / section removal survive regeneration ===');
{
  const first = extract(SENNA_73);
  const ds = first.dataset;
  const q = ds.changes.find((c) => c.normalizedData.ability === 'Piercing Darkness');
  const r = ds.changes.find((c) => c.normalizedData.ability === 'Dawning Shadow' && c.normalizedData.stat === 'Shield');
  const hp = ds.changes.find((c) => /base health/i.test(c.normalizedData.stat || ''));
  const res = applyReviewOps(ds, [
    { op: 'edit', changeId: q.changeId, displayText: 'Q base damage is lower at every rank.', displayTitle: 'Senna Q', reviewerNote: 'checked vs patch page' },
    { op: 'remove', changeId: r.changeId },
    { op: 'reject', changeId: hp.changeId },
    { op: 'originalSourceText', changeId: q.changeId, originalSourceText: 'HACKED' },
  ], { now: '2026-09-30T13:00:00.000Z' });
  check('edit/remove/reject applied; unknown op rejected', res.applied.length === 3 && res.errors.length === 1, res);
  check('original Riot source untouched by an edit (and by a malicious op)', q.originalSourceText.includes('50 / 90 / 130 / 170') && !q.originalSourceText.includes('HACKED'));
  check('review state set: edited / removed / rejected', q.review.state === 'edited' && r.review.state === 'removed' && hp.review.state === 'rejected');
  check('remove and reject are DISTINCT states', r.review.state !== hp.review.state);
  const sec = sectionKeyOf(q);
  applyReviewOps(ds, [{ op: 'editSectionTitle', sectionKey: sec, displayTitle: 'Senna (7.3)' }]);

  const regenerated = mergeReviewState(extract(SENNA_73).dataset, ds);
  const q2 = regenerated.changes.find((c) => c.changeId === q.changeId);
  check('regeneration preserved the manual display edit', q2.review.displayText === 'Q base damage is lower at every rank.' && q2.review.displayTitle === 'Senna Q' && q2.review.reviewerNote === 'checked vs patch page');
  check('regeneration preserved removed + rejected states', regenerated.changes.find((c) => c.changeId === r.changeId).review.state === 'removed' && regenerated.changes.find((c) => c.changeId === hp.changeId).review.state === 'rejected');
  check('regeneration preserved the section title edit', regenerated.sectionReview[sec].displayTitle === 'Senna (7.3)');
  check('regeneration kept the original source + provenance (from the new extraction, identical wording)', q2.originalSourceText === q.originalSourceText && q2.provenance.sourceFingerprint === q.provenance.sourceFingerprint);
  check('untouched changes stay pending and are not flagged', regenerated.changes.filter((c) => c.review.state === 'pending').length === ds.changes.length - 3 && regenerated.mergeStats.sourceChanged === 0);

  // source wording changes materially between runs: state + edit kept, flagged for re-check
  const changed = extract(SENNA_73.replace('50 / 80 / 110 / 140', '50 / 75 / 100 / 125')).dataset;
  const merged2 = mergeReviewState(changed, ds);
  const q3 = merged2.changes.find((c) => c.changeId === q.changeId);
  check('same ID + changed Riot wording: review state/edit KEPT, normalized data refreshed, flagged sourceChangedSinceReview', q3.review.state === 'edited' && q3.review.displayText.startsWith('Q base') && q3.normalizedData.newValue === '50 / 75 / 100 / 125' && q3.review.sourceChangedSinceReview === true);

  // parser no longer produces a human-touched change -> orphaned, never destroyed
  const without = extract(SENNA_73.replace('Piercing Darkness\n\n- Base Damage: 50 / 90 / 130 / 170 → 50 / 80 / 110 / 140\n', '')).dataset;
  const merged3 = mergeReviewState(without, ds);
  check('a human-touched change the new run no longer produces is kept as orphaned (not silently destroyed)', merged3.orphanedChanges.some((c) => c.changeId === q.changeId && c.review.state === 'edited') && merged3.mergeStats.orphaned >= 1);

  // K. section removal
  const ds2 = extract(SENNA_73).dataset;
  applyReviewOps(ds2, [{ op: 'removeSection', sectionKey: sec }]);
  const reg2 = mergeReviewState(extract(SENNA_73).dataset, ds2);
  const draft = deriveLegacyReport(reg2, { itemRoster: ITEMS, mode: 'draft' });
  check('K: removed section stays removed after regeneration', reg2.sectionReview[sec].state === 'removed');
  check('K: the underlying extraction is intact (all 11 changes still present)', reg2.changes.filter((c) => c.entity && c.entity.name === 'Senna').length === 11);
  check('K: the removed section does not appear in the draft/publish view', !draft.championChanges.some((c) => c.championName === 'Senna'));
  applyReviewOps(reg2, [{ op: 'restoreSection', sectionKey: sec }]);
  check('K: a section can be restored', deriveLegacyReport(reg2, { itemRoster: ITEMS, mode: 'draft' }).championChanges.some((c) => c.championName === 'Senna'));
  applyReviewOps(ds, [{ op: 'restore', changeId: r.changeId }, { op: 'restore', changeId: hp.changeId }]);
  check('a removed/rejected change can be restored', r.review.state === 'pending' && hp.review.state === 'pending');
}

console.log('\n=== Publication rules: review state decides what the public sees; Academy data is never written ===');
{
  const text = `## Item Adjustments\n\n#### Ardent Censer\n\n- Price: 2700 → 2400\n\n### Marksman Item Adjustments\n\nNew items like Stormrazor are joining the shop.\n\n#### Stormrazor\n\n- Price: 3000\n\n## BATTLEFIELD ADJUSTMENTS\n\n### Jungle Adjustments\n\n- [Removed] Monster gold scaling.\n`;
  const { dataset } = extract(text);
  const pub = () => deriveLegacyReport(dataset, { itemRoster: ITEMS, mode: 'publish' });
  check('pending EXISTING change publishes by default', pub().itemChanges.some((e) => e.itemName === 'Ardent Censer'));
  check('NEW_CANDIDATE and SYSTEM stay out of the public view until a human keeps them (but ARE in the draft)', !pub().itemChanges.some((e) => e.itemName === 'Stormrazor') && pub().systemChanges.length === 0 && deriveLegacyReport(dataset, { itemRoster: ITEMS, mode: 'draft' }).systemChanges.length > 0);
  const storm = dataset.changes.find((c) => c.entity && c.entity.name === 'Stormrazor');
  const jungle = dataset.changes.find((c) => c.kind === 'system');
  applyReviewOps(dataset, [{ op: 'keep', changeId: storm.changeId }, { op: 'keep', changeId: jungle.changeId }]);
  check('kept NEW_CANDIDATE + kept system change now publish', pub().itemChanges.some((e) => e.itemName === 'Stormrazor') && pub().systemChanges.length === 1);
  const censer = dataset.changes.find((c) => c.entity && c.entity.name === 'Ardent Censer');
  applyReviewOps(dataset, [{ op: 'remove', changeId: censer.changeId }]);
  check('removed change never publishes', !pub().itemChanges.some((e) => e.itemName === 'Ardent Censer') && !isChangePublishable(censer, dataset));
  check('published entries never expose review internals via the derived legacy fields (entityStatus/supportScope present, no dataset)', pub().itemChanges.every((e) => e.entityStatus && e.supportScope && !('patchNotes' in e)));
}

console.log('\n=== Accounting: nothing silently dropped ===');
{
  const text = `# Wild Rift Patch Notes 7.3\n\n2026-09-21T09:00:00.000Z\n\n## Item Adjustments\n\n#### Ardent Censer\n\n- Price: 2700 → 2400\n\n#### Empty Container\n\n## BUG FIXES\n\n- Fixed a bug.\n`;
  const { dataset } = extract(text);
  const v = dataset.validation;
  check('droppedBlocks / unaccounted = 0', v.droppedBlocks === 0 && v.unaccountedBlocks.length === 0, v);
  check('heading-only blocks are explicitly ignored with a reason (non-content), timestamp boilerplate with a reason', v.ignoredByReason['non-content'] >= 1);
  check('bug fixes are kept as a SYSTEM change', dataset.changes.some((c) => c.kind === 'system' && c.system.category === 'bug_fix'));
  check('every meaningful block has changes or an explicit ignoredReason', dataset.blocks.filter((b) => b.originalSourceText.trim()).every((b) => b.changeIds.length > 0 || b.ignoredReason));
  check('validation counts all four statuses + lifecycle + duplicates', ['entityOwnedBlocks', 'systemBlocks', 'newCandidateBlocks', 'unmatchedBlocks', 'lifecycleChanges', 'duplicateMerges', 'droppedBlocks'].every((k) => k in v));
}

console.log('\n=== No AI in Patch Notes ===');
{
  const fs = await import('node:fs');
  const files = ['patchNotesExtract', 'patchNotesReview', 'patchNotesIds', 'patchIntelPipeline', 'patchChangeDetector', 'patchLifecycle', 'patchParser', 'patchText', 'patchAcademyDetection', 'patchIntelligence'];
  const banned = /aiProvider|providers\/anthropic|openaiCompatible|openrouter|embedding|\bllm\b|api\.anthropic\.com|api\.openai\.com/i;
  const offenders = files.filter((f) => banned.test(fs.readFileSync(new URL(`../functions/_lib/${f}.js`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
  check('no AI/LLM/embedding references in any Patch Notes module', offenders.length === 0, offenders);
  const legacy = ['patchAnalysis.js', 'patchAggregate.js', 'patchPlanner.js', 'patchDeterministicReport.js'].filter((f) => fs.existsSync(new URL(`../functions/_lib/${f}`, import.meta.url)));
  check('legacy AI/planner modules are gone', legacy.length === 0, legacy);
}

done();
