// Green architecture. Until now every green in the game was one line —
// `stampDisc(course, hole.x, hole.y, 2.5, GREEN)` — a 2.5-tile circle, on every
// hole, in every biome. Green *shape* is the most legible signature a golf hole
// has, and we had exactly one. This module is the replacement.
//
// A green complex is planned in four movements, all on the landform release B
// built:
//
//   1. THE SILHOUETTE. A parametric implicit shape in the green's own frame —
//      an axis set against the line of play, semi-axes sized to the hole, and
//      bites taken out of it — rasterized onto the tile grid and reduced to the
//      connected component the cup sits in. Not a stamp: `round` and
//      `long-narrow` and `boomerang` are the same three lines of algebra with
//      different numbers.
//   2. THE SURFACE. Tiers, bowls, crowns and swales are written into a COPY of
//      the hole's height field, so a shelf is a real 4-foot step the physics
//      putts across and the art shades, not a label. Grades are then limited so
//      the surface stays puttable and the apron stays walkable.
//   3. THE HAZARDS, BY ROLE. Not scattered: guard the short side, punish the
//      greedy line, frame the entrance, trouble long, mow a collection area.
//      Every plan reserves an ENTRANCE wedge on the approach side and the hole's
//      own spine tiles, so there is always a ground route in — a green is never
//      fully encircled, the island's moat included (it gets a neck).
//   4. THE PIN. Legal pin zones are derived FROM the surface: interior cells
//      (never within a tile of an edge) flat enough to hold a cup, grouped by
//      shelf and by quadrant, and named the way a caddie names them —
//      "back-right shelf". The cup is today's pin; `pinFor(course, day)` walks
//      the rota.
//
// Two rules, the same two release B kept:
//
//   PURE AND SEEDED. The plan is a function of (finished layout, relief, seed)
//   and nothing else, drawn from its OWN named substreams AFTER every existing
//   layout draw — so no already-shared seed's fairway, trees or hazards move.
//   Only the green complex itself is new ground.
//
//   CERTIFIED OR REROLLED. Every plan is checked — reachable, puttable, pin
//   legal, a ground route in, area in bounds — and a plan that fails is rerolled
//   deterministically into a differently-named substream, so a reroll is a
//   different GREEN rather than a different course. The last resort is a plain
//   graded green with no hazard plan; across the seed space nothing reaches it.

import { substream, pickWeighted } from './rng.js';
import { FAIRWAY, ROUGH, SAND, WATER, GREEN, isRestable } from './terrain.js';
import { cellAt, inBounds } from './course.js';
import { gradientAt, FT_PER_TILE } from './relief.js';

/** The shape vocabulary. Every one of these appears across a few hundred seeds. */
export const GREEN_ARCHETYPES = [
  'round', 'kidney', 'boomerang', 'long-narrow', 'tiered', 'punchbowl', 'crowned', 'island',
];

/** What a green-complex hazard is FOR. A plan is a list of these, never a scatter. */
export const HAZARD_ROLES = [
  'short-side',   // the small-margin side of the green: the miss that has no room
  'greedy',       // the aggressive line at a tucked pin
  'frame-left',   // the entrance's flanks — they frame the ground route, never block it
  'frame-right',
  'wrap',         // the bunker a kidney/boomerang green is bent around
  'long',         // trouble through the back (Road-style: long is dead)
  'carry',        // water short, off the entrance: a diagonal carry
  'moat',         // the island's water, everywhere but the neck
  'false-front',  // a slope that rejects the short approach back down the hill
  'runoff',       // a mown collection area off a shoulder
  'swale',        // a closely-mown chipping hollow beside the green
];

export const SIZE_CLASSES = ['small', 'medium', 'large'];

// --- the contract numbers ----------------------------------------------------

/** Degenerate bounds. The old disc was 21 tiles; a green may be half that or
 *  nearly double, but never a postage stamp and never a field. */
export const MIN_GREEN_TILES = 9;
export const MAX_GREEN_TILES = 42;

/** A cup is never cut within this many tiles of an edge. */
export const PIN_EDGE_MARGIN = 1;
/** Nor on ground steeper than this: 4.5% is about the limit a hole location
 *  committee will accept before a ball will not sit still. */
export const PIN_MAX_GRADE = 0.045;
/** A putting surface steeper than this is a slide, not a green. */
export const GREEN_MAX_GRADE = 0.12;
/** And the mown apron around it keeps release B's walkable-corridor promise. */
export const APRON_MAX_GRADE = 0.095;
/** Total hole relief the complex is allowed to leave behind (release B's own
 *  plausibility bound is 45 ft; the complex never spends the last three). */
const RELIEF_BUDGET_FT = 42;

/** Tiles from the cup that count as "the green complex" — the only ground this
 *  module is ever allowed to touch. Everything outside is release A/B's. */
export const COMPLEX_R = 8;

const MAX_ATTEMPTS = 10;
const ENTRANCE_HALF = 0.72; // radians (~41°) of open ground on the approach side
const ENTRANCE_REACH = 4.5; // tiles beyond the green edge the entrance stays clear

// --- small vector/grid helpers ----------------------------------------------

const TAU = Math.PI * 2;

function norm(dx, dy) {
  const m = Math.hypot(dx, dy) || 1;
  return { x: dx / m, y: dy / m };
}

