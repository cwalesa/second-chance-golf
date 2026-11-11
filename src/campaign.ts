import type { Game } from './game';

/** `stage` and `completed` are legacy fields from the old chapter system; they are kept only so old saves still load. */
export interface CampaignState { stage: number; claimed: string[]; completed: string[]; rounds: number; profit: number; events: number; medals: number; }
export const freshCampaign = (): CampaignState => ({ stage: 0, claimed: [], completed: [], rounds: 0, profit: 0, events: 0, medals: 0 });
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
