/**
 * POST /api/admin/import — pull a hole from OpenStreetMap.
 *
 * `?preview=1` assembles and returns the hole without writing anything, so
 * the studio can show what would be imported (and what the importer threw
 * away) before it commits. Without it the hole goes through the same
 * `ingestHole` path a traced hole does.
 *
 * v1 has no auth, in line with the rest of /api/admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AssembleError } from '@/lib/content/osm/assemble';
import { OverpassError } from '@/lib/content/osm/overpass';
import { importHole, previewImport } from '@/lib/content/osm/import';

export const dynamic = 'force-dynamic';
/** Overpass is slow and the engine derives puzzles; well past the default. */
export const maxDuration = 120;

const schema = z
  .object({
    course: z.string().trim().min(2).max(80).optional(),
    near: z
      .object({ lat: z.number().min(-85).max(85), lon: z.number().min(-180).max(180) })
      .optional(),
    holeNumber: z.number().int().min(1).max(18),
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,40}$/)
      .optional(),
    courseName: z.string().trim().min(1).max(60).optional(),
    corridorYds: z.number().int().min(30).max(300).optional(),
    radius: z.number().int().min(100).max(5000).optional(),
    nSamples: z.number().int().min(50).max(2000).optional(),
  })
  .refine((v) => v.course || v.near, {
    message: 'give either a course name or a point near the hole',
  });

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `invalid request — ${issue?.path.join('.') || 'body'}: ${issue?.message}` },
      { status: 400 },
    );
  }

  const preview = req.nextUrl.searchParams.get('preview') === '1';
  try {
    const out = preview
      ? { ...(await previewImport(parsed.data)), committed: false }
      : { ...(await importHole(parsed.data)), committed: true };
    return NextResponse.json(out);
  } catch (err) {
    // An unreachable or rate-limited Overpass is not the caller's fault and
    // is worth retrying; a hole that cannot be assembled is not.
    if (err instanceof OverpassError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    if (err instanceof AssembleError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'import failed' },
      { status: 500 },
    );
  }
}
