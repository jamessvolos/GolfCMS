/**
 * Regenerate the cape fixture's content file from its yard-space source:
 *   npx tsx scripts/build-hole.ts
 *
 * The cape is the one synthetic hole (hand-authored in lib/engine/holes/
 * cape.ts, used by the engine tests and the ASCII demo); every other hole
 * in data/holes/ is traced in the annotation studio and exported with
 * `npm run content:export`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { capeHole, CAPE_PUZZLES } from '@/lib/engine/holes/cape';
import { prepareHole } from '@/lib/engine/hole';
import type { IngestInput } from '@/lib/server/ingestHole';

const hole = capeHole();
const prepared = prepareHole(hole);

const polygons: IngestInput['hole']['polygons'] = [];
const tees: { lon: number; lat: number }[] = [];
let pin: { lon: number; lat: number } | null = null;

for (const f of hole.geojson.features) {
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
if (!pin) throw new Error('cape fixture has no pin');

const payload: IngestInput = {
  hole: {
    id: hole.id,
    courseName: hole.courseName,
    holeNumber: hole.holeNumber,
    par: hole.par,
    yardage: hole.yardage,
    imageryCenter: hole.imageryCenter,
    // Synthetic: its polygons ARE the ground, so they're painted.
    groundPlan: true,
    polygons,
    pin,
    tees,
  },
  puzzles: CAPE_PUZZLES.map((p) => ({
    id: p.id,
    ball: prepared.toLonLat(p.ball),
    pin: prepared.toLonLat(prepared.pin),
    lie: p.lie,
    category: p.category,
    description: p.description,
  })),
};

const out = join(process.cwd(), 'data', 'holes', 'cape-01.json');
mkdirSync(join(process.cwd(), 'data', 'holes'), { recursive: true });
writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`wrote ${out}`);
