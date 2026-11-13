import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { CFG } from '../src/config';
import { deserialize, serialize } from '../src/save';
import { isPayingRound, nextStep, roundReaction, scoreText } from '../src/first-round';
import type { RoundStats } from '../src/sim';
import { createTestCourse } from './fixtures/classic-course';

const stats = (o: Partial<RoundStats> = {}): RoundStats => ({ shots: 20, rough: 2, bunker: 0, water: 0, tree: 0, condSum: 0, condN: 0, wait: 0, picked: 0, closedOnMe: 0, ...o });
const round = (s: RoundStats, strokes = 40, par = 36, holes = 9) => ({ strokes, par, holes, stats: s });

describe('the first round reaction is grounded in what was measured', () => {
  it('picks what actually happened, most notable first', () => {
    expect(roundReaction(round(stats({ water: 2 })))).toMatch(/water twice/);
    expect(roundReaction(round(stats({ water: 1, tree: 5 })))).toMatch(/water once/); // water outranks trees
    expect(roundReaction(round(stats({ tree: 3 })))).toMatch(/trees 3 times/);
    expect(roundReaction(round(stats({ bunker: 2 })))).toMatch(/sand \(2 shots/);
    expect(roundReaction(round(stats({ wait: 30 })))).toMatch(/wait at the tee/);
    expect(roundReaction(round(stats({ condSum: 400, condN: 10 })))).toMatch(/worn/); // average turf 40
    expect(roundReaction(round(stats({ rough: 12 })))).toMatch(/rough/);
    expect(roundReaction(round(stats({ condSum: 850, condN: 10 })))).toMatch(/smooth/);
  });
  it('falls back to something true when nothing stands out', () => {
    expect(roundReaction(round(stats(), 30, 36, 9))).toMatch(/Played really well/);
    expect(roundReaction(round(stats(), 40, 36, 9))).toBe('Finished all 9 holes and headed home.');
    expect(roundReaction(round(stats(), 4, 3, 1))).toBe('Finished all 1 hole and headed home.');
    // no turf readings at all: it never claims anything about the turf
    expect(roundReaction(round(stats({ condN: 0 })))).not.toMatch(/turf|smooth|fairways/);
  });
  it('words the score and chooses one next step from the course', () => {
    expect(scoreText(0)).toBe('Even par');
    expect(scoreText(3)).toBe('3 over par');
    expect(scoreText(-2)).toBe('2 under par');
    expect(nextStep([{ id: 1, name: 'A', open: true }]).label).toBe('Build your second hole');
    expect(nextStep([{ id: 1, name: 'A', open: true }, { id: 2, name: 'B', open: false }])).toMatchObject({ id: 'openHole', label: 'Open B', holeId: 2 });
    expect(nextStep([{ id: 1, name: 'A', open: true }, { id: 2, name: 'B', open: true }]).id).toBe('guests');
  });
  it('only a paying, non-test round counts', () => {
    expect(isPayingRound({ test: false, fee: 30 })).toBe(true);
    expect(isPayingRound({ test: true, fee: 0 })).toBe(false);
    expect(isPayingRound({ test: true, fee: 30 })).toBe(false);
    expect(isPayingRound({ test: false, fee: 0 })).toBe(false);
  });
});

/** Run an open course until some guests have finished. */
function play(g: Game, until: (g: Game) => boolean, maxSeconds = 4000) {
  for (let t = 0; t < maxSeconds / CFG.sim.dt && !until(g); t++) g.step(CFG.sim.dt);
}

describe('the first paying round', () => {
  it('is recorded once, from the real round, without paying the fee a second time', () => {
    const g = new Game(createTestCourse(), 4);
    let feeAtFinish = -1, shopAtFinish = -1, calls = 0;
    const orig = (g as unknown as { onRoundComplete: (r: never) => string }).onRoundComplete.bind(g);
    (g as unknown as { onRoundComplete: (r: never) => string }).onRoundComplete = (r: never) => {
      const before = { fees: g.today.fees, shop: g.today.shop };
      const out = orig(r);
      if (!(r as { test?: boolean }).test) { calls++; if (calls === 1) { feeAtFinish = g.today.fees - before.fees; shopAtFinish = g.today.shop - before.shop; } }
      return out;
    };
    expect(g.firstRound.done).toBe(false);
    play(g, (x) => x.stats.rounds >= 3);
    expect(g.stats.rounds).toBeGreaterThanOrEqual(3);
    const fr = g.firstRound;
    expect(fr.done).toBe(true);
    expect(fr.shown).toBe(false);
    expect(fr.result!.fee).toBeGreaterThan(0);
    expect(fr.result!.name.length).toBeGreaterThan(0);
    expect(fr.result!.reaction.length).toBeGreaterThan(5);
    // finishing the round collected no green fee: the fee was taken at the tee, and only the clubhouse spend came in at the end
    expect(feeAtFinish).toBe(0);
    expect(shopAtFinish).toBeGreaterThanOrEqual(0);
    // later rounds never replace it
    const first = JSON.stringify(fr.result);
    play(g, (x) => x.stats.rounds >= 8);
    expect(JSON.stringify(g.firstRound.result)).toBe(first);
  });

  it('ignores test golfers', () => {
    const g = new Game(createTestCourse(), 4);
    g.settings.open = false;
    g.sendTestGolfers(1);
    for (let t = 0; t < 900 / CFG.sim.dt && g.testResults.length === 0; t++) g.stepTest ? g.stepTest(CFG.sim.dt) : g.step(CFG.sim.dt);
    expect(g.testResults.length).toBeGreaterThan(0);
    expect(g.firstRound.done).toBe(false);
  });

  it('survives a save: recorded and not shown again, or still waiting to be shown', () => {
    const g = new Game(createTestCourse(), 4);
    play(g, (x) => x.firstRound.done);
    expect(g.firstRound.done).toBe(true);
    const waiting = deserialize(serialize(g))!.game;
    expect(waiting.firstRound.done).toBe(true);
    expect(waiting.firstRound.shown).toBe(false);
    expect(waiting.firstRound.result).toEqual(g.firstRound.result);
    g.firstRound.shown = true;
    const seen = deserialize(serialize(g))!.game;
    expect(seen.firstRound.shown).toBe(true);
    // after more rounds a reload still has exactly the one result
    play(seen, (x) => x.stats.rounds >= g.stats.rounds + 2);
    expect(seen.firstRound.result).toEqual(g.firstRound.result);
  });

  it('a course saved before this existed that already has rounds gets no celebration; a fresh one still does', () => {
    const old = new Game(createTestCourse(), 4);
    old.stats.rounds = 12;
    const raw = JSON.parse(serialize(old));
    delete raw.firstRound;
    const loaded = deserialize(JSON.stringify(raw))!.game;
    expect(loaded.firstRound).toEqual({ done: true, shown: true, result: null });
    const fresh = new Game(createTestCourse(), 4);
    const raw2 = JSON.parse(serialize(fresh));
    delete raw2.firstRound;
    expect(deserialize(JSON.stringify(raw2))!.game.firstRound.done).toBe(false);
  });
});
