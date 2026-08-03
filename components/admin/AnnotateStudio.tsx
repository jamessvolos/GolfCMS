'use client';

/**
 * The annotation studio: trace hole features over satellite imagery with
 * terra-draw, place pin/tees/ball positions, define 2–4 puzzles, and save
 * through the same ingest pipeline the seed uses. This is how all content
 * gets made (spec, Milestone 4).
 *
 * URL params: ?lat=&lon=&z= opens the camera somewhere; ?id= loads a hole.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MLMap, Marker as MLMarker } from 'maplibre-gl';
import type { TerraDraw } from 'terra-draw';
import { ground } from '@/lib/design/tokens';
import { TILE_URL, ESRI_ATTRIBUTION } from '@/lib/map/groundStyle';
import { createProjection, dist } from '@/lib/engine/projection';
import type { FeatureKind, LonLat } from '@/lib/engine/types';

const KINDS: FeatureKind[] = ['fairway', 'green', 'bunker', 'water', 'ob', 'recovery'];
const KIND_COLOR: Record<FeatureKind, string> = {
  fairway: '#4C8B54',
  green: '#63B06C',
  bunker: '#D8C07C',
  water: '#4C7E96',
  ob: '#8A4A3D',
  recovery: '#3E5C3A',
};

/** Fly-to shortlist for the Milestone 4 content wave (approximate). */
const PRESETS: { label: string; lat: number; lon: number }[] = [
  { label: 'TPC Sawgrass 17 (island)', lat: 30.19765, lon: -81.39445 },
  { label: 'TPC Sawgrass 18', lat: 30.19929, lon: -81.39435 },
  { label: 'Pebble Beach 18', lat: 36.56705, lon: -121.94745 },
  { label: 'Pebble Beach 8', lat: 36.5658, lon: -121.9297 },
  { label: 'Riviera 10', lat: 34.04935, lon: -118.50095 },
  { label: 'Bay Hill 18', lat: 28.44515, lon: -81.51065 },
  { label: 'TPC Scottsdale 17', lat: 33.64275, lon: -111.9145 },
  { label: 'Harbour Town 18', lat: 32.14105, lon: -80.8065 },
  { label: 'Doral Blue Monster 18', lat: 25.8125, lon: -80.3395 },
  { label: 'Kapalua Plantation 18', lat: 21.0035, lon: -156.65155 },
];

type Placement = { kind: 'pin' } | { kind: 'tee' } | { kind: 'ball'; index: number } | null;

/**
 * terra-draw rejects coordinates beyond its 9-decimal precision contract.
 * Round on the way in so stored geometry always survives a load — an
 * unrounded ring is silently dropped and the next save deletes it.
 */
const COORD_DP = 9;
const roundCoord = (v: number) => Number(v.toFixed(COORD_DP));
const roundRing = (ring: [number, number][]): [number, number][] =>
  ring.map(([lon, lat]) => [roundCoord(lon), roundCoord(lat)]);

interface PuzzleDraft {
  id?: string;
  ball: LonLat | null;
  lie: 'tee' | 'fairway' | 'rough' | 'sand' | 'recovery';
  category: 'tee' | 'approach' | 'layup' | 'recovery';
  description: string;
  /** Per-puzzle pin override, preserved across a load→save round trip. */
  pin?: LonLat;
}

/**
 * Fields the studio doesn't edit but must not destroy when re-saving a
 * loaded hole (polygon names, render mode, imagery framing).
 */
interface PreservedMeta {
  groundPlan?: boolean;
  imageryCenter?: LonLat;
  polygonNames: Map<string, string>;
}

interface HoleListing {
  id: string;
  courseName: string;
  holeNumber: number;
  par: number;
  yardage: number;
  puzzleCount: number;
}

