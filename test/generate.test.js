import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCourse, ARCHETYPES } from '../src/engine/generate.js';
import { FAIRWAY, WATER, TREES, GREEN } from '../src/engine/terrain.js';
import { cellAt, inBounds } from '../src/engine/course.js';

test('same seed generates an identical course', () => {
  const a = generateCourse(1837462913);
  const b = generateCourse(1837462913);
  assert.deepEqual(a, b);
});

test('property: 1000 seeded courses satisfy structural invariants', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const c = generateCourse(seed);
    assert.ok(inBounds(c, c.tee.x, c.tee.y), `seed ${seed}: tee in bounds`);
    assert.ok(inBounds(c, c.hole.x, c.hole.y), `seed ${seed}: hole in bounds`);
    assert.ok(ARCHETYPES.includes(c.archetype), `seed ${seed}: known archetype`);
    assert.equal(cellAt(c, c.tee.x, c.tee.y), FAIRWAY, `seed ${seed}: tee is fairway`);
    assert.equal(cellAt(c, c.hole.x, c.hole.y), GREEN, `seed ${seed}: hole is on green`);
    assert.ok(
      Math.hypot(c.hole.x - c.tee.x, c.hole.y - c.tee.y) >= 15,
      `seed ${seed}: hole is a real distance from the tee`
    );
    // A corridor of restable tiles must connect tee to hole (flood fill).
    assert.ok(reachable(c), `seed ${seed}: hole reachable over land`);
  }
});

function reachable(course) {
  const seen = new Set([course.tee.x + ',' + course.tee.y]);
  const queue = [course.tee];
  while (queue.length) {
    const p = queue.pop();
    if (p.x === course.hole.x && p.y === course.hole.y) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const n = { x: p.x + dx, y: p.y + dy };
      const key = n.x + ',' + n.y;
      if (!inBounds(course, n.x, n.y) || seen.has(key)) continue;
      const t = cellAt(course, n.x, n.y);
      if (t === WATER || t === TREES) continue;
      seen.add(key);
      queue.push(n);
    }
  }
  return false;
}

test('archetype distribution covers all archetypes across seeds', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) seen.add(generateCourse(seed).archetype);
  assert.deepEqual([...seen].sort(), [...ARCHETYPES].sort());
});