/** Signed smallest angle between two bearings. */
function angleDelta(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function smoothstep(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

const key = (x, y) => y * 1000 + x;

// --- the silhouette ----------------------------------------------------------

/**
 * The shape parameters for an archetype. Everything is in TILES, in the green's
 * own frame: `u` runs along the green's axis, `v` across it.
 */
function shapeFor(rng, archetype, areaTiles) {
  const aspect = {
    round: 0.9 + rng() * 0.35,
    kidney: 1.15 + rng() * 0.4,
    boomerang: 1.25 + rng() * 0.45,
    'long-narrow': 2.3 + rng() * 1.0,
    tiered: 1.0 + rng() * 0.6,
    punchbowl: 0.9 + rng() * 0.35,
    crowned: 0.9 + rng() * 0.3,
    island: 0.9 + rng() * 0.35,
  }[archetype];

  // a bitten shape has to start larger to finish at the target area
  const inflate = archetype === 'kidney' ? 1.18 : archetype === 'boomerang' ? 1.5 : 1;
  // No green is thinner than MIN_HALF: below ~1.75 tiles of half-width there is
  // no interior left, and a green with no interior has no legal pin. For the
  // narrow archetypes that is a floor on AREA, not on shape — a Biarritz is a
  // big green by definition, and squashing one into a small footprint would
  // just produce a slightly oval circle.
  const MIN_HALF = 1.75;
  let S = areaTiles * inflate;
  if (aspect > 1.6) S = Math.max(S, Math.PI * MIN_HALF * MIN_HALF * aspect * 1.06);
  let a = Math.sqrt((S * aspect) / Math.PI);
  let b = Math.sqrt(S / (Math.PI * aspect));
  if (b < MIN_HALF) { b = MIN_HALF; a = S / (Math.PI * b); }
  if (a < MIN_HALF) { a = MIN_HALF; b = S / (Math.PI * a); }

  const lobeK = 2 + Math.floor(rng() * 3);
  const lobeAmp = 0.05 + rng() * 0.09;
  const lobePhase = rng() * TAU;

  const bites = [];
  const side = rng() < 0.5 ? -1 : 1;
  // A bite is a disc pushed in from one flank. `pen` is how far it eats past
  // the edge, in tiles — the one number that separates a kidney's soft
  // concavity from a boomerang's wrap, and the one the cup's elbow room is
  // bought back out of when a plan is too greedy with it.
  if (archetype === 'kidney') {
    const rb = b * (0.9 + rng() * 0.3);
    bites.push({ u: (rng() * 0.5 - 0.25) * a, s: side, r: rb, pen: rb * (0.28 + rng() * 0.12) });
  } else if (archetype === 'boomerang') {
    const rb = b * (1.3 + rng() * 0.4);
    bites.push({ u: (rng() * 0.4 - 0.2) * a, s: side, r: rb, pen: rb * (0.62 + rng() * 0.18) });
  }

  return { archetype, a, b, aspect, lobeK, lobeAmp, lobePhase, bites, side };
}

/** Where a bite's centre sits, at a given penetration scale. */
function biteCentre(shape, bite, penScale = 1) {
  return { u: bite.u, v: bite.s * (shape.b + bite.r - bite.pen * penScale) };
}

/** Is the local point (u, v) inside this silhouette? */
function insideShape(s, u, v, penScale = 1) {
  const nu = u / s.a;
  const nv = v / s.b;
  const r = Math.hypot(nu, nv);
  if (r > 1 + s.lobeAmp * Math.cos(s.lobeK * Math.atan2(nv, nu) + s.lobePhase)) return false;
  for (const bite of s.bites) {
    const c = biteCentre(s, bite, penScale);
    if (Math.hypot(u - c.u, v - c.v) < bite.r) return false;
  }
  return true;
}

// --- the plan ----------------------------------------------------------------

/**
 * @typedef {{
 *   archetype: string, sizeClass: string, areaTiles: number,
 *   theta: number, a: number, b: number,
 *   center: {x: number, y: number}, cells: Array<{x: number, y: number}>,
 *   tiers: Array<{id: string, name: string, tiles: number, meanFt: number}>,
 *   tierStepFt: number,
 *   hazards: Array<{role: string, kind: string, tiles: number, x: number, y: number}>,
 *   entrance: {theta: number, halfWidth: number, tiles: number},
 *   pinZones: Array<{id: string, name: string, tiles: number, x: number, y: number}>,
 *   pin: {x: number, y: number, zone: string, name: string},
 *   certified: object, attempt: number
 * }} GreenPlan
 */

/**
 * Build a certified green complex for a course that already has its layout and
 * its height field, and write it in. This is the ONLY entry point the generator
 * uses; everything below it is pure.
 *
 * @param {import('./course.js').Course} course a finished, relieved course
 * @param {number} [seed]
 * @param {{spine?: Array<{x:number,y:number}>}} [opts] the routing spine, so the
 *   ground route in can be protected tile-for-tile
 * @returns {GreenPlan}
 */
export function applyGreenComplex(course, seed = course.seed, opts = {}) {
  const spine = opts.spine ?? [];
  const rejected = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const plan = planGreen(course, seed, attempt, spine);
    if (plan.certified.ok) {
      plan.certified.rejected = rejected;
      commit(course, plan);
      return plan;
    }
    rejected.push(`${plan.archetype}: ${plan.certified.reasons.join('; ')}`);
  }
  // The floor: a plain graded round green with no hazard plan. It is still a
  // GRADED green — pad, pin zones and all — so it certifies where the raw
  // hillside would not. Across the seed space it is not expected to be reached.
  const plan = planGreen(course, seed, -1, spine);
  plan.certified.rejected = rejected;
  commit(course, plan);
  return plan;
}

function commit(course, plan) {
  course.cells = plan.cellsOut;
  course.relief = plan.reliefOut;
  course.green = publicPlan(plan);
  course.pin = { ...plan.pin };
  delete plan.cellsOut;
  delete plan.reliefOut;
}

/** The serializable half of the plan — what rides on the course. */
function publicPlan(p) {
  return {
    archetype: p.archetype,
    sizeClass: p.sizeClass,
    areaTiles: p.areaTiles,
    theta: p.theta,
    a: p.a,
    b: p.b,
    center: p.center,
    cells: p.cells,
    tiers: p.tiers,
    tierStepFt: p.tierStepFt,
    hazards: p.hazards,
    entrance: p.entrance,
    pinZones: p.pinZones,
    pin: p.pin,
    certified: p.certified,
    attempt: p.attempt,
  };
}

/**
 * One deterministic attempt at a green complex. `attempt` names the substreams,
 * so a reroll is a different green rather than a different course; `attempt`
 * of -1 is the plain-green fallback.
 */
function planGreen(course, seed, attempt, spine) {
  const H = course.hole;
  const T = course.tee;
  const fallback = attempt < 0;
  const tag = fallback ? 'green:fallback' : `green:${attempt}`;
  const rng = substream(seed >>> 0, tag);
  const hazRng = substream(seed >>> 0, fallback ? 'greenhaz:fallback' : `greenhaz:${attempt}`);

  // --- the frame: the green is set against the line of play -----------------
  const ap = norm(H.x - T.x, H.y - T.y); // the approach, tee → green
  const apTheta = Math.atan2(ap.y, ap.x);
  const entTheta = apTheta + Math.PI; // the way home: the entrance faces the golfer

  // --- size: a short par 3 gets a small green, a long par 4 a big one -------
  const holeTiles = Math.hypot(H.x - T.x, H.y - T.y);
  const sizeClass = fallback
    ? 'medium'
    : pickWeighted(rng, holeTiles < 15
      ? [['small', 52], ['medium', 38], ['large', 10]]
      : holeTiles < 25
        ? [['small', 22], ['medium', 50], ['large', 28]]
        : [['small', 10], ['medium', 42], ['large', 48]]);
  const areaBand = { small: [11, 16], medium: [16, 24], large: [24, 33] }[sizeClass];
  let areaTiles = areaBand[0] + rng() * (areaBand[1] - areaBand[0]);

  const archetype = fallback ? 'round' : pickWeighted(rng, [
    ['round', 20], ['kidney', 15], ['boomerang', 9], ['long-narrow', 13],
    ['tiered', 16], ['punchbowl', 10], ['crowned', 10], ['island', 7],
  ]);

  // A shelf needs a green long enough to have two flat halves and a step
  // between them; on a 15-tile green the transition IS the green.
  if (archetype === 'tiered') areaTiles = Math.max(areaTiles, 19);

  // Orientation: a long green set diagonally to the approach is a different
  // puzzle from one facing you square. Narrow shapes get the bigger swings.
  const skewMax = archetype === 'long-narrow' ? 1.15 : archetype === 'tiered' ? 0.8 : 0.55;
  const theta = fallback ? apTheta : apTheta + (rng() * 2 - 1) * skewMax;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);

  const shape = fallback
    ? { archetype: 'round', a: 2.5, b: 2.5, aspect: 1, lobeK: 2, lobeAmp: 0, lobePhase: 0, bites: [], side: 1 }
    : shapeFor(rng, archetype, areaTiles);

  // The cup sits OFF centre — a green whose centre is always the hole is a
  // target, not a puzzle. But a cup on the edge is not a cup, so the offset is
  // pulled back, halving, until the cup has a full tile of green all round it.
  // Deterministic: still one draw, resolved rather than searched.
  const offU0 = fallback ? 0 : (rng() * 2 - 1) * shape.a * 0.32;
  const offV0 = fallback ? 0 : (rng() * 2 - 1) * shape.b * 0.32;
  const reach = Math.ceil(Math.max(shape.a, shape.b) * (1 + shape.lobeAmp)) + 1;

  let center = null;
  let cellSet = null;
  let penScale = 1;
  for (let k = 0; k < 5; k++) {
    const s = 0.5 ** k;
    penScale = Math.max(0, 1 - k * 0.28); // and the bite is pulled back with it
    const offU = offU0 * s;
    const offV = offV0 * s;
    center = { x: H.x - (offU * ct - offV * st), y: H.y - (offU * st + offV * ct) };
    const raw = new Set();
    for (let y = Math.max(0, Math.round(center.y) - reach); y <= Math.min(course.height - 1, Math.round(center.y) + reach); y++) {
      for (let x = Math.max(0, Math.round(center.x) - reach); x <= Math.min(course.width - 1, Math.round(center.x) + reach); x++) {
        if (x === course.tee.x && y === course.tee.y) continue;
        const dx = x - center.x;
        const dy = y - center.y;
        if (insideShape(shape, dx * ct + dy * st, -dx * st + dy * ct, penScale)) raw.add(key(x, y));
      }
    }
    raw.add(key(H.x, H.y)); // the cup is on the green by definition
    cellSet = componentContaining(raw, H.x, H.y);
    if (NEIGHBOURS8.every(([dx, dy]) => cellSet.has(key(H.x + dx, H.y + dy)))) break;
  }
  shape.penScale = penScale;
  const cells = [...cellSet].map((k) => ({ x: k % 1000, y: Math.floor(k / 1000) }))
    .sort((p, q) => (p.y - q.y) || (p.x - q.x));

  // --- write the tiles ------------------------------------------------------
  const cellsOut = course.cells.slice();
  const put = (x, y, t) => { cellsOut[y * course.width + x] = t; };
  // the old disc's footprint that the new green does not use becomes the mown
  // surround — the collection apron every real green complex has
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      if (cellAt(course, x, y) === GREEN && !cellSet.has(key(x, y))) put(x, y, FAIRWAY);
    }
  }
  for (const c of cells) put(c.x, c.y, GREEN);

  // --- protected ground: the spine near the green is the route in -----------
  const protectedSet = new Set();
  for (const p of spine) {
    if (Math.hypot(p.x - H.x, p.y - H.y) <= COMPLEX_R + 2) protectedSet.add(key(p.x, p.y));
  }
  protectedSet.add(key(course.tee.x, course.tee.y));

  // --- the surface ----------------------------------------------------------
  const ft = Float32Array.from(course.relief.ft);
  const surface = shapeSurface(course, ft, {
    shape, archetype, center, ct, st, cells, cellSet, cup: H, rng: fallback ? null : rng,
  });

  // --- hazards, by role -----------------------------------------------------
  const hazards = fallback ? [] : placeHazards(course, cellsOut, ft, {
    shape, archetype, center, ct, st, cellSet, cells, entTheta, apTheta,
    protectedSet, rng: hazRng, areaTiles: cells.length,
  });

  // The hole location gets its pad. A cup cut on a ramp is not a hole location
  // — greenkeepers level the ground around a cup for exactly this reason — so
  // where the archetype and the landform between them leave the cup too steep,
  // a saucer a couple of tiles across is relaxed flat under it. Applied only
  // when it is needed, so the break a putt reads elsewhere is untouched.
  for (let k = 0; k < 2 && nodeGrade(course, ft, H.x, H.y) > PIN_MAX_GRADE * 0.8; k++) {
    // the saucer is sized to the green: on a small one a full-size pad would
    // flatten the whole surface
    flattenCupPad(course, ft, cellSet, H,
      Math.max(1.2, Math.min(CUP_PAD_R, Math.max(shape.a, shape.b) * 0.55)));
  }

  limitGrades(course, cellsOut, ft, H);
  fitReliefBudget(course, ft);
  const reliefOut = withHeights(course.relief, ft);
  reliefOut.greenArchetype = archetype;

  // --- tiers, measured off the finished field -------------------------------
  const tiers = measureTiers(surface, cells, reliefOut, course.width);
  const tierStepFt = tiers.length === 2 ? Math.abs(tiers[1].meanFt - tiers[0].meanFt) : 0;

  // --- pins -----------------------------------------------------------------
  const zones = pinZones(course, cellsOut, reliefOut, {
    cells, cellSet, center, ct, st, shape, surface, archetype,
  });
  const cupZone = zones.find((z) => z.cells.some((c) => c.x === H.x && c.y === H.y));
  const pin = cupZone
    ? { x: H.x, y: H.y, zone: cupZone.id, name: cupZone.name }
    : { x: H.x, y: H.y, zone: 'unzoned', name: 'the cup' };

  const plan = {
    archetype,
    sizeClass,
    areaTiles: cells.length,
    theta,
    a: shape.a,
    b: shape.b,
    center: { x: +center.x.toFixed(4), y: +center.y.toFixed(4) },
    cells,
    tiers,
    tierStepFt: +tierStepFt.toFixed(3),
    hazards,
    entrance: { theta: entTheta, halfWidth: ENTRANCE_HALF, tiles: surface.entranceTiles },
    pinZones: zones.map((z) => ({ id: z.id, name: z.name, tiles: z.cells.length, x: z.x, y: z.y })),
    pin,
    attempt,
    cellsOut,
    reliefOut,
  };
  plan.certified = certifyGreen(course, plan, zones, cupZone);
  return plan;
}

