import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from './types';
import { evaluateGrid } from './optimize';
import { prepareHole } from './hole';
import { circleRing, holeFromYardSpec } from './holes/build';
import { capeHole, CAPE_APPROACH, CAPE_TEE } from './holes/cape';
import { dist } from './projection';

const ORIGIN = { lon: -93.335, lat: 41.02 };
const DRIVER = 2.45 * 110;

const P5: PlayerProfile = { handicap: 5, clubSpeedMph: 110, shotShape: 'draw' };
const P14S: PlayerProfile = { handicap: 14, clubSpeedMph: 110, shotShape: 'straight' };
const P20: PlayerProfile = { handicap: 20, clubSpeedMph: 110, shotShape: 'draw' };

function corridorHole() {
  return prepareHole(
    holeFromYardSpec({
      id: 'corridor',
      courseName: 'Test',
      holeNumber: 1,
      par: 4,
      yardage: 400,
      origin: ORIGIN,
      polygons: [
        { kind: 'fairway', ring: [[-25, 100], [25, 100], [25, 420], [-25, 420]] },
        { kind: 'green', ring: circleRing(0, 400, 11) },
      ],
      pin: [0, 400],
      tees: [[0, 0]],
    }),
  );
}

describe('evaluateGrid on a symmetric corridor', () => {
  const prepared = corridorHole();
  const sit = { ball: { x: 0, y: 0 }, lie: 'tee' as const, pin: { x: 0, y: 400 } };
  const grid = evaluateGrid(prepared, sit, P14S, 'tee');

  it('keeps the grid rectangular and consistent with the optimum', () => {
    expect(grid.values).toHaveLength(grid.width * grid.height);
    expect(grid.cellSize).toBe(6);
    const finite = grid.values.filter((v) => Number.isFinite(v));
    expect(finite.length).toBeGreaterThan(100);
    expect(finite.length).toBeLessThan(grid.values.length); // sector masks corners
    const min = Math.min(...finite);
    expect(min).toBeCloseTo(grid.optimal.expectedStrokes, 9);
  });

  it('finds an optimum down the middle at driver range', () => {
    expect(Math.abs(grid.optimal.point.x)).toBeLessThanOrEqual(8);
    const d = dist(sit.ball, grid.optimal.point);
    expect(d).toBeGreaterThan(230);
    expect(d).toBeLessThan(311);
  });

  it('seeds the naive tee aim at fairway center, driver distance', () => {
    expect(Math.abs(grid.naive.point.x)).toBeLessThanOrEqual(3);
    expect(grid.naive.point.y).toBeGreaterThan(DRIVER - 8);
    expect(grid.naive.point.y).toBeLessThan(DRIVER + 8);
  });

  it('has a small non-negative trap on an honest hole', () => {
    expect(grid.trapSize).toBeGreaterThan(-0.02);
    expect(grid.trapSize).toBeLessThan(0.2);
  });
});

describe('evaluateGrid on the cape hole', () => {
  const prepared = prepareHole(capeHole());

  it('shifts the optimal aim away from the water as handicap rises', () => {
    const sit = { ball: CAPE_TEE.ball, lie: CAPE_TEE.lie, pin: prepared.pin };
    const g5 = evaluateGrid(prepared, sit, P5, 'tee');
    const g20 = evaluateGrid(prepared, sit, P20, 'tee');
    // Water guards the right side: the wider-dispersion player must bail left.
    expect(g5.optimal.point.x - g20.optimal.point.x).toBeGreaterThanOrEqual(4);
    // Neither optimum should be in the water.
    expect(g5.optimal.result.outcomeStats.lieBreakdown.water ?? 0).toBeLessThan(0.25);
    expect(g20.optimal.result.outcomeStats.lieBreakdown.water ?? 0).toBeLessThan(0.25);
    expect(g5.trapSize).toBeGreaterThan(-0.01);
    expect(g20.trapSize).toBeGreaterThan(-0.01);
  });

  it('treats the pin as the naive aim on approach shots and finds a real trap', () => {
    const sit = { ball: CAPE_APPROACH.ball, lie: CAPE_APPROACH.lie, pin: prepared.pin };
    const g = evaluateGrid(prepared, sit, P20, 'approach');
    expect(g.naive.point.x).toBeCloseTo(prepared.pin.x, 6);
    expect(g.naive.point.y).toBeCloseTo(prepared.pin.y, 6);
    // Water right of the green: bailing away from the pin must be worth something.
    expect(g.trapSize).toBeGreaterThan(0.02);
    // And the optimum should sit left of the pin.
    expect(g.optimal.point.x).toBeLessThan(prepared.pin.x);
  });
});
