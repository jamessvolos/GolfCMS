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
import {
  CUP_R, DEFAULT_PROFILE, UNIT_OFFSETS, PUTT_OVERRUN,
  puttPoints, puttSigmas, puttHolesOut, puttBreakDrift, restingCell,
} from '../engine/dispersion.js';
import { puttsFrom, onPuttingSurface } from '../engine/strategy.js';
import { YARDS_PER_TILE } from '../engine/yards.js';

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
 * @param {{breaks?: 'lines'|'grid'|'none'}} [opts] how the slope reading is drawn
 *   INTO the base layer: 'lines' (default) is the sparse fall-line streamlines
 *   this layer has always drawn, 'grid' bakes the yardage-book arrow grid in,
 *   'none' leaves the turf clean for a separate renderBreakLayer() on top.
 * @returns {{canvas: HTMLCanvasElement, ox:number, oy:number, w:number, h:number,
 *            sub:number, sloped:boolean, ms:number}} the layer plus its world-pixel
 *   placement — draw it with ctx.drawImage(canvas, ox, oy, w, h) under the world
 *   transform and it lands exactly on the course art it replaces.
 */
export function renderGreenArt(course, rect, { breaks = 'lines' } = {}) {
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
    if (breaks === 'lines') paintFallLines(ctx, course, field, box, surfaceLip, field.gain);
    else if (breaks === 'grid') paintBreakArrows(ctx, breakArrows(course, field, box), surfaceLip);
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

// ============================================================================
// THE YARDAGE BOOK
// ----------------------------------------------------------------------------
// A GolfLogix green page, in layers. Every layer below shares ONE geometry
// (greenBookGeometry) and one slope field (greenSlopeField), builds into its own
// offscreen canvas at GREEN_SUB× world resolution, and reports itself in the
// same {canvas, ox, oy, w, h, sub} shape renderGreenArt() returns — so the app
// stacks them with the identical
//
//     ctx.drawImage(layer.canvas, layer.ox, layer.oy, layer.w, layer.h)
//
// under the world transform, in this order:
//
//     base (renderGreenArt, breaks:'none')   the turf, collar, relief, cup
//     heat (renderHeatLayer 'slope'|'cost')  the coloured page, optional
//     contours (renderContourLayer)          isolines, running past the edge
//     breaks (renderBreakLayer)              the arrow grid — always on top
//     furniture (renderFurnitureLayer)       perimeter, 5-yard grid, hole no.
//
// renderGreenBook() does exactly that and caches per hole+profile+kind, so
// toggling a heat page rebuilds one layer and reuses the rest.
// ============================================================================

// --- units -------------------------------------------------------------------
// The slope field is measured in PULL units: 1.0 is a slope tile directly
// underfoot pulling at full weight (dispersion.js's slopePull contract). To put
// a legend on the page that reads in golfer's language we need one honest
// constant tying pull to grade. The engine's own break model fixes it: a roll
// crossing a full-strength pull drifts BREAK_RATE (0.12) tiles sideways per tile
// rolled, i.e. ~5.8 ft of break on a 48 ft putt — which on a real green is the
// break of a ~7% cross slope. So pull 1.0 == 7% grade, and the book's own 1–7%
// legend falls out of the physics rather than being decoration.
export const SLOPE_PCT_PER_PULL = 7;

/** Slope-field magnitude (pull units) → percent grade, the legend's language. */
export function slopePercent(pullMag) {
  return Math.abs(pullMag) * SLOPE_PCT_PER_PULL;
}

/** Percent grade → the rise in feet over `tiles` of run. */
export function riseFeet(pct, tiles = 1) {
  return (pct / 100) * FT_PER_TILE * tiles;
}

// --- the ramp ----------------------------------------------------------------
// One cool→hot ramp serves both heat pages: blue → teal → green → yellow →
// orange → red, kept a touch desaturated so arrows and contours drawn OVER it
// still win the contrast fight. Stops are spaced by perceived lightness, not by
// hue angle, so equal steps of severity look like equal steps of colour.
export const HEAT_STOPS = [
  { t: 0.00, rgb: [46, 96, 158] },   // cool blue — dead flat / tap-in
  { t: 0.22, rgb: [42, 148, 150] },  // teal
  { t: 0.45, rgb: [104, 166, 78] },  // green
  { t: 0.63, rgb: [214, 194, 72] },  // yellow
  { t: 0.81, rgb: [220, 132, 50] },  // orange
  { t: 1.00, rgb: [196, 58, 46] },   // red — severe
];

/** Ramp lookup. `t` is clamped to 0..1; returns an rgba() string. */
export function heatColor(t, alpha = 1) {
  const u = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  let a = HEAT_STOPS[0];
  let b = HEAT_STOPS[HEAT_STOPS.length - 1];
  for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
    if (u >= HEAT_STOPS[i].t && u <= HEAT_STOPS[i + 1].t) {
      a = HEAT_STOPS[i];
      b = HEAT_STOPS[i + 1];
      break;
    }
  }
  const span = b.t - a.t || 1;
  const k = (u - a.t) / span;
  const c = (i) => Math.round(a.rgb[i] + (b.rgb[i] - a.rgb[i]) * k);
  return `rgba(${c(0)},${c(1)},${c(2)},${alpha})`;
}

/**
 * Legend descriptors — everything a UI needs to draw the key beside the page:
 * the value range, its unit, the tick values, and a colour for any value.
 * @typedef {{kind:string,label:string,unit:string,min:number,max:number,
 *            ticks:number[],decimals:number,norm:(v:number)=>number,
 *            color:(v:number,alpha?:number)=>string}} Legend
 */
function makeLegend(kind, label, unit, min, max, ticks, decimals) {
  const norm = (v) => Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
  return { kind, label, unit, min, max, ticks, decimals, norm, color: (v, a = 1) => heatColor(norm(v), a) };
}

/** Slope severity page: percent grade, the book's own 1–7% band. */
export const SLOPE_LEGEND = makeLegend('slope', 'slope', '%', 0, 7, [1, 2, 3, 4, 5, 6, 7], 0);
/** Cost page: expected putts from a position — the thing the book can't print. */
export const COST_LEGEND = makeLegend('cost', 'expected putts', '', 1, 3, [1, 1.5, 2, 2.5, 3], 1);

/** @param {'slope'|'cost'} kind @returns {Legend} */
export function legendFor(kind) {
  return kind === 'cost' ? COST_LEGEND : SLOPE_LEGEND;
}

