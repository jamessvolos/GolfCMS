/**
 * The second question: which way do you miss?
 *
 * Every situation the app has ever served asks one thing — where do you
 * aim — and on a green where the middle is both the obvious and the optimal
 * target, that question has no content. Wave 2 measured how common that is:
 * twelve of the seeded library's servable situations hold a one-sided
 * consequence and no decision at all. Sawgrass 17 is the extreme case, trap
 * 0.000 and consequence 2.469, and the app was awarding PERFECT for aiming
 * at the flag.
 *
 * So ask the other question. It costs nothing: the answer is read off the
 * field the optimizer already built, twenty yards either side of the optimal
 * aim, in strokes.
 *
 * Twenty yards, not "the corridor", and in strokes, not yards. Corridor
 * width is a yardage — the room you have before expected strokes rise by a
 * given amount — and comparing two corridor widths does not tell you which
 * side is more expensive. The question is what the miss costs, so the
 * instrument has to be denominated in strokes.
 */

import { sampleField, decodeField } from '@/lib/puzzle/field';
import type { EncodedField } from '@/lib/puzzle/field';
import { dist } from '@/lib/engine/projection';
import type { Pt } from '@/lib/engine/types';

/** How far off line counts as "a miss" rather than a different shot. */
export const MISS_YDS = 20;

/**
 * Below this the two sides are the same price and there is no question to
 * ask. Asking anyway would be the free-PERFECT problem in a new costume.
 */
export const MIN_DECISIVE_STROKES = 0.15;

export interface SafeSide {
  /** The side that costs less. */
  answer: 'left' | 'right';
  /** Strokes a MISS_YDS miss costs on each side. */
  leftCost: number;
  rightCost: number;
  /** What getting it wrong is worth. */
  margin: number;
  /** False when both sides cost the same — do not ask. */
  decisive: boolean;
}

/**
 * Read the field either side of the optimal aim, in the shot frame.
 *
 * "Left" and "right" are the player's, looking down the shot: the same
 * frame `dispersion.ts` samples in, so the answer matches the pattern the
 * reveal draws.
 */
export function safeSide(field: EncodedField, ball: Pt, optimal: Pt): SafeSide {
  const values = decodeField(field);
  const d = Math.max(1e-6, dist(ball, optimal));
  const ux = (optimal.x - ball.x) / d;
  const uy = (optimal.y - ball.y) / d;
  // Right-hand perpendicular, matching sampleLandings.
  const px = uy;
  const py = -ux;

  const read = (sign: 1 | -1): number => {
    const p = { x: optimal.x + px * MISS_YDS * sign, y: optimal.y + py * MISS_YDS * sign };
    const e = sampleField(field, values, p);
    // Off the searched sector means the miss leaves the map — which is not
    // "free", it is the worst thing on the hole.
    if (!Number.isFinite(e)) return Number.POSITIVE_INFINITY;
    return e - field.optimalE;
  };

  const rightCost = read(1);
  const leftCost = read(-1);
  const margin = Math.abs(rightCost - leftCost);

  return {
    answer: rightCost <= leftCost ? 'right' : 'left',
    leftCost,
    rightCost,
    margin: Number.isFinite(margin) ? margin : 99,
    decisive: !(margin < MIN_DECISIVE_STROKES),
  };
}
