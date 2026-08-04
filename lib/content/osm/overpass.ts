/**
 * Overpass API client — query building, response typing, and the one fetch.
 *
 * Kept free of any assembly logic so the assembler can be unit-tested
 * against committed fixtures with no network at all. That matters here:
 * Overpass is rate-limited, occasionally down, and unreachable from this
 * project's dev container, so the tests must never depend on it.
 */

import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { FEATURE_FILTER } from './tags';

export interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export interface OsmWay {
  type: 'way';
  id: number;
  tags?: Record<string, string>;
  /** Present when the query used `out geom`. */
  geometry?: { lat: number; lon: number }[];
  nodes?: number[];
}

export interface OsmRelationMember {
  type: 'way' | 'node' | 'relation';
  ref: number;
  role: string;
  geometry?: { lat: number; lon: number }[];
}

export interface OsmRelation {
  type: 'relation';
  id: number;
  tags?: Record<string, string>;
  members?: OsmRelationMember[];
}

export type OsmElement = OsmNode | OsmWay | OsmRelation;

export interface OverpassResponse {
  elements: OsmElement[];
}

export const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter';

export function endpoint(): string {
  return process.env.OVERPASS_URL || DEFAULT_ENDPOINT;
}

/**
 * Everything within `radius` metres of a point that the tag rules can use,
 * plus the hole centrelines and pin/tee nodes needed to locate the hole.
 *
 * `out geom` inlines coordinates on ways and relation members, which turns
 * assembly into pure data shaping — no second round trip to resolve node
 * ids, and no partial hole when a node lookup is rate-limited away.
 */
export function queryAround(lat: number, lon: number, radius = 500): string {
  const around = `(around:${radius},${lat},${lon})`;
  const features = FEATURE_FILTER.map(
    (f) => `  way${f}${around};\n  relation${f}${around};`,
  ).join('\n');
  return `[out:json][timeout:60];
(
${features}
  node["golf"="pin"]${around};
  way["golf"="hole"]${around};
);
out geom;`;
}

/**
 * The same payload scoped to a named course, which is what a person
 * actually has: "Royal Birkdale, hole 12". The course area is resolved
 * first, then features are taken from inside it.
 */
export function queryCourse(name: string, radius = 4000): string {
  const escaped = name.replace(/["\\]/g, '\\$&');
  const features = FEATURE_FILTER.map(
    (f) => `  way${f}(area.course);\n  relation${f}(area.course);`,
  ).join('\n');
  return `[out:json][timeout:90];
area["leisure"="golf_course"]["name"~"${escaped}",i]->.course;
(
${features}
  node["golf"="pin"](area.course);
  way["golf"="hole"](area.course);
);
out geom;`;
}

export function isLocal(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return (
      h === 'localhost' ||
      h === '::1' ||
      h.endsWith('.localhost') ||
      /^127\./.test(h) ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h)
    );
  } catch {
    return false;
  }
}

export class OverpassError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'OverpassError';
  }
}

/**
 * Run one Overpass query. Honours HTTPS_PROXY the same way the tile relay
 * does, so it works from a sandboxed container whose egress is proxied —
 * provided the policy allows the host at all.
 */
export async function runQuery(
  query: string,
  opts: { url?: string; signal?: AbortSignal } = {},
): Promise<OverpassResponse> {
  const url = opts.url ?? endpoint();
  // Proxy outbound requests, but never a local endpoint — a self-hosted
  // Overpass or a test stub on localhost is unreachable through an egress
  // proxy, and the resulting failure looks like Overpass being down.
  const dispatcher =
    process.env.HTTPS_PROXY && !isLocal(url) ? new ProxyAgent(process.env.HTTPS_PROXY) : undefined;

  let res;
  try {
    res = await undiciFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // Overpass asks callers to identify themselves; anonymous bulk
        // traffic is what gets IP ranges blocked.
        'user-agent': 'sg-trainer/0.1 (golf course-management trainer)',
      },
      body: new URLSearchParams({ data: query }).toString(),
      dispatcher,
      signal: opts.signal,
    });
  } catch (cause) {
    throw new OverpassError(
      `could not reach Overpass at ${url} — ${(cause as Error).message}. ` +
        'Set OVERPASS_URL to a reachable mirror, or check the network policy.',
    );
  }

  if (res.status === 429 || res.status === 504) {
    throw new OverpassError(
      `Overpass is rate-limiting or overloaded (${res.status}). Wait, or set ` +
        'OVERPASS_URL to a mirror such as https://overpass.kumi.systems/api/interpreter.',
      res.status,
    );
  }
  if (!res.ok) {
    throw new OverpassError(`Overpass returned ${res.status}`, res.status);
  }

  const text = await res.text();
  try {
    return JSON.parse(text) as OverpassResponse;
  } catch {
    // Overpass reports query errors as HTML with a 200.
    const hint = /<p><strong[^>]*>Error<\/strong>:?\s*([^<]+)/i.exec(text);
    throw new OverpassError(
      hint ? `Overpass rejected the query: ${hint[1]!.trim()}` : 'Overpass returned non-JSON',
    );
  }
}
