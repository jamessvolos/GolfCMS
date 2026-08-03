/**
 * Audit every committed hole: ring validity, engine classification of pins
 * and puzzle balls, yardage plausibility, and rating sanity. Run after any
 * content change.
 *
 *   npm run content:audit
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kinks, polygon as turfPolygon } from '@turf/turf';
import { classifyPoint, prepareHole } from '@/lib/engine/hole';
import { dist } from '@/lib/engine/projection';
import { ingestSchema } from '@/lib/server/ingestHole';
import type { IngestInput } from '@/lib/server/ingestHole';
import type { HoleData } from '@/lib/engine/types';

const CONTENT_DIR = join(process.cwd(), 'data', 'holes');

function toHoleData(input: IngestInput): HoleData {
  const { hole } = input;
  return {
    id: hole.id,
    courseName: hole.courseName,
    holeNumber: hole.holeNumber,
    par: hole.par,
    yardage: hole.yardage ?? 0,
    groundPlan: hole.groundPlan ?? false,
    imageryCenter: hole.imageryCenter ?? {
      lon: (hole.tees[0]!.lon + hole.pin.lon) / 2,
      lat: (hole.tees[0]!.lat + hole.pin.lat) / 2,
    },
    geojson: {
      type: 'FeatureCollection',
      features: [
        ...hole.polygons.map((p) => {
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
          geometry: { type: 'Point' as const, coordinates: [hole.pin.lon, hole.pin.lat] },
        },
        ...hole.tees.map((t) => ({
          type: 'Feature' as const,
          properties: { kind: 'tee' as const },
          geometry: { type: 'Point' as const, coordinates: [t.lon, t.lat] as [number, number] },
        })),
      ],
    },
  };
}

let failures = 0;
let warnings = 0;
const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.json')).sort();

for (const file of files) {
  const raw = JSON.parse(readFileSync(join(CONTENT_DIR, file), 'utf8'));
  const parsed = ingestSchema.safeParse(raw);
  if (!parsed.success) {
    console.log(`✗ ${file}: schema — ${parsed.error.issues[0]?.message}`);
    failures++;
    continue;
  }
  const input = parsed.data;
  const problems: string[] = [];
  const notes: string[] = [];

  // 1. Ring validity — including the studio's 9-decimal precision contract:
  // stored geometry beyond it is silently dropped when a hole is loaded.
  const overPrecise = input.hole.polygons
    .flatMap((p) => p.ring)
    .filter(([lon, lat]) => Number(lon.toFixed(9)) !== lon || Number(lat.toFixed(9)) !== lat);
  if (overPrecise.length) {
    problems.push(
      `${overPrecise.length} coordinate(s) beyond 9 decimal places — the studio would reject them`,
    );
  }
  for (const [i, p] of input.hole.polygons.entries()) {
    const ring = p.ring.map(([lon, lat]) => [lon, lat] as [number, number]);
    const [fx, fy] = ring[0]!;
    const [lx, ly] = ring[ring.length - 1]!;
    if (fx !== lx || fy !== ly) ring.push([fx, fy]);
    if (ring.length < 4) {
      problems.push(`polygon ${i} (${p.kind}) has too few vertices`);
      continue;
    }
    try {
      const k = kinks(turfPolygon([ring]));
      if (k.features.length > 0) {
        problems.push(`polygon ${i} (${p.kind}) self-intersects ×${k.features.length}`);
      }
    } catch (err) {
      problems.push(`polygon ${i} (${p.kind}) invalid: ${(err as Error).message}`);
    }
  }

  // 2. Engine classification.
  const holeData = toHoleData(input);
  const prepared = prepareHole(holeData);
  const pinLie = classifyPoint(prepared, prepared.pin);
  if (pinLie !== 'green') problems.push(`pin classifies as ${pinLie}`);

  const teeLocal = prepared.toLocal(input.hole.tees[0]!);
  const yards = Math.round(dist(teeLocal, prepared.pin));
  if (yards < 90 || yards > 620) problems.push(`implausible yardage ${yards}y`);

  for (const [i, p] of input.puzzles.entries()) {
    const ballLocal = prepared.toLocal(p.ball);
    const ballLie = classifyPoint(prepared, ballLocal);
    if (ballLie === 'water' || ballLie === 'ob') {
      problems.push(`puzzle ${i + 1} ball in ${ballLie}`);
    } else if (p.lie !== 'tee' && ballLie !== p.lie) {
      notes.push(`puzzle ${i + 1} declared ${p.lie}, classifies ${ballLie}`);
    }
    const toPin = Math.round(dist(ballLocal, prepared.toLocal(p.pin ?? input.hole.pin)));
    if (toPin < 8) problems.push(`puzzle ${i + 1} ball only ${toPin}y from the pin`);
    if (toPin > 620) problems.push(`puzzle ${i + 1} ball ${toPin}y from the pin`);
  }

  const kindCounts = input.hole.polygons.reduce<Record<string, number>>((m, p) => {
    m[p.kind] = (m[p.kind] ?? 0) + 1;
    return m;
  }, {});
  if (!kindCounts.green) problems.push('no green polygon');

  const status = problems.length ? '✗' : notes.length ? '!' : '✓';
  console.log(
    `${status} ${input.hole.id.padEnd(15)} ${String(yards).padStart(3)}y  ` +
      `${input.puzzles.length} pz  ${Object.entries(kindCounts).map(([k, n]) => `${k}×${n}`).join(' ')}`,
  );
  for (const p of problems) console.log(`    ✗ ${p}`);
  for (const n of notes) console.log(`    ! ${n}`);
  if (problems.length) failures++;
  if (notes.length) warnings++;
}

console.log(
  `\n${files.length} holes audited — ${failures} with problems, ${warnings} with warnings`,
);
if (failures) process.exitCode = 1;
