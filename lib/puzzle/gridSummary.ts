/**
 * GridSummary: everything the reveal renderer and the explanation
 * generator need from one grid search — clipped isolines, the optimal /
 * naive / pin aims with their full stats, the trap size, and a compact
 * "brief" of corridor room walked out of the lattice before it is
 * discarded. Computed identically by the server-side heatmap cache, the
 * seed, and the worker fallback, so a cached grid and a live one are
 * indistinguishable.
 */

import { maxCarry } from '@/lib/engine/clubs';
import { dispersionParams } from '@/lib/engine/dispersion';
import { evaluateAim } from '@/lib/engine/evaluate';
import { evaluateGrid } from '@/lib/engine/optimize';
import type { GridOptions } from '@/lib/engine/optimize';
import type { Situation } from '@/lib/engine/evaluate';
import { dist } from '@/lib/engine/projection';
import { contoursFromGrid } from '@/lib/map/contours';
import type { ContourSet } from '@/lib/map/contours';
import type {
  EvalGrid,
  EvalResult,
  LonLat,
  PlayerProfile,
  PreparedHole,
  Pt,
  PuzzleCategory,
} from '@/lib/engine/types';

export type CorridorLevel = '0.03' | '0.10' | '0.25';

export interface CorridorSide {
  left: number;
  right: number;
  leftClipped: boolean;
  rightClipped: boolean;
}

export interface GridBrief {
  /**
   * Yards of room either side of the optimal, walking the shot-frame
   * lateral axis through the lattice until expected strokes exceed
   * optimal + level. `clipped` means the walk hit the sector edge or the
   * cap, so the number is a floor rather than a measurement.
   */
  corridor: Record<CorridorLevel, CorridorSide>;
  /** Optimal relative to the pin in the shot frame: +lat right, +long past. */
  optimalOffset: { lat: number; long: number };
  holeDistance: number;
  maxCarry: number;
  /** Lateral sigma at the player's shot distance — the instrument's resolution. */
  sigmaLat: number;
}

export interface GridSummary {
  contours: ContourSet;
  optimal: { local: Pt; lonlat: LonLat; e: number; clubLabel: string; result: EvalResult };
  /** The naive line's full result, forwarded rather than discarded. */
  naive: { local: Pt; lonlat: LonLat; e: number; result: EvalResult };
  /** The pin as an aim, when it isn't already the naive aim (tee shots). */
  pinAim: { local: Pt; e: number; result: EvalResult } | null;
  trapSize: number;
  /** Standard error of trapSize; see EvalGrid.trapSe. */
  trapSe: number;
  brief: GridBrief;
}

const CORRIDOR_LEVELS: CorridorLevel[] = ['0.03', '0.10', '0.25'];
const CORRIDOR_CAP_YDS = 40;

/** Bilinear sample of the lattice; NaN outside the searched sector. */
function sampleGrid(grid: EvalGrid, p: Pt): number {
  const fx = (p.x - grid.origin.x) / grid.cellSize;
  const fy = (p.y - grid.origin.y) / grid.cellSize;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= grid.width || y0 + 1 >= grid.height) return NaN;
  const tx = fx - x0;
  const ty = fy - y0;
  const v = (cx: number, cy: number) => grid.values[cy * grid.width + cx]!;
  const v00 = v(x0, y0);
  const v10 = v(x0 + 1, y0);
  const v01 = v(x0, y0 + 1);
  const v11 = v(x0 + 1, y0 + 1);
  if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)) {
    return NaN;
  }
  return (
    v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty
  );
}

function corridorFor(grid: EvalGrid, ball: Pt, level: number): CorridorSide {
  const o = grid.optimal.point;
  const d = Math.max(1e-6, dist(ball, o));
  // Shot-frame lateral unit: right-hand perpendicular to the aim line.
  const ux = (o.x - ball.x) / d;
  const uy = (o.y - ball.y) / d;
  const px = uy;
  const py = -ux;
  const ceiling = grid.optimal.expectedStrokes + level;

  const walk = (sign: 1 | -1) => {
    let yards = 0;
    for (let r = 1; r <= CORRIDOR_CAP_YDS; r++) {
      const s = sampleGrid(grid, { x: o.x + px * sign * r, y: o.y + py * sign * r });
      if (!Number.isFinite(s)) return { yards, clipped: true };
      if (s > ceiling) return { yards, clipped: false };
      yards = r;
    }
    return { yards, clipped: true };
  };

  const right = walk(1);
  const left = walk(-1);
  return {
    left: left.yards,
    right: right.yards,
    leftClipped: left.clipped,
    rightClipped: right.clipped,
  };
}

function buildBrief(
  grid: EvalGrid,
  sit: Situation,
  profile: PlayerProfile,
): GridBrief {
  const corridor = {} as Record<CorridorLevel, CorridorSide>;
  for (const key of CORRIDOR_LEVELS) {
    corridor[key] = corridorFor(grid, sit.ball, Number(key));
  }
  const holeDistance = dist(sit.ball, sit.pin);
  const d = Math.max(1e-6, holeDistance);
  const ux = (sit.pin.x - sit.ball.x) / d;
  const uy = (sit.pin.y - sit.ball.y) / d;
  const o = grid.optimal.point;
  const dx = o.x - sit.pin.x;
  const dy = o.y - sit.pin.y;
  return {
    corridor,
    optimalOffset: { lat: dx * uy - dy * ux, long: dx * ux + dy * uy },
    holeDistance,
    maxCarry: maxCarry(profile, sit.lie),
    sigmaLat: dispersionParams(
      profile,
      sit.lie,
      grid.optimal.result.outcomeStats.aimDistance,
    ).sigmaLat,
  };
}

export function computeGridSummary(
  prepared: PreparedHole,
  sit: Situation,
  profile: PlayerProfile,
  category: PuzzleCategory,
  opts: GridOptions = {},
): GridSummary {
  const grid = evaluateGrid(prepared, sit, profile, category, opts);
  const contours = contoursFromGrid(grid, sit.ball, sit.pin, profile, sit.lie);

  // The pin as an aim, when the naive line isn't already the pin.
  const naiveIsPin =
    Math.abs(grid.naive.point.x - sit.pin.x) < 1e-9 &&
    Math.abs(grid.naive.point.y - sit.pin.y) < 1e-9;
  const pinAim = naiveIsPin
    ? null
    : (() => {
        const result = evaluateAim(prepared, sit, profile, sit.pin, {
          nSamples: opts.nSamples,
          seed: opts.seed,
        });
        return { local: { ...sit.pin }, e: result.expectedStrokes, result };
      })();

  return {
    contours,
    optimal: {
      local: grid.optimal.point,
      lonlat: prepared.toLonLat(grid.optimal.point),
      e: grid.optimal.expectedStrokes,
      clubLabel: grid.optimal.result.outcomeStats.club.label,
      result: grid.optimal.result,
    },
    naive: {
      local: grid.naive.point,
      lonlat: prepared.toLonLat(grid.naive.point),
      e: grid.naive.expectedStrokes,
      result: grid.naive.result,
    },
    pinAim,
    trapSize: grid.trapSize,
    trapSe: grid.trapSe,
    brief: buildBrief(grid, sit, profile),
  };
}
