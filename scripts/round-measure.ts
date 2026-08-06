/**
 * What is course management worth over a round, and can a scoreboard show it?
 *
 *   npm run round:measure                     # holes that hold decisions
 *   HOLES=8 SEEDS=20 npm run round:measure
 *
 * Two policies play the same holes off the same tees on the IDENTICAL dice:
 * the reflex (aim where you were going to aim) and the caddie (aim where the
 * engine says). Common random numbers, exactly as the optimizer already uses
 * them — the two cards differ only in where they pointed.
 *
 * It reports two margins, and the gap between them is the point.
 *
 *  - EXPECTED, the sum of sgLoss the reflex conceded. Low variance, because
 *    it is an expectation rather than an outcome.
 *  - OBSERVED, the difference in strokes actually taken. This is what a
 *    scoreboard would show a player, and it is noise-dominated at any
 *    session length a person will sit through.
 */

import { readFileSync, existsSync } from 'node:fs';
import { prepareHole } from '@/lib/engine/hole';
import { bucketedProfile, SEED_PROFILE } from '@/lib/engine/profile';
import { holeDataFromInput, ingestSchema } from '@/lib/server/ingestHole';
import { caddie, playHole, reflex } from '@/lib/round/card';
import type { IngestInput } from '@/lib/server/ingestHole';

const PACK = 'data/packs/se-england.json';
const HOLES = Number(process.env.HOLES ?? 8);
const SEEDS = Number(process.env.SEEDS ?? 10);
const SAMPLES = Number(process.env.SAMPLES ?? 300);

function decisionHoles(): IngestInput[] {
  if (!existsSync(PACK)) return [];
  const pack = JSON.parse(readFileSync(PACK, 'utf8')) as unknown[];
  return pack
    .map((raw) => ingestSchema.parse(raw))
    .filter((h) => h.puzzles.some((p) => p.stats?.holds === 'decision' && p.stats.trapSize > 0.25))
    .slice(0, HOLES);
}

function main(): void {
  const profile = bucketedProfile(SEED_PROFILE);
  const holes = decisionHoles();
  if (!holes.length) {
    console.error(`no mined holes with decisions in ${PACK} — run npm run mine first`);
    process.exitCode = 1;
    return;
  }

  let reflexStrokes = 0;
  let caddieStrokes = 0;
  let conceded = 0;
  let plays = 0;
  let asks = 0;
  const margins: number[] = [];

  for (const input of holes) {
    const prepared = prepareHole(holeDataFromInput(input.hole));
    const start = { ball: prepared.toLocal(input.hole.tees[0]!), lie: 'tee' as const };
    for (let i = 0; i < SEEDS; i++) {
      const seed = 1000 * (i + 1);
      const a = playHole(prepared, start, profile, seed, reflex, { nSamples: SAMPLES, holeIndex: plays });
      const b = playHole(prepared, start, profile, seed, caddie, { nSamples: SAMPLES, holeIndex: plays });
      reflexStrokes += a.strokes;
      caddieStrokes += b.strokes;
      conceded += a.conceded;
      margins.push(a.strokes - b.strokes);
      asks += a.shots.length;
      plays++;
    }
  }

  const mean = margins.reduce((s, m) => s + m, 0) / plays;
  const variance = margins.reduce((s, m) => s + (m - mean) ** 2, 0) / Math.max(1, plays - 1);
  const sePerHole = Math.sqrt(variance / plays);

  console.log(`\n${holes.length} holes × ${SEEDS} cards = ${plays} hole-plays, ${asks} scored aims\n`);
  console.log(`  expected margin   ${(conceded / plays * 18).toFixed(2)} strokes per 18  (sum of sgLoss conceded)`);
  console.log(`  observed margin   ${(mean * 18).toFixed(2)} strokes per 18  ± ${(sePerHole * 18).toFixed(2)} (1 SE)`);
  console.log(`  per-hole SD       ${Math.sqrt(variance).toFixed(2)} strokes`);

  // How much play would it take for the scoreboard to be the evidence?
  const effect = conceded / plays;
  const needed = effect > 0 ? Math.ceil(variance / (effect / 2) ** 2 / 18) : Infinity;
  console.log(
    `\n  To resolve that effect at 2 SE the scoreboard needs about ${Number.isFinite(needed) ? needed : '∞'} rounds of 18.`,
  );
  console.log('  The ledger reads the same effect off one session, because it is an');
  console.log('  expectation rather than an outcome. That is why the ledger is the headline');
  console.log('  and the match result is not.');
}

main();
