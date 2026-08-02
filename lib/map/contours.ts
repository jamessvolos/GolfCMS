/**
 * Isoline extraction from an evaluation grid: d3-contour marching squares at
 * the sgLoss levels, clipped to the search sector, with rings split into
 * stroke polylines so contours END at the data boundary instead of drawing
 * it. Shared by the reveal renderer, the engine worker, and the preview
 * exporter. Everything is in local yards.
 */

import { contours as d3contours } from 'd3-contour';
import { featureCollection, intersect } from '@turf/turf';
import { maxCarry } from '@/lib/engine/clubs';
import {
  GRID_BEYOND_PIN_MARGIN_YDS,
  GRID_MIN_REACH_YDS,
  GRID_REACH_FACTOR,
  GRID_SECTOR_HALF_ANGLE_DEG,
} from '@/lib/engine/constants';
import { dist } from '@/lib/engine/projection';
import type { EvalGrid, PlayableLie, PlayerProfile, Pt } from '@/lib/engine/types';

export interface ContourLevel {
  /** sgLoss above optimal for this line. */
  level: number;
  /** Open polylines to stroke (clipped, boundary segments removed). */
  strokes: Pt[][];
  /** Closed rings (with holes) for region fills — e.g. the danger wash. */
  rings: Pt[][];
}

export interface ContourSet {
  levels: ContourLevel[];
  optimalE: number;
}

export const DEFAULT_CONTOUR_LEVELS = [0.03, 0.1, 0.25, 0.5, 1.0];

type Ring = [number, number][];

function wedgeRing(ball: Pt, bearing: number, halfAngle: number, radius: number): Ring {
  const ring: Ring = [[ball.x, ball.y]];
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const a = bearing - halfAngle + (2 * halfAngle * i) / steps;
    ring.push([ball.x + radius * Math.sin(a), ball.y + radius * Math.cos(a)]);
  }
  ring.push([ball.x, ball.y]);
  return ring;
}

export function contoursFromGrid(
  grid: EvalGrid,
  ball: Pt,
  pin: Pt,
  profile: PlayerProfile,
  lie: PlayableLie,
  levels: number[] = DEFAULT_CONTOUR_LEVELS,
): ContourSet {
  // Crop to the finite region to keep marching squares tight.
  let minCol = grid.width;
  let maxCol = -1;
  let minRow = grid.height;
  let maxRow = -1;
  for (let row = 0; row < grid.height; row++) {
    for (let col = 0; col < grid.width; col++) {
      if (Number.isFinite(grid.values[row * grid.width + col])) {
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
      }
    }
  }
  if (maxCol < minCol) return { levels: [], optimalE: grid.optimal.expectedStrokes };

  const w = maxCol - minCol + 1;
  const h = maxRow - minRow + 1;
  const optimalE = grid.optimal.expectedStrokes;
  const SENTINEL = optimalE + 9;
  const data = new Array<number>(w * h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const v = grid.values[(row + minRow) * grid.width + (col + minCol)]!;
      data[row * w + col] = Number.isFinite(v) ? v : SENTINEL;
    }
  }
  const originX = grid.origin.x + minCol * grid.cellSize;
  const originY = grid.origin.y + minRow * grid.cellSize;

  // Same sector the optimizer searched, slightly inset for clipping.
  const reach = maxCarry(profile, lie);
  const distToPin = dist(ball, pin);
  const maxR = Math.max(
    GRID_MIN_REACH_YDS,
    Math.min(reach * GRID_REACH_FACTOR, distToPin + GRID_BEYOND_PIN_MARGIN_YDS),
  );
  const bearing = Math.atan2(pin.x - ball.x, pin.y - ball.y);
  const halfAngle = ((GRID_SECTOR_HALF_ANGLE_DEG - 1.5) * Math.PI) / 180;
  const rClip = maxR - grid.cellSize;
  const wedge = {
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'Polygon' as const, coordinates: [wedgeRing(ball, bearing, halfAngle, rClip)] },
  };

  const interior = ([x, y]: [number, number]) => {
    const dx = x - ball.x;
    const dy = y - ball.y;
    const r = Math.hypot(dx, dy);
    if (r < 3 || r > rClip - 0.8) return false;
    let da = Math.atan2(dx, dy) - bearing;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    return Math.abs(da) < halfAngle - 0.008;
  };

  const thresholds = levels.map((l) => optimalE + l);
  const raw = d3contours().size([w, h]).thresholds(thresholds)(data);

  const result: ContourLevel[] = raw.map((c, i) => {
    const toYards = ([x, y]: number[]): [number, number] => [
      originX + (x! - 0.5) * grid.cellSize,
      originY + (y! - 0.5) * grid.cellSize,
    ];
    const geom = {
      type: 'MultiPolygon' as const,
      coordinates: c.coordinates.map((poly) => poly.map((ring) => ring.map(toYards))),
    };

    let rings: Ring[] = [];
    if (geom.coordinates.length > 0) {
      const hit = intersect(
        featureCollection([{ type: 'Feature', properties: {}, geometry: geom }, wedge] as never),
      );
      if (hit) {
        const g = hit.geometry;
        const polys =
          g.type === 'Polygon'
            ? [g.coordinates as Ring[]]
            : (g.coordinates as Ring[][]);
        rings = polys.flat();
      }
    }

    const strokes: Ring[] = [];
    for (const ring of rings) {
      let run: Ring = [];
      for (const v of ring) {
        if (interior(v)) {
          run.push(v);
        } else {
          if (run.length > 1) strokes.push(run);
          run = [];
        }
      }
      if (run.length > 1) strokes.push(run);
    }

    return {
      level: levels[i]!,
      strokes: strokes.map((s) => s.map(([x, y]) => ({ x, y }))),
      rings: rings.map((s) => s.map(([x, y]) => ({ x, y }))),
    };
  });

  return { levels: result, optimalE };
}
