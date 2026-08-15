// UI shell: routing (#/hole/<seed>[/<difficulty>] or #/daily), input, HUD.
// The engine is imported, never duplicated — the page is a thin interpreter.

import { makePuzzle, dailyPuzzle, dailyNumber, DIFFICULTIES } from '../engine/puzzle.js';
import { BIOMES } from '../engine/generate.js';
import { makeRound, scorecard } from '../engine/round.js';
import { encodeReplay, decodeReplay, ghostPath, quantizeAngle } from '../engine/replay.js';
import { makeGauntlet } from '../engine/gauntlet.js';
import { generateCourse } from '../engine/generate.js';
import { decodePatch, applyPatch } from '../engine/patch.js';
import { solve } from '../engine/solver.js';
import { estimateStars, starLabel, calibration } from '../engine/difficulty.js';
import { initSound, play, setMuted, isMuted } from './sound.js';
import { photoKey, loadPlayPhoto } from './photo.js';
import { decodeGeoRef, formatGeo } from '../engine/georef.js';
import { applyShot } from '../engine/game.js';
import { CLUBS, lieRules } from '../engine/shots.js';
import { cellAt } from '../engine/course.js';
import { SAND, ICE, slopeDir } from '../engine/terrain.js';
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

/** Build game state directly from the puzzle's course, so patched (creator
 *  mode) courses survive both play and undo without regeneration. */
function freshGame(p) {
  return {
    course: p.course,
    start: { ...p.start },
    ball: { ...p.start },
    strokes: 0,
    holed: false,
    history: [],
  };
}

/** Undo by replaying all but the last shot against the same course. */
function rewindOne(g) {
  if (g.history.length === 0) return g;
  let fresh = freshGame({ course: g.course, start: g.start });
  for (const entry of g.history.slice(0, -1)) fresh = applyShot(fresh, entry.shot);
  return fresh;
}
let ghost = null; // {positions, index, holed, strokes} while racing a replay
let anim = null; // {from, to, t0} while the ball is in flight
let photo = null; // {img, alpha} — the traced hole's baked aerial, when this machine has it

/** Show/hide the ground-opacity control with the photo it governs. */
function setPhoto(next) {
  photo = next;
  const ctl = document.getElementById('photoctl');
  if (ctl) ctl.hidden = !next;
}

function loadFromHash() {
  const [h, query] = location.hash.split('?');
  if (h.startsWith('#/gauntlet')) {
    const g = makeGauntlet();
    if (round && round.data.label === g.label) return;
    round = { data: g, index: 0, strokes: [] };
    loadRoundHole();
    return;
  }
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
    const params = new URLSearchParams(query ?? '');
    const patchStr = params.get('p');
    if (patchStr) {
      // Creator-mode hole: generated base + author's patch, par recomputed.
      try {
        const seed = Number(holeMatch[1]) >>> 0;
        // creator-mode holes are arcade holes: classic disc, like the puzzle path
        const base = generateCourse(seed, biome, { legacyGreen: true });
        const course = applyPatch(base, decodePatch(patchStr));
        const solved = solve(course, course.tee);
        startPuzzle({
          seed, difficulty: 'standard', biome, course,
          start: { ...course.tee },
          par: solved ? solved.strokes : 0,
          certificate: solved ?? { strokes: 0, line: [] },
          custom: true,
        }, false);
        meta.textContent = `Custom hole · seed ${seed} · ${biome} · par ${solved ? solved.strokes : '?'}`;
        // provenance: a georeferenced trace says where on Earth it is
        try {
          const geoStr = params.get('geo');
          if (geoStr) meta.textContent += ` · ${formatGeo(decodeGeoRef(geoStr))}`;
        } catch { /* malformed geo is dropped, never fatal */ }
        // the trace's baked aerial, if this machine has it: the photo ground.
        // Key mismatch or absence loads nothing — tile-only is the fallback.
        if (params.get('photo')) {
          const key = photoKey(seed, biome, patchStr);
          loadPlayPhoto(key).then((rec) => {
            if (!rec || puzzle?.seed !== seed) return;
            const img = new Image();
            img.onload = () => {
              let alpha = 0.45;
              try { alpha = Number(localStorage.getItem('golfcms.photo.alpha')) || 0.45; } catch { /* default */ }
              setPhoto({ img, alpha });
              const slider = document.getElementById('photoAlpha');
              if (slider) slider.value = Math.round(alpha * 100);
              meta.textContent += ' · on its photo';
              refresh();
            };
            img.src = URL.createObjectURL(rec.blob);
          });
        }
      } catch {
        startPuzzle(makePuzzle(Number(holeMatch[1]) >>> 0, difficulty, biome), false);
      }
      return;
    }
    startPuzzle(makePuzzle(Number(holeMatch[1]) >>> 0, difficulty, biome), false);
    const g = params.get('g');
    if (g) {
      try {
        ghost = { ...ghostPath(puzzle.course, puzzle.start, decodeReplay(g)), index: 0 };
        meta.textContent += ` · racing a ghost (${ghost.strokes} strokes)`;
        refresh();
      } catch {
        ghost = null;
      }
    }
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
  ghost = null;
  anim = null;
  setPhoto(null);
  game = freshGame(p);
  aim = null;
  recorded = false;
  toast.classList.remove('show');
  const biomeTag = p.biome !== 'classic' ? ` · ${p.biome}` : '';
  const label = round.data.label ?? `Round ${round.data.seed}`;
  meta.textContent =
    `${label} · hole ${round.index + 1}/${round.data.holes.length} · ${p.course.archetype}${biomeTag}` +
    ` · par ${p.par} · course par ${round.data.totalPar}`;
  refresh();
}