// --- shared geometry ---------------------------------------------------------

/**
 * The world-pixel window every book layer is built in — identical to the one
 * renderGreenArt() uses, so all layers register pixel-for-pixel.
 * @returns {{ox:number,oy:number,ex:number,ey:number,w:number,h:number,sub:number,
 *            box:{x0:number,y0:number,x1:number,y1:number}}}
 */
export function greenBookGeometry(course, rect, { margin = GREEN_MARGIN, sub = GREEN_SUB } = {}) {
  const ox = Math.max(0, rect.x0 * TILE - margin);
  const oy = Math.max(0, rect.y0 * TILE - margin);
  const ex = Math.min(course.width * TILE, (rect.x1 + 1) * TILE + margin);
  const ey = Math.min(course.height * TILE, (rect.y1 + 1) * TILE + margin);
  const w = Math.max(TILE, ex - ox);
  const h = Math.max(TILE, ey - oy);
  return { ox, oy, ex, ey, w, h, sub, box: { x0: ox, y0: oy, x1: ox + w, y1: oy + h } };
}

/** The smoothed slope field over a book geometry. Pure: no canvas involved, so
 *  callers (and tests) can read the green without painting it. */
export function greenSlopeField(course, geo) {
  const t0x = Math.floor(geo.ox / TILE) - 2;
  const t0y = Math.floor(geo.oy / TILE) - 2;
  const tw = Math.ceil(geo.w / TILE) + 5;
  const th = Math.ceil(geo.h / TILE) + 5;
  return buildSlopeField(course, t0x, t0y, tw, th);
}

/** Steepest grade anywhere on this green, in percent. */
export function fieldPeakPercent(field) {
  return field ? slopePercent(field.peak) : 0;
}

/** Bilinear slope read at a fractional tile coordinate, in percent grade. */
export function slopePercentAt(field, tx, ty) {
  const d = sampleSlope(field, tx, ty);
  return slopePercent(Math.hypot(d.x, d.y));
}

/** A fresh offscreen layer over `geo`, with the world-pixel transform applied. */
function bookCanvas(geo) {
  const off = document.createElement('canvas');
  off.width = Math.round(geo.w * geo.sub);
  off.height = Math.round(geo.h * geo.sub);
  const ctx = off.getContext('2d');
  ctx.setTransform(geo.sub, 0, 0, geo.sub, -geo.ox * geo.sub, -geo.oy * geo.sub);
  return { off, ctx };
}

function silhouette(course, grow, r) {
  const p = new Path2D();
  greenSilhouette(p, course, grow, r);
  return p;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function finishLayer(off, geo, kind, t0, extra = {}) {
  return { canvas: off, ox: geo.ox, oy: geo.oy, w: geo.w, h: geo.h, sub: geo.sub, kind, ms: now() - t0, ...extra };
}

// --- 1. the break arrow grid -------------------------------------------------
// The book prints one small arrow per yard over the whole surface. At 1 tile =
// 16 yards a true 1-yard lattice is 1.5 world px between arrows, which moirés
// against the mowing bands below 4× camera. Two yards (1/8 tile = 3 world px, so
// 9–18 screen px at the 3–6× putting zooms) is the densest lattice that still
// draws a readable head, and ODD ROWS ARE OFFSET half a step: a hex lattice has
// no axis-aligned rows to beat against the stripes.

export const ARROW_SPACING_TILES = 1 / 8; // 2 yards
/** Grades gentler than this are noise, not break: no arrow at all. */
export const ARROW_MIN_PCT = 0.3;

/**
 * The arrow grid as DATA — position, downhill unit vector, grade — with no
 * canvas anywhere. Flat greens return an empty array by arithmetic (the field
 * is exactly zero), which is how "no slope tiles ⇒ no arrows" stays exact.
 * @returns {{tx:number,ty:number,ax:number,ay:number,pct:number,t:number}[]}
 *   tx/ty are TILE coordinates (world px = (tx + 0.5) * TILE); `t` is the 0..1
 *   display severity used for size and alpha.
 */
export function breakArrows(course, field, box, { spacing = ARROW_SPACING_TILES, minPct = ARROW_MIN_PCT } = {}) {
  const out = [];
  if (!field || field.flat) return out;
  // Size/alpha are read against THIS green's own peak (floored at 2%, capped at
  // the legend's 7%) — the book's arrows are relative too. The absolute grade
  // travels along in `pct` for anything that wants the real number.
  const ref = Math.max(2, Math.min(SLOPE_LEGEND.max, fieldPeakPercent(field)));
  const t0x = box.x0 / TILE - 0.5;
  const t1x = box.x1 / TILE - 0.5;
  const t0y = box.y0 / TILE - 0.5;
  const t1y = box.y1 / TILE - 0.5;
  let row = 0;
  for (let ty = t0y; ty <= t1y; ty += spacing, row++) {
    for (let tx = t0x + (row % 2) * spacing * 0.5; tx <= t1x; tx += spacing) {
      const cx = Math.round(tx);
      const cy = Math.round(ty);
      if (!inBounds(course, cx, cy) || cellAt(course, cx, cy) !== GREEN) continue;
      const d = sampleSlope(field, tx, ty);
      const mag = Math.hypot(d.x, d.y);
      if (mag < 1e-9) continue;
      const pct = slopePercent(mag);
      if (pct < minPct) continue;
      out.push({ tx, ty, ax: d.x / mag, ay: d.y / mag, pct, t: Math.min(1, pct / ref) });
    }
  }
  return out;
}

/** Draw an arrow grid. Each arrow is a dark stroke with a light one riding just
 *  above it, so it reads on the lit and the shaded side of the relief and over
 *  any heat colour. */
function paintBreakArrows(ctx, arrows, clipPath, { scale = 1 } = {}) {
  if (!arrows.length) return;
  ctx.save();
  if (clipPath) ctx.clip(clipPath);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const a of arrows) {
    const len = (1.1 + 1.6 * a.t ** 0.7) * scale; // world px; < the 3px lattice
    const cx = (a.tx + 0.5) * TILE;
    const cy = (a.ty + 0.5) * TILE;
    const hx = cx + a.ax * len * 0.5;
    const hy = cy + a.ay * len * 0.5;
    const bx = cx - a.ax * len * 0.5;
    const by = cy - a.ay * len * 0.5;
    const head = len * 0.44;
    const ang = Math.atan2(a.ay, a.ax);
    const shaft = (color, width, dx, dy) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(bx + dx, by + dy);
      ctx.lineTo(hx + dx, hy + dy);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(hx + dx + a.ax * head * 0.5, hy + dy + a.ay * head * 0.5);
      ctx.lineTo(hx + dx + Math.cos(ang + 2.5) * head, hy + dy + Math.sin(ang + 2.5) * head);
      ctx.lineTo(hx + dx + Math.cos(ang - 2.5) * head, hy + dy + Math.sin(ang - 2.5) * head);
      ctx.closePath();
      ctx.fill();
    };
    const w = (0.34 + 0.30 * a.t) * scale;
    shaft(`rgba(15,42,22,${(0.28 + 0.44 * a.t).toFixed(3)})`, w, 0.3, 0.35);
    shaft(`rgba(246,255,242,${(0.26 + 0.46 * a.t).toFixed(3)})`, w, -0.15, -0.2);
  }
  ctx.restore();
}

