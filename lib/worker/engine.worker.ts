/**
 * Engine web worker: hole preparation and Monte Carlo aim evaluation off
 * the main thread, plus a full grid-summary computation used as a fallback
 * when the server-side heatmap cache is unreachable.
 */

import { evaluateAim, type Situation } from '@/lib/engine/evaluate';
import { prepareHole } from '@/lib/engine/hole';
import { computeGridSummary } from '@/lib/puzzle/gridSummary';
import { explain } from '@/lib/explain';
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
      const summary = computeGridSummary(prepared, sit, msg.profile, msg.category, {
        nSamples: msg.nSamples,
      });
      post({ type: 'grid', id: msg.id, summary });
      return;
    }

    if (msg.type === 'note') {
      const prep = prepared;
      const sit = toSituation(prep, msg.sit);
      const playerAim = prep.toLocal(msg.aim);
      const playerEval = evaluateAim(prep, sit, msg.profile, playerAim);
      const note = explain({
        category: msg.category,
        lie: sit.lie,
        band: msg.band,
        sgLoss: msg.sgLoss,
        prepared: prep,
        sit,
        profile: msg.profile,
        playerAim,
        playerEval,
        grid: msg.grid,
        evaluate: (aim) => evaluateAim(prep, sit, msg.profile, aim),
        history: [],
      });
      post({ type: 'note', id: msg.id, note });
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
