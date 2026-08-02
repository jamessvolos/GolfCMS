/**
 * GET /api/heatmap?puzzleId=… — the cached expected-strokes grid summary
 * for the current profile's bucket. Computes on first request (spec §6),
 * serves from the HeatmapCache table after.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOrComputeHeatmap } from '@/lib/server/heatmap';
import { prismaHeatmapStore } from '@/lib/server/heatmapPrisma';
import { getProfile, getPuzzleWithHole } from '@/lib/server/content';

export async function GET(req: NextRequest) {
  const puzzleId = req.nextUrl.searchParams.get('puzzleId');
  if (!puzzleId) {
    return NextResponse.json({ error: 'puzzleId is required' }, { status: 400 });
  }
  const content = await getPuzzleWithHole(puzzleId);
  if (!content) {
    return NextResponse.json({ error: 'unknown puzzle' }, { status: 404 });
  }
  const profile = await getProfile();
  const result = await getOrComputeHeatmap(prismaHeatmapStore, content, profile);
  return NextResponse.json(result);
}
