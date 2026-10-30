import { GolferType } from './config';
import { Rng } from './rng';
import { CLUB_LEVELS } from './progression';

export type EventId = 'scramble' | 'outing' | 'clinic' | 'league' | 'open' | 'wedding';

export interface EventDef {
  name: string;
  blurb: string;
  cost: number; // setup cost, paid when the event starts
  fair: number; // entry fee guests consider fair
  guests: number; // typical turnout at a fair price
  mix: Record<GolferType, number>;
  minHoles: number;
  minRep: number;
  minCond: number;
  minClub: number; // clubhouse level (0 to 4) needed
}

export const EVENTS: Record<EventId, EventDef> = {
  scramble: { name: 'Charity scramble', blurb: 'A friendly shotgun start for mixed abilities. Good turnout, modest entry fee.', cost: 150, fair: 45, guests: 14, mix: { beginner: 0.4, regular: 0.5, skilled: 0.1 }, minHoles: 2, minRep: 0, minCond: 0, minClub: 0 },
  outing: { name: 'Corporate outing', blurb: 'A company day out. Pays well, but they expect a course with a good reputation.', cost: 250, fair: 60, guests: 10, mix: { beginner: 0.5, regular: 0.45, skilled: 0.05 }, minHoles: 2, minRep: 55, minCond: 0, minClub: 1 },
  clinic: { name: 'Junior clinic', blurb: 'Lessons for young beginners. Cheap to run and cheap to enter.', cost: 80, fair: 20, guests: 12, mix: { beginner: 0.9, regular: 0.1, skilled: 0 }, minHoles: 1, minRep: 0, minCond: 0, minClub: 0 },
  league: { name: 'League day', blurb: 'Serious players who notice the turf. Needs well-kept holes.', cost: 200, fair: 50, guests: 12, mix: { beginner: 0.1, regular: 0.5, skilled: 0.4 }, minHoles: 2, minRep: 0, minCond: 65, minClub: 1 },
  open: { name: 'Regional open', blurb: 'A proper tournament. Big entry fees and big expectations. Needs nine holes and a grand clubhouse.', cost: 900, fair: 140, guests: 30, mix: { beginner: 0.05, regular: 0.45, skilled: 0.5 }, minHoles: 9, minRep: 70, minCond: 72, minClub: 3 },
  wedding: { name: 'Resort wedding party', blurb: 'A celebration with a round of golf. Needs the resort lodge.', cost: 1200, fair: 120, guests: 24, mix: { beginner: 0.6, regular: 0.35, skilled: 0.05 }, minHoles: 6, minRep: 65, minCond: 70, minClub: 4 },
};
export const EVENT_IDS = Object.keys(EVENTS) as EventId[];

export interface Booking {
  id: EventId;
  day: number;
  fee: number;
}
export interface ActiveEvent {
  id: EventId;
  fee: number;
  total: number;
  spawned: number;
  nextAt: number;
  revenue: number;
  rounds: number;
  satSum: number;
}
export interface EventResult {
  id: EventId;
  day: number;
  guests: number;
  revenue: number;
  cost: number;
  rounds: number;
  avgSat: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Expected turnout for an entry fee and the course's reputation. */
export function eventGuests(id: EventId, fee: number, reputation: number): number {
  const d = EVENTS[id];
  const price = clamp(Math.pow(d.fair / Math.max(1, fee), 1.3), 0.15, 1.6);
  const rep = clamp(0.6 + (reputation / 100) * 0.8, 0.6, 1.3);
  return Math.max(0, Math.round(d.guests * price * rep));
}

export function eventProblems(id: EventId, openHoles: number, reputation: number, avgCond: number, clubLevel = 4): string[] {
  const d = EVENTS[id];
  const out: string[] = [];
  if (clubLevel < d.minClub) out.push(`Needs the ${CLUB_LEVELS[d.minClub].name} (clubhouse level ${d.minClub + 1}).`);
  if (openHoles < d.minHoles) out.push(`Needs ${d.minHoles} open hole${d.minHoles === 1 ? '' : 's'} (you have ${openHoles}).`);
  if (reputation < d.minRep) out.push(`Needs guest satisfaction of ${d.minRep} (you have ${Math.round(reputation)}).`);
  if (avgCond < d.minCond) out.push(`Needs turf condition of ${d.minCond} (you have ${Math.round(avgCond)}).`);
  return out;
}

export function pickEventGolfer(id: EventId, rng: Rng): GolferType {
  let r = rng.next();
  for (const [k, v] of Object.entries(EVENTS[id].mix) as [GolferType, number][]) if ((r -= v) <= 0) return k;
  return 'regular';
}
