// Caddie: the decision game. You are dropped on a generated hole and choose
// aim targets for the tee shot and every approach. Your dispersion pattern —
// not a perfect strike — decides where the ball goes; every choice is scored
// in strokes gained against the optimal target, with a full reveal.

import { cellAt, inBounds, dist } from '../engine/course.js';
import { GREEN, WATER, slopeDir } from '../engine/terrain.js';
import { lieParams, lieParamsAt, shotPlaysLike, sigmas, patternStats, sampleLanding, restingCell, windShift, reach, HANDICAPS, handicapById, puttSigmas, samplePuttRoll, puttHolesOut, PUTT_MAX, puttBreakDrift, CUP_R } from '../engine/dispersion.js';
import { strokesField, scoreDecision, aimHeatmap, isHoleOver, scorePuttDecision, puttHeatmap, puttStats, onPuttingSurface } from '../engine/strategy.js';
import { caddieHoleSeed, caddieHoleCourse, encodeCaddieRound } from '../engine/caddierec.js';
import { dailySeed, dailyNumber } from '../engine/puzzle.js';
import { weekKey, gauntletSeed } from '../engine/gauntlet.js';
import { courseName } from '../engine/namer.js';
import { yards, feet, holeYards, parForTiles, clubName } from '../engine/yards.js';
import {
  renderCourseArt, renderGreenBook, drawFlag, drawBall, drawPin, drawBallWorld,
  legendFor, TILE, renderCostImage, coneBeamPath, CONE_ALPHA,
} from './paint.js';
import {
  makeCamera, worldToScreen, screenToWorld, worldTransform, courseCamera,
  frameRect, easeOutCubic, lerpCamera, sameCamera,
  corridorRect, zoomAbout, panBy, clampCenter,
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
let countdownTimer = null; // ticks the "next daily in…" clock on the round overlay
let rival = null; // a challenge link's card to beat: {seed, holes: [pts], total}
let riskStreak = 0; // days of daily streak that die at UTC midnight if today goes unplayed
let course = null;
let V = null;
let costImage = null; // release E: V as greyscale, one pixel per tile, cached per hole
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
// Which page of the yardage book is showing under the break arrows: the slope
// heat (how steep, in percent), the cost heat (expected putts from here — the
// page a printed book cannot draw), or none. Break arrows are always on.
const HEAT_KEY = 'golfcms.greenPage.v1';
const HEAT_PAGES = [null, 'slope', 'cost'];
let heatPage = (() => {
  try {
    const v = localStorage.getItem(HEAT_KEY);
    return HEAT_PAGES.includes(v) ? v : null;
  } catch { return null; }
})();
let heatBtn = null;
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
let camMode = 'course'; // 'course' | 'approach' | 'green' — what it is framing
let camAnim = null; // {from, to, t0, dur} while easing between framings
let camRaf = 0;
let camPending = null; // a transition that arrived mid-drag, owed at pointerup
let greenRect = null; // this hole's green bbox + centroid, computed once
let approachRect = null; // the ball→pin corridor, re-derived on every new lie
// The player's own camera, on top of the automatic framing: pinch/wheel zoom
// and two-finger pan write here. It outlives a resize or a rotate (the numbers
// are world tiles, not pixels) and is cleared by the next phase change or by
// Recenter — so the game always gets the last word about what a NEW lie shows.
let manualCam = null;
// The overview peek: hold it and the whole hole is back, whatever the framing.
// It is a display state only — camMode still remembers what we peeked out of.
let peeking = false;
const CAM_MS = 700;
const PEEK_MS = 300; // the peek is a glance, not a cinematic move
const GREEN_PAD = 2; // tiles of fringe to keep around the green
const APPROACH_PAD = 2.5; // tiles of room around the ball→pin corridor
const APPROACH_TILES = 5; // <= 5 tiles (80 yds) to the pin is an approach
const ZOOM_MIN_MUL = 0.75; // how far under the framing scale a pinch may go
const ZOOM_MAX_MUL = 6; // …and how far over it
const ZOOM_FLOOR = 1; // never below the course view
const ZOOM_CEIL = 8; // …nor past legibility
const PEEK_PINCH = 0.62; // pinch out to 62% of the start = "show me the hole"

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
  greenArt = renderGreenBook(course, greenRect, {
    heat: heatPage, profile, V,
    holeNumber: round ? round.holeIndex + 1 : null,
  });
  greenArtStats.builds += 1;
  greenArtStats.buildMs = +(greenArt.ms.total ?? 0);
  return greenArt;
}

/** Swap the book's heat page. paint.js caches every layer per hole, so
 *  flipping pages re-composites rather than re-deriving the green. */
