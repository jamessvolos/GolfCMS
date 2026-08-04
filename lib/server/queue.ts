/**
 * The puzzle queue: serve puzzles near the player's rating (spec: ±150),
 * preferring ones they haven't seen. Selection is pure given a candidate
 * list so it can be unit-tested without a database.
 */

import { db } from './db';

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
  const pool = candidates.filter((c) => !exclude.has(c.id));
  if (pool.length === 0) return null;

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
  }));
  return pickNext(candidates, playerRating, { excludeIds });
}
