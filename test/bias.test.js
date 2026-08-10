import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patternPoints, MAX_CARRY } from '../src/engine/dispersion.js';
import { strokesField, bestAim } from '../src/engine/strategy.js';
import { makeCourse, setCell } from '../src/engine/course.js';
import { FAIRWAY, GREEN } from '../src/engine/terrain.js';

const mean = (pts, k) => pts.reduce((s, p) => s + p[k], 0) / pts.length;

test('directional miss bias shifts the pattern mean sideways, scaled by carry', () => {
  const from = { x: 0, y: 12 };
  const target = { x: MAX_CARRY, y: 12 }; // full carry due east: bias pushes +y
  const straight = patternPoints(from, target, 1, undefined, { base: 1, longExtra: 0, bias: 0 });
  const rightMiss = patternPoints(from, target, 1, undefined, { base: 1, longExtra: 0, bias: 1 });
  const leftMiss = patternPoints(from, target, 1, undefined, { base: 1, longExtra: 0, bias: -1 });
  assert.ok(mean(rightMiss, 'y') - mean(straight, 'y') > 0.9, 'positive bias pushes one way');
  assert.ok(mean(leftMiss, 'y') - mean(straight, 'y') < -0.9, 'negative bias the other');
  const chip = patternPoints(from, { x: 4, y: 12 }, 1, undefined, { base: 1, longExtra: 0, bias: 1 });
  assert.ok(Math.abs(mean(chip, 'y') - 12) < 0.4, 'short clubs barely feel the bias');
});

test('the caddie plays farther from trouble when the miss leaks toward it', () => {
  const c = makeCourse(11, 'straight', 1);
  c.cells.fill(FAIRWAY);
  c.tee = { x: 3, y: 12 };
  c.hole = { x: 34, y: 12 };
  setCell(c, 34, 12, GREEN);
  // water guards the entire right side of the landing zone
  for (let x = 14; x <= 30; x++) for (let y = 15; y <= 18; y++) {
    const { setCell: sc } = { setCell };
    sc(c, x, y, 3); // WATER
  }
  const straight = { id: 's', label: 's', base: 1, longExtra: 0, bias: 0 };
  const leaky = { id: 'x', label: 'x', base: 1, longExtra: 0, bias: 1.5 };
  const from = { x: 6, y: 12 };
  const a = bestAim(c, strokesField(c, 6, straight), from, 1, straight);
  const b = bestAim(c, strokesField(c, 6, leaky), from, 1, leaky);
  assert.ok(b.target.y <= a.target.y, `rightward leak aims farther left of the water: ` +
    `${b.target.y} <= ${a.target.y}`);
  assert.ok(b.target.y < 12, `and holds left of the direct line, got y=${b.target.y}`);
});
