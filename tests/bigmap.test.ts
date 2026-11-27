import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { CFG } from '../src/config';
import { createWilderness, landmarksOf, placeClubhouse, suggestClubhouse } from '../src/wilderness';
import { deserialize, serialize } from '../src/save';
import { parcelCols, parcelRows } from '../src/terrain';
import { setUpOpening } from '../src/opening';
import { planNewHole } from '../src/editing';
import { T, idx } from '../src/terrain';

describe('the bigger map and older saves', () => {
  it('a new course is 480 x 320 with a starting block in the middle and three landmarks to buy toward', () => {
    const g = new Game(undefined, 77);
    expect([g.world.w, g.world.h]).toEqual([CFG.grid.w, CFG.grid.h]);
    expect([parcelCols(g.world), parcelRows(g.world)]).toEqual([10, 8]);
    expect(landmarksOf(g.world).length).toBe(3);
    for (const s of landmarksOf(g.world)) expect(g.isParcelOwned(Math.floor(s.x / CFG.land.pw), Math.floor(s.y / CFG.land.ph))).toBe(false);
  });
  it('a save from the original 240 x 160 map loads at its own size, owning all of its land, with its ground unchanged', () => {
    const w = createWilderness(4242, 'parkland', { w: 240, h: 160 });
    placeClubhouse(w, suggestClubhouse(w)!);
    const g = new Game(w, 3);
    expect(g.legacyMap).toBe(true);
    expect(g.world.parcels.every((p) => p === 1)).toBe(true);
    const back = deserialize(serialize(g))!.game;
    expect([back.world.w, back.world.h]).toEqual([240, 160]);
    expect(Array.from(back.world.terrain)).toEqual(Array.from(g.world.terrain));
    expect(back.world.parcels.length).toBe(20);
    expect(landmarksOf(back.world)).toEqual([]); // the original map has no landmarks added to it
  });
  it('a save written in the old plain format (digit strings and a condition array) still loads', () => {
    const w = createWilderness(99, 'coast');
    setUpOpening(w);
    const g = new Game(w, 3);
    const d = JSON.parse(serialize(g));
    d.world.terrain = Array.from(g.world.terrain).join(''); delete d.world.terrainRle;
    d.world.tree = Array.from(g.world.tree).join(''); delete d.world.treeRle;
    d.world.cond = Array.from(g.world.cond, (c) => Math.round(c * 10) / 10); delete d.world.condQ;
    const back = deserialize(JSON.stringify(d))!.game;
    expect(Array.from(back.world.terrain)).toEqual(Array.from(g.world.terrain));
    expect(back.world.holes[0].par).toBe(4);
  });
  it('the compact save is much smaller than the plain one, and round-trips the ground exactly', () => {
    const w = createWilderness(5, 'parkland');
    setUpOpening(w);
    const g = new Game(w, 3);
    const text = serialize(g);
    const plain = Array.from(g.world.terrain).join('').length + Array.from(g.world.tree).join('').length + JSON.stringify(Array.from(g.world.cond, (c) => Math.round(c * 10) / 10)).length;
    expect(text.length).toBeLessThan(plain * 0.6);
    const back = deserialize(text)!.game;
    expect(Array.from(back.world.tree)).toEqual(Array.from(g.world.tree));
    for (let i = 0; i < g.world.cond.length; i += 97) expect(Math.abs(back.world.cond[i] - g.world.cond[i])).toBeLessThanOrEqual(0.5);
  });
  it('land beyond the starting block can be built on once it is bought, and not before', () => {
    const g = new Game(undefined, 31);
    const s0 = landmarksOf(g.world).find((x) => x.id === 'meadow')!;
    // a short hole across the open meadow, out where the land is for sale
    const tee = { x: Math.round(s0.x - 6), y: Math.round(s0.y) }, cup = { x: Math.round(s0.x + 8), y: Math.round(s0.y) };
    for (const p of [tee, cup]) { const i = idx(g.world, p.x, p.y); g.world.terrain[i] = T.ROUGH; g.world.tree[i] = 0; }
    expect(planNewHole(g.world, 2, tee, cup)).toMatch(/do not own/);
    g.cash = 1e6;
    for (const p of [tee, cup]) { const c = Math.floor(p.x / CFG.land.pw), r = Math.floor(p.y / CFG.land.ph); if (!g.isParcelOwned(c, r)) expect(g.buyParcel(c, r)).toBe(true); }
    const plan = planNewHole(g.world, 2, tee, cup);
    expect(typeof plan).toBe('object');
  });
});
