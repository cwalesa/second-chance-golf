import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { planNewHole } from '../src/editing';
import { suggestClubhouse, suggestFirstHole } from '../src/wilderness';
import { run } from './helpers';

function course() {
  const g = new Game(undefined, 20250601, { tutorial: false });
  expect(g.buildClubhouse(suggestClubhouse(g.world)!)).toBe(true);
  const s = suggestFirstHole(g.world)!;
  const plan = planNewHole(g.world, g.nextHoleId(), s.tee, s.cup);
  expect(typeof plan).not.toBe('string');
  expect(g.commitEdit(plan as Exclude<typeof plan, string>).ok).toBe(true);
  return g;
}

describe('playtest bugs', () => {
  it('the first opening of a hole is not a "reopen"; a later one is', () => {
    const g = course();
    const h = g.world.holes[0];
    expect(h.reopenedAt).toBe(-1);
    g.openHole(h.id);
    expect(h.open).toBe(true);
    expect(h.reopenedAt).toBe(-1);
    run(g, 5);
    g.closeHole(h.id);
    g.openHole(h.id);
    expect(h.reopenedAt).toBeGreaterThan(0);
  });

  it('test golfers start beside the tee and finish the hole quickly', () => {
    const g = course();
    const h = g.world.holes[0];
    g.openHole(h.id);
    expect(g.sendTestGolfers(h.id)).toBe(3);
    const first = g.sim.golfers[0];
    expect(Math.hypot(first.x - h.tee.x, first.y - h.tee.y)).toBeLessThan(6);
    expect(first.phase).toBe('toTee');
    run(g, 40);
    expect(g.testResults.length).toBeGreaterThan(0);
  });
});
