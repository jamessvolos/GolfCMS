// The caddie's brain: an expected-strokes field over the whole course,
// computed by value iteration with the real dispersion model. V(cell) is the
// expected strokes to hole out from a ball at rest there. From it we get the
// optimal aim point for any lie — the "answer" every player decision is
// scored against, strokes-gained style.

import { GREEN, WATER } from './terrain.js';
import { cellAt, inBounds } from './course.js';
import { lieParams, patternPoints, restingCell, DEFAULT_PROFILE } from './dispersion.js';

const PENALTY = 1; // water / out-of-bounds: stroke-and-distance style

/** Expected putts from a distance (in tiles) on the green. */
export function expectedPutts(d) {
  if (d <= 0.6) return 1;
  return Math.min(3, 1 + 0.13 * d + (d > 8 ? 0.1 : 0));
}

/**
 * Compute the expected-strokes field. Deterministic and pure per course.
 * @returns {Float64Array} V indexed cell-major (y * width + x); Infinity for water.
 */
export function strokesField(course, sweeps = 6, profile = DEFAULT_PROFILE) {
  const { width, height } = course;
  const V = new Float64Array(width * height);
  const holeD = (x, y) => Math.hypot(x - course.hole.x, y - course.hole.y);

  // Initialize: greens by putt model, everything else by a distance heuristic.
  const order = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const t = cellAt(course, x, y);
      if (t === GREEN) V[i] = expectedPutts(holeD(x, y));
      else if (t === WATER) V[i] = Infinity;
      else {
        V[i] = 1.5 + holeD(x, y) / 9;
        order.push({ i, x, y, d: holeD(x, y) });
      }
    }
  }
  order.sort((a, b) => a.d - b.d); // near-hole first: values propagate outward

  for (let sweep = 0; sweep < sweeps; sweep++) {
    for (const cell of order) {
      V[cell.i] = 1 + bestAim(course, V, cell, 2, profile).value;
    }
  }
  return V;
}

/**
 * Search aim points reachable from `from`, minimizing expected cost-to-hole
 * after the shot. `stride` trades accuracy for speed (field build uses 2,
 * player-facing answers use 1).
 * @returns {{target: {x,y}, value: number}}
 */
export function bestAim(course, V, from, stride = 1, profile = DEFAULT_PROFILE) {
  const lie = lieParams(cellAt(course, from.x, from.y));
  let best = { target: { x: from.x, y: from.y }, value: Infinity };
  const r = lie.maxDist;
  for (let ty = Math.max(0, from.y - r); ty < Math.min(course.height, from.y + r + 1); ty += stride) {
    for (let tx = Math.max(0, from.x - r); tx < Math.min(course.width, from.x + r + 1); tx += stride) {
      const d = Math.hypot(tx - from.x, ty - from.y);
      if (d < 1 || d > r) continue;
      const value = evaluateAim(course, V, from, { x: tx, y: ty }, profile);
      if (value < best.value) best = { target: { x: tx, y: ty }, value };
    }
  }
  return best;
}

/**
 * Expected cost-to-hole AFTER hitting from `from` at `target` — the mean of
 * V over the landing pattern, with penalties for water/OB samples.
 */
export function evaluateAim(course, V, from, target, profile = DEFAULT_PROFILE) {
  const lie = lieParams(cellAt(course, from.x, from.y));
  if (Math.hypot(target.x - from.x, target.y - from.y) > lie.maxDist + 0.01) return Infinity;
  const pts = patternPoints(from, target, lie.sigmaScale, undefined, profile);
  const fromV = inBounds(course, from.x, from.y) ? V[from.y * course.width + from.x] : 5;
  let total = 0;
  for (const p of pts) {
    const rest = restingCell(course, p.x, p.y);
    if (rest.kind === 'rest') {
      const v = V[rest.y * course.width + rest.x];
      total += Number.isFinite(v) ? v : PENALTY + fromV;
    } else {
      // splash or over the fence: penalty, replay from where you stand
      total += PENALTY + fromV;
    }
  }
  return total / pts.length;
}

/**
 * Score one player decision, GeoGuessr-style.
 * @returns {{yourE: number, optimalE: number, sgLost: number, points: number, optimal: {x,y}}}
 */
export function scoreDecision(course, V, from, target, profile = DEFAULT_PROFILE) {
  const optimal = bestAim(course, V, from, 1, profile);
  const yourAfter = evaluateAim(course, V, from, target, profile);
  const yourE = 1 + yourAfter;
  const optimalE = 1 + optimal.value;
  const sgLost = Math.max(0, yourE - optimalE);
  const points = Math.round(1000 * Math.exp(-3 * sgLost));
  return { yourE, optimalE, sgLost, points, optimal: optimal.target };
}

/** Is the hole "done" for decision purposes? On the green we hand it to the putt model. */
export function isHoleOver(course, ball) {
  return cellAt(course, ball.x, ball.y) === GREEN;
}

/** Heat data for the reveal: expected total strokes for each aim candidate. */
export function aimHeatmap(course, V, from, stride = 1, profile = DEFAULT_PROFILE) {
  const lie = lieParams(cellAt(course, from.x, from.y));
  const cells = [];
  const r = lie.maxDist;
  for (let ty = Math.max(0, from.y - r); ty < Math.min(course.height, from.y + r + 1); ty += stride) {
    for (let tx = Math.max(0, from.x - r); tx < Math.min(course.width, from.x + r + 1); tx += stride) {
      const d = Math.hypot(tx - from.x, ty - from.y);
      if (d < 1 || d > r) continue;
      if (cellAt(course, tx, ty) === WATER) continue;
      cells.push({ x: tx, y: ty, e: 1 + evaluateAim(course, V, from, { x: tx, y: ty }, profile) });
    }
  }
  return cells;
}