function setHeatPage(kind) {
  heatPage = kind;
  try {
    localStorage.setItem(HEAT_KEY, kind ?? 'none');
  } catch { /* private mode: the page choice just won't persist */ }
  if (heatBtn) {
    const legend = kind ? legendFor(kind) : null;
    heatBtn.textContent = kind === 'slope' ? 'Slope' : kind === 'cost' ? 'Cost' : 'Break';
    heatBtn.title = legend
      ? `Green page: ${legend.label} (${legend.min}–${legend.max}${legend.unit}). Click to change.`
      : 'Green page: break arrows only. Click to change.';
    heatBtn.classList.toggle('active', Boolean(kind));
  }
  if (greenRect && course) {
    greenArt = null; // the composite changed; the cached layers under it did not
    if (camMode === 'green') ensureGreenArt();
    refresh();
  }
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
  if (mode === 'approach' && approachRect) {
    return frameRect(approachRect, { ...view, ...visibleCanvasPx(), pad: APPROACH_PAD, min: 1, max: 4 });
  }
  return courseCamera(view);
}

/** The framing this LIE earns, and the corridor it needs. Called on every new
 *  lie and nowhere else — the same rule wave 1 set: phase changes only.
 *  Putting always wins; inside 80 yards the ball→pin corridor is the story;
 *  anything longer is still a whole-hole decision, so stay wide. */
function lieCamMode() {
  approachRect = null;
  if (putting) return 'green';
  if (!course || !ball) return 'course';
  if (toPin(ball) > APPROACH_TILES) return 'course';
  approachRect = corridorRect(ball, course.hole);
  return 'approach';
}

/** What the camera should be RIGHT NOW: a peek beats everything, the player's
 *  own zoom beats the automatic framing, and the framing is the floor. */
function activeCamera() {
  if (peeking) return courseCamera(camView());
  if (manualCam) return manualCam;
  return desiredCamera(camMode);
}

/** The automatic framing's scale — what a manual zoom is measured against. */
const frameScale = () => desiredCamera(camMode).scale;

/** How far the player may zoom from here: a window around the framing scale,
 *  never below the course view and never past legibility. The floor also gives
 *  way to where the camera already IS — peeked all the way out to scale 1, a
 *  wheel must zoom from there instead of snapping up to the framing's floor. */
function zoomBounds() {
  const base = frameScale();
  return {
    min: Math.max(ZOOM_FLOOR, Math.min(base * ZOOM_MIN_MUL, camera.scale)),
    max: Math.min(ZOOM_CEIL, base * ZOOM_MAX_MUL),
  };
}

const camBounds = () => ({ width: course?.width ?? 40, height: course?.height ?? 24, margin: 2 });

// --- the arrival -----------------------------------------------------------
// A new hole opens ON THE GREEN: the camera holds there with a title card —
// name, number, par and yardage, what green and where the flag is cut — then
// eases back down the fairway to the tee. Since release D the hole is worth
// reading before the swing; this makes the game read it to you. Any input
// skips straight to the tee framing, and reduced-motion never flies at all.
let introTimer = 0;
const holeCard = document.getElementById('holecard');
const HOLE_CARD_MS = 1500;
const INTRO_EASE_MS = 1300;

function introCamera() {
  if (!greenRect) return null;
  const view = camView();
  return frameRect(
    { x0: greenRect.x0, y0: greenRect.y0, x1: greenRect.x1, y1: greenRect.y1 },
    { ...view, ...visibleCanvasPx(), pad: 3.5, min: 1, max: 3.2 },
  );
}

let cardHideTimer = 0;

function showHoleCard({ kicker, title, sub }) {
  if (!holeCard) return;
  // A hide scheduled moments ago (loadHole's own cleanup, most often) must not
  // fire into the card we are about to show — the first version lost every
  // intro to exactly that stale timer, 450 ms after it began.
  if (cardHideTimer) { clearTimeout(cardHideTimer); cardHideTimer = 0; }
  holeCard.querySelector('.hc-kicker').textContent = kicker;
  holeCard.querySelector('.hc-title').textContent = title;
  holeCard.querySelector('.hc-sub').textContent = sub;
  holeCard.hidden = false;
  requestAnimationFrame(() => holeCard.classList.add('show'));
}

function hideHoleCard() {
  if (!holeCard) return;
  holeCard.classList.remove('show');
  if (cardHideTimer) clearTimeout(cardHideTimer);
  cardHideTimer = setTimeout(() => { cardHideTimer = 0; holeCard.hidden = true; }, 450);
}

