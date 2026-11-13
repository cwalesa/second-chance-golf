import { describe, expect, it } from 'vitest';
import { Game, TEST_SPEED } from '../src/game';
import { CFG } from '../src/config';
import { planNewHole, planPaint } from '../src/editing';
import { T, idx } from '../src/terrain';
import { deserialize, serialize } from '../src/save';
import { suggestClubhouse, suggestFirstHole } from '../src/wilderness';
import { testObservation, testResultLine } from '../src/tutorial-state';
import { DT } from './helpers';
import { createTestCourse } from './fixtures/classic-course';

/** The frame loop, without a browser: advance the game the way main.ts does. */
function frames(g: Game, seconds: number) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) g.advance(DT);
}
/** A new course through the tutorial's building steps: clubhouse, first hole, open it. Time is never started. */
function setUp(seed = 4242) {
  const g = new Game(undefined, seed);
  expect(g.buildClubhouse(suggestClubhouse(g.world)!)).toBe(true);
  const s = suggestFirstHole(g.world)!;
  expect(g.commitEdit(planNewHole(g.world, g.nextHoleId(), s.tee, s.cup) as never).ok).toBe(true);
  expect(g.openHole(1).ok).toBe(true);
  return g;
}
const snapshot = (g: Game) => ({ day: g.day, clock: g.clock, cash: g.cash, total: g.total, arrivals: g.today.arrivals, rounds: g.stats.rounds, cond: Array.from(g.world.cond).join(','), log: g.log.length });

describe('a new course is unhurried', () => {
  it('starts paused and closed, and setting it up never starts the clock', () => {
    const g = setUp();
    expect(g.settings).toMatchObject({ paused: true, open: false });
    expect(g.timeHold).toBe('unopened');
    const before = snapshot(g);
    frames(g, 60);
    expect(snapshot(g)).toEqual(before);
    expect(g.sim.golfers).toHaveLength(0);
  });
  it('a speed button on an unopened course remembers the speed but does not start time', () => {
    const g = setUp();
    g.setSpeed(3);
    expect(g.settings.speed).toBe(3);
    expect(g.businessRunning).toBe(false);
    expect(g.resume()).toBe(false);
    expect(g.businessRunning).toBe(false);
  });
  it('Open for business is the explicit start, and needs a clubhouse and an open hole', () => {
    const blank = new Game(undefined, 7);
    expect(blank.openForBusiness()).toBe(false);
    const g = new Game(undefined, 4242);
    g.buildClubhouse(suggestClubhouse(g.world)!);
    expect(g.openForBusiness()).toBe(false);
    expect(g.settings.open).toBe(false);
    const ready = setUp();
    expect(ready.openForBusiness()).toBe(true);
    expect(ready.timeHold).toBeNull();
    frames(ready, 30);
    expect(ready.clock).toBeGreaterThan(0);
  });
  it('ready-made courses start open and running, and skip the walkthrough', () => {
    const g = new Game(createTestCourse());
    expect(g.settings).toMatchObject({ paused: false, open: true });
    expect(g.tutorial.done).toBe(true);
    expect(g.businessRunning).toBe(true);
  });
});

