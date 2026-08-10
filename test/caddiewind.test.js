import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windShift, patternStats, sampleLanding } from '../src/engine/dispersion.js';
import { strokesField, bestAim } from '../src/engine/strategy.js';
import { makeCourse, setCell } from '../src/engine/course.js';
import { FAIRWAY, GREEN } from '../src/engine/terrain.js';

function flat(windy) {
  const c = makeCourse(9, 'straight', 1);
  c.cells.fill(FAIRWAY);
  c.tee = { x: 3, y: 12 };
  c.hole = { x: 34, y: 12 };
  setCell(c, 34, 12, GREEN);
  if (windy) c.wind = { x: 0, y: 2 };
  return c;
}

test('calm courses have zero drift; windy patterns move downwind by carry', () => {
  assert.deepEqual(windShift(flat(false), { x: 3, y: 12 }, { x: 13, y: 12 }), { x: 0, y: 0 });
  const drift = windShift(flat(true), { x: 3, y: 12 }, { x: 13, y: 12 });
  assert.equal(drift.y, 2, 'full carry takes the whole gust');
  assert.ok(windShift(flat(true), { x: 3, y: 12 }, { x: 6, y: 12 }).y < 1, 'chips barely drift');
});

test('wind moves the whole pattern and the sampled ball', () => {
  const calm = patternStats(flat(false), { x: 3, y: 12 }, { x: 15, y: 12 }, 1);
  const gusty = patternStats(flat(true), { x: 3, y: 12 }, { x: 15, y: 12 }, 1);
  const meanY = (st) => st.dots.reduce((s, d) => s + d.y, 0) / st.dots.length;
  assert.ok(meanY(gusty) - meanY(calm) > 1.5, 'pattern center blown downwind');
  const a = sampleLanding(flat(false), { x: 3, y: 12 }, { x: 15, y: 12 }, 1, 0);
  const b = sampleLanding(flat(true), { x: 3, y: 12 }, { x: 15, y: 12 }, 1, 0);
  assert.equal(b.y - a.y, 2);
});

test('the caddie aims upwind to compensate', () => {
  const c = flat(true);
  const V = strokesField(c);
  const best = bestAim(c, V, { x: 20, y: 12 }, 1);
  assert.ok(best.target.y < 12, `optimal aim holds into the wind, got y=${best.target.y}`);
});
