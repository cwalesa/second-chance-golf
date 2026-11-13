import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { suggestClubhouse, suggestFirstHole } from '../src/wilderness';
import { CFG } from '../src/config';
import { AMENITY_KINDS, BUILDING_KINDS, ITEMS, buildingProblem, countOf, itemAt, toggleItem } from '../src/items';
import { cartDriving, cartOut } from '../src/sim';
import { deserialize, serialize } from '../src/save';
import { T, idx } from '../src/terrain';
import { lotFor, lotKindAt, reserveLots } from '../src/lots';
import { createTestCourse } from './fixtures/classic-course';
import { run } from './helpers';

/** Where the game keeps this amenity: its marked lot. */
function spotFor(g: Game, kind: 'puttingGreen' | 'range') {
  const at = lotFor(g.world, kind);
  if (!at) throw new Error('no lot');
  return at;
}
const fresh = () => { const g = new Game(createTestCourse()); g.cash = 50000; return g; };

describe('the putting green and driving range are placed, not just bought', () => {
  it('are buildings with a footprint and the same price as before', () => {
    for (const k of AMENITY_KINDS) {
      expect(BUILDING_KINDS).toContain(k);
      expect(ITEMS[k].w).toBeGreaterThan(1);
      expect(ITEMS[k].max).toBe(1);
      expect(ITEMS[k].cost).toBe(CFG.upgrades[k].cost);
    }
  });
  it('are paid for and owned when placed, and sold back when removed', () => {
    for (const k of AMENITY_KINDS) {
      const g = fresh();
      const at = spotFor(g, k), cash = g.cash;
      expect(g.upgrades[k]).toBe(false);
      expect(toggleItem(g, at, k).ok).toBe(true);
      expect(g.cash).toBe(cash - ITEMS[k].cost);
      expect(g.upgrades[k]).toBe(true);
      expect(countOf(g.world, k)).toBe(1);
      expect(buildingProblem(g.world, at.x, at.y, k)).toMatch(/already have/);
      expect(itemAt(g.world, at.x + 1, at.y + 1)).toBeGreaterThanOrEqual(0);
      expect(toggleItem(g, at, k).removed).toBe(true);
      expect(g.cash).toBe(cash);
      expect(g.upgrades[k]).toBe(false);
    }
  });
  it('cannot stand on a fairway, green or water', () => {
    const g = fresh();
    const h = g.world.holes[0];
    expect(buildingProblem(g.world, h.tee.x, h.tee.y, 'puttingGreen')).not.toBeNull();
    let water = -1;
    for (let i = 0; i < g.world.terrain.length && water < 0; i++) if (g.world.terrain[i] === T.WATER) water = i;
    if (water >= 0) expect(buildingProblem(g.world, water % g.world.w, Math.floor(water / g.world.w), 'range')).not.toBeNull();
  });
  it('cannot stand on a cart path', () => {
    const g = fresh();
    g.world.clubhouse = null; // no lots: the plain placement rules apply
    let path = -1;
    for (let i = 0; i < g.world.terrain.length && path < 0; i++) if (g.world.terrain[i] === T.PATH) path = i;
    expect(path).toBeGreaterThanOrEqual(0);
    expect(buildingProblem(g.world, path % g.world.w, Math.floor(path / g.world.w), 'range')).toMatch(/paths/);
  });
  it('keep their benefits: guests are happier and the range draws more golfers', () => {
    const g = fresh();
    const demand = g.arrivalRate;
    toggleItem(g, spotFor(g, 'range'), 'range');
    expect(g.arrivalRate).toBeGreaterThan(demand);
  });
  it('are placed by the game for a save that already owned them, free, and only once', () => {
    const g = fresh();
    g.upgrades.puttingGreen = true; g.upgrades.range = true;
    const cash = g.cash;
    const back = deserialize(serialize(g))!.game;
    expect(back.cash).toBe(cash);
    for (const k of AMENITY_KINDS) {
      expect(countOf(back.world, k)).toBe(1);
      const it = back.world.items!.find((x) => x.k === k)!;
      // all of its ground is plain rough, clear of the clubhouse and the holes
      for (let y = it.y; y < it.y + ITEMS[k].h!; y++) for (let x = it.x; x < it.x + ITEMS[k].w!; x++) expect(back.world.terrain[idx(back.world, x, y)]).toBe(T.ROUGH);
    }
    const again = deserialize(serialize(back))!.game;
    expect(again.world.items!.length).toBe(back.world.items!.length);
    // the two do not overlap each other
    const [a, b] = back.world.items!.filter((x) => AMENITY_KINDS.includes(x.k as never));
    expect(a.x < b.x + ITEMS[b.k].w! && b.x < a.x + ITEMS[a.k].w! && a.y < b.y + ITEMS[b.k].h! && b.y < a.y + ITEMS[a.k].h!).toBe(false);
  });
  it('a course that owns neither is left alone', () => {
    const g = fresh();
    const n = g.world.items?.length ?? 0;
    expect(deserialize(serialize(g))!.game.world.items?.length ?? 0).toBe(n);
  });
});

