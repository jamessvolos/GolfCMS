import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Overpass is a build-time dependency. It rate-limits, it returns 504 as a
 * normal state, and a blocked IP would be the app's — so nothing the
 * container runs at boot or in a request may reach it.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts') || path.endsWith('.tsx')) out.push(path);
  }
  return out;
}

const ALLOWED = [
  'lib/content/osm/',
  'scripts/',
  'app/api/admin/',
];

describe('Overpass stays out of the serving path', () => {
  it('is imported only by the miner, the admin import route and the osm module', () => {
    const offenders: string[] = [];
    for (const file of walk(process.cwd())) {
      const rel = file.slice(process.cwd().length + 1);
      if (ALLOWED.some((p) => rel.startsWith(p))) continue;
      const src = readFileSync(file, 'utf8');
      if (/from '[^']*osm\/(overpass|discover)'/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('is not reachable from the seed, which runs on every container boot', () => {
    const seed = readFileSync(join(process.cwd(), 'prisma', 'seed.ts'), 'utf8');
    expect(seed).not.toMatch(/overpass|discover|fetch\(/);
  });
});
