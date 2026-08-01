/**
 * Hole preparation and lie classification.
 *
 * prepareHole projects every polygon into the local yard frame once; the
 * Monte Carlo hot loop then classifies landing points with a bbox pre-check
 * followed by turf point-in-polygon (planar, so it works directly on the
 * projected coordinates). Anything inside no polygon is rough.
 */

import { booleanPointInPolygon } from '@turf/turf';
import { CLASSIFY_PRIORITY, KIND_TO_LIE, WATER_DROP_OFFSET_YDS } from './constants';
import { createProjection } from './projection';
import type {
  FeatureKind,
  HoleData,
  LandingLie,
  PreparedHole,
  ProjectedPolygon,
  Pt,
} from './types';

export function prepareHole(hole: HoleData): PreparedHole {
  const proj = createProjection(hole.imageryCenter);
  const polygons: ProjectedPolygon[] = [];
  const tees: Pt[] = [];
  let pin: Pt | null = null;

  for (const feature of hole.geojson.features) {
    if (feature.geometry.type === 'Point') {
      const [lon, lat] = feature.geometry.coordinates;
      const p = proj.toLocal({ lon: lon!, lat: lat! });
      if (feature.properties.kind === 'pin') pin = p;
      else tees.push(p);
      continue;
    }
    const kind = feature.properties.kind as FeatureKind;
    const rings = feature.geometry.coordinates.map((ring) =>
      ring.map(([lon, lat]) => proj.toLocal({ lon, lat })),
    );
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of rings[0] ?? []) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    polygons.push({
      kind,
      rings,
      bbox: { minX, minY, maxX, maxY },
      geometry: {
        type: 'Polygon',
        coordinates: rings.map((ring) => ring.map((p) => [p.x, p.y])),
      },
    });
  }

  if (!pin) throw new Error(`Hole ${hole.id} has no pin feature`);

  // Pre-sort by classification priority so the hot loop is a single pass.
  const rank = new Map(CLASSIFY_PRIORITY.map((k, i) => [k, i]));
  polygons.sort((a, b) => (rank.get(a.kind) ?? 99) - (rank.get(b.kind) ?? 99));

  return {
    hole,
    polygons,
    pin,
    tees,
    toLocal: proj.toLocal,
    toLonLat: proj.toLonLat,
  };
}

export interface ClassifiedPoint {
  lie: LandingLie;
  polygon: ProjectedPolygon | null;
}

const scratchPoint = { type: 'Point' as const, coordinates: [0, 0] as [number, number] };

export function classifyPointDetailed(prepared: PreparedHole, p: Pt): ClassifiedPoint {
  for (const poly of prepared.polygons) {
    const b = poly.bbox;
    if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) continue;
    scratchPoint.coordinates[0] = p.x;
    scratchPoint.coordinates[1] = p.y;
    if (booleanPointInPolygon(scratchPoint, poly.geometry)) {
      return { lie: KIND_TO_LIE[poly.kind], polygon: poly };
    }
  }
  return { lie: 'rough', polygon: null };
}

export function classifyPoint(prepared: PreparedHole, p: Pt): LandingLie {
  return classifyPointDetailed(prepared, p).lie;
}

/**
 * Penalty-drop approximation for water: the point where the ball-to-landing
 * segment first enters the water polygon, offset a few yards back toward
 * the ball, treated as rough by the caller.
 */
export function waterDropPoint(ball: Pt, landing: Pt, water: ProjectedPolygon): Pt {
  let bestT = Infinity;
  const dx = landing.x - ball.x;
  const dy = landing.y - ball.y;

  for (const ring of water.rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % n]!;
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-12) continue; // parallel
      const t = ((a.x - ball.x) * ey - (a.y - ball.y) * ex) / denom;
      const s = ((a.x - ball.x) * dy - (a.y - ball.y) * dx) / denom;
      if (t >= 0 && t <= 1 && s >= 0 && s <= 1 && t < bestT) bestT = t;
    }
  }

  let entry: Pt;
  if (Number.isFinite(bestT)) {
    entry = { x: ball.x + bestT * dx, y: ball.y + bestT * dy };
  } else {
    // Ball started inside the hazard footprint or numeric miss: fall back to
    // the ring vertex nearest the landing point.
    let best: Pt = water.rings[0]![0]!;
    let bestD = Infinity;
    for (const ring of water.rings) {
      for (const v of ring) {
        const d = (v.x - landing.x) ** 2 + (v.y - landing.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = v;
        }
      }
    }
    entry = best;
  }

  const bx = ball.x - entry.x;
  const by = ball.y - entry.y;
  const len = Math.hypot(bx, by);
  if (len < 1e-9) return { ...entry };
  return {
    x: entry.x + (bx / len) * WATER_DROP_OFFSET_YDS,
    y: entry.y + (by / len) * WATER_DROP_OFFSET_YDS,
  };
}
