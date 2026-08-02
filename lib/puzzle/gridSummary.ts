/**
 * GridSummary: everything the reveal renderer needs from one grid search —
 * clipped isolines, the optimal and naive aims with stats, and the trap
 * size. Computed identically by the server-side heatmap cache, the seed
 * script, and the web-worker fallback, so a cached grid and a live one are
 * indistinguishable to the UI.
 */

import { evaluateGrid } from '@/lib/engine/optimize';
import type { GridOptions } from '@/lib/engine/optimize';
import type { Situation } from '@/lib/engine/evaluate';
import { contoursFromGrid } from '@/lib/map/contours';
import type { ContourSet } from '@/lib/map/contours';
import type {
  EvalResult,
  LonLat,
  PlayerProfile,
  PreparedHole,
  Pt,
  PuzzleCategory,
} from '@/lib/engine/types';

export interface GridSummary {
  contours: ContourSet;
  /** Local-yard positions plus lon/lat for storage/markers. */
  optimal: { local: Pt; lonlat: LonLat; e: number; clubLabel: string; result: EvalResult };
  naive: { local: Pt; lonlat: LonLat; e: number };
  trapSize: number;
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
    },
    trapSize: grid.trapSize,
  };
}
