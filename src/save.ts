import { Game } from './game';
import { World, computeZones, createStartingWorld } from './terrain';
import { Rng } from './rng';
import { noUpgrades } from './economy';
import { REGIONS } from './progression';
import { defaultLogo } from './logo';

const KEY = 'second-chance-golf.save.v2';
const VERSION = 2;
const BACKUP_KEY = KEY + '.backup';
export interface LoadedSave { game: Game; savedAt: number; recovered?: boolean; }

export function serialize(g: Game): string {
  const w = g.world;
  return JSON.stringify({
    v: VERSION,
    savedAt: Date.now(),
    campaign: g.campaign,
    experience: g.experience,
    preferences: g.preferences,
    pendingRecap: g.pendingRecap,
    staff: g.staff,
    members: g.members,
    ownerRecords: g.ownerRecords,
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
    activeEvent: g.activeEvent,
    sim: { golfers: g.sim.golfers.map(x => ({ ...x, said: [...x.said] })), queues: [...g.sim.queues], tee: [...g.sim.tee], now: g.sim.now, nextId: g.sim.nextId },
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
    settings: { ...g.settings, speed: g.owner.active || g.designMode ? 1 : g.settings.speed },
    selectedHole: g.selectedHole,
  });
}

export function deserialize(text: string): LoadedSave | null {
  try {
    const d = JSON.parse(text);
    if (d.v !== VERSION || !REGIONS[d.region as keyof typeof REGIONS]) return null;
    if (!Number.isFinite(d.cash) || !Number.isInteger(d.day) || d.day < 1 || !Number.isFinite(d.clock) || d.clock < 0 || !Number.isFinite(d.total) || d.total < 0) return null;
    if (!d.world || typeof d.world.terrain !== 'string' || typeof d.world.tree !== 'string' || !Array.isArray(d.world.cond) || !Array.isArray(d.world.parcels)) return null;
    if (!/^[0-7]+$/.test(d.world.terrain) || !/^[01]+$/.test(d.world.tree) || d.world.cond.some((v: number) => !Number.isFinite(v) || v < 0 || v > 100)) return null;
    if (!Array.isArray(d.days) || !Array.isArray(d.log) || !Array.isArray(d.recent) || !d.today) return null;
    if (d.campaign && (!Number.isInteger(d.campaign.stage) || d.campaign.stage < 0 || d.campaign.stage > 4 || !Array.isArray(d.campaign.claimed) || !Array.isArray(d.campaign.completed))) return null;
    if (d.experience && (!Number.isFinite(d.experience.xp) || d.experience.xp < 0 || !Array.isArray(d.experience.earned) || !Array.isArray(d.experience.archives))) return null;
    const base = createStartingWorld(d.region);
    const n = base.terrain.length;
    if (d.world.terrain.length !== n || d.world.tree.length !== n || d.world.cond.length !== n || d.world.parcels.length !== base.parcels.length) return null;
    const world: World = { ...base, terrain: new Uint8Array(n), tree: new Uint8Array(n), cond: new Float32Array(n), holes: d.world.holes, zone: new Uint8Array(n), parcels: Uint8Array.from(d.world.parcels) };
    for (let i = 0; i < n; i++) {
      world.terrain[i] = d.world.terrain.charCodeAt(i) - 48;
      world.tree[i] = d.world.tree.charCodeAt(i) - 48;
      world.cond[i] = d.world.cond[i];
    }
    if (!Array.isArray(world.holes) || world.holes.length < 1) return null;
    const seen = new Set<number>();
    for (const h of world.holes) {
      if (!Number.isInteger(h.id) || h.id < 1 || h.id > 255 || seen.has(h.id) || typeof h.name !== 'string' || ![3, 4, 5].includes(h.par)) return null;
      seen.add(h.id);
      for (const p of [h.tee, h.cup, h.bend]) if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x >= base.w || p.y >= base.h) return null;
    }
    computeZones(world);
    world.version = 2;
    const g = new Game(world);
    if (d.experience) g.experience = { ...g.experience, ...d.experience, site: { ...g.experience.site, ...d.experience.site } };
    g.preferences = { ...g.preferences, ...(d.preferences ?? {}) };
    g.pendingRecap = d.pendingRecap ?? null;
    g.campaign = { ...g.campaign, ...(d.campaign ?? {}) };
    g.staff = { ...g.staff, ...(d.staff ?? {}) };
    g.members = Array.isArray(d.members) ? d.members : [];
    g.ownerRecords = Array.isArray(d.ownerRecords) ? d.ownerRecords : [];
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
    g.activeEvent = d.activeEvent ?? null;
    if (d.sim) {
      g.sim.golfers = d.sim.golfers.map((x: { said: string[] }) => ({ ...x, said: new Set(x.said) }));
      g.sim.queues = new Map(d.sim.queues);
      g.sim.tee = new Map(d.sim.tee);
      g.sim.nextId = d.sim.nextId;
    }
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
    g.sim.now = d.sim?.now ?? g.total;
    g.applyRegion();
    return { game: g, savedAt: d.savedAt ?? Date.now() };
  } catch {
    return null;
  }
}

function keepBackup() {
  const previous = localStorage.getItem(KEY);
  if (previous && deserialize(previous)) {
    try { localStorage.setItem(BACKUP_KEY, previous); } catch { /* Backup space must not prevent a primary save. */ }
  }
}
export function saveGame(g: Game): boolean {
  try {
    const next = serialize(g);
    keepBackup();
    localStorage.setItem(KEY, next);
    return true;
  } catch { return false; }
}
export function loadGame(): LoadedSave | null {
  try {
    const current = localStorage.getItem(KEY);
    const loaded = current ? deserialize(current) : null;
    if (loaded) return loaded;
    const backup = localStorage.getItem(BACKUP_KEY);
    const recovered = backup ? deserialize(backup) : null;
    return recovered ? { ...recovered, recovered: true } : null;
  } catch { return null; }
}
export function clearSave() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(BACKUP_KEY); } catch { /* No storage available. */ }
}
/** Reject malformed imports before touching either copy of the current game. */
export function importSave(text: string): boolean {
  if (!deserialize(text)) return false;
  try { keepBackup(); localStorage.setItem(KEY, text); return true; } catch { return false; }
}
