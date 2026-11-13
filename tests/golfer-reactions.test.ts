import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { CFG } from '../src/config';
import { run } from './helpers';
import { createTestCourse } from './fixtures/classic-course';

/** Everything the simulation decides, ignoring the cosmetic reaction field. */
const outcome = (g: Game) => ({
  rounds: g.days.map((d) => [d.rounds, d.fees]),
  holes: g.world.holes.map((h) => [h.stats.rounds, h.stats.strokes]),
  golfers: g.sim.golfers.map((x) => [x.id, x.phase, +x.x.toFixed(3), +x.y.toFixed(3), x.hs.strokes, x.strokesDone]),
});

describe('golfer reactions', () => {
  it('are cosmetic: set on some shots, always well-formed, and the simulation is unchanged by them', () => {
    const a = new Game(createTestCourse());
    const kinds = new Set<string>();
    for (let i = 0; i < Math.round((CFG.day.seconds + 5) / CFG.sim.dt); i++) {
      a.step(CFG.sim.dt);
      for (const x of a.sim.golfers) if (x.react) {
        kinds.add(x.react.kind);
        expect(['good', 'poor']).toContain(x.react.kind);
        expect(x.react.v).toBeGreaterThanOrEqual(0);
        expect(x.react.v).toBeLessThan(1);
        expect(x.react.t0).toBeLessThanOrEqual(a.sim.now);
      }
    }
    expect(kinds.size).toBeGreaterThan(0);
    // the same course run again, with every reaction wiped as soon as it appears, plays out identically
    const b = new Game(createTestCourse());
    for (let i = 0; i < Math.round((CFG.day.seconds + 5) / CFG.sim.dt); i++) {
      b.step(CFG.sim.dt);
      for (const x of b.sim.golfers) x.react = undefined;
    }
    expect(outcome(b)).toEqual(outcome(a));
    // and a plain run (no tampering) matches too, so a reaction never consumed a random number
    const c = new Game(createTestCourse());
    run(c, CFG.day.seconds + 5);
    expect(outcome(c)).toEqual(outcome(a));
  });
});
