import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { CFG } from '../src/config';
import { REGION_IDS, REGIONS, ratingStars, seasonIndex } from '../src/progression';
import { planNewHole, planPaint } from '../src/editing';
import { T, createStartingWorld, idx, isOwned } from '../src/terrain';
import { deserialize, serialize } from '../src/save';
import { run } from './helpers';

describe('regions', () => {
  it('each region builds a valid starting course with its own character', () => {
    for (const id of REGION_IDS) {
      const g = new Game(undefined, 1, { region: id });
      expect(g.region).toBe(id);
      expect(g.validate(1).ok).toBe(true);
      expect(g.validate(2).ok).toBe(true);
    }
    const trees = (id: 'parkland' | 'coast' | 'mountain') => createStartingWorld(id).tree.reduce((a, b) => a + b, 0);
    expect(trees('mountain')).toBeGreaterThan(trees('parkland'));
    expect(trees('coast')).toBeLessThan(trees('parkland'));
  });
  it('regional economics change prices and demand', () => {
    const a = new Game(undefined, 1, { region: 'parkland' });
    const b = new Game(undefined, 1, { region: 'coast' });
    expect(b.fair).toBeGreaterThan(a.fair);
    expect(REGIONS.mountain.seasonDemand[3]).toBeLessThan(0.5);
  });
  it('seasons rotate every four days and change demand', () => {
    expect(seasonIndex(1)).toBe(0);
    expect(seasonIndex(5)).toBe(1);
    expect(seasonIndex(17)).toBe(0);
    const g = new Game(undefined, 1, { region: 'mountain' });
    const spring = g.arrivalRate;
    g.day = 13; // winter
    expect(g.arrivalRate).toBeLessThan(spring * 0.6);
  });
});

describe('pricing bands', () => {
  it('each band has its own fee and expected turnout', () => {
    const g = new Game();
    const before = g.bandArrivals('twilight');
    g.setBandFee('twilight', 60);
    expect(g.bandArrivals('twilight')).toBeLessThan(before);
    expect(g.bandArrivals('mid')).toBeGreaterThan(0);
    run(g, 5);
    expect(g.fee).toBe(g.fees.early);
  });
});

describe('land, new holes and the clubhouse', () => {
  it('locked land cannot be edited until bought, and shots there are out of bounds', () => {
    const g = new Game();
    const x = 90;
    const y = 10;
    expect(isOwned(g.world, x, y)).toBe(false);
    const plan = planPaint(g.world, 'fairway', [idx(g.world, x, y)]);
    expect(plan.tiles.length).toBe(0);
    const col = Math.floor(x / CFG.land.pw);
    const row = Math.floor(y / CFG.land.ph);
    g.cash = 5000;
    const price = g.parcelPrice;
    expect(g.buyParcel(col, row)).toBe(true);
    expect(g.cash).toBe(5000 - price);
    expect(g.buyParcel(col, row)).toBe(false);
    expect(planPaint(g.world, 'fairway', [idx(g.world, x, y)]).tiles.length).toBe(1);
    expect(g.parcelPrice).toBeGreaterThan(price);
  });
  it('builds a new hole, validates it, opens it, and undo removes it', () => {
    const g = new Game();
    g.cash = 5000;
    const plan = planNewHole(g.world, g.nextHoleId(), { x: 50, y: 6 }, { x: 66, y: 8 });
    expect(typeof plan).not.toBe('string');
    if (typeof plan === 'string') return;
    const cash = g.cash;
    expect(g.commitEdit(plan).ok).toBe(true);
    expect(g.world.holes.length).toBe(4);
    expect(g.cash).toBe(cash - plan.cost);
    const id = plan.newHole!.id;
    expect(g.hole(id).open).toBe(false);
    expect(g.validate(id).problems).toEqual([]);
    expect(g.openHole(id).ok).toBe(true);
    // hole cap for the starting clubhouse is 4
    const second = planNewHole(g.world, g.nextHoleId(), { x: 52, y: 60 }, { x: 66, y: 62 });
    if (typeof second !== 'string') expect(g.commitEdit(second).ok).toBe(false);
    g.undo();
    expect(g.world.holes.length).toBe(3);
  });
  it('refuses holes that run into other holes or unowned land', () => {
    const w = createStartingWorld();
    expect(typeof planNewHole(w, 4, { x: 30, y: 34 }, { x: 44, y: 34 })).toBe('string');
    expect(typeof planNewHole(w, 4, { x: 90, y: 10 }, { x: 100, y: 12 })).toBe('string');
  });
  it('clubhouse upgrades are gated by rating and cash, and raise demand', () => {
    const g = new Game();
    g.cash = 100000;
    expect(g.stars).toBeLessThan(2.5);
    const before = g.dailyBase;
    expect(g.upgradeClubhouse()).toBe(g.stars >= 1);
    if (g.clubLevel === 0) return;
    expect(g.dailyBase).toBeGreaterThan(before * 1.05);
    expect(g.maxHoles).toBe(9);
    expect(g.upgradeClubhouse()).toBe(false); // level 3 needs 2.5 stars
  });
  it('rating rises with holes, upkeep of turf, and amenities', () => {
    const base = { openHoles: 3, avgCond: 60, rep: 55, amenities: 0, clubLevel: 0 };
    expect(ratingStars({ ...base, openHoles: 12 })).toBeGreaterThan(ratingStars(base));
    expect(ratingStars({ ...base, avgCond: 95 })).toBeGreaterThan(ratingStars(base));
    expect(ratingStars({ openHoles: 18, avgCond: 100, rep: 100, amenities: 6, clubLevel: 4 })).toBe(5);
  });
});

describe('persistence and time away', () => {
  it('saves region, logo, name, land and clubhouse', () => {
    const g = new Game(undefined, 2, { region: 'desert', name: 'Dune Ridge', logo: { shape: 'circle', primary: '#111111', secondary: '#eeeeee', icon: 'sun', initials: 'DR' } });
    g.cash = 9000;
    g.buyParcel(3, 0);
    g.bookEvent('clinic');
    const h = deserialize(serialize(g))!.game;
    expect(h.region).toBe('desert');
    expect(h.name).toBe('Dune Ridge');
    expect(h.logo.icon).toBe('sun');
    expect(h.isParcelOwned(3, 0)).toBe(true);
    expect(h.bookings.length).toBe(1);
    expect(h.goals.length).toBe(g.goals.length);
  });
  it('time away pays modest income, never more than the cap, and cancels missed bookings', () => {
    const g = new Game();
    g.bookEvent('clinic');
    const cash = g.cash;
    expect(g.applyAway(30)).toBeNull();
    const res = g.applyAway(CFG.offline.realSecondsPerDay * 50)!;
    expect(res.days).toBe(CFG.offline.maxDays);
    expect(g.day).toBe(1 + CFG.offline.maxDays);
    expect(g.cash).toBe(cash + res.net);
    expect(g.bookings.length).toBe(0);
    expect(res.net).toBeLessThan(CFG.offline.maxDays * 800);
  });
  it('a tee box on edge tiles survives: new world has owned parcels only around the start', () => {
    const w = createStartingWorld();
    expect(w.parcels.reduce((a, b) => a + b, 0)).toBe(CFG.land.startCols * CFG.land.startRows);
    expect(w.terrain[idx(w, 9, 33)]).toBe(T.TEE);
  });
});
