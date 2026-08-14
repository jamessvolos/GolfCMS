// Strategic routing. Release C gave every hole a green worth aiming at; this
// module gives it a REASON to aim somewhere other than the middle.
//
// The classic generator (generate.js) lays hazards "biased toward the direct
// tee→hole line so hazards threaten the obvious route". That sentence is the
// bug. A hazard ON the line has exactly one answer — go round it — and both
// ways round are the same, so there is no decision. Golf architecture has
// solved this for a century and the solution is always the same shape:
//
//   PUT THE TROUBLE ON THE SIDE THE PIN IS ON.
//
// Then the aggressive line and the safe line are DIFFERENT PLACES, not the same
// place at different speeds. Hug the sand and the approach opens up down the
// length of the green; bail out wide and you are left playing the short axis
// over whatever guards the front. That is MacKenzie's sixth principle as
// arithmetic, and it is the entire content of this file.
//
// Six stages, from `docs/research/01-architecture-and-sg.md` §3:
//
//   G2  the landing-zone hazard moves OFF the centre line and onto the pin side
//   G3  the corridor widens, asymmetrically — the bail-out side is the wide one
//   G4  a centre-line bunker on some straight holes: the cheapest fork there is
//   G5  a diagonal carry across the inside of a dogleg (the Cape)
//   G6  templates — Redan, Cape, Road, Punchbowl, Short — as landform + green
//   G7  recovery asymmetry: one side treed, the other open, so the two misses
//       cost differently
//
// THE SEAM WITH GREENS. Strategic owns the ground from the tee to `COMPLEX_R`
// tiles short of the cup; `greens.js` owns everything inside that radius, and
// runs after. Nothing here may write a tile within the complex — asserted
// tile-by-tile in strategic.test.js — so the two modules can never fight over
// the same ground. What crosses the seam is a REQUEST, not terrain: a green
// archetype the template wants, and the flank the cup should be tucked on.
//
// SEED STABILITY. Everything is opt-in behind `generateCourse(seed, biome,
// {strategic: true})` and drawn from this module's own named substreams. A
// course generated without the flag is byte-identical to release C's — the
// arcade, its certificates and its goldens never see any of this.

import { substream, pickWeighted } from './rng.js';
import { FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN } from './terrain.js';
import { cellAt, inBounds, setCell } from './course.js';
import { MAX_CARRY } from './dispersion.js';
import { COMPLEX_R } from './greens.js';

/** The template vocabulary: a landform, a green, and a set of hazard duties. */
export const TEMPLATES = ['none', 'redan', 'cape', 'road', 'punchbowl', 'short'];

/** Tiles of the corridor the widener will reach on the generous side. */
export const WIDE_MAX = 6.2;
/** ...and the sliver it leaves on the side the trouble is on. */
export const TIGHT_MAX = 3.0;

/** Nothing in this module may write a tile this close to the cup. greens.js owns it. */
export const GREEN_KEEPOUT = COMPLEX_R;

/** Shorter than this and the hole has no landing zone to fork — it's a par 3. */
export const LZ_MIN_HOLE = 19;

/**
 * The landing zone's geometry, in tiles off the line of play, as `[min, span]`
 * pairs. These are the numbers the fork actually hangs on and they were TUNED,
 * not chosen: `certify.js` measures the fork rate over a seed sweep and this
 * table is what maximises it, which is why it lives here as data instead of
 * being scattered through the function as literals.
 *
 * The tuning story in one line: the shelf wants to be as far off the line as
 * the angle is worth and no further. Every tile sideways costs real progress
 * toward the green — a target 5.6 tiles off a 14.4-tile arc gives up nearly two
 * tiles of advance — and past about four tiles the arithmetic stops calling it
 * a choice and starts calling it a mistake.
 */
export const LZ_SHAPE = {
  // The carry. `farMargin` sets the band's FAR edge that far inside a full
  // swing — the whole decision lives in how little room is left beyond it.
  // `depth` then runs backward toward the tee, lengthening the lay-up.
  farMargin: [0.9, 0.3],
  depth: [2.4, 0.8],
  // The two aim points, as radial offsets from the band's edges.
  layBack: [1.3, 0.6],    // ...short of the near edge
  carryOver: [0.6, 0.4],  // ...and past the far one, which is the whole gamble
  // Lateral flavour: the lay-up sits on the open side, the carry shelf on the
  // side worth being on, and sand runs outside the shelf so over-clubbing the
  // good line is a miss too.
  layOff: [1.4, 1.4],
  carryOff: [2.4, 1.2],
  outerOff: [7.4, 1.0],
  outerR: [1.3, 0.6],
  layR: [2.6, 0.9],
  carryR: [1.9, 0.6],
};

