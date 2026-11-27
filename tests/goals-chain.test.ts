import { regionComplete } from '../src/campaign';
import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { CHAIN, chainStep, currentGoal, goalDone } from '../src/campaign';
import { planNewHole } from '../src/editing';
import { suggestClubhouse, suggestFirstHole } from '../src/wilderness';
import { deserialize, serialize } from '../src/save';
import { createTestCourse } from './fixtures/classic-course';

describe('goal chain', () => {
  it('runs from the first hole to eighteen holes, then on to the resort goals', () => {
    expect(CHAIN[0].id).toBe('c-hole1');
    const eighteen = CHAIN.findIndex((c) => c.id === 'c-hole18');
    expect(CHAIN[eighteen].target).toBe(18);
    expect(CHAIN.slice(eighteen + 1).map((c) => c.id)).toEqual(['c-members20', 'c-star45', 'c-club4', 'c-wedding']);
    // hole targets only ever rise
    const holes = CHAIN.filter((c) => c.id.startsWith('c-hole')).map((c) => c.target);
    expect(holes).toEqual([...holes].sort((a, b) => a - b));
  });

  it('gives one goal at a time and pays its reward exactly once', () => {
    const g = new Game(undefined, 4242);
    expect(currentGoal(g)!.id).toBe('c-hole1');
    g.buildClubhouse(suggestClubhouse(g.world)!);
    const s = suggestFirstHole(g.world)!;
    g.commitEdit(planNewHole(g.world, 1, s.tee, s.cup) as never);
    g.checkGoals();
    expect(chainStep(g)).toBe(0); // built, not open yet
    const cash = g.cash;
    g.openHole(1); // opening checks the goals straight away
    expect(chainStep(g)).toBe(1);
    expect(g.cash).toBe(cash + CHAIN[0].reward);
    expect(g.goalJustDone?.next).toBe(CHAIN[1].title);
    g.checkGoals();
    expect(g.cash).toBe(cash + CHAIN[0].reward);
    // the next goal (25 rounds) is not met yet
    g.stats.rounds = 24;
    g.checkGoals();
    expect(chainStep(g)).toBe(1);
    g.stats.rounds = 25;
    g.checkGoals();
    g.checkGoals();
    expect(chainStep(g)).toBe(2); // 25 rounds reached; the bunker goal is the earliest still open
  });

  it('recognises goals reached out of order, each paid once, and keeps the earlier ones open', () => {
    const g = new Game(undefined, 4242);
    g.buildClubhouse(suggestClubhouse(g.world)!);
    const s = suggestFirstHole(g.world)!;
    g.commitEdit(planNewHole(g.world, 1, s.tee, s.cup) as never);
    g.openHole(1);
    const cash = g.cash;
    g.clubLevel = 1; // the clubhouse upgrade goal is seventh in the list
    g.checkGoals();
    const club = CHAIN.find((c) => c.id === 'c-club1')!;
    expect(goalDone(g, 'c-club1')).toBe(true);
    expect(g.cash).toBeGreaterThanOrEqual(cash + club.reward); // plus any level grant from the experience it earns
    expect(currentGoal(g)!.id).toBe('c-rounds10'); // earlier goals are still there to do
    const after = g.cash;
    g.checkGoals();
    expect(g.cash).toBe(after);
  });

  it('keeps bunker progress while the edited hole is closed, and says to reopen it', () => {
    const g = new Game(createTestCourse(), 1);
    const goal = CHAIN.find((c) => c.id === 'c-bunker')!;
    const before = goal.value(g);
    expect(before).toBeGreaterThanOrEqual(4); // the classic course has sand by its open greens
    for (const h of g.world.holes) g.closeHole(h.id, true);
    expect(goal.value(g)).toBe(before); // closing a hole for work does not wipe the progress
    expect(goal.blocked!(g)).toMatch(/Reopen hole/);
  });

  it('shows profit progress live, before the day closes', () => {
    const g = new Game(createTestCourse(), 1);
    const goal = CHAIN.find((c) => c.id === 'c-profit1500')!;
    expect(goal.value(g)).toBe(0);
    g.earn('fees', 120, 'test');
    expect(goal.value(g)).toBe(120);
  });

  it('keeps the step in saves, and old saves catch up without being paid', () => {
    const g = new Game(createTestCourse(), 1);
    g.openHole(1); g.openHole(2);
    const raw = JSON.parse(serialize(g));
    delete raw.campaign.step;
    delete raw.campaign.done; // as saved before goals were tracked one by one
    const back = deserialize(JSON.stringify(raw))!.game;
    expect(chainStep(back)).toBe(1); // first hole is open already; 10 rounds is not
    expect(back.cash).toBe(g.cash);
    back.campaign.done = CHAIN.slice(0, 5).map((c) => c.id);
    expect(chainStep(deserialize(serialize(back))!.game)).toBe(5);
    // a save from the first chain stored only the position: position 3 was "Earn $1,500 profit"
    const v1 = JSON.parse(serialize(back));
    v1.campaign.step = 3;
    delete v1.campaign.goalId;
    delete v1.campaign.done;
    expect(currentGoal(deserialize(JSON.stringify(v1))!.game)!.id).toBe('c-profit1500');
  });

  it('gives a save that had finished the old chain the resort goals, and marks its region complete', () => {
    const g = new Game(createTestCourse(), 1);
    const raw = JSON.parse(serialize(g));
    raw.campaign.step = 19;
    raw.campaign.goalId = 'done'; // the end of the chain before the resort goals existed
    delete raw.campaign.done;
    const back = deserialize(JSON.stringify(raw))!.game;
    expect(currentGoal(back)!.id).toBe('c-members20');
    expect(regionComplete(back)).toBe(true);
    expect(regionComplete(g)).toBe(false);
  });

  it('moves a save that was on a removed goal to the goal that follows it', () => {
    const g = new Game(createTestCourse(), 1);
    const raw = JSON.parse(serialize(g));
    raw.campaign.step = 5;
    raw.campaign.goalId = 'c-play'; // "Play a hole yourself" is no longer part of the chain
    delete raw.campaign.done;
    expect(currentGoal(deserialize(JSON.stringify(raw))!.game)!.id).toBe('c-profit1500');
  });
});
