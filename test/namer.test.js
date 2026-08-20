import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseName } from '../src/engine/namer.js';

test('course names are deterministic, non-empty, and vary across seeds', () => {
  assert.equal(courseName(2026), courseName(2026));
  assert.ok(courseName(2026).length >= 7);
  const names = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(courseName));
  assert.ok(names.size >= 5, `variety: ${[...names].join(', ')}`);
});
