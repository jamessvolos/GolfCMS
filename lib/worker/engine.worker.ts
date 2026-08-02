/**
 * Engine web worker: hole preparation, Monte Carlo aim evaluation, and the
 * full grid search + contour extraction, all off the main thread. The grid
 * is kicked off while the player is still aiming, so the reveal usually has
 * its isolines ready the moment the pin locks.
 */

import { evaluateAim, type Situation } from '@/lib/engine/evaluate';
import { evaluateGrid } from '@/lib/engine/optimize';
import { prepareHole } from '@/lib/engine/hole';
import { contoursFromGrid } from '@/lib/map/contours';
import type { PreparedHole } from '@/lib/engine/types';
import type { SituationWire, WorkerRequest, WorkerResponse } from './protocol';

let prepared: PreparedHole | null = null;

const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg);

function toSituation(prep: PreparedHole, wire: SituationWire): Situation {
  return {
    ball: prep.toLocal(wire.ball),
    pin: prep.toLocal(wire.pin),
    lie: wire.lie,
  };
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      prepared = prepareHole(msg.hole);
      post({ type: 'ready', id: msg.id });
      return;
    }
    if (!prepared) throw new Error('worker not initialized');

    if (msg.type === 'grid') {
      const sit = toSituation(prepared, msg.sit);
      const grid = evaluateGrid(prepared, sit, msg.profile, msg.category, {
        nSamples: msg.nSamples,
      });
      const contours = contoursFromGrid(grid, sit.ball, sit.pin, msg.profile, sit.lie);
      post({
        type: 'grid',
        id: msg.id,
        summary: {
          contours,
          optimal: {
            local: grid.optimal.point,
            lonlat: prepared.toLonLat(grid.optimal.point),
            e: grid.optimal.expectedStrokes,
            clubLabel: grid.optimal.result.outcomeStats.club.label,
            result: grid.optimal.result,
          },
          naive: {
            local: grid.naive.point,
            lonlat: prepared.toLonLat(grid.naive.point),
            e: grid.naive.expectedStrokes,
          },
          trapSize: grid.trapSize,
        },
      });
      return;
    }

    if (msg.type === 'aim') {
      const sit = toSituation(prepared, msg.sit);
      const aimLocal = prepared.toLocal(msg.aim);
      const result = evaluateAim(prepared, sit, msg.profile, aimLocal);
      post({ type: 'aim', id: msg.id, result, aimLocal });
      return;
    }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
};
