// Is this hole actually strategic? — the measuring instrument.
//
// Release D's generator is *designed* to fork. Design intent is not evidence.
// This module is the arithmetic that decides whether a hole earns the word, and
// it is deliberately hostile: a hole passes only if the expected-strokes field
// itself — the same field the caddie scores you against — contains two viable
// answers that a player could genuinely disagree about.
//
// Four metrics, from `docs/research/01-architecture-and-sg.md` §4:
//
//   M1  FORK. The aim heatmap has two basins at least FORK_SEP tiles apart,
//       the second within FORK_TIE strokes of the best, and a ridge of at
//       least FORK_RIDGE strokes between them. Two viable lines, genuinely
//       separated — not one basin with a dent in it.
//   M2  PROFILE DIVERGENCE. A tour pro and a 20-handicap aim at points at
//       least DIVERGE tiles apart. The hole plays different lengths for
//       different dispersions, which is the strategic school's whole claim.
//   M3  CENTRE-LINE PENALTY. Aiming naively — as far down the middle as you
//       can safely go — costs at least CENTRE_COST strokes against the best
//       line. If dead-centre is optimal, the hole teaches nothing.
//   M4  TEMPTATION. The optimal line's own pattern flirts with trouble, or a
//       tied alternative does. Guarantees the right answer isn't merely the
//       safe one.
//
// A hole PASSES on M1 and at least one of M2/M3. M4 is reported but does not
// gate: it is the anti-boredom reading, and a hole can be a good decision
// without being a scary one.
//
// COST. Each profile costs one `strokesField`, which is the expensive call in
// this codebase (~1.7 s at six sweeps). Certification is therefore an OFFLINE
// instrument — tests, the audit sheet, release evidence — never a live reroll
// gate in the browser. The generator earns its fork by construction and this
// module proves it did, over hundreds of seeds at a time.

import { strokesField, bestAim, evaluateAim, aimHeatmap } from './strategy.js';
import { lieParamsAt, patternStats, reach, HANDICAPS, handicapById } from './dispersion.js';
import { cellAt, inBounds } from './course.js';
import { WATER } from './terrain.js';

/** Two basins must be at least this far apart to count as different lines. */
export const FORK_SEP = 4;
/** ...the second no worse than this many strokes... */
export const FORK_TIE = 0.10;
/** ...and separated by a ridge at least this high, or it is one basin. */
export const FORK_RIDGE = 0.15;
/** M2: tour and 20-handicap optimal aims must differ by this many tiles. */
export const DIVERGE = 3;
/** M3: the naive centre-line aim must cost at least this much. */
export const CENTRE_COST = 0.15;
/** M4: trouble share on the optimal line... */
export const TEMPT_BEST = 0.10;
/** ...or on a tied alternative. */
export const TEMPT_ALT = 0.25;

const SWEEPS = 5;

/** Below this hole length M1 is not applicable — see `certifyHole`. */
export const TEE_FORK_MIN = 19;

/**
 * @typedef {{
 *   pass: boolean,
 *   m1: {ok: boolean, best: number, second: number|null, ridge: number|null,
 *        sep: number|null, basins: Array<{x:number,y:number,e:number}>},
 *   m2: {ok: boolean, divergence: number|null, tour: {x,y}|null, twenty: {x,y}|null},
 *   m3: {ok: boolean, cost: number|null, centre: {x,y}|null},
 *   m4: {ok: boolean, bestTrouble: number, altTrouble: number},
 *   best: {x: number, y: number, e: number},
 *   from: {x: number, y: number},
 *   reasons: string[],
 * }} Certificate
 */

/**
 * Certify the tee shot of a hole.
 *
 * @param {import('./course.js').Course} course
 * @param {{from?: {x,y}, profile?: object, stride?: number, sweeps?: number,
 *          skipDivergence?: boolean, V?: Float64Array}} [opts]
 *   `skipDivergence` drops M2 (and its second `strokesField`) when only the
 *   single-profile metrics are wanted — it halves the cost of a sweep.
 * @returns {Certificate}
 */
export function certifyHole(course, opts = {}) {
  const profile = opts.profile ?? handicapById('scratch');
  const from = opts.from ?? course.tee;
  const stride = opts.stride ?? 1;
  const sweeps = opts.sweeps ?? SWEEPS;

  const V = opts.V ?? strokesField(course, sweeps, profile);
  const heat = aimHeatmap(course, V, from, stride, profile);
  const reasons = [];

  // M1 asks whether there are two viable LINES from this shot. On a one-shotter
  // there is one line — at the green — and no amount of architecture changes
  // that; the decision a par 3 poses is about which part of the green, at a
  // scale the tee-shot heatmap cannot resolve. Measuring a par 3 with M1 does
  // not find a flaw, it asks the wrong question, so par 3s are reported as
  // NOT APPLICABLE rather than as failures. Certifying them needs a
  // green-scale metric, which release D does not have and does not pretend to.
  const holeTiles = Math.hypot(course.hole.x - from.x, course.hole.y - from.y);
  const applicable = holeTiles >= TEE_FORK_MIN;

  const m1 = forkMetric(heat, course, V, from, profile);
  m1.applicable = applicable;
  if (!applicable) m1.why = 'one-shotter: no tee-shot fork to measure';
  if (applicable && !m1.ok) reasons.push(m1.why);

  const m3 = centreMetric(course, V, from, profile, m1.basins[0]);
  if (!m3.ok) reasons.push(m3.why);

  const m2 = opts.skipDivergence
    ? { ok: false, divergence: null, tour: null, twenty: null, skipped: true }
    : divergenceMetric(course, from, sweeps);
  if (!opts.skipDivergence && !m2.ok) reasons.push(m2.why);

  const m4 = temptationMetric(course, from, profile, m1.basins);

  const best = m1.basins[0] ?? { x: from.x, y: from.y, e: Infinity };
  const pass = applicable && m1.ok && (m2.ok || m3.ok);
  return { pass, applicable, m1, m2, m3, m4, best, from, reasons };
}

