import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from './types';
import { evaluateAim } from './evaluate';
import { prepareHole } from './hole';
import { circleRing, holeFromYardSpec } from './holes/build';
import type { YardHoleSpec } from './holes/build';
import { baselineStrokes } from './baseline';

const ORIGIN = { lon: -93.335, lat: 41.02 };
const SCRATCH: PlayerProfile = { handicap: 0, clubSpeedMph: 110, shotShape: 'straight' };
const P14: PlayerProfile = { handicap: 14, clubSpeedMph: 110, shotShape: 'draw' };

function makeHole(polygons: YardHoleSpec['polygons'], pin: [number, number]) {
  return prepareHole(
    holeFromYardSpec({
      id: 'synthetic',
      courseName: 'Test',
      holeNumber: 1,
      par: 4,
      yardage: 400,
      origin: ORIGIN,
      polygons,
      pin,
      tees: [[0, 0]],
    }),
  );
}

describe('evaluateAim', () => {
  it('is deterministic for a given seed and varies across seeds', () => {
    const hole = makeHole(
      [{ kind: 'fairway', ring: [[-300, -50], [300, -50], [300, 600], [-300, 600]] }],
      [0, 150],
    );
    const sit = { ball: { x: 0, y: 0 }, lie: 'fairway' as const, pin: { x: 0, y: 150 } };
    const a = evaluateAim(hole, sit, P14, { x: 0, y: 150 }, { seed: 1 });
    const b = evaluateAim(hole, sit, P14, { x: 0, y: 150 }, { seed: 1 });
    const c = evaluateAim(hole, sit, P14, { x: 0, y: 150 }, { seed: 2 });
    expect(a.expectedStrokes).toBe(b.expectedStrokes);
    expect(a.expectedStrokes).not.toBe(c.expectedStrokes);
  });

  it('evaluates an open approach sensibly', () => {
    const hole = makeHole(
      [
        { kind: 'fairway', ring: [[-300, -50], [300, -50], [300, 600], [-300, 600]] },
        { kind: 'green', ring: circleRing(0, 150, 11) },
      ],
      [0, 150],
    );
    const sit = { ball: { x: 0, y: 0 }, lie: 'fairway' as const, pin: { x: 0, y: 150 } };
    const r = evaluateAim(hole, sit, P14, { x: 0, y: 150 });
    const b = r.outcomeStats.lieBreakdown;
    expect(r.expectedStrokes).toBeGreaterThan(2.2);
    expect(r.expectedStrokes).toBeLessThan(3.6);
    expect((b.green ?? 0) + (b.fairway ?? 0)).toBeCloseTo(1, 9);
    expect(b.green ?? 0).toBeGreaterThan(0.3);
    expect(r.outcomeStats.meanDistanceToPin).toBeLessThan(15);
    expect(r.outcomeStats.nSamples).toBe(600);
  });

  it('breakdown fractions always sum to 1', () => {
    const hole = makeHole(
      [
        { kind: 'fairway', ring: [[-30, 100], [30, 100], [30, 300], [-30, 300]] },
        { kind: 'water', ring: [[30, 100], [120, 100], [120, 300], [30, 300]] },
        { kind: 'bunker', ring: circleRing(-35, 200, 12) },
      ],
      [0, 400],
    );
    const sit = { ball: { x: 0, y: 0 }, lie: 'tee' as const, pin: { x: 0, y: 400 } };
    const r = evaluateAim(hole, sit, P14, { x: 15, y: 200 });
    const total = Object.values(r.outcomeStats.lieBreakdown).reduce((a, v) => a + (v ?? 0), 0);
    expect(total).toBeCloseTo(1, 9);
  });

  it('scores an all-OB landing zone as exact stroke and distance', () => {
    // OB zone is enormous relative to dispersion, so every sample lands OB.
    const hole = makeHole(
      [{ kind: 'ob', ring: [[-150, 50], [150, 50], [150, 250], [-150, 250]] }],
      [0, 400],
    );
    const sit = { ball: { x: 0, y: 0 }, lie: 'tee' as const, pin: { x: 0, y: 400 } };
    const r = evaluateAim(hole, sit, SCRATCH, { x: 0, y: 150 });
    expect(r.outcomeStats.lieBreakdown.ob).toBe(1);
    // cost = 2 + baseline(400, tee) = 2 + 3.95, identical for every sample
    expect(r.expectedStrokes).toBeCloseTo(2 + 3.95, 9);
  });

  it('scores water with penalty plus a drop near the entry point', () => {
    const hole = makeHole(
      [{ kind: 'water', ring: [[-200, 100], [200, 100], [200, 200], [-200, 200]] }],
      [0, 400],
    );
    const sit = { ball: { x: 0, y: 0 }, lie: 'fairway' as const, pin: { x: 0, y: 400 } };
    const r = evaluateAim(hole, sit, SCRATCH, { x: 0, y: 150 });
    expect(r.outcomeStats.lieBreakdown.water).toBe(1);
    // Every drop lands ~5y short of y=100 on the ball side → ~305y rough shot.
    // cost ≈ 2 + baseline(305, rough) = 2 + ~4.115
    expect(r.expectedStrokes).toBeGreaterThan(6.0);
    expect(r.expectedStrokes).toBeLessThan(6.25);
  });

  it('scores an all-green landing zone with putts', () => {
    const hole = makeHole(
      [{ kind: 'green', ring: [[-200, 100], [200, 100], [200, 200], [-200, 200]] }],
      [0, 150],
    );
    const sit = { ball: { x: 0, y: 0 }, lie: 'fairway' as const, pin: { x: 0, y: 150 } };
    const r = evaluateAim(hole, sit, SCRATCH, { x: 0, y: 150 });
    expect(r.outcomeStats.lieBreakdown.green).toBe(1);
    expect(r.expectedStrokes).toBeGreaterThan(2.3);
    expect(r.expectedStrokes).toBeLessThan(3.3);
  });

  it('penalizes aiming over water versus a safe line', () => {
    const hole = makeHole(
      [
        { kind: 'fairway', ring: [[-80, 100], [0, 100], [0, 320], [-80, 320]] },
        { kind: 'water', ring: [[0, 100], [90, 100], [90, 320], [0, 320]] },
      ],
      [0, 400],
    );
    const sit = { ball: { x: 0, y: 0 }, lie: 'tee' as const, pin: { x: 0, y: 400 } };
    const risky = evaluateAim(hole, sit, P14, { x: 20, y: 250 });
    const safe = evaluateAim(hole, sit, P14, { x: -40, y: 250 });
    expect(risky.expectedStrokes).toBeGreaterThan(safe.expectedStrokes + 0.3);
  });

  it('clamps aims beyond max club to driver carry', () => {
    const hole = makeHole([], [0, 400]); // all rough
    const sit = { ball: { x: 0, y: 0 }, lie: 'tee' as const, pin: { x: 0, y: 400 } };
    const r = evaluateAim(hole, sit, SCRATCH, { x: 0, y: 400 });
    expect(r.outcomeStats.clamped).toBe(true);
    expect(r.outcomeStats.aimDistance).toBeCloseTo(2.45 * 110, 6);
    // Landing center ≈ 269.5 → mean distance to pin ≈ 130.5
    expect(r.outcomeStats.meanDistanceToPin).toBeGreaterThan(110);
    expect(r.outcomeStats.meanDistanceToPin).toBeLessThan(150);
  });

  it('respects an explicit sample count', () => {
    const hole = makeHole([], [0, 400]);
    const sit = { ball: { x: 0, y: 0 }, lie: 'tee' as const, pin: { x: 0, y: 400 } };
    const r = evaluateAim(hole, sit, P14, { x: 0, y: 200 }, { nSamples: 100 });
    expect(r.outcomeStats.nSamples).toBe(100);
  });
});
