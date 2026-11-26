// Decisions: now and then the club faces a choice with more than one reasonable answer. Each one is announced
// ahead of the day it matters, says plainly what each option costs and does, and has a sensible default if the
// player lets it pass. They are rare (a few a season), never block play, and the consequences are proportionate.
import type { Game } from './game';
import { fmtMoney } from './game';
import { EVENTS } from './events';
import { facLevel, FAC } from './facilities';
import { story } from './regulars';
import { hash2 } from './terrain';
import { summarisePlays } from './quality';

export type DecisionKind = 'heat' | 'access' | 'setup' | 'function';
export interface DecisionOption { id: string; label: string; detail: string; cost?: number }
export interface Decision {
  id: number;
  kind: DecisionKind;
  title: string;
  text: string;
  /** the day the choice takes effect */
  day: number;
  /** decide by the end of this day, or the default is taken */
  until: number;
  options: DecisionOption[];
  /** the option taken if the player does not choose */
  fallback: string;
  chosen?: string;
}
export interface DecisionState { open: Decision[]; seq: number; last: Record<string, number>; log: { day: number; title: string; chose: string }[]; /** heat plans for days: watering crew booked */ watered: number[] }
export const freshDecisions = (): DecisionState => ({ open: [], seq: 1, last: {}, log: [], watered: [] });
export function loadDecisions(d: unknown): DecisionState {
  const s = freshDecisions();
  if (!d || typeof d !== 'object') return s;
  const o = d as Partial<DecisionState>;
  if (Number.isInteger(o.seq)) s.seq = o.seq!;
  if (Array.isArray(o.open)) s.open = o.open.filter((x) => x && Array.isArray(x.options) && typeof x.title === 'string');
  if (o.last && typeof o.last === 'object') s.last = { ...o.last };
  if (Array.isArray(o.log)) s.log = o.log.slice(-12);
  if (Array.isArray(o.watered)) s.watered = o.watered.filter((x) => Number.isInteger(x));
  return s;
}

/** All of the decisions' tuning. */
export const DEC = {
  /** fewest days between two decisions of any kind, and of the same kind */
  gap: 3,
  sameGap: 8,
  heatCrewBase: 160,
  heatCrewPerHole: 22,
  heatSyringe: 70,
};

const add = (g: Game, d: Omit<Decision, 'id'>) => {
  const s = g.decisions;
  s.open.push({ ...d, id: s.seq++ });
  s.last[d.kind] = g.day;
  s.last.any = g.day;
  g.notify('info', `Decision needed by day ${d.until}: ${d.title}. See Goals.`);
  g.dirtySave = true;
};