// --- the surface -------------------------------------------------------------

/**
 * Write the archetype's shape into the height field: a tier is a real step, a
 * punchbowl is a real bowl, a Biarritz swale is a real trench. Returns the
 * bookkeeping the pin zones and the tier report need.
 */
function shapeSurface(course, ft, ctx) {
  const { shape, archetype, center, ct, st, cells, cellSet, rng, cup } = ctx;
  const W = course.width;
  const out = { tierOf: new Map(), tierNames: null, entranceTiles: 0, form: archetype };
  gradeGreenPad(course, ft, cells, cellSet, TILT_CAP[archetype] ?? MAX_GREEN_TILT);
  if (!rng) return out; // the fallback green: graded, but with no archetype on it

  const delta = new Map();
  const add = (x, y, v) => delta.set(key(x, y), (delta.get(key(x, y)) ?? 0) + v);
  const local = (x, y) => {
    const dx = x - center.x;
    const dy = y - center.y;
    return { u: dx * ct + dy * st, v: -dx * st + dy * ct };
  };

  if (archetype === 'tiered') {
    // A real shelf: the divide runs across the green's axis (or along it, for a
    // left/right split), the step is 2.5–5 ft, and the transition is a tile wide.
    const acrossAxis = rng() < 0.72;
    const stepFt = 2.5 + rng() * 2.5;
    const half = acrossAxis ? shape.a : shape.b;
    const band = 0.8;
    let divide = (rng() * 2 - 1) * half * 0.30;
    // A cup cut into the transition is a cup on a ramp. Push the divide off it —
    // deterministically, so this is still one draw, not a search — but never so
    // far that one of the two shelves falls off the green.
    const cl = local(cup.x, cup.y);
    const cw = acrossAxis ? cl.u : cl.v;
    const limit = half * 0.5;
    if (Math.abs(cw - divide) < band * 1.35) {
      const away = divide >= cw ? 1 : -1;
      const first = cw + away * band * 1.6;
      divide = Math.abs(first) <= limit ? first : cw - away * band * 1.6;
      divide = Math.max(-limit, Math.min(limit, divide));
    }
    for (const c of cells) {
      const { u, v } = local(c.x, c.y);
      const w = acrossAxis ? u : v;
      const s = smoothstep((w - divide) / (2 * band) + 0.5);
      add(c.x, c.y, (s - 0.5) * stepFt);
      out.tierOf.set(key(c.x, c.y), w >= divide ? 'upper' : 'lower');
    }
    out.tierNames = ['lower', 'upper'];
  } else if (archetype === 'punchbowl') {
    // The rim stands above the middle, so the whole complex gathers.
    const bowlFt = 2.2 + rng() * 2.4;
    for (const c of cells) {
      const { u, v } = local(c.x, c.y);
      const r = Math.min(1, Math.hypot(u / shape.a, v / shape.b));
      add(c.x, c.y, bowlFt * (r * r - 0.5));
      out.tierOf.set(key(c.x, c.y), 'bowl');
    }
    // and the gather runs a tile past the edge, so a shot off the rim comes back
    ringAround(course, cellSet, 2, (x, y, d) => add(x, y, bowlFt * (0.5 + 0.22 * d)));
  } else if (archetype === 'crowned') {
    // Turtleback: the middle is the high point and every edge sheds away.
    const domeFt = 1.8 + rng() * 2.0;
    for (const c of cells) {
      const { u, v } = local(c.x, c.y);
      const r = Math.min(1, Math.hypot(u / shape.a, v / shape.b));
      add(c.x, c.y, domeFt * (0.55 - r * r));
      out.tierOf.set(key(c.x, c.y), 'crown');
    }
    ringAround(course, cellSet, 2, (x, y, d) => add(x, y, -domeFt * (0.45 + 0.35 * d)));
  } else if (archetype === 'long-narrow') {
    // Biarritz: front and back plateaus with a swale bisecting them.
    const swaleFt = 2.0 + rng() * 2.2;
    const wSwale = 0.55 + rng() * 0.35;
    const uc = (rng() * 2 - 1) * shape.a * 0.16;
    for (const c of cells) {
      const { u, v } = local(c.x, c.y);
      const t = (u - uc) / (shape.a * wSwale);
      add(c.x, c.y, -swaleFt * Math.exp(-t * t * 2.2));
      out.tierOf.set(key(c.x, c.y), u >= uc ? 'back plateau' : 'front plateau');
    }
    out.tierNames = ['front plateau', 'back plateau'];
  } else if (archetype === 'island') {
    // an island sits proud of its surround, so the moat reads as a moat
    for (const c of cells) add(c.x, c.y, 0.9);
    ringAround(course, cellSet, 2, (x, y, d) => add(x, y, -1.1 * (0.4 + 0.4 * d)));
  }

  // Zero-mean over the complex: shaping a green must not lift or drop the whole
  // property, or release B's relief budget drifts hole by hole.
  let sum = 0;
  for (const v of delta.values()) sum += v;
  const mean = delta.size ? sum / delta.size : 0;
  for (const [k, v] of delta) {
    const x = k % 1000;
    const y = Math.floor(k / 1000);
    if (!inBounds(course, x, y)) continue;
    ft[y * W + x] += v - mean;
  }
  return out;
}

