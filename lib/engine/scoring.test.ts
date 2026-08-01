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
  it('maps trap size onto the rating range with clamping', () => {
    expect(puzzleRatingFromTrap(0)).toBe(1000);
    expect(puzzleRatingFromTrap(0.25)).toBe(1750);
    expect(puzzleRatingFromTrap(0.5)).toBe(2500);
    expect(puzzleRatingFromTrap(2)).toBe(2500);
    expect(puzzleRatingFromTrap(-0.2)).toBe(1000);
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
