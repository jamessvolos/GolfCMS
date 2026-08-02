/**
 * Canvas renderer for the reveal overlay: labeled expected-strokes isolines
 * pen-plotting outward from the optimal point, the danger wash, dispersion
 * ellipses, and the surveyor's-benchmark glyph. Pure functions of
 * (context, projector, scene, beat progress) so the choreography stays in
 * the component and this file stays testable.
 *
 * All scene geometry is in local yards; `project` maps yards → canvas px.
 */

import { color } from '@/lib/design/tokens';
import type { ContourSet } from '@/lib/map/contours';
import type { Pt } from '@/lib/engine/types';

export interface EllipseSpec {
  /** Landing-distribution center (aim + shape bias), local yards. */
  center: Pt;
  sigmaLat: number;
  sigmaLong: number;
  /** Unit direction of the aim line, local yards. */
  dir: Pt;
}

export interface RevealScene {
  contours: ContourSet;
  optimal: Pt;
  ellipses: EllipseSpec[];
  /** Danger wash drawn inside regions at or beyond this level. */
  washLevel: number;
}

export interface RevealProgress {
  /** 0..1 — contour pen-plot progress across all levels. */
  contours: number;
  /** 0..1 — ellipse dash-in progress. */
  ellipses: number;
  /** 0..1 — label + wash + benchmark fade. */
  labels: number;
}

export type Project = (p: Pt) => { x: number; y: number };

function polylineLength(line: Pt[]): number {
  let len = 0;
  for (let i = 1; i < line.length; i++) {
    len += Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y);
  }
  return len;
}

/** Draw the leading fraction t of a polyline (in yard-space arclength). */
function strokePartial(ctx: CanvasRenderingContext2D, project: Project, line: Pt[], t: number) {
  if (line.length < 2 || t <= 0) return;
  const total = polylineLength(line);
  const target = total * Math.min(1, t);
  const first = project(line[0]!);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const seg = Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y);
    if (walked + seg >= target) {
      const f = seg === 0 ? 0 : (target - walked) / seg;
      const p = project({
        x: line[i - 1]!.x + (line[i]!.x - line[i - 1]!.x) * f,
        y: line[i - 1]!.y + (line[i]!.y - line[i - 1]!.y) * f,
      });
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      return;
    }
    walked += seg;
    const p = project(line[i]!);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

export function drawReveal(
  ctx: CanvasRenderingContext2D,
  project: Project,
  scene: RevealScene,
  progress: RevealProgress,
): void {
  const levels = scene.contours.levels;
  const n = levels.length;

  // Danger wash first, under the lines.
  if (progress.labels > 0) {
    const wash = levels.find((l) => l.level === scene.washLevel);
    if (wash && wash.rings.length) {
      ctx.save();
      ctx.globalAlpha = progress.labels;
      ctx.beginPath();
      for (const ring of wash.rings) {
        const first = project(ring[0]!);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < ring.length; i++) {
          const p = project(ring[i]!);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
      }
      ctx.fillStyle = color.washDanger;
      ctx.fill('evenodd');
      ctx.restore();
    }
  }

  // Contours pen-plot outward from the optimal point: inner level first.
  ctx.save();
  ctx.strokeStyle = color.contourInk;
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  levels.forEach((lvl, i) => {
    // Level i draws inside its slice of the window, in sequence.
    const tLevel = Math.max(0, Math.min(1, progress.contours * n - i));
    if (tLevel <= 0) return;
    for (const line of lvl.strokes) strokePartial(ctx, project, line, tLevel);
  });
  ctx.restore();

  // Dispersion ellipses: 1px dashed pencil ovals, dashing in.
  if (progress.ellipses > 0) {
    ctx.save();
    ctx.strokeStyle = color.contourInk;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (const e of scene.ellipses) {
      const c = project(e.center);
      const tip = project({ x: e.center.x + e.dir.x * 10, y: e.center.y + e.dir.y * 10 });
      const angle = Math.atan2(tip.y - c.y, tip.x - c.x);
      const pxPerYd = Math.hypot(tip.x - c.x, tip.y - c.y) / 10;
      ctx.beginPath();
      ctx.ellipse(
        c.x,
        c.y,
        Math.max(1, e.sigmaLong * pxPerYd),
        Math.max(1, e.sigmaLat * pxPerYd),
        angle,
        0,
        Math.PI * 2 * Math.min(1, progress.ellipses),
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  // Labels: Archivo Narrow small caps with a viewport-color halo.
  if (progress.labels > 0) {
    ctx.save();
    ctx.globalAlpha = progress.labels;
    ctx.font = '500 11px "Archivo Narrow", "Archivo", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = color.viewport;
    ctx.fillStyle = color.contourInk;
    // Seed with the benchmark position so no label lands on the glyph.
    const placed: { x: number; y: number }[] = [{ x: scene.optimal.x, y: scene.optimal.y }];
    for (const lvl of levels) {
      if (!lvl.strokes.length) continue;
      const line = lvl.strokes.reduce((a, b) => (b.length > a.length ? b : a));
      const bottom = { ...line.reduce((a, b) => (b.y < a.y ? b : a)) };
      for (let guard = 0; guard < 6; guard++) {
        const hit = placed.some(
          (p) => Math.abs(p.x - bottom.x) < 17 && Math.abs(p.y - bottom.y) < 8,
        );
        if (!hit) break;
        bottom.y -= 7;
      }
      placed.push({ x: bottom.x, y: bottom.y });
      const s = project(bottom);
      const text = '+' + lvl.level.toFixed(2);
      ctx.strokeText(text, s.x, s.y + 14);
      ctx.fillText(text, s.x, s.y + 14);
    }
    ctx.restore();
  }

  // Surveyor's benchmark at the optimal aim: circled triangle.
  if (progress.labels > 0) {
    const o = project(scene.optimal);
    ctx.save();
    ctx.globalAlpha = progress.labels;
    ctx.strokeStyle = color.contourInk;
    ctx.fillStyle = color.contourInk;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(o.x, o.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(o.x, o.y - 4.5);
    ctx.lineTo(o.x + 4.2, o.y + 3);
    ctx.lineTo(o.x - 4.2, o.y + 3);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** Fine range ticks along the viewport's left frame while aiming. */
export function drawRangeTicks(
  ctx: CanvasRenderingContext2D,
  project: Project,
  ball: Pt,
  upDir: Pt,
  maxDistance: number,
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(241,235,221,0.4)';
  ctx.fillStyle = 'rgba(241,235,221,0.55)';
  ctx.font = '500 9px "IBM Plex Mono", monospace';
  ctx.textAlign = 'left';
  ctx.lineWidth = 1;
  for (let d = 50; d <= maxDistance; d += 50) {
    const p = project({ x: ball.x + upDir.x * d, y: ball.y + upDir.y * d });
    if (p.y < 8 || p.y > ctx.canvas.clientHeight - 8) continue;
    ctx.beginPath();
    ctx.moveTo(0, p.y);
    ctx.lineTo(7, p.y);
    ctx.stroke();
    ctx.fillText(String(d), 10, p.y + 3);
  }
  ctx.restore();
}
