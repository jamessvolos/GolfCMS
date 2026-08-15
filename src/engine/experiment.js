// The photo-ground experiment — Thin Coat Studio's gate, endorsed by the
// aerial bake-off verdict: before any further spend on photographic play,
// measure whether the photo actually improves it. Pure functions over the
// entries the Caddie surface logs after each traced round; the UI owns
// storage, this module owns the arithmetic, so the experiment is testable
// without a browser — the same split stats.js uses.

/**
 * @typedef {{ground: 'photo'|'paint', overrode: boolean, keptPhoto: boolean,
 *            points: number, holes: number}} ABEntry
 */

/** Deterministic assignment: traced rounds alternate grounds by play count,
 *  so a lone tracer still builds both arms of the experiment. */
export function abAssign(entryCount) {
  return entryCount % 2 === 0 ? 'photo' : 'paint';
}

/** Aggregate the experiment. Points are normalized per hole so a one-hole
 *  trace and a longer pack round weigh the same. */
export function abSummary(entries) {
  const arm = { photo: { n: 0, pts: 0 }, paint: { n: 0, pts: 0 } };
  let overrides = 0;
  let keptPhoto = 0;
  for (const e of entries) {
    const a = arm[e.ground];
    if (!a || !Number.isFinite(e.points) || !(e.holes > 0)) continue;
    a.n += 1;
    a.pts += e.points / e.holes;
    if (e.overrode) overrides += 1;
    if (e.keptPhoto) keptPhoto += 1;
  }
  const avg = (a) => (a.n ? a.pts / a.n : null);
  const counted = arm.photo.n + arm.paint.n;
  return {
    photo: { n: arm.photo.n, avgPts: avg(arm.photo) },
    paint: { n: arm.paint.n, avgPts: avg(arm.paint) },
    overrides,
    keptPhoto,
    rounds: counted,
    // the experiment speaks only when both arms have a real sample
    verdict: verdictLine(arm, avg, overrides, keptPhoto, counted),
  };
}

function verdictLine(arm, avg, overrides, keptPhoto, counted) {
  if (arm.photo.n < 5 || arm.paint.n < 5) {
    return `collecting — ${arm.photo.n} photo / ${arm.paint.n} paint rounds of the 5+5 needed`;
  }
  const dp = avg(arm.photo) - avg(arm.paint);
  const pref = counted ? keptPhoto / counted : 0;
  const scores = dp > 15 ? 'photo rounds score higher'
    : dp < -15 ? 'photo rounds score LOWER'
    : 'scoring is a wash';
  const prefs = pref > 0.65 ? 'players keep the photo'
    : pref < 0.35 ? 'players turn the photo off'
    : 'preference is split';
  return `${scores} (${dp >= 0 ? '+' : ''}${Math.round(dp)} pts/hole) · ${prefs} (${Math.round(pref * 100)}%)`;
}
