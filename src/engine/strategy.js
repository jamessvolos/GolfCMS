// The caddie's brain: an expected-strokes field over the whole course,
// computed by value iteration with the real dispersion model. V(cell) is the
// expected strokes to hole out from a ball at rest there. From it we get the
// optimal aim point for any lie — the "answer" every player decision is
// scored against, strokes-gained style.

import { GREEN, WATER } from './terrain.js';
import { cellAt, inBounds } from './course.js';
import {
  lieParams, patternPoints, restingCell, windShift, reach, DEFAULT_PROFILE,
  PREVIEW_OFFSETS, puttPoints, puttSigmas, puttHolesOut, puttSkill,
  PUTT_MAX, puttBreakDrift, FEET_PER_TILE, PUTT_TABLE_OFFSETS,
} from './dispersion.js';

const PENALTY = 1; // water / out-of-bounds: stroke-and-distance style

// Broadie's expected-putts baseline, in FEET. Internally consistent with the
// make curve in dispersion.js: E ≈ 2 − make%, because the comeback from a
// missed putt is itself nearly automatic until the lag range. This is the
// published answer the engine's own putt model (`puttsFrom`) is calibrated
// against; the two agree to a few hundredths across the whole range.
const PUTTS_CURVE = [
  [1, 1.00], [2, 1.01], [3, 1.04], [4, 1.13], [5, 1.23], [6, 1.35], [8, 1.50],
  [10, 1.61], [15, 1.78], [20, 1.87], [25, 1.93], [30, 1.98], [40, 2.06],
  [50, 2.14], [60, 2.21], [75, 2.32], [90, 2.40], [120, 2.55],
];

