// The season calendar: dated opportunities the club can choose to commit to, and the tournament that runs on one.
//
// Opportunities come from what the club has built and become (an academy offers a junior camp, a tournament center
// a championship, a busy restaurant a private function), each with notice, requirements, costs, expected turnout,
// who benefits, what it disrupts and a range of outcomes. Nothing is forced: an opportunity not taken simply passes.
//
// Tournaments are the centrepiece: the field plays a route the player chooses, on a course the player prepared,
// under the access rules the player set; a leaderboard fills as they play; the report afterwards says how the
// course actually tested them, and the result moves prestige, regulars and future invitations.
import type { Game } from './game';
import { Access, Booking, BoardRow, EVENTS, EventId, Prep, TournamentReport, eventGuests, eventProblems } from './events';
import { facLevel, FAC, FACILITIES } from './facilities';
import { eventReadiness } from './quality';
import { T, center, hash2 } from './terrain';
import { story } from './regulars';
import { WEATHER } from './weather';

export interface Offer {
  id: number;
  ev: EventId;
  day: number;
  /** the last day to commit: the event needs this much notice */
  commitBy: number;
}
export interface CalendarState { offers: Offer[]; seq: number; history: TournamentReport[]; /** the day an event kind was last offered, so the same thing does not come round every week */ last: Record<string, number> }
export const freshCalendar = (): CalendarState => ({ offers: [], seq: 1, history: [], last: {} });
export function loadCalendar(d: unknown): CalendarState {
  const c = freshCalendar();
  if (!d || typeof d !== 'object') return c;
  const o = d as Partial<CalendarState>;
  if (Number.isInteger(o.seq)) c.seq = o.seq!;
  if (Array.isArray(o.offers)) c.offers = o.offers.filter((x) => x && x.ev in EVENTS && Number.isInteger(x.day));
  if (Array.isArray(o.history)) c.history = o.history.filter((x) => x && typeof x.name === 'string').slice(-6);
  if (o.last && typeof o.last === 'object') c.last = { ...o.last };
  return c;
}

/** All of the calendar's tuning. */
export const CAL = {
  horizon: 10,
  maxOffers: 4,
  /** days before the same kind of event is offered again */
  repeat: { junior: 8, championship: 8, qualifier: 12, memberday: 7, function: 5 } as Partial<Record<EventId, number>>,
  prepCost: { none: 0, standard: 22, championship: 75 } as Record<Prep, number>,
  prepCond: { none: 0, standard: 86, championship: 93 } as Record<Prep, number>,
};
export const PREP_LABEL: Record<Prep, string> = { none: 'No extra work', standard: 'Standard: greens cut and rolled', championship: 'Championship: greens and fairways at their best, tucked pins' };
export const ACCESS_LABEL: Record<Access, string> = { open: 'Open: the public plays alongside', members: 'Members only besides the field', closed: 'Closed to everyone but the field' };

/** Open holes in playing order. */
const openOrder = (g: Game) => g.openHoles.sort((a, b) => a.id - b.id);
/** The route a booking plays: its chosen holes that are still open, or every open hole. */
export function routeOf(g: Game, b: Pick<Booking, 'route'>): number[] {
  const open = openOrder(g).map((h) => h.id);
  const r = b.route?.filter((id) => open.includes(id));
  return r && r.length ? r : open;
}
export function readinessOf(g: Game, route: number[]) {
  return eventReadiness(g.world, route.map((id) => g.hole(id)).filter(Boolean), g.qualityCtx);
}

/** Why an event cannot be booked (or run) now, with this route. */
export function eventIssues(g: Game, id: EventId, route?: number[]): string[] {
  const d = EVENTS[id];
  const out = eventProblems(id, g.openHoles.length, g.reputation, g.avgCondition, g.clubLevel);
  if (d.needs && facLevel(g, d.needs.facility) < d.needs.level) {
    const f = FACILITIES[d.needs.facility];
    out.push(d.needs.level > 1 ? `Needs the ${f.name.toLowerCase()} with ${f.levels[d.needs.level - 1].name.toLowerCase()}.` : `Needs a ${f.name.toLowerCase()}.`);
  }
  if (id === 'memberday' && g.members.length < 4) out.push(`Needs 4 members (you have ${g.members.length}).`);
  const r = route ?? routeOf(g, {});
  if (d.minRoute && r.length < d.minRoute) out.push(`Needs a route of ${d.minRoute} open holes (${r.length} chosen).`);
  if (d.minReady) {
    const rd = readinessOf(g, r).score;
    if (rd < d.minReady) out.push(`Course readiness ${rd} of ${d.minReady} needed. See the readiness notes.`);
  }
  if (d.minPrestige && g.prestige < d.minPrestige) out.push(`Needs prestige ${d.minPrestige} (you have ${Math.round(g.prestige)}). Host a club championship first.`);
  return out;
}

