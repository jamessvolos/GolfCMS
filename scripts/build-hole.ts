/**
 * Regenerate the committed hole-data artifact from the yard-space source:
 *   npm run build:hole
 * Emits data/holes/cape-01.json — the same shape the DB seed will consume.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { capeHole, CAPE_PUZZLES } from '../lib/engine/holes/cape';
import { prepareHole } from '../lib/engine/hole';

const hole = capeHole();
const prepared = prepareHole(hole);

const puzzles = CAPE_PUZZLES.map((p) => ({
  id: p.id,
  holeId: hole.id,
  ballPosition: prepared.toLonLat(p.ball),
  lie: p.lie,
  pinPosition: prepared.toLonLat(prepared.pin),
  category: p.category,
  description: p.description,
}));

const out = join(import.meta.dirname, '..', 'data', 'holes', 'cape-01.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ hole, puzzles }, null, 2)}\n`);
console.log(`wrote ${out}`);
