// The art pass. Terrain renders as organic blob-merged shapes with mowing
// stripes, canopy clusters, and soft shadows — built once per hole into an
// offscreen canvas so the pretty version is free at frame time.
//
// There are TWO art layers. renderCourseArt() is the whole-board painting the
// game has always used, drawn at 1 world pixel per tile-pixel. renderGreenArt()
// is the green complex — the same ground, repainted at GREEN_SUB× resolution
// for the putting camera, with mowing at putting pitch, a collar, shaded relief
// and fall lines derived from the slope tiles, the cup at CUP_R, and a feet
// grid. It covers only the green's own silhouette, so it drops onto the course
// art with no rectangular seam and the course view never sees it.

import { FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN, ICE, slopeDir } from '../engine/terrain.js';
import { cellAt, inBounds } from '../engine/course.js';
import { CUP_R } from '../engine/dispersion.js';

export const TILE = 24;

const INK = {
  roughBase: '#48793f',
  roughDark: '#3f6c38',
  fairway: '#71b45e',
  fairwayStripe: '#7cc067',
  green: '#8fd47f',
  greenStripe: '#9bdd8b',
  fringe: '#7fc76e',
  sand: '#e6d097',
  sandShade: '#cdb379',
  water: '#4f93d6',
  waterDeep: '#3d7fc0',
  canopy: '#2f5a35',
  canopyLight: '#3c6d40',
  canopyDark: '#234427',
  ice: '#c9e9f2',
  slope: '#97b26e',
};

/** Rounded, slightly-enlarged cell rect — overlapping same-color blobs merge
 *  into organic shapes instead of a tile grid. */
function blob(ctx, x, y, grow = 3, r = 7) {
  ctx.roundRect(x * TILE - grow, y * TILE - grow, TILE + grow * 2, TILE + grow * 2, r);
}

function layer(ctx, course, match, fill, { grow = 3, shadow = null } = {}) {
  ctx.save();
  if (shadow) {
    ctx.shadowColor = shadow;
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
  }
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      if (match(cellAt(course, x, y))) blob(ctx, x, y, grow);
    }
  }
  ctx.fill();
  ctx.restore();
}

