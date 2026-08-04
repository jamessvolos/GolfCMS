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
import { dispersionParams, sampleLandings } from './dispersion';
import { classifyPointDetailed, waterDropPoint } from './hole';
import { dist } from './projection';
import { createNormalPairs } from './rng';
import type {
  EvalResult,
  FeatureHit,
  FeatureKind,
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
  /**
   * Collect the explanation statistics (per-polygon hits, in-play and
   * on-green distances). Default true; the grid lattice passes false so
   * thousands of candidate evaluations stay lean.
   */
  stats?: boolean;
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

  // Effective aim: the requested aim clamped to max carry along the aim line.
  const effAim: Pt = {
    x: ball.x + ((aim.x - ball.x) / requested) * effectiveDistance,
    y: ball.y + ((aim.y - ball.y) / requested) * effectiveDistance,
  };

  const params = dispersionParams(profile, lie, effectiveDistance);
  const normals =
    opts.normals ?? createNormalPairs(opts.seed ?? DEFAULT_SEED, opts.nSamples ?? MC_SAMPLES);
  const n = normals.length >> 1;
  // One shared transform (dispersion.ts) so the tested rotation/shape-bias
  // geometry is exactly what runs here.
  const landings = sampleLandings(ball, effAim, params, normals);

  // OB cost is identical for every sample; compute once, lazily.
  let obCost: number | null = null;

  const counts: Partial<Record<LandingLie, number>> = {};
  let totalCost = 0;
  let totalPinDist = 0;

  // Explanation accumulators, filled in the same pass as the costing.
  const stats = opts.stats !== false;
  const hits = new Map<number, { kind: FeatureKind; name?: string; n: number; sx: number; sy: number }>();
  let inPlayN = 0;
  let inPlaySum = 0;
  let greenN = 0;
  let greenSum = 0;

  for (let i = 0; i < n; i++) {
    const landing = landings[i]!;
    const { lie: landingLie, polygon } = classifyPointDetailed(prepared, landing);
    counts[landingLie] = (counts[landingLie] ?? 0) + 1;
    const pinDist = dist(landing, pin);
    totalPinDist += pinDist;

    if (stats) {
      if (polygon) {
        let h = hits.get(polygon.id);
        if (!h) {
          h = { kind: polygon.kind, name: polygon.name, n: 0, sx: 0, sy: 0 };
          hits.set(polygon.id, h);
        }
        h.n += 1;
        h.sx += landing.x;
        h.sy += landing.y;
      }
      if (landingLie !== 'water' && landingLie !== 'ob') {
        inPlayN += 1;
        inPlaySum += pinDist;
        if (landingLie === 'green') {
          greenN += 1;
          greenSum += pinDist;
        }
      }
    }

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

  const featureHits: FeatureHit[] = stats
    ? [...hits.entries()]
        .map(([id, h]) => ({
          id,
          kind: h.kind,
          ...(h.name ? { name: h.name } : {}),
          n: h.n,
          fraction: h.n / n,
          locus: { x: h.sx / h.n, y: h.sy / h.n },
        }))
        .sort((a, b) => b.n - a.n)
    : [];

  return {
    expectedStrokes: totalCost / n,
    outcomeStats: {
      lieBreakdown,
      meanDistanceToPin: totalPinDist / n,
      club,
      aimDistance: effectiveDistance,
      clamped,
      nSamples: n,
      ...(stats
        ? {
            featureHits,
            inPlay: {
              fraction: inPlayN / n,
              meanDistanceToPin: inPlayN ? inPlaySum / inPlayN : 0,
            },
            onGreen: {
              fraction: greenN / n,
              meanDistanceToPin: greenN ? greenSum / greenN : 0,
            },
            effAim,
          }
        : {}),
    },
  };
}
