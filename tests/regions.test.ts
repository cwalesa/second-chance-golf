import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { CFG } from '../src/config';
import { REGIONS, REGION_IDS } from '../src/progression';
import { T } from '../src/terrain';
import { planNewHole } from '../src/editing';
import { createWilderness, suggestClubhouse, suggestFirstHole } from '../src/wilderness';
import { deserialize, serialize } from '../src/save';
import { run } from './helpers';

const SEEDS = [1, 7, 4242, 99990];
const share = (w: ReturnType<typeof createWilderness>) => {
  let water = 0, sand = 0, trees = 0;
  for (let i = 0; i < w.terrain.length; i++) {
    if (w.terrain[i] === T.WATER) water++;
    else if (w.terrain[i] === T.BUNKER) sand++;
    if (w.tree[i]) trees++;
  }
  const n = w.terrain.length;
  return { water: water / n, sand: sand / n, trees: trees / n };
};

describe('starting regions', () => {
  it('offers five regions with plain difficulty labels, easiest first', () => {
    const order = [...REGION_IDS].sort((a, b) => REGIONS[a].level - REGIONS[b].level).map((id) => REGIONS[id].difficulty);
    expect(order).toEqual(['Easy', 'Easy to medium', 'Medium', 'Hard', 'Very hard']);
    expect(REGIONS.parkland.name).toBe('Forest');
    for (const id of REGION_IDS) expect(REGIONS[id].blurb.length).toBeGreaterThan(30);
  });

  it('difficulty comes from the existing regional modifiers', () => {
    expect(REGIONS.plains.buildMult).toBeLessThan(REGIONS.parkland.buildMult);
    expect(REGIONS.plains.fairMult).toBeLessThan(REGIONS.parkland.fairMult);
    expect(REGIONS.plains.wind).toBeGreaterThan(REGIONS.parkland.wind);
    expect(REGIONS.coast.wind).toBeGreaterThan(REGIONS.plains.wind);
    expect(REGIONS.coast.spend).toBeGreaterThan(REGIONS.parkland.spend);
    expect(REGIONS.mountain.buildMult).toBeGreaterThan(REGIONS.coast.buildMult);
    expect(REGIONS.desert.upkeep).toBeGreaterThan(REGIONS.mountain.upkeep);
    expect(REGIONS.desert.fairMult).toBe(Math.max(...REGION_IDS.map((r) => REGIONS[r].fairMult)));
  });

  it('every region looks different, and mountains are denser than forest', () => {
    for (const seed of SEEDS) {
      const s = Object.fromEntries(REGION_IDS.map((r) => [r, share(createWilderness(seed, r))]));
      expect(s.mountain.trees).toBeGreaterThan(s.parkland.trees + 0.05);
      expect(s.plains.trees).toBeLessThan(s.parkland.trees * 0.7);
      expect(s.desert.trees).toBeLessThan(0.1);
      expect(s.desert.sand).toBeGreaterThan(0.05);
      expect(s.coast.water).toBeGreaterThan(0.1); // the sea
      expect(s.coast.sand).toBeGreaterThan(0.02);
      expect(s.parkland.sand).toBe(0);
      expect(s.desert.water).toBeGreaterThan(0.002); // an oasis to build around
    }
  });

  it('each region gives a legal clubhouse spot and a buildable first hole for several seeds', () => {
    for (const id of REGION_IDS)
      for (const seed of SEEDS) {
        const g = new Game(undefined, seed, { region: id });
        expect(g.region).toBe(id);
        expect(g.world.w).toBe(CFG.grid.w);
        const spot = suggestClubhouse(g.world);
        expect(spot, `${id} ${seed}`).not.toBeNull();
        expect(g.buildClubhouse(spot!)).toBe(true);
        const s = suggestFirstHole(g.world);
        expect(s, `${id} ${seed}`).not.toBeNull();
        const plan = planNewHole(g.world, g.nextHoleId(), s!.tee, s!.cup);
        expect(typeof plan, `${id} ${seed}`).not.toBe('string');
        expect(g.commitEdit(plan as Exclude<typeof plan, string>).ok).toBe(true);
        expect(g.validate(1).problems).toEqual([]);
        expect(g.openHole(1).ok).toBe(true);
      }
  });

  it('a hole opened in any region plays rounds', () => {
    for (const id of REGION_IDS) {
      const g = new Game(undefined, 4242, { region: id });
      g.buildClubhouse(suggestClubhouse(g.world)!);
      const s = suggestFirstHole(g.world)!;
      g.commitEdit(planNewHole(g.world, 1, s.tee, s.cup) as never);
      g.openHole(1);
      g.designMode = false;
      g.setSpeed(1);
      run(g, CFG.day.seconds + 5);
      expect(g.days[0]?.rounds, id).toBeGreaterThan(0);
    }
  });

  it('the whole map is buildable from the start, with no chapters or unlocks', () => {
    const g = new Game(undefined, 5, { region: 'mountain' });
    expect(g.world.parcels.every((p) => p === 1)).toBe(true);
    expect('travel' in g).toBe(false);
  });

  it('the tutorial is optional', () => {
    expect(new Game(undefined, 1, { region: 'coast', tutorial: false }).tutorial.done).toBe(true);
    expect(new Game(undefined, 1, { region: 'coast' }).tutorial.done).toBe(false);
  });

  it('saves keep the chosen region and its land', () => {
    for (const id of REGION_IDS) {
      const g = new Game(undefined, 77, { region: id });
      const back = deserialize(serialize(g))!.game;
      expect(back.region).toBe(id);
      expect(Array.from(back.world.terrain)).toEqual(Array.from(g.world.terrain));
      expect(Array.from(back.world.tree)).toEqual(Array.from(g.world.tree));
    }
  });
});
