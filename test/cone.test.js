// Release E — the expected-strokes cone.
//
// The cone is a picture, and pictures are checked by eye. What CAN be tested
// without a screen is the arithmetic behind it, and that is the part with a
// right answer: cheap ground must come out lighter than dear ground, the scale
// must be set by the ground the swing can actually reach, and the beam must be
// the shape the dispersion actually is.

import test from 'node:test';
import assert from 'node:assert/strict';

import { costShades, coneBeamPath, CONE_SWING, CONE_ALPHA, TILE } from '../src/ui/paint.js';
import { generateCourse } from '../src/engine/generate.js';
import { strokesField } from '../src/engine/strategy.js';
import { sigmas, puttSigmas, handicapById, MAX_CARRY } from '../src/engine/dispersion.js';
import { cellAt } from '../src/engine/course.js';
import { WATER, FAIRWAY } from '../src/engine/terrain.js';

const P = handicapById('scratch');

function hole(seed = 4242, len = 26) {
  const course = generateCourse(seed, 'classic', { holeDistTiles: len, strategic: true });
  return { course, V: strokesField(course, 4, P) };
}

/** A canvas 2D context that records the path instead of drawing it. */
function recordingCtx() {
  const pts = [];
  return {
    pts,
    beginPath() { pts.length = 0; },
    moveTo(x, y) { pts.push([x, y]); },
    lineTo(x, y) { pts.push([x, y]); },
    ellipse(x, y) { pts.push([x, y]); },
    closePath() {},
  };
}

test('cheap ground is lit and dear ground is shadowed', () => {
  const { course, V } = hole();
  const shades = costShades(course, V, { from: course.tee, reach: MAX_CARRY });
  // pair up every tile with its cost and check the mapping is monotone the
  // right way round — a cone that darkened the good ground would be worse than
  // no cone, because the player would believe it
  let pairs = 0;
  for (let i = 0; i < V.length; i++) {
    for (let j = i + 1; j < V.length; j += 97) {
      if (!Number.isFinite(V[i]) || !Number.isFinite(V[j])) continue;
      if (Math.abs(V[i] - V[j]) < 0.25) continue; // ties and near-ties prove nothing
      const cheaper = V[i] < V[j] ? i : j;
      const dearer = cheaper === i ? j : i;
      if (shades[cheaper] === shades[dearer]) continue; // both clamped to an end
      assert.ok(shades[cheaper] > shades[dearer],
        `tile ${cheaper} costs ${V[cheaper].toFixed(2)} and shades ${shades[cheaper]},`
        + ` tile ${dearer} costs ${V[dearer].toFixed(2)} and shades ${shades[dearer]}`);
      pairs++;
    }
  }
  assert.ok(pairs > 200, `only ${pairs} comparable pairs`);
});

test('neutral grey is the middle, and the swing never leaves it', () => {
  const { course, V } = hole();
  const shades = costShades(course, V, { from: course.tee, reach: MAX_CARRY });
  let min = 255;
  let max = 0;
  for (const s of shades) { min = Math.min(min, s); max = Math.max(max, s); }
  assert.ok(min >= 128 - CONE_SWING - 1 && max <= 128 + CONE_SWING + 1,
    `shades ran ${min}..${max}, outside 128 ± ${CONE_SWING}`);
  // and it must actually use its range, or the cone is invisible
  assert.ok(max - min > 60, `only ${max - min} shades of separation`);
});

test('water is among the darkest ground on the hole', () => {
  const { course, V } = hole();
  const shades = costShades(course, V, { from: course.tee, reach: MAX_CARRY });
  const wet = [];
  const grass = [];
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      const i = y * course.width + x;
      if (Math.hypot(x - course.tee.x, y - course.tee.y) > MAX_CARRY) continue;
      if (cellAt(course, x, y) === WATER) wet.push(shades[i]);
      else if (cellAt(course, x, y) === FAIRWAY) grass.push(shades[i]);
    }
  }
  if (wet.length < 3) return; // this seed has no water in range; nothing to prove
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(mean(wet) < mean(grass),
    `water shaded ${mean(wet).toFixed(0)} against fairway ${mean(grass).toFixed(0)}`);
});

