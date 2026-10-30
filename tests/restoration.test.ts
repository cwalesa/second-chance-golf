import { createCampaignWorld } from '../src/locations';
import { describe, it, expect } from 'vitest';
import { Game, STAFF } from '../src/game';
import { assessDesign, designEnjoyment } from '../src/design';
import { LOCATIONS, activeLocation, stageComplete } from '../src/campaign';
import { T, createStartingWorld, holeCondition, idx } from '../src/terrain';
import { planMoveBend, planPaint } from '../src/editing';
import { deserialize, serialize } from '../src/save';
import { run } from './helpers';

describe('restoration campaign', () => {
  it('each new location has its own valid routing and playable opening holes', () => {
    const routes = new Set<string>();
    for (const region of ['coast', 'mountain', 'plains', 'desert'] as const) {
      const g = new Game(createCampaignWorld(region));
      routes.add(JSON.stringify(g.world.holes.map(h => [h.tee, h.bend, h.cup])));
      expect(g.validate(1).problems).toEqual([]);
      expect(g.validate(2).problems).toEqual([]);
      expect(g.validate(3).ok).toBe(false);
      expect(g.designRating).toBeGreaterThan(30);
    }
    expect(routes.size).toBe(4);
  });
  it('only pays a completed objective once, and books the grant in the ledger', () => {
    const g = new Game();
    expect(g.claimObjective('rounds')).toBe(false);
    g.campaign.rounds = 12;
    const cash = g.cash, bonus = g.today.bonus;
    expect(g.claimObjective('rounds')).toBe(true);
    expect(g.cash).toBe(cash + 400);
    expect(g.today.bonus).toBe(bonus + 400);
    expect(g.claimObjective('rounds')).toBe(false);
    expect(g.campaign.medals).toBe(1);
  });
  it('gates travel and gives the next property a fresh budget without losing medals', () => {
    const g = new Game();
    expect(g.travel()).toBe(false);
    g.campaign.claimed = activeLocation(g).objectives.map(o => o.id);
    g.campaign.medals = 4;
    g.staff.ranger = true; g.members.push({ name: 'Avery', type: 'regular', visits: 2, happiness: 90, joined: 1 });
    g.owner.start(g); g.bookEvent('scramble');
    expect(stageComplete(g)).toBe(true);
    const before = g.world;
    expect(g.travel()).toBe(true);
    expect(g.world).not.toBe(before);
    expect(g.sim.world).toBe(g.world);
    expect(g.region).toBe('coast');
    expect(g.cash).toBe(LOCATIONS[1].budget);
    expect(g.campaign.medals).toBe(4);
    expect(g.campaign.completed).toContain('willow');
    expect(g.campaign.claimed).toEqual([]);
    expect(g.members).toEqual([]);
    expect(g.staff.ranger).toBe(false);
    expect(g.owner.active).toBe(false);
    expect(g.bookings).toEqual([]);
    run(g, 30);
    expect(g.today.arrivals).toBeGreaterThan(0);
    expect(g.sim.golfers.length).toBeGreaterThan(0);
  });
  it('allows all five locations and retains the final property', () => {
    const g = new Game();
    for (let i = 0; i < 4; i++) { g.campaign.claimed = activeLocation(g).objectives.map(o => o.id); expect(g.travel()).toBe(true); }
    g.campaign.claimed = activeLocation(g).objectives.map(o => o.id);
    const w = g.world;
    expect(g.travel()).toBe(false);
    expect(g.campaign.completed.length).toBe(5);
    expect(g.world).toBe(w);
  });
  it('rounds and daily operating profit advance location objectives', () => {
    const g = new Game(); run(g, 305);
    expect(g.campaign.rounds).toBeGreaterThan(0);
    expect(g.campaign.profit).toBe(g.days[0].profit);
  });
});

describe('design with consequences', () => {
  it('blocking a fairway with water lowers forgiveness and beginner enjoyment', () => {
    const g = new Game(); const h = g.hole(1), before = assessDesign(g.world, h);
    for (let i = 0; i < g.world.terrain.length; i++) if (g.world.zone[i] === h.id && g.world.terrain[i] === T.FAIRWAY) g.world.terrain[i] = T.WATER;
    g.world.version++;
    const after = assessDesign(g.world, h);
    expect(after.forgiveness).toBeLessThan(before.forgiveness);
    expect(designEnjoyment(after, 'beginner')).toBeLessThan(designEnjoyment(before, 'beginner'));
    expect(after.advice.join(' ')).toContain('Widen');
  });
  it('does not leak condition ratings between different courses with the same hole IDs', () => {
    const a = createStartingWorld(), b = createStartingWorld();
    b.cond.fill(12);
    expect(holeCondition(a, a.holes[0]).overall).toBeGreaterThan(holeCondition(b, b.holes[0]).overall);
  });
  it('routes a dogleg with a reversible, properly charged plan', () => {
    const g = new Game(), h = g.hole(1), before = { ...h.bend }, cash = g.cash;
    const plan = planMoveBend(g.world, h, h.bend.x + 2, h.bend.y + 2);
    expect(typeof plan).not.toBe('string');
    if (typeof plan === 'string') return;
    expect(g.commitEdit(plan).ok).toBe(true);
    expect(g.hole(1).open).toBe(false);
    expect(g.cash).toBe(cash - plan.cost);
    expect(g.undo()).toBe(true);
    expect(g.hole(1).bend).toEqual(before);
    expect(g.cash).toBe(cash);
  });
  it('paints greens and paths while protecting tees and buildings', () => {
    const g = new Game(), w = g.world;
    const i = w.terrain.findIndex((t, i) => t === T.ROUGH && !w.tree[i] && w.zone[i] === 1);
    const green = planPaint(w, 'green', [i]);
    expect(green.tiles.length).toBe(1);
    g.commitEdit(green); expect(w.terrain[i]).toBe(T.GREEN);
    expect(planPaint(w, 'path', [idx(w, g.hole(1).tee.x, g.hole(1).tee.y)]).tiles.length).toBe(0);
  });
});

