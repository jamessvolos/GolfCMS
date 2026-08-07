// Thin leaderboard service — a separate, optional companion to GolfCMS.
// The game never depends on this; it only ever *offers* scores to it.
// Cheat-proofing is determinism: a submission is a ghost replay string,
// and the server re-simulates it against the seed. Only what actually
// holes out is accepted, and the stroke count is whatever the engine
// says — never a client-sent number.
//
// Node built-ins only. Run: node server/leaderboard.js [port]

import http from 'node:http';
import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

import { makePuzzle, DIFFICULTIES } from '../src/engine/puzzle.js';
import { BIOMES } from '../src/engine/generate.js';
import { decodeReplay, ghostPath } from '../src/engine/replay.js';

const MAX_BODY = 64 * 1024;
const BOARD_CAP = 20;
const MAX_NAME = 24;

/**
 * @param {{file?: string}} [options] optional JSON persistence file
 * @returns {import('node:http').Server}
 */
export function createServer(options = {}) {
  const file = options.file ?? process.env.GOLFCMS_BOARD_FILE ?? null;
  /** @type {Map<string, Array<{name:string,strokes:number,replay:string,at:number}>>} */
  const boards = new Map();

  if (file) loadBoards(file, boards);

  const server = http.createServer((req, res) => {
    // Permissive CORS: the game may be served from anywhere (or file://).
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);

    if (req.method === 'POST' && url.pathname === '/scores') {
      readBody(req, res, (body) => handleSubmit(body, res, boards, file));
      return;
    }

    if (req.method === 'GET' && parts.length === 4 && parts[0] === 'scores') {
      handleList(parts[1], parts[2], parts[3], res, boards);
      return;
    }

    sendJSON(res, 404, { error: 'not found' });
  });

  return server;
}

function handleSubmit(raw, res, boards, file) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return sendJSON(res, 400, { error: 'malformed JSON' });
  }
  if (typeof body !== 'object' || body === null) {
    return sendJSON(res, 400, { error: 'body must be a JSON object' });
  }

  const { seed, difficulty, biome, replay } = body;
  if (!Number.isInteger(seed) || seed < 0) {
    return sendJSON(res, 400, { error: 'seed must be a non-negative integer' });
  }
  if (!DIFFICULTIES.includes(difficulty)) {
    return sendJSON(res, 400, { error: `difficulty must be one of ${DIFFICULTIES.join(', ')}` });
  }
  if (!BIOMES.includes(biome)) {
    return sendJSON(res, 400, { error: `biome must be one of ${BIOMES.join(', ')}` });
  }
  if (typeof replay !== 'string' || replay.length === 0) {
    return sendJSON(res, 400, { error: 'replay must be a non-empty hex string' });
  }
  if (body.name !== undefined && typeof body.name !== 'string') {
    return sendJSON(res, 400, { error: 'name must be a string' });
  }
  const name = cleanName(body.name);

  // The heart of the service: re-simulate. The replay either holes out
  // against the deterministic puzzle for this seed, or it is worthless.
  let puzzle, shots;
  try {
    puzzle = makePuzzle(seed, difficulty, biome);
    shots = decodeReplay(replay);
  } catch (err) {
    return sendJSON(res, 400, { error: String(err.message ?? err) });
  }
  const ghost = ghostPath(puzzle.course, puzzle.start, shots);
  if (!ghost.holed) {
    return sendJSON(res, 422, { error: 'replay does not hole out' });
  }

  const key = `${seed}/${difficulty}/${biome}`;
  const board = boards.get(key) ?? [];
  const entry = { name, strokes: ghost.strokes, replay, at: Date.now() };
  board.push(entry);
  board.sort((a, b) => a.strokes - b.strokes || a.at - b.at);
  board.length = Math.min(board.length, BOARD_CAP);
  boards.set(key, board);
  if (file) saveBoards(file, boards);

  const rank = board.indexOf(entry) + 1; // 0 if capped off the board
  sendJSON(res, 200, {
    rank: rank || board.length + 1,
    of: board.length,
    strokes: ghost.strokes,
  });
}

function handleList(seedStr, difficulty, biome, res, boards) {
  const seed = Number(seedStr);
  if (!Number.isInteger(seed) || seed < 0) {
    return sendJSON(res, 400, { error: 'seed must be a non-negative integer' });
  }
  if (!DIFFICULTIES.includes(difficulty) || !BIOMES.includes(biome)) {
    return sendJSON(res, 400, { error: 'unknown difficulty or biome' });
  }
  let puzzle;
  try {
    puzzle = makePuzzle(seed, difficulty, biome);
  } catch (err) {
    return sendJSON(res, 400, { error: String(err.message ?? err) });
  }
  const board = boards.get(`${seed}/${difficulty}/${biome}`) ?? [];
  sendJSON(res, 200, {
    board: board.map(({ name, strokes, at }) => ({ name, strokes, at })),
    par: puzzle.par,
  });
}

function cleanName(name) {
  if (typeof name !== 'string') return 'anon';
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, MAX_NAME).trim();
  return cleaned || 'anon';
}

function readBody(req, res, cb) {
  const chunks = [];
  let size = 0;
  let tooBig = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      tooBig = true;
      req.destroy();
      sendJSON(res, 400, { error: 'body too large' });
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (!tooBig) cb(Buffer.concat(chunks).toString('utf8'));
  });
  req.on('error', () => {});
}

function sendJSON(res, status, obj) {
  if (res.writableEnded) return;
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function loadBoards(file, boards) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    for (const [key, entries] of Object.entries(data)) {
      if (Array.isArray(entries)) boards.set(key, entries);
    }
  } catch {
    // Missing or corrupt file: start fresh. The board is best-effort state.
  }
}

function saveBoards(file, boards) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(boards)));
    renameSync(tmp, file); // atomic-ish: readers never see a half-written file
  } catch {
    // Persistence is optional; never let a disk hiccup break scoring.
  }
}

// Main entry: `node server/leaderboard.js [port]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2]) || 8787;
  const server = createServer();
  server.listen(port, () => {
    console.log(`GolfCMS leaderboard listening on http://localhost:${port}`);
  });
}
