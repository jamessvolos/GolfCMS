import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patternPoints, sampleLanding, lieParams, sigmas } from '../src/engine/dispersion.js';
import { strokesField, bestAim, evaluateAim, scoreDecision, expectedPutts } from '../src/engine/strategy.js';
import { generateCourse } from '../src/engine/generate.js';
import { makeCourse, setCell, cellAt } from '../src/engine/course.js';
import { FAIRWAY, ROUGH, SAND, WATER, GREEN } from '../src/engine/terrain.js';

function flat() {
  const c = makeCourse(7, 'straight', 1);
  c.cells.fill(FAIRWAY);
  c.tee = { x: 3, y: 12 };
  c.hole = { x: 34, y: 12 };
  for (let y = 10; y <= 14; y++) for (let x = 32; x <= 36; x++) setCell(c, x, y, GREEN);
  return c;
}

test('dispersion is deterministic and widens with bad lies', () => {
  const c = flat();
  const a = sampleLanding(c, { x: 3, y: 12 }, { x: 13, y: 12 }, 1, 0);
  const b = sampleLanding(c, { x: 3, y: 12 }, { x: 13, y: 12 }, 1, 0);
  assert.deepEqual(a, b);
  assert.ok(sigmas(10, 1.8).lat > sigmas(10, 1).lat);
  assert.ok(lieParams(SAND).maxDist < lieParams(FAIRWAY).maxDist);
  const pts = patternPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
  assert.equal(pts.length, 16);
  const spreadX = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  const spreadY = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
  assert.ok(spreadX > spreadY, 'depth error exceeds lateral error along the line of play');
});

test('expected putts grow with distance and stay in [1, 3]', () => {
  assert.equal(expectedPutts(0.3), 1);
  assert.ok(expectedPutts(5) > expectedPutts(2));
  assert.ok(expectedPutts(40) <= 3);
});

test('strokes field decreases toward the hole on a flat course', () => {
  const c = flat();
  const V = strokesField(c);
  const at = (x, y) => V[y * c.width + x];
  assert.ok(at(5, 12) > at(20, 12), 'farther lie costs more strokes');
  assert.ok(at(20, 12) > at(33, 12), 'approach range beats tee range');
  assert.ok(at(3, 12) > 2 && at(3, 12) < 6, `sane tee value, got ${at(3, 12)}`);
});

test('optimal aim lays up short of a water carry it cannot safely clear', () => {
  const c = flat();
  // wall of water from x=14..17, too wide to ignore from a lie at x=4
  for (let y = 0; y < c.height; y++) for (let x = 14; x <= 17; x++) setCell(c, x, y, WATER);
  const V = strokesField(c);
  const from = { x: 4, y: 12 };
  const layup = evaluateAim(c, V, from, { x: 12, y: 12 });
  const splashy = evaluateAim(c, V, from, { x: 16, y: 12 });
  assert.ok(layup < splashy, 'aiming into the hazard is dominated');
  const best = bestAim(c, V, from, 1);
  assert.ok(cellAt(c, best.target.x, best.target.y) !== WATER, 'caddie never aims at water');
});

test('scoreDecision: the optimal aim scores ~1000 and worse aims lose points', () => {
  const c = flat();
  const V = strokesField(c);
  const from = { x: 4, y: 12 };
  const best = bestAim(c, V, from, 1);
  const perfect = scoreDecision(c, V, from, best.target);
  assert.ok(perfect.sgLost < 1e-9, 'optimal aim loses no strokes');
  assert.equal(perfect.points, 1000);
  const bad = scoreDecision(c, V, from, { x: from.x + 2, y: 2 });
  assert.ok(bad.sgLost > 0.05, `sideways aim costs strokes, got ${bad.sgLost}`);
  assert.ok(bad.points < perfect.points);
});

test('field builds on generated courses in reasonable time and is finite on land', () => {
  const t0 = Date.now();
  const c = generateCourse(1837462913);
  const V = strokesField(c);
  const elapsed = Date.now() - t0;
  for (let i = 0; i < V.length; i++) {
    const x = i % c.width;
    const y = (i / c.width) | 0;
    if (cellAt(c, x, y) !== WATER) {
      assert.ok(Number.isFinite(V[i]), `V finite at ${x},${y}`);
      assert.ok(V[i] >= 0 && V[i] < 12, `V sane at ${x},${y}: ${V[i]}`);
    }
  }
  assert.ok(elapsed < 15000, `field build took ${elapsed}ms`);
});
