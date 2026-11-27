import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { STEPS } from '../src/tutorial';
import { createWilderness } from '../src/wilderness';
import { setUpOpening, OPENING } from '../src/opening';
import { holeYards } from '../src/terrain';

/** A stand-in for what the tutorial reads from the editor and the interface; the checks under test only touch the game and `mark`. */
const ctxFor = (g: Game) => ({ g, e: { proposal: null, tool: 'inspect', overlay: {}, focusHole: () => {} } as never, r: {} as never, ui: { tab: 'none' } as never, mark: {} as Record<string, unknown> });
const step = (id: string) => STEPS.find((s) => s.id === id)!;
/** A new course as the start screen makes it: clubhouse and the designed opening par 4, with a guided round under way. */
function course(seed = 11) {
  const w = createWilderness(seed, 'parkland');
  const o = setUpOpening(w)!;
  const g = new Game(w, seed);
  g.selectedHole = 1;
  g.owner.start(g, false, true);
  return { g, o, c: ctxFor(g) };
}
/** Fly the ball until it stops. */
const land = (g: Game) => { for (let k = 0; k < 400 && g.owner.flight; k++) g.owner.update(g, 0.05); };

describe('the opening hole tutorial follows what the player does', () => {
  it('opens on a designed par 4 that plays as one', () => {
    const { g, o } = course();
    const h = g.hole(1);
    expect(h.par).toBe(4);
    expect(holeYards(h)).toBeGreaterThanOrEqual(OPENING.minLen * 10 - 10);
    expect(holeYards(h)).toBeLessThanOrEqual(OPENING.maxLen * 10 + 20);
    expect(g.validate(1).ok).toBe(true);
    // the starter driver cannot reach the green from the tee
    expect(Math.hypot(h.cup.x - h.tee.x, h.cup.y - h.tee.y)).toBeGreaterThan(25 + OPENING.green);
    expect(o.plan.landing).toBeTruthy();
  });
  it('a guided round waits for the player to aim: nothing is aimed for them', () => {
    const { g } = course();
    expect(g.owner.aim).toBeNull();
    g.owner.hit(g, 0);
    expect(g.owner.shots).toBe(0); // no aim, no shot
  });
  it('the aim step passes only for an aim that lands in the highlighted area', () => {
    const { g, o, c } = course();
    const aim = step('aim');
    expect(aim.check!(c)).toBe(false);
    g.owner.aim = { x: o.plan.landing.x + 14, y: o.plan.landing.y - 14 };
    expect(aim.check!(c)).toBe(false);
    expect(aim.short(c)).toMatch(/outside the landing area/);
    g.owner.aim = { x: o.plan.landing.x + 0.5, y: o.plan.landing.y + 0.5 };
    expect(aim.check!(c)).toBe(true);
  });
  it('the swing steps advance on starting the swing and on striking, not on anything else', () => {
    const { g, o, c } = course();
    g.owner.aim = { x: o.plan.landing.x + 0.5, y: o.plan.landing.y + 0.5 };
    expect(step('swing').check!(c)).toBe(false);
    g.owner.swing.start();
    expect(step('swing').check!(c)).toBe(true);
    expect(step('strike').check!(c)).toBe(false);
    g.owner.hit(g, g.owner.swing.strike());
    expect(step('strike').check!(c)).toBe(true);
    expect(step('flight').check!(c)).toBe(false); // still in the air
    land(g);
    expect(step('flight').check!(c)).toBe(true);
  });
  it('the approach asks for the club the distance needs, then an aim at the green', () => {
    const { g, o, c } = course();
    g.owner.aim = { x: o.plan.landing.x + 0.5, y: o.plan.landing.y + 0.5 };
    g.owner.hit(g, 0); land(g);
    const want = g.owner.suggestedClub(g);
    expect(['iron', 'wedge']).toContain(want);
    expect(step('club2').check!(c)).toBe(false); // still holding the driver
    expect(step('club2').short(c)).toMatch(new RegExp(want === 'iron' ? 'Iron' : 'Wedge'));
    g.owner.club = want;
    expect(step('club2').check!(c)).toBe(true);
    const h = g.hole(1);
    g.owner.aim = { x: h.cup.x + 9, y: h.cup.y + 9 };
    expect(step('aim2').check!(c)).toBe(false);
    g.owner.aim = { x: h.cup.x + 0.5, y: h.cup.y + 0.5 };
    expect(step('aim2').check!(c)).toBe(true);
  });
  it('struggling offers a retry that starts the hole again from the tee', () => {
    const { g, c } = course();
    g.owner.strokes = 6; g.owner.shots = 6;
    expect(step('club2').retry!(c)).toBe(true);
    g.owner.restartHole(g);
    expect(g.owner.strokes).toBe(0);
    expect(g.owner.ball).toEqual({ x: g.hole(1).tee.x + 0.5, y: g.hole(1).tee.y + 0.5 });
    expect(step('club2').retry!(c)).toBe(false);
  });
  it('finishing pays the first-round gift once, and never on a replay', () => {
    const { g, c } = course();
    const done = step('done');
    const cash = g.cash;
    expect(done.action!(c)).toBe(true);
    expect(g.cash).toBe(cash + 400);
    expect(done.action!(c)).toBe(true);
    expect(g.cash).toBe(cash + 400);
    const g2 = course(222).g; g2.tutorial.replay = true;
    const c2 = ctxFor(g2), cash2 = g2.cash;
    done.action!(c2);
    expect(g2.cash).toBe(cash2);
  });
  it('every step has an instruction, and the optional ones can be skipped to a real step', () => {
    const { c } = course();
    for (const s of STEPS) {
      expect(s.short(c).length, s.id).toBeGreaterThan(5);
      if (s.skipTo) expect(STEPS.some((x) => x.id === s.skipTo), s.id).toBe(true);
    }
  });
});