/**
 * @typedef {{
 *   template: string,
 *   tuckSide: number,           // the flank the CUP sits on, in the frame below
 *   shelfSide: number,          // ...and the flank worth driving to: -tuckSide
 *   sideName: string,           // the shelf side, 'left' | 'right', golfer's view
 *   greenPrefer: string|null,   // the archetype the template asks greens.js for
 *   lzDist: number,             // tiles from the tee to the strategic landing zone
 *   lz: {x: number, y: number}, // ...and where that is
 *   axis: {x: number, y: number},   // tee → cup, unit
 *   perp: {x: number, y: number},   // +perp is the golfer's RIGHT
 *   width: {tight: number, wide: number},
 *   hazards: Array<{role: string, kind: string, x: number, y: number, r: number}>,
 *   targets: {aggressive: {x,y,r,carry}, bail: {x,y,r,carry}}|null,
 *   carryBand: {near: number, far: number, kind: string}|null,
 *   treedSide: number,
 *   notes: string[],
 * }} StrategicPlan
 */

/**
 * Lay the strategic plan over a finished classic layout, in place.
 *
 * Runs BEFORE `buildRelief` and `applyGreenComplex`: the land should be shaped
 * against the ground the player actually plays, and the green wants the
 * template's opinion.
 *
 * @param {import('./course.js').Course} course a finished classic layout
 * @param {number} [seed]
 * @param {{spine?: Array<{x:number,y:number}>, controls?: Array<{x:number,y:number}>}} [opts]
 * @returns {StrategicPlan}
 */
