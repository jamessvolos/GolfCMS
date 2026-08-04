/**
 * Candidate-grid search for the optimal aim point.
 *
 * A regular cell grid (so the same values feed d3-contour isolines later)
 * over the reachable area: radius up to max-club carry × 1.15, angularly
 * bounded around the ball→pin corridor. Every in-sector cell is evaluated
 * with common random numbers; optimal = argmin.
 *
 * The naive aim (rating seed) is the pin for approach-style puzzles, or
 * fairway center at driver distance for tee shots. trapSize =
 * E[naive] − E[optimal] measures how punishing the "obvious" play is.
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
  const maxR = Math.max(
    GRID_MIN_REACH_YDS,
    Math.min(reach * GRID_REACH_FACTOR, distToPin + GRID_BEYOND_PIN_MARGIN_YDS),
  );
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

  const naivePoint =
    category === 'tee' ? fairwayCenterAim(prepared, ball, bearing, reach) : { ...pin };
  const naiveResult = evaluateAim(prepared, sit, profile, naivePoint, { normals });

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

  const optimalResult = evaluateAim(prepared, sit, profile, best.point, { normals });

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
  };
}
