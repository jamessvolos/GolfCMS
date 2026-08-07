// UI shell: routing (#/hole/<seed>[/<difficulty>] or #/daily), input, HUD.
// The engine is imported, never duplicated — the page is a thin interpreter.

import { makePuzzle, dailyPuzzle, dailyNumber, DIFFICULTIES } from '../engine/puzzle.js';
import { BIOMES } from '../engine/generate.js';
import { makeRound, scorecard } from '../engine/round.js';
import { createGame, applyShot, undoShot } from '../engine/game.js';
import { CLUBS, lieRules } from '../engine/shots.js';
import { cellAt } from '../engine/course.js';
import { draw, TILE } from './render.js';
import { recordRound, dailyStreak, summary } from '../engine/stats.js';

const ROUNDS_KEY = 'golfcms.rounds.v1';

function loadRounds() {
  try {
    return JSON.parse(localStorage.getItem(ROUNDS_KEY)) ?? [];
  } catch {
    return [];
  }
}

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
let recorded = false;
let round = null; // {data, index, strokes[]} while a 9-hole round is live

function loadFromHash() {
  const h = location.hash;
  const roundMatch = h.match(/^#\/round\/(\d+)(?:\/(\w+))?/);
  if (roundMatch) {
    const seed = Number(roundMatch[1]) >>> 0;
    const biome = BIOMES.includes(roundMatch[2]) ? roundMatch[2] : 'classic';
    if (round && round.data.seed === seed && round.data.biome === biome) return;
    startRound(seed, biome);
    return;
  }
  round = null;
  const holeMatch = h.match(/^#\/hole\/(\d+)(?:\/(\w+))?(?:\/(\w+))?/);
  if (holeMatch) {
    const difficulty = DIFFICULTIES.includes(holeMatch[2]) ? holeMatch[2] : 'standard';
    const biome = BIOMES.includes(holeMatch[3]) ? holeMatch[3] : 'classic';
    startPuzzle(makePuzzle(Number(holeMatch[1]) >>> 0, difficulty, biome), false);
  } else {
    startPuzzle(dailyPuzzle(), true);
  }
}

function startRound(seed, biome) {
  round = { data: makeRound(seed, biome), index: 0, strokes: [] };
  location.hash = `#/round/${seed}/${biome}`;
  loadRoundHole();
}

function loadRoundHole() {
  const p = round.data.holes[round.index];
  puzzle = p;
  isDaily = false;
  game = createGame(p.seed, p.start, p.biome);
  aim = null;
  recorded = false;
  toast.classList.remove('show');
  const biomeTag = p.biome !== 'classic' ? ` · ${p.biome}` : '';
  meta.textContent =
    `Round ${round.data.seed} · hole ${round.index + 1}/9 · ${p.course.archetype}${biomeTag}` +
    ` · par ${p.par} · course par ${round.data.totalPar}`;
  refresh();
}

function startPuzzle(p, daily) {
  round = null;
  puzzle = p;
  isDaily = daily;
  game = createGame(p.seed, p.start, p.biome);
  aim = null;
  recorded = false;
  toast.classList.remove('show');
  const label = daily
    ? `Daily hole #${dailyNumber()}`
    : `Hole seed ${p.seed} · ${p.difficulty}`;
  const biomeTag = p.biome && p.biome !== 'classic' ? ` · ${p.biome}` : '';
  meta.textContent = `${label} · ${p.course.archetype}${biomeTag} · par ${p.par}`;
  if (!daily) location.hash = `#/hole/${p.seed}/${p.difficulty}/${p.biome ?? 'classic'}`;
  refresh();
}

function refresh() {
  window.__game = game; // debug/test hook: read-only view of live state
  window.__debugShot = (shot) => { game = applyShot(game, shot); refresh(); };
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
  document.getElementById('undo').disabled = game.history.length === 0 || game.holed;
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
  if (round) {
    const card = scorecard(round.data, round.strokes);
    const vs = card.vsPar >= 0 ? `+${card.vsPar}` : `${card.vsPar}`;
    const holes = card.entries
      .filter((e) => e.strokes !== null)
      .map((e) => {
        const d = e.strokes - e.par;
        return e.strokes === 1 ? '🎯' : d <= -2 ? '🦅' : d === -1 ? '🐦' : d === 0 ? '🟢' : d === 1 ? '🟨' : '🟥';
      })
      .join('');
    return `Daily Links round ${round.data.seed} — ${card.totalStrokes}/${round.data.totalPar} (${vs}) ${holes}`;
  }
  const trail = g.history.map((h) => (
    { holed: '⛳', water: '🟦', 'out-of-bounds': '🟥', trees: '🌲' }[h.event] ??
    { 2: '🟨', 1: '🟩' }[cellAt(p.course, h.ball.x, h.ball.y)] ?? '🟩'
  )).join('');
  const label = daily ? `Daily Links #${dailyNumber()}` : `Daily Links seed ${p.seed}`;
  const streak = daily ? dailyStreak(loadRounds(), new Date().toISOString().slice(0, 10)) : 0;
  return `${label} — ${g.strokes}/${p.par} ${trail}` + (streak > 1 ? ` 🔥${streak}` : '');
}

function showResult() {
  const today = new Date().toISOString().slice(0, 10);
  if (!recorded) {
    recorded = true;
    localStorage.setItem(ROUNDS_KEY, JSON.stringify(recordRound(loadRounds(), {
      date: today, seed: puzzle.seed, strokes: game.strokes, par: puzzle.par, daily: isDaily,
    })));
    if (round) round.strokes[round.index] = game.strokes;
  }
  const nextBtn = document.getElementById('toast-next');
  if (round) {
    const card = scorecard(round.data, round.strokes);
    const vs = card.vsPar >= 0 ? `+${card.vsPar}` : `${card.vsPar}`;
    if (!card.complete) {
      toast.querySelector('.big').textContent = scoreWord(game.strokes, puzzle.par);
      toast.querySelector('.sub').textContent =
        `Hole ${round.index + 1} done · ${card.totalStrokes} strokes through ` +
        `${round.index + 1} (${vs})`;
      nextBtn.hidden = false;
    } else {
      toast.querySelector('.big').textContent =
        card.vsPar < 0 ? 'Under par round!' : card.vsPar === 0 ? 'Even par round.' : 'Round complete.';
      toast.querySelector('.sub').textContent =
        `${card.totalStrokes} strokes on a par-${round.data.totalPar} course (${vs})`;
      nextBtn.hidden = true;
    }
    toast.classList.add('show');
    return;
  }
  nextBtn.hidden = true;
  const rounds = loadRounds();
  const streak = dailyStreak(rounds, today);
  const s = summary(rounds);
  toast.querySelector('.big').textContent = scoreWord(game.strokes, puzzle.par);
  toast.querySelector('.sub').textContent =
    `${game.strokes} strokes on a par ${puzzle.par}` +
    (streak > 0 ? ` · 🔥 ${streak}-day streak` : '') +
    ` · ${s.rounds} rounds, avg ${s.avgVsPar >= 0 ? '+' : ''}${s.avgVsPar} vs par`;
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
  const biome = document.getElementById('biome').value;
  startPuzzle(makePuzzle((Math.random() * 0xffffffff) >>> 0, 'standard', biome), false);
});
document.getElementById('newround').addEventListener('click', () => {
  startRound((Math.random() * 0xffffffff) >>> 0, document.getElementById('biome').value);
});
document.getElementById('toast-next').addEventListener('click', () => {
  if (!round) return;
  round.index++;
  loadRoundHole();
});
document.getElementById('daily').addEventListener('click', () => {
  location.hash = '';
  startPuzzle(dailyPuzzle(), true);
});
document.getElementById('share').addEventListener('click', () => {
  const url = `${location.origin}${location.pathname}#/hole/${puzzle.seed}/${puzzle.difficulty}/${puzzle.biome ?? 'classic'}`;
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
