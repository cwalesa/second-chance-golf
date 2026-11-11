import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { ITEMS, beautyNear, itemProblem, toggleItem } from '../src/items';
import { T, idx } from '../src/terrain';
import { deserialize, serialize } from '../src/save';
import { createTestCourse } from './fixtures/classic-course';

describe('placed decorations and structures', () => {
  it('places on rough, refuses greens and water, and a second tap removes with a refund', () => {
    const g = new Game(createTestCourse(), 1);
    const w = g.world;
    let spot = { x: 0, y: 0 };
    for (let i = 0; i < w.terrain.length; i++) if (w.terrain[i] === T.ROUGH && i % w.w > 5) { spot = { x: i % w.w, y: Math.floor(i / w.w) }; break; }
    const cash = g.cash;
    expect(toggleItem(g, spot, 'fountain').ok).toBe(true);
    expect(g.cash).toBe(cash - ITEMS.fountain.cost);
    expect(w.tree[idx(w, spot.x, spot.y)]).toBe(0);
    expect(beautyNear(w, spot)).toBe(ITEMS.fountain.beauty);
    const back = deserialize(serialize(g))!.game;
    expect(back.world.items).toEqual([{ x: spot.x, y: spot.y, k: 'fountain' }]);
    expect(toggleItem(g, spot, 'bench')).toEqual({ ok: true, removed: true });
    expect(g.cash).toBe(cash);
    const green = w.holes[0].cup;
    expect(itemProblem(w, green.x, green.y)).toMatch(/green/);
    let wet = -1;
    for (let i = 0; i < w.terrain.length && wet < 0; i++) if (w.terrain[i] === T.WATER) wet = i;
    expect(toggleItem(g, { x: wet % w.w, y: Math.floor(wet / w.w) }, 'flowers').ok).toBe(false);
  });
});
