import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makePuzzle, verifyPuzzle, sampleBallStart, dailySeed, dailyNumber, dailyPuzzle,
} from '../src/engine/puzzle.js';
import { generateCourse } from '../src/engine/generate.js';
import { ROUGH, SAND, GREEN } from '../src/engine/terrain.js';
import { cellAt, dist } from '../src/engine/course.js';

test('puzzles are deterministic: same seed + difficulty = same puzzle', () => {
  const a = makePuzzle(1837462913, 'standard');
  const b = makePuzzle(1837462913, 'standard');
  assert.deepEqual(a, b);
});

test('property: 60 certified puzzles are solvable with sane par and legal starts', () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const p = makePuzzle(seed, 'standard');
    assert.ok(p.par >= 2 && p.par <= 7, `seed ${seed}: par ${p.par} in band`);
    assert.ok(verifyPuzzle(p), `seed ${seed}: certificate replays to holed`);
    const lie = cellAt(p.course, p.start.x, p.start.y);
    assert.notEqual(lie, GREEN, `seed ${seed}: never starts on the green`);
    assert.ok(dist(p.start, p.course.hole) >= 12, `seed ${seed}: real distance to hole`);
  }
});

test('rude puzzles always start from trouble (rough or sand)', () => {
  for (let seed = 100; seed < 120; seed++) {
    const p = makePuzzle(seed, 'rude');
    const lie = cellAt(p.course, p.start.x, p.start.y);
    assert.ok(lie === ROUGH || lie === SAND, `seed ${seed}: rude lie is trouble, got ${lie}`);
    assert.ok(verifyPuzzle(p), `seed ${seed}: rude certificate replays`);
  }
});

test('easy puzzles start on the tee', () => {
  const p = makePuzzle(7, 'easy');
  assert.deepEqual(p.start, p.course.tee);
});

test('ball-start sampler rejects green and near-hole lies', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const c = generateCourse(seed);
    for (const diff of ['standard', 'rude']) {
      const s = sampleBallStart(c, diff);
      if (!s) continue;
      assert.notEqual(cellAt(c, s.x, s.y), GREEN);
      assert.ok(dist(s, c.hole) >= 12);
    }
  }
});

test('daily seed is stable for a date and differs across dates', () => {
  assert.equal(dailySeed('2026-08-07'), dailySeed('2026-08-07'));
  assert.notEqual(dailySeed('2026-08-07'), dailySeed('2026-08-08'));
  assert.equal(dailyNumber('2026-08-07'), 1);
  assert.equal(dailyNumber('2026-08-08'), 2);
});

test('daily puzzle: whole world gets the same certified hole', () => {
  const a = dailyPuzzle('2026-08-07');
  const b = dailyPuzzle('2026-08-07');
  assert.deepEqual(a, b);
  assert.ok(verifyPuzzle(a));
  // 2026-08-08 is a Saturday: rude day.
  assert.equal(dailyPuzzle('2026-08-08').difficulty, 'rude');
});
