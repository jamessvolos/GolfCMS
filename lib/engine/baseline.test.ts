import { describe, expect, it } from 'vitest';
import { baselineStrokes, expectedPutts, strokesToHoleOut } from './baseline';

const FT = 1 / 3; // yards per foot

describe('baselineStrokes', () => {
  it('returns table anchors exactly for a scratch player', () => {
    expect(baselineStrokes(150, 'fairway', 0)).toBeCloseTo(2.98, 9);
    expect(baselineStrokes(25, 'sand', 0)).toBeCloseTo(2.85, 9);
    expect(baselineStrokes(400, 'tee', 0)).toBeCloseTo(3.95, 9);
    expect(baselineStrokes(100, 'recovery', 0)).toBeCloseTo(3.85, 9);
  });

  it('interpolates linearly between anchors', () => {
    expect(baselineStrokes(175, 'fairway', 0)).toBeCloseTo((2.98 + 3.19) / 2, 9);
    expect(baselineStrokes(75, 'rough', 0)).toBeCloseTo((2.85 + 3.05) / 2, 9);
  });

  it('applies the handicap multiplier of 1 + 0.011h', () => {
    expect(baselineStrokes(150, 'fairway', 10)).toBeCloseTo(2.98 * 1.11, 9);
    expect(baselineStrokes(150, 'fairway', 20)).toBeCloseTo(2.98 * 1.22, 9);
  });

  it('extrapolates beyond the last anchor with the edge slope', () => {
    // fairway 300→400 slope = 0.35/100
    expect(baselineStrokes(500, 'fairway', 0)).toBeCloseTo(4.4, 9);
    // sand 200→250 slope = 0.3/50
    expect(baselineStrokes(300, 'sand', 0)).toBeCloseTo(4.5, 9);
    // recovery 200→250 slope = 0.3/50
    expect(baselineStrokes(275, 'recovery', 0)).toBeCloseTo(4.75, 9);
  });

  it('extrapolates below the first anchor with the edge slope', () => {
    // tee is only defined from 150; slope 150→200 = 0.2/50
    expect(baselineStrokes(100, 'tee', 0)).toBeCloseTo(2.75, 9);
    // fairway 25→50 slope = 0.25/25
    expect(baselineStrokes(10, 'fairway', 0)).toBeCloseTo(2.25, 9);
    expect(baselineStrokes(0, 'fairway', 0)).toBeCloseTo(2.15, 9);
  });

  it('never drops below the floor', () => {
    for (const d of [0, 1, 5, 10]) {
      expect(baselineStrokes(d, 'fairway', 0)).toBeGreaterThanOrEqual(1.5);
    }
  });
});

describe('expectedPutts', () => {
  it('returns anchors exactly (input in yards)', () => {
    expect(expectedPutts(2 * FT, 0)).toBeCloseTo(1.0, 9);
    expect(expectedPutts(20 * FT, 0)).toBeCloseTo(1.87, 9);
    expect(expectedPutts(55 * FT, 0)).toBeCloseTo(2.3, 9);
  });

  it('interpolates between anchors', () => {
    expect(expectedPutts(6 * FT, 0)).toBeCloseTo(1.325, 9);
  });

  it('clamps to at least one putt', () => {
    expect(expectedPutts(0.5 * FT, 0)).toBeCloseTo(1.0, 9);
    expect(expectedPutts(0, 0)).toBeCloseTo(1.0, 9);
  });

  it('extrapolates long putts with the edge slope and caps them', () => {
    // 35→55 slope = 0.2/20 = 0.01 per foot
    expect(expectedPutts(75 * FT, 0)).toBeCloseTo(2.5, 9);
    expect(expectedPutts(200 * FT, 0)).toBeCloseTo(3.0, 9); // capped
  });

  it('applies the handicap multiplier', () => {
    expect(expectedPutts(20 * FT, 10)).toBeCloseTo(1.87 * 1.11, 9);
  });
});

describe('strokesToHoleOut', () => {
  it('routes green lies to the putt model', () => {
    expect(strokesToHoleOut(20 * FT, 'green', 0)).toBeCloseTo(1.87, 9);
  });

  it('routes other lies to the baseline table', () => {
    expect(strokesToHoleOut(150, 'fairway', 0)).toBeCloseTo(2.98, 9);
    expect(strokesToHoleOut(150, 'sand', 0)).toBeCloseTo(3.6, 9);
  });
});
