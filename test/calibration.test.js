// The calibration contract (release W-A). These are not fixtures — they are
// the published numbers the engine claims to reproduce. If a change to
// dispersion or strategy moves them, the model has stopped being honest and
// this file is supposed to say so.
//
// Sources are collected in docs/research/01-architecture-and-sg.md §5:
// Broadie's strokes-gained baselines and the PGA Tour one-putt table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeRate, puttMakeProbability, captureAt, handicapById,
  PUTT_OVERRUN, PUTT_MAX, FEET_PER_TILE, CUP_R,
} from '../src/engine/dispersion.js';
import {
  strokesField, bestAim, bestPutt, puttsFrom, puttStats, expectedPutts,
} from '../src/engine/strategy.js';
import { makeCourse, setCell } from '../src/engine/course.js';
import { FAIRWAY, GREEN, ROUGH } from '../src/engine/terrain.js';

const FT = FEET_PER_TILE; // 48
const profile = handicapById('scratch');

/** A big flat green around the cup (as putting.test.js). */
function greenCourse() {
  const c = makeCourse(11, 'straight', 1);
  c.cells.fill(FAIRWAY);
  c.tee = { x: 2, y: 12 };
  c.hole = { x: 20, y: 12 };
  for (let y = 2; y <= 22; y++) for (let x = 6; x <= 34; x++) setCell(c, x, y, GREEN);
  return c;
}
const puttAt = (c, ft) => ({ x: c.hole.x - ft / FT, y: c.hole.y });

/**
 * The reference course for strokes-gained anchors: dead flat, all fairway,
 * one round green of 20-yd radius (a ~5,000 sq ft green — real size; the
 * generator's current 40-yd disc is eight times a real green and hides every
 * lie penalty). Hole at x=32, so x=32−yds/16 is a lie at that yardage.
 */
function refCourse() {
  const c = makeCourse(11, 'straight', 1);
  c.cells.fill(FAIRWAY);
  c.hole = { x: 32, y: 12 };
  c.tee = { x: 7, y: 12 }; // 25 tiles = 400 yds
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (Math.hypot(x - c.hole.x, y - c.hole.y) <= 1.25) setCell(c, x, y, GREEN);
    }
  }
  return c;
}

let refMemo = null;
function ref() {
  if (!refMemo) {
    const course = refCourse();
    refMemo = { course, V: strokesField(course, 8, profile) };
  }
  return refMemo;
}

/** Expected strokes to hole out from a lie `yds` from the hole. */
function eFrom(yds, { rough = false } = {}) {
  const { course, V } = ref();
  const x = 32 - Math.round(yds / 16);
  let c = course;
  if (rough) {
    c = { ...course, cells: course.cells.slice() };
    setCell(c, x, 12, ROUGH); // one cell of rough: the lie changes, nothing else
  }
  return 1 + bestAim(c, V, { x, y: 12 }, 1, profile).value;
}

// --- the make curve ----------------------------------------------------------

test('the published make curve is the model, not an aspiration', () => {
  // The analytic curve, sampled through the engine's own pattern + capture,
  // reproduces the PGA anchors to within 2 points at the reference pace.
  for (const ft of [3, 5, 6, 8, 10, 15, 20, 25, 30, 40, 60, 90]) {
    const modelled = 100 * puttMakeProbability(ft / FT);
    const published = 100 * makeRate(ft);
    assert.ok(Math.abs(modelled - published) <= 2,
      `${ft} ft: model ${modelled.toFixed(1)}% vs published ${published.toFixed(1)}%`);
  }
});

test('engine-measured make rates land within a few points of the tour', () => {
  const c = greenCourse();
  const V = strokesField(c);
  // Sampled over the 48-point preview pattern at the caddie's own chosen pace
  // — the number the HUD actually shows a player. 48 samples quantize to
  // ~2 points, so the contract is ±5.
  const anchors = [[3, 96], [8, 50], [20, 15], [30, 7], [60, 2]];
  for (const [ft, published] of anchors) {
    const from = puttAt(c, ft);
    const best = bestPutt(c, V, from, profile);
    const measured = puttStats(c, from, best.target, profile).makePct;
    assert.ok(Math.abs(measured - published) <= 5,
      `${ft} ft: engine ${measured}% vs tour ${published}%`);
  }
});

test('capture is inches and overrun is a yard: no more free racing', () => {
  assert.ok(Math.abs(PUTT_OVERRUN * FT - 3) < 1e-9, 'overrun caps at 3 ft past');
  assert.ok(Math.abs(PUTT_MAX * FT - 120) < 1e-9, 'the longest putt is 120 ft');
  for (const ft of [3, 20, 60, 110]) {
    const cap = captureAt(ft / FT);
    assert.ok(cap * FT > 0.15 && cap * FT < 1.0, `${ft} ft capture ${(cap * FT).toFixed(2)} ft`);
    assert.ok(cap < CUP_R, 'effective capture is well inside the drawn cup');
  }
  // and it tightens as the putt lengthens
  assert.ok(captureAt(90 / FT) < captureAt(10 / FT));
});

