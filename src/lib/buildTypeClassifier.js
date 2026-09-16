// Core/Situational classification for Champion Build item/rune entries --
// the single source of truth for this logic, used by AdminPage.jsx's
// migration Preview, Apply, and post-Apply verification, and safe to reuse
// anywhere else that ever needs to answer "what type should this entry be".
//
// This does NOT run on every page load or every render of the public
// Champion Build UI -- BuildBoard.jsx and BuildEditor.jsx read `entry.type`
// directly, exactly as authored/migrated. This module only exists to
// (a) let BuildEditor default a brand-new row to "core", and (b) power the
// one-time, admin-triggered KV migration in AdminPage.jsx. It never mutates
// its inputs -- every function here returns new data.
//
// The classification rule below is the exact policy approved during the
// Core/Situational data audit (chat, not reproduced here) after a
// per-entry review of all 654 live KV build entries -- not a blanket
// "category X = core" shortcut. In summary:
//   1. An entry that already has a valid type ("core" or "situational") is
//      left completely alone -- this is what makes the migration
//      idempotent and what lets an admin's manual BuildEditor edit always
//      win over anything this file would otherwise guess.
//   2. A tag that literally says "core" (any case) -> core.
//   3. A tag that literally says "situational", or one of its known
//      hand-typed variants (situatinal / situatuinal / sitatuinal) -> situational.
//   4. An entry with an explicit swap/alternative signal -- tag is
//      "Rune Swap" / "Spell Swap", tag names a matchup condition like
//      "Boots vs AD" / "vs AP", tag itself says "swap for X", or the NAME
//      says "(swap for X)" / "(instead of X)" -- is always the alternative
//      being offered, so -> situational. This is read directly off the
//      entry's own wording, never inferred from its tag's category.
//   5. Anything else -- a bare category tag such as "Always", "Boots",
//      "Keystone", "Resolve", "Domination", "Inspiration",
//      "Summoner Spells", "Enchant", "Precision", or a tag that's actually
//      a data-entry slip (tag == the item's own name) -- is the default/
//      recommended pick for its slot with no competing alternative offered
//      anywhere in the same build, so -> core. Verified during the audit by
//      checking every such tag for (a) a same-build entry naming it as a
//      swap target and (b) repeated bare-category tags within one build,
//      which always turned out to be separate simultaneous rune-tree slots
//      (e.g. three different Resolve minor runes), never competing
//      alternatives for one slot.
//
// `tag` is never read, written, or renamed by anything in this file beyond
// the read-only checks above -- it stays exactly as authored, since the AI
// Coach's grounding (functions/_lib/extractChampionContext.js) and
// BuildBoard's spell-combo detection both depend on it unchanged.

const VALID_TYPES = new Set(["core", "situational"]);
const EXACT_SITUATIONAL_TAGS = new Set(["situational", "situatinal", "situatuinal", "sitatuinal"]);

/** Classifies one item/rune entry. Returns "core" or "situational" --
 *  always one of the two, never null/undefined, per the approved policy
 *  (there is no longer an "unresolved" outcome; see the audit). Preserves
 *  an already-valid `entry.type` untouched -- this single line is what
 *  guarantees a manual admin edit always wins and reruns are idempotent. */
export function classifyBuildEntryType(entry) {
  if (entry && VALID_TYPES.has(entry.type)) return entry.type;
  const tag = String(entry?.tag ?? "").trim().toLowerCase();
  const name = String(entry?.name ?? "").trim().toLowerCase();

  if (tag === "core") return "core";
  if (EXACT_SITUATIONAL_TAGS.has(tag)) return "situational";
  if (tag === "rune swap" || tag === "spell swap") return "situational";
  if (tag.includes("vs ad") || tag.includes("vs ap")) return "situational";
  if (tag.includes("swap for")) return "situational";
  if (name.includes("(swap for") || name.includes("(instead of") || name.includes("swap for") || name.includes("instead of")) {
    return "situational";
  }
  return "core";
}

/** Normalizes one build's items/runes lists. Never mutates `build`; returns
 *  the SAME `build` reference back untouched when nothing needs changing
 *  (so callers can cheaply tell "did this build actually change" via
 *  `result.build === build`), or a shallow copy with new items/runes
 *  arrays when at least one entry needed a `type` added. An entry that
 *  needed no change keeps its exact original object reference too. */
