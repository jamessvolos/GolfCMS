import { describe, expect, it } from 'vitest';
import { attributionsFor, OSM_ATTRIBUTION } from './groundStyle';

describe('attributionsFor', () => {
  it('credits OpenStreetMap for imported holes', () => {
    // ODbL obligation, not a nicety: publishing an imported hole without
    // this credit breaches the licence the geometry came under.
    expect(attributionsFor({ source: 'osm' })).toEqual([OSM_ATTRIBUTION]);
  });

  it('credits nobody extra for hand-traced holes', () => {
    // Esri's imagery credit comes from the raster source and is always on.
    expect(attributionsFor({ source: 'traced' })).toEqual([]);
    expect(attributionsFor({})).toEqual([]);
  });
});
