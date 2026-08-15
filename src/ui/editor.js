// Creator mode: paint terrain over a generated base course, certify the
// result with the real solver, and share it as seed + patch in a URL.

import { generateCourse } from '../engine/generate.js';
import { cellAt, setCell, inBounds } from '../engine/course.js';
import { TERRAIN_NAMES, FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN, ICE, SLOPE_N, SLOPE_S, SLOPE_E, SLOPE_W, slopeDir } from '../engine/terrain.js';
import { solve } from '../engine/solver.js';
import { diffCourses, encodePatch, encodeGridPatch } from '../engine/patch.js';
import { detectTerrain } from '../engine/aerial.js';
import { photoKey, savePlayPhoto } from './photo.js';
import { encodeGeoRef, geoFromAnchors, parseLatLon } from '../engine/georef.js';
import { fetchSatelliteGround } from './satellite.js';
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
  document.getElementById('playCaddie').disabled = true;
}

// --- the aerial underlay -----------------------------------------------------
// The path to playing real holes. A local image — a satellite or drone
// capture the user already has — draws UNDER the tile grid, and the ground
// fades to a translucent tracing layer over it. Align it (pan/zoom/rotate so
// the real tee and cup sit on the anchors), let detection draft the trace,
// correct it, certify, share. Two rules keep it honest:
//   THE TILES ARE STILL THE TRUTH. The engine scores the mask, not the photo.
//   Detection is a first draft of the trace, never an authority.
//   THE IMAGE NEVER LEAVES THE MACHINE. It is session-state, not course data:
//   a shared URL carries seed + patch, so redistribution of imagery — the
//   entire licensing question — never arises.
let underlay = null; // {img, k} — k is the cover-fit factor; user transform below
let traceAlpha = 0.45;
let uZoom = 1; // user zoom on top of cover-fit
let uRot = 0; // degrees
let uPan = { x: 0, y: 0 }; // canvas px
let moveMode = false; // drag pans the photo instead of painting
let panning = null; // {x, y} pointer position while dragging the photo

const underlayCtls = ['tracectl', 'zoomctl', 'rotctl', 'uMove', 'detect', 'clearUnderlay'];

/** Paint the underlay onto any 2d context with the current user transform. */
function drawUnderlayTo(c) {
  const { img, k } = underlay;
  c.save();
  c.translate(canvas.width / 2 + uPan.x, canvas.height / 2 + uPan.y);
  c.rotate((uRot * Math.PI) / 180);
  c.scale(k * uZoom, k * uZoom);
  c.drawImage(img, -img.width / 2, -img.height / 2);
  c.restore();
}

