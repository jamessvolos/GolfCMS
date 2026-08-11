import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCamera, worldToScreen, screenToWorld, worldTransform, courseCamera,
  frameRect, easeOutCubic, lerpCamera, sameCamera,
} from '../src/ui/camera.js';

const TILE = 24;
// a 40x24 course, landscape and portrait, exactly as caddie.js sizes the canvas
const LAND = { w: 40 * TILE, h: 24 * TILE, tile: TILE, rotated: false };
const PORT = { w: 24 * TILE, h: 40 * TILE, tile: TILE, rotated: true };

/** The mapping caddie.js used BEFORE the camera existed. The course view must
 *  still reproduce it exactly — that is the regression bar. */
function legacyToScreen(p, view) {
  return view.rotated
    ? { x: (p.y + 0.5) * TILE, y: view.h - (p.x + 0.5) * TILE }
    : { x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE };
}

test('makeCamera defaults to the identity framing', () => {
  assert.deepEqual(makeCamera(), { scale: 1, cx: 0, cy: 0 });
  assert.deepEqual(makeCamera({ scale: 3, cx: 5, cy: 6 }), { scale: 3, cx: 5, cy: 6 });
});

test('course view reproduces the pre-camera mapping exactly, both orientations', () => {
  for (const view of [LAND, PORT]) {
    const cam = courseCamera(view);
    assert.equal(cam.scale, 1);
    const cols = view.rotated ? view.h / TILE : view.w / TILE;
    const rows = view.rotated ? view.w / TILE : view.h / TILE;
    for (let x = 0; x < cols; x += 3) {
      for (let y = 0; y < rows; y += 3) {
        const got = worldToScreen({ x, y }, cam, view);
        const want = legacyToScreen({ x, y }, view);
        assert.equal(got.x, want.x, `x at ${x},${y} rotated=${view.rotated}`);
        assert.equal(got.y, want.y, `y at ${x},${y} rotated=${view.rotated}`);
      }
    }
  }
});

test('course view inverts the pre-camera mapping exactly', () => {
  for (const view of [LAND, PORT]) {
    const cam = courseCamera(view);
    for (const p of [{ x: 0, y: 0 }, { x: 12.5, y: 7.25 }, { x: 39, y: 23 }]) {
      const s = legacyToScreen(p, view);
      const back = screenToWorld(s.x, s.y, cam, view);
      assert.ok(Math.abs(back.x - p.x) < 1e-9);
      assert.ok(Math.abs(back.y - p.y) < 1e-9);
    }
  }
});

test('round trip is identity at every scale, center and orientation', () => {
  const pts = [
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 19.5, y: 11.5 },
    { x: 7.125, y: 3.875 }, { x: 39, y: 23 }, { x: -4, y: 30 },
  ];
  for (const view of [LAND, PORT]) {
    for (const scale of [1, 1.37, 2, 3.5, 6, 0.5]) {
      for (const c of [{ cx: 19.5, cy: 11.5 }, { cx: 3, cy: 4 }, { cx: 31.25, cy: 18.75 }]) {
        const cam = makeCamera({ scale, ...c });
        for (const p of pts) {
          const s = worldToScreen(p, cam, view);
          const back = screenToWorld(s.x, s.y, cam, view);
          assert.ok(Math.abs(back.x - p.x) < 0.001,
            `x ${p.x}->${back.x} @scale ${scale} rotated=${view.rotated}`);
          assert.ok(Math.abs(back.y - p.y) < 0.001,
            `y ${p.y}->${back.y} @scale ${scale} rotated=${view.rotated}`);
        }
      }
    }
  }
});

test('the camera center lands at the canvas center at any scale', () => {
  for (const view of [LAND, PORT]) {
    for (const scale of [1, 2, 4.5]) {
      const cam = makeCamera({ scale, cx: 8.5, cy: 5.25 });
      const s = worldToScreen({ x: 8.5, y: 5.25 }, cam, view);
      assert.ok(Math.abs(s.x - view.w / 2) < 1e-9);
      assert.ok(Math.abs(s.y - view.h / 2) < 1e-9);
    }
  }
});

test('zoom magnifies distances by exactly the scale', () => {
  for (const view of [LAND, PORT]) {
    const cam = makeCamera({ scale: 3, cx: 10, cy: 10 });
    const a = worldToScreen({ x: 10, y: 10 }, cam, view);
    const b = worldToScreen({ x: 14, y: 10 }, cam, view);
    assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 4 * TILE * 3) < 1e-9);
  }
});

test('worldTransform matches worldToScreen step for step', () => {
  // replay the ctx steps as a 2x3 matrix, then map world PIXELS through it
  const apply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  for (const view of [LAND, PORT]) {
    for (const cam of [courseCamera(view), makeCamera({ scale: 2.5, cx: 30, cy: 6 })]) {
      let m = [1, 0, 0, 1, 0, 0];
      for (const s of worldTransform(cam, view)) {
        if (s.t === 'translate') m = mul(m, [1, 0, 0, 1, s.x, s.y]);
        else if (s.t === 'scale') m = mul(m, [s.k, 0, 0, s.k, 0, 0]);
        else m = mul(m, [Math.cos(s.a), Math.sin(s.a), -Math.sin(s.a), Math.cos(s.a), 0, 0]);
      }
      for (const p of [{ x: 0, y: 0 }, { x: 12, y: 9 }, { x: 23.5, y: 4.5 }]) {
        const viaMatrix = apply(m, (p.x + 0.5) * TILE, (p.y + 0.5) * TILE);
        const viaPoint = worldToScreen(p, cam, view);
        assert.ok(Math.abs(viaMatrix.x - viaPoint.x) < 1e-9, 'transform x');
        assert.ok(Math.abs(viaMatrix.y - viaPoint.y) < 1e-9, 'transform y');
      }
    }
  }
});

