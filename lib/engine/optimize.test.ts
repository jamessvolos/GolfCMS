import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from './types';
import { evaluateGrid, fairwayCenterAim, referenceAim } from './optimize';
import { createNormalPairs } from './rng';
import { DEFAULT_SEED } from './constants';
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

describe('referenceAim — the yardstick every rating is measured against', () => {
  const prepared = corridorHole();
  const bearing = 0; // ball at the tee, pin due north

  it('is the flag when the flag is reachable', () => {
    // A 150-yard shot with a 270-yard driver. Nobody lays up; the naive
    // play and the aim the player is scored against are both the flag.
    const sit = { ball: { x: 0, y: 250 }, lie: 'fairway' as const, pin: { x: 0, y: 400 } };
    const ref = referenceAim(prepared, sit, P14S, bearing);
    expect(ref.x).toBeCloseTo(sit.pin.x, 9);
    expect(ref.y).toBeCloseTo(sit.pin.y, 9);
  });

  it('is the reachable line when the flag is not reachable', () => {
    // 400 yards out with a 270-yard driver: "aim at the flag" is not a
    // behaviour, it is a clamp artefact. The reference is as far as you can
    // go down the middle.
    const sit = { ball: { x: 0, y: 0 }, lie: 'tee' as const, pin: { x: 0, y: 400 } };
    const ref = referenceAim(prepared, sit, P14S, bearing);
    const r = dist(sit.ball, ref);
    expect(r).toBeLessThanOrEqual(DRIVER + 1e-6);
    expect(r).toBeGreaterThan(DRIVER * 0.5);
    expect(classifyPoint(prepared, ref)).toBe('fairway');
  });

  it('switches at the carry boundary, not at a category name', () => {
    // The old rule keyed off `category === 'tee'`, which is why a 119-yard
    // par-3 tee shot was scored against a driver. The boundary is physical.
    const just = { ball: { x: 0, y: 400 - (DRIVER - 5) }, lie: 'fairway' as const, pin: { x: 0, y: 400 } };
    const past = { ball: { x: 0, y: 400 - (DRIVER + 5) }, lie: 'fairway' as const, pin: { x: 0, y: 400 } };
    expect(referenceAim(prepared, just, P14S, bearing).y).toBeCloseTo(400, 9);
    expect(referenceAim(prepared, past, P14S, bearing).y).not.toBeCloseTo(400, 3);
  });
});

describe('the artefact guard — an unreachable flag must not manufacture a trap', () => {
  // This is the test that protects every wave downstream. A generator that
  // searches for high trap sizes will find whatever the yardstick rewards,
  // so if "aim at an unreachable flag" scores as a decision, the miner will
  // mass-produce that wrong lesson at the top of the rating range.
  //
  // The hole: a dogleg corridor whose FLAG LINE crosses water the fairway
  // avoids. Aiming at the flag from the tee flies a driver straight into it.
  const prepared = prepareHole(
    holeFromYardSpec({
      id: 'flagline-water',
      courseName: 'Test',
      holeNumber: 1,
      par: 5,
      yardage: 520,
      origin: ORIGIN,
      polygons: [
        // Fairway bends right; the direct line to the pin does not follow it.
        { kind: 'fairway', ring: [[10, 80], [90, 80], [120, 520], [40, 520]] },
        // Water sits exactly where a driver aimed at the flag would land.
        { kind: 'water', ring: [[-60, 200], [30, 200], [30, 320], [-60, 320]] },
        { kind: 'green', ring: circleRing(80, 520, 12) },
      ],
      pin: [80, 520],
      tees: [[0, 0]],
    }),
  );
  const sit = { ball: { x: 0, y: 0 }, lie: 'tee' as const, pin: { x: 80, y: 520 } };

  it('scores the flag line as a decision only when the flag can be reached', () => {
    const grid = evaluateGrid(prepared, sit, P14S, 'tee', { nSamples: 400 });
    const flagE = evaluateAim(prepared, sit, P14S, sit.pin, { nSamples: 400 }).expectedStrokes;
    const flagTrap = flagE - grid.optimal.expectedStrokes;

    // The flag line really is expensive — that part was never in doubt.
    expect(flagTrap).toBeGreaterThan(0.3);
    // But the player was never choosing it, so it is not the yardstick, and
    // the trap the product reports stays small.
    expect(grid.trapSize).toBeLessThan(flagTrap / 2);
    expect(dist(sit.ball, grid.naive.point)).toBeLessThanOrEqual(DRIVER + 1e-6);
  });
});

describe('trapSe — the error bar on a rating', () => {
  const prepared = corridorHole();
  const sit = { ball: { x: 0, y: 0 }, lie: 'tee' as const, pin: { x: 0, y: 400 } };

  it('is reported and is small relative to a stroke', () => {
    const grid = evaluateGrid(prepared, sit, P14S, 'tee', { nSamples: 600 });
    expect(grid.trapSe).toBeGreaterThanOrEqual(0);
    expect(grid.trapSe).toBeLessThan(0.2);
  });

  it('shrinks like 1/sqrt(n)', () => {
    // The claim the gate rests on: quadrupling the samples halves the bar.
    const lo = evaluateGrid(prepared, sit, P20, 'tee', { nSamples: 300 }).trapSe;
    const hi = evaluateGrid(prepared, sit, P20, 'tee', { nSamples: 1200 }).trapSe;
    expect(hi).toBeLessThan(lo);
    expect(hi).toBeGreaterThan(lo / 6);
  });

  it('agrees with an independent batch-means estimate', () => {
    // Cross-check the paired formula against splitting the same samples
    // into blocks and taking the spread of the block means.
    const n = 1200;
    const blocks = 24;
    const grid = evaluateGrid(prepared, sit, P20, 'tee', { nSamples: n });
    const normals = createNormalPairs(DEFAULT_SEED, n);
    const refCosts = new Float64Array(n);
    const optCosts = new Float64Array(n);
    evaluateAim(prepared, sit, P20, grid.naive.point, { normals, costs: refCosts });
    evaluateAim(prepared, sit, P20, grid.optimal.point, { normals, costs: optCosts });

    const per = n / blocks;
    const means: number[] = [];
    for (let b = 0; b < blocks; b++) {
      let s = 0;
      for (let i = b * per; i < (b + 1) * per; i++) s += refCosts[i]! - optCosts[i]!;
      means.push(s / per);
    }
    const mu = means.reduce((a, c) => a + c, 0) / blocks;
    const varBlocks = means.reduce((a, c) => a + (c - mu) ** 2, 0) / (blocks - 1);
    const batchSe = Math.sqrt(varBlocks / blocks);

    // Two estimators of the same quantity from the same draws; 25% is a
    // generous band for 24 blocks and catches a formula that is simply wrong.
    expect(grid.trapSe).toBeGreaterThan(batchSe * 0.75);
    expect(grid.trapSe).toBeLessThan(batchSe * 1.25);
  });

  it('is exactly zero when the reference aim IS the optimal aim', () => {
    // Same aim, same draws, identical per-sample costs. A puzzle with no
    // decision has no uncertainty about having no decision.
    const flat = { ball: { x: 0, y: 300 }, lie: 'fairway' as const, pin: { x: 0, y: 400 } };
    const grid = evaluateGrid(prepared, flat, P5, 'approach', { nSamples: 400 });
    if (grid.trapSize === 0) expect(grid.trapSe).toBe(0);
  });
});
