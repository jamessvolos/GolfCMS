// Shot dispersion: you don't hit shots, you hit patterns. A target plus a
// distance-scaled ellipse (long axis along the line of play), widened by bad
// lies. All sampling is deterministic — fixed low-discrepancy offsets for
// expectation math, seeded draws for the one ball that actually flies.

import { substream } from './rng.js';
import { FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN, ICE, slopeDir } from './terrain.js';
import { cellAt, inBounds } from './course.js';

export const MAX_CARRY = 15; // tiles (240 yds) — a scratch driver carry

// Per-lie shot constraints: how far you can hit and how much wider the
// pattern gets. Trees are a punch-out, sand is an escape.
export function lieParams(terrain) {
  if (terrain === SAND) return { maxDist: 7, sigmaScale: 1.8 };
  if (terrain === ROUGH) return { maxDist: 12, sigmaScale: 1.4 };
  if (terrain === TREES) return { maxDist: 5, sigmaScale: 1.6 };
  return { maxDist: MAX_CARRY, sigmaScale: 1 }; // fairway, green, ice, slopes
}

// Handicap profiles: `base` scales the whole pattern; `longExtra` widens it
// further as carry approaches max — long clubs punish higher handicaps
// disproportionately, exactly as in real dispersion data. 'scratch' is the
// identity profile, so everything downstream defaults to today's behavior.
// `dist` scales reach too: a 20-capper doesn't carry a scratch driver.
export const HANDICAPS = [
  { id: 'tour', label: 'Tour pro', base: 0.78, longExtra: 0, dist: 1.08 },
  { id: 'scratch', label: 'Scratch', base: 1, longExtra: 0, dist: 1 },
  { id: 'ten', label: '10 handicap', base: 1.35, longExtra: 0.35, dist: 0.92 },
  { id: 'twenty', label: '20 handicap', base: 1.7, longExtra: 0.7, dist: 0.84 },
];
export const DEFAULT_PROFILE = HANDICAPS[1];

/** Effective reach from a lie for a given player: lie limit x distance factor. */
export function reach(lie, profile = DEFAULT_PROFILE) {
  return Math.max(2, Math.round(lie.maxDist * (profile.dist ?? 1)));
}

export function handicapById(id) {
  return HANDICAPS.find((h) => h.id === id) ?? DEFAULT_PROFILE;
}

