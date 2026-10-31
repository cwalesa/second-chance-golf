import { describe, it, expect, vi, afterEach } from 'vitest';
import { Game } from '../src/game';
import { careerLevel, awardExperience, commissionProject, projectOffers, constructionFactor, useOperatingReserve } from '../src/experience';
import { activeLocation } from '../src/campaign';
import { createCampaignWorld } from '../src/locations';
import { deserialize, serialize, saveGame, loadGame, clearSave, importSave } from '../src/save';
import { SwingMeter } from '../src/swing';
import { run } from './helpers';

describe('restoration projects and progression', () => {
  it('repairs the open damaged green, reopens it, and accounts for the exact quote', () => {
    const g = new Game(), offer = projectOffers(g).find(p => p.id === 'green')!;
    const before = g.cash;
    expect(offer.title).toContain('2');
    expect(commissionProject(g, 'green')).toBe(true);
    expect(g.hole(2).open).toBe(true);
    expect(g.today.construction).toBe(offer.cost);
    expect(g.cash).toBeCloseTo(before - offer.cost + g.today.bonus);
    expect(g.experience.xp).toBe(25);
  });
  it('uses an affordable map-specific plan to restore the closed hole at every location', () => {
    for (const region of ['parkland','coast','mountain','plains','desert'] as const) {
      const g = new Game(createCampaignWorld(region));
      const p = projectOffers(g).find(p => p.id === 'reopen')!;
      expect(p.cost).toBeLessThan(2400);
      expect(commissionProject(g, 'reopen')).toBe(true);
      expect(g.hole(3).open).toBe(true);
      expect(g.validate(3).ok).toBe(true);
      expect(g.today.construction).toBe(p.cost);
    }
  });
  it('enforces budget and career locks and prevents buying the same site improvement twice', () => {
    const g = new Game();
    expect(commissionProject(g, 'irrigation')).toBe(false);
    g.cash = 0; expect(commissionProject(g, 'garden')).toBe(false);
    g.cash = 1000; expect(commissionProject(g, 'garden')).toBe(true);
    expect(g.cash).toBe(720); expect(g.experience.site.garden).toBe(true);
    expect(commissionProject(g, 'garden')).toBe(false); expect(g.cash).toBe(720);
  });
  it('does not award restoration XP again after undoing a project', () => {
    const g = new Game(); commissionProject(g, 'green');
    const xp = g.experience.xp; g.undo();
    expect(commissionProject(g, 'green')).toBe(true);
    expect(g.experience.xp).toBe(xp);
  });
  it('unlocks later improvements and permanent terrain discounts through career XP', () => {
    const g = new Game(); awardExperience(g, 160, 'test'); awardExperience(g, 160, 'test');
    expect(g.experience.xp).toBe(160); expect(careerLevel(g)).toBe(1);
    expect(commissionProject(g, 'irrigation')).toBe(true);
    awardExperience(g, 4500);
    expect(careerLevel(g)).toBe(4); expect(constructionFactor(g)).toBe(.9);
    expect(projectOffers(g).find(p => p.id === 'terrace')?.locked).toBeNull();
  });
  it('charges irrigation upkeep and improves hourly turf care', () => {
    const g = new Game(); awardExperience(g, 160); commissionProject(g, 'irrigation');
    const i = g.world.terrain.findIndex(t => t === 1); g.world.cond[i] = 40;
    const rate = g.maintenanceRate;
    run(g, g.hourLen + .1);
    expect(g.world.cond[i]).toBeGreaterThan(40);
    expect(g.today.maintenance).toBe(rate);
    expect(g.sim.wearMult).toBeCloseTo(.8);
  });
  it('provides an operating reserve once per property when cash is low', () => {
    const g = new Game(); expect(useOperatingReserve(g)).toBe(false);
    g.cash = 100; expect(useOperatingReserve(g)).toBe(true);
    expect(g.cash).toBe(750); expect(g.today.bonus).toBe(650);
    g.cash = 0; expect(useOperatingReserve(g)).toBe(false);
  });
  it('preserves a completed course plan while resetting local improvements at travel', () => {
    const g = new Game(); g.name = 'My restored course'; commissionProject(g, 'garden');
    g.campaign.claimed = activeLocation(g).objectives.map(o => o.id);
    const terrain = Array.from(g.world.terrain).join('');
    const xp = g.experience.xp;
    expect(g.travel()).toBe(true);
    expect(g.experience.archives[0].name).toBe('My restored course');
    expect(g.experience.archives[0].terrain).toBe(terrain);
    expect(g.experience.site.garden).toBe(false); expect(g.experience.xp).toBe(xp);
    g.world.terrain.fill(0);
    expect(g.experience.archives[0].terrain).toBe(terrain);
    const loaded = deserialize(serialize(g))!.game;
    expect(loaded.experience.archives).toEqual(g.experience.archives);
  });
});

