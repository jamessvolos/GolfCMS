/**
 * 2D normal dispersion model oriented along the aim line.
 * Longitudinal sigma is a fixed fraction of shot distance; lateral sigma
 * comes from the handicap table. Shot shape shifts the lateral MEAN — the
 * player aims at their pin and the distribution is biased by their curve.
 */

import {
  LATERAL_SIGMA_BY_HANDICAP,
  LATERAL_SIGMA_MAX_FRACTION,
  LIE_SIGMA_MULTIPLIER,
  LONG_SIGMA_FRACTION,
  SHAPE_BIAS_FRACTION,
} from './constants';
import type { PlayableLie, PlayerProfile, Pt } from './types';

export interface DispersionParams {
  sigmaLong: number;
  sigmaLat: number;
  /** Lateral mean offset, + = right of the aim line (RH player). */
  meanLat: number;
}

/** Lateral sigma fraction for a handicap: interpolated, extrapolated, clamped. */
export function lateralSigmaFraction(handicap: number): number {
  const anchors = LATERAL_SIGMA_BY_HANDICAP;
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  if (handicap <= first[0]) return first[1];
  for (let i = 1; i < anchors.length; i++) {
    const [h1, f1] = anchors[i]!;
    const [h0, f0] = anchors[i - 1]!;
    if (handicap <= h1) {
      return f0 + ((handicap - h0) / (h1 - h0)) * (f1 - f0);
    }
  }
  const [h0, f0] = anchors[anchors.length - 2]!;
  const slope = (last[1] - f0) / (last[0] - h0);
  return Math.min(LATERAL_SIGMA_MAX_FRACTION, last[1] + (handicap - last[0]) * slope);
}

export function dispersionParams(
  profile: PlayerProfile,
  lie: PlayableLie,
  shotDistanceYds: number,
): DispersionParams {
  const lieMult = LIE_SIGMA_MULTIPLIER[lie];
  return {
    sigmaLong: LONG_SIGMA_FRACTION * shotDistanceYds * lieMult,
    sigmaLat: lateralSigmaFraction(profile.handicap) * shotDistanceYds * lieMult,
    // The shape bias is a systematic curve, not noise: the lie widens the
    // spread but does not change the curve, so no lie multiplier here.
    meanLat: SHAPE_BIAS_FRACTION[profile.shotShape] * shotDistanceYds,
  };
}

/**
 * Transform standard-normal pairs into landing points around the aim.
 * normals is the [z_long, z_lat, ...] buffer from createNormalPairs; its
 * length determines the sample count.
 */
export function sampleLandings(
  ball: Pt,
  aim: Pt,
  params: DispersionParams,
  normals: Float64Array,
): Pt[] {
  const dx = aim.x - ball.x;
  const dy = aim.y - ball.y;
  const d = Math.hypot(dx, dy);
  const ux = d > 1e-9 ? dx / d : 0;
  const uy = d > 1e-9 ? dy / d : 1;
  // Right-hand perpendicular: heading north (0,1) → right is east (1,0).
  const px = uy;
  const py = -ux;

  const n = normals.length >> 1;
  const out: Pt[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const along = d + normals[2 * i]! * params.sigmaLong;
    const across = params.meanLat + normals[2 * i + 1]! * params.sigmaLat;
    out[i] = {
      x: ball.x + ux * along + px * across,
      y: ball.y + uy * along + py * across,
    };
  }
  return out;
}
