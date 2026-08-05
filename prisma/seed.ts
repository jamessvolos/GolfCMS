/**
 * Seed the database from the committed content files in data/holes/,
 * through the same ingestion pipeline the annotation studio uses (so
 * ratings, geometry checks, and warm heatmap caches are identical).
 *
 *   npm run db:seed
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { holeDataFromInput, ingestHole, ingestSchema } from '@/lib/server/ingestHole';
import type { IngestInput } from '@/lib/server/ingestHole';
import { GRID_VERSION } from '@/lib/server/heatmap';
import { profileBucket, SEED_PROFILE } from '@/lib/engine/profile';
import { db } from '@/lib/server/db';

const CONTENT_DIR = join(process.cwd(), 'data', 'holes');
const SEED_BUCKET = `v${GRID_VERSION}-${profileBucket(SEED_PROFILE)}`;

/**
 * Is this hole already in the database exactly as the file describes it,
 * with its warm grids intact?
 *
 * Ingesting recomputes a Monte Carlo grid per puzzle, which is 27 seconds
 * for the shipped library — and the container entrypoint seeds on every
 * boot. Paying that on each restart makes a redeploy 27 seconds of
 * downtime and makes scale-to-zero hosting unusable.
 *
 * The check is deliberately conservative: identical geometry, the same set
 * of puzzle ids, and a cached grid for every one of them at the seed
 * bucket. The bucket string carries GRID_VERSION, so an engine change
 * invalidates every row and the work happens again.
 */
async function isCurrent(input: IngestInput): Promise<boolean> {
  const holeData = holeDataFromInput(input.hole);
  const existing = await db.hole.findUnique({
    where: { id: input.hole.id },
    select: { geojson: true, source: true, puzzles: { select: { id: true } } },
  });
  if (!existing) return false;
  if (existing.geojson !== JSON.stringify(holeData.geojson)) return false;
  if (existing.source !== holeData.source) return false;

  const wanted = input.puzzles.map(
    (p, i) => p.id ?? `${input.hole.id}-${p.category}-${i + 1}`,
  );
  const have = new Set(existing.puzzles.map((p) => p.id));
  if (wanted.length !== have.size || !wanted.every((id) => have.has(id))) return false;

  const warm = await db.heatmapCache.count({
    where: { puzzleId: { in: wanted }, profileBucket: SEED_BUCKET },
  });
  return warm === wanted.length;
}

/** SG_SEED_FORCE=1 re-ingests everything, ignoring the up-to-date check. */
const force = process.env.SG_SEED_FORCE === '1';

async function main() {
  await db.profile.upsert({ where: { id: 'local' }, create: { id: 'local' }, update: {} });

  const files = readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    console.log('no content files in data/holes — nothing to seed');
    return;
  }

  let puzzleCount = 0;
  let skipped = 0;
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(CONTENT_DIR, file), 'utf8'));
    const parsed = ingestSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      console.error(`✗ ${file}: ${issue?.path.join('.')} — ${issue?.message}`);
      process.exitCode = 1;
      continue;
    }
    try {
      if (!force && (await isCurrent(parsed.data))) {
        puzzleCount += parsed.data.puzzles.length;
        skipped++;
        continue;
      }
      const result = await ingestHole(parsed.data);
      puzzleCount += result.puzzles.length;
      const ratings = result.puzzles.map((p) => `${p.id} ${p.rating}`).join(', ');
      console.log(`✓ ${result.holeId} (${result.yardage}y): ${ratings}`);
      for (const w of result.warnings) console.log(`  ⚠ ${w}`);
    } catch (err) {
      console.error(`✗ ${file}: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
  }
  console.log(
    `\nseeded ${files.length} holes / ${puzzleCount} puzzles` +
      (skipped ? ` — ${skipped} already current, left alone` : ''),
  );
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
