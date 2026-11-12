import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { COOLDOWN, FIRST_WAIT, INTROS, TIP_COOLDOWN, markIntro, pickIntro, tipAllowed } from '../src/intros';
import { deserialize, serialize } from '../src/save';
import { createTestCourse } from './fixtures/classic-course';

const fresh = () => {
  const g = new Game(createTestCourse());
  g.world.holes.splice(1); // one hole: nothing about a bigger course is relevant yet
  g.tutorial = { step: 11, done: true, v: 2 };
  g.preferences.introAt = 0;
  return g;
};
const env = (playSec: number, tool = 'inspect') => ({ playSec, tool });

describe('introductions', () => {
  it('have unique ids, short text, and no stray words', () => {
    expect(new Set(INTROS.map((i) => i.id)).size).toBe(INTROS.length);
    for (const i of INTROS) {
      expect(i.text.length).toBeLessThan(150);
      expect(`${i.text} ${i.more ?? ''}`).not.toMatch(/click|!/i);
    }
  });

  it('never appear during the tutorial, while the player is busy, or when switched off', () => {
    const g = fresh();
    g.tutorial.done = false;
    expect(pickIntro(g, env(1000), false)).toBeNull();
    g.tutorial.done = true;
    expect(pickIntro(g, env(1000), true)).toBeNull();
    g.preferences.introsOff = true;
    expect(pickIntro(g, env(1000), false)).toBeNull();
  });

  it('the Goals line comes first, just after the tutorial, and then the quiet period starts', () => {
    const g = fresh();
    expect(pickIntro(g, env(2), false)).toBeNull(); // not straight away
    const a = pickIntro(g, env(10), false)!;
    expect(a.id).toBe('goals');
    markIntro(g, a.id, 10);
    // something else is relevant now, but it waits out the cooldown
    g.days.push({ day: 1, profit: -10, rounds: 0 } as never);
    expect(pickIntro(g, env(10 + COOLDOWN - 1), false)).toBeNull();
    expect(pickIntro(g, env(10 + COOLDOWN + 1), false)?.id).toBe('bands');
  });

  it('only one at a time, once each, in order', () => {
    const g = fresh();
    markIntro(g, 'goals', 0);
    g.days.push({ day: 1, profit: -10, rounds: 3, avgSat: 70 } as never);
    let t = COOLDOWN + 1;
    const order: string[] = [];
    for (let k = 0; k < 2; k++) {
      const i = pickIntro(g, env(t), false);
      if (!i) break;
      order.push(i.id);
      markIntro(g, i.id, t);
      expect(pickIntro(g, env(t + 5), false)).toBeNull(); // nothing on top of it
      t += COOLDOWN + 1;
    }
    expect(order).toEqual(['bands', 'upkeep']);
    expect(new Set(order).size).toBe(order.length);
  });

  it('triggers come from what the course is doing', () => {
    const at = (mut: (g: Game) => void, tool = 'inspect') => { const g = fresh(); markIntro(g, 'goals', 0); mut(g); return pickIntro(g, env(5000, tool), false)?.id ?? null; };
    // bends: starting a second hole (one hole exists, the New hole tool is picked)
    const one = (g: Game) => { g.world.holes.splice(1); };
    expect(at(one, 'build')).toBe('bends');
    expect(at(one, 'inspect')).not.toBe('bends');
    expect(at((g) => { g.world.holes.splice(1); g.world.holes.push({ ...g.world.holes[0], id: 9 }); g.world.holes.forEach((h) => (h.open = false)); })).toBe('shaping');
    expect(at((g) => g.days.push({ day: 1, profit: 50, rounds: 2, avgSat: 70 } as never))).toBe('bands');
    expect(at((g) => { g.stats.rounds = 6; })).toBe('golfers');
    expect(at((g) => g.members.push({ name: 'A', type: 'regular', visits: 1, happiness: 80, joined: 1 }))).toBe('members');
    expect(at((g) => { g.day = 6; })).toBe('seasons');
    expect(at((g) => { g.daily.challenges = [{ kind: 'rounds', target: 5, base: 0, reward: 100, xp: 10, claimed: false }]; })).toBe('daily');
  });

  it('first-use tips share the gate and never land right after an introduction', () => {
    const g = fresh();
    expect(tipAllowed(g, TIP_COOLDOWN + 1)).toBe(true);
    markIntro(g, 'goals', 100);
    expect(tipAllowed(g, 110)).toBe(false);
    expect(tipAllowed(g, 100 + TIP_COOLDOWN + 1)).toBe(true);
    g.preferences.tipAt = 200;
    expect(pickIntro(g, env(210), false)).toBeNull();
    g.preferences.introsOff = true;
    expect(tipAllowed(g, 9999)).toBe(false);
    expect(FIRST_WAIT).toBeGreaterThan(60);
  });

  it('what has been seen survives a save, and old saves without the field load', () => {
    const g = fresh();
    markIntro(g, 'goals', 12);
    g.preferences.introsOff = true;
    const back = deserialize(serialize(g))!.game;
    expect(back.preferences.introsSeen).toEqual(['goals']);
    expect(back.preferences.introsOff).toBe(true);
    const d = JSON.parse(serialize(fresh()));
    delete d.preferences.introsSeen; delete d.preferences.playSec;
    const old = deserialize(JSON.stringify(d))!.game;
    expect(old.preferences.introsSeen ?? []).toEqual([]);
  });
});
