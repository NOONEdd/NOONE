// Home page "Full Roster Coverage" rotation -- tests the REAL exported
// pure helpers from src/hooks/useRosterRotation.js (shuffle, initialSlots,
// drawNext). Plain Node ESM, same convention as the rest of this project's
// tests -- see tests/buildTypeMigration.test.mjs's header for why no
// jsdom/@testing-library/react dependency is added. The interval/timeout
// orchestration inside useRosterRotation() itself is a thin, mechanical
// wrapper around these three functions (schedule -> call commit() with
// their output); what actually needs proving -- no duplicate champions
// visible at once, no immediate repeats, graceful behavior when the roster
// is tiny, and zero dependence on any specific champion id or count -- all
// lives in these functions and is fully exercised here.

import { shuffle, initialSlots, drawNext, nextSequentialSlot } from '../src/hooks/useRosterRotation.js';

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log('  PASS -', label); }
  else { fail++; console.log('  FAIL -', label, detail !== undefined ? '-> ' + JSON.stringify(detail) : ''); }
}

function fakeRoster(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `champ-${i}`, name: `Champ ${i}`, tier: 'A', role: 'Enchanter' }));
}

// ---------------------------------------------------------------------
console.log('\n-- shuffle: pure, non-destructive, same-membership --');
{
  const input = fakeRoster(20);
  const out = shuffle(input);
  check('returns a NEW array (does not mutate input)', out !== input);
  check('input order is untouched', input[0].id === 'champ-0' && input[19].id === 'champ-19');
  check('output has the exact same members as input', 
    JSON.stringify(out.map((c) => c.id).sort()) === JSON.stringify(input.map((c) => c.id).sort()));
  check('output length matches input length', out.length === input.length);
}

// ---------------------------------------------------------------------
console.log('\n-- initialSlots: works at any roster size (future-proofing: 8 -> 9 -> 36 -> 136) --');
for (const size of [0, 1, 5, 8, 9, 20, 36, 136]) {
  const roster = fakeRoster(size);
  const slots = initialSlots(roster, 8);
  const expected = Math.min(8, size);
  check(`roster of ${size} -> exactly ${expected} slot(s) filled`, slots.length === expected, slots.length);
  const ids = slots.map((s) => s.champion.id);
  check(`roster of ${size} -> no duplicate champion across slots`, new Set(ids).size === ids.length);
  check(`roster of ${size} -> every slot starts "visible"`, slots.every((s) => s.phase === 'visible'));
}
check('visibleCount is never a bound on the roster itself -- a 36-champion roster still only fills 8 slots',
  initialSlots(fakeRoster(36), 8).length === 8);
check('no champion ids or counts are hardcoded -- an arbitrary/unfamiliar id set works identically',
  (() => {
    const weird = [{ id: 'brand-new-support-champ', name: 'New Champ', tier: 'S', role: 'Enchanter' }, ...fakeRoster(3)];
    const slots = initialSlots(weird, 8);
    return slots.length === 4 && new Set(slots.map((s) => s.champion.id)).size === 4;
  })());

