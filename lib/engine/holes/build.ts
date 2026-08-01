/**
 * Author holes in local yard coordinates (tee at or near the origin, +y
 * toward the green) and convert to GeoJSON lon/lat for storage.
 *
 * The spec origin doubles as the hole's imageryCenter, so prepareHole
 * reprojects into exactly the frame the hole was authored in.
 */

import { createProjection } from '../projection';
import type {
  FeatureKind,
  HoleData,
  HoleGeoJSON,
  HolePointFeature,
  HolePolygonFeature,
  LonLat,
} from '../types';

export interface YardHoleSpec {
  id: string;
  courseName: string;
  holeNumber: number;
  par: number;
  yardage: number;
  /** Lon/lat anchoring the local yard frame (its (0,0)). */
  origin: LonLat;
  polygons: { kind: FeatureKind; ring: [number, number][]; name?: string }[];
  pin: [number, number];
  tees: [number, number][];
}

/** Approximate a circle as a polygon ring (open; the builder closes rings). */
export function circleRing(
  cx: number,
  cy: number,
  r: number,
  segments = 24,
): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI * i) / segments;
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return ring;
}

export function holeFromYardSpec(spec: YardHoleSpec): HoleData {
  const proj = createProjection(spec.origin);
  const toCoord = ([x, y]: [number, number]): [number, number] => {
    const ll = proj.toLonLat({ x, y });
    return [ll.lon, ll.lat];
  };

  const polygonFeatures: HolePolygonFeature[] = spec.polygons.map((p) => {
    const ring = p.ring.map(toCoord);
    const [fx, fy] = ring[0]!;
    const [lx, ly] = ring[ring.length - 1]!;
    if (fx !== lx || fy !== ly) ring.push([fx, fy]);
    return {
      type: 'Feature',
      properties: { kind: p.kind, ...(p.name ? { name: p.name } : {}) },
      geometry: { type: 'Polygon', coordinates: [ring] },
    };
  });

  const pointFeatures: HolePointFeature[] = [
    {
      type: 'Feature',
      properties: { kind: 'pin' },
      geometry: { type: 'Point', coordinates: toCoord(spec.pin) },
    },
    ...spec.tees.map(
      (t): HolePointFeature => ({
        type: 'Feature',
        properties: { kind: 'tee' },
        geometry: { type: 'Point', coordinates: toCoord(t) },
      }),
    ),
  ];

  const geojson: HoleGeoJSON = {
    type: 'FeatureCollection',
    features: [...polygonFeatures, ...pointFeatures],
  };

  return {
    id: spec.id,
    courseName: spec.courseName,
    holeNumber: spec.holeNumber,
    par: spec.par,
    yardage: spec.yardage,
    geojson,
    imageryCenter: spec.origin,
  };
}
