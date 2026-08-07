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
