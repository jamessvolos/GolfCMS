/**
 * The shared die.
 *
 * A puzzle scores one aim and stops. A round is the same engine asked nine
 * times, with the ball carried between questions — and the moment you carry
 * the ball you have to answer an objection: *the caddie got lucky.*
 *
 * So the caddie does not get their own luck. Both lines are flown on the
 * IDENTICAL standard-normal pair, drawn once per shot from the card's seed.
 * If the player's ball finds a bunker on a draw the caddie's line would have
 * survived, that is the line, not the dice. The margin between the two cards
 * is decision quality with the luck excuse removed by construction — which
 * is the same common-random-numbers argument the optimizer already uses to
 * keep its expected-strokes surface smooth, applied to a scoreboard.
 *
 * It is also the only honest way to show someone that course management is
 * worth strokes. Told "you lost 0.4 expected strokes" a golfer shrugs. Shown
 * "played from the same lies with the same bounces, the caddie is three
 * ahead after three holes", they do not.
 */

import { selectClub } from '@/lib/engine/clubs';
import { dispersionParams, sampleLandings } from '@/lib/engine/dispersion';
import { classifyPointDetailed, waterDropPoint } from '@/lib/engine/hole';
import { dist } from '@/lib/engine/projection';
import { createNormalPairs } from '@/lib/engine/rng';
import { WATER_PENALTY } from '@/lib/engine/constants';
import type {
  LandingLie,
  PlayableLie,
  PlayerProfile,
  PreparedHole,
  Pt,
} from '@/lib/engine/types';

export interface Roll {
  /** Where the ball finished. */
  at: Pt;
  lie: LandingLie;
  /** Penalty strokes incurred getting there (water, OB). */
  penalty: number;
  /** Where play resumes — the drop point when the ball is lost. */
  resumeAt: Pt;
  resumeLie: PlayableLie;
  /** True when the ball finished on the green. */
  holed: boolean;
}

/**
 * Fly one shot. `z` is the standard-normal pair both cards share, so two
 * aims from the same lie differ only in where they were pointed.
 */
export function flyShot(
  prepared: PreparedHole,
  ball: Pt,
  lie: PlayableLie,
  aim: Pt,
  profile: PlayerProfile,
  z: Float64Array,
): Roll {
  const want = Math.max(0.5, dist(ball, aim));
  const { effectiveDistance } = selectClub(profile, lie, want);
  const effAim: Pt = {
    x: ball.x + ((aim.x - ball.x) / want) * effectiveDistance,
    y: ball.y + ((aim.y - ball.y) / want) * effectiveDistance,
  };
  const landing = sampleLandings(
    ball,
    effAim,
    dispersionParams(profile, lie, effectiveDistance),
    z,
  )[0]!;

  const { lie: landed, polygon } = classifyPointDetailed(prepared, landing);

  if (landed === 'water') {
    // The engine's documented simplification: penalty, then play as rough
    // from where the ball entered the hazard, offset back toward the ball.
    const drop = waterDropPoint(ball, landing, polygon!);
    return {
      at: landing,
      lie: 'water',
      penalty: WATER_PENALTY,
      resumeAt: drop,
      resumeLie: 'rough',
      holed: false,
    };
  }
  if (landed === 'ob') {
    // Stroke and distance: replay from where the shot was struck.
    return { at: landing, lie: 'ob', penalty: 1, resumeAt: ball, resumeLie: lie, holed: false };
  }
  return {
    at: landing,
    lie: landed,
    penalty: 0,
    resumeAt: landing,
    resumeLie: landed === 'green' ? 'fairway' : landed,
    holed: landed === 'green',
  };
}

/**
 * The pair of normals for shot `index` of a card. Derived from the card
 * seed alone, so both players see the same weather and a card replays
 * identically in another process.
 */
export function shotDice(cardSeed: number, index: number): Float64Array {
  // Mix the index into the seed rather than consuming a stream, so shot 4
  // is the same draw whether or not shots 1-3 needed a re-roll.
  return createNormalPairs((cardSeed * 2654435761 + index * 40503) >>> 0, 1);
}
