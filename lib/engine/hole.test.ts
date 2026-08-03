import { describe, expect, it } from 'vitest';
import { booleanPointInPolygon } from '@turf/turf';
import { CLASSIFY_PRIORITY, KIND_TO_LIE } from './constants';
import { classifyPoint, classifyPointDetailed, prepareHole, waterDropPoint } from './hole';
import { circleRing, holeFromYardSpec } from './holes/build';
import { capeHole } from './holes/cape';
import { createRng } from './rng';
import type { YardHoleSpec } from './holes/build';

const ORIGIN = { lon: -93.335, lat: 41.02 };

/** Synthetic hole with deliberate overlaps to pin down classification priority. */
function overlapHole() {
  const spec: YardHoleSpec = {
    id: 'overlap',
    courseName: 'Test',
    holeNumber: 1,
    par: 4,
    yardage: 400,
    origin: ORIGIN,
    polygons: [
      { kind: 'fairway', ring: [[-100, 0], [100, 0], [100, 400], [-100, 400]] },
      // bunker inside the fairway
      { kind: 'bunker', ring: circleRing(0, 200, 15) },
      // water overlapping the right half of the bunker
      { kind: 'water', ring: [[5, 150], [60, 150], [60, 250], [5, 250]] },
      // green inside fairway, top end
      { kind: 'green', ring: circleRing(0, 380, 12) },
      // recovery overlapping fairway's left edge
      { kind: 'recovery', ring: [[-120, 100], [-90, 100], [-90, 300], [-120, 300]] },
      // OB overlapping the recovery strip
      { kind: 'ob', ring: [[-200, 100], [-110, 100], [-110, 300], [-200, 300]] },
    ],
    pin: [0, 380],
    tees: [[0, -20]],
  };
  return prepareHole(holeFromYardSpec(spec));
}

describe('prepareHole', () => {
  it('projects pin and tees into local yards', () => {
    const prepared = prepareHole(capeHole());
    expect(prepared.pin.x).toBeCloseTo(50, 1);
    expect(prepared.pin.y).toBeCloseTo(398, 1);
    expect(prepared.tees[0]!.x).toBeCloseTo(0, 1);
    expect(prepared.tees[0]!.y).toBeCloseTo(0, 1);
  });
});

describe('classifyPoint', () => {
  const prepared = overlapHole();

  it('defaults to rough outside every polygon', () => {
    expect(classifyPoint(prepared, { x: 300, y: 300 })).toBe('rough');
    expect(classifyPoint(prepared, { x: 0, y: -50 })).toBe('rough');
  });

  it('classifies plain fairway', () => {
    expect(classifyPoint(prepared, { x: 50, y: 50 })).toBe('fairway');
  });

  it('prefers bunker over fairway', () => {
    expect(classifyPoint(prepared, { x: -8, y: 200 })).toBe('sand');
  });

  it('prefers bunker over water where they overlap', () => {
    // Annotating a bunker means "this is sand", even over a hazard polygon.
    expect(classifyPoint(prepared, { x: 10, y: 200 })).toBe('sand');
  });

  it('prefers bunker over green (a bunker cut into a green is sand)', () => {
    // The Road Hole case: the green outline encloses the pot bunker.
    const road = prepareHole(
      holeFromYardSpec({
        id: 'road',
        courseName: 'Test',
        holeNumber: 17,
        par: 4,
        yardage: 460,
        origin: ORIGIN,
        polygons: [
          { kind: 'fairway', ring: [[-40, 100], [40, 100], [40, 420], [-40, 420]] },
          { kind: 'green', ring: [[-14, 430], [14, 430], [14, 470], [-14, 470]] },
          { kind: 'bunker', ring: circleRing(-7, 438, 4) },
        ],
        pin: [6, 458],
        tees: [[0, 0]],
      }),
    );
    expect(classifyPoint(road, { x: -7, y: 438 })).toBe('sand');
    expect(classifyPoint(road, { x: 6, y: 458 })).toBe('green');
  });

  it('prefers green over water (island greens)', () => {
    const island = prepareHole(
      holeFromYardSpec({
        id: 'island',
        courseName: 'Test',
        holeNumber: 17,
        par: 3,
        yardage: 130,
        origin: ORIGIN,
        polygons: [
          { kind: 'water', ring: [[-80, 60], [80, 60], [80, 220], [-80, 220]] },
          { kind: 'green', ring: circleRing(0, 140, 12) },
        ],
        pin: [0, 140],
        tees: [[0, 0]],
      }),
    );
    expect(classifyPoint(island, { x: 0, y: 140 })).toBe('green');
    expect(classifyPoint(island, { x: 40, y: 140 })).toBe('water');
  });

  it('prefers green over fairway', () => {
    expect(classifyPoint(prepared, { x: 0, y: 380 })).toBe('green');
  });

  it('prefers ob over recovery', () => {
    expect(classifyPoint(prepared, { x: -115, y: 200 })).toBe('ob');
    expect(classifyPoint(prepared, { x: -100, y: 200 })).toBe('recovery');
  });

  it('returns the containing polygon in detailed mode', () => {
    const d = classifyPointDetailed(prepared, { x: 10, y: 200 });
    expect(d.lie).toBe('sand');
    expect(d.polygon?.kind).toBe('bunker');
    const rough = classifyPointDetailed(prepared, { x: 300, y: 300 });
    expect(rough.lie).toBe('rough');
    expect(rough.polygon).toBeNull();
  });

  it('agrees with a brute-force turf sweep on the cape hole', () => {
    const prepared = prepareHole(capeHole());
    const rng = createRng(7);
    for (let i = 0; i < 300; i++) {
      const p = { x: -220 + rng() * 460, y: -20 + rng() * 470 };
      let expected: string = 'rough';
      outer: for (const kind of CLASSIFY_PRIORITY) {
        for (const poly of prepared.polygons) {
          if (poly.kind !== kind) continue;
          if (booleanPointInPolygon([p.x, p.y], poly.geometry)) {
            expected = KIND_TO_LIE[kind];
            break outer;
          }
        }
      }
      expect(classifyPoint(prepared, p)).toBe(expected);
    }
  });
});

describe('waterDropPoint', () => {
  it('drops at the entry point offset back toward the ball', () => {
    const prepared = overlapHole();
    const water = prepared.polygons.find((p) => p.kind === 'water')!;
    const ball = { x: 0, y: 0 };
    const landing = { x: 30, y: 200 };
    // Segment (0,0)→(30,200) crosses y=150 (bottom edge) at x = 22.5.
    const drop = waterDropPoint(ball, landing, water);
    const t = 150 / 200;
    const entry = { x: 30 * t, y: 150 };
    const len = Math.hypot(entry.x, entry.y);
    const expected = { x: entry.x - (entry.x / len) * 5, y: entry.y - (entry.y / len) * 5 };
    expect(drop.x).toBeCloseTo(expected.x, 6);
    expect(drop.y).toBeCloseTo(expected.y, 6);
    // The drop must be outside the water.
    expect(classifyPoint(prepared, drop)).not.toBe('water');
  });

  it('uses the crossing nearest the ball when the segment crosses twice', () => {
    const prepared = overlapHole();
    const water = prepared.polygons.find((p) => p.kind === 'water')!;
    // Shot flying clean over the water, from the left of it to the right.
    const ball = { x: -40, y: 200 };
    const landing = { x: 30, y: 200 };
    const drop = waterDropPoint(ball, landing, water);
    // Entry at x=5 (left edge), offset 5y back toward the ball → x=0.
    expect(drop.x).toBeCloseTo(0, 6);
    expect(drop.y).toBeCloseTo(200, 6);
  });
});
