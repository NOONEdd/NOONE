// decisionLab -- seeded PRNG. The ONLY source of randomness in the engine.
//
// Design:
//  - xoshiro128** over four 32-bit words, seeded by splitmix32 from a hash
//    of `${seed}|${path}`. Pure 32-bit integer math (Math.imul, >>> 0), so it
//    behaves identically on every JavaScript runtime.
//  - Named sub-streams: createRng(seed, "a/b") is independent of how many
//    values any other path has consumed. A stage that needs its own stream
//    calls rng.fork("stageName"); adding a draw in one stage never shifts
//    another stage's values.
//  - No Math.random, no clocks, no environment access.

/** FNV-1a over UTF-16 code units, finished with the murmur3 avalanche. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Canonical string for a seed. Integers and strings are distinct
 *  namespaces (1 vs "1"); anything else is a programming error. */
export function seedToString(seed) {
  if (typeof seed === "number" && Number.isSafeInteger(seed)) return `i:${seed}`;
  if (typeof seed === "string" && seed.length > 0) return `s:${seed}`;
  throw new TypeError("decisionLab seed must be a safe integer or a non-empty string");
}

function splitmix32(a) {
  let state = a | 0;
  return function next() {
    state = (state + 0x9e3779b9) | 0;
    let t = state ^ (state >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

function rotl(x, k) {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Create a generator for (seed, path). `path` names the sub-stream. */
export function createRng(seed, path = "root") {
  const seedStr = seedToString(seed);
  const sm = splitmix32(hash32(`${seedStr}|${path}`));
  let s0 = sm();
  let s1 = sm();
  let s2 = sm();
  let s3 = sm();
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1; // xoshiro state must not be all zero

  function u32() {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  }

  const rng = {
    seed,
    path,
    u32,

    /** Uniform integer in [min, max], inclusive, without modulo bias. */
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new RangeError(`rng.int(${min}, ${max}) needs integers with max >= min`);
      }
      const n = max - min + 1;
      if (n === 1) return min;
      if (n > 0x100000000) throw new RangeError("rng.int range too large");
      const limit = Math.floor(0x100000000 / n) * n;
      let x = u32();
      while (x >= limit) x = u32();
      return min + (x % n);
    },

    /** True with probability numerator/denominator (integers). */
    chance(numerator, denominator) {
      return rng.int(0, denominator - 1) < numerator;
    },

    pick(items) {
      if (!Array.isArray(items) || items.length === 0) throw new RangeError("rng.pick needs a non-empty array");
      return items[rng.int(0, items.length - 1)];
    },

    /** items[i] chosen with probability weights[i] / sum(weights).
     *  Weights are non-negative integers with a positive sum. */
    weightedPick(items, weights) {
      if (items.length !== weights.length || items.length === 0) throw new RangeError("weightedPick length mismatch");
      let total = 0;
      for (const w of weights) {
        if (!Number.isInteger(w) || w < 0) throw new RangeError("weights must be non-negative integers");
        total += w;
      }
      if (total <= 0) throw new RangeError("weights must have a positive sum");
      let r = rng.int(0, total - 1);
      for (let i = 0; i < items.length; i++) {
        if (r < weights[i]) return items[i];
        r -= weights[i];
      }
      return items[items.length - 1];
    },

    /** Fisher-Yates over a copy; the input is not modified. */
    shuffle(items) {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    },

    /** Independent sub-stream. Depends only on (seed, path, label), never
     *  on how many values this generator has already produced. */
    fork(label) {
      return createRng(seed, `${path}/${label}`);
    },
  };
  return rng;
}

/** 32-bit derived seed for (seed, label). */
export function derive(seed, label) {
  return hash32(`${seedToString(seed)}|${label}`);
}
