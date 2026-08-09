// Caddie: the decision game. You are dropped on a generated hole and choose
// aim targets for the tee shot and every approach. Your dispersion pattern —
// not a perfect strike — decides where the ball goes; every choice is scored
// in strokes gained against the optimal target, with a full reveal.

import { substream } from '../engine/rng.js';
import { generateCourse } from '../engine/generate.js';
import { cellAt, inBounds, dist } from '../engine/course.js';
import { GREEN, WATER, slopeDir } from '../engine/terrain.js';
import { lieParams, sigmas, patternStats, sampleLanding, restingCell, HANDICAPS, handicapById } from '../engine/dispersion.js';
import { strokesField, scoreDecision, aimHeatmap, expectedPutts, isHoleOver } from '../engine/strategy.js';
import { dailySeed, dailyNumber } from '../engine/puzzle.js';
import { yards, holeYards, parForTiles, clubName, HOLE_LENGTHS } from '../engine/yards.js';
import { pickWeighted, randInt } from '../engine/rng.js';
import { renderCourseArt, drawFlag, drawBall, drawCallout, TILE } from './paint.js';

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
let holeInfo = null; // {par, yds} for the current hole
let art = null; // offscreen course rendering, rebuilt per hole
let profile = handicapById(localStorage.getItem('golfcms.handicap') ?? 'scratch');

const toPin = (p) => dist(p, course.hole);

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
    const seed = holeSeed(round.holeIndex);
    // draw this hole's length from the par-3/4/5 menu, seeded per hole
    const lenRng = substream(seed, 'yardage');
    const band = pickWeighted(lenRng, HOLE_LENGTHS.map((b) => [b, b.weight]));
    course = generateCourse(seed, 'classic', { holeDistTiles: randInt(lenRng, band.min, band.max) });
    const lengthTiles = dist(course.tee, course.hole);
    holeInfo = { par: parForTiles(lengthTiles), yds: holeYards(lengthTiles) };
    V = strokesField(course, 6, profile);
    art = renderCourseArt(course);
    ball = { ...course.tee };
    strokes = 0;
    decisions = [];
    aimTarget = null;
    reveal = null;
    phase = 'aim';
    const label = round.daily ? `Daily #${dailyNumber()}` : `Round ${round.seed}`;
    meta.textContent =
      `${label} · hole ${round.holeIndex + 1}/${HOLES_PER_ROUND} · par ${holeInfo.par} · ` +
      `${holeInfo.yds} yds · ${course.archetype}`;
    verdict.textContent =
      `${yards(toPin(ball))} yds to the pin. Place your target — the ellipse is where this shot actually lands.`;
    document.getElementById('pattern').textContent = '';
    refresh();
  }, 30);
}

function refresh() {
  drawBase();
  if (phase === 'aim' && aimTarget) drawAim();
  if (phase === 'reveal' && reveal) drawReveal();
  const pts = decisions.reduce((s, d) => s + d.points, 0);
  scoreEl.textContent =
    `Hole ${round.holeIndex + 1}/${HOLES_PER_ROUND} (par ${holeInfo.par}, ${holeInfo.yds} yds) · ` +
    `Shot ${strokes + 1} · ${yards(toPin(ball))} yds out · ${round.totalPoints + pts} pts`;
  document.getElementById('commit').hidden = phase !== 'reveal';
}

function drawBase() {
  canvas.width = course.width * TILE;
  canvas.height = course.height * TILE;
  ctx.drawImage(art, 0, 0);
  drawFlag(ctx, course.hole);
  drawBall(ctx, ball);
}

