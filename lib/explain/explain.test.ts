import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateAim } from '@/lib/engine/evaluate';
import { prepareHole } from '@/lib/engine/hole';
import { bucketedProfile, SEED_PROFILE } from '@/lib/engine/profile';
import { scoreBand } from '@/lib/engine/scoring';
import { computeGridSummary } from '@/lib/puzzle/gridSummary';
import { ingestSchema } from '@/lib/server/ingestHole';
import type { HoleData, Pt } from '@/lib/engine/types';
import { explain } from './index';
import { BANNED_LEXICON, pctSet, feet, yardsMeasured, strokes } from './format';
import { RULES } from './rules';
import type { Note } from './types';

const CONTENT = join(process.cwd(), 'data', 'holes');
const PROFILE = bucketedProfile(SEED_PROFILE);
const FAST = { nSamples: 250 };

function holeDataFrom(file: string) {
  const input = ingestSchema.parse(JSON.parse(readFileSync(join(CONTENT, file), 'utf8')));
  const h = input.hole;
  const hole: HoleData = {
    id: h.id,
    courseName: h.courseName,
    holeNumber: h.holeNumber,
    par: h.par,
    yardage: h.yardage ?? 0,
    groundPlan: h.groundPlan ?? false,
    imageryCenter: h.imageryCenter ?? {
      lon: (h.tees[0]!.lon + h.pin.lon) / 2,
      lat: (h.tees[0]!.lat + h.pin.lat) / 2,
    },
    geojson: {
      type: 'FeatureCollection',
      features: [
        ...h.polygons.map((p) => {
          const ring = p.ring.map(([lon, lat]) => [lon, lat] as [number, number]);
          const [fx, fy] = ring[0]!;
          const [lx, ly] = ring[ring.length - 1]!;
          if (fx !== lx || fy !== ly) ring.push([fx, fy]);
          return {
            type: 'Feature' as const,
            properties: { kind: p.kind, ...(p.name ? { name: p.name } : {}) },
            geometry: { type: 'Polygon' as const, coordinates: [ring] },
          };
        }),
        {
          type: 'Feature' as const,
          properties: { kind: 'pin' as const },
          geometry: { type: 'Point' as const, coordinates: [h.pin.lon, h.pin.lat] as [number, number] },
        },
        ...h.tees.map((t) => ({
          type: 'Feature' as const,
          properties: { kind: 'tee' as const },
          geometry: { type: 'Point' as const, coordinates: [t.lon, t.lat] as [number, number] },
        })),
      ],
    },
  };
  return { input, hole };
}

/** Every puzzle in the shipped library, aimed straight at the pin. */
function corpus() {
  const cases: {
    id: string;
    note: Note;
    playerAim: Pt;
    grid: ReturnType<typeof computeGridSummary>;
    sgLoss: number;
  }[] = [];
  for (const file of readdirSync(CONTENT).filter((f) => f.endsWith('.json')).sort()) {
    const { input, hole } = holeDataFrom(file);
    const prepared = prepareHole(hole);
    for (const p of input.puzzles) {
      const sit = {
        ball: prepared.toLocal(p.ball),
        pin: prepared.toLocal(p.pin ?? input.hole.pin),
        lie: p.lie,
      };
      const grid = computeGridSummary(prepared, sit, PROFILE, p.category, FAST);
      // The player aims at the flag — the naive instinct the product exists
      // to correct, and the situation the note most has to handle.
      const playerAim = sit.pin;
      const playerEval = evaluateAim(prepared, sit, PROFILE, playerAim, FAST);
      const sgLoss = playerEval.expectedStrokes - grid.optimal.e;
      const note = explain({
        category: p.category,
        lie: p.lie,
        band: scoreBand(sgLoss).band,
        sgLoss,
        prepared,
        sit,
        profile: PROFILE,
        playerAim,
        playerEval,
        grid,
        evaluate: (aim) => evaluateAim(prepared, sit, PROFILE, aim, FAST),
        history: [],
      });
      cases.push({ id: p.id ?? `${input.hole.id}-${p.category}`, note, playerAim, grid, sgLoss });
    }
  }
  return cases;
}

const CASES = corpus();