export function applyStrategicPlan(course, seed = course.seed, opts = {}) {
  const spine = opts.spine ?? [];
  const controls = opts.controls ?? [];
  const rng = substream(seed >>> 0, 'strategic');
  const hazRng = substream(seed >>> 0, 'strathaz');
  const tmplRng = substream(seed >>> 0, 'templates');

  const T = course.tee;
  const H = course.hole;
  const dx = H.x - T.x;
  const dy = H.y - T.y;
  const holeTiles = Math.hypot(dx, dy) || 1;
  const axis = { x: dx / holeTiles, y: dy / holeTiles };
  // +perp is the golfer's RIGHT: with y increasing downscreen and the golfer
  // playing left→right, rotating the axis by +90° points south, which is the
  // right hand of a player facing east.
  const perp = { x: -axis.y, y: axis.x };

  const notes = [];

  // --- the two choices everything else serves ------------------------------
  const template = pickTemplate(tmplRng, course, holeTiles);
  const tuckSide = pickTuckSide(rng, course, controls, perp);
  // The angle rule, and it is the opposite of the obvious one. A pin tucked
  // behind a bunker on the left is SHORT-SIDED from the left: the guard sits
  // between you and the cup with no green beyond it. From the right you have
  // the whole length of the green to work with. So the flank worth fighting for
  // is the one AWAY from the tuck — which is why the trouble goes there.
  const shelfSide = -tuckSide;
  const sideName = shelfSide > 0 ? 'right' : 'left';
  const greenPrefer = GREEN_FOR_TEMPLATE[template] ?? null;

  // The strategic landing zone: as far as a good drive carries, but never so
  // far that it lands inside the green complex — on a 20-tile par 4 the whole
  // second half of the hole belongs to greens.js, and the fork has to happen
  // before it.
  const lzDist = Math.max(6, Math.min(MAX_CARRY * 0.95, holeTiles - GREEN_KEEPOUT - 1));
  const lz = pointAt(spine, T, axis, lzDist);

  const width = {
    tight: 2.2 + rng() * (TIGHT_MAX - 2.2),
    wide: 4.6 + rng() * (WIDE_MAX - 4.6),
  };

  const plan = {
    template, tuckSide, shelfSide, sideName, greenPrefer,
    lzDist, lz, axis, perp, width,
    hazards: [], targets: null, carryBand: null, treedSide: tuckSide, notes,
  };

  const ctx = { course, T, H, axis, perp, holeTiles, spine, plan };

  // G2a — clear the centre line. Everything the classic pass dropped on the
  // corridor in the strategic band goes back to ground: an on-line pond is the
  // exact pattern this release exists to delete.
  const cleared = clearCentreLine(ctx);
  if (cleared) notes.push(`cleared ${cleared} centre-line hazard tiles`);

  // G3 — width, with a preferred side. Do this BEFORE siting the new hazards
  // so the fairway can't erase them.
  const widened = widenCorridor(ctx, rng);
  if (widened) notes.push(`corridor widened to ${width.wide.toFixed(1)}/${width.tight.toFixed(1)} tiles`);

  // Only holes that HAVE a landing zone get one. A par 3 is played tee-to-green
  // in a single decision, so its whole strategy is the green complex and the
  // tuck above; building a driver-range fork on a 13-tile hole just buries the
  // tee in sand.
  const hasLZ = holeTiles >= LZ_MIN_HOLE;

  // ORDER MATTERS, and it is decided by who gets the last word. The diagonal
  // carry and the half-way bunker both write ground the landing zone may need,
  // and when they ran afterwards they did exactly that — a Cape's water band
  // laid straight over the carry target, so the aggressive arm of the fork was
  // a pond and the test that checks both arms are playable caught it. Anything
  // that decorates the route runs FIRST; the landing zone, which is the
  // decision itself, runs last and owns its own two targets.

  // G5 — the diagonal carry across the inside of a bend.
  if (controls.length > 2 || template === 'cape') siteDiagonalCarry(ctx, hazRng, hasLZ);

  // G4 — the half-way bunker. Only where there is no carry band: the band IS
  // the driver-range fork, and a second bunker short of it is noise, not a
  // second decision.
  if (!hasLZ && shouldCentreBunker(course, template, hazRng)) siteCentreBunker(ctx, hazRng, hasLZ);

  // G2b — the landing zone: the fork itself.
  if (hasLZ) siteLandingZone(ctx, hazRng);

  // G7 — recovery asymmetry.
  const treed = treeAsymmetry(ctx, hazRng);
  if (treed) notes.push(`trees biased ${plan.treedSide > 0 ? 'right' : 'left'}, ${treed} tiles`);

  // The corridor guarantee, re-asserted — but NOT through the landing zone.
  // The classic generator promises the spine is playable fairway; keeping that
  // promise here would drill a dry hole through the middle of the wall the
  // landing zone just built, which is the one place a free centre route must
  // not exist. Outside the wall the promise stands. A forced carry at driver
  // range is a golf hole; a gap down the middle of it is not.
  const wallLo = plan.lzDist - 8;
  const wallHi = plan.lzDist + 4;
  for (const p of spine) {
    if (!writable(course, p.x, p.y)) continue;
    if (cellAt(course, p.x, p.y) !== WATER) continue;
    const { along } = spineOffset(ctx, p.x, p.y);
    if (along >= wallLo && along <= wallHi) continue;
    setCell(course, p.x, p.y, FAIRWAY);
  }
  setCell(course, T.x, T.y, FAIRWAY);

  course.strategy = publicPlan(plan);
  return plan;
}

/** The serializable half — what rides on the course for the UI and certify.js. */
function publicPlan(p) {
  return {
    template: p.template,
    tuckSide: p.tuckSide,
    shelfSide: p.shelfSide,
    sideName: p.sideName,
    greenPrefer: p.greenPrefer,
    lzDist: Math.round(p.lzDist * 100) / 100,
    lz: p.lz,
    // the frame, so the UI and the tests can talk about "the left side" without
    // re-deriving it from tee and cup and getting the sign wrong
    axis: { x: p.axis.x, y: p.axis.y },
    perp: { x: p.perp.x, y: p.perp.y },
    width: { tight: Math.round(p.width.tight * 100) / 100, wide: Math.round(p.width.wide * 100) / 100 },
    hazards: p.hazards,
    targets: p.targets,
    carryBand: p.carryBand,
    treedSide: p.treedSide,
    notes: p.notes,
  };
}

// --- G6: templates -----------------------------------------------------------

/** What green each template asks `greens.js` for. A preference, never a demand. */
const GREEN_FOR_TEMPLATE = {
  none: null,
  redan: 'long-narrow', // the long axis running away from the approach
  cape: 'kidney',       // bent around the water it is played over
  road: 'long-narrow',  // the thin diagonal sliver, pot short, dead long
  punchbowl: 'punchbowl',
  short: 'crowned',     // small, domed, sheds every miss
};

