import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateStars, starLabel, calibration } from '../src/engine/difficulty.js';
import { makePuzzle } from '../src/engine/puzzle.js';

test('stars stay in [1, 5] in half-star steps across seeds and modes', () => {
  for (let seed = 1; seed <= 12; seed++) {
    for (const [diff, biome] of [['easy', 'classic'], ['standard', 'winter'], ['rude', 'links']]) {
      const s = estimateStars(makePuzzle(seed, diff, biome));
      assert.ok(s >= 1 && s <= 5, `stars ${s} in range`);
      assert.equal((s * 2) % 1, 0, 'half-star steps');
    }
  }
});

test('harder configurations never rate below their gentler twin', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const easy = estimateStars(makePuzzle(seed, 'easy', 'classic'));
    const rude = estimateStars(makePuzzle(seed, 'rude', 'classic'));
    // same base seed family; rude adds a trouble start + modifier
    assert.ok(rude >= easy, `seed ${seed}: rude ${rude} >= easy ${easy}`);
  }
});

test('starLabel renders halves', () => {
  assert.equal(starLabel(3), '★★★');
  assert.equal(starLabel(2.5), '★★½');
  assert.equal(starLabel(1), '★');
});

test('calibration verdicts respond to the recorded history', () => {
  const mk = (over) => ({ strokes: 3 + over, par: 3, stars: 3 });
  assert.equal(calibration([mk(2)], 3).verdict, '', 'needs 3+ samples');
  assert.equal(calibration([mk(2), mk(2), mk(2)], 3).verdict, 'plays harder than rated for you');
  assert.equal(calibration([mk(0), mk(0), mk(0)], 3).verdict, 'plays easier than rated for you');
  assert.equal(calibration([mk(1), mk(1), mk(0)], 3).verdict, 'rating matches your results');
  assert.equal(calibration([mk(9), mk(9), mk(9)], 1).samples, 0, 'band filter');
});
