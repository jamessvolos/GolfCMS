// Green reading: slope tiles bend a rolling putt. These tests pin down the
// break model — direction, aim-off compensation, make-rate cost — and, just
// as important, that flat greens reproduce the pre-break engine EXACTLY.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puttBreakDrift, samplePuttRoll, courseHasSlopes, captureAt } from '../src/engine/dispersion.js';
import { strokesField, evaluatePutt, bestPutt, scorePuttDecision, puttStats } from '../src/engine/strategy.js';
import { makeCourse, setCell } from '../src/engine/course.js';
import { FAIRWAY, GREEN, SLOPE_N, SLOPE_S, SLOPE_E } from '../src/engine/terrain.js';

/** A big flat green around the cup, fairway everywhere else (as putting.test). */
function greenCourse() {
  const c = makeCourse(11, 'straight', 1);
  c.cells.fill(FAIRWAY);
  c.tee = { x: 2, y: 12 };
  c.hole = { x: 20, y: 12 };
  for (let y = 2; y <= 22; y++) for (let x = 6; x <= 34; x++) setCell(c, x, y, GREEN);
  return c;
}

/** The same green with a slope band stamped across the cup line at x 17..19. */
function slopedCourse(slope, x0 = 17, x1 = 19) {
  const c = greenCourse();
  for (let y = 11; y <= 13; y++) for (let x = x0; x <= x1; x++) setCell(c, x, y, slope);
  return c;
}

test('no-slope putts are byte-identical to the pre-break engine', () => {
  const c = greenCourse();
  assert.equal(courseHasSlopes(c), false);
  const V = strokesField(c);
  const from = { x: 19.2, y: 12 }; // a 38-ft putt, played 1.5 ft past the cup
  const target = { x: 20.031, y: 12 };
  // golden values, regenerated for the calibrated model (release W-A) — the
  // point of the fixture is unchanged: a flat green takes the exact arithmetic
  // it always did, with zero drift as the additive identity.
  assert.equal(evaluatePutt(c, V, from, target), 2.0505070956483946);
  assert.deepEqual(bestPutt(c, V, from), {
    target: { x: 20, y: 12 },
    value: 2.0232880147814285,
    past: 0,
  });
  assert.deepEqual(samplePuttRoll(c, from, target, 3), {
    x: 19.97907676236533,
    y: 11.991352254952092,
  });
  const st = puttStats(c, from, target);
  assert.equal(st.makePct, 4);
  assert.equal(st.threePct, 9);
  assert.equal(st.medianLeave, 0.06263580814315188);
  // and the drift itself is exactly zero on a flat course
  assert.deepEqual(puttBreakDrift(c, from, target), { x: 0, y: 0, cross: 0 });
});

test('slope tiles far from the line leave the putt untouched', () => {
  const c = greenCourse();
  for (let x = 8; x <= 10; x++) setCell(c, x, 20, SLOPE_N); // 8 tiles off the line
  assert.equal(courseHasSlopes(c), true);
  const V = strokesField(c);
  const from = { x: 19.2, y: 12 };
  const target = { x: 20.031, y: 12 };
  assert.equal(puttBreakDrift(c, from, target).cross, 0);
  assert.equal(evaluatePutt(c, V, from, target), 2.0505070956483946);
});