/**
 * Pick a template. Length and archetype gate what makes sense: a Redan is a
 * one-shotter, a Cape needs a bend to cut, a Road wants a full two-shotter.
 * `none` stays the plurality — a course of nothing but famous holes is a
 * theme park, not a golf course.
 */
function pickTemplate(rng, course, holeTiles) {
  const isShort = holeTiles < 16;
  const isLong = holeTiles > 27;
  const bends = course.archetype === 'dogleg-left' || course.archetype === 'dogleg-right';
  const table = [
    ['none', 46],
    ['redan', isShort ? 26 : 4],
    ['short', isShort ? 20 : 2],
    ['cape', bends ? 30 : 3],
    ['road', isLong ? 16 : bends ? 10 : 12],
    ['punchbowl', isShort ? 10 : 14],
  ];
  return pickWeighted(rng, table);
}

/**
 * Which flank the cup gets tucked on — the single decision the whole hole
 * hangs off. On a dogleg it is the INSIDE of the bend, because that is where
 * the corner-cutter earns their angle; otherwise it is a coin flip.
 */
function pickTuckSide(rng, course, controls, perp) {
  if (controls.length > 2) {
    const bend = controls[1];
    const T = controls[0];
    const H = controls[controls.length - 1];
    // Which side of the tee→cup line does the bend sit on? The corner to cut
    // is the OTHER one.
    const s = Math.sign((bend.x - T.x) * perp.x + (bend.y - T.y) * perp.y
      - (((H.x - T.x) * perp.x + (H.y - T.y) * perp.y)));
    if (s !== 0) return -s;
  }
  return rng() < 0.5 ? -1 : 1;
}

// --- geometry helpers --------------------------------------------------------

/** The point `d` tiles along the routing, following the spine where there is one. */
function pointAt(spine, T, axis, d) {
  if (spine.length > 1) {
    let best = null;
    let bestErr = Infinity;
    for (const p of spine) {
      const err = Math.abs(Math.hypot(p.x - T.x, p.y - T.y) - d);
      if (err < bestErr) { bestErr = err; best = p; }
    }
    if (best && bestErr < 2.5) return { x: best.x, y: best.y };
  }
  return { x: Math.round(T.x + axis.x * d), y: Math.round(T.y + axis.y * d) };
}

/** Distance from a tile to the nearest spine point, and the signed side of it. */
function spineOffset(ctx, x, y) {
  const { spine, perp, T, axis } = ctx;
  let best = null;
  let bestD = Infinity;
  for (const p of spine) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) { bestD = d; best = p; }
  }
  const rx = x - T.x;
  const ry = y - T.y;
  // `off` is measured against the tee→cup LINE, not against whichever spine
  // point happens to be nearest. Measuring it spine-relative was a real bug:
  // the spine wanders a tile either way per step, so the SIGN of a tile's
  // offset flipped along the hole and the asymmetric widener spent half its
  // effort widening the side it meant to pinch. One frame for the whole module,
  // and it is the frame the player sees from the tee.
  const off = rx * perp.x + ry * perp.y;
  const along = rx * axis.x + ry * axis.y;
  // `d` stays spine-relative: corridor width is about distance from the ROUTE.
  return { d: best ? bestD : Math.abs(off), off, along };
}

/**
 * The nearest TILE to `want` whose carry distance from the tee satisfies `ok`
 * and which this module is allowed to build on. Returns null when no tile in
 * range qualifies — on a short par 4 the band and the green complex together
 * can leave genuinely nowhere to land, and saying so beats inventing a spot.
 */
function snapTile(course, T, want, ok) {
  let best = null;
  const cx = Math.round(want.x);
  const cy = Math.round(want.y);
  for (let y = cy - 3; y <= cy + 3; y++) {
    for (let x = cx - 3; x <= cx + 3; x++) {
      if (!writable(course, x, y)) continue;
      const rad = Math.hypot(x - T.x, y - T.y);
      if (!ok(rad)) continue;
      const d = Math.hypot(x - want.x, y - want.y);
      if (!best || d < best.d) best = { x, y, rad, d };
    }
  }
  return best;
}

/**
 * The one rule the whole module obeys: greens.js owns the complex, and the tee
 * is never buried. Everything writes through here.
 */
function writable(course, x, y) {
  if (!inBounds(course, x, y)) return false;
  if (x === course.tee.x && y === course.tee.y) return false;
  if (Math.hypot(x - course.hole.x, y - course.hole.y) <= GREEN_KEEPOUT) return false;
  if (cellAt(course, x, y) === GREEN) return false;
  return true;
}

