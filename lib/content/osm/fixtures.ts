/**
 * Test fixtures for the OSM importer.
 *
 * Overpass is rate-limited, occasionally down, and blocked outright by this
 * project's dev-container network policy, so no test may touch it. Instead
 * there are two fixture sources:
 *
 *  1. `overpassFromHole` re-expresses one of our own hand-traced holes as
 *     an Overpass response. Real coordinates, real shapes, real scale — it
 *     proves the importer reconstructs a hole we already know is good.
 *  2. `MESSY_COURSE` is hand-authored to be everything (1) is not: a
 *     multipolygon split into fragments, an island, a reversed centreline,
 *     no pin node, a metric `dist`, and tagging the rules must reject.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IngestInput } from '@/lib/server/ingestHole';
import type { OverpassResponse, OsmElement, OsmWay } from './overpass';

const KIND_TO_TAGS: Record<string, Record<string, string>> = {
  fairway: { golf: 'fairway' },
  green: { golf: 'green' },
  bunker: { golf: 'bunker' },
  water: { golf: 'water_hazard' },
  ob: { golf: 'out_of_bounds' },
  recovery: { natural: 'wood' },
};

export function loadHole(slug: string): IngestInput {
  const file = join(process.cwd(), 'data', 'holes', `${slug}.json`);
  return JSON.parse(readFileSync(file, 'utf8')) as IngestInput;
}

/**
 * A traced hole, re-expressed the way OSM would carry it: every polygon a
 * closed way, the pin a `golf=pin` node, the tee a small square tee box,
 * and a `golf=hole` centreline from tee to green.
 */
export function overpassFromHole(input: IngestInput): OverpassResponse {
  const { hole } = input;
  let id = 1000;
  const elements: OsmElement[] = [];

  for (const p of hole.polygons) {
    elements.push({
      type: 'way',
      id: id++,
      tags: { ...KIND_TO_TAGS[p.kind]!, ...(p.name ? { name: p.name } : {}) },
      geometry: p.ring.map(([lon, lat]) => ({ lon, lat })),
    });
  }

  const tee = hole.tees[0]!;
  // A ~10y square tee box around the authored tee point.
  const d = 0.00005;
  elements.push({
    type: 'way',
    id: id++,
    tags: { golf: 'tee' },
    geometry: [
      { lon: tee.lon - d, lat: tee.lat - d },
      { lon: tee.lon + d, lat: tee.lat - d },
      { lon: tee.lon + d, lat: tee.lat + d },
      { lon: tee.lon - d, lat: tee.lat + d },
      { lon: tee.lon - d, lat: tee.lat - d },
    ],
  });

  elements.push({
    type: 'node',
    id: id++,
    lat: hole.pin.lat,
    lon: hole.pin.lon,
    tags: { golf: 'pin' },
  });

  elements.push({
    type: 'way',
    id: id++,
    tags: {
      golf: 'hole',
      ref: String(hole.holeNumber),
      par: String(hole.par),
      ...(hole.yardage ? { dist: String(hole.yardage) } : {}),
    },
    geometry: [
      { lon: tee.lon, lat: tee.lat },
      { lon: (tee.lon + hole.pin.lon) / 2, lat: (tee.lat + hole.pin.lat) / 2 },
      { lon: hole.pin.lon, lat: hole.pin.lat },
    ],
  });

  return { elements };
}

// --------------------------------------------------------------- messy fixture

/**
 * Two courses whose hole numbers collide, one of them on another continent.
 *
 * Not hypothetical: an Overpass name search for "Carnoustie" returns four
 * ways tagged `golf=hole` with `ref=12` — three Carnoustie courses plus a
 * course in British Columbia — and taking the first produced a confidently
 * labelled hole from the wrong hemisphere.
 */
export function collidingCourses(base: OverpassResponse): OverpassResponse {
  const holeWay = base.elements.find((e) => e.tags?.golf === 'hole') as OsmWay;
  const decoy: OsmWay = {
    type: 'way',
    id: 99001,
    tags: { golf: 'hole', ref: holeWay.tags!.ref!, name: 'Impostor', par: '4' },
    // Same hole number, ~9000km away.
    geometry: (holeWay.geometry ?? []).map((g) => ({ lat: g.lat + 23, lon: g.lon - 42 })),
  };
  return { elements: [decoy, ...base.elements] };
}

