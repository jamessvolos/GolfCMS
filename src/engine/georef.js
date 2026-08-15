// Georeference codec — the Georeference Guild's contribution to the aerial
// verdict: a hole's place on Earth, packed the way patch.js packs terrain.
// Fixed-width hex, versioned, pure functions, no I/O. THE IMAGE IS NOT THE
// ASSET — THE COORDINATES ARE: a share carries where the hole is and how the
// grid sits on the ground, never a pixel. ~23 characters of provenance.
//
// Format: 'a' + lat(7) + lon(7) + rot(3) + tileSize(3) + vintage(2)
//   lat/lon — grid-center anchor, 1e-5° steps (~1.1 m; a tile is ~7–9 m)
//   rot     — grid bearing in tenth-degrees (0–3599)
//   tileSize— tile edge in decimeters (0.1–409.5 m)
//   vintage — imagery year minus 2000 (0–255), provenance only, never physics

const hex = (n, w) => n.toString(16).padStart(w, '0');

export function encodeGeoRef({ lat, lon, rotDeg = 0, tileM, vintage = 2020 }) {
  const la = Math.round((lat + 90) * 1e5);
  const lo = Math.round((lon + 180) * 1e5);
  const ro = Math.round((((rotDeg % 360) + 360) % 360) * 10) % 3600;
  const tm = Math.round(tileM * 10);
  if (la < 0 || la > 18e6 || lo < 0 || lo > 36e6 || tm <= 0 || tm > 4095) {
    throw new Error('georef out of range');
  }
  const vi = Math.min(255, Math.max(0, Math.round(vintage) - 2000));
  return 'a' + hex(la, 7) + hex(lo, 7) + hex(ro, 3) + hex(tm, 3) + hex(vi, 2);
}

export function decodeGeoRef(str) {
  const m = /^a([0-9a-f]{7})([0-9a-f]{7})([0-9a-f]{3})([0-9a-f]{3})([0-9a-f]{2})$/i.exec(str);
  if (!m) throw new Error('malformed georef');
  const geo = {
    lat: parseInt(m[1], 16) / 1e5 - 90,
    lon: parseInt(m[2], 16) / 1e5 - 180,
    rotDeg: parseInt(m[3], 16) / 10,
    tileM: parseInt(m[4], 16) / 10,
    vintage: 2000 + parseInt(m[5], 16),
  };
  if (geo.lat < -90 || geo.lat > 90 || geo.lon < -180 || geo.lon > 180 ||
      geo.rotDeg >= 360 || geo.tileM <= 0) throw new Error('georef out of range');
  return geo;
}

const M_PER_DEG_LAT = 111320;

/** Lat/lon of a tile center: local tangent-plane offsets from the anchor,
 *  rotated by the grid bearing. Over a 400 m hole the flat-earth error is
 *  centimeters — three orders below tile size. */
export function tileLatLon(geo, { width, height }, x, y) {
  const dx = (x + 0.5 - width / 2) * geo.tileM;
  const dy = (y + 0.5 - height / 2) * geo.tileM;
  const th = (geo.rotDeg * Math.PI) / 180;
  const east = dx * Math.cos(th) - dy * Math.sin(th);
  const south = dx * Math.sin(th) + dy * Math.cos(th);
  return {
    lat: geo.lat - south / M_PER_DEG_LAT,
    lon: geo.lon + east / (M_PER_DEG_LAT * Math.cos((geo.lat * Math.PI) / 180)),
  };
}

/**
 * Mint a georeference from the two facts every trace is anchored to: the tee
 * and the cup, each as a grid position and a real-world lat/lon. Two point
 * pairs fully determine the similarity transform — scale (tileM), rotation
 * (rotDeg), and translation (the grid-center anchor) — so the author never
 * eyeballs a number the codec can derive.
 *
 * @param {{tee:{x,y}, cup:{x,y}, teeLL:{lat,lon}, cupLL:{lat,lon},
 *          width:number, height:number, vintage?:number}} a
 */
export function geoFromAnchors(a) {
  const gx = a.cup.x - a.tee.x;
  const gy = a.cup.y - a.tee.y;
  const gridTiles = Math.hypot(gx, gy);
  if (gridTiles < 1) throw new Error('tee and cup are the same tile');
  const midLat = ((a.teeLL.lat + a.cupLL.lat) / 2) * (Math.PI / 180);
  const east = (a.cupLL.lon - a.teeLL.lon) * M_PER_DEG_LAT * Math.cos(midLat);
  const south = -(a.cupLL.lat - a.teeLL.lat) * M_PER_DEG_LAT;
  const groundM = Math.hypot(east, south);
  if (groundM < 20) throw new Error('anchors are implausibly close on the ground');
  const tileM = groundM / gridTiles;
  // solve [east; south] = R(θ) · [gx; gy]·tileM for the grid bearing θ
  const th = Math.atan2(south * gx - east * gy, east * gx + south * gy);
  const rotDeg = ((th * 180) / Math.PI + 360) % 360;
  // anchor: walk from the tee's known lat/lon to the grid center
  const cdx = (a.width / 2 - (a.tee.x + 0.5)) * tileM;
  const cdy = (a.height / 2 - (a.tee.y + 0.5)) * tileM;
  const cEast = cdx * Math.cos(th) - cdy * Math.sin(th);
  const cSouth = cdx * Math.sin(th) + cdy * Math.cos(th);
  return {
    lat: a.teeLL.lat - cSouth / M_PER_DEG_LAT,
    lon: a.teeLL.lon + cEast / (M_PER_DEG_LAT * Math.cos(midLat)),
    rotDeg, tileM,
    vintage: a.vintage ?? 2020,
  };
}

/** "34.052°N 118.500°W" — the provenance line the HUD shows. */
export function formatGeo(geo) {
  const f = (v, pos, neg) =>
    `${Math.abs(v).toFixed(3)}°${v >= 0 ? pos : neg}`;
  return `${f(geo.lat, 'N', 'S')} ${f(geo.lon, 'E', 'W')}`;
}

/** Parse a "lat, lon" text field. Returns {lat, lon} or null — never throws
 *  on user typing. */
export function parseLatLon(text) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return null;
  return { lat, lon };
}
