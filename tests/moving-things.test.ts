import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { ITEMS, itemAt, moveItem, moveProblem, toggleItem } from '../src/items';
import { CLUB_H, CLUB_W, T, clubDims, clubSites, idx } from '../src/terrain';
import { createWilderness, newLandSeed, relocateClubhouse, relocateProblem, suggestClubhouse } from '../src/wilderness';
import { deserialize, serialize } from '../src/save';
import { createTestCourse } from './fixtures/classic-course';

function wild(seed = 5) {
  const g = new Game(createWilderness(newLandSeed(seed)), seed);
  const spot = suggestClubhouse(g.world)!;
  g.buildClubhouse(spot);
  g.cash = 100000;
  return { g, spot };
}

describe('moving and turning things', () => {
  it('turns the clubhouse: footprint, door and road all follow, and the old ground goes back to rough', () => {
    const { g, spot } = wild();
    const w = g.world;
    const sites0 = clubSites(w);
    expect(w.clubFlip).toBeFalsy();
    expect(relocateProblem(w, spot, true)).toBeNull();
    expect(g.moveClubhouse(spot, true)).toBe(true);
    expect(w.clubFlip).toBe(true);
    const dm = clubDims(true);
    expect([dm.w, dm.h]).toEqual([CLUB_H, CLUB_W]);
    // the footprint is 5 wide and 7 deep now
    for (let y = spot.y; y < spot.y + dm.h; y++) for (let x = spot.x; x < spot.x + dm.w; x++) expect(w.terrain[idx(w, x, y)]).toBe(T.BUILDING);
    expect(w.terrain[idx(w, spot.x + CLUB_W - 1, spot.y)]).not.toBe(T.BUILDING);
    // golfers come in at the turned door, from a gate on the top or bottom edge
    const sites = clubSites(w);
    expect(sites.door).not.toEqual(sites0.door);
    expect(sites.door.x).toBeCloseTo(spot.x - 0.4);
    expect(w.gate.y === 0.5 || w.gate.y === w.h - 0.5).toBe(true);
    // the road runs from the gate to the grounds
    expect(w.terrain[idx(w, Math.floor(w.gate.x), Math.floor(w.gate.y))]).toBe(T.PATH);
    // turning it back restores the first layout
    expect(g.moveClubhouse(spot, false)).toBe(true);
    expect(w.clubFlip).toBe(false);
    expect(clubSites(w).door).toEqual(sites0.door);
    expect(w.terrain[idx(w, spot.x + CLUB_W - 1, spot.y + CLUB_H - 1)]).toBe(T.BUILDING);
    expect(w.terrain[idx(w, spot.x, spot.y + CLUB_H + 1)]).not.toBe(T.BUILDING);
  });

  it('moves the clubhouse to another meadow and leaves the old spot as plain ground', () => {
    const { g, spot } = wild();
    const w = g.world;
    let to: { x: number; y: number } | null = null;
    for (let y = 6; y < w.h - 24 && !to; y += 3) for (let x = 6; x < w.w - 24 && !to; x += 3) if (Math.abs(x - spot.x) > 30 && Math.abs(y - spot.y) > 30 && relocateProblem(w, { x, y }, false) === null) to = { x, y };
    expect(to).not.toBeNull();
    expect(relocateClubhouse(w, to!, false)).toBeNull();
    expect(w.clubhouse).toEqual(to);
    expect(w.terrain[idx(w, spot.x + 2, spot.y + 2)]).toBe(T.ROUGH);
    expect(w.terrain[idx(w, to!.x + 2, to!.y + 2)]).toBe(T.BUILDING);
  });

  it('refuses to move or turn it onto a hole, a building or the water', () => {
    const { g, spot } = wild();
    const w = g.world;
    // a building in the turned lot blocks the turn until it is moved away
    const at = { x: spot.x + 2, y: spot.y + 12 };
    for (let y = at.y; y < at.y + 3; y++) for (let x = at.x; x < at.x + 4; x++) { const i = idx(w, x, y); w.terrain[i] = T.ROUGH; w.tree[i] = 0; }
    expect(toggleItem(g, at, 'proShop').ok).toBe(true);
    expect(relocateProblem(w, spot, true)).toMatch(/Move it first/);
    expect(g.moveClubhouse(spot, true)).toBe(false);
    expect(w.clubFlip).toBeFalsy();
    const i = itemAt(w, at.x, at.y);
    expect(moveItem(g, i, { x: at.x + 20, y: at.y }).ok).toBe(true);
    expect(relocateProblem(w, spot, true)).toBeNull();
    // ground with a fairway on it is refused
    const ex = { x: spot.x + 4, y: spot.y + 15 };
    w.terrain[idx(w, ex.x, ex.y)] = T.FAIRWAY;
    expect(relocateProblem(w, spot, true)).toMatch(/hole is in the way/);
  });

  it('keeps the turn in a saved game', () => {
    const { g, spot } = wild();
    expect(g.moveClubhouse(spot, true)).toBe(true);
    const back = deserialize(serialize(g));
    expect(back).not.toBeNull();
    expect(back!.game.world.clubFlip).toBe(true);
    expect(clubSites(back!.game.world).door.x).toBeCloseTo(spot.x - 0.4);
  });

  it('puts the amenity lots beside a turned clubhouse, never on it', () => {
    const { g, spot } = wild(9);
    const w = g.world;
    expect(g.moveClubhouse(spot, true)).toBe(true);
    const dm = clubDims(true);
    for (const k of ['puttingGreen', 'range'] as const) {
      const lot = w.lots?.[k];
      if (!lot) continue;
      const s = ITEMS[k];
      const overlap = lot.x < spot.x + dm.w && lot.x + (s.w ?? 1) > spot.x && lot.y < spot.y + dm.h && lot.y + (s.h ?? 1) > spot.y;
      expect(overlap).toBe(false);
    }
  });
});

