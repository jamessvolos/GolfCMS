'use client';

/**
 * Folio profile form. Client-side only for the live derived readouts
 * (driver carry, lateral spread, scoring bucket) — submission goes through
 * the server action.
 */

import { useActionState, useState } from 'react';
import { saveProfileAction } from '@/lib/server/actions';
import type { ProfileFormState } from '@/lib/server/actions';
import { DRIVER_CARRY_PER_MPH } from '@/lib/engine/constants';
import { lateralSigmaFraction } from '@/lib/engine/dispersion';
import { bucketedProfile, profileBucket } from '@/lib/engine/profile';
import type { ProfileRecord } from '@/lib/server/content';
import type { ShotShape } from '@/lib/engine/types';

const SHAPES: { value: ShotShape; label: string; hint: string }[] = [
  { value: 'draw', label: 'Draw', hint: 'curves left' },
  { value: 'straight', label: 'Straight', hint: 'no bias' },
  { value: 'fade', label: 'Fade', hint: 'curves right' },
];

export default function SettingsForm({ profile }: { profile: ProfileRecord }) {
  const [state, formAction, pending] = useActionState<ProfileFormState, FormData>(
    saveProfileAction,
    { error: null },
  );
  // String state so partially-typed values ('', '-', '12.') aren't clobbered
  // by a numeric round-trip; the readouts parse with a validity guard.
  const [handicap, setHandicap] = useState(String(profile.handicap));
  const [clubSpeed, setClubSpeed] = useState(String(profile.clubSpeedMph));
  const [shotShape, setShotShape] = useState<ShotShape>(profile.shotShape);

  const hNum = Number(handicap);
  const sNum = Number(clubSpeed);
  const valid = handicap !== '' && clubSpeed !== '' && Number.isFinite(hNum) && Number.isFinite(sNum);
  // The readouts show what the ENGINE will use — the bucketed profile the
  // cached grids and scoring actually run with, not the raw inputs.
  const bp = valid ? bucketedProfile({ handicap: hNum, clubSpeedMph: sNum, shotShape }) : null;
  const carry = bp ? Math.round(DRIVER_CARRY_PER_MPH * bp.clubSpeedMph) : null;
  const spread = bp && carry ? Math.round(lateralSigmaFraction(bp.handicap) * carry) : null;
  const bucket = bp ? profileBucket(bp) : null;

  return (
    <form action={formAction} className="mt-8">
      <div className="grid gap-6 sm:grid-cols-2">
        <label className="block">
          <span className="stat-caption">Name</span>
          <input
            name="name"
            defaultValue={profile.name}
            maxLength={40}
            required
            className="mono-nums mt-1 w-full rounded-folio border border-hairline bg-paper px-3 py-2.5 text-[15px]"
          />
        </label>
        <div aria-hidden className="hidden sm:block" />

        <label className="block">
          <span className="stat-caption">Handicap</span>
          <input
            name="handicap"
            type="number"
            min={-5}
            max={36}
            step="any"
            value={handicap}
            onChange={(e) => setHandicap(e.target.value)}
            required
            className="mono-nums mt-1 w-full rounded-folio border border-hairline bg-paper px-3 py-2.5 text-[15px]"
          />
          <span className="mt-1 block text-[12px] text-ink-soft">
            Sets your lateral dispersion.
          </span>
        </label>

        <label className="block">
          <span className="stat-caption">Driver club speed (mph)</span>
          <input
            name="clubSpeed"
            type="number"
            min={60}
            max={135}
            step={1}
            value={clubSpeed}
            onChange={(e) => setClubSpeed(e.target.value)}
            required
            className="mono-nums mt-1 w-full rounded-folio border border-hairline bg-paper px-3 py-2.5 text-[15px]"
          />
          <span className="mt-1 block text-[12px] text-ink-soft">
            Sets your whole club distance table.
          </span>
        </label>
      </div>

      <fieldset className="mt-6">
        <legend className="stat-caption">Typical shot shape</legend>
        <div className="mt-2 flex gap-3">
          {SHAPES.map((s) => (
            <label
              key={s.value}
              className={`min-h-11 flex-1 cursor-pointer rounded-folio border px-4 py-2.5 text-center ${
                shotShape === s.value
                  ? 'border-ink bg-ink text-paper'
                  : 'border-hairline bg-paper'
              }`}
            >
              <input
                type="radio"
                name="shotShape"
                value={s.value}
                checked={shotShape === s.value}
                onChange={() => setShotShape(s.value)}
                className="sr-only"
              />
              <span className="block font-ui text-[14px] font-medium">{s.label}</span>
              <span
                className={`block text-[11px] ${
                  shotShape === s.value ? 'text-paper/70' : 'text-ink-soft'
                }`}
              >
                {s.hint}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-8 rounded-folio border border-hairline bg-[var(--sg-paper-edge)] px-5 py-4">
        <div className="stat-caption">What the engine sees</div>
        <div className="mono-nums mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[13.5px] sm:grid-cols-3">
          <span>driver carry ≈ {carry ?? '—'}y</span>
          <span>±1σ at driver ≈ {spread ?? '—'}y</span>
          <span>scoring bucket {bucket ?? '—'}</span>
        </div>
        <p className="mt-2 text-[12px] text-ink-soft">
          Grids are cached per bucket — handicap rounds to 5s, speed to 10s — so your aim is
          scored with the bucket&rsquo;s dispersion.
        </p>
      </div>

      {state.error && (
        <p role="alert" className="mt-4 text-[13.5px] font-medium text-flag">
          {state.error} — adjust the value and save again.
        </p>
      )}

      <div className="mt-6 flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 rounded-folio bg-ink px-6 font-ui text-[14px] font-medium text-paper disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  );
}