/** What committing to an event is expected to bring: turnout, money in and out, who benefits, and how sure it is. */
export function eventOutlook(g: Game, id: EventId, b: Partial<Booking> = {}): { guests: number; revenue: number; cost: number; low: number; high: number; note: string } {
  const d = EVENTS[id];
  const fee = b.fee ?? g.eventFees[id];
  const route = routeOf(g, b);
  let guests = eventGuests(id, fee, g.reputation);
  if (d.tournament) guests = Math.round(guests * (0.8 + g.prestige / 250) * (g.identity?.top === 'competitive' ? 1.15 : 1));
  if (id === 'memberday') guests = g.members.length;
  let revenue = guests * fee;
  if (d.tournament && facLevel(g, 'tourney') >= 2) revenue += guests * FAC.tourney.galleryPerPlayer;
  if (id === 'function') revenue = FAC.restaurant.functionFee[facLevel(g, 'restaurant')] - FAC.restaurant.functionCost;
  const prep = (b.prep ?? 'none') as Prep;
  const cost = d.cost + CAL.prepCost[prep] * route.length + (id === 'memberday' ? 25 * g.members.length : 0);
  // weather is known a few days out; beyond that it could go either way
  const day = b.day ?? g.day + 1;
  const wx = g.weatherFor(day);
  const sure = day - g.day <= 3;
  const spread = sure ? (wx === 'clear' ? 0.12 : 0.35) : 0.25;
  const low = Math.round(revenue * (1 - spread) * (sure ? WEATHER[wx].demand ** 0.3 : 1));
  const note = sure ? (wx === 'clear' ? 'Forecast clear.' : `Forecast: ${WEATHER[wx].name.toLowerCase()}. Turnout may suffer.`) : 'Too far out for a forecast.';
  return { guests, revenue, cost, low, high: Math.round(revenue * (1 + spread * 0.6)), note };
}

/** Day start: drop offers whose commit-by day has passed, and offer what this club is ready for. */
export function refreshOffers(g: Game) {
  const c = g.calendar;
  c.offers = c.offers.filter((o) => o.commitBy >= g.day && !g.bookings.some((b) => b.day === o.day && b.id === o.ev));
  if (g.day < 3 || !g.openHoles.length) return;
  const kinds: EventId[] = ['championship', 'junior', 'memberday', 'function', 'qualifier'];
  for (const ev of kinds) {
    if (c.offers.length >= CAL.maxOffers) break;
    if (c.offers.some((o) => o.ev === ev)) continue;
    if (g.day - (c.last[ev] ?? -99) < (CAL.repeat[ev] ?? 6)) continue;
    const d = EVENTS[ev];
    // only what the club has the facility for; readiness and the like are shown as requirements, so the player can work toward them
    if (d.needs && facLevel(g, d.needs.facility) < d.needs.level) continue;
    if (ev === 'memberday' && g.members.length < 4) continue;
    // a club leaning one way sees more of what suits it; not every club gets the same calendar
    const lean = g.identity?.top;
    const bias = (ev === 'championship' || ev === 'qualifier') && lean === 'competitive' ? 0.25 : ev === 'junior' && lean === 'learning' ? 0.25 : ev === 'function' && lean === 'resort' ? 0.25 : ev === 'memberday' && lean === 'community' ? 0.25 : 0;
    if (hash2(g.day, ev.length * 13 + 7, g.world.landSeed % 99991) > 0.45 + bias) continue;
    const prep = d.prep ?? 1;
    const day = g.day + prep + 2 + Math.floor(hash2(g.day, ev.length, 5) * 4);
    if (g.bookings.some((b) => b.day === day) || c.offers.some((o) => o.day === day)) continue;
    c.offers.push({ id: c.seq++, ev, day, commitBy: day - prep });
    c.last[ev] = g.day;
  }
  c.offers.sort((a, b) => a.day - b.day);
}

