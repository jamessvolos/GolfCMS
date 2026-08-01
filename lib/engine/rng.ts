/**
 * Deterministic RNG so evaluations are reproducible and testable.
 * mulberry32 for uniforms, Box–Muller for standard normals.
 */

/** Uniform [0, 1) generator seeded with a 32-bit integer. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * n pairs of independent standard normals, laid out [z0a, z0b, z1a, z1b, ...].
 * Pair i drives sample i (longitudinal, lateral). Sharing one buffer across
 * many aim evaluations gives common random numbers, which keeps the
 * expected-strokes surface smooth for contouring and argmin.
 */
export function createNormalPairs(seed: number, n: number): Float64Array {
  const rng = createRng(seed);
  const out = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    let u1 = rng();
    if (u1 <= 1e-12) u1 = 1e-12;
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    out[2 * i] = r * Math.cos(2 * Math.PI * u2);
    out[2 * i + 1] = r * Math.sin(2 * Math.PI * u2);
  }
  return out;
}
