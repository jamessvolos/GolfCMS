/**
 * The expected-strokes field, small enough to keep.
 *
 * The optimizer evaluates one to two thousand aim points per situation and
 * then throws all but five polylines away. Measured on the seeded library, a
 * cached `GridSummary` is 20.7–50.7 KB and **93% of it is the contours** —
 * the picture of the field, stored at ten times the cost of the field
 * itself.
 *
 * That was affordable for twenty hand-traced holes with warm grids. It is
 * not affordable once content is mined: every generated puzzle is a cache
 * miss, each grid is read exactly once by exactly one person, and the cache
 * becomes a write-only log growing without bound on a 1 GB volume.
 *
 * So store the lattice instead, as one byte per cell holding the cell's
 * distance above the optimal in hundredths of a stroke. Contours are drawn
 * from it on read — they are marching squares over the same numbers, which
 * is where they came from — and the player can be handed the field itself
 * rather than a tracing of it.
 *
 * A byte tops out at 2.55 strokes above optimal. That is not a limitation:
 * every contour the app draws sits at +1.00 or below, and a cell two and a
 * half strokes worse than the best line is "unplayable" at any resolution.
 * Out-of-sector cells — the ones the grid left NaN — get 255 as a sentinel,
 * so the ceiling for real values is 2.54.
 */

import type { EvalGrid, Pt } from '@/lib/engine/types';

/** Strokes per encoded unit. */
export const FIELD_QUANTUM = 0.01;
/** Reserved for "this cell was never evaluated". */
export const FIELD_NOT_EVALUATED = 255;
/** Highest representable penalty above optimal, in strokes. */
export const FIELD_CEILING = (FIELD_NOT_EVALUATED - 1) * FIELD_QUANTUM;

export interface EncodedField {
  /** Lattice origin (cell [0,0] centre) in local yards. */
  origin: Pt;
  cellSize: number;
  width: number;
  height: number;
  /** Expected strokes at the optimal aim; every cell is an offset from it. */
  optimalE: number;
  /** Base64 of one byte per cell, row-major. */
  cells: string;
  /**
   * The sector the optimizer searched, carried so contours can be redrawn
   * from the field alone. Without it a reader would have to re-derive the
   * wedge from the player's profile, and a grid cached for one bucket would
   * clip differently when read back.
   */
  clip: { ball: Pt; pin: Pt; maxR: number };
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeField(
  grid: EvalGrid,
  clip: { ball: Pt; pin: Pt; maxR: number },
): EncodedField {
  const optimalE = grid.optimal.expectedStrokes;
  const bytes = new Uint8Array(grid.width * grid.height);
  for (let i = 0; i < bytes.length; i++) {
    const v = grid.values[i];
    if (v === undefined || !Number.isFinite(v)) {
      bytes[i] = FIELD_NOT_EVALUATED;
      continue;
    }
    // Clamp rather than wrap: a cell worse than the ceiling is unplayable,
    // and wrapping would draw it as the best line on the hole.
    const q = Math.round((v - optimalE) / FIELD_QUANTUM);
    bytes[i] = q <= 0 ? 0 : q >= FIELD_NOT_EVALUATED ? FIELD_NOT_EVALUATED - 1 : q;
  }
  return {
    origin: grid.origin,
    cellSize: grid.cellSize,
    width: grid.width,
    height: grid.height,
    optimalE,
    cells: toBase64(bytes),
    clip,
  };
}

/** Expected strokes per cell, NaN where the grid never looked. */
export function decodeField(field: EncodedField): number[] {
  const bytes = fromBase64(field.cells);
  const out = new Array<number>(field.width * field.height);
  for (let i = 0; i < out.length; i++) {
    const b = bytes[i]!;
    out[i] = b === FIELD_NOT_EVALUATED ? NaN : field.optimalE + b * FIELD_QUANTUM;
  }
  return out;
}

/**
 * Bilinear read of the field at a point, in expected strokes. NaN outside
 * the searched sector.
 *
 * This is what makes the reveal interactive without a round trip: the player
 * drags the stake and reads what that line would have cost, straight out of
 * the numbers the optimizer already produced.
 */
export function sampleField(field: EncodedField, values: number[], p: Pt): number {
  const fx = (p.x - field.origin.x) / field.cellSize;
  const fy = (p.y - field.origin.y) / field.cellSize;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= field.width || y0 + 1 >= field.height) return NaN;
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (cx: number, cy: number) => values[cy * field.width + cx]!;
  const v00 = at(x0, y0);
  const v10 = at(x0 + 1, y0);
  const v01 = at(x0, y0 + 1);
  const v11 = at(x0 + 1, y0 + 1);
  if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)) {
    return NaN;
  }
  return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty;
}

/**
 * Rebuild enough of an `EvalGrid` to redraw contours from a stored field.
 * The parts a contour pass never reads — the full `EvalResult` on each aim —
 * are supplied by the caller from the summary it already has.
 */
export function gridFromField(
  field: EncodedField,
  optimal: EvalGrid['optimal'],
  naive: EvalGrid['naive'],
  trapSize: number,
  trapSe: number,
): EvalGrid {
  return {
    origin: field.origin,
    cellSize: field.cellSize,
    width: field.width,
    height: field.height,
    values: decodeField(field),
    optimal,
    naive,
    trapSize,
    trapSe,
  };
}
