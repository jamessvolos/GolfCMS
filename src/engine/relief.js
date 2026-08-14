// The land itself. Until now "slope" was four discrete tile codes sprinkled on
// alpine greens; the contour lines the art drew integrated a height field the
// physics had never heard of. This module IS that height field: one seeded,
// deterministic surface in FEET per hole, sampled bilinearly, generated with the
// hole and read by both the physics and the picture.
//
// Three rules govern everything below:
//
//   1. PURE AND SEEDED. buildRelief(course, seed) is a function of (routing,
//      seed) and nothing else. Same inputs, byte-identical field.
//   2. STITCHED TO THE ROUTING. Landforms are anchored to the tee→hole axis,
//      the fairway corridor is conditioned so no cliff crosses the landing
//      zone, and the green sits on a DELIBERATE landform (gather / shed / tilt
//      / shelf) rather than wherever the noise happened to land.
//   3. THE LEGACY BRIDGE. A SLOPE_* tile is a local gradient, so alpine and
//      winter courses — and every already-shared seed — write themselves into
//      the field and keep breaking the way they always did. And where a course
//      carries NO relief at all, every consumer takes its pre-relief path
//      exactly: that is the regression contract, enforced by `course.relief`
//      being the single gate.

import { substream, pickWeighted } from './rng.js';
import { FAIRWAY, GREEN, slopeDir } from './terrain.js';
import { cellAt } from './course.js';
import { YARDS_PER_TILE } from './yards.js';

/** Feet of run in one tile (1 tile = 16 yds = 48 ft). */
export const FT_PER_TILE = YARDS_PER_TILE * 3;

// A SLOPE_* tile is worth a 7% grade — paint.js's SLOPE_PCT_PER_PULL, which is
// itself derived from the engine's BREAK_RATE. One "pull" of the old tile model
// is therefore this many feet of rise per tile of run, and that constant is the
// exchange rate between the legacy vocabulary and the new one.
export const SLOPE_TILE_GRADE = 0.07;
export const FT_PER_PULL = SLOPE_TILE_GRADE * FT_PER_TILE; // 3.36 ft/tile

// --- shape vocabulary --------------------------------------------------------

/** The macro landforms a hole can be built from. */
export const LANDFORMS = ['tilt', 'ridge', 'valley', 'plateau', 'punchbowl'];
/** The landform a green site is given, deliberately, by the generator. */
export const GREEN_FORMS = ['gather', 'shed', 'tilt', 'shelf'];

// How much total relief a golf property actually shows, tee to the far corner.
// Most holes roll a little; a few are genuinely dramatic. Bounds are in FEET.
const RELIEF_CLASSES = [
  { id: 'gentle', min: 4, max: 11, weight: 34 },
  { id: 'rolling', min: 11, max: 22, weight: 46 },
  { id: 'dramatic', min: 22, max: 40, weight: 20 },
];

const NOISE_SHARE = 0.34; // fraction of the raw field that is low-octave roll
const CORRIDOR_R = 3.2; // tiles either side of mown ground that get conditioned
const CORRIDOR_PASSES = 4;
const CORRIDOR_MAX_GRADE = 0.085; // no fairway step steeper than 8.5%
const GREEN_R = 4.5; // tiles: the reach of the green's own landform
const GREEN_KEEP = 3.2; // tiles around the cup the corridor smoother leaves alone

// --- value noise -------------------------------------------------------------
// A seeded lattice with smoothstep interpolation. Two octaves is all a golf
// property wants: the first is the roll of the ground, the second is texture.

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function makeLattice(rng, w, h) {
  const v = new Float32Array(w * h);
  for (let i = 0; i < v.length; i++) v[i] = rng() * 2 - 1;
  return { v, w, h };
}

function latticeAt(l, x, y) {
  const cx = Math.min(l.w - 1.001, Math.max(0, x));
  const cy = Math.min(l.h - 1.001, Math.max(0, y));
  const i = Math.floor(cx);
  const j = Math.floor(cy);
  const a = smoothstep(cx - i);
  const b = smoothstep(cy - j);
  const k = j * l.w + i;
  return (l.v[k] * (1 - a) + l.v[k + 1] * a) * (1 - b)
    + (l.v[k + l.w] * (1 - a) + l.v[k + l.w + 1] * a) * b;
}

