import { describe, expect, it } from 'vitest';
import { assembleHole, findHoleWay } from './assemble';
import { MESSY_COURSE, loadHole, overpassFromHole } from './fixtures';
import { derivePuzzles } from './puzzles';
import {
  kindForTags,
  parFromYards,
  parseDistanceTag,
  parseParTag,
  waterwayHalfWidthYds,
} from './tags';
import { classifyPoint, prepareHole } from '@/lib/engine/hole';
import { dist } from '@/lib/engine/projection';
import { holeDataFromInput, ingestSchema } from '@/lib/server/ingestHole';

describe('tag rules', () => {
  it('prefers explicit golf tagging over generic landcover', () => {
    expect(kindForTags({ golf: 'water_hazard', natural: 'water' })).toBe('water');
    expect(kindForTags({ golf: 'green' })).toBe('green');
    expect(kindForTags({ natural: 'wood', golf: 'rough' })).toBe('recovery');
  });

  it('leaves rough and tee boxes unclassified', () => {
    // Rough is what the engine assumes for unmapped ground; a tee box is a
    // start position, not a lie.
    expect(kindForTags({ golf: 'rough' })).toBeNull();
    expect(kindForTags({ golf: 'tee' })).toBeNull();
  });

  it('rejects tagging that would put a hazard on a building or a pool', () => {
    expect(kindForTags({ building: 'yes', natural: 'water' })).toBeNull();
    expect(kindForTags({ leisure: 'swimming_pool', natural: 'water' })).toBeNull();
    expect(kindForTags({ golf: 'cartpath' })).toBeNull();
  });

  it('reads the distance tag without trusting its unit', () => {
    expect(parseDistanceTag('420 yd')).toEqual({ yards: 420, unit: 'yd' });
    expect(parseDistanceTag('366 m')!.yards).toBeCloseTo(400.3, 0);
    expect(parseDistanceTag('366')).toEqual({ yards: 366, unit: 'unknown' });
    expect(parseDistanceTag('about a par 4')).toBeNull();
  });

  it('treats a waterway centreline as water, and sizes it', () => {
    // The Barry Burn at Carnoustie is `waterway=river` on a LINE. Before
    // this the 18th imported with no water at all — every sentence the
    // engine generated was true of a hole that does not exist.
    expect(kindForTags({ waterway: 'river', name: 'Barry Burn' })).toBe('water');
    expect(waterwayHalfWidthYds({ waterway: 'river' })).toBe(4);
    expect(waterwayHalfWidthYds({ waterway: 'ditch' })).toBe(1);
    // A mapped width is in metres and wins over the default.
    expect(waterwayHalfWidthYds({ waterway: 'stream', width: '6' })).toBeCloseTo(3.28, 2);
    expect(waterwayHalfWidthYds({ waterway: 'stream', width: 'wide' })).toBe(1.5);
    expect(waterwayHalfWidthYds({ natural: 'water' })).toBeNull();
  });

  it('ignores a culverted burn, which runs under the hole', () => {
    expect(kindForTags({ waterway: 'river', tunnel: 'culvert' })).toBeNull();
    expect(kindForTags({ waterway: 'stream', covered: 'yes' })).toBeNull();
  });

  it('only accepts a plausible par', () => {
    expect(parseParTag('4')).toBe(4);
    expect(parseParTag('7')).toBeNull();
    expect(parseParTag(undefined)).toBeNull();
    expect(parFromYards(150)).toBe(3);
    expect(parFromYards(420)).toBe(4);
    expect(parFromYards(540)).toBe(5);
  });
});

