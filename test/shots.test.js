import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveShot, CLUBS, lieRules } from '../src/engine/shots.js';
import { makeCourse, setCell } from '../src/engine/course.js';
import { FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN } from '../src/engine/terrain.js';
import { createGame, applyShot, undoShot } from '../src/engine/game.js';

/** A flat all-fairway practice range with the hole far away in a corner. */
function range() {
  const c = makeCourse(1, 'straight', 1);
  c.cells.fill(FAIRWAY);
  c.hole = { x: 39, y: 23 };
  c.tee = { x: 2, y: 12 };
  return c;
}

test('every club respects its range table on fairway (angle 0, no scatter path)', () => {
  const c = range();
  const r = resolveShot(c, { x: 2, y: 12 }, { club: 'putter', angle: 0, power: 3 }, 0);
  assert.equal(r.ball.x, 2 + CLUBS.putter.ranges[2]);
  assert.equal(r.ball.y, 12);
});

test('driver flies farther than iron, iron farther than wedge', () => {
  assert.ok(CLUBS.driver.ranges[2] > CLUBS.iron.ranges[2]);
  assert.ok(CLUBS.iron.ranges[2] > CLUBS.wedge.ranges[2]);
});

test('scatter is deterministic: same seed + stroke = same landing', () => {
  const c = range();
  const shot = { club: 'driver', angle: 0.3, power: 2 };
  const a = resolveShot(c, { x: 5, y: 12 }, shot, 4);
  const b = resolveShot(c, { x: 5, y: 12 }, shot, 4);
  assert.deepEqual(a.ball, b.ball);
});

test('water landing returns ball to pre-shot tile and adds a penalty stroke', () => {
  const c = range();
  for (let y = 0; y < 24; y++) for (let x = 8; x < 20; x++) setCell(c, x, y, WATER);
  const r = resolveShot(c, { x: 5, y: 12 }, { club: 'iron', angle: 0, power: 2 }, 0);
  assert.equal(r.event, 'water');
  assert.deepEqual(r.ball, { x: 5, y: 12 });
  assert.equal(r.penalty, 1);
});

test('sand allows only wedge and putter at half range', () => {
  const rules = lieRules(SAND);
  assert.deepEqual(rules.allowed, ['wedge', 'putter']);
  assert.equal(rules.rangeScale, 0.5);
  const c = range();
  setCell(c, 5, 12, SAND);
  assert.throws(() => resolveShot(c, { x: 5, y: 12 }, { club: 'driver', angle: 0, power: 3 }, 0));
});

test('rough reduces range by 25%', () => {
  const c = range();
  setCell(c, 5, 12, ROUGH);
  const r = resolveShot(c, { x: 5, y: 12 }, { club: 'putter', angle: 0, power: 3 }, 0);
  // putter power 3 = 5 tiles, scaled by 0.75 → 4
  assert.equal(r.ball.x, 5 + 4);
});

test('trees block low iron flight but not high driver flight', () => {
  const c = range();
  for (let y = 0; y < 24; y++) setCell(c, 10, y, TREES);
  const iron = resolveShot(c, { x: 5, y: 12 }, { club: 'iron', angle: 0, power: 3 }, 0);
  assert.ok(iron.ball.x < 10, `iron stopped before the tree wall, got x=${iron.ball.x}`);
  const driver = resolveShot(c, { x: 5, y: 12 }, { club: 'driver', angle: 0, power: 1 }, 1);
  assert.ok(driver.ball.x > 10, `driver carried the tree wall, got x=${driver.ball.x}`);
});

test('rolling putt stops when it enters rough', () => {
  const c = range();
  setCell(c, 7, 12, ROUGH);
  const r = resolveShot(c, { x: 5, y: 12 }, { club: 'putter', angle: 0, power: 3 }, 0);
  assert.deepEqual(r.ball, { x: 7, y: 12 });
});

test('putt across the hole tile sinks it', () => {
  const c = range();
  c.hole = { x: 8, y: 12 };
  setCell(c, 8, 12, GREEN);
  const r = resolveShot(c, { x: 5, y: 12 }, { club: 'putter', angle: 0, power: 3 }, 0);
  assert.equal(r.holed, true);
});

test('out of bounds returns ball with a penalty', () => {
  const c = range();
  const r = resolveShot(c, { x: 38, y: 12 }, { club: 'driver', angle: 0, power: 3 }, 2);
  assert.equal(r.event, 'out-of-bounds');
  assert.equal(r.penalty, 1);
  assert.deepEqual(r.ball, { x: 38, y: 12 });
});

test('game state: strokes accumulate and undo replays deterministically', () => {
  let g = createGame(1837462913);
  const before = { ...g.ball };
  g = applyShot(g, { club: 'iron', angle: 0, power: 2 });
  assert.equal(g.strokes >= 1, true);
  const afterOne = { ...g.ball };
  g = applyShot(g, { club: 'wedge', angle: 1, power: 1 });
  g = undoShot(g);
  assert.deepEqual(g.ball, afterOne);
  g = undoShot(g);
  assert.deepEqual(g.ball, before);
  assert.equal(g.strokes, 0);
});

test('holed game ignores further shots', () => {
  const c = range();
  c.hole = { x: 8, y: 12 };
  let g = createGame(1);
  g = { ...g, course: c, ball: { x: 5, y: 12 }, start: { x: 5, y: 12 } };
  g = applyShot(g, { club: 'putter', angle: 0, power: 3 });
  assert.equal(g.holed, true);
  const frozen = applyShot(g, { club: 'driver', angle: 0, power: 3 });
  assert.deepEqual(frozen, g);
});
