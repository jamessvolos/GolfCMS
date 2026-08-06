/**
 * Play every hole's every puzzle against a sheet of pin positions, and
 * report — or commit — the ones that turn a reflex into a decision.
 *
 *   npm run content:pins                 # measure and print
 *   npm run content:pins -- --commit     # write the keepers into data/holes
 *
 * Why this exists: `evaluate.ts` is blind to where the ball is but fully
 * sensitive to where the pin is, because `pinDist` is its input. Moving the
 * flag is therefore the one lever that produces genuinely new decisions from
 * geometry already committed, with no new physics and no new content.
 *
 * The null is printed with the win. Par-4/5 tee shots are excluded by
 * construction — the pin is beyond max carry, so it is not the reference aim
 * and cannot change the answer — and the table shows what they do anyway.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { maxCarry } from '@/lib/engine/clubs';
import { MC_SAMPLES } from '@/lib/engine/constants';
import { prepareHole } from '@/lib/engine/hole';
import { bucketedProfile, SEED_PROFILE } from '@/lib/engine/profile';
import { dist } from '@/lib/engine/projection';
import { clearsDecisionThreshold, puzzleRatingFromTrap } from '@/lib/engine/scoring';
import { computeGridSummary } from '@/lib/puzzle/gridSummary';
import { holdsSomething } from '@/lib/puzzle/legibility';
import { pinSheet } from '@/lib/content/generate/pins';
import type { Pin } from '@/lib/content/generate/pins';
import { holeDataFromInput, ingestSchema } from '@/lib/server/ingestHole';
import type { IngestInput } from '@/lib/server/ingestHole';

const HOLES_DIR = 'data/holes';
const commit = process.argv.includes('--commit');
/** Deterministic: the sheet a hole gets is a function of the hole, not the run. */
const SHEET_SEED = 1000;
const SHEET_SIZE = Number(process.env.PINS ?? 8);
/**
 * How many variants per hole may be committed. Every committed puzzle costs
 * a Monte Carlo grid on first boot (~0.4s), and fly.toml allows 45 seconds
 * of grace, so the library grows deliberately rather than exhaustively.
 * The miner in Wave 3 is where volume comes from.
 */
const KEEP_PER_HOLE = Number(process.env.KEEP ?? 2);
const nSamples = Number(process.env.SAMPLES ?? MC_SAMPLES);

interface Variant {
  sourceId: string;
  puzzle: IngestInput['puzzles'][number];
  zone: Pin['zone'];
  baseTrap: number;
  trap: number;
  trapSe: number;
  asymmetry: number;
}

function zoneLabel(zone: Pin['zone']): string {
  return zone.replace('-', ' ');
}

