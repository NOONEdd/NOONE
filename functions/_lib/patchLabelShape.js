// Patch Notes -- label-shape test shared by the document parser and the change detector. Pure, dependency-free, deterministic.
//
// The generic "is this short non-bullet line the NAME of an ability/effect block?" test has always rejected any line ending in . ! or ?
// because that is what a sentence looks like. Riot's ability names sometimes end in punctuation themselves -- Yuumi's "You and Me!",
// Lulu's "Help, Pix!", Zoe's "Paddle Star!" -- so those names were read as prose, their bullets were extracted correctly but
// attached to NO subsection, and nothing downstream (grouping, the Riot heading, the ability icon) could find the name.
//
// A name that ends in "!" or "?" is accepted ONLY when it is unmistakably title-shaped. This file is the "title-shaped" half; the
// callers add the structural half (the line is followed directly by a list of changes). Both must hold, so a sentence that merely
// ends in "!" ("Let's get into it, everyone!", "Enjoy the new patch!") or a title-cased line that introduces prose is still prose.
//
// "Title-shaped" = typography only, no game knowledge:
//   - at most 6 words and 40 characters, exactly one terminator and it is the last character (a second sentence-ending mark inside
//     the line means it is more than one sentence);
//   - it starts with an uppercase letter or a digit, and every word is Capitalised, a number, or one of a few small joining words
//     (and, of, the, to, ...) -- an ordinary lowercase word ("get", "new", "patch") makes it a sentence.

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "n", "of", "on", "or", "over", "per", "the", "to", "up", "vs", "with"]);
const strip = (s) => String(s || "").replace(/\*+/g, "").replace(/_{2,}/g, "").trim();

export function isPunctuatedTitleLabel(line) {
  const t = strip(line);
  if (!t || t.length > 40) return false;
  if (!/^[^.!?]*[!?]$/.test(t)) return false; // one terminator, at the very end
  const words = t.split(/\s+/);
  if (words.length > 6) return false;
  if (!/^[\p{Lu}\p{N}]/u.test(t)) return false;
  let hasLetter = false;
  for (const raw of words) {
    const w = raw.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[^\p{L}\p{N}]+$/u, "");
    if (!w) continue;
    if (/\p{L}/u.test(w)) hasLetter = true;
    if (SMALL_WORDS.has(w.toLowerCase())) continue;
    if (!/^[\p{Lu}\p{N}]/u.test(w)) return false;
  }
  return hasLetter;
}
