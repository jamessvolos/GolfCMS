// Canvas renderer: flat-color tiles with cheap procedural texture. The grid
// is honest — what you see is exactly what the sim plays.

import { FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN, ICE, slopeDir } from '../engine/terrain.js';
import { cellAt } from '../engine/course.js';

export const TILE = 24;

const COLORS = {
  [FAIRWAY]: '#6db35f',
  [ROUGH]: '#4a7c45',
  [SAND]: '#e0c98f',
  [WATER]: '#4f8fd0',
  [TREES]: '#2c5232',
  [GREEN]: '#8fd47f',
  [ICE]: '#bfe4ee',
};

export function terrainColor(t) {
  return COLORS[t] ?? (slopeDir(t) ? '#93b06b' : '#000');
}

function drawSlopeArrow(ctx, x, y, dir) {
  const cx = x * TILE + TILE / 2;
  const cy = y * TILE + TILE / 2;
  const a = Math.atan2(dir.y, dir.x);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7);
  ctx.lineTo(cx + Math.cos(a + 2.5) * 6, cy + Math.sin(a + 2.5) * 6);
  ctx.lineTo(cx + Math.cos(a - 2.5) * 6, cy + Math.sin(a - 2.5) * 6);
  ctx.closePath();
  ctx.fill();
}

/** Halftone & Turf's truth clamp, mandated by the bake-off verdict: in photo
 *  mode, wherever the picture and the physics might disagree, the physics is
 *  inked on top — hazard boundaries as cased strokes the photo can't argue
 *  with. The player always sees the line where the engine starts charging.
 *  Exported: the Caddie surface bakes the same ink into its photo ground. */
export function strokeHazardTruth(ctx, course) {
  const at = (x, y) =>
    x < 0 || y < 0 || x >= course.width || y >= course.height ? -1 : cellAt(course, x, y);
  const edges = (match) => {
    ctx.beginPath();
    for (let y = 0; y < course.height; y++) {
      for (let x = 0; x < course.width; x++) {
        if (!match(at(x, y))) continue;
        const X = x * TILE;
        const Y = y * TILE;
        if (!match(at(x, y - 1))) { ctx.moveTo(X, Y); ctx.lineTo(X + TILE, Y); }
        if (!match(at(x, y + 1))) { ctx.moveTo(X, Y + TILE); ctx.lineTo(X + TILE, Y + TILE); }
        if (!match(at(x - 1, y))) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + TILE); }
        if (!match(at(x + 1, y))) { ctx.moveTo(X + TILE, Y); ctx.lineTo(X + TILE, Y + TILE); }
      }
    }
  };
  const ink = (match, casing, color) => {
    edges(match);
    ctx.strokeStyle = casing;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  ink((t) => t === WATER, 'rgba(0, 20, 40, 0.7)', 'rgba(140, 220, 255, 0.9)');
  ink((t) => t === SAND, 'rgba(60, 40, 0, 0.6)', 'rgba(255, 235, 180, 0.9)');
  ctx.lineWidth = 1;
}

