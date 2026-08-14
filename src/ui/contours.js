// Iso-contours over the tile grid — the primitive the whole art style now
// stands on.
//
// Until this module, every terrain shape on screen was `blob()`: a union of
// rounded rectangles, one per tile. However good the palette and the light,
// a bunker drawn that way is a plus-sign and a pond is a stack of squares —
// the GRID was the art style, and it capped everything layered on top.
//
// The replacement treats the tile mask as samples of a continuous field:
//
//   1. FIELD. Each tile contributes 0 or 1 at its centre; the field between
//      centres is bilinear. A straight run of tiles gives a straight 0→1 ramp
//      one tile wide, so the 0.5 iso-line sits exactly on the tile boundary —
//      which is what makes `grow` a LEVEL SHIFT rather than a second geometry
//      system: level 0.5 − g/TILE is the old blob grown by g pixels.
//   2. WOBBLE. A little seeded value-noise is added to the field, so straight
//      edges meander the way mown edges do. Seeded from the course, so a hole
//      always draws the same — and small enough (≤0.09) that no contour moves
//      more than a third of a tile, so the art never contradicts the tiles the
//      ball actually obeys.
//   3. MARCH. Standard marching squares with edge interpolation, segments
//      stitched into closed loops.
//   4. SMOOTH. Chaikin corner-cutting, twice. Polylines in, organic curves out.
//
// Everything here is pure arithmetic on arrays — no canvas, no DOM — so the
// geometry is unit-testable in node and the painting code just fills paths.

import { substream } from '../engine/rng.js';

/** Field samples per tile edge. 4 puts contour vertices every 6 world px. */
export const CONTOUR_RES = 4;

/** Default wobble amplitude, in field units (1 = a full tile of mask). */
export const WOBBLE = 0.07;

/**
 * The scalar field for a terrain predicate, sampled on a ((w·res)+1)² grid of
 * points with a half-sample ring of 0 padding outside the course, so every
 * contour closes even when the terrain touches the board edge.
 *
 * @param {import('../engine/course.js').Course} course
 * @param {(t: number) => boolean} match
 * @param {number} [res]
 * @returns {{f: Float32Array, gw: number, gh: number, res: number}}
 */
export function maskField(course, match, res = CONTOUR_RES) {
  const gw = course.width * res + 1;
  const gh = course.height * res + 1;
  const f = new Float32Array(gw * gh);
  const tile = (x, y) => {
    if (x < 0 || y < 0 || x >= course.width || y >= course.height) return 0;
    return match(course.cells[y * course.width + x]) ? 1 : 0;
  };
  for (let j = 0; j < gh; j++) {
    // sample point in tile coordinates, measured from tile CENTres
    const ty = j / res - 0.5;
    const y0 = Math.floor(ty);
    const fy = ty - y0;
    for (let i = 0; i < gw; i++) {
      const tx = i / res - 0.5;
      const x0 = Math.floor(tx);
      const fx = tx - x0;
      const v =
        tile(x0, y0) * (1 - fx) * (1 - fy) +
        tile(x0 + 1, y0) * fx * (1 - fy) +
        tile(x0, y0 + 1) * (1 - fx) * fy +
        tile(x0 + 1, y0 + 1) * fx * fy;
      f[j * gw + i] = v;
    }
  }
  return { f, gw, gh, res };
}

/**
 * Seeded value-noise wobble, added in place. Lattice noise at ~1.7-tile
 * wavelength, bilinear between lattice points, zero at the field's hard 0s and
 * 1s (scaled by f·(1−f)) so only the EDGES move — interiors stay solid.
 */
export function addWobble(field, seed, name, amp = WOBBLE) {
  const { f, gw, gh, res } = field;
  const rng = substream(seed >>> 0, 'art:' + name);
  const cell = Math.max(2, Math.round(res * 1.7));
  const lw = Math.ceil(gw / cell) + 2;
  const lh = Math.ceil(gh / cell) + 2;
  const lattice = new Float32Array(lw * lh);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng() * 2 - 1;
  for (let j = 0; j < gh; j++) {
    const ly = j / cell;
    const y0 = Math.floor(ly);
    const fy = ly - y0;
    for (let i = 0; i < gw; i++) {
      const lx = i / cell;
      const x0 = Math.floor(lx);
      const fx = lx - x0;
      const n =
        lattice[y0 * lw + x0] * (1 - fx) * (1 - fy) +
        lattice[y0 * lw + x0 + 1] * fx * (1 - fy) +
        lattice[(y0 + 1) * lw + x0] * (1 - fx) * fy +
        lattice[(y0 + 1) * lw + x0 + 1] * fx * fy;
      const v = f[j * gw + i];
      f[j * gw + i] = v + n * amp * 4 * v * (1 - v);
    }
  }
  return field;
}

