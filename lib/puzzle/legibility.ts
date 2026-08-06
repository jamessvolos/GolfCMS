/**
 * The second axis: consequence.
 *
 * `trapSize` asks "is the obvious aim wrong?" It is the right question and
 * it is not the only one. A green with water down one side and forty yards
 * of short grass down the other can have a trap of exactly zero — the
 * optimal aim really is the middle, which is where you were going to aim —
 * while still being the most important shot on the golf course. The shipped
 * library taught three of those as free PERFECTs.
 *
 * Consequence asks the other question: **what does being wrong cost?**
 * Read in strokes off the lattice the optimizer already built, walking the
 * shot-frame lateral axis out from the optimal aim. A situation ships if it
 * holds a decision OR a consequence; a situation with neither is a reflex.
 *
 * Everything here comes out of a grid that has already been computed. No
 * extra `evaluateAim` call, so it is free at both mining and serving time.
 */

import { dist } from '@/lib/engine/projection';
import type { EvalGrid, FeatureKind, Pt } from '@/lib/engine/types';

/**
 * How far off line to look. Beyond this the player is not missing, they are
 * playing a different shot — and 36 yards is already about three standard
 * deviations of lateral dispersion for a mid-handicap iron.
 */
export const CONSEQUENCE_REACH_YDS = 36;

/** Sample step along the lateral walk. */
const STEP_YDS = 3;

/**
 * The trouble a situation is about. Below this the culprit is noise —
 * a bunker that catches 4% of a pattern is not the story of the hole.
 */
export const CULPRIT_MIN_SHARE = 0.08;

/**
 * How one-sided a situation must be to be worth asking about.
 *
 * Raw consequence is the wrong bar and the measurement says so: at a bar of
 * 0.60, 32 of 36 shipped puzzles qualify, because almost any green punishes
 * a 36-yard miss somewhere. county-down-7 scores consequence 0.922 with an
 * asymmetry of 0.052 — both sides equally dead, so there is nothing to
 * choose and nothing to teach.
 *
 * ASYMMETRY is the teachable quantity: one side costs this much more than
 * the other, so "which way do you miss?" has an answer. At 0.60 strokes,
 * 13 of the shipped 36 qualify — including the island green at Sawgrass 17,
 * which trapSize alone rates 1000.
 */
export const CONSEQUENCE_ASYMMETRY = 0.6;

export interface Legibility {
  /**
   * Strokes lost by the worst miss within CONSEQUENCE_REACH_YDS of the
   * optimal, on the worse side. This is the "you must not miss here"
   * number.
   */
  consequence: number;
  /** Which side that is, from the player's point of view. */
  consequenceSide: 'left' | 'right';
  /** Strokes lost by the same-sized miss to the *safe* side. */
  safeSideCost: number;
  /**
   * Is the situation one-sided enough to be worth asking "which way do you
   * miss?" — the difference between the two sides, in strokes.
   */
  asymmetry: number;
  /**
   * The feature the reference line feeds that the optimal line does not,
   * and by how much of the pattern. This is what the reveal should draw.
   */
  culprit: { kind: FeatureKind; name?: string; shareSwing: number } | null;
}

/** Bilinear read of the lattice; NaN outside the searched sector. */
function sampleGrid(grid: EvalGrid, p: Pt): number {
  const fx = (p.x - grid.origin.x) / grid.cellSize;
  const fy = (p.y - grid.origin.y) / grid.cellSize;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= grid.width || y0 + 1 >= grid.height) return NaN;
  const tx = fx - x0;
  const ty = fy - y0;
  const v = (cx: number, cy: number) => grid.values[cy * grid.width + cx]!;
  const v00 = v(x0, y0);
  const v10 = v(x0 + 1, y0);
  const v01 = v(x0, y0 + 1);
  const v11 = v(x0 + 1, y0 + 1);
  if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)) {
    return NaN;
  }
  return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty;
}

/**
 * Worst expected-strokes penalty found walking `sign` laterally away from
 * the optimal aim. Stops at the edge of the searched sector rather than
 * treating a missing cell as free — a walk that leaves the lattice reports
 * what it found before it left.
 */
function walk(grid: EvalGrid, ball: Pt, sign: 1 | -1, reach: number): number {
  const o = grid.optimal.point;
  const d = Math.max(1e-6, dist(ball, o));
  const ux = (o.x - ball.x) / d;
  const uy = (o.y - ball.y) / d;
  // Right-hand perpendicular, matching dispersion.ts's shot frame.
  const px = uy * sign;
  const py = -ux * sign;

  let worst = 0;
  for (let t = STEP_YDS; t <= reach; t += STEP_YDS) {
    const e = sampleGrid(grid, { x: o.x + px * t, y: o.y + py * t });
    if (!Number.isFinite(e)) break;
    worst = Math.max(worst, e - grid.optimal.expectedStrokes);
  }
  return worst;
}

export function legibility(grid: EvalGrid, ball: Pt): Legibility {
  const right = walk(grid, ball, 1, CONSEQUENCE_REACH_YDS);
  const left = walk(grid, ball, -1, CONSEQUENCE_REACH_YDS);
  const consequence = Math.max(left, right);
  const safeSideCost = Math.min(left, right);

  // Which feature does the obvious line feed that the good line avoids?
  // featureHits are already collected on both aims for the explanation
  // generator, so this is a subtraction rather than a computation.
  const optimalShare = new Map<number, number>();
  for (const h of grid.optimal.result.outcomeStats.featureHits ?? []) {
    optimalShare.set(h.id, h.fraction);
  }
  let culprit: Legibility['culprit'] = null;
  for (const h of grid.naive.result.outcomeStats.featureHits ?? []) {
    if (h.kind === 'fairway' || h.kind === 'green') continue;
    const swing = h.fraction - (optimalShare.get(h.id) ?? 0);
    if (swing < CULPRIT_MIN_SHARE) continue;
    if (!culprit || swing > culprit.shareSwing) {
      culprit = { kind: h.kind, ...(h.name ? { name: h.name } : {}), shareSwing: swing };
    }
  }

  return {
    consequence,
    consequenceSide: right >= left ? 'right' : 'left',
    safeSideCost,
    asymmetry: Math.abs(right - left),
    culprit,
  };
}


/**
 * Is this situation worth a player's turn?
 *
 * Two ways to earn it. Either the obvious aim is wrong by enough to survive
 * the error bar — a decision — or one side of the miss is much more
 * expensive than the other, so there is a real answer to "which way do you
 * miss?" even though the aim itself is uncontroversial.
 *
 * The second kind is not yet *scored* — the aim question still awards
 * PERFECT for aiming at the flag, because on those situations the flag
 * genuinely is the best aim. What the second axis buys today is that the
 * caddie note can name the cost instead of congratulating a reflex, and
 * that the miner does not throw the island green away. Scoring the miss
 * itself is Wave 5.
 */
export function holdsSomething(
  trapSize: number,
  trapSe: number,
  asymmetry: number,
  clearsDecision: (t: number, se: number) => boolean,
): { ships: boolean; because: 'decision' | 'consequence' | null } {
  if (clearsDecision(trapSize, trapSe)) return { ships: true, because: 'decision' };
  if (asymmetry >= CONSEQUENCE_ASYMMETRY) return { ships: true, because: 'consequence' };
  return { ships: false, because: null };
}
