// Aerial terrain detection: turn a satellite photo's pixels into the tile
// vocabulary the engine scores. Pure functions over RGB samples — the UI owns
// the canvas and hands in per-tile sample arrays, so every threshold in here
// is testable in node against synthetic imagery.
//
// The design premise mirrors the editor's: THE TILES ARE THE TRUTH. Detection
// is a first draft of the trace, never an authority — the player corrects it,
// the solver certifies it, and only then does a hole exist. That's why the
// classifier prefers being decisively wrong (easy to see, one click to fix)
// over hedging: every tile gets a real terrain, no "unknown".

import { FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN } from './terrain.js';

/** RGB [0..255] → {h: 0..360, s: 0..1, v: 0..1}. */
export function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max / 255 };
}

/** One pixel's coarse vote. Golf ground from above is a small vocabulary:
 *  blue reads as water, tan as sand, green as vegetation, the rest as scrub. */
function pixelVote(r, g, b) {
  const { h, s, v } = rgbToHsv(r, g, b);
  if (v < 0.08) return 'veg'; // shadow: almost always canopy from above
  if (s > 0.12 && h >= 175 && h <= 265 && b >= g) return 'water';
  if (s >= 0.12 && s <= 0.72 && v > 0.45 && h >= 25 && h < 60 && r > b) return 'sand';
  if (h >= 60 && h < 175 && g >= b) return 'veg';
  if (v > 0.75 && s < 0.14) return 'sand'; // washed-out bright: cart path / bare sand
  return 'scrub';
}

/**
 * Classify one tile from its pixel samples. Vegetation splits on brightness
 * and texture: greens are the brightest, most uniform surface on a course;
 * canopy is dark or high-variance; fairway sits between; rough is the dull
 * remainder. `nearPin` widens the green window — putting surfaces only exist
 * around a cup, and knowing that beats any threshold.
 *
 * @param {Array<[number, number, number]>} samples RGB triples
 * @param {{nearPin?: boolean}} [opts]
 * @returns {number} a terrain constant
 */
export function classifyAerialTile(samples, opts = {}) {
  if (!samples || samples.length === 0) return ROUGH;
  const votes = { water: 0, sand: 0, veg: 0, scrub: 0 };
  let sumLuma = 0;
  let sumLuma2 = 0;
  let sumV = 0;
  let sumS = 0;
  let sumH = 0;
  for (const [r, g, b] of samples) {
    votes[pixelVote(r, g, b)]++;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    sumLuma += luma;
    sumLuma2 += luma * luma;
    const { h, s, v } = rgbToHsv(r, g, b);
    sumV += v;
    sumS += s;
    sumH += h;
  }
  const n = samples.length;
  const lumaStd = Math.sqrt(Math.max(0, sumLuma2 / n - (sumLuma / n) ** 2));
  const meanV = sumV / n;
  const meanS = sumS / n;
  const meanH = sumH / n; // vegetation lives in 60–175°, so linear mean is safe

  // hazards claim the tile well below majority: a pond edge or bunker lip
  // mixed with grass still plays as the hazard the moment the ball finds it
  if (votes.water / n > 0.35) return WATER;
  if (votes.sand / n > 0.45) return SAND;
  if (votes.veg / n >= 0.5) {
    if (meanV < 0.34 || lumaStd > 26) return TREES; // dark, or rustling texture
    // a putting surface is the flattest texture on the course — mowed glass.
    // The texture gate never relaxes (fairway would flood through); near the
    // cup only the brightness/saturation bar comes down.
    if (lumaStd < 3.5 && (opts.nearPin
      ? meanV > 0.5 && meanS > 0.3
      : meanV > 0.62 && meanS > 0.45)) return GREEN;
    // fairway is TRUE green (hue past ~88°) and saturated; rough is the
    // olive, dull remainder — the hue split is what stripes can't hide
    if (meanH >= 88 && meanS >= 0.4 && meanV >= 0.42) return FAIRWAY;
    return ROUGH;
  }
  return ROUGH;
}

/** 3×3 modal smoothing: one pass, ties keep the original cell. Kills the
 *  salt-and-pepper single tiles a per-tile classifier inevitably sprinkles. */
export function smoothCells(cells, width, height) {
  const out = new Array(cells.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const counts = new Map();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const t = cells[ny * width + nx];
          counts.set(t, (counts.get(t) ?? 0) + 1);
        }
      }
      const self = cells[y * width + x];
      const selfN = counts.get(self) ?? 0;
      let best = self;
      let bestN = selfN;
      for (const [t, c] of counts) {
        if (c > bestN) { best = t; bestN = c; }
      }
      // flip only on a clear majority: lone speckles die, but the edge of a
      // real feature (a 2-tile pond against 5 rough neighbors) holds its ground
      out[y * width + x] = bestN >= selfN + 2 ? best : self;
    }
  }
  return out;
}

/**
 * Detect a whole board. `tileSamples(x, y)` returns the RGB samples for that
 * tile (the UI reads them off its underlay canvas). Greens only survive near
 * the cup — a "green" reading out in the country is just well-watered fairway.
 *
 * @returns {number[]} cells, row-major, width × height
 */
export function detectTerrain({ width, height, tileSamples, hole }) {
  const GREEN_RADIUS = 3; // tiles ≈ 8–10 yds each: a real green's footprint
  const cells = new Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nearPin = hole
        ? Math.hypot(x - hole.x, y - hole.y) <= GREEN_RADIUS
        : false;
      let t = classifyAerialTile(tileSamples(x, y), { nearPin });
      if (t === GREEN && !nearPin) t = FAIRWAY;
      cells[y * width + x] = t;
    }
  }
  return smoothCells(cells, width, height);
}
