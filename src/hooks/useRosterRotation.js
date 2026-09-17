import { useEffect, useMemo, useRef, useState } from "react";

// How often ONE slot rotates (not all of them at once -- see useRosterRotation
// below), and how long the fade/translate/scale transition takes. Keep
// TRANSITION_MS in sync with .roster-slot's CSS transition-duration in
// src/index.css -- this is what makes the "swap the champion while offstage,
// then reveal" sequencing land cleanly instead of racing the CSS.
const ROTATE_EVERY_MS = 4200;
const TRANSITION_MS = 520;

export function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function initialSlots(roster, visibleCount) {
  const count = Math.min(visibleCount, roster.length);
  return shuffle(roster)
    .slice(0, count)
    .map((champion, i) => ({ id: i, champion, phase: "visible" }));
}

/** Pops the next champion id to rotate in from the shared shuffled queue,
 *  skipping (and re-queuing) anything already visible in another slot right
 *  now -- this is what guarantees the same champion is never shown in two
 *  cards simultaneously. Reshuffles a fresh queue from the full roster once
 *  exhausted, which is also what naturally prevents a champion from
 *  reappearing until the rest of the roster has had its turn. Returns null
 *  when there's genuinely nothing new available (e.g. the roster is barely
 *  bigger than `visibleCount`) -- callers treat that as a no-op tick. */
export function drawNext(queueRef, excludeIds, fullRosterIds) {
  if (fullRosterIds.length === 0) return null;
  if (queueRef.current.length === 0) queueRef.current = shuffle(fullRosterIds);

  let guard = 0;
  while (queueRef.current.length > 0 && excludeIds.has(queueRef.current[0]) && guard < fullRosterIds.length) {
    queueRef.current.push(queueRef.current.shift());
    guard++;
  }
  if (queueRef.current.length === 0 || excludeIds.has(queueRef.current[0])) return null;
  return queueRef.current.shift();
}

/** Pure step function for the deterministic left-to-right slot cycle: given
 *  the slot index used on the previous tick, returns the index to use next
 *  -- 0, 1, 2, ..., length-1, then back to 0. This single function is the
 *  entire "Card 1 -> Card 2 -> ... -> Card 8 -> Card 1 -> ..." guarantee;
 *  useRosterRotation just calls it once per tick. No Math.random(), no
 *  shuffling, nothing roster-dependent -- pure arithmetic on the slot
 *  count, so it's directly testable without driving the hook's timers. */
export function nextSequentialSlot(previousIndex, length) {
  if (length <= 0) return 0;
  return (previousIndex + 1) % length;
}

/** Drives the Home page's rotating Support roster teaser (see
 *  src/pages/HomePage.jsx's "Full Roster Coverage" section). Takes the
 *  exact same effective, already-filtered champion list the rest of the
 *  app uses (App.jsx's `academyChampions = champions.filter(isAcademyCovered)`)
 *  as `roster` -- this hook never decides who counts as a Support champion,
 *  never hardcodes an id, and never assumes a count. `visibleCount` only
 *  caps how many cards show at once; it is never a bound on the roster
 *  itself, so the exact same code keeps working whether the roster has 8,
 *  20, or 136 champions in it.
 *
 *  Returns `slots`: a FIXED-length, fixed-position array of
 *  `{ id, champion, phase }`. A slot's `id` (really just its index) never
 *  changes and is meant as the React key for the slot WRAPPER, so the grid
 *  itself never reorders or reflows -- only which champion a slot holds,
 *  and that slot's `phase` ("visible" | "hidden"), change over time. Map
 *  `phase` to a CSS class in the caller; see src/index.css's `.roster-slot`
 *  / `.roster-slot-offstage`.
 *
 *  Rotation is a single interval that, each tick, fades exactly one slot
 *  to "hidden", swaps in the next champion from the shuffled queue once
 *  that fade has actually completed, then fades it back to "visible" -- so
 *  at most one card is ever mid-transition, the other seven stay
 *  untouched, and nothing crossfades or slides as a batch. WHICH slot
 *  rotates each tick is a plain sequential counter over slot positions
 *  (0, 1, 2, ..., visibleCount-1, 0, 1, ...) -- left-to-right, wrapping
 *  after the last card, never randomized and never re-derived from
 *  Math.random(). This is deliberately a separate concern from WHICH
 *  champion fills that slot (still the shuffled, no-repeat-visible draw
 *  queue below) -- the fixed left-to-right order only governs position. */