/**
 * The break page: a uniform downhill arrow grid over the putting surface.
 * @param {object} course @param {{x0,y0,x1,y1}} rect green bbox in tiles
 * @param {{spacing?:number, minPct?:number, field?:object, sub?:number, margin?:number}} [opts]
 * @returns {{canvas,ox,oy,w,h,sub,kind:'breaks',ms:number,count:number,peakPct:number,flat:boolean}}
 */
export function renderBreakLayer(course, rect, opts = {}) {
  const t0 = now();
  const geo = greenBookGeometry(course, rect, opts);
  const field = opts.field ?? greenSlopeField(course, geo);
  const { off, ctx } = bookCanvas(geo);
  const arrows = breakArrows(course, field, geo.box, opts);
  paintBreakArrows(ctx, arrows, silhouette(course, GREEN_GROW, 7));
  return finishLayer(off, geo, 'breaks', t0, {
    count: arrows.length, peakPct: fieldPeakPercent(field), flat: field.flat,
  });
}

// --- 2 & 3. the heat pages ---------------------------------------------------

const SLOPE_HEAT_RES = 8;   // samples per tile — smooth under the 4× oversample
const SLOPE_HEAT_ALPHA = 0.30; // low enough that arrows and contours stay legible
const COST_HEAT_ALPHA = 0.42;

/**
 * Slope severity sampled over the layer box, in PERCENT GRADE.
 * @returns {{vals:Float32Array,ew:number,eh:number,box:object,min:number,max:number}}
 */
