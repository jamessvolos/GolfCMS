/**
 * Seed the dev database through the same ingestion pipeline the annotate
 * studio uses: the single local profile plus the cape fixture hole with
 * its puzzles (ratings from trap size, warm heatmap cache).
 *
 *   npm run db:seed
 */

import { getHole, listPuzzles } from '@/lib/content/holes';
import { ingestHole } from '@/lib/server/ingestHole';
import type { IngestInput } from '@/lib/server/ingestHole';
import { db } from '@/lib/server/db';

function capeAsIngest(): IngestInput {
  const hole = getHole();
  const polygons: IngestInput['hole']['polygons'] = [];
  const tees: { lon: number; lat: number }[] = [];
  let pin: { lon: number; lat: number } | null = null;

  for (const f of hole.geojson.features) {
    if (f.geometry.type === 'Polygon') {
      polygons.push({
        kind: f.properties.kind as IngestInput['hole']['polygons'][number]['kind'],
        name: f.properties.name,
        ring: f.geometry.coordinates[0]!.map(([lon, lat]) => [lon, lat] as [number, number]),
      });
    } else if (f.properties.kind === 'pin') {
      const [lon, lat] = f.geometry.coordinates;
      pin = { lon, lat };
    } else {
      const [lon, lat] = f.geometry.coordinates;
      tees.push({ lon, lat });
    }
  }
  if (!pin) throw new Error('cape fixture has no pin');

  return {
    hole: {
      id: hole.id,
      courseName: hole.courseName,
      holeNumber: hole.holeNumber,
      par: hole.par,
      yardage: hole.yardage,
      imageryCenter: hole.imageryCenter,
      polygons,
      pin,
      tees,
    },
    puzzles: listPuzzles().map((p) => ({
      id: p.id,
      ball: p.ballPosition,
      pin: p.pinPosition,
      lie: p.lie,
      category: p.category,
      description: p.description,
    })),
  };
}

async function main() {
  await db.profile.upsert({ where: { id: 'local' }, create: { id: 'local' }, update: {} });
  const result = await ingestHole(capeAsIngest());
  for (const p of result.puzzles) {
    console.log(`seeded ${p.id}: trap ${p.trapSize.toFixed(3)} → rating ${p.rating}`);
  }
  for (const w of result.warnings) console.log(`warning: ${w}`);
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await db.$disconnect();
    process.exit(1);
  });