/** A course whose outline is mapped but whose holes are not. */
export const OUTLINE_ONLY: OverpassResponse = {
  elements: [
    {
      type: 'way',
      id: 7001,
      tags: { leisure: 'golf_course', name: 'Sketchy Park GC' },
      geometry: [
        { lon: -3, lat: 55 },
        { lon: -2.99, lat: 55 },
        { lon: -2.99, lat: 55.01 },
        { lon: -3, lat: 55 },
      ],
    },
  ],
};

/** Rectangle helper: metres-ish offsets from a corner, in degrees. */
function rect(lon: number, lat: number, w: number, h: number) {
  return [
    { lon, lat },
    { lon: lon + w, lat },
    { lon: lon + w, lat: lat + h },
    { lon, lat: lat + h },
    { lon, lat },
  ];
}

const L = -80.0;
const A = 26.0;
/** ~1 yard in degrees of latitude at this scale. */
const Y = 1 / 121740;

/**
 * A synthetic 400-yard hole playing due north, mapped badly on purpose.
 * The centreline is written green→tee, the lake is a relation whose outer
 * boundary is split into two fragments and which contains an island, there
 * is no pin node, `dist` is in metres, and a cart path and a clubhouse sit
 * inside the corridor wearing tags the rules must reject.
 */
export const MESSY_COURSE: OverpassResponse = {
  elements: [
    // Green, 30y square, at 400y north of the tee.
    {
      type: 'way',
      id: 1,
      tags: { golf: 'green' },
      geometry: rect(L - 15 * Y, A + 385 * Y, 30 * Y, 30 * Y),
    },
    // Fairway, 60y wide, from 40y to 360y.
    {
      type: 'way',
      id: 2,
      tags: { golf: 'fairway' },
      geometry: rect(L - 30 * Y, A + 40 * Y, 60 * Y, 320 * Y),
    },
    // Greenside bunker.
    {
      type: 'way',
      id: 3,
      tags: { golf: 'bunker', name: 'Front left' },
      geometry: rect(L - 28 * Y, A + 372 * Y, 14 * Y, 12 * Y),
    },
    // A lake as a multipolygon: outer split into two open fragments that
    // only join end to end, plus an inner ring (an island).
    {
      type: 'relation',
      id: 4,
      tags: { type: 'multipolygon', natural: 'water', name: 'The lake' },
      members: [
        {
          type: 'way',
          ref: 41,
          role: 'outer',
          geometry: [
            { lon: L + 40 * Y, lat: A + 200 * Y },
            { lon: L + 90 * Y, lat: A + 200 * Y },
            { lon: L + 90 * Y, lat: A + 260 * Y },
          ],
        },
        {
          type: 'way',
          ref: 42,
          role: 'outer',
          geometry: [
            { lon: L + 90 * Y, lat: A + 260 * Y },
            { lon: L + 40 * Y, lat: A + 260 * Y },
            { lon: L + 40 * Y, lat: A + 200 * Y },
          ],
        },
        {
          type: 'way',
          ref: 43,
          role: 'inner',
          geometry: rect(L + 58 * Y, A + 220 * Y, 14 * Y, 14 * Y),
        },
      ],
    },
    // Rejected by the tag rules: a cart path, a clubhouse, and a pond that
    // is really a swimming pool.
    {
      type: 'way',
      id: 5,
      tags: { golf: 'cartpath' },
      geometry: rect(L + 35 * Y, A + 100 * Y, 3 * Y, 200 * Y),
    },
    {
      type: 'way',
      id: 6,
      tags: { building: 'yes', natural: 'water' },
      geometry: rect(L - 60 * Y, A + 120 * Y, 25 * Y, 25 * Y),
    },
    {
      type: 'way',
      id: 7,
      tags: { leisure: 'swimming_pool', natural: 'water' },
      geometry: rect(L - 55 * Y, A + 160 * Y, 10 * Y, 6 * Y),
    },
    // Far enough away to belong to another hole.
    {
      type: 'way',
      id: 8,
      tags: { golf: 'bunker' },
      geometry: rect(L + 300 * Y, A + 200 * Y, 15 * Y, 15 * Y),
    },
    // Tee box at the origin.
    {
      type: 'way',
      id: 9,
      tags: { golf: 'tee' },
      geometry: rect(L - 5 * Y, A - 5 * Y, 10 * Y, 10 * Y),
    },
    // Centreline mapped backwards: green first, tee last.
    {
      type: 'way',
      id: 10,
      tags: { golf: 'hole', ref: '7', dist: '366' },
      geometry: [
        { lon: L, lat: A + 400 * Y },
        { lon: L, lat: A + 200 * Y },
        { lon: L, lat: A },
      ],
    },
  ],
};
