/**
 * Candidate-grid search for the optimal aim point.
 *
 * A regular cell grid (so the same values feed d3-contour isolines later)
 * over the reachable area: radius up to max-club carry × 1.15, angularly
 * bounded around the ball→pin corridor. Every in-sector cell is evaluated
 * with common random numbers; optimal = argmin.
 *
 * The reference aim (rating seed) is the shot a player makes without
 * thinking, and `trapSize = E[reference] − E[optimal]` is what that costs
 * them. Getting the reference wrong does not add noise to a rating — it
 * changes which puzzles the product believes are hard, so it is defined in
 * one place, `referenceAim`, and explained there.
 */

import { maxCarry } from './clubs';
import {
  DEFAULT_SEED,
  GRID_BEYOND_PIN_MARGIN_YDS,
  GRID_MIN_AIM_YDS,
  GRID_MIN_REACH_YDS,
  GRID_REACH_FACTOR,
  GRID_SECTOR_HALF_ANGLE_DEG,
  GRID_SPACING_YDS,
  MC_SAMPLES,
} from './constants';
import { evaluateAim } from './evaluate';
import type { Situation } from './evaluate';
import { classifyPoint } from './hole';
import { dist } from './projection';
import { createNormalPairs } from './rng';
import type {
  EvalGrid,
  PlayableLie,
  PlayerProfile,
  PreparedHole,
  Pt,
  PuzzleCategory,
} from './types';

export interface GridOptions {
  nSamples?: number;
  seed?: number;
  cellSize?: number;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * "Fairway center at driver distance": scan an arc at the given radius and
 * take the middle of the longest contiguous fairway run. Falls back to
 * shorter radii, then to the straight-at-pin direction.
 */
export function fairwayCenterAim(
  prepared: PreparedHole,
  ball: Pt,
  bearing: number,
  radius: number,
): Pt {
  const scanHalfAngle = (60 * Math.PI) / 180;
  const step = (0.5 * Math.PI) / 180;

  for (let r = radius; r >= radius * 0.5; r -= 10) {
    let bestLen = 0;
    let bestMid = NaN;
    let runStart = NaN;
    let prevInFairway = false;
    for (let a = -scanHalfAngle; a <= scanHalfAngle + 1e-9; a += step) {
      const theta = bearing + a;
      const p = { x: ball.x + r * Math.sin(theta), y: ball.y + r * Math.cos(theta) };
      const inFairway = classifyPoint(prepared, p) === 'fairway';
      if (inFairway && !prevInFairway) runStart = a;
      if (!inFairway && prevInFairway) {
        const len = a - runStart;
        if (len > bestLen) {
          bestLen = len;
          bestMid = runStart + len / 2;
        }
      }
      prevInFairway = inFairway;
    }
    if (prevInFairway) {
      const len = scanHalfAngle - runStart;
      if (len > bestLen) {
        bestLen = len;
        bestMid = runStart + len / 2;
      }
    }
    if (Number.isFinite(bestMid)) {
      const theta = bearing + bestMid;
      return { x: ball.x + r * Math.sin(theta), y: ball.y + r * Math.cos(theta) };
    }
  }
  return { x: ball.x + radius * Math.sin(bearing), y: ball.y + radius * Math.cos(bearing) };
}

export function evaluateGrid(
  prepared: PreparedHole,
  sit: Situation,
  profile: PlayerProfile,
  category: PuzzleCategory = 'approach',
  opts: GridOptions = {},
): EvalGrid {
  const { ball, lie, pin } = sit;
  const cellSize = opts.cellSize ?? GRID_SPACING_YDS;
  const nSamples = opts.nSamples ?? MC_SAMPLES;
  const normals = createNormalPairs(opts.seed ?? DEFAULT_SEED, nSamples);

  const reach = maxCarry(profile, lie);
  const distToPin = dist(ball, pin);
  const maxR = searchRadius(ball, pin, profile, lie);
  const bearing = Math.atan2(pin.x - ball.x, pin.y - ball.y);
  const halfAngle = (GRID_SECTOR_HALF_ANGLE_DEG * Math.PI) / 180;

  // Absolute lattice (multiples of cellSize) so grids line up across profiles.
  const minCol = Math.floor((ball.x - maxR) / cellSize);
  const maxCol = Math.ceil((ball.x + maxR) / cellSize);
  const minRow = Math.floor((ball.y - maxR) / cellSize);
  const maxRow = Math.ceil((ball.y + maxR) / cellSize);
  const width = maxCol - minCol + 1;
  const height = maxRow - minRow + 1;
  const values = new Array<number>(width * height).fill(NaN);

  let best: { point: Pt; expectedStrokes: number } | null = null;

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const p: Pt = { x: (minCol + col) * cellSize, y: (minRow + row) * cellSize };
      const r = dist(ball, p);
      if (r < GRID_MIN_AIM_YDS || r > maxR) continue;
      const theta = Math.atan2(p.x - ball.x, p.y - ball.y);
      if (Math.abs(angleDiff(theta, bearing)) > halfAngle) continue;

      // Lattice cells never need explanation stats — thousands of them.
      const e = evaluateAim(prepared, sit, profile, p, { normals, stats: false })
        .expectedStrokes;
      values[row * width + col] = e;
      if (!best || e < best.expectedStrokes) {
        best = { point: p, expectedStrokes: e };
      }
    }
  }

  if (!best) throw new Error('Search grid contained no candidates');

  const naivePoint = referenceAim(prepared, sit, profile, bearing);
  const naiveCosts = new Float64Array(nSamples);
  const naiveResult = evaluateAim(prepared, sit, profile, naivePoint, {
    normals,
    costs: naiveCosts,
  });

  // The lattice can miss the best line (quantization, or a pin closer than
  // one cell). Adding the naive aim and the pin as candidates guarantees
  // optimal ≤ naive, so trapSize is non-negative by construction.
  if (naiveResult.expectedStrokes < best.expectedStrokes) {
    best = { point: { ...naivePoint }, expectedStrokes: naiveResult.expectedStrokes };
  }
  if (
    (pin.x !== naivePoint.x || pin.y !== naivePoint.y) &&
    distToPin >= GRID_MIN_AIM_YDS
  ) {
    const pinResult = evaluateAim(prepared, sit, profile, pin, { normals });
    if (pinResult.expectedStrokes < best.expectedStrokes) {
      best = { point: { ...pin }, expectedStrokes: pinResult.expectedStrokes };
    }
  }

  // Candidates beyond max carry evaluate as shots clamped to the carry
  // circle; report the optimal at the effective aim, not the unreachable point.
  const bestR = dist(ball, best.point);
  if (bestR > reach) {
    const s = reach / bestR;
    best.point = {
      x: ball.x + (best.point.x - ball.x) * s,
      y: ball.y + (best.point.y - ball.y) * s,
    };
  }

  const optimalCosts = new Float64Array(nSamples);
  const optimalResult = evaluateAim(prepared, sit, profile, best.point, {
    normals,
    costs: optimalCosts,
  });

  // Paired standard error. The two aims saw the same landing draws, so the
  // per-sample difference cancels most of the shared noise; taking the SE
  // of the difference rather than combining two independent SEs is what
  // makes the error bar tight enough to gate on.
  let dSum = 0;
  for (let i = 0; i < nSamples; i++) dSum += naiveCosts[i]! - optimalCosts[i]!;
  const dMean = dSum / nSamples;
  let dVar = 0;
  for (let i = 0; i < nSamples; i++) {
    const e = naiveCosts[i]! - optimalCosts[i]! - dMean;
    dVar += e * e;
  }
  // The reported optimal is an argmin over the lattice, so `best` is the
  // minimum of many noisy estimates and dMean is not exactly trapSize.
  // The SPREAD is what is being measured here, and it is the same either way.
  const trapSe = nSamples > 1 ? Math.sqrt(dVar / (nSamples - 1) / nSamples) : 0;

  return {
    origin: { x: minCol * cellSize, y: minRow * cellSize },
    cellSize,
    width,
    height,
    values,
    optimal: {
      point: best.point,
      expectedStrokes: best.expectedStrokes,
      result: optimalResult,
    },
    naive: {
      point: naivePoint,
      expectedStrokes: naiveResult.expectedStrokes,
      result: naiveResult,
    },
    trapSize: naiveResult.expectedStrokes - best.expectedStrokes,
    trapSe,
  };
}

