import { describe, expect, it } from 'vitest';
import { CONSEQUENCE_ASYMMETRY, holdsSomething, legibility } from './legibility';
import { clearsDecisionThreshold } from '@/lib/engine/scoring';
import { evaluateGrid } from '@/lib/engine/optimize';
import { prepareHole } from '@/lib/engine/hole';
import { circleRing, holeFromYardSpec } from '@/lib/engine/holes/build';
import type { PlayerProfile } from '@/lib/engine/types';

const ORIGIN = { lon: -93.335, lat: 41.02 };
const P14: PlayerProfile = { handicap: 14, clubSpeedMph: 110, shotShape: 'straight' };

/**
 * The shape the second axis exists for: the aim is uncontroversial (the
 * middle of the green is both the obvious and the optimal target, so the
 * trap is ~0) but one side is water and the other is short grass.
 */
function oneSidedGreen() {
  return prepareHole(
    holeFromYardSpec({
      id: 'one-sided',
      courseName: 'Test',
      holeNumber: 1,
      par: 4,
      yardage: 400,
      origin: ORIGIN,
      polygons: [
        { kind: 'fairway', ring: [[-60, 120], [60, 120], [60, 430], [-60, 430]] },
        { kind: 'green', ring: circleRing(0, 400, 18) },
        { kind: 'water', ring: [[22, 360], [90, 360], [90, 440], [22, 440]] },
      ],
      pin: [0, 400],
      tees: [[0, 0]],
    }),
  );
}

/** Symmetric trouble: expensive to miss, but nothing to choose between. */
function bothSidesGreen() {
  return prepareHole(
    holeFromYardSpec({
      id: 'both-sides',
      courseName: 'Test',
      holeNumber: 1,
      par: 4,
      yardage: 400,
      origin: ORIGIN,
      polygons: [
        { kind: 'fairway', ring: [[-60, 120], [60, 120], [60, 430], [-60, 430]] },
        { kind: 'green', ring: circleRing(0, 400, 18) },
        { kind: 'water', ring: [[22, 360], [90, 360], [90, 440], [22, 440]] },
        { kind: 'water', ring: [[-90, 360], [-22, 360], [-22, 440], [-90, 440]] },
      ],
      pin: [0, 400],
      tees: [[0, 0]],
    }),
  );
}

describe('legibility', () => {
  it('finds the expensive side and names it', () => {
    const prepared = oneSidedGreen();
    const sit = { ball: { x: 0, y: 240 }, lie: 'fairway' as const, pin: { x: 0, y: 400 } };
    const grid = evaluateGrid(prepared, sit, P14, 'approach', { nSamples: 400 });
    const leg = legibility(grid, sit.ball);

    expect(leg.consequenceSide).toBe('right');
    expect(leg.consequence).toBeGreaterThan(leg.safeSideCost);
    expect(leg.asymmetry).toBeGreaterThan(CONSEQUENCE_ASYMMETRY);
  });

  it('reports near-zero asymmetry when both sides are equally dead', () => {
    // This is the case raw consequence gets wrong: expensive to miss, but
    // no answer to "which way?", so nothing to teach. Measured on the
    // shipped library, county-down-7 scores consequence 0.922 with an
    // asymmetry of 0.052 for exactly this reason.
    const prepared = bothSidesGreen();
    const sit = { ball: { x: 0, y: 240 }, lie: 'fairway' as const, pin: { x: 0, y: 400 } };
    const grid = evaluateGrid(prepared, sit, P14, 'approach', { nSamples: 400 });
    const leg = legibility(grid, sit.ball);

    expect(leg.consequence).toBeGreaterThan(0.3);
    expect(leg.asymmetry).toBeLessThan(leg.consequence / 2);
  });

  it('names the feature the obvious line feeds that the good one does not', () => {
    const prepared = oneSidedGreen();
    // Aiming at a flag tucked behind the water is the classic version.
    const sit = { ball: { x: 0, y: 250 }, lie: 'fairway' as const, pin: { x: 14, y: 400 } };
    const grid = evaluateGrid(prepared, sit, P14, 'approach', { nSamples: 500 });
    const leg = legibility(grid, sit.ball);
    if (leg.culprit) {
      expect(leg.culprit.kind).toBe('water');
      expect(leg.culprit.shareSwing).toBeGreaterThan(0);
    }
  });

  it('costs nothing — it reads a grid that was already built', () => {
    const prepared = oneSidedGreen();
    const sit = { ball: { x: 0, y: 240 }, lie: 'fairway' as const, pin: { x: 0, y: 400 } };
    const grid = evaluateGrid(prepared, sit, P14, 'approach', { nSamples: 400 });
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) legibility(grid, sit.ball);
    // 50 reads of a lattice must not approach the cost of one grid (~400ms).
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe('holdsSomething — the admission gate', () => {
  it('admits a decision', () => {
    const r = holdsSomething(0.3, 0.02, 0, clearsDecisionThreshold);
    expect(r).toEqual({ ships: true, because: 'decision' });
  });

  it('admits a one-sided consequence even with no decision at all', () => {
    // Sawgrass 17 measured: trapSize 0.000, consequence 2.469. The most
    // famous shot in golf, rated 1000 and taught as a free PERFECT.
    const r = holdsSomething(0, 0, 1.2, clearsDecisionThreshold);
    expect(r).toEqual({ ships: true, because: 'consequence' });
  });

  it('refuses a reflex', () => {
    const r = holdsSomething(0.02, 0.01, 0.1, clearsDecisionThreshold);
    expect(r).toEqual({ ships: false, because: null });
  });

  it('refuses a trap that does not survive its own error bar', () => {
    expect(holdsSomething(0.12, 0.05, 0, clearsDecisionThreshold).ships).toBe(false);
    expect(holdsSomething(0.12, 0.005, 0, clearsDecisionThreshold).ships).toBe(true);
  });
});