describe('golfers ride in rented carts', () => {
  const carted = () => { const g = fresh(); g.upgrades.carts = true; g.fleet = 6; g.cartFee = 1; return g; };
  it('renters are given a cart from the fleet, never more than the fleet owns', () => {
    const g = carted();
    let most = 0, sawCart = false;
    for (let i = 0; i < 30 * 400; i++) {
      g.step(1 / 30);
      if (i % 30) continue;
      const riding = g.sim.golfers.filter((x) => x.cart !== undefined && x.cart >= 0 && x.phase !== 'leave').length;
      most = Math.max(most, riding);
      if (riding) sawCart = true;
    }
    expect(sawCart).toBe(true);
    expect(most).toBeLessThanOrEqual(g.fleet);
  });
  it('without carts nobody rides', () => {
    const g = fresh();
    run(g, 200);
    expect(g.sim.golfers.some((x) => x.cart !== undefined)).toBe(false);
  });
  it('a cart is out, and driving, only while its renter is on the course between shots', () => {
    const base = { cart: 2 };
    expect(cartOut({ ...base, phase: 'arrive' })).toBe(false);
    expect(cartOut({ ...base, phase: 'toTee' })).toBe(true);
    expect(cartDriving({ ...base, phase: 'toBall' })).toBe(true);
    expect(cartDriving({ ...base, phase: 'swing' })).toBe(false);
    expect(cartOut({ ...base, phase: 'swing' })).toBe(true);
    expect(cartOut({ ...base, phase: 'leave' })).toBe(false);
    expect(cartOut({ phase: 'toBall' })).toBe(false);
  });
  it('a rider keeps their cart through a save and reload', () => {
    const g = carted();
    for (let i = 0; i < 30 * 200 && !g.sim.golfers.some((x) => x.cart !== undefined && x.cart >= 0); i++) g.step(1 / 30);
    const rider = g.sim.golfers.find((x) => x.cart !== undefined && x.cart >= 0)!;
    expect(rider).toBeDefined();
    const back = deserialize(serialize(g))!.game;
    expect(back.sim.golfers.find((x) => x.id === rider.id)!.cart).toBe(rider.cart);
  });
});

