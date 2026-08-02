import Link from 'next/link';
import { getProfile } from '@/lib/server/content';
import SettingsForm from '@/components/settings/SettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const profile = await getProfile();

  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <header>
        <div className="folio-eyebrow">
          <Link href="/" className="hover:text-ink">
            SG Trainer
          </Link>{' '}
          · Player profile
        </div>
        <h1 className="mt-1 font-display text-[clamp(26px,5vw,38px)] leading-tight [text-wrap:balance]">
          Your game, on the record
        </h1>
        <hr className="rule-engraved mt-3" />
        <p className="mt-3 max-w-[58ch] text-[14.5px] leading-relaxed text-ink-soft">
          The engine derives your club distances and shot cloud from three numbers. Every puzzle
          is then scored against the optimal aim for <em>your</em> dispersion — not a tour
          player&rsquo;s.
        </p>
      </header>

      <SettingsForm profile={profile} />
    </main>
  );
}
