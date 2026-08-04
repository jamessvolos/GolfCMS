/**
 * POST /api/attempt — score a confirmed aim authoritatively.
 *
 * The server re-evaluates the aim with the profile's bucketed dispersion
 * and the same deterministic seed the cached grid used, so the returned
 * sgLoss matches the client's reveal exactly. Applies Elo (K=24 player,
 * K=16 puzzle drift) and records the attempt.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { evaluateAim } from '@/lib/engine/evaluate';
import { prepareHole } from '@/lib/engine/hole';
import { bucketedProfile } from '@/lib/engine/profile';
import { eloDeltas, scoreBand } from '@/lib/engine/scoring';
import { getOrComputeHeatmap } from '@/lib/server/heatmap';
import { prismaHeatmapStore } from '@/lib/server/heatmapPrisma';
import { getProfile, getPuzzleWithHole } from '@/lib/server/content';
import { db } from '@/lib/server/db';
import { advanceStreak, levelInfo, xpForAttempt } from '@/lib/progress/xp';
import { nextPuzzleId } from '@/lib/server/queue';

const bodySchema = z.object({
  puzzleId: z.string(),
  aim: z.object({ lon: z.number(), lat: z.number() }),
});

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid attempt body' }, { status: 400 });
  }
  const { puzzleId, aim } = parsed.data;

  const content = await getPuzzleWithHole(puzzleId);
  if (!content) {
    return NextResponse.json({ error: 'unknown puzzle' }, { status: 404 });
  }
  const profile = await getProfile();
  const { summary } = await getOrComputeHeatmap(prismaHeatmapStore, content, profile);

  const prepared = prepareHole(content.hole);
  const sit = {
    ball: prepared.toLocal(content.puzzle.ballPosition),
    pin: prepared.toLocal(content.puzzle.pinPosition),
    lie: content.puzzle.lie,
  };
  const evalResult = evaluateAim(prepared, sit, bucketedProfile(profile), prepared.toLocal(aim));
  const sgLoss = evalResult.expectedStrokes - summary.optimal.e;
  const band = scoreBand(sgLoss);
  const deltas = eloDeltas(profile.elo, content.puzzle.rating, band.eloScore);

  // Progression: XP by band (with an upset bonus for beating a puzzle above
  // your rating) and the daily streak.
  const xpGained = xpForAttempt(band.band, profile.elo, content.puzzle.rating);
  const row = await db.profile.findUnique({
    where: { id: profile.id },
    select: { streak: true, lastPlayedDay: true, bestStreak: true, xp: true },
  });
  const streak = advanceStreak(
    { streak: row?.streak ?? 0, lastPlayedDay: row?.lastPlayedDay ?? null },
    new Date(),
  );
  const newRating = profile.elo + deltas.player;
  const newXp = (row?.xp ?? 0) + xpGained;

  const [updatedProfile, updatedPuzzle] = await db.$transaction([
    db.profile.update({
      where: { id: profile.id },
      data: {
        elo: { increment: deltas.player },
        xp: { increment: xpGained },
        streak: streak.streak,
        lastPlayedDay: streak.lastPlayedDay,
        bestStreak: Math.max(row?.bestStreak ?? 0, streak.streak),
      },
    }),
    db.puzzle.update({
      where: { id: puzzleId },
      data: { rating: { increment: deltas.puzzle } },
    }),
    db.attempt.create({
      data: {
        puzzleId,
        profileId: profile.id,
        aimPoint: JSON.stringify(aim),
        sgLoss,
        band: band.band,
        eloDelta: deltas.player,
        xpGained,
        ratingAfter: newRating,
      },
    }),
  ]);

  // Queue the next puzzle from the player's UPDATED rating.
  const next = await nextPuzzleId(profile.id, updatedProfile.elo, [puzzleId]);
  const before = levelInfo(row?.xp ?? 0);
  const after = levelInfo(newXp);

  return NextResponse.json({
    sgLoss,
    band: band.band,
    playerE: evalResult.expectedStrokes,
    optimalE: summary.optimal.e,
    eloDelta: deltas.player,
    newRating: updatedProfile.elo,
    puzzleRating: updatedPuzzle.rating,
    xpGained,
    xp: updatedProfile.xp,
    level: after.level,
    leveledUp: after.level > before.level,
    streak: updatedProfile.streak,
    streakExtended: streak.extended,
    nextPuzzleId: next?.puzzleId ?? null,
  });
}