describe('staff, practice, and persistent progress', () => {
  it('resumes live golfers, tee queues, and an active event on a short reload', () => {
    const g = new Game(); g.bookEvent('scramble'); run(g, 315);
    const loaded = deserialize(serialize(g))!.game;
    expect(loaded.activeEvent).toEqual(g.activeEvent);
    expect(loaded.sim.golfers.length).toBe(g.sim.golfers.length);
    expect(loaded.sim.queues).toEqual(g.sim.queues);
    expect(loaded.sim.nextId).toBe(g.sim.nextId);
    expect(loaded.sim.golfers[0].said).toBeInstanceOf(Set);
    run(loaded, 10);
    expect(loaded.cash).not.toBeNaN();
  });
  it('charges hiring fees once and wages hourly, and allows dismissal', () => {
    const g = new Game(); const cash = g.cash;
    g.hire('ranger'); g.hire('ranger');
    expect(g.cash).toBe(cash - STAFF.ranger.hire);
    expect(g.dailyWages).toBe(48);
    run(g, g.hourLen + .1);
    expect(g.sim.teeIntervalMult).toBe(.75);
    expect(g.today.maintenance).toBe(g.maintenanceRate + 4);
    g.dismiss('ranger'); expect(g.dailyWages).toBe(0);
  });
  it('cannot hire staff with insufficient cash', () => {
    const g = new Game(); g.cash = 0; g.hire('gardener'); expect(g.staff.gardener).toBe(false);
  });
  it('a practice shot animates, increments strokes, and never earns guest money', () => {
    const g = new Game(); const cash = g.cash, rng = g.rng.state;
    g.owner.start(g); g.owner.hit(g); g.owner.hit(g);
    expect(g.owner.strokes).toBeGreaterThanOrEqual(1);
    expect(g.owner.strokes).toBeLessThanOrEqual(2); // includes any penalty; second click cannot hit mid-flight
    expect(g.owner.flight).not.toBeNull();
    g.owner.update(g, 2);
    expect(g.owner.flight).toBeNull();
    expect(g.cash).toBe(cash); expect(g.stats.rounds).toBe(0); expect(g.rng.state).toBe(rng);
  });
  it('finishes a practice hole at the stroke cap and retains the scorecard', () => {
    const g = new Game(); g.owner.start(g); g.owner.strokes = g.hole(1).par + 4;
    g.owner.hit(g); g.owner.update(g, 2);
    expect(g.owner.completed).toBe(true);
    g.owner.next(g);
    expect(g.owner.active).toBe(false);
    expect(g.ownerRecords.length).toBe(1);
  });
  it('preserves campaign, staff, members and scorecards on save, and migrates old saves', () => {
    const g = new Game(); g.campaign.stage = 2; g.campaign.medals = 8; g.hire('host');
    g.members.push({ name: 'Dana W.', type: 'regular', visits: 3, happiness: 88, joined: 1 });
    const saved = serialize(g), loaded = deserialize(saved)!.game;
    expect(loaded.campaign).toEqual(g.campaign); expect(loaded.staff).toEqual(g.staff); expect(loaded.members).toEqual(g.members);
    const old = JSON.parse(saved); delete old.campaign; delete old.staff; delete old.members; delete old.ownerRecords;
    const legacy = deserialize(JSON.stringify(old))!.game;
    expect(legacy.campaign.stage).toBe(0); expect(legacy.members).toEqual([]); expect(legacy.staff.host).toBe(false);
  });
  it('dues are credited to the ledger and unhappy members leave', () => {
    const g = new Game();
    g.members.push({ name: 'Happy', type: 'skilled', visits: 1, happiness: 95, joined: 1 }, { name: 'Unhappy', type: 'regular', visits: 1, happiness: 10, joined: 1 });
    g.closeHole(1); g.closeHole(2);
    run(g, 301);
    expect(g.members.some(m => m.name === 'Unhappy')).toBe(false);
    expect(g.log.some(l => l.label === 'Daily dues: Happy')).toBe(true);
    expect(g.cash).toBeCloseTo(2400 + g.today.fees + g.today.shop + g.today.bonus - g.today.maintenance - g.today.construction + g.days.reduce((sum, d) => sum + d.net, 0), 6);
  });
});