// --- the field ---------------------------------------------------------------

/**
 * A relief is IMMUTABLE once built — the same regenerate-rather-than-mutate rule
 * course.js states for courses. Gradients are memoized off `ft` on first read,
 * so editing the heights in place would leave the fall lines describing land
 * that no longer exists. Build a new one (`buildRelief` or `reliefFromHeights`).
 *
 * @typedef {{
 *   width: number, height: number,
 *   ft: Float32Array,          // height in FEET at each tile centre, row-major
 *   minFt: number, maxFt: number, reliefFt: number,
 *   landform: string, secondForm: string, greenForm: string, reliefClass: string,
 *   fromSlopeTiles: boolean,   // did legacy SLOPE_* tiles write into this field?
 *   seed: number
 * }} Relief
 */

/**
 * Wrap a raw feet-per-tile array as a relief — the hand-built escape hatch, for
 * authored holes, the CMS and tests. Same immutability rule as `buildRelief`.
 * @param {number} width @param {number} height
 * @param {ArrayLike<number>|((x:number,y:number)=>number)} heights feet per tile
 * @returns {Relief}
 */
export function reliefFromHeights(width, height, heights) {
  const ft = new Float32Array(width * height);
  if (typeof heights === 'function') {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) ft[y * width + x] = heights(x, y);
  } else {
    ft.set(heights);
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < ft.length; i++) {
    if (ft[i] < min) min = ft[i];
    if (ft[i] > max) max = ft[i];
  }
  return {
    width, height, ft, minFt: min, maxFt: max, reliefFt: max - min,
    landform: 'authored', secondForm: 'authored', greenForm: 'authored',
    reliefClass: 'authored', fromSlopeTiles: false, seed: 0,
  };
}

/**
 * Build the height field for a course.
 * @param {import('./course.js').Course} course
 * @param {number} [seed] defaults to course.seed
 * @param {{stream?: string, slopeTiles?: boolean}} [opts]
 *   `stream` names the RNG substream (default 'relief' — a NEW named stream, so
 *   attaching relief perturbs no existing terrain draw); `slopeTiles` may be set
 *   false to skip the legacy bridge (tests only).
 * @returns {Relief}
 */
