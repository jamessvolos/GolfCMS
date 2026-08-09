import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patternStats, PREVIEW_OFFSETS } from '../src/engine/dispersion.js';
import { makeCourse, setCell } from '../src/engine/course.js';
import { FAIRWAY, WATER, SAND, GREEN } from '../src/engine/terrain.js';

function flat() {
  const c = makeCourse(3, 'straight', 1);
  c.cells.fill(FAIRWAY);
  c.tee = { x: 3, y: 12 };
  c.hole = { x: 34, y: 12 };
  setCell(c, 34, 12, GREEN);
  return c;
}

test('pattern stats are deterministic and percentages account for every sample', () => {
  const c = flat();
  const a = patternStats(c, { x: 3, y: 12 }, { x: 13, y: 12 }, 1);
  const b = patternStats(c, { x: 3, y: 12 }, { x: 13, y: 12 }, 1);
  assert.deepEqual(a, b);
  assert.equal(a.dots.length, PREVIEW_OFFSETS.length);
  const sum = Object.values(a.pct).reduce((s, v) => s + v, 0);
  assert.ok(sum >= 97 && sum <= 103, `rounded percentages ≈ 100, got ${sum}`);
  assert.equal(a.pct.fairway, 100, 'everything lands on fairway on a flat course');
  assert.ok(a.medianLeave > 15 && a.medianLeave < 26, `sane median leave, got ${a.medianLeave}`);
});

test('water percentage rises as the target moves onto a hazard', () => {
  const c = flat();
  for (let y = 8; y <= 16; y++) for (let x = 12; x <= 16; x++) setCell(c, x, y, WATER);
  const safe = patternStats(c, { x: 3, y: 12 }, { x: 8, y: 12 }, 1);
  const risky = patternStats(c, { x: 3, y: 12 }, { x: 14, y: 12 }, 1);
  assert.ok(risky.pct.wet > 50, `aiming at the lake is mostly wet, got ${risky.pct.wet}%`);
  assert.ok(risky.pct.wet > safe.pct.wet, 'risk reads higher on the risky line');
  const wetDots = risky.dots.filter((d) => d.outcome === 'wet').length;
  assert.equal(Math.round((wetDots / risky.dots.length) * 100), risky.pct.wet);
});

test('wider lies spread more samples into surrounding sand', () => {
  const c = flat();
  for (let y = 9; y <= 15; y++) for (let x = 10; x <= 16; x++) {
    if (y === 9 || y === 15) setCell(c, x, y, SAND);
  }
  const clean = patternStats(c, { x: 3, y: 12 }, { x: 13, y: 12 }, 1);
  const wild = patternStats(c, { x: 3, y: 12 }, { x: 13, y: 12 }, 1.8);
  assert.ok(wild.pct.sand >= clean.pct.sand, 'a wider pattern finds more bunkers');
});
