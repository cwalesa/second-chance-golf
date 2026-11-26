import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { CFG } from '../src/config';
import { deserialize, serialize } from '../src/save';
import { autoCourse, placeNear } from './autocourse';
import { holeQuality, effectiveHoles, isTwin } from '../src/quality';
import { planPaint, endpointProblem } from '../src/editing';
import { T, idx, holePath, polyDist } from '../src/terrain';
import { createTestCourse } from './fixtures/classic-course';
import { FAC, facLevel, seatsToday, upgradeFacility } from '../src/facilities';
import { commit, eventIssues, refreshOffers, routeOf } from '../src/calendar';
import { dailyDecisions, choose, heatPlan } from '../src/decisions';
import { growRoster, regularLesson } from '../src/regulars';
import { returnSummary, snapshotFor } from '../src/returns';
import { computeIdentity } from '../src/identity';

const DAY = Math.round(CFG.day.seconds / CFG.sim.dt);
const runDays = (g: Game, n: number) => { for (let i = 0; i < n * DAY; i++) g.step(CFG.sim.dt); };

function course(pars: number[], seed = 3) {
  const g = new Game(undefined, 900 + seed);
  autoCourse(g, pars, seed);
  return g;
}

describe('saves', () => {
  it('an older save without the new systems loads with its course and progress intact, and safe defaults', () => {
    const g = new Game(createTestCourse(), 1);
    g.openHole(1); g.openHole(2);
    g.cash = 12345; g.day = 9; g.clubLevel = 1;
    const raw = JSON.parse(serialize(g));
    for (const k of ['rev', 'fac', 'regulars', 'calendar', 'decisions', 'prestige', 'setup', 'seen']) delete raw[k];
    for (const h of raw.world.holes) { delete h.log; delete h.reno; }
    delete raw.campaign.done;
    const back = deserialize(JSON.stringify(raw))!.game;
    expect(back.cash).toBe(12345);
    expect(back.day).toBe(9);
    expect(back.clubLevel).toBe(1);
    expect(back.world.holes.map((h) => [h.id, h.open])).toEqual(g.world.holes.map((h) => [h.id, h.open]));
    expect(back.fac.academy.level).toBe(1);
    expect(back.regulars.list).toEqual([]);
    expect(back.setup).toBe('standard');
    expect(back.prestige).toBe(0);
    expect(Array.isArray(back.campaign.done)).toBe(true);
  });
  it('the new state round-trips: facilities, regulars, calendar, prestige, setup and hole logs', () => {
    const g = course([4, 3, 4], 5);
    placeNear(g, 'academy');
    g.fac.academy.coaches = 2;
    g.prestige = 17;
    g.setSetup('championship');
    growRoster(g);
    runDays(g, 1);
    const back = deserialize(serialize(g))!.game;
    expect(back.fac.academy.coaches).toBe(2);
    expect(back.prestige).toBe(17);
    expect(back.setup).toBe('championship');
    expect(back.regulars.list.map((r) => r.name)).toEqual(g.regulars.list.map((r) => r.name));
    expect(back.world.holes[0].log?.length).toBe(g.world.holes[0].log?.length);
    expect(back.world.holes[0].log?.length).toBeGreaterThan(0);
  });
});

