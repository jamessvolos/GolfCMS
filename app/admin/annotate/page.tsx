import Link from 'next/link';
import AnnotateStudio from '@/components/admin/AnnotateStudio';

export const dynamic = 'force-dynamic';

export default function AnnotatePage() {
  return (
    <main className="mx-auto max-w-[1400px] px-5 py-6">
      <header className="mb-4">
        <div className="folio-eyebrow">
          <Link href="/" className="hover:text-ink">
            SG Trainer
          </Link>{' '}
          · Annotation studio
        </div>
        <h1 className="mt-1 font-display text-[clamp(22px,3.5vw,30px)] leading-tight">
          Survey a hole
        </h1>
        <p className="mt-1 max-w-[75ch] text-[13.5px] text-ink-soft">
          Trace the features over imagery — fairway, green, bunkers, water, trees, O.B. — place
          the pin and tees, define up to four puzzles, and save. Ratings and heatmaps are
          computed on save. Anything untraced plays as rough.
        </p>
        <hr className="rule-engraved mt-3" />
      </header>
      <AnnotateStudio />
    </main>
  );
}