/** Diagonal mowing stripes clipped to a terrain type. */
function stripes(ctx, course, match, color, band) {
  ctx.save();
  ctx.beginPath();
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      if (match(cellAt(course, x, y))) blob(ctx, x, y, 2);
    }
  }
  ctx.clip();
  ctx.fillStyle = color;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  for (let d = -h; d < w + h; d += band * 2) {
    ctx.beginPath();
    ctx.moveTo(d, 0);
    ctx.lineTo(d + band, 0);
    ctx.lineTo(d + band - h, h);
    ctx.lineTo(d - h, h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Build the full course art once. Returns an offscreen canvas. */
export function renderCourseArt(course) {
  const off = document.createElement('canvas');
  off.width = course.width * TILE;
  off.height = course.height * TILE;
  const ctx = off.getContext('2d');

  // ground: rough with a coarse mottle so big areas don't read flat
  ctx.fillStyle = INK.roughBase;
  ctx.fillRect(0, 0, off.width, off.height);
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      if (cellAt(course, x, y) === ROUGH && (x * 7 + y * 13) % 5 === 0) {
        ctx.fillStyle = INK.roughDark;
        ctx.beginPath();
        ctx.arc((x + 0.5) * TILE, (y + 0.5) * TILE, TILE * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const is = (t) => (v) => v === t;
  // fringe halo under fairway+green ties the mown shapes together
  layer(ctx, course, (t) => t === FAIRWAY || t === GREEN, INK.fringe, { grow: 5 });
  layer(ctx, course, is(FAIRWAY), INK.fairway, { grow: 3 });
  stripes(ctx, course, is(FAIRWAY), 'rgba(255,255,255,0.07)', 34);
  layer(ctx, course, is(SAND), INK.sand, { grow: 2, shadow: 'rgba(60,40,10,0.45)' });
  // bunker lips: a darker inner rim
  layer(ctx, course, is(SAND), INK.sandShade, { grow: -4 });
  layer(ctx, course, is(SAND), INK.sand, { grow: -6 });
  layer(ctx, course, is(WATER), INK.waterDeep, { grow: 2, shadow: 'rgba(10,30,60,0.5)' });
  layer(ctx, course, is(WATER), INK.water, { grow: -3 });
  // ripple glints
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      if (cellAt(course, x, y) === WATER && (x * 5 + y * 11) % 4 === 0) {
        const cx = (x + 0.3) * TILE;
        const cy = (y + 0.5) * TILE + ((x * 3 + y) % 3) * 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo(cx + 6, cy - 3, cx + 12, cy);
        ctx.stroke();
      }
    }
  }
  layer(ctx, course, is(ICE), INK.ice, { grow: 2, shadow: 'rgba(120,180,200,0.4)' });
  layer(ctx, course, is(GREEN), INK.green, { grow: 3, shadow: 'rgba(20,60,20,0.45)' });
  stripes(ctx, course, is(GREEN), 'rgba(255,255,255,0.09)', 16);
  layer(ctx, course, (t) => !!slopeDir(t), INK.slope, { grow: 1 });
  // slope arrows
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      const dir = slopeDir(cellAt(course, x, y));
      if (!dir) continue;
      const cx = (x + 0.5) * TILE;
      const cy = (y + 0.5) * TILE;
      const a = Math.atan2(dir.y, dir.x);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7);
      ctx.lineTo(cx + Math.cos(a + 2.5) * 6, cy + Math.sin(a + 2.5) * 6);
      ctx.lineTo(cx + Math.cos(a - 2.5) * 6, cy + Math.sin(a - 2.5) * 6);
      ctx.closePath();
      ctx.fill();
    }
  }

  // tree canopies: clustered discs with seeded jitter, shadow, and highlight
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      if (cellAt(course, x, y) !== TREES) continue;
      const j = ((x * 2654435761 + y * 40503) >>> 16) % 7;
      const cx = (x + 0.5) * TILE + (j % 3) - 1;
      const cy = (y + 0.5) * TILE + (j % 2) * 2 - 1;
      const r = TILE * (0.52 + (j % 4) * 0.045);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = INK.canopy;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.fillStyle = INK.canopyLight;
      ctx.beginPath(); ctx.arc(cx - r * 0.25, cy - r * 0.3, r * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = INK.canopyDark;
      ctx.beginPath(); ctx.arc(cx + r * 0.3, cy + r * 0.32, r * 0.4, 0, Math.PI * 2); ctx.fill();
    }
  }

  // vignette: the property fades into the treeline
  const vg = ctx.createRadialGradient(
    off.width / 2, off.height / 2, Math.min(off.width, off.height) * 0.45,
    off.width / 2, off.height / 2, Math.max(off.width, off.height) * 0.72
  );
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(8,20,12,0.35)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, off.width, off.height);

  return off;
}

// --- the green complex ------------------------------------------------------
// Everything below is the putting-camera art. It is built once per hole into
// its own offscreen canvas at GREEN_SUB world-subpixels, then drawn under the
// world transform so it scales cleanly with the camera instead of magnifying
// course-zoom pixels.

/** Detail canvas pixels per world pixel. 4 keeps a 3–6× camera oversampled. */
export const GREEN_SUB = 4;

/** World pixels of ground kept around the green bbox: the collar plus slack for
 *  the blob grow, so the whole silhouette lands inside the detail canvas. */
const GREEN_MARGIN = 2 * TILE;

const GREEN_GROW = 3; // matches renderCourseArt's GREEN layer exactly
const COLLAR_GROW = 9; // the collar reaches 6 world px past the putting surface
const LIP = 2; // world pixels of darker rim on each silhouette's outline

const GINK = {
  surface: '#8fd47f', // the same base the course art uses — no colour pop
  surfaceRim: '#7cc16c',
  mowLight: 'rgba(255,255,255,0.055)',
  mowDark: 'rgba(18,58,24,0.045)',
  collar: '#75bd63',
  collarMow: 'rgba(255,255,255,0.06)',
  collarRim: '#5f9a4f',
};

/** The mowing pitch on the green: a third of a tile, so a putt crosses several
 *  bands. The collar is cut shorter and mown across the grain. */
const MOW_BAND = TILE / 3;
const COLLAR_BAND = TILE / 6;
const MOW_ANGLE = -0.42; // radians; the collar runs perpendicular to this

const FT_PER_TILE = 48; // yards.js: 1 tile = 16 yds
const FEET_RINGS = [10, 20, 40, 80];

