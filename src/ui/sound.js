// Synthesized sound effects for GolfCMS — Web Audio only, zero assets.
// Safe to import in Node: every function is a silent no-op when Web Audio
// is unavailable, the context can't start, or the user has muted sound.

const MUTE_KEY = 'golfcms.muted.v1';
const MASTER_GAIN = 0.15;

let ctx = null;
let master = null;
let muted = loadMuted();

function loadMuted() {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(MUTE_KEY) === '1';
    }
  } catch {
    /* storage unavailable (private mode, Node, etc.) */
  }
  return false;
}

function saveMuted(value) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(MUTE_KEY, value ? '1' : '0');
    }
  } catch {
    /* ignore */
  }
}

/**
 * Lazily create the shared AudioContext. Safe to call anywhere: returns
 * null when Web Audio is unavailable (e.g. under Node).
 */
export function initSound() {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(ctx.destination);
  return ctx;
}

export function setMuted(value) {
  muted = Boolean(value);
  saveMuted(muted);
  if (muted) stopHeartbeat();
}

export function isMuted() {
  return muted;
}

/** Play a named effect. Silent no-op when muted or Web Audio is missing. */
export function play(name, opts = {}) {
  if (muted) return;
  const c = initSound();
  if (!c) return;
  if (c.state === 'suspended') {
    // Best effort — user-gesture policies may still block; that's fine.
    try { c.resume(); } catch { /* ignore */ }
  }
  const fx = EFFECTS[name];
  if (!fx) return;
  try {
    fx(c, c.currentTime, opts);
  } catch {
    /* never let audio glitches break the game */
  }
}

// ---------------------------------------------------------------------------
// Risk heartbeat — a continuous low double-thump (lub-dub) whose rate and
// loudness track a danger level in [0, 1]. Silent no-op everywhere Web Audio
// is unavailable (Node, muted, blocked autoplay): the level is still tracked
// so the UI/tests can observe it via window.__hb.
// ---------------------------------------------------------------------------

const HB_MAX_GAIN = 0.12; // gain at danger level 1
const HB_MIN_BPM = 50;
const HB_MAX_BPM = 110;
const HB_LOOKAHEAD = 0.3; // seconds of audio scheduled ahead
const HB_TICK_MS = 90; // scheduler wake-up interval

let hb = null; // {gain, timer, nextBeat, level} while running

function hbMirror(level) {
  // Test/observability hook: the current heartbeat level, always up to date
  // even when audio itself can't run.
  try {
    if (typeof window !== 'undefined') window.__hb = level;
  } catch { /* ignore */ }
}

// One thump: a short 55Hz sine with a fast attack, pitch sagging as it decays.
function hbThump(c, t0, strength) {
  const osc = c.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(55, t0);
  osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.12);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(strength, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
  osc.connect(g);
  g.connect(hb.gain);
  osc.start(t0);
  osc.stop(t0 + 0.17);
}

// Lookahead scheduler: keeps a rolling window of lub-dub pairs queued so the
// rhythm stays steady while the rate follows the live danger level.
function hbSchedule() {
  if (!hb || !ctx) return;
  try {
    if (hb.nextBeat < ctx.currentTime) hb.nextBeat = ctx.currentTime + 0.02;
    while (hb.nextBeat < ctx.currentTime + HB_LOOKAHEAD) {
      const bpm = HB_MIN_BPM + (HB_MAX_BPM - HB_MIN_BPM) * hb.level;
      const period = 60 / bpm;
      const t0 = hb.nextBeat;
      hbThump(ctx, t0, 1); // lub
      hbThump(ctx, t0 + Math.min(0.24, period * 0.3), 0.65); // dub
      hb.nextBeat = t0 + period;
    }
  } catch {
    /* never let audio glitches break the game */
  }
}

/** Start the heartbeat engine (silent until setHeartbeat raises the level). */
export function startHeartbeat() {
  if (muted || hb) return;
  const c = initSound();
  if (!c) return;
  if (c.state === 'suspended') {
    try { c.resume(); } catch { /* autoplay policy — fine */ }
  }
  try {
    const gain = c.createGain();
    gain.gain.value = 0;
    gain.connect(c.destination);
    hb = { gain, level: 0, nextBeat: c.currentTime + 0.05, timer: setInterval(hbSchedule, HB_TICK_MS) };
  } catch {
    hb = null;
  }
}

/** Set the danger level 0..1: scales rate (~50→110 bpm) and gain (0→~0.12). */
export function setHeartbeat(level) {
  const lvl = Math.min(1, Math.max(0, Number(level) || 0));
  hbMirror(lvl);
  if (!hb && lvl > 0) startHeartbeat();
  if (!hb) return; // audio unavailable or muted: tracked, but silent
  hb.level = lvl;
  try {
    hb.gain.gain.setTargetAtTime(HB_MAX_GAIN * lvl, ctx.currentTime, 0.08);
  } catch {
    /* ignore */
  }
}

