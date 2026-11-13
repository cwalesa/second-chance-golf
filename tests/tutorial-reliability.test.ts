import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { T, isOwned } from '../src/terrain';
import { planPaint } from '../src/editing';
import { STEPS } from '../src/tutorial';
import { createTestCourse } from './fixtures/classic-course';
import { suggestClubhouse } from '../src/wilderness';

/** A stand-in for what the tutorial reads from the editor and the interface; the checks under test only touch the game and `mark`. */
const ctxFor = (g: Game) => ({ g, e: { proposal: null, tool: 'bunker' } as never, r: {} as never, ui: { tab: 'build' } as never, mark: {} as Record<string, unknown> });
const step = (id: string) => STEPS.find((s) => s.id === id)!;

/** Owned rough tiles, taken from the far end of the map so the bunker is deliberately not "beside the green". */
function farRough(g: Game): number[] {
  const w = g.world;
  const out: number[] = [];
  for (let i = w.terrain.length - 1; i >= 0 && out.length < 6; i--) if (w.terrain[i] === T.ROUGH && !w.tree[i] && isOwned(w, i % w.w, Math.floor(i / w.w))) out.push(i);
  return out;
}

describe('tutorial steps follow committed game state', () => {
  it('the bunker step completes when any bunker is built, and not before; undo takes it back with the money', () => {
    const g = new Game(createTestCourse(), 4);
    const c = ctxFor(g);
    const improve = step('improve');
    c.mark.undoBase = new Set(g.undoStack);
    expect(improve.check!(c)).toBe(false);
    // painting alone (a plan that was never committed) changes nothing
    const plan = planPaint(g.world, 'bunker', farRough(g));
    expect(plan.tiles.length).toBeGreaterThan(0);
    expect(improve.check!(c)).toBe(false);
    const cash = g.cash;
    expect(g.commitEdit(plan).ok).toBe(true);
    expect(g.cash).toBe(cash - plan.cost);
    expect(improve.check!(c)).toBe(true); // built far from the green: still counts
    expect(g.undo()).toBe(true);
    expect(g.cash).toBe(cash);
    for (const t of plan.tiles) expect(g.world.terrain[t.i]).toBe(t.before.t);
    expect(improve.check!(c)).toBe(false);
  });

  it('a bunker built before the step began does not count, and Done (leaving the tray) completes it', () => {
    const g = new Game(createTestCourse(), 4);
    expect(g.commitEdit(planPaint(g.world, 'bunker', farRough(g))).ok).toBe(true);
    const c = ctxFor(g);
    c.mark.undoBase = new Set(g.undoStack); // what enter() records
    expect(step('improve').check!(c)).toBe(false);
    c.mark.left = true; // what ensure() records once the tray is closed with nothing staged
    expect(step('improve').check!(c)).toBe(true);
  });

  it('the clubhouse step is satisfied the moment the clubhouse exists', () => {
    const g = new Game(undefined, 5);
    const c = ctxFor(g);
    expect(step('club').check!(c)).toBe(false);
    const spot = suggestClubhouse(g.world)!;
    expect(g.buildClubhouse({ x: spot.x, y: spot.y })).toBe(true);
    expect(step('club').check!(c)).toBe(true);
  });

  it('the game announces committed changes so guidance can update at once', () => {
    const g = new Game(createTestCourse(), 4);
    let calls = 0;
    g.onStateChanged = () => { calls++; };
    g.commitEdit(planPaint(g.world, 'bunker', farRough(g)));
    expect(calls).toBeGreaterThan(0);
    const after = calls;
    g.undo();
    expect(calls).toBeGreaterThan(after);
  });

  it('every step has an instruction, and the optional ones can be skipped to a real step', () => {
    const ids = STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STEPS) {
      if (s.skipTo) expect(ids).toContain(s.skipTo);
      expect(typeof s.short).toBe('function');
      // a step either finishes by itself, or has a button
      expect(!!s.check || s.manual !== false).toBe(true);
    }
  });
});