/** Downhill light: the sun sits upper-left, so a face that leans up-left is lit
 *  and one that falls away to the lower-right is in shade. */
const LIGHT = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };

/** Slope pull at a tile, mirroring dispersion.js's slopePull weights so the
 *  picture and the physics are reading the SAME field: the tile underfoot at
 *  full weight plus its four neighbours at 0.35. Engine code is untouched —
 *  this is the art's own copy of the contract, and greenreading.test.js pins
 *  the engine side of it. */
function slopePullAt(course, x, y) {
  let px = 0;
  let py = 0;
  const add = (tx, ty, w) => {
    if (!inBounds(course, tx, ty)) return;
    const d = slopeDir(cellAt(course, tx, ty));
    if (d) { px += d.x * w; py += d.y * w; }
  };
  add(x, y, 1);
  add(x + 1, y, 0.35);
  add(x - 1, y, 0.35);
  add(x, y + 1, 0.35);
  add(x, y - 1, 0.35);
  return { x: px, y: py };
}

/**
 * A CONTINUOUS slope field over a tile window: the per-tile pull, softened by
 * one separable binomial pass and read back with bilinear interpolation. That
 * is what turns four blocky slope codes into something a green reader can use —
 * the field varies smoothly across a tile instead of stepping at its border.
 * A course with no slope tiles produces exact zeros, so classic greens get no
 * relief and no fall lines at all, by arithmetic rather than by a special case.
 */
const BLUR_PASSES = 2;
// N passes of [1,2,1]/4 compose into the binomial of order 2N, whose centre tap
// is C(2N,N)/4^N per axis — 6/16 for two passes — and that squared in 2D. A
// single neighbouring slope tile pulls 0.35, so this is the softest real lean
// the blurred field can carry: the floor below which the display gain is NOT
// allowed to amplify, which is what keeps a barely-touched green calm.
const BLUR_CENTRE = (() => {
  let c = 1;
  for (let k = 1; k <= BLUR_PASSES; k++) c = (c * (BLUR_PASSES + k)) / k; // C(2N,N)
  return c / 4 ** BLUR_PASSES;
})();
const SOFTEST_LEAN = 0.35 * BLUR_CENTRE ** 2;

function buildSlopeField(course, t0x, t0y, tw, th) {
  const gx = new Float32Array(tw * th);
  const gy = new Float32Array(tw * th);
  let raw = 0;
  for (let j = 0; j < th; j++) {
    for (let i = 0; i < tw; i++) {
      const p = slopePullAt(course, t0x + i, t0y + j);
      gx[j * tw + i] = p.x;
      gy[j * tw + i] = p.y;
      raw = Math.max(raw, Math.abs(p.x), Math.abs(p.y));
    }
  }
  if (raw > 0) {
    const clamp = (v, hi) => Math.min(hi, Math.max(0, v));
    for (const buf of [gx, gy]) {
      const tmp = new Float32Array(buf.length);
      for (let pass = 0; pass < BLUR_PASSES; pass++) {
        for (let j = 0; j < th; j++) {
          for (let i = 0; i < tw; i++) {
            tmp[j * tw + i] = (buf[j * tw + clamp(i - 1, tw - 1)]
              + 2 * buf[j * tw + i] + buf[j * tw + clamp(i + 1, tw - 1)]) / 4;
          }
        }
        for (let j = 0; j < th; j++) {
          for (let i = 0; i < tw; i++) {
            buf[j * tw + i] = (tmp[clamp(j - 1, th - 1) * tw + i]
              + 2 * tmp[j * tw + i] + tmp[clamp(j + 1, th - 1) * tw + i]) / 4;
          }
        }
      }
    }
  }
  // how hard THIS green actually leans, measured on the putting surface only —
  // the surround's slope strips set the field but never the display contrast
  let peak = 0;
  for (let j = 0; j < th; j++) {
    for (let i = 0; i < tw; i++) {
      const x = t0x + i;
      const y = t0y + j;
      if (!inBounds(course, x, y) || cellAt(course, x, y) !== GREEN) continue;
      peak = Math.max(peak, Math.hypot(gx[j * tw + i], gy[j * tw + i]));
    }
  }
  // full contrast for the steepest reading on this green, but never more gain
  // than the softest real lean earns: a green barely touched by slope draws a
  // barely-there picture, and a flat one draws nothing at all.
  const gain = peak > 0 ? 1 / Math.max(peak, SOFTEST_LEAN) : 0;
  return { gx, gy, tw, th, t0x, t0y, peak, gain, flat: peak <= 1e-6 };
}

