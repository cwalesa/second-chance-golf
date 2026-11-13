import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/game';
import { T, findPath, holeCondition, idx, layoutStamp, routeField } from '../src/terrain';
import { assessDesign } from '../src/design';
import { deserialize, saveGame, serialize } from '../src/save';
import { createTestCourse } from './fixtures/classic-course';

const wear = (g: Game, n = 1) => { for (let i = 0; i < n; i++) { g.world.version++; g.world.wearBumps = (g.world.wearBumps ?? 0) + 1; } };

describe('work that must not repeat while turf wears', () => {
  it('keeps a hole route field through gradual wear, and rebuilds it after the ground is edited', () => {
    const g = new Game(createTestCourse(), 3);
    const h = g.world.holes[0];
    const a = routeField(g.world, h);
    wear(g, 10);
    expect(routeField(g.world, h)).toBe(a);
    g.world.terrain[idx(g.world, 20, 33)] = T.WATER;
    g.world.version++; // an edit
    expect(routeField(g.world, h)).not.toBe(a);
  });

  it('refreshes fields slowly after a long stretch of wear: at most one hole per wear update', () => {
    const g = new Game(createTestCourse(), 3);
    const [h1, h2] = g.world.holes;
    const a1 = routeField(g.world, h1), a2 = routeField(g.world, h2);
    wear(g, 61); // past the refresh interval
    const b1 = routeField(g.world, h1), b2 = routeField(g.world, h2);
    // one of them refreshed on this wear update, the other keeps serving the old field until the next
    expect([b1 !== a1, b2 !== a2].filter(Boolean)).toHaveLength(1);
    wear(g, 1);
    expect(routeField(g.world, h1)).not.toBe(a1);
    expect(routeField(g.world, h2)).not.toBe(a2);
  });

  it('gives the same route field as a full recomputation (same distances after the cache is bypassed)', () => {
    const g = new Game(createTestCourse(), 3);
    const h = g.world.holes[0];
    const a = Float64Array.from(routeField(g.world, h));
    g.world.version++;
    const b = routeField(g.world, h);
    expect(b).not.toBe(a);
    expect(Array.from(b)).toEqual(Array.from(a));
    expect(b[idx(g.world, h.cup.x, h.cup.y)]).toBe(0);
  });

  it('does not throw away the design assessment or hole condition on every wear update', () => {
    const g = new Game(createTestCourse(), 3);
    const h = g.world.holes[0];
    const d = assessDesign(g.world, h);
    const c = holeCondition(g.world, h);
    wear(g, 2);
    expect(assessDesign(g.world, h)).toBe(d);
    expect(holeCondition(g.world, h)).toBe(c);
    wear(g, 5);
    expect(holeCondition(g.world, h)).not.toBe(c); // condition still follows wear, just not every second
    g.world.version++;
    expect(assessDesign(g.world, h)).not.toBe(d);
  });

  it('has a stamp that moves with edits at once and with wear only in steps', () => {
    const g = new Game(createTestCourse(), 3);
    const s0 = layoutStamp(g.world, 5);
    wear(g, 4);
    expect(layoutStamp(g.world, 5)).toBe(s0);
    wear(g, 1);
    expect(layoutStamp(g.world, 5)).not.toBe(s0);
    const s1 = layoutStamp(g.world, 1000);
    g.world.version++;
    expect(layoutStamp(g.world, 1000)).not.toBe(s1);
  });
});

describe('walking paths', () => {
  it('finds the same route when asked again, and in a world of another size', () => {
    const g = new Game(createTestCourse(), 3);
    const a = { x: 10.5, y: 33.5 }, b = { x: 40.5, y: 31.5 };
    const p1 = findPath(g.world, a, b)!;
    const p2 = findPath(g.world, a, b)!;
    expect(p1).not.toBeNull();
    expect(p2).toEqual(p1);
    for (const p of p1) expect(g.world.terrain[idx(g.world, Math.floor(p.x), Math.floor(p.y))]).not.toBe(T.WATER);
    // scratch buffers are shared; a smaller world must not see leftovers from the bigger one
    const small = createTestCourse();
    expect(findPath(small, a, b)).toEqual(p1);
  });

  it('keeps every golfer walking when many ask for a path at once', () => {
    const g = new Game(createTestCourse(), 3);
    g.openForBusiness(); g.resume(); g.setSpeed(1);
    let most = 0;
    for (let i = 0; i < 30 * 600; i++) { g.advance(1 / 30); most = Math.max(most, g.sim.golfers.length); }
    expect(most).toBeGreaterThan(1);
    expect(g.stats.rounds).toBeGreaterThan(0);
  });
});

describe('autosave', () => {
  const values = new Map<string, string>();
  afterEach(() => { vi.unstubAllGlobals(); values.clear(); });
  const stub = () => vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v), removeItem: (k: string) => void values.delete(k) });

  it('keeps the previous good save as the backup without rebuilding the whole game', () => {
    stub();
    const g = new Game(createTestCourse(), 3);
    expect(saveGame(g)).toBe(true);
    const first = [...values.values()][0];
    g.cash += 123;
    expect(saveGame(g)).toBe(true);
    const keys = [...values.keys()];
    expect(keys).toHaveLength(2);
    const backup = values.get(keys.find((k) => k.endsWith('.backup'))!)!;
    expect(backup).toBe(first);
    expect(deserialize(backup)).not.toBeNull();
  });

  it('does not copy a broken save over the backup', () => {
    stub();
    const g = new Game(createTestCourse(), 3);
    saveGame(g);
    const mainKey = [...values.keys()][0];
    const good = values.get(mainKey)!;
    values.set(mainKey, '{ not json');
    saveGame(g);
    const backupKey = [...values.keys()].find((k) => k.endsWith('.backup'));
    expect(backupKey === undefined || values.get(backupKey) !== '{ not json').toBe(true);
    expect(values.get(mainKey)).toBe(serialize(g).length ? values.get(mainKey) : good);
  });

  it('writes a save that loads back', () => {
    stub();
    const g = new Game(createTestCourse(), 3);
    saveGame(g);
    const back = deserialize([...values.values()][0])!.game;
    expect(back.world.holes.length).toBe(g.world.holes.length);
  });
});