// --- M1: the fork ------------------------------------------------------------

/**
 * Local minima of the aim heatmap, thinned so no two are within `FORK_SEP`
 * tiles — each survivor is the floor of a genuinely separate basin.
 */
export function basinsOf(heat, sep = FORK_SEP) {
  const at = new Map();
  for (const c of heat) at.set(c.y * 4096 + c.x, c.e);
  const minima = [];
  for (const c of heat) {
    let isMin = true;
    for (let dy = -1; dy <= 1 && isMin; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const n = at.get((c.y + dy) * 4096 + (c.x + dx));
        if (n !== undefined && n < c.e - 1e-9) { isMin = false; break; }
      }
    }
    if (isMin) minima.push(c);
  }
  minima.sort((a, b) => a.e - b.e);
  const kept = [];
  for (const m of minima) {
    if (kept.some((k) => Math.hypot(k.x - m.x, k.y - m.y) < sep)) continue;
    kept.push(m);
    if (kept.length >= 6) break;
  }
  return kept;
}

/**
 * The highest heat value along the straight line between two aim points — the
 * ridge you would have to cross to move from one line of play to the other. A
 * real fork has a real ridge; a single basin with a dimple has none.
 *
 * Sampled off the heatmap where the heatmap has a value and evaluated live
 * where it does not, so a ridge made of unreachable or wet ground still reads
 * as the wall it is.
 */
export function ridgeBetween(heat, a, b, course, V, from, profile) {
  const at = new Map();
  for (const c of heat) at.set(c.y * 4096 + c.x, c.e);
  const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  let peak = -Infinity;
  const lie = lieParamsAt(course, from.x, from.y);
  const r = reach(lie, profile);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    const cached = at.get(y * 4096 + x);
    if (cached !== undefined) { peak = Math.max(peak, cached); continue; }
    if (!inBounds(course, x, y)) continue;
    // Water is skipped by aimHeatmap because you cannot aim there; as a wall
    // between two lines it is the highest ridge there is.
    if (cellAt(course, x, y) === WATER) return Infinity;
    if (Math.hypot(x - from.x, y - from.y) > r) continue;
    const e = 1 + evaluateAim(course, V, from, { x, y }, profile);
    if (Number.isFinite(e)) peak = Math.max(peak, e);
  }
  return peak;
}

function forkMetric(heat, course, V, from, profile) {
  const basins = basinsOf(heat);
  if (basins.length < 2) {
    return { ok: false, best: basins[0]?.e ?? Infinity, second: null, ridge: null, sep: null, basins, why: 'no second basin' };
  }
  const best = basins[0];
  // The best CONTENDER is the nearest-in-value rival that actually has a wall
  // between it and the winner — not merely the second-lowest number.
  let contender = null;
  for (let i = 1; i < basins.length; i++) {
    const b = basins[i];
    if (b.e - best.e > FORK_TIE) break;
    const ridge = ridgeBetween(heat, best, b, course, V, from, profile);
    const cand = { b, ridge, gap: b.e - best.e };
    if (!contender || ridge > contender.ridge) contender = cand;
  }
  if (!contender) {
    const gap = basins[1].e - best.e;
    return {
      ok: false, best: best.e, second: basins[1].e, ridge: null,
      sep: Math.hypot(basins[1].x - best.x, basins[1].y - best.y), basins,
      why: `second basin costs +${gap.toFixed(3)} (needs <= ${FORK_TIE})`,
    };
  }
  const rise = contender.ridge - best.e;
  const sep = Math.hypot(contender.b.x - best.x, contender.b.y - best.y);
  const ok = rise >= FORK_RIDGE;
  return {
    ok, best: best.e, second: contender.b.e,
    ridge: Number.isFinite(contender.ridge) ? contender.ridge : null,
    rise: Number.isFinite(rise) ? rise : Infinity, sep, basins,
    why: ok ? null : `ridge only +${rise.toFixed(3)} (needs >= ${FORK_RIDGE})`,
  };
}

// --- M2: profile divergence --------------------------------------------------

