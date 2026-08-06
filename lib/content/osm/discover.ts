/**
 * Finding courses, without asking Overpass for them by name.
 *
 * `queryCourse(name)` exists and the importer's own documentation explains
 * why it cannot be the mining path: "Carnoustie hole 12" resolves to four
 * ways, one of them in British Columbia, which is why `findHoleWays` is
 * plural and refuses ambiguity. A miner cannot disambiguate by hand.
 *
 * So discovery is geographic and hole-shaped, which is also what Overpass
 * will actually serve. Measured on this network:
 *
 *   way[leisure=golf_course] over a 0.5°×0.9° bbox   ->  504, every time
 *   way[golf=hole]           over the same bbox      ->  2404 ways in 3.2s
 *   way[golf=hole]           over Great Britain      ->  504
 *
 * Course polygons are too heavy and continental boxes time out, so the unit
 * of discovery is the hole centreline — which is what the assembler needs
 * anyway — and the region is tiled. 92% of those ways carry a `ref` (the
 * hole number) and 70% carry `par`; `dist` is tagged on 0.8%, so yardage is
 * measured from geometry, which `assemble.ts` already does.
 *
 * Courses are then clusters of hole centrelines, not tagged objects. That
 * sounds like a compromise and is closer to the truth: what the app needs is
 * "eighteen holes near each other that are mapped", which is exactly what a
 * cluster is, and it does not care whether anyone drew the property boundary.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runQuery } from './overpass';
import type { OverpassResponse } from './overpass';

/** Where raw Overpass responses are cached so a rerun costs nothing. */
export const CACHE_DIR = 'data/osm-cache';

/**
 * Tile size in degrees. 0.5 × 0.9 is measured to work; anything
 * continental returns 504. Latitude is the tighter axis because hole
 * density is higher in the temperate bands where golf is played.
 */
export const TILE_LAT = 0.5;
export const TILE_LON = 0.9;

/** Cluster cell for grouping hole centrelines into courses, in degrees. */
const CLUSTER_DEG = 0.02;

/** A cluster below this is a driving range, a pitch-and-putt, or noise. */
export const MIN_HOLES_PER_COURSE = 9;

export interface DiscoveredCourse {
  /** Stable id: the rounded centroid, so a re-harvest matches. */
  id: string;
  lat: number;
  lon: number;
  /** Distinct hole numbers seen. */
  holeNumbers: number[];
  /** How many of those carry a par tag — a proxy for mapping quality. */
  parTagged: number;
  /** Best-guess name from any hole way that carries one. */
  name?: string;
}

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

function cacheKey(query: string): string {
  return createHash('sha256').update(query).digest('hex').slice(0, 16);
}

/**
 * Run a query, or read the answer off disk.
 *
 * The cache is not an optimisation. It is what lets the mining path be
 * tested and re-run without touching the network at all, which matters
 * because Overpass rate-limits, because CI must never depend on it, and
 * because a blocked IP would be the app's.
 */
export interface CacheOptions {
  cacheDir?: string;
  offline?: boolean;
  /** Retries on 429/504 before giving up. */
  attempts?: number;
  /** Fixed backoff, for tests. Omit for exponential. */
  backoffMs?: number;
  onBackoff?: (attempt: number, waitMs: number, status: number) => void;
}

export async function cachedQuery(
  query: string,
  opts: CacheOptions = {},
): Promise<OverpassResponse> {
  const dir = opts.cacheDir ?? CACHE_DIR;
  const path = join(dir, `${cacheKey(query)}.json`);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf8')) as OverpassResponse;
  }
  if (opts.offline) {
    throw new Error(
      `no cached Overpass response for this query and offline mode is set (${path}). ` +
        'Run the miner online once to populate data/osm-cache, then commit it.',
    );
  }

  // 429 and 504 are Overpass's normal states, not exceptions: measured on
  // this network, three of five course fetches hit one on the first pass.
  // A miner that gives up on them mines a fifth of what it discovered, and
  // a miner that retries hard gets the app's IP blocked — so back off.
  const attempts = opts.attempts ?? 4;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await runQuery(query);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, JSON.stringify(res));
      return res;
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      if (status !== 429 && status !== 504) throw err;
      if (i === attempts - 1) break;
      const waitMs = opts.backoffMs ?? 4000 * 2 ** i;
      opts.onBackoff?.(i + 1, waitMs, status);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

/**
 * Several ways can share a hole number. The importer refuses that outright,
 * and it is right to: a name-scoped query for "Carnoustie hole 12" once
 * returned four ways, one of them in British Columbia, and picking the
 * first would have produced a hole from the wrong continent.
 *
 * A geographic query is a different situation and needs a different rule.
 * Every candidate here came back from a radius query around one course, so
 * they are all on the same property — the usual causes are a hole digitised
 * in segments, or a second routing over the same ground. Refusing costs
 * real content: measured on one mined course, ambiguity refused 27 of 36
 * holes.
 *
 * So: candidates that are far from the course centre are still refused —
 * that is the failure the guard exists for — and among those that are near
 * it, the longest centreline wins, because a hole mapped in segments has
 * one way that is the hole and several that are fragments of it.
 */
