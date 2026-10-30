import { Game } from './game';
import { World, computeZones, createStartingWorld } from './terrain';
import { Rng } from './rng';
import { noUpgrades } from './economy';
import { REGIONS } from './progression';
import { defaultLogo } from './logo';

const KEY = 'second-chance-golf.save.v2';
const VERSION = 2;

export function serialize(g: Game): string {
  const w = g.world;
  return JSON.stringify({
    v: VERSION,
    savedAt: Date.now(),
    region: g.region,
    name: g.name,
    logo: g.logo,
    world: {
      terrain: Array.from(w.terrain).join(''),
      tree: Array.from(w.tree).join(''),
      cond: Array.from(w.cond, (c) => Math.round(c * 10) / 10),
      holes: w.holes,
      parcels: Array.from(w.parcels),
    },
    cash: g.cash,
    cartFee: g.cartFee,
    bookings: g.bookings,
    eventFees: g.eventFees,
    lastEvent: g.lastEvent,
    day: g.day,
    clock: g.clock,
    total: g.total,
    fees: g.fees,
    clubLevel: g.clubLevel,
    stats: g.stats,
    upgrades: g.upgrades,
    goals: g.goals,
    today: g.today,
    days: g.days,
    log: g.log,
    recent: g.recent,
    rng: g.rng.state,
    lastHour: g.lastHour,
    settings: g.settings,
    selectedHole: g.selectedHole,
  });
}

export function deserialize(text: string): { game: Game; savedAt: number } | null {
  try {
    const d = JSON.parse(text);
    if (d.v !== VERSION || !REGIONS[d.region as keyof typeof REGIONS]) return null;
    const base = createStartingWorld(d.region);
    const n = base.terrain.length;
    if (d.world.terrain.length !== n || d.world.cond.length !== n || d.world.parcels.length !== base.parcels.length) return null;
    const world: World = { ...base, terrain: new Uint8Array(n), tree: new Uint8Array(n), cond: new Float32Array(n), holes: d.world.holes, zone: new Uint8Array(n), parcels: Uint8Array.from(d.world.parcels) };
    for (let i = 0; i < n; i++) {
      world.terrain[i] = d.world.terrain.charCodeAt(i) - 48;
      world.tree[i] = d.world.tree.charCodeAt(i) - 48;
      world.cond[i] = d.world.cond[i];
    }
    if (!Array.isArray(world.holes) || world.holes.length < 1) return null;
    computeZones(world);
    world.version = 2;
    const g = new Game(world);
    g.region = d.region;
    g.name = d.name ?? g.name;
    g.logo = d.logo ?? defaultLogo();
    g.rng = new Rng(d.rng);
    g.sim.rng = g.rng;
    g.cash = d.cash;
    g.cartFee = d.cartFee ?? g.cartFee;
    g.bookings = Array.isArray(d.bookings) ? d.bookings : [];
    g.eventFees = { ...g.eventFees, ...(d.eventFees ?? {}) };
    g.lastEvent = d.lastEvent ?? null;
    g.day = d.day;
    g.clock = d.clock;
    g.total = d.total;
    g.fees = { ...g.fees, ...(d.fees ?? {}) };
    g.clubLevel = d.clubLevel ?? 0;
    g.stats = { ...g.stats, ...(d.stats ?? {}) };
    g.upgrades = { ...noUpgrades(), ...d.upgrades };
    // keep goal list in step with the current definitions
    const saved = new Map<string, boolean>((d.goals ?? []).map((x: { id: string; done: boolean }) => [x.id, x.done]));
    g.goals = g.goals.map((x) => ({ id: x.id, done: saved.get(x.id) ?? false }));
    g.today = d.today;
    g.days = d.days;
    g.log = d.log;
    g.recent = d.recent;
    g.lastHour = d.lastHour;
    g.settings = { ...g.settings, ...d.settings };
    g.selectedHole = d.selectedHole ?? world.holes[0].id;
    g.sim.now = g.total;
    g.applyRegion();
    return { game: g, savedAt: d.savedAt ?? Date.now() };
  } catch {
    return null;
  }
}

export function saveGame(g: Game): boolean {
  try {
    localStorage.setItem(KEY, serialize(g));
    return true;
  } catch {
    return false;
  }
}
export function loadGame(): { game: Game; savedAt: number } | null {
  try {
    const t = localStorage.getItem(KEY);
    return t ? deserialize(t) : null;
  } catch {
    return null;
  }
}
export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
