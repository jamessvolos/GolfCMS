// Caddie: the decision game. You are dropped on a generated hole and choose
// aim targets for the tee shot and every approach. Your dispersion pattern —
// not a perfect strike — decides where the ball goes; every choice is scored
// in strokes gained against the optimal target, with a full reveal.

import { cellAt, inBounds, dist } from '../engine/course.js';
import { GREEN, WATER, slopeDir } from '../engine/terrain.js';
import { lieParams, sigmas, patternStats, sampleLanding, restingCell, windShift, reach, HANDICAPS, handicapById, puttSigmas, samplePuttRoll, puttHolesOut, PUTT_MAX, puttBreakDrift, CUP_R } from '../engine/dispersion.js';
import { strokesField, scoreDecision, aimHeatmap, isHoleOver, scorePuttDecision, puttHeatmap, puttStats, onPuttingSurface } from '../engine/strategy.js';
import { caddieHoleSeed, caddieHoleCourse, encodeCaddieRound } from '../engine/caddierec.js';
import { dailySeed, dailyNumber } from '../engine/puzzle.js';
import { weekKey, gauntletSeed } from '../engine/gauntlet.js';
import { courseName } from '../engine/namer.js';
import { yards, feet, holeYards, parForTiles, clubName } from '../engine/yards.js';
import {
  renderCourseArt, renderGreenArt, drawFlag, drawBall, drawPin, drawBallWorld, TILE,
} from './paint.js';
import {
  makeCamera, worldToScreen, screenToWorld, worldTransform, courseCamera,
  frameRect, easeOutCubic, lerpCamera, sameCamera,
} from './camera.js';
import { setHeartbeat, stopHeartbeat } from './sound.js';
import { copy } from './copy.js';

const HOLES_PER_ROUND = 5;
const canvas = document.getElementById('course');
const ctx = canvas.getContext('2d');
const meta = document.getElementById('meta');
const scoreEl = document.getElementById('score');
const vignetteEl = document.getElementById('vignette');
const stampEl = document.getElementById('stamp');
const verdict = document.getElementById('verdict');
const overlay = document.getElementById('overlay');
const topinEl = document.getElementById('topin');
const modeSel = document.getElementById('mode');

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
// The green complex: a SECOND art layer at putting resolution, used only while
// the camera is framing the green. Built lazily — the first time a hole's putt
// loop opens — and then reused for every frame of every putt on that hole, so
// it costs one build per hole and nothing per frame. paint.js: renderGreenArt.
let greenArt = null;
const greenArtStats = { builds: 0, buildMs: 0, draws: 0 };
let lastFrameMs = 0; // wall time of the most recent refresh(), for perf checks
// --- putting state: once the ball reaches the green, every putt is a real
// decision through the same aim/commit/reveal loop, at green resolution ---
let putting = false; // in the putt decision loop
let puttPos = null; // fractional ball position on the green (inches matter)
let puttCount = 0; // putt decisions taken this hole
let holedOut = false; // the ball is in the cup — hole strokes are real
// per-round decision recorder: every committed target, hole by hole, so a
// finished round can be offered to the leaderboard as a verifiable replay
let recHole = null; // {holeSeed, decisions:[{x,y}], puttDecisions:[{x,y}]}
function resolveProfile(id) {
  if (id === 'custom') {
    try {
      const c = JSON.parse(localStorage.getItem('golfcms.customProfile'));
      if (c && typeof c.base === 'number') {
        return { id: 'custom', label: 'Custom', base: c.base, longExtra: c.longExtra ?? 0, bias: c.bias ?? 0, dist: c.dist ?? 1 };
      }
    } catch { /* fall through */ }
  }
  return handicapById(id);
}
let profile = resolveProfile(localStorage.getItem('golfcms.handicap') ?? 'scratch');
let proMode = localStorage.getItem('golfcms.pro') === '1';

const toPin = (p) => dist(p, course.hole);

// --- mobile & orientation ---
let touchMode = false;
let dragStart = null; // {sx, sy, t0} during a touch drag
let rotated = false; // portrait: course drawn tee-at-bottom, green-at-top
let hadWater = false; // for the haptic tick on risk transitions

// --- the world camera: {scale, cx, cy}, cx/cy being the world tile sitting at
// the center of the canvas. It is threaded through toScreen / fromScreenPx /
// beginWorld and NOWHERE else — those three are the whole world↔screen seam,
// so drawing, pointer input and the DOM stamp all zoom together for free.
// At scale 1 centered on the board the transform is the identity it always
// was, so the course view is pixel-for-pixel unchanged. Math: ui/camera.js.
let camera = makeCamera();
let camMode = 'course'; // 'course' | 'green' — what the camera is framing
let camAnim = null; // {from, to, t0, dur} while easing between framings
let camRaf = 0;
let camPending = null; // a transition that arrived mid-drag, owed at pointerup
let greenRect = null; // this hole's green bbox + centroid, computed once
const CAM_MS = 700;
const GREEN_PAD = 2; // tiles of fringe to keep around the green

const camView = () => ({ w: canvas.width, h: canvas.height, tile: TILE, rotated });

function toScreen(p) {
  return worldToScreen(p, camera, camView());
}
function fromScreenPx(sx, sy) {
  return screenToWorld(sx, sy, camera, camView());
}
function beginWorld() {
  ctx.save();
  for (const s of worldTransform(camera, camView())) {
    if (s.t === 'translate') ctx.translate(s.x, s.y);
    else if (s.t === 'scale') ctx.scale(s.k, s.k);
    else ctx.rotate(s.a);
  }
}

/** Cover-fit the canvas to the viewport: the course fills the screen in both
 *  orientations, centered, cropping the edges rather than letterboxing. The
 *  CSS box stays a uniform scale of the canvas bitmap, so pointer math in
 *  eventCoursePoint keeps working unchanged. */
function fitCanvas() {
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  const s = Math.max(vw / canvas.width, vh / canvas.height);
  const w = canvas.width * s;
  const h = canvas.height * s;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.style.left = `${(vw - w) / 2}px`;
  canvas.style.top = `${(vh - h) / 2}px`;
}

/** Canvas-pixel point → viewport CSS coordinates (for DOM layers pinned to
 *  spots on the map, like the verdict stamp). */
function canvasToViewport(px) {
  const r = canvas.getBoundingClientRect();
  return {
    x: r.left + (px.x / canvas.width) * r.width,
    y: r.top + (px.y / canvas.height) * r.height,
  };
}

/** The slice of the canvas bitmap the viewport actually shows. Cover-fit
 *  crops the rest, so this — not the full bitmap — is what must fit a frame. */
function visibleCanvasPx() {
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  const s = Math.max(vw / canvas.width, vh / canvas.height);
  return { viewW: vw / s, viewH: vh / s };
}

/** The green's bounding box and centroid, in world tiles. Computed once per
 *  hole — the auto-frame consults it on every resize. */
function findGreenRect() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < course.height; y++) {
    for (let x = 0; x < course.width; x++) {
      if (cellAt(course, x, y) !== GREEN) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      sx += x; sy += y; n += 1;
    }
  }
  return n ? { x0, y0, x1, y1, cx: sx / n, cy: sy / n } : null;
}