function divergenceMetric(course, from, sweeps) {
  const tourP = HANDICAPS[0];
  const twentyP = HANDICAPS[3];
  const tour = bestAim(course, strokesField(course, sweeps, tourP), from, 1, tourP).target;
  const twenty = bestAim(course, strokesField(course, sweeps, twentyP), from, 1, twentyP).target;
  const divergence = Math.hypot(tour.x - twenty.x, tour.y - twenty.y);
  const ok = divergence >= DIVERGE;
  return {
    ok, divergence, tour, twenty,
    why: ok ? null : `tour and 20-hcp aim ${divergence.toFixed(1)} tiles apart (needs >= ${DIVERGE})`,
  };
}

// --- M3: the centre-line penalty ---------------------------------------------

/**
 * The naive aim: as far down the direct tee→cup line as the player can reach
 * without aiming into water. This is what a golfer who is not thinking does,
 * and a strategic hole has to punish it.
 */
export function centreAim(course, from, profile) {
  const H = course.hole;
  const d = Math.hypot(H.x - from.x, H.y - from.y) || 1;
  const ax = (H.x - from.x) / d;
  const ay = (H.y - from.y) / d;
  const r = reach(lieParamsAt(course, from.x, from.y), profile);
  const limit = Math.min(r, d);
  let found = null;
  for (let s = limit; s >= 1; s -= 0.5) {
    const x = Math.round(from.x + ax * s);
    const y = Math.round(from.y + ay * s);
    if (!inBounds(course, x, y) || cellAt(course, x, y) === WATER) continue;
    // Rounding to a tile can push a point that was inside the reach circle
    // outside it, and `evaluateAim` prices anything out of reach at Infinity —
    // which would read as "the naive line is catastrophic" instead of "the
    // naive line is fine", the exact opposite of the truth.
    if (Math.hypot(x - from.x, y - from.y) > r) continue;
    found = { x, y };
    break;
  }
  return found;
}

function centreMetric(course, V, from, profile, best) {
  const centre = centreAim(course, from, profile);
  if (!centre || !best) return { ok: false, cost: null, centre, why: 'no centre-line aim' };
  const e = 1 + evaluateAim(course, V, from, centre, profile);
  const cost = e - best.e;
  const ok = Number.isFinite(cost) && cost >= CENTRE_COST;
  return {
    ok, cost: Number.isFinite(cost) ? cost : null, centre,
    why: ok ? null : `naive centre aim costs only +${Number.isFinite(cost) ? cost.toFixed(3) : '?'} (needs >= ${CENTRE_COST})`,
  };
}

// --- M4: temptation ----------------------------------------------------------

function troubleShare(course, from, target, profile) {
  const lie = lieParamsAt(course, from.x, from.y);
  const s = patternStats(course, from, target, lie.sigmaScale, profile);
  return (s.pct.sand + s.pct.wet + s.pct.trees) / 100;
}

function temptationMetric(course, from, profile, basins) {
  if (basins.length === 0) return { ok: false, bestTrouble: 0, altTrouble: 0 };
  const bestTrouble = troubleShare(course, from, basins[0], profile);
  let altTrouble = 0;
  for (let i = 1; i < basins.length; i++) {
    if (basins[i].e - basins[0].e > FORK_TIE) break;
    altTrouble = Math.max(altTrouble, troubleShare(course, from, basins[i], profile));
  }
  return { ok: bestTrouble >= TEMPT_BEST || altTrouble >= TEMPT_ALT, bestTrouble, altTrouble };
}

// --- sweeps ------------------------------------------------------------------

/**
 * Certify a run of holes and report the rate. The comparison this release
 * lives or dies by: the same seeds through the classic generator and through
 * the strategic one, measured by the identical instrument.
 *
 * @param {(seed: number) => import('./course.js').Course} build
 * @param {number[]} seeds
 * @param {object} [opts] forwarded to `certifyHole`
 */
export function certifySweep(build, seeds, opts = {}) {
  const rows = [];
  let pass = 0;
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  let applicable = 0;
  for (const seed of seeds) {
    const course = build(seed);
    const c = certifyHole(course, opts);
    rows.push({ seed, pass: c.pass, applicable: c.applicable, m1: c.m1.ok, m2: c.m2.ok, m3: c.m3.ok, m4: c.m4.ok, cert: c });
    if (c.applicable) applicable++;
    if (c.pass) pass++;
    if (c.m1.ok) m1++;
    if (c.m2.ok) m2++;
    if (c.m3.ok) m3++;
    if (c.m4.ok) m4++;
  }
  const n = Math.max(1, seeds.length);
  // `rate` counts every hole asked; `applicableRate` counts only the holes the
  // question fits. Reporting both keeps a sweep honest in either direction — a
  // set that is half par 3s cannot flatter itself by hiding them, and cannot be
  // damned for containing them either.
  const a = Math.max(1, applicable);
  return {
    n: seeds.length, rows, applicable,
    rate: pass / n, applicableRate: pass / a,
    m1Rate: m1 / n, m1ApplicableRate: m1 / a,
    m2Rate: m2 / n, m3Rate: m3 / n, m4Rate: m4 / n,
  };
}