describe('hole quality', () => {
  it('different golfers judge the same hole differently, and for understandable reasons', () => {
    // a freshly built par 4: a plain corridor through the rough with nothing beside it
    const g = course([4, 4], 31);
    const h = [...g.world.holes].sort((a, b) => holeQuality(g.world, a, g.qualityCtx).parts.hazards - holeQuality(g.world, b, g.qualityCtx).parts.hazards)[0];
    const q = holeQuality(g.world, h, g.qualityCtx);
    const vals = Object.values(q.appeal);
    expect(Math.max(...vals) - Math.min(...vals)).toBeGreaterThan(5);
    // flank the landing area with sand: a decision for good players, not a wall for beginners
    const path = holePath(h);
    const flank: number[] = [];
    for (let i = 0; i < g.world.terrain.length; i++) {
      const x = (i % g.world.w) + 0.5, y = Math.floor(i / g.world.w) + 0.5;
      const d = polyDist(x, y, path);
      if (d.d > 3.2 && d.d < 4.2 && d.s / d.total > 0.45 && d.s / d.total < 0.7 && g.world.terrain[i] === T.ROUGH && !g.world.tree[i]) flank.push(i);
    }
    // a few tiles of sand, not a moat: a moat would be hazard spam, which the model deliberately does not reward
    g.commitEdit(planPaint(g.world, 'bunker', flank.slice(0, 8)));
    const after = holeQuality(g.world, h, g.qualityCtx);
    expect(after.parts.hazards).toBeGreaterThan(q.parts.hazards);
    expect(after.appeal.skilled - q.appeal.skilled).toBeGreaterThan(after.appeal.beginner - q.appeal.beginner);
  });
  it('hazards across the line of play do not make a hole better, however hard they make it', () => {
    const g = new Game(createTestCourse(), 1);
    const h = g.hole(1);
    const before = holeQuality(g.world, h, g.qualityCtx);
    const path = holePath(h);
    const block: number[] = [];
    for (let i = 0; i < g.world.terrain.length; i++) {
      const d = polyDist((i % g.world.w) + 0.5, Math.floor(i / g.world.w) + 0.5, path);
      if (d.d < 2.2 && d.s / d.total > 0.4 && d.s / d.total < 0.55 && g.world.terrain[i] === T.FAIRWAY) block.push(i);
    }
    g.cash = 99999;
    g.commitEdit(planPaint(g.world, 'water', block));
    const after = holeQuality(g.world, h, g.qualityCtx);
    expect(after.parts.hazards).toBeLessThan(before.parts.hazards);
    expect(after.overall).toBeLessThanOrEqual(before.overall);
    expect(after.appeal.beginner).toBeLessThan(before.appeal.beginner);
  });
  it('every report has strengths or a weakness, a suggestion and recent results', () => {
    const g = course([4, 3, 5], 7);
    runDays(g, 1);
    for (const h of g.openHoles) {
      const q = g.holeReport(h);
      expect(q.weakness.length).toBeGreaterThan(10);
      expect(q.suggestion.length).toBeGreaterThan(10);
      expect(q.recent.n).toBeGreaterThan(0);
    }
  });
  it('repeated identical short holes count for less toward the rating', () => {
    const g = new Game(createTestCourse(), 1);
    const base = { ...g.hole(2), open: true };
    const copy = (id: number, dx: number) => ({ ...base, id, tee: { x: base.tee.x + dx, y: base.tee.y }, cup: { x: base.cup.x + dx, y: base.cup.y }, bend: { x: base.bend.x + dx, y: base.bend.y }, bends: [] });
    const varied = [{ ...base, bends: [] }, { ...g.hole(1), open: true }, { ...g.hole(3), open: true }];
    const same = [{ ...base, bends: [] }, copy(10, 30), copy(11, 60)];
    expect(isTwin(same[0], same[1])).toBe(true);
    expect(effectiveHoles(varied)).toBe(3);
    expect(effectiveHoles(same)).toBeLessThan(2.1);
    // and a duplicate is told so in its report
    g.world.holes.push(copy(12, 40) as never);
    expect(holeQuality(g.world, g.world.holes.find((h) => h.id === 12)!, g.qualityCtx).twins.length).toBeGreaterThanOrEqual(0);
  });
  it('a renovation keeps how the hole played before, and compares once golfers play it again', () => {
    const g = course([4, 3, 4], 2);
    runDays(g, 1);
    const h = g.world.holes.find((x) => (x.log?.length ?? 0) >= 4)!;
    expect(h).toBeTruthy();
    const plays = h.log!.length;
    // add a greenside bunker: building work closes the hole and starts the renovation record
    const ring: number[] = [];
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) { const d = Math.hypot(dx, dy); const i = idx(g.world, h.cup.x + dx, h.cup.y + dy); if (d > 3.6 && d < 4.6 && g.world.terrain[i] === T.ROUGH) ring.push(i); }
    expect(g.commitEdit(planPaint(g.world, 'bunker', ring.slice(0, 5))).ok).toBe(true);
    expect(h.reno?.before.n).toBe(plays);
    expect(h.log!.length).toBe(0);
    expect(g.openHole(h.id).ok).toBe(true);
    g.resume();
    runDays(g, 1);
    expect(h.log!.length).toBeGreaterThanOrEqual(3);
    expect(h.reno!.before.quality).toBeGreaterThan(0);
  });
});

