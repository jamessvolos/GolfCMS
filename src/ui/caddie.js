// Caddie: the decision game. You are dropped on a generated hole and choose
// aim targets for the tee shot and every approach. Your dispersion pattern —
// not a perfect strike — decides where the ball goes; every choice is scored
// in strokes gained against the optimal target, with a full reveal.

import { substream } from '../engine/rng.js';
import { generateCourse } from '../engine/generate.js';
import { cellAt, inBounds, dist } from '../engine/course.js';
import { GREEN, WATER, slopeDir } from '../engine/terrain.js';
import { lieParams, sigmas, patternPoints, sampleLanding, restingCell, UNIT_OFFSETS } from '../engine/dispersion.js';
import { strokesField, scoreDecision, aimHeatmap, expectedPutts, isHoleOver } from '../engine/strategy.js';
import { dailySeed, dailyNumber } from '../engine/puzzle.js';
import { terrainColor, TILE } from './render.js';

const HOLES_PER_ROUND = 5;
const canvas = document.getElementById('course');
const ctx = canvas.getContext('2d');
const meta = document.getElementById('meta');
const scoreEl = document.getElementById('score');
const verdict = document.getElementById('verdict');
const overlay = document.getElementById('overlay');

let round = null; // {seed, daily, holeIndex, holes: [{points, strokes}], totalPoints}
let course = null;
let V = null;
let ball = null;
let strokes = 0;
let decisions = [];
let phase = 'loading'; // aim | reveal | loading | holeover
let aimTarget = null;
let reveal = null; // {your, optimal, score, heat, landing}

function startRound(seed, daily) {
  round = { seed: seed >>> 0, daily, holeIndex: 0, holes: [], totalPoints: 0 };
  location.hash = daily ? '#/daily' : `#/round/${round.seed}`;
  loadHole();
}

function holeSeed(i) {
  const rng = substream(round.seed, 'caddieround');
  let s = 0;
  for (let k = 0; k <= i; k++) s = Math.floor(rng() * 0xffffffff) >>> 0;
  return s;
}

function loadHole() {
  phase = 'loading';
  overlay.classList.remove('show');
  meta.textContent = `Hole ${round.holeIndex + 1}/${HOLES_PER_ROUND} · the caddie is reading the hole…`;
  setTimeout(() => {
    course = generateCourse(holeSeed(round.holeIndex));
    V = strokesField(course);
    ball = { ...course.tee };
    strokes = 0;
    decisions = [];
    aimTarget = null;
    reveal = null;
    phase = 'aim';
    const label = round.daily ? `Daily #${dailyNumber()}` : `Round ${round.seed}`;
    meta.textContent = `${label} · hole ${round.holeIndex + 1}/${HOLES_PER_ROUND} · ${course.archetype} · pick your tee-shot target`;
    verdict.textContent = 'Place your target. The ellipse is where this shot actually lands from this lie.';
    refresh();
  }, 30);
}

function refresh() {
  drawBase();
  if (phase === 'aim' && aimTarget) drawAim();
  if (phase === 'reveal' && reveal) drawReveal();
  const pts = decisions.reduce((s, d) => s + d.points, 0);
  scoreEl.textContent =
    `Hole ${round.holeIndex + 1}/${HOLES_PER_ROUND} · Shot ${strokes + 1} · ` +
    `${round.totalPoints + pts} pts`;
  document.getElementById('commit').hidden = phase !== 'reveal';
}

function drawBase() {
  canvas.width = course.width * TILE;
  canvas.height = course.height * TILE;
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      const t = cellAt(course, x, y);
      ctx.fillStyle = terrainColor(t);
      ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      if (slopeDir(t)) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(x * TILE + 9, y * TILE + 9, 6, 6);
      }
    }
  }
  // flag
  const hx = (course.hole.x + 0.5) * TILE;
  const hy = (course.hole.y + 0.5) * TILE;
  ctx.fillStyle = '#1c2b1f';
  ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#eee';
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, hy - 18); ctx.stroke();
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath(); ctx.moveTo(hx, hy - 18); ctx.lineTo(hx + 12, hy - 13); ctx.lineTo(hx, hy - 8);
  ctx.closePath(); ctx.fill();
  // ball
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.beginPath(); ctx.arc((ball.x + 0.5) * TILE, (ball.y + 0.5) * TILE, 6, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
}

