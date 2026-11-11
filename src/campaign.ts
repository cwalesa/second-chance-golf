import type { Game } from './game';

/** `stage` and `completed` are legacy fields from the old chapter system; they are kept only so old saves still load. */
export interface CampaignState { /** position in the goal chain (CHAIN) */ step?: number; /** id of the current goal, so the chain can change between versions */ goalId?: string; stage: number; claimed: string[]; completed: string[]; rounds: number; profit: number; events: number; medals: number; }
export const freshCampaign = (): CampaignState => ({ step: 0, goalId: 'c-hole1', stage: 0, claimed: [], completed: [], rounds: 0, profit: 0, events: 0, medals: 0 });
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
  go?: 'build' | 'course' | 'club' | 'money' | 'events' | 'guests';
  /** The building tool to pick up, for goals that teach one. */
  tool?: 'build' | 'bunker' | 'water' | 'treeAdd' | 'path';
  /** The control to point at once there. */
  guide?: string;
  /** Shown as a count (3 / 6), as money ($1,200 / $1,500) or as stars. */
  unit?: 'money' | 'stars';
}
const cg = (id: string, title: string, how: string, reward: number, target: number, value: (g: Game) => number, more: Partial<ChainGoal> = {}): ChainGoal => ({ id, title, how, reward, target, value, ...more });
const openHoles = (g: Game) => g.openHoles.length;
/** Sand within a short pitch of an open green: the player has started shaping holes, not just laying them out. */
function bunkersByGreens(g: Game) {
  const w = g.world;
  let n = 0;
  for (const h of w.holes) {
    if (!h.open) continue;
    for (let y = h.cup.y - 6; y <= h.cup.y + 6; y++)
      for (let x = h.cup.x - 6; x <= h.cup.x + 6; x++) if (x >= 0 && y >= 0 && x < w.w && y < w.h && w.terrain[y * w.w + x] === 4) n++;
  }
  return n;
}
const doglegs = (g: Game) => g.world.holes.filter((h) => h.open && (h.bends?.length ?? 0) > 0).length;
/**
 * The tutorial covers the basics (clubhouse, one hole, opening it). The goals then teach one deeper
 * system at a time: game speed, hazards, doglegs, playing a hole, fees and profit, the clubhouse,
 * staff, improvements, members, events and the rating, while the course grows to eighteen holes.
 */
