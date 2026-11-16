import type { Game } from './game';
import { CFG } from './config';
import { BANDS } from './progression';
import { beautyNear, countOf } from './items';
import { Hole, hash2, idx } from './terrain';

/**
 * Guest requests: now and then a golfer asks for something the simulation shows is actually wrong (long waits, a hole
 * that eats balls, a bumpy green, nowhere to stop), and the player is paid for putting it right within a few days.
 * Every request is chosen from what the course measures, never at random, so fixing one fixes something real.
 */
export type RequestKind = 'wait' | 'water' | 'hard' | 'worn' | 'restroom' | 'snack' | 'pretty' | 'price' | 'carts';
export interface GuestRequest {
  id: number;
  kind: RequestKind;
  hole?: number;
  /** Who asked, and what they said. */
  who: string;
  text: string;
  /** What putting it right pays. */
  reward: number;
  /** The last day it can be done on. */
  until: number;
  /** What the course looked like when it was asked, for requests that need to see a change. */
  base: number;
}
export interface RequestState { list: GuestRequest[]; seq: number; /** the day each kind was last asked, so the same thing is not asked over and over */ last: Record<string, number>; }
export const freshRequests = (): RequestState => ({ list: [], seq: 1, last: {} });

/** Days a request stays open, and the most open at once. */
export const REQUEST_DAYS = 3;
const MAX_OPEN = 2;
const COOLDOWN = 5;
const LAPSE_WAIT = 7;
const REWARD: Record<RequestKind, number> = { wait: 500, water: 450, hard: 450, worn: 300, restroom: 400, snack: 350, pretty: 250, price: 250, carts: 450 };

/** The average condition of the green within a step or so of the cup: what golfers putt on. */
export function cupCondition(g: Game, h: Hole): number {
  const w = g.world;
  let sum = 0, n = 0;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const x = h.cup.x + dx, y = h.cup.y + dy;
      if (Math.hypot(dx, dy) > CFG.wear.cupRadius || x < 0 || y < 0 || x >= w.w || y >= w.h || w.terrain[idx(w, x, y)] !== 2) continue;
      sum += w.cond[idx(w, x, y)]; n++;
    }
  return n ? sum / n : 100;
}
const prettiness = (g: Game, h: Hole) => beautyNear(g.world, h.tee) + beautyNear(g.world, h.cup);
const avgWait = (g: Game) => { const r = g.recent.slice(-10); return r.length >= 5 ? r.reduce((s, x) => s + x.wait, 0) / r.length : 0; };
const feesHigh = (g: Game, by: number) => BANDS.some((b) => g.fees[b.id] > g.fair * b.fair + by);

/** What could be asked right now, each with what it is about and the baseline it is measured from. */
function candidates(g: Game): { kind: RequestKind; hole?: number; text: string; base: number }[] {
  const out: { kind: RequestKind; hole?: number; text: string; base: number }[] = [];
  const open = g.openHoles;
  if (avgWait(g) > 20 && (open.length < g.maxHoles || !g.staff.ranger))
    out.push({ kind: 'wait', text: 'We waited ages at the tee. Another hole, or a ranger to keep play moving?', base: open.length * 10 + (g.staff.ranger ? 1 : 0) });
  for (const h of open) {
    const s = h.stats;
    if (s.rounds >= 4 && s.water / s.rounds >= 0.35) out.push({ kind: 'water', hole: h.id, text: `Hole ${h.id} eats balls. Give us a safer way around the water.`, base: h.reopenedAt });
    else if (s.rounds >= 4 && s.picked / s.rounds >= 0.15) out.push({ kind: 'hard', hole: h.id, text: `Hole ${h.id} is too much for beginners. More fairway, or a shorter way in?`, base: h.reopenedAt });
    if (cupCondition(g, h) < 50) out.push({ kind: 'worn', hole: h.id, text: `The green on hole ${h.id} is bumpy around the cup.`, base: 0 });
    if (open.length >= 2 && prettiness(g, h) === 0) out.push({ kind: 'pretty', hole: h.id, text: `Hole ${h.id} looks a bit bare. Some flowers or a bench by the tee?`, base: 0 });
  }
  if (open.length >= 3 && countOf(g.world, 'restroom') + countOf(g.world, 'shelter') === 0)
    out.push({ kind: 'restroom', text: 'A long way round with nowhere to stop. A comfort station would be welcome.', base: 0 });
  if (open.length >= 4 && !g.upgrades.snackBar && countOf(g.world, 'halfway') === 0)
    out.push({ kind: 'snack', text: 'Anywhere to grab a drink between holes? A snack bar would be lovely.', base: 0 });
  if (feesHigh(g, 5)) out.push({ kind: 'price', text: 'The fees are steep for what we get.', base: 0 });
  if (open.length >= 6 && !g.upgrades.carts) out.push({ kind: 'carts', text: `${open.length} holes on foot is a long walk. Any carts to rent?`, base: 0 });
  return out;
}

