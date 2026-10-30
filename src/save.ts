import { Game } from './game';
import { World, computeZones, createStartingWorld } from './terrain';
import { Rng } from './rng';
import { noUpgrades } from './economy';

const KEY = 'second-chance-golf.save.v1';
const VERSION = 1;

export function serialize(g: Game): string {
  const w = g.world;
  return JSON.stringify({
    v: VERSION,
    world: {
      terrain: Array.from(w.terrain).join(''),
      tree: Array.from(w.tree).join(''),
      cond: Array.from(w.cond, (c) => Math.round(c * 10) / 10),
      holes: w.holes,
    },
    cash: g.cash,
    cartFee: g.cartFee,
    day: g.day,
    clock: g.clock,
    total: g.total,
    fee: g.fee,
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

export function deserialize(text: string): Game | null {
  try {
    const d = JSON.parse(text);
    if (d.v !== VERSION) return null;
    const base = createStartingWorld();
    const n = base.terrain.length;
    if (d.world.terrain.length !== n || d.world.cond.length !== n) return null;
    const world: World = { ...base, terrain: new Uint8Array(n), tree: new Uint8Array(n), cond: new Float32Array(n), holes: d.world.holes, zone: new Uint8Array(n) };
    for (let i = 0; i < n; i++) {
      world.terrain[i] = d.world.terrain.charCodeAt(i) - 48;
      world.tree[i] = d.world.tree.charCodeAt(i) - 48;
      world.cond[i] = d.world.cond[i];
    }
    if (!Array.isArray(world.holes) || world.holes.length !== 3) return null;
    computeZones(world);
    world.version = 2;
    const g = new Game(world);
    g.rng = new Rng(d.rng);
    g.sim.rng = g.rng;
    g.cash = d.cash;
    g.day = d.day;
    g.clock = d.clock;
    g.total = d.total;
    g.fee = d.fee;
    g.upgrades = { ...noUpgrades(), ...d.upgrades };
    g.cartFee = d.cartFee ?? g.cartFee;
    g.goals = d.goals;
    g.today = d.today;
    g.days = d.days;
    g.log = d.log;
    g.recent = d.recent;
    g.lastHour = d.lastHour;
    g.settings = { ...g.settings, ...d.settings };
    g.selectedHole = d.selectedHole ?? 1;
    g.sim.crewWear = g.upgrades.crew ? 0.5 : 1;
    g.sim.now = g.total;
    return g;
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
export function loadGame(): Game | null {
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
