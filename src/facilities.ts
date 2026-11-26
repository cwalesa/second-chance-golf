// The three deep facilities: the golf academy, the restaurant with its patio, and the tournament center.
//
// Each one is a building the player places on the property (items.ts holds its footprint and price), runs with a
// choice of staffing, upgrades twice, serves a clear group of customers and changes what golfers actually do:
// beginners walk over for lessons and get better, golfers and locals eat on the patio, competitors play events.
// Where it stands matters: the academy wants the practice ground nearby, the restaurant wants a view and a short
// walk from the clubhouse door, the tournament center wants room for a gallery near the first tee.
import type { Game } from './game';
import { ITEMS, beautyNear, countOf } from './items';
import type { Item } from './items';
import { T, World, clubSites, idx, inBounds } from './terrain';

export type FacilityId = 'academy' | 'restaurant' | 'tourney';
export const FACILITY_IDS: FacilityId[] = ['academy', 'restaurant', 'tourney'];

export interface FacilityLevelDef { name: string; cost: number; upkeep: number; what: string }
export interface FacilityDef {
  name: string;
  /** who it is for, in a few words */
  serves: string;
  /** what it does, in one sentence */
  effect: string;
  /** what placement helps or hurts */
  placement: string;
  /** level 1 is the building itself (its price is the item's); levels 2 and 3 are upgrades */
  levels: [FacilityLevelDef, FacilityLevelDef, FacilityLevelDef];
}

/** All of the facilities' tuning in one place. Money is per game day unless it says otherwise. */
export const FAC = {
  academy: {
    lessonFee: 30,
    coachWage: 70,
    /** lessons one coach can give in a day, by academy level */
    lessonsPerCoach: [0, 4, 5, 6],
    maxCoaches: 3,
    /** chance a beginner (or a regular working on their game) books a lesson after the round */
    bookBeginner: 0.4,
    bookOther: 0.12,
    bookSkilled: 0.18, // only with the performance studio (level 3)
    /** how much one lesson lowers a regular's dispersion multiplier (1 = typical; 0.72 is the floor) */
    improve: 0.025,
    skillFloor: 0.72,
    /** practice ground within this many tiles makes lessons better */
    practiceRange: 16,
    juniorsPerDay: [0, 0, 3, 4],
    juniorFee: 12,
  },
  restaurant: {
    seats: [0, 26, 42, 60],
    service: {
      lean: { label: 'Lean', wage: 90, spend: 15, sat: -2, locals: 0.85, blurb: 'Two staff and a short menu. Cheap to run; golfers notice the wait.' },
      standard: { label: 'Standard', wage: 160, spend: 19, sat: 2, locals: 1, blurb: 'A full kitchen and table service.' },
      premium: { label: 'Premium', wage: 280, spend: 26, sat: 5, locals: 1.3, blurb: 'A chef and a sommelier. Draws resort visitors and locals from town.' },
    },
    /** share of the food bill that is ingredients */
    foodCost: 0.38,
    /** share of finishing golfers who stay to eat, before satisfaction and service */
    golferShare: 0.42,
    /** local diners a day at a plain spot with standard service */
    localsBase: 7,
    functionFee: [0, 1300, 1900, 2600],
    functionCost: 380,
  },
  tourney: {
    /** gallery tickets per competitor, once the grandstand stands */
    galleryPerPlayer: 9,
    prestigeMult: [0, 1, 1.15, 1.5],
  },
};
export type ServiceLevel = keyof typeof FAC.restaurant.service;