/** Expected putts from a distance (in tiles) on the green — Broadie's curve. */
export function expectedPutts(d) {
  const ft = d * FEET_PER_TILE;
  if (ft <= PUTTS_CURVE[0][0]) return PUTTS_CURVE[0][1];
  const last = PUTTS_CURVE[PUTTS_CURVE.length - 1];
  if (ft >= last[0]) return last[1];
  for (let i = 1; i < PUTTS_CURVE.length; i++) {
    const [d1, p1] = PUTTS_CURVE[i];
    if (ft <= d1) {
      const [d0, p0] = PUTTS_CURVE[i - 1];
      const t = (Math.log(ft) - Math.log(d0)) / (Math.log(d1) - Math.log(d0));
      return p0 + t * (p1 - p0);
    }
  }
  return last[1];
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
      // Green cells are terminal: they are never swept, so their value IS the
      // putting model. Price them with `puttsFrom` — the same recursion the
      // putt game plays — so the field and the green agree exactly, instead
      // of with a crude closed form the putt model then contradicts.
      if (t === GREEN) V[i] = puttsFrom(holeD(x, y), profile);
      else if (t === WATER) V[i] = Infinity;
      else {
        // Seed above the fixed point: value iteration is a min-contraction, so
        // starting high converges down and never leaves an optimistic cell.
        V[i] = 2 + holeD(x, y) / 12;
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
  const r = reach(lie, profile);
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
  if (Math.hypot(target.x - from.x, target.y - from.y) > reach(lie, profile) + 0.01) return Infinity;
  const pts = patternPoints(from, target, lie.sigmaScale, undefined, profile);
  const drift = windShift(course, from, target);
  const fromV = inBounds(course, from.x, from.y) ? V[from.y * course.width + from.x] : 5;
  let total = 0;
  for (const p of pts) {
    const px = p.x + drift.x;
    const py = p.y + drift.y;
    const rest = restingCell(course, px, py);
    if (rest.kind === 'rest') {
      // On the green, INCHES matter and tiles do not: a 48-ft cell would
      // price a ball anywhere inside it as a tap-in, which is exactly how a
      // wedge used to look free. Price green finishes by the ball's own
      // distance, with the same recursion the putt game plays.
      if (rest.terrain === GREEN) {
        total += puttsFrom(Math.hypot(px - course.hole.x, py - course.hole.y), profile);
        continue;
      }
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

// --- putting decisions -------------------------------------------------------
// On the green the hole is no longer auto-resolved: every putt is a real
// decision, priced in expected putts by the same machinery as full swings.
// The decision axis is PACE — how far past the cup to play — so the optimal
// search runs along the line to the cup, and every candidate is priced by the
// putt dispersion pattern plus the holing model in dispersion.js.

const PUTT_FRINGE = 2; // tiles of fringe past the green edge a putt may target

/** Can a putt finish (or be aimed) here? On the green or ~2 tiles of fringe. */
export function onPuttingSurface(course, x, y, fringe = PUTT_FRINGE) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let dy = -fringe; dy <= fringe; dy++) {
    for (let dx = -fringe; dx <= fringe; dx++) {
      if (dx * dx + dy * dy > fringe * fringe + 0.01) continue;
      const nx = cx + dx;
      const ny = cy + dy;
      if (inBounds(course, nx, ny) && cellAt(course, nx, ny) === GREEN) return true;
    }
  }
  return false;
}

// Expected putts from a raw distance, self-consistent with the holing model:
// P(d) = 1 + E[P(leave)] under the caddie's own pace policy, iterated to a
// fixed point on a distance grid and capped at 3 — the "expectedPutts of the
// leave" recursion, tabulated once per putting-skill level.
const PUTT_TABLE_STEP = 0.01; // tiles (~0.5 ft) — inches decide comebacks
const PUTT_TABLE_N = Math.round(PUTT_MAX / PUTT_TABLE_STEP) + 1;
// Pace grid in TILES past the cup: 0 to 6 ft, the whole realistic range.
// (Was 0–0.65 tiles = 0–31 ft past, a grid that could only be read as a
// licence to race every putt.)
const PACE_CANDIDATES = [0, 0.008, 0.015, 0.021, 0.026, 0.031, 0.038, 0.05, 0.07, 0.1, 0.13];
const puttTables = new Map(); // skill → Float64Array

function tableLookup(t, d) {
  const i = d / PUTT_TABLE_STEP;
  if (i <= 0) return t[0];
  if (i >= PUTT_TABLE_N - 1) return t[PUTT_TABLE_N - 1];
  const lo = Math.floor(i);
  return t[lo] + (t[lo + 1] - t[lo]) * (i - lo);
}

function buildPuttTable(profile) {
  const t = new Float64Array(PUTT_TABLE_N);
  // Seed with Broadie's published curve, then iterate to the model's own
  // fixed point. If the model is honest the two barely move apart.
  for (let i = 0; i < PUTT_TABLE_N; i++) t[i] = expectedPutts(i * PUTT_TABLE_STEP);
  const cup = { x: 0, y: 0 };
  for (let sweep = 0; sweep < 6; sweep++) {
    const prev = t.slice();
    for (let i = 1; i < PUTT_TABLE_N; i++) {
      const d = i * PUTT_TABLE_STEP;
      let best = 3;
      for (const past of PACE_CANDIDATES) {
        const aim = d + past;
        const s = puttSigmas(aim, profile);
        let total = 0;
        for (const o of PUTT_TABLE_OFFSETS) {
          const rolled = Math.max(0, aim + o.y * s.long); // pace along the line
          const line = o.x * s.lat; // lateral miss at the finish
          if (puttHolesOut({ x: -d, y: 0 }, { x: rolled - d, y: line }, cup)) continue;
          total += tableLookup(prev, Math.hypot(rolled - d, line));
        }
        best = Math.min(best, 1 + total / PUTT_TABLE_OFFSETS.length);
      }
      t[i] = Math.min(3, best);
    }
  }
  return t;
}

/** Expected putts to hole out from `d` tiles, playing the caddie's pace. */
export function puttsFrom(d, profile = DEFAULT_PROFILE) {
  const key = puttSkill(profile).toFixed(4);
  let t = puttTables.get(key);
  if (!t) {
    t = buildPuttTable(profile);
    puttTables.set(key, t);
  }
  return tableLookup(t, d);
}

/** Cost of one non-holed putt sample finishing at `p`. */
function puttLeaveCost(course, V, from, p, profile) {
  const rest = restingCell(course, p.x, p.y);
  if (rest.kind !== 'rest') {
    // raced it clean off the green into a pond: penalty, replay the putt
    return PENALTY + puttsFrom(Math.hypot(from.x - course.hole.x, from.y - course.hole.y), profile);
  }
  if (rest.terrain === GREEN) {
    // still on the dance floor: the fractional leave distance is what matters
    return puttsFrom(Math.hypot(p.x - course.hole.x, p.y - course.hole.y), profile);
  }
  // rolled into the collar/fringe: back to a chip, priced by the field
  const v = V ? V[rest.y * course.width + rest.x] : NaN;
  return Number.isFinite(v) ? v : 3;
}

/**
 * Expected putts from this decision: the stroke itself plus the mean, over
 * PREVIEW-style fixed offsets, of (holed ? 0 : putts-remaining from the
 * leave). Infinity for targets off the green+fringe surface or past the cap.
 */
export function evaluatePutt(course, V, from, target, profile = DEFAULT_PROFILE) {
  const d = Math.hypot(target.x - from.x, target.y - from.y);
  if (d < 0.02 || d > PUTT_MAX + 0.01) return Infinity;
  if (!onPuttingSurface(course, target.x, target.y)) return Infinity;
  const pts = puttPoints(from, target, profile, PREVIEW_OFFSETS);
  let total = 0;
  for (const p of pts) {
    const br = puttBreakDrift(course, from, p); // slope tiles bend the roll
    const q = { x: p.x + br.x, y: p.y + br.y };
    if (puttHolesOut(from, q, course.hole)) continue; // drops: no further cost
    total += puttLeaveCost(course, V, from, q, profile);
  }
  return 1 + total / pts.length;
}

// Pace grid for the optimal-putt search: tiles past (or short of) the cup.
// −3 ft to +9 ft, which is the whole space a golfer actually chooses inside.
const PUTT_PACE_GRID = [
  -0.06, -0.04, -0.025, -0.015, -0.008, 0, 0.005, 0.01, 0.016, 0.021, 0.026, 0.031,
  0.037, 0.045, 0.055, 0.07, 0.1, 0.14, 0.19,
];

// Cross-line grid for breaking putts: tiles of aim-off either side of the cup
// line. Only searched when the line to the cup actually breaks — on a flat
// green the lateral term stays [0] and the search is exactly the classic one.
// Resolution matters now that capture is inches, not yards: the first steps
// are a few inches of aim-off.
const PUTT_LATERAL_GRID = [
  0, 0.01, -0.01, 0.02, -0.02, 0.035, -0.035, 0.06, -0.06, 0.1, -0.1, 0.16, -0.16,
  0.25, -0.25, 0.4, -0.4, 0.6, -0.6,
];

/**
 * Optimal putt target: a small grid search along the line to the cup — on a
 * flat green line is free, PACE is the whole decision — over aims from well
 * short to aggressively past. When the cup line breaks (slope tiles on or
 * beside it), the search also slides ACROSS the line, so the caddie's answer
 * plays the break: the optimal target sits aimed off the cup, upslope.
 * @returns {{target:{x,y}, value, past}}
 */
export function bestPutt(course, V, from, profile = DEFAULT_PROFILE) {
  const cup = course.hole;
  const d = Math.hypot(cup.x - from.x, cup.y - from.y) || 0.001;
  // ball at the cup lip (a shot that landed dead on the hole cell): there is
  // no line to normalize, so take any — the tap-in is pure pace. Without this
  // the direction vector degenerates to (0,0) and every candidate prices as
  // Infinity, which used to poison the decision score with NaN points.
  const ux = d < 0.01 ? 1 : (cup.x - from.x) / d;
  const uy = d < 0.01 ? 0 : (cup.y - from.y) / d;
  const breaks = Math.abs(puttBreakDrift(course, from, cup).cross) > 1e-9;
  const laterals = breaks ? PUTT_LATERAL_GRID : [0];
  let best = { target: { x: cup.x, y: cup.y }, value: Infinity, past: 0 };
  for (const past of PUTT_PACE_GRID) {
    const aim = Math.min(PUTT_MAX, d + past);
    if (aim < 0.05) continue;
    for (const lat of laterals) {
      const target = { x: from.x + ux * aim - uy * lat, y: from.y + uy * aim + ux * lat };
      const value = evaluatePutt(course, V, from, target, profile);
      if (value < best.value) best = { target, value, past: aim - d };
    }
  }
  return best;
}

/** Score one putt decision, mirroring scoreDecision: SG lost vs the caddie's
 *  read, 1000-point exponential. E's are expected PUTTS from here. */
export function scorePuttDecision(course, V, from, target, profile = DEFAULT_PROFILE) {
  const optimal = bestPutt(course, V, from, profile);
  const raw = evaluatePutt(course, V, from, target, profile);
  const yourE = Number.isFinite(raw) ? raw : optimal.value + 2; // off-surface aim: priced as a blunder
  const sgLost = Math.max(0, yourE - optimal.value);
  const points = Math.round(1000 * Math.exp(-3 * sgLost));
  return { yourE, optimalE: optimal.value, sgLost, points, optimal: optimal.target, optimalPast: optimal.past };
}

/** Live putt intelligence for the HUD: make %, three-putt risk, sample dots. */
export function puttStats(course, from, target, profile = DEFAULT_PROFILE) {
  const pts = puttPoints(from, target, profile, PREVIEW_OFFSETS);
  const dots = [];
  const leaves = [];
  let make = 0;
  let three = 0;
  for (const p of pts) {
    const br = puttBreakDrift(course, from, p); // slope tiles bend the roll
    const q = { x: p.x + br.x, y: p.y + br.y };
    if (puttHolesOut(from, q, course.hole)) {
      make++;
      dots.push({ x: q.x, y: q.y, outcome: 'holed' });
      continue;
    }
    const leave = Math.hypot(q.x - course.hole.x, q.y - course.hole.y);
    leaves.push(leave);
    // chance this leave misses too — the three-putt seed
    three += Math.min(1, Math.max(0, puttsFrom(leave, profile) - 1));
    dots.push({ x: q.x, y: q.y, outcome: 'left' });
  }
  leaves.sort((a, b) => a - b);
  return {
    makePct: Math.round((make / pts.length) * 100),
    threePct: Math.round((three / pts.length) * 100),
    medianLeave: leaves.length ? leaves[Math.floor(leaves.length / 2)] : null,
    dots,
  };
}

/** Heat data for the putt reveal: expected putts for each green/fringe cell. */
export function puttHeatmap(course, V, from, profile = DEFAULT_PROFILE) {
  const cells = [];
  const r = Math.ceil(PUTT_MAX);
  for (let ty = Math.max(0, Math.round(from.y) - r); ty < Math.min(course.height, Math.round(from.y) + r + 1); ty++) {
    for (let tx = Math.max(0, Math.round(from.x) - r); tx < Math.min(course.width, Math.round(from.x) + r + 1); tx++) {
      if (cellAt(course, tx, ty) === WATER) continue;
      if (!onPuttingSurface(course, tx, ty)) continue;
      const e = evaluatePutt(course, V, from, { x: tx, y: ty }, profile);
      if (Number.isFinite(e)) cells.push({ x: tx, y: ty, e });
    }
  }
  return cells;
}

/** Heat data for the reveal: expected total strokes for each aim candidate. */
export function aimHeatmap(course, V, from, stride = 1, profile = DEFAULT_PROFILE) {
  const lie = lieParams(cellAt(course, from.x, from.y));
  const cells = [];
  const r = reach(lie, profile);
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
