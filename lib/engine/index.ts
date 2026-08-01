/**
 * SG Trainer strokes-gained engine — public API.
 * Pure TypeScript, no framework dependencies; safe in a web worker or on
 * the server. All tunables live in ./constants.
 */

export * from './types';
export * from './constants';
export { createRng, createNormalPairs } from './rng';
export { createProjection, dist, YARDS_PER_DEG_LAT } from './projection';
export type { Projection } from './projection';
export { clubTable, allowedClubs, selectClub, maxCarry } from './clubs';
export type { ClubSelection } from './clubs';
export { dispersionParams, lateralSigmaFraction, sampleLandings } from './dispersion';
export type { DispersionParams } from './dispersion';
export { baselineStrokes, expectedPutts, strokesToHoleOut } from './baseline';
export type { BaselineLie } from './baseline';
export { prepareHole, classifyPoint, classifyPointDetailed, waterDropPoint } from './hole';
export type { ClassifiedPoint } from './hole';
export { evaluateAim } from './evaluate';
export type { Situation, EvalOptions } from './evaluate';
export { evaluateGrid, fairwayCenterAim } from './optimize';
export type { GridOptions } from './optimize';
export { scoreBand, eloExpectedScore, eloDeltas, puzzleRatingFromTrap } from './scoring';
export { profileBucket, SEED_PROFILE } from './profile';
export { holeFromYardSpec, circleRing } from './holes/build';
export type { YardHoleSpec } from './holes/build';