function put(course, x, y, terrain) {
  if (!writable(course, x, y)) return 0;
  if (cellAt(course, x, y) === terrain) return 0;
  setCell(course, x, y, terrain);
  return 1;
}

function stamp(course, cx, cy, radius, terrain, accept = null) {
  let n = 0;
  const r = Math.ceil(radius);
  for (let y = Math.round(cy) - r; y <= Math.round(cy) + r; y++) {
    for (let x = Math.round(cx) - r; x <= Math.round(cx) + r; x++) {
      if (Math.hypot(x - cx, y - cy) > radius) continue;
      if (accept && !accept(cellAt(course, x, y))) continue;
      n += put(course, x, y, terrain);
    }
  }
  return n;
}

// --- G2a: clear the centre line ---------------------------------------------

/**
 * Reclaim sand and water from the corridor in the strategic band. The classic
 * pass put them there on purpose; the purpose was wrong. Tiles on the spine
 * come back as fairway, tiles beside it as rough — so a cleared pond leaves
 * playable ground, not a scar.
 */
function clearCentreLine(ctx) {
  const { course, plan } = ctx;
  const lo = 4;
  const hi = plan.lzDist + 4;
  let n = 0;
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      const t = cellAt(course, x, y);
      if (t !== SAND && t !== WATER) continue;
      const { d, along } = spineOffset(ctx, x, y);
      if (along < lo || along > hi) continue;
      if (d > 2.2) continue; // only what actually sits ON the route
      n += put(course, x, y, d <= 0.9 ? FAIRWAY : ROUGH);
    }
  }
  return n;
}

// --- G3: width with a preferred side ----------------------------------------

/**
 * Widen the corridor and make the two sides different widths. The BAIL-OUT
 * side is the generous one: taking the safe line should always be possible and
 * always cost you the angle, never cost you the hole.
 *
 * A correction to `01`'s G3 while we are here. It estimated the classic
 * corridor at 24–40 yards from the fairway stamp radius, and measured against
 * the tee→cup line the real thing is far wider than that — because the spine
 * WANDERS, so a corridor that hugs the route within two and a half tiles still
 * sweeps five or six tiles either side of the straight line. The premise was
 * wrong; the stage is still worth having, but for the ASYMMETRY rather than the
 * width. What it adds is measured in strategic.test.js the only way that means
 * anything: by which side of the hole the newly mown ground lands on.
 *
 * Width tapers to nothing at the tee and at the green keepout, so the corridor
 * is a lens, not a runway.
 */
function widenCorridor(ctx, rng) {
  const { course, plan, holeTiles } = ctx;
  const jitter = 0.75 + rng() * 0.5;
  const lo = 3;
  const hi = Math.min(holeTiles - GREEN_KEEPOUT + 1.5, holeTiles);
  let n = 0;
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      if (cellAt(course, x, y) !== ROUGH) continue; // never overwrite trouble
      const { d, off, along } = spineOffset(ctx, x, y);
      if (along < lo || along > hi) continue;
      // a lens: full width through the landing zone, tapering both ways
      const t = along < plan.lzDist
        ? (along - lo) / Math.max(1, plan.lzDist - lo)
        : 1 - (along - plan.lzDist) / Math.max(1, hi - plan.lzDist);
      const taper = Math.max(0, Math.min(1, t)) ** 0.6;
      const side = Math.sign(off) === plan.shelfSide ? plan.width.tight : plan.width.wide;
      if (d <= side * taper * jitter) n += put(course, x, y, FAIRWAY);
    }
  }
  return n;
}

// --- G2b: the landing-zone hazard -------------------------------------------

/**
 * The landing zone, built as TWO TARGETS AND A WALL.
 *
 * The first draft of this function did what `01`'s G2 says literally: move the
 * hazard off the centre line and onto the pin side. Measured through
 * `certify.js` it made things WORSE — fork rate fell from 30% to zero. The
 * reason is worth writing down, because it is the whole lesson of the release:
 *
 *   A hazard beside a wide fairway does not create two options. It creates one
 *   option with a bruise on it. The expected-strokes field stays a single
 *   smooth basin whose floor has simply moved a couple of tiles away from the
 *   sand. There is no ridge, so there is no decision.
 *
 * A fork needs two separated floors WITH A WALL BETWEEN THEM. So the landing
 * zone is designed backwards from that requirement, as two named places:
 *
 *   THE AGGRESSIVE TARGET — long, and on the tuck side, so it is both nearer
 *   the green and on the flank the cup sits on. A narrow shelf.
 *   THE BAIL — short, wide, on the open side. Always available, always costs
 *   you the angle and forty yards of approach.
 *
 * and the hazard is then laid ALONG THE SEGMENT BETWEEN THEM, which is the only
 * place it can be if crossing from one plan to the other is meant to be
 * expensive. What makes the two unequal in character rather than merely in
 * length is everything else in this file: the tuck, the asymmetric width, the
 * trees. What makes them CLOSE IN VALUE — the thing M1 actually measures — is
 * that the shelf's own dispersion pattern clips the wall.
 */
