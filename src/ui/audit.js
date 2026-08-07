// Generator audit grid: 50 raw courses on one screen. This is the "fast
// human review" gate from the winning proposal — procedural oatmeal and
// broken layouts jump out visually long before players ever see them.

import { generateCourse, ARCHETYPES } from '../engine/generate.js';
import { cellAt } from '../engine/course.js';
import { terrainColor } from './render.js';

const grid = document.getElementById('grid');
const info = document.getElementById('info');

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

function render() {
  const biome = document.getElementById('biome').value;
  const base = (Math.random() * 0xffffffff) >>> 0;
  grid.innerHTML = '';
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
  info.textContent = 'archetypes: ' +
    ARCHETYPES.map((a) => `${a} ${counts[a]}`).join(' · ');
}

document.getElementById('biome').addEventListener('change', render);
document.getElementById('reroll').addEventListener('click', render);
render();
