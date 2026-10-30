import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { CFG } from '../src/config';
import { Rng } from '../src/rng';
import { PAINT_TOOLS, brushTiles, planMoveCup, planMoveTee, planPaint } from '../src/editing';
import { run } from './helpers';

describe('random play never strands golfers or loses money', () => {
  it('survives 12 days of random edits, fee changes and open/close toggles', () => {
    const g = new Game(undefined, 4242);
    const r = new Rng(77);
    let maxAge = 0;
    let maxPhase = 0;
    for (let k = 0; k < 12 * 15; k++) {
      const a = r.next();
      if (a < 0.45) {
        const tool = r.pick(PAINT_TOOLS);
        const tiles = brushTiles(g.world, Math.floor(r.range(4, 76)), Math.floor(r.range(4, 46)), Math.floor(r.range(0, 3)));
        g.commitEdit(planPaint(g.world, tool, tiles));
      } else if (a < 0.55) {
        const h = g.world.holes[Math.floor(r.range(0, 3))];
        const p = r.next() < 0.5 ? planMoveTee(g.world, h, Math.floor(r.range(4, 76)), Math.floor(r.range(4, 46))) : planMoveCup(g.world, h, Math.floor(r.range(4, 76)), Math.floor(r.range(4, 46)));
        if (typeof p !== 'string') g.commitEdit(p);
      } else if (a < 0.7) g.openHole(1 + Math.floor(r.range(0, 3)));
      else if (a < 0.78) g.closeHole(1 + Math.floor(r.range(0, 3)));
      else if (a < 0.85) g.undo();
      else if (a < 0.92) g.setFee(r.range(8, 70));
      else if (a < 0.95) g.buyUpgrade(r.next() < 0.5 ? 'crew' : 'proShop');
      if (g.cash < 200) g.cash += 400; // keep the fuzz moving
      run(g, 20);
      for (const gg of g.sim.golfers) {
        maxAge = Math.max(maxAge, gg.age);
        maxPhase = Math.max(maxPhase, gg.phase === 'queue' ? 0 : gg.phaseTime);
        expect(Number.isFinite(gg.x) && Number.isFinite(gg.y)).toBe(true);
        expect(Number.isFinite(gg.ball.x) && Number.isFinite(gg.ball.y)).toBe(true);
      }
    }
    // let everyone finish
    for (const h of g.world.holes) g.closeHole(h.id, true);
    run(g, 150);
    expect(g.sim.golfers.length).toBe(0);
    expect(maxAge).toBeLessThan(1500);
    expect(maxPhase).toBeLessThan(150);
    expect(Number.isFinite(g.cash)).toBe(true);
    for (const t of g.world.terrain) expect(t).toBeLessThan(8);
    for (const h of g.world.holes) {
      expect(h.tee.x).toBeGreaterThanOrEqual(0);
      expect(h.par).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps an exact ledger: cash equals start plus every recorded flow', () => {
    const g = new Game(undefined, 11);
    const r = new Rng(5);
    for (let k = 0; k < 40; k++) {
      if (r.next() < 0.5) g.commitEdit(planPaint(g.world, r.pick(PAINT_TOOLS), brushTiles(g.world, Math.floor(r.range(4, 76)), Math.floor(r.range(4, 46)), 2)));
      if (r.next() < 0.2) g.undo();
      run(g, 30);
    }
    const all = [...g.days, g.today];
    const sum = (k: 'fees' | 'shop' | 'maintenance' | 'construction' | 'bonus') => all.reduce((s, d) => s + d[k], 0);
    expect(g.cash).toBe(CFG.economy.startCash + sum('fees') + sum('shop') + sum('bonus') - sum('maintenance') - sum('construction'));
  });
});
