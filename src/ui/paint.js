// The art pass. Terrain renders as organic blob-merged shapes with mowing
// stripes, canopy clusters, and soft shadows — built once per hole into an
// offscreen canvas so the pretty version is free at frame time.

import { FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN, ICE, slopeDir } from '../engine/terrain.js';
import { cellAt } from '../engine/course.js';

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
