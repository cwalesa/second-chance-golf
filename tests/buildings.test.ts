import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { CART_PRICE, FLEET_BASE, FLEET_WITH_BARN, buildingProblem, countOf, toggleItem } from '../src/items';
import { T } from '../src/terrain';
import { deserialize, serialize } from '../src/save';
import { createTestCourse } from './fixtures/classic-course';

function roughSpot(g: Game, skip: { x: number; y: number }[] = []) {
  const w = g.world;
  for (let y = 4; y < w.h - 6; y += 3)
    for (let x = 4; x < w.w - 8; x += 3)
      if (!skip.some((s) => Math.abs(s.x - x) < 6 && Math.abs(s.y - y) < 5) && !buildingProblem(w, x, y, 'barn') && !buildingProblem(w, x, y, 'halfway')) return { x, y };
  throw new Error('no spot');
}

describe('golf buildings and carts', () => {
  it('places, limits, upkeeps and refunds buildings', () => {
    const g = new Game(createTestCourse(), 1);
    g.cash = 40000;
    const a = roughSpot(g);
    const before = g.cash;
    expect(toggleItem(g, a, 'shed').ok).toBe(true);
    expect(g.cash).toBe(before - 3800);
    expect(countOf(g.world, 'shed')).toBe(1);
    expect(buildingProblem(g.world, roughSpot(g, [a]).x, roughSpot(g, [a]).y, 'shed')).toMatch(/already/);
    expect(g.maintenanceRate).toBeGreaterThan(0);
    // overlapping footprint is refused
    expect(toggleItem(g, { x: a.x - 2, y: a.y }, 'barn').ok).toBe(false);
    // tapping it again sells it for the full price
    expect(toggleItem(g, a, 'shed')).toEqual({ ok: true, removed: true });
    expect(g.cash).toBe(before);
  });

  it('the fleet is bought one cart at a time, capped until there is a barn', () => {
    const g = new Game(createTestCourse(), 1);
    g.cash = 50000;
    expect(g.buyCart()).toBe(false); // no carts yet
    g.buyUpgrade('carts');
    expect(g.fleet).toBe(FLEET_BASE);
    expect(g.buyCart()).toBe(false);
    expect(g.maxFleet).toBe(FLEET_BASE);
    const spot = roughSpot(g);
    expect(toggleItem(g, spot, 'barn').ok).toBe(true);
    expect(g.maxFleet).toBe(FLEET_WITH_BARN);
    const cash = g.cash;
    expect(g.buyCart()).toBe(true);
    expect(g.cash).toBe(cash - CART_PRICE);
    expect(g.fleet).toBe(FLEET_BASE + 1);
    expect(g.fleetFactor).toBe(1);
  });

  it('saves keep buildings and the fleet; old saves with carts get a starting fleet', () => {
    const g = new Game(createTestCourse(), 1);
    g.cash = 50000;
    g.buyUpgrade('carts');
    toggleItem(g, roughSpot(g), 'halfway');
    const back = deserialize(serialize(g))!.game;
    expect(back.fleet).toBe(g.fleet);
    expect(countOf(back.world, 'halfway')).toBe(1);
    const raw = JSON.parse(serialize(g));
    delete raw.fleet;
    expect(deserialize(JSON.stringify(raw))!.game.fleet).toBe(6);
  });

  it('a halfway house raises clubhouse spending and a shed slows turf wear', () => {
    const g = new Game(createTestCourse(), 1);
    g.cash = 50000;
    const wear = g.sim.wearMult;
    toggleItem(g, roughSpot(g), 'shed');
    expect(g.sim.wearMult).toBeCloseTo(wear * 0.85, 6);
    expect(g.world.terrain[0]).toBeDefined();
    expect(T.ROUGH).toBe(0);
  });
});
