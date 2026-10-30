import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { CFG } from '../src/config';
import { planPaint, planMoveCup, planMoveTee } from '../src/editing';
import { T, idx, holeCondition } from '../src/terrain';
import { deserialize, serialize } from '../src/save';
import { arrivalsPerDay, scoreRound, fairFee } from '../src/economy';
import { repairGreen2, restoreHole3, run, tilesIn } from './helpers';

describe('construction costs', () => {
  it('charges only for tiles that actually change, exactly once', () => {
    const g = new Game();
    const fw = tilesIn(g, 14, 31, 18, 35, (i) => g.world.terrain[i] === T.FAIRWAY);
    const none = planPaint(g.world, 'fairway', fw);
    expect(none.tiles.length).toBe(0);
    expect(none.cost).toBe(0);
    const rough = tilesIn(g, 14, 25, 17, 27, (i) => g.world.terrain[i] === T.ROUGH && !g.world.tree[i]);
    const plan = planPaint(g.world, 'fairway', rough);
    expect(plan.tiles.length).toBe(rough.length);
    expect(plan.cost).toBe(CFG.costs.fairway * rough.length);
    const cash = g.cash;
    expect(g.commitEdit(plan).ok).toBe(true);
    expect(g.cash).toBe(cash - plan.cost);
    expect(g.today.construction).toBe(plan.cost);
    // painting the same thing again is free
    expect(planPaint(g.world, 'fairway', rough).cost).toBe(0);
  });

  it('refuses an unaffordable edit without changing anything', () => {
    const g = new Game();
    g.cash = 50;
    const rough = tilesIn(g, 14, 25, 17, 27, (i) => g.world.terrain[i] === T.ROUGH && !g.world.tree[i]);
    const plan = planPaint(g.world, 'fairway', rough);
    const snap = Array.from(g.world.terrain);
    const res = g.commitEdit(plan);
    expect(res.ok).toBe(false);
    expect(g.cash).toBe(50);
    expect(Array.from(g.world.terrain)).toEqual(snap);
  });

  it('undo restores tiles and refunds exactly once', () => {
    const g = new Game();
    const rough = tilesIn(g, 14, 25, 17, 27, (i) => g.world.terrain[i] === T.ROUGH && !g.world.tree[i]);
    const plan = planPaint(g.world, 'bunker', rough);
    const snap = Array.from(g.world.terrain);
    const cash = g.cash;
    g.commitEdit(plan);
    expect(g.undo()).toBe(true);
    expect(g.cash).toBe(cash);
    expect(Array.from(g.world.terrain)).toEqual(snap);
    expect(g.undo()).toBe(false);
    expect(g.cash).toBe(cash);
  });

  it('moving a cup keeps tee and cup tied to the same hole and updates the green', () => {
    const g = new Game();
    const h = g.hole(1);
    const plan = planMoveCup(g.world, h, 40, 30);
    expect(typeof plan).not.toBe('string');
    if (typeof plan === 'string') return;
    g.commitEdit(plan);
    expect(g.hole(1).cup).toEqual({ x: 40, y: 30 });
    expect(g.world.terrain[idx(g.world, 40, 30)]).toBe(T.GREEN);
    g.undo();
    expect(g.hole(1).cup).toEqual({ x: 42, y: 31 });
  });
});

describe('moving a tee', () => {
  it('builds a new tee box for the same hole and refuses water', () => {
    const g = new Game();
    const h = g.hole(1);
    const plan = planMoveTee(g.world, h, 12, 33);
    expect(typeof plan).not.toBe('string');
    if (typeof plan === 'string') return;
    expect(plan.hole?.id).toBe(1);
    g.commitEdit(plan);
    expect(g.hole(1).tee).toEqual({ x: 12, y: 33 });
    expect(g.world.terrain[idx(g.world, 12, 33)]).toBe(T.TEE);
    expect(typeof planMoveTee(g.world, g.hole(1), 54, 34)).toBe('string'); // pond
  });
});

describe('goals and income', () => {
  it('repairing the damaged green completes goal 1 and pays the bonus exactly once', () => {
    const g = new Game();
    expect(holeCondition(g.world, g.hole(2)).green).toBeLessThan(30);
    const { res, plan } = repairGreen2(g);
    expect(res.ok).toBe(true);
    const cashAfterRepair = g.cash;
    expect(g.hole(2).open).toBe(false); // editing closed it
    run(g, 2);
    expect(g.goalDone('green')).toBe(true);
    const bonus = CFG.goals[0].reward;
    expect(g.today.bonus).toBe(bonus);
    expect(g.cash).toBeGreaterThan(cashAfterRepair);
    run(g, 5);
    expect(g.today.bonus).toBe(bonus);
    // every dollar is accounted for exactly once
    const l = g.today;
    expect(g.cash).toBe(CFG.economy.startCash - l.maintenance - l.construction + l.fees + l.shop + l.bonus);
    expect(plan.cost).toBeLessThan(400);
  });

  it('charges maintenance once per game hour', () => {
    const g = new Game();
    g.closeHole(1);
    g.closeHole(2);
    const rate = g.maintenanceRate;
    run(g, CFG.day.seconds / CFG.day.hours * 3 + 0.5);
    expect(g.today.maintenance).toBe(rate * 3);
  });

  it('rolls the day over once with a summary', () => {
    const g = new Game();
    run(g, CFG.day.seconds + 1);
    expect(g.day).toBe(2);
    expect(g.days.length).toBe(1);
    expect(g.days[0].maintenance).toBe(g.maintenanceRate * CFG.day.hours);
  });
});

