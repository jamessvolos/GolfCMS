/**
 * Import a hole from OpenStreetMap.
 *
 *   npm run content:import -- --course "Royal Birkdale" --hole 12
 *   npm run content:import -- --near 26.0,-80.1 --hole 18 --commit
 *   npm run content:import -- --file saved.json --hole 12 --course "Birkdale"
 *
 * Dry-run by default: it prints what it found, what it threw away, and the
 * derived puzzles, and writes nothing. `--commit` sends it through the same
 * ingest path a traced hole takes. `--out` writes the payload to
 * data/holes-draft/ for review instead.
 *
 * `--file` reads a saved Overpass response instead of calling the API,
 * which is how to work from a network that cannot reach Overpass: fetch the
 * query elsewhere, bring the JSON back, import from it.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AssembleError } from '@/lib/content/osm/assemble';
import {
  fetchCourse,
  previewFromResponse,
  previewImport,
  slugify,
} from '@/lib/content/osm/import';
import type { ImportRequest } from '@/lib/content/osm/import';
import { queryAround, queryCourse, OverpassError } from '@/lib/content/osm/overpass';
import type { OverpassResponse } from '@/lib/content/osm/overpass';
import { ingestHole } from '@/lib/server/ingestHole';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const holeNumber = Number(arg('hole'));
if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 18) {
  console.error('--hole <1-18> is required');
  process.exit(1);
}

const course = arg('course');
const nearRaw = arg('near');
const file = arg('file');
const near = nearRaw
  ? (() => {
      const [lat, lon] = nearRaw.split(',').map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        console.error('--near expects "lat,lon"');
        process.exit(1);
      }
      return { lat: lat!, lon: lon! };
    })()
  : undefined;

if (!course && !near && !file) {
  console.error('give --course "Name", --near lat,lon, or --file saved.json');
  process.exit(1);
}

const req: ImportRequest = {
  holeNumber,
  ...(course ? { course } : {}),
  ...(near ? { near } : {}),
  ...(arg('id') ? { id: arg('id')! } : {}),
  ...(arg('name') ? { courseName: arg('name')! } : {}),
  ...(arg('corridor') ? { corridorYds: Number(arg('corridor')) } : {}),
  ...(arg('radius') ? { radius: Number(arg('radius')) } : {}),
  ...(arg('samples') ? { nSamples: Number(arg('samples')) } : {}),
};

if (flag('query')) {
  // Print the Overpass QL and stop — for running the query by hand
  // somewhere with network access.
  console.log(course ? queryCourse(course) : queryAround(near!.lat, near!.lon, req.radius ?? 500));
  process.exit(0);
}

async function main() {
  let preview;
  if (file) {
    if (!course && !arg('name')) {
      console.error('--file also needs --course or --name for the hole’s course name');
      process.exit(1);
    }
    const res = JSON.parse(readFileSync(file, 'utf8')) as OverpassResponse;
    preview = previewFromResponse(res, req);
  } else {
    if (flag('save')) {
      const res = await fetchCourse(req);
      const path = arg('save')!;
      writeFileSync(path, `${JSON.stringify(res, null, 2)}\n`);
      console.log(`saved ${res.elements.length} elements to ${path}`);
      preview = previewFromResponse(res, req);
    } else {
      preview = await previewImport(req);
    }
  }

  const { input, measuredYards, notes } = preview;
  const h = input.hole;
  const kinds = h.polygons.reduce<Record<string, number>>((m, p) => {
    m[p.kind] = (m[p.kind] ?? 0) + 1;
    return m;
  }, {});

  console.log(`\n${h.id}  ${h.courseName} #${h.holeNumber}  par ${h.par}  ${measuredYards}y`);
  console.log(
    `  ${h.polygons.length} polygons — ${Object.entries(kinds)
      .map(([k, n]) => `${k}×${n}`)
      .join(' ')}`,
  );
  for (const p of input.puzzles) {
    console.log(`  · ${p.category.padEnd(9)} ${p.lie.padEnd(9)} ${p.description}`);
  }
  if (notes.length) {
    console.log('\n  what the importer decided:');
    for (const n of notes) console.log(`    ! ${n}`);
  }

  if (arg('out')) {
    const dir = join(process.cwd(), 'data', 'holes-draft');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${h.id}.json`);
    writeFileSync(path, `${JSON.stringify(input, null, 2)}\n`);
    console.log(`\n  written to ${path} — review it before seeding`);
  }

  if (flag('commit')) {
    const result = await ingestHole(input);
    console.log(
      `\n  committed: ${result.puzzles
        .map((p) => `${p.id} (${p.rating})`)
        .join(', ')}`,
    );
    for (const w of result.warnings) console.log(`    ! ${w}`);
  } else {
    console.log('\n  dry run — pass --commit to ingest, or --out to write a draft');
  }
}

main().catch((err) => {
  if (err instanceof OverpassError) {
    console.error(`\nOverpass: ${err.message}`);
    console.error('Tip: --query prints the query to run elsewhere, then --file imports the result.');
  } else if (err instanceof AssembleError) {
    console.error(`\nCannot import this hole: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
