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

/** Given a build-row name like "Flash + Ignite" or "Flash + Ignite (swap
 *  for Heal)", returns ["Flash", "Ignite"] if every piece is a recognized
 *  spell name once any trailing "(...)" annotation is stripped, otherwise
 *  returns null so the caller can fall back to plain text. */
export function splitSpellNames(name) {
  const cleaned = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const parts = cleaned.split(/\s*\+\s*/).map((p) => p.trim());
  if (parts.length < 2) return null;
  const allRecognized = parts.every((p) => SPELL_NAMES.has(p.toLowerCase()));
  return allRecognized ? parts : null;
}
