// The satellite ground: real imagery under a georeferenced hole, fetched as
// raw XYZ raster tiles — no SDK, no build step, one composed canvas handed
// to the same ground seam every other renderer uses.
//
// Providers, in order of preference:
//   mapbox — global, commercial, the player's own pk. token (they pay, they
//            restrict it to their domain; it never ships in this repo).
//   usgs   — public-domain US NAIP imagery, no key, endpoint best-effort.
//   custom — any {z}/{x}/{y} template via localStorage, for proxies and
//            self-hosters.
// Every failure path resolves to null: painted tiles are the floor, never
// an error. Attribution rides back with the canvas — display it.

import { coveragePlan, tileUrl, TILE_PX } from '../engine/webmerc.js';

const PROVIDERS = {
  mapbox: {
    template: 'https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token={token}',
    maxZoom: 19,
    scale: 2, // @2x tiles arrive 512px for a 256px footprint
    attribution: '© Mapbox © Maxar',
    needsToken: true,
  },
  usgs: {
    template: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
    maxZoom: 16,
    scale: 1,
    attribution: 'USGS NAIP (public domain)',
    needsToken: false,
  },
};

function config() {
  let token = '';
  let custom = '';
  try {
    token = localStorage.getItem('golfcms.imagery.token') ?? '';
    custom = localStorage.getItem('golfcms.imagery.url') ?? '';
  } catch { /* storage blocked */ }
  return { token: token.trim(), custom: custom.trim() };
}

/** The provider this machine can use right now, or null. */
export function activeProvider() {
  const { token, custom } = config();
  if (custom) {
    return { template: custom, maxZoom: 19, scale: 1, attribution: 'custom imagery', needsToken: false };
  }
  if (token) return PROVIDERS.mapbox;
  return PROVIDERS.usgs; // best-effort: probe decides at fetch time
}

function loadTile(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // CORS-clean, so the canvas stays readable
    const drop = setTimeout(() => resolve(null), 12000);
    img.onload = () => { clearTimeout(drop); resolve(img); };
    img.onerror = () => { clearTimeout(drop); resolve(null); };
    img.src = url;
  });
}

/**
 * Fetch and compose the satellite ground for a georeferenced board.
 * Resolves {canvas, attribution} at world resolution (width×24 by
 * height×24 px), or null if imagery can't be had. Never throws.
 */
export async function fetchSatelliteGround(geo, { width, height }, boardTilePx = 24) {
  try {
    const provider = activeProvider();
    const { token } = config();
    if (provider.needsToken && !token) return null;
    const plan = coveragePlan(geo, { width, height }, { maxZoom: provider.maxZoom, boardTilePx });
    if (plan.count > 140) return null; // a hole, not a county
    // probe one center tile first: a dead endpoint fails in one request
    const cx = Math.floor(plan.centerPx.x / TILE_PX);
    const cy = Math.floor(plan.centerPx.y / TILE_PX);
    const probe = await loadTile(tileUrl(provider.template, plan.zoom, cx, cy, token));
    if (!probe) return null;

    // mercator scratch canvas covering the tile range
    const { x0, x1, y0, y1 } = plan.tiles;
    const k = provider.scale;
    const merc = document.createElement('canvas');
    merc.width = (x1 - x0 + 1) * TILE_PX * k;
    merc.height = (y1 - y0 + 1) * TILE_PX * k;
    const mctx = merc.getContext('2d');
    const jobs = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const p = (tx === cx && ty === cy)
          ? Promise.resolve(probe)
          : loadTile(tileUrl(provider.template, plan.zoom, tx, ty, token));
        jobs.push(p.then((img) => {
          if (img) mctx.drawImage(img, (tx - x0) * TILE_PX * k, (ty - y0) * TILE_PX * k, TILE_PX * k, TILE_PX * k);
        }));
      }
    }
    await Promise.all(jobs);

    // rotate/scale the mercator scratch into board space. Board axes relate
    // to (east, south) by R(θ) — georef.js's tileLatLon is the contract —
    // so the ground rotates by −θ under the board.
    const out = document.createElement('canvas');
    out.width = width * boardTilePx;
    out.height = height * boardTilePx;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#22301f';
    ctx.fillRect(0, 0, out.width, out.height);
    const mercPxPerM = k / plan.mPerPx;
    const boardPxPerM = boardTilePx / geo.tileM;
    ctx.save();
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((-geo.rotDeg * Math.PI) / 180);
    ctx.scale(boardPxPerM / mercPxPerM, boardPxPerM / mercPxPerM);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(merc, -(plan.centerPx.x - x0 * TILE_PX) * k, -(plan.centerPx.y - y0 * TILE_PX) * k);
    ctx.restore();
    return { canvas: out, attribution: provider.attribution };
  } catch {
    return null; // painted tiles are the floor, never an error
  }
}