// --- expected putts ----------------------------------------------------------

test('expected putts match Broadie at every anchor', () => {
  // The published curve...
  const anchors = [[1, 1.0], [8, 1.50], [20, 1.87], [33, 2.0], [60, 2.21], [90, 2.40]];
  for (const [ft, published] of anchors) {
    assert.ok(Math.abs(expectedPutts(ft / FT) - published) <= 0.03,
      `expectedPutts ${ft} ft: ${expectedPutts(ft / FT)} vs ${published}`);
    // ...and the engine's own self-consistent recursion, independently.
    assert.ok(Math.abs(puttsFrom(ft / FT, profile) - published) <= 0.12,
      `puttsFrom ${ft} ft: ${puttsFrom(ft / FT, profile)} vs ${published}`);
  }
});

test('putting costs grow monotonically with distance', () => {
  let prev = 0;
  for (const ft of [1, 3, 5, 8, 12, 20, 30, 45, 60, 90, 115]) {
    const e = puttsFrom(ft / FT, profile);
    assert.ok(e > prev, `${ft} ft costs ${e}, previous ${prev}`);
    prev = e;
  }
  assert.ok(prev < 2.6, 'and never runs away: a 115-footer is not a 3-putt');
});

test('pace trades make% against the comeback', () => {
  const c = greenCourse();
  const from = puttAt(c, 8);
  const at = (pastFt) => {
    const st = puttStats(c, from, { x: c.hole.x + pastFt / FT, y: c.hole.y }, profile);
    return { make: st.makePct, leave: st.medianLeave * FT };
  };
  const die = at(0); // struck to die at the hole
  const firm = at(1.5); // a foot and a half past
  const raced = at(5); // gone
  assert.ok(firm.make > die.make,
    `a putt with pace makes more than one dying at the hole: ${firm.make}% vs ${die.make}%`);
  assert.ok(raced.make < firm.make,
    `but racing it misses more: ${raced.make}% vs ${firm.make}%`);
  assert.ok(firm.leave > die.leave, 'and pace costs comeback length');
  assert.ok(raced.leave > firm.leave + 2, `racing leaves a real second putt: ${raced.leave} ft`);
});

// --- the strokes-gained field ------------------------------------------------

test('approach values land on Broadie: 2.80 from 100 yds', () => {
  const e100 = eFrom(100);
  assert.ok(Math.abs(e100 - 2.80) <= 0.15, `E(100 yd, fairway) = ${e100.toFixed(3)}, want 2.80`);
  const e150 = eFrom(150);
  assert.ok(Math.abs(e150 - 2.98) <= 0.15, `E(150 yd, fairway) = ${e150.toFixed(3)}, want 2.98`);
  const e200 = eFrom(200);
  assert.ok(Math.abs(e200 - 3.25) <= 0.2, `E(200 yd, fairway) = ${e200.toFixed(3)}, want 3.25`);
  const e400 = eFrom(400);
  assert.ok(Math.abs(e400 - 3.99) <= 0.25, `E(400 yd, tee) = ${e400.toFixed(3)}, want 3.99`);
  // and being closer is always worth something — the old field was flat from
  // 50 to 250 yds, which is why proximity could not move the caddie's advice
  assert.ok(eFrom(50) < e100 && e100 < e150 && e150 < e200 && e200 < e400);
  assert.ok(e200 - e100 > 0.3, 'a hundred yards of approach is worth real strokes');
});

test('rough costs about a fifth of a stroke, as it does on tour', () => {
  for (const yds of [100, 150]) {
    const delta = eFrom(yds, { rough: true }) - eFrom(yds);
    assert.ok(Math.abs(delta - 0.2) <= 0.08,
      `${yds} yds: rough costs ${delta.toFixed(3)} strokes vs fairway, want ~0.20`);
  }
});

test('the field prices greens with the putt model it plays', () => {
  const { course, V } = ref();
  // a green cell 30 ft from the cup must cost what a 30-ft putt costs
  const x = course.hole.x - 1;
  const cell = V[12 * course.width + x];
  assert.ok(Math.abs(cell - puttsFrom(1, profile)) < 1e-9,
    `green cell ${cell} vs puttsFrom ${puttsFrom(1, profile)}`);
  assert.ok(Math.abs(cell - expectedPutts(1)) < 0.12, 'and agrees with the published curve');
});

test('everything stays deterministic', () => {
  const a = eFrom(100);
  refMemo = null; // rebuild the field from scratch
  const b = eFrom(100);
  assert.equal(a, b);
  assert.equal(puttsFrom(0.5, profile), puttsFrom(0.5, profile));
  assert.equal(captureAt(0.5), captureAt(0.5));
});
