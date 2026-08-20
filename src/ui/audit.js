// Generator audit grid: 50 raw courses on one screen. This is the "fast
// human review" gate from the winning proposal — procedural oatmeal and
// broken layouts jump out visually long before players ever see them.
//
// Release C added the second sheet: 24 GREEN COMPLEXES, drawn through the real
// putting-camera art at putting resolution. One disc repeated fifty times was
// invisible on the course sheet and unmissable on this one, which is exactly
// why the sheet exists.
//
// Release D added the third: 24 STRATEGIC ROUTINGS, with the plan drawn ON the
// hole — the carry band it laid, the lay-up and the shelf it left either side
// of it, and the line of play they are measured against. A fork is a claim
// about geometry, and this sheet is where the claim is visible instead of
// merely asserted in a test.

import { generateCourse, ARCHETYPES } from '../engine/generate.js';
import { GREEN_ARCHETYPES } from '../engine/greens.js';
import { TEMPLATES } from '../engine/strategic.js';
import { HOLE_LENGTHS } from '../engine/yards.js';
import { substream, pickWeighted, randInt } from '../engine/rng.js';
import { cellAt } from '../engine/course.js';
import { GREEN } from '../engine/terrain.js';
import { terrainColor } from './render.js';
import { renderGreenArt } from './paint.js';

const grid = document.getElementById('grid');
const info = document.getElementById('info');
const modeSel = document.getElementById('mode');

function drawCourse(canvas, course) {
  const s = 6;
  canvas.width = course.width * s;
  canvas.height = course.height * s;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      ctx.fillStyle = terrainColor(cellAt(course, x, y));
      ctx.fillRect(x * s, y * s, s, s);
    }
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(course.tee.x * s - 1, course.tee.y * s - 1, s + 2, s + 2);
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(course.hole.x * s - 1, course.hole.y * s - 1, s + 2, s + 2);
}

/** The green's bounding box in tiles — the same rect the putting camera frames. */
export function greenRectOf(course) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      if (cellAt(course, x, y) !== GREEN) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

/** One green complex, through the real art path, fitted to the card. The ground
 *  around it is painted first, so the hazard PLAN — which bunker guards which
 *  side, where the water is, where the entrance was left open — is visible
 *  rather than implied. */
function drawGreen(canvas, course) {
  const box = greenRectOf(course);
  if (!box) return;
  const PAD = 3; // tiles of surround: enough to show the greenside hazards
  const rect = {
    x0: Math.max(0, box.x0 - PAD),
    y0: Math.max(0, box.y0 - PAD),
    x1: Math.min(course.width - 1, box.x1 + PAD),
    y1: Math.min(course.height - 1, box.y1 + PAD),
  };
  const art = renderGreenArt(course, rect, { breaks: 'lines' });
  const DPR = 2;
  const scale = Math.min(340 / art.w, 260 / art.h);
  canvas.width = Math.round(art.w * scale * DPR);
  canvas.height = Math.round(art.h * scale * DPR);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const s = canvas.width / art.w; // world pixels → card pixels
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      ctx.fillStyle = terrainColor(cellAt(course, x, y));
      ctx.fillRect((x * 24 - art.ox) * s, (y * 24 - art.oy) * s, 24 * s + 1, 24 * s + 1);
    }
  }
  ctx.drawImage(art.canvas, 0, 0, canvas.width, canvas.height);
  // the cup, so the pin zone the label names can be located on the picture
  const k = (canvas.width / art.w) * 1;
  const px = ((course.hole.x + 0.5) * 24 - art.ox) * k;
  const py = ((course.hole.y + 0.5) * 24 - art.oy) * k;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, 7, 0, Math.PI * 2);
  ctx.stroke();
}