function siteLandingZone(ctx, rng) {
  const { course, T, axis, perp, plan, holeTiles } = ctx;
  const kind = pickWeighted(rng, [[WATER, 38], [SAND, 62]]);
  const S = LZ_SHAPE;
  const draw = ([lo, span]) => lo + rng() * span;

  // Aim points live on ARCS OF CONSTANT CARRY, not on distances along the line.
  // The first version of this function placed the aggressive target at `lzDist`
  // ALONG the line and five tiles off it — sixteen tiles of carry when a scratch
  // driver goes fifteen. `evaluateAim` prices an unreachable aim at Infinity, so
  // the aggressive line was not merely bad, it did not exist.
  const at = (radial, off) => {
    const along = Math.sqrt(Math.max(1, radial * radial - off * off));
    return {
      x: T.x + axis.x * along + perp.x * off,
      y: T.y + axis.y * along + perp.y * off,
    };
  };

  // The band, and where it sits, is the ONE number this whole release turns on.
  // It is placed as a fraction of a full swing so that the far edge lands just
  // inside the driver, which is the only position where the question is real:
  // clear it and you have most of a shot in hand, come up short and you are wet.
  const full = MAX_CARRY;
  // The band is derived from the FAR EDGE inward, not from the near edge out.
  //
  // The first version drew the near edge as a fraction of a full swing and let
  // the depth run outward from it, and the two knobs fought: a deep band pushed
  // its own far edge past the driver, so the "carry target" — clamped back to
  // maximum reach — landed inside the hazard it was supposed to clear. The
  // measured fork rate went UP, which is exactly how a bug survives a tuning
  // pass: the aim heatmap was reading an unclearable wall, not a decision.
  //
  // So the far edge is placed first, `farMargin` inside a full swing, leaving
  // just enough room to land beyond it. Depth then grows BACKWARD toward the
  // tee, where it costs nothing but the length of the lay-up.
  const outer = holeTiles - GREEN_KEEPOUT - 0.9; // ...and out of the green complex
  const over = draw(S.carryOver);
  const r1 = Math.min(full - draw(S.farMargin), outer - over - 0.35);
  const depth = draw(S.depth);
  const r0 = r1 - depth;
  if (r0 < 6.0 || r1 <= r0) {
    plan.notes.push('no room between the tee and the green complex for a carry');
    return;
  }

  // THE TWO AIM POINTS, chosen as TILES inside a permitted annulus rather than
  // as float points rounded afterwards. Rounding moves a point by up to seven
  // tenths of a tile, which was enough to drop a carry target computed at 14.1
  // tiles back onto the tile at 13.6 — inside the band it was meant to have
  // cleared. An aim point is a tile the player can hit; picking it as one
  // removes the whole class of bug.
  //
  // THE LAY-UP is short of the band, wide, on the open side: always available,
  // always leaving the longer approach from the flank the pin is tucked away
  // from. Safe is not the same as free.
  //
  // THE CARRY is past the far edge by less than a standard deviation of
  // distance control, on the side that opens the green.
  const layRad = Math.max(5, r0 - draw(S.layBack));
  const layOff = -draw(S.layOff) * plan.shelfSide;
  const layR = draw(S.layR);
  const lay = snapTile(course, T, at(layRad, layOff), (rad) => rad >= 4 && rad <= r0 - 0.5);

  const carryRad = Math.min(full - 0.35, outer, r1 + over);
  const carryOff = draw(S.carryOff) * plan.shelfSide;
  const carryR = draw(S.carryR);
  const carryLimit = Math.min(full, outer + 0.4);
  const carry = snapTile(course, T, at(carryRad, carryOff), (rad) => rad >= r1 + 0.5 && rad <= carryLimit);

  if (!lay || !carry) {
    plan.notes.push('no tile both clears the carry band and stays inside a full swing');
    return;
  }

  // The band spans the CORRIDOR — the played width plus a margin — and no more.
  // The first version spanned the widened corridor plus three and a half tiles
  // either side, which on a twenty-four-tile board is nineteen tiles across:
  // not a hazard but a moat, edge to edge, with the tee on one bank. It scored
  // well precisely because it was impossible, which is not the same as being
  // interesting. Going round the end is left possible and left expensive —
  // eight tiles off the line gives up most of the drive — so it is a third
  // option with a price, which is what a golf hole is made of.
  const span = plan.width.wide + 1.9;
  let wrote = 0;
  for (let off = -span; off <= span; off += 0.6) {
    for (let rad = r0; rad <= r1; rad += 0.6) {
      const p = at(rad, off);
      wrote += put(course, Math.round(p.x), Math.round(p.y), kind);
    }
  }

  // Sand outside the carry shelf, so the miss long-and-wide is a miss too and
  // the greedy line is genuinely a corridor.
  for (let i = 0; i < 2; i++) {
    const o = at(carryRad + (i === 0 ? -1.4 : 1.0), draw(S.outerOff) * plan.shelfSide);
    wrote += stamp(course, o.x, o.y, draw(S.outerR), SAND, (t) => t === ROUGH || t === FAIRWAY);
  }

  // The landing areas are mown LAST, over whatever the band spilled, so a plan
  // can never eat its own targets — over trees too, because a clump that
  // happened to fall here would otherwise silently delete one arm of the fork.
  //
  // But they must not eat the BAND. An earlier version stamped plain discs and
  // the carry target's radius reached back through the far edge, mowing a dry
  // lane down the middle of the hazard the plan had just laid: a wall with a
  // door in it, which is no wall. So the discs are radially clipped, with the
  // aim tiles themselves always mown — an aim point you cannot land on is not
  // an option, and both of these have already been checked clear of the band.
  const ground = (t) => t === ROUGH || t === SAND || t === TREES || t === WATER;
  const mow = (p, radius) => {
    const R = Math.ceil(radius);
    for (let y = p.y - R; y <= p.y + R; y++) {
      for (let x = p.x - R; x <= p.x + R; x++) {
        if (Math.hypot(x - p.x, y - p.y) > radius) continue;
        const rad = Math.hypot(x - T.x, y - T.y);
        if (rad > r0 - 0.45 && rad < r1 + 0.45) continue; // the band is inviolable
        if (!ground(cellAt(course, x, y))) continue;
        put(course, x, y, FAIRWAY);
      }
    }
  };
  mow(lay, layR);
  mow(carry, carryR);

  const kindName = kind === WATER ? 'water' : 'sand';
  const mid = at((r0 + r1) / 2, 0);
  plan.hazards.push({
    role: 'carry-band', kind: kindName,
    x: Math.round(mid.x), y: Math.round(mid.y), r: Math.round(depth * 100) / 100,
  });
  plan.targets = {
    aggressive: { x: carry.x, y: carry.y, r: Math.round(carryR * 100) / 100, carry: Math.round(carry.rad * 10) / 10 },
    bail: { x: lay.x, y: lay.y, r: Math.round(layR * 100) / 100, carry: Math.round(lay.rad * 10) / 10 },
  };
  plan.carryBand = { near: Math.round(r0 * 10) / 10, far: Math.round(r1 * 10) / 10, kind: kindName };
  plan.notes.push(
    `${kindName} across the fairway from ${(r0 * 16).toFixed(0)} to ${(r1 * 16).toFixed(0)} yds:`
    + ` lay up at ${(lay.rad * 16).toFixed(0)} or carry to ${(carry.rad * 16).toFixed(0)} on the ${plan.sideName}`
    + ` (${wrote} tiles)`,
  );
}

