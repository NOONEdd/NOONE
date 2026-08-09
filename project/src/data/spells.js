// Wild Rift summoner spells (support-relevant subset). Smite is jungle-only
// and Teleport is accessed via an item rather than a base spell slot in
// Wild Rift, so neither is included here.
export const SPELLS = [
  { id: "flash", name: "Flash" },
  { id: "ignite", name: "Ignite" },
  { id: "heal", name: "Heal" },
  { id: "barrier", name: "Barrier" },
  { id: "exhaust", name: "Exhaust" },
  { id: "ghost", name: "Ghost" },
];

const SPELL_NAMES = new Set(SPELLS.map((s) => s.name.toLowerCase()));

/** Given a build-row name like "Flash + Ignite", "Ignite (swap for
 *  Heal)", or just "Heal", returns the recognized spell name(s) as an
 *  array once any trailing "(...)" annotation is stripped -- one entry
 *  for a single spell, two for a "+" combo -- or null if any piece isn't
 *  a recognized spell name, so the caller can fall back to plain text. */
export function splitSpellNames(name) {
  const cleaned = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const parts = cleaned.split(/\s*\+\s*/).map((p) => p.trim());
  const allRecognized = parts.length > 0 && parts.every((p) => SPELL_NAMES.has(p.toLowerCase()));
  return allRecognized ? parts : null;
}
