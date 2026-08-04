/**
 * The counterfactual ladder.
 *
 * Every probe is measured from the PLAYER'S OWN AIM, never from the
 * optimal. That is the difference between "the engine's argmin is over
 * there" and "move twelve yards left" — only the second is something a
 * player can execute, and only the second stays honest when the player's
 * aim scores at or better than the cached optimal.
 */

import { dist } from '@/lib/engine/projection';
import type { EvalResult, Pt } from '@/lib/engine/types';
import type { Probe } from './types';

/** Lateral offsets tried, yards. Half of GRID_SPACING upward. */
export const LADDER_LAT = [-24, -18, -12, -6, 6, 12, 18, 24];
/** Longitudinal offsets tried, yards. */
export const LADDER_LONG = [-18, -12, -6, 6, 12];

export interface LadderContext {
  ball: Pt;
  pin: Pt;
  playerAim: Pt;
  maxCarry: number;
  evaluate: (aim: Pt) => EvalResult;
}

/** Run the ladder around the player's aim in the shot frame. */
export function runProbes(ctx: LadderContext): Probe[] {
  const dx = ctx.pin.x - ctx.ball.x;
  const dy = ctx.pin.y - ctx.ball.y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  // Right-hand perpendicular in the shot frame.
  const px = uy;
  const py = -ux;

  const out: Probe[] = [];
  const push = (lat: number, long: number) => {
    const aim: Pt = {
      x: ctx.playerAim.x + px * lat + ux * long,
      y: ctx.playerAim.y + py * lat + uy * long,
    };
    // A probe past max carry is not a shot the player can hit.
    if (dist(ctx.ball, aim) > ctx.maxCarry * 1.02) return;
    const result = ctx.evaluate(aim);
    out.push({ aim, lat, long, result, e: result.expectedStrokes });
  };

  for (const lat of LADDER_LAT) push(lat, 0);
  for (const long of LADDER_LONG) push(0, long);
  return out;
}

/**
 * Choose the correction to recommend: the SMALLEST offset whose result
 * would score Good or better, not merely the biggest improvement. A note
 * that says "move 24 yards" when 6 would do teaches over-correction.
 */
export function chooseCorrection(
  probes: Probe[],
  playerE: number,
  optimalE: number,
  goodThreshold = 0.1,
): Probe | null {
  const reaching = probes.filter((p) => p.e - optimalE <= goodThreshold && p.e < playerE);
  const pool = reaching.length
    ? reaching
    : probes.filter((p) => p.e <= playerE - 0.05);
  if (pool.length === 0) return null;
  return [...pool].sort(
    (a, b) =>
      Math.hypot(a.lat, a.long) - Math.hypot(b.lat, b.long) ||
      a.e - b.e ||
      a.lat - b.lat,
  )[0]!;
}
