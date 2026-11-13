import { describe, it, expect } from 'vitest';
import { Game } from '../src/game';
import { T, holeBends, holeYards, idx, MAX_BENDS } from '../src/terrain';
import { placeClubhouse } from '../src/wilderness';
import { bendProblem, insertBend, moveBendTo, planBends, planNewHole, removeBendAt, routeStats, sameBends, suggestBend } from '../src/editing';

/** A clear meadow with the clubhouse out of the way, so each test controls what is on the ground. */
function meadow(seed = 7) {
  const g = new Game(undefined, seed);
  const w = g.world;
  for (let i = 0; i < w.terrain.length; i++) { w.terrain[i] = T.ROUGH; w.tree[i] = 0; w.cond[i] = 70; }
  g.openProperty();
  placeClubhouse(w, { x: 10, y: 60 });
  g.world.version++;
  g.cash = 100000;
  return g;
}
const build = (g: Game, tee: { x: number; y: number }, cup: { x: number; y: number }, bends: { x: number; y: number }[] = []) => {
  const plan = planNewHole(g.world, g.nextHoleId(), tee, cup, { bends });
  if (typeof plan === 'string') throw new Error(plan);
  expect(g.commitEdit(plan).ok).toBe(true);
  return plan.newHole!;
};

describe('live bend editing', () => {
  it('reports the same total yardage as the finished hole, through every bend', () => {
    const g = meadow();
    const bends = [{ x: 70, y: 40 }, { x: 80, y: 20 }, { x: 90, y: 38 }];
    const h = build(g, { x: 60, y: 30 }, { x: 100, y: 30 }, bends);
    const s = routeStats(h.tee, holeBends(h), h.cup);
    expect(s.total).toBe(holeYards(h));
    expect(s.legs.length).toBe(4);
    // each leg is rounded on its own, so together they can differ from the total by a yard or two at most
    expect(Math.abs(s.legs.reduce((a, b) => a + b, 0) - s.total)).toBeLessThanOrEqual(2);
    // a bend adds length compared with the straight line
    expect(s.total).toBeGreaterThan(routeStats(h.tee, [], h.cup).total);
  });

  it('prices each new or moved bend at $40, removals are free, and moving back costs nothing', () => {
    const g = meadow();
    const h = build(g, { x: 60, y: 30 }, { x: 100, y: 30 }, [{ x: 80, y: 40 }]);
    const live = g.hole(h.id);
    const added = planBends(g.world, live, [{ x: 80, y: 40 }, { x: 90, y: 20 }])!;
    expect(added.cost).toBe(40);
    const movedTwo = planBends(g.world, live, [{ x: 75, y: 42 }, { x: 90, y: 20 }])!;
    expect(movedTwo.cost).toBe(80);
    expect(planBends(g.world, live, [])!.cost).toBe(0);
    // dragged away and back: no change, no plan, no charge
    expect(planBends(g.world, live, [{ x: 80, y: 40 }])).toBeNull();
    // nothing is charged until Build
    const cash = g.cash;
    expect(g.cash).toBe(cash);
    expect(g.commitEdit(added).ok).toBe(true);
    expect(g.cash).toBe(cash - 40);
    expect(holeBends(g.hole(h.id)).length).toBe(2);
    g.undo();
    expect(g.cash).toBe(cash);
    expect(holeBends(g.hole(h.id))).toEqual([{ x: 80, y: 40 }]);
  });

  it('keeps routing order when adding, moving and removing several bends', () => {
    const g = meadow();
    const tee = { x: 60, y: 30 }, cup = { x: 110, y: 30 };
    let bends = insertBend(tee, [], cup, { x: 70, y: 45 });
    bends = insertBend(tee, bends, cup, { x: 100, y: 45 });
    bends = insertBend(tee, bends, cup, { x: 85, y: 15 }); // lands between the other two
    expect(bends.map((b) => b.x)).toEqual([70, 85, 100]);
    // moving a bend never reorders the route, even past a neighbour
    const moved = moveBendTo(bends, 0, { x: 95, y: 40 });
    expect(moved.map((b) => b.x)).toEqual([95, 85, 100]);
    expect(removeBendAt(moved, 1).map((b) => b.x)).toEqual([95, 100]);
    expect(removeBendAt(bends, 0).map((b) => b.x)).toEqual([85, 100]);
    // the saved hole keeps the order it was given
    const h = build(g, tee, cup, bends);
    expect(holeBends(h).map((b) => b.x)).toEqual([70, 85, 100]);
    expect(h.bend).toEqual(bends[0]);
  });

  it('reuses the existing bend limit', () => {
    const g = meadow();
    const tee = { x: 60, y: 30 }, cup = { x: 110, y: 30 };
    const full = [{ x: 70, y: 40 }, { x: 85, y: 20 }, { x: 100, y: 40 }];
    expect(full.length).toBe(MAX_BENDS);
    expect(typeof suggestBend(g.world, tee, cup, full)).toBe('string');
    const one = suggestBend(g.world, tee, cup, []);
    expect(typeof one).toBe('object');
    if (typeof one === 'string') return;
    expect(one.bends.length).toBe(1);
    expect(one.index).toBe(0);
    // the suggested bend is off the straight line so it is visible, and valid
    expect(Math.abs(one.bends[0].y - 30)).toBeGreaterThan(1.5);
    expect(bendProblem(g.world, tee, cup, one.bends, 0, one.bends[0])).toBeNull();
    // with a bend already there, the new one goes into the longest leg, in order
    const two = suggestBend(g.world, tee, cup, [{ x: 70, y: 40 }]);
    if (typeof two === 'string') throw new Error(two);
    expect(two.index).toBe(1);
    expect(two.bends[0]).toEqual({ x: 70, y: 40 });
  });

  it('explains invalid positions instead of silently refusing', () => {
    const g = meadow();
    const tee = { x: 60, y: 30 }, cup = { x: 100, y: 30 };
    const bends = [{ x: 80, y: 40 }];
    expect(bendProblem(g.world, tee, cup, bends, 0, { x: 80, y: 41 })).toBeNull();
    expect(bendProblem(g.world, tee, cup, bends, 0, { x: -3, y: 40 })).toMatch(/off the property/);
    expect(bendProblem(g.world, tee, cup, bends, 0, { x: 0, y: 40 })).toMatch(/edge/);
    expect(bendProblem(g.world, tee, cup, bends, 0, { x: 61, y: 30 })).toMatch(/tee/);
    expect(bendProblem(g.world, tee, cup, bends, 0, { x: 100, y: 31 })).toMatch(/green/);
    expect(bendProblem(g.world, tee, cup, [{ x: 70, y: 40 }, { x: 90, y: 40 }], 1, { x: 71, y: 40 })).toMatch(/bend 1/);
    // moving a bend onto its own tile is fine
    expect(bendProblem(g.world, tee, cup, [{ x: 70, y: 40 }, { x: 90, y: 40 }], 0, { x: 70, y: 40 })).toBeNull();
    // the clubhouse
    const club = g.world.clubhouse!;
    expect(bendProblem(g.world, tee, cup, bends, 0, { x: club.x + 1, y: club.y + 1 })).toMatch(/clubhouse|own/);
    expect(g.world.terrain[idx(g.world, club.x + 1, club.y + 1)]).toBe(T.BUILDING);
  });

  it('an unchanged route plans nothing, so Cancel and drag-back leave the hole untouched', () => {
    const g = meadow();
    const h = build(g, { x: 60, y: 30 }, { x: 100, y: 30 }, [{ x: 80, y: 40 }]);
    expect(sameBends(holeBends(h), [{ x: 80, y: 40 }])).toBe(true);
    const plan = planBends(g.world, g.hole(h.id), [{ x: 82, y: 44 }])!;
    expect(plan.hole!.before.bends).toEqual([{ x: 80, y: 40 }]);
    expect(plan.hole!.after.bends).toEqual([{ x: 82, y: 44 }]);
    expect(plan.tiles).toEqual([]);
    // planning never touches the live hole
    expect(holeBends(g.hole(h.id))).toEqual([{ x: 80, y: 40 }]);
  });
});