/** Whether a request has been put right. */
export function requestDone(g: Game, r: GuestRequest): boolean {
  const h = r.hole !== undefined ? g.world.holes.find((x) => x.id === r.hole) : undefined;
  switch (r.kind) {
    case 'wait': return g.openHoles.length * 10 + (g.staff.ranger ? 1 : 0) > r.base;
    // reworked: the hole has been changed (which closes it) and opened again since the request
    case 'water': case 'hard': return !!h && h.open && h.reopenedAt > r.base;
    case 'worn': return !!h && cupCondition(g, h) >= 75;
    case 'pretty': return !!h && prettiness(g, h) >= 2;
    case 'restroom': return countOf(g.world, 'restroom') + countOf(g.world, 'shelter') > 0;
    case 'snack': return g.upgrades.snackBar || countOf(g.world, 'halfway') > 0;
    case 'price': return !feesHigh(g, 2);
    case 'carts': return g.upgrades.carts;
  }
}

/** A guest's name for the request: someone who has played here lately, or a member. */
function askerName(g: Game, salt: number): string {
  const names = [...g.recent.map((r) => r.name), ...g.members.map((m) => m.name)].filter(Boolean);
  return names.length ? names[Math.floor(hash2(g.day, salt, 41) * names.length)] : 'A guest';
}

/**
 * Once a day as it begins: requests past their last day lapse, and if there is room a new one may be asked.
 * Returns the new request, if any.
 */
export function rollRequests(g: Game): GuestRequest | null {
  const st = g.requests;
  // a request left to lapse is not asked again for a while: the player chose not to, and nagging helps nobody
  for (const r of st.list.filter((x) => x.until < g.day)) { g.notify('info', `${r.who}'s request lapsed: ${r.text}`); st.last[r.kind] = g.day + LAPSE_WAIT; }
  st.list = st.list.filter((x) => x.until >= g.day);
  // a holes whose request no longer makes sense (the hole was removed) is dropped quietly
  st.list = st.list.filter((x) => x.hole === undefined || g.world.holes.some((h) => h.id === x.hole));
  if (g.day < 4 || st.list.length >= MAX_OPEN || hash2(g.day, 17, g.world.landSeed % 1000003) > 0.6) return null;
  const pool = candidates(g).filter((c) => !st.list.some((r) => r.kind === c.kind && r.hole === c.hole) && g.day - (st.last[c.kind] ?? -99) >= COOLDOWN);
  if (!pool.length) return null;
  const c = pool[Math.floor(hash2(g.day, 23, g.world.landSeed % 1000003) * pool.length)];
  const r: GuestRequest = { id: st.seq++, kind: c.kind, hole: c.hole, who: askerName(g, st.seq), text: c.text, reward: Math.round(REWARD[c.kind] * (1 + 0.25 * g.clubLevel) / 10) * 10, until: g.day + REQUEST_DAYS - 1, base: c.base };
  st.list.push(r);
  st.last[c.kind] = g.day;
  return r;
}

/** Load saved requests, dropping anything malformed. */
export function loadRequests(d: unknown): RequestState {
  const st = freshRequests();
  if (!d || typeof d !== 'object') return st;
  const o = d as Partial<RequestState>;
  if (Number.isInteger(o.seq)) st.seq = o.seq!;
  if (o.last && typeof o.last === 'object') for (const [k, v] of Object.entries(o.last)) if (Number.isFinite(v)) st.last[k] = v as number;
  if (Array.isArray(o.list))
    st.list = o.list.filter((r): r is GuestRequest => !!r && typeof r === 'object' && Number.isInteger(r.id) && typeof r.kind === 'string' && r.kind in REWARD && typeof r.text === 'string' && Number.isFinite(r.reward) && Number.isFinite(r.until) && Number.isFinite(r.base));
  return st;
}
