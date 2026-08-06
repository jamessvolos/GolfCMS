/**
 * The rig: turn a region of the planet into playable content.
 *
 *   npm run mine -- --bbox 51.2,-0.6,51.7,0.3 --courses 6
 *   npm run mine -- --bbox 51.2,-0.6,51.7,0.3 --offline      # cache only
 *   npm run mine -- --bbox ... --out data/packs/se-england.json
 *
 * The funnel, with every stage counted and every rejection given a reason:
 *
 *   discover  bbox tiles -> golf=hole ways -> clusters of >= 9 holes
 *   assemble  one Overpass query per course, then the existing assembler
 *   draw      play each hole with the profile's own dispersion; the ball
 *             starts where a shot FINISHED, not where the optimizer aimed
 *   screen    12y/150-sample lattice, ~13x cheaper than the full grid
 *   admit     6y/600-sample grid, error bar, corridor and artefact checks
 *
 * Nothing here runs at request time and nothing runs at boot. Overpass is a
 * build-time dependency with a disk cache, so a rerun costs nothing and CI
 * never touches the network.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { assembleHole, findHoleWays } from '@/lib/content/osm/assemble';
import { cachedQuery, discoverCourses, pickNearestHoleWay } from '@/lib/content/osm/discover';
import type { Bbox, DiscoveredCourse } from '@/lib/content/osm/discover';
import { queryAround } from '@/lib/content/osm/overpass';
import { admit, REJECTION_REASONS } from '@/lib/content/generate/admit';
import type { RejectionReason } from '@/lib/content/generate/admit';
import { drawSituations } from '@/lib/content/generate/situations';
import { pinSheet } from '@/lib/content/generate/pins';
import { screen } from '@/lib/puzzle/screen';
import { prepareHole } from '@/lib/engine/hole';
import { bucketedProfile, SEED_PROFILE } from '@/lib/engine/profile';
import { holeDataFromInput } from '@/lib/server/ingestHole';
import type { IngestInput } from '@/lib/server/ingestHole';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Situations kept per hole. More than this from one hole is repetition. */
const KEEP_PER_HOLE = Number(process.env.KEEP_PER_HOLE ?? 3);
/** Flags per green offered to each situation. */
const PINS_PER_GREEN = Number(process.env.PINS ?? 3);
/** Simulated passes down each hole. */
const PASSES = Number(process.env.PASSES ?? 24);

interface Funnel {
  coursesDiscovered: number;
  coursesTried: number;
  holesAssembled: number;
  holesFailed: number;
  proposed: number;
  screenedOut: number;
  admitted: number;
  rejections: Record<RejectionReason, number>;
  assemblyErrors: Record<string, number>;
}

function emptyFunnel(): Funnel {
  const rejections = {} as Record<RejectionReason, number>;
  for (const r of REJECTION_REASONS) rejections[r] = 0;
  return {
    coursesDiscovered: 0,
    coursesTried: 0,
    holesAssembled: 0,
    holesFailed: 0,
    proposed: 0,
    screenedOut: 0,
    admitted: 0,
    rejections,
    assemblyErrors: {},
  };
}