function main(): void {
  const profile = bucketedProfile(SEED_PROFILE);
  let baseShips = 0;
  let baseTotal = 0;
  let variantShips = 0;
  let variantTotal = 0;
  const nulls: string[] = [];
  const kept: string[] = [];

  for (const file of readdirSync(HOLES_DIR).sort()) {
    if (!file.endsWith('.json')) continue;
    const path = join(HOLES_DIR, file);
    const input = ingestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    const prepared = prepareHole(holeDataFromInput(input.hole));
    const pins = pinSheet(prepared, SHEET_SEED, { count: SHEET_SIZE });

    // Only the hole's own authored puzzles seed variants; a variant of a
    // variant is the same flag moved twice.
    const seeds = input.puzzles.filter((p) => !p.id?.includes('-pin-'));
    const variants: Variant[] = [];

    for (const p of seeds) {
      const ball = prepared.toLocal(p.ball);
      const base = computeGridSummary(
        prepared,
        { ball, pin: prepared.pin, lie: p.lie },
        profile,
        p.category,
        { nSamples },
      );
      baseTotal++;
      if (holdsSomething(base.trapSize, base.trapSe, base.legibility.asymmetry, clearsDecisionThreshold).ships) {
        baseShips++;
      }

      // The null, stated as a fact about the model rather than a hope: when
      // the pin is beyond max carry it is not the reference aim, so moving
      // it cannot change what the player is being scored against.
      const pinUnreachable = dist(ball, prepared.pin) > maxCarry(profile, p.lie);
      let bestNullDelta = 0;

      for (const pin of pins) {
        const s = computeGridSummary(
          prepared,
          { ball, pin: pin.at, lie: p.lie },
          profile,
          p.category,
          { nSamples },
        );
        variantTotal++;
        const ships = holdsSomething(
          s.trapSize,
          s.trapSe,
          s.legibility.asymmetry,
          clearsDecisionThreshold,
        ).ships;
        if (ships) variantShips++;
        if (pinUnreachable) {
          bestNullDelta = Math.max(bestNullDelta, s.trapSize - base.trapSize);
          continue;
        }
        if (!clearsDecisionThreshold(s.trapSize, s.trapSe)) continue;
        if (s.trapSize < base.trapSize + 0.05) continue;
        variants.push({
          sourceId: p.id ?? `${input.hole.id}-${p.category}`,
          zone: pin.zone,
          baseTrap: base.trapSize,
          trap: s.trapSize,
          trapSe: s.trapSe,
          asymmetry: s.legibility.asymmetry,
          puzzle: {
            ...p,
            id: `${p.id ?? `${input.hole.id}-${p.category}`}-pin-${pin.zone}`,
            pin: prepared.toLonLat(pin.at),
            description: `${p.description.replace(/\.$/, '')} — flag ${zoneLabel(pin.zone)}.`,
          },
        });
      }

      if (pinUnreachable) {
        nulls.push(
          `  ${(p.id ?? '?').padEnd(26)} pin beyond carry — best pin moved trap by ` +
            `${bestNullDelta >= 0 ? '+' : ''}${bestNullDelta.toFixed(3)}`,
        );
      }
    }

    variants.sort((a, b) => b.trap - a.trap);
    const chosen: Variant[] = [];
    for (const v of variants) {
      if (chosen.length >= KEEP_PER_HOLE) break;
      // One variant per source puzzle: eight flags on one approach is eight
      // near-identical puzzles in the same queue band.
      if (chosen.some((c) => c.sourceId === v.sourceId)) continue;
      chosen.push(v);
    }

    for (const v of chosen) {
      kept.push(
        `  ${v.puzzle.id!.padEnd(40)} ${v.baseTrap.toFixed(3)} → ${v.trap.toFixed(3)} ` +
          `± ${v.trapSe.toFixed(3)}   r${puzzleRatingFromTrap(v.baseTrap)}→${puzzleRatingFromTrap(v.trap)}`,
      );
    }

    if (commit && chosen.length) {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as IngestInput;
      const existing = new Set(raw.puzzles.map((p) => p.id));
      raw.puzzles = [
        ...raw.puzzles.filter((p) => !p.id?.includes('-pin-')),
        ...chosen.map((v) => v.puzzle).filter((p) => !existing.has(p.id)),
      ];
      writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
    }
  }

  console.log(`\nPin sheet — ${SHEET_SIZE} flags per green, n=${nSamples}\n`);
  console.log(`shipped flag:  ${baseShips}/${baseTotal} situations hold something`);
  console.log(
    `varied flags:  ${variantShips}/${variantTotal} situations hold something ` +
      `(${((100 * variantShips) / Math.max(1, variantTotal)).toFixed(0)}%)`,
  );

  console.log(`\nkept (top ${KEEP_PER_HOLE} per hole, one per source puzzle):`);
  for (const k of kept) console.log(k);

  console.log('\nthe null — par-4/5 tee shots, where the pin is beyond max carry:');
  for (const n of nulls) console.log(n);

  console.log(
    commit
      ? `\ncommitted ${kept.length} variants into ${HOLES_DIR}. Re-run db:seed.`
      : '\ndry run — pass --commit to write them into data/holes.',
  );
}

main();
