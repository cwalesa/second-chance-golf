import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { planNewHole, planPaint } from '../src/editing';
import { suggestClubhouse, suggestFirstHole } from '../src/wilderness';
import { T } from '../src/terrain';
import { Ctx, SAND_NEEDED, STEPS, StepId, bunkerZone, legacyTutorialStep, parLine, stepIndex } from '../src/tutorial';
import { deserialize, serialize } from '../src/save';
import { CFG } from '../src/config';

const step = (id: StepId) => STEPS[stepIndex(id)];
function ctx(g: Game, e: Record<string, unknown> = {}): Ctx {
  const editor = { proposal: null, buildStarted: false, newPar: 3, tool: 'build', clubSpot: null, clubLocked: false, overlay: { staged: new Set<number>(), stagedKind: new Map() }, ...e };
  return { g, e: editor as unknown as Ctx['e'], r: {} as Ctx['r'], ui: { tab: 'none', menuOpen: false } as unknown as Ctx['ui'], mark: {} };
}
function club() {
  const g = new Game(undefined, 20250601);
  expect(g.buildClubhouse(suggestClubhouse(g.world)!)).toBe(true);
  return g;
}
function withHole(g: Game) {
  const s = suggestFirstHole(g.world)!;
  const plan = planNewHole(g.world, g.nextHoleId(), s.tee, s.cup, { par: 3 });
  expect(typeof plan).not.toBe('string');
  expect(g.commitEdit(plan as Exclude<typeof plan, string>).ok).toBe(true);
  return g.world.holes[g.world.holes.length - 1];
}

describe('tutorial steps', () => {
  it('teaches only what one hole needs, in order, ending with the clock', () => {
    expect(STEPS.map((s) => s.id)).toEqual(['club', 'par', 'tee', 'green', 'build', 'bunker', 'open', 'watch', 'finances', 'fee', 'done']);
    // no step mentions systems that belong to later introductions
    const text = STEPS.map((s) => s.short(ctx(new Game(undefined, 1)))).join(' ').toLowerCase();
    for (const w of ['halfway', 'dogleg', 'bend', 'click']) expect(text).not.toContain(w);
  });

  it('the clubhouse step is skipped when a clubhouse already stands (replay)', () => {
    const g = new Game(undefined, 20250601);
    expect(step('club').skipIf!(ctx(g))).toBe(false);
    g.buildClubhouse(suggestClubhouse(g.world)!);
    expect(step('club').skipIf!(ctx(g))).toBe(true);
    expect(step('club').check!(ctx(g))).toBe(true);
  });

  it('explains par with the real length ranges', () => {
    expect(parLine(3)).toBe('Par 3: one shot to the green, about 80–230 yd.');
    expect(parLine(4)).toContain('230–430');
    expect(parLine(5)).toContain('430–620');
  });

  it('tee and green steps wait for the player, and a cancelled placement sends them back', () => {
    const g = club();
    expect(step('tee').check!(ctx(g))).toBe(false);
    expect(step('tee').check!(ctx(g, { buildStarted: true }))).toBe(true);
    expect(step('green').check!(ctx(g, { buildStarted: true }))).toBe(false);
    expect(step('green').back!(ctx(g, { buildStarted: false }))).toBe('tee');
    expect(step('green').back!(ctx(g, { buildStarted: true }))).toBeNull();
    const nh = planNewHole(g.world, 1, suggestFirstHole(g.world)!.tee, suggestFirstHole(g.world)!.cup);
    expect(step('green').check!(ctx(g, { proposal: nh }))).toBe(true);
  });

  it('the build step reports length and cost, warns when the length does not fit the par, and finishes when the hole exists', () => {
    const g = club();
    const s = suggestFirstHole(g.world)!;
    const c = ctx(g);
    const plan = planNewHole(g.world, 1, s.tee, s.cup, { par: 3 }) as Exclude<ReturnType<typeof planNewHole>, string>;
    c.e = { ...c.e, proposal: plan } as unknown as Ctx['e'];
    c.mark.n = 0;
    expect(step('build').short(c)).toMatch(/yd, par 3, \$[\d,]+\. Tap Build\./);
    const wrongPar = planNewHole(g.world, 1, s.tee, s.cup, { par: 5 }) as Exclude<ReturnType<typeof planNewHole>, string>;
    c.e = { ...c.e, proposal: wrongPar } as unknown as Ctx['e'];
    expect(step('build').short(c)).toMatch(/short for a par 5/);
    c.e = { ...c.e, proposal: null } as unknown as Ctx['e'];
    expect(step('build').check!(c)).toBe(false);
    withHole(g);
    expect(step('build').check!(c)).toBe(true);
    expect(c.mark.holeId).toBe(1);
    // cancelling instead sends the player back to the tee step
    const c2 = ctx(g);
    c2.mark.n = g.world.holes.length;
    expect(step('build').back!(c2)).toBe('tee');
  });

  it('the bunker step wants sand inside the outlined area beside the green, not just anywhere', () => {
    const g = club();
    const h = withHole(g);
    const c = ctx(g);
    c.mark.holeId = h.id;
    const z = bunkerZone(g.world, h);
    expect(Math.hypot(z.x - h.cup.x, z.y - h.cup.y)).toBeLessThan(8);
    expect(step('bunker').zone!(c)!.label).toBe('Sand here');
    expect(step('bunker').check!(c)).toBe(false);
    // sand far from the zone does not count
    const far: number[] = [];
    for (let k = 0; k < 8; k++) far.push((h.tee.y + 12) * g.world.w + h.tee.x - 12 + k);
    expect(g.commitEdit(planPaint(g.world, 'bunker', far)).ok).toBe(true);
    expect(step('bunker').check!(c)).toBe(false);
    // sand in it does
    const tiles: number[] = [];
    for (let y = Math.floor(z.y - 2); y <= z.y + 2; y++) for (let x = Math.floor(z.x - 2); x <= z.x + 2; x++) if (Math.hypot(x - z.x, y - z.y) <= 2 && g.world.terrain[y * g.world.w + x] !== T.GREEN) tiles.push(y * g.world.w + x);
    expect(g.commitEdit(planPaint(g.world, 'bunker', tiles)).ok).toBe(true);
    expect(tiles.length).toBeGreaterThanOrEqual(SAND_NEEDED);
    expect(step('bunker').check!(c)).toBe(true);
    expect(step('bunker').skippable).toBe(true);
  });

  it('opening, test golfers and the fee step each check what the player did', () => {
    const g = club();
    const h = withHole(g);
    const c = ctx(g);
    c.mark.holeId = h.id;
    expect(step('open').check!(c)).toBe(false);
    g.openHole(h.id);
    expect(step('open').check!(c)).toBe(true);
    step('watch').enter!(c);
    expect(g.settings.speed).toBe(8);
    expect(step('watch').check!(c)).toBe(false);
    for (let i = 0; i < 40 * 30; i++) g.step(CFG.sim.dt);
    expect(step('watch').check!(c)).toBe(true);
    // finances: opening the tab is its own step, and the fee step only passes when a fee really changed
    expect(step('finances').check!(ctx(g))).toBe(false);
    expect(step('finances').check!({ ...ctx(g), ui: { tab: 'money' } as unknown as Ctx['ui'] })).toBe(true);
    step('fee').enter!(c);
    expect(step('fee').check!(c)).toBe(false);
    g.setBandFee('mid', g.fees.mid + 1);
    expect(step('fee').check!(c)).toBe(true);
    expect(step('fee').tab).toBe('money');
    expect(step('finances').tab).toBe('money');
  });
});

