/**
 * Server-side heatmap cache per (puzzleId, profileBucket), as the spec
 * prescribes: compute on first request, reuse after. The store is an
 * interface so the cache logic is unit-testable without a database.
 */

import { prepareHole } from '@/lib/engine/hole';
import { bucketedProfile, profileBucket } from '@/lib/engine/profile';
import type { HoleData, PlayerProfile } from '@/lib/engine/types';
import { computeGridSummary } from '@/lib/puzzle/gridSummary';
import type { GridSummary } from '@/lib/puzzle/gridSummary';
import type { PuzzleContent } from '@/lib/content/types';

/**
 * Bump when GridSummary's shape or the engine's numbers change. A cached
 * grid from an older engine is not just stale, it can be missing fields
 * downstream code requires — the explanation generator hit exactly this
 * when `brief` was added. The version rides in the bucket key, so old rows
 * are simply never read.
 */
export const GRID_VERSION = 2;

export interface HeatmapStore {
  get(puzzleId: string, bucket: string): Promise<GridSummary | null>;
  put(puzzleId: string, bucket: string, summary: GridSummary): Promise<void>;
}

export class MemoryHeatmapStore implements HeatmapStore {
  private map = new Map<string, GridSummary>();
  async get(puzzleId: string, bucket: string): Promise<GridSummary | null> {
    return this.map.get(`${puzzleId}::${bucket}`) ?? null;
  }
  async put(puzzleId: string, bucket: string, summary: GridSummary): Promise<void> {
    this.map.set(`${puzzleId}::${bucket}`, summary);
  }
  get size(): number {
    return this.map.size;
  }
}

export interface HeatmapResult {
  summary: GridSummary;
  bucket: string;
  cached: boolean;
}

/**
 * Fetch-or-compute the grid summary for a puzzle and a player profile.
 * The profile is bucketed here — callers pass the exact profile and must
 * score aims with the SAME bucketed profile for sgLoss coherence.
 */
export async function getOrComputeHeatmap(
  store: HeatmapStore,
  content: { hole: HoleData; puzzle: PuzzleContent },
  profile: PlayerProfile,
  opts: { nSamples?: number } = {},
): Promise<HeatmapResult> {
  const bucket = `v${GRID_VERSION}-${profileBucket(profile)}`;
  const hit = await store.get(content.puzzle.id, bucket);
  if (hit) return { summary: hit, bucket, cached: true };

  const prepared = prepareHole(content.hole);
  const sit = {
    ball: prepared.toLocal(content.puzzle.ballPosition),
    pin: prepared.toLocal(content.puzzle.pinPosition),
    lie: content.puzzle.lie,
  };
  const summary = computeGridSummary(
    prepared,
    sit,
    bucketedProfile(profile),
    content.puzzle.category,
    opts,
  );
  await store.put(content.puzzle.id, bucket, summary);
  return { summary, bucket, cached: false };
}