async function mineCourse(
  course: DiscoveredCourse,
  funnel: Funnel,
  offline: boolean,
): Promise<IngestInput[]> {
  const profile = bucketedProfile(SEED_PROFILE);
  const out: IngestInput[] = [];

  let res;
  try {
    res = await cachedQuery(queryAround(course.lat, course.lon, 1400), {
      offline,
      onBackoff: (n, ms, status) =>
        console.log(`    Overpass ${status}; backing off ${(ms / 1000).toFixed(0)}s (attempt ${n})`),
    });
  } catch (err) {
    funnel.assemblyErrors[`fetch: ${(err as Error).message.slice(0, 60)}`] =
      (funnel.assemblyErrors[`fetch: ${(err as Error).message.slice(0, 60)}`] ?? 0) + 1;
    return out;
  }
  funnel.coursesTried++;

  const courseSlug = `osm-${course.id.replace(/[^0-9a-z]+/gi, '')}`;

  for (const holeNumber of course.holeNumbers) {
    const candidates = findHoleWays(res, { holeNumber });
    // The importer refuses ambiguity outright and is right to for a
    // name-scoped query. Here every candidate came back from a radius query
    // around one course, so the refusal is resolved geographically instead:
    // anything far from the centre is still refused, and among the rest the
    // longest centreline wins.
    const { chosen } = pickNearestHoleWay(candidates, { lat: course.lat, lon: course.lon });
    if (!chosen) {
      funnel.holesFailed++;
      const k = candidates.length === 0 ? 'not mapped' : `${candidates.length} candidates, none on this course`;
      funnel.assemblyErrors[k] = (funnel.assemblyErrors[k] ?? 0) + 1;
      continue;
    }

    let input: IngestInput;
    try {
      const assembled = assembleHole(res, chosen, {
        id: `${courseSlug}-${holeNumber}`,
        courseName: course.name ?? `OSM ${course.id}`,
        holeNumber,
      });
      // assembleHole returns the hole only; the miner supplies the puzzles.
      input = { ...assembled.input, puzzles: [] } as IngestInput;
    } catch (err) {
      funnel.holesFailed++;
      const k = (err as Error).message.split('\n')[0]!.slice(0, 60);
      funnel.assemblyErrors[k] = (funnel.assemblyErrors[k] ?? 0) + 1;
      continue;
    }
    funnel.holesAssembled++;

    const prepared = prepareHole(holeDataFromInput(input.hole));
    const situations = drawSituations(prepared, profile, 7777, { passes: PASSES });
    const sheet = pinSheet(prepared, 1000, { count: PINS_PER_GREEN });
    const pins = sheet.length
      ? sheet
      : [{ at: prepared.pin, zone: 'middle' as const, clearance: 0 }];

    const kept: IngestInput['puzzles'] = [];
    const usedShapes = new Set<string>();
    // The tee is situation zero of every pass, so it wins any quota that is
    // filled in order: an early run kept 156 tee shots against 8 fairway,
    // 16 rough and 2 sand across 65 holes. Cap it, and spend the rest of
    // the quota on the shots the old derivation could never produce.
    let teeKept = 0;

    for (const s of situations) {
      if (kept.length >= KEEP_PER_HOLE) break;
      if (s.category === 'tee' && teeKept >= 1) continue;
      for (const pin of pins) {
        if (kept.length >= KEEP_PER_HOLE) break;
        // The cap has to be re-checked inside the pin loop: one tee
        // situation offered three flags will otherwise fill the whole hole
        // quota by itself before the outer guard is ever re-evaluated.
        if (s.category === 'tee' && teeKept >= 1) break;
        // One situation per (category, flag) per hole. Fifteen approaches
        // from one fairway to one flag is one puzzle fifteen times.
        const shape = `${s.category}:${s.lie}:${pin.zone}`;
        if (usedShapes.has(shape)) continue;

        funnel.proposed++;
        const sc = screen(
          prepared,
          { ball: s.ball, pin: pin.at, lie: s.lie },
          profile,
          s.category,
        );
        if (!sc.passed) {
          funnel.screenedOut++;
          continue;
        }
        const verdict = admit(prepared, s, pin.at, pin.zone, profile);
        if (verdict.rejected) {
          funnel.rejections[verdict.rejected.reason]++;
          continue;
        }
        usedShapes.add(shape);
        if (s.category === 'tee') teeKept++;
        funnel.admitted++;

        const a = verdict.admitted;
        kept.push({
          id: `${input.hole.id}-${s.category}-${s.shotIndex}-${pin.zone}`.toLowerCase(),
          ball: prepared.toLonLat(s.ball),
          lie: s.lie,
          category: s.category,
          pin: prepared.toLonLat(pin.at),
          description:
            `${s.category === 'tee' ? 'Tee shot' : `${s.category[0]!.toUpperCase()}${s.category.slice(1)} from the ${s.lie}`}, ` +
            `${s.toPin} yards to a flag ${pin.zone.replace('-', ' ')}.`,
          // Measured here at full sampling, so the container does not have
          // to recompute a grid per puzzle just to learn its rating. This is
          // content, like the geometry — `content:audit` re-derives it.
          stats: {
            trapSize: round4(a.trapSize),
            trapSe: round4(a.trapSe),
            consequence: round4(a.consequence),
            asymmetry: round4(a.asymmetry),
            holds: a.holds,
            rating: a.rating,
          },
        });
      }
    }

    if (kept.length) out.push({ ...input, puzzles: kept });
  }

  return out;
}

async function main(): Promise<void> {
  const bboxRaw = arg('bbox');
  if (!bboxRaw) {
    console.error('usage: npm run mine -- --bbox south,west,north,east [--courses N] [--offline] [--out path]');
    process.exitCode = 1;
    return;
  }
  const [south, west, north, east] = bboxRaw.split(',').map(Number);
  if ([south, west, north, east].some((n) => !Number.isFinite(n))) {
    console.error('--bbox expects south,west,north,east');
    process.exitCode = 1;
    return;
  }
  const region: Bbox = { south: south!, west: west!, north: north!, east: east! };
  const offline = flag('offline');
  const limit = Number(arg('courses') ?? 4);
  const outPath = arg('out');

  const funnel = emptyFunnel();

  console.log(`discovering courses in ${bboxRaw}${offline ? ' (cache only)' : ''}…`);
  const courses = await discoverCourses(region, {
    offline,
    onTile: (i, n, found) => console.log(`  tile ${i}/${n}: ${found} hole ways`),
  });
  funnel.coursesDiscovered = courses.length;
  console.log(`  ${courses.length} courses with ≥9 mapped holes`);

  // Best-mapped first: par-tagged holes are a decent proxy for a course
  // someone actually surveyed rather than sketched.
  const chosen = [...courses]
    .sort((a, b) => b.parTagged - a.parTagged || b.holeNumbers.length - a.holeNumbers.length)
    .slice(0, limit);

  const holes: IngestInput[] = [];
  for (const [i, course] of chosen.entries()) {
    console.log(`\n[${i + 1}/${chosen.length}] ${course.name ?? course.id} — ${course.holeNumbers.length} holes`);
    const mined = await mineCourse(course, funnel, offline);
    for (const h of mined) {
      console.log(`    ✓ ${h.hole.id} par ${h.hole.par} — ${h.puzzles.length} situation(s)`);
    }
    holes.push(...mined);
  }

  console.log('\n── funnel ─────────────────────────────────');
  console.log(`  courses discovered   ${funnel.coursesDiscovered}`);
  console.log(`  courses fetched      ${funnel.coursesTried}`);
  console.log(`  holes assembled      ${funnel.holesAssembled}`);
  console.log(`  holes refused        ${funnel.holesFailed}`);
  for (const [k, n] of Object.entries(funnel.assemblyErrors).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(4)}  ${k}`);
  }
  console.log(`  situations proposed  ${funnel.proposed}`);
  console.log(`  screened out         ${funnel.screenedOut}`);
  for (const [k, n] of Object.entries(funnel.rejections)) {
    if (n) console.log(`      ${String(n).padStart(4)}  rejected: ${k}`);
  }
  console.log(`  ADMITTED             ${funnel.admitted}  across ${holes.length} holes`);

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(holes, null, 2)}\n`);
    console.log(`\nwrote ${holes.length} holes to ${outPath}`);
  } else {
    console.log('\nno --out given, nothing written');
  }
}

main();
