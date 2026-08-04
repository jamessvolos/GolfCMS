import Link from 'next/link';
import { getProgress } from '@/lib/server/progress';
import Sparkline from '@/components/progress/Sparkline';
import TallyStreak from '@/components/progress/TallyStreak';
import { bandStamp } from '@/lib/design/tokens';
import type { Band } from '@/lib/progress/xp';

export const dynamic = 'force-dynamic';

const BAND_ORDER: Band[] = ['perfect', 'good', 'okay', 'miss'];
const CATEGORY_LABEL: Record<string, string> = {
  tee: 'Tee shots',
  approach: 'Approaches',
  layup: 'Layups',
  recovery: 'Recovery',
};

export default async function SummaryPage() {
  const p = await getProgress();
  const played = p.totals.attempts > 0;
  const session = p.session;
  const sessionSg = session.length
    ? session.reduce((s, a) => s + a.sgLoss, 0) / session.length
    : 0;
  const sessionElo = session.reduce((s, a) => s + a.eloDelta, 0);
  const sessionXp = session.reduce((s, a) => s + a.xpGained, 0);

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <header>
        <div className="folio-eyebrow">
          <Link href="/" className="hover:text-ink">
            SG Trainer
          </Link>{' '}
          · Session summary
        </div>
        <h1 className="mt-2 font-display text-[clamp(30px,5.5vw,44px)] leading-[1.1] [text-wrap:balance]">
          {played ? 'The card so far' : 'Nothing on the card yet'}
        </h1>
        <hr className="rule-engraved mt-4" />
      </header>

      {!played ? (
        <section className="mt-6">
          <p className="max-w-[60ch] text-[15px] leading-relaxed text-ink-soft">
            Play a puzzle and this page fills in: your rating line, the bands you earned, and
            which kind of shot is costing you strokes.
          </p>
          <Link
            href="/play"
            className="mt-5 inline-grid min-h-12 place-items-center rounded-folio bg-ink px-6 font-ui text-[14px] text-paper"
          >
            Play a puzzle →
          </Link>
        </section>
      ) : (
        <>
          <section className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <div className="stat-caption">Rating</div>
              <div className="mono-nums text-[30px] font-semibold leading-none">
                {p.profile.elo}
              </div>
              <div className="mt-2">
                <Sparkline values={p.ratingHistory} />
              </div>
              <div className="mono-nums mt-1 text-[12px] text-ink-soft">
                {p.totals.attempts} attempt{p.totals.attempts === 1 ? '' : 's'} · mean sgLoss{' '}
                {p.totals.meanSgLoss.toFixed(2)}
              </div>
            </div>

            <div>
              <div className="stat-caption">Level {p.level.level}</div>
              <div className="mono-nums text-[30px] font-semibold leading-none">{p.profile.xp}</div>
              <div className="mono-nums mt-1 text-[12px] text-ink-soft">
                XP · {p.level.xpToNext} to level {p.level.level + 1}
              </div>
              <div
                className="mt-2 h-[3px] w-full max-w-[220px] bg-[var(--sg-paper-edge)]"
                role="img"
                aria-label={`${Math.round(p.level.progress * 100)} percent through level ${p.level.level}`}
              >
                <div
                  className="h-full bg-ink"
                  style={{ width: `${Math.max(2, p.level.progress * 100)}%` }}
                />
              </div>

              <div className="stat-caption mt-5">Streak</div>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <TallyStreak groups={p.profile.tally} days={p.profile.streak} />
                <span className="mono-nums text-[13px]">
                  {p.profile.streak} day{p.profile.streak === 1 ? '' : 's'}
                  {p.profile.bestStreak > p.profile.streak && (
                    <span className="text-ink-soft"> · best {p.profile.bestStreak}</span>
                  )}
                </span>
              </div>
            </div>
          </section>

          <hr className="rule-hairline mt-8" />

          <section className="mt-6">
            <div className="stat-caption">Bands earned</div>
            <div className="mt-2 grid grid-cols-4 gap-3">
              {BAND_ORDER.map((b) => (
                <div key={b}>
                  <div className="mono-nums text-[22px] font-semibold leading-none">
                    {p.totals.bands[b]}
                  </div>
                  <div
                    className="folio-label mt-1 text-[12px]"
                    style={{ color: bandStamp.colors[b] }}
                  >
                    {bandStamp.labels[b]}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <hr className="rule-hairline mt-8" />

          <section className="mt-6">
            <div className="stat-caption">By shot type</div>
            <table className="mt-2 w-full">
              <thead>
                <tr className="stat-caption text-left">
                  <th className="py-1 font-normal">Category</th>
                  <th className="py-1 text-right font-normal">Played</th>
                  <th className="py-1 text-right font-normal">Good+</th>
                  <th className="py-1 text-right font-normal">Mean loss</th>
                </tr>
              </thead>
              <tbody className="mono-nums text-[13.5px]">
                {p.categories.map((c) => (
                  <tr key={c.category} className="border-t border-hairline">
                    <td className="py-1.5 font-ui text-[14px]">
                      {CATEGORY_LABEL[c.category] ?? c.category}
                    </td>
                    <td className="py-1.5 text-right">{c.attempts}</td>
                    <td className="py-1.5 text-right">
                      {c.attempts ? `${Math.round(c.accuracy * 100)}%` : '—'}
                    </td>
                    <td className="py-1.5 text-right">
                      {c.attempts ? c.meanSgLoss.toFixed(2) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {session.length > 0 && (
            <>
              <hr className="rule-hairline mt-8" />
              <section className="mt-6">
                <div className="stat-caption">This session</div>
                <div className="mono-nums mt-1 text-[14px]">
                  {session.length} puzzle{session.length === 1 ? '' : 's'} · mean loss{' '}
                  {sessionSg.toFixed(2)} · {sessionElo >= 0 ? '+' : ''}
                  {sessionElo} rating · +{sessionXp} XP
                </div>
                <ul className="mt-3 grid gap-1.5">
                  {[...session].reverse().map((a, i) => (
                    <li
                      key={`${a.puzzleId}-${i}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 border-t border-hairline pt-1.5"
                    >
                      <span className="text-[13.5px]">
                        <span
                          className="folio-label mr-2 text-[12px]"
                          style={{ color: bandStamp.colors[a.band] }}
                        >
                          {bandStamp.labels[a.band]}
                        </span>
                        {a.courseName} No. {a.holeNumber}
                        <span className="text-ink-soft"> · {a.category}</span>
                      </span>
                      <span className="mono-nums text-[12.5px] text-ink-soft">
                        {Math.max(0, a.sgLoss).toFixed(2)} loss ·{' '}
                        {a.eloDelta >= 0 ? '+' : ''}
                        {a.eloDelta} · +{a.xpGained} XP
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/play"
              className="grid min-h-12 place-items-center rounded-folio bg-ink px-6 font-ui text-[14px] text-paper"
            >
              Next puzzle →
            </Link>
            <Link
              href="/"
              className="grid min-h-12 place-items-center rounded-folio border border-hairline bg-paper px-6 font-ui text-[14px]"
            >
              The folio
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