function startPuzzle(p, daily) {
  round = null;
  ghost = null;
  anim = null;
  setPhoto(null); // a new hole never inherits the last trace's ground
  puzzle = p;
  isDaily = daily;
  game = freshGame(p);
  aim = null;
  recorded = false;
  toast.classList.remove('show');
  const label = daily
    ? `Daily hole #${dailyNumber()}`
    : `Hole seed ${p.seed} · ${p.difficulty}`;
  const biomeTag = p.biome && p.biome !== 'classic' ? ` · ${p.biome}` : '';
  const stars = p.custom ? '' : ` · ${starLabel(estimateStars(p))}`;
  meta.textContent = `${label} · ${p.course.archetype}${biomeTag} · par ${p.par}${stars}`;
  if (!daily) {
    const path = `#/hole/${p.seed}/${p.difficulty}/${p.biome ?? 'classic'}`;
    // Preserve a ?g= ghost param if the hash already points at this hole.
    if (location.hash.split('?')[0] !== path) location.hash = path;
  }
  refresh();
}

function refresh() {
  window.__game = game; // debug/test hook: read-only view of live state
  window.__debugShot = (shot) => { takeShot(shot); };
  updateHud();
  draw(ctx, puzzle.course, game, anim ? null : aim, { ghost, photo });
  if (!anim && game.holed) showResult();
}

/** Apply a shot, advance any ghost, and animate the ball to its new lie. */
function takeShot(shot) {
  initSound();
  const from = { ...game.ball };
  game = applyShot(game, shot);
  aim = null;
  if (ghost && ghost.index < ghost.positions.length - 1) ghost.index++;
  const to = game.ball;
  play('swing', { power: shot.power });
  const event = game.history[game.history.length - 1]?.event;
  const lie = cellAt(puzzle.course, to.x, to.y);
  setTimeout(() => {
    if (event === 'water' || event === 'out-of-bounds') play('splash');
    else if (game.holed) play(game.strokes === 1 ? 'ace' : 'holed');
    else if (lie === SAND) play('thud');
    else if (lie === ICE || slopeDir(lie)) play('slide');
    else play('bounce');
  }, 240);
  if (to.x !== from.x || to.y !== from.y) {
    anim = { from, to, t0: performance.now() };
    requestAnimationFrame(stepAnim);
  } else {
    refresh();
  }
}

function stepAnim(now) {
  if (!anim) return;
  const t = Math.min(1, (now - anim.t0) / 260);
  const ease = 1 - (1 - t) * (1 - t);
  const ballPos = {
    x: anim.from.x + (anim.to.x - anim.from.x) * ease,
    y: anim.from.y + (anim.to.y - anim.from.y) * ease,
  };
  draw(ctx, puzzle.course, game, null, { ghost, photo, ballPos });
  if (t < 1) {
    requestAnimationFrame(stepAnim);
  } else {
    anim = null;
    refresh();
  }
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
  if (game.holed || anim) return;
  const r = canvas.getBoundingClientRect();
  const scale = canvas.width / r.width;
  const mx = (e.clientX - r.left) * scale / TILE - 0.5;
  const my = (e.clientY - r.top) * scale / TILE - 0.5;
  // Aim on the replay codec's angle lattice so every played shot encodes
  // into a ghost URL bit-exactly.
  aim = computePreview(quantizeAngle(Math.atan2(my - game.ball.y, mx - game.ball.x)));
  refresh();
});

