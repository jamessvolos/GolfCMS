// Creator-mode patches: a hole edit is a diff against its generated base
// course, packed 4 hex chars per changed tile (12-bit cell index + 4-bit
// terrain). A shared creation is still just a URL: seed + patch.

import { TERRAIN_NAMES } from './terrain.js';

const MAX_EDITS = 400;

/** @param {Array<{i: number, t: number}>} edits */
export function encodePatch(edits) {
  if (edits.length > MAX_EDITS) throw new Error(`patch too large (${edits.length} edits)`);
  return edits.map(({ i, t }) => {
    if (i < 0 || i >= 4096 || t < 0 || t >= TERRAIN_NAMES.length) {
      throw new Error(`bad edit ${i}:${t}`);
    }
    return ((i << 4) | t).toString(16).padStart(4, '0');
  }).join('');
}

/**
 * Full-grid patch: `g` + one hex nibble per cell, in row order. The escape
 * hatch for traced holes — an aerial trace legitimately repaints most of the
 * board, where the diff format's 400-edit cap (and its 4 chars per tile)
 * stops making sense. At 960 cells the whole grid is 961 characters: still
 * comfortably a URL.
 */
export function encodeGridPatch(cells) {
  if (cells.length === 0 || cells.length > 4096) throw new Error(`bad grid size (${cells.length})`);
  let out = 'g';
  for (const t of cells) {
    if (t < 0 || t >= TERRAIN_NAMES.length) throw new Error(`bad terrain ${t}`);
    out += t.toString(16);
  }
  return out;
}

/** @returns {Array<{i: number, t: number}>} */
export function decodePatch(str) {
  if (/^g/i.test(str)) {
    const body = str.slice(1);
    if (!/^[0-9a-f]+$/i.test(body) || body.length > 4096) throw new Error('malformed grid patch');
    const edits = [];
    for (let i = 0; i < body.length; i++) {
      const t = parseInt(body[i], 16);
      if (t >= TERRAIN_NAMES.length) throw new Error('unknown terrain in patch');
      edits.push({ i, t });
    }
    return edits;
  }
  if (!/^([0-9a-f]{4})*$/i.test(str)) throw new Error('malformed patch string');
  if (str.length / 4 > MAX_EDITS) throw new Error('patch too large');
  const edits = [];
  for (let k = 0; k < str.length; k += 4) {
    const v = parseInt(str.slice(k, k + 4), 16);
    const i = v >> 4;
    const t = v & 15;
    if (t >= TERRAIN_NAMES.length) throw new Error('unknown terrain in patch');
    edits.push({ i, t });
  }
  return edits;
}

/** Apply a patch to a course, returning a new course. Tee and hole tiles are
 *  immutable — a patch can reshape the ground, not move the puzzle's anchors. */
export function applyPatch(course, edits) {
  const cells = [...course.cells];
  const teeI = course.tee.y * course.width + course.tee.x;
  const holeI = course.hole.y * course.width + course.hole.x;
  for (const { i, t } of edits) {
    if (i >= cells.length || i === teeI || i === holeI) continue;
    cells[i] = t;
  }
  return { ...course, cells };
}

/** Diff an edited course against its base → minimal patch. */
export function diffCourses(base, edited) {
  const edits = [];
  for (let i = 0; i < base.cells.length; i++) {
    if (edited.cells[i] !== base.cells[i]) edits.push({ i, t: edited.cells[i] });
  }
  return edits;
}
