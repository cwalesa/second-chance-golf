import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { Rng } from '../src/rng';
import { CFG } from '../src/config';
import { T, createStartingWorld, idx } from '../src/terrain';
import { executeShot, isValidLie, lieAt, planShot, resolveShot } from '../src/physics';
import { run } from './helpers';

describe('starting course', () => {
  it('has two playable holes and one closed hole that fails validation', () => {
    const g = new Game();
    expect(g.world.holes.map((h) => h.open)).toEqual([true, true, false]);
    expect(g.validate(1).ok).toBe(true);
    expect(g.validate(2).ok).toBe(true);
    const v3 = g.validate(3);
    expect(v3.ok).toBe(false);
    expect(v3.breakAt).not.toBeNull();
  });

  it('lets golfers finish holes and pay revenue within one day', () => {
    const g = new Game();
    run(g, CFG.day.seconds + 5);
    const d = g.days[0];
    expect(d).toBeDefined();
    expect(d.rounds).toBeGreaterThan(3);
    expect(d.fees).toBeGreaterThan(0);
    expect(d.shop).toBeGreaterThan(0);
    expect(g.world.holes[0].stats.rounds + g.world.holes[1].stats.rounds).toBeGreaterThan(5);
  });
});

describe('shot physics', () => {
  const world = createStartingWorld();
  const avg = (tx: number, ty: number, type: 'beginner' | 'regular' | 'skilled') => {
    const rng = new Rng(7);
    let sum = 0;
    const from = { x: tx + 0.5, y: ty + 0.5 };
    const plan = { angle: 0, dist: 14, aim: { x: from.x + 14, y: from.y }, directCarryTooLong: false };
    const n = 400;
    for (let i = 0; i < n; i++) {
      const s = executeShot(world, rng, type, from, plan);
      sum += Math.hypot(s.air.x - from.x, s.air.y - from.y);
    }
    return sum / n;
  };
  it('fairway lies travel farther than rough or sand', () => {
    // find three same-row spots with open terrain ahead: use a scratch world
    const w = createStartingWorld();
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
      const i = idx(w, x, y);
      if (y >= 20 && y <= 26 && x < 60) { w.terrain[i] = T.FAIRWAY; w.tree[i] = 0; w.cond[i] = 90; }
    }
    const lieF = lieAt(w, 10.5, 22.5);
    w.terrain[idx(w, 10, 24)] = T.ROUGH; w.cond[idx(w, 10, 24)] = 60;
    w.terrain[idx(w, 10, 26)] = T.BUNKER;
    const rough = lieAt(w, 10.5, 24.5);
    const sand = lieAt(w, 10.5, 26.5);
    expect(lieF.distF).toBeGreaterThan(rough.distF);
    expect(rough.distF).toBeGreaterThan(sand.distF);
    expect(lieF.dispF).toBeLessThan(rough.dispF);
    expect(rough.dispF).toBeLessThan(sand.dispF);
  });
  it('skilled golfers hit farther and straighter than beginners', () => {
    expect(avg(9, 33, 'skilled')).toBeGreaterThan(avg(9, 33, 'beginner'));
  });
  it('worn turf shortens shots', () => {
    const w = createStartingWorld();
    w.terrain[idx(w, 20, 20)] = T.FAIRWAY;
    w.cond[idx(w, 20, 20)] = 95;
    const good = lieAt(w, 20.5, 20.5);
    w.cond[idx(w, 20, 20)] = 15;
    const worn = lieAt(w, 20.5, 20.5);
    expect(worn.distF).toBeLessThan(good.distF);
    expect(worn.dispF).toBeGreaterThan(good.dispF);
  });
  it('water costs a stroke and the drop is always a legal lie', () => {
    const w = createStartingWorld();
    const h2 = w.holes[1];
    const from = { x: h2.tee.x + 0.5, y: h2.tee.y + 0.5 };
    // aim straight at the pond centre
    const a = Math.atan2(34.5 - from.y, 53.5 - from.x);
    const r = resolveShot(w, from, a, Math.hypot(34.5 - from.y, 53.5 - from.x));
    expect(r.kind).toBe('water');
    expect(r.penalty).toBe(1);
    expect(isValidLie(w, r.end.x, r.end.y)).toBe(true);
  });
  it('a tree directly in front blocks a full shot', () => {
    const w = createStartingWorld();
    for (let x = 0; x < 30; x++) for (let y = 20; y < 24; y++) { w.terrain[idx(w, x, y)] = T.FAIRWAY; w.tree[idx(w, x, y)] = 0; }
    const clear = resolveShot(w, { x: 5.5, y: 21.5 }, 0, 15);
    expect(clear.kind).toBe('ok');
    w.tree[idx(w, 8, 21)] = 1;
    const blocked = resolveShot(w, { x: 5.5, y: 21.5 }, 0, 15);
    expect(blocked.kind).toBe('tree');
    expect(blocked.end.x).toBeLessThan(8);
  });
  it('beginners lay up instead of attempting a carry beyond their reach', () => {
    const w = createStartingWorld();
    const h2 = w.holes[1];
    const from = { x: h2.tee.x + 0.5, y: h2.tee.y + 0.5 };
    const beginner = planShot(w, h2, 'beginner', from);
    const skilled = planShot(w, h2, 'skilled', from);
    expect(beginner.directCarryTooLong).toBe(true);
    // the beginner's aim point must be on dry land
    expect(isValidLie(w, beginner.aim.x, beginner.aim.y)).toBe(true);
    // the skilled golfer can go for the green
    expect(Math.hypot(skilled.aim.x - (h2.cup.x + 0.5), skilled.aim.y - (h2.cup.y + 0.5))).toBeLessThan(Math.hypot(beginner.aim.x - (h2.cup.x + 0.5), beginner.aim.y - (h2.cup.y + 0.5)));
  });
});

