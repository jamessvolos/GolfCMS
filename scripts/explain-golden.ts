/**
 * The golden corpus: run the caddie's note over every shipped puzzle and
 * print it. Read this before changing a rule — it is the only way to see
 * what the system actually says at scale.
 *
 *   npm run explain:golden           # aim at the flag (the naive instinct)
 *   npm run explain:golden -- optimal  # aim at the engine's best line
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateAim } from '@/lib/engine/evaluate';
import { prepareHole } from '@/lib/engine/hole';
import { bucketedProfile, SEED_PROFILE } from '@/lib/engine/profile';
import { scoreBand } from '@/lib/engine/scoring';
import { computeGridSummary } from '@/lib/puzzle/gridSummary';
import { ingestSchema } from '@/lib/server/ingestHole';
import { explain } from '@/lib/explain';
import type { HoleData } from '@/lib/engine/types';

const CONTENT = join(process.cwd(), 'data', 'holes');
const PROFILE = bucketedProfile(SEED_PROFILE);
const mode = process.argv[2] === 'optimal' ? 'optimal' : 'pin';

for (const file of readdirSync(CONTENT).filter((f) => f.endsWith('.json')).sort()) {
  const input = ingestSchema.parse(JSON.parse(readFileSync(join(CONTENT, file), 'utf8')));
  const h = input.hole;
  const hole: HoleData = {
    id: h.id,
    courseName: h.courseName,
    holeNumber: h.holeNumber,
    par: h.par,
    yardage: h.yardage ?? 0,
    groundPlan: h.groundPlan ?? false,
    imageryCenter: h.imageryCenter ?? {
      lon: (h.tees[0]!.lon + h.pin.lon) / 2,
      lat: (h.tees[0]!.lat + h.pin.lat) / 2,
    },
    geojson: {
      type: 'FeatureCollection',
      features: [
        ...h.polygons.map((p) => {
          const ring = p.ring.map(([lon, lat]) => [lon, lat] as [number, number]);
          const [fx, fy] = ring[0]!;
          const [lx, ly] = ring[ring.length - 1]!;
          if (fx !== lx || fy !== ly) ring.push([fx, fy]);
          return {
            type: 'Feature' as const,
            properties: { kind: p.kind, ...(p.name ? { name: p.name } : {}) },
            geometry: { type: 'Polygon' as const, coordinates: [ring] },
          };
        }),
        {
          type: 'Feature' as const,
          properties: { kind: 'pin' as const },
          geometry: {
            type: 'Point' as const,
            coordinates: [h.pin.lon, h.pin.lat] as [number, number],
          },
        },
        ...h.tees.map((t) => ({
          type: 'Feature' as const,
          properties: { kind: 'tee' as const },
          geometry: { type: 'Point' as const, coordinates: [t.lon, t.lat] as [number, number] },
        })),
      ],
    },
  };

  const prepared = prepareHole(hole);
  for (const p of input.puzzles) {
    const sit = {
      ball: prepared.toLocal(p.ball),
      pin: prepared.toLocal(p.pin ?? h.pin),
      lie: p.lie,
    };
    const grid = computeGridSummary(prepared, sit, PROFILE, p.category);
    const playerAim = mode === 'optimal' ? grid.optimal.local : sit.pin;
    const playerEval = evaluateAim(prepared, sit, PROFILE, playerAim);
    const sgLoss = playerEval.expectedStrokes - grid.optimal.e;
    const band = scoreBand(sgLoss).band;
    const note = explain({
      category: p.category,
      lie: p.lie,
      band,
      sgLoss,
      prepared,
      sit,
      profile: PROFILE,
      playerAim,
      playerEval,
      grid,
      evaluate: (aim) => evaluateAim(prepared, sit, PROFILE, aim),
      history: [],
    });

    console.log(`\n── ${p.id ?? h.id} · ${h.courseName} No. ${h.holeNumber} · ${p.category}`);
    console.log(`   ${band.toUpperCase()}  sgLoss ${Math.max(0, sgLoss).toFixed(2)}`);
    console.log('   THE READ');
    for (const c of note.read) console.log(`     ${c.text}`);
    if (note.move) {
      console.log('   THE MOVE');
      console.log(`     ${note.move.text}`);
    }
    console.log(`   [${note.ruleIds.join(', ')}]`);
  }
}
