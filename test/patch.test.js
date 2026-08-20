import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePatch, decodePatch, applyPatch, diffCourses } from '../src/engine/patch.js';
import { generateCourse } from '../src/engine/generate.js';
import { solve } from '../src/engine/solver.js';
import { cellAt } from '../src/engine/course.js';
import { WATER, SAND, GREEN, FAIRWAY } from '../src/engine/terrain.js';

test('patch codec round-trips and rejects garbage', () => {
  const edits = [{ i: 0, t: 3 }, { i: 959, t: 10 }, { i: 500, t: 0 }];
  assert.deepEqual(decodePatch(encodePatch(edits)), edits);
  assert.equal(encodePatch([]), '');
  assert.throws(() => decodePatch('xyz!'));
  assert.throws(() => decodePatch('12345')); // not a multiple of 4
  assert.throws(() => decodePatch('000f')); // terrain 15 doesn't exist
  assert.throws(() => encodePatch([{ i: 5000, t: 0 }]));
});

test('applyPatch changes tiles but never the tee or hole anchors', () => {
  const base = generateCourse(42);
  const teeI = base.tee.y * base.width + base.tee.x;
  const holeI = base.hole.y * base.width + base.hole.x;
  const patched = applyPatch(base, [
    { i: teeI, t: WATER },
    { i: holeI, t: WATER },
    { i: 100, t: SAND },
  ]);
  assert.equal(patched.cells[teeI], base.cells[teeI], 'tee immutable');
  assert.equal(patched.cells[holeI], base.cells[holeI], 'hole immutable');
  assert.equal(patched.cells[100], SAND);
  assert.notEqual(patched.cells, base.cells, 'base untouched (new array)');
  assert.equal(cellAt(base, 100 % 40, Math.floor(100 / 40)), base.cells[100]);
});

test('diff → encode → decode → apply reproduces an edited course exactly', () => {
  const base = generateCourse(7);
  const edited = { ...base, cells: [...base.cells] };
  // carve a lake and a bunker somewhere unremarkable
  for (let i = 200; i < 210; i++) edited.cells[i] = WATER;
  edited.cells[400] = SAND;
  const patch = diffCourses(base, edited);
  const rebuilt = applyPatch(base, decodePatch(encodePatch(patch)));
  assert.deepEqual(rebuilt.cells, edited.cells);
});

test('a patched course can still be certified by the solver', () => {
  const base = generateCourse(11);
  // pave the whole map: trivially solvable after patching
  const edits = base.cells.map((t, i) => ({ i, t: FAIRWAY }))
    .filter(({ i }) => base.cells[i] !== FAIRWAY && base.cells[i] !== GREEN)
    .slice(0, 399);
  const patched = applyPatch(base, edits);
  const solved = solve(patched, patched.tee);
  assert.ok(solved, 'patched course solvable');
  assert.ok(solved.strokes >= 1);
});
