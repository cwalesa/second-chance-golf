import { GolferType } from './config';
import { Rng } from './rng';
import { CLUB_LEVELS } from './progression';

export type EventId = 'scramble' | 'outing' | 'clinic' | 'league' | 'open' | 'wedding' | 'junior' | 'championship' | 'qualifier' | 'memberday' | 'function';

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
  /** a competition with a field, a leaderboard and a report */
  tournament?: boolean;
  /** offered only on dated calendar days (see calendar.ts), not bookable any day */
  dated?: boolean;
  /** a facility and its level the event needs */
  needs?: { facility: 'academy' | 'restaurant' | 'tourney'; level: number };
  /** days of notice needed to prepare */
  prep?: number;
  /** who it is for */
  serves?: string;
  /** what it costs the normal day */
  disruption?: string;
  /** fewest holes in its route, and the course readiness and prestige it needs */
  minRoute?: number;
  minReady?: number;
  minPrestige?: number;
}

export const EVENTS: Record<EventId, EventDef> = {
  scramble: { name: 'Charity scramble', blurb: 'A friendly shotgun start for mixed abilities. Good turnout, modest entry fee.', cost: 150, fair: 45, guests: 14, mix: { beginner: 0.4, regular: 0.5, skilled: 0.1 }, minHoles: 2, minRep: 0, minCond: 0, minClub: 0 },
  outing: { name: 'Corporate outing', blurb: 'A company day out. Pays well, but they expect a course with a good reputation.', cost: 250, fair: 60, guests: 10, mix: { beginner: 0.5, regular: 0.45, skilled: 0.05 }, minHoles: 2, minRep: 55, minCond: 0, minClub: 1 },
  clinic: { name: 'Junior clinic', blurb: 'Lessons for young beginners. Cheap to run and cheap to enter.', cost: 80, fair: 20, guests: 12, mix: { beginner: 0.9, regular: 0.1, skilled: 0 }, minHoles: 1, minRep: 0, minCond: 0, minClub: 0 },
  league: { name: 'League day', blurb: 'Serious players who notice the turf. Needs well-kept holes.', cost: 200, fair: 50, guests: 12, mix: { beginner: 0.1, regular: 0.5, skilled: 0.4 }, minHoles: 2, minRep: 0, minCond: 65, minClub: 1 },
  open: { name: 'Regional open', blurb: 'A proper tournament. Big entry fees and big expectations. Needs nine holes and a grand clubhouse.', cost: 900, fair: 140, guests: 30, mix: { beginner: 0.05, regular: 0.45, skilled: 0.5 }, minHoles: 9, minRep: 70, minCond: 72, minClub: 3, tournament: true, prep: 3, minRoute: 9, serves: 'Skilled players and spectators' },
  junior: { name: 'Junior camp', blurb: 'A day of lessons and short holes for juniors from town. Small fees, but parents and future members.', cost: 260, fair: 25, guests: 14, mix: { beginner: 1, regular: 0, skilled: 0 }, minHoles: 3, minRep: 0, minCond: 0, minClub: 0, dated: true, needs: { facility: 'academy', level: 2 }, prep: 2, serves: 'Juniors, the academy, future members', disruption: 'Juniors share the first holes all morning: slower play for everyone.' },
  championship: { name: 'Club championship', blurb: 'Your members and regulars compete over the holes you choose. A leaderboard, a winner and a full report.', cost: 300, fair: 40, guests: 16, mix: { beginner: 0.15, regular: 0.5, skilled: 0.35 }, minHoles: 4, minRep: 0, minCond: 0, minClub: 0, tournament: true, dated: true, needs: { facility: 'tourney', level: 1 }, prep: 2, minRoute: 4, minReady: 50, serves: 'Members, regulars, competitive golfers', disruption: 'The route is busy with the field all day.' },
  qualifier: { name: 'Regional qualifier', blurb: 'Strong players chase a place in the regional open. They judge your course hard and talk about it after.', cost: 900, fair: 90, guests: 24, mix: { beginner: 0, regular: 0.25, skilled: 0.75 }, minHoles: 6, minRep: 60, minCond: 70, minClub: 0, tournament: true, dated: true, needs: { facility: 'tourney', level: 2 }, prep: 3, minRoute: 6, minReady: 64, minPrestige: 12, serves: 'Skilled players, spectators, your prestige', disruption: 'Public tee times are squeezed unless you close the route.' },
  memberday: { name: 'Member appreciation day', blurb: 'Free golf and a lunch for members. Costs money, delights members and brings prospects over the line.', cost: 120, fair: 0, guests: 10, mix: { beginner: 0.3, regular: 0.5, skilled: 0.2 }, minHoles: 2, minRep: 0, minCond: 0, minClub: 0, dated: true, prep: 1, serves: 'Members and prospects', disruption: 'Members play free, and public tee times are fewer in the morning.' },
  function: { name: 'Restaurant function', blurb: 'A private party books the dining room for the evening. Good money, but golfers lose most of their seats that day.', cost: 0, fair: 0, guests: 0, mix: { beginner: 1, regular: 0, skilled: 0 }, minHoles: 1, minRep: 0, minCond: 0, minClub: 0, dated: true, needs: { facility: 'restaurant', level: 2 }, prep: 1, serves: 'Local diners and the restaurant', disruption: 'Golfers lose more than half the restaurant seats that day.' },
  wedding: { name: 'Resort wedding party', blurb: 'A celebration with a round of golf. Needs the resort lodge.', cost: 1200, fair: 120, guests: 24, mix: { beginner: 0.6, regular: 0.35, skilled: 0.05 }, minHoles: 6, minRep: 65, minCond: 70, minClub: 4 },
};
export const EVENT_IDS = Object.keys(EVENTS) as EventId[];

export type Prep = 'none' | 'standard' | 'championship';
export type Access = 'open' | 'members' | 'closed';
export interface Booking {
  id: EventId;
  day: number;
  fee: number;
  /** tournaments: the holes the field plays, in order (absent: every open hole) */
  route?: number[];
  /** course preparation before the day */
  prep?: Prep;
  /** who else may play that day */
  access?: Access;
}
export interface BoardRow { name: string; regId?: number; strokes: number; par: number; holes: number; done: boolean; water: number }
export interface ActiveEvent {
  id: EventId;
  fee: number;
  total: number;
  spawned: number;
  nextAt: number;
  revenue: number;
  rounds: number;
  satSum: number;
  /** tournaments */
  board?: BoardRow[];
  route?: number[];
  prep?: Prep;
  access?: Access;
  readiness?: number;
  gallery?: number;
}
export interface EventResult {
  id: EventId;
  day: number;
  guests: number;
  revenue: number;
  cost: number;
  rounds: number;
  avgSat: number;
  /** a tournament's full report */
  report?: TournamentReport;
}
export interface TournamentReport {
  name: string;
  day: number;
  route: number[];
  field: number;
  top: { name: string; over: number; holes: number; regId?: number }[];
  toughest: { hole: number; over: number } | null;
  easiest: { hole: number; over: number } | null;
  water: number;
  wait: number;
  sat: number;
  readiness: number;
  revenue: number;
  cost: number;
  prestige: number;
  notes: string[];
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
