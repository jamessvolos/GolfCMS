/**
 * GET /play — the queue. Redirects to the next puzzle near the player's
 * rating (spec: ±150, widening when nothing unseen is in range).
 */

import { redirect } from 'next/navigation';
import { getProfile } from '@/lib/server/content';
import { nextPuzzleId } from '@/lib/server/queue';

export const dynamic = 'force-dynamic';

export async function GET() {
  const profile = await getProfile();
  const pick = await nextPuzzleId(profile.id, profile.elo);
  redirect(pick ? `/puzzle/${pick.puzzleId}` : '/');
}
