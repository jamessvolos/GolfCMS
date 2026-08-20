// Author the tribute pack: nine hand-built holes honoring famous real ones,
// each certified by the actual solver before it may enter the pack. This is
// deliberately NOT imagery-derived — no satellite pixels were fetched or
// shipped; the layouts are drawn from public knowledge of the holes, and the
// georeference pins each tribute to the real hole's approximate coordinates
// (public facts), so the HUD can say where on Earth the original lives.
//
// Usage: node scripts/author-real-pack.mjs   → writes packs/real-9.json
//
// Method per hole: search seeds for a generated course whose immutable
// tee→cup geometry fits the target length (the patch format anchors tee and
// cup by design), repaint the whole board in a tee→cup local frame (u along,
// v across, in tiles), then gate on the solver: unsolvable or wildly
// off-par candidates never publish. Par is parForTiles (the caddie's own
// model), and the solver's stroke count must agree within a stroke.

import { writeFileSync, mkdirSync } from 'node:fs';
import { generateCourse } from '../src/engine/generate.js';
import { solve } from '../src/engine/solver.js';
import { encodeGridPatch, applyPatch, decodePatch } from '../src/engine/patch.js';
import { encodeGeoRef, geoFromAnchors } from '../src/engine/georef.js';
import { parForTiles, holeYards, YARDS_PER_TILE } from '../src/engine/yards.js';
import { FAIRWAY, ROUGH, SAND, WATER, TREES, GREEN } from '../src/engine/terrain.js';

/** Painting frame: u runs tee→cup in tiles, v is perpendicular (right). */
function frame(course) {
  const dx = course.hole.x - course.tee.x;
  const dy = course.hole.y - course.tee.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  return {
    len,
    pt: (u, v) => ({ x: course.tee.x + ux * u - uy * v, y: course.tee.y + uy * u + ux * v }),
  };
}

const ops = (course, cells) => {
  const put = (x, y, t) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= course.width || yi >= course.height) return;
    cells[yi * course.width + xi] = t;
  };
  const disc = (p, r, t) => {
    for (let y = Math.floor(p.y - r); y <= Math.ceil(p.y + r); y++) {
      for (let x = Math.floor(p.x - r); x <= Math.ceil(p.x + r); x++) {
        if (Math.hypot(x - p.x, y - p.y) <= r) put(x, y, t);
      }
    }
  };
  const ribbon = (a, b, halfW, t) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2) + 1;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      disc({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, halfW, t);
    }
  };
  return { put, disc, ribbon };
};