/** Build the green complex for this hole, once. Called when the putt loop
 *  opens — a hole abandoned before the green never pays for it. */
function ensureGreenArt() {
  if (greenArt || !greenRect || !course) return greenArt;
  greenArt = renderGreenArt(course, greenRect);
  greenArtStats.builds += 1;
  greenArtStats.buildMs = +greenArt.ms.toFixed(2);
  return greenArt;
}

/** Is the detail layer the one on screen right now? */
const onGreenArt = () => camMode === 'green' && Boolean(greenArt);

/** The SCREEN direction the sun's shadows fall in: world lower-right, carried
 *  through the same transform the turf relief was baked under, so the pin's
 *  shadow and the shaded relief always agree — portrait rotation included. */
function shadowDir() {
  const a = toScreen({ x: 0, y: 0 });
  const b = toScreen({ x: 1, y: 1 });
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/** One ball, drawn the right size for the framing: a fixed sprite at course
 *  zoom, world-sized (and therefore tiny, and therefore honest) on the green. */
function paintBall(px, opts = {}) {
  if (onGreenArt()) drawBallWorld(ctx, px, camera.scale, opts);
  else drawBall(ctx, px, opts);
}

/** What the camera SHOULD be for a framing, at the current size/orientation.
 *  Pure and cheap, so a resize or a rotate just re-derives it. */
function desiredCamera(mode) {
  const view = camView();
  if (mode === 'green' && greenRect) {
    return frameRect(greenRect, { ...view, ...visibleCanvasPx(), pad: GREEN_PAD, min: 1, max: 6 });
  }
  return courseCamera(view);
}

function cancelCamAnim() {
  if (camRaf) cancelAnimationFrame(camRaf);
  camRaf = 0;
  camAnim = null;
}

function camTick() {
  camRaf = 0;
  if (!camAnim) return;
  const t = (performance.now() - camAnim.t0) / camAnim.dur;
  camera = lerpCamera(camAnim.from, camAnim.to, easeOutCubic(t));
  if (t >= 1) {
    camera = camAnim.to;
    camAnim = null;
  } else {
    camRaf = requestAnimationFrame(camTick);
  }
  refresh();
}

/** Ease the camera to a framing. Reduced motion snaps. */
function applyCam(mode, { instant = false } = {}) {
  camMode = mode;
  const to = desiredCamera(mode);
  if (sameCamera(to, camera)) { cancelCamAnim(); camera = to; return; }
  if (instant || reducedMotion.matches) {
    cancelCamAnim();
    camera = to;
    if (course && phase !== 'loading') refresh();
    return;
  }
  cancelCamAnim();
  camAnim = { from: { ...camera }, to, t0: performance.now(), dur: CAM_MS };
  camRaf = requestAnimationFrame(camTick);
}

/** The camera only ever moves on a PHASE CHANGE — entering the putt loop, a
 *  hole ending, a hole loading. Every call site clears aimTarget first, so a
 *  live decision is never re-framed under the player. A request that lands
 *  mid-drag is owed until the finger lifts. */
function requestCam(mode, opts = {}) {
  if (dragStart) {
    camPending = { mode, opts };
    return;
  }
  applyCam(mode, opts);
}

// --- risk-reactive ambience: the vignette layer tints toward alarm as the
// aimed pattern flirts with water/OB, sand, and trees ---
function setDanger(pct) {
  const wet = pct.wet ?? 0;
  const trouble = wet + (pct.sand ?? 0) + (pct.trees ?? 0);
  const d = Math.min(1, (wet * 2 + trouble) / 90);
  vignetteEl.style.setProperty('--danger', d.toFixed(3));
  vignetteEl.classList.toggle('alarm', wet > 0);
  // the same danger drives the risk heartbeat while aiming
  setHeartbeat(d);
}
function clearDanger() {
  vignetteEl.style.setProperty('--danger', '0');
  vignetteEl.classList.remove('alarm');
  stopHeartbeat();
}

// --- reveal-only camera push-in: a slow cinematic zoom toward the ball,
// applied to the course wrapper so aim-phase pointer math never sees it ---
const wrapEl = document.getElementById('wrap');
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? { matches: false };

function startPushIn(target) {
  if (reducedMotion.matches || !wrapEl) return;
  // on the green the world camera already frames the ball — a CSS zoom on top
  // would double-apply, so push-in stays a full-swing flourish only
  if (putting) return;
  const p = canvasToViewport(toScreen(target));
  wrapEl.style.transformOrigin = `${p.x.toFixed(1)}px ${p.y.toFixed(1)}px`;
  wrapEl.classList.add('push-in');
}
function clearPushIn() {
  if (!wrapEl) return;
  // .push-in carries the transition, so removal snaps back instantly:
  // by the next aim frame the canvas rect is exactly the untransformed one
  wrapEl.classList.remove('push-in');
  wrapEl.style.transformOrigin = '';
}

// --- shot FX: ball-flight comet, then a radial heatmap sweep from the lie ---
const SWEEP_MS = 600;
let fx = null; // {stage:'flight'|'sweep', t0, p, from, to, dur}
let fxRaf = 0;

function startShotFx(from, to, opts = {}) {
  cancelFx();
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  fx = {
    stage: 'flight', t0: performance.now(), p: 0,
    from: { ...from }, to: { ...to },
    putt: Boolean(opts.putt), // a putt is a low flat roll, over quicker
    dur: opts.putt ? Math.min(600, 200 + d * 60) : Math.min(1000, 340 + d * 14),
  };
  fxRaf = requestAnimationFrame(fxTick);
}

function fxTick() {
  if (!fx) return;
  const el = performance.now() - fx.t0;
  if (fx.stage === 'flight') {
    fx.p = Math.min(1, el / fx.dur);
    if (fx.p >= 1) {
      fx.stage = 'sweep';
      fx.t0 = performance.now();
      fx.p = 0;
      showStamp();
    }
  } else {
    fx.p = Math.min(1, el / SWEEP_MS);
    if (fx.p >= 1) fx = null;
  }
  refresh();
  if (fx) fxRaf = requestAnimationFrame(fxTick);
}

function cancelFx() {
  if (fxRaf) cancelAnimationFrame(fxRaf);
  fxRaf = 0;
  fx = null;
}

/** The comet: interpolated ball with a fading trail, arcing lie → landing. */
function drawFlight() {
  const ease = (t) => t * t * (3 - 2 * t);
  const at = (t) => ({
    x: fx.from.x + (fx.to.x - fx.from.x) * t,
    y: fx.from.y + (fx.to.y - fx.from.y) * t,
  });
  // the arc is a screen-space lift, so it tracks the camera's zoom
  const distPx = Math.hypot(fx.to.x - fx.from.x, fx.to.y - fx.from.y) * TILE * camera.scale;
  const lift = fx.putt ? 0 : Math.min(90, 18 + distPx * 0.16); // putts hug the turf
  const SAMPLES = 14;
  for (let k = SAMPLES; k >= 0; k--) {
    const e = ease(Math.max(0, fx.p - k * 0.04));
    const sp = toScreen(at(e));
    const y = sp.y - Math.sin(Math.PI * e) * lift;
    if (k === 0) {
      paintBall({ x: sp.x, y });
      continue;
    }
    const a = 0.5 * (1 - k / SAMPLES) * Math.min(1, fx.p * 3);
    if (a <= 0.02) continue;
    ctx.fillStyle = `rgba(255, 240, 190, ${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(sp.x, y, 1.5 + 5 * (1 - k / SAMPLES), 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- the stamped verdict: huge rotated call near the ball, SG chip below ---
function showStamp() {
  if (!reveal?.note) return;
  stampEl.className = reveal.note.tone;
  document.getElementById('stamp-word').textContent = reveal.note.title.toUpperCase();
  document.getElementById('stamp-chip').textContent = reveal.note.lines.slice(0, 2).join('  ·  ');
  stampEl.hidden = false;
  positionStamp();
}
function positionStamp() {
  if (stampEl.hidden || !reveal) return;
  const p = canvasToViewport(toScreen(reveal.landing ?? reveal.your));
  const x = Math.max(160, Math.min(window.innerWidth - 160, p.x));
  const y = Math.max(120, Math.min(window.innerHeight - 140, p.y - 44));
  stampEl.style.left = `${x}px`;
  stampEl.style.top = `${y}px`;
}
function hideStamp() { stampEl.hidden = true; }

function startRound(seed, daily, opts = {}) {
  round = {
    seed: seed >>> 0, daily, holeIndex: 0, holes: [], totalPoints: 0,
    count: opts.count ?? HOLES_PER_ROUND, label: opts.label ?? null, hash: opts.hash ?? null,
    rec: [], // completed holes' decision records, for the board submission
  };
  location.hash = round.hash ?? (daily ? '#/daily' : `#/round/${round.seed}`);
  syncModeSelect();
  loadHole();
}

/** Keep the Round menu honest about what is being played. */
function syncModeSelect() {
  modeSel.value = round.daily ? 'daily'
    : round.count === 18 ? 'champ'
    : round.hash === '#/major' ? 'major'
    : 'quick';
}

function loadHole() {
  phase = 'loading';
  cancelFx();
  cancelCamAnim(); // no ease may outlive the course it was framing
  camPending = null;
  hideStamp();
  clearDanger();
  clearPushIn();
  overlay.classList.remove('show');
  meta.textContent = copy.loadingHole(round.holeIndex + 1, round.count);
  setTimeout(() => {
    // hole derivation lives in caddierec.js — the SAME helpers the
    // leaderboard verifier replays against, so they can never drift
    const seed = caddieHoleSeed(round.seed, round.holeIndex);
    course = caddieHoleCourse(seed);
    recHole = { holeSeed: seed, decisions: [], puttDecisions: [] };
    const lengthTiles = dist(course.tee, course.hole);
    holeInfo = { par: parForTiles(lengthTiles), yds: holeYards(lengthTiles) };
    V = strokesField(course, 6, profile);
    art = renderCourseArt(course);
    greenArt = null; // new hole, new green — rebuilt on the first putt
    greenRect = findGreenRect();
    ball = { ...course.tee };
    strokes = 0;
    decisions = [];
    aimTarget = null;
    reveal = null;
    putting = false;
    puttPos = null;
    puttCount = 0;
    holedOut = false;
    // a fresh hole opens on the course view — new art, so nothing to ease from
    applyCam('course', { instant: true });
    phase = 'aim';
    const label = round.label ?? (round.daily ? copy.dailyLabel(dailyNumber()) : copy.roundLabel(round.seed));
    meta.textContent = copy.holeMeta({
      course: courseName(round.seed), label,
      n: round.holeIndex + 1, count: round.count,
      par: holeInfo.par, yds: holeInfo.yds,
      arch: course.archetype, wind: windLabel(),
    });
    verdict.textContent = copy.firstAim(yards(toPin(ball)));
    document.getElementById('pattern').textContent = '';
    if (touchMode) initNeutralAim();
    refresh();
  }, 30);
}

function refresh() {
  const t0 = performance.now();
  drawBase();
  if (phase === 'aim' && aimTarget) drawAim();
  if (phase === 'reveal' && reveal) drawReveal();
  const pts = decisions.reduce((s, d) => s + d.points, 0);
  scoreEl.textContent = copy.scoreLine(holedOut ? strokes : strokes + 1, round.totalPoints + pts);
  // on the green the book flips to feet: "36 ft", not "12 yds"
  const eyebrow = document.querySelector('#hud-yardage .eyebrow');
  if (eyebrow) eyebrow.textContent = putting ? 'Ft to pin' : 'Yds to pin';
  topinEl.textContent = putting
    ? String(feet(toPin(puttPos ?? ball)))
    : String(yards(toPin(ball)));
  document.getElementById('commit').hidden = phase !== 'reveal';
  document.getElementById('hit').hidden = !(touchMode && phase === 'aim' && aimTarget);
  if (phase === 'reveal' && !stampEl.hidden) positionStamp();
  lastFrameMs = performance.now() - t0;
}

function drawBase() {
  rotated = window.innerHeight > window.innerWidth;
  canvas.width = (rotated ? course.height : course.width) * TILE;
  canvas.height = (rotated ? course.width : course.height) * TILE;
  fitCanvas();
  // re-derive the framing for the current size/orientation (a no-op unless the
  // window changed); an ease in flight owns the camera and is left alone
  if (!camAnim) camera = desiredCamera(camMode);
  beginWorld();
  ctx.drawImage(art, 0, 0);
  // the green complex rides on top of the course art, in the same world pixels,
  // so it registers exactly and the course view never sees it
  if (onGreenArt()) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(greenArt.canvas, greenArt.ox, greenArt.oy, greenArt.w, greenArt.h);
    greenArtStats.draws += 1;
  }
  ctx.restore();
  if (onGreenArt()) drawPin(ctx, toScreen(course.hole), camera.scale, shadowDir());
  else drawFlag(ctx, toScreen(course.hole));
  // during the flight comet the interpolated ball is the only ball on screen
  if (!(fx && fx.stage === 'flight')) paintBall(toScreen(putting && puttPos ? puttPos : ball));
}

function ellipsePath(from, target, sigmaScale, k, sig = null) {
  const d = Math.hypot(target.x - from.x, target.y - from.y) || 0.001;
  const s = sig ?? sigmas(d, sigmaScale, profile);
  const ang = Math.atan2(target.y - from.y, target.x - from.x);
  const drift = sig ? { x: 0, y: 0 } : windShift(course, from, target); // no wind on the ground
  ctx.beginPath();
  ctx.ellipse((target.x + drift.x + 0.5) * TILE, (target.y + drift.y + 0.5) * TILE,
    s.long * k * TILE, s.lat * k * TILE, ang, 0, Math.PI * 2);
}

/** Putt aim: tight ellipse, long axis ALONG the line (pace is the miss),
 *  gold dots for samples that drop, white for the ones that stay out. */
function drawPuttAim() {
  beginWorld();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.moveTo((puttPos.x + 0.5) * TILE, (puttPos.y + 0.5) * TILE);
  ctx.lineTo((aimTarget.x + 0.5) * TILE, (aimTarget.y + 0.5) * TILE);
  ctx.stroke();
  ctx.setLineDash([]);
  const d = Math.hypot(aimTarget.x - puttPos.x, aimTarget.y - puttPos.y);
  const sig = puttSigmas(d, profile);
  ctx.fillStyle = 'rgba(180, 235, 255, 0.20)';
  ellipsePath(puttPos, aimTarget, 1, 2, sig); ctx.fill();
  ctx.fillStyle = 'rgba(180, 235, 255, 0.30)';
  ellipsePath(puttPos, aimTarget, 1, 1, sig); ctx.fill();
  ctx.strokeStyle = 'rgba(180, 235, 255, 0.85)';
  ellipsePath(puttPos, aimTarget, 1, 1, sig); ctx.stroke();
  if (!proMode) {
    for (const dot of puttStats(course, puttPos, aimTarget, profile).dots) {
      ctx.fillStyle = dot.outcome === 'holed' ? '#ffd166' : '#ffffff';
      ctx.beginPath();
      ctx.arc((dot.x + 0.5) * TILE, (dot.y + 0.5) * TILE, dot.outcome === 'holed' ? 2.5 : 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  // footage tag beside the target (screen space, always upright)
  const tp = toScreen(aimTarget);
  ctx.font = 'bold 13px system-ui';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 3;
  const label = `${feet(d)}ft`;
  ctx.strokeText(label, tp.x + 12, tp.y - 10);
  ctx.fillText(label, tp.x + 12, tp.y - 10);
  ctx.lineWidth = 1;
}

function drawAim() {
  if (putting) return drawPuttAim();
  const lie = lieParams(cellAt(course, ball.x, ball.y));
  beginWorld();
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
  ctx.arc((ball.x + 0.5) * TILE, (ball.y + 0.5) * TILE, reach(lie, profile) * TILE, 0, Math.PI * 2);
  ctx.stroke();
  // 1σ and 2σ pattern ellipses
  ctx.fillStyle = 'rgba(255, 209, 102, 0.20)';
  ellipsePath(ball, aimTarget, lie.sigmaScale, 2); ctx.fill();
  ctx.fillStyle = 'rgba(255, 209, 102, 0.30)';
  ellipsePath(ball, aimTarget, lie.sigmaScale, 1); ctx.fill();
  ctx.strokeStyle = 'rgba(255, 209, 102, 0.8)';
  ellipsePath(ball, aimTarget, lie.sigmaScale, 1); ctx.stroke();
  // the pattern itself: 48 sample shots, colored by where they finish
  // (hidden in Pro mode — the judgment test is the point)
  const DOT = { fairway: '#ffffff', green: '#b6ffc0', rough: '#2e5230',
    sand: '#a8813a', trees: '#123a1c', wet: '#ff5c5c' };
  for (const d of proMode ? [] : patternStats(course, ball, aimTarget, lie.sigmaScale, profile).dots) {
    ctx.fillStyle = DOT[d.outcome];
    ctx.beginPath();
    ctx.arc((d.x + 0.5) * TILE, (d.y + 0.5) * TILE, d.outcome === 'wet' ? 3.5 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // carry yardage tag beside the target (screen space, always upright)
  const carry = Math.hypot(aimTarget.x - ball.x, aimTarget.y - ball.y);
  const tp = toScreen(aimTarget);
  ctx.font = 'bold 13px system-ui';
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 3;
  const label = `${yards(carry)}y`;
  ctx.strokeText(label, tp.x + 12, tp.y - 10);
  ctx.fillText(label, tp.x + 12, tp.y - 10);
  ctx.lineWidth = 1;
}

function drawReveal() {
  // stage 1: the ball flies (comet trail); everything else waits
  if (fx && fx.stage === 'flight') {
    drawFlight();
    return;
  }
  // stage 2: heatmap sweeps radially outward from the lie it was hit from
  const sweep = fx && fx.stage === 'sweep' ? fx.p : 1;
  const origin = reveal.from ?? ball;
  const limit = sweep * (reveal.maxHeat ?? Infinity);
  // heatmap: green = smart aim, red = stroke-burning aim
  beginWorld();
  const min = Math.min(...reveal.heat.map((c) => c.e));
  for (const c of reveal.heat) {
    if (sweep < 1 && Math.hypot(c.x - origin.x, c.y - origin.y) > limit) continue;
    const badness = Math.min(1, (c.e - min) / 1.2);
    ctx.fillStyle = `rgba(${Math.round(80 + 175 * badness)}, ${Math.round(200 - 140 * badness)}, 80, 0.30)`;
    ctx.fillRect(c.x * TILE, c.y * TILE, TILE, TILE);
  }
  ctx.restore();
  // your pick ✕
  const { x: yx, y: yy } = toScreen(reveal.your);
  ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(yx - 8, yy - 8); ctx.lineTo(yx + 8, yy + 8);
  ctx.moveTo(yx + 8, yy - 8); ctx.lineTo(yx - 8, yy + 8);
  ctx.stroke(); ctx.lineWidth = 1;
  // optimal ★ (drawn as a ringed dot)
  const { x: ox, y: oy } = toScreen(reveal.score.optimal);
  ctx.strokeStyle = '#6fd08c'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(ox, oy, 9, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#6fd08c';
  ctx.beginPath(); ctx.arc(ox, oy, 3, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 1;
  // where the sampled ball actually went
  if (reveal.landing) paintBall(toScreen(reveal.landing));
  // the post-shot note now lands as the DOM stamp + glass chip (showStamp),
  // not the painted callout card
}

function windLabel() {
  const w = course.wind ?? { x: 0, y: 0 };
  if (!w.x && !w.y) return '';
  const mag = Math.max(Math.abs(w.x), Math.abs(w.y));
  const dir = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][
    ((Math.round(Math.atan2(w.y, w.x) / (Math.PI / 4)) % 8) + 8) % 8];
  return copy.wind(mag, dir);
}

function setAim(pt) {
  if (putting) return setPuttAim(pt);
  const lie = lieParams(cellAt(course, ball.x, ball.y));
  const d = Math.hypot(pt.x - ball.x, pt.y - ball.y);
  // clamp inside the ring by half a tile so rounding can't push the target
  // past maxDist (which the evaluator would price as unreachable)
  const clamp = Math.min(1, (reach(lie, profile) - 0.51) / Math.max(d, 0.001));
  aimTarget = {
    x: Math.round(ball.x + (pt.x - ball.x) * clamp),
    y: Math.round(ball.y + (pt.y - ball.y) * clamp),
  };
  updateAimReadout(lie);
  refresh();
}

function updateAimReadout(lie) {
  const carry = Math.hypot(aimTarget.x - ball.x, aimTarget.y - ball.y);
  const leaves = toPin(aimTarget);
  verdict.textContent = copy.aimReadout({
    carry: yards(carry), club: clubName(carry),
    leaves: yards(leaves), atFlag: !(leaves > 1.5),
  });
  const s = sigmas(carry, lie.sigmaScale, profile);
  const stats = patternStats(course, ball, aimTarget, lie.sigmaScale, profile);
  document.getElementById('pattern').innerHTML = proMode
    ? copy.proPattern
    : copy.patternLine({
        w: yards(4 * s.lat), l: yards(4 * s.long), pct: stats.pct,
        medianLeave: stats.medianLeave !== null ? yards(stats.medianLeave) : null,
      });
  // the screen itself feels the danger: tint the vignette toward alarm
  setDanger(stats.pct);
  // haptic tick when water/OB comes into or out of play while dragging
  const wetNow = stats.pct.wet > 0;
  if (touchMode && wetNow !== hadWater) navigator.vibrate?.(12);
  hadWater = wetNow;
}

/** Putt aim stays FRACTIONAL — pace is measured in inches, not tiles — and is
 *  clamped to the putting surface (green + ~2 tiles of fringe, capped). */
function setPuttAim(pt) {
  const dx = pt.x - puttPos.x;
  const dy = pt.y - puttPos.y;
  const d = Math.hypot(dx, dy) || 0.001;
  let f = Math.min(1, (PUTT_MAX - 0.01) / d);
  f = Math.max(f * d, 0.05) / d; // never aim exactly at your feet
  // walk back toward the ball until the target sits on green/fringe
  for (let k = 0; k < 24; k++) {
    const t = { x: puttPos.x + dx * f, y: puttPos.y + dy * f };
    if (onPuttingSurface(course, t.x, t.y)) {
      aimTarget = t;
      updatePuttReadout();
      refresh();
      return;
    }
    f *= 0.92;
  }
  aimTarget = { x: course.hole.x, y: course.hole.y }; // degenerate drag: aim the cup
  updatePuttReadout();
  refresh();
}

function updatePuttReadout() {
  const d = Math.hypot(aimTarget.x - puttPos.x, aimTarget.y - puttPos.y);
  const toCup = toPin(puttPos);
  const stats = puttStats(course, puttPos, aimTarget, profile);
  const paceFt = (d - toCup) * 48; // + past the cup, − short (along your line)
  // green reading: when slope bends this line, the caddie says so out loud
  const br = puttBreakDrift(course, puttPos, aimTarget);
  let breakNote = '';
  if (Math.abs(br.cross) > CUP_R * 0.5) {
    const side = br.cross > 0 ? 'right' : 'left';
    const cups = Math.round(Math.abs(br.cross) / (CUP_R * 2));
    breakNote = copy.puttBreakNote(side, cups);
  }
  verdict.textContent = copy.puttAim({ ft: feet(toCup), pace: copy.paceCall(paceFt), make: stats.makePct }) + breakNote;
  document.getElementById('pattern').innerHTML = proMode
    ? copy.proPattern
    : copy.puttPatternLine({
        make: stats.makePct, three: stats.threePct,
        leave: stats.medianLeave !== null ? feet(stats.medianLeave) : null,
      });
  // no water alarm on the dance floor — the pulse tracks three-putt risk
  setHeartbeat(Math.min(1, stats.threePct / 50));
}

function eventCoursePoint(e) {
  const r = canvas.getBoundingClientRect();
  return fromScreenPx(
    (e.clientX - r.left) * (canvas.width / r.width),
    (e.clientY - r.top) * (canvas.height / r.height)
  );
}

/** Touch users get a sensible starting target to nudge from. */
function initNeutralAim() {
  if (putting) return setPuttAim({ x: course.hole.x, y: course.hole.y });
  const lie = lieParams(cellAt(course, ball.x, ball.y));
  const d = toPin(ball);
  const f = Math.min(reach(lie, profile) * 0.7, Math.max(1, d)) / Math.max(d, 0.001);
  setAim({ x: ball.x + (course.hole.x - ball.x) * f, y: ball.y + (course.hole.y - ball.y) * f });
}

canvas.addEventListener('pointermove', (e) => {
  if (phase !== 'aim') return;
  if (e.pointerType === 'touch') {
    // relative drag: the target moves with your finger's delta, so the
    // thumb never has to sit on the pattern itself
    if (!dragStart) return;
    e.preventDefault();
    const now = eventCoursePoint(e);
    setAim({
      x: dragStart.t0.x + (now.x - dragStart.at.x),
      y: dragStart.t0.y + (now.y - dragStart.at.y),
    });
    return;
  }
  setAim(eventCoursePoint(e)); // mouse: classic hover-follow
});

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  if (!touchMode) {
    touchMode = true;
    document.body.classList.add('touch');
  }
  if (phase === 'reveal') {
    advance();
    return;
  }
  if (phase !== 'aim') return;
  e.preventDefault();
  if (!aimTarget) initNeutralAim();
  dragStart = { at: eventCoursePoint(e), t0: { ...aimTarget } };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // synthetic/expired pointers can't be captured; dragging still works
  }
});
window.addEventListener('pointerup', () => {
  dragStart = null;
  // a framing that came due mid-drag runs now that the finger is off the glass
  if (camPending) {
    const p = camPending;
    camPending = null;
    applyCam(p.mode, p.opts);
  }
});

canvas.addEventListener('click', () => {
  if (touchMode) return; // touch commits via the Hit button; taps advance reveals
  if (phase === 'reveal') return advance();
  if (phase !== 'aim' || !aimTarget) return;
  commitDecision();
});

document.getElementById('hit').addEventListener('click', () => {
  if (phase === 'aim' && aimTarget) commitDecision();
});

// leaderboard URL: a plain preference riding along in the My-game panel
const boardInput = document.getElementById('c-board');
try {
  if (boardInput) boardInput.value = localStorage.getItem('golfcms.leaderboard.url') ?? '';
} catch { /* storage blocked: field starts empty */ }

document.getElementById('custom-apply').addEventListener('click', () => {
  try {
    const url = boardInput?.value.trim() ?? '';
    if (url) localStorage.setItem('golfcms.leaderboard.url', url);
    else localStorage.removeItem('golfcms.leaderboard.url');
  } catch { /* best-effort preference */ }
  const custom = {
    base: Number(document.getElementById('c-width').value),
    longExtra: Number(document.getElementById('c-long').value),
    bias: Number(document.getElementById('c-bias').value),
    dist: Number(document.getElementById('c-dist')?.value ?? 1),
  };
  localStorage.setItem('golfcms.customProfile', JSON.stringify(custom));
  localStorage.setItem('golfcms.handicap', 'custom');
  profile = resolveProfile('custom');
  document.getElementById('custom-panel').hidden = true;
  if (course && phase !== 'loading') {
    verdict.textContent = copy.recalibratingCustom;
    setTimeout(() => {
      V = strokesField(course, 6, profile);
      verdict.textContent = copy.recalibratedCustom(yards(toPin(ball)));
      refresh();
    }, 30);
  }
});

const proBtn = document.getElementById('pro');
proBtn.classList.toggle('active', proMode);
proBtn.addEventListener('click', () => {
  proMode = !proMode;
  localStorage.setItem('golfcms.pro', proMode ? '1' : '0');
  proBtn.classList.toggle('active', proMode);
  if (aimTarget && phase === 'aim') {
    if (putting) updatePuttReadout();
    else updateAimReadout(lieParams(cellAt(course, ball.x, ball.y)));
  }
  refresh();
});

window.addEventListener('resize', () => {
  if (course && phase !== 'loading') refresh();
});

document.getElementById('commit').addEventListener('click', advance);

function commitDecision() {
  if (putting) return commitPutt();
  const from = { ...ball };
  const lie = lieParams(cellAt(course, from.x, from.y));
  const score = scoreDecision(course, V, from, aimTarget, profile);
  const heat = aimHeatmap(course, V, from, 1, profile);
  const land = sampleLanding(course, from, aimTarget, lie.sigmaScale, strokes, profile);
  const rest = restingCell(course, land.x, land.y);
  recHole?.decisions.push({ x: aimTarget.x, y: aimTarget.y }); // for the replay record
  strokes += 1;
  let outcome;
  if (rest.kind === 'rest') {
    ball = { x: rest.x, y: rest.y };
    outcome = rest.terrain === WATER ? 'splash' : 'landed';
  } else {
    strokes += 1; // penalty; replay from the same spot
    outcome = rest.kind === 'water' ? 'penalty-water' : 'penalty-ob';
  }
  decisions.push(score);
  reveal = {
    your: { ...aimTarget }, score, heat,
    landing: rest.kind === 'rest' ? { x: rest.x, y: rest.y } : null,
    from: { ...from },
    maxHeat: Math.max(1, ...heat.map((c) => Math.hypot(c.x - from.x, c.y - from.y))),
  };
  phase = 'reveal';
  clearDanger();
  // camera: slow push toward where the ball finished (or the replay lie)
  startPushIn(reveal.landing ?? reveal.from);
  const sg = score.sgLost;
  const outcomeText = copy.outcome[outcome];
  const ballNow = rest.kind === 'rest' ? copy.ballOut(yards(toPin(ball))) : outcomeText;
  verdict.textContent = copy.verdictLine({
    call: copy.verdictCall(sg),
    optCarry: yards(Math.hypot(score.optimal.x - from.x, score.optimal.y - from.y)),
    yourE: score.yourE.toFixed(2),
    optimalE: score.optimalE.toFixed(2),
    sg: sg.toFixed(2),
    points: score.points,
    ballNow,
  });
  // risk ledger: your line vs the caddie's, in trouble percentages
  const trouble = (t) => {
    const p = patternStats(course, from, t, lie.sigmaScale, profile).pct;
    return p.wet + p.sand + p.trees;
  };
  const yourRisk = trouble(reveal.your);
  const caddieRisk = trouble(score.optimal);
  Object.assign(score, { yourRisk, caddieRisk });
  document.getElementById('pattern').innerHTML = copy.riskLedger(yourRisk, caddieRisk);
  // career log: every decision, forever (well, the last 2000)
  try {
    const KEY = 'golfcms.caddie.log.v1';
    const log = JSON.parse(localStorage.getItem(KEY)) ?? [];
    log.push({
      at: Date.now(), round: round.seed, hole: round.holeIndex + 1, shot: decisions.length,
      par: holeInfo.par, holeYds: holeInfo.yds,
      category: decisions.length === 1 ? 'tee' : 'approach',
      sgLost: +sg.toFixed(3), points: score.points,
      risk: yourRisk, caddieRisk, hcp: profile.id,
    });
    if (log.length > 2000) log.splice(0, log.length - 2000);
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch { /* storage blocked: career stats are best-effort */ }
  // inline post-shot note, pinned to where the ball finished
  reveal.note = {
    title: copy.noteTitle(sg),
    tone: sg < 0.08 ? 'good' : sg < 0.2 ? 'ok' : 'bad',
    lines: copy.noteLines({
      sg: sg < 0.005 ? '±0.00' : '−' + sg.toFixed(2),
      points: score.points,
      yourE: score.yourE.toFixed(2),
      optimalE: score.optimalE.toFixed(2),
      yourRisk, caddieRisk,
      last: outcome !== 'landed' ? outcomeText : copy.ballOut(yards(toPin(ball))),
    }),
  };
  // flight comet toward where the strike actually came down, then the sweep
  startShotFx(from, { x: land.x, y: land.y });
  refresh();
}

/** One putt decision through the real commit path: score the pace against the
 *  caddie's read, roll the one seeded ball, hole it or live with the leave. */
function commitPutt() {
  const from = { x: puttPos.x, y: puttPos.y };
  const target = { x: aimTarget.x, y: aimTarget.y };
  const score = scorePuttDecision(course, V, from, target, profile);
  const heat = puttHeatmap(course, V, from, profile);
  const roll = samplePuttRoll(course, from, target, strokes, profile);
  const holed = puttHolesOut(from, roll, course.hole);
  recHole?.puttDecisions.push({ x: target.x, y: target.y }); // for the replay record
  strokes += 1;
  puttCount += 1;
  let outcome;
  if (holed) {
    holedOut = true;
    puttPos = { x: course.hole.x, y: course.hole.y };
    ball = { ...course.hole };
    outcome = 'holed';
  } else {
    const rest = restingCell(course, roll.x, roll.y);
    if (rest.kind === 'rest') {
      puttPos = { x: roll.x, y: roll.y };
      ball = { x: rest.x, y: rest.y }; // integer shadow for the terrain logic
      outcome = 'left';
    } else {
      strokes += 1; // raced it into the pond: penalty, replay from the same spot
      outcome = 'penalty-water';
    }
  }
  score.putt = true;
  decisions.push(score);
  reveal = {
    your: target, score, heat, putt: true, holed,
    landing: holed ? { ...course.hole } : outcome === 'left' ? { ...puttPos } : null,
    from,
    maxHeat: Math.max(1, ...heat.map((c) => Math.hypot(c.x - from.x, c.y - from.y))),
  };
  phase = 'reveal';
  clearDanger();
  startPushIn(reveal.landing ?? reveal.from);
  const sg = score.sgLost;
  const result = outcome === 'holed' ? copy.puttResult.holed
    : outcome === 'left' ? copy.puttResult.left(feet(toPin(puttPos)))
    : copy.puttResult['penalty-water'];
  verdict.textContent = copy.puttVerdictLine({
    call: copy.puttVerdictCall(sg),
    pace: copy.paceCall(score.optimalPast * 48),
    yourE: score.yourE.toFixed(2),
    optimalE: score.optimalE.toFixed(2),
    sg: sg.toFixed(2),
    points: score.points,
    result,
  });
  // make ledger: your pace vs the caddie's, in drop percentages
  const mk = (t) => puttStats(course, from, t, profile);
  const yourStats = mk(target);
  const caddieStats = mk(score.optimal);
  Object.assign(score, { yourMake: yourStats.makePct, caddieMake: caddieStats.makePct });
  document.getElementById('pattern').innerHTML = copy.puttLedger(yourStats.makePct, caddieStats.makePct);
  // career log: putt decisions land under their own category
  try {
    const KEY = 'golfcms.caddie.log.v1';
    const log = JSON.parse(localStorage.getItem(KEY)) ?? [];
    log.push({
      at: Date.now(), round: round.seed, hole: round.holeIndex + 1, shot: decisions.length,
      par: holeInfo.par, holeYds: holeInfo.yds,
      category: 'putt',
      sgLost: +sg.toFixed(3), points: score.points,
      risk: yourStats.threePct, caddieRisk: caddieStats.threePct, hcp: profile.id,
    });
    if (log.length > 2000) log.splice(0, log.length - 2000);
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch { /* storage blocked: career stats are best-effort */ }
  reveal.note = {
    title: outcome === 'holed' ? copy.puttHoledTitle : copy.noteTitle(sg),
    tone: sg < 0.08 ? 'good' : sg < 0.2 ? 'ok' : 'bad',
    lines: copy.noteLines({
      sg: sg < 0.005 ? '±0.00' : '−' + sg.toFixed(2),
      points: score.points,
      yourE: score.yourE.toFixed(2),
      optimalE: score.optimalE.toFixed(2),
      yourRisk: yourStats.threePct, caddieRisk: caddieStats.threePct,
      last: result,
    }),
  };
  // low flat roll toward where the ball actually finished (or the cup)
  startShotFx(from, holed ? course.hole : roll, { putt: true });
  refresh();
}

/** Enter (or continue) the putt decision loop from the ball's green lie. */
function beginPutting() {
  putting = true;
  puttPos = puttPos ?? { x: ball.x, y: ball.y };
  phase = 'aim';
  aimTarget = null;
  reveal = null;
  // the dance floor deserves the room: ease in to the green + its fringe, on
  // the art cut for it (built here so the first zoomed frame already has it)
  ensureGreenArt();
  requestCam('green');
  const ft = feet(toPin(puttPos));
  verdict.textContent = puttCount === 0 ? copy.puttFirst(ft) : copy.puttNext(puttCount + 1, ft);
  document.getElementById('pattern').textContent = '';
  if (touchMode) initNeutralAim();
  refresh();
}

function advance() {
  cancelFx();
  hideStamp();
  clearDanger();
  clearPushIn();
  if (holedOut) return finishHole();
  if (putting && puttCount >= 4) {
    // mercy rule: four putt decisions is enough — concede the tap-in
    strokes += 1;
    holedOut = true;
    return finishHole();
  }
  if (isHoleOver(course, ball)) return beginPutting(); // on the green: putt for real
  const rolledOff = putting;
  if (putting) {
    // the putt rolled off the green — back to a real lie and a real swing
    putting = false;
    puttPos = null;
  }
  if (decisions.filter((d) => !d.putt).length >= 8) return finishHole();
  phase = 'aim';
  aimTarget = null;
  reveal = null;
  if (rolledOff) requestCam('course'); // full swing again: pull back out
  verdict.textContent = copy.nextShot(strokes + 1, yards(toPin(ball)));
  document.getElementById('pattern').textContent = '';
  if (touchMode) initNeutralAim();
  refresh();
}

/** Daily streak: record today's finished Daily and count consecutive days
 *  (UTC, matching the daily seed) ending today. Best-effort, like all stats. */
function recordDailyStreak() {
  try {
    const KEY = 'golfcms.caddie.streak.v1';
    const data = JSON.parse(localStorage.getItem(KEY)) ?? {};
    const dates = Array.isArray(data.dates) ? data.dates : [];
    const today = new Date().toISOString().slice(0, 10);
    if (!dates.includes(today)) dates.push(today);
    dates.sort();
    if (dates.length > 400) dates.splice(0, dates.length - 400);
    localStorage.setItem(KEY, JSON.stringify({ dates }));
    const have = new Set(dates);
    let streak = 0;
    for (let t = Date.parse(today); have.has(new Date(t).toISOString().slice(0, 10)); t -= 86400000) streak += 1;
    return streak;
  } catch {
    return 0; // storage blocked: no streak, no drama
  }
}

function finishHole() {
  // the hole is done: pull back out to the course view behind the card
  requestCam('course');
  // bank this hole's decision record for the round submission
  if (recHole) {
    round.rec?.push(recHole);
    recHole = null;
  }
  // holed out: the card shows REAL strokes, actual putts included. Only a
  // hole abandoned at the decision cap still gets the old 2.5-putt estimate.
  const total = holedOut ? strokes : strokes + 2.5;
  // calibration ledger: what the model said off the tee vs what you carded
  try {
    const KEY = 'golfcms.calibration.v1';
    let cal = JSON.parse(localStorage.getItem(KEY)) ?? [];
    if (!Array.isArray(cal)) cal = [];
    if (decisions.length && Number.isFinite(decisions[0]?.yourE)) {
      cal.push({
        at: Date.now(),
        predicted: +decisions[0].yourE.toFixed(2),
        actual: +total.toFixed(holedOut ? 0 : 1),
        holed: holedOut,
        n: decisions.length,
      });
      if (cal.length > 500) cal.splice(0, cal.length - 500);
      localStorage.setItem(KEY, JSON.stringify(cal));
    }
  } catch { /* storage blocked: calibration is best-effort */ }
  const holePts = Math.round(decisions.reduce((s, d) => s + d.points, 0) / Math.max(1, decisions.length));
  round.holes.push({
    points: holePts,
    strokes: +total.toFixed(holedOut ? 0 : 1),
    recap: decisions.map((d, i) => ({
      hole: round.holeIndex + 1, shot: i + 1, sgLost: d.sgLost,
      risk: d.yourRisk ?? 0, caddieRisk: d.caddieRisk ?? 0,
    })),
  });
  round.totalPoints += holePts;
  phase = 'holeover';
  const done = round.holeIndex + 1 >= round.count;
  if (done && round.daily) round.streak = recordDailyStreak();
  overlay.querySelector('.big').textContent = done
    ? copy.roundScore(round.label ?? copy.genericRoundLabel, round.totalPoints, round.count * 1000)
    : copy.holeScore(round.holeIndex + 1, holePts);
  const vsParN = total - holeInfo.par;
  const holeLine = holedOut
    ? copy.holeSubReal({
        decisions: decisions.length, strokes, putts: puttCount,
        par: holeInfo.par, yds: holeInfo.yds,
        vsPar: vsParN === 0 ? 'E' : vsParN > 0 ? `+${vsParN}` : `${vsParN}`,
      })
    : copy.holeSub({
        decisions: decisions.length, est: total.toFixed(1), par: holeInfo.par, yds: holeInfo.yds,
        vsPar: `${vsParN >= 0 ? '+' : ''}${vsParN.toFixed(1)}`,
      });
  overlay.querySelector('.sub').textContent = done
    ? copy.roundSub(round.count, copy.roundGrade(round.totalPoints / (round.count * 1000)))
      + (round.streak > 1 ? ` · 🔥 ${round.streak}` : '')
    : holeLine;
  document.getElementById('ov-next').textContent = done ? copy.newRound : copy.nextHole;
  const coach = document.getElementById('coach');
  if (done) {
    const all = round.holes.flatMap((h) => h.recap ?? []);
    const worst = all.filter((d) => d.sgLost > 0.05).sort((a, b) => b.sgLost - a.sgLost).slice(0, 2);
    coach.textContent = worst.length === 0 ? copy.coachClean : copy.coachNotes(worst);
    coach.hidden = false;
  } else {
    coach.hidden = true;
  }
  overlay.classList.add('show');
  if (done) submitRoundToBoard(round); // silent, optional, never blocks the UI
}

/** Offer the finished round to the leaderboard, if one is configured. The
 *  payload is the decision record — the server replays it and computes the
 *  points itself. Every failure mode is silent: the board is a bonus. */
async function submitRoundToBoard(r) {
  let url = null;
  try {
    url = localStorage.getItem('golfcms.leaderboard.url');
  } catch {
    return; // storage blocked: no board configured
  }
  if (!url || !Array.isArray(r?.rec) || r.rec.length !== r.count) return;
  try {
    const record = encodeCaddieRound({
      roundSeed: r.seed, count: r.count, hcp: profile.id, holes: r.rec,
    }); // throws for custom profiles — the board only takes known handicaps
    const res = await fetch(`${url.replace(/\/+$/, '')}/caddie-scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!Number.isInteger(data?.rank) || !Number.isInteger(data?.of)) return;
    // still on this round's final overlay? append the rank to the sub line
    if (round === r && phase === 'holeover') {
      overlay.querySelector('.sub').textContent += ` · ${copy.boardRank(data.rank, data.of)}`;
    }
  } catch {
    /* offline, misconfigured, or rejected: the round result stands alone */
  }
}

function shareText() {
  const label = round.label ??
    (round.daily ? copy.shareDaily(dailyNumber()) : copy.shareRound(round.seed));
  const text = copy.share({
    label, total: round.totalPoints, max: round.count * 1000,
    squares: copy.shareSquares(round.holes),
  });
  return round.streak > 1 ? `${text} 🔥${round.streak}` : text;
}

document.getElementById('ov-next').addEventListener('click', () => {
  if (round.holeIndex + 1 >= round.count) {
    startRound((Math.random() * 0xffffffff) >>> 0, false);
  } else {
    round.holeIndex += 1;
    loadHole();
  }
});
document.getElementById('ov-share').addEventListener('click', () => navigator.clipboard?.writeText(shareText()));
document.getElementById('share').addEventListener('click', () => navigator.clipboard?.writeText(shareText()));
const hcpSel = document.getElementById('handicap');
for (const h of HANDICAPS) {
  const o = document.createElement('option');
  o.value = h.id;
  o.textContent = h.label;
  o.selected = h.id === profile.id;
  hcpSel.append(o);
}
{
  const o = document.createElement('option');
  o.value = 'custom';
  o.textContent = 'Custom…';
  o.selected = profile.id === 'custom';
  hcpSel.append(o);
}
hcpSel.addEventListener('change', () => {
  if (hcpSel.value === 'custom') document.getElementById('custom-panel').hidden = false;
  profile = resolveProfile(hcpSel.value);
  localStorage.setItem('golfcms.handicap', hcpSel.value);
  if (course && phase !== 'loading') {
    verdict.textContent = copy.recalibratingHcp(profile.label.toLowerCase());
    setTimeout(() => {
      V = strokesField(course, 6, profile);
      verdict.textContent = copy.recalibratedHcp(profile.label.toLowerCase(), yards(toPin(ball)));
      refresh();
    }, 30);
  }
});

// test hooks
window.__caddie = {
  get state() {
    return { phase, ball, strokes, decisions, round, course, putting, puttPos, puttCount, holedOut,
      aimTarget, camera: { ...camera }, camMode, rotated, camAnimating: Boolean(camAnim),
      // the green complex: whether it exists, what it cost, how often it drew
      greenArt: greenArt
        ? { w: greenArt.w, h: greenArt.h, sub: greenArt.sub, sloped: greenArt.sloped,
            px: greenArt.canvas.width, ...greenArtStats }
        : null,
      greenArtLive: onGreenArt(), frameMs: +lastFrameMs.toFixed(2) };
  },
  aimAt(x, y) { aimTarget = { x, y }; commitDecision(); },
  advance,
  /** Test hook: repaint both art layers for the course as it stands now. Lets a
   *  harness stamp a different biome's cells onto the live hole and see the art
   *  that terrain earns. Never called by the game itself. */
  rebuildArt() {
    art = renderCourseArt(course);
    greenArt = null;
    greenRect = findGreenRect();
    V = strokesField(course, 6, profile);
    if (putting) ensureGreenArt();
    refresh();
  },
};

function startMajor() {
  const wk = weekKey();
  startRound(gauntletSeed('caddie-major-' + wk), false,
    { count: 5, label: copy.majorLabel(wk), hash: '#/major' });
}

function startChampionship(seed = (Math.random() * 0xffffffff) >>> 0) {
  startRound(seed >>> 0, false,
    { count: 18, label: copy.champLabel(seed), hash: `#/champ/${seed}` });
}

// the Round menu: one control, four ways to play
modeSel.addEventListener('change', () => {
  const v = modeSel.value;
  if (v === 'daily') startRound(dailySeed(), true);
  else if (v === 'major') startMajor();
  else if (v === 'champ') startChampionship();
  else startRound((Math.random() * 0xffffffff) >>> 0, false);
});

// "My game" disclosure: the custom-pattern panel stays out of the way
const mygameBtn = document.getElementById('mygame');
mygameBtn.addEventListener('click', () => {
  const panel = document.getElementById('custom-panel');
  panel.hidden = !panel.hidden;
  mygameBtn.setAttribute('aria-expanded', String(!panel.hidden));
});

// control labels live in copy.js with everything else
document.getElementById('hit').textContent = copy.hitIt;
document.getElementById('commit').textContent = copy.playOn;
document.getElementById('ov-share').textContent = copy.copyResult;

// first-run onboarding: three cards, dismissible, never shown again
{
  const ob = document.getElementById('onboard');
  let seen = '1';
  try { seen = localStorage.getItem('golfcms.onboarded.v1'); } catch { /* storage blocked: skip it */ }
  if (ob && !seen) {
    let step = 0;
    const render = () => {
      const s = copy.onboarding[step];
      document.getElementById('ob-step').textContent = copy.onboardingStep(step + 1, copy.onboarding.length);
      document.getElementById('ob-title').textContent = s.title;
      document.getElementById('ob-body').textContent = s.body;
      document.getElementById('ob-next').textContent =
        step === copy.onboarding.length - 1 ? copy.onboardingPlay : copy.onboardingNext;
      document.getElementById('ob-skip').textContent = copy.onboardingSkip;
    };
    const dismiss = () => {
      try { localStorage.setItem('golfcms.onboarded.v1', '1'); } catch { /* best-effort */ }
      ob.remove();
    };
    document.getElementById('ob-next').addEventListener('click', () => {
      if (step < copy.onboarding.length - 1) { step += 1; render(); } else dismiss();
    });
    document.getElementById('ob-skip').addEventListener('click', dismiss);
    render();
    ob.hidden = false;
  } else {
    ob?.remove();
  }
}

try {
  navigator.serviceWorker?.register('sw.js');
} catch { /* offline support is a bonus, never a requirement */ }

const m = location.hash.match(/^#\/round\/(\d+)/);
const mc = location.hash.match(/^#\/champ\/(\d+)/);
if (location.hash.startsWith('#/major')) startMajor();
else if (mc) startChampionship(Number(mc[1]));
else if (m) startRound(Number(m[1]) >>> 0, false);
else startRound(dailySeed(), true);