describe('dedicated lots near the clubhouse', () => {
  const near = (a: { x: number; y: number }, k: 'puttingGreen' | 'range', c: { x: number; y: number }) =>
    Math.hypot(a.x + ITEMS[k].w! / 2 - (c.x + 3.5), a.y + ITEMS[k].h! / 2 - (c.y + 2.5));
  it('are reserved when the clubhouse is built, near it and clear of everything', () => {
    for (const seed of [1, 7, 4242, 99990]) {
      const g = new Game(undefined, seed);
      expect(g.world.lots).toBeUndefined();
      expect(g.buildClubhouse(suggestClubhouse(g.world)!)).toBe(true);
      const c = g.world.clubhouse!;
      const lots = AMENITY_KINDS.map((k) => ({ k, at: g.world.lots![k]! }));
      for (const { k, at } of lots) {
        expect(at, `${k} ${seed}`).toBeDefined();
        expect(near(at, k, c)).toBeLessThan(26);
        for (let y = at.y; y < at.y + ITEMS[k].h!; y++) for (let x = at.x; x < at.x + ITEMS[k].w!; x++) {
          expect(g.world.terrain[idx(g.world, x, y)]).toBe(T.ROUGH);
          expect(g.world.tree[idx(g.world, x, y)]).toBe(0);
          expect(g.world.zone[idx(g.world, x, y)]).toBe(0);
        }
      }
      const [a, b] = lots;
      expect(a.at.x < b.at.x + ITEMS[b.k].w! && b.at.x < a.at.x + ITEMS[a.k].w! && a.at.y < b.at.y + ITEMS[b.k].h! && b.at.y < a.at.y + ITEMS[a.k].h!).toBe(false);
    }
  });
  it('are kept for their amenity: other buildings and decorations cannot take the ground', () => {
    const g = new Game(undefined, 4242);
    g.buildClubhouse(suggestClubhouse(g.world)!);
    const pg = g.world.lots!.puttingGreen!;
    expect(lotKindAt(g.world, pg.x + 1, pg.y + 1)).toBe('puttingGreen');
    expect(buildingProblem(g.world, pg.x, pg.y, 'barn')).toMatch(/saved for the putting green/);
    g.cash = 99999;
    expect(toggleItem(g, { x: pg.x + 1, y: pg.y + 1 }, 'bench').ok).toBe(false);
    expect(toggleItem(g, { x: pg.x + 1, y: pg.y + 1 }, 'flowers').message).toMatch(/saved/);
  });
  it('are the only place the amenity can go, and it can go there', () => {
    const g = new Game(undefined, 4242);
    g.buildClubhouse(suggestClubhouse(g.world)!);
    g.cash = 99999;
    const lot = g.world.lots!.range!;
    expect(buildingProblem(g.world, lot.x + 2, lot.y, 'range')).toMatch(/marked lot/);
    expect(buildingProblem(g.world, lot.x, lot.y, 'range')).toBeNull();
    expect(toggleItem(g, lot, 'range').ok).toBe(true);
    expect(lotKindAt(g.world, lot.x, lot.y)).toBeNull(); // built: no longer a lot
    // selling it brings the lot back
    expect(toggleItem(g, lot, 'range').removed).toBe(true);
    expect(g.world.lots!.range).toBeDefined();
    expect(buildingProblem(g.world, g.world.lots!.range!.x, g.world.lots!.range!.y, 'range')).toBeNull();
  });
  it('the suggested first hole keeps clear of them', () => {
    for (const seed of [1, 7, 4242, 99990]) {
      const g = new Game(undefined, seed);
      g.buildClubhouse(suggestClubhouse(g.world)!);
      const s = suggestFirstHole(g.world);
      if (!s) continue;
      for (let k = 0; k <= 30; k++) {
        const x = Math.round(s.tee.x + ((s.cup.x - s.tee.x) * k) / 30), y = Math.round(s.tee.y + ((s.cup.y - s.tee.y) * k) / 30);
        expect(lotKindAt(g.world, x, y)).toBeNull();
      }
    }
  });
  it('are saved with the course, and a course from before them gets lots on load', () => {
    const g = new Game(undefined, 4242);
    g.buildClubhouse(suggestClubhouse(g.world)!);
    const back = deserialize(serialize(g))!.game;
    expect(back.world.lots).toEqual(g.world.lots);
    const old = JSON.parse(serialize(g));
    delete old.world.lots;
    const migrated = deserialize(JSON.stringify(old))!.game;
    expect(migrated.world.lots!.puttingGreen).toBeDefined();
    expect(migrated.world.lots!.range).toBeDefined();
  });
  it('move to fresh ground if the player builds over one, and are dropped when there is no room', () => {
    const g = new Game(undefined, 4242);
    g.buildClubhouse(suggestClubhouse(g.world)!);
    const old = { ...g.world.lots!.puttingGreen! };
    for (let y = old.y; y < old.y + 3; y++) for (let x = old.x; x < old.x + 4; x++) g.world.terrain[idx(g.world, x, y)] = T.FAIRWAY;
    reserveLots(g.world);
    const now = g.world.lots!.puttingGreen!;
    expect(now.x !== old.x || now.y !== old.y).toBe(true);
  });
  it('a save that owned the amenities gets them on their lots', () => {
    const g = fresh();
    g.upgrades.range = true;
    const back = deserialize(serialize(g))!.game;
    const it = back.world.items!.find((x) => x.k === 'range')!;
    expect(it).toBeDefined();
    expect(back.world.lots!.range).toBeUndefined();
  });
});