/** How much tilt a graded putting surface is allowed to keep, and how much of
 *  the raw landform's own roll survives the grading. Release B's green form
 *  (gather/shed/tilt/shelf) still whispers through the residual — the pad is cut
 *  INTO that land, not dropped on top of it. */
// 3% is the steepest a green-wide tilt ever reads — but an archetype whose whole
// point is what the surface does to a ball gets a flatter pad, or the site's own
// tilt simply swamps it: a punchbowl on a 3% ramp does not gather, it drains.
const MAX_GREEN_TILT = 0.030;
const TILT_CAP = {
  punchbowl: 0.012,
  crowned: 0.015,
  tiered: 0.020,
  'long-narrow': 0.022,
};
const RESIDUAL_KEEP = 0.28;
const PAD_BLEND = 3.5; // tiles the surround takes to rejoin the untouched field

/**
 * The greenkeeper's pass. A green is a GRADED pad, not whatever the hillside
 * happened to do: fit a plane to the site, limit its tilt to something a ball
 * will sit on, keep a quarter of the land's own roll, and blend the pad back
 * into the untouched field over three tiles of surround. Everything the
 * archetype then adds — tiers, bowls, crowns, swales — is deliberate shape on a
 * surface that is puttable to begin with.
 */
function gradeGreenPad(course, ft, cells, cellSet, maxTilt = MAX_GREEN_TILT) {
  const W = course.width;
  const n = cells.length;
  if (!n) return;
  let mx = 0;
  let my = 0;
  let mh = 0;
  for (const c of cells) { mx += c.x; my += c.y; mh += ft[c.y * W + c.x]; }
  mx /= n; my /= n; mh /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sxh = 0;
  let syh = 0;
  for (const c of cells) {
    const dx = c.x - mx;
    const dy = c.y - my;
    const dh = ft[c.y * W + c.x] - mh;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy; sxh += dx * dh; syh += dy * dh;
  }
  const det = sxx * syy - sxy * sxy;
  let gx = 0;
  let gy = 0;
  if (Math.abs(det) > 1e-9) {
    gx = (sxh * syy - syh * sxy) / det;
    gy = (syh * sxx - sxh * sxy) / det;
  }
  const tilt = Math.hypot(gx, gy);
  const cap = maxTilt * FT_PER_TILE;
  if (tilt > cap) { gx *= cap / tilt; gy *= cap / tilt; }
  const plane = (x, y) => mh + gx * (x - mx) + gy * (y - my);

  // the pad itself
  const orig = new Map();
  for (const c of cells) {
    const i = c.y * W + c.x;
    orig.set(key(c.x, c.y), ft[i]);
  }
  for (const c of cells) {
    const i = c.y * W + c.x;
    const p = plane(c.x, c.y);
    ft[i] = p + (orig.get(key(c.x, c.y)) - p) * RESIDUAL_KEEP;
  }
  // and the surround, rejoining the field it was cut out of
  const untouched = new Map();
  ringAround(course, cellSet, Math.ceil(PAD_BLEND), (x, y, d) => {
    untouched.set(key(x, y), { i: y * W + x, d });
  });
  for (const [k, { i, d }] of untouched) {
    const x = k % 1000;
    const y = Math.floor(k / 1000);
    const w = smoothstep(d / PAD_BLEND);
    ft[i] = plane(x, y) * (1 - w) + ft[i] * w;
  }
}

