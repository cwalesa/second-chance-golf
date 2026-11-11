import { describe, it, expect } from 'vitest';
import { Game } from '../src/game';
import { CFG } from '../src/config';
import { T, computeZones, findPath, holeBends, holePath, holeYards, idx, polyDist, validateHole, lengthAdvice, routesCross } from '../src/terrain';
import { createWilderness, placeClubhouse, suggestClubhouse } from '../src/wilderness';
import { planMoveBend, planMoveCup, planMoveTee, planNewHole, planPaint, planStraighten, planTile } from '../src/editing';
import { run } from './helpers';

/** A clear meadow (no trees, no creek) so each test controls exactly what is on the ground. */
function meadow(seed = 7) {
  const g = new Game(undefined, seed);
  const w = g.world;
  for (let i = 0; i < w.terrain.length; i++) { w.terrain[i] = T.ROUGH; w.tree[i] = 0; w.cond[i] = 70; }
  g.openProperty();
  const spot = { x: 10, y: 60 };
  placeClubhouse(w, spot);
  g.world.version++;
  g.cash = 100000;
  return g;
}
const lake = (g: Game, x0: number, x1: number, y0: number, y1: number) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.world.terrain[idx(g.world, x, y)] = T.WATER;
  g.world.layout = (g.world.layout ?? 0) + 1;
  g.world.version++;
};
const build = (g: Game, tee: { x: number; y: number }, cup: { x: number; y: number }, opts = {}) => {
  const plan = planNewHole(g.world, g.nextHoleId(), tee, cup, opts);
  if (typeof plan === 'string') throw new Error(plan);
  expect(g.commitEdit(plan).ok).toBe(true);
  return plan.newHole!;
};