// --- G4: the centre-line bunker ---------------------------------------------

function shouldCentreBunker(course, template, rng) {
  const straight = course.archetype === 'straight' || course.archetype === 'long';
  if (template === 'road') return rng() < 0.55;
  return straight && rng() < 0.30;
}

/**
 * A small bunker sitting ON the line at driver range. The cheapest fork in
 * architecture: you cannot aim where you were going to aim, and the two ways
 * past are not equivalent, because one of them is the tuck side.
 */
function siteCentreBunker(ctx, rng, hasLZ) {
  const { course, plan, T, axis, perp } = ctx;
  const along = hasLZ
    ? plan.lzDist * (0.48 + rng() * 0.16)   // half-way: forks the lay-up
    : plan.lzDist * (0.82 + rng() * 0.22);  // driver range: the only fork here
  const off = (rng() * 0.8 - 0.4);
  const cx = T.x + axis.x * along + perp.x * off;
  const cy = T.y + axis.y * along + perp.y * off;
  const r = 1.0 + rng() * 0.6;
  const wrote = stamp(course, cx, cy, r, SAND, (t) => t === FAIRWAY || t === ROUGH);
  if (wrote > 0) {
    plan.hazards.push({ role: 'centre', kind: 'sand', x: Math.round(cx), y: Math.round(cy), r: Math.round(r * 100) / 100 });
    plan.notes.push(`centre-line bunker at ${Math.round(along)} tiles`);
  }
}