/** Bilinear read of the slope field at a fractional TILE coordinate. */
function sampleSlope(f, x, y) {
  const u = Math.min(f.tw - 1.001, Math.max(0, x - f.t0x));
  const v = Math.min(f.th - 1.001, Math.max(0, y - f.t0y));
  const i = Math.floor(u);
  const j = Math.floor(v);
  const a = u - i;
  const b = v - j;
  const k = j * f.tw + i;
  const lerp2 = (buf) =>
    (buf[k] * (1 - a) + buf[k + 1] * a) * (1 - b)
    + (buf[k + f.tw] * (1 - a) + buf[k + f.tw + 1] * a) * b;
  return { x: lerp2(f.gx), y: lerp2(f.gy) };
}

/** The green's blob silhouette, grown by `grow` world pixels — the same shape
 *  language renderCourseArt uses, so the two layers register exactly. */
function greenSilhouette(path, course, grow, r) {
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      if (cellAt(course, x, y) !== GREEN) continue;
      path.roundRect(x * TILE - grow, y * TILE - grow, TILE + grow * 2, TILE + grow * 2, r);
    }
  }
}

/** Parallel mowing bands across a world-pixel box, at an angle. */
function mowBands(ctx, box, angle, band, colors) {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const R = Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2 + band * 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  const n = Math.ceil(R / band) + 1;
  for (let i = -n; i <= n; i++) {
    const c = colors[((i % colors.length) + colors.length) % colors.length];
    if (!c) continue;
    ctx.fillStyle = c;
    ctx.fillRect(i * band, -R, band, R * 2);
  }
  ctx.restore();
}

/** A seeded fine-grain noise tile, used as a repeating pattern so the turf has
 *  texture at putting scale without thousands of draw calls. */
function grainTile(seed, size = 64) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  let s = (seed >>> 0) || 1;
  for (let i = 0; i < size * size; i++) {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    const light = (s & 1) === 0;
    const o = i * 4;
    img.data[o] = light ? 255 : 24;
    img.data[o + 1] = light ? 255 : 60;
    img.data[o + 2] = light ? 255 : 28;
    img.data[o + 3] = 6 + ((s >>> 24) % 14);
  }
  g.putImageData(img, 0, 0);
  return c;
}

function paintGrain(ctx, path, tile, alpha) {
  const pat = ctx.createPattern(tile, 'repeat');
  if (!pat) return;
  try {
    // one noise texel per DETAIL pixel, not per world pixel — real grain
    pat.setTransform(new DOMMatrix().scale(1 / GREEN_SUB));
  } catch { /* older engines: coarser grain, still fine */ }
  ctx.save();
  ctx.clip(path);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pat;
  ctx.fill(path);
  ctx.restore();
}

/**
 * Shaded relief for the green: a small Lambert buffer over the slope field,
 * upscaled with smoothing and composited in `overlay`, so a mid-grey sample is
 * a no-op and only real gradient lightens or darkens the turf. Flat greens
 * produce a uniform mid-grey buffer and therefore no visible change at all.
 */
