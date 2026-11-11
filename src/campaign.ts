import type { Game } from './game';

/** `stage` and `completed` are legacy fields from the old chapter system; they are kept only so old saves still load. */
export interface CampaignState { /** position in the goal chain (CHAIN) */ step?: number; stage: number; claimed: string[]; completed: string[]; rounds: number; profit: number; events: number; medals: number; }
export const freshCampaign = (): CampaignState => ({ step: 0, stage: 0, claimed: [], completed: [], rounds: 0, profit: 0, events: 0, medals: 0 });
export interface Objective { id: string; title: string; detail: string; reward: number; target: number; value(g: Game): number; }
const objective = (id: string, title: string, detail: string, reward: number, target: number, value: (g: Game) => number): Objective => ({ id, title, detail, reward, target, value });
const holes = (n: number) => objective(`holes${n}`, `Open ${n} holes`, 'Build holes, then open them for guests.', 550, n, g => g.openHoles.length);
const rounds = (n: number) => objective(`rounds${n}`, `Welcome ${n} completed rounds`, 'Finished rounds on your course count toward this goal.', 400, n, g => g.campaign.rounds);
const profit = (n: number) => objective(`profit${n}`, `Earn $${n.toLocaleString()} operating profit`, 'Total daily operating profit, after wages and maintenance.', 600, n, g => g.campaign.profit);
const members = (n: number) => objective(`members${n}`, `Build a club of ${n} members`, 'Delighted guests join and pay daily dues. Keep their satisfaction high.', 500, n, g => g.members.length);
const design = (n: number) => objective(`design${n}`, `Reach ${n} course design`, 'The average layout rating of your open holes; see Course → Design report.', 650, n, g => g.designRating);
/** Optional milestones for any course, in any region. They pay a small grant and never gate anything. */
export const GOALS: Objective[] = [
  holes(3), rounds(12), profit(500), holes(6), members(4), profit(2500), design(85),
  objective('events', 'Finish two hosted events', 'Book events in the Events tab, meet their requirements, and complete their days.', 800, 2, g => g.campaign.events),
];

/**
 * The road from one hole to eighteen: one goal at a time, each paying a grant when it is reached.
 * Clubhouse upgrades unlock more holes (9, then 12, then 18), so they sit in the chain where they are needed.
 * After the last goal the game is a sandbox.
 */
export interface ChainGoal {
  id: string;
  title: string;
  /** How to do it, in one plain sentence. */
  how: string;
  reward: number;
  target: number;
  value(g: Game): number;
  /** Where the goal card's button takes the player. */
  go?: 'build' | 'course' | 'club' | 'money' | 'events';
  /** Shown as a count (3 / 6), as money ($1,200 / $1,500) or as stars. */
  unit?: 'money' | 'stars';
}
const cg = (id: string, title: string, how: string, reward: number, target: number, value: (g: Game) => number, go?: ChainGoal['go'], unit?: ChainGoal['unit']): ChainGoal => ({ id, title, how, reward, target, value, go, unit });
const openHoles = (g: Game) => g.openHoles.length;
export const CHAIN: ChainGoal[] = [
  cg('c-hole1', 'Open your first hole', 'Build a hole (Design, then New hole), then open it in Course.', 500, 1, openHoles, 'build'),
  cg('c-rounds10', 'Welcome 10 rounds', 'Let golfers play. Fast speed in the menu helps.', 600, 10, (g) => g.stats.rounds),
  cg('c-hole3', 'Open 3 holes', 'More holes bring more golfers. Build two more and open them.', 800, 3, openHoles, 'build'),
  cg('c-profit1500', 'Earn $1,500 profit', 'Profit is green fees and sales minus upkeep. Keep fees fair in Finances.', 800, 1500, (g) => g.campaign.profit, 'money', 'money'),
  cg('c-club1', 'Upgrade to a real clubhouse', 'Needs a 1-star rating. Upgrade it in the Clubhouse panel.', 1000, 1, (g) => g.clubLevel, 'club'),
  cg('c-hole6', 'Open 6 holes', 'Keep building. Mix pars 3, 4 and 5 for variety.', 1500, 6, openHoles, 'build'),
  cg('c-members3', 'Win 3 club members', 'Golfers who love their round may join and pay daily dues. Keep them happy.', 1000, 3, (g) => g.members.length),
  cg('c-event1', 'Host an event', 'Book one in Events, then let the day play out.', 1200, 1, (g) => g.stats.events, 'events'),
  cg('c-hole9', 'Open 9 holes', 'A full nine. Golfers stay longer and pay more.', 2500, 9, openHoles, 'build'),
  cg('c-star25', 'Reach a 2.5-star rating', 'Rating grows with holes, turf condition, happy guests and improvements.', 2000, 2.5, (g) => g.stars, 'club', 'stars'),
  cg('c-club2', 'Become a country club', 'Upgrade the clubhouse again. It allows 12 holes.', 3000, 2, (g) => g.clubLevel, 'club'),
  cg('c-hole12', 'Open 12 holes', 'Use the extra room the country club gives you.', 4000, 12, openHoles, 'build'),
  cg('c-star35', 'Reach a 3.5-star rating', 'Keep turf in good shape, buy improvements and keep guests happy.', 5000, 3.5, (g) => g.stars, 'club', 'stars'),
  cg('c-club3', 'Build the grand clubhouse', 'The grand clubhouse allows a full 18 holes.', 6000, 3, (g) => g.clubLevel, 'club'),
  cg('c-hole18', 'Open 18 holes', 'Finish the full championship course.', 10000, 18, openHoles, 'build'),
];
export const chainStep = (g: Game) => Math.min(CHAIN.length, g.campaign.step ?? 0);
export const currentGoal = (g: Game): ChainGoal | null => CHAIN[chainStep(g)] ?? null;
export function goalProgressText(goal: ChainGoal, g: Game): string {
  const v = Math.max(0, Math.min(goal.target, goal.value(g)));
  if (goal.unit === 'money') return '$' + Math.round(v).toLocaleString('en-US') + ' / $' + goal.target.toLocaleString('en-US');
  if (goal.unit === 'stars') return v + ' / ' + goal.target + ' stars';
  return Math.floor(v) + ' / ' + goal.target;
}