// --- G5: the diagonal carry (Cape) ------------------------------------------

/**
 * A hazard laid along the inside of a bend, so the carry needed to clear it
 * grows the more of the corner you take on. Not a wall to be cleared — a
 * DIAGONAL, where every extra yard of carry buys a measurable yard of angle,
 * which is the whole idea behind a Cape hole.
 */
function siteDiagonalCarry(ctx, rng, hasLZ = false) {
  const { course, T, axis, perp, plan, holeTiles } = ctx;
  const kind = plan.template === 'cape' ? WATER : (rng() < 0.55 ? WATER : SAND);
  // The corner to cut is the tuck side: the bend goes the other way.
  const side = plan.shelfSide;
  const t0 = 0.14;
  // Short of the band when there is one: two hazards that merge read as one
  // wall, and a wall is not a diagonal.
  const t1 = Math.min(hasLZ ? 0.34 : 0.62, (holeTiles - GREEN_KEEPOUT - 1) / holeTiles);
  if (t1 <= t0 + 0.08) return;
  const steps = 5;
  let wroteAny = 0;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const t = t0 + (t1 - t0) * f;
    // the band walks OUT from the line as it goes: near the tee it barely
    // intrudes, near the corner it demands the full carry
    const off = (0.4 + f * (3.4 + rng() * 1.2)) * side;
    const along = holeTiles * t;
    const cx = T.x + axis.x * along + perp.x * off;
    const cy = T.y + axis.y * along + perp.y * off;
    const r = 1.3 + f * (1.1 + rng() * 0.6);
    wroteAny += stamp(course, cx, cy, r, kind, (t2) => t2 === ROUGH || t2 === TREES || t2 === FAIRWAY);
  }
  if (wroteAny > 0) {
    plan.hazards.push({
      role: 'carry',
      kind: kind === WATER ? 'water' : 'sand',
      x: Math.round(T.x + axis.x * holeTiles * ((t0 + t1) / 2) + perp.x * 2 * side),
      y: Math.round(T.y + axis.y * holeTiles * ((t0 + t1) / 2) + perp.y * 2 * side),
      r: 0,
    });
    plan.notes.push(`diagonal carry down the ${plan.sideName}, ${wroteAny} tiles`);
  }
}

// --- G7: recovery asymmetry --------------------------------------------------

/**
 * A miss is not a decision unless the two miss sides cost differently. Trees go
 * on ONE side of the corridor — the bail-out side, so the wide safe fairway is
 * bounded by a real penalty if you over-cook the bail — and the tuck side is
 * left as open rough, so the aggressive miss is recoverable. Aggression should
 * be punished by GEOMETRY, not by a stroke and distance.
 */
function treeAsymmetry(ctx, rng) {
  const { course, plan, holeTiles } = ctx;
  const open = plan.shelfSide;
  let n = 0;
  const grow = [];
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      const t = cellAt(course, x, y);
      if (t !== TREES && t !== ROUGH) continue;
      const { d, off, along } = spineOffset(ctx, x, y);
      if (along < 2 || along > holeTiles - GREEN_KEEPOUT + 2) continue;
      if (d > 11) continue;
      const onOpenSide = Math.sign(off) === open;
      if (t === TREES && onOpenSide && d < 8) {
        n += put(course, x, y, ROUGH); // clear the aggressive side
      } else if (t === ROUGH && !onOpenSide && d > plan.width.wide + 3.5 && d < 10) {
        grow.push({ x, y }); // and thicken the bail-out side
      }
    }
  }
  for (const g of grow) {
    if (rng() < 0.30) n += put(course, g.x, g.y, TREES);
  }
  return n;
}