canvas.addEventListener('click', () => {
  if (game.holed || anim || !aim) return;
  takeShot({ club, angle: aim.angle, power });
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
    const label = round.data.label ?? `round ${round.data.seed}`;
    return `Daily Links ${label} — ${card.totalStrokes}/${round.data.totalPar} (${vs}) ${holes}`;
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
      stars: puzzle.custom ? undefined : estimateStars(puzzle),
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
  document.getElementById('toast-challenge').hidden = false;
  const rounds = loadRounds();
  const streak = dailyStreak(rounds, today);
  const s = summary(rounds);
  const race = ghost && ghost.holed
    ? game.strokes < ghost.strokes ? ' · 👻 ghost beaten!'
      : game.strokes === ghost.strokes ? ' · 👻 tied the ghost' : ' · 👻 the ghost wins'
    : '';
  const cal = puzzle.custom ? { verdict: '' } : calibration(rounds, estimateStars(puzzle));
  toast.querySelector('.big').textContent = scoreWord(game.strokes, puzzle.par);
  toast.querySelector('.sub').textContent =
    `${game.strokes} strokes on a par ${puzzle.par}` + race +
    (streak > 0 ? ` · 🔥 ${streak}-day streak` : '') +
    ` · ${s.rounds} rounds, avg ${s.avgVsPar >= 0 ? '+' : ''}${s.avgVsPar} vs par` +
    (cal.verdict ? ` · ${starLabel(estimateStars(puzzle))} ${cal.verdict}` : '');
  toast.classList.add('show');
  submitToLeaderboard();
}

/** Optional leaderboard: only speaks up if the player configured a server.
 *  The game never depends on it — failures are silent. */
async function submitToLeaderboard() {
  const url = localStorage.getItem('golfcms.leaderboard.url');
  if (!url || puzzle.custom || !game.holed) return;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        seed: puzzle.seed,
        difficulty: puzzle.difficulty,
        biome: puzzle.biome ?? 'classic',
        name: localStorage.getItem('golfcms.player.name') ?? 'anon',
        replay: encodeReplay(game.history.map((h) => h.shot)),
      }),
    });
    if (!res.ok) return;
    const { rank, of } = await res.json();
    toast.querySelector('.sub').textContent += ` · 🏆 rank ${rank}/${of}`;
  } catch {
    // leaderboard unreachable: the game shrugs and carries on
  }
}

document.getElementById('toast-challenge').addEventListener('click', () => {
  const replay = encodeReplay(game.history.map((h) => h.shot));
  const url = `${location.origin}${location.pathname}` +
    `#/hole/${puzzle.seed}/${puzzle.difficulty}/${puzzle.biome ?? 'classic'}?g=${replay}`;
  navigator.clipboard?.writeText(`Race my ${game.strokes}-stroke ghost: ${url}`);
});

document.getElementById('toast-share').addEventListener('click', () => {
  navigator.clipboard?.writeText(resultText(game, puzzle, isDaily) + '\n' + location.href);
});
document.getElementById('undo').addEventListener('click', () => {
  game = rewindOne(game);
  if (ghost) ghost.index = Math.max(0, ghost.index - 1);
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
document.getElementById('gauntlet').addEventListener('click', () => {
  round = null;
  location.hash = '#/gauntlet';
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
// Full keyboard play: arrows aim and set power, C cycles clubs, Space swings.
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (game.holed || anim) {
    if (e.key === 'Enter' && round && !document.getElementById('toast-next').hidden) {
      document.getElementById('toast-next').click();
    }
    return;
  }
  const currentAngle = aim?.angle ??
    Math.atan2(puzzle.course.hole.y - game.ball.y, puzzle.course.hole.x - game.ball.x);
  const step = e.shiftKey ? (Math.PI * 2) / 2048 : (Math.PI * 2) / 128;
  switch (e.key) {
    case 'ArrowLeft':
      aim = computePreview(quantizeAngle(currentAngle - step));
      break;
    case 'ArrowRight':
      aim = computePreview(quantizeAngle(currentAngle + step));
      break;
    case 'ArrowUp':
      power = Math.min(3, power + 1);
      if (aim) aim = computePreview(aim.angle);
      break;
    case 'ArrowDown':
      power = Math.max(1, power - 1);
      if (aim) aim = computePreview(aim.angle);
      break;
    case '1': case '2': case '3':
      power = Number(e.key);
      if (aim) aim = computePreview(aim.angle);
      break;
    case 'c': case 'C': {
      const enabled = [...document.querySelectorAll('[data-club]')]
        .filter((b) => !b.disabled).map((b) => b.dataset.club);
      club = enabled[(enabled.indexOf(club) + 1) % enabled.length];
      if (aim) aim = computePreview(aim.angle);
      break;
    }
    case 'u': case 'U':
      document.getElementById('undo').click();
      return;
    case ' ': case 'Enter':
      if (!aim) aim = computePreview(quantizeAngle(currentAngle));
      takeShot({ club, angle: aim.angle, power });
      e.preventDefault();
      return;
    default:
      return;
  }
  e.preventDefault();
  refresh();
});

const muteBtn = document.getElementById('mute');
muteBtn.textContent = isMuted() ? '🔇' : '🔊';
muteBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  muteBtn.textContent = isMuted() ? '🔇' : '🔊';
});

document.getElementById('photoAlpha')?.addEventListener('input', (e) => {
  if (!photo) return;
  photo.alpha = Number(e.target.value) / 100;
  try { localStorage.setItem('golfcms.photo.alpha', String(photo.alpha)); } catch { /* best-effort */ }
  refresh();
});

window.addEventListener('hashchange', loadFromHash);

loadFromHash();
