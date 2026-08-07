import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGauntlet, weekKey, gauntletSeed, GAUNTLET_LADDER } from '../src/engine/gauntlet.js';
import { verifyPuzzle } from '../src/engine/puzzle.js';

test('weekKey follows ISO-8601 weeks', () => {
  assert.equal(weekKey('2026-08-07'), '2026-W32');
  assert.equal(weekKey('2026-08-09'), '2026-W32'); // Sunday, same week
  assert.equal(weekKey('2026-08-10'), '2026-W33'); // Monday rolls over
  assert.equal(weekKey('2026-01-01'), '2026-W01');
  assert.equal(weekKey('2027-01-01'), '2026-W53'); // Jan 1 2027 is a Friday
});

test('the same week yields the same gauntlet every day', () => {
  const fri = makeGauntlet('2026-08-07');
  const sun = makeGauntlet('2026-08-09');
  assert.deepEqual(fri.holes.map((h) => h.seed), sun.holes.map((h) => h.seed));
  assert.equal(fri.week, '2026-W32');
  assert.notEqual(gauntletSeed('2026-W32'), gauntletSeed('2026-W33'));
});

test('five certified holes escalating through the ladder', () => {
  const g = makeGauntlet('2026-08-07');
  assert.equal(g.holes.length, 5);
  for (let i = 0; i < 5; i++) {
    assert.equal(g.holes[i].difficulty, GAUNTLET_LADDER[i].difficulty, `rung ${i} difficulty`);
    assert.equal(g.holes[i].biome, GAUNTLET_LADDER[i].biome, `rung ${i} biome`);
    assert.ok(verifyPuzzle(g.holes[i]), `rung ${i} certificate replays`);
  }
  assert.equal(g.totalPar, g.holes.reduce((s, h) => s + h.par, 0));
});