export function buildRelief(course, seed = course.seed, opts = {}) {
  const { width, height } = course;
  const rng = substream(seed >>> 0, opts.stream ?? 'relief');

  // --- the routing frame: everything is anchored to the tee→hole axis --------
  const A = course.tee;
  const B = course.hole;
  const L = Math.max(1, Math.hypot(B.x - A.x, B.y - A.y));
  const ux = (B.x - A.x) / L;
  const uy = (B.y - A.y) / L;
  const nx = -uy;
  const ny = ux;
  const along = (x, y) => ((x - A.x) * ux + (y - A.y) * uy) / L; // 0 at tee, 1 at hole
  const across = (x, y) => (x - A.x) * nx + (y - A.y) * ny; // tiles, signed

  // --- macro landforms ------------------------------------------------------
  const reliefClass = pickWeighted(rng, RELIEF_CLASSES.map((c) => [c, c.weight]));
  const targetFt = reliefClass.min + rng() * (reliefClass.max - reliefClass.min);

  const primary = pickWeighted(rng, [
    ['tilt', 30], ['ridge', 20], ['valley', 18], ['plateau', 18], ['punchbowl', 14],
  ]);
  const secondary = pickWeighted(rng, [
    ['tilt', 34], ['ridge', 22], ['valley', 20], ['plateau', 14], ['punchbowl', 10],
  ]);
  const mix = 0.22 + rng() * 0.36; // how much of the second form shows through

  // Anchors sit ON the routing, not at random: a ridge crosses the hole
  // somewhere a golfer has to deal with it, a bowl gathers near a landing zone
  // or the green. `anchorS` is a station along the tee→hole axis.
  const shapeOf = (kind) => {
    const anchorS = 0.3 + rng() * 0.75; // late-ish: the interesting half of the hole
    const offset = (rng() * 2 - 1) * 5; // tiles off the axis
    const cx = A.x + (B.x - A.x) * anchorS + nx * offset;
    const cy = A.y + (B.y - A.y) * anchorS + ny * offset;
    const theta = rng() * Math.PI * 2;
    const w = 3.5 + rng() * 6.5; // tiles of half-width
    const R = 6 + rng() * 9;
    const sign = rng() < 0.5 ? -1 : 1;
    return { kind, cx, cy, theta, w, R, sign, anchorS };
  };
  const p1 = shapeOf(primary);
  const p2 = shapeOf(secondary);

  const evalShape = (s, x, y) => {
    switch (s.kind) {
      case 'tilt': {
        // a whole-property tilt: the plane the hole is cut into
        const a = along(x, y) * 2 - 1;
        const b = across(x, y) / 9;
        return Math.cos(s.theta) * a + Math.sin(s.theta) * b;
      }
      case 'ridge':
      case 'valley': {
        // a spine crossing the property; distance is measured perpendicular
        const dx = x - s.cx;
        const dy = y - s.cy;
        const d = Math.abs(-Math.sin(s.theta) * dx + Math.cos(s.theta) * dy);
        const bump = Math.exp(-(d / s.w) * (d / s.w));
        return s.kind === 'ridge' ? bump * 2 - 0.6 : 0.6 - bump * 2;
      }
      case 'plateau': {
        // a shelf: flat ground stepping up to flat ground across one line
        const dx = x - s.cx;
        const dy = y - s.cy;
        const d = (-Math.sin(s.theta) * dx + Math.cos(s.theta) * dy) / s.w;
        return (smoothstep(Math.min(1, Math.max(0, d * 0.5 + 0.5))) * 2 - 1) * s.sign;
      }
      case 'punchbowl':
      default: {
        const r = Math.hypot(x - s.cx, y - s.cy) / s.R;
        return -(Math.max(0, 1 - r * r)) * 2 + 0.5;
      }
    }
  };

  // low-octave roll: a golf property is never a clean quadric
  const l1 = makeLattice(rng, 8, 6);
  const l2 = makeLattice(rng, 15, 10);
  const noiseAt = (x, y) => latticeAt(l1, (x / width) * (l1.w - 1), (y / height) * (l1.h - 1))
    + 0.42 * latticeAt(l2, (x / width) * (l2.w - 1), (y / height) * (l2.h - 1));

  const ft = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const macro = evalShape(p1, x, y) + mix * evalShape(p2, x, y);
      ft[y * width + x] = macro * (1 - NOISE_SHARE) + noiseAt(x, y) * NOISE_SHARE;
    }
  }
  rescaleTo(ft, targetFt);

  // --- stitch to the routing: the corridor must stay playable ---------------
  conditionCorridor(course, ft);

  // --- the green sits on a chosen landform ----------------------------------
  const greenForm = pickWeighted(rng, [
    ['gather', 26], ['shed', 24], ['tilt', 32], ['shelf', 18],
  ]);
  const greenAmp = 1.2 + rng() * 3.3; // feet across the complex
  const greenTheta = rng() * Math.PI * 2;
  applyGreenForm(course, ft, greenForm, greenAmp, greenTheta, ux, uy);

  // --- the legacy bridge: SLOPE_* tiles ARE local gradients -----------------
  const fromSlopeTiles = opts.slopeTiles === false ? false : writeSlopeTiles(course, ft);

  // --- datum: the tee is zero, so plays-like reads as a golfer would say it --
  const relief = {
    width, height, ft,
    minFt: 0, maxFt: 0, reliefFt: 0,
    landform: primary, secondForm: secondary, greenForm,
    reliefClass: reliefClass.id, fromSlopeTiles, seed: seed >>> 0,
  };
  const datum = heightAt(relief, course.tee.x, course.tee.y);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < ft.length; i++) {
    ft[i] -= datum;
    if (ft[i] < min) min = ft[i];
    if (ft[i] > max) max = ft[i];
  }
  relief.minFt = min;
  relief.maxFt = max;
  relief.reliefFt = max - min;
  return relief;
}

/** Rescale a raw field so its total relief is exactly `targetFt` feet. */
function rescaleTo(ft, targetFt) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < ft.length; i++) {
    if (ft[i] < min) min = ft[i];
    if (ft[i] > max) max = ft[i];
  }
  const span = max - min;
  const k = span > 1e-9 ? targetFt / span : 0;
  for (let i = 0; i < ft.length; i++) ft[i] = (ft[i] - min) * k;
}