function ellipsePath(from, target, sigmaScale, k) {
  const d = Math.hypot(target.x - from.x, target.y - from.y) || 0.001;
  const s = sigmas(d, sigmaScale, profile);
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
  // the pattern itself: 48 sample shots, colored by where they finish
  const DOT = { fairway: '#ffffff', green: '#b6ffc0', rough: '#2e5230',
    sand: '#a8813a', trees: '#123a1c', wet: '#ff5c5c' };
  for (const d of patternStats(course, ball, aimTarget, lie.sigmaScale, profile).dots) {
    ctx.fillStyle = DOT[d.outcome];
    ctx.beginPath();
    ctx.arc((d.x + 0.5) * TILE, (d.y + 0.5) * TILE, d.outcome === 'wet' ? 3.5 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // carry yardage tag beside the target
  const carry = Math.hypot(aimTarget.x - ball.x, aimTarget.y - ball.y);
  ctx.font = 'bold 13px system-ui';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 3;
  const label = `${yards(carry)}y`;
  const lx = (aimTarget.x + 0.5) * TILE + 12;
  const ly = (aimTarget.y + 0.5) * TILE - 10;
  ctx.strokeText(label, lx, ly);
  ctx.fillText(label, lx, ly);
  ctx.lineWidth = 1;
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
  if (reveal.landing) drawBall(ctx, reveal.landing);
  // the post-shot note, inline on the map
  if (reveal.note) drawCallout(ctx, reveal.landing ?? reveal.your, reveal.note);
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
  const carry = Math.hypot(aimTarget.x - ball.x, aimTarget.y - ball.y);
  const leaves = toPin(aimTarget);
  verdict.textContent =
    `Pin ${yards(toPin(ball))} yds · this target: ${yards(carry)}-yd carry (${clubName(carry)})` +
    (leaves > 1.5 ? ` · leaves ${yards(leaves)} yds in` : ' · going at the flag');
  const lieHere = lieParams(cellAt(course, ball.x, ball.y));
  const s = sigmas(carry, lieHere.sigmaScale, profile);
  const stats = patternStats(course, ball, aimTarget, lieHere.sigmaScale, profile);
  const parts = [];
  if (stats.pct.green) parts.push(`<span class="fw">${stats.pct.green}% green</span>`);
  if (stats.pct.fairway) parts.push(`<span class="fw">${stats.pct.fairway}% fairway</span>`);
  if (stats.pct.rough) parts.push(`${stats.pct.rough}% rough`);
  if (stats.pct.sand) parts.push(`${stats.pct.sand}% sand`);
  if (stats.pct.trees) parts.push(`${stats.pct.trees}% trees`);
  if (stats.pct.wet) parts.push(`<span class="wet">${stats.pct.wet}% water/OB</span>`);
  document.getElementById('pattern').innerHTML =
    `Pattern ${yards(4 * s.lat)} × ${yards(4 * s.long)} yds · ${parts.join(' · ')}` +
    (stats.medianLeave !== null ? ` · median leave ${yards(stats.medianLeave)} yds` : '');
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
  const score = scoreDecision(course, V, from, aimTarget, profile);
  const heat = aimHeatmap(course, V, from, 1, profile);
  const land = sampleLanding(course, from, aimTarget, lie.sigmaScale, strokes, profile);
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
  const ballNow = rest.kind === 'rest' ? `ball ${yards(toPin(ball))} yds out` : outcome;
  verdict.textContent =
    `${call} You: E[${score.yourE.toFixed(2)}] strokes · optimal (green ring, ` +
    `${yards(Math.hypot(score.optimal.x - from.x, score.optimal.y - from.y))}-yd carry): ` +
    `E[${score.optimalE.toFixed(2)}] · SG lost ${sg.toFixed(2)} · +${score.points} pts · ${ballNow}`;
  // risk ledger: your line vs the caddie's, in trouble percentages
  const trouble = (t) => {
    const p = patternStats(course, from, t, lie.sigmaScale, profile).pct;
    return p.wet + p.sand + p.trees;
  };
  const yourRisk = trouble(reveal.your);
  const caddieRisk = trouble(score.optimal);
  document.getElementById('pattern').innerHTML =
    `Risk taken — your line: <span class="wet">${yourRisk}%</span> trouble ` +
    `(water/sand/trees) · caddie's line: <span class="fw">${caddieRisk}%</span>`;
  // inline post-shot note, pinned to where the ball finished
  reveal.note = {
    title: sg < 0.02 ? 'Caddie-approved' : sg < 0.08 ? 'Good call' : sg < 0.2 ? 'Loose' : 'Costly',
    tone: sg < 0.08 ? 'good' : sg < 0.2 ? 'ok' : 'bad',
    lines: [
      `SG ${sg < 0.005 ? '±0.00' : '−' + sg.toFixed(2)} · +${score.points} pts`,
      `E ${score.yourE.toFixed(2)} vs caddie ${score.optimalE.toFixed(2)}`,
      `risk ${yourRisk}% vs caddie ${caddieRisk}%`,
      outcome !== 'landed' ? outcome : `ball ${yards(toPin(ball))} yds out`,
    ],
  };
  refresh();
}

function advance() {
  if (isHoleOver(course, ball) || decisions.length >= 8) return finishHole();
  phase = 'aim';
  aimTarget = null;
  reveal = null;
  verdict.textContent =
    `Shot ${strokes + 1}: ${yards(toPin(ball))} yds to the pin — pick your target from this lie.`;
  document.getElementById('pattern').textContent = '';
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
  const est = (strokes + putts).toFixed(1);
  const vsPar = (strokes + putts - holeInfo.par).toFixed(1);
  overlay.querySelector('.sub').textContent = done
    ? `Decision quality across ${HOLES_PER_ROUND} holes — ` + roundGrade(round.totalPoints)
    : `${decisions.length} decisions · est. ${est} strokes on the par-${holeInfo.par} ` +
      `${holeInfo.yds}-yarder (${vsPar >= 0 ? '+' : ''}${vsPar})`;
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
const hcpSel = document.getElementById('handicap');
for (const h of HANDICAPS) {
  const o = document.createElement('option');
  o.value = h.id;
  o.textContent = h.label;
  o.selected = h.id === profile.id;
  hcpSel.append(o);
}
hcpSel.addEventListener('change', () => {
  profile = handicapById(hcpSel.value);
  localStorage.setItem('golfcms.handicap', profile.id);
  if (course && phase !== 'loading') {
    verdict.textContent = `Recalibrating the caddie for a ${profile.label.toLowerCase()} pattern…`;
    setTimeout(() => {
      V = strokesField(course, 6, profile);
      verdict.textContent =
        `Caddie recalibrated: optimal targets now assume ${profile.label.toLowerCase()} dispersion. ` +
        `${yards(toPin(ball))} yds to the pin.`;
      refresh();
    }, 30);
  }
});
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
