/**
 * The one OSM import path — used by the CLI, the admin route, and the
 * tests. Fetch → assemble → derive puzzles → hand to `ingestHole`, which
 * applies the same validation, geometry gates, trap ratings and cache
 * warming that a hand-traced hole gets. There is no second way in.
 */

import { assembleHole, describeCandidate, findHoleWays, AssembleError } from './assemble';
import { derivePuzzles } from './puzzles';
import { matchedCourses, queryAround, queryCourse, runQuery } from './overpass';
import { DECISION_THRESHOLD } from './survey';
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
  /**
   * Minimum trap size a derived puzzle must carry to be shipped. Defaults
   * to DECISION_THRESHOLD; pass 0 to keep everything.
   */
  minTrap?: number;
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
  const candidates = findHoleWays(res, { holeNumber: req.holeNumber, near: req.near });
  if (!candidates.length) {
    const mapped = res.elements.filter((e) => e.tags?.golf === 'hole').length;
    if (mapped) {
      throw new AssembleError(
        `hole ${req.holeNumber} is not among the ${mapped} mapped here`,
      );
    }
    const courses = matchedCourses(res);
    throw new AssembleError(
      courses.length
        ? `${courses.length} course(s) match that name (${courses
            .map((c) => c.name)
            .join(', ')}) but none has its holes mapped — only the outline. ` +
          'Trace this one by hand.'
        : 'no golf course matches that name in OpenStreetMap — check the spelling ' +
          'as OSM has it, or use a point on the hole instead.',
    );
  }

  // More than one candidate and nothing to choose with. Refusing is the only
  // honest option: a name search spans the whole planet, and multi-course
  // venues reuse hole numbers, so "the first one" is a coin flip presented
  // as a fact.
  if (candidates.length > 1 && !req.near) {
    throw new AssembleError(
      `hole ${req.holeNumber} is ambiguous — ${candidates.length} candidates:\n` +
        candidates.map((c) => `  · ${describeCandidate(c)}`).join('\n') +
        '\nPick one by passing a point on it (--near lat,lon), or narrow the ' +
        'course name to match a single course in OpenStreetMap.',
    );
  }
  const way = candidates[0]!;

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

  const derived = derivePuzzles(input.hole, {
    ...(req.nSamples ? { nSamples: req.nSamples } : {}),
    minTrap: req.minTrap ?? DECISION_THRESHOLD,
  });
  if (!derived.puzzles.length) {
    throw new AssembleError(
      'no puzzle on this hole carries a decision — every derived position ' +
        'has the flag as its optimal aim, so the hole would award PERFECT ' +
        'for no thought. Survey the course (--survey) to find one that does.',
    );
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
