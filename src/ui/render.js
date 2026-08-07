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

export function draw(ctx, course, game, aim) {
  const { width, height } = course;
  ctx.canvas.width = width * TILE;
  ctx.canvas.height = height * TILE;

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

  // ball
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath();
  ctx.arc((game.ball.x + 0.5) * TILE, (game.ball.y + 0.5) * TILE, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
