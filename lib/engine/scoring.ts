/**
 * Scoring bands, Elo, and puzzle-rating seeds.
 * All scoring flows through strokes-gained space — never raw distance.
 */

import {
  DECISION_TRAP,
  ELO_K_PLAYER,
  ELO_K_PUZZLE,
  MISS_ELO_SCORE,
  PUZZLE_RATING_BASE,
  PUZZLE_RATING_SPAN,
  PUZZLE_RATING_HALF_TRAP,
  SCORE_BANDS,
  TRAP_SE_MARGIN,
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

/**
 * Seed a puzzle's rating from its trap size: subtle traps = hard puzzles.
 *
 * The curve's floor is DECISION_TRAP, not zero. Anchored at zero it spent
 * its first three hundred points distinguishing two puzzles that both have
 * no decision in them — the shipped library had three at exactly trap 0.000
 * sharing the base rating with everything else that rounded to nothing.
 * Anchored here, rating 1000 means "exactly at the threshold of being worth
 * asking", and anything below it is not served at all.
 */
export function puzzleRatingFromTrap(trapSize: number): number {
  const over = Math.max(0, trapSize - DECISION_TRAP);
  // Saturating but never saturated: strictly increasing for every trap, so
  // two puzzles of different difficulty never share a rating.
  const t = over / (over + PUZZLE_RATING_HALF_TRAP);
  return Math.round(PUZZLE_RATING_BASE + PUZZLE_RATING_SPAN * t);
}

/**
 * Is this situation worth serving? The gate is on the trap size minus its
 * error bar, so a puzzle admitted at the threshold is one whose decision
 * survives the Monte Carlo noise rather than one that got a lucky draw.
 */
export function clearsDecisionThreshold(trapSize: number, trapSe: number): boolean {
  return trapSize - TRAP_SE_MARGIN * trapSe >= DECISION_TRAP;
}

/**
 * The rating's error bar, in rating points. A trap size is a Monte Carlo
 * estimate and the rating curve is non-linear, so the interval is not
 * symmetric — this reports the half-width of the wider side, which is the
 * honest number to show a player next to a difficulty.
 */
export function ratingUncertainty(trapSize: number, trapSe: number): number {
  const mid = puzzleRatingFromTrap(trapSize);
  const hi = puzzleRatingFromTrap(trapSize + TRAP_SE_MARGIN * trapSe);
  const lo = puzzleRatingFromTrap(Math.max(0, trapSize - TRAP_SE_MARGIN * trapSe));
  return Math.round(Math.max(hi - mid, mid - lo));
}