document.getElementById('underlay').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    underlay = { img, k: Math.max(canvas.width / img.width, canvas.height / img.height) };
    uZoom = 1; uRot = 0; uPan = { x: 0, y: 0 };
    document.getElementById('uZoom').value = 100;
    document.getElementById('uRot').value = 0;
    for (const id of underlayCtls) document.getElementById(id).hidden = false;
    document.getElementById('underlayNote').textContent =
      'align the photo (zoom/rotate/move) so tee and cup match, then Detect or paint';
    draw();
  };
  img.src = URL.createObjectURL(file);
});
document.getElementById('traceAlpha').addEventListener('input', (e) => {
  traceAlpha = Number(e.target.value) / 100;
  draw();
});
document.getElementById('uZoom').addEventListener('input', (e) => {
  uZoom = Number(e.target.value) / 100;
  draw();
});
document.getElementById('uRot').addEventListener('input', (e) => {
  uRot = Number(e.target.value);
  draw();
});
const moveBtn = document.getElementById('uMove');
moveBtn.addEventListener('click', () => {
  moveMode = !moveMode;
  moveBtn.setAttribute('aria-pressed', String(moveMode));
  moveBtn.classList.toggle('active', moveMode);
  canvas.style.cursor = moveMode ? 'grab' : 'crosshair';
});
// --- fetched imagery: coordinates in, satellite underlay out ----------------
// The two geo anchors fully determine where on Earth the board sits, so the
// composed imagery arrives pre-aligned: k=1, no pan, no rotate — the anchors
// ARE the alignment. Mapbox with the player's own token (global), USGS NAIP
// without one (US), painted-tiles workflow unchanged if neither answers.
const tokenInput = document.getElementById('imgToken');
try { tokenInput.value = localStorage.getItem('golfcms.imagery.token') ?? ''; } catch { /* blocked */ }
tokenInput.addEventListener('change', () => {
  try { localStorage.setItem('golfcms.imagery.token', tokenInput.value.trim()); } catch { /* best-effort */ }
});
document.getElementById('fetchImagery').addEventListener('click', async () => {
  const note = document.getElementById('underlayNote');
  const teeLL = parseLatLon(document.getElementById('geoTee').value);
  const cupLL = parseLatLon(document.getElementById('geoCup').value);
  if (!teeLL || !cupLL) {
    note.textContent = 'enter tee and cup lat,lon first — two anchors are the whole alignment';
    return;
  }
  let geo;
  try {
    geo = geoFromAnchors({
      tee: course.tee, cup: course.hole, teeLL, cupLL,
      width: course.width, height: course.height,
    });
  } catch (e) {
    note.textContent = `bad anchors: ${e.message}`;
    return;
  }
  note.textContent = 'fetching imagery…';
  const sat = await fetchSatelliteGround(geo, course);
  if (!sat) {
    note.textContent = 'no imagery reachable — check the token, or load a local file instead';
    return;
  }
  underlay = { img: sat.canvas, k: 1 };
  uZoom = 1; uRot = 0; uPan = { x: 0, y: 0 };
  document.getElementById('uZoom').value = 100;
  document.getElementById('uRot').value = 0;
  for (const id of underlayCtls) document.getElementById(id).hidden = false;
  note.textContent = `imagery ${sat.attribution} — pre-aligned by the anchors: Detect or paint`;
  draw();
});

document.getElementById('clearUnderlay').addEventListener('click', () => {
  underlay = null;
  moveMode = false;
  moveBtn.setAttribute('aria-pressed', 'false');
  moveBtn.classList.remove('active');
  canvas.style.cursor = 'crosshair';
  document.getElementById('underlay').value = '';
  for (const id of underlayCtls) document.getElementById(id).hidden = true;
  document.getElementById('underlayNote').textContent = '';
  draw();
});

// --- detection: the classifier drafts the trace ------------------------------
document.getElementById('detect').addEventListener('click', () => {
  if (!underlay) return;
  // render the aligned photo alone, then hand per-tile samples to the engine
  const off = document.createElement('canvas');
  off.width = canvas.width;
  off.height = canvas.height;
  const octx = off.getContext('2d', { willReadFrequently: true });
  drawUnderlayTo(octx);
  const px = octx.getImageData(0, 0, off.width, off.height).data;
  const STEP = 4; // 36 samples per 24px tile
  const tileSamples = (tx, ty) => {
    const samples = [];
    for (let y = ty * TILE + 2; y < (ty + 1) * TILE; y += STEP) {
      for (let x = tx * TILE + 2; x < (tx + 1) * TILE; x += STEP) {
        const i = (y * off.width + x) * 4;
        if (px[i + 3] < 128) continue; // outside the photo after alignment
        samples.push([px[i], px[i + 1], px[i + 2]]);
      }
    }
    return samples;
  };
  const cells = detectTerrain({
    width: course.width, height: course.height, tileSamples, hole: course.hole,
  });
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      if ((x === course.tee.x && y === course.tee.y) ||
          (x === course.hole.x && y === course.hole.y)) continue;
      setCell(course, x, y, cells[y * course.width + x]);
    }
  }
  invalidate();
  draw();
  document.getElementById('underlayNote').textContent =
    'detected — a first draft: fix what it got wrong, then Certify';
});

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (underlay) {
    drawUnderlayTo(ctx);
    ctx.globalAlpha = traceAlpha;
  }
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
  // tee and cup punch through the tracing alpha: they are the two facts a
  // trace is anchored to, so they never fade with the ground
  ctx.globalAlpha = 1;
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