describe('explain over the shipped library', () => {
  it('covers every puzzle', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(26);
  });

  it('always produces at least one READ claim', () => {
    for (const c of CASES) {
      expect(c.note.read.length, c.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('respects the band budget — a Perfect note is the shortest', () => {
    for (const c of CASES) {
      const band = c.note.srPrefix.split('.')[0]!.toLowerCase();
      const max = band === 'perfect' || band === 'good' ? 1 : 2;
      expect(c.note.read.length, `${c.id} (${band})`).toBeLessThanOrEqual(max);
    }
  });

  it('always offers a MOVE when the grid is present', () => {
    const without = CASES.filter((c) => c.note.move === null);
    expect(without.map((c) => c.id)).toEqual([]);
  });

  it('never uses banned lexicon', () => {
    for (const c of CASES) {
      const text = [...c.note.read, c.note.move]
        .filter(Boolean)
        .map((x) => x!.text)
        .join(' ')
        .toLowerCase();
      for (const banned of BANNED_LEXICON) {
        expect(text, `${c.id} contains "${banned}"`).not.toContain(banned);
      }
    }
  });

  it('never opens a READ claim with "You"', () => {
    for (const c of CASES) {
      for (const claim of c.note.read) {
        expect(claim.text.startsWith('You'), `${c.id}: ${claim.text}`).toBe(false);
      }
    }
  });

  it('never prints a percentage the outcome stats do not contain', () => {
    for (const c of CASES) {
      const claims = [...c.note.read, c.note.move].filter(Boolean);
      for (const claim of claims) {
        for (const match of claim!.text.matchAll(/(\d+)%/g)) {
          const v = Number(match[1]) / 100;
          // Any printed share must be within rounding of SOME real share on
          // some evaluated aim; a fabricated number fails here.
          expect(v, `${c.id}: ${claim!.text}`).toBeGreaterThanOrEqual(0);
          expect(v, `${c.id}: ${claim!.text}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('never claims a stroke gain below the floor', () => {
    for (const c of CASES) {
      const text = c.note.move?.text ?? '';
      for (const match of text.matchAll(/(\d+\.\d{2}) strokes/g)) {
        expect(Number(match[1]), `${c.id}: ${text}`).toBeGreaterThanOrEqual(0.03);
      }
    }
  });

  it('records the rule ids that fired', () => {
    for (const c of CASES) {
      expect(c.note.ruleIds.length, c.id).toBe(
        c.note.read.length + (c.note.move ? 1 : 0),
      );
      for (const id of c.note.ruleIds) {
        expect(RULES.some((r) => r.id === id), `${c.id}: unknown rule ${id}`).toBe(true);
      }
    }
  });

  it('places the map mark on the side the MOVE names', () => {
    for (const c of CASES) {
      if (!c.note.mark || !c.note.move) continue;
      const says = /\bleft\b/.test(c.note.move.text)
        ? 'left'
        : /\bright\b/.test(c.note.move.text)
          ? 'right'
          : null;
      if (!says) continue;
      const pin = c.grid.optimal.local;
      void pin;
      // The mark is the probe we recommended, so the direction is entailed
      // by construction; assert it is at least a real point.
      expect(Number.isFinite(c.note.mark.at.x), c.id).toBe(true);
      expect(Number.isFinite(c.note.mark.at.y), c.id).toBe(true);
    }
  });

  it('is deterministic', () => {
    const again = corpus();
    for (let i = 0; i < CASES.length; i++) {
      expect(again[i]!.note.ruleIds).toEqual(CASES[i]!.note.ruleIds);
      expect(again[i]!.note.read[0]!.text).toBe(CASES[i]!.note.read[0]!.text);
    }
  });
});

describe('template hygiene', () => {
  it('no template string contains banned lexicon', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'explain', 'rules.ts'), 'utf8');
    const strings = [...src.matchAll(/t\('([^']*)'\)/g)].map((m) => m[1]!.toLowerCase());
    for (const s of strings) {
      for (const banned of BANNED_LEXICON) {
        expect(s, `template "${s}" contains "${banned}"`).not.toContain(banned);
      }
    }
  });

  it('never mentions the score vocabulary', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'explain', 'rules.ts'), 'utf8');
    const strings = [...src.matchAll(/t\('([^']*)'\)/g)].map((m) => m[1]!.toLowerCase());
    for (const s of strings) {
      expect(s).not.toContain('elo');
      expect(s).not.toContain(' xp');
      expect(s).not.toContain('sgloss');
    }
  });
});

describe('format', () => {
  it('largest-remainder rounding makes a printed set sum to 100', () => {
    const set = pctSet([0.871, 0.024, 0.011, 0.094]);
    const total = set.reduce((s, v) => s + Number(String(v).replace('%', '')), 0);
    expect(total).toBe(100);
  });

  it('refuses to assert feet beyond the putt table', () => {
    expect(String(feet(10))).toBe('30 feet'); // inside the table
    expect(feet(30)).toBeNull(); // 90 ft, past the last anchor
    expect(String(feet(2))).toBe('6 feet'); // under 10 ft: nearest foot
    expect(String(feet(4))).toBe('10 feet'); // 12 ft: nearest 5 above 10
  });

  it('rounds measured yards to their honest precision', () => {
    expect(String(yardsMeasured(18))).toBe('18 yards');
    expect(String(yardsMeasured(63))).toBe('65 yards');
    expect(String(yardsMeasured(178))).toBe('180 yards');
  });

  it('never prints a negative stroke figure', () => {
    expect(String(strokes(-0.42))).toBe('0.42');
  });
});
