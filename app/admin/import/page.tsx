import Link from 'next/link';
import ImportPanel from '@/components/admin/ImportPanel';

export const dynamic = 'force-dynamic';

export default function ImportPage() {
  return (
    <main className="mx-auto max-w-[1100px] px-5 py-6">
      <header className="mb-5">
        <div className="folio-eyebrow">
          <Link href="/" className="hover:text-ink">
            SG Trainer
          </Link>{' '}
          · Import from OpenStreetMap
        </div>
        <h1 className="mt-1 font-display text-[clamp(22px,3.5vw,30px)] leading-tight">
          Take a hole off the map
        </h1>
        <p className="mt-1 max-w-[75ch] text-[13.5px] text-ink-soft">
          Where a course is mapped in OpenStreetMap, the hole can be imported rather than traced:
          the greens, bunkers, water and trees come from the map, and the engine plays the hole to
          decide where each puzzle&rsquo;s ball sits. Coverage is uneven — plenty of courses have
          only an outline, and those cannot be imported.{' '}
          <Link href="/admin/annotate" className="underline">
            Trace one by hand instead
          </Link>
          .
        </p>
        <hr className="rule-engraved mt-3" />
      </header>
      <ImportPanel />
    </main>
  );
}
