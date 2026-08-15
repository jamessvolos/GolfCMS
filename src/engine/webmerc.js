// Web-Mercator tile math — the arithmetic between a georeference and the
// XYZ tile pyramid every imagery provider speaks. Pure functions, no I/O,
// node-tested; the UI's satellite composer is a thin consumer.

const TILE_PX = 256;
const EARTH = 156543.03392; // meters per pixel at zoom 0, equator

/** Meters per screen pixel at (zoom, latitude). */
export function metersPerPixel(zoom, lat) {
  return (EARTH * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/** The zoom whose ground resolution best matches `targetMPerPx`, clamped to
 *  the provider's range. Prefer the SHARPER side of the target: upscaling
 *  imagery blurs, downscaling merely wastes a few tiles. */
export function pickZoom(targetMPerPx, lat, maxZoom = 19, minZoom = 3) {
  const raw = Math.log2((EARTH * Math.cos((lat * Math.PI) / 180)) / targetMPerPx);
  return Math.max(minZoom, Math.min(maxZoom, Math.ceil(raw - 0.25)));
}

/** Lon/lat → fractional XYZ tile coordinates at `zoom`. */
export function lonLatToTile(lon, lat, zoom) {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const rad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { x, y };
}

/** Lon/lat → absolute Mercator pixel coordinates at `zoom`. */
export function lonLatToPixel(lon, lat, zoom) {
  const t = lonLatToTile(lon, lat, zoom);
  return { x: t.x * TILE_PX, y: t.y * TILE_PX };
}

/**
 * Everything a composer needs to lay imagery under a georeferenced board:
 * the zoom, the tile range covering the board's rotated footprint (plus a
 * margin), and the board-center's absolute Mercator pixel. The board is
 * `width × height` game tiles of `geo.tileM` meters; rotation means the
 * footprint's Mercator bbox is the rotated rectangle's bbox.
 */
export function coveragePlan(geo, { width, height }, { maxZoom = 19, boardTilePx = 24 } = {}) {
  const targetMPerPx = geo.tileM / boardTilePx;
  const zoom = pickZoom(targetMPerPx, geo.lat, maxZoom);
  const mpp = metersPerPixel(zoom, geo.lat);
  const center = lonLatToPixel(geo.lon, geo.lat, zoom);
  // half-extent of the rotated board footprint, in meters
  const hw = (width * geo.tileM) / 2;
  const hh = (height * geo.tileM) / 2;
  const th = (geo.rotDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(th));
  const s = Math.abs(Math.sin(th));
  const extEastM = hw * c + hh * s;
  const extSouthM = hw * s + hh * c;
  const margin = TILE_PX; // one tile of slack against rounding at the edges
  const x0 = Math.floor((center.x - extEastM / mpp - margin) / TILE_PX);
  const x1 = Math.floor((center.x + extEastM / mpp + margin) / TILE_PX);
  const y0 = Math.floor((center.y - extSouthM / mpp - margin) / TILE_PX);
  const y1 = Math.floor((center.y + extSouthM / mpp + margin) / TILE_PX);
  const n = 2 ** zoom;
  return {
    zoom,
    mPerPx: mpp,
    centerPx: center,
    tiles: {
      x0: Math.max(0, x0), x1: Math.min(n - 1, x1),
      y0: Math.max(0, y0), y1: Math.min(n - 1, y1),
    },
    count: (Math.min(n - 1, x1) - Math.max(0, x0) + 1) * (Math.min(n - 1, y1) - Math.max(0, y0) + 1),
  };
}

/** Fill an XYZ URL template: {z}/{x}/{y}, plus optional {token}. */
export function tileUrl(template, z, x, y, token = '') {
  return template
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y))
    .replaceAll('{token}', token);
}

export { TILE_PX };