const CUP_PAD_R = 2.2; // tiles of saucer around a hole location, on a big green

/** The grade at a tile node, read straight off a raw height array — the same
 *  central difference `gradientAt` takes, before there is a relief to ask. */
function nodeGrade(course, ft, x, y) {
  const W = course.width;
  const cx = (i) => Math.min(course.width - 1, Math.max(0, i));
  const cy = (j) => Math.min(course.height - 1, Math.max(0, j));
  const gx = (ft[cy(y) * W + cx(x + 1)] - ft[cy(y) * W + cx(x - 1)]) / 2;
  const gy = (ft[cy(y + 1) * W + cx(x)] - ft[cy(y - 1) * W + cx(x)]) / 2;
  return Math.hypot(gx, gy) / FT_PER_TILE;
}

/** Relax a saucer of green flat around the cup, toward the mean of the ground
 *  right under it. Green tiles only — the surround keeps its shape. */
function flattenCupPad(course, ft, cellSet, H, radius = CUP_PAD_R) {
  const W = course.width;
  let sum = 0;
  let n = 0;
  const near = [];
  const r = Math.ceil(radius);
  for (let y = H.y - r; y <= H.y + r; y++) {
    for (let x = H.x - r; x <= H.x + r; x++) {
      if (!inBounds(course, x, y) || !cellSet.has(key(x, y))) continue;
      const d = Math.hypot(x - H.x, y - H.y);
      if (d > radius) continue;
      near.push({ x, y, d });
      sum += ft[y * W + x];
      n += 1;
    }
  }
  if (!n) return;
  const level = sum / n;
  for (const p of near) {
    const w = 0.85 * (1 - smoothstep(p.d / radius));
    const i = p.y * W + p.x;
    ft[i] += (level - ft[i]) * w;
  }
}

/** Walk the tiles within `d` tiles outside a cell set, cheapest-first. */
function ringAround(course, cellSet, radius, fn) {
  const seen = new Set(cellSet);
  let frontier = [...cellSet].map((k) => ({ x: k % 1000, y: Math.floor(k / 1000) }));
  for (let d = 1; d <= radius; d++) {
    const next = [];
    for (const p of frontier) {
      for (const [dx, dy] of NEIGHBOURS8) {
        const x = p.x + dx;
        const y = p.y + dy;
        if (!inBounds(course, x, y) || seen.has(key(x, y))) continue;
        seen.add(key(x, y));
        next.push({ x, y });
        fn(x, y, d);
      }
    }
    frontier = next;
  }
}

const NEIGHBOURS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const NEIGHBOURS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// --- hazards, by role --------------------------------------------------------

/** Which roles an archetype's complex is built from. */
const ROLE_PLANS = {
  round: [['short-side', 'frame-left', 'frame-right'], ['runoff', 'long', 'false-front']],
  kidney: [['wrap', 'short-side'], ['swale', 'false-front', 'runoff']],
  boomerang: [['wrap', 'greedy'], ['runoff', 'frame-right']],
  'long-narrow': [['frame-left', 'frame-right'], ['false-front', 'long', 'swale']],
  tiered: [['short-side', 'greedy'], ['false-front', 'runoff', 'long']],
  punchbowl: [['frame-left', 'frame-right'], ['long', 'greedy']],
  crowned: [['runoff', 'short-side'], ['swale', 'frame-left', 'false-front']],
  island: [['moat'], ['carry', 'frame-right']],
};

/**
 * Place the complex's hazards. Every one is sited by a BEARING from the green's
 * centre and hugged to the green's own edge, so a bunker is always greenside and
 * always sized to the green it guards. Two things are inviolable: the entrance
 * wedge on the approach side, and the routing spine.
 */
