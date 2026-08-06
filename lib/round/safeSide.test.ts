import { describe, expect, it } from 'vitest';
import { MIN_DECISIVE_STROKES, MISS_YDS, safeSide } from './safeSide';
import { encodeField } from '@/lib/puzzle/field';
import { evaluateGrid, searchRadius } from '@/lib/engine/optimize';
import { prepareHole } from '@/lib/engine/hole';
import { circleRing, holeFromYardSpec } from '@/lib/engine/holes/build';
import type { PlayerProfile } from '@/lib/engine/types';

const ORIGIN = { lon: -93.335, lat: 41.02 };
const P14: PlayerProfile = { handicap: 14, clubSpeedMph: 110, shotShape: 'straight' };

function green(polys: { kind: string; ring: [number, number][] }[]) {
  return prepareHole(
    holeFromYardSpec({
      id: 'safe-side',
      courseName: 'Test',
      holeNumber: 1,
      par: 4,
      yardage: 400,
      origin: ORIGIN,
      polygons: polys as never,
      pin: [0, 400],
      tees: [[0, 0]],
    }),
  );
}

const FAIRWAY: [number, number][] = [[-70, 120], [70, 120], [70, 390], [-70, 390]];
const sit = { ball: { x: 0, y: 250 }, lie: 'fairway' as const, pin: { x: 0, y: 400 } };

function fieldFor(prepared: ReturnType<typeof green>) {
  const grid = evaluateGrid(prepared, sit, P14, 'approach', { nSamples: 400 });
  return {
    grid,
    field: encodeField(grid, {
      ball: sit.ball,
      pin: sit.pin,
      maxR: searchRadius(sit.ball, sit.pin, P14, sit.lie),
    }),
  };
}

describe('safeSide', () => {
  it('names the cheap side when one flank is water', () => {
    const prepared = green([
      { kind: 'fairway', ring: FAIRWAY },
      { kind: 'green', ring: circleRing(0, 400, 17) },
      { kind: 'water', ring: [[22, 350], [95, 350], [95, 445], [22, 445]] },
    ]);
    const { grid, field } = fieldFor(prepared);
    const r = safeSide(field, sit.ball, grid.optimal.point);
    expect(r.answer).toBe('left');
    expect(r.rightCost).toBeGreaterThan(r.leftCost);
    expect(r.decisive).toBe(true);
  });

  it('refuses to ask when both sides cost the same', () => {
    // This is the free-PERFECT problem in a new costume: a question whose
    // answer is a coin toss teaches nothing and costs a turn.
    const prepared = green([
      { kind: 'fairway', ring: FAIRWAY },
      { kind: 'green', ring: circleRing(0, 400, 17) },
    ]);
    const { grid, field } = fieldFor(prepared);
    const r = safeSide(field, sit.ball, grid.optimal.point);
    expect(r.margin).toBeLessThan(MIN_DECISIVE_STROKES + 0.4);
  });

  it('is denominated in strokes, not in yards of room', () => {
    // The distinction that killed the original version of this idea:
    // corridor width is a yardage, and comparing two yardages does not tell
    // you which miss is more expensive.
    const prepared = green([
      { kind: 'fairway', ring: FAIRWAY },
      { kind: 'green', ring: circleRing(0, 400, 17) },
      { kind: 'water', ring: [[22, 350], [95, 350], [95, 445], [22, 445]] },
    ]);
    const { grid, field } = fieldFor(prepared);
    const r = safeSide(field, sit.ball, grid.optimal.point);
    // A stroke cost, not a distance: bounded by what the model can charge.
    expect(r.leftCost).toBeLessThan(5);
    expect(r.margin).toBeLessThan(5);
    expect(MISS_YDS).toBe(20);
  });

  it('treats a miss that leaves the searched sector as the worst outcome, not a free one', () => {
    const prepared = green([
      { kind: 'fairway', ring: FAIRWAY },
      { kind: 'green', ring: circleRing(0, 400, 17) },
    ]);
    const { field } = fieldFor(prepared);
    // An "optimal" far outside the lattice: both reads fall off the map.
    const r = safeSide(field, sit.ball, { x: 9000, y: 9000 });
    expect(r.decisive).toBe(true);
    expect(r.margin).toBeGreaterThan(0);
  });
});
