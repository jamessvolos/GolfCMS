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
  if (terrain === SAND) return { maxDist: 7, sigmaScale: 2.2 };
  if (terrain === ROUGH) return { maxDist: 11, sigmaScale: 1.6 };
  if (terrain === TREES) return { maxDist: 5, sigmaScale: 1.9 };
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

// Dispersion grows SUPERLINEARLY with carry, and that shape is the whole
// reason a wedge is a scoring club. A linear model pinned to a scratch
// driver (lateral 1-sigma ~21 yds at 240) implies ~32 ft of lateral error on
// a 100-yd wedge, i.e. 30+ ft mean proximity — the tour's is 17-18 ft. Tour
// proximity by carry (≈19 ft at 100 yds, 27 ft at 150, 45 ft at 200, driver
// ~21 yds lateral at 240) fits a + c·d^p with p ≈ 1.57 far better than any
// straight line. `LAT_A` is the floor: even a 16-yd pitch scatters ~5 ft.
const LAT_A = 0.12;
const LAT_C = 0.0184;
const LAT_P = 1.565;
const LONG_A = 0.075;
const LONG_RATIO = 0.62; // depth error is ~62% of lateral: patterns are wide, not deep

/** Ellipse semi-axes (in tiles) for a shot of the given carry distance. */
export function sigmas(dist, sigmaScale, profile = DEFAULT_PROFILE) {
  const skill = profile.base + profile.longExtra * (dist / MAX_CARRY);
  // Real dispersion is WIDE, not deep: lateral misses dominate, and distance
  // control is comparatively tight for a known club. Scratch full driver:
  // lateral 1-sigma ~21 yds, depth 1-sigma ~13 yds; scratch 100-yd wedge:
  // lateral ~6.5 yds, which prices out at ~20 ft mean proximity.
  const grow = Math.pow(Math.max(dist, 0), LAT_P);
  return {
    long: (LONG_A + LONG_RATIO * LAT_C * grow) * sigmaScale * skill, // depth (distance control)
    lat: (LAT_A + LAT_C * grow) * sigmaScale * skill, // lateral (the real miss)
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

export const FEET_PER_TILE = 48;
export const PUTT_MAX = 2.5; // tiles (120 ft) — the longest roll the caddie will line up
// The drawn cup: a nominal radius the renderer and the HUD read for scale.
// It is NOT the holing test any more — see MAKE_CURVE / captureAt below.
export const CUP_R = 0.058; // tiles
// Past-cup pace beyond this never drops: a ball arriving with more than a yard
// of run hits the back lip and spins out. (Was 2.5 tiles = 120 ft of overrun,
// which made "race it" a free strategy.)
export const PUTT_OVERRUN = 3 / FEET_PER_TILE; // 0.0625 tiles = 3 ft
// The pace the make curve is anchored at: Pelz's "17 inches past" rounded to
// a foot and a half. Dying it at the hole or racing it both make fewer.
export const PUTT_REF_PACE = 1.5 / FEET_PER_TILE; // 0.03125 tiles

/**
 * The contract: published PGA one-putt rates by distance in FEET. This table
 * — not a capture radius — is the model's truth. Everything geometric below
 * is fitted to reproduce it.
 * Sources: Broadie / The Brassie / Golfing Focus tour make-percentage tables.
 */
export const MAKE_CURVE = [
  [1, 1.0], [2, 0.99], [3, 0.96], [4, 0.88], [5, 0.77], [6, 0.65], [8, 0.50],
  [10, 0.40], [15, 0.23], [20, 0.15], [25, 0.10], [30, 0.07], [40, 0.04],
  [50, 0.03], [60, 0.02], [75, 0.013], [90, 0.01], [120, 0.005],
];

/** One-putt probability at `ft` feet, log-interpolated between the anchors. */
export function makeRate(ft) {
  if (ft <= MAKE_CURVE[0][0]) return MAKE_CURVE[0][1];
  const last = MAKE_CURVE[MAKE_CURVE.length - 1];
  if (ft >= last[0]) return last[1];
  for (let i = 1; i < MAKE_CURVE.length; i++) {
    const [d1, p1] = MAKE_CURVE[i];
    if (ft <= d1) {
      const [d0, p0] = MAKE_CURVE[i - 1];
      const t = (Math.log(ft) - Math.log(d0)) / (Math.log(d1) - Math.log(d0));
      return Math.exp(Math.log(p0) + t * (Math.log(p1) - Math.log(p0)));
    }
  }
  return last[1];
}

/**
 * The pace modifier on the curve: how much of the cup a ball rolling `over`
 * tiles past the hole can still use. Dead weight uses all of it; a ball with
 * three feet of run uses none. This is the aggressive-lag trade-off — pace
 * buys you arrival (a putt that dies short cannot drop at all) and spends
 * capture (a racing putt lips out) — expressed as a factor on the make rate,
 * not as the mechanism that produces it.
 */
export function paceCapture(over) {
  if (over < 0 || over > PUTT_OVERRUN) return 0;
  const u = over / PUTT_OVERRUN;
  return 1 - 0.6 * u * u;
}

/** Putting skill factor: sqrt of the full-swing base. */
export function puttSkill(profile = DEFAULT_PROFILE) {
  return Math.sqrt(profile.base ?? 1);
}

// Putt error in FEET: pace 1-sigma ≈ 0.5 + 6% of the putt, line 1-sigma ≈
// 0.3 + 3.5%. That is what leaves a missed 30-footer ~3 ft away (tour lag
// reality) instead of the old model's 15 ft, and it is what makes three-putt
// avoidance a real skill rather than an accident.
const PACE_SIGMA_A = 0.5 / FEET_PER_TILE;
const PACE_SIGMA_B = 0.06;
const LINE_SIGMA_A = 0.3 / FEET_PER_TILE;
const LINE_SIGMA_B = 0.035;

/** Putt ellipse semi-axes (tiles): long axis is PACE, short axis is LINE. */
export function puttSigmas(dist, profile = DEFAULT_PROFILE) {
  const s = puttSkill(profile);
  return {
    long: (PACE_SIGMA_A + dist * PACE_SIGMA_B) * s, // pace (depth) — the real miss on the green
    lat: (LINE_SIGMA_A + dist * LINE_SIGMA_B) * s, // line (lateral) — comparatively tight
  };
}

// --- capture, derived from the curve ----------------------------------------
// A real cup is 0.18 ft in radius; a 16-sample quasi-random pattern is not a
// golf ball. So rather than assert a radius and hope the make rates fall out
// (they never did — the old 2.8-ft radius holed 86% of 8-footers), we INVERT:
// for each distance, find the capture width at which the reference-pace
// pattern holes exactly `makeRate(ft)` of its samples. The empirical curve is
// the input; the geometry is the fitted part. Misses still finish where the
// ellipse puts them, so leaves, three-putts and comebacks stay physical.

const CALIB_N = 256;
const CALIB_OFFSETS = (() => {
  const pts = [];
  const GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < CALIB_N; i++) {
    const r = Math.sqrt((i + 0.5) / CALIB_N) * 1.85; // the mean of the 16/48 pattern scales
    const a = i * GA + 0.35;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
})();

/**
 * Offsets for expected-putts tabulation. The 16-point pattern is fine for
 * full swings, where V varies slowly, but on the green it quantizes make
 * probability to 6.25% — enough to move a 20-footer's expected putts by 0.1.
 * 96 points buys ~1% granularity for a table that is built once per profile.
 */
export const PUTT_TABLE_OFFSETS = (() => {
  const pts = [];
  const GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 96; i++) {
    const r = Math.sqrt((i + 0.5) / 96) * 1.85;
    const a = i * GA + 0.2;
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
})();

const CAPTURE_STEP = 0.01; // tiles (~0.5 ft)
const CAPTURE_N = Math.round(PUTT_MAX / CAPTURE_STEP) + 1;
const CAPTURE_MAX = 0.4; // tiles — the bisection ceiling (19 ft; never binding in practice)

/** Fraction of the reference-pace pattern from `d` that a capture of `c` holes. */
function calibMakeFraction(d, c) {
  const aim = d + PUTT_REF_PACE;
  const s = puttSigmas(aim, DEFAULT_PROFILE);
  let made = 0;
  for (const o of CALIB_OFFSETS) {
    const rolled = Math.max(0, aim + o.y * s.long);
    const over = rolled - d;
    if (over < 0 || over > PUTT_OVERRUN) continue;
    // line miss measured at the cup, on a roll line that is nearly the aim line
    const line = Math.abs(o.x * s.lat) * (rolled > 1e-9 ? d / rolled : 1);
    if (line <= c * paceCapture(over)) made++;
  }
  return made / CALIB_N;
}

const captureTable = (() => {
  const t = new Float64Array(CAPTURE_N);
  for (let i = 0; i < CAPTURE_N; i++) {
    const d = i * CAPTURE_STEP;
    const target = makeRate(d * FEET_PER_TILE);
    let lo = 0;
    let hi = CAPTURE_MAX;
    for (let k = 0; k < 34; k++) {
      const mid = (lo + hi) / 2;
      if (calibMakeFraction(d, mid) < target) lo = mid;
      else hi = mid;
    }
    t[i] = (lo + hi) / 2;
  }
  return t;
})();

/**
 * Effective capture width (tiles) for a putt of `d` tiles — the inversion of
 * MAKE_CURVE through the pattern. It runs ~0.65 ft inside 10 ft and tightens
 * to ~0.44 ft out at lag range — an order of magnitude under the old 2.8-ft
 * radius, and it narrows with distance because on a long putt the few balls
 * that arrive with holeable pace are already the good ones.
 */
export function captureAt(d) {
  const i = d / CAPTURE_STEP;
  if (i <= 0) return captureTable[0];
  if (i >= CAPTURE_N - 1) return captureTable[CAPTURE_N - 1];
  const lo = Math.floor(i);
  return captureTable[lo] + (captureTable[lo + 1] - captureTable[lo]) * (i - lo);
}

/**
 * Analytic make probability for a putt of `d` tiles played `past` tiles past
 * the cup: the published curve, modified by pace. Exported as the contract
 * the sampled engine is tested against.
 */
export function puttMakeProbability(d, past = PUTT_REF_PACE, profile = DEFAULT_PROFILE) {
  const aim = d + past;
  const s = puttSigmas(aim, profile);
  const c = captureAt(d);
  let made = 0;
  for (const o of CALIB_OFFSETS) {
    const rolled = Math.max(0, aim + o.y * s.long);
    const over = rolled - d;
    if (over < 0 || over > PUTT_OVERRUN) continue;
    const line = Math.abs(o.x * s.lat) * (rolled > 1e-9 ? d / rolled : 1);
    if (line <= c * paceCapture(over)) made++;
  }
  return made / CALIB_N;
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
 * reach the cup (a putt dying at the front door does not count — it has to
 * get there), must not be pacing more than PUTT_OVERRUN (3 ft) past, and must
 * pass within the cup's effective capture — `captureAt(d)` scaled by
 * `paceCapture(over)`. Aggregated over a shot pattern this reproduces the
 * published make curve by construction, with pace as the modifier: dead
 * weight arrives half the time, three feet of run lips out.
 */
export function puttHolesOut(from, finish, cup) {
  const vx = finish.x - from.x;
  const vy = finish.y - from.y;
  const len = Math.hypot(vx, vy);
  const d = Math.hypot(cup.x - from.x, cup.y - from.y);
  if (len < 1e-9) return d <= captureAt(d); // the ball never moved: it was already in
  const ux = vx / len;
  const uy = vy / len;
  const along = (cup.x - from.x) * ux + (cup.y - from.y) * uy; // cup's station on the roll line
  if (len < along - 1e-9) return false; // died short of the hole
  const over = len - along; // how far past the cup this pace carries
  const grip = paceCapture(over);
  if (grip <= 0) return false;
  const off = Math.abs(-(cup.x - from.x) * uy + (cup.y - from.y) * ux); // line miss at the cup
  return off <= captureAt(d) * grip;
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
  const br = puttBreakDrift(course, from, p);
  return { x: p.x + br.x, y: p.y + br.y };
}

// --- green reading -----------------------------------------------------------
// Slope tiles bend a rolling ball. A putt whose line passes over or beside a
// slope tile picks up lateral drift toward the downhill direction — the
// classic cross-slope break. Flat courses (no slope tiles anywhere) take the
// exact arithmetic they always did: zero drift is the additive identity, so
// classic-green behavior is byte-identical to the pre-break engine.

export const BREAK_RATE = 0.12; // lateral tiles of drift per tile rolled on a full cross-slope
const BREAK_STEP = 0.5; // sampling interval along the roll line (tiles)

const slopedCourseCache = new WeakMap();
/** Does this course contain any slope tiles at all? Cached per course object
 *  (courses are regenerate-not-mutate, per course.js). */
export function courseHasSlopes(course) {
  let has = slopedCourseCache.get(course);
  if (has === undefined) {
    has = course.cells.some((t) => slopeDir(t) !== null);
    slopedCourseCache.set(course, has);
  }
  return has;
}

/** Downhill pull at a fractional point: the tile under the ball plus its four
 *  neighbors — a slope ON or ADJACENT to the line still grabs the roll. */
function slopePull(course, x, y) {
  const cx = Math.round(x);
  const cy = Math.round(y);
  let px = 0;
  let py = 0;
  const add = (tx, ty, w) => {
    if (!inBounds(course, tx, ty)) return;
    const d = slopeDir(cellAt(course, tx, ty));
    if (d) {
      px += d.x * w;
      py += d.y * w;
    }
  };
  add(cx, cy, 1);
  add(cx + 1, cy, 0.35);
  add(cx - 1, cy, 0.35);
  add(cx, cy + 1, 0.35);
  add(cx, cy - 1, 0.35);
  return { x: px, y: py };
}

/**
 * Accumulated break for a roll from `from` finishing at `finish`: the
 * cross-line component of downhill pull, integrated along the line, scaled by
 * BREAK_RATE. Pull ALONG the line is pace, and pace error is already priced
 * by the putt ellipse — only the lateral component becomes break.
 * @returns {{x:number, y:number, cross:number}} drift vector plus its signed
 * magnitude (positive = drifts to the right of the roll direction, screen coords).
 */
export function puttBreakDrift(course, from, finish) {
  if (!courseHasSlopes(course)) return { x: 0, y: 0, cross: 0 };
  const dx = finish.x - from.x;
  const dy = finish.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return { x: 0, y: 0, cross: 0 };
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy; // unit normal: the right-hand side of the roll direction
  const ny = ux;
  const steps = Math.max(1, Math.ceil(len / BREAK_STEP));
  const dl = len / steps;
  let cross = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dl;
    const g = slopePull(course, from.x + ux * t, from.y + uy * t);
    cross += (g.x * nx + g.y * ny) * dl;
  }
  cross *= BREAK_RATE;
  return { x: nx * cross, y: ny * cross, cross };
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