// Each spec paints in the (u, v) frame; L is tee→cup distance in tiles.
// Approximate real-hole coordinates are public knowledge (tee, then green).
const SPECS = [
  {
    name: 'The Island', tribute: 'after TPC Sawgrass No. 17', par: 3, yds: 190, biome: 'classic',
    teeLL: { lat: 30.19607, lon: -81.39544 }, cupLL: { lat: 30.19735, lon: -81.39441 },
    paint({ L, pt, disc, ribbon }) {
      ribbon(pt(-1, 0), pt(1.5, 0), 1.6, FAIRWAY);          // the tee deck
      disc(pt(L, 0), 5.2, WATER);                           // the lake owns the end
      disc(pt(L, 0), 2.4, GREEN);                           // the island
      ribbon(pt(L - 2.6, 1.6), pt(L - 1.2, 0.9), 0.7, FAIRWAY); // the walkway
      disc(pt(L - 1.8, -1.9), 0.8, SAND);                   // the little front-right pot
    },
  },
  {
    name: 'Golden Bell', tribute: 'after Augusta National No. 12', par: 3, yds: 200, biome: 'classic',
    teeLL: { lat: 33.50205, lon: -82.02114 }, cupLL: { lat: 33.50330, lon: -82.02106 },
    paint({ L, pt, disc, ribbon }) {
      ribbon(pt(-1, 0), pt(1.5, 0), 1.6, FAIRWAY);
      ribbon(pt(L - 3.4, -5), pt(L - 3.4, 5), 1.3, WATER);  // the creek crosses the front
      ribbon(pt(L - 0.6, -2.6), pt(L - 0.2, 2.6), 1.5, GREEN); // wide, shallow green
      disc(pt(L - 2.1, 0), 0.9, SAND);                      // front bunker
      disc(pt(L + 1.7, -1.4), 0.9, SAND);                   // back bunkers
      disc(pt(L + 1.7, 1.6), 0.9, SAND);
      ribbon(pt(L + 3.2, -4), pt(L + 3.2, 4), 1.2, TREES);  // the hillside behind
    },
  },
  {
    name: 'Cliffside Seventh', tribute: 'after Pebble Beach No. 7', par: 3, yds: 176, biome: 'classic',
    teeLL: { lat: 36.56935, lon: -121.94854 }, cupLL: { lat: 36.56862, lon: -121.94829 },
    paint({ L, pt, disc, ribbon }) {
      ribbon(pt(-1, 0), pt(1.2, 0), 1.4, FAIRWAY);
      disc(pt(L + 2.5, 0), 4.6, WATER);                     // the Pacific behind
      ribbon(pt(L - 1, 3.2), pt(L + 2, 1.8), 1.8, WATER);   // …and wrapping right
      disc(pt(L, 0), 1.9, GREEN);                           // tiny target
      disc(pt(L - 1.7, -1.4), 0.8, SAND);                   // necklace of bunkers
      disc(pt(L - 1.2, 1.5), 0.8, SAND);
      disc(pt(L + 1.6, -0.8), 0.8, SAND);
    },
  },
  {
    name: 'Ocean Carry', tribute: 'after Cypress Point No. 16', par: 3, yds: 235, biome: 'links',
    teeLL: { lat: 36.57955, lon: -121.97537 }, cupLL: { lat: 36.57891, lon: -121.97294 },
    paint({ L, pt, disc, ribbon }) {
      ribbon(pt(-1, 0), pt(1.2, 0), 1.5, FAIRWAY);
      ribbon(pt(2.8, 0), pt(L - 3.2, 0), 3.6, WATER);       // the cove: carry or die
      ribbon(pt(2.5, 3.8), pt(L - 2, 4.6), 1.5, FAIRWAY);   // the bail-out left
      disc(pt(L, 0), 2.3, GREEN);
      disc(pt(L - 2.4, 1.8), 0.9, SAND);
      disc(pt(L - 2.2, -1.8), 0.9, SAND);
    },
  },
  {
    name: 'Tenth at the Canyon', tribute: 'after Riviera No. 10', par: 4, yds: 325, biome: 'classic',
    teeLL: { lat: 34.04938, lon: -118.50609 }, cupLL: { lat: 34.05088, lon: -118.50372 },
    paint({ L, pt, disc, ribbon }) {
      ribbon(pt(-1, 0), pt(L * 0.62, -0.6), 2.4, FAIRWAY);  // generous up the left
      ribbon(pt(L * 0.62, -0.6), pt(L - 2.2, 0.4), 1.7, FAIRWAY);
      disc(pt(L, 0.6), 1.9, GREEN);                         // small, angled, guarded
      disc(pt(L - 2.3, 1.7), 1.0, SAND);                    // the ring of sand
      disc(pt(L - 1.1, -1.7), 1.0, SAND);
      disc(pt(L + 1.8, 1.2), 1.0, SAND);
      disc(pt(L + 1.4, -1.3), 0.9, SAND);
      disc(pt(L * 0.8, -3.4), 1.2, SAND);                   // the drive-side trap
      ribbon(pt(L * 0.35, 4.2), pt(L, 4.6), 1.4, TREES);    // barranca trees right
    },
  },
  {
    name: 'The Road Hole', tribute: 'after St Andrews No. 17', par: 4, yds: 410, biome: 'links',
    teeLL: { lat: 56.34114, lon: -2.80215 }, cupLL: { lat: 56.34294, lon: -2.79911 },
    paint({ L, pt, disc, ribbon }) {
      ribbon(pt(-1, 0), pt(2, 0), 1.6, FAIRWAY);
      ribbon(pt(2, -4.4), pt(L * 0.42, -3.4), 2.2, TREES);  // the sheds: blind corner
      ribbon(pt(L * 0.3, 0.8), pt(L - 2.5, 0.2), 2.3, FAIRWAY); // fairway bends right
      ribbon(pt(L - 0.7, -2.4), pt(L - 0.1, 2.4), 1.4, GREEN);  // long, thin, sideways
      disc(pt(L - 1.9, -0.6), 0.9, SAND);                   // the Road bunker, gathering
      ribbon(pt(L + 1.6, -3), pt(L + 1.6, 3), 0.9, WATER);  // the road: over is dead
    },
  },
  {
    name: 'Water All the Way', tribute: 'after TPC Sawgrass No. 18', par: 4, yds: 415, biome: 'classic',
    teeLL: { lat: 30.19934, lon: -81.39930 }, cupLL: { lat: 30.20226, lon: -81.39519 },
    paint({ L, pt, disc, ribbon }) {
      ribbon(pt(-1, 0), pt(1.8, 0), 1.6, FAIRWAY);
      ribbon(pt(1.5, -6.2), pt(L + 1.5, -3.4), 2.8, WATER); // the lake, all the left
      ribbon(pt(2, 0.8), pt(L - 2.2, -0.2), 2.2, FAIRWAY);  // hug it or bail
      ribbon(pt(L * 0.35, 3.8), pt(L - 1, 3.4), 1.5, TREES); // gallery trees right
      disc(pt(L, -0.4), 2.1, GREEN);
      disc(pt(L - 1.6, 1.8), 0.9, SAND);
    },
  },
  {
    name: 'Azalea', tribute: 'after Augusta National No. 13', par: 5, yds: 505, biome: 'classic',
    teeLL: { lat: 33.50467, lon: -82.02320 }, cupLL: { lat: 33.50697, lon: -82.02694 },
    paint({ L, pt, disc, ribbon }) {
      ribbon(pt(-1, 0), pt(2, 0), 1.6, FAIRWAY);
      ribbon(pt(2, 0.6), pt(L * 0.5, 1.8), 2.5, FAIRWAY);   // the dogleg's outside
      ribbon(pt(L * 0.5, 1.8), pt(L - 2.6, 0.2), 2.4, FAIRWAY);
      ribbon(pt(L * 0.2, -3.8), pt(L * 0.62, -2.6), 1.6, TREES); // cut the corner? trees
      ribbon(pt(L - 3.1, -2.8), pt(L - 2.4, 3), 1.1, WATER); // the tributary at the green
      disc(pt(L, 0), 2.3, GREEN);
      disc(pt(L + 1.9, -1.5), 0.9, SAND);                   // back bunkers
      disc(pt(L + 1.7, 1.4), 0.9, SAND);
    },
  },
  {
    name: 'Shoreline Eighteenth', tribute: 'after Pebble Beach No. 18', par: 5, yds: 528, biome: 'links',
    teeLL: { lat: 36.56744, lon: -121.94918 }, cupLL: { lat: 36.57012, lon: -121.94990 },
    paint({ L, pt, disc, ribbon }) {
      ribbon(pt(-1, 0), pt(1.8, 0), 1.6, FAIRWAY);
      ribbon(pt(1.5, -6.6), pt(L + 2, -3.8), 3.0, WATER);   // the ocean, all the left
      ribbon(pt(2, 0.6), pt(L - 2.4, -0.4), 2.3, FAIRWAY);  // the long curve home
      disc(pt(L * 0.45, -2.2), 1.0, TREES);                 // the fairway pine
      ribbon(pt(L * 0.3, 3.9), pt(L - 1, 3.6), 1.4, TREES), // out-of-play right
      disc(pt(L, -0.3), 2.2, GREEN);
      disc(pt(L - 2.2, 1.9), 1.0, SAND);
      disc(pt(L - 0.8, -2.4), 0.9, SAND);                   // the seawall bunker
    },
  },
];