function placeHazards(course, cellsOut, ft, ctx) {
  const {
    shape, archetype, center, ct, st, cellSet, cells, entTheta, protectedSet, rng, areaTiles,
  } = ctx;
  const W = course.width;
  const H = course.hole;
  const [required, optional] = ROLE_PLANS[archetype];
  const roles = [...required];
  const extras = 1 + (rng() < 0.45 ? 1 : 0);
  for (let i = 0; i < extras && optional.length; i++) {
    const r = optional[Math.floor(rng() * optional.length)];
    if (!roles.includes(r)) roles.push(r);
  }

  // the short side is the side the cup is tucked toward; with a central cup,
  // take the flank the green's own shape already pinches
  const cupOff = Math.hypot(H.x - center.x, H.y - center.y);
  const shortTheta = cupOff > 0.6
    ? Math.atan2(H.y - center.y, H.x - center.x)
    : entTheta + (rng() < 0.5 ? -1 : 1) * (Math.PI / 2);
  const greedyTheta = entTheta + angleDelta(shortTheta, entTheta) * 0.55;

  const inEntrance = (x, y) => {
    const th = Math.atan2(y - center.y, x - center.x);
    if (Math.abs(angleDelta(th, entTheta)) > ENTRANCE_HALF) return false;
    return Math.hypot(x - center.x, y - center.y)
      < edgeDistance(center, th, cellSet, course) + ENTRANCE_REACH;
  };

  const carvable = (x, y) => {
    if (!inBounds(course, x, y)) return false;
    if (cellSet.has(key(x, y))) return false;
    if (protectedSet.has(key(x, y))) return false;
    if (Math.hypot(x - H.x, y - H.y) > COMPLEX_R) return false;
    if (inEntrance(x, y)) return false;
    return true;
  };

  const out = [];

  const carveBunker = (role, theta, sizeK, kind = SAND) => {
    const edge = edgeDistance(center, theta, cellSet, course);
    const gap = 0.75 + rng() * 0.7;
    const cx = center.x + Math.cos(theta) * (edge + gap);
    const cy = center.y + Math.sin(theta) * (edge + gap);
    const major = Math.max(1.0, Math.min(3.2, Math.sqrt(areaTiles / Math.PI) * sizeK));
    const minor = Math.max(0.7, major * (0.48 + rng() * 0.2));
    const bt = theta + Math.PI / 2;
    const cbt = Math.cos(bt);
    const sbt = Math.sin(bt);
    let n = 0;
    const r = Math.ceil(Math.max(major, minor)) + 1;
    for (let y = Math.round(cy) - r; y <= Math.round(cy) + r; y++) {
      for (let x = Math.round(cx) - r; x <= Math.round(cx) + r; x++) {
        if (!carvable(x, y)) continue;
        const dx = x - cx;
        const dy = y - cy;
        const p = (dx * cbt + dy * sbt) / major;
        const q = (-dx * sbt + dy * cbt) / minor;
        if (p * p + q * q > 1) continue;
        cellsOut[y * W + x] = kind;
        n++;
      }
    }
    if (n) out.push({ role, kind: kind === WATER ? 'water' : 'sand', tiles: n, x: +cx.toFixed(2), y: +cy.toFixed(2) });
    return n;
  };

  /** Mown ground plus a hollow in it: run-offs, collection areas, chipping swales. */
  const carveHollow = (role, theta, depthFt, spread) => {
    const edge = edgeDistance(center, theta, cellSet, course);
    const cx = center.x + Math.cos(theta) * (edge + 1.1);
    const cy = center.y + Math.sin(theta) * (edge + 1.1);
    let n = 0;
    const r = Math.ceil(spread) + 1;
    for (let y = Math.round(cy) - r; y <= Math.round(cy) + r; y++) {
      for (let x = Math.round(cx) - r; x <= Math.round(cx) + r; x++) {
        if (!inBounds(course, x, y) || cellSet.has(key(x, y))) continue;
        if (Math.hypot(x - H.x, y - H.y) > COMPLEX_R) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d > spread) continue;
        const t = cellsOut[y * W + x];
        if (t === WATER || t === SAND) continue;
        if (!protectedSet.has(key(x, y))) cellsOut[y * W + x] = FAIRWAY;
        ft[y * W + x] -= depthFt * (1 - (d / spread) ** 2);
        n++;
      }
    }
    if (n) out.push({ role, kind: 'mown', tiles: n, x: +cx.toFixed(2), y: +cy.toFixed(2) });
    return n;
  };

  for (const role of roles) {
    switch (role) {
      case 'short-side':
        carveBunker('short-side', shortTheta, 0.62);
        break;
      case 'greedy':
        carveBunker('greedy', greedyTheta, 0.5);
        break;
      case 'frame-left':
        carveBunker('frame-left', entTheta - (ENTRANCE_HALF + 0.42), 0.42);
        break;
      case 'frame-right':
        carveBunker('frame-right', entTheta + (ENTRANCE_HALF + 0.42), 0.42);
        break;
      case 'wrap': {
        // the bunker the green is bent around: it sits IN the bite
        const bite = shape.bites[0];
        if (!bite) break;
        const c = biteCentre(shape, bite, shape.penScale ?? 1);
        const bx = center.x + (c.u * ct - c.v * st);
        const by = center.y + (c.u * st + c.v * ct);
        carveBunker('wrap', Math.atan2(by - center.y, bx - center.x), 0.6);
        break;
      }
      case 'long':
        carveBunker('long', entTheta + Math.PI, 0.45);
        break;
      case 'carry':
        carveBunker('carry', entTheta + (ENTRANCE_HALF + 0.5) * (rng() < 0.5 ? -1 : 1), 0.55, WATER);
        break;
      case 'moat': {
        // the island's water, everywhere but the neck the routing keeps open
        let n = 0;
        ringAround(course, cellSet, 2, (x, y) => {
          if (!carvable(x, y)) return;
          cellsOut[y * W + x] = WATER;
          n++;
        });
        if (n) out.push({ role: 'moat', kind: 'water', tiles: n, x: +center.x.toFixed(2), y: +center.y.toFixed(2) });
        break;
      }
      case 'runoff':
        carveHollow('runoff', shortTheta + Math.PI, 2.2 + rng() * 1.6, 1.8 + rng() * 1.1);
        break;
      case 'swale':
        carveHollow('swale', entTheta + (Math.PI / 2) * (rng() < 0.5 ? -1 : 1), 2.4 + rng() * 1.6, 1.6 + rng() * 1.0);
        break;
      case 'false-front': {
        // A slope in the ENTRANCE that rejects the short approach back down the
        // hill. It is the one thing allowed inside the entrance wedge, because it
        // is not an obstacle — it is the ground being honest about the miss.
        //
        // Expressed as a CEILING, not a subtraction: each ring of apron may sit
        // no higher than the green's own front minus another 2-3 feet. So the
        // profile always descends away from the putting surface at a grade the
        // apron limiter will not have to argue with, and ground that already
        // falls that fast is simply left alone.
        const fallPerTile = 1.9 + rng() * 1.3;
        let front = 0;
        let nf = 0;
        for (const c2 of cells) {
          if (Math.abs(angleDelta(Math.atan2(c2.y - center.y, c2.x - center.x), entTheta)) > ENTRANCE_HALF + 0.35) continue;
          front += ft[c2.y * W + c2.x];
          nf++;
        }
        if (!nf) break;
        const lip = front / nf;
        let n = 0;
        ringAround(course, cellSet, 3, (x, y, d) => {
          if (Math.hypot(x - H.x, y - H.y) > COMPLEX_R) return;
          const th = Math.atan2(y - center.y, x - center.x);
          if (Math.abs(angleDelta(th, entTheta)) > ENTRANCE_HALF + 0.25) return;
          const t = cellsOut[y * W + x];
          if (t === WATER || t === SAND) return;
          const ceiling = lip - fallPerTile * d;
          if (ft[y * W + x] <= ceiling) return;
          if (!protectedSet.has(key(x, y)) && t === ROUGH) cellsOut[y * W + x] = FAIRWAY;
          ft[y * W + x] = ceiling;
          n++;
        });
        if (n) out.push({ role: 'false-front', kind: 'slope', tiles: n, x: +center.x.toFixed(2), y: +center.y.toFixed(2) });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** How far the green's own edge is from its centre along a bearing, in tiles. */
function edgeDistance(center, theta, cellSet, course) {
  const cx = Math.cos(theta);
  const cy = Math.sin(theta);
  let last = 0.5;
  for (let d = 0.5; d <= 9; d += 0.25) {
    const x = Math.round(center.x + cx * d);
    const y = Math.round(center.y + cy * d);
    if (!inBounds(course, x, y)) break;
    if (cellSet.has(key(x, y))) last = d;
  }
  return last;
}

// --- the height-field housekeeping -------------------------------------------

/**
 * Grade limiting inside the complex. A tier has to READ, but a putting surface
 * steeper than GREEN_MAX_GRADE is a slide and an apron steeper than
 * APRON_MAX_GRADE breaks release B's walkable-corridor promise. Tiles outside
 * the complex are frozen, so the field stays exactly release B's everywhere the
 * green is not.
 */
function limitGrades(course, cells, ft, H) {
  const W = course.width;
  // "Free" is exactly the ground this module moved — measured, not guessed. A
  // tile release B left alone is FROZEN: an offending step against it is fixed
  // entirely on our side, so no height outside the complex can drift.
  const orig = course.relief.ft;
  const freeSet = new Uint8Array(ft.length);
  for (let i = 0; i < ft.length; i++) if (ft[i] !== orig[i] || cells[i] === GREEN) freeSet[i] = 1;
  const R = COMPLEX_R + 6;
  const capOf = (t) => (t === GREEN ? GREEN_MAX_GRADE : APRON_MAX_GRADE) * FT_PER_TILE;
  for (let pass = 0; pass < 24; pass++) {
    let worst = 0;
    for (let y = Math.max(0, H.y - R); y <= Math.min(course.height - 1, H.y + R); y++) {
      for (let x = Math.max(0, H.x - R); x <= Math.min(course.width - 1, H.x + R); x++) {
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= course.width || ny >= course.height) continue;
          const k = y * W + x;
          const m = ny * W + nx;
          const fa = freeSet[k] === 1;
          const fb = freeSet[m] === 1;
          if (!fa && !fb) continue;
          const cap = Math.min(capOf(cells[k]), capOf(cells[m]));
          const diff = ft[m] - ft[k];
          const over = Math.abs(diff) - cap;
          if (over <= 0) continue;
          worst = Math.max(worst, over);
          const fix = Math.sign(diff) * over;
          if (fa && fb) {
            ft[k] += fix * 0.5;
            ft[m] -= fix * 0.5;
          } else if (fa) {
            ft[k] += fix;
          } else {
            ft[m] -= fix;
          }
        }
      }
    }
    if (worst < 0.02) break;
  }
}

/**
 * Keep the hole inside release B's plausibility budget. A green complex is
 * allowed to shape its own ground, never to make the property taller: if the
 * new extremes overrun the budget, the complex's OWN delta is scaled back —
 * bisected, because the extreme may not be on the complex at all — and the rest
 * of the field is left exactly where release B put it.
 */
function fitReliefBudget(course, ft) {
  const orig = course.relief.ft;
  const spanOf = () => {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < ft.length; i++) {
      if (ft[i] < min) min = ft[i];
      if (ft[i] > max) max = ft[i];
    }
    return max - min;
  };
  if (spanOf() <= RELIEF_BUDGET_FT) return;
  const delta = new Float32Array(ft.length);
  for (let i = 0; i < ft.length; i++) delta[i] = ft[i] - orig[i];
  for (let step = 0; step < 8; step++) {
    const k = 0.5 ** (step + 1);
    for (let i = 0; i < ft.length; i++) ft[i] = orig[i] + delta[i] * k;
    if (spanOf() <= RELIEF_BUDGET_FT) return;
  }
  ft.set(orig);
}

