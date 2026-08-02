/**
 * POST /api/admin/hole — ingest an annotated hole + its puzzles.
 * v1 has no auth (single local player); the route validates hard and the
 * engine sanity-checks the geometry before anything persists.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ingestHole, ingestSchema } from '@/lib/server/ingestHole';

export async function POST(req: NextRequest) {
  const parsed = ingestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json(
      { error: `invalid annotation — ${issue?.path.join('.')}: ${issue?.message}` },
      { status: 400 },
    );
  }
  try {
    const result = await ingestHole(parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'ingest failed' },
      { status: 422 },
    );
  }
}