function renderCourses(biome, base) {
  const counts = Object.fromEntries(ARCHETYPES.map((a) => [a, 0]));
  for (let i = 0; i < 50; i++) {
    const seed = (base + i) >>> 0;
    const course = generateCourse(seed, biome);
    counts[course.archetype]++;
    const cell = document.createElement('div');
    cell.className = 'cell';
    const canvas = document.createElement('canvas');
    canvas.title = `play seed ${seed}`;
    canvas.addEventListener('click', () => {
      window.open(`index.html#/hole/${seed}/standard/${biome}`, '_blank');
    });
    cell.append(canvas);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${seed} · ${course.archetype}`;
    cell.append(meta);
    grid.append(cell);
    drawCourse(canvas, course);
  }
  info.textContent = 'archetypes: ' + ARCHETYPES.map((a) => `${a} ${counts[a]}`).join(' · ');
}

function renderGreens(biome, base) {
  const counts = Object.fromEntries(GREEN_ARCHETYPES.map((a) => [a, 0]));
  let seed = base >>> 0;
  for (let i = 0; i < 24; i++) {
    const course = generateCourse(seed, biome);
    const g = course.green;
    counts[g.archetype] = (counts[g.archetype] ?? 0) + 1;
    const cell = document.createElement('div');
    cell.className = 'cell green-cell';
    const canvas = document.createElement('canvas');
    canvas.title = `seed ${seed}`;
    cell.append(canvas);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const roles = g.hazards.map((h) => h.role).join(', ') || 'no hazards';
    meta.innerHTML = `<b>${g.archetype}</b> · ${g.sizeClass} · ${g.areaTiles} tiles`
      + `<br>pin: ${g.pin.name}${g.tierStepFt ? ` · tier ${g.tierStepFt.toFixed(1)} ft` : ''}`
      + `<br><span class="dim">${roles}</span>`;
    cell.append(meta);
    grid.append(cell);
    drawGreen(canvas, course);
    seed = (seed + 1) >>> 0;
  }
  info.textContent = 'green archetypes: '
    + GREEN_ARCHETYPES.map((a) => `${a} ${counts[a]}`).join(' · ');
}

/** A hole the way Caddie builds one: a length band drawn from the seed. */
function caddieLength(seed) {
  const r = substream(seed >>> 0, 'yardage');
  const band = pickWeighted(r, HOLE_LENGTHS.map((b) => [b, b.weight]));
  return { tiles: randInt(r, band.min, band.max), par: band.par };
}

/** One strategic routing, with the PLAN drawn over it. */
function drawStrategy(canvas, course) {
  const s = course.strategy;
  const px = 11;
  canvas.width = course.width * px;
  canvas.height = course.height * px;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      ctx.fillStyle = terrainColor(cellAt(course, x, y));
      ctx.fillRect(x * px, y * px, px, px);
    }
  }
  const P = (p) => [(p.x + 0.5) * px, (p.y + 0.5) * px];

  // the line of play, which every number in the plan is measured against
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(...P(course.tee));
  ctx.lineTo(...P(course.hole));
  ctx.stroke();
  ctx.setLineDash([]);

  // the carry band, as the two arcs the player is actually judging
  if (s.carryBand) {
    const [tx, ty] = P(course.tee);
    ctx.strokeStyle = 'rgba(255,214,102,0.85)';
    ctx.lineWidth = 1.5;
    for (const r of [s.carryBand.near, s.carryBand.far]) {
      ctx.beginPath();
      ctx.arc(tx, ty, r * px, -Math.PI / 2.2, Math.PI / 2.2);
      ctx.stroke();
    }
  }

  // the two arms of the fork
  if (s.targets) {
    const ring = (p, color, label) => {
      const [x, y] = P(p);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(6, p.r * px), 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '600 10px ui-sans-serif, system-ui';
      ctx.fillText(label, x + 8, y - 6);
    };
    ring(s.targets.bail, '#7ee0a0', 'lay up');
    ring(s.targets.aggressive, '#ff8a5c', 'carry');
  }

  // tee and cup last, so nothing draws over them
  ctx.fillStyle = '#fff';
  ctx.fillRect(course.tee.x * px - 1, course.tee.y * px - 1, px + 2, px + 2);
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(course.hole.x * px - 1, course.hole.y * px - 1, px + 2, px + 2);
}

function renderStrategy(biome, base) {
  const counts = Object.fromEntries(TEMPLATES.map((t) => [t, 0]));
  let forked = 0;
  let seed = base >>> 0;
  for (let i = 0; i < 24; i++) {
    const { tiles, par } = caddieLength(seed);
    const course = generateCourse(seed, biome, { holeDistTiles: tiles, strategic: true });
    const s = course.strategy;
    counts[s.template] = (counts[s.template] ?? 0) + 1;
    if (s.targets) forked++;
    const cell = document.createElement('div');
    cell.className = 'cell';
    const canvas = document.createElement('canvas');
    canvas.title = `seed ${seed}`;
    cell.append(canvas);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const band = s.carryBand
      ? `carry ${(s.carryBand.near * 16).toFixed(0)}–${(s.carryBand.far * 16).toFixed(0)} yds of ${s.carryBand.kind}`
      : 'no carry band — the green is the whole decision';
    meta.innerHTML = `<b>${s.template}</b> · par ${par} · ${(tiles * 16)} yds`
      + `<br>${band}`
      + `<br><span class="dim">shelf ${s.sideName} · ${course.green.archetype} green, pin ${course.green.pin.name}</span>`;
    cell.append(meta);
    grid.append(cell);
    drawStrategy(canvas, course);
    seed = (seed + 1) >>> 0;
  }
  info.textContent = `${forked}/24 holes forked · templates: `
    + TEMPLATES.map((t) => `${t} ${counts[t]}`).join(' · ');
}

function render() {
  const biome = document.getElementById('biome').value;
  const mode = modeSel ? modeSel.value : 'courses';
  const base = (Math.random() * 0xffffffff) >>> 0;
  grid.innerHTML = '';
  grid.classList.toggle('greens', mode === 'greens');
  grid.classList.toggle('strategy', mode === 'strategy');
  if (mode === 'greens') renderGreens(biome, base);
  else if (mode === 'strategy') renderStrategy(biome, base);
  else renderCourses(biome, base);
}

document.getElementById('biome').addEventListener('change', render);
document.getElementById('reroll').addEventListener('click', render);
if (modeSel) modeSel.addEventListener('change', render);

// Deterministic sheets for the release evidence: #greens=<seed>, #strategy=<seed>.
const m = location.hash.match(/^#(greens|strategy)=(\d+)$/);
if (m) {
  const [, sheet, seed] = m;
  if (modeSel) modeSel.value = sheet;
  grid.classList.add(sheet);
  const biome = document.getElementById('biome').value;
  if (sheet === 'greens') renderGreens(biome, Number(seed) >>> 0);
  else renderStrategy(biome, Number(seed) >>> 0);
} else {
  render();
}
