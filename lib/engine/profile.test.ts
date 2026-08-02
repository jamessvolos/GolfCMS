import { describe, expect, it } from 'vitest';
import { bucketedProfile, profileBucket } from './profile';

describe('bucketedProfile', () => {
  it('rounds handicap to 5s and speed to 10s, preserving shape', () => {
    expect(bucketedProfile({ handicap: 14, clubSpeedMph: 107, shotShape: 'draw' })).toEqual({
      handicap: 15,
      clubSpeedMph: 110,
      shotShape: 'draw',
    });
    expect(bucketedProfile({ handicap: 12, clubSpeedMph: 104, shotShape: 'fade' })).toEqual({
      handicap: 10,
      clubSpeedMph: 100,
      shotShape: 'fade',
    });
  });

  it('is idempotent and consistent with profileBucket', () => {
    const p = { handicap: 17.4, clubSpeedMph: 96, shotShape: 'straight' as const };
    const b = bucketedProfile(p);
    expect(bucketedProfile(b)).toEqual(b);
    expect(profileBucket(p)).toBe(profileBucket(b));
    expect(profileBucket(p)).toBe('h15-s100-straight');
  });

  it('groups nearby profiles into the same bucket and splits shapes', () => {
    const a = { handicap: 14, clubSpeedMph: 107, shotShape: 'draw' as const };
    const b = { handicap: 16, clubSpeedMph: 113, shotShape: 'draw' as const };
    const c = { handicap: 14, clubSpeedMph: 107, shotShape: 'fade' as const };
    expect(profileBucket(a)).toBe(profileBucket(b));
    expect(profileBucket(a)).not.toBe(profileBucket(c));
  });
});