/**
 * The corridor guarantee, in elevation. generate.js promises a playable route
 * of tiles; this promises the route is playable in THREE dimensions — no cliff
 * across a landing zone, no wall the second shot has to climb. Mown ground and
 * its immediate surround are relaxed toward their own local mean and then
 * gradient-limited; the rough outside the corridor keeps every foot of drama.
 */
function conditionCorridor(course, ft) {
  const { width, height } = course;
  // distance (in tiles) from every cell to the nearest mown tile — two chamfer
  // passes, which is exact enough at this radius and costs nothing
  const D = new Float32Array(width * height).fill(1e6);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = cellAt(course, x, y);
      if (t === FAIRWAY || t === GREEN) D[y * width + x] = 0;
    }
  }
  const relax = (xs, ys) => {
    for (const y of ys) {
      for (const x of xs) {
        const k = y * width + x;
        let best = D[k];
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const c = D[ny * width + nx] + (dx && dy ? Math.SQRT2 : 1);
          if (c < best) best = c;
        }
        D[k] = best;
      }
    }
  };
  const fwd = { xs: [...Array(width).keys()], ys: [...Array(height).keys()] };
  const rev = { xs: [...fwd.xs].reverse(), ys: [...fwd.ys].reverse() };
  relax(fwd.xs, fwd.ys);
  relax(rev.xs, rev.ys);

  // corridor weight, held OFF the green so the green keeps its own landform
  const w = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = y * width + x;
      let wt = Math.max(0, Math.min(1, 1 - D[k] / CORRIDOR_R));
      const dh = Math.hypot(x - course.hole.x, y - course.hole.y);
      if (dh < GREEN_KEEP + 2) wt *= smoothstep(Math.max(0, Math.min(1, (dh - GREEN_KEEP) / 2)));
      w[k] = wt;
    }
  }

  // relax toward the local mean where the corridor runs
  const tmp = new Float32Array(ft.length);
  for (let pass = 0; pass < CORRIDOR_PASSES; pass++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const k = y * width + x;
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const wt = dx === 0 && dy === 0 ? 4 : (dx && dy ? 1 : 2);
            sum += ft[ny * width + nx] * wt;
            n += wt;
          }
        }
        tmp[k] = ft[k] + (sum / n - ft[k]) * w[k];
      }
    }
    ft.set(tmp);
  }

  // and then a hard gradient limit: no step across mown ground steeper than
  // CORRIDOR_MAX_GRADE. Two endpoints of an offending edge are pulled together
  // by half the excess each, which converges in a handful of sweeps.
  const maxStep = CORRIDOR_MAX_GRADE * FT_PER_TILE;
  for (let pass = 0; pass < 12; pass++) {
    let worst = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const k = y * width + x;
        if (w[k] < 0.5) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= width || ny >= height) continue;
          const m = ny * width + nx;
          if (w[m] < 0.5) continue;
          const diff = ft[m] - ft[k];
          const over = Math.abs(diff) - maxStep;
          if (over <= 0) continue;
          worst = Math.max(worst, over);
          const fix = Math.sign(diff) * over * 0.5;
          ft[k] += fix * 0.5;
          ft[m] -= fix * 0.5;
        }
      }
    }
    if (worst < 0.01) break;
  }
}

/**
 * Give the green site a deliberate shape. `gather` feeds a ball to the middle,
 * `shed` throws it off in every direction, `tilt` runs back-to-front the way a
 * receptive green does, `shelf` splits the surface into two levels.
 */
function applyGreenForm(course, ft, form, amp, theta, ux, uy) {
  const { width, height } = course;
  const H = course.hole;
  const r0 = Math.ceil(GREEN_R) + 1;
  for (let y = Math.max(0, H.y - r0); y <= Math.min(height - 1, H.y + r0); y++) {
    for (let x = Math.max(0, H.x - r0); x <= Math.min(width - 1, H.x + r0); x++) {
      const dx = x - H.x;
      const dy = y - H.y;
      const r = Math.hypot(dx, dy) / GREEN_R;
      if (r >= 1) continue;
      const mask = (1 - r * r) ** 2; // smooth to zero at the rim
      let v;
      switch (form) {
        case 'gather': v = -(1 - r * r); break;
        case 'shed': v = 1 - r * r; break;
        case 'shelf': {
          const d = (-Math.sin(theta) * dx + Math.cos(theta) * dy) / 1.6;
          v = smoothstep(Math.min(1, Math.max(0, d * 0.5 + 0.5))) * 2 - 1;
          break;
        }
        case 'tilt':
        default:
          // back-to-front: the far side of the green (away from the tee) is
          // the high side, so an approach lands into an upslope and holds
          v = (dx * ux + dy * uy) / GREEN_R * 2;
          break;
      }
      ft[y * width + x] += amp * v * mask;
    }
  }
}