/** A relief with new heights: same metadata, fresh extremes, no stale gradient
 *  memo (it is defined non-enumerably on the source, so the spread drops it). */
function withHeights(relief, ft) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < ft.length; i++) {
    if (ft[i] < min) min = ft[i];
    if (ft[i] > max) max = ft[i];
  }
  return { ...relief, ft, minFt: min, maxFt: max, reliefFt: max - min };
}

/** Report each shelf's REAL mean height off the finished field. */
function measureTiers(surface, cells, relief, width) {
  if (!surface.tierNames) return [];
  const acc = new Map();
  for (const c of cells) {
    const id = surface.tierOf.get(key(c.x, c.y));
    if (!id) continue;
    const a = acc.get(id) ?? { sum: 0, n: 0 };
    a.sum += relief.ft[c.y * width + c.x];
    a.n += 1;
    acc.set(id, a);
  }
  return surface.tierNames
    .filter((id) => acc.has(id))
    .map((id) => ({
      id,
      name: id.includes('plateau') ? id : `${id} shelf`,
      tiles: acc.get(id).n,
      meanFt: +(acc.get(id).sum / acc.get(id).n).toFixed(3),
    }));
}

// --- pins --------------------------------------------------------------------

/**
 * Legal pin zones, derived FROM the surface. A cell qualifies if it is a full
 * tile inside the green's edge and the ground under it is flatter than
 * PIN_MAX_GRADE. Qualifying cells are then grouped the way a caddie groups
 * them: by shelf, and by depth/side against the line of play.
 */
function pinZones(course, cells, relief, ctx) {
  const { cells: green, cellSet, center, ct, st, shape, surface, archetype } = ctx;
  const groups = new Map();
  const M = PIN_EDGE_MARGIN;
  for (const c of green) {
    let interior = true;
    for (let dy = -M; dy <= M && interior; dy++) {
      for (let dx = -M; dx <= M; dx++) {
        if (!cellSet.has(key(c.x + dx, c.y + dy))) { interior = false; break; }
      }
    }
    if (!interior) continue;
    const g = gradientAt(relief, c.x, c.y);
    if (Math.hypot(g.dx, g.dy) / FT_PER_TILE > PIN_MAX_GRADE) continue;

    const dx = c.x - center.x;
    const dy = c.y - center.y;
    const u = dx * ct + dy * st;
    const v = -dx * st + dy * ct;
    const depth = u > shape.a * 0.28 ? 'back' : u < -shape.a * 0.28 ? 'front' : 'middle';
    const side = v > shape.b * 0.28 ? 'right' : v < -shape.b * 0.28 ? 'left' : 'centre';
    const shelf = surface.tierOf.get(key(c.x, c.y)) ?? null;
    const id = `${depth}-${side}${shelf ? `:${shelf}` : ''}`;
    const g2 = groups.get(id) ?? { id, depth, side, shelf, cells: [] };
    g2.cells.push(c);
    groups.set(id, g2);
  }

  const suffix = archetype === 'tiered' ? ' shelf'
    : archetype === 'punchbowl' ? ' bowl'
      : archetype === 'crowned' ? ' crown'
        : archetype === 'long-narrow' ? ' plateau' : '';

  return [...groups.values()]
    .filter((g) => g.cells.length >= 1)
    .map((g) => {
      let sx = 0;
      let sy = 0;
      for (const c of g.cells) { sx += c.x; sy += c.y; }
      const cx = sx / g.cells.length;
      const cy = sy / g.cells.length;
      // the zone's own anchor is a real cell, not a centroid in the rough
      let best = g.cells[0];
      let bd = Infinity;
      for (const c of g.cells) {
        const d = Math.hypot(c.x - cx, c.y - cy);
        if (d < bd) { bd = d; best = c; }
      }
      const base = g.side === 'centre' ? g.depth : `${g.depth}-${g.side}`;
      return {
        id: g.id,
        name: `${base}${suffix}`.trim(),
        cells: g.cells,
        x: best.x,
        y: best.y,
      };
    })
    .sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
}

/**
 * The pin rota. Day 0 is the cup the hole was generated with; later days walk a
 * deterministic rotation of the legal zones, so a Tuesday pin and a Sunday pin
 * on the same hole are genuinely different puzzles.
 * @param {import('./course.js').Course} course
 * @param {number} day
 * @returns {{x:number, y:number, zone:string, name:string}}
 */
export function pinFor(course, day = 0) {
  const g = course.green;
  if (!g) return { x: course.hole.x, y: course.hole.y, zone: 'unzoned', name: 'the cup' };
  if (day <= 0 || g.pinZones.length === 0) return { ...g.pin };
  const rng = substream(course.seed >>> 0, `pin:${day}`);
  const zone = pickWeighted(rng, g.pinZones.map((z) => [z, Math.max(1, z.tiles)]));
  return { x: zone.x, y: zone.y, zone: zone.id, name: zone.name };
}

// --- certification -----------------------------------------------------------

/**
 * Every green is certified before it is committed: reachable from the tee,
 * puttable, with a legal cup, an open ground route in, and an area a golfer
 * would recognize. A plan that fails is rerolled — deterministically, into a
 * differently-named substream, so the reroll is a different green rather than a
 * different course.
 */
