import { describe, expect, it } from 'vitest';
import { distance as turfDistance } from '@turf/turf';
import { createProjection, dist } from './projection';

const ORIGIN = { lon: -93.335, lat: 41.02 };
const YDS_PER_KM = 1093.6132983377078;

describe('createProjection', () => {
  it('maps the origin to (0, 0)', () => {
    const proj = createProjection(ORIGIN);
    const p = proj.toLocal(ORIGIN);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });

  it('round-trips points within numerical noise', () => {
    const proj = createProjection(ORIGIN);
    for (const pt of [
      { x: 0, y: 0 },
      { x: 137.2, y: -260.4 },
      { x: -410, y: 388 },
      { x: 3.25, y: 512 },
    ]) {
      const back = proj.toLocal(proj.toLonLat(pt));
      expect(back.x).toBeCloseTo(pt.x, 6);
      expect(back.y).toBeCloseTo(pt.y, 6);
    }
  });

  it('agrees with turf geodesic distance going north', () => {
    const proj = createProjection(ORIGIN);
    const ll = proj.toLonLat({ x: 0, y: 500 });
    const yds =
      turfDistance([ORIGIN.lon, ORIGIN.lat], [ll.lon, ll.lat], { units: 'kilometers' }) *
      YDS_PER_KM;
    expect(Math.abs(yds - 500) / 500).toBeLessThan(0.002);
  });

  it('agrees with turf geodesic distance going east', () => {
    const proj = createProjection(ORIGIN);
    const ll = proj.toLonLat({ x: 500, y: 0 });
    const yds =
      turfDistance([ORIGIN.lon, ORIGIN.lat], [ll.lon, ll.lat], { units: 'kilometers' }) *
      YDS_PER_KM;
    expect(Math.abs(yds - 500) / 500).toBeLessThan(0.005);
  });
});

describe('dist', () => {
  it('computes planar distance in yards', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5, 9);
  });
});
