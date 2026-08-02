import Link from 'next/link';
import { getHole, listPuzzles } from '@/lib/content/holes';
import { SEED_PROFILE } from '@/lib/engine/profile';

export default function Home() {
  const hole = getHole();
  const puzzles = listPuzzles();

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <header>
        <div className="folio-eyebrow">SG Trainer · course management, trained like tactics</div>
        <h1 className="mt-2 font-display text-[clamp(34px,6vw,52px)] leading-[1.08] [text-wrap:balance]">
          Where would you aim?
        </h1>
        <hr className="rule-engraved mt-4" />
        <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-ink-soft">
          A puzzle is a real hole, a ball, and a lie. Drop a pin where you would aim; the engine
          scores your target in expected strokes against the optimal aim for your own dispersion —
          then draws the field so you can see why the optimal target is optimal.
        </p>
      </header>

      <section className="mt-10">
        <div className="stat-caption">Today&rsquo;s plates</div>
        <div className="mt-3 grid gap-3">
          {puzzles.map((p, i) => (
            <Link
              key={p.id}
              href={`/puzzle/${p.id}`}
              className="group rounded-folio border border-hairline bg-paper px-5 py-4 transition-colors hover:border-ink"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-[22px]">
                  {i === 0 ? 'Plate I' : 'Plate II'} — {hole.courseName} No. {hole.holeNumber}
                </span>
                <span className="mono-nums text-[12px] text-ink-soft">
                  par {hole.par} · {hole.yardage}y · {p.category.toUpperCase()}
                </span>
              </div>
              <p className="mt-1 text-[14px] text-ink-soft">{p.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-10 rounded-folio border border-hairline bg-[var(--sg-paper-edge)] px-5 py-4">
        <div className="stat-caption">Playing as</div>
        <div className="mono-nums mt-1 text-[15px]">
          {SEED_PROFILE.handicap} handicap · {SEED_PROFILE.clubSpeedMph} mph ·{' '}
          {SEED_PROFILE.shotShape}
        </div>
        <p className="mt-1 text-[13px] text-ink-soft">
          Your own profile — handicap, club speed, shot shape — arrives in Milestone 3.
        </p>
      </section>
    </main>
  );
}
