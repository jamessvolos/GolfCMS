import { describe, expect, it } from 'vitest';
import { greenFrame, pinSheet, pinZone, PIN_COLLAR_YDS } from './pins';
import { classifyPoint, prepareHole } from '@/lib/engine/hole';
import { circleRing, holeFromYardSpec } from '@/lib/engine/holes/build';
import { dist } from '@/lib/engine/projection';

const ORIGIN = { lon: -93.335, lat: 41.02 };

/** A green wide enough to hold a sheet, with a bunker eating its right side. */
function greenHole(radius = 22) {
  return prepareHole(
    holeFromYardSpec({
      id: 'green-test',
      courseName: 'Test',
      holeNumber: 1,
      par: 4,
      yardage: 400,
      origin: ORIGIN,
      polygons: [
        { kind: 'fairway', ring: [[-30, 100], [30, 100], [30, 380], [-30, 380]] },
        { kind: 'green', ring: circleRing(0, 400, radius) },
      ],
      pin: [0, 400],
      tees: [[0, 0]],
    }),
  );
}

describe('pinSheet', () => {
  const prepared = greenHole();

  it('draws pins that are on the green', () => {
    const pins = pinSheet(prepared, 1000, { count: 6 });
    expect(pins.length).toBeGreaterThan(0);
    for (const p of pins) expect(classifyPoint(prepared, p.at)).toBe('green');
  });

  it('leaves a collar — no flag cut on the edge', () => {
    // A pin against the boundary makes the optimal aim degenerate: every
    // miss is off the green, so the model just says "middle" with no
    // information in it. Every pin must have room on all eight sides.
    const pins = pinSheet(prepared, 7, { count: 8 });
    for (const p of pins) {
      for (let i = 0; i < 8; i++) {
        const a = (2 * Math.PI * i) / 8;
        const probe = {
          x: p.at.x + PIN_COLLAR_YDS * Math.cos(a),
          y: p.at.y + PIN_COLLAR_YDS * Math.sin(a),
        };
        expect(classifyPoint(prepared, probe)).toBe('green');
      }
    }
  });

  it('is reproducible from (hole, seed)', () => {
    // A mined library stores puzzle ids, not geometry; the same id must
    // resolve to the same flag in another process or the content is lost.
    const a = pinSheet(prepared, 4242, { count: 6 });
    const b = pinSheet(prepared, 4242, { count: 6 });
    expect(a.map((p) => [p.at.x, p.at.y, p.zone])).toEqual(
      b.map((p) => [p.at.x, p.at.y, p.zone]),
    );
  });

  it('gives different sheets for different seeds', () => {
    const a = pinSheet(prepared, 1, { count: 6 });
    const b = pinSheet(prepared, 2, { count: 6 });
    expect(a.map((p) => p.at.x)).not.toEqual(b.map((p) => p.at.x));
  });

  it('spreads across the green rather than clustering', () => {
    const pins = pinSheet(prepared, 1000, { count: 6 });
    // A sheet of six flags all in the middle is six copies of one puzzle.
    expect(new Set(pins.map((p) => p.zone)).size).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        expect(dist(pins[i]!.at, pins[j]!.at)).toBeGreaterThan(PIN_COLLAR_YDS);
      }
    }
  });

  it('returns nothing rather than guessing when a hole has no green', () => {
    // Badly mapped OSM courses are the normal case, not the exception.
    const noGreen = prepareHole(
      holeFromYardSpec({
        id: 'no-green',
        courseName: 'Test',
        holeNumber: 1,
        par: 4,
        yardage: 400,
        origin: ORIGIN,
        polygons: [{ kind: 'fairway', ring: [[-30, 100], [30, 100], [30, 380], [-30, 380]] }],
        pin: [0, 400],
        tees: [[0, 0]],
      }),
    );
    expect(pinSheet(noGreen, 1000)).toEqual([]);
    expect(greenFrame(noGreen)).toBeNull();
  });

  it('yields fewer pins on a green too small to hold them', () => {
    // 6 yards of radius against a 4-yard collar leaves almost nothing.
    const tiny = greenHole(6);
    expect(pinSheet(tiny, 1000, { count: 8 }).length).toBeLessThan(8);
  });
});

describe('pinZone', () => {
  const prepared = greenHole();
  const frame = greenFrame(prepared)!;

  it('names positions from the tee, not from north', () => {
    // The player is playing due north here, so "back" is further from them
    // in +y. On a hole playing south the same +y point would be "front".
    expect(pinZone(frame, { x: 0, y: 400 })).toBe('middle');
    expect(pinZone(frame, { x: 0, y: 415 })).toBe('back');
    expect(pinZone(frame, { x: 0, y: 385 })).toBe('front');
    expect(pinZone(frame, { x: 15, y: 400 })).toBe('right');
    expect(pinZone(frame, { x: -15, y: 415 })).toBe('back-left');
  });

  it('is stated in the player frame, so a reversed hole reverses it', () => {
    const south = prepareHole(
      holeFromYardSpec({
        id: 'south',
        courseName: 'Test',
        holeNumber: 1,
        par: 4,
        yardage: 400,
        origin: ORIGIN,
        polygons: [{ kind: 'green', ring: circleRing(0, 0, 22) }],
        pin: [0, 0],
        tees: [[0, 400]],
      }),
    );
    const f = greenFrame(south)!;
    // +y is now TOWARD the player, so it reads front, not back.
    expect(pinZone(f, { x: 0, y: 15 })).toBe('front');
  });
});