export default function AnnotateStudio() {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const drawRef = useRef<TerraDraw | null>(null);
  const markersRef = useRef<MLMarker[]>([]);
  const placementRef = useRef<Placement>(null);
  const activeKindRef = useRef<FeatureKind>('fairway');
  const selectedRef = useRef<string | null>(null);
  const maplibreRef = useRef<typeof import('maplibre-gl') | null>(null);
  const preservedRef = useRef<PreservedMeta>({ polygonNames: new Map() });
  const loadedIdRef = useRef<string | null>(null);
  /** Set when a load was lossy — saving would delete what didn't draw. */
  const blockedRef = useRef(false);
  /** Unsaved tracing exists; warn before the tab closes. */
  const dirtyRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [activeKind, setActiveKind] = useState<FeatureKind | null>(null);
  const [placement, setPlacement] = useState<Placement>(null);
  const [center, setCenter] = useState<{ lat: number; lon: number; z: number } | null>(null);
  const [flyTo, setFlyTo] = useState('');
  const [meta, setMeta] = useState({ id: '', courseName: '', holeNumber: 1, par: 4 });
  const [pin, setPin] = useState<LonLat | null>(null);
  const [tees, setTees] = useState<LonLat[]>([]);
  const [puzzles, setPuzzles] = useState<PuzzleDraft[]>([]);
  const [holes, setHoles] = useState<HoleListing[]>([]);
  const [status, setStatus] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [polyCount, setPolyCount] = useState<Record<string, number>>({});

  const yardage = useMemo(() => {
    if (!pin || tees.length === 0) return null;
    const proj = createProjection(pin);
    return Math.round(dist(proj.toLocal(tees[0]!), proj.toLocal(pin)));
  }, [pin, tees]);

  const refreshHoles = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/holes');
      if (res.ok) setHoles(((await res.json()) as { holes: HoleListing[] }).holes);
    } catch {
      /* listing is a convenience */
    }
  }, []);

  const recountPolys = useCallback(() => {
    const snap = drawRef.current?.getSnapshot() ?? [];
    const counts: Record<string, number> = {};
    for (const f of snap) {
      if (f.geometry.type !== 'Polygon') continue;
      const kind = (f.properties as { kind?: string }).kind ?? 'untagged';
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    setPolyCount(counts);
  }, []);

  // ------------------------------------------------------------- map + draw
  useEffect(() => {
    let disposed = false;
    let map: MLMap | null = null;

    (async () => {
      const maplibregl = await import('maplibre-gl');
      const { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode } = await import('terra-draw');
      const { TerraDrawMapLibreGLAdapter } = await import('terra-draw-maplibre-gl-adapter');
      if (disposed || !mapDivRef.current) return;
      maplibreRef.current = maplibregl;
      maplibregl.setWorkerUrl('/vendor/maplibre-gl-worker.mjs');

      const params = new URLSearchParams(window.location.search);
      const lat = Number(params.get('lat')) || 30.19765;
      const lon = Number(params.get('lon')) || -81.39445;
      const z = Number(params.get('z')) || 17;

      map = new maplibregl.Map({
        container: mapDivRef.current,
        style: {
          version: 8,
          sources: {
            esri: {
              type: 'raster',
              tiles: [TILE_URL],
              tileSize: 256,
              maxzoom: 19,
              attribution: ESRI_ATTRIBUTION,
            },
          },
          layers: [
            { id: 'bg', type: 'background', paint: { 'background-color': ground.rough } },
            { id: 'imagery', type: 'raster', source: 'esri' },
          ],
        },
        center: [lon, lat],
        zoom: z,
        pitch: 0,
        maxPitch: 0,
        dragRotate: false,
        attributionControl: { compact: true },
      });
      map.touchZoomRotate.disableRotation();
      mapRef.current = map;
      (window as never as { __sgMap: unknown }).__sgMap = map;

      // Terra-draw registers style layers — it must wait for the style.
      await new Promise<void>((resolve) => map!.once('style.load', () => resolve()));
      if (disposed) return;

      const kindStyle = <T,>(picker: (kind: FeatureKind | undefined) => T) => {
        return (feature: { properties?: Record<string, unknown> }) =>
          picker((feature.properties?.kind as FeatureKind | undefined) ?? undefined);
      };
      const fillFor = (k: FeatureKind | undefined) =>
        KIND_COLOR[k ?? activeKindRef.current] ?? '#888888';

      const draw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [
          new TerraDrawPolygonMode({
            styles: {
              fillColor: kindStyle(fillFor) as never,
              fillOpacity: 0.28,
              outlineColor: kindStyle(fillFor) as never,
              outlineWidth: 2,
              closingPointColor: '#F1EBDD',
              closingPointOutlineColor: '#16130E',
            },
          }),
          new TerraDrawSelectMode({
            flags: {
              polygon: {
                feature: {
                  draggable: false,
                  coordinates: { midpoints: true, draggable: true, deletable: true },
                },
              },
            },
            styles: {
              selectedPolygonFillOpacity: 0.4,
              selectionPointColor: '#F1EBDD',
              selectionPointOutlineColor: '#B5342A',
              midPointColor: '#9C7A2E',
            },
          }),
        ],
      });
      draw.start();
      draw.setMode('select');
      drawRef.current = draw;

      draw.on('finish', (id, context) => {
        if (context.action !== 'draw') return;
        const f = draw.getSnapshot().find((x) => x.id === id);
        if (f && f.geometry.type === 'Polygon' && !(f.properties as { kind?: string }).kind) {
          draw.removeFeatures([id]);
          draw.addFeatures([
            {
              ...f,
              properties: { ...f.properties, mode: 'polygon', kind: activeKindRef.current },
            },
          ]);
        }
        recountPolys();
      });
      draw.on('select', (id) => {
        selectedRef.current = String(id);
      });
      draw.on('deselect', () => {
        selectedRef.current = null;
      });
      draw.on('change', () => {
        dirtyRef.current = true;
        recountPolys();
      });

      map.on('click', (ev) => {
        const p = placementRef.current;
        if (!p) return;
        const lonlat = { lon: ev.lngLat.lng, lat: ev.lngLat.lat };
        if (p.kind === 'pin') setPin(lonlat);
        else if (p.kind === 'tee') setTees((t) => [...t, lonlat]);
        else
          setPuzzles((ps) =>
            ps.map((pz, i) => (i === p.index ? { ...pz, ball: lonlat } : pz)),
          );
        placementRef.current = null;
        setPlacement(null);
      });

      const report = () => {
        const c = map!.getCenter();
        setCenter({ lat: c.lat, lon: c.lng, z: map!.getZoom() });
      };
      map.on('move', report);
      map.on('error', () => {});
      setReady(true);
      report();

      const id = params.get('id');
      if (id) void loadHole(id);
    })();

    // Tracing a hole is an hour of work — don't let a stray navigation eat it.
    const onBeforeUnload = (ev: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      ev.preventDefault();
      ev.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    void refreshHoles();
    return () => {
      disposed = true;
      window.removeEventListener('beforeunload', onBeforeUnload);
      drawRef.current?.stop();
      drawRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----------------------------------------------------------- point markers
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = maplibreRef.current;
    if (!map || !maplibregl || !ready) return;
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    const mk = (lonlat: LonLat, html: string) => {
      const el = document.createElement('div');
      el.innerHTML = html;
      el.style.lineHeight = '0';
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lonlat.lon, lonlat.lat])
        .addTo(map);
      markersRef.current.push(marker);
    };
    if (pin)
      mk(
        pin,
        `<svg width="18" height="18"><circle cx="9" cy="9" r="6" fill="none" stroke="#B5342A" stroke-width="2.5"/><circle cx="9" cy="9" r="1.6" fill="#B5342A"/></svg>`,
      );
    tees.forEach((t, i) =>
      mk(
        t,
        `<div style="font:600 10px monospace;color:#F1EBDD;background:#16130E;border:1px solid #F1EBDD;padding:1px 4px">T${i + 1}</div>`,
      ),
    );
    puzzles.forEach(
      (p, i) =>
        p.ball &&
        mk(
          p.ball,
          `<div style="font:600 10px monospace;color:#16130E;background:#F1EBDD;border:1.5px solid #16130E;border-radius:50%;width:18px;height:18px;display:grid;place-items:center">${i + 1}</div>`,
        ),
    );
  }, [pin, tees, puzzles, ready]);

  // ------------------------------------------------------------------ verbs
  const startPolygon = (kind: FeatureKind) => {
    activeKindRef.current = kind;
    setActiveKind(kind);
    setPlacement(null);
    placementRef.current = null;
    drawRef.current?.setMode('polygon');
  };
  const startSelect = () => {
    setActiveKind(null);
    drawRef.current?.setMode('select');
  };
  const startPlacement = (p: Placement) => {
    setActiveKind(null);
    drawRef.current?.setMode('select');
    placementRef.current = p;
    setPlacement(p);
  };
  const deleteSelected = () => {
    if (selectedRef.current) {
      drawRef.current?.removeFeatures([selectedRef.current]);
      selectedRef.current = null;
      recountPolys();
    }
  };
  const clearAll = () => {
    const ids = (drawRef.current?.getSnapshot() ?? []).map((f) => f.id!) as string[];
    if (ids.length + tees.length + puzzles.length > 0) {
      const ok = window.confirm(
        `Clear everything? ${ids.length} polygon(s), ${tees.length} tee(s) and ` +
          `${puzzles.length} puzzle(s) will be discarded. Saved holes are not affected.`,
      );
      if (!ok) return;
    }
    if (ids.length) drawRef.current?.removeFeatures(ids);
    setPin(null);
    setTees([]);
    setPuzzles([]);
    preservedRef.current = { polygonNames: new Map() };
    loadedIdRef.current = null;
    blockedRef.current = false;
    dirtyRef.current = false;
    recountPolys();
  };

  const doFlyTo = (lat: number, lon: number, zoom = 17) => {
    mapRef.current?.jumpTo({ center: [lon, lat], zoom });
  };

  const loadHole = useCallback(async (id: string) => {
    setBusy(true);
    setStatus({ tone: 'info', text: `Loading ${id}…` });
    try {
      const res = await fetch(`/api/admin/holes?id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`load failed (${res.status})`);
      const data = (await res.json()) as {
        hole: {
          id: string;
          courseName: string;
          holeNumber: number;
          par: number;
          geojson: {
            features: {
              properties: { kind: string; name?: string };
              geometry:
                | { type: 'Polygon'; coordinates: [number, number][][] }
                | { type: 'Point'; coordinates: [number, number] };
            }[];
          };
          imageryCenter: LonLat;
          groundPlan?: boolean;
        };
        puzzles: {
          id: string;
          ballPosition: LonLat;
          pinPosition: LonLat;
          lie: PuzzleDraft['lie'];
          category: PuzzleDraft['category'];
          description: string;
        }[];
      };
      const draw = drawRef.current;
      const old = (draw?.getSnapshot() ?? []).map((f) => f.id!) as string[];
      if (old.length) draw?.removeFeatures(old);

      const nextTees: LonLat[] = [];
      let nextPin: LonLat | null = null;
      const names = new Map<string, string>();
      const rejected: string[] = [];
      for (const f of data.hole.geojson.features) {
        if (f.geometry.type === 'Polygon') {
          const ring = roundRing(f.geometry.coordinates[0] as [number, number][]);
          if (f.properties.name) names.set(JSON.stringify(ring[0]), f.properties.name);
          // Capture the validation result: a silently rejected polygon would
          // vanish from the map and be deleted by the next save.
          const results = draw?.addFeatures([
            {
              type: 'Feature',
              properties: { mode: 'polygon', kind: f.properties.kind },
              geometry: { type: 'Polygon', coordinates: [ring] },
            } as never,
          ]);
          if (results?.some((r) => !r.valid)) {
            rejected.push(
              `${f.properties.name ?? f.properties.kind}: ${
                results.find((r) => !r.valid)?.reason ?? 'rejected'
              }`,
            );
          }
        } else if (f.properties.kind === 'pin') {
          nextPin = { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
        } else {
          nextTees.push({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
        }
      }
      setPin(nextPin);
      setTees(nextTees);
      setPuzzles(
        data.puzzles.map((p) => ({
          id: p.id,
          ball: p.ballPosition,
          lie: p.lie,
          category: p.category,
          description: p.description,
          pin: p.pinPosition,
        })),
      );
      setMeta({
        id: data.hole.id,
        courseName: data.hole.courseName,
        holeNumber: data.hole.holeNumber,
        par: data.hole.par,
      });
      // Hold the fields the studio doesn't edit so saving can't erase them.
      preservedRef.current = {
        groundPlan: data.hole.groundPlan,
        imageryCenter: data.hole.imageryCenter,
        polygonNames: names,
      };
      loadedIdRef.current = id;
      doFlyTo(data.hole.imageryCenter.lat, data.hole.imageryCenter.lon, 16.5);
      recountPolys();
      if (rejected.length) {
        setStatus({
          tone: 'err',
          text: `Loaded ${id} but ${rejected.length} polygon(s) could not be drawn (${rejected.join('; ')}). Saving now would delete them — reload before editing.`,
        });
        blockedRef.current = true;
      } else {
        blockedRef.current = false;
        setStatus({ tone: 'ok', text: `Loaded ${id}.` });
      }
    } catch (err) {
      setStatus({ tone: 'err', text: err instanceof Error ? err.message : 'load failed' });
    } finally {
      setBusy(false);
    }
  }, [recountPolys]);

  const save = async () => {
    const draw = drawRef.current;
    if (!draw) return;
    if (blockedRef.current) {
      setStatus({
        tone: 'err',
        text: 'Refusing to save: part of this hole failed to load, so saving would delete it. Reload the page and try again.',
      });
      return;
    }
    const polygons = draw
      .getSnapshot()
      .filter((f) => f.geometry.type === 'Polygon' && (f.properties as { kind?: string }).kind)
      .map((f) => {
        const ring = roundRing((f.geometry.coordinates as [number, number][][])[0]!);
        const name = preservedRef.current.polygonNames.get(JSON.stringify(ring[0]));
        return { kind: (f.properties as { kind: FeatureKind }).kind, ...(name ? { name } : {}), ring };
      });
    const readyPuzzles = puzzles.filter((p) => p.ball);
    if (!meta.id || !meta.courseName) {
      setStatus({ tone: 'err', text: 'Give the hole a slug and a course name first.' });
      return;
    }
    if (!pin || tees.length === 0 || polygons.length === 0 || readyPuzzles.length === 0) {
      setStatus({
        tone: 'err',
        text: 'A hole needs polygons, a pin, at least one tee, and at least one placed puzzle ball.',
      });
      return;
    }
    setBusy(true);
    setStatus({ tone: 'info', text: 'Saving — computing grids and ratings…' });
    try {
      const res = await fetch('/api/admin/hole', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          hole: {
            id: meta.id,
            courseName: meta.courseName,
            holeNumber: meta.holeNumber,
            par: meta.par,
            // Preserved from the loaded hole; a fresh trace keeps the defaults.
            ...(meta.id === loadedIdRef.current && preservedRef.current.groundPlan !== undefined
              ? { groundPlan: preservedRef.current.groundPlan }
              : {}),
            ...(meta.id === loadedIdRef.current && preservedRef.current.imageryCenter
              ? { imageryCenter: preservedRef.current.imageryCenter }
              : {}),
            polygons,
            pin,
            tees,
          },
          puzzles: readyPuzzles.map((p) => ({
            ...(p.id ? { id: p.id } : {}),
            ball: p.ball!,
            ...(p.pin ? { pin: p.pin } : {}),
            lie: p.lie,
            category: p.category,
            description: p.description || `${meta.courseName} No. ${meta.holeNumber}`,
          })),
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        yardage?: number;
        puzzles?: { id: string; rating: number; trapSize: number }[];
        warnings?: string[];
      };
      if (!res.ok) throw new Error(body.error ?? `save failed (${res.status})`);
      const ratings = body.puzzles!.map((p) => `${p.id} → ${p.rating}`).join(' · ');
      const warn = body.warnings?.length ? ` · ⚠ ${body.warnings.join('; ')}` : '';
      setStatus({ tone: 'ok', text: `Saved ${meta.id} (${body.yardage}y). ${ratings}${warn}` });
      dirtyRef.current = false;
      loadedIdRef.current = meta.id;
      void refreshHoles();
    } catch (err) {
      setStatus({ tone: 'err', text: err instanceof Error ? err.message : 'save failed' });
    } finally {
      setBusy(false);
    }
  };

  // ------------------------------------------------------------------ render
  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="relative min-w-0 flex-1 overflow-hidden border border-hairline bg-viewport">
        <div ref={mapDivRef} className="h-[76vh] min-h-[480px] w-full" data-ready={ready || undefined} />
        {/* center crosshair for precise camera reads */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2">
          <div className="absolute left-1/2 top-0 h-full w-px bg-[rgba(241,235,221,0.7)]" />
          <div className="absolute left-0 top-1/2 h-px w-full bg-[rgba(241,235,221,0.7)]" />
        </div>
        {center && (
          <div className="mono-nums pointer-events-none absolute bottom-2 right-2 bg-[rgba(16,21,17,0.85)] px-2 py-1 text-[11px] text-[rgba(241,235,221,0.85)]">
            {center.lat.toFixed(5)}, {center.lon.toFixed(5)} · z{center.z.toFixed(2)}
          </div>
        )}
        {placement && (
          <div className="folio-label pointer-events-none absolute left-3 top-3 bg-[rgba(16,21,17,0.85)] px-3 py-1.5 text-[13px] text-[rgba(241,235,221,0.92)]">
            Click the map to place{' '}
            {placement.kind === 'ball' ? `ball ${placement.index + 1}` : placement.kind}
          </div>
        )}
        {activeKind && (
          <div className="folio-label pointer-events-none absolute left-3 top-3 bg-[rgba(16,21,17,0.85)] px-3 py-1.5 text-[13px] text-[rgba(241,235,221,0.92)]">
            Drawing {activeKind} — click vertices, click the first point to close
          </div>
        )}
      </div>

      <aside className="w-full shrink-0 lg:w-96">
        <div className="stat-caption">Navigate</div>
        <div className="mt-1 flex gap-2">
          <input
            value={flyTo}
            onChange={(e) => setFlyTo(e.target.value)}
            placeholder="lat, lon"
            aria-label="Fly to coordinates"
            className="mono-nums min-w-0 flex-1 rounded-folio border border-hairline bg-paper px-2 py-1.5 text-[13px]"
          />
          <button
            type="button"
            className="rounded-folio border border-hairline bg-paper px-3 text-[13px]"
            onClick={() => {
              const m = flyTo.match(/(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/);
              if (m) doFlyTo(Number(m[1]), Number(m[2]));
            }}
          >
            Go
          </button>
          <select
            aria-label="Preset holes"
            className="max-w-[130px] rounded-folio border border-hairline bg-paper px-1 text-[12px]"
            defaultValue=""
            onChange={(e) => {
              const p = PRESETS[Number(e.target.value)];
              if (p) doFlyTo(p.lat, p.lon);
              e.target.value = '';
            }}
          >
            <option value="" disabled>
              presets
            </option>
            {PRESETS.map((p, i) => (
              <option key={p.label} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="stat-caption mt-4">Draw features</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => startPolygon(k)}
              aria-pressed={activeKind === k}
              className="rounded-folio border px-2.5 py-1.5 text-[12px]"
              style={{
                borderColor: KIND_COLOR[k],
                background: activeKind === k ? KIND_COLOR[k] : 'transparent',
                color: activeKind === k ? '#F1EBDD' : undefined,
              }}
            >
              {k} {polyCount[k] ? `·${polyCount[k]}` : ''}
            </button>
          ))}
          <button
            type="button"
            onClick={startSelect}
            className="rounded-folio border border-hairline bg-paper px-2.5 py-1.5 text-[12px]"
          >
            select/edit
          </button>
          <button
            type="button"
            onClick={deleteSelected}
            className="rounded-folio border border-hairline bg-paper px-2.5 py-1.5 text-[12px]"
          >
            delete selected
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="rounded-folio border border-flag px-2.5 py-1.5 text-[12px] text-flag"
          >
            clear all
          </button>
        </div>

        <div className="stat-caption mt-4">Points</div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => startPlacement({ kind: 'pin' })}
            className="rounded-folio border border-hairline bg-paper px-2.5 py-1.5 text-[12px]"
          >
            {pin ? 'move pin' : 'place pin'}
          </button>
          <button
            type="button"
            onClick={() => startPlacement({ kind: 'tee' })}
            className="rounded-folio border border-hairline bg-paper px-2.5 py-1.5 text-[12px]"
          >
            add tee ({tees.length})
          </button>
          {tees.length > 0 && (
            <button
              type="button"
              onClick={() => setTees([])}
              className="rounded-folio border border-hairline bg-paper px-2.5 py-1.5 text-[12px]"
            >
              clear tees
            </button>
          )}
        </div>

        <div className="stat-caption mt-4">Hole</div>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <input
            value={meta.id}
            onChange={(e) => setMeta({ ...meta, id: e.target.value })}
            placeholder="slug e.g. sawgrass-17"
            aria-label="Hole slug"
            className="mono-nums col-span-2 rounded-folio border border-hairline bg-paper px-2 py-1.5 text-[13px]"
          />
          <input
            value={meta.courseName}
            onChange={(e) => setMeta({ ...meta, courseName: e.target.value })}
            placeholder="Course name"
            aria-label="Course name"
            className="col-span-2 rounded-folio border border-hairline bg-paper px-2 py-1.5 text-[13px]"
          />
          <label className="mono-nums text-[12px]">
            hole #
            <input
              type="number"
              min={1}
              max={18}
              value={meta.holeNumber}
              onChange={(e) => setMeta({ ...meta, holeNumber: Number(e.target.value) || 1 })}
              className="mono-nums mt-0.5 w-full rounded-folio border border-hairline bg-paper px-2 py-1.5"
            />
          </label>
          <label className="mono-nums text-[12px]">
            par
            <input
              type="number"
              min={3}
              max={5}
              value={meta.par}
              onChange={(e) => setMeta({ ...meta, par: Number(e.target.value) || 4 })}
              className="mono-nums mt-0.5 w-full rounded-folio border border-hairline bg-paper px-2 py-1.5"
            />
          </label>
          <div className="mono-nums col-span-2 text-[12px] text-ink-soft">
            yardage (tee → pin): {yardage ?? '—'}y
          </div>
        </div>

        <div className="stat-caption mt-4">Puzzles ({puzzles.length}/4)</div>
        <div className="mt-1 grid gap-2">
          {puzzles.map((p, i) => (
            <div key={i} className="rounded-folio border border-hairline bg-paper p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mono-nums text-[12px] font-semibold">{i + 1}</span>
                <button
                  type="button"
                  onClick={() => startPlacement({ kind: 'ball', index: i })}
                  className="rounded-folio border border-hairline px-2 py-1 text-[11px]"
                >
                  {p.ball ? 'move ball' : 'place ball'}
                </button>
                <select
                  value={p.lie}
                  aria-label="Lie"
                  onChange={(e) =>
                    setPuzzles((ps) =>
                      ps.map((x, j) =>
                        j === i ? { ...x, lie: e.target.value as PuzzleDraft['lie'] } : x,
                      ),
                    )
                  }
                  className="rounded-folio border border-hairline bg-paper px-1 py-1 text-[11px]"
                >
                  {['tee', 'fairway', 'rough', 'sand', 'recovery'].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
                <select
                  value={p.category}
                  aria-label="Category"
                  onChange={(e) =>
                    setPuzzles((ps) =>
                      ps.map((x, j) =>
                        j === i
                          ? { ...x, category: e.target.value as PuzzleDraft['category'] }
                          : x,
                      ),
                    )
                  }
                  className="rounded-folio border border-hairline bg-paper px-1 py-1 text-[11px]"
                >
                  {['tee', 'approach', 'layup', 'recovery'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`Remove puzzle ${i + 1}`}
                  onClick={() => setPuzzles((ps) => ps.filter((_, j) => j !== i))}
                  className="ml-auto rounded-folio border border-hairline px-2 py-1 text-[11px] text-flag"
                >
                  ✕
                </button>
              </div>
              <input
                value={p.description}
                onChange={(e) =>
                  setPuzzles((ps) =>
                    ps.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                  )
                }
                placeholder="Description shown to the player"
                aria-label={`Puzzle ${i + 1} description`}
                className="mt-1.5 w-full rounded-folio border border-hairline bg-paper px-2 py-1 text-[12px]"
              />
            </div>
          ))}
          {puzzles.length < 4 && (
            <button
              type="button"
              onClick={() =>
                setPuzzles((ps) => [
                  ...ps,
                  { ball: null, lie: 'fairway', category: 'approach', description: '' },
                ])
              }
              className="rounded-folio border border-hairline bg-paper px-3 py-2 text-[13px]"
            >
              + add puzzle
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="min-h-11 rounded-folio bg-ink px-5 font-ui text-[14px] font-medium text-paper disabled:opacity-60"
          >
            {busy ? 'Working…' : 'Save hole'}
          </button>
          <select
            aria-label="Load existing hole"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) void loadHole(e.target.value);
              e.target.value = '';
            }}
            className="min-w-0 flex-1 rounded-folio border border-hairline bg-paper px-2 py-2 text-[13px]"
          >
            <option value="" disabled>
              load existing… ({holes.length})
            </option>
            {holes.map((h) => (
              <option key={h.id} value={h.id}>
                {h.id} — {h.courseName} #{h.holeNumber} ({h.puzzleCount} pz)
              </option>
            ))}
          </select>
        </div>

        {status && (
          <p
            role="status"
            className={`mono-nums mt-3 text-[12.5px] ${
              status.tone === 'err' ? 'text-flag' : status.tone === 'ok' ? 'text-fairway' : 'text-ink-soft'
            }`}
          >
            {status.text}
          </p>
        )}
      </aside>
    </div>
  );
}
