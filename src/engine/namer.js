// Course identity: every round is played somewhere with a name. Derived from
// the seed, so the Major at "Royal Bracken Downs" is the same place all week.

import { substream, pick } from './rng.js';

const FIRST = ['Windy', 'Pine', 'Fox', 'Heather', 'Stone', 'Gorse', 'Royal', 'Old',
  'High', 'Bracken', 'Silver', 'Thorn', 'Marsh', 'Ember', 'Crook', 'Wren'];
const SECOND = ['Hollow', 'Point', 'Links', 'Downs', 'Moor', 'Glen', 'Ridge',
  'Commons', 'Heath', 'Park', 'Fields', 'Burn', 'Knoll', 'Vale'];
const STYLE = ['G.C.', 'National', 'Club', ''];

export function courseName(seed) {
  const rng = substream(seed >>> 0, 'coursename');
  const parts = [pick(rng, FIRST), pick(rng, SECOND), pick(rng, STYLE)];
  return parts.filter(Boolean).join(' ');
}
