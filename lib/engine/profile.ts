/**
 * Profile helpers. The heatmap cache is keyed per (puzzle, profile bucket):
 * handicap rounded to 5s, club speed to 10s, plus shot shape.
 */

import { BUCKET_HANDICAP_STEP, BUCKET_SPEED_STEP } from './constants';
import type { PlayerProfile } from './types';

export function profileBucket(profile: PlayerProfile): string {
  const h = Math.round(profile.handicap / BUCKET_HANDICAP_STEP) * BUCKET_HANDICAP_STEP;
  const s = Math.round(profile.clubSpeedMph / BUCKET_SPEED_STEP) * BUCKET_SPEED_STEP;
  return `h${h}-s${s}-${profile.shotShape}`;
}

/** The default seed profile used in tests and the demo CLI. */
export const SEED_PROFILE: PlayerProfile = {
  handicap: 14,
  clubSpeedMph: 110,
  shotShape: 'draw',
};
