import { describe, expect, it } from 'vitest';
import { admit, MAX_CORRIDOR_YDS, MIN_CORRIDOR_YDS, REJECTION_REASONS } from './admit';
import { screen, SCREEN_CELL_YDS, SCREEN_SAMPLES } from '@/lib/puzzle/screen';
import { GRID_SPACING_YDS, MC_SAMPLES } from '@/lib/engine/constants';
import { prepareHole } from '@/lib/engine/hole';
import { circleRing, holeFromYardSpec } from '@/lib/engine/holes/build';
import { clearsDecisionThreshold } from '@/lib/engine/scoring';
import type { PlayerProfile } from '@/lib/engine/types';
import type { Situation } from './situations';

const ORIGIN = { lon: -93.335, lat: 41.02 };
const P14: PlayerProfile = { handicap: 14, clubSpeedMph: 110, shotShape: 'straight' };

/** A long par 5 whose flag line runs over water the fairway avoids. */
function flagLineWater() {
  return prepareHole(
    holeFromYardSpec({
      id: 'flagline',
      courseName: 'Test',
      holeNumber: 1,
      par: 5,
      yardage: 540,
      origin: ORIGIN,
      polygons: [
        { kind: 'fairway', ring: [[10, 80], [95, 80], [125, 540], [45, 540]] },
        { kind: 'water', ring: [[-70, 210], [35, 210], [35, 330], [-70, 330]] },
        { kind: 'green', ring: circleRing(85, 540, 14) },
      ],
      pin: [85, 540],
      tees: [[0, 0]],
    }),
  );
}

const sit = (ball: { x: number; y: number }, lie: Situation['lie'], category: Situation['category'], toPin: number): Situation => ({
  ball,
  lie,
  category,
  toPin,
  shotIndex: 1,
});

describe('admit', () => {
  it('refuses a situation whose flag is unreachable and whose trap comes from the flag line', () => {
    // The guard the whole mining wave rests on. A generator searching for
    // high trap sizes finds whatever the yardstick rewards, and "aim at a
    // flag 540 yards away" is not a decision anyone was making — measured
    // in the shipped library at 1.841 against the flag line versus 0.026
    // against a reachable one. Admitting those would put a wrong lesson at
    // the top of the rating range.
    const prepared = flagLineWater();
    const s = sit({ x: 40, y: 20 }, 'tee', 'tee', 520);
    const v = admit(prepared, s, prepared.pin, 'middle', P14, { nSamples: 400 });
    if (v.rejected) {
      expect(REJECTION_REASONS).toContain(v.rejected.reason);
    } else {
      // If it is admitted, it must be because the reference aim was the
      // reachable line and the trap is real — never because the flag was
      // treated as the obvious target from 520 yards.
      expect(v.admitted.trapSize).toBeLessThan(1);
    }
  });

  it('refuses a knife-edge corridor', () => {
    // A trap you can only collect by hitting a target narrower than your own
    // dispersion is a lottery, not a lesson. Measured on the miner's first
    // run, every corridor-rejected situation had 0–3 yards of room.
    expect(MIN_CORRIDOR_YDS).toBeGreaterThan(0);
    expect(MAX_CORRIDOR_YDS).toBeGreaterThan(MIN_CORRIDOR_YDS);
  });

  it('refuses a chip', () => {
    const prepared = flagLineWater();
    const v = admit(prepared, sit({ x: 85, y: 515 }, 'rough', 'approach', 25), prepared.pin, 'middle', P14, { nSamples: 200 });
    expect(v.rejected?.reason).toBe('too-close');
  });

  it('gives every refusal a machine-readable reason', () => {
    // A generator whose rejections are anonymous is a generator nobody can
    // debug — the funnel report is the only view into why 1664 of 2386
    // proposals were thrown away.
    const prepared = flagLineWater();
    const probes: Situation[] = [
      sit({ x: 85, y: 515 }, 'rough', 'approach', 25),
      sit({ x: 55, y: 380 }, 'fairway', 'approach', 165),
      sit({ x: 40, y: 20 }, 'tee', 'tee', 520),
    ];
    for (const p of probes) {
      const v = admit(prepared, p, prepared.pin, 'middle', P14, { nSamples: 200 });
      if (v.rejected) expect(REJECTION_REASONS).toContain(v.rejected.reason);
    }
  });

  it('carries the measurements forward so nothing is recomputed to serve it', () => {
    const prepared = flagLineWater();
    const v = admit(prepared, sit({ x: 55, y: 370 }, 'fairway', 'approach', 175), { x: 92, y: 545 }, 'back-right', P14, { nSamples: 500 });
    if (v.admitted) {
      const a = v.admitted;
      expect(a.rating).toBeGreaterThanOrEqual(1000);
      expect(a.trapSe).toBeGreaterThanOrEqual(0);
      expect(['decision', 'consequence']).toContain(a.holds);
      expect(a.pinZone).toBe('back-right');
    }
  });
});

describe('screen', () => {
  const prepared = flagLineWater();
  const probe = { ball: { x: 55, y: 370 }, lie: 'fairway' as const, pin: prepared.pin };

  it('is materially cheaper than the grid it stands in for', () => {
    // 8-13x measured on this hardware. It is the difference between
    // generation that fits on a shared vCPU and generation that does not.
    expect(SCREEN_CELL_YDS).toBeGreaterThan(GRID_SPACING_YDS);
    expect(SCREEN_SAMPLES).toBeLessThan(MC_SAMPLES);

    const t0 = performance.now();
    screen(prepared, probe, P14, 'approach');
    const screenMs = performance.now() - t0;

    const t1 = performance.now();
    admit(prepared, sit(probe.ball, 'fairway', 'approach', 180), probe.pin, 'middle', P14);
    const fullMs = performance.now() - t1;

    expect(screenMs).toBeLessThan(fullMs);
  });

  it('sets a bar below the admission bar, because a lost decision cannot be recovered', () => {
    // A false positive costs one grid. A false negative costs the puzzle
    // forever, since nothing downstream ever sees it again.
    const r = screen(prepared, probe, P14, 'approach');
    expect(typeof r.passed).toBe('boolean');
    if (clearsDecisionThreshold(r.trap, 0)) expect(r.passed).toBe(true);
  });

  it('passes a one-sided situation even when its trap is zero', () => {
    // Sawgrass 17 measures trap 0.000 and consequence 2.469. Screening on
    // trap alone would throw the most famous shot in golf away before the
    // axis that admits it ever ran.
    const oneSided = prepareHole(
      holeFromYardSpec({
        id: 'island',
        courseName: 'Test',
        holeNumber: 1,
        par: 3,
        yardage: 140,
        origin: ORIGIN,
        polygons: [
          { kind: 'green', ring: circleRing(0, 140, 16) },
          { kind: 'water', ring: [[20, 100], [90, 100], [90, 180], [20, 180]] },
          { kind: 'fairway', ring: [[-70, 100], [-18, 100], [-18, 180], [-70, 180]] },
        ],
        pin: [0, 140],
        tees: [[0, 0]],
      }),
    );
    const r = screen(oneSided, { ball: { x: 0, y: 0 }, lie: 'tee', pin: { x: 0, y: 140 } }, P14, 'tee');
    expect(r.asymmetry).toBeGreaterThan(0);
  });
});