/** Day start: settle what passed, then perhaps raise one new decision the coming days call for. */
export function dailyDecisions(g: Game) {
  const s = g.decisions;
  for (const d of [...s.open]) if (d.until < g.day && !d.chosen) choose(g, d.id, d.fallback, true);
  s.open = s.open.filter((d) => !d.chosen);
  s.watered = s.watered.filter((x) => x >= g.day);
  if (g.day < 5 || s.open.length >= 2 || g.day - (s.last.any ?? -99) < DEC.gap) return;
  const fresh = (k: DecisionKind) => g.day - (s.last[k] ?? -99) >= DEC.sameGap;
  // a heatwave is in the forecast: water the course, or accept the wear
  for (const ahead of [1, 2]) {
    const day = g.day + ahead;
    if (fresh('heat') && g.weatherFor(day) === 'heat' && g.openHoles.length >= 2) {
      const crew = DEC.heatCrewBase + DEC.heatCrewPerHole * g.openHoles.length;
      return add(g, {
        kind: 'heat', title: `Heatwave on day ${day}`, day, until: day - 1,
        text: 'The forecast says a heatwave. Turf wears half as fast again in the heat unless it is watered.',
        options: [
          { id: 'crew', label: `Extra watering crew · ${fmtMoney(crew)}`, detail: 'No extra wear that day. Costs money, turf stays as it is.', cost: crew },
          { id: 'syringe', label: `Light syringing · ${fmtMoney(DEC.heatSyringe)}`, detail: 'Cheap: wear is only a little worse than usual.', cost: DEC.heatSyringe },
          { id: 'none', label: 'Do nothing', detail: 'Free, but expect worn greens to repair afterwards.' },
        ],
        fallback: 'none',
      });
    }
  }
  // a tournament is booked open to the public: members ask for their tee times
  const t = g.bookings.find((b) => EVENTS[b.id].tournament && b.day - g.day >= 1 && b.day - g.day <= 3 && b.access !== 'members');
  if (t && fresh('access') && g.members.length >= 3) {
    return add(g, {
      kind: 'access', title: `Members and the ${EVENTS[t.id].name.toLowerCase()}`, day: t.day, until: t.day - 1,
      text: `Members ask to keep their tee times on day ${t.day}. The field would like the course to themselves.`,
      options: [
        { id: 'members', label: 'Members keep their tee times', detail: 'Members stay happy; the field waits a little more and readiness is judged on a busier course.' },
        { id: 'closed', label: 'Field only', detail: 'Best pace for the field and better scores. Members and founders are put out.' },
        { id: 'open', label: 'Open to everyone', detail: 'Normal green fees keep coming, but the route will be crowded.' },
      ],
      fallback: t.access ?? 'open',
    });
  }
  // beginners pick up and skilled players are bored at the same time: how should the course be set up?
  const plays = g.openHoles.flatMap((h) => h.log ?? []).filter((p) => g.day - p.day <= 3);
  const sum = summarisePlays(plays);
  const begPick = plays.filter((p) => p.k === 'b' || p.k === 'j');
  const pickRate = begPick.length >= 8 ? begPick.reduce((a, p) => a + p.p, 0) / begPick.length : 0;
  const skilledShare = sum.n ? plays.filter((p) => p.k === 's' || p.k === 'f').length / sum.n : 0;
  if (fresh('setup') && (pickRate > 0.12 || (skilledShare > 0.2 && g.setup !== 'championship')) && hash2(g.day, 3, 9) < 0.5) {
    return add(g, {
      kind: 'setup', title: 'How should the course play?', day: g.day + 1, until: g.day + 1,
      text: pickRate > 0.12 ? `${Math.round(pickRate * 100)}% of beginners picked up lately. Your skilled players want a stiffer test.` : 'More skilled players are coming. They would enjoy tucked pins and thicker rough; beginners would not.',
      options: [
        { id: 'forgiving', label: 'Forgiving setup', detail: 'Pins in the middle of greens, rough kept short. Beginners score better and enjoy it more; skilled players find it tame.' },
        { id: 'standard', label: 'Standard setup', detail: 'A balanced test for everyone.' },
        { id: 'championship', label: 'Championship setup', detail: 'Tucked pins and thick rough. Skilled players love it; beginners struggle and pick up more.' },
      ],
      fallback: g.setup,
    });
  }
  // a private party asks for the restaurant
  if (facLevel(g, 'restaurant') >= 1 && fresh('function') && !g.bookings.some((b) => b.id === 'function') && hash2(g.day, 11, g.world.landSeed % 7919) < 0.3) {
    const day = g.day + 2;
    if (!g.bookings.some((b) => b.day === day)) {
      const lv = facLevel(g, 'restaurant');
      const fee = FAC.restaurant.functionFee[Math.max(1, lv)];
      return add(g, {
        kind: 'function', title: `A birthday party for day ${day}`, day, until: day - 1,
        text: `A local family wants the dining room for the evening of day ${day}: ${fmtMoney(fee)} for the night. Golfers would lose more than half the seats.`,
        options: [
          { id: 'accept', label: `Host it · +${fmtMoney(fee - FAC.restaurant.functionCost)}`, detail: 'Good money; golfers find the restaurant mostly full after their round.' },
          { id: 'decline', label: 'Keep the room for golfers', detail: 'No function money; golfers dine as usual.' },
        ],
        fallback: 'decline',
      });
    }
  }
}

/** The player (or the default) chooses. */
export function choose(g: Game, id: number, option: string, byDefault = false): boolean {
  const d = g.decisions.open.find((x) => x.id === id);
  if (!d || d.chosen) return false;
  const opt = d.options.find((o) => o.id === option);
  if (!opt) return false;
  if (opt.cost && opt.cost > g.cash) { g.notify('bad', `That costs ${fmtMoney(opt.cost)}. You have ${fmtMoney(g.cash)}.`); return false; }
  d.chosen = option;
  g.decisions.log.push({ day: g.day, title: d.title, chose: opt.label });
  if (g.decisions.log.length > 12) g.decisions.log.shift();
  if (opt.cost) g.spend('maintenance', opt.cost, d.title);
  switch (d.kind) {
    case 'heat':
      if (option === 'crew') g.decisions.watered.push(d.day);
      if (option === 'syringe') g.decisions.watered.push(-d.day); // negative: partial watering
      break;
    case 'access': {
      const b = g.bookings.find((x) => x.day === d.day);
      if (b) b.access = option as 'open' | 'members' | 'closed';
      if (option === 'closed') for (const r of g.regulars.list.filter((x) => x.member)) { r.happiness = Math.max(0, r.happiness - 6); }
      if (option === 'closed') story(g, 'Members', `were shut out for day ${d.day}. A few grumbled at the bar.`, 'bad');
      if (option === 'members') story(g, 'Members', `kept their tee times on day ${d.day}. Thank you, they said.`, 'good');
      break;
    }
    case 'setup':
      g.setSetup(option as 'forgiving' | 'standard' | 'championship');
      break;
    case 'function':
      if (option === 'accept') {
        g.bookings.push({ id: 'function', day: d.day, fee: 0 });
        g.bookings.sort((a, b) => a.day - b.day);
        g.fac.restaurant.functionDay = d.day;
      }
      break;
  }
  g.notify(byDefault ? 'info' : 'good', `${d.title}: ${byDefault ? 'nobody chose, so ' : ''}${opt.label.split(' · ')[0].toLowerCase()}.`);
  g.decisions.open = g.decisions.open.filter((x) => !x.chosen);
  g.dirtySave = true;
  return true;
}

/** Extra turf wear multiplier for today from a heatwave plan. */
export function heatPlan(g: Game): number {
  if (g.weather !== 'heat') return 1;
  if (g.decisions.watered.includes(g.day)) return 1 / 1.5;
  if (g.decisions.watered.includes(-g.day)) return 1.2 / 1.5;
  return 1;
}