describe('assembling a traced hole re-expressed as OSM', () => {
  const source = loadHole('pebble-18');
  const res = overpassFromHole(source);

  it('finds the hole way by its ref', () => {
    const way = findHoleWay(res, { holeNumber: source.hole.holeNumber });
    expect(way).not.toBeNull();
    expect(way!.tags!.golf).toBe('hole');
  });

  it('reconstructs a hole the ingest schema accepts', () => {
    const way = findHoleWay(res, { holeNumber: 18 })!;
    const { input, measuredYards } = assembleHole(res, way, {
      id: 'osm-pebble-18',
      courseName: 'Pebble Beach',
      holeNumber: 18,
    });

    // The schema is the contract every other ingest path goes through.
    const parsed = ingestSchema.safeParse({
      ...input,
      puzzles: [
        {
          ball: input.hole.tees[0]!,
          lie: 'tee',
          category: 'tee',
          description: 'Tee shot.',
        },
      ],
    });
    expect(parsed.success).toBe(true);

    // Same hole, so the same length within rounding of the tee-box centre.
    expect(measuredYards).toBeGreaterThan(source.hole.yardage! - 25);
    expect(measuredYards).toBeLessThan(source.hole.yardage! + 25);
    expect(input.hole.par).toBe(source.hole.par);
  });

  it('places a pin the engine classifies as green', () => {
    const way = findHoleWay(res, { holeNumber: 18 })!;
    const { input } = assembleHole(res, way, {
      id: 'osm-pebble-18',
      courseName: 'Pebble Beach',
      holeNumber: 18,
    });
    const prepared = prepareHole(holeDataFromInput(input.hole));
    // The pin gate in ingestHole rejects anything else outright.
    expect(classifyPoint(prepared, prepared.pin)).toBe('green');
  });

  it('keeps the hazards that made the original hole worth playing', () => {
    const way = findHoleWay(res, { holeNumber: 18 })!;
    const { input } = assembleHole(res, way, {
      id: 'osm-pebble-18',
      courseName: 'Pebble Beach',
      holeNumber: 18,
    });
    const kinds = input.hole.polygons.map((p) => p.kind);
    expect(kinds).toContain('green');
    expect(kinds).toContain('fairway');
    expect(kinds).toContain('water');
    expect(kinds.filter((k) => k === 'bunker').length).toBeGreaterThan(0);
  });
});

describe('assembling a badly mapped course', () => {
  const way = findHoleWay(MESSY_COURSE, { holeNumber: 7 })!;
  const result = assembleHole(MESSY_COURSE, way, {
    id: 'messy-07',
    courseName: 'Messy Links',
    holeNumber: 7,
  });

  it('detects and corrects a centreline mapped green→tee', () => {
    expect(result.notes.join(' ')).toMatch(/reversed/);
    // Tee first: the last point must be the one next to the green.
    const last = result.centreline[result.centreline.length - 1]!;
    expect(last.lat).toBeGreaterThan(result.centreline[0]!.lat);
  });

  it('stitches a fragmented multipolygon into one closed ring with its island', () => {
    const lake = result.input.hole.polygons.find((p) => p.kind === 'water');
    expect(lake).toBeDefined();
    // Two open fragments became one closed outer ring, not two slivers.
    expect(result.input.hole.polygons.filter((p) => p.kind === 'water')).toHaveLength(1);
    expect(lake!.ring[0]).toEqual(lake!.ring[lake!.ring.length - 1]);
    expect(lake!.holes).toHaveLength(1);
  });

  it('drops the cart path, the clubhouse, and the swimming pool', () => {
    // All three sit inside the corridor and would otherwise be hazards.
    expect(result.input.hole.polygons).toHaveLength(4); // green, fairway, bunker, lake
    const named = result.input.hole.polygons.map((p) => `${p.kind}:${p.name ?? ''}`);
    expect(named).toContain('bunker:Front left');
  });

  it('drops the neighbouring hole’s bunker', () => {
    expect(result.notes.join(' ')).toMatch(/fell outside the .*corridor/);
  });

  it('places the pin inside the green when no pin node is mapped', () => {
    expect(result.notes.join(' ')).toMatch(/no golf=pin node/);
    const prepared = prepareHole(holeDataFromInput(result.input.hole));
    expect(classifyPoint(prepared, prepared.pin)).toBe('green');
  });

  it('does not trust a metric dist tag', () => {
    // dist=366 is metres (400y). Read as yards it is 34y short, so the
    // measured geometry must win and the discrepancy must be reported.
    expect(result.measuredYards).toBeGreaterThan(390);
    expect(result.notes.join(' ')).toMatch(/probably metres/);
  });

  it('stays quiet when a yardage tag agrees with the geometry', () => {
    // The gate must be able to pass, not only to fire — a warning that is
    // always on is the same as no warning.
    const source = loadHole('pebble-18');
    const res = overpassFromHole(source); // emits dist in yards
    const way = findHoleWay(res, { holeNumber: 18 })!;
    const { notes } = assembleHole(res, way, {
      id: 'osm-pebble-18',
      courseName: 'Pebble Beach',
      holeNumber: 18,
    });
    expect(notes.join(' ')).not.toMatch(/probably metres|dist says/);
  });

  it('honours the island when classifying', () => {
    const prepared = prepareHole(holeDataFromInput(result.input.hole));
    const lake = result.input.hole.polygons.find((p) => p.kind === 'water')!;
    const island = lake.holes![0]!;
    const cx = island.reduce((s, [lon]) => s + lon, 0) / island.length;
    const cy = island.reduce((s, [, lat]) => s + lat, 0) / island.length;
    // Inside the island: dry land, not water.
    expect(classifyPoint(prepared, prepared.toLocal({ lon: cx, lat: cy }))).not.toBe('water');
    // Inside the lake but outside the island: water.
    const inLake = prepared.toLocal({ lon: lake.ring[0]![0]! + 0.00002, lat: lake.ring[0]![1]! + 0.00002 });
    expect(classifyPoint(prepared, inLake)).toBe('water');
  });
});