/** Commit to an offer (or book any-day event) with the player's choices. */
export function commit(g: Game, id: EventId, day: number, opts: { fee?: number; route?: number[]; prep?: Prep; access?: Access } = {}): boolean {
  const issues = eventIssues(g, id, opts.route);
  if (issues.length) { g.notify('bad', `Cannot commit to ${EVENTS[id].name}: ${issues[0]}`); return false; }
  if (g.bookings.some((b) => b.day === day)) { g.notify('bad', `Day ${day} already has an event.`); return false; }
  const b: Booking = { id, day, fee: opts.fee ?? g.eventFees[id], route: opts.route, prep: opts.prep ?? (EVENTS[id].tournament ? 'standard' : 'none'), access: opts.access ?? (EVENTS[id].tournament ? 'members' : 'open') };
  g.bookings.push(b);
  g.bookings.sort((a, c) => a.day - c.day);
  g.calendar.offers = g.calendar.offers.filter((o) => !(o.ev === id && o.day === day));
  if (id === 'function') g.fac.restaurant.functionDay = day;
  if (b.access === 'closed') for (const r of g.regulars.list.filter((x) => x.kind === 'founder' && x.member)) story(g, r.name, `heard the course closes to members on day ${day}. Founders do not like being shut out.`, 'bad');
  g.notify('good', `${EVENTS[id].name} set for day ${day}.${EVENTS[id].tournament ? ' Choose its holes, preparation and access in Calendar.' : ''}`);
  g.dirtySave = true;
  return true;
}

/** Tournament prep: work done the evening before, charged when the event starts. */
export function applyPrep(g: Game, route: number[], prep: Prep): number {
  if (prep === 'none') return 0;
  const w = g.world, to = CAL.prepCond[prep];
  for (const id of route) {
    const h = g.world.holes.find((x) => x.id === id);
    if (!h) continue;
    const cup = center(h.cup);
    for (let i = 0; i < w.terrain.length; i++) {
      if (w.zone[i] !== id) continue;
      const t = w.terrain[i];
      const green = t === T.GREEN && Math.hypot((i % w.w) + 0.5 - cup.x, Math.floor(i / w.w) + 0.5 - cup.y) < 5;
      if (green || t === T.TEE || (prep === 'championship' && t === T.FAIRWAY)) {
        if (w.cond[i] < to) { w.cond[i] = to; w.dirty.add(i); }
      }
    }
  }
  w.version++;
  return CAL.prepCost[prep] * route.length;
}

/** The field for a tournament: regulars and members first (by name), then visiting players. */
export function fieldNames(g: Game, n: number, id: EventId): { name: string; regId?: number; type: 'beginner' | 'regular' | 'skilled'; skill?: number }[] {
  const out: { name: string; regId?: number; type: 'beginner' | 'regular' | 'skilled'; skill?: number }[] = [];
  const kinds = id === 'qualifier' || id === 'open' ? ['competitor'] : ['competitor', 'junior', 'founder', 'learner', 'socialite'];
  for (const r of g.regulars.list) if (kinds.includes(r.kind) && out.length < n) out.push({ name: r.name, regId: r.id, type: r.type, skill: r.skill });
  if (id === 'championship') for (const m of g.members) if (out.length < Math.min(n, 12) && !out.some((x) => x.name === m.name)) out.push({ name: m.name, type: m.type });
  return out;
}

/** A hole finished by a field player: their leaderboard row moves. */
export function boardHole(g: Game, name: string, regId: number | undefined, par: number, strokes: number, water: number) {
  const e = g.activeEvent;
  if (!e?.board) return;
  let row = e.board.find((r) => r.name === name);
  if (!row) { row = { name, regId, strokes: 0, par: 0, holes: 0, done: false, water: 0 }; e.board.push(row); }
  row.strokes += strokes; row.par += par; row.holes++; row.water += water;
  if (row.holes >= (e.route?.length ?? 99)) row.done = true;
}
/** Lowest score against par first; ties go to whoever has played more holes. */
export const sortedBoard = (rows: BoardRow[]) => [...rows].sort((a, b) => (a.strokes - a.par) - (b.strokes - b.par) || b.holes - a.holes);