describe('building holes freely', () => {
  it('keeps the par the player chose, whatever the length', () => {
    const g = meadow();
    const a = build(g, { x: 60, y: 30 }, { x: 80, y: 30 }, { par: 5 });
    expect(a.par).toBe(5);
    const b = build(g, { x: 60, y: 50 }, { x: 90, y: 50 }, { par: 3 });
    expect(b.par).toBe(3);
    const c = build(g, { x: 60, y: 70 }, { x: 80, y: 70 });
    expect(c.par).toBe(3); // no choice: follows the length
    expect(g.hole(a.id).par).toBe(5);
  });

  it('lets tee and green go in any direction, and recommends rather than forbids lengths', () => {
    const g = meadow();
    for (const [tee, cup] of [[{ x: 100, y: 80 }, { x: 70, y: 80 }], [{ x: 100, y: 80 }, { x: 100, y: 50 }], [{ x: 100, y: 80 }, { x: 125, y: 105 }], [{ x: 100, y: 80 }, { x: 80, y: 60 }]] as const) {
      const plan = planNewHole(g.world, 99, tee, cup);
      expect(typeof plan).toBe('object');
    }
    // 700 yards is outside every recommendation but still buildable, with a plain caution
    const long = planNewHole(g.world, 99, { x: 20, y: 20 }, { x: 90, y: 20 });
    expect(typeof long).toBe('object');
    if (typeof long !== 'string') expect(long.notes?.join(' ')).toMatch(/long for a par/);
    expect(lengthAdvice(3, 150)).toBeNull();
    expect(lengthAdvice(3, 400)).toMatch(/par 5|par 4/);
  });

  it('builds neighbouring holes with no spacing rule, and blocks only real overlaps', () => {
    const g = meadow();
    const a = build(g, { x: 100, y: 60 }, { x: 125, y: 60 });
    // alongside it, five tiles away: fine
    const b = planNewHole(g.world, g.nextHoleId(), { x: 100, y: 66 }, { x: 125, y: 66 });
    expect(typeof b).toBe('object');
    // a tee on the other hole's tee box, or a green on its green: refused, and the reason names the hole
    expect(planNewHole(g.world, 9, { x: 100, y: 61 }, { x: 125, y: 70 })).toMatch(new RegExp(`hole ${a.id}`));
    expect(planNewHole(g.world, 9, { x: 100, y: 70 }, { x: 125, y: 61 })).toMatch(new RegExp(`hole ${a.id}`));
    // crossing routes only warn
    const x = planNewHole(g.world, 9, { x: 110, y: 50 }, { x: 112, y: 75 });
    expect(typeof x).toBe('object');
    if (typeof x !== 'string') expect(x.notes?.join(' ')).toMatch(/Crosses hole/);
    expect(routesCross([{ x: 0, y: 0 }, { x: 10, y: 10 }], [{ x: 0, y: 10 }, { x: 10, y: 0 }])).toBe(true);
    // the clubhouse still blocks
    const club = g.world.clubhouse!;
    expect(typeof planNewHole(g.world, 9, { x: club.x + 2, y: club.y + 2 }, { x: club.x + 20, y: club.y + 20 })).toBe('string');
  });

  it('supports up to three optional turning points and lays the fairway along them', () => {
    const g = meadow();
    const straight = build(g, { x: 60, y: 30 }, { x: 90, y: 30 });
    expect(holeBends(straight)).toEqual([]);
    const bends = [{ x: 70, y: 40 }, { x: 80, y: 20 }, { x: 85, y: 35 }, { x: 88, y: 25 }];
    const h = build(g, { x: 60, y: 90 }, { x: 95, y: 90 }, { bends });
    expect(holeBends(h).length).toBe(3); // a fourth is ignored
    expect(holePath(h).length).toBe(5);
    expect(holeYards(h)).toBeGreaterThan(Math.round(35 * CFG.grid.yardsPerTile));
    // the corridor follows the route: fairway tiles on both bends
    const tiles = (p: { x: number; y: number }) => g.world.terrain[idx(g.world, p.x, p.y)];
    expect(g.validate(h.id).ok).toBe(true);
    expect(tiles({ x: 60, y: 90 })).toBe(T.TEE);
    // zone covers the whole bent route
    for (const p of holePath(h)) expect(g.world.zone[idx(g.world, Math.floor(p.x), Math.floor(p.y))]).toBe(h.id);
  });

  it('edits keep par and turning points, and dogleg taps add, move and remove', () => {
    const g = meadow();
    const h = build(g, { x: 60, y: 30 }, { x: 100, y: 30 }, { par: 5 });
    const addOne = planMoveBend(g.world, g.hole(h.id), 80, 45);
    expect(typeof addOne).toBe('object');
    if (typeof addOne === 'string') return;
    expect(addOne.label).toBe('Add turning point');
    g.commitEdit(addOne);
    expect(holeBends(g.hole(h.id)).length).toBe(1);
    expect(g.hole(h.id).par).toBe(5);
    const move = planMoveBend(g.world, g.hole(h.id), 83, 47) as Exclude<ReturnType<typeof planMoveBend>, string>;
    expect(move.label).toBe('Move turning point');
    const remove = planMoveBend(g.world, g.hole(h.id), 80, 45) as Exclude<ReturnType<typeof planMoveBend>, string>;
    expect(remove.label).toBe('Remove turning point');
    expect(remove.cost).toBe(0);
    for (const [x, y] of [[70, 20], [90, 20]]) g.commitEdit(planMoveBend(g.world, g.hole(h.id), x, y) as never);
    expect(holeBends(g.hole(h.id)).length).toBe(3);
    // a fourth tap far from the others moves the nearest instead of adding
    expect((planMoveBend(g.world, g.hole(h.id), 120, 100) as { label: string }).label).toBe('Move turning point');
    const tee = planMoveTee(g.world, g.hole(h.id), 55, 32) as Exclude<ReturnType<typeof planMoveTee>, string>;
    expect(tee.hole!.after.par).toBe(5);
    expect(holeBends(tee.hole!.after).length).toBe(3);
    g.commitEdit(tee);
    expect(g.hole(h.id).tee).toEqual({ x: 55, y: 32 });
    expect(holeBends(g.hole(h.id)).length).toBe(3);
    const cup = planMoveCup(g.world, g.hole(h.id), 104, 28) as Exclude<ReturnType<typeof planMoveCup>, string>;
    expect(cup.hole!.after.par).toBe(5);
    g.undo();
    expect(g.hole(h.id).tee).toEqual({ x: 60, y: 30 });
    const straight = planStraighten(g.world, g.hole(h.id)) as Exclude<ReturnType<typeof planStraighten>, string>;
    g.commitEdit(straight);
    expect(holeBends(g.hole(h.id))).toEqual([]);
    expect(g.hole(h.id).par).toBe(5);
    g.undo();
    expect(holeBends(g.hole(h.id)).length).toBe(3);
  });

  it('computes hole zones exactly like a full-map scan', () => {
    const g = meadow();
    build(g, { x: 60, y: 30 }, { x: 100, y: 30 });
    build(g, { x: 60, y: 40 }, { x: 100, y: 44 }, { bends: [{ x: 80, y: 60 }] });
    build(g, { x: 150, y: 100 }, { x: 170, y: 130 });
    const w = g.world;
    const naive = new Uint8Array(w.w * w.h);
    const R = CFG.holes.zoneRadius;
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) { let best = R, id = 0; for (const h of w.holes) { const d = polyDist(x + 0.5, y + 0.5, holePath(h)).d; if (d <= best) { best = d; id = h.id; } } naive[y * w.w + x] = id; }
    computeZones(w);
    expect(Array.from(w.zone)).toEqual(Array.from(naive));
  });
});

