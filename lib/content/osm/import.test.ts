import { describe, expect, it } from 'vitest';
import { previewFromResponse, slugify } from './import';
import { isLocal } from './overpass';
import { AssembleError } from './assemble';
import {
  collidingCourses,
  loadHole,
  MESSY_COURSE,
  OUTLINE_ONLY,
  overpassFromHole,
} from './fixtures';
import { holeDataFromInput } from '@/lib/server/ingestHole';
import { classifyPoint, prepareHole } from '@/lib/engine/hole';

// Assembly tests care about geometry, not selection, so they keep every
// derived puzzle. MESSY_COURSE is a wide-open synthetic hole with no
// decision in it, which the default threshold correctly refuses.
const FAST = { nSamples: 120, minTrap: 0 };

describe('slugify', () => {
  it('makes a schema-legal id from a course name', () => {
    expect(slugify('Royal Birkdale', 12)).toBe('royal-birkdale-12');
    expect(slugify("St. Andrews — Old Course", 17)).toBe('st-andrews-old-course-17');
    expect(slugify('', 1)).toBe('course-1');
  });
});

describe('local endpoint detection', () => {
  it('treats loopback and private ranges as local', () => {
    // A self-hosted Overpass behind an egress proxy is unreachable, and the
    // failure reads as "Overpass is down" rather than "wrongly proxied".
    expect(isLocal('http://127.0.0.1:4545/api/interpreter')).toBe(true);
    expect(isLocal('http://localhost:12345/')).toBe(true);
    expect(isLocal('http://10.1.2.3/api')).toBe(true);
    expect(isLocal('http://192.168.0.9/api')).toBe(true);
    expect(isLocal('http://172.20.0.4/api')).toBe(true);
  });

  it('treats public hosts as remote', () => {
    expect(isLocal('https://overpass-api.de/api/interpreter')).toBe(false);
    expect(isLocal('https://overpass.kumi.systems/api/interpreter')).toBe(false);
    // 172.32 is outside the private block.
    expect(isLocal('http://172.32.0.1/api')).toBe(false);
    expect(isLocal('not a url')).toBe(false);
  });
});

