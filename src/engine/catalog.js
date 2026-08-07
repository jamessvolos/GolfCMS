// The CMS content model. A puzzle record is a (seed, difficulty) tuple plus
// curation state — courses are re-derived, never stored. Share codes pack the
// tuple into a short human-pasteable string. All functions are pure; storage
// is the caller's concern.

import { makePuzzle, DIFFICULTIES } from './puzzle.js';
import { BIOMES } from './generate.js';

// Crockford-style base32: no I, L, O, U — codes survive handwriting.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const BIOME_LETTERS = 'CWAL'; // classic, winter, alpine, links

export const STATUSES = ['generated', 'approved', 'rejected'];

/**
 * Encode seed + difficulty (+ biome) into a code like GLF-3K9M-W2P0-S.
 * Classic codes keep the original three-part format so every code ever
 * shared stays valid; other biomes append a letter: GLF-3K9M-W2P0-S-W.
 */
export function encodeShareCode(seed, difficulty, biome = 'classic') {
  const di = DIFFICULTIES.indexOf(difficulty);
  if (di < 0) throw new Error(`unknown difficulty: ${difficulty}`);
  const bi = BIOMES.indexOf(biome);
  if (bi < 0) throw new Error(`unknown biome: ${biome}`);
  let n = seed >>> 0;
  let chars = '';
  for (let i = 0; i < 7; i++) {
    chars = ALPHABET[n & 31] + chars;
    n >>>= 5;
  }
  // Check digit folds in difficulty and biome (biome 0 preserves old codes).
  chars += ALPHABET[(seed >>> 0) % 31 ^ di ^ (bi << 2)];
  const base = `GLF-${chars.slice(0, 4)}-${chars.slice(4)}-${'ESR'[di]}`;
  return bi === 0 ? base : `${base}-${BIOME_LETTERS[bi]}`;
}

/** @returns {{seed: number, difficulty: string, biome: string}} */
export function decodeShareCode(code) {
  const m = String(code).trim().toUpperCase()
    .match(/^GLF-([0-9A-Z]{4})-([0-9A-Z]{4})-([ESR])(?:-([CWAL]))?$/);
  if (!m) throw new Error('malformed share code');
  const chars = m[1] + m[2];
  let seed = 0;
  for (let i = 0; i < 7; i++) {
    const v = ALPHABET.indexOf(chars[i]);
    if (v < 0) throw new Error('malformed share code');
    seed = ((seed << 5) | v) >>> 0;
  }
  const di = 'ESR'.indexOf(m[3]);
  const bi = m[4] ? BIOME_LETTERS.indexOf(m[4]) : 0;
  if (bi >= BIOMES.length) throw new Error('unknown biome in share code');
  const check = ALPHABET[(seed >>> 0) % 31 ^ di ^ (bi << 2)];
  if (chars[7] !== check) throw new Error('share code failed its check digit');
  return { seed, difficulty: DIFFICULTIES[di], biome: BIOMES[bi] };
}

/**
 * Build a catalog record for a seed: generate, certify, summarize.
 * @returns {{code: string, seed: number, difficulty: string, par: number,
 *            archetype: string, start: {x:number,y:number}, status: string, notes: string}}
 */
export function makeRecord(seed, difficulty = 'standard', biome = 'classic') {
  const p = makePuzzle(seed, difficulty, biome);
  return {
    code: encodeShareCode(p.seed, p.difficulty, p.biome),
    seed: p.seed,
    difficulty: p.difficulty,
    biome: p.biome,
    par: p.par,
    archetype: p.course.archetype,
    start: p.start,
    status: 'generated',
    notes: '',
  };
}

/** Curation state machine: generated → approved | rejected (and back). */
export function setStatus(record, status) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status: ${status}`);
  return { ...record, status };
}

/** Batch-generate distinct certified records from a base seed. */
export function generateBatch(baseSeed, count, difficulty = 'standard', biome = 'classic') {
  const records = [];
  const seen = new Set();
  let seed = baseSeed >>> 0;
  while (records.length < count) {
    const r = makeRecord(seed, difficulty, biome);
    seed = (r.seed + 1) >>> 0; // makePuzzle may have rerolled forward
    if (!seen.has(r.seed)) {
      seen.add(r.seed);
      records.push(r);
    }
  }
  return records;
}

/** Serialize a catalog for export; versioned so future schemas can migrate. */
export function exportCatalog(records) {
  return JSON.stringify({ format: 'golfcms-catalog', version: 1, records }, null, 2);
}

/** @returns {Array<ReturnType<typeof makeRecord>>} */
export function importCatalog(json) {
  const data = JSON.parse(json);
  if (data.format !== 'golfcms-catalog') throw new Error('not a GolfCMS catalog file');
  if (data.version !== 1) throw new Error(`unsupported catalog version ${data.version}`);
  for (const r of data.records) {
    decodeShareCode(r.code); // integrity: every record's code must parse
    if (!STATUSES.includes(r.status)) throw new Error(`bad status on ${r.code}`);
  }
  return data.records;
}
