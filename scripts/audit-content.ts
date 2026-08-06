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
import { DECISION_TRAP } from '@/lib/engine/constants';
import { measureLibrary } from './rating-drift';
import { dist } from '@/lib/engine/projection';
import { holeDataFromInput, ingestSchema } from '@/lib/server/ingestHole';

const CONTENT_DIR = join(process.cwd(), 'data', 'holes');

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
  const allRings = input.hole.polygons.flatMap((p) => [p.ring, ...(p.holes ?? [])]);
  const overPrecise = allRings
    .flat()
    .filter(([lon, lat]) => Number(lon.toFixed(9)) !== lon || Number(lat.toFixed(9)) !== lat);
  if (overPrecise.length) {
    problems.push(
      `${overPrecise.length} coordinate(s) beyond 9 decimal places — the studio would reject them`,
    );
  }
  for (const [i, p] of input.hole.polygons.entries()) {
    // Islands are checked alongside the outer ring: an imported multipolygon
    // can carry a malformed inner ring just as easily as a traced outer one.
    const rings: [string, [number, number][]][] = [
      [`polygon ${i} (${p.kind})`, p.ring],
      ...(p.holes ?? []).map(
        (h, j) => [`polygon ${i} (${p.kind}) island ${j + 1}`, h] as [string, [number, number][]],
      ),
    ];
    for (const [label, raw] of rings) {
      const ring = raw.map(([lon, lat]) => [lon, lat] as [number, number]);
      const [fx, fy] = ring[0]!;
      const [lx, ly] = ring[ring.length - 1]!;
      if (fx !== lx || fy !== ly) ring.push([fx, fy]);
      if (ring.length < 4) {
        problems.push(`${label} has too few vertices`);
        continue;
      }
      try {
        const k = kinks(turfPolygon([ring]));
        if (k.features.length > 0) {
          problems.push(`${label} self-intersects ×${k.features.length}`);
        }
      } catch (err) {
        problems.push(`${label} invalid: ${(err as Error).message}`);
      }
    }
  }

  // 2. Engine classification.
  const holeData = holeDataFromInput(input.hole);
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

// The decision census. Geometry can be flawless and the content still be
// worthless: a hole whose every puzzle has the flag as its optimal aim
// awards PERFECT for a reflex. This is not a build failure while the
// shipped library is the only supply — it is the number the miner exists to
// move, so it is printed on every audit and asserted in CI once Wave 3
// lands a pack.
if (!process.argv.includes('--no-decisions')) {
  const rows = measureLibrary();
  const serving = rows.filter((r) => r.serves);
  const ses = rows.map((r) => r.trapSe).sort((a, b) => a - b);
  console.log(
    `\nDecision census — ${serving.length} of ${rows.length} puzzles hold a decision ` +
      `(trap − 2·SE ≥ ${DECISION_TRAP.toFixed(2)}); SE median ${ses[ses.length >> 1]!.toFixed(3)} strokes.`,
  );
  for (const r of serving.sort((a, b) => b.trap - a.trap)) {
    console.log(
      `    ✓ ${r.puzzleId.padEnd(26)} trap ${r.trap.toFixed(3)} ± ${r.trapSe.toFixed(3)}  rating ${r.rating}`,
    );
  }
}

if (failures) process.exitCode = 1;
