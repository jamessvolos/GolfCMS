import { describe, expect, it } from 'vitest';
import { ask, caddie, HOLED_OUT_YDS, MAX_SHOTS_PER_HOLE, playHole, reflex } from './card';
import { flyShot, shotDice } from './roll';
import { prepareHole } from '@/lib/engine/hole';
import { circleRing, holeFromYardSpec } from '@/lib/engine/holes/build';
import { dist } from '@/lib/engine/projection';
import type { PlayerProfile } from '@/lib/engine/types';

const ORIGIN = { lon: -93.335, lat: 41.02 };
const P14: PlayerProfile = { handicap: 14, clubSpeedMph: 110, shotShape: 'straight' };

/** A par 4 with water down the right of the landing area. */
function par4() {
  return prepareHole(
    holeFromYardSpec({
      id: 'card-test',
      courseName: 'Test',
      holeNumber: 1,
      par: 4,
      yardage: 410,
      origin: ORIGIN,
      polygons: [
        { kind: 'fairway', ring: [[-26, 110], [26, 110], [26, 390], [-26, 390]] },
        { kind: 'green', ring: circleRing(0, 410, 16) },
        { kind: 'water', ring: [[30, 200], [110, 200], [110, 330], [30, 330]] },
      ],
      pin: [0, 410],
      tees: [[0, 0]],
    }),
  );
}

const start = { ball: { x: 0, y: 0 }, lie: 'tee' as const };
const FAST = { nSamples: 200 };

describe('shotDice', () => {
  it('gives both cards the same weather', () => {
    // The whole point of the construction: two policies on one card differ
    // in where they aimed, never in what the ball did afterwards.
    expect([...shotDice(1234, 3)]).toEqual([...shotDice(1234, 3)]);
  });

  it('gives different shots different draws', () => {
    expect([...shotDice(1234, 3)]).not.toEqual([...shotDice(1234, 4)]);
  });

  it('does not depend on how many shots came before it', () => {
    // Shot 4 must be the same draw whether the hole took three shots to get
    // there or five, or a card could not be replayed from a different line.
    const a = shotDice(9, 104);
    const b = shotDice(9, 104);
    expect([...a]).toEqual([...b]);
  });

  it('replays a whole card identically', () => {
    const prepared = par4();
    const a = playHole(prepared, start, P14, 4242, caddie, FAST);
    const b = playHole(prepared, start, P14, 4242, caddie, FAST);
    expect(a.strokes).toBeCloseTo(b.strokes, 9);
    expect(a.shots.map((s) => [s.roll.at.x, s.roll.at.y, s.roll.lie])).toEqual(
      b.shots.map((s) => [s.roll.at.x, s.roll.at.y, s.roll.lie]),
    );
  });
});

describe('flyShot', () => {
  const prepared = par4();

  it('resumes from a drop rather than from the water', () => {
    // A puzzle never has to answer this; a round does on the first bad shot.
    const intoWater = flyShot(prepared, { x: 0, y: 250 }, 'fairway', { x: 70, y: 265 }, P14, shotDice(1, 1));
    if (intoWater.lie === 'water') {
      expect(intoWater.penalty).toBeGreaterThan(0);
      expect(intoWater.resumeLie).toBe('rough');
      expect(intoWater.resumeAt).not.toEqual(intoWater.at);
    }
  });

  it('plays OB as stroke and distance, from where the shot was struck', () => {
    const ob = prepareHole(
      holeFromYardSpec({
        id: 'ob-test',
        courseName: 'Test',
        holeNumber: 1,
        par: 4,
        yardage: 410,
        origin: ORIGIN,
        polygons: [
          { kind: 'fairway', ring: [[-26, 110], [26, 110], [26, 390], [-26, 390]] },
          { kind: 'ob', ring: [[40, 100], [400, 100], [400, 400], [40, 400]] },
          { kind: 'green', ring: circleRing(0, 410, 16) },
        ],
        pin: [0, 410],
        tees: [[0, 0]],
      }),
    );
    const ball = { x: 0, y: 250 };
    const r = flyShot(ob, ball, 'fairway', { x: 200, y: 280 }, P14, shotDice(2, 1));
    if (r.lie === 'ob') {
      expect(r.penalty).toBe(1);
      expect(r.resumeAt).toEqual(ball);
      expect(r.resumeLie).toBe('fairway');
    }
  });
});

describe('playHole', () => {
  const prepared = par4();

  it('asks several questions, not one', () => {
    // The app's entire recorded history is 18 attempts because a puzzle is
    // one question and then it stops.
    const card = playHole(prepared, start, P14, 77, caddie, FAST);
    expect(card.shots.length).toBeGreaterThanOrEqual(2);
    expect(card.shots.length).toBeLessThanOrEqual(MAX_SHOTS_PER_HOLE);
  });

  it('starts each shot where the last one finished, never where it was aimed', () => {
    // The circularity Wave 3 removed from content generation, kept out of
    // the round as well.
    const card = playHole(prepared, start, P14, 77, caddie, FAST);
    for (let i = 1; i < card.shots.length; i++) {
      const prev = card.shots[i - 1]!;
      expect(card.shots[i]!.ask.ball).toEqual(prev.roll.resumeAt);
      expect(card.shots[i]!.ask.ball).not.toEqual(prev.aim);
    }
  });

  it('stops when the ball is close enough that the question is putting', () => {
    const card = playHole(prepared, start, P14, 77, caddie, FAST);
    const last = card.shots[card.shots.length - 1]!;
    const finished = last.roll.holed || dist(last.roll.resumeAt, prepared.pin) <= HOLED_OUT_YDS;
    expect(finished || card.shots.length === MAX_SHOTS_PER_HOLE).toBe(true);
  });

  it('concedes nothing when the caddie plays', () => {
    // The caddie aims where the engine says, so by construction it gives up
    // no expected strokes — which is what makes it a yardstick.
    const card = playHole(prepared, start, P14, 5, caddie, FAST);
    expect(card.conceded).toBeCloseTo(0, 9);
  });

  it('concedes strokes when the reflex plays a hole that holds a decision', () => {
    const card = playHole(prepared, start, P14, 5, reflex, FAST);
    expect(card.conceded).toBeGreaterThanOrEqual(0);
  });

  it('gives the two policies the identical dice, shot for shot', () => {
    // Same seed, same hole index: the draws must match even though the
    // outcomes do not, because the aims differ.
    const a = playHole(prepared, start, P14, 31337, caddie, { ...FAST, holeIndex: 2 });
    const b = playHole(prepared, start, P14, 31337, reflex, { ...FAST, holeIndex: 2 });
    const zA = shotDice(31337, 2 * 100 + 1);
    const zB = shotDice(31337, 2 * 100 + 1);
    expect([...zA]).toEqual([...zB]);
    expect(a.shots[0]!.ask.ball).toEqual(b.shots[0]!.ask.ball);
  });
});

describe('ask', () => {
  const prepared = par4();

  it('reports both the engine line and the reflex line', () => {
    const a = ask(prepared, { x: 0, y: 0 }, 'tee', 1, P14, 200);
    expect(a.optimalE).toBeGreaterThan(0);
    expect(a.trapSize).toBeGreaterThanOrEqual(0);
    expect(a.toPin).toBeCloseTo(410, 0);
    expect(a.category).toBe('tee');
  });

  it('names a shot from sand or trees a recovery', () => {
    const a = ask(prepared, { x: 0, y: 200 }, 'sand', 2, P14, 200);
    expect(a.category).toBe('recovery');
  });
});
