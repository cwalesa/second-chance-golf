import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { CFG } from '../src/config';
import { CLUB_H, CLUB_W, T, clubSites, idx } from '../src/terrain';
import { createWilderness, clubhouseProblem, landOf, placeClubhouse, reliefAt, suggestClubhouse, suggestFirstHole } from '../src/wilderness';
import { planNewHole } from '../src/editing';
import { activeLocation } from '../src/campaign';
import { deserialize, serialize } from '../src/save';
import { run } from './helpers';

const SEEDS = [1, 7, 4242, 99990];
const blank = (seed = 20250601) => new Game(undefined, seed, { start: 'blank' });

/** What the tutorial has the player do: pick the suggested spot, build the suggested hole, open it. */
function startClub(g: Game) {
  const spot = suggestClubhouse(g.world)!;
  expect(g.buildClubhouse(spot)).toBe(true);
  const s = suggestFirstHole(g.world)!;
  expect(s).not.toBeNull();
  const plan = planNewHole(g.world, g.nextHoleId(), s.tee, s.cup);
  expect(typeof plan).not.toBe('string');
  expect(g.commitEdit(plan as Exclude<typeof plan, string>).ok).toBe(true);
  return g.world.holes[0];
}

describe('blank canvas world', () => {
  it('starts as forest, water and valleys with no holes and no clubhouse', () => {
    for (const seed of SEEDS) {
      const w = createWilderness(seed);
      let water = 0, trees = 0, open = 0;
      for (let i = 0; i < w.terrain.length; i++) {
        if (w.terrain[i] === T.WATER) water++;
        else if (w.tree[i]) trees++;
        else open++;
        expect([T.ROUGH, T.WATER]).toContain(w.terrain[i]);
      }
      const n = w.terrain.length;
      expect(w.holes).toEqual([]);
      expect(w.clubhouse).toBeNull();
      expect(w.parcels.every((p) => p === 1)).toBe(true);
      expect(water / n).toBeGreaterThan(0.025);
      expect(water / n).toBeLessThan(0.14);
      expect(trees / n).toBeGreaterThan(0.35); // a forest
      expect(open / n).toBeGreaterThan(0.25); // with meadows to build on
      expect(landOf(seed).ponds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('is repeatable and has real valleys', () => {
    const a = createWilderness(4242), b = createWilderness(4242), c = createWilderness(7);
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(Array.from(a.tree)).toEqual(Array.from(b.tree));
    expect(Array.from(a.terrain)).not.toEqual(Array.from(c.terrain));
    let lo = 1, hi = 0;
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) { const r = reliefAt(4242, x, y); lo = Math.min(lo, r); hi = Math.max(hi, r); }
    expect(hi - lo).toBeGreaterThan(0.5);
    expect(reliefAt(0, 10, 10)).toBe(0.5); // the classic course has no relief
  });

  it('a new blank game has no holes, so no time passes and no money is spent until there is a clubhouse', () => {
    const g = blank();
    expect(g.start).toBe('blank');
    expect(g.world.holes).toHaveLength(0);
    expect(g.selectedHole).toBe(0);
    expect(g.cash).toBe(CFG.economy.startCash);
    expect(g.avgCondition).toBe(0);
    expect(g.designRating).toBe(0);
    expect(activeLocation(g).objectives.map((o) => o.id)).toEqual(['holes', 'rounds', 'profit']);
    run(g, 40);
    expect(g.sim.golfers).toHaveLength(0);
  });
});

describe('choosing the clubhouse spot', () => {
  it('refuses water, the map edge and steep ground, and offers a spot that works', () => {
    const w = createWilderness(1);
    expect(clubhouseProblem(w, { x: 0, y: 0 })).toMatch(/edge/);
    expect(clubhouseProblem(w, { x: 110, y: 40 })).toMatch(/edge/);
    let wet = null as { x: number; y: number } | null;
    for (let i = 0; i < w.terrain.length && !wet; i++) {
      const x = i % w.w, y = Math.floor(i / w.w);
      if (w.terrain[i] === T.WATER && x > 12 && x < 100 && y > 12 && y < 66) wet = { x: x - 3, y: y - 2 };
    }
    expect(clubhouseProblem(w, wet!)).toMatch(/water/);
    const spot = suggestClubhouse(w)!;
    expect(clubhouseProblem(w, spot)).toBeNull();
    let steep = 0;
    for (let y = 3; y < 70; y++) for (let x = 4; x < 100; x++) if (clubhouseProblem(w, { x, y })?.match(/steep/)) steep++;
    expect(steep).toBeGreaterThan(0);
  });

  it('builds the clubhouse, lawn and a road to the edge where the player chose', () => {
    for (const seed of SEEDS) {
      const g = blank(seed);
      const spot = suggestClubhouse(g.world)!;
      const cash = g.cash;
      expect(g.buildClubhouse(spot)).toBe(true);
      const w = g.world;
      expect(w.clubhouse).toEqual(spot);
      expect(g.cash).toBe(cash); // a gift
      expect(g.buildClubhouse(spot)).toBe(false); // only once
      for (let y = spot.y; y < spot.y + CLUB_H; y++) for (let x = spot.x; x < spot.x + CLUB_W; x++) {
        expect(w.terrain[idx(w, x, y)]).toBe(T.BUILDING);
        expect(w.tree[idx(w, x, y)]).toBe(0);
      }
      // the road reaches the edge where golfers appear, and a golfer can walk from there to the door
      expect(w.terrain[idx(w, Math.floor(w.gate.x), Math.floor(w.gate.y))]).toBe(T.PATH);
      expect(w.gate.x < 1 || w.gate.x > w.w - 1).toBe(true);
      const { door, entry } = clubSites(w);
      expect(w.terrain[idx(w, Math.floor(door.x), Math.floor(door.y))]).toBe(T.PATH);
      expect(w.terrain[idx(w, Math.floor(entry.x), Math.floor(entry.y))]).toBe(T.PATH);
    }
  });

  it('rejects a bad spot without changing the land', () => {
    const g = blank();
    const before = Array.from(g.world.terrain);
    expect(g.buildClubhouse({ x: 0, y: 0 })).toBe(false);
    expect(g.world.clubhouse).toBeNull();
    expect(Array.from(g.world.terrain)).toEqual(before);
    expect(placeClubhouse(g.world, { x: 1, y: 1 })).toMatch(/edge/);
  });
});

describe('building the first hole through the forest', () => {
  it('the suggested hole is a short, valid par 3 that can open straight away', () => {
    for (const seed of SEEDS) {
      const g = blank(seed);
      const h = startClub(g);
      expect(h.par).toBe(3);
      expect(h.name).toBe('Willow Bend');
      expect(h.open).toBe(false);
      const v = g.validate(h.id);
      expect(v.problems).toEqual([]);
      expect(g.openHole(h.id).ok).toBe(true);
      expect(g.selectedHole).toBe(h.id);
    }
  });

  it('refunds the build on undo, and golfers can then walk from the clubhouse and finish rounds', () => {
    const g = blank(4242);
    startClub(g);
    const afterBuild = g.cash;
    expect(g.undo()).toBe(true);
    expect(g.world.holes).toHaveLength(0);
    expect(g.cash).toBeGreaterThan(afterBuild);
    expect(g.cash).toBe(CFG.economy.startCash);
    g.redo();
    expect(g.openHole(1).ok).toBe(true);
    g.designMode = false;
    g.setSpeed(1);
    run(g, CFG.day.seconds + 5);
    const d = g.days[0];
    expect(d).toBeDefined();
    expect(d.rounds).toBeGreaterThan(0);
    expect(d.fees).toBeGreaterThan(0);
    expect(g.world.holes[0].stats.rounds).toBeGreaterThan(0);
  });

  it('sends test golfers out from the new clubhouse and they finish the hole', () => {
    const g = blank(7);
    const h = startClub(g);
    g.openHole(h.id);
    expect(g.sendTestGolfers(h.id)).toBe(3);
    run(g, 240);
    expect(g.testResults.filter((r) => r.hole === h.id).length).toBe(3);
  });
});

describe('saving a blank canvas club', () => {
  it('round-trips before any clubhouse exists', () => {
    const g = blank(99990);
    const back = deserialize(serialize(g))!.game;
    expect(back.start).toBe('blank');
    expect(back.world.clubhouse).toBeNull();
    expect(back.world.holes).toHaveLength(0);
    expect(back.world.landSeed).toBe(g.world.landSeed);
    expect(Array.from(back.world.terrain)).toEqual(Array.from(g.world.terrain));
    expect(back.selectedHole).toBe(0);
  });

  it('round-trips with a clubhouse and a hole, keeping where golfers arrive', () => {
    const g = blank(1);
    const h = startClub(g);
    g.openHole(h.id);
    const back = deserialize(serialize(g))!.game;
    expect(back.world.clubhouse).toEqual(g.world.clubhouse);
    expect(back.world.gate).toEqual(g.world.gate);
    expect(back.world.holes.map((x) => x.name)).toEqual(['Willow Bend']);
    expect(back.world.holes[0].open).toBe(true);
    expect(back.selectedHole).toBe(h.id);
    expect(clubSites(back.world)).toEqual(clubSites(g.world));
  });

  it('still rejects a classic save with no holes', () => {
    const g = new Game();
    const raw = JSON.parse(serialize(g));
    raw.world.holes = [];
    expect(deserialize(JSON.stringify(raw))).toBeNull();
  });

  it('classic saves keep the classic clubhouse', () => {
    const g = new Game();
    expect(g.start).toBe('restore');
    const back = deserialize(serialize(g))!.game;
    expect(back.start).toBe('restore');
    expect(back.world.clubhouse).toEqual({ x: 3, y: 41 });
    expect(back.world.gate).toEqual({ x: 0.5, y: 47.5 });
  });
});