function ellipsePath(from, target, sigmaScale, k) {
  const d = Math.hypot(target.x - from.x, target.y - from.y) || 0.001;
  const s = sigmas(d, sigmaScale);
  const ang = Math.atan2(target.y - from.y, target.x - from.x);
  ctx.beginPath();
  ctx.ellipse((target.x + 0.5) * TILE, (target.y + 0.5) * TILE,
    s.long * k * TILE, s.lat * k * TILE, ang, 0, Math.PI * 2);
}

function drawAim() {
  const lie = lieParams(cellAt(course, ball.x, ball.y));
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.moveTo((ball.x + 0.5) * TILE, (ball.y + 0.5) * TILE);
  ctx.lineTo((aimTarget.x + 0.5) * TILE, (aimTarget.y + 0.5) * TILE);
  ctx.stroke();
  ctx.setLineDash([]);
  // reach ring
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.arc((ball.x + 0.5) * TILE, (ball.y + 0.5) * TILE, lie.maxDist * TILE, 0, Math.PI * 2);
  ctx.stroke();
  // 1σ and 2σ pattern ellipses
  ctx.fillStyle = 'rgba(255, 209, 102, 0.20)';
  ellipsePath(ball, aimTarget, lie.sigmaScale, 2); ctx.fill();
  ctx.fillStyle = 'rgba(255, 209, 102, 0.30)';
  ellipsePath(ball, aimTarget, lie.sigmaScale, 1); ctx.fill();
  ctx.strokeStyle = 'rgba(255, 209, 102, 0.8)';
  ellipsePath(ball, aimTarget, lie.sigmaScale, 1); ctx.stroke();
}