/**
 * THE LEGACY BRIDGE. Each SLOPE_* tile stamps a local plane whose fall line
 * points the way the tile always did, at SLOPE_TILE_GRADE, with a kernel that
 * reproduces the old slopePull neighbour weights (1 underfoot, ~0.35 one tile
 * away). So alpine greens and winter courses keep their break, in the same
 * direction and to within a hair of the same magnitude, now expressed as
 * geometry the rest of the engine can read.
 * @returns {boolean} whether any slope tile contributed
 */
function writeSlopeTiles(course, ft) {
  const { width, height } = course;
  // exp(-K r²) with K = ln(1/0.35) puts the one-tile neighbour at 0.35
  const K = Math.log(1 / 0.35);
  const REACH = 2;
  let any = false;
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const d = slopeDir(cellAt(course, cx, cy));
      if (!d) continue;
      any = true;
      for (let y = Math.max(0, cy - REACH); y <= Math.min(height - 1, cy + REACH); y++) {
        for (let x = Math.max(0, cx - REACH); x <= Math.min(width - 1, cx + REACH); x++) {
          const dx = x - cx;
          const dy = y - cy;
          const r2 = dx * dx + dy * dy;
          if (r2 > REACH * REACH + 0.01) continue;
          // height falls along d: h = -grade * (d · offset) * kernel(r)
          ft[y * width + x] -= FT_PER_PULL * (d.x * dx + d.y * dy) * Math.exp(-K * r2);
        }
      }
    }
  }
  return any;
}

// --- sampling ----------------------------------------------------------------

/**
 * Height in FEET at a fractional tile coordinate, bilinear. Tile (x, y) has its
 * sample at the integer coordinate; outside the grid the edge value is held, so
 * a ball hooked into the car park still gets a finite answer.
 */
export function heightAt(relief, x, y) {
  if (!relief) return 0;
  const { ft, width, height } = relief;
  const u = Math.min(width - 1.0001, Math.max(0, x));
  const v = Math.min(height - 1.0001, Math.max(0, y));
  const i = Math.floor(u);
  const j = Math.floor(v);
  const a = u - i;
  const b = v - j;
  const k = j * width + i;
  return (ft[k] * (1 - a) + ft[k + 1] * a) * (1 - b)
    + (ft[k + width] * (1 - a) + ft[k + width + 1] * a) * b;
}

const GRAD_EPS = 0.5; // tiles: central differences over half a tile

/**
 * Per-tile gradients, built once and cached on the relief. The cache is a
 * memo, not state: it is a pure function of `ft`, it is defined
 * non-enumerably so a relief still compares and serializes as its data, and
 * dropping it changes nothing but speed. Value iteration samples the gradient
 * tens of thousands of times per hole, so this is the difference between the
 * caddie thinking for one second and thinking for two.
 */
function nodeGradients(relief) {
  if (relief.gxNode) return relief;
  const { width, height } = relief;
  const gxNode = new Float32Array(width * height);
  const gyNode = new Float32Array(width * height);
  const e = GRAD_EPS;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = y * width + x;
      gxNode[k] = (heightAt(relief, x + e, y) - heightAt(relief, x - e, y)) / (2 * e);
      gyNode[k] = (heightAt(relief, x, y + e) - heightAt(relief, x, y - e)) / (2 * e);
    }
  }
  Object.defineProperty(relief, 'gxNode', { value: gxNode, enumerable: false, configurable: true });
  Object.defineProperty(relief, 'gyNode', { value: gyNode, enumerable: false, configurable: true });
  return relief;
}

