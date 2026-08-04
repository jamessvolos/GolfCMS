/**
 * The one OSM import path — used by the CLI, the admin route, and the
 * tests. Fetch → assemble → derive puzzles → hand to `ingestHole`, which
 * applies the same validation, geometry gates, trap ratings and cache
 * warming that a hand-traced hole gets. There is no second way in.
 */

import { assembleHole, findHoleWay, AssembleError } from './assemble';
import { derivePuzzles } from './puzzles';
import { queryAround, queryCourse, runQuery } from './overpass';
import type { OverpassResponse } from './overpass';
import { ingestHole, ingestSchema } from '@/lib/server/ingestHole';
import type { IngestInput, IngestResult } from '@/lib/server/ingestHole';

export interface ImportRequest {
  /** Course name to search, e.g. "Royal Birkdale". */
  course?: string;
  /** Or a point on the hole, when the course name is ambiguous or unmapped. */
  near?: { lat: number; lon: number };
  holeNumber: number;
  /** Slug override; defaults to a slug of the course plus the hole number. */
  id?: string;
  /** Display name; defaults to whatever `course` was searched for. */
  courseName?: string;
  corridorYds?: number;
  /** Search radius in metres when using `near`. */
  radius?: number;
  /** Monte Carlo samples for puzzle derivation. Lower is faster, coarser. */
  nSamples?: number;
}

export interface ImportPreview {
  input: IngestInput;
  measuredYards: number;
  /** Everything the importer decided or discarded, in order. */
  notes: string[];
}

export function slugify(course: string, holeNumber: number): string {
  const base = course
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 34);
  return `${base || 'course'}-${holeNumber}`;
}

/** Fetch the raw Overpass payload for a request. */
export async function fetchCourse(req: ImportRequest): Promise<OverpassResponse> {
  if (req.course) return runQuery(queryCourse(req.course));
  if (req.near) return runQuery(queryAround(req.near.lat, req.near.lon, req.radius ?? 500));
  throw new AssembleError('give either a course name or a point near the hole');
}

/**
 * Everything up to but not including the database write, so a caller can
 * show the result before committing it. Pure given a response, which is
 * what makes it testable without Overpass.
 */
export function previewFromResponse(res: OverpassResponse, req: ImportRequest): ImportPreview {
  const way = findHoleWay(res, { holeNumber: req.holeNumber, near: req.near });
  if (!way) {
    const mapped = res.elements.filter((e) => e.tags?.golf === 'hole').length;
    throw new AssembleError(
      mapped
        ? `hole ${req.holeNumber} is not among the ${mapped} mapped on this course`
        : 'no golf=hole centrelines are mapped here — the course cannot be imported',
    );
  }

  const courseName = req.courseName ?? req.course ?? 'Unknown course';
  const { input, measuredYards, notes } = assembleHole(res, way, {
    id: req.id ?? slugify(courseName, req.holeNumber),
    courseName,
    holeNumber: req.holeNumber,
    ...(req.corridorYds ? { corridorYds: req.corridorYds } : {}),
  });

  // Mark provenance before anything else sees the hole: it is what makes
  // the map render the ODbL credit this data is licensed under.
  input.hole.source = 'osm';

  const derived = derivePuzzles(input.hole, req.nSamples ? { nSamples: req.nSamples } : {});
  if (!derived.puzzles.length) {
    throw new AssembleError('no playable puzzle could be derived for this hole');
  }

  const full = { ...input, puzzles: derived.puzzles };
  const parsed = ingestSchema.safeParse(full);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AssembleError(
      `the imported hole does not satisfy the ingest schema — ${issue?.path.join('.')}: ${issue?.message}`,
    );
  }

  return { input: parsed.data, measuredYards, notes: [...notes, ...derived.notes] };
}

export async function previewImport(req: ImportRequest): Promise<ImportPreview> {
  return previewFromResponse(await fetchCourse(req), req);
}

/** Preview, then commit through the shared ingest path. */
export async function importHole(
  req: ImportRequest,
): Promise<ImportPreview & { result: IngestResult }> {
  const preview = await previewImport(req);
  const result = await ingestHole(preview.input);
  return { ...preview, result };
}
