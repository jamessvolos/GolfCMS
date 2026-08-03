/**
 * GET /api/admin/holes            — list holes for the annotate studio
 * GET /api/admin/holes?id=<slug>  — full hole + puzzles for editing
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/server/db';
import { listPuzzles } from '@/lib/server/content';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    const holes = await db.hole.findMany({
      orderBy: [{ courseName: 'asc' }, { holeNumber: 'asc' }],
      select: {
        id: true,
        courseName: true,
        holeNumber: true,
        par: true,
        yardage: true,
        _count: { select: { puzzles: true } },
      },
    });
    return NextResponse.json({
      holes: holes.map((h) => ({
        id: h.id,
        courseName: h.courseName,
        holeNumber: h.holeNumber,
        par: h.par,
        yardage: h.yardage,
        puzzleCount: h._count.puzzles,
      })),
    });
  }

  const all = await listPuzzles();
  const mine = all.filter((p) => p.hole.id === id);
  if (mine.length === 0) {
    const one = await db.hole.findUnique({ where: { id } });
    if (!one) return NextResponse.json({ error: 'unknown hole' }, { status: 404 });
    // A hole can exist without puzzles mid-annotation.
    return NextResponse.json({
      hole: {
        id: one.id,
        courseName: one.courseName,
        holeNumber: one.holeNumber,
        par: one.par,
        yardage: one.yardage,
        geojson: JSON.parse(one.geojson),
        imageryCenter: JSON.parse(one.imageryCenter),
        groundPlan: one.groundPlan,
      },
      puzzles: [],
    });
  }
  return NextResponse.json({
    hole: mine[0]!.hole,
    puzzles: mine.map(({ puzzle }) => puzzle),
  });
}