function drawReveal() {
  // heatmap: green = smart aim, red = stroke-burning aim
  const min = Math.min(...reveal.heat.map((c) => c.e));
  for (const c of reveal.heat) {
    const badness = Math.min(1, (c.e - min) / 1.2);
    ctx.fillStyle = `rgba(${Math.round(80 + 175 * badness)}, ${Math.round(200 - 140 * badness)}, 80, 0.30)`;
    ctx.fillRect(c.x * TILE, c.y * TILE, TILE, TILE);
  }
  // your pick ✕
  const yx = (reveal.your.x + 0.5) * TILE, yy = (reveal.your.y + 0.5) * TILE;
  ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(yx - 8, yy - 8); ctx.lineTo(yx + 8, yy + 8);
  ctx.moveTo(yx + 8, yy - 8); ctx.lineTo(yx - 8, yy + 8);
  ctx.stroke(); ctx.lineWidth = 1;
  // optimal ★ (drawn as a ringed dot)
  const ox = (reveal.score.optimal.x + 0.5) * TILE, oy = (reveal.score.optimal.y + 0.5) * TILE;
  ctx.strokeStyle = '#6fd08c'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(ox, oy, 9, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#6fd08c';
  ctx.beginPath(); ctx.arc(ox, oy, 3, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 1;
  // where the sampled ball actually went
  if (reveal.landing) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.arc((reveal.landing.x + 0.5) * TILE, (reveal.landing.y + 0.5) * TILE, 6, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
}

canvas.addEventListener('mousemove', (e) => {
  if (phase !== 'aim') return;
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) * (canvas.width / r.width)) / TILE - 0.5;
  const y = ((e.clientY - r.top) * (canvas.height / r.height)) / TILE - 0.5;
  const lie = lieParams(cellAt(course, ball.x, ball.y));
  const d = Math.hypot(x - ball.x, y - ball.y);
  // clamp inside the ring by half a tile so rounding can't push the target
  // past maxDist (which the evaluator would price as unreachable)
  const clamp = Math.min(1, (lie.maxDist - 0.51) / Math.max(d, 0.001));
  aimTarget = {
    x: Math.round(ball.x + (x - ball.x) * clamp),
    y: Math.round(ball.y + (y - ball.y) * clamp),
  };
  refresh();
});

canvas.addEventListener('click', () => {
  if (phase === 'reveal') return advance();
  if (phase !== 'aim' || !aimTarget) return;
  commitDecision();
});
document.getElementById('commit').addEventListener('click', advance);

function commitDecision() {
  const from = { ...ball };
  const lie = lieParams(cellAt(course, from.x, from.y));
  const score = scoreDecision(course, V, from, aimTarget);
  const heat = aimHeatmap(course, V, from, 1);
  const land = sampleLanding(course, from, aimTarget, lie.sigmaScale, strokes);
  const rest = restingCell(course, land.x, land.y);
  strokes += 1;
  let outcome;
  if (rest.kind === 'rest') {
    ball = { x: rest.x, y: rest.y };
    outcome = rest.terrain === WATER ? 'splash' : 'landed';
  } else {
    strokes += 1; // penalty; replay from the same spot
    outcome = rest.kind === 'water' ? 'splash — penalty, replay' : 'OB — penalty, replay';
  }
  decisions.push(score);
  reveal = { your: { ...aimTarget }, score, heat, landing: rest.kind === 'rest' ? { x: rest.x, y: rest.y } : null };
  phase = 'reveal';
  const sg = score.sgLost;
  const call = sg < 0.02 ? 'Caddie-approved. Perfect target.'
    : sg < 0.08 ? 'Good call — within a whisker of optimal.'
    : sg < 0.2 ? 'Playable, but the caddie sees a better line.'
    : 'That aim burns real strokes.';
  verdict.textContent =
    `${call} Your target: E[${score.yourE.toFixed(2)}] strokes · optimal (green ring): ` +
    `E[${score.optimalE.toFixed(2)}] · SG lost ${sg.toFixed(2)} · +${score.points} pts` +
    (outcome !== 'landed' ? ` · ball: ${outcome}` : '');
  refresh();
}

function advance() {
  if (isHoleOver(course, ball) || decisions.length >= 8) return finishHole();
  phase = 'aim';
  aimTarget = null;
  reveal = null;
  verdict.textContent = `Shot ${strokes + 1}: pick your approach target from this lie.`;
  refresh();
}

function finishHole() {
  const putts = isHoleOver(course, ball) ? expectedPutts(dist(ball, course.hole)) : 2.5;
  const holePts = Math.round(decisions.reduce((s, d) => s + d.points, 0) / Math.max(1, decisions.length));
  round.holes.push({ points: holePts, strokes: +(strokes + putts).toFixed(1) });
  round.totalPoints += holePts;
  phase = 'holeover';
  const done = round.holeIndex + 1 >= HOLES_PER_ROUND;
  overlay.querySelector('.big').textContent = done
    ? `Round: ${round.totalPoints} / ${HOLES_PER_ROUND * 1000}`
    : `Hole ${round.holeIndex + 1}: ${holePts} / 1000`;
  overlay.querySelector('.sub').textContent = done
    ? `Decision quality across ${HOLES_PER_ROUND} holes — ` + roundGrade(round.totalPoints)
    : `${decisions.length} decisions · est. ${(strokes + putts).toFixed(1)} strokes with the putts`;
  document.getElementById('ov-next').textContent = done ? 'New round' : 'Next hole ⛳';
  overlay.classList.add('show');
}

function roundGrade(p) {
  const r = p / (HOLES_PER_ROUND * 1000);
  return r > 0.97 ? 'tour-caddie brain. 🧠' : r > 0.9 ? 'sharp course management.'
    : r > 0.8 ? 'solid, with a few loose targets.' : 'the caddie would like a word.';
}

function shareText() {
  const label = round.daily ? `Caddie Daily #${dailyNumber()}` : `Caddie round ${round.seed}`;
  const holes = round.holes.map((h) => (h.points > 970 ? '🟩' : h.points > 900 ? '🟨' : '🟥')).join('');
  return `${label} — ${round.totalPoints}/${HOLES_PER_ROUND * 1000} ${holes}`;
}

document.getElementById('ov-next').addEventListener('click', () => {
  if (round.holeIndex + 1 >= HOLES_PER_ROUND) {
    startRound((Math.random() * 0xffffffff) >>> 0, false);
  } else {
    round.holeIndex += 1;
    loadHole();
  }
});
document.getElementById('ov-share').addEventListener('click', () => navigator.clipboard?.writeText(shareText()));
document.getElementById('share').addEventListener('click', () => navigator.clipboard?.writeText(shareText()));
document.getElementById('new').addEventListener('click', () => startRound((Math.random() * 0xffffffff) >>> 0, false));
document.getElementById('daily').addEventListener('click', () => startRound(dailySeed(), true));

// test hooks
window.__caddie = {
  get state() { return { phase, ball, strokes, decisions, round, course }; },
  aimAt(x, y) { aimTarget = { x, y }; commitDecision(); },
  advance,
};

const m = location.hash.match(/^#\/round\/(\d+)/);
if (m) startRound(Number(m[1]) >>> 0, false);
else startRound(dailySeed(), true);