export const FACILITIES: Record<FacilityId, FacilityDef> = {
  academy: {
    name: 'Golf academy',
    serves: 'Beginners and juniors',
    effect: 'Coaches give lessons after rounds. Regulars who take lessons really do score better, and pupils become members.',
    placement: 'Lessons are better with the putting green or driving range within a short walk.',
    levels: [
      { name: 'Teaching bays', cost: 0, upkeep: 0, what: 'Lessons for beginners after their round.' },
      { name: 'Junior program', cost: 4200, upkeep: 30, what: 'Juniors come every day, some join the club, and the Junior camp appears on the calendar.' },
      { name: 'Performance studio', cost: 7800, upkeep: 55, what: 'Skilled players book coaching too, pupils improve faster, and juniors can chase the club championship.' },
    ],
  },
  restaurant: {
    name: 'Restaurant and patio',
    serves: 'Golfers after the round, local diners and resort visitors',
    effect: 'Serves meals up to its seats each day. Good service lifts satisfaction; premium service draws resort visitors.',
    placement: 'A view (trees, water, flowers nearby) brings more local diners; a long walk from the clubhouse door costs golfer custom.',
    levels: [
      { name: 'Dining room', cost: 0, upkeep: 0, what: 'Seats for about 26 a day.' },
      { name: 'Extended patio', cost: 5200, upkeep: 25, what: 'Seats for about 42, and private functions on the calendar.' },
      { name: 'Garden terrace', cost: 9400, upkeep: 45, what: 'Seats for about 60; functions pay more and the terrace adds to the view.' },
    ],
  },
  tourney: {
    name: 'Tournament center',
    serves: 'Competitive golfers and members',
    effect: 'Runs competitions: choose the holes, the preparation, the entry fee and who gets the course. Results build prestige.',
    placement: 'Best near the first tee or the clubhouse, where a gallery can gather.',
    levels: [
      { name: 'Scoring office', cost: 0, upkeep: 0, what: 'The club championship, with a leaderboard and a full report.' },
      { name: 'Grandstand', cost: 6400, upkeep: 30, what: 'Spectators buy tickets, and the regional qualifier opens up.' },
      { name: 'Media tent', cost: 11000, upkeep: 55, what: 'Results travel further: more prestige from every event, and invitations to the regional open.' },
    ],
  },
};

export interface FacilityState {
  academy: { level: number; coaches: number };
  restaurant: { level: number; service: ServiceLevel; /** a private function is booked for this day (the dining room is closed to golfers that evening) */ functionDay?: number };
  tourney: { level: number };
}
export const freshFacilities = (): FacilityState => ({ academy: { level: 1, coaches: 1 }, restaurant: { level: 1, service: 'standard' }, tourney: { level: 1 } });
export function loadFacilities(d: unknown): FacilityState {
  const f = freshFacilities();
  if (!d || typeof d !== 'object') return f;
  const o = d as Partial<FacilityState>;
  const lv = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 3 ? (v as number) : 1);
  if (o.academy) f.academy = { level: lv(o.academy.level), coaches: Number.isInteger(o.academy.coaches) ? Math.max(0, Math.min(FAC.academy.maxCoaches, o.academy.coaches)) : 1 };
  if (o.restaurant) f.restaurant = { level: lv(o.restaurant.level), service: o.restaurant.service && o.restaurant.service in FAC.restaurant.service ? o.restaurant.service : 'standard', functionDay: Number.isInteger(o.restaurant.functionDay) ? o.restaurant.functionDay : undefined };
  if (o.tourney) f.tourney = { level: lv(o.tourney.level) };
  return f;
}

export const facilityItem = (w: World, id: FacilityId): Item | undefined => (w.items ?? []).find((it) => it.k === id);
export const hasFacility = (g: Game, id: FacilityId) => countOf(g.world, id) > 0;
/** The working level of a facility: 0 when it is not built. */
export const facLevel = (g: Game, id: FacilityId) => (hasFacility(g, id) ? g.fac[id].level : 0);

/** Where golfers walk to: the front edge of the building. */
export function facilityDoor(w: World, id: FacilityId): { x: number; y: number } | null {
  const it = facilityItem(w, id);
  if (!it) return null;
  const d = ITEMS[it.k];
  return { x: it.x + (d.w ?? 1) / 2, y: it.y + (d.h ?? 1) + 0.4 };
}

