// Shot dispersion: you don't hit shots, you hit patterns. A target plus a
// distance-scaled ellipse (long axis along the line of play), widened by bad
// lies. All sampling is deterministic — fixed low-discrepancy offsets for
// expectation math, seeded draws for the one ball that actually flies.

import { substream } from './rng.js';
import { FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN, ICE, slopeDir } from './terrain.js';
import { cellAt, inBounds } from './course.js';

export const MAX_CARRY = 14; // tiles — the longest club in the bag

// Per-lie shot constraints: how far you can hit and how much wider the
// pattern gets. Trees are a punch-out, sand is an escape.
export function lieParams(terrain) {
  if (terrain === SAND) return { maxDist: 7, sigmaScale: 1.8 };
  if (terrain === ROUGH) return { maxDist: 11, sigmaScale: 1.4 };
  if (terrain === TREES) return { maxDist: 5, sigmaScale: 1.6 };
  return { maxDist: MAX_CARRY, sigmaScale: 1 }; // fairway, green, ice, slopes
}

/** Ellipse semi-axes (in tiles) for a shot of the given carry distance. */
export function sigmas(dist, sigmaScale) {
  return {
    long: (0.5 + dist * 0.09) * sigmaScale,  // depth error grows with club
    lat: (0.4 + dist * 0.06) * sigmaScale,   // lateral error slightly tighter
  };
}

// 16 fixed unit-disc offsets (sunflower spiral, radially gaussian-ish).
// Shared by the expectation math everywhere, so E[strokes] is reproducible.
export const UNIT_OFFSETS = (() => {
  const pts = [];
  const GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 16; i++) {
    const r = Math.sqrt((i + 0.5) / 16) * 1.8; // ~90% of a gaussian's mass
    const a = i * GA;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
})();

/** Landing points for a shot from `from` aimed at `target`, one per offset. */
export function patternPoints(from, target, sigmaScale, offsets = UNIT_OFFSETS) {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  const ux = dx / dist;
  const uy = dy / dist;
  const s = sigmas(dist, sigmaScale);
  return offsets.map((o) => ({
    x: target.x + ux * o.y * s.long - uy * o.x * s.lat,
    y: target.y + uy * o.y * s.long + ux * o.x * s.lat,
  }));
}

// Denser fixed offset set for live pattern visualization and outcome odds —
// 48 points gives ~2% probability granularity while staying deterministic.
export const PREVIEW_OFFSETS = (() => {
  const pts = [];
  const GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 48; i++) {
    const r = Math.sqrt((i + 0.5) / 48) * 1.9;
    const a = i * GA + 0.7;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
})();

/**
 * Live pattern intelligence for a candidate target: where the shots in this
 * pattern finish (as outcome percentages), the sample dots themselves for
 * rendering, and the median leave to the hole.
 */
export function patternStats(course, from, target, sigmaScale) {
  const pts = patternPoints(from, target, sigmaScale, PREVIEW_OFFSETS);
  const counts = { fairway: 0, green: 0, rough: 0, sand: 0, trees: 0, wet: 0 };
  const dots = [];
  const leaves = [];
  for (const p of pts) {
    const rest = restingCell(course, p.x, p.y);
    if (rest.kind !== 'rest') {
      counts.wet++;
      dots.push({ x: p.x, y: p.y, outcome: 'wet' });
      continue;
    }
    leaves.push(Math.hypot(rest.x - course.hole.x, rest.y - course.hole.y));
    const t = rest.terrain;
    const outcome =
      t === GREEN ? 'green' : t === SAND ? 'sand' : t === ROUGH ? 'rough'
      : t === TREES ? 'trees' : 'fairway'; // ice/slopes count as fairway-ish
    counts[outcome]++;
    dots.push({ x: p.x, y: p.y, outcome });
  }
  const pct = {};
  for (const k of Object.keys(counts)) pct[k] = Math.round((counts[k] / pts.length) * 100);
  leaves.sort((a, b) => a - b);
  const medianLeave = leaves.length ? leaves[Math.floor(leaves.length / 2)] : null;
  return { pct, dots, medianLeave };
}

/** The one real ball: a seeded gaussian draw from the same ellipse. */
export function sampleLanding(course, from, target, sigmaScale, strokeIndex) {
  const rng = substream(course.seed, `caddie:${strokeIndex}`);
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const mag = Math.sqrt(-2 * Math.log(u1));
  const g1 = mag * Math.cos(2 * Math.PI * u2);
  const g2 = mag * Math.sin(2 * Math.PI * u2);
  const [p] = patternPoints(from, target, sigmaScale, [{ x: g1, y: g2 }]);
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** Where a landed ball ends up resting, expressed for the strategy layer. */
export function restingCell(course, x, y) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  if (!inBounds(course, cx, cy)) return { kind: 'ob' };
  const t = cellAt(course, cx, cy);
  if (t === WATER) return { kind: 'water' };
  return { kind: 'rest', x: cx, y: cy, terrain: t };
}
