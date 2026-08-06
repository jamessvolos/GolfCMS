import { describe, expect, it } from 'vitest';
import {
  clusterCourses,
  MIN_HOLES_PER_COURSE,
  pickNearestHoleWay,
  tileQuery,
  tiles,
  TILE_LAT,
  TILE_LON,
} from './discover';

const hole = (lat: number, lon: number, ref: string, extra: Record<string, string> = {}) => ({
  type: 'way',
  id: 1,
  center: { lat, lon },
  tags: { golf: 'hole', ref, ...extra },
});

describe('tiles', () => {
  it('splits a region into boxes Overpass will answer', () => {
    // Measured: a 0.5x0.9 box returns 2404 hole ways in 3.2s; Great Britain
    // and the US Northeast both return 504, every time.
    const boxes = tiles({ south: 50, west: -5, north: 52, east: 1 });
    expect(boxes.length).toBeGreaterThan(1);
    for (const b of boxes) {
      expect(b.north - b.south).toBeLessThanOrEqual(TILE_LAT + 1e-9);
      expect(b.east - b.west).toBeLessThanOrEqual(TILE_LON + 1e-9);
    }
  });

  it('covers the region without leaving a gap', () => {
    const region = { south: 50, west: -5, north: 51.2, east: -3.1 };
    const boxes = tiles(region);
    expect(Math.min(...boxes.map((b) => b.south))).toBeCloseTo(region.south, 9);
    expect(Math.max(...boxes.map((b) => b.north))).toBeCloseTo(region.north, 9);
    expect(Math.max(...boxes.map((b) => b.east))).toBeCloseTo(region.east, 9);
  });

  it('asks for hole centrelines, never for course polygons', () => {
    // way[leisure=golf_course] over the same box returns 504 every time;
    // the hole way is what Overpass will actually serve and what the
    // assembler needs anyway.
    const q = tileQuery({ south: 51.2, west: -0.6, north: 51.7, east: 0.3 });
    expect(q).toContain('"golf"="hole"');
    expect(q).not.toContain('golf_course');
    expect(q).toContain('out ids center tags');
  });
});

describe('clusterCourses', () => {
  it('groups nearby hole centrelines into a course', () => {
    const els = Array.from({ length: 18 }, (_, i) =>
      hole(51.42 + i * 0.0002, -0.259 + i * 0.0002, String(i + 1), { par: '4' }),
    );
    const courses = clusterCourses(els);
    expect(courses).toHaveLength(1);
    expect(courses[0]!.holeNumbers).toHaveLength(18);
    expect(courses[0]!.parTagged).toBe(18);
  });

  it('drops a cluster too small to be a golf course', () => {
    const els = Array.from({ length: MIN_HOLES_PER_COURSE - 1 }, (_, i) =>
      hole(51.42, -0.259, String(i + 1)),
    );
    expect(clusterCourses(els)).toEqual([]);
  });

  it('ignores ways with no usable hole number', () => {
    const els = [
      ...Array.from({ length: 9 }, (_, i) => hole(51.42, -0.259, String(i + 1))),
      hole(51.42, -0.259, 'practice'),
      hole(51.42, -0.259, '27'),
      { type: 'way', id: 2, tags: { golf: 'hole', ref: '1' } }, // no centre
    ];
    const courses = clusterCourses(els);
    expect(courses[0]!.holeNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('is deterministic, so a re-harvest matches', () => {
    const els = Array.from({ length: 18 }, (_, i) => hole(51.42, -0.259 + i * 0.0002, String(i + 1)));
    expect(clusterCourses(els)).toEqual(clusterCourses([...els].reverse()));
  });
});

describe('pickNearestHoleWay', () => {
  const centre = { lat: 51.42, lon: -0.259 };
  const way = (pts: [number, number][]) => ({
    geometry: pts.map(([lat, lon]) => ({ lat, lon })),
  });

  it('takes the only candidate', () => {
    const a = way([[51.42, -0.259], [51.423, -0.259]]);
    expect(pickNearestHoleWay([a], centre).chosen).toBe(a);
  });

  it('refuses a candidate on another continent', () => {
    // The failure the guard exists for: a name-scoped query for Carnoustie
    // hole 12 once returned four ways, one of them in British Columbia.
    const bc = way([[49.2, -123.1], [49.21, -123.1]]);
    const r = pickNearestHoleWay([bc, bc], centre);
    expect(r.chosen).toBeNull();
    expect(r.note).toContain('none within');
  });

  it('takes the longest centreline when several are on the same course', () => {
    // A hole digitised in segments has one way that is the hole and several
    // that are fragments of it. Refusing outright cost 27 of 36 holes on a
    // real mined course.
    const short = way([[51.42, -0.259], [51.4205, -0.259]]);
    const long = way([[51.42, -0.259], [51.424, -0.259]]);
    const r = pickNearestHoleWay([short, long], centre);
    expect(r.chosen).toBe(long);
    expect(r.note).toContain('longest centreline');
  });

  it('returns nothing for an empty candidate list', () => {
    expect(pickNearestHoleWay([], centre).chosen).toBeNull();
  });
});