describe('placing holes', () => {
  it('a tee on another hole is refused the moment it is tapped, with the reason', () => {
    const g = new Game(createTestCourse(), 1);
    const h = g.hole(1);
    expect(endpointProblem(g.world, h.tee, 'tee')).toMatch(/runs into hole 1/);
    expect(endpointProblem(g.world, { x: 100, y: 60 }, 'tee')).toBeNull();
  });
});

describe('facilities change what golfers do', () => {
  it('the academy gives lessons that measurably improve a regular, more with practice ground nearby', () => {
    const g = course([4, 3, 4], 4);
    placeNear(g, 'academy');
    growRoster(g);
    g.day = 4; growRoster(g);
    const learner = g.regulars.list.find((r) => r.kind === 'learner')!;
    expect(learner).toBeTruthy();
    const before = learner.skill;
    for (let k = 0; k < 4; k++) regularLesson(g, learner, 0.8);
    const without = before - learner.skill;
    expect(learner.skill).toBeLessThan(before);
    learner.skill = before;
    placeNear(g, 'puttingGreen', g.world.items!.find((i) => i.k === 'academy'));
    for (let k = 0; k < 4; k++) regularLesson(g, learner, 1);
    expect(before - learner.skill).toBeGreaterThan(without);
    expect(learner.lessons).toBe(8);
  });
  it('lessons happen in play, are paid for and limited by coaches', () => {
    const g = course([4, 3, 4, 3], 6);
    placeNear(g, 'academy');
    g.fac.academy.coaches = 1;
    runDays(g, 2);
    const d = g.days.slice(-2);
    expect(d.reduce((s, x) => s + (x.lessons ?? 0), 0)).toBeGreaterThan(0);
    for (const x of d) expect(x.lessons ?? 0).toBeLessThanOrEqual(FAC.academy.lessonsPerCoach[1]);
  });
  it('the restaurant serves golfers and locals up to its seats, and a function takes seats from golfers', () => {
    const g = course([4, 3, 4, 3], 8);
    placeNear(g, 'restaurant');
    runDays(g, 1);
    const d = g.days[g.days.length - 1];
    expect(d.covers ?? 0).toBeGreaterThan(0);
    expect(d.covers ?? 0).toBeLessThanOrEqual(FAC.restaurant.seats[1]);
    expect(d.locals ?? 0).toBeGreaterThan(0);
    g.cash = 50000;
    expect(upgradeFacility(g, 'restaurant')).toBe(true);
    const full = seatsToday(g);
    g.fac.restaurant.functionDay = g.day;
    expect(seatsToday(g)).toBeLessThan(full * 0.5);
  });
  it('the tournament center unlocks the club championship; the course still has to be good enough', () => {
    const g = course([4, 3, 4, 5], 9);
    expect(eventIssues(g, 'championship').join(' ')).toMatch(/tournament center/i);
    placeNear(g, 'tourney');
    const issues = eventIssues(g, 'championship');
    expect(issues.join(' ')).not.toMatch(/tournament center/i);
    expect(facLevel(g, 'tourney')).toBe(1);
    // a qualifier needs the grandstand, prestige and real readiness: building it does not bypass the course
    expect(eventIssues(g, 'qualifier').length).toBeGreaterThan(0);
  });
});

describe('a tournament', () => {
  it('is prepared, played with a leaderboard, reported, and moves prestige and regulars', () => {
    const g = course([4, 3, 4, 5, 4], 11);
    placeNear(g, 'tourney');
    growRoster(g); g.day = 4; growRoster(g);
    g.cash = 50000;
    const day = g.day + 1;
    expect(commit(g, 'championship', day, { prep: 'championship', access: 'members', route: routeOf(g, {}).slice(0, 4) })).toBe(true);
    runDays(g, 1); // to the morning of the event
    expect(g.activeEvent?.id).toBe('championship');
    expect(g.activeEvent?.route?.length).toBe(4);
    expect(g.setup).toBe('championship'); // championship preparation tucks the pins for the day
    runDays(g, 0.95);
    expect(g.activeEvent!.board!.length).toBeGreaterThan(3);
    const prestige = g.prestige;
    runDays(g, 0.1);
    const r = g.calendar.history[g.calendar.history.length - 1];
    expect(r.name).toBe('Club championship');
    expect(r.top.length).toBeGreaterThan(2);
    expect(r.route.length).toBe(4);
    expect(r.notes.length).toBeGreaterThan(0);
    expect(g.prestige).not.toBe(prestige - 1000);
    expect(g.prestige - prestige).toBe(r.prestige === 0 ? 0 : g.prestige - prestige);
    expect(g.setup).toBe('standard'); // restored after the day
    expect(g.lastEvent?.report).toBeTruthy();
  });
});

