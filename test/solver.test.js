import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, verifyLine } from '../src/engine/solver.js';
import { generateCourse } from '../src/engine/generate.js';
import { makeCourse, setCell } from '../src/engine/course.js';
import { FAIRWAY, GREEN } from '../src/engine/terrain.js';

test('solver holes a trivial straight putt in one', () => {
  const c = makeCourse(1, 'straight', 1);
  c.cells.fill(FAIRWAY);
  c.tee = { x: 5, y: 12 };
  c.hole = { x: 8, y: 12 };
  setCell(c, 8, 12, GREEN);
  const r = solve(c, c.tee);
  assert.ok(r, 'solved');
  assert.equal(r.strokes, 1);
});

test('solver lines replay through the real engine (100 seeds)', () => {
  let solved = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const c = generateCourse(seed);
    const r = solve(c, c.tee);
    if (!r) continue;
    solved++;
    assert.ok(verifyLine(c, c.tee, r.line), `seed ${seed}: certificate line replays to holed`);
    assert.ok(r.strokes >= 1 && r.strokes <= 12, `seed ${seed}: sane stroke count`);
  }
  assert.ok(solved >= 95, `${solved}/100 seeds solvable from the tee`);
});

test('solver is deterministic', () => {
  const c = generateCourse(424242);
  const a = solve(c, c.tee);
  const b = solve(c, c.tee);
  assert.deepEqual(a, b);
});
