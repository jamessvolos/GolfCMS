import Link from 'next/link';
import { getProfile, listPuzzles } from '@/lib/server/content';
import { profileBucket } from '@/lib/engine/profile';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const [profile, puzzles] = await Promise.all([getProfile(), listPuzzles()]);

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
        <div className="stat-caption">The folio</div>
        {puzzles.length === 0 ? (
          <div className="mt-3 rounded-folio border border-hairline bg-paper px-5 py-6">
            <p className="text-[14.5px]">No holes in the folio yet.</p>
            <p className="mono-nums mt-1 text-[13px] text-ink-soft">
              Run <code>npm run db:push && npm run db:seed</code>, then reload.
            </p>
          </div>
        ) : (
          <div className="mt-3 grid gap-3">
            {Array.from(
              puzzles
                .reduce((m, entry) => {
                  const list = m.get(entry.hole.id) ?? [];
                  list.push(entry);
                  m.set(entry.hole.id, list);
                  return m;
                }, new Map<string, typeof puzzles>())
                .values(),
            ).map((group) => {
              const hole = group[0]!.hole;
              return (
                <div
                  key={hole.id}
                  className="rounded-folio border border-hairline bg-paper px-5 py-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-display text-[21px]">
                      {hole.courseName} · No. {hole.holeNumber}
                    </span>
                    <span className="mono-nums text-[12px] text-ink-soft">
                      par {hole.par} · {hole.yardage}y
                    </span>
                  </div>
                  <div className="mt-2 grid gap-1.5">
                    {group.map(({ puzzle }) => (
                      <Link
                        key={puzzle.id}
                        href={`/puzzle/${puzzle.id}`}
                        className="group flex flex-wrap items-baseline justify-between gap-2 rounded-folio border border-transparent px-2 py-1.5 transition-colors hover:border-hairline hover:bg-[var(--sg-paper-edge)]"
                      >
                        <span className="text-[14px]">
                          <span className="folio-label mr-2 text-[12.5px] text-ink-soft">
                            {puzzle.category.toUpperCase()}
                          </span>
                          {puzzle.description}
                        </span>
                        <span className="mono-nums text-[11.5px] text-ink-soft">
                          rating {puzzle.rating}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-folio border border-hairline bg-[var(--sg-paper-edge)] px-5 py-4">
        <div>
          <div className="stat-caption">Playing as {profile.name}</div>
          <div className="mono-nums mt-1 text-[15px]">
            {profile.handicap} hcp · {profile.clubSpeedMph} mph · {profile.shotShape} · Elo{' '}
            {profile.elo}
          </div>
          <div className="mono-nums mt-0.5 text-[12px] text-ink-soft">
            scoring bucket {profileBucket(profile)}
          </div>
        </div>
        <Link
          href="/settings"
          className="grid min-h-11 place-items-center rounded-folio border border-hairline bg-paper px-5 font-ui text-[14px]"
        >
          Edit profile
        </Link>
      </section>
    </main>
  );
}