/** Stop the heartbeat entirely (commit, reveal, hole load, mute). */
export function stopHeartbeat() {
  hbMirror(0);
  if (!hb) return;
  clearInterval(hb.timer);
  const g = hb.gain;
  hb = null;
  try {
    g.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    setTimeout(() => {
      try { g.disconnect(); } catch { /* ignore */ }
    }, 300);
  } catch {
    try { g.disconnect(); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

// Shared white-noise buffer, created once per context.
let noiseBuffer = null;
function getNoiseBuffer(c) {
  if (noiseBuffer && noiseBuffer.sampleRate === c.sampleRate) return noiseBuffer;
  const len = Math.floor(c.sampleRate * 0.5);
  noiseBuffer = c.createBuffer(1, len, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

// A gain node with a quick attack and exponential-ish decay envelope.
function envelope(c, t0, peak, duration, attack = 0.005) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  g.connect(master);
  return g;
}

// Oscillator tone with envelope; freqEnd (optional) glides the pitch.
function tone(c, t0, { type = 'sine', freq, freqEnd, peak = 1, duration = 0.2, attack = 0.005 }) {
  const osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
  }
  const g = envelope(c, t0, peak, duration, attack);
  osc.connect(g);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

// Filtered noise burst with envelope.
function noise(c, t0, { filterType = 'bandpass', freq = 1000, freqEnd, Q = 1, peak = 1, duration = 0.15, attack = 0.003 }) {
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freq, t0);
  if (freqEnd != null) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
  }
  filter.Q.value = Q;
  const g = envelope(c, t0, peak, duration, attack);
  src.connect(filter);
  filter.connect(g);
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}

// Marimba-ish note: fundamental sine plus fast-decaying upper partials.
function marimba(c, t0, freq, peak = 0.8, duration = 0.3) {
  tone(c, t0, { freq, peak, duration, attack: 0.004 });
  tone(c, t0, { freq: freq * 4, peak: peak * 0.25, duration: duration * 0.4, attack: 0.002 });
  tone(c, t0, { freq: freq * 9.2, peak: peak * 0.1, duration: duration * 0.25, attack: 0.002 });
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

const EFFECTS = {
  // Club impact "thwock": filtered noise burst + low sine pitch-drop.
  // Brighter and louder with power (1-3).
  swing(c, t0, opts) {
    const power = Math.min(3, Math.max(1, Number(opts.power) || 1));
    const k = (power - 1) / 2; // 0..1
    noise(c, t0, {
      filterType: 'bandpass',
      freq: 900 + 1400 * k,
      freqEnd: 300 + 300 * k,
      Q: 0.8,
      peak: 0.5 + 0.35 * k,
      duration: 0.09 + 0.03 * k,
    });
    tone(c, t0, {
      freq: 180 + 60 * k,
      freqEnd: 60,
      peak: 0.7 + 0.25 * k,
      duration: 0.12,
      attack: 0.003,
    });
  },

  // Water: band-passed noise swoosh descending.
  splash(c, t0) {
    noise(c, t0, {
      filterType: 'bandpass',
      freq: 2200,
      freqEnd: 350,
      Q: 1.5,
      peak: 0.6,
      duration: 0.35,
      attack: 0.02,
    });
    noise(c, t0 + 0.05, {
      filterType: 'bandpass',
      freq: 1200,
      freqEnd: 250,
      Q: 2,
      peak: 0.3,
      duration: 0.3,
      attack: 0.03,
    });
  },

  // Sand: dull low sine + noise, very short.
  thud(c, t0) {
    tone(c, t0, { freq: 110, freqEnd: 55, peak: 0.8, duration: 0.09, attack: 0.003 });
    noise(c, t0, { filterType: 'lowpass', freq: 500, Q: 0.7, peak: 0.35, duration: 0.07 });
  },

  // Gentle tick for a normal landing.
  bounce(c, t0) {
    tone(c, t0, { type: 'triangle', freq: 520, freqEnd: 380, peak: 0.35, duration: 0.06, attack: 0.002 });
    noise(c, t0, { filterType: 'highpass', freq: 2000, peak: 0.12, duration: 0.03 });
  },

  // Icy shimmer: high sine gliss (for ice/slope settles).
  slide(c, t0) {
    tone(c, t0, { freq: 1400, freqEnd: 2600, peak: 0.25, duration: 0.25, attack: 0.02 });
    tone(c, t0 + 0.03, { freq: 2100, freqEnd: 3400, peak: 0.12, duration: 0.22, attack: 0.02 });
    noise(c, t0, { filterType: 'highpass', freq: 5000, peak: 0.08, duration: 0.25, attack: 0.03 });
  },

  // Two-note rising chime, marimba-ish.
  holed(c, t0) {
    marimba(c, t0, 523.25, 0.7, 0.22); // C5
    marimba(c, t0 + 0.12, 783.99, 0.8, 0.28); // G5
  },

  // Short four-note fanfare arpeggio.
  ace(c, t0) {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      marimba(c, t0 + i * 0.08, freq, i === notes.length - 1 ? 0.9 : 0.6, i === notes.length - 1 ? 0.3 : 0.18);
    });
  },
};