describe('deriving puzzles with the engine', () => {
  const FAST = { nSamples: 120 };

  it('walks a par 4 from the tee to an approach on playable ground', () => {
    const way = findHoleWay(MESSY_COURSE, { holeNumber: 7 })!;
    const { input } = assembleHole(MESSY_COURSE, way, {
      id: 'messy-07',
      courseName: 'Messy Links',
      holeNumber: 7,
    });
    const { puzzles } = derivePuzzles(input.hole, FAST);

    expect(puzzles.map((p) => p.category)).toEqual(['tee', 'approach']);
    const prepared = prepareHole(holeDataFromInput(input.hole));
    for (const p of puzzles) {
      const lie = classifyPoint(prepared, prepared.toLocal(p.ball));
      // The ingest gate rejects a ball in water or out of bounds.
      expect(['fairway', 'rough', 'sand', 'recovery']).toContain(lie);
    }
    // The approach must actually be closer than the tee.
    const d = puzzles.map((p) => dist(prepared.toLocal(p.ball), prepared.pin));
    expect(d[1]!).toBeLessThan(d[0]!);
  });

  it('gives a par 3 a tee puzzle and nothing else', () => {
    const source = loadHole('sawgrass-17');
    const res = overpassFromHole(source);
    const way = findHoleWay(res, { holeNumber: source.hole.holeNumber })!;
    const { input } = assembleHole(res, way, {
      id: 'osm-sawgrass-17',
      courseName: 'TPC Sawgrass',
      holeNumber: 17,
    });
    const { puzzles } = derivePuzzles(input.hole, FAST);
    expect(puzzles).toHaveLength(1);
    expect(puzzles[0]!.category).toBe('tee');
  });

  it('adds a lay-up on a long par 5', () => {
    const source = loadHole('pebble-18');
    const res = overpassFromHole(source);
    const way = findHoleWay(res, { holeNumber: 18 })!;
    const { input } = assembleHole(res, way, {
      id: 'osm-pebble-18',
      courseName: 'Pebble Beach',
      holeNumber: 18,
    });
    const { puzzles } = derivePuzzles(input.hole, FAST);
    expect(puzzles.map((p) => p.category)).toContain('layup');
    expect(puzzles.length).toBeGreaterThanOrEqual(2);
  });

  it('produces puzzles the ingest schema accepts', () => {
    const way = findHoleWay(MESSY_COURSE, { holeNumber: 7 })!;
    const { input } = assembleHole(MESSY_COURSE, way, {
      id: 'messy-07',
      courseName: 'Messy Links',
      holeNumber: 7,
    });
    const { puzzles } = derivePuzzles(input.hole, FAST);
    expect(ingestSchema.safeParse({ ...input, puzzles }).success).toBe(true);
  });
});