/**
 * Where a player aims when they are not thinking about it.
 *
 * This is the yardstick every rating in the product is measured against,
 * and it was wrong in both directions until Wave 1.
 *
 * It used to be "fairway centre at driver distance" for every `tee` puzzle
 * regardless of the hole's length. On a 119-yard par 3 that scored the
 * player against hitting driver 31 yards past the green — measured, the
 * eight highest-rated puzzles in the library were all par-3 tee shots
 * inflated this way, county-down-7 reading a trap of 1.151. Nobody needs to
 * be taught not to hit driver at a wedge green.
 *
 * The obvious repair — "the reference is always the pin" — fails at the
 * other end. When the pin is 453 yards away, aiming *at the flag* is not a
 * naive behaviour, it is a degenerate use of the aim clamp: the shot
 * becomes a driver fired down the flag line, and on a hole with water on
 * that line it books a trap of 1.841 for a decision no player was making.
 * Generating content against that yardstick would mass-produce a wrong
 * lesson, so `optimize.test.ts` guards it explicitly.
 *
 * The rule that survives both: **aim at the flag if you can reach it,
 * otherwise as far as you can down the middle.** That is what an
 * unthinking player does, and it is the same sentence on a par 3, a 470-
 * yard par 4 and a bunker shot.
 */
export function referenceAim(
  prepared: PreparedHole,
  sit: Situation,
  profile: PlayerProfile,
  bearing: number,
): Pt {
  const reach = maxCarry(profile, sit.lie);
  const distToPin = dist(sit.ball, sit.pin);
  if (distToPin <= reach) return { ...sit.pin };
  return fairwayCenterAim(prepared, sit.ball, bearing, reach);
}


/**
 * The radius the candidate grid searches, and therefore the radius the
 * contour clip and the stored field must agree on. Defined once: three
 * copies of this rule is three chances for a cached grid to be drawn with a
 * different edge than the one it was computed with.
 */
export function searchRadius(
  ball: Pt,
  pin: Pt,
  profile: PlayerProfile,
  lie: PlayableLie,
): number {
  return Math.max(
    GRID_MIN_REACH_YDS,
    Math.min(
      maxCarry(profile, lie) * GRID_REACH_FACTOR,
      dist(ball, pin) + GRID_BEYOND_PIN_MARGIN_YDS,
    ),
  );
}