describe('previewFromResponse', () => {
  it('assembles a complete, schema-valid hole with puzzles', () => {
    const preview = previewFromResponse(MESSY_COURSE, {
      holeNumber: 7,
      course: 'Messy Links',
      ...FAST,
    });
    expect(preview.input.hole.id).toBe('messy-links-7');
    expect(preview.input.puzzles.length).toBeGreaterThan(0);
    expect(preview.notes.length).toBeGreaterThan(0);
  });

  it('refuses a hole number the course does not have, and says how many it does', () => {
    expect(() =>
      previewFromResponse(MESSY_COURSE, { holeNumber: 9, course: 'Messy Links', ...FAST }),
    ).toThrow(/not among the 1 mapped/);
  });

  it('refuses a course with no mapped hole centrelines', () => {
    const noHoles = { elements: MESSY_COURSE.elements.filter((e) => e.tags?.golf !== 'hole') };
    expect(() =>
      previewFromResponse(noHoles, { holeNumber: 7, course: 'Messy Links', ...FAST }),
    ).toThrow(AssembleError);
  });

  it('refuses a course mapped without greens rather than inventing one', () => {
    const noGreens = { elements: MESSY_COURSE.elements.filter((e) => e.tags?.golf !== 'green') };
    expect(() =>
      previewFromResponse(noGreens, { holeNumber: 7, course: 'Messy Links', ...FAST }),
    ).toThrow(/no green mapped/);
  });

  it('is deterministic — the same payload imports identically', () => {
    const req = { holeNumber: 7, course: 'Messy Links', ...FAST };
    const a = previewFromResponse(MESSY_COURSE, req);
    const b = previewFromResponse(MESSY_COURSE, req);
    expect(JSON.stringify(b.input)).toBe(JSON.stringify(a.input));
  });

  it('survives the JSON round trip the API and data/holes both perform', () => {
    const preview = previewFromResponse(MESSY_COURSE, {
      holeNumber: 7,
      course: 'Messy Links',
      ...FAST,
    });
    const revived = JSON.parse(JSON.stringify(preview.input));
    const before = prepareHole(holeDataFromInput(preview.input.hole));
    const after = prepareHole(holeDataFromInput(revived.hole));
    // The island must still be dry land on the other side of the trip.
    const lake = revived.hole.polygons.find((p: { kind: string }) => p.kind === 'water');
    expect(lake.holes).toHaveLength(1);
    const island = lake.holes[0] as [number, number][];
    const cx = island.reduce((s, [lon]) => s + lon, 0) / island.length;
    const cy = island.reduce((s, [, lat]) => s + lat, 0) / island.length;
    expect(classifyPoint(after, after.toLocal({ lon: cx, lat: cy }))).toBe(
      classifyPoint(before, before.toLocal({ lon: cx, lat: cy })),
    );
  });

  it('refuses an ambiguous hole rather than guessing a continent', () => {
    const colliding = collidingCourses(MESSY_COURSE);
    let err: Error | undefined;
    try {
      previewFromResponse(colliding, { holeNumber: 7, course: 'Messy Links', ...FAST });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(AssembleError);
    // The message has to be actionable: which candidates, and where they are.
    expect(err!.message).toMatch(/ambiguous — 2 candidates/);
    expect(err!.message).toMatch(/Impostor/);
    expect(err!.message).toMatch(/--near/);
  });

  it('resolves the ambiguity when given a point on the intended hole', () => {
    const colliding = collidingCourses(MESSY_COURSE);
    const preview = previewFromResponse(colliding, {
      holeNumber: 7,
      course: 'Messy Links',
      near: { lat: 26.0, lon: -80.0 },
      ...FAST,
    });
    // The real hole is a 400y par 4; the impostor is 23° of latitude away.
    expect(preview.measuredYards).toBeGreaterThan(390);
    expect(preview.notes.join(' ')).not.toMatch(/Impostor/);
  });

  it('tells an unmapped course apart from an unknown one', () => {
    expect(() =>
      previewFromResponse(OUTLINE_ONLY, { holeNumber: 1, course: 'Sketchy Park', ...FAST }),
    ).toThrow(/none has its holes mapped/);

    expect(() =>
      previewFromResponse({ elements: [] }, { holeNumber: 1, course: 'Nowhere GC', ...FAST }),
    ).toThrow(/no golf course matches that name/);
  });

  it('refuses a hole with no decision in it', () => {
    // MESSY_COURSE is 400 yards of open ground: aiming at the flag is
    // already optimal, so every band would be PERFECT for no thought.
    expect(() =>
      previewFromResponse(MESSY_COURSE, { holeNumber: 7, course: 'Messy Links', nSamples: 120 }),
    ).toThrow(/no puzzle on this hole carries a decision/);
  });

  it('drops the flat puzzles on a hole that has a good one', () => {
    // Same hole, but with a threshold low enough that the tee puzzle
    // survives and anything derived after it does not.
    const preview = previewFromResponse(MESSY_COURSE, {
      holeNumber: 7,
      course: 'Messy Links',
      nSamples: 120,
      minTrap: 0,
    });
    const filtered = previewFromResponse(MESSY_COURSE, {
      holeNumber: 7,
      course: 'Messy Links',
      nSamples: 120,
      minTrap: 0.0001,
    });
    expect(filtered.input.puzzles.length).toBeLessThanOrEqual(preview.input.puzzles.length);
    // Ids renumber after dropping, so a hole never ships with a gap.
    filtered.input.puzzles.forEach((p, i) => {
      expect(p.id).toBe(`${filtered.input.hole.id}-${p.category}-${i + 1}`);
    });
  });

  it('names the hole from an explicit id when one is given', () => {
    const res = overpassFromHole(loadHole('sawgrass-17'));
    const preview = previewFromResponse(res, {
      holeNumber: 17,
      course: 'TPC Sawgrass',
      id: 'sawgrass-17-osm',
      ...FAST,
    });
    expect(preview.input.hole.id).toBe('sawgrass-17-osm');
  });
});
