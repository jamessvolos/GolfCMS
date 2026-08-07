// UI shell: routing (#/hole/<seed>[/<difficulty>] or #/daily), input, HUD.
// The engine is imported, never duplicated — the page is a thin interpreter.

import { makePuzzle, dailyPuzzle, dailyNumber, DIFFICULTIES } from '../engine/puzzle.js';
import { createGame, applyShot, undoShot } from '../engine/game.js';
import { CLUBS, lieRules } from '../engine/shots.js';
import { cellAt } from '../engine/course.js';
import { draw, TILE } from './render.js';

const canvas = document.getElementById('course');
const ctx = canvas.getContext('2d');
const meta = document.getElementById('meta');
const score = document.getElementById('score');
const toast = document.getElementById('toast');

let puzzle = null;
let game = null;
let club = 'iron';
let power = 2;
let aim = null;
let isDaily = false;

function loadFromHash() {
  const h = location.hash;
  const holeMatch = h.match(/^#\/hole\/(\d+)(?:\/(\w+))?/);
  if (holeMatch) {
    const difficulty = DIFFICULTIES.includes(holeMatch[2]) ? holeMatch[2] : 'standard';
    startPuzzle(makePuzzle(Number(holeMatch[1]) >>> 0, difficulty), false);
  } else {
    startPuzzle(dailyPuzzle(), true);
  }
}

function startPuzzle(p, daily) {
  puzzle = p;
  isDaily = daily;
  game = createGame(p.seed, p.start);
  aim = null;
  toast.classList.remove('show');
  const label = daily
    ? `Daily hole #${dailyNumber()}`
    : `Hole seed ${p.seed} · ${p.difficulty}`;
  meta.textContent = `${label} · ${p.course.archetype} · par ${p.par}`;
  if (!daily) location.hash = `#/hole/${p.seed}/${p.difficulty}`;
  refresh();
}

function refresh() {
  updateHud();
  draw(ctx, puzzle.course, game, aim);
  if (game.holed) showResult();
}

function updateHud() {
  score.textContent = `Par ${puzzle.par} · Strokes ${game.strokes}`;
  const rules = lieRules(cellAt(puzzle.course, game.ball.x, game.ball.y));
  for (const b of document.querySelectorAll('[data-club]')) {
    b.disabled = game.holed || !rules.allowed.includes(b.dataset.club);
    b.classList.toggle('active', b.dataset.club === club);
  }
  if (!rules.allowed.includes(club)) {
    club = rules.allowed[rules.allowed.length - 1];
    updateHud();
    return;
  }
  for (const b of document.querySelectorAll('[data-power]')) {
    b.classList.toggle('active', Number(b.dataset.power) === power);
  }
  document.getElementById('undo').disabled = game.history.length === 0;
}

/** Nominal landing band: aim line reach plus the club's scatter width. */
function computePreview(angle) {
  const rules = lieRules(cellAt(puzzle.course, game.ball.x, game.ball.y));
  const c = CLUBS[club];
  const range = Math.max(1, Math.round(c.ranges[power - 1] * rules.rangeScale));
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const tiles = [];
  if (c.flight === 'ground') {
    for (let s = 1; s <= range; s++) {
      tiles.push({ x: Math.round(game.ball.x + dx * s), y: Math.round(game.ball.y + dy * s) });
    }
  } else {
    for (let s = -c.scatter; s <= c.scatter; s++) {
      tiles.push({
        x: Math.round(game.ball.x + dx * range - dy * s),
        y: Math.round(game.ball.y + dy * range + dx * s),
      });
    }
  }
  return { angle, range, preview: tiles };
}

canvas.addEventListener('mousemove', (e) => {
  if (game.holed) return;
  const r = canvas.getBoundingClientRect();
  const scale = canvas.width / r.width;
  const mx = (e.clientX - r.left) * scale / TILE - 0.5;
  const my = (e.clientY - r.top) * scale / TILE - 0.5;
  aim = computePreview(Math.atan2(my - game.ball.y, mx - game.ball.x));
  refresh();
});

canvas.addEventListener('click', () => {
  if (game.holed || !aim) return;
  game = applyShot(game, { club, angle: aim.angle, power });
  aim = null;
  refresh();
});

function scoreWord(strokes, par) {
  const d = strokes - par;
  if (strokes === 1) return 'Ace!';
  if (d <= -2) return 'Eagle!';
  if (d === -1) return 'Birdie!';
  if (d === 0) return 'Par.';
  if (d === 1) return 'Bogey.';
  if (d === 2) return 'Double bogey.';
  return 'Rough day.';
}

export function resultText(g, p, daily) {
  const trail = g.history.map((h) => (
    { holed: '⛳', water: '🟦', 'out-of-bounds': '🟥', trees: '🌲' }[h.event] ??
    { 2: '🟨', 1: '🟩' }[cellAt(p.course, h.ball.x, h.ball.y)] ?? '🟩'
  )).join('');
  const label = daily ? `Daily Links #${dailyNumber()}` : `Daily Links seed ${p.seed}`;
  return `${label} — ${g.strokes}/${p.par} ${trail}`;
}

function showResult() {
  toast.querySelector('.big').textContent = scoreWord(game.strokes, puzzle.par);
  toast.querySelector('.sub').textContent = `${game.strokes} strokes on a par ${puzzle.par}`;
  toast.classList.add('show');
}

document.getElementById('toast-share').addEventListener('click', () => {
  navigator.clipboard?.writeText(resultText(game, puzzle, isDaily) + '\n' + location.href);
});
document.getElementById('undo').addEventListener('click', () => {
  game = undoShot(game);
  toast.classList.remove('show');
  refresh();
});
document.getElementById('new').addEventListener('click', () => {
  startPuzzle(makePuzzle((Math.random() * 0xffffffff) >>> 0, 'standard'), false);
});
document.getElementById('daily').addEventListener('click', () => {
  location.hash = '';
  startPuzzle(dailyPuzzle(), true);
});
document.getElementById('share').addEventListener('click', () => {
  const url = `${location.origin}${location.pathname}#/hole/${puzzle.seed}/${puzzle.difficulty}`;
  navigator.clipboard?.writeText(url);
});
for (const b of document.querySelectorAll('[data-club]')) {
  b.addEventListener('click', () => { club = b.dataset.club; refresh(); });
}
for (const b of document.querySelectorAll('[data-power]')) {
  b.addEventListener('click', () => { power = Number(b.dataset.power); refresh(); });
}
window.addEventListener('hashchange', loadFromHash);

loadFromHash();
