/**
 * The cheap screen.
 *
 * A full grid is a 6-yard lattice at 600 Monte Carlo samples: measured
 * 285–1900 ms per situation on this hardware. The miner proposes hundreds of
 * situations per course and most of them hold nothing, so paying that to
 * find out is the difference between generation that fits on a
 * shared-cpu-1x and generation that needs a machine this deployment cannot
 * host.
 *
 * So: a 12-yard lattice at 150 samples first, and the full grid only for
 * what survives. The screen is allowed to be wrong in one direction and not
 * the other — it must not *lose* a real decision (recall), because nothing
 * downstream can recover it, while a false positive merely costs one full
 * grid. So its threshold is deliberately below the admission threshold.
 *
 * The screen never sets a rating. Everything it passes is re-measured at
 * full sampling by `admit.ts`, and the served rating comes from there.
 */

import { DECISION_TRAP, MC_SAMPLES } from '@/lib/engine/constants';
import { evaluateGrid } from '@/lib/engine/optimize';
import type { Situation } from '@/lib/engine/evaluate';
import type { PlayerProfile, PreparedHole, PuzzleCategory } from '@/lib/engine/types';
import { legibility } from './legibility';

/** Lattice spacing for the screen. The full grid uses GRID_SPACING_YDS (6). */
export const SCREEN_CELL_YDS = 12;
/** Monte Carlo samples for the screen. The full grid uses MC_SAMPLES (600). */
export const SCREEN_SAMPLES = 150;

/**
 * Pass anything that could plausibly clear DECISION_TRAP at full sampling.
 * At 150 samples the standard error runs about twice the full-grid figure,
 * so the screen's bar sits well under the real one: losing a decision here
 * is unrecoverable, spending one wasted grid is not.
 */
export const SCREEN_TRAP_BAR = DECISION_TRAP * 0.5;

/**
 * The screen also passes anything one-sided, because a consequence
 * situation can have a trap of exactly zero — Sawgrass 17 measures 0.000 —
 * and would otherwise be screened out before the axis that admits it ever
 * runs.
 */
export const SCREEN_ASYMMETRY_BAR = 0.4;

export interface ScreenResult {
  passed: boolean;
  /** Screen-quality estimates. Never store these as a rating. */
  trap: number;
  asymmetry: number;
}

/**
 * Would a full grid be worth running here? Roughly 8–13x cheaper than
 * finding out the expensive way.
 */
export function screen(
  prepared: PreparedHole,
  sit: Situation,
  profile: PlayerProfile,
  category: PuzzleCategory,
): ScreenResult {
  const grid = evaluateGrid(prepared, sit, profile, category, {
    cellSize: SCREEN_CELL_YDS,
    nSamples: SCREEN_SAMPLES,
  });
  // legibility() is a lattice read, so asking the screen for asymmetry is
  // free — and it is the only way a trap-0.000 situation survives to be
  // admitted on the second axis.
  const { asymmetry } = legibility(grid, sit.ball);
  return {
    passed: grid.trapSize >= SCREEN_TRAP_BAR || asymmetry >= SCREEN_ASYMMETRY_BAR,
    trap: grid.trapSize,
    asymmetry,
  };
}

/** Ratio the screen is expected to save, for the miner's funnel report. */
export const SCREEN_SPEEDUP_NOTE =
  `${SCREEN_CELL_YDS}y/${SCREEN_SAMPLES} screen vs 6y/${MC_SAMPLES} grid`;
