import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { BUILDING_KINDS, buildingUpkeep, ITEMS, ITEM_KINDS, ItemKind, buildingProblem, countOf, isBuilding, toggleItem } from '../src/items';
import { T, idx } from '../src/terrain';
import { deserialize, serialize } from '../src/save';
import { createTestCourse } from './fixtures/classic-course';

/** A clear rough meadow big enough for several buildings, away from the lots beside the clubhouse. */
function meadow() {
  const g = new Game(createTestCourse(), 3);
  const w = g.world;
  for (let y = 100; y < 140; y++) for (let x = 100; x < 160; x++) { const i = idx(w, x, y); w.terrain[i] = T.ROUGH; w.tree[i] = 0; }
  g.cash = 200000;
  return g;
}
const NEW_BUILDINGS: ItemKind[] = ['proShop', 'grill', 'pavilion', 'nursery', 'shelter'];
const NEW_DECOR: ItemKind[] = ['birdbath', 'picnic', 'flagpole', 'rockgarden', 'planter', 'arch', 'hedge'];

describe('more things to buy', () => {
  it('lists the new buildings and decorations in the tray, each with a price and a hint', () => {
    for (const k of NEW_BUILDINGS) { expect(BUILDING_KINDS).toContain(k); expect(isBuilding(k)).toBe(true); }
    for (const k of NEW_DECOR) { expect(ITEM_KINDS).toContain(k); expect(isBuilding(k)).toBe(false); }
    for (const k of [...NEW_BUILDINGS, ...NEW_DECOR]) { expect(ITEMS[k].cost).toBeGreaterThan(0); expect(ITEMS[k].hint.length).toBeGreaterThan(10); }
  });

  it('builds each one, charges its price, refuses the limit, and refunds when sold', () => {
    const g = meadow();
    let x = 100;
    for (const k of NEW_BUILDINGS) {
      const cash = g.cash;
      const at = { x, y: 110 };
      expect(buildingProblem(g.world, at.x, at.y, k)).toBeNull();
      expect(toggleItem(g, at, k).ok).toBe(true);
      expect(g.cash).toBe(cash - ITEMS[k].cost);
      expect(countOf(g.world, k)).toBe(1);
      x += (ITEMS[k].w ?? 1) + 1;
    }
    // a one-only building cannot be built twice
    expect(buildingProblem(g.world, 100, 125, 'proShop')).toMatch(/already/);
    // shelters allow several
    expect(buildingProblem(g.world, 100, 125, 'shelter')).toBeNull();
    // sell one back
    const cash = g.cash;
    expect(toggleItem(g, { x: 100, y: 110 }, 'proShop')).toEqual({ ok: true, removed: true });
    expect(g.cash).toBe(cash + ITEMS.proShop.cost);
    // they survive a save
    const back = deserialize(serialize(g))!.game;
    expect(countOf(back.world, 'grill')).toBe(1);
    expect(countOf(back.world, 'pavilion')).toBe(1);
    expect(countOf(back.world, 'proShop')).toBe(0);
  });

  it('places the new decorations one tile at a time', () => {
    const g = meadow();
    let x = 100;
    for (const k of NEW_DECOR) {
      const cash = g.cash;
      expect(toggleItem(g, { x, y: 120 }, k).ok).toBe(true);
      expect(g.cash).toBe(cash - ITEMS[k].cost);
      x += 2;
    }
    expect(g.world.items!.length).toBe(NEW_DECOR.length);
  });

  it('daily upkeep covers the new buildings', () => {
    const g = meadow();
    expect(toggleItem(g, { x: 100, y: 110 }, 'grill').ok).toBe(true);
    expect(toggleItem(g, { x: 110, y: 110 }, 'nursery').ok).toBe(true);
    expect(buildingUpkeep(g.world)).toBe(ITEMS.grill.upkeep! + ITEMS.nursery.upkeep!);
  });
});