/** At the end of a tournament day: the report, prestige, and what the regulars made of it. */
export function tournamentReport(g: Game, day: number): TournamentReport | null {
  const e = g.activeEvent;
  if (!e?.board || !EVENTS[e.id].tournament) return null;
  const route = e.route ?? [];
  const rows = sortedBoard(e.board.filter((r) => r.holes > 0));
  const per: Record<number, { over: number; n: number }> = {};
  let water = 0, waits = 0, n = 0;
  for (const id of route) {
    const h = g.world.holes.find((x) => x.id === id);
    const plays = (h?.log ?? []).filter((p) => p.day === day && p.k === 'f');
    if (plays.length) per[id] = { over: plays.reduce((s, p) => s + p.d, 0) / plays.length, n: plays.length };
    for (const p of plays) { water += p.w; waits += p.t; n++; }
  }
  const ranked = Object.entries(per).sort((a, b) => b[1].over - a[1].over);
  const toughest = ranked[0] ? { hole: Number(ranked[0][0]), over: Math.round(ranked[0][1].over * 10) / 10 } : null;
  const easiest = ranked.length > 1 ? { hole: Number(ranked[ranked.length - 1][0]), over: Math.round(ranked[ranked.length - 1][1].over * 10) / 10 } : null;
  const sat = e.rounds ? e.satSum / e.rounds : 0;
  const ready = e.readiness ?? 0;
  const lv = facLevel(g, 'tourney');
  // prestige: how good the test was, how the field enjoyed it, and how big the event is; a poor course loses face
  const size = e.id === 'open' ? 1.6 : e.id === 'qualifier' ? 1.3 : 1;
  const gain = Math.round(((ready - 50) / 6 + (sat - 65) / 8 + Math.min(4, rows.length / 6)) * size * (FAC.tourney.prestigeMult[lv] || 1) * (g.identity?.top === 'competitive' ? 1.2 : 1));
  g.prestige = Math.max(0, Math.min(100, g.prestige + gain));
  const notes: string[] = [];
  if (toughest && toughest.over >= 1.2) notes.push(`Hole ${toughest.hole} played ${toughest.over} over par on average: a real test${toughest.over > 2 ? ', perhaps too harsh' : ''}.`);
  if (n && water / n > 0.3) notes.push(`${Math.round((water / n) * 100)}% of holes played lost a ball to water.`);
  if (n && waits / n > 20) notes.push('The field waited on tees. A shorter route, a ranger or closing the route to the public would help.');
  if (ready < 60) notes.push('The field found the course plain or rough. More strategy and better turf would lift prestige.');
  if (gain > 0) notes.push(`Word is spreading: prestige +${gain}.`); else notes.push(`The field was not impressed: prestige ${gain}.`);
  // regulars in the field
  rows.forEach((r, i) => {
    const reg = r.regId ? g.regulars.list.find((x) => x.id === r.regId) : undefined;
    if (!reg) return;
    if (i === 0) story(g, reg.name, `won the ${EVENTS[e.id].name.toLowerCase()} at ${r.strokes - r.par >= 0 ? '+' : ''}${r.strokes - r.par}!`, 'good', true);
    if (reg.goal.kind === 'championship' && !reg.goal.done && i < Math.ceil(rows.length / 2)) {
      reg.goal.done = true; reg.goal.doneDay = g.day; reg.goal.progress = 1;
      story(g, reg.name, `finished ${ordinal(i + 1)} of ${rows.length} in the championship. The junior program worked.`, 'good', true);
    } else if (reg.goal.kind === 'championship' && !reg.goal.done) story(g, reg.name, `finished ${ordinal(i + 1)} of ${rows.length}. More lessons, and next time.`, 'info');
    reg.happiness = Math.min(100, reg.happiness + (i < 3 ? 8 : 3));
  });
  return {
    name: EVENTS[e.id].name, day, route, field: e.spawned,
    top: rows.slice(0, 5).map((r) => ({ name: r.name, over: r.strokes - r.par, holes: r.holes, regId: r.regId })),
    toughest, easiest, water: n ? Math.round((water / n) * 100) / 100 : 0, wait: n ? Math.round(waits / n) : 0, sat: Math.round(sat), readiness: ready,
    revenue: Math.round(e.revenue + (e.gallery ?? 0)), cost: Math.round(EVENTS[e.id].cost), prestige: gain, notes,
  };
}
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** Short text for a calendar day: weather mark and what is on. */
export function dayLine(g: Game, day: number): string {
  const b = g.bookings.find((x) => x.day === day);
  const o = g.calendar.offers.find((x) => x.day === day);
  return b ? EVENTS[b.id].name : o ? `Offer: ${EVENTS[o.ev].name}` : '';
}