export function draw(ctx, course, game, aim, opts = {}) {
  const ballPos = opts.ballPos ?? game.ball;
  const { width, height } = course;
  ctx.canvas.width = width * TILE;
  ctx.canvas.height = height * TILE;

  // photo ground: the baked aerial is the ground and the tiles become the
  // tracing layer over it, the editor's own alpha discipline carried into play
  if (opts.photo) {
    ctx.drawImage(opts.photo.img, 0, 0);
    ctx.globalAlpha = opts.photo.alpha;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = cellAt(course, x, y);
      ctx.fillStyle = terrainColor(t);
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      // two-line procedural texture per terrain
      if (t === FAIRWAY && (x + y) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      } else if (t === WATER) {
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.beginPath();
        ctx.moveTo(x * TILE + 4, y * TILE + TILE / 2 + ((x * 7 + y * 13) % 5) - 2);
        ctx.lineTo(x * TILE + TILE - 4, y * TILE + TILE / 2 + ((x * 7 + y * 13) % 5) - 2);
        ctx.stroke();
      } else if (t === TREES) {
        ctx.fillStyle = '#1e3d24';
        ctx.beginPath();
        ctx.arc(x * TILE + TILE / 2, y * TILE + TILE / 2, TILE / 3, 0, Math.PI * 2);
        ctx.fill();
      } else if (t === SAND) {
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(x * TILE + 3, y * TILE + TILE - 6, TILE - 6, 2);
      } else if (t === ICE) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.moveTo(x * TILE + 5, y * TILE + TILE - 7);
        ctx.lineTo(x * TILE + TILE - 7, y * TILE + 5);
        ctx.stroke();
      } else if (slopeDir(t)) {
        drawSlopeArrow(ctx, x, y, slopeDir(t));
      }
    }
  }

  // instruments from here down render at full alpha, exactly as tee and cup
  // punch through the editor's trace — the ground fades, the game never does
  ctx.globalAlpha = 1;
  if (opts.photo) strokeHazardTruth(ctx, course);

  // landing preview: shaded band of possible landing tiles
  if (aim && aim.preview) {
    ctx.fillStyle = 'rgba(255, 209, 102, 0.35)';
    for (const p of aim.preview) {
      ctx.fillRect(p.x * TILE, p.y * TILE, TILE, TILE);
    }
  }

  // aim line
  if (aim) {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo((game.ball.x + 0.5) * TILE, (game.ball.y + 0.5) * TILE);
    ctx.lineTo((game.ball.x + 0.5 + Math.cos(aim.angle) * aim.range) * TILE,
      (game.ball.y + 0.5 + Math.sin(aim.angle) * aim.range) * TILE);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // shot trail
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo((game.start.x + 0.5) * TILE, (game.start.y + 0.5) * TILE);
  for (const h of game.history) {
    ctx.lineTo((h.ball.x + 0.5) * TILE, (h.ball.y + 0.5) * TILE);
  }
  ctx.stroke();

  // ghost: a rival's replay racing you, one stroke behind your input
  if (opts.ghost) {
    const { positions, index } = opts.ghost;
    ctx.strokeStyle = 'rgba(160, 210, 255, 0.5)';
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo((positions[0].x + 0.5) * TILE, (positions[0].y + 0.5) * TILE);
    for (let i = 1; i <= index; i++) {
      ctx.lineTo((positions[i].x + 0.5) * TILE, (positions[i].y + 0.5) * TILE);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const gp = positions[Math.min(index, positions.length - 1)];
    ctx.fillStyle = 'rgba(160, 210, 255, 0.65)';
    ctx.beginPath();
    ctx.arc((gp.x + 0.5) * TILE, (gp.y + 0.5) * TILE, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // hole + flag
  const hx = (course.hole.x + 0.5) * TILE;
  const hy = (course.hole.y + 0.5) * TILE;
  ctx.fillStyle = '#1c2b1f';
  ctx.beginPath();
  ctx.arc(hx, hy, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#eee';
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx, hy - 18);
  ctx.stroke();
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.moveTo(hx, hy - 18);
  ctx.lineTo(hx + 12, hy - 13);
  ctx.lineTo(hx, hy - 8);
  ctx.closePath();
  ctx.fill();

  // wind sock (links biome)
  const wind = course.wind ?? { x: 0, y: 0 };
  if (wind.x !== 0 || wind.y !== 0) {
    const cx = ctx.canvas.width - 38;
    const cy = 30;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(cx, cy, 20, 0, Math.PI * 2);
    ctx.fill();
    const a = Math.atan2(wind.y, wind.x);
    const mag = Math.hypot(wind.x, wind.y);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * 10, cy - Math.sin(a) * 10);
    ctx.lineTo(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 14, cy + Math.sin(a) * 14);
    ctx.lineTo(cx + Math.cos(a + 2.6) * 8, cy + Math.sin(a + 2.6) * 8);
    ctx.lineTo(cx + Math.cos(a - 2.6) * 8, cy + Math.sin(a - 2.6) * 8);
    ctx.closePath();
    ctx.fill();
    ctx.font = '10px system-ui';
    ctx.fillText(String(Math.round(mag)), cx - 3, cy + 32);
  }

  // ball
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.arc((ballPos.x + 0.5) * TILE, (ballPos.y + 0.5) * TILE, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
