/**
 * Profile helpers. The heatmap cache is keyed per (puzzle, profile bucket):
 * handicap rounded to 5s, club speed to 10s, plus shot shape.
 */

import { BUCKET_HANDICAP_STEP, BUCKET_SPEED_STEP } from './constants';
import type { PlayerProfile } from './types';

export function profileBucket(profile: PlayerProfile): string {
  const b = bucketedProfile(profile);
  return `h${b.handicap}-s${b.clubSpeedMph}-${b.shotShape}`;
}

/**
 * The profile actually used for evaluation. Cached grids are computed per
 * bucket, so the player's aim MUST be scored with the same bucketed profile
 * or sgLoss would compare expectations from two different players.
 */
export function bucketedProfile(profile: PlayerProfile): PlayerProfile {
  return {
    handicap: Math.round(profile.handicap / BUCKET_HANDICAP_STEP) * BUCKET_HANDICAP_STEP,
    clubSpeedMph: Math.round(profile.clubSpeedMph / BUCKET_SPEED_STEP) * BUCKET_SPEED_STEP,
    shotShape: profile.shotShape,
  };
}

/** The default seed profile used in tests and the demo CLI. */
export const SEED_PROFILE: PlayerProfile = {
  handicap: 14,
  clubSpeedMph: 110,
  shotShape: 'draw',
};