/** End the intro early (first input) or on schedule: card away, camera home. */
function endIntro({ instant = false } = {}) {
  if (!introTimer) return;
  clearTimeout(introTimer);
  introTimer = 0;
  hideHoleCard();
  if (instant) applyCam(lieCamMode(), { instant: true });
  else settleCam({ dur: INTRO_EASE_MS });
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

/** Ease the camera to whatever it should be right now (peek, manual zoom, or
 *  the automatic framing). Reduced motion snaps. */
function settleCam({ instant = false, dur = CAM_MS } = {}) {
  const to = activeCamera();
  if (sameCamera(to, camera)) { cancelCamAnim(); camera = to; return; }
  if (instant || reducedMotion.matches) {
    cancelCamAnim();
    camera = to;
    if (course && phase !== 'loading') refresh();
    return;
  }
  cancelCamAnim();
  camAnim = { from: { ...camera }, to, t0: performance.now(), dur };
  camRaf = requestAnimationFrame(camTick);
}

/** Ease the camera to a framing. A phase change is the game taking the wheel
 *  back: the new lie gets to show itself, so a peek and any zoom the player
 *  set are both retired here. */
function applyCam(mode, opts = {}) {
  camMode = mode;
  manualCam = null;
  peeking = false;
  syncPeekBtn();
  settleCam(opts);
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

// --- player camera controls: peek, zoom, pan, recenter ---------------------
// All four write through activeCamera(), so they ride the SAME seam the game's
// own framings do: aiming, drawing and the DOM stamp follow for free.

const peekBtn = document.getElementById('peek');

function syncPeekBtn() {
  peekBtn?.classList.toggle('active', peeking);
  peekBtn?.setAttribute('aria-pressed', String(peeking));
}

/** The overview peek: the whole hole, held or toggled, over any framing. */
function setPeek(on) {
  if (peeking === on) return;
  peeking = on;
  // a relative touch drag measures its delta in the OLD camera — end it rather
  // than let the target jump when the framing changes underneath it
  dragStart = null;
  syncPeekBtn();
  settleCam({ dur: PEEK_MS });
  if (course && phase !== 'loading') refresh();
}

/** Back to the framing the game chose for this lie. */
function recenter() {
  peeking = false;
  manualCam = null;
  syncPeekBtn();
  settleCam({ dur: PEEK_MS });
  if (course && phase !== 'loading') refresh();
}

/** Zoom about a canvas-pixel point, clamped to the window around the framing.
 *  A deliberate zoom is the player taking the wheel, so it ends the peek. */
function zoomAt(sx, sy, factor) {
  if (!course || phase === 'loading') return;
  const from = peeking ? courseCamera(camView()) : camera;
  peeking = false;
  syncPeekBtn();
  cancelCamAnim();
  manualCam = clampCenter(zoomAbout(from, sx, sy, factor, camView(), zoomBounds()), camBounds());
  camera = manualCam;
  refresh();
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
const MARKERS_MS = 520;

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
  } else if (fx.stage === 'sweep') {
    fx.p = Math.min(1, el / SWEEP_MS);
    if (fx.p >= 1) {
      fx = { stage: 'markers', t0: performance.now(), p: 0 };
    }
  } else {
    // markers: your pick lands first, the optimal answers it — the argument
    // of the reveal played as a beat, not dumped as a diagram
    fx.p = Math.min(1, el / MARKERS_MS);
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
  explainSGOnce();
}

/** The moment SG first appears on screen is the moment to say what it means.
 *  One card, once per device; the ? popover carries the full key after that. */
function explainSGOnce() {
  let seen = '1';
  try { seen = localStorage.getItem('golfcms.sgseen.v1'); } catch { /* storage blocked */ }
  if (seen) return;
  const card = document.getElementById('sg-explain');
  if (!card) return;
  document.getElementById('sg-explain-body').textContent = copy.sgExplainer;
  const ok = document.getElementById('sg-explain-ok');
  ok.textContent = copy.sgExplainerOk;
  card.hidden = false;
  ok.addEventListener('click', () => {
    card.hidden = true;
    try { localStorage.setItem('golfcms.sgseen.v1', '1'); } catch { /* best-effort */ }
  }, { once: true });
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
  if (introTimer) { clearTimeout(introTimer); introTimer = 0; }
  hideHoleCard();
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
    costImage = null;
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
    // a fresh hole opens with the ARRIVAL: camera on the green, title card up,
    // then an ease back down the fairway to the framing the tee shot earns.
    // Reduced motion (or a green the finder somehow missed) skips straight
    // to the tee framing, exactly as before.
    const intro = reducedMotion.matches ? null : introCamera();
    if (intro) {
      cancelCamAnim();
      camera = intro;
      showHoleCard({
        kicker: `${courseName(round.seed)} · hole ${round.holeIndex + 1} of ${round.count}`,
        title: `Par ${holeInfo.par} · ${holeInfo.yds} yds`,
        sub: course.green ? copy.greenNote(course.green.archetype, course.pin?.name).replace(/^[\s·]+/, '') : '',
      });
      introTimer = setTimeout(() => {
        introTimer = 0;
        hideHoleCard();
        settleCam({ dur: INTRO_EASE_MS });
      }, HOLE_CARD_MS);
    } else {
      applyCam(lieCamMode(), { instant: true });
    }
    phase = 'aim';
    const label = round.label ?? (round.daily ? copy.dailyLabel(dailyNumber()) : copy.roundLabel(round.seed));
    meta.textContent = copy.holeMeta({
      course: courseName(round.seed), label,
      n: round.holeIndex + 1, count: round.count,
      par: holeInfo.par, yds: holeInfo.yds,
      arch: course.archetype, wind: windLabel(),
      // release C: the hole's green complex has a shape and a hole location, and
      // the caddie says both out loud
      green: course.green ? copy.greenNote(course.green.archetype, course.pin?.name) : null,
    });
    // the streak that dies at midnight rides the ticker until today's daily is in
    if (round.daily && riskStreak > 0) meta.textContent += copy.streakChip(riskStreak);
    verdict.textContent = copy.firstAim(yards(toPin(ball)));
    document.getElementById('pattern').textContent = '';
    if (touchMode) initNeutralAim();
    refresh();
  }, 30);
}