/** Practice ground within a short walk of the academy: each one makes lessons better. */
export function academyPractice(w: World): { near: string[]; quality: number } {
  const it = facilityItem(w, 'academy');
  if (!it) return { near: [], quality: 0 };
  const near: string[] = [];
  for (const k of ['puttingGreen', 'range'] as const) {
    const p = (w.items ?? []).find((x) => x.k === k);
    if (p && Math.hypot(p.x - it.x, p.y - it.y) <= FAC.academy.practiceRange) near.push(k === 'range' ? 'driving range' : 'putting green');
  }
  return { near, quality: 0.8 + 0.2 * near.length };
}

/** The restaurant's setting: its view (things worth looking at nearby, water, trees) and how far it is from the clubhouse door. */
export function restaurantSetting(w: World): { view: number; walk: number; access: number; locals: number } {
  const it = facilityItem(w, 'restaurant');
  if (!it) return { view: 0, walk: 0, access: 0, locals: 0 };
  const cx = it.x + 2.5, cy = it.y + 2;
  let water = 0, trees = 0;
  for (let y = Math.floor(cy - 9); y <= cy + 9; y++)
    for (let x = Math.floor(cx - 9); x <= cx + 9; x++) {
      if (!inBounds(w, x, y)) continue;
      const i = idx(w, x, y);
      if (w.terrain[i] === T.WATER) water++;
      if (w.tree[i]) trees++;
    }
  const beauty = beautyNear(w, { x: cx, y: cy }, 9);
  // a view saturates: a pond and some trees do most of it
  const view = Math.round(100 * (1 - Math.exp(-(water * 0.05 + trees * 0.025 + beauty * 0.12))));
  const door = clubSites(w).door;
  const walk = Math.hypot(door.x - cx, door.y - cy);
  const access = walk <= 10 ? 1 : Math.max(0.45, 1 - (walk - 10) * 0.025);
  const locals = FAC.restaurant.localsBase * (0.6 + 0.9 * (view / 100));
  return { view, walk, access, locals };
}

/** Dollars a day to run the three facilities: upkeep of their levels, coaches and kitchen staff. */
export function facilityDailyCost(g: Game): number {
  let c = 0;
  for (const id of FACILITY_IDS) {
    const lv = facLevel(g, id);
    for (let k = 1; k < lv; k++) c += FACILITIES[id].levels[k].upkeep;
  }
  if (hasFacility(g, 'academy')) c += g.fac.academy.coaches * FAC.academy.coachWage;
  if (hasFacility(g, 'restaurant')) c += FAC.restaurant.service[g.fac.restaurant.service].wage;
  return c;
}

export function upgradeProblem(g: Game, id: FacilityId): string | null {
  if (!hasFacility(g, id)) return `Build the ${FACILITIES[id].name.toLowerCase()} first.`;
  const lv = g.fac[id].level;
  if (lv >= 3) return 'Fully upgraded.';
  const next = FACILITIES[id].levels[lv];
  if (g.cash < next.cost) return `Needs ${next.cost - Math.floor(g.cash) > 0 ? '$' + Math.ceil(next.cost - g.cash).toLocaleString('en-US') : ''} more cash.`;
  return null;
}
export function upgradeFacility(g: Game, id: FacilityId): boolean {
  const why = upgradeProblem(g, id);
  if (why) { g.notify('bad', why); return false; }
  const next = FACILITIES[id].levels[g.fac[id].level];
  g.spend('construction', next.cost, `${FACILITIES[id].name}: ${next.name}`);
  g.fac[id].level++;
  g.notify('good', `${next.name} open. ${next.what}`);
  g.world.version++;
  g.dirtySave = true;
  return true;
}

/** Restaurant seats left today, and whether a private function has the dining room this evening. */
export function seatsToday(g: Game): number {
  const lv = facLevel(g, 'restaurant');
  if (!lv) return 0;
  const seats = FAC.restaurant.seats[lv];
  return g.fac.restaurant.functionDay === g.day ? Math.round(seats * 0.45) : seats;
}

