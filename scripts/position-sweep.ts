/**
 * Does a hole contain more decision than the library takes from it?
 *
 * The shipped library gives every hole exactly two positions: the tee, and
 * where the optimal tee shot was *aimed* (see lib/content/osm/puzzles.ts).
 * The second is circular — the ball is placed at the point the optimizer
 * chose as the best available outcome, which is by construction a position
 * from which the next shot is easy. So "this hole has no decision in it" may
 * be a fact about the hole, or it may be an artefact of where we put the
 * ball.
 *
 * This asks the hole directly. Scatter a ball across the hole's own
 * polygons, keep the playable positions, and compute a trap size at each.
 *
 *   npm run content:positions -- sawgrass-18 doral-18
 *   N=100 SAMPLES=600 npm run content:positions -- sawgrass-18
 *
 * A uniform scatter is the right instrument for THIS question and the wrong
 * one for generating puzzles: it includes positions no round ever produces.
 * It is here to measure the ceiling, not to pick content.
 */

import { readFileSync } from 'node:fs';
import { classifyPoint, prepareHole } from '@/lib/engine/hole';
import { bucketedProfile, SEED_PROFILE } from '@/lib/engine/profile';
import { dist } from '@/lib/engine/projection';
import { createRng } from '@/lib/engine/rng';
import { computeGridSummary } from '@/lib/puzzle/gridSummary';
import { holeDataFromInput, ingestSchema } from '@/lib/server/ingestHole';
import type { PlayableLie, PreparedHole, Pt } from '@/lib/engine/types';

const PROFILE = bucketedProfile(SEED_PROFILE);
/** Positions to keep per hole. */
const N = Number(process.env.N ?? 120);
/** Monte Carlo samples per grid. 600 is the engine default; 300 is a screen. */
const SAMPLES = Number(process.env.SAMPLES ?? 300);
const SEED = Number(process.env.SEED ?? 4242);
/** Closer in than this is a chip, not a course-management decision. */
const MIN_YDS = 40;

interface Row {
  at: Pt;
  lie: PlayableLie;
  toPin: number;
  trap: number;
}

function bbox(prepared: PreparedHole) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const poly of prepared.polygons) {
    for (const ring of poly.rings) {
      for (const p of ring) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

function sweep(id: string): void {
  const input = ingestSchema.parse(
    JSON.parse(readFileSync(`data/holes/${id}.json`, 'utf8')),
  );
  const prepared = prepareHole(holeDataFromInput(input.hole));
  const tee = prepared.toLocal(input.hole.tees[0]!);
  const pin = prepared.pin;
  const holeYds = dist(tee, pin);
  const { minX, maxX, minY, maxY } = bbox(prepared);

  const rng = createRng(SEED);
  const rows: Row[] = [];
  let tried = 0;
  // Rejection sampling: most of a hole's bounding box is water, green, OB
  // or off the property. The cap keeps a hole that is almost all hazard
  // from spinning forever.
  while (rows.length < N && tried < N * 40) {
    tried++;
    const at = { x: minX + rng() * (maxX - minX), y: minY + rng() * (maxY - minY) };
    const lie = classifyPoint(prepared, at);
    if (lie === 'water' || lie === 'ob' || lie === 'green') continue;
    const toPin = dist(at, pin);
    // Nothing behind the tee: those are positions a round cannot produce.
    if (toPin < MIN_YDS || toPin > holeYds + 40) continue;
    const summary = computeGridSummary(
      prepared,
      { ball: at, pin, lie },
      PROFILE,
      toPin > 240 ? 'layup' : 'approach',
      { nSamples: SAMPLES },
    );
    rows.push({ at, lie, toPin, trap: summary.trapSize });
  }

  if (!rows.length) {
    console.log(`\n${id}: no playable position found in ${tried} samples`);
    return;
  }

  rows.sort((a, b) => b.trap - a.trap);
  const traps = rows.map((r) => r.trap);
  const at = (f: number) => traps[Math.min(traps.length - 1, Math.floor(f * traps.length))]!;
  const over = (t: number) => traps.filter((x) => x >= t).length;
  const pct = (n: number) => `${((100 * n) / rows.length).toFixed(0)}%`;

  console.log(
    `\n${id}  par ${input.hole.par}  ${Math.round(holeYds)}y   ` +
      `${rows.length} playable positions of ${tried} sampled  (n=${SAMPLES})`,
  );
  console.log(
    `  trap  max ${at(0).toFixed(3)}  p90 ${at(0.1).toFixed(3)}  ` +
      `median ${at(0.5).toFixed(3)}  min ${traps[traps.length - 1]!.toFixed(3)}`,
  );
  console.log(
    `  >=0.10: ${over(0.1)} (${pct(over(0.1))})   ` +
      `>=0.32: ${over(0.32)} (${pct(over(0.32))})   ` +
      `>=0.60: ${over(0.6)} (${pct(over(0.6))})`,
  );
  console.log('  top 6:');
  for (const r of rows.slice(0, 6)) {
    console.log(`    trap ${r.trap.toFixed(3)}  ${r.lie.padEnd(8)} ${Math.round(r.toPin)}y to pin`);
  }
  const byLie = new Map<PlayableLie, number[]>();
  for (const r of rows) {
    const xs = byLie.get(r.lie) ?? [];
    xs.push(r.trap);
    byLie.set(r.lie, xs);
  }
  console.log(
    '  by lie: ' +
      [...byLie.entries()]
        .map(([l, xs]) => `${l} n=${xs.length} mean ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)}`)
        .join('  '),
  );
}

function main(): void {
  const ids = process.argv.slice(2);
  if (!ids.length) {
    console.error('usage: npm run content:positions -- <hole-id> [hole-id...]');
    process.exitCode = 1;
    return;
  }
  for (const id of ids) sweep(id);
}

main();