function refresh() {
  const t0 = performance.now();
  drawBase();
  if (phase === 'aim' && aimTarget) drawCone();
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
  // re-derive what the camera should be for the current size/orientation (a
  // no-op unless the window changed) — peek and the player's own zoom included,
  // so a rotate keeps both. An ease in flight owns the camera and is left alone.
  if (!camAnim) camera = activeCamera();
  beginWorld();
  ctx.drawImage(art, 0, 0);
  // the green complex rides on top of the course art, in the same world pixels,
  // so it registers exactly and the course view never sees it
  if (onGreenArt()) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // the book is a stack: turf, heat page, contours, break arrows, furniture —
    // each its own cached canvas over the same world box
    for (const L of greenArt.layers) {
      ctx.drawImage(L.canvas, greenArt.geo.ox, greenArt.geo.oy, greenArt.geo.w, greenArt.geo.h);
    }
    greenArtStats.draws += 1;
  }
  ctx.restore();
  if (onGreenArt()) drawPin(ctx, toScreen(course.hole), camera.scale, shadowDir());
  else drawFlag(ctx, toScreen(course.hole));
  // during the flight comet the interpolated ball is the only ball on screen
  if (!(fx && fx.stage === 'flight')) paintBall(toScreen(putting && puttPos ? puttPos : ball));
}

/**
 * THE EXPECTED-STROKES CONE.
 *
 * The caddie has always known what every tile on the hole costs — that is `V`,
 * the field the entire scoring model is built on — and until now the only way
 * to see it was the reveal heatmap, which arrives *after* the decision.
 *
 * This puts it in front of the player while they are still choosing, without
 * turning the hole into a chart. The rules it obeys:
 *
 *   NO COLOUR, NO NUMBERS. Cheap ground is lit, expensive ground is in shadow.
 *   `soft-light` at 18% bends the art's luminance and leaves its hue alone, so
 *   the result reads as weather rather than as an overlay.
 *   ONLY WHERE THE BALL COULD GO. The field is clipped to a dispersion-shaped
 *   beam. Shading ground this swing cannot reach would be answering a question
 *   nobody asked.
 *   OFF IN PRO MODE, like every other aid — Pro is the judgment test.
 */