export function normalizeBuildEntries(build) {
  let itemsChanged = 0, runesChanged = 0, coreCount = 0, situationalCount = 0;

  function normalizeList(list) {
    let changed = 0;
    const next = (list || []).map((entry) => {
      const before = VALID_TYPES.has(entry.type) ? entry.type : null;
      const finalType = classifyBuildEntryType(entry);
      if (finalType === "core") coreCount++; else situationalCount++;
      if (before === finalType) return entry;
      changed++;
      return { ...entry, type: finalType };
    });
    return { next, changed };
  }

  const items = normalizeList(build.items);
  const runes = normalizeList(build.runes);
  itemsChanged = items.changed;
  runesChanged = runes.changed;
  const changed = itemsChanged > 0 || runesChanged > 0;

  return {
    build: changed ? { ...build, items: items.next, runes: runes.next } : build,
    itemsChanged,
    runesChanged,
    coreCount,
    situationalCount,
    changed,
  };
}

/** Plans the migration across a raw `overrides.champions` map (the exact
 *  shape returned by useCoachOverrides()'s `overrides` state / the raw
 *  KV override object -- NOT the resolved/effective champions array).
 *  Pure and read-only: never calls updateOverride, never mutates its
 *  inputs. Safe to call for both Preview (discard the result) and Apply
 *  (feed `plan.champions` to updateOverride) -- this is deliberate, so
 *  Preview and Apply are always looking at literally the same logic and
 *  Apply always recomputes fresh against the current live state rather
 *  than trusting a possibly-stale Preview snapshot.
 *
 *  `validChampionIds` is a Set of real static champion ids (callers pass
 *  `new Set(champions.map(c => c.id))`) -- this is what separates a champion
 *  override that's actually queued for normalization from a stale/orphaned
 *  key (e.g. a champion id that no longer exists, or was never a real one)
 *  which is reported but never written to. */
export function planBuildTypeMigration(overridesChampions, validChampionIds) {
  const champions = [];
  const staleKeys = [];

  for (const [id, override] of Object.entries(overridesChampions || {})) {
    const builds = override?.builds;
    if (!Array.isArray(builds) || builds.length === 0) continue; // no KV builds override -- falls back to static, already typed, nothing to do

    if (!validChampionIds.has(id)) {
      staleKeys.push({ id, buildCount: builds.length });
      continue;
    }

    let itemsChanged = 0, runesChanged = 0, coreCount = 0, situationalCount = 0, anyChanged = false;
    const newBuilds = builds.map((b) => {
      const r = normalizeBuildEntries(b);
      itemsChanged += r.itemsChanged;
      runesChanged += r.runesChanged;
      coreCount += r.coreCount;
      situationalCount += r.situationalCount;
      if (r.changed) anyChanged = true;
      return r.build;
    });

    if (anyChanged) {
      champions.push({ id, newBuilds, itemsChanged, runesChanged, coreCount, situationalCount });
    }
  }

  const totals = champions.reduce(
    (acc, c) => ({
      itemsChanged: acc.itemsChanged + c.itemsChanged,
      runesChanged: acc.runesChanged + c.runesChanged,
      coreCount: acc.coreCount + c.coreCount,
      situationalCount: acc.situationalCount + c.situationalCount,
    }),
    { itemsChanged: 0, runesChanged: 0, coreCount: 0, situationalCount: 0 }
  );

  return { champions, staleKeys, totals };
}

/** Verification pass: confirms every item/rune entry, for every real
 *  champion id with a non-empty KV builds override, has a valid canonical
 *  `type`. Returns the list of entries that don't (expected to be empty
 *  immediately after an Apply). Stale/orphaned keys are intentionally out
 *  of scope here, same as in the plan -- they're reported separately, never
 *  expected to be typed. */
export function verifyAllEntriesTyped(overridesChampions, validChampionIds) {
  const invalid = [];
  for (const [id, override] of Object.entries(overridesChampions || {})) {
    if (!validChampionIds.has(id)) continue;
    const builds = override?.builds;
    if (!Array.isArray(builds)) continue;
    builds.forEach((build, buildIndex) => {
      for (const section of ["items", "runes"]) {
        (build[section] || []).forEach((entry, index) => {
          if (!VALID_TYPES.has(entry.type)) {
            invalid.push({ champion: id, build: build.name, buildIndex, section, index, tag: entry.tag, name: entry.name });
          }
        });
      }
    });
  }
  return invalid;
}
