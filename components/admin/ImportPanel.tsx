'use client';

/**
 * Pull a hole from OpenStreetMap instead of tracing it.
 *
 * Preview first, always. The importer makes real editorial decisions — it
 * reverses backwards centrelines, infers par, throws away features outside
 * the corridor, distrusts metric distance tags — and every one of those is
 * listed before anything is written. An import you cannot inspect is how a
 * bunker ends up on a swimming pool.
 */

import { useState } from 'react';

type Mode = 'course' | 'point';

interface Puzzle {
  id?: string;
  lie: string;
  category: string;
  description: string;
}

interface Preview {
  input: {
    hole: {
      id: string;
      courseName: string;
      holeNumber: number;
      par: number;
      polygons: { kind: string; name?: string; holes?: unknown[] }[];
    };
    puzzles: Puzzle[];
  };
  measuredYards: number;
  notes: string[];
  committed: boolean;
  result?: { puzzles: { id: string; rating: number }[]; warnings: string[] };
}

const control =
  'rounded-folio border border-hairline bg-paper px-2 py-1.5 text-[13px] w-full';
const button = 'rounded-folio border border-hairline bg-paper px-3 py-1.5 text-[13px]';

export default function ImportPanel() {
  const [mode, setMode] = useState<Mode>('course');
  const [course, setCourse] = useState('');
  const [point, setPoint] = useState('');
  const [holeNumber, setHoleNumber] = useState('1');
  const [corridor, setCorridor] = useState('80');
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  function body() {
    const n = Number(holeNumber);
    const base: Record<string, unknown> = {
      holeNumber: Number.isFinite(n) ? n : 0,
      corridorYds: Number(corridor) || 80,
    };
    if (mode === 'course') {
      base.course = course.trim();
    } else {
      const [lat, lon] = point.split(',').map((s) => Number(s.trim()));
      base.near = { lat, lon };
      base.courseName = course.trim() || 'Unknown course';
    }
    return base;
  }

  async function run(commit: boolean) {
    setBusy(commit ? 'commit' : 'preview');
    setError(null);
    if (!commit) setPreview(null);
    try {
      const res = await fetch(`/api/admin/import${commit ? '' : '?preview=1'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body()),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `import failed (${res.status})`);
      setPreview(json as Preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'import failed');
    } finally {
      setBusy(null);
    }
  }

  const canRun =
    (mode === 'course' ? course.trim().length > 1 : /^-?[\d.]+\s*,\s*-?[\d.]+$/.test(point)) &&
    Number(holeNumber) >= 1 &&
    Number(holeNumber) <= 18;

  const kinds = preview
    ? preview.input.hole.polygons.reduce<Record<string, number>>((m, p) => {
        m[p.kind] = (m[p.kind] ?? 0) + 1;
        return m;
      }, {})
    : {};

  return (
    <div className="grid gap-6 md:grid-cols-[320px_1fr]">
      <section>
        <h2 className="stat-caption mb-2">Source</h2>
        <div className="flex gap-2">
          {(['course', 'point'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`${button} ${mode === m ? 'border-ink' : ''}`}
              aria-pressed={mode === m}
            >
              {m === 'course' ? 'By course name' : 'By coordinates'}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-2">
          <label className="grid gap-1">
            <span className="stat-caption">
              {mode === 'course' ? 'Course name in OpenStreetMap' : 'Course name (for display)'}
            </span>
            <input
              className={control}
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              placeholder="Royal Birkdale"
            />
          </label>

          {mode === 'point' && (
            <label className="grid gap-1">
              <span className="stat-caption">A point on the hole — lat, lon</span>
              <input
                className={`${control} mono-nums`}
                value={point}
                onChange={(e) => setPoint(e.target.value)}
                placeholder="53.6191, -3.0286"
              />
            </label>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1">
              <span className="stat-caption">Hole</span>
              <input
                className={`${control} mono-nums`}
                inputMode="numeric"
                value={holeNumber}
                onChange={(e) => setHoleNumber(e.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="stat-caption">Corridor (yds)</span>
              <input
                className={`${control} mono-nums`}
                inputMode="numeric"
                value={corridor}
                onChange={(e) => setCorridor(e.target.value)}
              />
            </label>
          </div>
          <p className="text-[12px] text-ink-soft">
            Widen the corridor for a hole that doglegs hard, when the fairway sits outside the
            straight line from tee to green.
          </p>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className={button}
            disabled={!canRun || busy !== null}
            onClick={() => run(false)}
          >
            {busy === 'preview' ? 'Fetching…' : 'Preview'}
          </button>
          <button
            type="button"
            className={`${button} ${preview && !preview.committed ? 'border-ink' : ''}`}
            disabled={!preview || preview.committed || busy !== null}
            onClick={() => run(true)}
          >
            {busy === 'commit' ? 'Importing…' : 'Import this hole'}
          </button>
        </div>
      </section>

      <section aria-live="polite">
        {error && (
          <div className="rounded-folio border border-flag p-3 text-[13.5px]">
            <div className="stat-caption mb-1 text-flag">Could not import</div>
            {error}
          </div>
        )}

        {!error && !preview && (
          <p className="max-w-[60ch] text-[13.5px] text-ink-soft">
            Preview fetches the course from Overpass, assembles the hole, and plays it with the
            engine to place each puzzle&rsquo;s ball. Nothing is written until you import.
          </p>
        )}

        {preview && (
          <div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 className="font-display text-[22px]">
                {preview.input.hole.courseName} #{preview.input.hole.holeNumber}
              </h2>
              <span className="stat-caption">
                par {preview.input.hole.par} · {preview.measuredYards} yds ·{' '}
                {preview.input.hole.id}
              </span>
            </div>
            <hr className="rule-hairline my-3" />

            <div className="stat-caption mb-1">Features</div>
            <p className="mono-nums text-[13px]">
              {Object.entries(kinds)
                .map(([k, n]) => `${k}×${n}`)
                .join('   ')}
            </p>

            <div className="stat-caption mb-1 mt-4">Puzzles the engine derived</div>
            <ul className="grid gap-1 text-[13.5px]">
              {preview.input.puzzles.map((p, i) => (
                <li key={p.id ?? i}>
                  <span className="stat-caption mr-2">{p.category}</span>
                  {p.description}
                </li>
              ))}
            </ul>

            {preview.notes.length > 0 && (
              <>
                <div className="stat-caption mb-1 mt-4">What the importer decided</div>
                <ul className="grid gap-1 text-[13px] text-ink-soft">
                  {preview.notes.map((n) => (
                    <li key={n}>
                      <span className="sg-note-glyph">·</span>
                      {n}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {preview.committed && preview.result && (
              <div className="mt-4 rounded-folio border border-hairline p-3">
                <div className="stat-caption mb-1">Imported</div>
                <p className="mono-nums text-[13px]">
                  {preview.result.puzzles.map((p) => `${p.id} (${p.rating})`).join('   ')}
                </p>
                {preview.result.warnings.map((w) => (
                  <p key={w} className="mt-1 text-[13px] text-ink-soft">
                    ! {w}
                  </p>
                ))}
                <a href="/" className="mt-2 inline-block text-[13px] underline">
                  Back to the hole list
                </a>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
