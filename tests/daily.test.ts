import { levelBonus } from '../src/experience';
import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { challengeDone, claimable, rollDay, streakReward } from '../src/daily';
import { levelXp, playerLevel } from '../src/experience';
import { deserialize, serialize } from '../src/save';
import { createTestCourse } from './fixtures/classic-course';

describe('daily streak and challenges', () => {
  it('counts consecutive days, restarts after a gap, and ignores a clock that goes back', () => {
    const g = new Game(createTestCourse(), 1);
    expect(rollDay(g, '2026-11-10')).toBe(true);
    expect(g.daily.streak).toBe(1);
    expect(g.daily.pending).toBe(streakReward(1));
    expect(rollDay(g, '2026-11-10')).toBe(false); // same day: nothing new
    rollDay(g, '2026-11-11');
    rollDay(g, '2026-11-12');
    expect(g.daily.streak).toBe(3);
    expect(g.daily.best).toBe(3);
    rollDay(g, '2026-11-15'); // missed two days
    expect(g.daily.streak).toBe(1);
    expect(g.daily.best).toBe(3);
    rollDay(g, '2026-11-01');
    expect(g.daily.streak).toBe(1);
  });

  it('hands out three different challenges that pay once, with a bonus for all three', () => {
    const g = new Game(createTestCourse(), 1);
    rollDay(g, '2026-11-10');
    const kinds = g.daily.challenges.map((c) => c.kind);
    expect(new Set(kinds).size).toBe(3);
    // same day, same challenges
    const again = new Game(createTestCourse(), 2);
    rollDay(again, '2026-11-10');
    expect(again.daily.challenges.map((c) => c.kind)).toEqual(kinds);
    expect(g.claimChallenge(0)).toBe(0); // not done yet
    for (const c of g.daily.challenges) c.base -= c.target; // pretend each was completed
    expect(g.daily.challenges.every((c) => challengeDone(g, c))).toBe(true);
    expect(claimable(g)).toBe(4); // three challenges and the streak reward
    const cash = g.cash;
    const r = g.daily.challenges.reduce((a, c) => a + c.reward, 0);
    for (let i = 0; i < 3; i++) g.claimChallenge(i);
    // the challenges' XP reaches levels 2 and 3, and each level pays its grant
    expect(g.cash).toBe(cash + r + 500 + levelBonus(2) + levelBonus(3));
    expect(g.claimChallenge(0)).toBe(0);
    expect(g.claimStreak()).toBe(streakReward(1));
    expect(g.claimStreak()).toBe(0);
    expect(claimable(g)).toBe(0);
  });

  it('saves the streak and challenges', () => {
    const g = new Game(createTestCourse(), 1);
    rollDay(g, '2026-11-10');
    rollDay(g, '2026-11-11');
    const back = deserialize(serialize(g))!.game;
    expect(back.daily.streak).toBe(2);
    expect(back.daily.challenges).toEqual(g.daily.challenges);
  });

  it('levels come quickly at first and slow down', () => {
    expect(playerLevel(0)).toBe(1);
    expect(playerLevel(levelXp(2))).toBe(2);
    expect(levelXp(3) - levelXp(2)).toBeGreaterThan(levelXp(2) - levelXp(1));
    expect(playerLevel(5000)).toBeGreaterThan(10);
  });
});