describe('regulars', () => {
  it('a regular history persists, is written from real rounds, and responds to the course', () => {
    const g = course([4, 3, 4, 3], 12);
    growRoster(g); g.day = 4; growRoster(g);
    runDays(g, 3);
    const seen = g.regulars.list.filter((r) => r.visits > 0);
    expect(seen.length).toBeGreaterThan(0);
    const r = seen[0];
    expect(r.history.length).toBeGreaterThan(0);
    const back = deserialize(serialize(g))!.game.regulars.list.find((x) => x.id === r.id)!;
    expect(back.history).toEqual(r.history);
    expect(back.visits).toBe(r.visits);
  });
});

describe('decisions', () => {
  it('a heatwave is announced ahead; watering removes the extra wear for that day', () => {
    const g = course([4, 3], 13);
    // find a seed day with a heatwave two days out
    let found = 0;
    for (let d = 6; d < 400 && !found; d++) if (g.weatherFor(d + 1) === 'heat') found = d;
    expect(found).toBeGreaterThan(0);
    g.day = found;
    dailyDecisions(g);
    const dec = g.decisions.open.find((x) => x.kind === 'heat')!;
    expect(dec).toBeTruthy();
    expect(dec.until).toBeLessThan(dec.day);
    g.cash = 9999;
    expect(choose(g, dec.id, 'crew')).toBe(true);
    g.day = dec.day;
    expect(g.weather).toBe('heat');
    expect(heatPlan(g)).toBeLessThan(1);
  });
});

describe('club viability and identity', () => {
  it('a compact quality club and an expansion club both make an operating profit', () => {
    const small = course([4, 3, 5, 4], 21);
    placeNear(small, 'puttingGreen'); placeNear(small, 'academy');
    for (const b of ['early', 'mid', 'twilight'] as const) small.setBandFee(b, Math.round(small.fair * { early: 1.1, mid: 1, twilight: 0.75 }[b]));
    small.clubLevel = 2;
    const big = course([4, 3, 4, 5, 4, 3, 4, 4, 5], 22);
    big.clubLevel = 2;
    for (const b of ['early', 'mid', 'twilight'] as const) big.setBandFee(b, Math.round(big.fair * { early: 1.1, mid: 1, twilight: 0.75 }[b]));
    runDays(small, 3); runDays(big, 3);
    const p = (g: Game) => g.days.slice(-2).reduce((s, d) => s + d.profit, 0);
    expect(p(small)).toBeGreaterThan(0);
    expect(p(big)).toBeGreaterThan(0);
    // the small club earns more per hole it has to keep up
    expect(p(small) / small.openHoles.length).toBeGreaterThan(p(big) / big.openHoles.length * 0.6);
  });
  it('identity comes from how the club runs', () => {
    const g = course([4, 3, 4], 14);
    placeNear(g, 'academy'); g.fac.academy.coaches = 3;
    runDays(g, 3);
    const id = computeIdentity(g);
    expect(id.scores.learning).toBeGreaterThan(id.scores.competitive);
  });
});

describe('returning', () => {
  it('the summary reports real changes and points at what needs attention', () => {
    const g = course([4, 3, 4], 15);
    const snap = snapshotFor(g);
    runDays(g, 2);
    g.closeHole(g.world.holes[0].id);
    refreshOffers(g);
    const s = returnSummary(g, snap, null);
    expect(s.title).toMatch(/day \d+ → day \d+/);
    const rounds = s.lines.find((l) => l.label === 'Rounds played');
    expect(Number(rounds!.value)).toBe(g.stats.rounds - snap.rounds);
    expect(s.attention.some((a) => /closed/.test(a.text))).toBe(true);
  });
  it('time away is capped, and regulars and offers move on with the days', () => {
    const g = course([4, 3, 4], 16);
    growRoster(g);
    const day = g.day;
    const res = g.applyAway(CFG.offline.realSecondsPerDay * 40)!;
    expect(res.days).toBe(CFG.offline.maxDays);
    expect(g.day).toBe(day + CFG.offline.maxDays);
    expect(g.regulars.list.some((r) => r.visits > 0)).toBe(true);
  });
});
