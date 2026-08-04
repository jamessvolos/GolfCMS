/**
 * MapLibre style for a puzzle: Esri World Imagery under a drafting-style
 * vector ground plan built from the hole polygons.
 *
 * The synthetic Milestone 2 hole draws its ground plan at full opacity (its
 * polygons ARE the ground); holes annotated over real imagery in Milestone 4
 * will drop the fills and let the toned imagery carry the ground.
 */

import type { StyleSpecification } from 'maplibre-gl';
import { ground } from '@/lib/design/tokens';
import type { HoleData } from '@/lib/engine/types';

export const ESRI_ATTRIBUTION =
  'Imagery © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community';

/**
 * Required by ODbL for any hole whose geometry came out of OpenStreetMap.
 *
 * This has to go on the AttributionControl as customAttribution, NOT on the
 * hole source: MapLibre only surfaces a source's attribution while some
 * visible layer uses that source, and a hole traced over imagery renders no
 * ground-plan fills at all. Attaching it to the source looked right in
 * `map.getStyle()` and displayed nothing.
 */
export const OSM_ATTRIBUTION = 'Hole data © OpenStreetMap contributors (ODbL)';

/** The credits a hole owes, given where its geometry came from. */
export function attributionsFor(hole: Pick<HoleData, 'source'>): string[] {
  return hole.source === 'osm' ? [OSM_ATTRIBUTION] : [];
}

/**
 * Sandboxed dev containers can't reach Esri from the browser; setting
 * NEXT_PUBLIC_TILE_PROXY=1 at build time routes tiles through the
 * same-origin relay at /api/tiles (see app/api/tiles/.../route.ts).
 */
export const TILE_URL =
  process.env.NEXT_PUBLIC_TILE_PROXY === '1'
    ? '/api/tiles/{z}/{y}/{x}'
    : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const PAINT_ORDER = ['ob', 'recovery', 'fairway', 'bunker', 'water', 'green'] as const;

export function buildMapStyle(hole: HoleData, opts: { groundPlan: boolean }): StyleSpecification {
  const polygonFeatures = hole.geojson.features.filter(
    (f) => f.geometry.type === 'Polygon',
  );

  const style: StyleSpecification = {
    version: 8,
    sources: {
      esri: {
        type: 'raster',
        tiles: [TILE_URL],
        tileSize: 256,
        maxzoom: 19,
        attribution: ESRI_ATTRIBUTION,
      },
      hole: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: polygonFeatures } as never,
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': ground.rough } },
      { id: 'imagery', type: 'raster', source: 'esri' },
    ],
  };

  if (opts.groundPlan) {
    for (const kind of PAINT_ORDER) {
      style.layers.push({
        id: `ground-${kind}`,
        type: 'fill',
        source: 'hole',
        filter: ['==', ['get', 'kind'], kind],
        paint: { 'fill-color': ground[kind] },
      });
    }
    style.layers.push({
      id: 'ground-outline',
      type: 'line',
      source: 'hole',
      paint: { 'line-color': ground.outline, 'line-width': 1 },
    });
  }

  return style;
}
