import { CFG, GolferType } from './config';
import type { Rng } from './rng';
import type { RoundResult } from './sim';

export interface DayLedger {
  fees: number;
  shop: number;
  maintenance: number;
  construction: number;
  bonus: number;
  rounds: number;
  satSum: number;
  arrivals: number;
}
export const emptyLedger = (): DayLedger => ({ fees: 0, shop: 0, maintenance: 0, construction: 0, bonus: 0, rounds: 0, satSum: 0, arrivals: 0 });
export const operatingProfit = (l: DayLedger) => l.fees + l.shop - l.maintenance;
export const netChange = (l: DayLedger) => operatingProfit(l) - l.construction + l.bonus;

export interface DaySummary extends DayLedger {
  day: number;
  profit: number;
  net: number;
  avgSat: number;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

/** What golfers consider a fair green fee for the current state of the course. */
export function fairFee(avgCond: number, openHoles: number): number {
  return 12 + 0.16 * avgCond + 5 * openHoles;
}

export function arrivalsPerDay(openHoles: number, reputation: number, fee: number, fair: number): number {
  if (openHoles <= 0) return 0;
  const base = CFG.economy.baseGolfersPerDay + CFG.economy.golfersPerOpenHole * openHoles;
  const rep = clamp(0.55 + (reputation / 100) * 0.9, 0.5, 1.5);
  const price = clamp(Math.pow(fair / Math.max(1, fee), 1.3), 0.15, 1.5);
  return base * rep * price;
}

export type UpgradeId = keyof typeof CFG.upgrades;
export const UPGRADE_IDS = Object.keys(CFG.upgrades) as UpgradeId[];
export type Owned = Record<UpgradeId, boolean>;
export const noUpgrades = (): Owned => ({ proShop: false, snackBar: false, puttingGreen: false, range: false, carts: false, crew: false });

export function upkeepPerHour(owned: Owned): number {
  return UPGRADE_IDS.reduce((s, id) => s + (owned[id] ? CFG.upgrades[id].upkeep : 0), 0);
}
export function amenityBonus(owned: Owned): number {
  return UPGRADE_IDS.reduce((s, id) => s + (owned[id] ? CFG.upgrades[id].satBonus : 0), 0);
}
export function maintenancePerHour(openHoles: number, closedHoles: number, owned: Owned): number {
  const m = CFG.economy.maintenance;
  return m.perHour + m.perOpenHole * openHoles + m.perClosedHole * closedHoles + upkeepPerHour(owned);
}
/** Share of golfers who rent a cart at this price. */
export function cartRentalRate(cartFee: number): number {
  return clamp(1.1 - cartFee / 18, 0.05, 0.9);
}

export interface RoundScore {
  total: number;
  price: number;
  cond: number;
  diff: number;
  pace: number;
}
export function scoreRound(r: RoundResult, fee: number, fair: number, bonus = 0): RoundScore {
  const s = r.stats;
  const W = CFG.satisfaction.weights;
  const price = clamp(75 + (fair - fee) * CFG.tuning.fairLeniency);
  const avgCond = s.condN > 0 ? s.condSum / s.condN : 70;
  const cond = clamp((avgCond - 15) * 1.35);
  let diff = 75;
  if (r.holes > 0) {
    const excess = (r.strokes - r.par) / r.holes - CFG.golfers.types[r.type].expectedOver;
    diff = clamp(80 - 28 * excess - 4 * s.water);
  }
  const pace = clamp(100 - Math.max(0, s.wait - 10) * 1.8 - 8 * s.closedOnMe);
  const total = clamp(W.price * price + W.cond * cond + W.diff * diff + W.pace * pace + bonus);
  return { total, price, cond, diff, pace };
}

export function farewellFor(sc: RoundScore): string {
  if (sc.total >= 82) return 'Lovely round. See you next week.';
  const parts: [number, string][] = [
    [sc.price, 'Bit pricey for what this is.'],
    [sc.cond, 'The turf is in rough shape out there.'],
    [sc.diff, 'Too punishing for my game.'],
    [sc.pace, 'Too much standing around.'],
  ];
  parts.sort((a, b) => a[0] - b[0]);
  return parts[0][0] < 50 ? parts[0][1] : sc.total >= 68 ? 'A decent day out.' : 'Not my best day here.';
}

export function shopSpend(rng: Rng, satisfaction: number, owned: Owned): number {
  const e = CFG.economy;
  const base = e.shopBase + satisfaction * e.shopSatFactor + rng.range(0, 3) + (owned.snackBar ? CFG.extras.snackSpend : 0);
  return Math.round(base * (owned.proShop ? e.proShopMultiplier : 1));
}

export function reputationOf(totals: number[]): number {
  const w = CFG.satisfaction.window;
  const recent = totals.slice(-w);
  const prior = CFG.satisfaction.prior;
  return (prior * 4 + recent.reduce((a, b) => a + b, 0)) / (4 + recent.length);
}

export function pickGolferType(rng: Rng): GolferType {
  let r = rng.next();
  const entries = Object.entries(CFG.golfers.types) as [GolferType, { weight: number }][];
  for (const [k, v] of entries) {
    if ((r -= v.weight) <= 0) return k;
  }
  return 'regular';
}
