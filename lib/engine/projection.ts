/**
 * Equirectangular projection between lon/lat and a local planar frame in
 * yards. Accurate to well under 0.5% at golf-hole scale (< 1000 yards),
 * which is far below the noise floor of the dispersion model.
 */

import type { LonLat, Pt } from './types';

const METERS_PER_DEG_LAT = 111_320;
const YARDS_PER_METER = 1 / 0.9144;
export const YARDS_PER_DEG_LAT = METERS_PER_DEG_LAT * YARDS_PER_METER;

export interface Projection {
  origin: LonLat;
  toLocal: (p: LonLat) => Pt;
  toLonLat: (p: Pt) => LonLat;
}

export function createProjection(origin: LonLat): Projection {
  const latRad = (origin.lat * Math.PI) / 180;
  const yardsPerDegLon = YARDS_PER_DEG_LAT * Math.cos(latRad);
  return {
    origin,
    toLocal: (p) => ({
      x: (p.lon - origin.lon) * yardsPerDegLon,
      y: (p.lat - origin.lat) * YARDS_PER_DEG_LAT,
    }),
    toLonLat: (p) => ({
      lon: origin.lon + p.x / yardsPerDegLon,
      lat: origin.lat + p.y / YARDS_PER_DEG_LAT,
    }),
  };
}

/** Planar distance in yards. */
export function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
