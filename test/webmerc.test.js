// Web-Mercator arithmetic, pinned against known values — a tile-math slip
// puts the wrong acre of Earth under someone's hole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  metersPerPixel, pickZoom, lonLatToTile, lonLatToPixel, coveragePlan, tileUrl,
} from '../src/engine/webmerc.js';

test('metersPerPixel matches the textbook values', () => {
  assert.ok(Math.abs(metersPerPixel(0, 0) - 156543.03392) < 0.01);
  // zoom 19 at the equator ≈ 0.2986 m/px
  assert.ok(Math.abs(metersPerPixel(19, 0) - 0.29858) < 0.001);
  // latitude shrinks ground resolution by cos(φ)
  assert.ok(metersPerPixel(15, 60) < metersPerPixel(15, 0) * 0.51);
});

test('lonLatToTile hits the pyramid invariants', () => {
  // (0,0) is the exact center of the pyramid at every zoom
  const c = lonLatToTile(0, 0, 10);
  assert.ok(Math.abs(c.x - 512) < 1e-9 && Math.abs(c.y - 512) < 1e-9);
  // the Mercator ceiling maps to the top row, and y grows southward
  assert.ok(lonLatToTile(0, 85.05112878, 10).y < 1e-6);
  assert.ok(lonLatToTile(0, -30, 10).y > lonLatToTile(0, 30, 10).y);
  // longitude is linear: Sawgrass's x column is exact arithmetic
  const t = lonLatToTile(-81.3954, 30.1975, 15);
  assert.equal(Math.floor(t.x), Math.floor(((-81.3954 + 180) / 360) * 2 ** 15));
  assert.ok(t.y > 0 && t.y < 2 ** 15, 'y inside the pyramid');
});

test('pickZoom prefers the sharper side and respects the clamp', () => {
  // an 8m game tile at 24px wants ~0.33 m/px → z≈18–19 at golf latitudes
  const z = pickZoom(8 / 24, 34, 22);
  assert.ok(z >= 18 && z <= 19, `z=${z}`);
  assert.equal(pickZoom(8 / 24, 34, 17), 17, 'provider max clamps');
  assert.equal(pickZoom(1e6, 0), 3, 'floor clamps');
});

test('coveragePlan covers the rotated board with sane tile counts', () => {
  const geo = { lat: 34.05, lon: -118.5, rotDeg: 37.5, tileM: 8.2 };
  const plan = coveragePlan(geo, { width: 40, height: 24 }, { maxZoom: 19 });
  assert.ok(plan.zoom >= 17 && plan.zoom <= 19);
  assert.ok(plan.tiles.x1 >= plan.tiles.x0 && plan.tiles.y1 >= plan.tiles.y0);
  // a single hole should never demand a whole county of tiles
  assert.ok(plan.count > 0 && plan.count < 120, `count=${plan.count}`);
  // the center pixel must fall inside the tile range
  assert.ok(plan.centerPx.x / 256 >= plan.tiles.x0 && plan.centerPx.x / 256 <= plan.tiles.x1 + 1);
  // rotation must not shrink coverage: 0° needs no more tiles than 37.5°
  const flat = coveragePlan({ ...geo, rotDeg: 0 }, { width: 40, height: 24 });
  assert.ok(plan.count >= flat.count);
});

test('tileUrl fills every placeholder', () => {
  assert.equal(
    tileUrl('https://x/{z}/{x}/{y}?t={token}', 18, 5, 7, 'pk.abc'),
    'https://x/18/5/7?t=pk.abc');
  assert.equal(tileUrl('https://x/{z}/{y}/{x}', 3, 1, 2), 'https://x/3/2/1');
});
