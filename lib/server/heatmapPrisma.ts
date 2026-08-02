/**
 * Prisma-backed HeatmapStore (the HeatmapCache table). GridSummary is
 * stored as JSON text; it contains no NaN (contours/optima only), so the
 * round-trip is lossless.
 */

import { db } from './db';
import type { HeatmapStore } from './heatmap';
import type { GridSummary } from '@/lib/puzzle/gridSummary';

export const prismaHeatmapStore: HeatmapStore = {
  async get(puzzleId, bucket) {
    const row = await db.heatmapCache.findUnique({
      where: { puzzleId_profileBucket: { puzzleId, profileBucket: bucket } },
    });
    return row ? (JSON.parse(row.grid) as GridSummary) : null;
  },
  async put(puzzleId, bucket, summary) {
    await db.heatmapCache.upsert({
      where: { puzzleId_profileBucket: { puzzleId, profileBucket: bucket } },
      create: {
        puzzleId,
        profileBucket: bucket,
        grid: JSON.stringify(summary),
        optimalAim: JSON.stringify(summary.optimal.lonlat),
        optimalE: summary.optimal.e,
      },
      update: {
        grid: JSON.stringify(summary),
        optimalAim: JSON.stringify(summary.optimal.lonlat),
        optimalE: summary.optimal.e,
      },
    });
  },
};