describe('tutorial and old saves', () => {
  const base = () => {
    const g = club();
    withHole(g);
    return JSON.parse(serialize(g));
  };
  it('maps old practice steps onto the new ones', () => {
    expect(STEPS[legacyTutorialStep(0, true)].id).toBe('par');
    expect(STEPS[legacyTutorialStep(2, true)].id).toBe('bunker');
    expect(STEPS[legacyTutorialStep(4, true)].id).toBe('open');
    expect(STEPS[legacyTutorialStep(6, true)].id).toBe('finances');
    expect(STEPS[legacyTutorialStep(2, false)].id).toBe('par');
  });
  it('a save made mid-practice loads, becomes an ordinary course and resumes the tutorial', () => {
    const d = base();
    d.practice = true; d.name = 'Practice Course'; d.cash = 57000; d.tutorial = { step: 4, done: false };
    const loaded = deserialize(JSON.stringify(d))!;
    expect(loaded.legacyPractice).toBe(true);
    expect(loaded.game.name).toBe('Willow Creek');
    expect(loaded.game.cash).toBeLessThanOrEqual(CFG.economy.startCash);
    expect(loaded.game.tutorial.done).toBe(false);
    expect(STEPS[loaded.game.tutorial.step].id).toBe('open');
    // and it round-trips
    expect(deserialize(serialize(loaded.game))!.game.tutorial.step).toBe(loaded.game.tutorial.step);
  });
  it('a finished practice save, a real-course save from before, and a save with no tutorial all load as finished', () => {
    for (const mut of [(d: any) => { d.practice = true; d.tutorial = { step: 7, done: true }; }, (d: any) => { d.tutorial = { step: 3, done: false }; }, (d: any) => { delete d.tutorial; }]) {
      const d = base(); mut(d);
      const l = deserialize(JSON.stringify(d))!;
      expect(l).not.toBeNull();
      expect(l.game.tutorial.done).toBe(true);
    }
  });
  it('a new-format save keeps its place by step id', () => {
    const g = new Game(undefined, 5);
    g.tutorial = { step: 2, done: false, at: 'green', v: 2 };
    expect(deserialize(serialize(g))!.game.tutorial.at).toBe('green');
  });
});
