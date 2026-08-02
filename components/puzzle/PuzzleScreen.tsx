'use client';

/**
 * The puzzle instrument: MapLibre viewport with toned imagery and the
 * drafting ground plan, tap-to-aim with a live HUD chip, then the
 * three-beat reveal — Lock (dim, pin sets), Draw (isolines pen-plot
 * outward from the optimal, ellipses dash in), Stamp (band stamp, sgLoss
 * and Elo tick up). Skippable at any point; fully static under
 * prefers-reduced-motion.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MLMap, Marker as MLMarker } from 'maplibre-gl';
import { selectClub, maxCarry } from '@/lib/engine/clubs';
import { dispersionParams } from '@/lib/engine/dispersion';
import { createProjection, dist } from '@/lib/engine/projection';
import { SEED_PROFILE } from '@/lib/engine/profile';
import { eloDeltas, puzzleRatingFromTrap, scoreBand } from '@/lib/engine/scoring';
import type { HoleData, LonLat, Pt } from '@/lib/engine/types';
import { bandStamp, reveal as beats } from '@/lib/design/tokens';
import { buildMapStyle } from '@/lib/map/groundStyle';
import { drawRangeTicks, drawReveal } from '@/lib/map/overlayDraw';
import type { EllipseSpec, RevealScene } from '@/lib/map/overlayDraw';
import type { PuzzleContent } from '@/lib/content/holes';
import { EngineClient } from '@/lib/worker/engineClient';
import type { GridSummary } from '@/lib/worker/protocol';
import { getRating, setRating } from '@/lib/progress/local';

type Phase = 'boot' | 'aiming' | 'plotting' | 'reveal' | 'done' | 'error';

interface Outcome {
  sgLoss: number;
  band: 'perfect' | 'good' | 'okay' | 'miss';
  playerE: number;
  optimalE: number;
  playerClub: string;
  optimalClub: string;
  eloDelta: number;
  newRating: number;
  puzzleRating: number;
  practice: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function PuzzleScreen({
  hole,
  puzzle,
  nextPuzzleId,
}: {
  hole: HoleData;
  puzzle: PuzzleContent;
  nextPuzzleId: string | null;
}) {
  const profile = SEED_PROFILE;
  const proj = useMemo(() => createProjection(hole.imageryCenter), [hole]);
  const ballLocal = useMemo(() => proj.toLocal(puzzle.ballPosition), [proj, puzzle]);
  const pinLocal = useMemo(() => proj.toLocal(puzzle.pinPosition), [proj, puzzle]);
  const holeDistance = useMemo(() => dist(ballLocal, pinLocal), [ballLocal, pinLocal]);
  const upDir = useMemo(() => {
    const d = holeDistance || 1;
    return { x: (pinLocal.x - ballLocal.x) / d, y: (pinLocal.y - ballLocal.y) / d };
  }, [ballLocal, pinLocal, holeDistance]);
  const bearingDeg = useMemo(
    () => (Math.atan2(pinLocal.x - ballLocal.x, pinLocal.y - ballLocal.y) * 180) / Math.PI,
    [ballLocal, pinLocal],
  );
  const sitWire = useMemo(
    () => ({ ball: puzzle.ballPosition, pin: puzzle.pinPosition, lie: puzzle.lie }),
    [puzzle],
  );

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const aimMarkerRef = useRef<MLMarker | null>(null);
  const engineRef = useRef<EngineClient | null>(null);
  const gridPromiseRef = useRef<Promise<GridSummary> | null>(null);
  const gridReadyRef = useRef<GridSummary | null>(null);
  const sceneRef = useRef<RevealScene | null>(null);
  const progressRef = useRef({ contours: 0, ellipses: 0, labels: 0 });
  const rafRef = useRef(0);
  const skipRef = useRef(false);
  const eloAppliedRef = useRef(false);
  const aimRef = useRef<LonLat | null>(null);
  const phaseRef = useRef<Phase>('boot');

  const [phase, setPhaseState] = useState<Phase>('boot');
  const [gridReady, setGridReady] = useState(false);
  const [aimInfo, setAimInfo] = useState<{ distance: number; club: string } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [tick, setTick] = useState({ sg: 0, elo: 0 });
  const [stampOn, setStampOn] = useState(false);

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  // ------------------------------------------------------------------ canvas
  const projectYd = useCallback(
    (p: Pt) => {
      const map = mapRef.current!;
      const s = map.project([proj.toLonLat(p).lon, proj.toLonLat(p).lat]);
      return { x: s.x, y: s.y };
    },
    [proj],
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const map = mapRef.current;
    if (!canvas || !map) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const ph = phaseRef.current;
    if (ph === 'aiming' || ph === 'plotting') {
      drawRangeTicks(ctx, projectYd, ballLocal, upDir, holeDistance + 60);
    }
    if ((ph === 'reveal' || ph === 'done') && sceneRef.current) {
      drawReveal(ctx, projectYd, sceneRef.current, progressRef.current);
    }
  }, [projectYd, ballLocal, upDir, holeDistance]);

  // ------------------------------------------------------------------- HUD
  const updateHud = useCallback(
    (lonlat: LonLat) => {
      const hud = hudRef.current;
      const map = mapRef.current;
      if (!hud || !map) return;
      const local = proj.toLocal(lonlat);
      const d = dist(ballLocal, local);
      const sel = selectClub(profile, puzzle.lie, d);
      const clubText = sel.clamped ? `${sel.club.label} (max)` : sel.club.label;
      hud.innerHTML = `<b>${Math.round(d)}y</b> · ${clubText.toUpperCase()}`;
      const s = map.project([lonlat.lon, lonlat.lat]);
      hud.style.transform = `translate(${Math.round(s.x + 14)}px, ${Math.round(s.y - 34)}px)`;
      hud.style.display = 'block';
      setAimInfo({ distance: Math.round(d), club: clubText });
    },
    [proj, ballLocal, profile, puzzle.lie],
  );

  // --------------------------------------------------------------- map init
  useEffect(() => {
    let disposed = false;

    const engine = new EngineClient();
    engineRef.current = engine;
    gridPromiseRef.current = engine
      .init(hole)
      .then(() => engine.grid(sitWire, profile, puzzle.category))
      .then((summary) => {
        gridReadyRef.current = summary;
        if (!disposed) setGridReady(true);
        return summary;
      });
    // Surface engine failures instead of leaving the player stuck: the
    // promise is re-awaited in confirmAim, which owns the error phase, but
    // an early rejection must not become an unhandled-rejection crash.
    gridPromiseRef.current.catch(() => {});

    let map: MLMap | null = null;
    (async () => {
      const maplibregl = await import('maplibre-gl');
      if (disposed || !mapDivRef.current) return;
      // Bundlers mangle MapLibre's self-spawned worker; use the copy served
      // from /public (see scripts/copy-maplibre-worker.mjs).
      maplibregl.setWorkerUrl('/vendor/maplibre-gl-worker.mjs');

      map = new maplibregl.Map({
        container: mapDivRef.current,
        style: buildMapStyle(hole, { groundPlan: true }),
        center: [
          (puzzle.ballPosition.lon + puzzle.pinPosition.lon) / 2,
          (puzzle.ballPosition.lat + puzzle.pinPosition.lat) / 2,
        ],
        bearing: bearingDeg,
        pitch: 0,
        maxPitch: 0,
        dragRotate: false,
        attributionControl: false,
      });
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      mapRef.current = map;
      (window as never as { __sgMap: unknown }).__sgMap = map;

      // Frame the hole: ball → pin with lateral margin, hole running up-screen.
      const corners = [
        { x: ballLocal.x - 90, y: ballLocal.y - 45 },
        { x: ballLocal.x + 90, y: ballLocal.y - 45 },
        { x: pinLocal.x - 90, y: pinLocal.y + 45 },
        { x: pinLocal.x + 90, y: pinLocal.y + 45 },
      ].map((p) => proj.toLonLat(p));
      const lons = corners.map((c) => c.lon);
      const lats = corners.map((c) => c.lat);
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        {
          bearing: bearingDeg,
          padding: { top: 48, bottom: 96, left: 36, right: 36 },
          duration: 0,
        },
      );

      const mkEl = (className: string, html: string) => {
        const el = document.createElement('div');
        el.className = className;
        el.innerHTML = html;
        return el;
      };
      new maplibregl.Marker({ element: mkEl('sg-ball-marker', '') })
        .setLngLat([puzzle.ballPosition.lon, puzzle.ballPosition.lat])
        .addTo(map);
      new maplibregl.Marker({
        element: mkEl(
          'sg-pin-marker',
          `<svg width="20" height="26" viewBox="0 0 20 26"><line x1="4" y1="1" x2="4" y2="25" stroke="#F1EBDD" stroke-width="1.6"/><path d="M4 2 L17 5.4 L4 8.8 Z" fill="#B5342A" stroke="#F1EBDD" stroke-width="0.6"/></svg>`,
        ),
        anchor: 'bottom-left',
        offset: [-4, 2],
      })
        .setLngLat([puzzle.pinPosition.lon, puzzle.pinPosition.lat])
        .addTo(map);

      map.on('click', (ev) => {
        if (phaseRef.current !== 'aiming') return;
        const lonlat = { lon: ev.lngLat.lng, lat: ev.lngLat.lat };
        aimRef.current = lonlat;
        if (!aimMarkerRef.current) {
          const el = mkEl(
            'sg-aim-marker',
            `<svg width="18" height="30" viewBox="0 0 18 30"><line x1="9" y1="6" x2="9" y2="29" stroke="#B5342A" stroke-width="2"/><path d="M9 5 L16 8 L9 11 Z" fill="#B5342A"/><circle cx="9" cy="29" r="2.4" fill="#B5342A"/></svg>`,
          );
          const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', draggable: true })
            .setLngLat([lonlat.lon, lonlat.lat])
            .addTo(map!);
          marker.on('drag', () => {
            const p = marker.getLngLat();
            aimRef.current = { lon: p.lng, lat: p.lat };
            updateHud(aimRef.current);
          });
          aimMarkerRef.current = marker;
        } else {
          aimMarkerRef.current.setLngLat([lonlat.lon, lonlat.lat]);
        }
        updateHud(lonlat);
      });

      map.on('move', () => {
        redraw();
        if (aimRef.current && phaseRef.current === 'aiming') updateHud(aimRef.current);
      });
      // 'style.load' rather than 'load': the style is inline and the vector
      // ground plan needs no network, so aiming must not wait on imagery
      // tiles (which may be slow or blocked in offline dev).
      map.once('style.load', () => {
        if (!disposed) {
          setPhase('aiming');
          redraw();
        }
      });
      // Tiles may be unreachable (offline dev): the vector ground plan is the
      // ground. Swallow raster errors so they don't crash the console flow.
      map.on('error', () => {});
    })();

    const ro = new ResizeObserver(() => redraw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    if (document.fonts?.load) {
      document.fonts.load('500 11px "Archivo Narrow"').catch(() => {});
    }

    return () => {
      disposed = true;
      ro.disconnect();
      cancelAnimationFrame(rafRef.current);
      engine.dispose();
      map?.remove();
      mapRef.current = null;
      aimMarkerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hole, puzzle.id]);

  // ------------------------------------------------------------- the reveal
  const finishReveal = useCallback(
    (o: Outcome) => {
      progressRef.current = { contours: 1, ellipses: 1, labels: 1 };
      setStampOn(true);
      setTick({ sg: o.sgLoss, elo: o.eloDelta });
      setPhase('done');
      redraw();
    },
    [redraw, setPhase],
  );

  const confirmAim = useCallback(async () => {
    const engine = engineRef.current;
    const aim = aimRef.current;
    if (!engine || !aim || phaseRef.current !== 'aiming') return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    skipRef.current = false;
    setPhase('plotting');
    aimMarkerRef.current?.setDraggable(false);
    if (hudRef.current) hudRef.current.style.display = 'none';

    // Beat 1 — LOCK: pin sets, imagery dims 10%, haptic tick.
    const t0 = performance.now();
    (window as never as { __sgBeats: Record<string, number> }).__sgBeats = { lock: t0 };
    wrapRef.current?.classList.add('sg-dimmed');
    navigator.vibrate?.(10);

    let aimEval: Awaited<ReturnType<EngineClient['aim']>>;
    let grid: GridSummary;
    try {
      [aimEval, grid] = await Promise.all([
        engine.aim(sitWire, profile, aim),
        gridPromiseRef.current!,
      ]);
    } catch {
      wrapRef.current?.classList.remove('sg-dimmed');
      setPhase('error');
      return;
    }

    // Build the scene.
    const mkEllipse = (aimLocal: Pt, effDistance: number): EllipseSpec => {
      const d = Math.max(0.5, dist(ballLocal, aimLocal));
      const dir = { x: (aimLocal.x - ballLocal.x) / d, y: (aimLocal.y - ballLocal.y) / d };
      const params = dispersionParams(profile, puzzle.lie, effDistance);
      const center = {
        x: ballLocal.x + dir.x * effDistance + dir.y * params.meanLat,
        y: ballLocal.y + dir.y * effDistance - dir.x * params.meanLat,
      };
      return { center, sigmaLat: params.sigmaLat, sigmaLong: params.sigmaLong, dir };
    };
    sceneRef.current = {
      contours: grid.contours,
      optimal: grid.optimal.local,
      ellipses: [
        mkEllipse(aimEval.aimLocal, aimEval.result.outcomeStats.aimDistance),
        mkEllipse(grid.optimal.local, grid.optimal.result.outcomeStats.aimDistance),
      ],
      washLevel: 0.5,
    };

    // Score the attempt.
    const sgLoss = aimEval.result.expectedStrokes - grid.optimal.e;
    const band = scoreBand(sgLoss);
    const puzzleRating = puzzleRatingFromTrap(grid.trapSize);
    const practice = eloAppliedRef.current;
    const rating = getRating();
    const deltas = eloDeltas(rating, puzzleRating, band.eloScore);
    const newRating = practice ? rating : rating + deltas.player;
    if (!practice) {
      setRating(newRating);
      eloAppliedRef.current = true;
    }
    const o: Outcome = {
      sgLoss,
      band: band.band,
      playerE: aimEval.result.expectedStrokes,
      optimalE: grid.optimal.e,
      playerClub: aimEval.result.outcomeStats.club.label,
      optimalClub: grid.optimal.clubLabel,
      eloDelta: practice ? 0 : deltas.player,
      newRating,
      puzzleRating,
      practice,
    };
    setOutcome(o);

    if (reduced || skipRef.current) {
      finishReveal(o);
      return;
    }

    // Honor the full lock beat even when the engine answered instantly.
    const lockElapsed = performance.now() - t0;
    if (lockElapsed < beats.lockEnd) await sleep(beats.lockEnd - lockElapsed);
    if (skipRef.current) {
      finishReveal(o);
      return;
    }

    // Beats 2 + 3 — DRAW then STAMP.
    setPhase('reveal');
    const drawMs = beats.drawEnd - beats.lockEnd; // 500
    const stampMs = beats.stampEnd - beats.drawEnd; // 250
    const beatLog = (window as never as { __sgBeats: Record<string, number> }).__sgBeats;
    beatLog.draw = performance.now();
    let stampStarted = false;

    const drawT0 = performance.now();
    const loop = () => {
      if (skipRef.current) {
        finishReveal(o);
        return;
      }
      const p = performance.now() - drawT0;
      progressRef.current = {
        contours: Math.min(1, p / drawMs),
        ellipses: Math.min(1, Math.max(0, (p - 80) / (drawMs - 80))),
        labels: Math.min(1, Math.max(0, (p - drawMs * 0.55) / (drawMs * 0.45))),
      };
      redraw();
      if (p >= drawMs && !stampStarted) {
        stampStarted = true;
        beatLog.stamp = performance.now();
        setStampOn(true);
      }
      if (p >= drawMs) {
        const st = Math.min(1, (p - drawMs) / stampMs);
        setTick({ sg: o.sgLoss * st, elo: Math.round(o.eloDelta * st) });
      }
      if (p >= drawMs + stampMs) {
        beatLog.done = performance.now();
        finishReveal(o);
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [ballLocal, finishReveal, profile, puzzle.lie, redraw, setPhase, sitWire]);

  const skip = useCallback(() => {
    if (phaseRef.current === 'plotting' || phaseRef.current === 'reveal') {
      skipRef.current = true;
      cancelAnimationFrame(rafRef.current);
      if (outcome) finishReveal(outcome);
    }
  }, [outcome, finishReveal]);

  const reAim = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    sceneRef.current = null;
    progressRef.current = { contours: 0, ellipses: 0, labels: 0 };
    setStampOn(false);
    setOutcome(null);
    setTick({ sg: 0, elo: 0 });
    wrapRef.current?.classList.remove('sg-dimmed');
    aimMarkerRef.current?.setDraggable(true);
    setPhase('aiming');
    if (aimRef.current) updateHud(aimRef.current);
    redraw();
  }, [redraw, setPhase, updateHud]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (phaseRef.current === 'reveal' || phaseRef.current === 'plotting') {
        // Skip on activation keys only — never swallow Tab or shortcuts.
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Escape') {
          ev.preventDefault();
          skip();
        }
      } else if (phaseRef.current === 'aiming' && ev.key === 'Enter' && aimRef.current) {
        confirmAim();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [skip, confirmAim]);

  // ---------------------------------------------------------------- render
  const maxReach = Math.round(maxCarry(profile, puzzle.lie));
  const stamp = outcome ? bandStamp.labels[outcome.band] : '';
  const stampColor = outcome ? bandStamp.colors[outcome.band] : undefined;

  return (
    <div data-phase={phase} data-grid-ready={gridReady || undefined}>
      <div
        ref={wrapRef}
        className="sg-map relative overflow-hidden border border-hairline bg-viewport"
        onPointerDown={(ev) => {
          if (phaseRef.current === 'reveal' || phaseRef.current === 'plotting') {
            ev.preventDefault();
            skip();
          }
        }}
      >
        <div ref={mapDivRef} className="h-[68vh] min-h-[420px] max-h-[760px] w-full" />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        <div
          ref={hudRef}
          className="mono-nums pointer-events-none absolute left-0 top-0 hidden border border-[rgba(241,235,221,0.28)] bg-[rgba(16,21,17,0.94)] px-2 py-1 text-[11px] text-[rgba(241,235,221,0.92)]"
        />

        {phase === 'boot' && (
          <div className="absolute inset-0 grid place-items-center bg-viewport">
            <span className="stat-caption">Preparing instrument…</span>
          </div>
        )}

        {phase === 'error' && (
          <div className="absolute inset-0 grid place-items-center bg-[rgba(16,21,17,0.9)] px-6">
            <div className="max-w-[38ch] text-center">
              <p className="font-ui text-[15px] text-[rgba(241,235,221,0.92)]">
                The engine hit a snag while surveying this hole.
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mono-nums mt-4 min-h-11 rounded-folio border border-hairline bg-paper px-5 text-[14px] text-ink"
              >
                Reload the puzzle
              </button>
            </div>
          </div>
        )}

        {phase === 'aiming' && (
          <div className="folio-label pointer-events-none absolute left-3 top-3 bg-[rgba(16,21,17,0.85)] px-3 py-1.5 text-[13px] text-[rgba(241,235,221,0.92)]">
            {puzzle.lie === 'tee' ? 'Tee shot' : `From the ${puzzle.lie}`} · drop a pin — where do
            you aim?
          </div>
        )}
        {phase === 'plotting' && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2">
            <span className="stat-caption bg-[rgba(16,21,17,0.85)] px-3 py-1.5 text-[rgba(241,235,221,0.8)]">
              Plotting the field…
            </span>
          </div>
        )}

        {stampOn && outcome && (
          <div className="pointer-events-none absolute inset-x-0 top-[10%] flex justify-center">
            <div
              className="sg-stamp border-2 bg-[rgba(241,235,221,0.93)] px-5 py-1.5"
              style={{ color: stampColor, borderColor: stampColor }}
            >
              <span className="font-display text-[34px] uppercase tracking-[0.06em]">{stamp}</span>
            </div>
          </div>
        )}

        {phase === 'aiming' && (
          <div className="absolute inset-x-0 bottom-4 flex justify-center px-4">
            <button
              type="button"
              onClick={confirmAim}
              disabled={!aimInfo}
              className="mono-nums min-h-12 rounded-folio border border-hairline bg-paper px-6 text-[14px] font-medium text-ink disabled:opacity-50"
            >
              {aimInfo
                ? `Confirm aim — ${aimInfo.distance}y · ${aimInfo.club}`
                : 'Tap the map to set an aim'}
            </button>
          </div>
        )}
        {(phase === 'reveal' || phase === 'plotting') && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
            <span className="stat-caption text-[rgba(241,235,221,0.6)]">tap to skip</span>
          </div>
        )}
      </div>

      {outcome && phase === 'done' && (
        <div className="mt-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <div>
              <div className="stat-caption">SG loss</div>
              <div className="mono-nums text-[22px] font-semibold">{tick.sg.toFixed(2)}</div>
            </div>
            <div>
              <div className="stat-caption">Your aim</div>
              <div className="mono-nums text-[15px]">
                E {outcome.playerE.toFixed(2)} · {outcome.playerClub}
              </div>
            </div>
            <div>
              <div className="stat-caption">Optimal ◬</div>
              <div className="mono-nums text-[15px]">
                E {outcome.optimalE.toFixed(2)} · {outcome.optimalClub}
              </div>
            </div>
            <div>
              <div className="stat-caption">{outcome.practice ? 'Practice' : 'Elo'}</div>
              <div className="mono-nums text-[15px]">
                {outcome.practice
                  ? 'no rating change'
                  : `${outcome.eloDelta >= 0 ? '+' : ''}${tick.elo} → ${outcome.newRating}`}
                <span className="text-ink-soft"> · puzzle {outcome.puzzleRating}</span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={reAim}
              className="min-h-11 rounded-folio border border-hairline bg-paper px-5 font-ui text-[14px]"
            >
              Re-aim this shot
            </button>
            {nextPuzzleId && (
              <Link
                href={`/puzzle/${nextPuzzleId}`}
                className="grid min-h-11 place-items-center rounded-folio bg-ink px-5 font-ui text-[14px] text-paper"
              >
                Next puzzle →
              </Link>
            )}
          </div>
        </div>
      )}

      {phase !== 'done' && (
        <p className="mono-nums mt-3 text-[12px] text-ink-soft">
          {puzzle.description} · max reach {maxReach}y · pin {Math.round(holeDistance)}y
          {gridReady ? '' : ' · surveying the field…'}
        </p>
      )}
    </div>
  );
}
