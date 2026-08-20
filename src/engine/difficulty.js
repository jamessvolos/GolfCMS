// Human-facing difficulty: solver par says what the robot shot; stars say
// how it will feel. The estimate comes from certificate metrics, and the
// calibration layer corrects it against the player's own recorded rounds —
// Mulligan's "predicted vs actual" loop, scaled down to localStorage.

import { ROUGH, SAND } from './terrain.js';
import { cellAt } from './course.js';

/**
 * Rate a certified puzzle 1–5 stars.
 * Inputs are all facts the puzzle already carries — no re-solving needed.
 * @param {import('./puzzle.js').Puzzle} puzzle
 * @returns {number} 1..5 in 0.5 steps
 */
export function estimateStars(puzzle) {
  let stars = 1 + (puzzle.par - 2) * 0.75; // par 2 → 1★ base, par 6 → 4★
  const lie = cellAt(puzzle.course, puzzle.start.x, puzzle.start.y);
  if (lie === ROUGH || lie === SAND) stars += 0.5; // recovery start
  if (puzzle.difficulty === 'rude') stars += 0.5;
  const wind = puzzle.course.wind ?? { x: 0, y: 0 };
  stars += 0.5 * Math.max(Math.abs(wind.x), Math.abs(wind.y)); // links gusts
  if (puzzle.biome === 'winter' || puzzle.biome === 'alpine') stars += 0.5;
  return Math.max(1, Math.min(5, Math.round(stars * 2) / 2));
}

/** Render stars like ★★★½. */
export function starLabel(stars) {
  return '★'.repeat(Math.floor(stars)) + (stars % 1 ? '½' : '');
}

/**
 * Calibrate estimates against the player's own history: average strokes-
 * over-par across recorded rounds, overall and for the given star band.
 * @param {Array<{strokes: number, par: number, stars?: number}>} rounds
 * @param {number} stars band to inspect
 * @returns {{samples: number, avgOver: number, verdict: string}}
 */
export function calibration(rounds, stars) {
  const band = rounds.filter((r) => r.stars !== undefined && Math.abs(r.stars - stars) <= 0.5);
  if (band.length < 3) return { samples: band.length, avgOver: 0, verdict: '' };
  const avgOver = band.reduce((s, r) => s + (r.strokes - r.par), 0) / band.length;
  const verdict =
    avgOver >= 1.5 ? 'plays harder than rated for you'
    : avgOver <= 0.25 ? 'plays easier than rated for you'
    : 'rating matches your results';
  return { samples: band.length, avgOver: +avgOver.toFixed(2), verdict };
}
