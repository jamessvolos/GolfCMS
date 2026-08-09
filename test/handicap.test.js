import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sigmas, handicapById, HANDICAPS, DEFAULT_PROFILE, patternStats } from '../src/engine/dispersion.js';
import { strokesField } from '../src/engine/strategy.js';
import { generateCourse } from '../src/engine/generate.js';
import { makeCourse, setCell } from '../src/engine/course.js';
import { FAIRWAY, SAND, GREEN } from '../src/engine/terrain.js';

test('handicap profiles widen dispersion, and the gap grows with distance', () => {
  const tour = handicapById('tour');
  const twenty = handicapById('twenty');
  assert.ok(sigmas(10, 1, twenty).lat > sigmas(10, 1, tour).lat);
  const shortGap = sigmas(4, 1, twenty).lat / sigmas(4, 1, tour).lat;
  const longGap = sigmas(14, 1, twenty).lat / sigmas(14, 1, tour).lat;
  assert.ok(longGap > shortGap, `long clubs punish more: ${longGap.toFixed(2)} > ${shortGap.toFixed(2)}`);
});

test('scratch is the identity profile: default behavior is unchanged', () => {
  assert.equal(handicapById('scratch'), DEFAULT_PROFILE);
  assert.deepEqual(sigmas(10, 1), sigmas(10, 1, handicapById('scratch')));
  const c = generateCourse(42);
  assert.deepEqual(strokesField(c), strokesField(c, 6, handicapById('scratch')));
  assert.equal(handicapById('nonsense'), DEFAULT_PROFILE, 'unknown ids fall back safely');
  assert.equal(HANDICAPS.length, 4);
});

test('a 20-handicap expects more strokes from the same tee than a tour pro', () => {
  const c = generateCourse(1837462913);
  const i = c.tee.y * c.width + c.tee.x;
  const proV = strokesField(c, 6, handicapById('tour'))[i];
  const hackV = strokesField(c, 6, handicapById('twenty'))[i];
  assert.ok(hackV > proV, `twenty ${hackV.toFixed(2)} > tour ${proV.toFixed(2)}`);
});

test('wider handicap patterns find more of the surrounding bunkers', () => {
  const c = makeCourse(5, 'straight', 1);
  c.cells.fill(FAIRWAY);
  c.hole = { x: 38, y: 12 };
  setCell(c, 38, 12, GREEN);
  for (let x = 10; x <= 16; x++) { setCell(c, x, 10, SAND); setCell(c, x, 14, SAND); }
  const from = { x: 3, y: 12 };
  const target = { x: 13, y: 12 };
  const pro = patternStats(c, from, target, 1, handicapById('tour')).pct.sand;
  const hack = patternStats(c, from, target, 1, handicapById('twenty')).pct.sand;
  assert.ok(hack >= pro, `20-hcp sand ${hack}% >= tour ${pro}%`);
});
