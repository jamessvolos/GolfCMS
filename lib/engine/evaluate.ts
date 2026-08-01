/**
 * Monte Carlo evaluation of a single aim point:
 * expected strokes = 1 (the shot) + mean cost of holing out from where the
 * dispersion says the ball finishes.
 *
 * Documented simplifications (see lib/engine/README.md):
 *  - Water: +1 penalty, drop at the hazard entry point offset back toward
 *    the ball, played as rough.
 *  - OB: stroke and distance without recursion —
 *    cost = 2 + baseline(original distance to pin, original lie).
 *  - Carry = total (no roll-out); putts are distance-only.
 */

import { baselineStrokes, strokesToHoleOut } from './baseline';
import { selectClub } from './clubs';
import { DEFAULT_SEED, MC_SAMPLES, WATER_PENALTY } from './constants';
import { dispersionParams } from './dispersion';
import { classifyPointDetailed, waterDropPoint } from './hole';
import { dist } from './projection';
import { createNormalPairs } from './rng';
import type {
  EvalResult,
  LandingLie,
  PlayableLie,
  PlayerProfile,
  PreparedHole,
  Pt,
} from './types';

export interface Situation {
  ball: Pt;
  lie: PlayableLie;
  /** Puzzle pin — may differ from the hole's default pin feature. */
  pin: Pt;
}

export interface EvalOptions {
  nSamples?: number;
  seed?: number;
  /** Pre-generated normal pairs for common random numbers across aims. */
  normals?: Float64Array;
}

export function evaluateAim(
  prepared: PreparedHole,
  sit: Situation,
  profile: PlayerProfile,
  aim: Pt,
  opts: EvalOptions = {},
): EvalResult {
  const { ball, lie, pin } = sit;
  const requested = Math.max(0.5, dist(ball, aim));
  const { club, effectiveDistance, clamped } = selectClub(profile, lie, requested);

  const ux = (aim.x - ball.x) / requested;
  const uy = (aim.y - ball.y) / requested;
  // Right-hand perpendicular to the aim line.
  const px = uy;
  const py = -ux;

  const params = dispersionParams(profile, lie, effectiveDistance);
  const normals =
    opts.normals ?? createNormalPairs(opts.seed ?? DEFAULT_SEED, opts.nSamples ?? MC_SAMPLES);
  const n = normals.length >> 1;

  // OB cost is identical for every sample; compute once, lazily.
  let obCost: number | null = null;

  const counts: Partial<Record<LandingLie, number>> = {};
  let totalCost = 0;
  let totalPinDist = 0;

  for (let i = 0; i < n; i++) {
    const along = effectiveDistance + normals[2 * i]! * params.sigmaLong;
    const across = params.meanLat + normals[2 * i + 1]! * params.sigmaLat;
    const landing: Pt = {
      x: ball.x + ux * along + px * across,
      y: ball.y + uy * along + py * across,
    };

    const { lie: landingLie, polygon } = classifyPointDetailed(prepared, landing);
    counts[landingLie] = (counts[landingLie] ?? 0) + 1;
    const pinDist = dist(landing, pin);
    totalPinDist += pinDist;

    let cost: number;
    if (landingLie === 'ob') {
      if (obCost === null) {
        obCost = 2 + baselineStrokes(dist(ball, pin), lie, profile.handicap);
      }
      cost = obCost;
    } else if (landingLie === 'water') {
      const drop = waterDropPoint(ball, landing, polygon!);
      cost =
        1 + WATER_PENALTY + baselineStrokes(dist(drop, pin), 'rough', profile.handicap);
    } else {
      cost = 1 + strokesToHoleOut(pinDist, landingLie, profile.handicap);
    }
    totalCost += cost;
  }

  const lieBreakdown: Partial<Record<LandingLie, number>> = {};
  for (const [k, v] of Object.entries(counts)) {
    lieBreakdown[k as LandingLie] = v / n;
  }

  return {
    expectedStrokes: totalCost / n,
    outcomeStats: {
      lieBreakdown,
      meanDistanceToPin: totalPinDist / n,
      club,
      aimDistance: effectiveDistance,
      clamped,
      nSamples: n,
    },
  };
}
