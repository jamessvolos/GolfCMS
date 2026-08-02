/**
 * Export a JSON bundle for the Milestone 1 visual preview (and, later, the
 * Milestone 2 renderer): per-profile expected-strokes contours over the cape
 * hole, optimal/naive aims with stats, dispersion ellipses, and the cropped
 * evaluation grid for hover readouts.
 *
 *   npx tsx scripts/export-preview.ts <output.json>
 */

import { writeFileSync } from 'node:fs';
import { contours as d3contours } from 'd3-contour';
import { featureCollection, intersect } from '@turf/turf';
import { allowedClubs, maxCarry } from '../lib/engine/clubs';
import {
  GRID_BEYOND_PIN_MARGIN_YDS,
  GRID_MIN_REACH_YDS,
  GRID_REACH_FACTOR,
  GRID_SECTOR_HALF_ANGLE_DEG,
} from '../lib/engine/constants';
import { dispersionParams } from '../lib/engine/dispersion';
import { evaluateGrid } from '../lib/engine/optimize';
import { prepareHole } from '../lib/engine/hole';
import { capeHole, CAPE_APPROACH, CAPE_TEE } from '../lib/engine/holes/cape';
import type { YardPuzzle } from '../lib/engine/holes/cape';
import { puzzleRatingFromTrap } from '../lib/engine/scoring';
import { dist } from '../lib/engine/projection';
import type { EvalGrid, EvalResult, PlayerProfile, PreparedHole, Pt } from '../lib/engine/types';

const LEVELS = [0.03, 0.1, 0.25, 0.5, 1.0];
const N_SAMPLES = 2000;

const PROFILES: { key: string; label: string; profile: PlayerProfile }[] = [
  { key: 'h5', label: '5 hcp', profile: { handicap: 5, clubSpeedMph: 110, shotShape: 'draw' } },
  { key: 'h14', label: '14 hcp', profile: { handicap: 14, clubSpeedMph: 110, shotShape: 'draw' } },
  { key: 'h20', label: '20 hcp', profile: { handicap: 20, clubSpeedMph: 110, shotShape: 'draw' } },
];

const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

type Ring = [number, number][];

function wedgePolygon(ball: Pt, bearing: number, halfAngle: number, radius: number): Ring {
  const ring: Ring = [[r1(ball.x), r1(ball.y)]];
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const a = bearing - halfAngle + (2 * halfAngle * i) / steps;
    ring.push([r1(ball.x + radius * Math.sin(a)), r1(ball.y + radius * Math.cos(a))]);
  }
  ring.push(ring[0]!);
  return ring;
}

/** MultiPolygon coordinates → flat list of rings, rounded. */
function ringsOf(geom: { type: string; coordinates: unknown }): Ring[] {
  const polys =
    geom.type === 'Polygon'
      ? [geom.coordinates as [number, number][][]]
      : (geom.coordinates as [number, number][][][]);
  const out: Ring[] = [];
  for (const poly of polys) {
    for (const ring of poly) out.push(ring.map(([x, y]) => [r1(x), r1(y)] as [number, number]));
  }
  return out;
}

function breakdown(result: EvalResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(result.outcomeStats.lieBreakdown)) {
    if ((v ?? 0) >= 0.005) out[k] = Math.round((v ?? 0) * 100);
  }
  return out;
}

function ellipseAt(
  prepared: PreparedHole,
  ball: Pt,
  lie: YardPuzzle['lie'],
  profile: PlayerProfile,
  aim: Pt,
) {
  const d = Math.max(0.5, dist(ball, aim));
  const params = dispersionParams(profile, lie, d);
  const ux = (aim.x - ball.x) / d;
  const uy = (aim.y - ball.y) / d;
  // Landing center = aim shifted by the shape bias along the right-perp.
  return {
    cx: r1(aim.x + uy * params.meanLat),
    cy: r1(aim.y - ux * params.meanLat),
    rLat: r1(params.sigmaLat),
    rLong: r1(params.sigmaLong),
    bearingDeg: r1((Math.atan2(aim.x - ball.x, aim.y - ball.y) * 180) / Math.PI),
  };
}

