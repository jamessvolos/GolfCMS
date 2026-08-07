// Puzzle assembly: course + certified ball start + computed par.
// "The lie is the puzzle statement; the course is just the board" — ball
// starts are sampled from the interesting frontier and every published
// puzzle carries a solver certificate proving it can be beaten.

import { substream, randInt } from './rng.js';
import { generateCourse } from './generate.js';
import { solve, verifyLine } from './solver.js';
import { ROUGH, SAND, GREEN, WATER, TREES, isRestable } from './terrain.js';
import { cellAt, inBounds, dist } from './course.js';

export const DIFFICULTIES = ['easy', 'standard', 'rude'];

/**
 * @typedef {{
 *   seed: number, difficulty: string,
 *   course: import('./course.js').Course,
 *   start: {x: number, y: number},
 *   par: number,
 *   certificate: {strokes: number, line: Array<{club: string, angle: number, power: number}>}
 * }} Puzzle
 */

/**
 * Build a certified puzzle. Unsolvable or degenerate seeds reroll
 * deterministically (seed+1, seed+2, ...) so every input seed yields a
 * playable puzzle, and the same input always yields the same puzzle.
 * @param {number} seed
 * @param {string} [difficulty]
 * @returns {Puzzle}
 */
export function makePuzzle(seed, difficulty = 'standard') {
  for (let attempt = 0; attempt < 32; attempt++) {
    const effectiveSeed = (seed + attempt) >>> 0;
    const course = generateCourse(effectiveSeed);
    const start = sampleBallStart(course, difficulty);
    if (!start) continue;
    const solution = solve(course, start);
    if (!solution) continue;
    if (solution.strokes < 2 || solution.strokes > 7) continue; // trivial or miserable
    return {
      seed: effectiveSeed,
      difficulty,
      course,
      start,
      par: solution.strokes,
      certificate: solution,
    };
  }
  throw new Error(`no certifiable puzzle within 32 rerolls of seed ${seed}`);
}

/**
 * The interesting-lie sampler. A candidate start must be:
 * - restable, off the green, a real distance from the hole;
 * - engaged with the course: the direct line to the hole crosses a hazard,
 *   or the lie itself is trouble (rough/sand recovery lies);
 * - for 'easy', simply the tee. For 'rude', trouble is required.
 * Returns null if no candidate passes — caller rerolls the course.
 */
export function sampleBallStart(course, difficulty) {
  if (difficulty === 'easy') return { ...course.tee };
  const rng = substream(course.seed, 'ballstart:' + difficulty);
  for (let tries = 0; tries < 60; tries++) {
    const candidate =
      difficulty === 'rude'
        ? { x: randInt(rng, 2, course.width - 4), y: randInt(rng, 1, course.height - 2) }
        : {
            // standard: near the tee band, like a wayward opening drive
            x: Math.min(course.width - 4, course.tee.x + randInt(rng, 0, 6)),
            y: Math.min(course.height - 2, Math.max(1, course.tee.y + randInt(rng, -4, 4))),
          };
    if (!inBounds(course, candidate.x, candidate.y)) continue;
    const lie = cellAt(course, candidate.x, candidate.y);
    if (!isRestable(lie) || lie === GREEN) continue;
    if (dist(candidate, course.hole) < 12) continue;

    const inTrouble = lie === ROUGH || lie === SAND;
    if (difficulty === 'rude' && !inTrouble) continue;
    if (difficulty === 'standard' && !inTrouble && !lineCrossesHazard(course, candidate)) {
      continue; // open-field lies with a clean line are boring — reject
    }
    return candidate;
  }
  return null;
}

/** Does the straight line from the lie to the hole cross water, sand, or trees? */
export function lineCrossesHazard(course, from) {
  const to = course.hole;
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  for (let i = 1; i < steps; i++) {
    const x = Math.round(from.x + ((to.x - from.x) * i) / steps);
    const y = Math.round(from.y + ((to.y - from.y) * i) / steps);
    const t = cellAt(course, x, y);
    if (t === WATER || t === SAND || t === TREES) return true;
  }
  return false;
}

/** Re-verify a puzzle's certificate against the real engine. */
export function verifyPuzzle(puzzle) {
  return verifyLine(puzzle.course, puzzle.start, puzzle.certificate.line);
}

/** The shared daily seed: everyone on Earth gets the same hole today. */
export function dailySeed(date = null) {
  const d = date ?? isoToday();
  const [y, m, day] = d.split('-').map(Number);
  const days = Math.floor(Date.UTC(y, m - 1, day) / 86400000);
  // Spread consecutive days across seed space so neighbors don't correlate.
  return Math.imul(days, 2654435761) >>> 0;
}

export function dailyNumber(date = null) {
  const d = date ?? isoToday();
  const [y, m, day] = d.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, day) / 86400000) - 20671; // #1 on 2026-08-07
}

/** The daily ritual: Mon/Tue easy-standard, weekend turns rude. */
export function dailyPuzzle(date = null) {
  const d = date ?? isoToday();
  const seed = dailySeed(d);
  const [y, m, day] = d.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  const difficulty = dow === 6 ? 'rude' : dow === 1 || dow === 2 ? 'easy' : 'standard';
  return makePuzzle(seed, difficulty);
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}
