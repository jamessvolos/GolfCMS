import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yards, holeYards, parForTiles, clubName, YARDS_PER_TILE, HOLE_LENGTHS } from '../src/engine/yards.js';
import { generateCourse } from '../src/engine/generate.js';
import { dist } from '../src/engine/course.js';
import { GREEN } from '../src/engine/terrain.js';
import { cellAt } from '../src/engine/course.js';

test('yardage conversions are sane', () => {
  assert.equal(yards(10), 10 * YARDS_PER_TILE);
  assert.equal(holeYards(25.3) % 5, 0, 'scorecard yardage rounds to 5');
  assert.equal(parForTiles(13), 3);
  assert.equal(parForTiles(24), 4);
  assert.equal(parForTiles(32), 5);
  assert.equal(clubName(14), 'driver');
  assert.equal(clubName(2), 'pitch');
});

test('hole-length bands produce their advertised pars', () => {
  for (const band of HOLE_LENGTHS) {
    assert.equal(parForTiles(band.min), band.par, `${band.par} at min`);
    assert.equal(parForTiles(band.max), band.par, `${band.par} at max`);
  }
});

test('holeDistTiles override actually shortens holes and keeps the green intact', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const short = generateCourse(seed, 'classic', { holeDistTiles: 13 });
    const d = dist(short.tee, short.hole);
    assert.ok(d >= 8 && d <= 19, `seed ${seed}: par-3 length ${d.toFixed(1)} tiles`);
    assert.equal(cellAt(short, short.hole.x, short.hole.y), GREEN, 'hole on green');
    assert.equal(parForTiles(d), 3, `seed ${seed}: reads as a par 3`);
  }
});

test('omitting opts reproduces the classic course byte-for-byte', () => {
  for (const seed of [1, 42, 1837462913]) {
    assert.deepEqual(generateCourse(seed), generateCourse(seed, 'classic', null));
    // and an opts course differs only by design, not by stream corruption:
    const a = generateCourse(seed, 'classic', { holeDistTiles: 24 });
    const b = generateCourse(seed, 'classic', { holeDistTiles: 24 });
    assert.deepEqual(a, b, 'opts generation is deterministic');
  }
});
