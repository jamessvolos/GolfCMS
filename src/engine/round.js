// 9-hole rounds: one seed fans out into nine certified holes with a shaped
// difficulty curve — a gentle opener, a mid-round bite, and a rude closer.

import { substream } from './rng.js';
import { makePuzzle } from './puzzle.js';

export const ROUND_CURVE = [
  'easy', 'standard', 'standard',
  'standard', 'rude', 'standard',
  'standard', 'standard', 'rude',
];

/**
 * @param {number} seed
 * @param {string} [biome]
 * @returns {{seed: number, biome: string, holes: import('./puzzle.js').Puzzle[], totalPar: number}}
 */
export function makeRound(seed, biome = 'classic') {
  const rng = substream(seed, 'round');
  const holes = [];
  const used = new Set();
  for (let i = 0; i < 9; i++) {
    let holeSeed = Math.floor(rng() * 0xffffffff) >>> 0;
    let p = makePuzzle(holeSeed, ROUND_CURVE[i], biome);
    // makePuzzle rerolls forward, so two draws can certify to the same seed;
    // walk forward deterministically until the hole is distinct.
    while (used.has(p.seed)) {
      holeSeed = (p.seed + 1) >>> 0;
      p = makePuzzle(holeSeed, ROUND_CURVE[i], biome);
    }
    used.add(p.seed);
    holes.push(p);
  }
  return {
    seed: seed >>> 0,
    biome,
    holes,
    totalPar: holes.reduce((sum, h) => sum + h.par, 0),
  };
}

/** Scorecard math: strokes vs par with golf-standard naming. */
export function scorecard(round, strokes) {
  const entries = round.holes.map((h, i) => ({
    hole: i + 1,
    par: h.par,
    strokes: strokes[i] ?? null,
  }));
  const played = entries.filter((e) => e.strokes !== null);
  const totalStrokes = played.reduce((s, e) => s + e.strokes, 0);
  const parSoFar = played.reduce((s, e) => s + e.par, 0);
  return {
    entries,
    totalStrokes,
    parSoFar,
    vsPar: totalStrokes - parSoFar,
    complete: played.length === round.holes.length,
  };
}
