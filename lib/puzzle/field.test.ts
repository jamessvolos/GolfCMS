import { describe, expect, it } from 'vitest';
import {
  decodeField,
  encodeField,
  FIELD_CEILING,
  FIELD_QUANTUM,
  gridFromField,
  sampleField,
} from './field';
import { contoursFromGrid } from '@/lib/map/contours';
import { evaluateGrid, searchRadius } from '@/lib/engine/optimize';
import { prepareHole } from '@/lib/engine/hole';
import { circleRing, holeFromYardSpec } from '@/lib/engine/holes/build';
import type { PlayerProfile } from '@/lib/engine/types';

const ORIGIN = { lon: -93.335, lat: 41.02 };
const P14: PlayerProfile = { handicap: 14, clubSpeedMph: 110, shotShape: 'straight' };

function testHole() {
  return prepareHole(
    holeFromYardSpec({
      id: 'field-test',
      courseName: 'Test',
      holeNumber: 1,
      par: 4,
      yardage: 400,
      origin: ORIGIN,
      polygons: [
        { kind: 'fairway', ring: [[-28, 100], [28, 100], [28, 380], [-28, 380]] },
        { kind: 'green', ring: circleRing(0, 400, 16) },
        { kind: 'water', ring: [[20, 330], [90, 330], [90, 430], [20, 430]] },
      ],
      pin: [0, 400],
      tees: [[0, 0]],
    }),
  );
}

const sit = { ball: { x: 0, y: 240 }, lie: 'fairway' as const, pin: { x: 0, y: 400 } };
const clipFor = () => ({
  ball: sit.ball,
  pin: sit.pin,
  maxR: searchRadius(sit.ball, sit.pin, P14, sit.lie),
});

describe('encodeField / decodeField', () => {
  const prepared = testHole();
  const grid = evaluateGrid(prepared, sit, P14, 'approach', { nSamples: 300 });

  it('round-trips every evaluated cell within the quantum', () => {
    const field = encodeField(grid, clipFor());
    const back = decodeField(field);
    let checked = 0;
    for (let i = 0; i < grid.values.length; i++) {
      const v = grid.values[i]!;
      if (!Number.isFinite(v)) {
        expect(Number.isNaN(back[i]!)).toBe(true);
        continue;
      }
      // Cells more than the ceiling above optimal are clamped on purpose;
      // "unplayable" needs no resolution.
      if (v - grid.optimal.expectedStrokes > FIELD_CEILING) continue;
      expect(Math.abs(back[i]! - v)).toBeLessThanOrEqual(FIELD_QUANTUM);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('never reports a cell as better than the optimal', () => {
    // The optimal is an argmin over the same lattice, so nothing should sit
    // below it — and a wrapped byte would draw catastrophe as the best line.
    const back = decodeField(encodeField(grid, clipFor()));
    for (const v of back) {
      if (Number.isFinite(v)) expect(v).toBeGreaterThanOrEqual(grid.optimal.expectedStrokes - 1e-9);
    }
  });

  it('costs a fraction of the picture drawn from it', () => {
    // Measured across the seeded library: contours are 93% of a cached
    // GridSummary. Storing the numbers instead took the median row from
    // 37.2 KB to 10.8 KB.
    const field = encodeField(grid, clipFor());
    const contours = contoursFromGrid(grid, sit.ball, sit.pin, P14, sit.lie);
    expect(JSON.stringify(field).length).toBeLessThan(JSON.stringify(contours).length);
  });
});

describe('sampleField', () => {
  const prepared = testHole();
  const grid = evaluateGrid(prepared, sit, P14, 'approach', { nSamples: 300 });
  const field = encodeField(grid, clipFor());
  const values = decodeField(field);

  it('reads the optimal aim as the cheapest place on the field', () => {
    const atOptimal = sampleField(field, values, grid.optimal.point);
    expect(atOptimal).toBeGreaterThanOrEqual(grid.optimal.expectedStrokes - 1e-9);
    expect(atOptimal).toBeLessThan(grid.optimal.expectedStrokes + 0.15);
  });

  it('costs more as you walk toward the water', () => {
    const near = sampleField(field, values, { x: grid.optimal.point.x + 6, y: grid.optimal.point.y });
    const far = sampleField(field, values, { x: grid.optimal.point.x + 30, y: grid.optimal.point.y });
    if (Number.isFinite(near) && Number.isFinite(far)) expect(far).toBeGreaterThan(near);
  });

  it('returns NaN outside the searched sector rather than guessing', () => {
    expect(Number.isNaN(sampleField(field, values, { x: 5000, y: 5000 }))).toBe(true);
  });
});

describe('redrawing contours from a stored field', () => {
  const prepared = testHole();
  const grid = evaluateGrid(prepared, sit, P14, 'approach', { nSamples: 300 });

  it('reproduces the contour levels the grid itself would draw', () => {
    // This is the property the cache rewrite rests on: the picture is
    // recoverable from the numbers, so only the numbers need storing.
    const direct = contoursFromGrid(grid, sit.ball, sit.pin, P14, sit.lie);
    const field = encodeField(grid, clipFor());
    const rebuilt = gridFromField(field, grid.optimal, grid.naive, grid.trapSize, grid.trapSe);
    const redrawn = contoursFromGrid(
      rebuilt,
      field.clip.ball,
      field.clip.pin,
      { handicap: 0, clubSpeedMph: 100, shotShape: 'straight' },
      'fairway',
      undefined,
      field.clip.maxR,
    );

    expect(redrawn.optimalE).toBeCloseTo(direct.optimalE, 9);
    expect(redrawn.levels.map((l) => l.level)).toEqual(direct.levels.map((l) => l.level));
    for (const [i, level] of direct.levels.entries()) {
      const other = redrawn.levels[i]!;
      // Quantisation moves a boundary by at most one contour step, so ring
      // counts can differ by one where a level grazes the edge — but the
      // shape has to be substantially the same.
      expect(Math.abs(other.rings.length - level.rings.length)).toBeLessThanOrEqual(1);
    }
  });

  it('clips to the sector the grid actually searched, not the reader profile', () => {
    // A cached grid is read by whichever profile asks for it. Re-deriving
    // the wedge from that profile would clip the stored numbers with the
    // wrong edge.
    const field = encodeField(grid, clipFor());
    expect(field.clip.maxR).toBeCloseTo(searchRadius(sit.ball, sit.pin, P14, sit.lie), 9);
  });
});