/**
 * After a round: does this golfer stop for a lesson or a meal? Returns where they walk and what for, or null.
 * Lessons go to beginners and juniors first (and skilled players at a performance studio); meals depend on how the day went.
 */
export function afterRound(g: Game, type: 'beginner' | 'regular' | 'skilled', sat: number, seg: string | undefined, wantsLesson: boolean): { x: number; y: number; what: 'lesson' | 'dine' } | null {
  const ac = facLevel(g, 'academy');
  const t = g.today;
  if (ac && g.fac.academy.coaches > 0) {
    const p = wantsLesson ? 0.85 : type === 'beginner' || seg === 'junior' ? FAC.academy.bookBeginner : type === 'skilled' ? (ac >= 3 ? FAC.academy.bookSkilled : 0) : FAC.academy.bookOther;
    if (g.rng.next() < p) {
      const cap = g.fac.academy.coaches * FAC.academy.lessonsPerCoach[ac];
      if ((t.lessons ?? 0) < cap) { const d = facilityDoor(g.world, 'academy'); if (d) return { ...d, what: 'lesson' }; }
      else t.turnedAway = (t.turnedAway ?? 0) + 1;
    }
  }
  const rl = facLevel(g, 'restaurant');
  if (rl) {
    const svc = FAC.restaurant.service[g.fac.restaurant.service];
    const set = restaurantSetting(g.world);
    const p = FAC.restaurant.golferShare * set.access * (0.6 + sat / 160) * (svc.sat >= 2 ? 1.1 : 0.9);
    if (g.rng.next() < p) {
      if ((t.covers ?? 0) < seatsToday(g)) { const d = facilityDoor(g.world, 'restaurant'); if (d) return { ...d, what: 'dine' }; }
      else t.diningTurnedAway = (t.diningTurnedAway ?? 0) + 1;
    }
  }
  return null;
}

/** Local diners arrive through the day (they do not play golf): a share of the day's locals each game hour. */
export function hourlyLocals(g: Game): number {
  const lv = facLevel(g, 'restaurant');
  if (!lv) return 0;
  const set = restaurantSetting(g.world);
  const svc = FAC.restaurant.service[g.fac.restaurant.service];
  const identityBoost = g.identity?.top === 'resort' ? 1.15 : 1;
  const perDay = set.locals * svc.locals * (0.75 + 0.25 * lv) * (0.7 + g.reputation / 160) * identityBoost;
  const free = Math.max(0, seatsToday(g) - (g.today.covers ?? 0));
  const want = perDay / 12;
  const n = Math.floor(want) + (g.rng.next() < want - Math.floor(want) ? 1 : 0);
  return Math.min(free, n);
}

/** Money from one meal: what the diner spends less what the ingredients cost. */
export function mealMargin(g: Game): number {
  const svc = FAC.restaurant.service[g.fac.restaurant.service];
  return Math.round(svc.spend * (1 - FAC.restaurant.foodCost));
}

/** How many people to draw at each facility right now (for the art: diners on the patio, pupils in the bays). */
export function facilityPeople(g: Game, id: FacilityId): number {
  const frac = g.clock / 420;
  if (id === 'restaurant') {
    const c = g.today.covers ?? 0;
    // diners linger through the afternoon and evening
    return Math.min(9, Math.round(Math.min(c, 4 + c * 0.25) * (frac > 0.3 ? 1 : 0.4)));
  }
  if (id === 'academy') return Math.min(6, g.sim.golfers.filter((x) => x.stopAt?.what === 'lesson').length + Math.min(3, Math.floor((g.today.lessons ?? 0) / 3)));
  const ev = g.activeEvent;
  return ev ? Math.min(9, 3 + Math.floor(ev.spawned / 3)) : 0;
}
