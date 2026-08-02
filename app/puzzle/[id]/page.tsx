import Link from 'next/link';
import { notFound } from 'next/navigation';
import PuzzleScreen from '@/components/puzzle/PuzzleScreen';
import { getProfile, getPuzzleWithHole, listPuzzles } from '@/lib/server/content';

export const dynamic = 'force-dynamic';

export default async function PuzzlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [content, profile, all] = await Promise.all([
    getPuzzleWithHole(id),
    getProfile(),
    listPuzzles(),
  ]);
  if (!content) notFound();
  const { hole, puzzle } = content;
  const nextPuzzleId = all.find((p) => p.puzzle.id !== id)?.puzzle.id ?? null;

  return (
    <main className="mx-auto max-w-3xl px-5 py-8">
      <header className="mb-4">
        <div className="flex items-baseline justify-between gap-3">
          <div className="folio-eyebrow">
            <Link href="/" className="hover:text-ink">
              SG Trainer
            </Link>{' '}
            · {puzzle.category === 'tee' ? 'Tee shot' : 'Approach'}
          </div>
          <span className="mono-nums text-[12px] text-ink-soft">
            {puzzle.lie.toUpperCase()} LIE · PUZZLE {puzzle.rating}
          </span>
        </div>
        <h1 className="mt-1 font-display text-[clamp(24px,4.5vw,34px)] leading-tight">
          No. {hole.holeNumber} · {hole.courseName} · {hole.yardage}y
        </h1>
        <hr className="rule-engraved mt-3" />
      </header>

      <PuzzleScreen hole={hole} puzzle={puzzle} profile={profile} nextPuzzleId={nextPuzzleId} />
    </main>
  );
}
