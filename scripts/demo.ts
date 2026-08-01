/**
 * Milestone 1 acceptance CLI.
 *
 * Prints an ASCII expected-strokes contour map of the cape hole for two
 * profiles (5 and 20 handicap, same speed and shape) and shows the optimal
 * aim shifting away from the water as dispersion widens.
 *
 *   npm run demo
 */

import { capeHole, CAPE_APPROACH, CAPE_TEE } from '../lib/engine/holes/cape';
import type { YardPuzzle } from '../lib/engine/holes/cape';
import { prepareHole, classifyPoint } from '../lib/engine/hole';
import { evaluateGrid } from '../lib/engine/optimize';
import { puzzleRatingFromTrap } from '../lib/engine/scoring';
import { dist } from '../lib/engine/projection';
import type {
  EvalGrid,
  LieBreakdown,
  PlayerProfile,
  PreparedHole,
  Pt,
} from '../lib/engine/types';
import type { Situation } from '../lib/engine/evaluate';

const P5: PlayerProfile = { handicap: 5, clubSpeedMph: 110, shotShape: 'draw' };
const P20: PlayerProfile = { handicap: 20, clubSpeedMph: 110, shotShape: 'draw' };

// Expected-strokes bands above the optimum, mirroring the reveal isolines.
const BANDS: [number, string][] = [
  [0.03, '.'],
  [0.1, ':'],
  [0.25, '-'],
  [0.5, '='],
  [1.0, '%'],
  [Infinity, '#'],
];

function bandChar(delta: number): string {
  for (const [max, ch] of BANDS) if (delta <= max) return ch;
  return '#';
}

function near(p: Pt, x: number, y: number, tol: number): boolean {
  return Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol;
}

function renderMap(prepared: PreparedHole, sit: Situation, grid: EvalGrid): string[] {
  const { origin, cellSize, width, height, values } = grid;
  const half = cellSize / 2;

  let minCol = width;
  let maxCol = -1;
  let minRow = height;
  let maxRow = -1;
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (Number.isFinite(values[r * width + c])) {
        if (c < minCol) minCol = c;
        if (c > maxCol) maxCol = c;
        if (r < minRow) minRow = r;
        if (r > maxRow) maxRow = r;
      }
    }
  }
  minRow = Math.max(0, minRow - 1);
  maxRow = Math.min(height - 1, maxRow + 2);

  const lines: string[] = [];
  // Top of the map is the far end (high y); rows subsampled 2:1 for aspect.
  for (let r = maxRow; r >= minRow; r -= 2) {
    let line = '';
    for (let c = minCol; c <= maxCol; c++) {
      const p: Pt = { x: origin.x + c * cellSize, y: origin.y + r * cellSize };
      const v = values[r * width + c]!;

      if (near(sit.ball, p.x, p.y, half)) {
        line += 'B';
        continue;
      }
      if (near(sit.pin, p.x, p.y, half)) {
        line += 'F';
        continue;
      }
      if (near(grid.optimal.point, p.x, p.y, half)) {
        line += '*';
        continue;
      }
      if (near(grid.naive.point, p.x, p.y, half)) {
        line += '+';
        continue;
      }

      const lie = classifyPoint(prepared, p);
      if (lie === 'water') line += '~';
      else if (lie === 'ob') line += 'X';
      else if (lie === 'sand') line += 'o';
      else if (lie === 'recovery') line += '^';
      else if (lie === 'green') line += 'G';
      else if (Number.isFinite(v)) line += bandChar(v - grid.optimal.expectedStrokes);
      else line += ' ';
    }
    lines.push(line);
  }
  return lines;
}

function fmtBreakdown(b: LieBreakdown): string {
  return Object.entries(b)
    .sort(([, a], [, bb]) => (bb ?? 0) - (a ?? 0))
    .filter(([, v]) => (v ?? 0) >= 0.005)
    .map(([k, v]) => `${k} ${Math.round((v ?? 0) * 100)}%`)
    .join(' · ');
}

function report(
  prepared: PreparedHole,
  puzzle: YardPuzzle,
  profile: PlayerProfile,
  grid: EvalGrid,
): void {
  const sit: Situation = { ball: puzzle.ball, lie: puzzle.lie, pin: prepared.pin };
  const o = grid.optimal;
  const nv = grid.naive;
  console.log(
    `\n— ${profile.handicap} handicap · ${profile.clubSpeedMph} mph · ${profile.shotShape} —`,
  );
  for (const line of renderMap(prepared, sit, grid)) console.log(line);
  console.log(
    `\n  optimal aim   (${o.point.x.toFixed(0)}, ${o.point.y.toFixed(0)})y` +
      `  ${dist(sit.ball, o.point).toFixed(0)}y ${o.result.outcomeStats.club.label}` +
      `  E=${o.expectedStrokes.toFixed(3)}`,
  );
  console.log(`                ${fmtBreakdown(o.result.outcomeStats.lieBreakdown)}`);
  console.log(
    `  naive aim     (${nv.point.x.toFixed(0)}, ${nv.point.y.toFixed(0)})y` +
      `  E=${nv.expectedStrokes.toFixed(3)}  (${
        puzzle.category === 'tee' ? 'fairway center at driver range' : 'straight at the pin'
      })`,
  );
  console.log(`                ${fmtBreakdown(nv.result.outcomeStats.lieBreakdown)}`);
  console.log(
    `  trap size     ${grid.trapSize.toFixed(3)} strokes → puzzle rating ${puzzleRatingFromTrap(
      grid.trapSize,
    )}`,
  );
}

function runPuzzle(prepared: PreparedHole, puzzle: YardPuzzle): void {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`PUZZLE ${puzzle.id} — ${puzzle.description}`);
  console.log('='.repeat(72));
  console.log(
    'legend  B ball · F pin · * optimal aim · + naive aim · ~ water · o sand',
  );
  console.log(
    '        ^ trees · X out of bounds · G green · isolines vs optimal:',
  );
  console.log(
    '        "." ≤0.03  ":" ≤0.10  "-" ≤0.25  "=" ≤0.50  "%" ≤1.00  "#" >1.00',
  );

  const sit: Situation = { ball: puzzle.ball, lie: puzzle.lie, pin: prepared.pin };
  const g5 = evaluateGrid(prepared, sit, P5, puzzle.category);
  const g20 = evaluateGrid(prepared, sit, P20, puzzle.category);
  report(prepared, puzzle, P5, g5);
  report(prepared, puzzle, P20, g20);

  const shift = g5.optimal.point.x - g20.optimal.point.x;
  console.log(
    `\n  OPTIMAL SHIFT 5 → 20 handicap: ${Math.abs(shift).toFixed(0)}y ${
      shift >= 0 ? 'away from the water (left)' : 'toward the water (right)'
    }, ` +
      `(${g5.optimal.point.x.toFixed(0)}, ${g5.optimal.point.y.toFixed(0)}) → ` +
      `(${g20.optimal.point.x.toFixed(0)}, ${g20.optimal.point.y.toFixed(0)})`,
  );
}

const hole = capeHole();
const prepared = prepareHole(hole);
console.log(
  `\n${hole.courseName} — No. ${hole.holeNumber} · "The Cape" · par ${hole.par} · ${hole.yardage}y`,
);
const t0 = Date.now();
runPuzzle(prepared, CAPE_TEE);
runPuzzle(prepared, CAPE_APPROACH);
console.log(`\ncomputed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
