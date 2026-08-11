// Release D — the certification instrument.
//
// The metrics are the referee for the generator, so they are tested first as
// arithmetic on synthetic fields (where the right answer is known by
// construction) and only then let near a real course. A metric that flatters
// the feature it measures is worse than no metric at all.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  certifyHole, certifySweep, basinsOf, ridgeBetween, centreAim,
  FORK_SEP, FORK_TIE, FORK_RIDGE, CENTRE_COST, TEE_FORK_MIN,
} from '../src/engine/certify.js';
import { generateCourse } from '../src/engine/generate.js';
import { strokesField } from '../src/engine/strategy.js';
import { handicapById } from '../src/engine/dispersion.js';
import { cellAt } from '../src/engine/course.js';
import { WATER } from '../src/engine/terrain.js';

const P = handicapById('scratch');

// --- the metrics as arithmetic ----------------------------------------------

/** A synthetic heat row. */
const h = (x, y, e) => ({ x, y, e });

test('basinsOf finds one basin in a single bowl', () => {
  const heat = [];
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) heat.push(h(x, y, Math.hypot(x - 6, y - 6)));
  }
  const b = basinsOf(heat);
  assert.equal(b.length, 1);
  assert.equal(b[0].x, 6);
  assert.equal(b[0].y, 6);
});

test('basinsOf finds two basins when there are two, and orders them by cost', () => {
  const heat = [];
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      const a = Math.hypot(x - 4, y - 10);
      const c = Math.hypot(x - 16, y - 10) + 0.4;
      heat.push(h(x, y, Math.min(a, c)));
    }
  }
  const b = basinsOf(heat);
  assert.equal(b.length, 2);
  assert.deepEqual([b[0].x, b[0].y], [4, 10]);
  assert.deepEqual([b[1].x, b[1].y], [16, 10]);
  assert.ok(b[1].e > b[0].e);
});

test('basinsOf thins minima closer together than FORK_SEP', () => {
  // two dimples one tile apart are one basin with a bumpy floor, not two lines
  const heat = [];
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const d = Math.min(Math.hypot(x - 6, y - 6), Math.hypot(x - 7, y - 6) + 0.01);
      heat.push(h(x, y, d));
    }
  }
  const b = basinsOf(heat);
  assert.equal(b.length, 1, 'two dimples within FORK_SEP must collapse to one');
  assert.ok(FORK_SEP > 1);
});

test('ridgeBetween reports the wall between two basins, not their floors', () => {
  const heat = [];
  for (let x = 0; x < 21; x++) {
    // a valley, a hill at x=10, a valley
    const e = x === 10 ? 5 : 1 + Math.abs(Math.abs(x - 10) - 7) * 0.1;
    heat.push(h(x, 0, e));
  }
  const course = { width: 40, height: 24, cells: new Uint8Array(40 * 24) };
  const peak = ridgeBetween(heat, h(3, 0, 1), h(17, 0, 1), course, null, { x: 0, y: 0 }, P);
  assert.equal(peak, 5);
});

test('ridgeBetween treats water between two lines as an infinite wall', () => {
  const course = generateCourse(4242, 'classic', { holeDistTiles: 26 });
  // put a pond squarely between two aim points and make sure it reads as one
  const y = course.tee.y;
  for (let x = 6; x <= 14; x++) course.cells[y * course.width + x] = WATER;
  const heat = [h(5, y, 4), h(15, y, 4.05)];
  const peak = ridgeBetween(heat, heat[0], heat[1], course, null, course.tee, P);
  assert.equal(peak, Infinity);
});

test('centreAim never returns an unreachable or wet tile', () => {
  // The bug this exists for: the naive aim was computed at exactly max reach
  // and then ROUNDED to a tile, which could push it outside the reach circle —
  // where evaluateAim prices it at Infinity. M3 then read "the naive line is
  // catastrophic" when the truth was "the naive line is fine", which is the
  // exact opposite, and it silently passed a third of the field.
  for (let i = 0; i < 40; i++) {
    const seed = (5150 + i * 7919) >>> 0;
    const course = generateCourse(seed, 'classic', { holeDistTiles: 24 });
    const c = centreAim(course, course.tee, P);
    assert.ok(c, `seed ${seed}: no centre aim found`);
    assert.notEqual(cellAt(course, c.x, c.y), WATER);
    const d = Math.hypot(c.x - course.tee.x, c.y - course.tee.y);
    assert.ok(d <= 15, `seed ${seed}: naive aim at ${d.toFixed(2)} tiles is out of reach`);
  }
});