test('frameRect fits the padded rect inside the visible viewport', () => {
  const rect = { x0: 30, y0: 8, x1: 36, y1: 14 }; // a 7x7-tile green
  const view = { ...LAND, viewW: 920, viewH: 576, pad: 2, min: 1, max: 6 };
  const cam = frameRect(rect, view);
  assert.equal(cam.cx, 33);
  assert.equal(cam.cy, 11);
  // every corner of the padded rect must be inside the visible slice
  for (const p of [
    { x: rect.x0 - 2, y: rect.y0 - 2 }, { x: rect.x1 + 2, y: rect.y1 + 2 },
    { x: rect.x0 - 2, y: rect.y1 + 2 }, { x: rect.x1 + 2, y: rect.y0 - 2 },
  ]) {
    const s = worldToScreen(p, cam, view);
    assert.ok(Math.abs(s.x - view.w / 2) <= view.viewW / 2 + 1e-9, 'inside horizontally');
    assert.ok(Math.abs(s.y - view.h / 2) <= view.viewH / 2 + 1e-9, 'inside vertically');
  }
  assert.ok(cam.scale > 1.5, `expected a real zoom, got ${cam.scale}`);
});

test('frameRect centers on the given centroid and still contains the rect', () => {
  // an off-center centroid: extents mirror about it so nothing is cropped
  const rect = { x0: 10, y0: 10, x1: 20, y1: 14, cx: 12, cy: 11 };
  const view = { ...LAND, viewW: 920, viewH: 576, pad: 1 };
  const cam = frameRect(rect, view);
  assert.equal(cam.cx, 12);
  assert.equal(cam.cy, 11);
  for (const p of [{ x: 10, y: 10 }, { x: 20, y: 14 }]) {
    const s = worldToScreen(p, cam, view);
    assert.ok(Math.abs(s.x - view.w / 2) <= view.viewW / 2 + 1e-9);
    assert.ok(Math.abs(s.y - view.h / 2) <= view.viewH / 2 + 1e-9);
  }
});

test('frameRect swaps the fit axes in portrait', () => {
  const rect = { x0: 10, y0: 10, x1: 22, y1: 13 }; // wide in x, short in y
  const base = { viewW: 440, viewH: 950, pad: 2, tile: TILE, w: PORT.w, h: PORT.h };
  const land = frameRect(rect, { ...base, rotated: false });
  const port = frameRect(rect, { ...base, rotated: true });
  // portrait turns the wide axis into the tall viewport axis, so it fits better
  assert.ok(port.scale > land.scale, `${port.scale} vs ${land.scale}`);
});

test('frameRect clamps the scale to [min, max]', () => {
  const view = { ...LAND, viewW: 920, viewH: 576, pad: 2 };
  // a green the size of the whole board would want to zoom OUT — clamped to 1
  const huge = frameRect({ x0: 0, y0: 0, x1: 39, y1: 23 }, view);
  assert.equal(huge.scale, 1);
  // a single-tile green would want an absurd zoom — clamped to the max
  const tiny = frameRect({ x0: 20, y0: 12, x1: 20, y1: 12 }, { ...view, pad: 0 });
  assert.equal(tiny.scale, 6);
  assert.equal(frameRect({ x0: 20, y0: 12, x1: 20, y1: 12 }, { ...view, pad: 0, max: 3 }).scale, 3);
});

test('easeOutCubic runs 0 to 1, decelerating, and clamps', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(1.4), 1);
  assert.equal(easeOutCubic(-0.2), 0);
  assert.ok(easeOutCubic(0.5) > 0.5); // out-ease is ahead at the midpoint
  assert.ok(easeOutCubic(0.25) > easeOutCubic(0.1));
});

test('lerpCamera blends every field and hits both ends', () => {
  const a = makeCamera({ scale: 1, cx: 20, cy: 12 });
  const b = makeCamera({ scale: 3, cx: 33, cy: 11 });
  assert.deepEqual(lerpCamera(a, b, 0), a);
  assert.deepEqual(lerpCamera(a, b, 1), b);
  const mid = lerpCamera(a, b, 0.5);
  assert.equal(mid.scale, 2);
  assert.equal(mid.cx, 26.5);
  assert.equal(mid.cy, 11.5);
});

test('sameCamera spots a framing that would not move', () => {
  const a = makeCamera({ scale: 2, cx: 10, cy: 5 });
  assert.ok(sameCamera(a, { scale: 2, cx: 10, cy: 5 }));
  assert.ok(sameCamera(a, { scale: 2.00001, cx: 10, cy: 5 }));
  assert.ok(!sameCamera(a, { scale: 2.5, cx: 10, cy: 5 }));
  assert.ok(!sameCamera(a, { scale: 2, cx: 11, cy: 5 }));
});