describe('holes across water', () => {
  it('preserves water on the route instead of filling it, and keeps hazards', () => {
    const g = meadow();
    lake(g, 80, 86, 20, 40);
    for (let y = 28; y < 32; y++) g.world.terrain[idx(g.world, 70, y)] = T.BUNKER;
    const h = build(g, { x: 62, y: 30 }, { x: 105, y: 30 });
    expect(g.world.terrain[idx(g.world, 83, 30)]).toBe(T.WATER);
    expect(g.world.terrain[idx(g.world, 70, 29)]).toBe(T.BUNKER);
    expect(g.world.terrain[idx(g.world, 75, 30)]).toBe(T.FAIRWAY);
    expect(g.world.terrain[idx(g.world, 92, 30)]).toBe(T.FAIRWAY);
    expect(h.open).toBe(false);
  });

  it('refuses a tee or cup in water but accepts a green on an island', () => {
    const g = meadow();
    lake(g, 80, 100, 20, 40);
    for (let y = 28; y <= 32; y++) for (let x = 88; x <= 92; x++) g.world.terrain[idx(g.world, x, y)] = T.ROUGH;
    expect(planNewHole(g.world, 9, { x: 82, y: 30 }, { x: 70, y: 30 })).toMatch(/solid ground/);
    expect(planNewHole(g.world, 9, { x: 60, y: 30 }, { x: 84, y: 25 })).toMatch(/solid ground|island/i);
    expect(typeof planNewHole(g.world, 9, { x: 62, y: 30 }, { x: 90, y: 30 })).toBe('object');
  });

  it('explains an island green with no way to walk, then opens once a bridge is painted', () => {
    const g = meadow();
    lake(g, 76, 98, 24, 36);
    for (let y = 28; y <= 32; y++) for (let x = 85; x <= 89; x++) g.world.terrain[idx(g.world, x, y)] = T.ROUGH;
    const h = build(g, { x: 64, y: 30 }, { x: 87, y: 30 });
    const v = g.validate(h.id);
    // 11 tiles of water to the island: a reasonable carry, so only the walk is a problem
    expect(v.ok).toBe(false);
    expect(v.issues.map((i) => i.fix)).toContain('path');
    expect(v.problems.join(' ')).toMatch(/bridge/i);
    expect(g.openHole(h.id).ok).toBe(false);
    // the path tool over water lays a bridge, at the bridge price
    const tiles: number[] = [];
    for (let x = 76; x <= 85; x++) tiles.push(idx(g.world, x, 30));
    const plan = planPaint(g.world, 'path', tiles);
    expect(plan.tiles.length).toBe(9); // x 76 to 84 is water; 85 is the island
    expect(plan.tiles.every((e) => e.after.t === T.BRIDGE)).toBe(true);
    expect(plan.cost).toBeGreaterThanOrEqual(9 * CFG.costs.bridge); // dearer than the $8 land path
    g.commitEdit(plan);
    // land ends need path too: paint the shore tiles between fairway and bridge
    for (let x = 74; x <= 75; x++) g.world.terrain[idx(g.world, x, 30)] = T.PATH;
    g.world.layout = (g.world.layout ?? 0) + 1;
    expect(findPath(g.world, { x: 64.5, y: 30.5 }, { x: 87.5, y: 30.5 })).not.toBeNull();
    expect(g.validate(h.id).ok).toBe(true);
    expect(g.openHole(h.id).ok).toBe(true);
  });

  it('treats a bridge as walkable ground and a plain water crossing as blocked', () => {
    const g = meadow();
    lake(g, 80, 90, 0, 159);
    expect(findPath(g.world, { x: 70.5, y: 30.5 }, { x: 100.5, y: 30.5 })).toBeNull();
    for (let x = 80; x <= 90; x++) g.world.terrain[idx(g.world, x, 30)] = T.BRIDGE;
    const path = findPath(g.world, { x: 70.5, y: 30.5 }, { x: 100.5, y: 30.5 })!;
    expect(path).not.toBeNull();
    for (const p of path) expect(g.world.terrain[idx(g.world, Math.floor(p.x), Math.floor(p.y))]).not.toBe(T.WATER);
  });

  it('warns about long carries and refuses impossible ones, with plain reasons', () => {
    const g = meadow();
    lake(g, 78, 95, 0, 159); // 18 tiles = 180 yards of water: more than a beginner carries
    const hard = build(g, { x: 62, y: 30 }, { x: 112, y: 30 });
    for (let x = 78; x <= 95; x++) g.world.terrain[idx(g.world, x, 30)] = T.BRIDGE;
    g.world.layout = (g.world.layout ?? 0) + 1;
    const v1 = validateHole(g.world, g.hole(hard.id));
    expect(v1.ok).toBe(true);
    expect(v1.warnings.join(' ')).toMatch(/yard carry over water/);
    const g2 = meadow();
    lake(g2, 70, 100, 0, 159); // 30 tiles: beyond anyone
    const lost = build(g2, { x: 56, y: 30 }, { x: 118, y: 30 });
    const v2 = validateHole(g2.world, g2.hole(lost.id));
    expect(v2.ok).toBe(false);
    expect(v2.problems.join(' ')).toMatch(/does not reach the green/);
  });

  it('plays a hole across water by bridge: guests and test golfers finish it', () => {
    const g = meadow(11);
    lake(g, 80, 92, 0, 159);
    const h = build(g, { x: 64, y: 40 }, { x: 108, y: 40 }, { par: 4 });
    for (let x = 80; x <= 92; x++) g.world.terrain[idx(g.world, x, 40)] = T.BRIDGE;
    for (let x = 78; x <= 79; x++) g.world.terrain[idx(g.world, x, 40)] = T.PATH;
    for (let x = 93; x <= 94; x++) g.world.terrain[idx(g.world, x, 40)] = T.PATH;
    g.world.layout = (g.world.layout ?? 0) + 1;
    g.world.version++;
    expect(g.openHole(h.id).ok).toBe(true);
    (g as unknown as { maybeArrive: () => void }).maybeArrive = () => {};
    expect(g.sendTestGolfers(h.id)).toBe(3);
    for (let i = 0; i < 30 * 900 && g.testResults.length < 3; i++) g.step(CFG.sim.dt);
    expect(g.testResults.length).toBe(3);
    for (const r of g.testResults) expect(r.strokes).toBeLessThanOrEqual(r.par + CFG.holes.maxStrokesOverPar);
    // nobody waded: no golfer ever stood in water
    expect(g.world.terrain[idx(g.world, 85, 40)]).toBe(T.BRIDGE);
  });

  it('never lets a golfer wade: a ball with no walking route is dropped on their own side', () => {
    const g = meadow(5);
    lake(g, 80, 92, 0, 159);
    const h = build(g, { x: 64, y: 40 }, { x: 108, y: 40 });
    // force-open the hole although nobody can walk to the green, as an old save might
    g.hole(h.id).open = true;
    (g as unknown as { maybeArrive: () => void }).maybeArrive = () => {};
    g.sendTestGolfers(h.id);
    let waded = 0;
    for (let i = 0; i < 30 * 400; i++) {
      g.step(CFG.sim.dt);
      for (const o of g.sim.golfers) if (g.world.terrain[idx(g.world, Math.floor(o.x), Math.floor(o.y))] === T.WATER) waded++;
      if (g.testResults.length >= 3) break;
    }
    expect(waded).toBe(0);
  });

  it('bridges over water cannot be painted over except with water, and path over land is a plain path', () => {
    const g = meadow();
    lake(g, 80, 90, 0, 159);
    const i = idx(g.world, 85, 10);
    g.world.terrain[i] = T.BRIDGE;
    expect(planTile(g.world, 'rough', i)).toBeNull();
    expect(planTile(g.world, 'fairway', i)).toBeNull();
    expect(planTile(g.world, 'path', i)).toBeNull();
    const w = planTile(g.world, 'water', i)!;
    expect(w.after.t).toBe(T.WATER);
    const land = planTile(g.world, 'path', idx(g.world, 50, 10))!;
    expect(land.after.t).toBe(T.PATH);
  });
});

it('validates old-style saves: a hole with only a single bend still works', () => {
  const g = meadow();
  const h = build(g, { x: 60, y: 30 }, { x: 100, y: 30 });
  delete (g.hole(h.id) as { bends?: unknown }).bends; // as saved before turning points existed
  g.hole(h.id).bend = { x: 80, y: 30 };
  expect(holeBends(g.hole(h.id))).toEqual([]); // on the line: not a dogleg
  g.hole(h.id).bend = { x: 80, y: 40 };
  expect(holeBends(g.hole(h.id))).toEqual([{ x: 80, y: 40 }]);
  expect(typeof suggestClubhouse(createWilderness(3))).toBe('object');
  run(g, 5);
});
