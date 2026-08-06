/**
 * What did changing the yardstick do to every rating in the library?
 *
 * A change to `referenceAim` or to the rating curve does not add noise to a
 * rating — it changes which puzzles the product believes are hard. That is
 * invisible in a diff and invisible in a passing test suite, so it is
 * published as a table instead.
 *
 *   npm run content:drift
 *   npm run content:drift -- --json      # machine-readable, for CI
 *
 * The columns are: the trap and rating the library ships with, the trap and
 * rating under the current code, and the error bar the rating now carries.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DECISION_TRAP, MC_SAMPLES } from '@/lib/engine/constants';
import { prepareHole } from '@/lib/engine/hole';
import { bucketedProfile, SEED_PROFILE } from '@/lib/engine/profile';
import { dist } from '@/lib/engine/projection';
import { clearsDecisionThreshold, puzzleRatingFromTrap } from '@/lib/engine/scoring';
import { computeGridSummary } from '@/lib/puzzle/gridSummary';
import { holdsSomething } from '@/lib/puzzle/legibility';
import { holeDataFromInput, ingestSchema } from '@/lib/server/ingestHole';
import type { PlayableLie, PuzzleCategory } from '@/lib/engine/types';

const HOLES_DIR = 'data/holes';
const asJson = process.argv.includes('--json');
const nSamples = Number(process.env.SAMPLES ?? MC_SAMPLES);

export interface DriftRow {
  puzzleId: string;
  courseName: string;
  par: number;
  yardage: number;
  category: PuzzleCategory;
  lie: PlayableLie;
  toPin: number;
  /** Distance to the reference aim; equals toPin whenever the pin is reachable. */
  referenceYds: number;
  referenceIsPin: boolean;
  trap: number;
  trapSe: number;
  rating: number;
  consequence: number;
  asymmetry: number;
  /** '', 'decision' or 'consequence'. */
  holds: string;
  serves: boolean;
}

export function measureLibrary(): DriftRow[] {
  const profile = bucketedProfile(SEED_PROFILE);
  const rows: DriftRow[] = [];
  for (const file of readdirSync(HOLES_DIR).sort()) {
    if (!file.endsWith('.json')) continue;
    const input = ingestSchema.parse(JSON.parse(readFileSync(join(HOLES_DIR, file), 'utf8')));
    const prepared = prepareHole(holeDataFromInput(input.hole));
    for (const puzzle of input.puzzles) {
      const ball = prepared.toLocal(puzzle.ball);
      const pin = puzzle.pin ? prepared.toLocal(puzzle.pin) : prepared.pin;
      const summary = computeGridSummary(
        prepared,
        { ball, pin, lie: puzzle.lie },
        profile,
        puzzle.category,
        { nSamples },
      );
      const held = holdsSomething(
        summary.trapSize,
        summary.trapSe,
        summary.legibility.asymmetry,
        clearsDecisionThreshold,
      );
      const referenceIsPin =
        Math.abs(summary.naive.local.x - pin.x) < 1e-9 &&
        Math.abs(summary.naive.local.y - pin.y) < 1e-9;
      rows.push({
        puzzleId: puzzle.id ?? `${input.hole.id}-${puzzle.category}`,
        courseName: input.hole.courseName,
        par: input.hole.par,
        yardage: input.hole.yardage ?? Math.round(dist(prepared.toLocal(input.hole.tees[0]!), prepared.pin)),
        category: puzzle.category,
        lie: puzzle.lie,
        toPin: Math.round(dist(ball, pin)),
        referenceYds: Math.round(dist(ball, summary.naive.local)),
        referenceIsPin,
        trap: summary.trapSize,
        trapSe: summary.trapSe,
        rating: puzzleRatingFromTrap(summary.trapSize),
        consequence: summary.legibility.consequence,
        asymmetry: summary.legibility.asymmetry,
        holds: held.because ?? '',
        serves: held.ships,
      });
    }
  }
  return rows;
}

function main(): void {
  const rows = measureLibrary();
  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  rows.sort((a, b) => b.trap - a.trap);
  console.log(`\nRating drift — ${rows.length} shipped puzzles at n=${nSamples}\n`);
  console.log(
    'puzzle                             par   toPin   ref     trap    ±SE   rating  asym   holds',
  );
  for (const r of rows) {
    console.log(
      `${r.puzzleId.padEnd(35)} ${String(r.par).padStart(3)}  ` +
        `${String(r.toPin).padStart(5)}y  ${(r.referenceIsPin ? 'pin' : `${r.referenceYds}y`).padStart(5)}  ` +
        `${r.trap.toFixed(3).padStart(6)}  ${r.trapSe.toFixed(3)}   ` +
        `${String(r.rating).padStart(5)}  ${r.asymmetry.toFixed(2)}   ${r.holds || '—'}`,
    );
  }

  const serving = rows.filter((r) => r.serves);
  const ses = rows.map((r) => r.trapSe).sort((a, b) => a - b);
  const decisions = rows.filter((r) => r.holds === 'decision').length;
  const consequences = rows.filter((r) => r.holds === 'consequence').length;
  console.log(
    `\n${serving.length} of ${rows.length} hold something — ` +
      `${decisions} a decision (trap − 2·SE ≥ ${DECISION_TRAP.toFixed(2)}), ` +
      `${consequences} a one-sided consequence.`,
  );
  console.log(
    `SE range ${ses[0]!.toFixed(3)}–${ses[ses.length - 1]!.toFixed(3)}, ` +
      `median ${ses[ses.length >> 1]!.toFixed(3)} strokes.`,
  );
  const byRef = rows.filter((r) => r.referenceIsPin).length;
  console.log(
    `Reference aim was the flag on ${byRef} of ${rows.length}; ` +
      `the rest could not reach it and are measured against the reachable line.`,
  );
}

if (process.argv[1]?.endsWith('rating-drift.ts')) main();
