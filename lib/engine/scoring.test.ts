import { describe, expect, it } from 'vitest';
import {
  eloDeltas,
  eloExpectedScore,
  puzzleRatingFromTrap,
  scoreBand,
} from './scoring';
import { profileBucket } from './profile';

describe('scoreBand', () => {
  it('maps sgLoss to bands at the documented thresholds', () => {
    expect(scoreBand(0).band).toBe('perfect');
    expect(scoreBand(0.03).band).toBe('perfect');
    expect(scoreBand(0.031).band).toBe('good');
    expect(scoreBand(0.1).band).toBe('good');
    expect(scoreBand(0.101).band).toBe('okay');
    expect(scoreBand(0.25).band).toBe('okay');
    expect(scoreBand(0.26).band).toBe('miss');
    expect(scoreBand(1.4).band).toBe('miss');
  });

  it('treats tiny negative losses (MC noise) as perfect', () => {
    expect(scoreBand(-0.01).band).toBe('perfect');
  });

  it('carries the Elo score for each band', () => {
    expect(scoreBand(0.01).eloScore).toBe(1);
    expect(scoreBand(0.06).eloScore).toBe(0.5);
    expect(scoreBand(0.2).eloScore).toBe(0.25);
    expect(scoreBand(0.9).eloScore).toBe(0);
  });
});

describe('elo', () => {
  it('expects 0.5 against an equal-rated puzzle', () => {
    expect(eloExpectedScore(1200, 1200)).toBeCloseTo(0.5, 9);
  });

  it('matches the standard formula against a stronger puzzle', () => {
    // 1 / (1 + 10^((1400-1200)/400))
    expect(eloExpectedScore(1200, 1400)).toBeCloseTo(0.2402530733, 6);
  });

  it('applies K=24 to the player and K=16 to the puzzle', () => {
    const d = eloDeltas(1200, 1400, 1);
    expect(d.player).toBe(18); // round(24 * (1 - 0.24025))
    expect(d.puzzle).toBe(-12); // round(16 * (0.24025 - 1))
    const miss = eloDeltas(1200, 1200, 0);
    expect(miss.player).toBe(-12);
    expect(miss.puzzle).toBe(8);
  });
});

describe('puzzleRatingFromTrap', () => {
  it('anchors a decisionless puzzle at the base rating', () => {
    expect(puzzleRatingFromTrap(0)).toBe(1000);
    // Trap size cannot be negative, but a caller must not be able to push a
    // rating below the floor if one ever arrives.
    expect(puzzleRatingFromTrap(-0.2)).toBe(1000);
  });

  it('keeps resolution where most of the library lives', () => {
    // The shipped library's median trap is ~0.05 and its bulk sits under
    // 0.20; those must not all land on the same rating.
    expect(puzzleRatingFromTrap(0.05)).toBe(1188);
    expect(puzzleRatingFromTrap(0.1)).toBe(1333);
    expect(puzzleRatingFromTrap(0.2)).toBe(1545);
  });

  it('never saturates, so difficulty always orders', () => {
    // The defect this replaced: trap 0.88 and 1.19 both rated exactly 2500,
    // making the hardest hole in the library indistinguishable from one a
    // third easier. Every step must be strictly increasing.
    const traps = [0.5, 0.88, 0.94, 1.19, 2, 5, 50];
    const ratings = traps.map(puzzleRatingFromTrap);
    for (let i = 1; i < ratings.length; i++) {
      expect(ratings[i]!).toBeGreaterThan(ratings[i - 1]!);
    }
    // And it approaches the ceiling without ever reaching it.
    expect(ratings[ratings.length - 1]!).toBeLessThan(2500);
  });
});

describe('profileBucket', () => {
  it('rounds handicap to 5s and speed to 10s', () => {
    expect(profileBucket({ handicap: 14, clubSpeedMph: 107, shotShape: 'draw' })).toBe(
      'h15-s110-draw',
    );
    expect(profileBucket({ handicap: 12, clubSpeedMph: 104, shotShape: 'fade' })).toBe(
      'h10-s100-fade',
    );
    expect(profileBucket({ handicap: 0, clubSpeedMph: 95, shotShape: 'straight' })).toBe(
      'h0-s100-straight',
    );
  });
});