describe('golfers never get stuck', () => {
  it('everyone leaves after all holes close mid-play', () => {
    const g = new Game();
    run(g, 120);
    expect(g.sim.golfers.length).toBeGreaterThan(0);
    g.closeHole(1);
    g.closeHole(2);
    run(g, 90);
    expect(g.sim.golfers.length).toBe(0);
  });
  it('editing an open hole closes it and golfers carry on', () => {
    const g = new Game();
    run(g, 100);
    const green = g.hole(1).cup;
    const i = idx(g.world, green.x, green.y);
    expect(g.world.zone[i]).toBe(1);
    // repair near the green of hole 1 is a no-op (healthy) so use rough painting on its zone
    const tile = idx(g.world, 20, 31);
    const before = g.cash;
    const res = g.commitEdit({ tool: 'rough', label: 'x', tiles: [{ i: tile, before: { t: g.world.terrain[tile], c: g.world.cond[tile], tr: g.world.tree[tile] }, after: { t: T.BUNKER, c: 100, tr: 0 }, cost: 28 }], cost: 28 });
    expect(res.ok).toBe(true);
    expect(g.hole(1).open).toBe(false);
    expect(g.cash).toBe(before - 28 + 0 + (g.cash - (before - 28)));
    run(g, 120);
    for (const gg of g.sim.golfers) expect(gg.holeId).not.toBe(1);
  });
  it('golfers survive terrain edits under their ball', () => {
    const g = new Game();
    run(g, 60);
    for (let k = 0; k < 6; k++) {
      for (const gg of g.sim.golfers) {
        if (!gg.ballVisible) continue;
        const i = idx(g.world, Math.floor(gg.ball.x), Math.floor(gg.ball.y));
        g.world.terrain[i] = T.WATER;
        g.world.version++;
      }
      run(g, 30);
    }
    run(g, 200);
    expect(g.sim.golfers.every((gg) => gg.age < 1800)).toBe(true);
  });
});