export function useRosterRotation(roster, visibleCount) {
  // Identity for "the current SET of covered champions" -- changes only
  // when a champion is genuinely added to or removed from the roster, not
  // on every KV sync tick (which produces a brand-new `roster` array
  // reference whenever unrelated Coach Mode data changes elsewhere, even
  // though the actual set of covered ids is identical). This is what lets
  // the rotation react to a real roster change without restarting itself
  // on every unrelated re-render.
  const rosterKey = useMemo(() => roster.map((c) => c.id).sort().join(","), [roster]);
  const rosterRef = useRef(roster);
  rosterRef.current = roster;

  const [slots, setSlots] = useState(() => initialSlots(roster, visibleCount));
  const slotsRef = useRef(slots);
  const queueRef = useRef([]);
  // Deterministic left-to-right cycle position: slot 0, then 1, then 2, ...
  // wrapping back to 0 after the last visible slot. Plain counter, no
  // randomness -- see the doc comment above.
  const nextSlotIndexRef = useRef(0);

  function commit(next) {
    slotsRef.current = next;
    setSlots(next);
  }

  // A genuine roster change re-seeds the whole teaser from scratch, and
  // restarts the left-to-right cycle at slot 0 (Card 1) so the sequence is
  // always predictable from the start of a fresh cycle. Guarded by
  // rosterKey (not the raw `roster` reference), so this does not fire on
  // every render.
  useEffect(() => {
    queueRef.current = [];
    nextSlotIndexRef.current = 0;
    commit(initialSlots(rosterRef.current, visibleCount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey, visibleCount]);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" && typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Nothing to rotate in if motion is disabled, or if the roster isn't
    // meaningfully bigger than what's already on screen.
    if (reduced || rosterRef.current.length <= visibleCount) return undefined;

    let cancelled = false;
    const timeouts = [];
    const schedule = (fn, ms) => {
      const t = setTimeout(fn, ms);
      timeouts.push(t);
      return t;
    };

    const interval = setInterval(() => {
      const current = slotsRef.current;
      if (current.length === 0) return;

      // Fixed left-to-right order: 1 -> 2 -> ... -> visibleCount -> 1 -> ...
      // No Math.random(), no shuffling, no skipping -- each tick advances
      // exactly one position from wherever the last tick left off.
      const idx = nextSlotIndexRef.current;
      nextSlotIndexRef.current = nextSequentialSlot(idx, current.length);

      const visibleIds = new Set(current.map((s) => s.champion?.id).filter(Boolean));
      const nextId = drawNext(queueRef, visibleIds, rosterRef.current.map((c) => c.id));
      if (!nextId) return; // roster too small to bring in anything new this tick
      const nextChampion = rosterRef.current.find((c) => c.id === nextId);
      if (!nextChampion) return;

      commit(slotsRef.current.map((s, i) => (i === idx ? { ...s, phase: "hidden" } : s)));

      schedule(() => {
        if (cancelled) return;
        // Swap the champion in while still offstage -- invisible to the
        // viewer, but this is also the moment SmartImage's own fallback
        // state should reset for the new champion rather than carrying
        // over the previous one's, which is why the slot's key changes too
        // (see the render side in HomePage.jsx).
        commit(slotsRef.current.map((s, i) => (i === idx ? { ...s, champion: nextChampion } : s)));
        schedule(() => {
          if (cancelled) return;
          // One more tick later so the browser has actually painted the
          // "new champion, still offstage" frame -- otherwise the offstage
          // -> onstage change would collapse into the same commit as the
          // content swap and never animate.
          commit(slotsRef.current.map((s, i) => (i === idx ? { ...s, phase: "visible" } : s)));
        }, 30);
      }, TRANSITION_MS);
    }, ROTATE_EVERY_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
      timeouts.forEach(clearTimeout);
    };
  }, [rosterKey, visibleCount]);

  return slots;
}
