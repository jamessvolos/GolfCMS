/**
 * Seed the database from the committed content files in data/holes/,
 * through the same ingestion pipeline the annotation studio uses (so
 * ratings, geometry checks, and warm heatmap caches are identical).
 *
 *   npm run db:seed
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ingestHole, ingestSchema } from '@/lib/server/ingestHole';
import { db } from '@/lib/server/db';

const CONTENT_DIR = join(process.cwd(), 'data', 'holes');

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
  console.log(`\nseeded ${files.length} holes / ${puzzleCount} puzzles`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
