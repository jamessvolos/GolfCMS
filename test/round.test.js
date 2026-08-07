import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRound, scorecard, ROUND_CURVE } from '../src/engine/round.js';
import { verifyPuzzle } from '../src/engine/puzzle.js';

test('rounds are deterministic: same seed = same nine holes', () => {
  const a = makeRound(2026);
  const b = makeRound(2026);
  assert.deepEqual(a.holes.map((h) => h.seed), b.holes.map((h) => h.seed));
  assert.equal(a.totalPar, b.totalPar);
});

test('a round is nine distinct certified holes following the difficulty curve', () => {
  const r = makeRound(777, 'classic');
  assert.equal(r.holes.length, 9);
  assert.equal(new Set(r.holes.map((h) => h.seed)).size, 9, 'no repeated holes');
  for (let i = 0; i < 9; i++) {
    assert.equal(r.holes[i].difficulty, ROUND_CURVE[i], `hole ${i + 1} difficulty`);
    assert.ok(verifyPuzzle(r.holes[i]), `hole ${i + 1} certificate replays`);
  }
  assert.equal(r.totalPar, r.holes.reduce((s, h) => s + h.par, 0));
  assert.ok(r.totalPar >= 18 && r.totalPar <= 63, `sane round par ${r.totalPar}`);
});

test('rounds respect biomes', () => {
  const r = makeRound(55, 'winter');
  assert.equal(r.biome, 'winter');
  for (const h of r.holes) assert.equal(h.biome, 'winter');
});

test('scorecard tracks running and final totals', () => {
  const r = makeRound(2026);
  const partial = scorecard(r, [4, 3]);
  assert.equal(partial.totalStrokes, 7);
  assert.equal(partial.parSoFar, r.holes[0].par + r.holes[1].par);
  assert.equal(partial.complete, false);
  const strokes = r.holes.map((h) => h.par + 1);
  const full = scorecard(r, strokes);
  assert.equal(full.complete, true);
  assert.equal(full.vsPar, 9);
  assert.equal(full.entries.length, 9);
});