export function pickNearestHoleWay<T extends { geometry?: { lat: number; lon: number }[] }>(
  candidates: T[],
  centre: { lat: number; lon: number },
  maxKm = 3,
): { chosen: T | null; note?: string } {
  if (candidates.length === 0) return { chosen: null };
  if (candidates.length === 1) return { chosen: candidates[0]! };

  const near = candidates.filter((c) => {
    const g = c.geometry?.[0];
    if (!g) return false;
    // Equirectangular is plenty at this scale and avoids a dependency.
    const dLat = (g.lat - centre.lat) * 111;
    const dLon = (g.lon - centre.lon) * 111 * Math.cos((centre.lat * Math.PI) / 180);
    return Math.hypot(dLat, dLon) <= maxKm;
  });
  if (near.length === 0) {
    return { chosen: null, note: `${candidates.length} candidates, none within ${maxKm}km` };
  }

  const length = (c: T) => {
    const g = c.geometry ?? [];
    let total = 0;
    for (let i = 1; i < g.length; i++) {
      const dLat = (g[i]!.lat - g[i - 1]!.lat) * 111;
      const dLon = (g[i]!.lon - g[i - 1]!.lon) * 111 * Math.cos((centre.lat * Math.PI) / 180);
      total += Math.hypot(dLat, dLon);
    }
    return total;
  };
  const sorted = [...near].sort((a, b) => length(b) - length(a));
  return {
    chosen: sorted[0]!,
    ...(candidates.length > 1
      ? { note: `${candidates.length} candidates on this course; took the longest centreline` }
      : {}),
  };
}

export function tileQuery(bbox: Bbox): string {
  return `[out:json][timeout:90];way["golf"="hole"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});out ids center tags;`;
}

/** Split a region into tiles Overpass will actually answer. */
export function tiles(region: Bbox): Bbox[] {
  const out: Bbox[] = [];
  for (let s = region.south; s < region.north; s += TILE_LAT) {
    for (let w = region.west; w < region.east; w += TILE_LON) {
      out.push({
        south: s,
        west: w,
        north: Math.min(s + TILE_LAT, region.north),
        east: Math.min(w + TILE_LON, region.east),
      });
    }
  }
  return out;
}

interface HoleWay {
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Group hole centrelines into courses. Pure, so it is tested off fixtures. */
export function clusterCourses(elements: unknown[]): DiscoveredCourse[] {
  const cells = new Map<
    string,
    { lat: number; lon: number; n: number; numbers: Set<number>; par: number; name?: string }
  >();

  for (const raw of elements) {
    const e = raw as HoleWay;
    if (!e.center || !e.tags?.ref) continue;
    const ref = Number(e.tags.ref.trim());
    if (!Number.isInteger(ref) || ref < 1 || ref > 18) continue;
    const key = `${Math.round(e.center.lat / CLUSTER_DEG)},${Math.round(e.center.lon / CLUSTER_DEG)}`;
    const cell = cells.get(key) ?? {
      lat: 0,
      lon: 0,
      n: 0,
      numbers: new Set<number>(),
      par: 0,
    };
    // Running mean, so the id is the centre of the holes rather than of the
    // cell it happened to fall in.
    cell.lat += e.center.lat;
    cell.lon += e.center.lon;
    cell.n += 1;
    cell.numbers.add(ref);
    if (e.tags.par) cell.par += 1;
    if (!cell.name && e.tags.name) cell.name = e.tags.name;
    cells.set(key, cell);
  }

  const out: DiscoveredCourse[] = [];
  for (const c of cells.values()) {
    if (c.numbers.size < MIN_HOLES_PER_COURSE) continue;
    const lat = c.lat / c.n;
    const lon = c.lon / c.n;
    out.push({
      id: `${lat.toFixed(4)},${lon.toFixed(4)}`,
      lat,
      lon,
      holeNumbers: [...c.numbers].sort((a, b) => a - b),
      parTagged: c.par,
      ...(c.name ? { name: c.name } : {}),
    });
  }
  // Deterministic order: the miner's output must not depend on Map iteration.
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function discoverCourses(
  region: Bbox,
  opts: CacheOptions & { onTile?: (i: number, n: number, found: number) => void } = {},
): Promise<DiscoveredCourse[]> {
  const boxes = tiles(region);
  const all: unknown[] = [];
  for (const [i, box] of boxes.entries()) {
    const res = await cachedQuery(tileQuery(box), opts);
    all.push(...res.elements);
    opts.onTile?.(i + 1, boxes.length, res.elements.length);
  }
  return clusterCourses(all);
}
