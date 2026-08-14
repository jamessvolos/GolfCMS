// The contour engine under the art style. Pure geometry, so it gets real
// assertions: a disc of tiles must come back as one closed loop of about the
// right area, `grow` must move the contour outward, and the same course must
// draw the same picture every time.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  maskField, addWobble, marchLoops, chaikin, loopArea, terrainLoops, CONTOUR_RES,
} from '../src/ui/contours.js';

/** A bare course-shaped object: contours only read width/height/cells/seed. */
function board(w, h, fill = 0) {
  return { width: w, height: h, seed: 4242, cells: new Uint8Array(w * h).fill(fill) };
}

function stampDisc(c, cx, cy, r, v) {
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (Math.hypot(x - cx, y - cy) <= r) c.cells[y * c.width + x] = v;
    }
  }
}

test('a disc of tiles becomes one closed loop of about the right area', () => {
  const c = board(24, 24);
  stampDisc(c, 12, 12, 4.5, 1);
  const loops = terrainLoops(c, (t) => t === 1, { wobble: 0, tilePx: 24 });
  assert.equal(loops.length, 1);
  const areaTiles = Math.abs(loopArea(loops[0])) / (24 * 24);
  const trueTiles = c.cells.reduce((n, v) => n + v, 0);
  assert.ok(Math.abs(areaTiles - trueTiles) / trueTiles < 0.15,
    `contour encloses ${areaTiles.toFixed(1)} tiles, mask has ${trueTiles}`);
});

test('two separate blobs give two loops; touching blobs merge into one', () => {
  const c = board(30, 16);
  stampDisc(c, 6, 8, 2.2, 1);
  stampDisc(c, 22, 8, 2.2, 1);
  assert.equal(terrainLoops(c, (t) => t === 1, { wobble: 0 }).length, 2);
  const d = board(30, 16);
  stampDisc(d, 12, 8, 3, 1);
  stampDisc(d, 17, 8, 3, 1);
  assert.equal(terrainLoops(d, (t) => t === 1, { wobble: 0 }).length, 1);
});

test('grow moves the contour outward by about grow pixels', () => {
  const c = board(24, 24);
  stampDisc(c, 12, 12, 4.5, 1);
  const base = terrainLoops(c, (t) => t === 1, { wobble: 0 })[0];
  const grown = terrainLoops(c, (t) => t === 1, { wobble: 0, grow: 5 })[0];
  const rOf = (loop) => {
    let s = 0;
    for (const [x, y] of loop) s += Math.hypot(x - 12.5 * 24, y - 12.5 * 24);
    return s / loop.length;
  };
  const dr = rOf(grown) - rOf(base);
  assert.ok(dr > 2.5 && dr < 8, `grow=5px moved the mean radius by ${dr.toFixed(1)}px`);
});

test('wobble is deterministic per seed and bounded', () => {
  const c = board(24, 24);
  stampDisc(c, 12, 12, 5, 1);
  const a = terrainLoops(c, (t) => t === 1, { name: 'sand' });
  const b = terrainLoops(c, (t) => t === 1, { name: 'sand' });
  assert.deepEqual(a, b, 'same course, same picture');
  const flat = terrainLoops(c, (t) => t === 1, { wobble: 0 });
  // wobble must move the edge — that is its whole job — but never far enough
  // to contradict the tiles the ball obeys
  let maxDev = 0;
  for (const [x, y] of a[0]) {
    let best = Infinity;
    for (const [fx, fy] of flat[0]) best = Math.min(best, Math.hypot(x - fx, y - fy));
    maxDev = Math.max(maxDev, best);
  }
  assert.ok(maxDev > 0.5, 'wobble did nothing');
  assert.ok(maxDev < 24 * 0.4, `wobble moved an edge ${maxDev.toFixed(1)}px — more than 0.4 tiles`);
});

test('interiors never wobble: solid mask stays solid at the sample level', () => {
  const c = board(20, 20);
  stampDisc(c, 10, 10, 6, 1);
  const field = maskField(c, (t) => t === 1);
  const before = Float32Array.from(field.f);
  addWobble(field, 7, 'x', 0.09);
  for (let i = 0; i < field.f.length; i++) {
    if (before[i] === 1) assert.equal(field.f[i], 1, 'a solid interior sample moved');
    if (before[i] === 0) assert.equal(field.f[i], 0, 'an empty exterior sample moved');
  }
});

test('terrain touching the board edge still closes its loop', () => {
  const c = board(16, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 4; x++) c.cells[y * 16 + x] = 1;
  const loops = terrainLoops(c, (t) => t === 1, { wobble: 0 });
  assert.equal(loops.length, 1, 'an edge-hugging strip must still be one closed loop');
});

test('chaikin shortens corners but preserves point count growth and closure', () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const sm = chaikin(sq, 2);
  assert.equal(sm.length, 16);
  const area = Math.abs(loopArea(sm));
  assert.ok(area > 70 && area < 100, `smoothed square area ${area.toFixed(1)}`);
});

test('tiny specks are culled, real features are kept', () => {
  const c = board(20, 20);
  c.cells[5 * 20 + 5] = 1; // a lone tile: below default minArea? 1 tile > 0.16 — kept
  stampDisc(c, 14, 14, 2, 1);
  const loops = terrainLoops(c, (t) => t === 1, { wobble: 0 });
  assert.equal(loops.length, 2, 'a full tile is a feature, not a speck');
  const speck = terrainLoops(c, (t) => t === 1, { wobble: 0, minArea: 1.5 });
  assert.equal(speck.length, 1, 'minArea culls the lone tile when asked');
});

test('marchLoops levels bracket the mask: low level contains high level', () => {
  const c = board(24, 24);
  stampDisc(c, 12, 12, 4, 1);
  const field = maskField(c, (t) => t === 1, CONTOUR_RES);
  const lo = marchLoops(field, 0.3)[0];
  const hi = marchLoops(field, 0.7)[0];
  assert.ok(Math.abs(loopArea(lo)) > Math.abs(loopArea(hi)),
    'the 0.3 iso-line must enclose the 0.7 one');
});