describe('design pause', () => {
  const running = () => { const g = setUp(); g.openForBusiness(); g.setSpeed(3); return g; };
  it('entering design pauses, leaving keeps it paused, and resume restores the chosen speed', () => {
    const g = running();
    expect(g.businessRunning).toBe(true);
    g.enterDesign();
    expect(g.timeHold).toBe('design');
    const before = snapshot(g);
    frames(g, 20);
    expect(snapshot(g)).toEqual(before);
    g.exitDesign();
    expect(g.timeHold).toBe('paused');
    frames(g, 20);
    expect(snapshot(g)).toEqual(before);
    expect(g.resume()).toBe(true);
    expect(g.settings.speed).toBe(3);
    expect(g.timeScale).toBe(3);
  });
  it('an edit made from any panel pauses, and undo does too', () => {
    const g = running();
    expect(g.settings.paused).toBe(false);
    // a bunker beside the green, made from a panel rather than the tray
    const cup = g.world.holes[0].cup;
    const tiles: number[] = [];
    for (let y = cup.y - 4; y <= cup.y + 4; y++) for (let x = cup.x - 4; x <= cup.x + 4; x++) { const i = idx(g.world, x, y); if (g.world.terrain[i] === T.ROUGH && !g.world.tree[i] && Math.hypot(x - cup.x, y - cup.y) > 2.5) tiles.push(i); }
    expect(g.commitEdit(planPaint(g.world, 'bunker', tiles.slice(0, 6))).ok).toBe(true);
    expect(g.settings.paused).toBe(true);
    g.resume();
    expect(g.undo()).toBe(true);
    expect(g.settings.paused).toBe(true);
    expect(g.designMode).toBe(true);
  });
  it('the Pause button holds time, and the speed buttons resume at the picked speed', () => {
    const g = running();
    g.setSpeed(0);
    expect(g.speedShown).toBe(0);
    expect(g.settings.speed).toBe(3);
    g.setSpeed(1);
    expect(g.speedShown).toBe(1);
    expect(g.businessRunning).toBe(true);
  });
  it('a practice round, and closing it, never resume a paused business', () => {
    const g = running();
    g.enterDesign();
    g.exitDesign();
    g.owner.start(g);
    expect(g.timeHold).toBe('owner');
    expect(g.timeScale).toBe(0);
    g.owner.stop(g);
    expect(g.timeHold).toBe('paused');
    // and a running business is not stopped by one
    g.resume();
    g.owner.start(g);
    g.owner.stop(g);
    expect(g.businessRunning).toBe(true);
  });
  it('pause and the saved speed survive a reload', () => {
    const g = running();
    g.enterDesign();
    const back = deserialize(serialize(g))!.game;
    expect(back.settings).toMatchObject({ paused: true, open: true, speed: 3 });
    expect(back.timeHold).toBe('paused');
    expect(back.resume()).toBe(true);
    expect(back.settings.speed).toBe(3);
  });
});

describe('test golfers while the business is held', () => {
  it('play to a result without arrivals, revenue, upkeep, wear or day progress, and keep the saved speed', () => {
    const g = setUp();
    g.setSpeed(3);
    g.settings.speed = 2;
    const before = snapshot(g);
    expect(g.sendTestGolfers(1, ['regular'])).toBe(1);
    expect(g.hasTestGolfers).toBe(true);
    expect(g.timeScale).toBe(TEST_SPEED);
    frames(g, 600);
    expect(g.testResults.length).toBe(1);
    expect(g.testResults[0].strokes).toBeGreaterThan(0);
    expect(snapshot(g)).toEqual(before);
    expect(g.settings.speed).toBe(2);
    expect(g.settings.paused).toBe(true);
    expect(g.sim.golfers.filter((x) => !x.test)).toHaveLength(0);
    expect(g.timeScale).toBe(0); // once they are gone nothing moves
  });
});

describe('test golfers beside guests already on the course', () => {
  it('guests stay frozen and earn nothing while the test golfer plays through to a result', () => {
    const g = setUp();
    g.openForBusiness();
    // let ordinary guests arrive and get onto the course, then hold the business with them mid-round
    for (let i = 0; i < 30 * 70; i++) g.advance(DT);
    expect(g.sim.golfers.filter((x) => !x.test).length).toBeGreaterThan(0);
    g.enterDesign();
    const guests = g.sim.golfers.filter((x) => !x.test).map((x) => [x.id, x.x, x.y, x.phase, x.holesDone]);
    const before = snapshot(g);
    g.sendTestGolfers(1, ['regular']);
    frames(g, 900);
    expect(g.testResults.length).toBe(1); // not stuck behind frozen guests
    expect(g.sim.golfers.filter((x) => !x.test).map((x) => [x.id, x.x, x.y, x.phase, x.holesDone])).toEqual(guests);
    expect(snapshot(g)).toEqual(before);
    // and they carry on when the player resumes
    g.resume();
    frames(g, 30);
    expect(g.clock).toBeGreaterThan(before.clock);
  });
});

