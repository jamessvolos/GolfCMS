/**
 * Typed promise wrapper around the engine worker.
 */

import type { EvalResult, HoleData, LonLat, PlayerProfile, Pt } from '@/lib/engine/types';
import type { GridSummary, SituationWire, WorkerRequest, WorkerResponse } from './protocol';
import type { Note } from '@/lib/explain/types';

type Pending = { resolve: (value: never) => void; reject: (err: Error) => void };

export class EngineClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg as never);
    };
    // A worker that fails to boot (bad chunk, top-level throw) never posts a
    // message — reject everything in flight so callers can show an error.
    this.worker.onerror = (ev) => this.rejectAll(new Error(ev.message || 'engine worker crashed'));
    this.worker.onmessageerror = () => this.rejectAll(new Error('engine worker message error'));
  }

  private rejectAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private send<T>(req: Omit<WorkerRequest, 'id'>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as never, reject });
      this.worker.postMessage({ ...req, id });
    });
  }

  async init(hole: HoleData): Promise<void> {
    await this.send<{ type: 'ready' }>({ type: 'init', hole } as never);
  }

  async grid(
    sit: SituationWire,
    profile: PlayerProfile,
    category: 'tee' | 'approach' | 'layup' | 'recovery',
  ): Promise<GridSummary> {
    const res = await this.send<{ type: 'grid'; summary: GridSummary }>({
      type: 'grid',
      sit,
      profile,
      category,
    } as never);
    return res.summary;
  }

  /** Generate the caddie's note; the worker owns the prepared hole. */
  async note(req: {
    sit: SituationWire;
    profile: PlayerProfile;
    category: 'tee' | 'approach' | 'layup' | 'recovery';
    band: 'perfect' | 'good' | 'okay' | 'miss';
    sgLoss: number;
    aim: LonLat;
    grid: GridSummary;
  }): Promise<Note> {
    const res = await this.send<{ type: 'note'; note: Note }>({
      type: 'note',
      ...req,
    } as never);
    return res.note;
  }

  async aim(
    sit: SituationWire,
    profile: PlayerProfile,
    aim: LonLat,
  ): Promise<{ result: EvalResult; aimLocal: Pt }> {
    const res = await this.send<{ type: 'aim'; result: EvalResult; aimLocal: Pt }>({
      type: 'aim',
      sit,
      profile,
      aim,
    } as never);
    return { result: res.result, aimLocal: res.aimLocal };
  }

  dispose(): void {
    this.worker.terminate();
    this.rejectAll(new Error('engine client disposed'));
  }
}