function drawCone() {
  if (proMode || !V || !course) return;
  const from = putting && puttPos ? puttPos : ball;
  // The field image is normalised to what THIS swing can reach, so it is cached
  // per lie rather than per hole — rebuilt when the ball moves, never per frame.
  const key = `${from.x},${from.y},${putting ? 'p' : 's'}`;
  if (!costImage || costImage.key !== key) {
    const r = putting ? PUTT_MAX : reach(lieParamsAt(course, from.x, from.y), profile);
    costImage = { key, canvas: renderCostImage(course, V, { from, reach: r }) };
  }
  const dist = Math.hypot(aimTarget.x - from.x, aimTarget.y - from.y);
  if (dist < 0.4) return;

  // sigma at a fraction of the way out, from the same functions the pattern
  // ellipse and the engine use — a cone that flared differently from the real
  // dispersion would be a lie told softly
  const lie = putting ? null : lieParamsAt(course, from.x, from.y);
  const sigmaAt = putting
    ? (t) => puttSigmas(Math.max(0.05, dist * t), profile)
    : (t) => sigmas(Math.max(0.05, dist * t), lie.sigmaScale, profile);
  // ...and on a putt the beam follows the BREAK, because the ball does
  const bend = putting ? puttBreakDrift(course, from, aimTarget) : { x: 0, y: 0 };

  beginWorld();
  ctx.save();
  if (coneBeamPath(ctx, from, aimTarget, sigmaAt, bend)) {
    ctx.clip();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = CONE_ALPHA;
    // one pixel per tile, drawn across the whole board with smoothing on: the
    // bilinear upscale is what stops a coarse field looking like a mosaic
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(costImage.canvas, 0, 0, course.width * TILE, course.height * TILE);
  }
  ctx.restore();
  ctx.restore(); // beginWorld
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
  const lie = lieParamsAt(course, ball.x, ball.y);
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
  const pl = shotPlaysLike(course, ball, aimTarget);
  // the tag says what the shot MEASURES; the second line says what it PLAYS,
  // and only appears when the land is actually worth a club
  const label = Math.abs(pl.deltaYards) >= 2
    ? `${yards(carry)}y · plays ${pl.playsYards}`
    : `${yards(carry)}y`;
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
  // stage 2: heatmap sweeps radially outward from the lie it was hit from.
  // The heat itself is one pixel per tile, upscaled with smoothing — the same
  // bilinear trick as the cone — so the verdict field reads as gradients over
  // the ground instead of as a mosaic of squares, and the sweep edge is a
  // clean clipped circle instead of a popcorn of whole tiles.
  const sweep = fx && fx.stage === 'sweep' ? fx.p : fx && fx.stage === 'flight' ? 0 : 1;
  const origin = reveal.from ?? ball;
  if (!reveal.heatCanvas) reveal.heatCanvas = buildHeatCanvas(reveal.heat, course);
  beginWorld();
  ctx.save();
  if (sweep < 1) {
    const limit = sweep * (reveal.maxHeat ?? 40) * TILE;
    ctx.beginPath();
    ctx.arc((origin.x + 0.5) * TILE, (origin.y + 0.5) * TILE, Math.max(1, limit), 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(reveal.heatCanvas, 0, 0, course.width * TILE, course.height * TILE);
  ctx.restore();
  ctx.restore();
  // the argument, in sequence: your pick lands, then the optimal answers it
  const mk = fx && fx.stage === 'markers' ? fx.p : fx ? 0 : 1;
  const yourT = Math.min(1, mk / 0.4);
  const optT = Math.max(0, Math.min(1, (mk - 0.35) / 0.65));
  if (yourT > 0) {
    const { x: yx, y: yy } = toScreen(reveal.your);
    const k = 1 + (1 - easeOutCubic(yourT)) * 1.6; // punches in from large
    ctx.globalAlpha = yourT;
    ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(yx - 8 * k, yy - 8 * k); ctx.lineTo(yx + 8 * k, yy + 8 * k);
    ctx.moveTo(yx + 8 * k, yy - 8 * k); ctx.lineTo(yx - 8 * k, yy + 8 * k);
    ctx.stroke(); ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  }
  if (optT > 0) {
    const { x: ox, y: oy } = toScreen(reveal.score.optimal);
    const e = easeOutCubic(optT);
    ctx.globalAlpha = optT;
    ctx.strokeStyle = '#6fd08c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ox, oy, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#6fd08c';
    ctx.beginPath(); ctx.arc(ox, oy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1;
    if (optT < 1) {
      // a ripple that announces the answer, then gets out of the way
      ctx.globalAlpha = (1 - e) * 0.8;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ox, oy, 9 + e * 16, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.globalAlpha = 1;
  }
  // where the sampled ball actually went
  if (reveal.landing) paintBall(toScreen(reveal.landing));
  // the post-shot note now lands as the DOM stamp + glass chip (showStamp),
  // not the painted callout card
}

/** The reveal heat as pixels: one per tile, alpha baked in, drawn upscaled. */
function buildHeatCanvas(heat, c) {
  const cv = document.createElement('canvas');
  cv.width = c.width;
  cv.height = c.height;
  const g = cv.getContext('2d');
  const img = g.createImageData(c.width, c.height);
  let min = Infinity;
  for (const cell of heat) min = Math.min(min, cell.e);
  for (const cell of heat) {
    const badness = Math.min(1, (cell.e - min) / 1.2);
    const o = (cell.y * c.width + cell.x) * 4;
    img.data[o] = Math.round(80 + 175 * badness);
    img.data[o + 1] = Math.round(200 - 140 * badness);
    img.data[o + 2] = 80;
    img.data[o + 3] = 82; // ~0.32, baked in so the upscale carries it
  }
  g.putImageData(img, 0, 0);
  return cv;
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
  const lie = lieParamsAt(course, ball.x, ball.y);
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
  // the land's own say in the number: uphill plays longer, downhill shorter
  const pl = shotPlaysLike(course, ball, aimTarget);
  verdict.textContent = copy.aimReadout({
    carry: yards(carry), club: clubName(carry),
    leaves: yards(leaves), atFlag: !(leaves > 1.5),
    plays: Math.abs(pl.deltaYards) >= 2 ? pl.playsYards : null,
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

/** A pointer event in canvas-bitmap pixels — the space the camera seam speaks. */
function eventCanvasPx(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (canvas.width / r.width),
    y: (e.clientY - r.top) * (canvas.height / r.height),
  };
}

function eventCoursePoint(e) {
  const p = eventCanvasPx(e);
  return fromScreenPx(p.x, p.y);
}

/** Touch users get a sensible starting target to nudge from. */
function initNeutralAim() {
  if (putting) return setPuttAim({ x: course.hole.x, y: course.hole.y });
  const lie = lieParamsAt(course, ball.x, ball.y);
  const d = toPin(ball);
  const f = Math.min(reach(lie, profile) * 0.7, Math.max(1, d)) / Math.max(d, 0.001);
  setAim({ x: ball.x + (course.hole.x - ball.x) * f, y: ball.y + (course.hole.y - ball.y) * f });
}

// --- touch: ONE finger aims (wave 1, untouched), TWO drive the camera -------
// The second finger landing ends the aim drag and opens a gesture; the gesture
// only ever writes manualCam / peeking, never aimTarget. So a pinch can never
// move the target, and the target is exactly where the finger left it after.
const touches = new Map(); // live touch pointers, in canvas pixels
let gesture = null; // {d0, mid0, cam0, peeked}
let gestureLock = false; // a leftover finger must lift before it may aim again

function gestureStart() {
  const pts = [...touches.values()];
  if (pts.length < 2) return;
  dragStart = null; // the aim drag is over; the target stays put
  tap = null; // a second finger is not half a double-tap
  gestureLock = true;
  gesture = {
    d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
    mid0: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
    cam0: { ...camera },
    peeked: peeking,
  };
  cancelCamAnim();
}

function gestureMove() {
  const pts = [...touches.values()];
  if (!gesture || pts.length < 2 || !course || phase === 'loading') return;
  const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
  const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  const ratio = d / gesture.d0;
  // pinch OUT past the threshold: "show me the whole hole"
  if (!gesture.peeked && ratio < PEEK_PINCH && frameScale() > 1.05) {
    gesture.peeked = true;
    manualCam = null;
    setPeek(true);
    return;
  }
  // pinch IN out of a peek: back to the framing and keep zooming from there.
  // Fingers are on the glass, so this SNAPS — no ease may run under them.
  if (gesture.peeked && ratio > 1 / PEEK_PINCH) {
    peeking = false;
    syncPeekBtn();
    cancelCamAnim();
    camera = activeCamera();
    gesture = { d0: d, mid0: mid, cam0: { ...camera }, peeked: false };
    refresh();
    return;
  }
  if (gesture.peeked) return;
  const view = camView();
  const zoomed = zoomAbout(gesture.cam0, gesture.mid0.x, gesture.mid0.y, ratio, view, zoomBounds());
  const panned = panBy(zoomed, mid.x - gesture.mid0.x, mid.y - gesture.mid0.y, view);
  cancelCamAnim();
  manualCam = clampCenter(panned, camBounds());
  camera = manualCam;
  refresh();
}

function endTouch(id) {
  touches.delete(id);
  if (gesture && touches.size < 2) gesture = null;
  if (touches.size === 0) gestureLock = false;
}

// Double-tap anywhere on the glass recenters — the fastest way back. A tap is
// resolved on RELEASE (short, still, one finger), so a pinch's first finger and
// an aim drag can never be mistaken for half of one.
const TAP_MS = 300; // longer than this is a drag, not a tap
const TAP_SLOP = 14; // canvas px a tap may wander
const DOUBLE_MS = 320;
let tap = null; // {t, x, y, id} the single-finger tap in progress
let lastTap = 0;
let lastTapPt = null;

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
    touches.set(e.pointerId, eventCanvasPx(e));
    if (tap && tap.id === e.pointerId) {
      const p = touches.get(e.pointerId);
      if (Math.hypot(p.x - tap.x, p.y - tap.y) > TAP_SLOP) tap = null;
    }
    if (gesture) {
      e.preventDefault();
      gestureMove();
      return;
    }
  }
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
  endIntro({ instant: true });
  if (e.pointerType !== 'touch') return;
  if (!touchMode) {
    touchMode = true;
    document.body.classList.add('touch');
  }
  touches.set(e.pointerId, eventCanvasPx(e));
  if (touches.size >= 2) {
    e.preventDefault();
    gestureStart();
    return;
  }
  const at = touches.get(e.pointerId);
  tap = { t: performance.now(), x: at.x, y: at.y, id: e.pointerId };
  if (phase === 'reveal') {
    advance();
    return;
  }
  if (phase !== 'aim' || gestureLock) return;
  e.preventDefault();
  if (!aimTarget) initNeutralAim();
  dragStart = { at: eventCoursePoint(e), t0: { ...aimTarget } };
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // synthetic/expired pointers can't be captured; dragging still works
  }
});
function releasePointer(e) {
  if (e && (e.pointerType === 'touch' || touches.has(e.pointerId))) endTouch(e.pointerId);
  dragStart = null;
  // a completed single-finger tap: the second one within DOUBLE_MS recenters
  if (tap && e && tap.id === e.pointerId) {
    const now = performance.now();
    const quick = now - tap.t < TAP_MS;
    const near = lastTapPt && Math.hypot(tap.x - lastTapPt.x, tap.y - lastTapPt.y) < 60;
    if (quick && lastTap && now - lastTap < DOUBLE_MS && near) {
      lastTap = 0;
      lastTapPt = null;
      recenter();
    } else if (quick) {
      lastTap = now;
      lastTapPt = { x: tap.x, y: tap.y };
    }
    tap = null;
  }
  // a framing that came due mid-drag runs now that the finger is off the glass
  if (camPending) {
    const p = camPending;
    camPending = null;
    applyCam(p.mode, p.opts);
  }
}
window.addEventListener('pointerup', releasePointer);
window.addEventListener('pointercancel', releasePointer);

// --- desktop: wheel / trackpad pinch zooms about the cursor ----------------
// passive:false so the page can never scroll out from under the cockpit.
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!course || phase === 'loading') return;
  // a trackpad pinch arrives as ctrl+wheel, an order of magnitude finer
  const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const k = e.ctrlKey ? 0.01 : 0.0022;
  const p = eventCanvasPx(e);
  zoomAt(p.x, p.y, Math.exp(-Math.max(-160, Math.min(160, e.deltaY * lines)) * k));
}, { passive: false });