export function slopePercentField(field, box, res = SLOPE_HEAT_RES) {
  const ew = Math.max(2, Math.ceil(((box.x1 - box.x0) / TILE) * res));
  const eh = Math.max(2, Math.ceil(((box.y1 - box.y0) / TILE) * res));
  const vals = new Float32Array(ew * eh);
  let min = Infinity;
  let max = 0;
  for (let j = 0; j < eh; j++) {
    const ty = (box.y0 + ((j + 0.5) / eh) * (box.y1 - box.y0)) / TILE - 0.5;
    for (let i = 0; i < ew; i++) {
      const tx = (box.x0 + ((i + 0.5) / ew) * (box.x1 - box.x0)) / TILE - 0.5;
      const v = slopePercentAt(field, tx, ty);
      vals[j * ew + i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { vals, ew, eh, box, min: Number.isFinite(min) ? min : 0, max };
}

// The cost page's own putting cost. It is the ENGINE's model — the same putt
// ellipse (puttPoints), the same capture test (puttHolesOut), the same break
// integration (puttBreakDrift) and the same self-consistent leave table
// (puttsFrom) that strategy.js prices decisions with — evaluated over the 16
// fixed offsets instead of strategy's 48, and over a short pace/aim-off menu
// instead of the full search. That keeps a whole-green field inside the frame
// budget while every number it prints is the caddie's own arithmetic.
const COST_PACES = [0.06, 0.18, 0.4, 0.75]; // tiles past the cup
const FRINGE_TAX = 0.35; // a leave off the putting surface: chip, then putt

function leaveCost(course, V, from, q, profile) {
  const cup = course.hole;
  const rest = restingCell(course, q.x, q.y);
  if (rest.kind !== 'rest') return 1 + puttsFrom(Math.hypot(from.x - cup.x, from.y - cup.y), profile);
  const d = Math.hypot(q.x - cup.x, q.y - cup.y);
  if (rest.terrain === GREEN) return puttsFrom(d, profile);
  const v = V ? V[rest.y * course.width + rest.x] : NaN;
  return Number.isFinite(v) ? v : puttsFrom(d, profile) + FRINGE_TAX;
}

/**
 * Expected putts to hole out from a position, playing the best of a small pace ×
 * aim-off menu. Break-aware: when the line to the cup bends, the menu includes
 * the aim-off that cancels it (and a half and a half-again of it), so a position
 * above the hole on a shoulder prices its real difficulty.
 */
export function expectedPuttsAt(course, from, profile = DEFAULT_PROFILE, V = null) {
  const cup = course.hole;
  const d = Math.hypot(cup.x - from.x, cup.y - from.y);
  if (d <= CUP_R) return 1;
  const ux = (cup.x - from.x) / d;
  const uy = (cup.y - from.y) / d;
  const cross = puttBreakDrift(course, from, cup).cross;
  const laterals = Math.abs(cross) > 1e-9 ? [0, -cross, -cross * 0.5, -cross * 1.6] : [0];
  let best = COST_LEGEND.max;
  for (const past of COST_PACES) {
    const aim = d + past;
    for (const lat of laterals) {
      const target = { x: from.x + ux * aim - uy * lat, y: from.y + uy * aim + ux * lat };
      const pts = puttPoints(from, target, profile, UNIT_OFFSETS);
      let total = 0;
      for (const p of pts) {
        const br = puttBreakDrift(course, from, p);
        const q = { x: p.x + br.x, y: p.y + br.y };
        if (puttHolesOut(from, q, cup)) continue;
        total += leaveCost(course, V, from, q, profile);
      }
      const e = 1 + total / pts.length;
      if (e < best) best = e;
    }
  }
  return Math.min(COST_LEGEND.max, best);
}

/** Coarse grid budget: the cost model is ~250 modelled rolls per sample, so the
 *  sample count is what keeps a whole-green page inside ~100 ms. */
const COST_MAX_SAMPLES = 2400;

/**
 * Expected putts sampled on a coarse tile grid over the layer box. Positions off
 * the putting surface are filled from their neighbours so the bilinear upsample
 * has no transparent bleed at the edge.
 * @returns {{vals:Float32Array,ew:number,eh:number,x0:number,y0:number,step:number,
 *            min:number,max:number,samples:number}} sample (i,j) sits at tile
 *   coordinate (x0 + i*step, y0 + j*step).
 */
export function costField(course, geo, { profile = DEFAULT_PROFILE, V = null, step = 0.25, maxSamples = COST_MAX_SAMPLES } = {}) {
  const tw = geo.w / TILE;
  const th = geo.h / TILE;
  let s = step;
  const est = Math.ceil(tw / s + 1) * Math.ceil(th / s + 1);
  if (est > maxSamples) s *= Math.sqrt(est / maxSamples); // hold the budget
  const ew = Math.max(2, Math.ceil(tw / s) + 1);
  const eh = Math.max(2, Math.ceil(th / s) + 1);
  const x0 = geo.ox / TILE - 0.5;
  const y0 = geo.oy / TILE - 0.5;
  const vals = new Float32Array(ew * eh).fill(NaN);
  let min = Infinity;
  let max = -Infinity;
  let samples = 0;
  for (let j = 0; j < eh; j++) {
    for (let i = 0; i < ew; i++) {
      const x = x0 + i * s;
      const y = y0 + j * s;
      if (!onPuttingSurface(course, x, y, 1)) continue;
      const e = expectedPuttsAt(course, { x, y }, profile, V);
      vals[j * ew + i] = e;
      samples++;
      if (e < min) min = e;
      if (e > max) max = e;
    }
  }
  // grow the valid region outward a few rings so the smoothed upsample has
  // something sane to interpolate against right at the collar
  for (let pass = 0; pass < 3; pass++) {
    const src = vals.slice();
    for (let j = 0; j < eh; j++) {
      for (let i = 0; i < ew; i++) {
        const k = j * ew + i;
        if (!Number.isNaN(src[k])) continue;
        let sum = 0;
        let n = 0;
        const add = (ii, jj) => {
          if (ii < 0 || jj < 0 || ii >= ew || jj >= eh) return;
          const v = src[jj * ew + ii];
          if (!Number.isNaN(v)) { sum += v; n++; }
        };
        add(i - 1, j); add(i + 1, j); add(i, j - 1); add(i, j + 1);
        if (n) vals[k] = sum / n;
      }
    }
  }
  for (let k = 0; k < vals.length; k++) if (Number.isNaN(vals[k])) vals[k] = COST_LEGEND.max;
  return {
    vals, ew, eh, x0, y0, step: s, samples,
    min: Number.isFinite(min) ? min : 1, max: Number.isFinite(max) ? max : 1,
  };
}

/** Paint a scalar grid as ramp colours into an ImageData and blow it up with the
 *  canvas's own bilinear filter — smooth, and one draw call. */
function paintScalarGrid(ctx, grid, legend, worldRect, clipPath, alpha) {
  const buf = document.createElement('canvas');
  buf.width = grid.ew;
  buf.height = grid.eh;
  const bctx = buf.getContext('2d');
  const img = bctx.createImageData(grid.ew, grid.eh);
  for (let k = 0; k < grid.ew * grid.eh; k++) {
    const u = legend.norm(grid.vals[k]);
    let a = HEAT_STOPS[0];
    let b = HEAT_STOPS[HEAT_STOPS.length - 1];
    for (let i = 0; i < HEAT_STOPS.length - 1; i++) {
      if (u >= HEAT_STOPS[i].t && u <= HEAT_STOPS[i + 1].t) { a = HEAT_STOPS[i]; b = HEAT_STOPS[i + 1]; break; }
    }
    const f = (u - a.t) / ((b.t - a.t) || 1);
    const o = k * 4;
    img.data[o] = Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * f);
    img.data[o + 1] = Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * f);
    img.data[o + 2] = Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * f);
    img.data[o + 3] = 255;
  }
  bctx.putImageData(img, 0, 0);
  ctx.save();
  if (clipPath) ctx.clip(clipPath);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = alpha;
  ctx.drawImage(buf, worldRect.x, worldRect.y, worldRect.w, worldRect.h);
  ctx.restore();
}

/**
 * A heat page.
 * @param {'slope'|'cost'} kind
 * @param {{profile?:object, V?:Float64Array, field?:object, alpha?:number,
 *          step?:number, sub?:number, margin?:number}} [opts]
 * @returns {{canvas,ox,oy,w,h,sub,kind,legend:Legend,ms:number,min:number,max:number,flat:boolean}}
 *   `legend` is the key the UI should draw beside the page.
 */
export function renderHeatLayer(course, rect, kind = 'slope', opts = {}) {
  const t0 = now();
  const geo = greenBookGeometry(course, rect, opts);
  const { off, ctx } = bookCanvas(geo);
  const legend = legendFor(kind);
  const surface = silhouette(course, GREEN_GROW, 7);
  let min = 0;
  let max = 0;
  let flat = true;
  if (kind === 'cost') {
    const grid = costField(course, geo, opts);
    // texel centres sit ON the sample points, so the drawn rect runs half a step
    // outside the first and last sample
    const wx = (t) => (t + 0.5) * TILE;
    paintScalarGrid(ctx, grid, legend, {
      x: wx(grid.x0 - grid.step / 2), y: wx(grid.y0 - grid.step / 2),
      w: grid.ew * grid.step * TILE, h: grid.eh * grid.step * TILE,
    }, surface, opts.alpha ?? COST_HEAT_ALPHA);
    min = grid.min;
    max = grid.max;
    flat = false;
  } else {
    const field = opts.field ?? greenSlopeField(course, geo);
    flat = field.flat;
    if (!flat) {
      const grid = slopePercentField(field, geo.box, opts.res ?? SLOPE_HEAT_RES);
      paintScalarGrid(ctx, grid, legend, {
        x: geo.box.x0, y: geo.box.y0, w: geo.box.x1 - geo.box.x0, h: geo.box.y1 - geo.box.y0,
      }, surface, opts.alpha ?? SLOPE_HEAT_ALPHA);
      min = grid.min;
      max = grid.max;
    }
  }
  return finishLayer(off, geo, kind === 'cost' ? 'cost' : 'slope', t0, { legend, min, max, flat });
}

