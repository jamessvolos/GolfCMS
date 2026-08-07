// Creator mode: paint terrain over a generated base course, certify the
// result with the real solver, and share it as seed + patch in a URL.

import { generateCourse } from '../engine/generate.js';
import { cellAt, setCell, inBounds } from '../engine/course.js';
import { TERRAIN_NAMES, FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN, ICE, SLOPE_N, SLOPE_S, SLOPE_E, SLOPE_W, slopeDir } from '../engine/terrain.js';
import { solve } from '../engine/solver.js';
import { diffCourses, encodePatch } from '../engine/patch.js';
import { terrainColor } from './render.js';

const PALETTE = [
  { t: FAIRWAY, label: 'fairway' }, { t: ROUGH, label: 'rough' },
  { t: SAND, label: 'sand' }, { t: WATER, label: 'water' },
  { t: TREES, label: 'trees' }, { t: GREEN, label: 'green' },
  { t: ICE, label: 'ice' }, { t: SLOPE_N, label: 'slope ↑' },
  { t: SLOPE_S, label: 'slope ↓' }, { t: SLOPE_E, label: 'slope →' },
  { t: SLOPE_W, label: 'slope ←' },
];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const verdict = document.getElementById('verdict');
const TILE = 24;

let base = null;
let course = null;
let brush = SAND;
let certified = null; // {par} once the current edit state is solver-approved
let painting = false;

function load(seed, biome) {
  base = generateCourse(seed >>> 0, biome);
  course = { ...base, cells: [...base.cells] };
  invalidate();
  draw();
}

function invalidate() {
  certified = null;
  verdict.textContent = 'uncertified — hit Certify';
  document.getElementById('share').disabled = true;
  document.getElementById('play').disabled = true;
}

function draw() {
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      const t = cellAt(course, x, y);
      ctx.fillStyle = terrainColor(t);
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      const dir = slopeDir(t);
      if (dir) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        const cx = x * TILE + 12, cy = y * TILE + 12;
        const a = Math.atan2(dir.y, dir.x);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7);
        ctx.lineTo(cx + Math.cos(a + 2.5) * 6, cy + Math.sin(a + 2.5) * 6);
        ctx.lineTo(cx + Math.cos(a - 2.5) * 6, cy + Math.sin(a - 2.5) * 6);
        ctx.closePath();
        ctx.fill();
      }
      if (course.cells[y * course.width + x] !== base.cells[y * course.width + x]) {
        ctx.strokeStyle = 'rgba(255,209,102,0.5)';
        ctx.strokeRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
      }
    }
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(course.tee.x * TILE + 6, course.tee.y * TILE + 6, 12, 12);
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.arc((course.hole.x + 0.5) * TILE, (course.hole.y + 0.5) * TILE, 7, 0, Math.PI * 2);
  ctx.fill();
}

function paintAt(e) {
  const r = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - r.left) * (canvas.width / r.width)) / TILE);
  const y = Math.floor(((e.clientY - r.top) * (canvas.height / r.height)) / TILE);
  if (!inBounds(course, x, y)) return;
  if ((x === course.tee.x && y === course.tee.y) || (x === course.hole.x && y === course.hole.y)) return;
  if (cellAt(course, x, y) === brush) return;
  setCell(course, x, y, brush);
  invalidate();
  draw();
}

canvas.addEventListener('mousedown', (e) => { painting = true; paintAt(e); });
canvas.addEventListener('mousemove', (e) => { if (painting) paintAt(e); });
window.addEventListener('mouseup', () => { painting = false; });

document.getElementById('certify').addEventListener('click', () => {
  verdict.textContent = 'solving…';
  setTimeout(() => {
    const solved = solve(course, course.tee);
    if (!solved) {
      certified = null;
      verdict.textContent = '✗ unsolvable — carve a path';
      return;
    }
    const edits = diffCourses(base, course);
    if (edits.length > 400) {
      certified = null;
      verdict.textContent = `✗ too many edits (${edits.length}/400)`;
      return;
    }
    certified = { par: solved.strokes };
    verdict.textContent = `✓ certified · par ${solved.strokes} · ${edits.length} edits`;
    document.getElementById('share').disabled = false;
    document.getElementById('play').disabled = false;
  }, 10);
});

function challengeUrl() {
  const patch = encodePatch(diffCourses(base, course));
  return `${location.origin}${location.pathname.replace(/editor\.html$/, 'index.html')}` +
    `#/hole/${base.seed}/standard/${base.biome}${patch ? `?p=${patch}` : ''}`;
}

document.getElementById('share').addEventListener('click', () => {
  navigator.clipboard?.writeText(`My custom par-${certified.par} hole: ${challengeUrl()}`);
});
document.getElementById('play').addEventListener('click', () => window.open(challengeUrl(), '_blank'));
document.getElementById('load').addEventListener('click', () => {
  load(Number(document.getElementById('seed').value) >>> 0, document.getElementById('biome').value);
});
document.getElementById('random').addEventListener('click', () => {
  const seed = (Math.random() * 0xffffffff) >>> 0;
  document.getElementById('seed').value = seed;
  load(seed, document.getElementById('biome').value);
});
document.getElementById('reset').addEventListener('click', () => {
  course = { ...base, cells: [...base.cells] };
  invalidate();
  draw();
});

const paletteEl = document.getElementById('palette');
for (const { t, label } of PALETTE) {
  const b = document.createElement('button');
  b.innerHTML = `<span class="swatch" style="background:${terrainColor(t)}"></span>${label}`;
  b.classList.toggle('active', t === brush);
  b.addEventListener('click', () => {
    brush = t;
    for (const other of paletteEl.children) other.classList.remove('active');
    b.classList.add('active');
  });
  paletteEl.append(b);
}

// expose for tests
window.__editor = { get course() { return course; }, get base() { return base; }, load };
load(42, 'classic');
