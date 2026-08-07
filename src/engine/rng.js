// Seeded RNG for the whole game. mulberry32: tiny, fast, deterministic.
// Every random decision in the engine flows through one of these streams,
// so a 32-bit seed fully reproduces a course, its ball start, and its scatter.

/** @param {number} seed @returns {() => number} uniform in [0, 1) */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive an independent named substream so new features never reshuffle old ones. */
export function substream(seed, name) {
  let h = seed >>> 0;
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 2654435761) >>> 0;
  }
  return mulberry32(h);
}

/** Integer in [min, max] inclusive. */
export function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** @template T @param {() => number} rng @param {T[]} arr @returns {T} */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** Weighted choice: entries are [value, weight]. */
export function pickWeighted(rng, entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rng() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r <= 0) return v;
  }
  return entries[entries.length - 1][0];
}
