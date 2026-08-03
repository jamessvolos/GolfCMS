/**
 * Export every hole in the database to committed seed files under
 * data/holes/<slug>.json, in the exact shape the ingest pipeline accepts.
 * Content traced in the annotation studio lives in the gitignored dev DB;
 * this is how it becomes a repo artifact a fresh clone can seed from.
 *
 *   npm run content:export
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '@/lib/server/db';
import type { IngestInput } from '@/lib/server/ingestHole';

const OUT_DIR = join(process.cwd(), 'data', 'holes');

async function main() {
  const holes = await db.hole.findMany({
    include: { puzzles: { orderBy: { id: 'asc' } } },
    orderBy: { id: 'asc' },
  });
  mkdirSync(OUT_DIR, { recursive: true });

  for (const hole of holes) {
    const geojson = JSON.parse(hole.geojson) as {
      features: {
        properties: { kind: string; name?: string };
        geometry:
          | { type: 'Polygon'; coordinates: [number, number][][] }
          | { type: 'Point'; coordinates: [number, number] };
      }[];
    };

    const polygons: IngestInput['hole']['polygons'] = [];
    const tees: { lon: number; lat: number }[] = [];
    let pin: { lon: number; lat: number } | null = null;

    for (const f of geojson.features) {
      if (f.geometry.type === 'Polygon') {
        polygons.push({
          kind: f.properties.kind as IngestInput['hole']['polygons'][number]['kind'],
          ...(f.properties.name ? { name: f.properties.name } : {}),
          ring: f.geometry.coordinates[0]!.map(([lon, lat]) => [lon, lat] as [number, number]),
        });
      } else if (f.properties.kind === 'pin') {
        pin = { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
      } else {
        tees.push({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
      }
    }
    if (!pin || tees.length === 0) {
      console.warn(`skipping ${hole.id}: missing pin or tee`);
      continue;
    }

    const payload: IngestInput = {
      hole: {
        id: hole.id,
        courseName: hole.courseName,
        holeNumber: hole.holeNumber,
        par: hole.par,
        yardage: hole.yardage,
        imageryCenter: JSON.parse(hole.imageryCenter),
        groundPlan: hole.groundPlan,
        polygons,
        pin,
        tees,
      },
      puzzles: hole.puzzles.map((p) => ({
        id: p.id,
        ball: JSON.parse(p.ballPosition),
        pin: JSON.parse(p.pinPosition),
        lie: p.lie as IngestInput['puzzles'][number]['lie'],
        category: p.category as IngestInput['puzzles'][number]['category'],
        description: p.description,
      })),
    };

    const file = join(OUT_DIR, `${hole.id}.json`);
    writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
    const verts = polygons.reduce((n, p) => n + p.ring.length, 0);
    console.log(
      `${hole.id}: ${polygons.length} polygons (${verts} vertices), ` +
        `${payload.puzzles.length} puzzles → data/holes/${hole.id}.json`,
    );
  }
  console.log(`\nexported ${holes.length} holes`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
