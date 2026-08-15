// The georeference codec: coordinates are the asset, so the codec gets the
// same treatment patch.js gets — round-trips pinned, malformed input hostile,
// and the two-anchor solve verified against its own forward transform.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeGeoRef, decodeGeoRef, tileLatLon, geoFromAnchors, formatGeo, parseLatLon,
} from '../src/engine/georef.js';

const RIVIERA = { lat: 34.0495, lon: -118.5013, rotDeg: 251.3, tileM: 8.2, vintage: 2022 };

test('encode → decode round-trips within codec resolution', () => {
  const s = encodeGeoRef(RIVIERA);
  assert.match(s, /^a[0-9a-f]{22}$/);
  const d = decodeGeoRef(s);
  assert.ok(Math.abs(d.lat - RIVIERA.lat) < 1e-5 / 2 + 1e-9, 'lat within a half-step');
  assert.ok(Math.abs(d.lon - RIVIERA.lon) < 1e-5 / 2 + 1e-9, 'lon within a half-step');
  assert.ok(Math.abs(d.rotDeg - RIVIERA.rotDeg) < 0.05 + 1e-9, 'rotation within a tenth-degree');
  assert.ok(Math.abs(d.tileM - RIVIERA.tileM) < 0.05 + 1e-9, 'scale within a decimeter');
  assert.equal(d.vintage, 2022);
});

test('malformed and out-of-range input is rejected, never guessed at', () => {
  assert.throws(() => decodeGeoRef('zzz'), /malformed/);
  assert.throws(() => decodeGeoRef('a' + 'f'.repeat(21)), /malformed/); // wrong width
  assert.throws(() => decodeGeoRef('b' + '0'.repeat(22)), /malformed/); // wrong version
  assert.throws(() => encodeGeoRef({ lat: 91, lon: 0, tileM: 8 }), /out of range/);
  assert.throws(() => encodeGeoRef({ lat: 0, lon: 0, tileM: 0 }), /out of range/);
  assert.throws(() => encodeGeoRef({ lat: 0, lon: 0, tileM: 500 }), /out of range/);
});

test('tileLatLon: north-up grid moves east along +x and south along +y', () => {
  const geo = { lat: 40, lon: -100, rotDeg: 0, tileM: 10 };
  const board = { width: 40, height: 24 };
  const a = tileLatLon(geo, board, 10, 12);
  const b = tileLatLon(geo, board, 11, 12);
  const c = tileLatLon(geo, board, 10, 13);
  assert.ok(b.lon > a.lon && Math.abs(b.lat - a.lat) < 1e-9, '+x is east');
  assert.ok(c.lat < a.lat && Math.abs(c.lon - a.lon) < 1e-9, '+y is south');
  const center = tileLatLon(geo, board, board.width / 2 - 0.5, board.height / 2 - 0.5);
  assert.ok(Math.abs(center.lat - 40) < 1e-6 && Math.abs(center.lon + 100) < 1e-6,
    'grid center sits on the anchor');
});

test('geoFromAnchors recovers the transform its own tileLatLon produces', () => {
  const truth = { lat: 34.05, lon: -118.5, rotDeg: 37.5, tileM: 8.5, vintage: 2024 };
  const board = { width: 40, height: 24 };
  const tee = { x: 4, y: 18 };
  const cup = { x: 34, y: 6 };
  const solved = geoFromAnchors({
    tee, cup, width: board.width, height: board.height, vintage: 2024,
    teeLL: tileLatLon(truth, board, tee.x, tee.y),
    cupLL: tileLatLon(truth, board, cup.x, cup.y),
  });
  assert.ok(Math.abs(solved.tileM - truth.tileM) < 0.02, `tileM ${solved.tileM}`);
  assert.ok(Math.abs(solved.rotDeg - truth.rotDeg) < 0.2, `rotDeg ${solved.rotDeg}`);
  assert.ok(Math.abs(solved.lat - truth.lat) < 2e-5, `lat ${solved.lat}`);
  assert.ok(Math.abs(solved.lon - truth.lon) < 2e-5, `lon ${solved.lon}`);
  // and the whole thing survives the wire
  const wire = decodeGeoRef(encodeGeoRef(solved));
  assert.ok(Math.abs(wire.rotDeg - truth.rotDeg) < 0.25);
});

test('geoFromAnchors rejects degenerate anchors', () => {
  const board = { width: 40, height: 24 };
  assert.throws(() => geoFromAnchors({
    tee: { x: 5, y: 5 }, cup: { x: 5, y: 5 }, ...board,
    teeLL: { lat: 34, lon: -118 }, cupLL: { lat: 34.01, lon: -118 },
  }), /same tile/);
  assert.throws(() => geoFromAnchors({
    tee: { x: 4, y: 18 }, cup: { x: 34, y: 6 }, ...board,
    teeLL: { lat: 34, lon: -118 }, cupLL: { lat: 34.00001, lon: -118 },
  }), /implausibly close/);
});

test('formatGeo and parseLatLon speak human', () => {
  assert.equal(formatGeo({ lat: 34.0495, lon: -118.5013 }), '34.050°N 118.501°W');
  assert.equal(formatGeo({ lat: -37.8, lon: 144.96 }), '37.800°S 144.960°E');
  assert.deepEqual(parseLatLon(' 34.05, -118.5 '), { lat: 34.05, lon: -118.5 });
  assert.deepEqual(parseLatLon('34.05 -118.5'), { lat: 34.05, lon: -118.5 });
  assert.equal(parseLatLon('ninety, twelve'), null);
  assert.equal(parseLatLon('95, 0'), null);
  assert.equal(parseLatLon(''), null);
});