canvas.addEventListener('mousedown', (e) => {
  if (moveMode && underlay) {
    panning = { x: e.clientX, y: e.clientY };
    canvas.style.cursor = 'grabbing';
    return;
  }
  painting = true;
  paintAt(e);
});
canvas.addEventListener('mousemove', (e) => {
  if (panning) {
    const r = canvas.getBoundingClientRect();
    uPan.x += (e.clientX - panning.x) * (canvas.width / r.width);
    uPan.y += (e.clientY - panning.y) * (canvas.height / r.height);
    panning = { x: e.clientX, y: e.clientY };
    draw();
    return;
  }
  if (painting) paintAt(e);
});
window.addEventListener('mouseup', () => {
  painting = false;
  if (panning) {
    panning = null;
    canvas.style.cursor = moveMode ? 'grab' : 'crosshair';
  }
});

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
    certified = { par: solved.strokes };
    // big edits (a full aerial trace) ship as a whole-grid patch instead of a
    // diff, so there is no ceiling on how much of the board a trace repaints
    verdict.textContent = `✓ certified · par ${solved.strokes} · ${edits.length} edits` +
      (edits.length > 400 ? ' · full-grid share' : '');
    // certified with an aerial loaded: park the baked ground for the arcade
    if (underlay) bakePlayPhoto().catch(() => { /* storage blocked: photo is a bonus */ });
    document.getElementById('share').disabled = false;
    document.getElementById('play').disabled = false;
    document.getElementById('playCaddie').disabled = false;
  }, 10);
});

function currentPatchStr() {
  const edits = diffCourses(base, course);
  return edits.length > 400 ? encodeGridPatch(course.cells) : encodePatch(edits);
}

/** The georeference, when the author pinned the hole to Earth: two lat/lon
 *  anchors (tee, cup) fully determine scale, rotation, and place. Invalid or
 *  empty fields simply mean no geo — never an error. */
function currentGeoStr() {
  const teeLL = parseLatLon(document.getElementById('geoTee')?.value);
  const cupLL = parseLatLon(document.getElementById('geoCup')?.value);
  if (!teeLL || !cupLL) return null;
  try {
    return encodeGeoRef(geoFromAnchors({
      tee: course.tee, cup: course.hole, teeLL, cupLL,
      width: course.width, height: course.height,
      vintage: new Date().getUTCFullYear(),
    }));
  } catch {
    return null;
  }
}

function challengeUrl() {
  const patch = currentPatchStr();
  const geo = currentGeoStr();
  // the #/hole route lives in the ARCADE — index.html is the Caddie surface
  // and would silently fall back to its daily. `photo=1` tells the arcade a
  // baked ground may be waiting in IndexedDB; the URL itself stays imagery-free.
  return `${location.origin}${location.pathname.replace(/editor\.html$/, 'arcade.html')}` +
    `#/hole/${base.seed}/standard/${base.biome}` +
    (patch ? `?p=${patch}${underlay ? '&photo=1' : ''}${geo ? `&geo=${geo}` : ''}` : '');
}

/** The same trace as a Caddie strategy hole: the #/traced route, Wave 2. */
function caddieUrl() {
  const geo = currentGeoStr();
  return `${location.origin}${location.pathname.replace(/editor\.html$/, 'index.html')}` +
    `#/traced/${base.seed}/${base.biome}?p=${currentPatchStr()}` +
    `${underlay ? '&photo=1' : ''}${geo ? `&geo=${geo}` : ''}`;
}

/** The Thin Coat handoff: bake the aligned photo once at world resolution and
 *  park it for the arcade. One image across one page boundary — never a URL. */
async function bakePlayPhoto() {
  const off = document.createElement('canvas');
  off.width = canvas.width;
  off.height = canvas.height;
  drawUnderlayTo(off.getContext('2d'));
  const blob = await new Promise((r) => off.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) return;
  await savePlayPhoto(photoKey(base.seed, base.biome, currentPatchStr()), {
    blob,
    align: { k: underlay.k, uZoom, uRot, uPan }, // provenance for a future re-edit
    savedAt: Date.now(),
  });
}

document.getElementById('share').addEventListener('click', () => {
  navigator.clipboard?.writeText(`My custom par-${certified.par} hole: ${challengeUrl()}`);
});
document.getElementById('play').addEventListener('click', () => window.open(challengeUrl(), '_blank'));
document.getElementById('playCaddie').addEventListener('click', () => window.open(caddieUrl(), '_blank'));
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
