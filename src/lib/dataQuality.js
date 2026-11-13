// Academy record data quality. Pure, dependency-free (shared by the AI Coach backend and anything else that needs it).
//
// A record's IDENTITY is always real: its id, name, type, category/path, and structured relationships such as `upgradeOf`.
// Its descriptive / mechanical text (`info`: stats, numbers, effects) may not be. `dataStatus: "unverified"` on any champion,
// item or rune record says exactly that: "this entity exists and is related to these others, but its mechanical data has not
// been verified". An absent `dataStatus` means verified -- every record without the field behaves exactly as before.
//
// WHO HONOURS IT: consumers that treat Academy text as EVIDENCE for a factual claim -- the AI Coach
// (functions/_lib/extractItemRuneContext.js, academyCoverage.js, buildPrompt.js) -- must not use an unverified record's text
// as facts. Consumers that only need identity (Patch Notes matching and display, builds, images, tier lists) ignore it.
// To mark data as verified once real, sourced values have been written into the record: remove the field.

export const DATA_STATUS = Object.freeze({ VERIFIED: "verified", UNVERIFIED: "unverified" });

/** "verified" unless the record explicitly says "unverified". */
export function dataStatusOf(record) {
  return record && record.dataStatus === DATA_STATUS.UNVERIFIED ? DATA_STATUS.UNVERIFIED : DATA_STATUS.VERIFIED;
}

/** May this record's descriptive / mechanical text be used as evidence for a factual claim? */
export function hasVerifiedFacts(record) {
  return dataStatusOf(record) === DATA_STATUS.VERIFIED;
}
