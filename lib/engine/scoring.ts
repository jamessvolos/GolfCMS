/**
 * Scoring bands, Elo, and puzzle-rating seeds.
 * All scoring flows through strokes-gained space — never raw distance.
 */

import {
  ELO_K_PLAYER,
  ELO_K_PUZZLE,
  MISS_ELO_SCORE,
  PUZZLE_RATING_BASE,
  PUZZLE_RATING_SPAN,
  PUZZLE_RATING_HALF_TRAP,
  SCORE_BANDS,
} from './constants';
import type { ScoreBandResult } from './types';

export function scoreBand(sgLoss: number): ScoreBandResult {
  for (const { maxSgLoss, band, eloScore } of SCORE_BANDS) {
    if (sgLoss <= maxSgLoss) return { band, eloScore };
  }
  return { band: 'miss', eloScore: MISS_ELO_SCORE };
}

/** Standard Elo expectation of the player against a puzzle. */
export function eloExpectedScore(playerRating: number, puzzleRating: number): number {
  return 1 / (1 + 10 ** ((puzzleRating - playerRating) / 400));
}

/** Rating deltas for one attempt. Puzzle ratings drift toward difficulty. */
export function eloDeltas(
  playerRating: number,
  puzzleRating: number,
  eloScore: number,
): { player: number; puzzle: number } {
  const expected = eloExpectedScore(playerRating, puzzleRating);
  return {
    player: Math.round(ELO_K_PLAYER * (eloScore - expected)),
    puzzle: Math.round(ELO_K_PUZZLE * (expected - eloScore)),
  };
}

/** Seed a puzzle's rating from its trap size: subtle traps = hard puzzles. */
export function puzzleRatingFromTrap(trapSize: number): number {
  const trap = Math.max(0, trapSize);
  // Saturating but never saturated: strictly increasing for every trap, so
  // two puzzles of different difficulty never share a rating.
  const t = trap / (trap + PUZZLE_RATING_HALF_TRAP);
  return Math.round(PUZZLE_RATING_BASE + PUZZLE_RATING_SPAN * t);
}
