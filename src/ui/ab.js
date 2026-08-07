// Blind A/B gate: six hand-authored holes shuffled against six freshly
// generated ones, rendered identically. If the generator's work is regularly
// mistaken for the architect's, it passes the bake-off.

import { AUTHORED_HOLES, parseArt } from '../engine/authored.js';
import { generateCourse } from '../engine/generate.js';
import { cellAt } from '../engine/course.js';
import { terrainColor } from './render.js';

const STORE_KEY = 'golfcms.ab.v1';
const TARGET = 45; // % of generated holes misread as authored

const canvas = document.getElementById('thumb');
const progressEl = document.getElementById('progress');
const quizEl = document.getElementById('quiz');
const resultsEl = document.getElementById('results');
const verdictEl = document.getElementById('verdict');
const breakdownEl = document.getElementById('breakdown');
const bestEl = document.getElementById('best');

let deck = [];
let index = 0;
let guesses = [];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// One renderer for both groups: same scale, same white tee, same red hole.
// Nothing in the pixels betrays which side a course came from.
function drawCourse(course) {
  const s = 16;
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
  ctx.fillRect(course.tee.x * s - 2, course.tee.y * s - 2, s + 4, s + 4);
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(course.hole.x * s - 2, course.hole.y * s - 2, s + 4, s + 4);
}

function newRound() {
  deck = AUTHORED_HOLES.map((h) => ({
    kind: 'authored',
    label: h.name,
    course: parseArt(h.art),
  }));
  for (let i = 0; i < 6; i++) {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    deck.push({ kind: 'generated', label: `seed ${seed}`, course: generateCourse(seed) });
  }
  shuffle(deck);
  index = 0;
  guesses = [];
  quizEl.hidden = false;
  resultsEl.hidden = true;
  showCurrent();
}

function showCurrent() {
  progressEl.textContent = `Course ${index + 1} of ${deck.length} — who made this?`;
  drawCourse(deck[index].course);
}

function bestRate() {
  const raw = Number(localStorage.getItem(STORE_KEY));
  return Number.isFinite(raw) ? raw : 0;
}

function guess(kind) {
  guesses.push(kind);
  index++;
  if (index < deck.length) {
    showCurrent();
  } else {
    finish();
  }
}

function finish() {
  const correct = deck.filter((e, i) => guesses[i] === e.kind).length;
  const gen = deck.filter((e) => e.kind === 'generated');
  const fooled = deck.filter((e, i) => e.kind === 'generated' && guesses[i] === 'authored').length;
  const rate = Math.round((fooled / gen.length) * 100);

  let best = bestRate();
  if (rate > best) {
    best = rate;
    localStorage.setItem(STORE_KEY, String(rate));
  }

  quizEl.hidden = true;
  resultsEl.hidden = false;
  verdictEl.innerHTML =
    `You identified <b>${correct} / ${deck.length}</b> correctly.<br>` +
    `<span class="big ${rate >= TARGET ? 'pass' : 'fail'}">${rate}%</span> of generated holes ` +
    `fooled you into calling them authored — target &ge; ${TARGET}%. ` +
    (rate >= TARGET
      ? 'The generator passes the blind gate.'
      : 'The generator still reads as a machine.');
  bestEl.textContent = `Best-ever misidentification rate on this device: ${best}%`;

  breakdownEl.innerHTML = '';
  deck.forEach((e, i) => {
    const li = document.createElement('li');
    const ok = guesses[i] === e.kind;
    li.textContent = `${i + 1}. ${e.kind} (${e.label}) — you said ${guesses[i]} ${ok ? '✓' : '✗'}`;
    li.className = ok ? 'right' : 'wrong';
    breakdownEl.append(li);
  });
}

document.getElementById('say-authored').addEventListener('click', () => guess('authored'));
document.getElementById('say-generated').addEventListener('click', () => guess('generated'));
document.getElementById('again').addEventListener('click', newRound);

newRound();