test('cross-slope drift moves the roll downhill; aligned slope adds no break', () => {
  const from = { x: 16, y: 12 };
  const finish = { x: 20, y: 12 };
  // SLOPE_N (downhill −y) across a +x putt: drifts −y
  const n = puttBreakDrift(slopedCourse(SLOPE_N), from, finish);
  assert.ok(n.y < -0.05, `drifts -y across SLOPE_N, got ${n.y}`);
  assert.ok(Math.abs(n.x) < 1e-9, 'break is purely lateral to the line');
  assert.ok(n.cross < 0);
  // SLOPE_S mirrors it
  const s = puttBreakDrift(slopedCourse(SLOPE_S), from, finish);
  assert.ok(s.y > 0.05 && s.cross > 0, `drifts +y across SLOPE_S, got ${s.y}`);
  assert.ok(Math.abs(s.y + n.y) < 1e-9, 'mirror slopes, mirror break');
  // SLOPE_E across a +y putt drifts +x (downhill)
  const cv = greenCourse();
  for (let y = 11; y <= 13; y++) for (let x = 19; x <= 21; x++) setCell(cv, x, y, SLOPE_E);
  const e = puttBreakDrift(cv, { x: 20, y: 9 }, { x: 20, y: 15 });
  assert.ok(e.x > 0.05, `drifts +x across SLOPE_E, got ${e.x}`);
  // SLOPE_E ALONG a +x putt: pure pace, zero lateral break
  const aligned = puttBreakDrift(slopedCourse(SLOPE_E), from, finish);
  assert.ok(Math.abs(aligned.cross) < 1e-12, 'downslope putts do not break');
  // the one real seeded roll takes the same drift (perpendicular to its own
  // sampled line, so the dominant shift is the downhill −y one)
  const flatRoll = samplePuttRoll(greenCourse(), from, finish, 2);
  const slopeRoll = samplePuttRoll(slopedCourse(SLOPE_N), from, finish, 2);
  assert.ok(slopeRoll.y < flatRoll.y - 0.05, 'the real ball breaks downhill too');
  assert.ok(Math.abs(slopeRoll.x - flatRoll.x) < Math.abs(slopeRoll.y - flatRoll.y),
    'the break is mostly lateral to the roll');
});

test('the caddie plays the break: optimal aim moves upslope of the cup', () => {
  const c = slopedCourse(SLOPE_N); // downhill −y: the ball falls below the line
  const V = strokesField(c);
  const from = { x: 18.2, y: 12 }; // an 86-ft putt across the slope band
  const best = bestPutt(c, V, from);
  assert.ok(best.target.y > c.hole.y + 0.03,
    `optimal aim sits upslope (+y) of the cup, got y=${best.target.y}`);
  // the caddie's own answer scores a perfect 1000...
  const perfect = scorePuttDecision(c, V, from, best.target);
  assert.equal(perfect.points, 1000);
  assert.ok(perfect.sgLost < 1e-9);
  // ...while ignoring the break and firing dead at the cup gives putts away
  const straight = scorePuttDecision(c, V, from, { x: c.hole.x, y: c.hole.y });
  assert.ok(straight.sgLost > 0.001, `cup-line aim loses SG on a breaking green, got ${straight.sgLost}`);
  assert.ok(straight.points <= perfect.points);
  // flat-green control: the same search still answers on the cup line
  const flat = greenCourse();
  const flatBest = bestPutt(flat, strokesField(flat), from);
  assert.equal(flatBest.target.y, flat.hole.y);
});

test('make-rate on breaking putts is lower than flat at the same distance', () => {
  const from = { x: 19.6, y: 12 }; // a 19-footer: squarely inside the make range
  const target = { x: 20.031, y: 12 }; // cup line, holeable pace
  const flatMake = puttStats(greenCourse(), from, target).makePct;
  const c = greenCourse();
  for (let y = 11; y <= 13; y++) for (let x = 19; x <= 20; x++) setCell(c, x, y, SLOPE_N);
  const slopeMake = puttStats(c, from, target).makePct;
  assert.ok(flatMake > 8, `flat 19-footer drops about as often as the tour does, got ${flatMake}%`);
  assert.ok(slopeMake < flatMake,
    `break costs makes at the same distance: slope ${slopeMake}% < flat ${flatMake}%`);
  // and the drift on this line is worth more than a cup — aim-off territory.
  // The yardstick is the model's effective capture, not the drawn CUP_R.
  const drift = puttBreakDrift(c, from, target);
  assert.ok(Math.abs(drift.cross) > captureAt(0.4) * 2);
});