/**
 * March the `level` iso-line and stitch the segments into closed loops.
 * Returns loops of [x, y] points in FIELD grid units.
 */
export function marchLoops(field, level = 0.5) {
  const { f, gw, gh } = field;
  // The field is bilinear over a BINARY mask, so its values sit on a coarse
  // lattice (multiples of 1/res²) — and 0.5 is on it. An iso-level equal to a
  // sample value makes crossings land exactly on samples: zero-length
  // segments, coincident endpoints, and a stitcher that walks two steps and
  // gives up. Nudging the level off the lattice by an amount three orders
  // below a pixel makes every crossing strictly interior to its edge.
  level += 1.37e-5;
  const at = (i, j) => f[j * gw + i];
  // interpolated crossing on an edge between two sample points
  const lerp = (a, b) => {
    const d = b - a;
    return Math.abs(d) < 1e-12 ? 0.5 : (level - a) / d;
  };
  // segments keyed by their endpoints, quantized for stitching
  const segs = [];
  for (let j = 0; j < gh - 1; j++) {
    for (let i = 0; i < gw - 1; i++) {
      const tl = at(i, j);
      const tr = at(i + 1, j);
      const br = at(i + 1, j + 1);
      const bl = at(i, j + 1);
      let code = 0;
      if (tl >= level) code |= 8;
      if (tr >= level) code |= 4;
      if (br >= level) code |= 2;
      if (bl >= level) code |= 1;
      if (code === 0 || code === 15) continue;
      const top = [i + lerp(tl, tr), j];
      const right = [i + 1, j + lerp(tr, br)];
      const bottom = [i + lerp(bl, br), j + 1];
      const left = [i, j + lerp(tl, bl)];
      const emit = (a, b) => segs.push([a, b]);
      switch (code) {
        case 1: emit(left, bottom); break;
        case 2: emit(bottom, right); break;
        case 3: emit(left, right); break;
        case 4: emit(right, top); break;
        case 6: emit(bottom, top); break;
        case 7: emit(left, top); break;
        case 8: emit(top, left); break;
        case 9: emit(top, bottom); break;
        case 11: emit(top, right); break;
        case 12: emit(right, left); break;
        // 13: only br outside — the contour crosses the RIGHT and BOTTOM
        // edges. 14: only bl outside — LEFT and BOTTOM. The first version had
        // these two swapped with their complements, which is invisible on a
        // square (no concave corners) and fatal on anything round: every
        // concave step broke the chain and no loop ever closed.
        case 13: emit(right, bottom); break;
        case 14: emit(left, bottom); break;
        case 5: { // saddle: split by the cell-centre value
          const c = (tl + tr + br + bl) / 4;
          if (c >= level) { emit(left, top); emit(right, bottom); }
          else { emit(left, bottom); emit(right, top); }
          break;
        }
        case 10: {
          const c = (tl + tr + br + bl) / 4;
          if (c >= level) { emit(bottom, right); emit(top, left); }
          else { emit(top, right); emit(bottom, left); }
          break;
        }
      }
    }
  }
  // Stitch, UNDIRECTED. Hand-writing sixteen consistently-oriented cases is a
  // classic way to ship a contour tracer that finds zero loops (the first
  // version of this function did exactly that), so no orientation is assumed:
  // both endpoints of every segment are indexed, and the walk flips each
  // segment to whatever direction continues the chain.
  const Q = 64;
  const keyOf = (p) => Math.round(p[0] * Q) + ',' + Math.round(p[1] * Q);
  const byEnd = new Map();
  const link = (k, si) => {
    if (!byEnd.has(k)) byEnd.set(k, []);
    byEnd.get(k).push(si);
  };
  segs.forEach((s, i) => {
    link(keyOf(s[0]), i);
    link(keyOf(s[1]), i);
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let start = 0; start < segs.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const loop = [segs[start][0], segs[start][1]];
    const homeKey = keyOf(loop[0]);
    let closed = false;
    for (let guard = 0; guard < segs.length + 2; guard++) {
      const tipKey = keyOf(loop[loop.length - 1]);
      if (tipKey === homeKey && loop.length > 3) { closed = true; break; }
      const cands = byEnd.get(tipKey) ?? [];
      let advanced = false;
      for (const si of cands) {
        if (used[si]) continue;
        const [a, b] = segs[si];
        used[si] = 1;
        loop.push(keyOf(a) === tipKey ? b : a);
        advanced = true;
        break;
      }
      if (!advanced) break;
    }
    if (closed) {
      loop.pop(); // the repeated home point
      loops.push(loop);
    }
  }
  return loops;
}

/**
 * Separable 1-2-1 blur over the field, `iters` times. Without it, a LONE tile
 * marches into a four-pointed star: the bilinear peak of a single centre has
 * concave sides at the 0.5 level, so every isolated pot bunker on a links hole
 * came out as a diamond. One pass rounds the peak into the circle the eye
 * expects, at the cost of pulling tight convex corners in by a fraction of a
 * sample — which reads as more organic, not less accurate.
 */
export function blurField(field, iters = 1) {
  const { f, gw, gh } = field;
  const tmp = new Float32Array(f.length);
  for (let k = 0; k < iters; k++) {
    // zero-padded, NOT clamped: clamping lets a shape that touches the board
    // edge hold its border samples above the iso level, and a contour that
    // cannot get outside the sample grid cannot close — the whole loop
    // silently vanished. The world beyond the board is empty; the blur should
    // say so.
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const l = i > 0 ? f[j * gw + i - 1] : 0;
        const r = i < gw - 1 ? f[j * gw + i + 1] : 0;
        tmp[j * gw + i] = (l + 2 * f[j * gw + i] + r) / 4;
      }
    }
    for (let i = 0; i < gw; i++) {
      for (let j = 0; j < gh; j++) {
        const u = j > 0 ? tmp[(j - 1) * gw + i] : 0;
        const d = j < gh - 1 ? tmp[(j + 1) * gw + i] : 0;
        f[j * gw + i] = (u + 2 * tmp[j * gw + i] + d) / 4;
      }
    }
  }
  return field;
}