function paintRelief(ctx, field, box, path, gain) {
  const RES = 12; // relief samples per tile
  const w = Math.max(2, Math.ceil((box.x1 - box.x0) / TILE * RES));
  const h = Math.max(2, Math.ceil((box.y1 - box.y0) / TILE * RES));
  const buf = document.createElement('canvas');
  buf.width = w;
  buf.height = h;
  const bctx = buf.getContext('2d');
  const img = bctx.createImageData(w, h);
  for (let j = 0; j < h; j++) {
    const ty = (box.y0 + ((j + 0.5) / h) * (box.y1 - box.y0)) / TILE - 0.5;
    for (let i = 0; i < w; i++) {
      const tx = (box.x0 + ((i + 0.5) / w) * (box.x1 - box.x0)) / TILE - 0.5;
      const d = sampleSlope(field, tx, ty);
      // n ∝ (downhill.x, downhill.y, 1): a face falling toward the light leans
      // into it and lights up; one falling away goes to shade.
      const lambert = (d.x * LIGHT.x + d.y * LIGHT.y) * gain;
      const v = Math.max(-1, Math.min(1, lambert));
      const o = (j * w + i) * 4;
      const grey = Math.round(128 + 104 * v);
      img.data[o] = grey;
      img.data[o + 1] = grey;
      img.data[o + 2] = grey;
      img.data[o + 3] = 255;
    }
  }
  bctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.clip(path);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.62;
  ctx.drawImage(buf, box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
  ctx.restore();
}

/**
 * Fall lines: short downhill streamlines on a staggered grid, integrated
 * through the smooth field so each one actually traces where a ball would be
 * pulled. Alpha and length track the local gradient, so a green with one
 * sloping shoulder shows that shoulder and nothing else.
 */
function paintFallLines(ctx, course, field, box, path, gain) {
  // seeds spaced wider than a streamline is long, so the lines read as separate
  // fall-line ticks instead of merging into one continuous contour
  const STEP = 0.78; // tiles between streamline seeds
  const LEN = 5; // integration steps
  const DL = 0.075; // tiles per step
  ctx.save();
  ctx.clip(path);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const t0x = box.x0 / TILE - 0.5;
  const t1x = box.x1 / TILE - 0.5;
  const t0y = box.y0 / TILE - 0.5;
  const t1y = box.y1 / TILE - 0.5;
  let row = 0;
  for (let ty = t0y; ty <= t1y; ty += STEP, row++) {
    for (let tx = t0x + (row % 2) * STEP * 0.5; tx <= t1x; tx += STEP) {
      if (!inBounds(course, Math.round(tx), Math.round(ty))) continue;
      if (cellAt(course, Math.round(tx), Math.round(ty)) !== GREEN) continue;
      const d0 = sampleSlope(field, tx, ty);
      const m = Math.hypot(d0.x, d0.y) * gain;
      if (m < 0.12) continue;
      const strength = Math.min(1, m);
      const pts = [{ x: tx, y: ty }];
      let p = { x: tx, y: ty };
      for (let k = 0; k < LEN; k++) {
        const d = sampleSlope(field, p.x, p.y);
        const len = Math.hypot(d.x, d.y);
        if (len < 1e-6) break;
        p = { x: p.x + (d.x / len) * DL, y: p.y + (d.y / len) * DL };
        pts.push(p);
      }
      if (pts.length < 3) continue;
      const wpx = (q) => ({ x: (q.x + 0.5) * TILE, y: (q.y + 0.5) * TILE });
      const stroke = (color, width, dx, dy) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        pts.forEach((q, i) => {
          const s = wpx(q);
          if (i === 0) ctx.moveTo(s.x + dx, s.y + dy);
          else ctx.lineTo(s.x + dx, s.y + dy);
        });
        ctx.stroke();
      };
      // a dark line with a light one riding just above it reads on both the
      // lit and the shaded side of the relief
      stroke(`rgba(18,48,24,${(0.42 * strength).toFixed(3)})`, 1.25, 0.35, 0.45);
      stroke(`rgba(244,255,240,${(0.40 * strength).toFixed(3)})`, 1, -0.2, -0.25);
      // arrowhead at the downhill end
      const a = wpx(pts[pts.length - 1]);
      const b = wpx(pts[pts.length - 2]);
      const ang = Math.atan2(a.y - b.y, a.x - b.x);
      const hs = 2.2;
      ctx.fillStyle = `rgba(244,255,240,${(0.46 * strength).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(a.x + Math.cos(ang + 2.5) * hs, a.y + Math.sin(ang + 2.5) * hs);
      ctx.lineTo(a.x + Math.cos(ang - 2.5) * hs, a.y + Math.sin(ang - 2.5) * hs);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Faint concentric feet rings around the cup — a distance ruler you read
 *  without looking at it. Deliberately near the noise floor so the aim pattern
 *  always wins the contrast fight. */
function paintFeetGrid(ctx, cup, path) {
  const cx = (cup.x + 0.5) * TILE;
  const cy = (cup.y + 0.5) * TILE;
  ctx.save();
  ctx.clip(path);
  ctx.setLineDash([3, 3.5]);
  for (const ft of FEET_RINGS) {
    const r = (ft / FT_PER_TILE) * TILE;
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = 'rgba(12,44,20,0.14)';
    ctx.beginPath(); ctx.arc(cx, cy + 0.4, r, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '600 3.2px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.17)';
    ctx.fillText(`${ft}′`, cx, cy - r - 1.2);
    ctx.setLineDash([3, 3.5]);
  }
  ctx.setLineDash([]);
  ctx.restore();
}

/** The cup, at the engine's own CUP_R: a cut hole with a shadowed inner rim and
 *  a lit near wall, plus the small hole-location tick the crew leaves behind. */
function paintCup(ctx, cup) {
  const cx = (cup.x + 0.5) * TILE;
  const cy = (cup.y + 0.5) * TILE;
  const r = CUP_R * TILE; // world pixels — the same radius the roll is judged against
  // trodden ring around the hole
  const halo = ctx.createRadialGradient(cx, cy, r, cx, cy, r * 4.5);
  halo.addColorStop(0, 'rgba(60,110,55,0.34)');
  halo.addColorStop(1, 'rgba(60,110,55,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(cx, cy, r * 4.5, 0, Math.PI * 2); ctx.fill();
  // the cut: liner rim, then the dark of the hole
  ctx.fillStyle = '#dfe8d6';
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0b1710';
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.22, 0, Math.PI * 2); ctx.fill();
  // inside the hole: the far (upper-left) wall is in shadow, the near wall lit
  const inner = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  inner.addColorStop(0, 'rgba(0,0,0,0.85)');
  inner.addColorStop(1, 'rgba(120,150,120,0.45)');
  ctx.fillStyle = inner;
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.05, 0, Math.PI * 2); ctx.fill();
  // hole-location marker: the little painted tick beside the cup
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(cx + r * 3.4, cy);
  ctx.lineTo(cx + r * 5.2, cy);
  ctx.moveTo(cx + r * 4.3, cy - r * 0.9);
  ctx.lineTo(cx + r * 4.3, cy + r * 0.9);
  ctx.stroke();
}

/**
 * Build the green complex once per hole.
 * @param {import('../engine/course.js').Course} course
 * @param {{x0:number,y0:number,x1:number,y1:number}} rect green bbox, tiles
 * @returns {{canvas: HTMLCanvasElement, ox:number, oy:number, w:number, h:number,
 *            sub:number, sloped:boolean, ms:number}} the layer plus its world-pixel
 *   placement — draw it with ctx.drawImage(canvas, ox, oy, w, h) under the world
 *   transform and it lands exactly on the course art it replaces.
 */
export function renderGreenArt(course, rect) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const ox = Math.max(0, rect.x0 * TILE - GREEN_MARGIN);
  const oy = Math.max(0, rect.y0 * TILE - GREEN_MARGIN);
  const ex = Math.min(course.width * TILE, (rect.x1 + 1) * TILE + GREEN_MARGIN);
  const ey = Math.min(course.height * TILE, (rect.y1 + 1) * TILE + GREEN_MARGIN);
  const w = Math.max(TILE, ex - ox);
  const h = Math.max(TILE, ey - oy);
  const sub = GREEN_SUB;

  const off = document.createElement('canvas');
  off.width = Math.round(w * sub);
  off.height = Math.round(h * sub);
  const ctx = off.getContext('2d');
  // draw in WORLD pixels; the transform carries the oversampling
  ctx.setTransform(sub, 0, 0, sub, -ox * sub, -oy * sub);
  const box = { x0: ox, y0: oy, x1: ex, y1: ey };

  // Silhouettes. Each cut is a UNION of grown tile blobs, so its rim has to be
  // painted as the difference between two unions — stroking the path itself
  // would outline every tile inside the shape, not the shape.
  const shape = (grow, r) => {
    const p = new Path2D();
    greenSilhouette(p, course, grow, r);
    return p;
  };
  const collarLip = shape(COLLAR_GROW, 13);
  const collar = shape(COLLAR_GROW - LIP, 13 - LIP);
  const surfaceLip = shape(GREEN_GROW, 7);
  const surface = shape(GREEN_GROW - LIP * 0.8, 7 - LIP * 0.8);

  // --- collar / fringe: a shorter, cross-mown ring so the boundary reads -----
  ctx.fillStyle = GINK.collarRim;
  ctx.fill(collarLip);
  ctx.save();
  ctx.clip(collar);
  ctx.fillStyle = GINK.collar;
  ctx.fillRect(ox, oy, w, h);
  mowBands(ctx, box, MOW_ANGLE + Math.PI / 2, COLLAR_BAND, [GINK.collarMow, null]);
  ctx.restore();

  // --- the putting surface: fine mowing at a third of a tile ---------------
  ctx.fillStyle = GINK.surfaceRim;
  ctx.fill(surfaceLip);
  ctx.save();
  ctx.clip(surface);
  ctx.fillStyle = GINK.surface;
  ctx.fillRect(ox, oy, w, h);
  mowBands(ctx, box, MOW_ANGLE, MOW_BAND, [GINK.mowLight, GINK.mowDark]);
  ctx.restore();

  // --- grain -----------------------------------------------------------------
  const noise = grainTile((course.seed ^ 0x9e3779b9) >>> 0);
  paintGrain(ctx, collarLip, noise, 0.55);
  paintGrain(ctx, surfaceLip, noise, 1);

  // --- slope reading ---------------------------------------------------------
  const t0x = Math.floor(ox / TILE) - 2;
  const t0y = Math.floor(oy / TILE) - 2;
  const tw = Math.ceil(w / TILE) + 5;
  const th = Math.ceil(h / TILE) + 5;
  const field = buildSlopeField(course, t0x, t0y, tw, th);
  if (!field.flat) {
    paintRelief(ctx, field, box, surfaceLip, field.gain);
    paintFallLines(ctx, course, field, box, surfaceLip, field.gain);
  }

  // --- the ruler and the hole -----------------------------------------------
  paintFeetGrid(ctx, course.hole, collarLip);
  paintCup(ctx, course.hole);

  const ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return { canvas: off, ox, oy, w, h, sub, sloped: !field.flat, ms };
}

/**
 * The pin at green scale: sized in WORLD units so it grows with the camera,
 * with a ground shadow that lies away from the light. `k` is camera.scale and
 * `sun` the SCREEN direction the shadow falls in (world lower-right, rotated
 * with the map), so the flag agrees with the relief baked into the turf.
 */
export function drawPin(ctx, px, k, sun = { x: Math.SQRT1_2, y: Math.SQRT1_2 }) {
  const H = 9 * k; // world pixels of flagstick, in screen pixels
  const hx = px.x;
  const hy = px.y;
  ctx.save();
  // the stick's shadow, laid on the turf away from the sun and softened
  ctx.strokeStyle = 'rgba(16,44,20,0.34)';
  ctx.lineWidth = Math.max(1, 0.5 * k);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx + sun.x * H * 0.95, hy + sun.y * H * 0.95);
  ctx.stroke();
  // flag shadow: a soft blot at the far end
  ctx.fillStyle = 'rgba(16,44,20,0.22)';
  ctx.beginPath();
  ctx.ellipse(hx + sun.x * H * 0.92, hy + sun.y * H * 0.92, 2.4 * k, 1.3 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  // stick: a lit face and a shaded one, so it holds against pale turf
  ctx.strokeStyle = 'rgba(24,44,28,0.55)';
  ctx.lineWidth = Math.max(1.6, 0.82 * k);
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx, hy - H);
  ctx.stroke();
  ctx.strokeStyle = '#f6f6f2';
  ctx.lineWidth = Math.max(1, 0.5 * k);
  ctx.beginPath();
  ctx.moveTo(hx - 0.08 * k, hy);
  ctx.lineTo(hx - 0.08 * k, hy - H);
  ctx.stroke();
  // flag
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.moveTo(hx, hy - H);
  ctx.quadraticCurveTo(hx + 3.4 * k, hy - H + 0.7 * k, hx + 5.6 * k, hy - H + 2.4 * k);
  ctx.quadraticCurveTo(hx + 3 * k, hy - H + 3.4 * k, hx, hy - H + 4.6 * k);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.beginPath();
  ctx.moveTo(hx, hy - H + 2.6 * k);
  ctx.quadraticCurveTo(hx + 2.6 * k, hy - H + 2.8 * k, hx + 4.4 * k, hy - H + 3.2 * k);
  ctx.quadraticCurveTo(hx + 2.4 * k, hy - H + 3.9 * k, hx, hy - H + 4.6 * k);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Ball radius in WORLD pixels on the green. A ball is a fraction of the cup,
 *  not a fixed sprite — at putting zoom that ratio is the thing that makes the
 *  green read as a green rather than a lawn. */
export const BALL_WORLD_R = CUP_R * TILE * 0.62;

/**
 * The ball at inch scale: sized in world units (via `k` = camera.scale) so it
 * grows with the zoom, floored so it never drops below a couple of pixels.
 * A faint sighting halo keeps something that small findable.
 */
export function drawBallWorld(ctx, px, k, { ghost = false, halo = true } = {}) {
  const r = Math.max(2.6, BALL_WORLD_R * k);
  const bx = px.x;
  const by = px.y;
  if (halo && !ghost) {
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = Math.max(0.7, r * 0.2);
    ctx.beginPath(); ctx.arc(bx, by, r * 3.2, 0, Math.PI * 2); ctx.stroke();
  }
  if (!ghost) {
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.beginPath();
    ctx.ellipse(bx + r * 0.45, by + r * 0.5, r * 1.05, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = ghost ? 'rgba(180,220,255,0.7)' : '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = Math.max(0.5, r * 0.16);
  ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (!ghost && r > 3) {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(bx - r * 0.32, by - r * 0.34, r * 0.3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.lineWidth = 1;
}

/** Flag sprite at a SCREEN-pixel anchor (stays upright under map rotation). */
export function drawFlag(ctx, px) {
  const hx = px.x;
  const hy = px.y;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(hx + 2, hy + 2, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#14231a';
  ctx.beginPath(); ctx.arc(hx, hy, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#f2f2f2';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, hy - 20); ctx.stroke();
  ctx.lineWidth = 1;
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.moveTo(hx, hy - 20);
  ctx.quadraticCurveTo(hx + 8, hy - 18, hx + 13, hy - 14);
  ctx.quadraticCurveTo(hx + 7, hy - 12, hx, hy - 9);
  ctx.closePath();
  ctx.fill();
}

/** Ball sprite at a SCREEN-pixel anchor. */
export function drawBall(ctx, px, { ghost = false } = {}) {
  const bx = px.x;
  const by = px.y;
  if (!ghost) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(bx + 2, by + 3, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = ghost ? 'rgba(180,220,255,0.7)' : '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (!ghost) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(bx - 2, by - 2, 1.8, 0, Math.PI * 2); ctx.fill();
  }
}

/**
 * Inline callout card anchored to a point on the map — the post-shot note.
 * @param {{title: string, tone: 'good'|'ok'|'bad', lines: string[]}} note
 */
export function drawCallout(ctx, anchorPx, note) {
  const TONES = { good: '#6fd08c', ok: '#ffd166', bad: '#e07070' };
  ctx.font = '600 13px system-ui';
  const titleW = ctx.measureText(note.title).width;
  ctx.font = '12px system-ui';
  const w = Math.max(titleW, ...note.lines.map((l) => ctx.measureText(l).width)) + 24;
  const h = 26 + note.lines.length * 17;
  const ax = anchorPx.x;
  const ay = anchorPx.y;
  // place above-right, flipping to stay on canvas
  let bx = ax + 16;
  let by = ay - h - 16;
  if (bx + w > ctx.canvas.width - 6) bx = ax - w - 16;
  if (by < 6) by = ay + 20;
  bx = Math.max(6, bx);

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = 'rgba(16, 30, 22, 0.94)';
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 9);
  ctx.fill();
  ctx.restore();
  // pointer stem
  ctx.strokeStyle = 'rgba(16, 30, 22, 0.94)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx < ax ? bx + w : bx, by + h - 8);
  ctx.stroke();
  ctx.lineWidth = 1;
  // accent bar + text
  ctx.fillStyle = TONES[note.tone];
  ctx.beginPath();
  ctx.roundRect(bx, by, 4, h, { tl: 9, bl: 9, tr: 0, br: 0 });
  ctx.fill();
  ctx.fillStyle = TONES[note.tone];
  ctx.font = '600 13px system-ui';
  ctx.fillText(note.title, bx + 12, by + 17);
  ctx.fillStyle = '#eaf5ec';
  ctx.font = '12px system-ui';
  note.lines.forEach((l, i) => ctx.fillText(l, bx + 12, by + 34 + i * 17));
}