export function certifyGreen(course, plan, zones, cupZone) {
  const cells = plan.cellsOut;
  const relief = plan.reliefOut;
  const W = course.width;
  const H = course.hole;
  const at = (x, y) => cells[y * W + x];
  const fail = [];

  // area
  const area = plan.cells.length;
  if (area < MIN_GREEN_TILES) fail.push(`green too small (${area} tiles)`);
  if (area > MAX_GREEN_TILES) fail.push(`green too large (${area} tiles)`);

  // one surface, and the cup on it
  if (at(H.x, H.y) !== GREEN) fail.push('cup is not on the green');
  const surface = flood(course, H, (x, y) => at(x, y) === GREEN, NEIGHBOURS4);
  if (surface.size !== area) fail.push(`green is ${area - surface.size} tiles of island`);

  // puttable: no cell of the surface is steeper than a ball will sit on, and the
  // ground right around the cup is flat enough to hole a putt on
  let peak = 0;
  for (const c of plan.cells) {
    const g = gradientAt(relief, c.x, c.y);
    peak = Math.max(peak, Math.hypot(g.dx, g.dy) / FT_PER_TILE);
  }
  if (peak > GREEN_MAX_GRADE + 1e-6) fail.push(`surface too steep (${(peak * 100).toFixed(1)}%)`);
  const cupG = gradientAt(relief, H.x, H.y);
  if (Math.hypot(cupG.dx, cupG.dy) / FT_PER_TILE > PIN_MAX_GRADE) fail.push('cup is on a slope');

  // pin legality
  if (zones.length === 0) fail.push('no legal pin zone');
  if (!cupZone) fail.push('cup is not a legal pin');

  // a shaped surface has to actually be shaped: a "tiered" green with one shelf
  // is a round green wearing the wrong name
  if (plan.archetype === 'tiered' || plan.archetype === 'long-narrow') {
    if (plan.tiers.length !== 2 || plan.tiers.some((t) => t.tiles < 2)) {
      fail.push(`${plan.archetype} green did not develop two levels`);
    }
  }
  // and a shelf you cannot feel is not a shelf
  if (plan.archetype === 'tiered' && plan.tierStepFt < 1.2) {
    fail.push(`the tier is only ${plan.tierStepFt.toFixed(2)} ft`);
  }

  // A GROUND ROUTE IN. Not "the green is not an island" — this is the promise
  // that a player who will not fly it can still get there: unhazarded ground
  // (green, fairway or rough — never sand, water or trees) leading OUT of the
  // complex, and out on the side the shot comes from. Every archetype honours
  // it, the island's moat included: its neck is the routing's own spine.
  const run = flood(course, H, (x, y) => {
    const t = at(x, y);
    return t === GREEN || t === FAIRWAY || t === ROUGH;
  }, NEIGHBOURS8);
  let escapes = 0;
  let approachEscapes = 0;
  for (const k of run) {
    const x = k % 1000;
    const y = Math.floor(k / 1000);
    if (Math.hypot(x - H.x, y - H.y) < COMPLEX_R) continue;
    escapes++;
    const th = Math.atan2(y - plan.center.y, x - plan.center.x);
    if (Math.abs(angleDelta(th, plan.entrance.theta)) < Math.PI / 2) approachEscapes++;
  }
  if (escapes === 0) fail.push('no ground route out of the complex');
  if (approachEscapes === 0) fail.push('no ground route in from the approach side');

  // and the run-up itself is MOWN for the last stretch: a green you can only
  // reach through rough is a green you can only reach through the air
  const mown = flood(course, H, (x, y) => at(x, y) === GREEN || at(x, y) === FAIRWAY, NEIGHBOURS8);
  let mownReach = 0;
  for (const k of mown) {
    const x = k % 1000;
    const y = Math.floor(k / 1000);
    mownReach = Math.max(mownReach, Math.hypot(x - H.x, y - H.y));
  }
  if (mownReach < Math.max(shapeReach(plan) + 2, 4)) {
    fail.push(`no mown run-up (${mownReach.toFixed(1)} tiles)`);
  }

  // and never fully encircled: a real arc of the immediate surround is playable
  const openArc = surroundOpenArc(course, cells, plan);
  if (openArc.open < 3) fail.push(`green is encircled (${openArc.open}/${openArc.total} open)`);

  // Reachable at all, over any ground a ball can rest on. Measured as a DELTA:
  // a handful of seeds arrive from the layout stage already boxed in by water,
  // and that is the routing's business, not the green's — what a green complex
  // must never do is be the thing that closes the hole off.
  const land = flood(course, course.tee, (x, y) => isRestable(at(x, y)), NEIGHBOURS8);
  if (!land.has(key(H.x, H.y))) {
    const before = flood(course, course.tee, (x, y) => isRestable(cellAt(course, x, y)), NEIGHBOURS8);
    if (before.has(key(H.x, H.y))) fail.push('the complex closed the hole off');
  }

  return {
    ok: fail.length === 0,
    area,
    peakGradePct: +(peak * 100).toFixed(2),
    pinZones: zones.length,
    openArc: openArc.open,
    surroundTiles: openArc.total,
    groundEscapes: escapes,
    mownReach: +mownReach.toFixed(2),
    reasons: fail,
  };
}

/** How far the green's own tiles reach from the cup — the radius the mown
 *  run-up has to clear before it counts as a run-up. */
function shapeReach(plan) {
  let r = 0;
  for (const c of plan.cells) r = Math.max(r, Math.hypot(c.x - plan.pin.x, c.y - plan.pin.y));
  return r;
}

/** The immediate surround, one tile out: how much of it a ball can run over. */
function surroundOpenArc(course, cells, plan) {
  const W = course.width;
  const inGreen = new Set(plan.cells.map((c) => key(c.x, c.y)));
  const ring = [];
  for (const c of plan.cells) {
    for (const [dx, dy] of NEIGHBOURS8) {
      const x = c.x + dx;
      const y = c.y + dy;
      if (!inBounds(course, x, y) || inGreen.has(key(x, y))) continue;
      ring.push({ x, y, th: Math.atan2(y - plan.center.y, x - plan.center.x) });
    }
  }
  const seen = new Set();
  const uniq = ring.filter((p) => (seen.has(key(p.x, p.y)) ? false : seen.add(key(p.x, p.y))));
  uniq.sort((p, q) => p.th - q.th);
  let best = 0;
  let run = 0;
  const open = (p) => {
    const t = cells[p.y * W + p.x];
    return t === FAIRWAY || t === ROUGH || t === GREEN;
  };
  // twice around, so a run that straddles ±π is counted whole
  for (let i = 0; i < uniq.length * 2; i++) {
    if (open(uniq[i % uniq.length])) {
      run++;
      best = Math.max(best, Math.min(run, uniq.length));
    } else run = 0;
  }
  return { open: best, total: uniq.length };
}

// --- grid utilities ----------------------------------------------------------

function componentContaining(set, x0, y0) {
  const out = new Set();
  const stack = [[x0, y0]];
  while (stack.length) {
    const [x, y] = stack.pop();
    const k = key(x, y);
    if (!set.has(k) || out.has(k)) continue;
    out.add(k);
    for (const [dx, dy] of NEIGHBOURS4) stack.push([x + dx, y + dy]);
  }
  return out;
}

function flood(course, from, ok, neighbours) {
  const seen = new Set([key(from.x, from.y)]);
  const stack = [from];
  while (stack.length) {
    const p = stack.pop();
    for (const [dx, dy] of neighbours) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (!inBounds(course, x, y) || seen.has(key(x, y)) || !ok(x, y)) continue;
      seen.add(key(x, y));
      stack.push({ x, y });
    }
  }
  return seen;
}

/** Every GREEN tile of a course — the shape the art and the camera follow. */
export function greenCellsOf(course) {
  const out = [];
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      if (cellAt(course, x, y) === GREEN) out.push({ x, y });
    }
  }
  return out;
}