export const CHAIN: ChainGoal[] = [
  cg('c-hole1', 'Open your first hole', 'Build a hole (Design, then New hole), then open it in Course.', 500, 1, openHoles, { go: 'build', tool: 'build' }),
  cg('c-rounds10', 'Welcome 10 rounds', 'Golfers come on their own. Tap Fast in the menu to speed the day up.', 600, 10, (g) => g.stats.rounds, { guide: '#nav [data-mspeed="3"]' }),
  cg('c-bunker', 'Guard a green with sand', 'Pick Bunker in Design and paint a few tiles beside a green. Hazards make holes more fun to play.', 600, 4, bunkersByGreens, { go: 'build', tool: 'bunker' }),
  cg('c-hole3', 'Open 3 holes', 'More holes bring more golfers. Build two more and open them.', 800, 3, openHoles, { go: 'build', tool: 'build' }),
  cg('c-dogleg', 'Build a dogleg', 'Start a New hole, then tap + Bend and tap where the fairway should turn. Open it when it is ready.', 800, 1, doglegs, { go: 'build', tool: 'build' }),
  cg('c-play', 'Play a hole yourself', 'Open Course, pick a hole and tap Play it. Aim on the map, then time your swing.', 500, 1, (g) => g.ownerRecords.length, { go: 'course', guide: '[data-act="practice"]' }),
  cg('c-profit1500', 'Earn $1,500 profit', 'Profit is green fees and sales minus upkeep. In Finances, keep each fee close to what guests think is fair.', 800, 1500, (g) => g.campaign.profit, { go: 'money', guide: '[data-act="bandfee"]', unit: 'money' }),
  cg('c-club1', 'Upgrade to a real clubhouse', 'Needs a 1-star rating. Upgrade it in the Clubhouse panel.', 1000, 1, (g) => g.clubLevel, { go: 'club', guide: '[data-act="club"]' }),
  cg('c-staff', 'Hire your first staff member', 'A greenkeeper keeps turf healthy and a ranger keeps play moving. Hire one in Clubhouse.', 800, 1, (g) => Object.values(g.staff).filter(Boolean).length, { go: 'club', guide: '[data-act="hire"]' }),
  cg('c-hole6', 'Open 6 holes', 'Keep building. Mix pars 3, 4 and 5 for variety.', 1500, 6, openHoles, { go: 'build', tool: 'build' }),
  cg('c-amenity', 'Add an improvement', 'Improvements like a snack bar or carts earn money and please guests. Buy one in Finances.', 1000, 1, (g) => Object.values(g.upgrades).filter(Boolean).length, { go: 'money', guide: '[data-act="buy"]' }),
  cg('c-members3', 'Win 3 club members', 'Golfers who love their round may join and pay daily dues. Keep them happy.', 1000, 3, (g) => g.members.length, { go: 'guests' }),
  cg('c-event1', 'Host an event', 'Book one in Events, then let the day play out.', 1200, 1, (g) => g.stats.events, { go: 'events', guide: '[data-act="book"]' }),
  cg('c-hole9', 'Open 9 holes', 'A full nine. Golfers stay longer and pay more.', 2500, 9, openHoles, { go: 'build', tool: 'build' }),
  cg('c-star25', 'Reach a 2.5-star rating', 'Rating grows with holes, turf condition, happy guests and improvements.', 2000, 2.5, (g) => g.stars, { go: 'club', unit: 'stars' }),
  cg('c-club2', 'Become a country club', 'Upgrade the clubhouse again. It allows 12 holes.', 3000, 2, (g) => g.clubLevel, { go: 'club', guide: '[data-act="club"]' }),
  cg('c-hole12', 'Open 12 holes', 'Use the extra room the country club gives you.', 4000, 12, openHoles, { go: 'build', tool: 'build' }),
  cg('c-star35', 'Reach a 3.5-star rating', 'Keep turf in good shape, buy improvements and keep guests happy.', 5000, 3.5, (g) => g.stars, { go: 'club', unit: 'stars' }),
  cg('c-club3', 'Build the grand clubhouse', 'The grand clubhouse allows a full 18 holes.', 6000, 3, (g) => g.clubLevel, { go: 'club', guide: '[data-act="club"]' }),
  cg('c-hole18', 'Open 18 holes', 'Finish the full championship course.', 10000, 18, openHoles, { go: 'build', tool: 'build' }),
];
/** The first version of the chain, by position, so saves that stored only a number land on the same goal. */
export const CHAIN_V1 = ['c-hole1', 'c-rounds10', 'c-hole3', 'c-profit1500', 'c-club1', 'c-hole6', 'c-members3', 'c-event1', 'c-hole9', 'c-star25', 'c-club2', 'c-hole12', 'c-star35', 'c-club3', 'c-hole18'];
export const chainStep = (g: Game) => Math.min(CHAIN.length, g.campaign.step ?? 0);
export const currentGoal = (g: Game): ChainGoal | null => CHAIN[chainStep(g)] ?? null;
export function goalProgressText(goal: ChainGoal, g: Game): string {
  const v = Math.max(0, Math.min(goal.target, goal.value(g)));
  if (goal.unit === 'money') return '$' + Math.round(v).toLocaleString('en-US') + ' / $' + goal.target.toLocaleString('en-US');
  if (goal.unit === 'stars') return v + ' / ' + goal.target + ' stars';
  return Math.floor(v) + ' / ' + goal.target;
}
