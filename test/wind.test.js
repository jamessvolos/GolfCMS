import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCourse } from '../src/engine/generate.js';
import { makePuzzle, verifyPuzzle } from '../src/engine/puzzle.js';
import { resolveShot } from '../src/engine/shots.js';
import { makeCourse } from '../src/engine/course.js';
import { FAIRWAY, TREES } from '../src/engine/terrain.js';
import { encodeShareCode, decodeShareCode } from '../src/engine/catalog.js';

function range() {
  const c = makeCourse(1, 'straight', 1);
  c.cells.fill(FAIRWAY);
  c.hole = { x: 39, y: 23 };
  c.tee = { x: 2, y: 12 };
  return c;
}

test('wind drifts a full driver by its strength, a chip barely', () => {
  const calm = range();
  const windy = range();
  windy.wind = { x: 0, y: 2 };
  const still = resolveShot(calm, { x: 3, y: 12 }, { club: 'driver', angle: 0, power: 3 }, 0);
  const gusty = resolveShot(windy, { x: 3, y: 12 }, { club: 'driver', angle: 0, power: 3 }, 0);
  assert.equal(gusty.ball.y - still.ball.y, 2, 'full-range driver takes the whole gust');
  const stillChip = resolveShot(calm, { x: 3, y: 12 }, { club: 'wedge', angle: 0, power: 1 }, 1);
  const gustyChip = resolveShot(windy, { x: 3, y: 12 }, { club: 'wedge', angle: 0, power: 1 }, 1);
  assert.ok(Math.abs(gustyChip.ball.y - stillChip.ball.y) <= 1, 'short wedge barely drifts');
});

test('putts are immune to wind', () => {
  const windy = range();
  windy.wind = { x: 0, y: 2 };
  const r = resolveShot(windy, { x: 3, y: 12 }, { club: 'putter', angle: 0, power: 3 }, 0);
  assert.equal(r.ball.y, 12);
});

test('only links courses have wind; other biomes are calm', () => {
  for (let seed = 1; seed <= 20; seed++) {
    for (const biome of ['classic', 'winter', 'alpine']) {
      const c = generateCourse(seed, biome);
      assert.deepEqual(c.wind, { x: 0, y: 0 }, `${biome} ${seed} is calm`);
    }
    const links = generateCourse(seed, 'links');
    assert.ok(links.wind.x !== 0 || links.wind.y !== 0, `links ${seed} has wind`);
    assert.ok(Math.abs(links.wind.x) <= 2 && Math.abs(links.wind.y) <= 2, 'wind bounded');
  }
});

test('links courses are near-treeless compared to classic', () => {
  let fewer = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const classicTrees = generateCourse(seed, 'classic').cells.filter((t) => t === TREES).length;
    const linksTrees = generateCourse(seed, 'links').cells.filter((t) => t === TREES).length;
    if (linksTrees < classicTrees) fewer++;
  }
  assert.ok(fewer >= 18, `${fewer}/20 links courses lost most trees`);
});

test('links puzzles certify and their windy certificates replay (12 seeds)', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const p = makePuzzle(seed, 'standard', 'links');
    assert.equal(p.biome, 'links');
    assert.ok(verifyPuzzle(p), `links seed ${seed} certificate replays in the wind`);
  }
});

test('links share codes round-trip', () => {
  const code = encodeShareCode(31337, 'rude', 'links');
  assert.match(code, /-R-L$/);
  assert.deepEqual(decodeShareCode(code), { seed: 31337, difficulty: 'rude', biome: 'links' });
});
