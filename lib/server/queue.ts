/**
 * The puzzle queue: serve puzzles near the player's rating (spec: ±150),
 * preferring ones they haven't seen. Selection is pure given a candidate
 * list so it can be unit-tested without a database.
 */

import { db } from './db';
import { clearsDecisionThreshold } from '@/lib/engine/scoring';

export const QUEUE_BAND = 150;
/** Widen the band by this much per pass when nothing is in range. */
export const QUEUE_WIDEN_STEP = 200;

export interface QueueCandidate {
  id: string;
  rating: number;
  /** Attempts the player has recorded on this puzzle. */
  attempts: number;
  /** Epoch ms of the most recent attempt, or null if never played. */
  lastPlayedAt: number | null;
  /**
   * Does the situation hold a decision once its error bar is allowed for?
   * Measured over the shipped library, 32 of 36 do not — aiming where you
   * were going to aim anyway is already optimal, and the game awards
   * PERFECT for a reflex. Those are served only when nothing better exists.
   */
  serves: boolean;
}

export interface QueuePick {
  puzzleId: string;
  /** Rating band actually used (widens when the ±150 window is empty). */
  band: number;
  /** True when every candidate had already been played. */
  repeat: boolean;
}

/**
 * Pick the next puzzle:
 *  1. Unseen puzzles within the band, closest rating first.
 *  2. Widen the band until something unseen appears.
 *  3. If everything has been played, the least-recently-played puzzle
 *     within the band — a review, not a random re-serve.
 */
export function pickNext(
  candidates: QueueCandidate[],
  playerRating: number,
  opts: { excludeIds?: string[] } = {},
): QuePickResult {
  const exclude = new Set(opts.excludeIds ?? []);
  const all = candidates.filter((c) => !exclude.has(c.id));
  if (all.length === 0) return null;

  // A situation with no decision in it teaches nothing and costs a turn, so
  // it is not merely ranked lower — it is a different pool, reached only
  // when the first is empty. Until the miner lands this is the difference
  // between four puzzles and thirty-six, and serving the thirty-two would
  // be serving thirty-two free PERFECTs.
  const decisions = all.filter((c) => c.serves);
  const pool = decisions.length > 0 ? decisions : all;

  const near = (c: QueueCandidate) => Math.abs(c.rating - playerRating);

  for (let band = QUEUE_BAND; ; band += QUEUE_WIDEN_STEP) {
    const inBand = pool.filter((c) => near(c) <= band);
    const unseen = inBand.filter((c) => c.attempts === 0);
    if (unseen.length > 0) {
      unseen.sort((a, b) => near(a) - near(b) || a.id.localeCompare(b.id));
      return { puzzleId: unseen[0]!.id, band, repeat: false };
    }
    // Nothing unseen in band; if the band already covers the pool, review.
    if (inBand.length === pool.length) {
      const byAge = [...pool].sort(
        (a, b) =>
          (a.lastPlayedAt ?? 0) - (b.lastPlayedAt ?? 0) || near(a) - near(b) || a.id.localeCompare(b.id),
      );
      return { puzzleId: byAge[0]!.id, band, repeat: true };
    }
  }
}

type QuePickResult = QueuePick | null;

/** Load candidates and pick, using the live database. */
export async function nextPuzzleId(
  profileId: string,
  playerRating: number,
  excludeIds: string[] = [],
): Promise<QueuePick | null> {
  const puzzles = await db.puzzle.findMany({
    select: {
      id: true,
      rating: true,
      trapSize: true,
      trapSe: true,
      attempts: {
        where: { profileId },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      _count: { select: { attempts: { where: { profileId } } } },
    },
  });
  const candidates: QueueCandidate[] = puzzles.map((p) => ({
    id: p.id,
    rating: p.rating,
    attempts: p._count.attempts,
    lastPlayedAt: p.attempts[0]?.createdAt.getTime() ?? null,
    serves: clearsDecisionThreshold(p.trapSize, p.trapSe),
  }));
  return pickNext(candidates, playerRating, { excludeIds });
}