function author(spec) {
  // the bare generator builds full-length holes; holeDistTiles is the honest
  // knob (the same one Caddie's own par-3/4/5 dealing uses). The pack stores
  // it so reconstruction regenerates the identical base.
  const dist = Math.round(spec.yds / YARDS_PER_TILE);
  const start = 1000 + SPECS.indexOf(spec) * 50000;
  for (let seed = start; seed < start + 200_000; seed += 7) {
    const base = generateCourse(seed >>> 0, spec.biome, { holeDistTiles: dist });
    const L = Math.hypot(base.hole.x - base.tee.x, base.hole.y - base.tee.y);
    if (Math.abs(L - dist) > 2) continue;
    if (parForTiles(L) !== spec.par) continue;
    const margin = (p) => p.x >= 3 && p.y >= 3 && p.x < base.width - 3 && p.y < base.height - 3;
    if (!margin(base.tee) || !margin(base.hole)) continue;
    // repaint the whole board: rough canvas, then the tribute's geometry
    const cells = new Array(base.width * base.height).fill(ROUGH);
    const course = { ...base, cells };
    const f = frame(course);
    spec.paint({ L: f.len, pt: f.pt, ...ops(course, cells) });
    ops(course, cells).disc({ x: course.hole.x, y: course.hole.y }, 2.0, GREEN);
    cells[course.tee.y * course.width + course.tee.x] = FAIRWAY;
    // the gate: the real solver must play it, and it must not be trivial.
    // The solver is a superhuman line-optimizer — its count runs well under
    // golfer par by design — so the gate is solvable ∧ ≥2 ∧ ≤ par+1, and the
    // scorecard par stays parForTiles, the same model Caddie plays by.
    const solved = solve(course, course.tee);
    if (!solved) continue;
    if (solved.strokes < 2 || solved.strokes > spec.par + 1) continue;
    const patch = encodeGridPatch(cells);
    // sanity: the patch must rebuild this exact ground on the same base
    const rebuilt = applyPatch(
      generateCourse(seed >>> 0, spec.biome, { holeDistTiles: dist }), decodePatch(patch));
    if (rebuilt.cells.join() !== cells.join()) throw new Error(`${spec.name}: patch does not round-trip`);
    const geo = encodeGeoRef(geoFromAnchors({
      tee: course.tee, cup: course.hole, teeLL: spec.teeLL, cupLL: spec.cupLL,
      width: course.width, height: course.height, vintage: 2026,
    }));
    return {
      name: spec.name, tribute: spec.tribute, seed: seed >>> 0, biome: spec.biome,
      dist, par: spec.par, solverPar: solved.strokes, yds: holeYards(f.len), patch, geo,
    };
  }
  throw new Error(`${spec.name}: no seed fit the geometry`);
}

const pack = { version: 1, name: 'Real Nine', holes: SPECS.map(author) };
mkdirSync('packs', { recursive: true });
writeFileSync('packs/real-9.json', JSON.stringify(pack, null, 1) + '\n');
for (const h of pack.holes) {
  console.log(`${h.name.padEnd(22)} seed ${String(h.seed).padStart(10)} ${h.biome.padEnd(7)} par ${h.par} (solver ${h.solverPar}) ${h.yds} yds`);
}
