import { describe, expect, it, vi } from 'vitest';
import { getOrComputeHeatmap, MemoryHeatmapStore } from './heatmap';
import { capeHole, CAPE_APPROACH } from '@/lib/engine/holes/cape';
import { prepareHole } from '@/lib/engine/hole';
import type { PuzzleContent } from '@/lib/content/holes';
import type { PlayerProfile } from '@/lib/engine/types';

function capeContent() {
  const hole = capeHole();
  const prepared = prepareHole(hole);
  const puzzle: PuzzleContent = {
    id: 'cape-01-approach',
    holeId: hole.id,
    ballPosition: prepared.toLonLat(CAPE_APPROACH.ball),
    pinPosition: prepared.toLonLat(prepared.pin),
    lie: CAPE_APPROACH.lie,
    category: CAPE_APPROACH.category,
    description: CAPE_APPROACH.description,
  };
  return { hole, puzzle };
}

const FAST = { nSamples: 150 };

describe('getOrComputeHeatmap', () => {
  it('computes on miss, then serves from the cache', async () => {
    const store = new MemoryHeatmapStore();
    const content = capeContent();
    const p: PlayerProfile = { handicap: 14, clubSpeedMph: 110, shotShape: 'draw' };

    const first = await getOrComputeHeatmap(store, content, p, FAST);
    expect(first.cached).toBe(false);
    expect(first.bucket).toBe('h15-s110-draw');
    expect(first.summary.contours.levels.length).toBeGreaterThan(0);
    expect(store.size).toBe(1);

    const second = await getOrComputeHeatmap(store, content, p, FAST);
    expect(second.cached).toBe(true);
    expect(second.summary.optimal.e).toBe(first.summary.optimal.e);
    expect(store.size).toBe(1);
  });

  it('shares one entry across profiles in the same bucket', async () => {
    const store = new MemoryHeatmapStore();
    const content = capeContent();
    const put = vi.spyOn(store, 'put');

    const a = await getOrComputeHeatmap(
      store,
      content,
      { handicap: 14, clubSpeedMph: 107, shotShape: 'draw' },
      FAST,
    );
    const b = await getOrComputeHeatmap(
      store,
      content,
      { handicap: 16, clubSpeedMph: 113, shotShape: 'draw' },
      FAST,
    );
    expect(a.bucket).toBe(b.bucket);
    expect(b.cached).toBe(true);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('splits entries by shot shape and by bucket boundaries', async () => {
    const store = new MemoryHeatmapStore();
    const content = capeContent();

    await getOrComputeHeatmap(
      store,
      content,
      { handicap: 14, clubSpeedMph: 110, shotShape: 'draw' },
      FAST,
    );
    const fade = await getOrComputeHeatmap(
      store,
      content,
      { handicap: 14, clubSpeedMph: 110, shotShape: 'fade' },
      FAST,
    );
    const wideBucket = await getOrComputeHeatmap(
      store,
      content,
      { handicap: 22.6, clubSpeedMph: 110, shotShape: 'draw' },
      FAST,
    );
    expect(fade.cached).toBe(false);
    expect(wideBucket.cached).toBe(false);
    expect(wideBucket.bucket).toBe('h25-s110-draw');
    expect(store.size).toBe(3);
  });

  it('survives a JSON round-trip like the DB store performs', async () => {
    const store = new MemoryHeatmapStore();
    const content = capeContent();
    const p: PlayerProfile = { handicap: 5, clubSpeedMph: 100, shotShape: 'straight' };
    const { summary } = await getOrComputeHeatmap(store, content, p, FAST);
    const revived = JSON.parse(JSON.stringify(summary));
    expect(revived.optimal.e).toBe(summary.optimal.e);
    expect(revived.contours.levels.length).toBe(summary.contours.levels.length);
  });
});
