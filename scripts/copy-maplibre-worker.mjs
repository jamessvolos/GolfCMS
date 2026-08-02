/**
 * MapLibre processes vector/GeoJSON sources in its own web worker. Bundlers
 * can mangle its self-spawning trick (Turbopack does), so we serve the
 * official worker file verbatim from /public and point MapLibre at it with
 * setWorkerUrl(). Runs automatically before dev and build.
 */

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const distDir = join(root, 'node_modules', 'maplibre-gl', 'dist');
const outDir = join(root, 'public', 'vendor');
mkdirSync(outDir, { recursive: true });
// The worker module imports the shared chunk as a sibling — copy both.
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(join(distDir, file), join(outDir, file));
}
console.log('copied maplibre worker + shared chunk → public/vendor/');