// ---------------------------------------------------------------------
console.log('\n-- drawNext: no simultaneous duplicates, no immediate repeats, exhausts and reshuffles --');
{
  const fullIds = fakeRoster(10).map((c) => c.id);
  const queueRef = { current: [] };
  const visibleIds = new Set(fullIds.slice(0, 8)); // 8 of 10 currently visible

  const drawn = drawNext(queueRef, visibleIds, fullIds);
  check('draws a champion NOT currently visible', drawn !== null && !visibleIds.has(drawn), drawn);

  // Drain the rest of that same queue fill and confirm every draw avoids the visible set.
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const id = drawNext(queueRef, visibleIds, fullIds);
    if (id) seen.push(id);
  }
  check('every draw across a queue avoids the currently-visible set', seen.every((id) => !visibleIds.has(id)), seen);
}
{
  // Roster barely bigger than visibleCount -- exactly one champion could
  // ever be "next".
  const fullIds = fakeRoster(9).map((c) => c.id);
  const visibleIds = new Set(fullIds.slice(0, 8));
  const queueRef = { current: [] };
  const drawn = drawNext(queueRef, visibleIds, fullIds);
  check('with exactly one non-visible champion available, it is the one drawn', drawn === fullIds[8], drawn);
}
{
  // Roster the SAME size as visibleCount -- nothing new is ever available.
  const fullIds = fakeRoster(8).map((c) => c.id);
  const visibleIds = new Set(fullIds);
  const queueRef = { current: [] };
  const drawn = drawNext(queueRef, visibleIds, fullIds);
  check('roster == visibleCount -> drawNext returns null (graceful no-op, never throws)', drawn === null);
}
{
  check('empty roster -> drawNext returns null, never throws', drawNext({ current: [] }, new Set(), []) === null);
}
{
  // Reshuffle-on-exhaustion: drain a full queue, confirm it refills from
  // the complete roster rather than staying empty or erroring.
  const fullIds = fakeRoster(5).map((c) => c.id);
  const queueRef = { current: [] };
  const drawnAll = [];
  for (let i = 0; i < 5; i++) drawnAll.push(drawNext(queueRef, new Set(), fullIds));
  check('a full drain visits every roster id exactly once before reshuffling',
    new Set(drawnAll).size === 5 && drawnAll.every((id) => fullIds.includes(id)), drawnAll);
  const next = drawNext(queueRef, new Set(), fullIds);
  check('queue reshuffles automatically once exhausted (does not return null forever)', next !== null);
}

// ---------------------------------------------------------------------
console.log('\n-- nextSequentialSlot: deterministic 1 -> 2 -> ... -> 8 -> 1 -> ..., never random --');
{
  // Drive the exact sequence a live rotation would produce over many
  // cycles and confirm it's precisely 0,1,2,...,7,0,1,2,... (which is
  // "Card 1, Card 2, ..., Card 8, Card 1, ..." once displayed 1-indexed).
  let idx = 0; // matches the hook's initial nextSlotIndexRef.current
  const observed = [];
  for (let i = 0; i < 40; i++) { // five full cycles of 8
    observed.push(idx);
    idx = nextSequentialSlot(idx, 8);
  }
  const expected = [];
  for (let i = 0; i < 40; i++) expected.push(i % 8);
  check('40 ticks over an 8-card grid produce exactly 0,1,2,...,7 repeated 5 times',
    JSON.stringify(observed) === JSON.stringify(expected), observed);

  check('wraps from the last card (index 7) back to the first (index 0)', nextSequentialSlot(7, 8) === 0);
  check('never skips a position: every step advances by exactly 1 (mod length)',
    observed.every((v, i) => i === 0 || v === (observed[i - 1] + 1) % 8));
  check('never repeats a position out of turn: no two consecutive ticks share the same index',
    observed.every((v, i) => i === 0 || v !== observed[i - 1]));
}
{
  // Same guarantee at other grid sizes -- this must keep working however
  // many cards are ever visible at once, not just 8.
  for (const length of [1, 2, 5, 8, 12]) {
    let idx = 0;
    const seq = [];
    for (let i = 0; i < length * 3; i++) {
      seq.push(idx);
      idx = nextSequentialSlot(idx, length);
    }
    const ok = seq.every((v, i) => v === i % length);
    check(`length=${length}: three full cycles are exactly 0..${length - 1} repeated`, ok, seq);
  }
}
check('nextSequentialSlot never calls Math.random -- pure arithmetic, verified by source inspection',
  !nextSequentialSlot.toString().includes('random'));
check('length <= 0 is handled without throwing (defensive, matches an empty-roster tick being a no-op)',
  nextSequentialSlot(0, 0) === 0);

// ---------------------------------------------------------------------
console.log('\n-- Distribution sanity: over many draws, no pathological bias toward one champion --');
{
  const fullIds = fakeRoster(6).map((c) => c.id);
  const queueRef = { current: [] };
  const counts = {};
  for (let i = 0; i < 600; i++) {
    const id = drawNext(queueRef, new Set(), fullIds);
    counts[id] = (counts[id] || 0) + 1;
  }
  const values = Object.values(counts);
  check('all 6 champions get drawn at least once over 600 draws', values.length === 6, counts);
  check('no champion is drawn drastically more than others (shuffle-queue, not raw random)',
    Math.max(...values) - Math.min(...values) < 40, counts);
}

console.log(`\n=== RESULTS: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