// --- keyboard: O peeks at the whole hole, R recenters ----------------------
// O is hold-OR-tap: press and hold to glance at the hole and have it snap back
// when you let go; tap it and the overview stays until you tap it again.
const PEEK_TAP_MS = 260;
let peekDownAt = 0;
window.addEventListener('keydown', (e) => {
  endIntro({ instant: true });
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'o') {
    e.preventDefault();
    peekDownAt = performance.now();
    setPeek(!peeking);
  } else if (k === 'r') {
    e.preventDefault();
    recenter();
  } else if (k === 'g') {
    e.preventDefault();
    cycleHeatPage();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key.toLowerCase() !== 'o') return;
  if (peekDownAt && performance.now() - peekDownAt > PEEK_TAP_MS && peeking) setPeek(false);
  peekDownAt = 0;
});
// a lost keyup (tabbing away mid-hold) must not make the next one misfire;
// the overview stays visible and O or Recenter still puts it back
window.addEventListener('blur', () => { peekDownAt = 0; });

peekBtn?.addEventListener('click', () => setPeek(!peeking));
document.getElementById('recenter')?.addEventListener('click', recenter);

/** Break → Slope → Cost → Break. */
function cycleHeatPage() {
  setHeatPage(HEAT_PAGES[(HEAT_PAGES.indexOf(heatPage) + 1) % HEAT_PAGES.length]);
}
heatBtn = document.getElementById('greenpage');
heatBtn?.addEventListener('click', cycleHeatPage);
setHeatPage(heatPage); // paint the button's initial label

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
    costImage = null;
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
    else updateAimReadout(lieParamsAt(course, ball.x, ball.y));
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
  const lie = lieParamsAt(course, from.x, from.y);
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
  if (putting) {
    // the putt rolled off the green — back to a real lie and a real swing
    putting = false;
    puttPos = null;
  }
  if (decisions.filter((d) => !d.putt).length >= 8) return finishHole();
  phase = 'aim';
  aimTarget = null;
  reveal = null;
  // a new lie earns a fresh framing: the corridor to the pin when the shot is
  // an approach, the whole hole when it is not. Never mid-decision, never
  // mid-drag — requestCam owes it to the finger lifting.
  requestCam(lieCamMode());
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
    riskStreak = 0; // today is in the book: nothing on the line until tomorrow
    return streak;
  } catch {
    return 0; // storage blocked: no streak, no drama
  }
}

