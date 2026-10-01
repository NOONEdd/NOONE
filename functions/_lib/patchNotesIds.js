// Patch Notes -- stable deterministic identity.
//
// A change's ID must survive: UI re-renders, report regeneration, parser
// improvements that don't change WHAT Riot said, unrelated changes being
// added, and the reviewer editing the display text. So it is a pure hash
// of STRUCTURAL identity -- patch version, owner scope, the section path
// the change sits under, and a value-free change identity (ability, stat
// label / effect text, change class) -- never of a random UUID, an array
// index, or the human-editable display text. The CONTENT (the old/new
// numbers) goes into a separate `sourceFingerprint`: if Riot's own text for
// the same structural slot changes between fetches, the ID stays (so
// review state is kept) and the fingerprint mismatch flags the change as
// "source changed since review" instead of silently keeping a stale edit.
//
// No crypto / no I/O (works identically in Node tests and Workers):
// two independent 32-bit string hashes joined into 16 hex chars.

export const PATCH_NOTES_SCHEMA = "patch-notes-v1";

/** Lowercase, unify quotes/arrows, strip markdown and punctuation noise,
 *  collapse whitespace. Used for identity + fingerprints, never for display. */
export function normText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\u2018\u2019`\u00B4]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2192|\u21D2|=>|->/g, ">")
    .replace(/[*_]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compact alphanumeric form of an entity/heading name ("Kha'Zix" -> "khazix"). */
export function normName(value) {
  return String(value ?? "").toLowerCase().replace(/[\u2018\u2019`\u00B4]/g, "'").replace(/[^a-z0-9]+/g, "");
}

function hash32a(str) { // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function hash32b(str) { // djb2 variant with a different seed/multiplier (independent enough to make a 64-bit id)
  let h = 5381 ^ 0x9e3779b9;
  for (let i = str.length - 1; i >= 0; i--) { h = (Math.imul(h, 33) + str.charCodeAt(i)) >>> 0; h ^= h >>> 15; }
  return h >>> 0;
}

/** 16-hex-char deterministic hash of a string. */
export function hash64(str) {
  const s = String(str);
  return hash32a(s).toString(16).padStart(8, "0") + hash32b(s).toString(16).padStart(8, "0");
}

/** Fingerprint of the exact source wording (whitespace/markdown-insensitive). */
export function sourceFingerprint(originalSourceText) {
  return "fp_" + hash64(normText(originalSourceText));
}

const SEP = "\u241F";

/** `identity` is a value-free string describing WHAT slot this is (built by
 *  the extractor from ability/group/stat or effect text); `sectionPath` is
 *  the heading path below the document title. */
export function buildChangeId({ patchVersion, scopeKey, sectionPath, identity }) {
  const path = (sectionPath || []).map(normText).join(">");
  return "pn_" + hash64([normText(patchVersion), scopeKey || "", path, normText(identity)].join(SEP));
}