describe('time away', () => {
  const away = CFG.offline.realSecondsPerDay * 3 + 60;
  it('does not advance days or charge upkeep for a paused, designing or unopened course', () => {
    const held = [
      () => { const g = setUp(); g.openForBusiness(); g.pause(); return g; },
      () => { const g = setUp(); g.openForBusiness(); g.enterDesign(); return g; },
      () => setUp(),
    ];
    for (const make of held) {
      const g = make();
      const before = snapshot(g);
      expect(g.applyAway(away)).toBeNull();
      expect(snapshot(g)).toEqual(before);
      // and the same after a save and reload
      const back = deserialize(serialize(g))!.game;
      expect(back.applyAway(away)).toBeNull();
      expect(back.day).toBe(before.day);
    }
  });
  it('still earns for a course left running', () => {
    const g = setUp();
    g.openForBusiness();
    const day = g.day;
    const r = g.applyAway(away);
    expect(r).not.toBeNull();
    expect(g.day).toBeGreaterThan(day);
  });
  it('a course with no hours to catch up on stays put (old saves that were running)', () => {
    const g = new Game(createTestCourse());
    const old = JSON.parse(serialize(g));
    delete old.settings.paused; delete old.settings.open; old.settings.speed = 0;
    const back = deserialize(JSON.stringify(old))!.game;
    expect(back.settings).toMatchObject({ paused: true, open: true });
    expect(back.settings.speed).toBe(1);
    expect(back.applyAway(away)).toBeNull();
    old.settings.speed = 3;
    expect(deserialize(JSON.stringify(old))!.game.settings).toMatchObject({ paused: false, open: true, speed: 3 });
  });
});

describe('tutorial state on the real course', () => {
  it('a new course starts the tutorial, and its progress survives a reload', () => {
    const g = new Game(undefined, 5, { region: 'coast', name: 'Salt Marsh' });
    expect(g.tutorial).toMatchObject({ step: 0, done: false, v: 2 });
    expect(g.practice).toBe(false);
    g.tutorial.step = 4;
    const back = deserialize(serialize(g))!.game;
    expect(back.tutorial).toMatchObject({ step: 4, done: false, v: 2 });
    expect(back.region).toBe('coast');
    expect(back.name).toBe('Salt Marsh');
    expect(back.settings).toMatchObject({ paused: true, open: false });
  });
  it('the tutorial can be switched off at the start', () => {
    expect(new Game(undefined, 5, { tutorial: false }).tutorial.done).toBe(true);
  });
  it('saves from before it existed are finished, and old tutorial step numbers never apply to a real course', () => {
    const g = new Game(createTestCourse());
    const old = JSON.parse(serialize(g));
    delete old.tutorial;
    expect(deserialize(JSON.stringify(old))!.game.tutorial.done).toBe(true);
    old.tutorial = { step: 3, done: false }; // the old practice walkthrough, saved on a real course
    const back = deserialize(JSON.stringify(old))!.game;
    expect(back.tutorial.done).toBe(true);
    expect(back.world.holes.length).toBe(g.world.holes.length);
  });
  it('an old practice save is still recognised, so it can be retired without touching a real course', () => {
    const p = new Game(undefined, 3, { practice: true });
    const d = JSON.parse(serialize(p));
    delete d.tutorial.v;
    d.tutorial.step = 6;
    const back = deserialize(JSON.stringify(d))!.game;
    expect(back.practice).toBe(true);
    expect(deserialize(serialize(new Game(createTestCourse())))!.game.practice).toBe(false);
  });
});

describe('what the tutorial says about a test round', () => {
  const round = { name: 'Sam', type: 'regular' as const, strokes: 3, par: 3, shots: 3, rough: 0, bunker: 0, water: 0 };
  it('reports the actual result', () => {
    expect(testResultLine(round)).toBe('Sam, a regular golfer, took 3 on this par 3.');
    expect(testResultLine({ ...round, strokes: 5 })).toContain('5 on this par 3 (2 over par)');
    expect(testResultLine({ ...round, strokes: 2 })).toContain('(a birdie)');
  });
  it('gives one observation drawn from the round', () => {
    expect(testObservation({ ...round, water: 1 })).toMatch(/water/);
    expect(testObservation({ ...round, strokes: 5, bunker: 1 })).toMatch(/Sand/);
    expect(testObservation({ ...round, strokes: 5 })).toMatch(/fairway/);
    expect(testObservation({ ...round, rough: 2 })).toMatch(/rough/);
    expect(testObservation({ ...round, strokes: 2 })).toMatch(/bunker/);
    expect(testObservation(round)).toMatch(/bunker/);
  });
});
