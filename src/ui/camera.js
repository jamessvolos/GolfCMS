// The world camera: pure math for the single world↔screen seam.
//
// caddie.js maps between world tiles and canvas pixels in exactly three
// places — toScreen, fromScreenPx and beginWorld — so everything the game
// draws, aims and pins goes through this one transform. Putting the math
// here keeps it testable and keeps the seam honest: worldToScreen and
// screenToWorld are exact inverses, and beginWorld's ctx transform is the
// same mapping expressed as a matrix.
//
// Coordinate spaces, outward:
//   world tiles   p = {x, y}, tile centers (the game's own coordinates)
//   world pixels  u = (p.x + 0.5) * TILE — what the course art is drawn in
//   screen pixels canvas bitmap coordinates, after portrait rotation + camera
// The canvas bitmap is then cover-fit to the viewport by CSS, unchanged.

/** @typedef {{scale: number, cx: number, cy: number}} Camera
 *  scale: world pixels per screen pixel (1 = the classic course view)
 *  cx/cy: world TILE coordinates sitting at the center of the canvas. */

/** @typedef {{w: number, h: number, tile?: number, rotated?: boolean}} View
 *  w/h: canvas bitmap size. rotated: portrait — tee at the bottom. */

export function makeCamera(init = {}) {
  return { scale: 1, cx: 0, cy: 0, ...init };
}

/** World pixels → screen pixels: the portrait quarter-turn, nothing else.
 *  Matches `translate(0, h); rotate(-90°)` exactly. */
function rot(u, v, view) {
  return view.rotated ? { x: v, y: view.h - u } : { x: u, y: v };
}
/** The exact inverse of rot(). */
function unrot(x, y, view) {
  return view.rotated ? { u: view.h - y, v: x } : { u: x, v: y };
}

/** World tile point → screen (canvas bitmap) pixel. */
export function worldToScreen(p, cam, view) {
  const tile = view.tile ?? 24;
  const r = rot((p.x + 0.5) * tile, (p.y + 0.5) * tile, view);
  const c = rot((cam.cx + 0.5) * tile, (cam.cy + 0.5) * tile, view);
  return {
    x: view.w / 2 + (r.x - c.x) * cam.scale,
    y: view.h / 2 + (r.y - c.y) * cam.scale,
  };
}

/** Screen (canvas bitmap) pixel → world tile point. Exact inverse of the above. */
export function screenToWorld(sx, sy, cam, view) {
  const tile = view.tile ?? 24;
  const c = rot((cam.cx + 0.5) * tile, (cam.cy + 0.5) * tile, view);
  const { u, v } = unrot(
    (sx - view.w / 2) / cam.scale + c.x,
    (sy - view.h / 2) / cam.scale + c.y,
    view
  );
  return { x: u / tile - 0.5, y: v / tile - 0.5 };
}

/** The ctx transform steps for beginWorld, outermost first. Applying them in
 *  order makes drawing in WORLD PIXELS land exactly where worldToScreen says.
 *  Returned as data so the transform and the point math can never drift. */
export function worldTransform(cam, view) {
  const tile = view.tile ?? 24;
  const c = rot((cam.cx + 0.5) * tile, (cam.cy + 0.5) * tile, view);
  const steps = [
    { t: 'translate', x: view.w / 2, y: view.h / 2 },
    { t: 'scale', k: cam.scale },
    { t: 'translate', x: -c.x, y: -c.y },
  ];
  if (view.rotated) {
    steps.push({ t: 'translate', x: 0, y: view.h });
    steps.push({ t: 'rotate', a: -Math.PI / 2 });
  }
  return steps;
}

/** The classic course view: scale 1, whole board centered — pixel-for-pixel
 *  the framing the game had before the camera existed. */
export function courseCamera(view) {
  const tile = view.tile ?? 24;
  const cols = (view.rotated ? view.h : view.w) / tile;
  const rows = (view.rotated ? view.w : view.h) / tile;
  return { scale: 1, cx: (cols - 1) / 2, cy: (rows - 1) / 2 };
}

