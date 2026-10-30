import { describe, it, expect } from 'vitest';
import { Game } from '../src/game';
import { CFG } from '../src/config';
import { T, idx, holeYards, validateHole } from '../src/terrain';
import { EditPlan, mergeEdit, planMoveTee, planNewHole, planPaint, planTile, planRemoveHole, stagedState } from '../src/editing';
import { deserialize, serialize } from '../src/save';

const freshGame = () => {
  const g = new Game();
  g.openProperty();
  return g;
};
/** A new hole through the real planner in the empty right-hand side of the property. */
const buildHole = (g: Game, tee = { x: 80, y: 40 }, cup = { x: 100, y: 58 }) => {
  const plan = planNewHole(g.world, g.nextHoleId(), tee, cup);
  if (typeof plan === 'string') throw new Error(plan);
  expect(g.commitEdit(plan).ok).toBe(true);
  return plan.newHole!;
};

describe('first-course designer', () => {
  it('starts with a generous budget, the whole property, and room for nine holes', () => {
    const g = freshGame();
    expect(g.cash).toBe(CFG.economy.startCash);
    expect(CFG.economy.startCash).toBeGreaterThanOrEqual(20000);
    expect(g.parcelsOwned).toBe(CFG.land.cols * CFG.land.rows);
    expect(g.maxHoles).toBeGreaterThanOrEqual(9);
    expect(g.goalDone('land6')).toBe(false);
    g.checkGoals();
    expect(g.goalDone('land2') || g.goalDone('land6')).toBe(false);
  });

  it('lets staged strokes stack and merges them per tile', () => {
    const g = freshGame();
    const i = idx(g.world, 90, 20);
    const first = planTile(g.world, 'fairway', i)!;
    const staged = new Map([[i, first]]);
    // judged against what is already staged, fairway on fairway is a no-op
    expect(planTile(g.world, 'fairway', i, stagedState(g.world, i, staged))).toBeNull();
    const second = planTile(g.world, 'bunker', i, stagedState(g.world, i, staged))!;
    expect(second.before.t).toBe(T.FAIRWAY);
    const merged = mergeEdit(first, second)!;
    expect(merged.before.t).toBe(first.before.t); // still undoes to the original ground
    expect(merged.after.t).toBe(T.BUNKER);
    expect(merged.cost).toBeCloseTo(first.cost + second.cost);
    // an edit that ends where it began cancels out of the batch
    const same = { i, before: first.before, after: { ...first.before }, cost: 0 };
    expect(mergeEdit(undefined, same)).toBeNull();
  });

  it('charges exactly the previewed cost, once, and undo/redo restore ground and cash', () => {
    const g = freshGame();
    const tiles = [];
    for (let x = 85; x < 92; x++) for (let y = 20; y < 24; y++) tiles.push(idx(g.world, x, y));
    const plan = planPaint(g.world, 'water', tiles);
    const before = Array.from(g.world.terrain);
    const cash = g.cash;
    expect(g.commitEdit(plan).ok).toBe(true);
    expect(g.cash).toBe(cash - plan.cost);
    expect(tiles.every((i) => g.world.terrain[i] === T.WATER)).toBe(true);
    expect(g.undo()).toBe(true);
    expect(g.cash).toBe(cash);
    expect(Array.from(g.world.terrain)).toEqual(before);
    expect(g.redo()).toBe(true);
    expect(g.cash).toBe(cash - plan.cost);
    expect(g.canUndo).not.toBeNull();
  });

  it('refuses an unaffordable build without partial charges', () => {
    const g = freshGame();
    g.cash = 10;
    const tiles = [idx(g.world, 90, 20), idx(g.world, 91, 20)];
    const plan = planPaint(g.world, 'water', tiles);
    expect(g.commitEdit(plan).ok).toBe(false);
    expect(g.cash).toBe(10);
    expect(g.world.terrain[tiles[0]]).not.toBe(T.WATER);
  });

  it('builds a new hole that validates, and undo/redo remove and restore it', () => {
    const g = freshGame();
    const n = g.world.holes.length;
    const h = buildHole(g);
    expect(g.world.holes.length).toBe(n + 1);
    expect(h.open).toBe(false);
    expect(validateHole(g.world, g.hole(h.id)).ok).toBe(true);
    expect(g.openHole(h.id).ok).toBe(true);
    g.undo();
    expect(g.world.holes.length).toBe(n);
    expect(g.world.holes.some((x) => x.id === h.id)).toBe(false);
    g.redo();
    expect(g.world.holes.some((x) => x.id === h.id)).toBe(true);
    expect(g.hole(h.id).open).toBe(false);
  });

  it('removes a hole undoably and keeps its ground', () => {
    const g = freshGame();
    const h = buildHole(g);
    const terrain = Array.from(g.world.terrain);
    g.openHole(h.id);
    expect(g.removeHole(h.id)).toBe(true);
    expect(g.world.holes.some((x) => x.id === h.id)).toBe(false);
    expect(Array.from(g.world.terrain)).toEqual(terrain);
    expect(g.undo()).toBe(true);
    expect(g.world.holes.some((x) => x.id === h.id)).toBe(true);
    expect(planRemoveHole(new Game().world, 99)).toBeTypeOf('string');
  });

  it('will not remove the last hole', () => {
    const g = freshGame();
    for (const h of [...g.world.holes].slice(1)) g.removeHole(h.id);
    expect(g.world.holes.length).toBe(1);
    expect(g.removeHole(g.world.holes[0].id)).toBe(false);
  });

  it('shows par and yardage from the same routing', () => {
    const g = freshGame();
    for (const h of g.world.holes) {
      const y = holeYards(h);
      expect(h.par).toBe(y <= CFG.holes.par3Max * 10 ? 3 : y <= CFG.holes.par4Max * 10 ? 4 : 5);
    }
    const h = g.hole(1);
    const plan = planMoveTee(g.world, h, 12, 36) as EditPlan;
    expect(typeof plan).toBe('object');
    expect(plan.hole!.after.par).toBeGreaterThanOrEqual(3);
  });

  it('explains each blocker with a place on the map and a fixing tool', () => {
    const g = freshGame();
    const v = g.validate(3); // hole 3 starts overgrown with a gap in its fairway
    expect(v.ok).toBe(false);
    expect(v.issues.length).toBe(v.problems.length);
    for (const it of v.issues) {
      expect(it.text.length).toBeGreaterThan(20);
      expect(it.at).not.toBeNull();
      expect(it.fix).not.toBeNull();
    }
    expect(g.openHole(3).ok).toBe(false);
    expect(g.hole(3).open).toBe(false);
    // memoised until the ground changes
    expect(g.validate(3)).toBe(v);
    const gap = v.breakAt!;
    expect(gap).not.toBeNull();
  });

  it('lets greens and paths be trimmed or removed, but protects the cup and tee centre', () => {
    const g = freshGame();
    const h = g.hole(1);
    const edge = idx(g.world, h.cup.x + 2, h.cup.y);
    expect(g.world.terrain[edge]).toBe(T.GREEN);
    expect(planTile(g.world, 'rough', edge)).not.toBeNull();
    expect(planTile(g.world, 'rough', idx(g.world, h.cup.x, h.cup.y))).toBeNull();
    expect(planTile(g.world, 'rough', idx(g.world, h.tee.x, h.tee.y))).toBeNull();
    let path = -1;
    for (let i = 0; i < g.world.terrain.length && path < 0; i++) if (g.world.terrain[i] === T.PATH) path = i;
    expect(planTile(g.world, 'rough', path)).not.toBeNull();
    expect(planTile(g.world, 'path', path)).toBeNull();
    const clubhouse = g.world.terrain.indexOf(T.BUILDING);
    expect(planTile(g.world, 'rough', clubhouse)).toBeNull();
  });

  it('sends free test golfers who finish the hole without touching revenue or ratings', () => {
    const g = freshGame();
    const h = buildHole(g);
    g.openHole(h.id);
    for (const other of g.world.holes) if (other.id !== h.id) g.closeHole(other.id, true);
    (g as unknown as { maybeArrive: () => void }).maybeArrive = () => {}; // no paying guests in this test
    const feesBefore = g.today.fees, roundsBefore = g.stats.rounds, recent = g.recent.length;
    expect(g.sendTestGolfers(h.id)).toBe(3);
    for (let i = 0; i < 30 * 600 && g.testResults.length < 3; i++) g.step(CFG.sim.dt);
    expect(g.testResults.length).toBe(3);
    for (const r of g.testResults) {
      expect(r.hole).toBe(h.id);
      expect(r.strokes).toBeGreaterThanOrEqual(1);
      expect(r.strokes).toBeLessThanOrEqual(r.par + CFG.holes.maxStrokesOverPar);
    }
    expect(g.today.fees).toBe(feesBefore);
    expect(g.stats.rounds).toBe(roundsBefore);
    expect(g.recent.length).toBe(recent);
  });

  it('refuses test golfers on a closed hole', () => {
    const g = freshGame();
    expect(g.sendTestGolfers(3)).toBe(0);
  });

  it('keeps a redesign intact through save and reload', () => {
    const g = freshGame();
    const h = buildHole(g);
    g.renameHole(h.id, 'Heron Bend');
    const tiles = [];
    for (let x = 92; x < 96; x++) for (let y = 40; y < 44; y++) tiles.push(idx(g.world, x, y));
    g.commitEdit(planPaint(g.world, 'bunker', tiles));
    g.openHole(h.id);
    const loaded = deserialize(serialize(g))!.game;
    expect(Array.from(loaded.world.terrain)).toEqual(Array.from(g.world.terrain));
    expect(Array.from(loaded.world.tree)).toEqual(Array.from(g.world.tree));
    expect(loaded.world.holes.map((x) => [x.id, x.name, x.par, x.open, x.tee, x.cup, x.bend])).toEqual(g.world.holes.map((x) => [x.id, x.name, x.par, x.open, x.tee, x.cup, x.bend]));
    expect(loaded.cash).toBe(g.cash);
    expect(loaded.world.parcels.every((p) => p === 1)).toBe(true);
    expect(loaded.validate(h.id).ok).toBe(true);
  });
});
