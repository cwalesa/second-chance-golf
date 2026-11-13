import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { CHAIN, chainStep, currentGoal } from '../src/campaign';
import { planNewHole } from '../src/editing';
import { suggestClubhouse, suggestFirstHole } from '../src/wilderness';
import { deserialize, serialize } from '../src/save';
import { createTestCourse } from './fixtures/classic-course';

describe('goal chain', () => {
  it('runs from the first hole to eighteen holes, then the game is a sandbox', () => {
    expect(CHAIN[0].id).toBe('c-hole1');
    expect(CHAIN[CHAIN.length - 1].target).toBe(18);
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
    // the next goal (10 rounds) is not met yet, and goals never skip ahead
    g.stats.rounds = 24;
    g.checkGoals();
    expect(chainStep(g)).toBe(1);
    g.stats.rounds = 25;
    g.checkGoals();
    g.checkGoals();
    expect(chainStep(g)).toBe(2); // 10 rounds reached; 3 open holes is next
  });

  it('keeps the step in saves, and old saves catch up without being paid', () => {
    const g = new Game(createTestCourse(), 1);
    g.openHole(1); g.openHole(2);
    const raw = JSON.parse(serialize(g));
    delete raw.campaign.step;
    const back = deserialize(JSON.stringify(raw))!.game;
    expect(chainStep(back)).toBe(1); // first hole is open already; 10 rounds is not
    expect(back.cash).toBe(g.cash);
    back.campaign.step = 5;
    back.campaign.goalId = CHAIN[5].id;
    expect(chainStep(deserialize(serialize(back))!.game)).toBe(5);
    // a save from the first chain stored only the position: position 3 was "Earn $1,500 profit"
    const v1 = JSON.parse(serialize(back));
    v1.campaign.step = 3;
    delete v1.campaign.goalId;
    expect(currentGoal(deserialize(JSON.stringify(v1))!.game)!.id).toBe('c-profit1500');
  });

  it('moves a save that was on a removed goal to the goal that follows it', () => {
    const g = new Game(createTestCourse(), 1);
    const raw = JSON.parse(serialize(g));
    raw.campaign.step = 5;
    raw.campaign.goalId = 'c-play'; // "Play a hole yourself" is no longer part of the chain
    expect(currentGoal(deserialize(JSON.stringify(raw))!.game)!.id).toBe('c-profit1500');
  });
});
