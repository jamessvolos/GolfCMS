/**
 * Club distances derived from the player profile, and auto club selection:
 * the smallest club whose carry reaches the aim point. No manual selection
 * in v1. Below lob-wedge carry the player is assumed to hit a partial wedge
 * flighted exactly to the target.
 */

import { CLUB_GAPPING, DRIVER_CARRY_PER_MPH, LIE_CLUB_CAPS } from './constants';
import type { Club, PlayableLie, PlayerProfile } from './types';

export interface ClubSelection {
  club: Club;
  /** Distance the shot is actually played to (aim clamped to max carry). */
  effectiveDistance: number;
  /** True when the requested distance exceeded the longest allowed club. */
  clamped: boolean;
}

/** Full bag with carries for this player, longest club first. */
export function clubTable(profile: PlayerProfile): Club[] {
  const driverCarry = DRIVER_CARRY_PER_MPH * profile.clubSpeedMph;
  return CLUB_GAPPING.map(({ id, label, fraction }) => ({
    id,
    label,
    carry: driverCarry * fraction,
  }));
}

/** Bag filtered by what the lie allows, longest first. */
export function allowedClubs(profile: PlayerProfile, lie: PlayableLie): Club[] {
  const banned = LIE_CLUB_CAPS[lie];
  return clubTable(profile).filter((c) => !banned.includes(c.id));
}

const EPS = 1e-9;

export function selectClub(
  profile: PlayerProfile,
  lie: PlayableLie,
  distanceYds: number,
): ClubSelection {
  const clubs = allowedClubs(profile, lie);
  const longest = clubs[0]!;
  const shortest = clubs[clubs.length - 1]!;

  if (distanceYds < shortest.carry - EPS) {
    return {
      club: { id: 'WEDGE_PARTIAL', label: 'Partial wedge', carry: distanceYds },
      effectiveDistance: distanceYds,
      clamped: false,
    };
  }

  // Walk from shortest to longest: first club that reaches wins.
  for (let i = clubs.length - 1; i >= 0; i--) {
    const club = clubs[i]!;
    if (club.carry >= distanceYds - EPS) {
      return { club, effectiveDistance: distanceYds, clamped: false };
    }
  }

  return { club: longest, effectiveDistance: longest.carry, clamped: true };
}

/** Longest carry available from this lie — bounds the reachable area. */
export function maxCarry(profile: PlayerProfile, lie: PlayableLie): number {
  return allowedClubs(profile, lie)[0]!.carry;
}