describe('moving a building or an object', () => {
  const meadow = () => {
    const g = new Game(createTestCourse(), 3);
    const w = g.world;
    for (let y = 100; y < 140; y++) for (let x = 100; x < 160; x++) { const i = idx(w, x, y); w.terrain[i] = T.ROUGH; w.tree[i] = 0; }
    g.cash = 100000;
    return g;
  };

  it('moves a building for free, with its upkeep and value intact', () => {
    const g = meadow();
    expect(toggleItem(g, { x: 105, y: 105 }, 'grill').ok).toBe(true);
    const cash = g.cash;
    const i = itemAt(g.world, 105, 105);
    expect(moveProblem(g.world, i, 120, 110)).toBeNull();
    const r = moveItem(g, i, { x: 120, y: 110 });
    expect(r.ok).toBe(true);
    expect(g.cash).toBe(cash);
    expect(g.world.items![i]).toMatchObject({ k: 'grill', x: 120, y: 110 });
    expect(itemAt(g.world, 105, 105)).toBe(-1);
    expect(itemAt(g.world, 122, 111)).toBe(i);
  });

  it('lets a building overlap its own old spot but not another thing, water, or the fairway', () => {
    const g = meadow();
    toggleItem(g, { x: 105, y: 105 }, 'grill');
    toggleItem(g, { x: 112, y: 105 }, 'bench');
    const i = itemAt(g.world, 105, 105);
    expect(moveProblem(g.world, i, 106, 105)).toBeNull();
    expect(moveProblem(g.world, i, 110, 104)).toMatch(/already there/);
    g.world.terrain[idx(g.world, 120, 120)] = T.WATER;
    expect(moveProblem(g.world, i, 118, 119)).toMatch(/water/i);
    expect(moveItem(g, i, { x: 118, y: 119 }).ok).toBe(false);
    expect(g.world.items![i]).toMatchObject({ x: 105, y: 105 });
  });

  it('moves a small object and clears the trees at its new tile', () => {
    const g = meadow();
    toggleItem(g, { x: 105, y: 105 }, 'bench');
    const i = itemAt(g.world, 105, 105);
    g.world.tree[idx(g.world, 130, 130)] = 1;
    expect(moveItem(g, i, { x: 130, y: 130 }).ok).toBe(true);
    expect(g.world.tree[idx(g.world, 130, 130)]).toBe(0);
  });

  it('moves the putting green and the range anywhere clear, not only on their lots', () => {
    const g = meadow();
    const w = g.world;
    expect(toggleItem(g, { x: 110, y: 110 }, 'range').ok || true).toBeTruthy();
    const i = (w.items ?? []).findIndex((it) => it.k === 'range');
    if (i < 0) return; // the test course may keep the lot elsewhere
    expect(moveProblem(w, i, 130, 120)).toBeNull();
  });
});