/** Chaikin corner cutting on a closed loop, `iters` times. */
export function chaikin(loop, iters = 2) {
  let pts = loop;
  for (let k = 0; k < iters; k++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  return pts;
}

/**
 * Radial rounding for SMALL loops. A five-tile plus-clump — the classic
 * `overlayDisc` pot-bunker stamp — marches, correctly, into a four-pointed
 * star: the mask really is a plus. Correct and ugly. Blur converges on it far
 * too slowly (the lobes are a full tile long), so small features get rounded
 * at the polygon instead: express the loop as radius-of-centroid samples and
 * moving-average the radius over a ±18% window. A star's lobes and notches
 * cancel into a pot; anything big enough to have real coastline never comes
 * through here. The deviation is under half a tile — the same honesty budget
 * the wobble already spends.
 */
export function roundSmallLoop(loop, strength = 0.75) {
  const n = loop.length;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of loop) { cx += x; cy += y; }
  cx /= n; cy /= n;
  const rs = loop.map(([x, y]) => Math.hypot(x - cx, y - cy));
  const win = Math.max(2, Math.round(n * 0.18));
  const out = [];
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -win; k <= win; k++) acc += rs[(i + k + n) % n];
    const r = rs[i] * (1 - strength) + (acc / (2 * win + 1)) * strength;
    const a = Math.atan2(loop[i][1] - cy, loop[i][0] - cx);
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/** Signed area of a loop in its own units — negative for holes (winding). */
export function loopArea(loop) {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/**
 * The one call the painter makes: smooth world-pixel loops for a terrain
 * predicate. `grow` is in world pixels, exactly like blob()'s was, so call
 * sites translate one-for-one. Loops smaller than `minArea` (in tiles²) are
 * culled — a lone half-tile speck of contour is noise, not a feature.
 */
export function terrainLoops(course, match, {
  grow = 0, res = CONTOUR_RES, seed = course.seed, name = 'ground',
  wobble = WOBBLE, smooth = 2, minArea = 0.16, tilePx = 24, blur = 1,
} = {}) {
  const field = maskField(course, match, res);
  if (blur > 0) blurField(field, blur);
  if (wobble > 0) addWobble(field, seed, name, wobble);
  const level = 0.5 - grow / tilePx;
  const raw = marchLoops(field, Math.max(0.04, Math.min(0.96, level)));
  const px = tilePx / res;
  const out = [];
  for (const loop of raw) {
    const areaTiles = Math.abs(loopArea(loop)) / (res * res);
    if (areaTiles < minArea) continue;
    // graduated: a 5-tile pot rounds hard, a 13-tile pond keeps a hint of its
    // corners, real coastline (18+ tiles) is left entirely alone
    const strength = Math.min(0.8, Math.max(0, (18 - areaTiles) / 18));
    const shaped = strength > 0.05 ? roundSmallLoop(loop, strength) : loop;
    // sample (i,j) sits at world ((i/res)·TILE, (j/res)·TILE): sample 0 is the
    // corner of tile (0,0), because tile centres live at index i/res − 0.5
    out.push(chaikin(shaped, smooth).map(([x, y]) => [x * px, y * px]));
  }
  return out;
}