// --- 4. contours -------------------------------------------------------------
// The slope field is a GRADIENT; a contour needs a HEIGHT. We recover one by
// solving ∇h = −g over the window (up is against the fall line) with Jacobi
// relaxation: each sample relaxes toward the mean of what its four neighbours
// imply it should be, h(p) = mean_n( h(n) + g_mid·e·ds ). That is the least-
// squares surface for the field — stable for any field, exactly zero for a flat
// one, and it needs no integration order or seed point. Levels are then walked
// out with marching squares at a fixed one-FOOT interval.

export const CONTOUR_RES = 4;      // elevation samples per tile
export const CONTOUR_ITERS = 260;  // Jacobi sweeps — the window is ~50 cells wide
export const CONTOUR_FT = 1;       // feet between isolines

/** Height at one pull-tile of integrated gradient, in feet. */
export function elevationFeet(hPull) {
  return riseFeet(slopePercent(hPull), 1);
}
const CONTOUR_INTERVAL_PULL = CONTOUR_FT / (elevationFeet(1) || 1);

/**
 * Integrate the slope field into a relative elevation surface.
 * @returns {{vals:Float32Array,ew:number,eh:number,res:number,t0x:number,t0y:number,
 *            min:number,max:number,flat:boolean}} sample (i,j) sits at tile
 *   coordinate (t0x + i/res, t0y + j/res); values are in pull-tiles (see
 *   elevationFeet), zero-meaned so only DIFFERENCES matter.
 */
export function integrateElevation(field, { res = CONTOUR_RES, iters = CONTOUR_ITERS } = {}) {
  const ew = Math.max(2, Math.round(field.tw * res));
  const eh = Math.max(2, Math.round(field.th * res));
  const t0x = field.t0x;
  const t0y = field.t0y;
  const vals = new Float32Array(ew * eh);
  const empty = { vals, ew, eh, res, t0x, t0y, min: 0, max: 0, flat: true };
  if (field.flat) return empty;
  const ds = 1 / res;
  // pre-sample the gradient at every node once — the inner loop is hot
  const gx = new Float32Array(ew * eh);
  const gy = new Float32Array(ew * eh);
  for (let j = 0; j < eh; j++) {
    for (let i = 0; i < ew; i++) {
      const d = sampleSlope(field, t0x + i * ds, t0y + j * ds);
      gx[j * ew + i] = d.x;
      gy[j * ew + i] = d.y;
    }
  }
  let cur = vals;
  let nxt = new Float32Array(ew * eh);
  for (let it = 0; it < iters; it++) {
    for (let j = 0; j < eh; j++) {
      for (let i = 0; i < ew; i++) {
        const k = j * ew + i;
        let sum = 0;
        let n = 0;
        // ∇h = −g, so across a step e·ds:  h(n) − h(p) = −g·e·ds
        //                             ⇒   h(p) = h(n) + g·e·ds
        // (g points DOWNHILL, so stepping along g loses height — as it should.)
        if (i > 0) { sum += cur[k - 1] - ((gx[k] + gx[k - 1]) * 0.5) * ds; n++; }
        if (i < ew - 1) { sum += cur[k + 1] + ((gx[k] + gx[k + 1]) * 0.5) * ds; n++; }
        if (j > 0) { sum += cur[k - ew] - ((gy[k] + gy[k - ew]) * 0.5) * ds; n++; }
        if (j < eh - 1) { sum += cur[k + ew] + ((gy[k] + gy[k + ew]) * 0.5) * ds; n++; }
        nxt[k] = n ? sum / n : cur[k];
      }
    }
    const t = cur; cur = nxt; nxt = t;
  }
  let mean = 0;
  for (let k = 0; k < cur.length; k++) mean += cur[k];
  mean /= cur.length;
  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < cur.length; k++) {
    cur[k] -= mean;
    if (cur[k] < min) min = cur[k];
    if (cur[k] > max) max = cur[k];
  }
  return { vals: cur, ew, eh, res, t0x, t0y, min, max, flat: false };
}

/**
 * Marching-squares isolines over an elevation surface.
 * @returns {{level:number,x0:number,y0:number,x1:number,y1:number}[]} segments in
 *   TILE coordinates (world px = (t + 0.5) * TILE).
 */
export function contourSegments(elev, interval = CONTOUR_INTERVAL_PULL) {
  const segs = [];
  if (!elev || elev.flat || !(interval > 0)) return segs;
  if (elev.max - elev.min < interval * 0.5) return segs;
  const { vals, ew, eh, res, t0x, t0y } = elev;
  const at = (i, j) => vals[j * ew + i];
  const px = (i) => t0x + i / res;
  const py = (j) => t0y + j / res;
  for (let k = Math.ceil(elev.min / interval); k <= Math.floor(elev.max / interval); k++) {
    const level = k * interval;
    for (let j = 0; j < eh - 1; j++) {
      for (let i = 0; i < ew - 1; i++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i + 1, j + 1);
        const d = at(i, j + 1);
        const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const P = { x: px(i), y: py(j) };
        const Q = { x: px(i + 1), y: py(j) };
        const R = { x: px(i + 1), y: py(j + 1) };
        const S = { x: px(i), y: py(j + 1) };
        const cut = (p, q, vp, vq) => {
          const t = (level - vp) / ((vq - vp) || 1e-9);
          return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
        };
        const top = () => cut(P, Q, a, b);
        const right = () => cut(Q, R, b, c);
        const bottom = () => cut(S, R, d, c);
        const left = () => cut(P, S, a, d);
        const push = (p, q) => segs.push({ level, x0: p.x, y0: p.y, x1: q.x, y1: q.y });
        switch (idx) {
          case 1: case 14: push(left(), bottom()); break;
          case 2: case 13: push(bottom(), right()); break;
          case 3: case 12: push(left(), right()); break;
          case 4: case 11: push(top(), right()); break;
          case 6: case 9: push(top(), bottom()); break;
          case 7: case 8: push(left(), top()); break;
          case 5: case 10: {
            const mid = (a + b + c + d) / 4;
            if ((idx === 5) === (mid > level)) { push(left(), top()); push(bottom(), right()); }
            else { push(left(), bottom()); push(top(), right()); }
            break;
          }
          default: break;
        }
      }
    }
  }
  return segs;
}

/**
 * The contour page: thin, low-contrast isolines at CONTOUR_FT intervals, run a
 * little past the green edge the way the book prints them. Every fifth line is
 * an index contour, drawn a shade stronger.
 * @returns {{canvas,ox,oy,w,h,sub,kind:'contours',ms:number,segments:number,
 *            reliefFt:number,flat:boolean}}
 */
