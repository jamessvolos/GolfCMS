import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from './types';
import { dispersionParams, lateralSigmaFraction, sampleLandings } from './dispersion';
import { createNormalPairs } from './rng';

const P14: PlayerProfile = { handicap: 14, clubSpeedMph: 110, shotShape: 'draw' };

function meanStd(xs: number[]): { mean: number; std: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const varr = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1);
  return { mean, std: Math.sqrt(varr) };
}

describe('lateralSigmaFraction', () => {
  it('hits the anchors', () => {
    expect(lateralSigmaFraction(0)).toBeCloseTo(0.032, 9);
    expect(lateralSigmaFraction(5)).toBeCloseTo(0.038, 9);
    expect(lateralSigmaFraction(20)).toBeCloseTo(0.065, 9);
  });

  it('interpolates linearly between anchors', () => {
    // between 10 (0.046) and 15 (0.055): 14 → 0.046 + 0.8*0.009
    expect(lateralSigmaFraction(14)).toBeCloseTo(0.0532, 9);
  });

  it('extrapolates above 20 and clamps at the max', () => {
    expect(lateralSigmaFraction(25)).toBeCloseTo(0.075, 9);
    expect(lateralSigmaFraction(40)).toBeCloseTo(0.09, 9);
  });

  it('clamps plus handicaps at the scratch anchor', () => {
    expect(lateralSigmaFraction(-2)).toBeCloseTo(0.032, 9);
  });
});

describe('dispersionParams', () => {
  it('scales sigmas with distance and derives lateral from handicap', () => {
    const p = dispersionParams(P14, 'fairway', 200);
    expect(p.sigmaLong).toBeCloseTo(0.055 * 200, 9);
    expect(p.sigmaLat).toBeCloseTo(0.0532 * 200, 9);
    expect(p.meanLat).toBeCloseTo(-0.008 * 200, 9);
  });

  it('multiplies both sigmas from rough and sand', () => {
    const f = dispersionParams(P14, 'fairway', 200);
    const r = dispersionParams(P14, 'rough', 200);
    const s = dispersionParams(P14, 'sand', 200);
    expect(r.sigmaLong).toBeCloseTo(f.sigmaLong * 1.25, 9);
    expect(r.sigmaLat).toBeCloseTo(f.sigmaLat * 1.25, 9);
    expect(s.sigmaLong).toBeCloseTo(f.sigmaLong * 1.5, 9);
    expect(s.sigmaLat).toBeCloseTo(f.sigmaLat * 1.5, 9);
  });

  it('keeps the shape bias for straight and fade', () => {
    const straight = dispersionParams({ ...P14, shotShape: 'straight' }, 'fairway', 200);
    const fade = dispersionParams({ ...P14, shotShape: 'fade' }, 'fairway', 200);
    expect(straight.meanLat).toBeCloseTo(0, 9);
    expect(fade.meanLat).toBeCloseTo(1.6, 9);
  });
});

describe('sampleLandings', () => {
  const N = 20_000;
  const normals = createNormalPairs(42, N);

  it('matches the requested distribution aiming north', () => {
    const ball = { x: 0, y: 0 };
    const aim = { x: 0, y: 200 };
    const params = dispersionParams(P14, 'fairway', 200);
    const pts = sampleLandings(ball, aim, params, normals);
    expect(pts).toHaveLength(N);
    const xs = meanStd(pts.map((p) => p.x));
    const ys = meanStd(pts.map((p) => p.y));
    // Aiming north: lateral axis is x (right = east), longitudinal is y.
    expect(xs.mean).toBeCloseTo(-1.6, 0); // draw pulls left (west)
    expect(ys.mean).toBeCloseTo(200, 0);
    expect(Math.abs(xs.std - params.sigmaLat) / params.sigmaLat).toBeLessThan(0.03);
    expect(Math.abs(ys.std - params.sigmaLong) / params.sigmaLong).toBeLessThan(0.03);
  });

  it('rotates the distribution with the aim line (east aim)', () => {
    const ball = { x: 0, y: 0 };
    const aim = { x: 200, y: 0 };
    const params = dispersionParams(P14, 'fairway', 200);
    const pts = sampleLandings(ball, aim, params, normals);
    const xs = meanStd(pts.map((p) => p.x));
    const ys = meanStd(pts.map((p) => p.y));
    // Heading east: right of the line is south, so a draw (left bias) pushes north (+y).
    expect(xs.mean).toBeCloseTo(200, 0);
    expect(ys.mean).toBeCloseTo(1.6, 0);
    expect(Math.abs(ys.std - params.sigmaLat) / params.sigmaLat).toBeLessThan(0.03);
    expect(Math.abs(xs.std - params.sigmaLong) / params.sigmaLong).toBeLessThan(0.03);
  });

  it('pushes a fade right of the aim line', () => {
    const ball = { x: 0, y: 0 };
    const aim = { x: 0, y: 200 };
    const params = dispersionParams({ ...P14, shotShape: 'fade' }, 'fairway', 200);
    const pts = sampleLandings(ball, aim, params, normals);
    const xs = meanStd(pts.map((p) => p.x));
    expect(xs.mean).toBeCloseTo(1.6, 0);
  });

  it('is deterministic for a given normals buffer', () => {
    const ball = { x: 0, y: 0 };
    const aim = { x: 0, y: 200 };
    const params = dispersionParams(P14, 'fairway', 200);
    const a = sampleLandings(ball, aim, params, normals);
    const b = sampleLandings(ball, aim, params, normals);
    expect(a[123]).toEqual(b[123]);
  });
});