describe('swing timing and closing reports', () => {
  it('has a deterministic perfect window and stops when struck', () => {
    const m = new SwingMeter(); m.start();
    expect(m.offset).toBe(-1); expect(m.quality).toBe(0);
    m.update(.4); expect(m.quality).toBeCloseTo(1);
    expect(m.strike()).toBeCloseTo(0); expect(m.active).toBe(false);
    const offset = m.offset; m.update(5); expect(m.offset).toBe(offset);
  });
  it('timing changes the owner shot without consuming simulation randomness or money', () => {
    const clean = new Game(), poor = new Game();
    clean.owner.start(clean); poor.owner.start(poor);
    const rng = clean.rng.state, cash = clean.cash;
    clean.owner.hit(clean, 0); poor.owner.hit(poor, 1);
    expect(clean.owner.lastStrike).toBe('Pure strike'); expect(poor.owner.lastStrike).toContain('Late');
    expect(clean.owner.flight!.shot.air).not.toEqual(poor.owner.flight!.shot.air);
    expect(clean.rng.state).toBe(rng); expect(clean.cash).toBe(cash);
  });
  it('records a separate closing ledger and can disable reports', () => {
    const g = new Game(); run(g, 301);
    expect(g.pendingRecap?.day).toBe(1); expect(g.day).toBe(2);
    const revenue = g.pendingRecap!.fees;
    g.today.fees += 999; expect(g.pendingRecap!.fees).toBe(revenue);
    const other = new Game(); other.preferences.dailyReports = false; run(other, 301);
    expect(other.pendingRecap).toBeNull();
  });
});

describe('save compatibility and recovery', () => {
  afterEach(() => vi.unstubAllGlobals());
  const storage = () => {
    const values = new Map<string,string>();
    vi.stubGlobal('localStorage', { getItem: (k:string) => values.get(k) ?? null, setItem: (k:string,v:string) => values.set(k,v), removeItem: (k:string) => values.delete(k) });
    return values;
  };
  it('recovers a previous valid game after primary save corruption', () => {
    const values = storage(), g = new Game();
    g.name = 'Backup'; expect(saveGame(g)).toBe(true);
    g.name = 'Latest'; expect(saveGame(g)).toBe(true);
    values.set('second-chance-golf.save.v2', '{broken');
    const loaded = loadGame()!;
    expect(loaded.recovered).toBe(true); expect(loaded.game.name).toBe('Backup');
    clearSave(); expect(loadGame()).toBeNull();
  });
  it('does not overwrite a save with a malformed import', () => {
    const values = storage(), g = new Game(); saveGame(g);
    const before = values.get('second-chance-golf.save.v2');
    const invalid = JSON.parse(serialize(g)); invalid.cash = 'broken';
    expect(importSave(JSON.stringify(invalid))).toBe(false);
    expect(values.get('second-chance-golf.save.v2')).toBe(before);
  });
  it('rejects broken terrain, non-finite condition, and invalid campaign indexes', () => {
    for (const mutate of [(d:any)=>d.world.tree='0', (d:any)=>d.world.cond[0]=null, (d:any)=>d.campaign.stage=99]) {
      const d = JSON.parse(serialize(new Game())); mutate(d); expect(deserialize(JSON.stringify(d))).toBeNull();
    }
  });
  it('keeps an intentional pause but resumes after a transient practice mode', () => {
    const g = new Game(); g.setSpeed(0);
    expect(deserialize(serialize(g))!.game.settings.speed).toBe(0);
    g.owner.start(g);
    expect(deserialize(serialize(g))!.game.settings.speed).toBe(1);
  });
  it('preserves preferences, career progress, and the pending closing report', () => {
    const g = new Game(); g.preferences.sound = false; run(g, 301);
    const loaded = deserialize(serialize(g))!.game;
    expect(loaded.preferences.sound).toBe(false); expect(loaded.experience).toEqual(g.experience);
    expect(loaded.pendingRecap).toEqual(g.pendingRecap);
    const old = JSON.parse(serialize(g)); delete old.experience; delete old.preferences; delete old.pendingRecap;
    expect(deserialize(JSON.stringify(old))!.game.experience.xp).toBe(0);
  });
});
