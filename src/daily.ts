import type { Game } from './game';

/**
 * Reasons to come back every day, measured in real calendar days on the player's phone:
 * a login streak that pays a little more each day, and three small challenges that change at midnight.
 * Everything here is earned by playing; nothing is bought.
 */
export interface Challenge {
  kind: ChallengeKind;
  target: number;
  /** the stat's value when the challenge was handed out; progress is measured from here */
  base: number;
  reward: number;
  xp: number;
  claimed: boolean;
}
export interface DailyState {
  /** local date (YYYY-MM-DD) the streak and challenges belong to */
  date: string;
  streak: number;
  best: number;
  /** a streak reward waiting to be collected */
  pending: number;
  challenges: Challenge[];
}
export const freshDaily = (): DailyState => ({ date: '', streak: 0, best: 0, pending: 0, challenges: [] });

export type ChallengeKind = 'rounds' | 'revenue' | 'birdies' | 'trees' | 'bunkers' | 'members' | 'happy';
interface Kind {
  title: (n: number) => string;
  value: (g: Game) => number;
  target: (g: Game) => number;
  /** whether it makes sense for this course right now */
  ok?: (g: Game) => boolean;
}
const count = (g: Game, test: (i: number) => boolean) => {
  let n = 0;
  for (let i = 0; i < g.world.terrain.length; i++) if (test(i)) n++;
  return n;
};
export const KINDS: Record<ChallengeKind, Kind> = {
  rounds: { title: (n) => `Welcome ${n} rounds`, value: (g) => g.stats.rounds, target: (g) => 6 + 3 * g.openHoles.length },
  revenue: { title: (n) => `Take in $${n.toLocaleString('en-US')}`, value: (g) => g.stats.revenue, target: (g) => Math.round((300 + 220 * g.openHoles.length) / 50) * 50 },
  birdies: { title: (n) => `See ${n} birdies on your course`, value: (g) => g.stats.birdies ?? 0, target: (g) => 2 + Math.floor(g.openHoles.length / 2) },
  trees: { title: (n) => `Plant ${n} trees`, value: (g) => count(g, (i) => g.world.tree[i] === 1), target: () => 12 },
  bunkers: { title: (n) => `Dig ${n} tiles of bunker`, value: (g) => count(g, (i) => g.world.terrain[i] === 4), target: () => 10, ok: (g) => g.openHoles.length > 0 },
  members: { title: (n) => `Sign up ${n} new member${n > 1 ? 's' : ''}`, value: (g) => g.members.length, target: () => 1, ok: (g) => g.openHoles.length >= 2 && g.members.length < 28 },
  happy: { title: () => 'Finish a day with happy guests (75+)', value: (g) => (g.days.some((d) => d.day >= g.day - 1 && d.rounds >= 4 && d.avgSat >= 75) ? 1 : 0), target: () => 1, ok: (g) => g.openHoles.length >= 2 },
};

export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000);
/** Streak pay: grows each day for a week, then holds. */
export const streakReward = (day: number) => [150, 200, 250, 300, 400, 500, 750][Math.min(6, day - 1)];

/** The value the challenge reads progress from, since it was handed out. */
export const challengeProgress = (g: Game, c: Challenge) => Math.max(0, Math.min(c.target, KINDS[c.kind].value(g) - c.base));
export const challengeDone = (g: Game, c: Challenge) => challengeProgress(g, c) >= c.target;
export const claimable = (g: Game) => (g.daily.pending > 0 ? 1 : 0) + g.daily.challenges.filter((c) => !c.claimed && challengeDone(g, c)).length;

/** A new calendar day: extend or restart the streak and hand out three fresh challenges. Safe to call often. */
export function rollDay(g: Game, today = localDate()) {
  const d = g.daily;
  if (d.date === today) return false;
  if (!g.world.clubhouse || g.openHoles.length === 0) return false; // the streak starts once there is a running club to come back to
  const gap = d.date ? daysBetween(d.date, today) : 1;
  if (gap < 0) { d.date = today; return false; } // the clock went backwards; do not reward it
  d.streak = gap === 1 ? d.streak + 1 : 1;
  d.best = Math.max(d.best, d.streak);
  d.pending = streakReward(d.streak);
  d.date = today;
  // three different challenges, chosen from the date so they do not reshuffle on reload
  let seed = [...today].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 2147483647, 7);
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pool = (Object.keys(KINDS) as ChallengeKind[]).filter((k) => KINDS[k].ok?.(g) ?? true);
  const picks: ChallengeKind[] = [];
  while (picks.length < 3 && pool.length) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  d.challenges = picks.map((kind, i) => {
    const target = KINDS[kind].target(g);
    return { kind, target, base: KINDS[kind].value(g), reward: 250 + 150 * i + 50 * g.openHoles.length, xp: 30 + 15 * i, claimed: false };
  });
  g.dirtySave = true;
  return true;
}
