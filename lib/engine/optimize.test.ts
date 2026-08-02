import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from './types';
import { evaluateGrid, fairwayCenterAim } from './optimize';
import { evaluateAim } from './evaluate';
import { classifyPoint, prepareHole } from './hole';
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
    // The optimum considers the lattice plus the pin/naive candidates, so it
    // can only be at or below every lattice value.
    const min = Math.min(...finite);
    expect(grid.optimal.expectedStrokes).toBeLessThanOrEqual(min + 1e-9);
  });

  it('stores values row-major at the documented coordinates', () => {
    // The isoline renderer's contract: values[row*width+col] is the cell at
    // (origin.x + col*cellSize, origin.y + row*cellSize). Recompute one
    // interior cell independently with the grid's default seed/samples.
    const i = grid.values.findIndex((v) => Number.isFinite(v));
    expect(i).toBeGreaterThanOrEqual(0);
    const col = i % grid.width;
    const row = Math.floor(i / grid.width);
    const p = {
      x: grid.origin.x + col * grid.cellSize,
      y: grid.origin.y + row * grid.cellSize,
    };
    const e = evaluateAim(prepared, sit, P14S, p).expectedStrokes;
    expect(grid.values[i]).toBeCloseTo(e, 12);
  });

  it('finds an optimum down the middle at driver range', () => {
    expect(Math.abs(grid.optimal.point.x)).toBeLessThanOrEqual(8);
    const d = dist(sit.ball, grid.optimal.point);
    expect(d).toBeGreaterThan(230);
    expect(d).toBeLessThan(DRIVER + 1e-6);
  });

  it('seeds the naive tee aim at fairway center, driver distance', () => {
    expect(Math.abs(grid.naive.point.x)).toBeLessThanOrEqual(3);
    expect(grid.naive.point.y).toBeGreaterThan(DRIVER - 8);
    expect(grid.naive.point.y).toBeLessThan(DRIVER + 8);
  });

  it('has a small non-negative trap on an honest hole', () => {
    expect(grid.trapSize).toBeGreaterThanOrEqual(0);
    expect(grid.trapSize).toBeLessThan(0.2);
  });
});

describe('fairwayCenterAim', () => {
  it('finds the center of an off-center fairway', () => {
    const prepared = prepareHole(
      holeFromYardSpec({
        id: 'offset',
        courseName: 'Test',
        holeNumber: 1,
        par: 4,
        yardage: 400,
        origin: ORIGIN,
        polygons: [
          { kind: 'fairway', ring: [[10, 100], [60, 100], [60, 420], [10, 420]] },
          { kind: 'green', ring: circleRing(35, 400, 11) },
        ],
        pin: [35, 400],
        tees: [[0, 0]],
      }),
    );
    const ball = { x: 0, y: 0 };
    const bearing = Math.atan2(35, 400);
    const aim = fairwayCenterAim(prepared, ball, bearing, DRIVER);
    // Fairway spans x 10..60 at driver range → its center is x ≈ 35, and it
    // is NOT on the straight-at-pin fallback line (x ≈ 23 at that radius).
    expect(classifyPoint(prepared, aim)).toBe('fairway');
    expect(Math.abs(aim.x - 35)).toBeLessThanOrEqual(4);
    expect(dist(ball, aim)).toBeCloseTo(DRIVER, 6);
  });
});

describe('evaluateGrid on the cape hole', () => {
  const prepared = prepareHole(capeHole());

  it('shifts the optimal aim away from the water as handicap rises', () => {
    const sit = { ball: CAPE_TEE.ball, lie: CAPE_TEE.lie, pin: prepared.pin };
    // MC noise on the argmin at the default 600 samples is comparable to the
    // true shift; 5000 samples makes the shift stable (~11y) across seeds.
    const g5 = evaluateGrid(prepared, sit, P5, 'tee', { nSamples: 5000 });
    const g20 = evaluateGrid(prepared, sit, P20, 'tee', { nSamples: 5000 });
    // Water guards the right side: the wider-dispersion player must bail left.
    expect(g5.optimal.point.x - g20.optimal.point.x).toBeGreaterThanOrEqual(8);
    // Neither optimum flirts meaningfully with the lake.
    expect(g5.optimal.result.outcomeStats.lieBreakdown.water ?? 0).toBeLessThan(0.05);
    expect(g20.optimal.result.outcomeStats.lieBreakdown.water ?? 0).toBeLessThan(0.05);
    expect(g5.trapSize).toBeGreaterThanOrEqual(0);
    expect(g20.trapSize).toBeGreaterThanOrEqual(0);
    // The naive tee aim must be an actual fairway-center point.
    expect(classifyPoint(prepared, g5.naive.point)).toBe('fairway');
    expect(classifyPoint(prepared, g20.naive.point)).toBe('fairway');
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

describe('evaluateGrid on short greenside puzzles', () => {
  it('finds the optimum for a pin closer than one grid cell', () => {
    // 12y chip: the old 15y inner dead zone would have forced the "optimal"
    // past the green and produced a negative trap.
    const prepared = prepareHole(
      holeFromYardSpec({
        id: 'chip',
        courseName: 'Test',
        holeNumber: 1,
        par: 3,
        yardage: 120,
        origin: ORIGIN,
        polygons: [
          { kind: 'fairway', ring: [[-60, -30], [60, -30], [60, 80], [-60, 80]] },
          { kind: 'green', ring: circleRing(0, 12, 10) },
        ],
        pin: [0, 12],
        tees: [[0, -100]],
      }),
    );
    const sit = { ball: { x: 0, y: 0 }, lie: 'fairway' as const, pin: { x: 0, y: 12 } };
    const g = evaluateGrid(prepared, sit, P14S, 'approach');
    const pinE = evaluateAim(prepared, sit, P14S, sit.pin).expectedStrokes;
    expect(g.optimal.expectedStrokes).toBeLessThanOrEqual(pinE + 1e-9);
    expect(dist(g.optimal.point, sit.pin)).toBeLessThanOrEqual(7);
    expect(g.trapSize).toBeGreaterThanOrEqual(0);
  });
});
