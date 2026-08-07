// CMS admin page: catalog CRUD over localStorage, thumbnails rendered by the
// same engine that plays the game. The catalog stores (seed, difficulty,
// status) — courses are always re-derived, never persisted.

import { generateBatch, makeRecord, setStatus, exportCatalog, importCatalog, decodeShareCode } from '../engine/catalog.js';
import { generateCourse } from '../engine/generate.js';
import { cellAt } from '../engine/course.js';
import { terrainColor } from './render.js';

const STORE_KEY = 'golfcms.catalog.v1';
const grid = document.getElementById('grid');
const statusEl = document.getElementById('status');

let records = load();

function load() {
  try {
    return importCatalog(localStorage.getItem(STORE_KEY) ?? '');
  } catch {
    return [];
  }
}

function save() {
  localStorage.setItem(STORE_KEY, exportCatalog(records));
}

function drawThumb(canvas, record) {
  const course = generateCourse(record.seed, record.biome ?? 'classic');
  const s = 7;
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
  ctx.beginPath();
  ctx.arc((record.start.x + 0.5) * s, (record.start.y + 0.5) * s, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.arc((course.hole.x + 0.5) * s, (course.hole.y + 0.5) * s, 3, 0, Math.PI * 2);
  ctx.fill();
}

function render() {
  const filter = document.getElementById('filter').value;
  const visible = records.filter((r) => filter === 'all' || r.status === filter);
  grid.innerHTML = '';
  document.getElementById('empty').hidden = visible.length > 0;
  for (const r of visible) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <canvas></canvas>
      <div class="row">
        <span class="code">${r.code}</span>
        <span class="badge ${r.status}">${r.status}</span>
      </div>
      <div class="row">
        <span class="meta">seed ${r.seed} · ${r.archetype} · ${r.difficulty}${r.biome && r.biome !== 'classic' ? ' · ' + r.biome : ''} · par ${r.par}</span>
        <span class="actions">
          <button data-act="play">Play</button>
          <button data-act="approve">Approve</button>
          <button data-act="reject">Reject</button>
          <button data-act="delete">Delete</button>
        </span>
      </div>`;
    drawThumb(card.querySelector('canvas'), r);
    card.addEventListener('click', (e) => {
      const act = e.target.dataset?.act;
      if (!act) return;
      if (act === 'play') {
        window.open(`index.html#/hole/${r.seed}/${r.difficulty}/${r.biome ?? 'classic'}`, '_blank');
      } else if (act === 'delete') {
        records = records.filter((x) => x !== r);
        save();
        render();
      } else {
        records = records.map((x) => (x === r ? setStatus(x, act === 'approve' ? 'approved' : 'rejected') : x));
        save();
        render();
      }
    });
    grid.append(card);
  }
  const counts = { generated: 0, approved: 0, rejected: 0 };
  for (const r of records) counts[r.status]++;
  statusEl.textContent =
    `${records.length} puzzles · ${counts.approved} approved · ${counts.rejected} rejected`;
}

document.getElementById('generate').addEventListener('click', () => {
  const count = Math.max(1, Math.min(60, Number(document.getElementById('count').value) || 12));
  const difficulty = document.getElementById('difficulty').value;
  const biome = document.getElementById('biomeSel').value;
  const base = (Math.random() * 0xffffffff) >>> 0;
  statusEl.textContent = `certifying ${count} candidates…`;
  setTimeout(() => {
    const existing = new Set(records.map((r) => r.code));
    records = [...generateBatch(base, count, difficulty, biome).filter((r) => !existing.has(r.code)), ...records];
    save();
    render();
  }, 10);
});

document.getElementById('filter').addEventListener('change', render);

document.getElementById('export').addEventListener('click', () => {
  const blob = new Blob([exportCatalog(records)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'golfcms-catalog.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('import').addEventListener('click', () => {
  document.getElementById('importFile').click();
});
document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const imported = importCatalog(await file.text());
    const existing = new Set(records.map((r) => r.code));
    records = [...records, ...imported.filter((r) => !existing.has(r.code))];
    save();
    render();
  } catch (err) {
    statusEl.textContent = `import failed: ${err.message}`;
  }
});

document.getElementById('redeem').addEventListener('change', (e) => {
  try {
    const { seed, difficulty, biome } = decodeShareCode(e.target.value);
    const existing = new Set(records.map((r) => r.code));
    const rec = makeRecord(seed, difficulty, biome);
    if (!existing.has(rec.code)) {
      records = [rec, ...records];
      save();
      render();
    }
    window.open(`index.html#/hole/${seed}/${difficulty}/${biome}`, '_blank');
  } catch (err) {
    statusEl.textContent = err.message;
  }
});

render();