/**
 * Fit a world rect (tile coords, inclusive) into the visible viewport.
 * The rect may name its own center (a green's centroid); the extents are then
 * mirrored about that center so the whole rect still fits.
 * @param {{x0:number,y0:number,x1:number,y1:number,cx?:number,cy?:number}} rect
 * @param {View & {viewW:number, viewH:number, pad?:number, min?:number, max?:number}} view
 *   viewW/viewH: the VISIBLE slice of the canvas bitmap, in bitmap pixels
 *   (cover-fit crops the rest). pad: extra tiles of margin on every side.
 * @returns {Camera}
 */
export function frameRect(rect, view) {
  const tile = view.tile ?? 24;
  const pad = view.pad ?? 0;
  const min = view.min ?? 1;
  const max = view.max ?? 6;
  const cx = rect.cx ?? (rect.x0 + rect.x1) / 2;
  const cy = rect.cy ?? (rect.y0 + rect.y1) / 2;
  // mirror the extents about the chosen center, +0.5 because tile coords are
  // centers and a tile reaches half a tile further in every direction
  const hx = Math.max(cx - rect.x0, rect.x1 - cx) + pad + 0.5;
  const hy = Math.max(cy - rect.y0, rect.y1 - cy) + pad + 0.5;
  const wpx = 2 * hx * tile;
  const hpx = 2 * hy * tile;
  const alongX = view.rotated ? hpx : wpx; // portrait swaps the axes
  const alongY = view.rotated ? wpx : hpx;
  const fit = Math.min(view.viewW / alongX, view.viewH / alongY);
  return { scale: Math.max(min, Math.min(max, fit)), cx, cy };
}

/** The bbox of two world points — a ball→pin corridor. frameRect pads and
 *  centers it; keeping the bbox its own function keeps the rule testable. */
export function corridorRect(a, b) {
  return {
    x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y),
  };
}

/**
 * Zoom about a SCREEN point: the world point under (sx, sy) stays exactly
 * under (sx, sy) while the scale changes by `factor`, clamped to [min, max].
 * A clamped-away factor is a perfect no-op (the returned camera equals `cam`),
 * so a wheel spun into the stop never drifts the view.
 */
export function zoomAbout(cam, sx, sy, factor, view, opts = {}) {
  const tile = view.tile ?? 24;
  const min = opts.min ?? 0.25;
  const max = opts.max ?? 12;
  const scale = Math.max(min, Math.min(max, cam.scale * factor));
  const p = screenToWorld(sx, sy, cam, view); // what the pointer is holding
  const r = rot((p.x + 0.5) * tile, (p.y + 0.5) * tile, view);
  // solve worldToScreen(p, next) === (sx, sy) for the new center
  const { u, v } = unrot(
    r.x - (sx - view.w / 2) / scale,
    r.y - (sy - view.h / 2) / scale,
    view
  );
  return { scale, cx: u / tile - 0.5, cy: v / tile - 0.5 };
}

/** Pan by a SCREEN-pixel delta: the world slides with the finger, so the point
 *  under it stays under it. Scale is untouched. */
export function panBy(cam, dx, dy, view) {
  const tile = view.tile ?? 24;
  const c = rot((cam.cx + 0.5) * tile, (cam.cy + 0.5) * tile, view);
  const { u, v } = unrot(c.x - dx / cam.scale, c.y - dy / cam.scale, view);
  return { scale: cam.scale, cx: u / tile - 0.5, cy: v / tile - 0.5 };
}

/** Keep a camera center within reach of the board, so a pan can never strand
 *  the player on empty background. */
export function clampCenter(cam, bounds) {
  const m = bounds.margin ?? 2;
  return {
    scale: cam.scale,
    cx: Math.max(-m, Math.min(bounds.width - 1 + m, cam.cx)),
    cy: Math.max(-m, Math.min(bounds.height - 1 + m, cam.cy)),
  };
}

export const easeOutCubic = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

/** Blend two cameras. t is already eased. */
export function lerpCamera(a, b, t) {
  return {
    scale: a.scale + (b.scale - a.scale) * t,
    cx: a.cx + (b.cx - a.cx) * t,
    cy: a.cy + (b.cy - a.cy) * t,
  };
}

/** Are two cameras the same framing (within a hair)? */
export function sameCamera(a, b, eps = 1e-4) {
  return Math.abs(a.scale - b.scale) < eps
    && Math.abs(a.cx - b.cx) < eps
    && Math.abs(a.cy - b.cy) < eps;
}
