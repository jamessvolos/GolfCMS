// The photo experiment's arithmetic, pinned: assignment alternates, arms
// normalize per hole, and the verdict only speaks with a real sample.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abAssign, abSummary } from '../src/engine/experiment.js';

test('assignment alternates so one player builds both arms', () => {
  assert.equal(abAssign(0), 'photo');
  assert.equal(abAssign(1), 'paint');
  assert.equal(abAssign(2), 'photo');
});

test('summary normalizes points per hole and counts preference', () => {
  const entries = [
    { ground: 'photo', overrode: false, keptPhoto: true, points: 900, holes: 1 },
    { ground: 'paint', overrode: true, keptPhoto: true, points: 4000, holes: 5 },
    { ground: 'photo', overrode: false, keptPhoto: true, points: 700, holes: 1 },
  ];
  const s = abSummary(entries);
  assert.equal(s.photo.n, 2);
  assert.equal(s.paint.n, 1);
  assert.equal(s.photo.avgPts, 800);
  assert.equal(s.paint.avgPts, 800);
  assert.equal(s.overrides, 1);
  assert.equal(s.keptPhoto, 3);
  assert.match(s.verdict, /collecting/);
});

test('verdict speaks once both arms reach five rounds', () => {
  const mk = (ground, pts, kept) =>
    ({ ground, overrode: false, keptPhoto: kept, points: pts, holes: 1 });
  const wash = abSummary([
    ...Array.from({ length: 5 }, () => mk('photo', 800, true)),
    ...Array.from({ length: 5 }, () => mk('paint', 805, true)),
  ]);
  assert.match(wash.verdict, /wash/);
  assert.match(wash.verdict, /keep the photo/);
  const worse = abSummary([
    ...Array.from({ length: 5 }, () => mk('photo', 700, false)),
    ...Array.from({ length: 5 }, () => mk('paint', 800, false)),
  ]);
  assert.match(worse.verdict, /LOWER/);
  assert.match(worse.verdict, /turn the photo off/);
});

test('garbage entries are skipped, never counted', () => {
  const s = abSummary([
    { ground: 'photo', points: NaN, holes: 1 },
    { ground: 'mystery', points: 500, holes: 1 },
    { ground: 'paint', points: 500, holes: 0 },
  ]);
  assert.equal(s.rounds, 0);
});