/** Days of streak that end at UTC midnight if today's daily goes unplayed:
 *  0 when today is already recorded (or there is no streak to lose). */
function streakAtRisk() {
  try {
    const data = JSON.parse(localStorage.getItem('golfcms.caddie.streak.v1')) ?? {};
    const have = new Set(Array.isArray(data.dates) ? data.dates : []);
    const today = new Date().toISOString().slice(0, 10);
    if (have.has(today)) return 0;
    let n = 0;
    for (let t = Date.parse(today) - 86400000; have.has(new Date(t).toISOString().slice(0, 10)); t -= 86400000) n += 1;
    return n;
  } catch {
    return 0;
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
      cat: d.putt ? 'putt' : i === 0 ? 'tee' : 'approach',
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
  // a challenger's card rides along: their points on this hole, the verdict at the end
  if (rival && rival.seed === round.seed) {
    const sub = overlay.querySelector('.sub');
    if (done) sub.textContent += ` · ${copy.challengerResult(round.totalPoints, rival.total)}`;
    else if (rival.holes[round.holeIndex] != null) sub.textContent += copy.challengerHole(rival.holes[round.holeIndex]);
  }
  document.getElementById('ov-chal').hidden = !(done && /^https?:$/.test(location.protocol));
  document.getElementById('ov-next').textContent = done ? copy.newRound : copy.nextHole;
  const coach = document.getElementById('coach');
  if (done) {
    const all = round.holes.flatMap((h) => h.recap ?? []);
    const worst = all.filter((d) => d.sgLost > 0.05).sort((a, b) => b.sgLost - a.sgLost).slice(0, 2);
    // the phase ledger: where the round's strokes went, and the one habit to fix
    const lost = { tee: 0, approach: 0, putt: 0 };
    for (const d of all) {
      if (d.cat && Number.isFinite(d.sgLost) && d.sgLost > 0) lost[d.cat] += d.sgLost;
    }
    const phases = copy.coachPhases(lost);
    const worstCat = Object.entries(lost).sort((a, b) => b[1] - a[1])[0];
    const tip = worstCat && worstCat[1] > 0.25 ? copy.phaseTip(worstCat[0]) : '';
    const notes = worst.length === 0 ? copy.coachClean : copy.coachNotes(worst);
    coach.textContent = [phases, notes, tip].filter(Boolean).join('\n');
    coach.hidden = false;
  } else {
    coach.hidden = true;
  }
  // the daily's closing beat: a ticking tee time for tomorrow's hole, and a
  // Quick 5 for anyone not ready to put the bag down
  const cd = document.getElementById('ov-countdown');
  const quick = document.getElementById('ov-quick');
  clearInterval(countdownTimer);
  if (done && round.daily) {
    const tick = () => {
      const ms = 86400000 - (Date.now() % 86400000); // daily rolls at UTC midnight
      const s = Math.floor(ms / 1000);
      const hms = [s / 3600, (s / 60) % 60, s % 60]
        .map((n) => String(Math.floor(n)).padStart(2, '0')).join(':');
      cd.innerHTML = copy.nextDailyIn(`<b>${hms}</b>`);
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
    cd.hidden = false;
    quick.textContent = copy.quickFive;
    quick.hidden = false;
  } else {
    cd.hidden = true;
    quick.hidden = true;
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
  // the link that lets the reader play the same holes — only when the game is
  // actually served from a URL worth pasting (not file:, not about:)
  let url = null;
  if (/^https?:$/.test(location.protocol)) {
    url = location.origin + location.pathname +
      (round.daily ? '' : (round.hash ?? `#/round/${round.seed}`));
  }
  let text = copy.share({
    label, total: round.totalPoints, max: round.count * 1000,
    squares: copy.shareSquares(round.holes),
  });
  if (round.streak > 1) text += ` 🔥${round.streak}`;
  if (url) text += `\n${url}`;
  return text;
}

/** Copy with a visible receipt: async clipboard first, the textarea trick as
 *  fallback (plain-http and older WebViews), and a toast either way. */
let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
    return;
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    toast(ok ? okMsg : copy.copyFailedToast);
  } catch {
    toast(copy.copyFailedToast);
  }
}
const copyResult = () => copyText(shareText(), copy.copiedToast);

/** The challenge link: the same holes plus `?vs=` — the sharer's per-hole
 *  points. Whoever opens it plays against that card, no backend anywhere. */
function challengeUrl() {
  const hash = round.count === 18 && round.hash ? round.hash : `#/round/${round.seed}`;
  return `${location.origin}${location.pathname}${hash}?vs=${round.holes.map((h) => h.points).join('.')}`;
}

document.getElementById('ov-next').addEventListener('click', () => {
  clearInterval(countdownTimer);
  if (round.holeIndex + 1 >= round.count) {
    startRound((Math.random() * 0xffffffff) >>> 0, false);
  } else {
    round.holeIndex += 1;
    loadHole();
  }
});
document.getElementById('ov-share').addEventListener('click', copyResult);
document.getElementById('share').addEventListener('click', copyResult);
document.getElementById('ov-chal').addEventListener('click', () => copyText(challengeUrl(), copy.challengeToast));
document.getElementById('ov-quick').addEventListener('click', () => {
  clearInterval(countdownTimer);
  startRound((Math.random() * 0xffffffff) >>> 0, false);
});
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
    costImage = null;
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
      // the player's own camera layer: peeking at the whole hole, or zoomed
      peeking, manualZoom: manualCam ? { ...manualCam } : null,
      frameScale: +frameScale().toFixed(4), zoomBounds: zoomBounds(),
      approachRect: approachRect ? { ...approachRect } : null,
      // the green complex: whether it exists, what it cost, how often it drew
      greenArt: greenArt
        ? { w: greenArt.geo.w, h: greenArt.geo.h, sub: greenArt.geo.sub,
            sloped: greenArt.sloped, peakPct: greenArt.peakPct,
            layers: greenArt.layers.map((L) => L.kind), ms: greenArt.ms,
            px: greenArt.layers[0]?.canvas.width ?? 0, ...greenArtStats }
        : null,
      heatPage, greenArtLive: onGreenArt(), frameMs: +lastFrameMs.toFixed(2) };
  },
  aimAt(x, y) { aimTarget = { x, y }; commitDecision(); },
  advance,
  // camera controls, the same entry points the buttons and keys use
  peek(on) { setPeek(Boolean(on)); },
  recenter,
  zoomAt,
  /** Test hook: repaint both art layers for the course as it stands now. Lets a
   *  harness stamp a different biome's cells onto the live hole and see the art
   *  that terrain earns. Never called by the game itself. */
  rebuildArt() {
    art = renderCourseArt(course);
    greenArt = null;
    greenRect = findGreenRect();
    V = strokesField(course, 6, profile);
    costImage = null;
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
document.getElementById('ov-chal').textContent = copy.challenge;

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

// A challenge link freezes the sharer's card as the target: `?vs=` after a
// round route carries their per-hole points. Parse it before routing rewrites
// the hash; the card only counts while the seeds match.
{
  const q = location.hash.indexOf('?');
  const seedM = location.hash.match(/^#\/(?:round|champ)\/(\d+)/);
  if (q !== -1 && seedM) {
    const vs = new URLSearchParams(location.hash.slice(q + 1)).get('vs');
    if (vs && /^\d+(\.\d+)*$/.test(vs)) {
      const holes = vs.split('.').map(Number).filter((n) => n >= 0 && n <= 1000);
      if (holes.length) {
        rival = { seed: Number(seedM[1]) >>> 0, holes, total: holes.reduce((a, b) => a + b, 0) };
        toast(copy.challengerStart(rival.total), 5200);
      }
    }
  }
}

// The nudge that guards the ritual: if a daily streak dies at UTC midnight,
// say so once out loud (and keep a chip on the ticker until today's is in).
riskStreak = streakAtRisk();
if (riskStreak > 0 && !rival) toast(copy.streakNudge(riskStreak), 5200);

const m = location.hash.match(/^#\/round\/(\d+)/);
const mc = location.hash.match(/^#\/champ\/(\d+)/);
// `#/gauntlet` is the weekly major's original, documented name — honor both
if (location.hash.startsWith('#/major') || location.hash.startsWith('#/gauntlet')) startMajor();
else if (mc) startChampionship(Number(mc[1]));
else if (m) startRound(Number(m[1]) >>> 0, false);
else startRound(dailySeed(), true);