export function renderContourLayer(course, rect, opts = {}) {
  const t0 = now();
  const geo = greenBookGeometry(course, rect, opts);
  const field = opts.field ?? greenSlopeField(course, geo);
  const { off, ctx } = bookCanvas(geo);
  const elev = field.flat ? null : integrateElevation(field, opts);
  const interval = opts.interval ?? CONTOUR_INTERVAL_PULL;
  const segs = elev ? contourSegments(elev, interval) : [];
  if (segs.length) {
    // past the putting surface but not out into the rough: the collar plus a few
    // world pixels, exactly as the printed page lets its lines run on
    ctx.save();
    ctx.clip(silhouette(course, COLLAR_GROW + (opts.overrun ?? 6), 15));
    ctx.lineCap = 'round';
    const wx = (t) => (t + 0.5) * TILE;
    const draw = (color, width, index) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const s of segs) {
        const isIndex = Math.abs(Math.round(s.level / interval)) % 5 === 0;
        if (isIndex !== index) continue;
        ctx.moveTo(wx(s.x0), wx(s.y0));
        ctx.lineTo(wx(s.x1), wx(s.y1));
      }
      ctx.stroke();
    };
    draw('rgba(16,44,24,0.20)', 0.5, false);
    draw('rgba(255,255,255,0.13)', 0.4, false);
    draw('rgba(16,44,24,0.30)', 0.75, true);
    draw('rgba(255,255,255,0.16)', 0.5, true);
    ctx.restore();
  }
  return finishLayer(off, geo, 'contours', t0, {
    segments: segs.length,
    reliefFt: elev ? elevationFeet(elev.max - elev.min) : 0,
    flat: !!field.flat,
  });
}

// --- 5. page furniture -------------------------------------------------------

/** Yards between the fine grid lines — the book's own 5-yard squares. */
export const GRID_YARDS = 5;

/**
 * Perimeter stroke, 5-yard grid, optional hole numeral. Drawn on its own layer
 * so it can ride ON TOP of a heat page without being tinted by it.
 * @param {{grid?:boolean, gridYards?:number, perimeter?:boolean, holeNumber?:number|null,
 *          cup?:boolean, rings?:boolean, sub?:number, margin?:number}} [opts]
 */
export function renderFurnitureLayer(course, rect, opts = {}) {
  const t0 = now();
  const {
    grid = true, gridYards = GRID_YARDS, perimeter = true,
    holeNumber = null, cup = false, rings = false,
  } = opts;
  const geo = greenBookGeometry(course, rect, opts);
  const { off, ctx } = bookCanvas(geo);
  const surface = silhouette(course, GREEN_GROW, 7);

  if (grid) {
    // squares anchored ON the cup, so the ruler reads from the thing you aim at
    const step = (gridYards / YARDS_PER_TILE) * TILE;
    const cx = (course.hole.x + 0.5) * TILE;
    const cy = (course.hole.y + 0.5) * TILE;
    ctx.save();
    ctx.clip(surface);
    ctx.lineWidth = 0.3;
    const line = (x0, y0, x1, y1, n) => {
      ctx.strokeStyle = n % 4 === 0 ? 'rgba(12,40,20,0.16)' : 'rgba(12,40,20,0.085)';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    };
    const n0 = Math.floor((geo.box.x0 - cx) / step);
    const n1 = Math.ceil((geo.box.x1 - cx) / step);
    for (let n = n0; n <= n1; n++) line(cx + n * step, geo.box.y0, cx + n * step, geo.box.y1, n);
    const m0 = Math.floor((geo.box.y0 - cy) / step);
    const m1 = Math.ceil((geo.box.y1 - cy) / step);
    for (let m = m0; m <= m1; m++) line(geo.box.x0, cy + m * step, geo.box.x1, cy + m * step, m);
    ctx.restore();
  }

  if (perimeter) {
    // A silhouette is a UNION of tile blobs, so its outline has to be drawn as
    // the DIFFERENCE of two unions — stroking the path would ink every interior
    // tile edge. Fill the outer union, then punch the inner one back out.
    const ring = (grow, width, color) => {
      ctx.save();
      ctx.fillStyle = color;
      ctx.fill(silhouette(course, grow + width / 2, 7 + width / 2));
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fill(silhouette(course, grow - width / 2, Math.max(1, 7 - width / 2)));
      ctx.restore();
    };
    ring(GREEN_GROW + 1.1, 0.7, 'rgba(248,255,246,0.34)'); // printed highlight
    ring(GREEN_GROW, 0.85, 'rgba(20,52,28,0.62)');         // the crisp edge
  }

  if (rings) paintFeetGrid(ctx, course.hole, silhouette(course, COLLAR_GROW, 13));
  if (cup) paintCup(ctx, course.hole);

  if (holeNumber != null) {
    // the book's hole numeral, tucked into the layer's top-left corner
    ctx.save();
    ctx.font = `700 ${TILE * 0.5}px system-ui`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(12,32,18,0.35)';
    ctx.fillText(String(holeNumber), geo.box.x0 + 5.4, geo.box.y0 + 4.4);
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.fillText(String(holeNumber), geo.box.x0 + 5, geo.box.y0 + 4);
    ctx.restore();
  }
  return finishLayer(off, geo, 'furniture', t0, {});
}

/**
 * The screen angle world NORTH points at, in radians (0 = right, +y = down).
 * camera.js rotates portrait boards by mapping (u,v) → (v, h−u), which turns a
 * direction (dx,dy) into (dy,−dx); world north is (0,−1). Pure, so the caller
 * can orient anything — the rose, a wind barb — with one call.
 */
export function northScreenAngle(rotated = false) {
  return rotated ? Math.PI : -Math.PI / 2;
}

/**
 * A small compass rose at a SCREEN-pixel anchor. The caller places it (a corner
 * of the viewport, usually) and passes the board's rotation, so the needle keeps
 * pointing at true north through the portrait flip.
 * @param {{x:number,y:number}} px screen anchor (the rose's centre)
 * @param {{r?:number, rotated?:boolean, angle?:number, alpha?:number, label?:string}} [opts]
 */
