/**
 * Prisma-backed HeatmapStore (the HeatmapCache table).
 *
 * What is stored is NOT the summary as computed. Contours are 93% of a
 * `GridSummary` — measured across the seeded library, 29.7 KB of a 32 KB
 * blob — and they are a *picture* of the lattice, drawn by marching squares
 * over numbers the row already contains. So the contours are dropped on
 * write and redrawn on read from the encoded field.
 *
 * That matters because mined content changes the cache's economics. With
 * twenty hand-traced holes every grid was warmed once and read many times.
 * With a mined library every puzzle is a cache miss, each grid is read
 * exactly once by exactly one person, and a cache that stores the picture
 * as well as the numbers is a write-only log growing on a 1 GB volume.
 */

import { db } from './db';
import type { HeatmapStore } from './heatmap';
import type { GridSummary } from '@/lib/puzzle/gridSummary';
import { contoursFromGrid } from '@/lib/map/contours';
import { gridFromField } from '@/lib/puzzle/field';

/** What actually goes in the column: everything except the drawing. */
type StoredSummary = Omit<GridSummary, 'contours'>;

export const prismaHeatmapStore: HeatmapStore = {
  async get(puzzleId, bucket) {
    const row = await db.heatmapCache.findUnique({
      where: { puzzleId_profileBucket: { puzzleId, profileBucket: bucket } },
    });
    if (!row) return null;
    const stored = JSON.parse(row.grid) as StoredSummary & { contours?: GridSummary['contours'] };
    // A row written before the field existed still carries its contours;
    // honour it rather than throwing away a warm grid on a version boundary.
    if (stored.contours) return stored as GridSummary;
    const grid = gridFromField(
      stored.field,
      stored.optimal as never,
      stored.naive as never,
      stored.trapSize,
      stored.trapSe,
    );
    return {
      ...(stored as StoredSummary),
      contours: contoursFromGrid(
        grid,
        grid.naive.point,
        grid.optimal.point,
        // Contour levels are absolute offsets from the optimal, so the
        // profile and lie only affect the clip mask, which the stored
        // lattice has already had applied.
        { handicap: 0, clubSpeedMph: 100, shotShape: 'straight' },
        'fairway',
      ),
    };
  },
  async put(puzzleId, bucket, summary) {
    const { contours: _contours, ...stored } = summary;
    const grid = JSON.stringify(stored);
    await db.heatmapCache.upsert({
      where: { puzzleId_profileBucket: { puzzleId, profileBucket: bucket } },
      create: {
        puzzleId,
        profileBucket: bucket,
        grid,
        optimalAim: JSON.stringify(summary.optimal.lonlat),
        optimalE: summary.optimal.e,
      },
      update: {
        grid,
        optimalAim: JSON.stringify(summary.optimal.lonlat),
        optimalE: summary.optimal.e,
      },
    });
  },
};
