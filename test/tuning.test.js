import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sigmas, reach, lieParams, handicapById, MAX_CARRY } from '../src/engine/dispersion.js';
import { yards } from '../src/engine/yards.js';
import { FAIRWAY } from '../src/engine/terrain.js';

test('full-driver dispersion matches real golf: ~21yd lateral, ~14yd depth 1-sigma', () => {
  const s = sigmas(MAX_CARRY, 1);
  assert.ok(s.lat > s.long, 'wide, not deep');
  assert.ok(yards(s.lat) >= 17 && yards(s.lat) <= 25, `lateral ${yards(s.lat)}yds`);
  assert.ok(yards(s.long) >= 10 && yards(s.long) <= 17, `depth ${yards(s.long)}yds`);
});

test('shot lengths scale with handicap: tour outdrives scratch outdrives 20-cap', () => {
  const fw = lieParams(FAIRWAY);
  const t = reach(fw, handicapById('tour'));
  const s = reach(fw, handicapById('scratch'));
  const h = reach(fw, handicapById('twenty'));
  assert.ok(t > s && s > h, `${t} > ${s} > ${h}`);
  assert.ok(yards(t) >= 250 && yards(t) <= 270, `tour drive ${yards(t)}yds`);
  assert.equal(yards(s), 240, 'scratch drives 240');
  assert.ok(yards(h) >= 190 && yards(h) <= 210, `20-cap drive ${yards(h)}yds`);
});

test('short-game dispersion is tight: 60yd wedge inside ~8yds lateral 1-sigma', () => {
  const s = sigmas(60 / 16, 1);
  assert.ok(yards(s.lat) <= 9, `wedge lateral ${yards(s.lat)}yds`);
});