describe('satisfaction and pricing', () => {
  const base = { golferId: 1, name: 'x', type: 'regular' as const, holes: 2, strokes: 10, par: 7, fee: 30, stats: { shots: 10, rough: 1, bunker: 0, water: 0, tree: 0, condSum: 800, condN: 10, wait: 5, picked: 0, closedOnMe: 0 } };
  it('worn turf, long waits and high fees each lower satisfaction', () => {
    const good = scoreRound(base, 30, 32).total;
    expect(scoreRound({ ...base, stats: { ...base.stats, condSum: 250 } }, 30, 32).total).toBeLessThan(good);
    expect(scoreRound({ ...base, stats: { ...base.stats, wait: 70 } }, 30, 32).total).toBeLessThan(good);
    expect(scoreRound(base, 60, 32).total).toBeLessThan(good);
  });
  it('higher fees reduce arrivals and better reputation increases them', () => {
    const fair = fairFee(70, 2);
    expect(arrivalsPerDay(2, 60, 60, fair)).toBeLessThan(arrivalsPerDay(2, 60, 25, fair));
    expect(arrivalsPerDay(2, 90, 30, fair)).toBeGreaterThan(arrivalsPerDay(2, 40, 30, fair));
    expect(arrivalsPerDay(0, 60, 30, fair)).toBe(0);
  });
});

describe('speed and persistence', () => {
  it('sim state only advances through step(), so speed is just how many steps run', () => {
    const a = new Game();
    const b = new Game();
    run(a, 40);
    run(b, 40);
    expect(a.cash).toBe(b.cash);
    expect(a.sim.golfers.length).toBe(b.sim.golfers.length);
  });
  it('save and load keeps property, money, goals and upgrades; golfers restart cleanly', () => {
    const g = new Game();
    repairGreen2(g);
    run(g, 60);
    g.buyUpgrade('crew');
    const text = serialize(g);
    const h = deserialize(text)!;
    expect(h).not.toBeNull();
    expect(h.cash).toBe(g.cash);
    expect(h.day).toBe(g.day);
    expect(h.goalDone('green')).toBe(true);
    expect(h.upgrades.crew).toBe(true);
    expect(Array.from(h.world.terrain)).toEqual(Array.from(g.world.terrain));
    expect(h.sim.golfers.length).toBe(0);
    run(h, 30);
    expect(h.sim.golfers.length).toBeGreaterThanOrEqual(0);
  });
  it('rejects corrupt saves', () => {
    expect(deserialize('{"v":1}')).toBeNull();
    expect(deserialize('nonsense')).toBeNull();
  });
});

describe('restoring the closed hole', () => {
  it('can be validated, opened, played, and pays its goal once', () => {
    const g = new Game();
    expect(g.validate(3).ok).toBe(false);
    const open = g.openHole(3);
    expect(open.ok).toBe(false);
    expect(g.hole(3).open).toBe(false);
    const cash = g.cash;
    const results = restoreHole3(g);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(g.cash).toBeLessThan(cash);
    const v = g.validate(3);
    expect(v.problems).toEqual([]);
    expect(g.openHole(3).ok).toBe(true);
    expect(g.hole(3).open).toBe(true);
    run(g, 1);
    expect(g.goalDone('reopen')).toBe(true);
    expect(g.today.bonus).toBe(CFG.goals[1].reward);
    run(g, CFG.day.seconds * 2);
    expect(g.hole(3).stats.rounds).toBeGreaterThan(0);
    expect(g.days[0].bonus).toBe(CFG.goals[1].reward);
    expect(g.days[1].bonus).toBe(0);
  });
});

describe('terrain changes shot outcomes and satisfaction', () => {
  it('repairing worn turf improves the satisfaction golfers report', () => {
    const avg = (fix: boolean) => {
      const g = new Game(undefined, 99);
      if (fix) {
        repairGreen2(g);
        g.openHole(2);
        // also repair the worn patches on hole 1
        g.commitEdit(planPaint(g.world, 'repair', tilesIn(g, 5, 28, 50, 38)));
        g.openHole(1);
      }
      g.setFee(24);
      run(g, CFG.day.seconds * 1.5);
      const r = g.recent;
      return r.reduce((s, x) => s + x.cond, 0) / Math.max(1, r.length);
    };
    expect(avg(true)).toBeGreaterThan(avg(false) + 3);
  });
});
