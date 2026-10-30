import type { Game } from './game';
import { RegionId } from './progression';
import { holeCondition } from './terrain';

export interface CampaignState { stage: number; claimed: string[]; completed: string[]; rounds: number; profit: number; events: number; medals: number; }
export const freshCampaign = (): CampaignState => ({ stage: 0, claimed: [], completed: [], rounds: 0, profit: 0, events: 0, medals: 0 });
export interface Objective { id: string; title: string; detail: string; reward: number; target: number; value(g: Game): number; }
const objective = (id: string, title: string, detail: string, reward: number, target: number, value: (g: Game) => number): Objective => ({ id, title, detail, reward, target, value });
const greens = (g: Game) => g.world.holes.filter(h => holeCondition(g.world, h).green >= 75).length;
const holes = (n: number) => objective('holes', `Open ${n} holes`, 'Restore closed holes or build new ones, then open them for guests.', 550, n, g => g.openHoles.length);
const rounds = (n: number) => objective('rounds', `Welcome ${n} completed rounds`, 'Finished rounds at this location count toward this objective.', 400, n, g => g.campaign.rounds);
const profit = (n: number) => objective('profit', `Earn $${n.toLocaleString()} operating profit`, 'Cumulative daily operating profit at this location, after wages and maintenance.', 600, n, g => g.campaign.profit);
const members = (n: number) => objective('members', `Build a club of ${n} members`, 'Delighted guests join and pay daily dues. Keep their satisfaction high.', 500, n, g => g.members.length);
const design = (n: number) => objective('design', `Reach ${n} course design`, 'The average layout rating of your open holes; see Course → Design report.', 650, n, g => g.designRating);
export const LOCATIONS: { id: string; name: string; region: RegionId; brief: string; budget: number; objectives: Objective[] }[] = [
  { id: 'willow', name: 'Willow Creek', region: 'parkland', brief: 'An overlooked municipal course with good bones. Restore its greens, reopen the third hole, and give the locals a reason to return.', budget: 2400, objectives: [
    objective('green', 'Bring two greens back to life', 'Repair at least two greens to condition 75. Close a hole before working on it.', 300, 2, greens),
    holes(3), rounds(12), profit(500),
  ] },
  { id: 'dunes', name: 'Dunes & Tide', region: 'coast', brief: 'Tourists will pay for beautiful golf, but the wind punishes narrow landing areas. Build a forgiving links and a loyal following.', budget: 4200, objectives: [holes(3), design(88), members(3), profit(1200)] },
  { id: 'pine', name: 'Pine Ridge', region: 'mountain', brief: 'Tall pines and a short summer. Clear the playing lines, hire a reliable team, and grow into a four-hole destination.', budget: 6000, objectives: [holes(4), objective('staff', 'Hire two specialists', 'Hire permanent staff from the Club tab. Their daily wages come out of operating profit.', 650, 2, g => Object.values(g.staff).filter(Boolean).length), rounds(30), profit(1600)] },
  { id: 'prairie', name: 'Prairie Run', region: 'plains', brief: 'Affordable land gives you room to think big. Expand, host local events, and make the course a community fixture.', budget: 8500, objectives: [holes(5), objective('events', 'Finish two hosted events', 'Book events in the Events tab, meet their requirements, and complete their days.', 800, 2, g => g.campaign.events), members(6), profit(2500)] },
  { id: 'oasis', name: 'The Oasis', region: 'desert', brief: 'Your final restoration: a desert resort. Balance turf care with memorable design and build a club people will travel to play.', budget: 12000, objectives: [holes(6), design(90), members(10), profit(4000)] },
];
export const activeLocation = (g: Game) => LOCATIONS[Math.min(LOCATIONS.length - 1, g.campaign.stage)];
export const stageComplete = (g: Game) => activeLocation(g).objectives.every(o => g.campaign.claimed.includes(o.id));
