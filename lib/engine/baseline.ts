/**
 * Broadie-style expected-strokes baseline: strokes to hole out by distance
 * and lie, seeded from anchor tables and linearly interpolated. Beyond the
 * table edges we extrapolate with the nearest segment's slope. A handicap
 * multiplier of (1 + 0.011 × handicap) applies to all values, putts
 * included.
 */

import {
  BASELINE_DISTANCES,
  BASELINE_FLOOR,
  BASELINE_TABLE,
  HANDICAP_MULTIPLIER_PER_STROKE,
  PUTT_MAX,
  PUTT_TABLE,
} from './constants';
import type { LandingLie } from './types';

export type BaselineLie = keyof typeof BASELINE_TABLE;

function handicapMultiplier(handicap: number): number {
  return 1 + HANDICAP_MULTIPLIER_PER_STROKE * handicap;
}

/** Piecewise-linear over (x, y) anchors with edge-slope extrapolation. */
function interpolate(anchors: [number, number][], x: number): number {
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (anchors.length === 1) return first[1];
  if (x <= first[0]) {
    const [x1, y1] = anchors[1]!;
    const slope = (y1 - first[1]) / (x1 - first[0]);
    return first[1] + (x - first[0]) * slope;
  }
  if (x >= last[0]) {
    const [x0, y0] = anchors[anchors.length - 2]!;
    const slope = (last[1] - y0) / (last[0] - x0);
    return last[1] + (x - last[0]) * slope;
  }
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i]!;
    if (x <= x1) {
      const [x0, y0] = anchors[i - 1]!;
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}

const ANCHORS_BY_LIE: Record<BaselineLie, [number, number][]> = (() => {
  const out = {} as Record<BaselineLie, [number, number][]>;
  for (const lie of Object.keys(BASELINE_TABLE) as BaselineLie[]) {
    const anchors: [number, number][] = [];
    BASELINE_TABLE[lie].forEach((value, i) => {
      if (value !== null) anchors.push([BASELINE_DISTANCES[i]!, value]);
    });
    out[lie] = anchors;
  }
  return out;
})();

/** Expected strokes to hole out from an off-green lie, in yards. */
export function baselineStrokes(
  distanceYds: number,
  lie: BaselineLie,
  handicap: number,
): number {
  const raw = interpolate(ANCHORS_BY_LIE[lie], distanceYds) * handicapMultiplier(handicap);
  return Math.max(BASELINE_FLOOR, raw);
}

/** Expected putts from a green lie. Distance in YARDS (converted to feet). */
export function expectedPutts(distanceYds: number, handicap: number): number {
  const feet = distanceYds * 3;
  const raw = interpolate(PUTT_TABLE, feet) * handicapMultiplier(handicap);
  return Math.min(PUTT_MAX, Math.max(1, raw));
}

/** Expected strokes to hole out from any landing lie except water/OB. */
export function strokesToHoleOut(
  distanceYds: number,
  lie: Exclude<LandingLie, 'water' | 'ob'>,
  handicap: number,
): number {
  if (lie === 'green') return expectedPutts(distanceYds, handicap);
  return baselineStrokes(distanceYds, lie, handicap);
}