function exportCombo(
  prepared: PreparedHole,
  puzzle: YardPuzzle,
  profile: PlayerProfile,
) {
  const sit = { ball: puzzle.ball, lie: puzzle.lie, pin: prepared.pin };
  const grid: EvalGrid = evaluateGrid(prepared, sit, profile, puzzle.category, {
    nSamples: N_SAMPLES,
  });

  // Crop to the finite region so the hover grid and contours stay compact.
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
  const w = maxCol - minCol + 1;
  const h = maxRow - minRow + 1;
  const optimalE = grid.optimal.expectedStrokes;
  const SENTINEL = optimalE + 9;
  const cropped = new Float64Array(w * h);
  const deltas: (number | null)[] = new Array(w * h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const v = grid.values[(row + minRow) * grid.width + (col + minCol)]!;
      cropped[row * w + col] = Number.isFinite(v) ? v : SENTINEL;
      deltas[row * w + col] = Number.isFinite(v) ? r3(v - optimalE) : null;
    }
  }
  const originX = grid.origin.x + minCol * grid.cellSize;
  const originY = grid.origin.y + minRow * grid.cellSize;

  // Clip contours to a slightly inset search wedge so the NaN sentinel wall
  // doesn't draw phantom rings along the sector boundary.
  const reach = maxCarry(profile, sit.lie);
  const distToPin = dist(sit.ball, sit.pin);
  const maxR = Math.max(
    GRID_MIN_REACH_YDS,
    Math.min(reach * GRID_REACH_FACTOR, distToPin + GRID_BEYOND_PIN_MARGIN_YDS),
  );
  const bearing = Math.atan2(sit.pin.x - sit.ball.x, sit.pin.y - sit.ball.y);
  const halfAngle = ((GRID_SECTOR_HALF_ANGLE_DEG - 1.5) * Math.PI) / 180;
  const wedge = {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: [wedgePolygon(sit.ball, bearing, halfAngle, maxR - grid.cellSize)],
    },
  };

  const thresholds = LEVELS.map((l) => optimalE + l);
  const raw = d3contours().size([w, h]).thresholds(thresholds)(Array.from(cropped));
  const levels = raw.map((c, i) => {
    // d3-contour index space → yards: data point (i,j) sits at ⟨i+0.5, j+0.5⟩.
    const toYards = ([x, y]: number[]): [number, number] => [
      originX + (x! - 0.5) * grid.cellSize,
      originY + (y! - 0.5) * grid.cellSize,
    ];
    const geom = {
      type: 'MultiPolygon' as const,
      coordinates: c.coordinates.map((poly) => poly.map((ring) => ring.map(toYards))),
    };
    const feature = { type: 'Feature' as const, properties: {}, geometry: geom };
    let clipped: Ring[] = [];
    if (geom.coordinates.length > 0) {
      const hit = intersect(featureCollection([feature, wedge] as never));
      if (hit) clipped = ringsOf(hit.geometry);
    }

    // Contours should END at the search boundary, not draw it: split each
    // clipped ring into stroke polylines, dropping segments that lie on the
    // wedge edge (arc, rays, or apex).
    const rClip = maxR - grid.cellSize;
    const interior = ([x, y]: [number, number]) => {
      const dx = x - sit.ball.x;
      const dy = y - sit.ball.y;
      const r = Math.hypot(dx, dy);
      if (r < 3 || r > rClip - 0.8) return false;
      let da = Math.atan2(dx, dy) - bearing;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      return Math.abs(da) < halfAngle - 0.008;
    };
    const strokes: Ring[] = [];
    for (const ring of clipped) {
      let run: Ring = [];
      for (const v of ring) {
        if (interior(v)) {
          run.push(v);
        } else if (run.length > 1) {
          strokes.push(run);
          run = [];
        } else {
          run = [];
        }
      }
      if (run.length > 1) strokes.push(run);
    }
    return { level: LEVELS[i]!, rings: clipped, strokes };
  });

  const optDist = dist(sit.ball, grid.optimal.point);
  return {
    optimal: {
      point: { x: r1(grid.optimal.point.x), y: r1(grid.optimal.point.y) },
      e: r3(grid.optimal.expectedStrokes),
      distance: Math.round(optDist),
      club: grid.optimal.result.outcomeStats.club.label,
      breakdown: breakdown(grid.optimal.result),
    },
    naive: {
      point: { x: r1(grid.naive.point.x), y: r1(grid.naive.point.y) },
      e: r3(grid.naive.expectedStrokes),
      distance: Math.round(dist(sit.ball, grid.naive.point)),
      breakdown: breakdown(grid.naive.result),
    },
    trap: r3(grid.trapSize),
    rating: puzzleRatingFromTrap(grid.trapSize),
    levels,
    ellipses: {
      optimal: ellipseAt(prepared, sit.ball, sit.lie, profile, grid.optimal.point),
      naive: ellipseAt(prepared, sit.ball, sit.lie, profile, grid.naive.point),
    },
    hover: {
      originX: r1(originX),
      originY: r1(originY),
      cellSize: grid.cellSize,
      width: w,
      height: h,
      optimalE: r3(optimalE),
      deltas,
    },
    clubs: allowedClubs(profile, sit.lie).map((c) => ({
      label: c.label,
      carry: r1(c.carry),
    })),
  };
}

const hole = capeHole();
const prepared = prepareHole(hole);

const holePolygons = prepared.polygons.map((p) => ({
  kind: p.kind,
  rings: p.rings.map((ring) => ring.map((pt) => [r1(pt.x), r1(pt.y)] as [number, number])),
}));

const puzzles = [CAPE_TEE, CAPE_APPROACH].map((puzzle) => ({
  id: puzzle.id,
  category: puzzle.category,
  description: puzzle.description,
  ball: puzzle.ball,
  lie: puzzle.lie,
  combos: Object.fromEntries(
    PROFILES.map(({ key, profile }) => [key, exportCombo(prepared, puzzle, profile)]),
  ),
}));

const bundle = {
  meta: {
    courseName: hole.courseName,
    holeNumber: hole.holeNumber,
    par: hole.par,
    yardage: hole.yardage,
    pin: { x: r1(prepared.pin.x), y: r1(prepared.pin.y) },
    nSamples: N_SAMPLES,
    levels: LEVELS,
  },
  profiles: PROFILES.map(({ key, label, profile }) => ({ key, label, ...profile })),
  hole: holePolygons,
  puzzles,
};

const out = process.argv[2];
if (!out) throw new Error('usage: tsx scripts/export-preview.ts <output.json>');
writeFileSync(out, JSON.stringify(bundle));
console.log(
  `wrote ${out} — ${puzzles.length} puzzles × ${PROFILES.length} profiles, ` +
    `${Math.round(JSON.stringify(bundle).length / 1024)}KB`,
);