test('THE SCALE IS LOCAL: the same hole shades differently from different lies', () => {
  // The first version normalised over the whole hole, and on a 400-yard par 4
  // that spans four strokes of expectation — so the two or three tenths that
  // separate the good half of a landing zone from the bad half compressed into
  // one shade and the beam lit up uniformly, which is a picture of nothing.
  const { course, V } = hole();
  const fromTee = costShades(course, V, { from: course.tee, reach: MAX_CARRY });
  const near = { x: Math.round((course.tee.x + course.hole.x) / 2), y: course.hole.y };
  const fromMid = costShades(course, V, { from: near, reach: MAX_CARRY });
  let differing = 0;
  for (let i = 0; i < fromTee.length; i++) {
    if (Math.abs(fromTee[i] - fromMid[i]) > 6) differing++;
  }
  assert.ok(differing > fromTee.length * 0.15,
    `only ${differing}/${fromTee.length} tiles re-shaded from a different lie`);
});

test('a degenerate field falls back to neutral rather than to noise', () => {
  const course = generateCourse(1234, 'classic', { holeDistTiles: 24 });
  const flat = new Float64Array(course.width * course.height).fill(Infinity);
  const shades = costShades(course, flat, { from: course.tee, reach: MAX_CARRY });
  assert.equal(shades.length, course.width * course.height);
  for (const s of shades) assert.equal(s, 128);
});

test('the beam flares the way dispersion flares, and closes at the ball', () => {
  const { course } = hole();
  const from = course.tee;
  const target = { x: from.x + 12, y: from.y };
  const ctx = recordingCtx();
  const sigmaAt = (t) => sigmas(Math.max(0.05, 12 * t), 1, P);
  assert.equal(coneBeamPath(ctx, from, target, sigmaAt), true);

  // width across the beam, sampled near the ball and near the target
  const half = (ctx.pts.length - 1) / 2;
  const atBall = ctx.pts[0];
  const nearTarget = ctx.pts[Math.floor(half * 0.9)];
  const widthAtBall = Math.abs(atBall[1] - (from.y + 0.5) * TILE);
  const widthOut = Math.abs(nearTarget[1] - (from.y + 0.5) * TILE);
  assert.ok(widthAtBall < widthOut * 0.4,
    `the beam is ${widthAtBall.toFixed(0)}px wide at the ball and ${widthOut.toFixed(0)}px out`);
  assert.ok(widthOut > TILE, 'the beam should open to more than a tile by the target');
});

test('the beam bends with the break on a putt', () => {
  const { course } = hole();
  const from = { x: course.hole.x - 2, y: course.hole.y };
  const target = { ...course.hole };
  const sigmaAt = (t) => puttSigmas(Math.max(0.05, 2 * t), P);
  const straight = recordingCtx();
  coneBeamPath(straight, from, target, sigmaAt, { x: 0, y: 0 });
  const bent = recordingCtx();
  coneBeamPath(bent, from, target, sigmaAt, { x: 0, y: 0.8 });
  let moved = 0;
  for (let i = 0; i < straight.pts.length; i++) {
    if (Math.abs(straight.pts[i][1] - bent.pts[i][1]) > 1) moved++;
  }
  assert.ok(moved > straight.pts.length * 0.5,
    `only ${moved}/${straight.pts.length} of the beam followed the break`);
  // ...and it must bend LATE: a putt barely moves in its first foot
  assert.ok(Math.abs(straight.pts[0][1] - bent.pts[0][1]) < 1,
    'the beam must leave the ball on the line it was struck');
});

test('a zero-length aim draws nothing at all', () => {
  const { course } = hole();
  const ctx = recordingCtx();
  const ok = coneBeamPath(ctx, course.tee, { ...course.tee }, () => sigmas(1, 1, P));
  assert.equal(ok, false);
  assert.equal(ctx.pts.length, 0);
});

test('the cone stays subtle by construction', () => {
  // The whole design rests on this number. Past about a fifth, soft-light stops
  // reading as light on the ground and starts reading as a chart laid over it,
  // which is the thing the cone exists to avoid.
  assert.ok(CONE_ALPHA > 0 && CONE_ALPHA <= 0.20, `CONE_ALPHA is ${CONE_ALPHA}`);
});
