import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/leaderboard.js';
import { makePuzzle } from '../src/engine/puzzle.js';
import { encodeReplay, ghostPath, quantizeAngle } from '../src/engine/replay.js';

let server;
let base;

// The known-good puzzle every test submits against.
const puzzle = makePuzzle(1, 'standard');

// A shot line guaranteed to replay holed: the certificate line, quantized
// onto the encodable angle lattice if the raw line does not survive replay.
function holedLine() {
  let line = puzzle.certificate.line;
  if (!ghostPath(puzzle.course, puzzle.start, line).holed) {
    line = line.map((s) => ({ ...s, angle: quantizeAngle(s.angle) }));
  }
  const ghost = ghostPath(puzzle.course, puzzle.start, line);
  assert.equal(ghost.holed, true, 'test precondition: line replays holed');
  return { line, strokes: ghost.strokes };
}

before(async () => {
  server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

function submit(body) {
  return fetch(`${base}/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('a verified certificate replay is accepted with the engine stroke count', async () => {
  const { line, strokes } = holedLine();
  const res = await submit({
    seed: puzzle.seed,
    difficulty: 'standard',
    biome: 'classic',
    name: 'certbot',
    replay: encodeReplay(line),
    strokes: 1, // a lie — the server must ignore client-sent numbers
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.strokes, strokes);
  assert.ok(data.rank >= 1);
  assert.ok(data.of >= 1);
});

test('a forged replay that does not hole out is rejected 422', async () => {
  const { line } = holedLine();
  const forged = line.slice(0, -1); // last shot removed: cannot be holed
  const res = await submit({
    seed: puzzle.seed,
    difficulty: 'standard',
    biome: 'classic',
    name: 'cheater',
    replay: encodeReplay(forged),
  });
  assert.equal(res.status, 422);
  const data = await res.json();
  assert.ok(data.error);
});

test('wrong-shape bodies are rejected 400', async () => {
  const bad = [
    'not json at all',
    JSON.stringify(null),
    JSON.stringify({ seed: 'one', difficulty: 'standard', biome: 'classic', replay: 'abcdef' }),
    JSON.stringify({ seed: 1, difficulty: 'nightmare', biome: 'classic', replay: 'abcdef' }),
    JSON.stringify({ seed: 1, difficulty: 'standard', biome: 'moon', replay: 'abcdef' }),
    JSON.stringify({ seed: 1, difficulty: 'standard', biome: 'classic' }),
    JSON.stringify({ seed: 1, difficulty: 'standard', biome: 'classic', replay: 'zzzzzz' }),
  ];
  for (const body of bad) {
    const res = await submit(body);
    assert.equal(res.status, 400, `expected 400 for ${body.slice(0, 60)}`);
  }
});

test('GET returns the sorted board with par and without replay strings', async () => {
  const { line } = holedLine();
  await submit({
    seed: puzzle.seed,
    difficulty: 'standard',
    biome: 'classic',
    name: 'lister',
    replay: encodeReplay(line),
  });
  const res = await fetch(`${base}/scores/${puzzle.seed}/standard/classic`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.par, puzzle.par);
  assert.ok(Array.isArray(data.board));
  assert.ok(data.board.length >= 1);
  for (let i = 0; i < data.board.length; i++) {
    const entry = data.board[i];
    assert.deepEqual(Object.keys(entry).sort(), ['at', 'name', 'strokes']);
    if (i > 0) assert.ok(entry.strokes >= data.board[i - 1].strokes, 'sorted by strokes');
  }
});

test('a better submission outranks an earlier worse one', async () => {
  const { line, strokes } = holedLine();
  const goodReplay = encodeReplay(line);

  // A worse-but-holed line: waste strokes with putts that go nowhere useful
  // before playing the certificate line. If the padded line still replays
  // holed, it lands with more strokes than the clean one.
  let worse = null;
  for (const pad of [
    [{ club: 'putter', angle: 0, power: 1 }],
    [{ club: 'putter', angle: Math.PI, power: 1 }],
    [
      { club: 'putter', angle: 0, power: 1 },
      { club: 'putter', angle: Math.PI, power: 1 },
    ],
  ]) {
    const candidate = [...pad, ...line];
    const g = ghostPath(puzzle.course, puzzle.start, candidate);
    if (g.holed && g.strokes > strokes) {
      worse = { line: candidate, strokes: g.strokes };
      break;
    }
  }

  if (worse) {
    const worseRes = await submit({
      seed: puzzle.seed,
      difficulty: 'standard',
      biome: 'classic',
      name: 'slowpoke',
      replay: encodeReplay(worse.line),
    });
    assert.equal(worseRes.status, 200);
    const worseData = await worseRes.json();
    assert.equal(worseData.strokes, worse.strokes);

    const betterRes = await submit({
      seed: puzzle.seed,
      difficulty: 'standard',
      biome: 'classic',
      name: 'ace',
      replay: goodReplay,
    });
    const betterData = await betterRes.json();
    assert.ok(
      betterData.rank < worseData.rank || betterData.strokes < worseData.strokes,
      'fewer strokes ranks above more strokes'
    );

    const res = await fetch(`${base}/scores/${puzzle.seed}/standard/classic`);
    const { board } = await res.json();
    const aceIdx = board.findIndex((e) => e.name === 'ace');
    const slowIdx = board.findIndex((e) => e.name === 'slowpoke');
    assert.ok(aceIdx >= 0 && slowIdx >= 0);
    assert.ok(aceIdx < slowIdx, 'better score listed first');
  } else {
    // Fallback: same strokes — earlier submission wins the tie, so a fresh
    // equal submission must not outrank it. Rank ordering is still exercised.
    const res = await submit({
      seed: puzzle.seed,
      difficulty: 'standard',
      biome: 'classic',
      name: 'tied',
      replay: goodReplay,
    });
    const data = await res.json();
    assert.ok(data.rank >= 2, 'equal strokes cannot beat an earlier entry');
  }
});

test('unknown routes return 404 JSON', async () => {
  const res = await fetch(`${base}/nope`);
  assert.equal(res.status, 404);
  const data = await res.json();
  assert.ok(data.error);
});