export function drawCompassRose(ctx, px, opts = {}) {
  const { r = 18, rotated = false, angle = northScreenAngle(rotated), alpha = 0.8, label = 'N' } = opts;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(px.x, px.y);
  // dial
  ctx.fillStyle = 'rgba(12,26,16,0.42)';
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  // tick marks every 45°
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  for (let i = 0; i < 8; i++) {
    const a = angle + (i * Math.PI) / 4;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78);
    ctx.lineTo(Math.cos(a) * r * 0.94, Math.sin(a) * r * 0.94);
    ctx.stroke();
  }
  // needle: filled north half, hollow south half
  const nx = Math.cos(angle);
  const ny = Math.sin(angle);
  const sx = -ny;
  const sy = nx;
  const tri = (dx, dy, fill) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(dx * r * 0.72, dy * r * 0.72);
    ctx.lineTo(sx * r * 0.2, sy * r * 0.2);
    ctx.lineTo(-sx * r * 0.2, -sy * r * 0.2);
    ctx.closePath();
    ctx.fill();
  };
  tri(-nx, -ny, 'rgba(230,240,232,0.35)');
  tri(nx, ny, '#e74c3c');
  // the letter, upright on screen and set just outside the dial
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `700 ${Math.round(r * 0.62)}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, nx * r * 1.32, ny * r * 1.32);
  ctx.restore();
}

// --- 6. the dispersion pattern at green scale --------------------------------
// The flaw this fixes: the pattern's 48 dots are drawn in WORLD pixels, so at
// 6× putting zoom a 2.5 px dot is 15 screen px and a tight putt pattern paints
// one opaque lozenge over the cup. Two rules fix it and both are pure arithmetic
// on the camera scale:
//   1. dots are sized in SCREEN pixels (radius / k), so zooming in never fattens
//      them; and their alpha falls as the pattern's screen area per dot shrinks,
//      so the TOTAL ink stays roughly constant instead of stacking to opaque.
//   2. below the density where separate dots can be resolved the pattern draws
//      as a soft density cloud instead — the honest picture of "too many samples
//      for this area", not a blob pretending to be one sample.
// And the ball, the cup and their immediate surrounds are punched OUT of the
// pattern's clip, so the pattern can never hide the two things you are reading.

/** Screen px² of pattern area per dot below which dots stop being resolvable. */
export const DOT_RESOLVE_AREA = 46;
const DOT_SCREEN_R = 2.1;

/**
 * Which way to draw a pattern of `n` samples spread over a screen-space ellipse.
 * Pure — exported so the caller (and the tests) can predict the mode.
 */
export function patternDensityMode(n, sigmaLongPx, sigmaLatPx) {
  const area = Math.PI * Math.max(0.5, sigmaLongPx) * Math.max(0.5, sigmaLatPx) * 2.6; // ~2σ footprint
  return area / Math.max(1, n) >= DOT_RESOLVE_AREA ? 'dots' : 'cloud';
}

/** Dot alpha that holds total ink constant as the pattern tightens on screen. */
export function patternDotAlpha(n, sigmaLongPx, sigmaLatPx) {
  const area = Math.PI * Math.max(0.5, sigmaLongPx) * Math.max(0.5, sigmaLatPx) * 2.6;
  const per = area / Math.max(1, n);
  return Math.max(0.13, Math.min(0.62, 0.62 * (per / DOT_RESOLVE_AREA)));
}

/**
 * Pace tick spacing in FEET: the smallest of 1/2/5/10/20/50 ft whose ticks still
 * land at least 14 screen pixels apart at camera scale `k`.
 */
export function paceTickFeet(k) {
  for (const ft of [1, 2, 5, 10, 20, 50]) {
    if ((ft / FT_PER_TILE) * TILE * k >= 14) return ft;
  }
  return 50;
}

/**
 * Draw a putt dispersion pattern at GREEN scale.
 *
 * Call it inside the world transform (the same one the green art is drawn
 * under); `k` is camera.scale, which is what lets every mark be specified in
 * screen pixels and converted back to world units here.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{from:{x,y}, target:{x,y}, cup?:{x,y}, dots?:{x,y,outcome?:string}[],
 *          k:number, profile?:object, sigmas?:{long:number,lat:number},
 *          line?:boolean, ticks?:boolean, ballR?:number, mode?:'dots'|'cloud'}} o
 * @returns {{mode:string, alpha:number, ticks:{x:number,y:number,ft:number}[]}}
 *   the chosen mode and the WORLD-pixel tick anchors, so the caller can label
 *   them in upright screen space.
 */
export function drawPuttPattern(ctx, o) {
  const k = Math.max(0.001, o.k ?? 1);
  const from = o.from;
  const target = o.target;
  const cup = o.cup ?? null;
  const dots = o.dots ?? [];
  const d = Math.hypot(target.x - from.x, target.y - from.y) || 0.001;
  const sig = o.sigmas ?? puttSigmas(d, o.profile ?? DEFAULT_PROFILE);
  const ang = Math.atan2(target.y - from.y, target.x - from.x);
  const wx = (p) => ({ x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE });
  const A = wx(from);
  const B = wx(target);
  const sLongPx = sig.long * TILE * k;
  const sLatPx = sig.lat * TILE * k;
  const mode = o.mode ?? patternDensityMode(dots.length || 1, sLongPx, sLatPx);
  const alpha = patternDotAlpha(dots.length || 1, sLongPx, sLatPx);
  const out = { mode, alpha, ticks: [] };

  ctx.save();
  // --- the protected discs: the pattern is clipped OUT of them, so the ball and
  // the cup are never covered no matter how dense the pattern gets.
  const keepOut = new Path2D();
  keepOut.rect(ctx.canvas.width * -4, ctx.canvas.height * -4, ctx.canvas.width * 9, ctx.canvas.height * 9);
  const ballR = (o.ballR ?? BALL_WORLD_R * 1.9);
  keepOut.moveTo(A.x + ballR, A.y);
  keepOut.arc(A.x, A.y, ballR, 0, Math.PI * 2);
  if (cup) {
    const C = wx(cup);
    const cr = Math.max(CUP_R * TILE * 2.1, 7 / k);
    keepOut.moveTo(C.x + cr, C.y);
    keepOut.arc(C.x, C.y, cr, 0, Math.PI * 2);
  }
  ctx.clip(keepOut, 'evenodd');

  if (mode === 'cloud') {
    // a soft density cloud: the same ellipse the dots would fill, as a radial
    // falloff, so the eye reads WHERE the mass is instead of a hard edge
    ctx.save();
    ctx.translate(B.x, B.y);
    ctx.rotate(ang);
    ctx.scale(Math.max(0.6 / k, sig.long * TILE * 2), Math.max(0.6 / k, sig.lat * TILE * 2));
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(190,238,255,0.34)');
    g.addColorStop(0.55, 'rgba(170,225,255,0.16)');
    g.addColorStop(1, 'rgba(150,210,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // dots: screen-sized, alpha-budgeted. Makes stay gold and a touch brighter so
  // the make rate is still readable inside a cloud.
  const r = Math.max(0.35, DOT_SCREEN_R / k) * (mode === 'cloud' ? 0.7 : 1);
  for (const dot of dots) {
    const p = wx(dot);
    const holed = dot.outcome === 'holed';
    ctx.fillStyle = holed
      ? `rgba(255,209,102,${Math.max(0.35, alpha).toFixed(3)})`
      : `rgba(255,255,255,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, holed ? r * 1.15 : r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // --- the aim line, unclipped: it runs THROUGH the ball and the cup on purpose
  if (o.line !== false) {
    ctx.save();
    ctx.lineCap = 'butt';
    ctx.setLineDash([6 / k, 5 / k]);
    ctx.lineWidth = Math.max(0.25, 1.3 / k);
    ctx.strokeStyle = 'rgba(255,255,255,0.62)';
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // --- pace ticks: how far past the cup this roll is being played
  if (o.ticks !== false && cup) {
    const ux = (target.x - from.x) / d;
    const uy = (target.y - from.y) / d;
    const along = (cup.x - from.x) * ux + (cup.y - from.y) * uy; // cup's station
    const past = d - along; // tiles of pace past the hole
    const stepFt = paceTickFeet(k);
    const stepTiles = stepFt / FT_PER_TILE;
    const limit = Math.min(past, PUTT_OVERRUN);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.22, 1.1 / k);
    const half = Math.max(1.2, 5 / k);
    for (let i = 1; i * stepTiles <= limit + 1e-9 && i <= 12; i++) {
      const s = along + i * stepTiles;
      const p = { x: from.x + ux * s, y: from.y + uy * s };
      const q = wx(p);
      ctx.strokeStyle = `rgba(255,235,180,${(0.72 - i * 0.05).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(q.x + uy * half, q.y - ux * half);
      ctx.lineTo(q.x - uy * half, q.y + ux * half);
      ctx.stroke();
      out.ticks.push({ x: q.x, y: q.y, ft: Math.round(i * stepFt) });
    }
    ctx.restore();
  }
  return out;
}

// --- the composed page + its cache -------------------------------------------

const bookCache = new Map(); // key → layer
const BOOK_CACHE_MAX = 16;

function cacheKey(course, rect, kind, opts) {
  return [
    course.seed, course.hole.x, course.hole.y,
    rect.x0, rect.y0, rect.x1, rect.y1,
    kind, opts.profile?.id ?? 'scratch', opts.sub ?? GREEN_SUB,
  ].join('|');
}

function cached(course, rect, kind, opts, build) {
  const key = cacheKey(course, rect, kind, opts);
  const hit = bookCache.get(key);
  if (hit) {
    bookCache.delete(key); // LRU: re-insert at the young end
    bookCache.set(key, hit);
    return hit;
  }
  const made = build();
  bookCache.set(key, made);
  while (bookCache.size > BOOK_CACHE_MAX) bookCache.delete(bookCache.keys().next().value);
  return made;
}

/** Drop every cached page. Call on a new round if memory matters. */
export function clearGreenBookCache() {
  bookCache.clear();
}

/**
 * The whole yardage-book page, composed and cached.
 *
 *   const book = renderGreenBook(course, greenRect, { heat: 'slope', profile });
 *   for (const l of book.layers) ctx.drawImage(l.canvas, l.ox, l.oy, l.w, l.h);
 *
 * Every layer is cached per hole+profile+kind, so flipping `heat` between null,
 * 'slope' and 'cost' rebuilds ONE layer and reuses the other four.
 *
 * @param {{heat?: 'slope'|'cost'|null, profile?: object, V?: Float64Array,
 *          breaks?: boolean, contours?: boolean, furniture?: boolean,
 *          base?: boolean, holeNumber?: number|null, sub?: number, margin?: number}} [opts]
 * @returns {{geo:object, layers:object[], base:object|null, breaks:object|null,
 *            heat:object|null, contours:object|null, furniture:object|null,
 *            legend:Legend|null, peakPct:number, sloped:boolean, ms:object}}
 */
export function renderGreenBook(course, rect, opts = {}) {
  const {
    heat = null, profile = DEFAULT_PROFILE, V = null,
    breaks = true, contours = true, furniture = true, base = true, holeNumber = null,
  } = opts;
  const geo = greenBookGeometry(course, rect, opts);
  const field = greenSlopeField(course, geo);
  const shared = { ...opts, field, profile, V };
  const ms = {};
  const t0 = now();

  const baseLayer = base
    ? cached(course, rect, 'base', opts, () => renderGreenArt(course, rect, { breaks: 'none' }))
    : null;
  if (baseLayer) ms.base = +baseLayer.ms.toFixed(2);

  const heatLayer = heat
    ? cached(course, rect, `heat:${heat}`, opts, () => renderHeatLayer(course, rect, heat, shared))
    : null;
  if (heatLayer) ms[heat] = +heatLayer.ms.toFixed(2);

  const contourLayer = contours && !field.flat
    ? cached(course, rect, 'contours', opts, () => renderContourLayer(course, rect, shared))
    : null;
  if (contourLayer) ms.contours = +contourLayer.ms.toFixed(2);

  const breakLayer = breaks && !field.flat
    ? cached(course, rect, 'breaks', opts, () => renderBreakLayer(course, rect, shared))
    : null;
  if (breakLayer) ms.breaks = +breakLayer.ms.toFixed(2);

  const furnitureLayer = furniture
    ? cached(course, rect, `furniture:${holeNumber ?? ''}`, opts,
      () => renderFurnitureLayer(course, rect, shared))
    : null;
  if (furnitureLayer) ms.furniture = +furnitureLayer.ms.toFixed(2);

  ms.total = +(now() - t0).toFixed(2);
  return {
    geo,
    layers: [baseLayer, heatLayer, contourLayer, breakLayer, furnitureLayer].filter(Boolean),
    base: baseLayer, heat: heatLayer, contours: contourLayer,
    breaks: breakLayer, furniture: furnitureLayer,
    legend: heat ? legendFor(heat) : null,
    peakPct: fieldPeakPercent(field),
    sloped: !field.flat,
    ms,
  };
}
