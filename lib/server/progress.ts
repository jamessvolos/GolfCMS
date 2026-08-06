/**
 * Progress reads for the folio: session summary, Elo history for the
 * sparkline, and per-category accuracy.
 */

import { db } from './db';
import { levelInfo, tallyGroups } from '@/lib/progress/xp';
import { buildLedger } from '@/lib/progress/ledger';
import type { Ledger } from '@/lib/progress/ledger';
import type { Band } from '@/lib/progress/xp';
import type { PuzzleCategory } from '@/lib/engine/types';

export interface CategoryStat {
  category: PuzzleCategory;
  attempts: number;
  /** Fraction of attempts that were Good or better. */
  accuracy: number;
  meanSgLoss: number;
}

export interface SessionAttempt {
  puzzleId: string;
  courseName: string;
  holeNumber: number;
  category: PuzzleCategory;
  band: Band;
  sgLoss: number;
  eloDelta: number;
  xpGained: number;
  ratingAfter: number;
  createdAt: Date;
}

export interface ProgressSummary {
  profile: {
    name: string;
    elo: number;
    xp: number;
    streak: number;
    bestStreak: number;
    tally: number[];
  };
  level: ReturnType<typeof levelInfo>;
  totals: { attempts: number; meanSgLoss: number; bands: Record<Band, number> };
  categories: CategoryStat[];
  /** Ratings over time, oldest first — the ink sparkline. */
  ratingHistory: number[];
  /** Most recent attempts, newest first. */
  recent: SessionAttempt[];
  /** Attempts from the current session (the latest unbroken run of play). */
  session: SessionAttempt[];
  /**
   * Strokes conceded per round, from the sgLoss already stored on every
   * attempt. Elo paces the queue; this is the number a golfer owns.
   */
  ledger: Ledger;
}

const CATEGORIES: PuzzleCategory[] = ['tee', 'approach', 'layup', 'recovery'];

/** Attempts more than this far apart start a new session. */
const SESSION_GAP_MS = 45 * 60 * 1000;

export async function getProgress(profileId = 'local'): Promise<ProgressSummary> {
  const [profile, rows] = await Promise.all([
    db.profile.findUnique({ where: { id: profileId } }),
    db.attempt.findMany({
      where: { profileId },
      orderBy: { createdAt: 'asc' },
      include: { puzzle: { include: { hole: true } } },
    }),
  ]);

  const attempts: SessionAttempt[] = rows.map((a) => ({
    puzzleId: a.puzzleId,
    courseName: a.puzzle.hole.courseName,
    holeNumber: a.puzzle.hole.holeNumber,
    category: a.puzzle.category as PuzzleCategory,
    band: a.band as Band,
    sgLoss: a.sgLoss,
    eloDelta: a.eloDelta,
    xpGained: a.xpGained,
    ratingAfter: a.ratingAfter,
    createdAt: a.createdAt,
  }));

  const bands: Record<Band, number> = { perfect: 0, good: 0, okay: 0, miss: 0 };
  for (const a of attempts) bands[a.band] += 1;

  const categories: CategoryStat[] = CATEGORIES.map((category) => {
    const mine = attempts.filter((a) => a.category === category);
    const good = mine.filter((a) => a.band === 'perfect' || a.band === 'good').length;
    return {
      category,
      attempts: mine.length,
      accuracy: mine.length ? good / mine.length : 0,
      meanSgLoss: mine.length
        ? mine.reduce((s, a) => s + Math.max(0, a.sgLoss), 0) / mine.length
        : 0,
    };
  });

  // The current session: walk back while consecutive attempts are close.
  const session: SessionAttempt[] = [];
  for (let i = attempts.length - 1; i >= 0; i--) {
    const a = attempts[i]!;
    const next = attempts[i + 1];
    if (next && next.createdAt.getTime() - a.createdAt.getTime() > SESSION_GAP_MS) break;
    session.unshift(a);
  }

  const xp = profile?.xp ?? 0;
  const streak = profile?.streak ?? 0;
  return {
    profile: {
      name: profile?.name ?? 'Player',
      elo: profile?.elo ?? 1200,
      xp,
      streak,
      bestStreak: Math.max(profile?.bestStreak ?? 0, streak),
      tally: tallyGroups(streak),
    },
    level: levelInfo(xp),
    ledger: buildLedger(attempts.map((a) => ({ sgLoss: a.sgLoss, createdAt: a.createdAt }))),
    totals: {
      attempts: attempts.length,
      // Clamp per-attempt: a negative sgLoss is Monte Carlo noise around a
      // matched optimal, not credit that should offset a genuine miss.
      meanSgLoss: attempts.length
        ? attempts.reduce((s, a) => s + Math.max(0, a.sgLoss), 0) / attempts.length
        : 0,
      bands,
    },
    categories,
    ratingHistory: attempts.map((a) => a.ratingAfter),
    recent: [...attempts].reverse().slice(0, 10),
    session,
  };
}
