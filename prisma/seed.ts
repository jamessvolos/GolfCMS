/**
 * Seed the dev database: the single local profile, the cape hole and its
 * puzzles (ratings seeded from trap size per the spec), and a warm heatmap
 * cache entry for the default profile bucket.
 *
 *   npm run db:seed
 */

import { getHole, listPuzzles } from '@/lib/content/holes';
import { prepareHole } from '@/lib/engine/hole';
import { bucketedProfile, profileBucket, SEED_PROFILE } from '@/lib/engine/profile';
import { puzzleRatingFromTrap } from '@/lib/engine/scoring';
import { computeGridSummary } from '@/lib/puzzle/gridSummary';
import { db } from '@/lib/server/db';

async function main() {
  await db.profile.upsert({ where: { id: 'local' }, create: { id: 'local' }, update: {} });

  const hole = getHole();
  await db.hole.upsert({
    where: { id: hole.id },
    create: {
      id: hole.id,
      courseName: hole.courseName,
      holeNumber: hole.holeNumber,
      par: hole.par,
      yardage: hole.yardage,
      geojson: JSON.stringify(hole.geojson),
      imageryCenter: JSON.stringify(hole.imageryCenter),
    },
    update: {
      courseName: hole.courseName,
      holeNumber: hole.holeNumber,
      par: hole.par,
      yardage: hole.yardage,
      geojson: JSON.stringify(hole.geojson),
      imageryCenter: JSON.stringify(hole.imageryCenter),
    },
  });

  const prepared = prepareHole(hole);
  const seedBucketProfile = bucketedProfile(SEED_PROFILE);
  const bucket = profileBucket(SEED_PROFILE);

  for (const puzzle of listPuzzles()) {
    const sit = {
      ball: prepared.toLocal(puzzle.ballPosition),
      pin: prepared.toLocal(puzzle.pinPosition),
      lie: puzzle.lie,
    };
    const summary = computeGridSummary(prepared, sit, seedBucketProfile, puzzle.category);
    const rating = puzzleRatingFromTrap(summary.trapSize);

    const data = {
      holeId: hole.id,
      ballPosition: JSON.stringify(puzzle.ballPosition),
      pinPosition: JSON.stringify(puzzle.pinPosition),
      lie: puzzle.lie,
      category: puzzle.category,
      description: puzzle.description,
      rating,
      trapSize: summary.trapSize,
    };
    await db.puzzle.upsert({
      where: { id: puzzle.id },
      create: { id: puzzle.id, ...data },
      update: data,
    });

    // Geometry may have changed: stale grids must not survive a re-seed.
    await db.heatmapCache.deleteMany({ where: { puzzleId: puzzle.id } });
    await db.heatmapCache.create({
      data: {
        puzzleId: puzzle.id,
        profileBucket: bucket,
        grid: JSON.stringify(summary),
        optimalAim: JSON.stringify(summary.optimal.lonlat),
        optimalE: summary.optimal.e,
      },
    });

    console.log(
      `seeded ${puzzle.id}: trap ${summary.trapSize.toFixed(3)} → rating ${rating}, ` +
        `warm cache for ${bucket}`,
    );
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
