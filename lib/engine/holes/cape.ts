/**
 * "The Cape" — the hardcoded Milestone 1 hole, hand-authored in yard space.
 *
 * Par 4, 401 yards, tee at the origin, green up and to the right. A lake
 * guards the entire right side; its shoreline slants toward the fairway as
 * the drive gets longer, so the direct line at the pin flirts with water.
 * Bailing left runs into a pair of fairway bunkers, a tree line, and OB at
 * the property fence. The reward for hugging the water is a much shorter
 * approach to a pin cut on the water side of the green.
 *
 * This makes the optimal tee shot dispersion-dependent: tighter players can
 * aim closer to the shoreline; wider dispersions must bail left and accept
 * the longer approach — exactly the behavior Milestone 1 must demonstrate.
 */

import { holeFromYardSpec, circleRing } from './build';
import type { YardHoleSpec } from './build';
import type { HoleData, PlayableLie, Pt, PuzzleCategory } from '../types';

export const CAPE_ORIGIN = { lon: -93.335, lat: 41.02 };

const SPEC: YardHoleSpec = {
  id: 'cape-01',
  courseName: 'Folio National',
  holeNumber: 1,
  par: 4,
  yardage: 401,
  origin: CAPE_ORIGIN,
  polygons: [
    {
      kind: 'fairway',
      ring: [
        [-55, 150],
        [42, 150],
        [24, 300],
        [34, 338],
        [18, 355],
        [-55, 355],
      ],
    },
    {
      kind: 'water',
      name: 'lake',
      ring: [
        [44, 140],
        [26, 300],
        [36, 338],
        [60, 356],
        [60, 440],
        [230, 440],
        [230, 140],
      ],
    },
    { kind: 'green', ring: circleRing(46, 398, 12) },
    { kind: 'bunker', name: 'front-right', ring: circleRing(54, 376, 6) },
    { kind: 'bunker', name: 'left-near', ring: circleRing(-45, 258, 8) },
    { kind: 'bunker', name: 'left-far', ring: circleRing(-36, 290, 7) },
    {
      kind: 'recovery',
      name: 'tree line',
      ring: [
        [-95, 140],
        [-58, 140],
        [-58, 430],
        [-95, 430],
      ],
    },
    {
      kind: 'ob',
      name: 'property fence',
      ring: [
        [-200, 100],
        [-95, 100],
        [-95, 450],
        [-200, 450],
      ],
    },
  ],
  pin: [50, 398],
  tees: [[0, 0]],
};

export function capeHole(): HoleData {
  return holeFromYardSpec(SPEC);
}

export interface YardPuzzle {
  id: string;
  ball: Pt;
  lie: PlayableLie;
  category: PuzzleCategory;
  description: string;
}

/** Tee shot: how much of the lake do you bite off? */
export const CAPE_TEE: YardPuzzle = {
  id: 'cape-01-tee',
  ball: { x: 0, y: 0 },
  lie: 'tee',
  category: 'tee',
  description: 'Tee shot, 401y par 4, water right, bunkers and OB left',
};

/** Approach from the fairway: pin sits on the water side of the green. */
export const CAPE_APPROACH: YardPuzzle = {
  id: 'cape-01-approach',
  ball: { x: -8, y: 252 },
  lie: 'fairway',
  category: 'approach',
  description: 'Approach from 157y, pin cut toward the lake',
};

export const CAPE_PUZZLES: YardPuzzle[] = [CAPE_TEE, CAPE_APPROACH];