/** Ellipse semi-axes (in tiles) for a shot of the given carry distance. */
export function sigmas(dist, sigmaScale, profile = DEFAULT_PROFILE) {
  const skill = profile.base + profile.longExtra * (dist / MAX_CARRY);
  // Real dispersion is WIDE, not deep: lateral misses dominate, and distance
  // control is comparatively tight for a known club. Scratch full driver:
  // lateral 1-sigma ~21 yds, depth 1-sigma ~14 yds.
  return {
    long: (0.2 + dist * 0.042) * sigmaScale * skill, // depth (distance control)
    lat: (0.22 + dist * 0.075) * sigmaScale * skill, // lateral (the real miss)
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
export function patternPoints(from, target, sigmaScale, offsets = UNIT_OFFSETS, profile = DEFAULT_PROFILE) {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  const ux = dx / dist;
  const uy = dy / dist;
  const s = sigmas(dist, sigmaScale, profile);
  // directional miss: a personal bias shifts the pattern MEAN sideways,
  // scaled by carry — "my driver leaks right" as arithmetic
  const b = (profile.bias ?? 0) * (dist / MAX_CARRY);
  const bx = -uy * b;
  const by = ux * b;
  return offsets.map((o) => ({
    x: target.x + bx + ux * o.y * s.long - uy * o.x * s.lat,
    y: target.y + by + uy * o.y * s.long + ux * o.x * s.lat,
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
export function patternStats(course, from, target, sigmaScale, profile = DEFAULT_PROFILE) {
  const drift = windShift(course, from, target);
  const pts = patternPoints(from, target, sigmaScale, PREVIEW_OFFSETS, profile)
    .map((p) => ({ x: p.x + drift.x, y: p.y + drift.y }));
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

/**
 * Wind drift for a shot: the pattern's CENTER moves downwind, scaled by
 * carry (a full swing takes the whole gust, a chip barely feels it).
 */
export function windShift(course, from, target) {
  const w = course.wind ?? { x: 0, y: 0 };
  if (!w.x && !w.y) return { x: 0, y: 0 };
  const d = Math.hypot(target.x - from.x, target.y - from.y);
  const k = Math.min(1, d / 10);
  return { x: w.x * k, y: w.y * k };
}

/** The one real ball: a seeded gaussian draw from the same ellipse. */
export function sampleLanding(course, from, target, sigmaScale, strokeIndex, profile = DEFAULT_PROFILE) {
  const rng = substream(course.seed, `caddie:${strokeIndex}`);
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const mag = Math.sqrt(-2 * Math.log(u1));
  const g1 = mag * Math.cos(2 * Math.PI * u2);
  const g2 = mag * Math.sin(2 * Math.PI * u2);
  const [p] = patternPoints(from, target, sigmaScale, [{ x: g1, y: g2 }], profile);
  const drift = windShift(course, from, target);
  return { x: Math.round(p.x + drift.x), y: Math.round(p.y + drift.y) };
}

// --- putting -----------------------------------------------------------------
// The putt pattern INVERTS the full-swing shape: pace (depth) error dominates
// and line (lateral) error is small — a putt misses long/short far more than
// wide. Skill scales by sqrt(profile.base): bad ballstrikers aren't equally
// bad putters. All distances in tiles (1 tile = 16 yds = 48 ft).

export const PUTT_MAX = 20; // tiles — the longest roll the caddie will line up
// Capture: a roll that passes this close to the cup with holeable pace drops.
// Tuned against the make-rate contract (3-footers near-automatic, 60-footers
// roughly one-in-three) rather than physical cup size — this is game scale.
export const CUP_R = 0.058; // tiles
export const PUTT_OVERRUN = 2.5; // tiles — pace that races farther past never drops

/** Putting skill factor: sqrt of the full-swing base. */
export function puttSkill(profile = DEFAULT_PROFILE) {
  return Math.sqrt(profile.base ?? 1);
}

/** Putt ellipse semi-axes (tiles): long axis is PACE, short axis is LINE. */
export function puttSigmas(dist, profile = DEFAULT_PROFILE) {
  const s = puttSkill(profile);
  return {
    long: (0.08 + dist * 0.10) * s, // pace (depth) — the real miss on the green
    lat: (0.04 + dist * 0.045) * s, // line (lateral) — comparatively tight
  };
}

/** Finishing points for a putt from `from` rolled at `target`, one per offset. */
export function puttPoints(from, target, profile = DEFAULT_PROFILE, offsets = UNIT_OFFSETS) {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const dist = Math.hypot(dx, dy) || 0.001;
  const ux = dx / dist;
  const uy = dy / dist;
  const s = puttSigmas(dist, profile);
  return offsets.map((o) => ({
    x: target.x + ux * o.y * s.long - uy * o.x * s.lat,
    y: target.y + uy * o.y * s.long + ux * o.x * s.lat,
  }));
}

/**
 * Did a roll from `from` finishing at `finish` drop? The ball must actually
 * reach the cup (a putt dying at the front door still counts), must not be
 * pacing more than PUTT_OVERRUN past, and must pass within the cup's capture
 * width — which SHRINKS with overrun speed: a racing putt lips out. That
 * gradient is the aggressive-lag trade-off: pace past the hole raises make%
 * up to a point, then costs both the make and the comeback.
 */
export function puttHolesOut(from, finish, cup) {
  const vx = finish.x - from.x;
  const vy = finish.y - from.y;
  const len = Math.hypot(vx, vy);
  if (len < 1e-9) return Math.hypot(cup.x - from.x, cup.y - from.y) <= CUP_R;
  const ux = vx / len;
  const uy = vy / len;
  const along = (cup.x - from.x) * ux + (cup.y - from.y) * uy; // cup's station on the roll line
  if (len < along - 1e-9) return false; // died short of the hole
  const over = len - along; // how far past the cup this pace carries
  if (over > PUTT_OVERRUN) return false;
  const capture = CUP_R * (1 - Math.max(0, over) / PUTT_OVERRUN);
  const off = Math.abs(-(cup.x - from.x) * uy + (cup.y - from.y) * ux); // line miss at the cup
  return off <= capture;
}

/** The one real roll: a seeded gaussian draw from the putt ellipse. No wind —
 *  the ball is on the ground. Fractional finish: inches matter on the green. */
export function samplePuttRoll(course, from, target, strokeIndex, profile = DEFAULT_PROFILE) {
  const rng = substream(course.seed, `putt:${strokeIndex}`);
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const mag = Math.sqrt(-2 * Math.log(u1));
  const g1 = mag * Math.cos(2 * Math.PI * u2);
  const g2 = mag * Math.sin(2 * Math.PI * u2);
  const [p] = puttPoints(from, target, profile, [{ x: g1, y: g2 }]);
  return { x: p.x, y: p.y };
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