/**
 * The UPHILL gradient in feet per tile — ∇h, so {dx, dy} points the way the
 * ground RISES and its negation is the fall line. Central differences of
 * `heightAt` taken at the tile centres and then read back bilinearly, which
 * keeps the gradient continuous everywhere (a plain per-cell bilinear
 * derivative would step at every tile border, and a putt would feel the steps).
 */
export function gradientAt(relief, x, y) {
  if (!relief) return { dx: 0, dy: 0 };
  const { width, height } = nodeGradients(relief);
  const u = Math.min(width - 1.0001, Math.max(0, x));
  const v = Math.min(height - 1.0001, Math.max(0, y));
  const i = Math.floor(u);
  const j = Math.floor(v);
  const a = u - i;
  const b = v - j;
  const k = j * width + i;
  const lerp = (buf) => (buf[k] * (1 - a) + buf[k + 1] * a) * (1 - b)
    + (buf[k + width] * (1 - a) + buf[k + width + 1] * a) * b;
  return { dx: lerp(relief.gxNode), dy: lerp(relief.gyNode) };
}

/** The fall line at a point: a UNIT vector downhill plus the grade it runs at. */
export function fallLineAt(relief, x, y) {
  const g = gradientAt(relief, x, y);
  const m = Math.hypot(g.dx, g.dy);
  if (m < 1e-9) return { x: 0, y: 0, ftPerTile: 0, pct: 0 };
  return { x: -g.dx / m, y: -g.dy / m, ftPerTile: m, pct: (m / FT_PER_TILE) * 100 };
}

/** Grade at a point as a percentage — the golfer's own unit. */
export function gradePctAt(relief, x, y) {
  const g = gradientAt(relief, x, y);
  return (Math.hypot(g.dx, g.dy) / FT_PER_TILE) * 100;
}

/** The old tile model's "pull" units, read off the continuous field: 1.0 pull
 *  is one SLOPE_* tile underfoot. Downhill-pointing, like slopePull was. */
export function pullAt(relief, x, y) {
  const g = gradientAt(relief, x, y);
  return { x: -g.dx / FT_PER_PULL, y: -g.dy / FT_PER_PULL };
}

// --- plays-like --------------------------------------------------------------
// The standard caddie rule: about a yard of club per foot of rise. It is a rule
// for a full shot, though — nobody adds five yards to a 20-yard pitch because
// the green is five feet up — so it fades in with carry.

export const PLAYS_YDS_PER_FT = 1;
const PLAYS_FULL_TILES = 6; // ~100 yds: the shortest shot that takes the whole rule

/**
 * How far a shot from `from` to `to` actually plays.
 * @param {Relief|null} relief
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {number} [carryTiles] geometric carry, if already known
 * @returns {{riseFt:number, carryTiles:number, playsTiles:number,
 *            deltaTiles:number, deltaYards:number, carryYards:number,
 *            playsYards:number}}
 *   `riseFt` positive is uphill; uphill plays LONGER.
 */
export function playsLike(relief, from, to, carryTiles = null) {
  const d = carryTiles ?? Math.hypot(to.x - from.x, to.y - from.y);
  if (!relief) {
    return {
      riseFt: 0, carryTiles: d, playsTiles: d, deltaTiles: 0, deltaYards: 0,
      carryYards: d * YARDS_PER_TILE, playsYards: d * YARDS_PER_TILE,
    };
  }
  const riseFt = heightAt(relief, to.x, to.y) - heightAt(relief, from.x, from.y);
  const fade = Math.min(1, d / PLAYS_FULL_TILES);
  const deltaYards = riseFt * PLAYS_YDS_PER_FT * fade;
  const deltaTiles = deltaYards / YARDS_PER_TILE;
  const playsTiles = Math.max(0.2, d + deltaTiles);
  return {
    riseFt,
    carryTiles: d,
    playsTiles,
    deltaTiles,
    deltaYards,
    carryYards: d * YARDS_PER_TILE,
    playsYards: playsTiles * YARDS_PER_TILE,
  };
}

/** Total rise from tee to green, in feet — the scorecard's own elevation note. */
export function holeRiseFeet(course) {
  const r = course?.relief;
  if (!r) return 0;
  return heightAt(r, course.hole.x, course.hole.y) - heightAt(r, course.tee.x, course.tee.y);
}
