import { describe, expect, it } from 'vitest';
import { drawSituations, MIN_SITUATION_YDS } from './situations';
import { classifyPoint, prepareHole } from '@/lib/engine/hole';
import { circleRing, holeFromYardSpec } from '@/lib/engine/holes/build';
import { dist } from '@/lib/engine/projection';
import type { PlayerProfile } from '@/lib/engine/types';

const ORIGIN = { lon: -93.335, lat: 41.02 };
const P14: PlayerProfile = { handicap: 14, clubSpeedMph: 110, shotShape: 'straight' };
const P26: PlayerProfile = { handicap: 26, clubSpeedMph: 95, shotShape: 'fade' };

/** A par 4 with a narrow fairway, so dispersion actually finds the rough. */
function narrowPar4() {
  return prepareHole(
    holeFromYardSpec({
      id: 'narrow',
      courseName: 'Test',
      holeNumber: 1,
      par: 4,
      yardage: 420,
      origin: ORIGIN,
      polygons: [
        { kind: 'fairway', ring: [[-18, 120], [18, 120], [18, 400], [-18, 400]] },
        { kind: 'green', ring: circleRing(0, 420, 16) },
        { kind: 'bunker', ring: circleRing(26, 260, 9) },
      ],
      pin: [0, 420],
      tees: [[0, 0]],
    }),
  );
}

describe('drawSituations', () => {
  const prepared = narrowPar4();

  it('starts every situation somewhere a shot could actually finish', () => {
    const sits = drawSituations(prepared, P14, 99, { passes: 20 });
    expect(sits.length).toBeGreaterThan(2);
    for (const s of sits) {
      const lie = classifyPoint(prepared, s.ball);
      expect(['tee', 'fairway', 'rough', 'sand', 'recovery']).toContain(lie);
      expect(s.lie).toBe(s.shotIndex === 1 ? 'tee' : lie);
    }
  });

  it('never proposes a chip as a course-management decision', () => {
    for (const s of drawSituations(prepared, P14, 3, { passes: 20 })) {
      expect(dist(s.ball, prepared.pin)).toBeGreaterThanOrEqual(MIN_SITUATION_YDS);
    }
  });

  it('produces lies the old derivation could not', () => {
    // The point of the whole wave. The shipped library has 4 of 36 puzzles
    // starting anywhere other than the tee or the fairway, because it placed
    // the ball where the optimizer AIMED — and the optimizer never aims at a
    // bunker. Dispersion does.
    const sits = drawSituations(prepared, P26, 12345, { passes: 60 });
    const lies = new Set(sits.map((s) => s.lie));
    expect(lies.has('tee')).toBe(true);
    expect(lies.size).toBeGreaterThan(1);
    expect(sits.some((s) => s.lie !== 'tee' && s.lie !== 'fairway')).toBe(true);
  });

  it('is reproducible from a seed, across processes', () => {
    const a = drawSituations(prepared, P14, 777, { passes: 15 });
    const b = drawSituations(prepared, P14, 777, { passes: 15 });
    expect(a.map((s) => [s.ball.x, s.ball.y, s.lie, s.category])).toEqual(
      b.map((s) => [s.ball.x, s.ball.y, s.lie, s.category]),
    );
  });

  it('gives a different player different situations', () => {
    // A 26-handicap does not end up where a 14 does, so the content a
    // player is offered is derived from their own dispersion.
    const a = drawSituations(prepared, P14, 777, { passes: 15 });
    const b = drawSituations(prepared, P26, 777, { passes: 15 });
    expect(a.map((s) => s.ball.x)).not.toEqual(b.map((s) => s.ball.x));
  });

  it('deduplicates situations a player could not tell apart', () => {
    // Twenty passes down one hole produce many near-identical approaches;
    // shipping them all is one puzzle twenty times.
    const coarse = drawSituations(prepared, P14, 5, { passes: 40, distanceBandYds: 60, lateralBandYds: 60 });
    const fine = drawSituations(prepared, P14, 5, { passes: 40, distanceBandYds: 5, lateralBandYds: 5 });
    expect(coarse.length).toBeLessThan(fine.length);
  });

  it('does not start a puzzle where the player would be taking a drop', () => {
    const watery = prepareHole(
      holeFromYardSpec({
        id: 'watery',
        courseName: 'Test',
        holeNumber: 1,
        par: 4,
        yardage: 420,
        origin: ORIGIN,
        polygons: [
          { kind: 'fairway', ring: [[-18, 120], [18, 120], [18, 400], [-18, 400]] },
          { kind: 'water', ring: [[-200, 150], [200, 150], [200, 380], [-200, 380]] },
          { kind: 'green', ring: circleRing(0, 420, 16) },
        ],
        pin: [0, 420],
        tees: [[0, 0]],
      }),
    );
    for (const s of drawSituations(watery, P14, 11, { passes: 25 })) {
      expect(classifyPoint(watery, s.ball)).not.toBe('water');
      expect(classifyPoint(watery, s.ball)).not.toBe('ob');
    }
  });

  it('returns nothing for a hole with no tee rather than inventing one', () => {
    const teeless = { ...prepared, tees: [] };
    expect(drawSituations(teeless, P14, 1)).toEqual([]);
  });
});