test('the thresholds are the ones the research specified', () => {
  assert.equal(FORK_TIE, 0.10);
  assert.equal(FORK_RIDGE, 0.15);
  assert.equal(CENTRE_COST, 0.15);
  assert.equal(FORK_SEP, 4);
});

// --- the metrics on real holes ----------------------------------------------

test('certifyHole is deterministic', () => {
  const course = generateCourse(9001, 'classic', { holeDistTiles: 25, strategic: true });
  const V = strokesField(course, 4, P);
  const a = certifyHole(course, { V, skipDivergence: true, profile: P });
  const b = certifyHole(course, { V, skipDivergence: true, profile: P });
  assert.equal(a.pass, b.pass);
  assert.equal(a.m1.ok, b.m1.ok);
  assert.deepEqual(a.best, b.best);
});

test('a one-shotter is NOT APPLICABLE, not a failure', () => {
  // M1 asks whether there are two viable lines. On a par 3 there is one — at
  // the green — and that is correct golf, not a broken hole. Counting par 3s as
  // M1 failures would have let release D claim a 25-point improvement it never
  // made, simply by comparing two generators that both "fail" the same quarter
  // of the field for a reason neither controls.
  for (let i = 0; i < 6; i++) {
    const seed = (3300 + i * 7919) >>> 0;
    const par3 = generateCourse(seed, 'classic', { holeDistTiles: 13, strategic: true });
    const cert = certifyHole(par3, { skipDivergence: true, sweeps: 3 });
    assert.equal(cert.applicable, false);
    assert.equal(cert.pass, false);
    assert.match(cert.m1.why, /one-shotter/);

    const par4 = generateCourse(seed, 'classic', { holeDistTiles: TEE_FORK_MIN + 5, strategic: true });
    assert.equal(certifyHole(par4, { skipDivergence: true, sweeps: 3 }).applicable, true);
  }
});

test('certifySweep reports both the raw rate and the applicable rate', () => {
  const seeds = [11, 12, 13, 14].map((n) => (n * 7919) >>> 0);
  const r = certifySweep(
    (s) => generateCourse(s, 'classic', { holeDistTiles: s % 2 ? 13 : 26, strategic: true }),
    seeds, { skipDivergence: true, sweeps: 3 },
  );
  assert.equal(r.n, 4);
  assert.ok(r.applicable < r.n, 'the mixed set contains one-shotters');
  assert.ok(r.applicableRate >= r.rate);
  assert.equal(r.rows.length, 4);
});

test('THE RESULT: strategic holes fork tighter than classic ones', () => {
  // The claim release D actually earns, stated as the number it is measured by:
  // the SECOND-BEST line on a strategic hole is closer in value to the best one.
  // That gap is what M1's tie threshold tests, and tightening it is what turns
  // "there is an answer" into "there is an argument".
  //
  // Deliberately not asserted: a large jump in the M1 pass RATE. Measured over
  // fresh seeds it moves from about a fifth of par 4s and 5s to a bit over a
  // quarter, which is real but small, and an assertion tuned to squeeze past it
  // would be measuring this seed list rather than the generator.
  const lens = [22, 26, 30];
  const gaps = { classic: [], strategic: [] };
  for (const len of lens) {
    for (let i = 0; i < 4; i++) {
      const seed = (48000 + i * 7919 + len * 131) >>> 0;
      for (const mode of ['classic', 'strategic']) {
        const c = generateCourse(seed, 'classic', { holeDistTiles: len, strategic: mode === 'strategic' });
        const cert = certifyHole(c, { skipDivergence: true, sweeps: 4 });
        const b = cert.m1.basins;
        if (b.length > 1) gaps[mode].push(b[1].e - b[0].e);
      }
    }
  }
  const median = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  };
  assert.ok(gaps.classic.length >= 8 && gaps.strategic.length >= 8);
  const mc = median(gaps.classic);
  const ms = median(gaps.strategic);
  assert.ok(ms < mc,
    `strategic median gap ${ms.toFixed(3)} is not tighter than classic ${mc.toFixed(3)}`);
});
