import { CFG, GolferType } from './config';
import { Hole, Pt, T, World, center, idx, inBounds, isOwned, routeField, terrainAt, treeAt } from './terrain';
import { Rng } from './rng';

/** Regional conditions: wind widens dispersion, thin air adds distance. */
export const PHYS = { wind: 1, dist: 1 };
export function setPhysics(wind: number, dist: number) {
  PHYS.wind = wind;
  PHYS.dist = dist;
}

export type LieKind = 'tee' | 'fairway' | 'rough' | 'bunker' | 'green';
export interface Lie {
  kind: LieKind;
  distF: number;
  dispF: number;
  cond: number;
}

export function lieAt(world: World, x: number, y: number): Lie {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (!inBounds(world, tx, ty)) return { kind: 'rough', distF: 0.7, dispF: 1.5, cond: 50 };
  const i = idx(world, tx, ty);
  const cond = world.cond[i];
  const wear = 1 - cond / 100;
  const condDist = 1 - 0.18 * wear;
  const condDisp = 1 + 0.45 * wear;
  switch (world.terrain[i]) {
    case T.TEE: return { kind: 'tee', distF: 1.04 * condDist, dispF: 0.95 * condDisp, cond };
    case T.FAIRWAY: return { kind: 'fairway', distF: condDist, dispF: condDisp, cond };
    case T.GREEN: return { kind: 'green', distF: condDist, dispF: condDisp, cond };
    case T.BUNKER: return { kind: 'bunker', distF: 0.55, dispF: 1.8, cond: 100 };
    case T.PATH: return { kind: 'fairway', distF: 0.95, dispF: 1.1, cond: 80 };
    default: return { kind: 'rough', distF: 0.78 * condDist, dispF: 1.4 * condDisp, cond };
  }
}

export function isValidLie(world: World, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (!inBounds(world, tx, ty) || !isOwned(world, tx, ty)) return false;
  const i = idx(world, tx, ty);
  const t = world.terrain[i];
  return t !== T.WATER && t !== T.BUILDING && world.tree[i] === 0;
}

/** Nearest legal spot to (x,y): used for drops and for repairing a ball whose tile was edited. */
export function nearestValid(world: World, x: number, y: number, maxR = 12): Pt {
  if (isValidLie(world, x, y)) return { x, y };
  for (let r = 1; r <= maxR; r++) {
    let best: Pt | null = null;
    let bd = Infinity;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = Math.floor(x) + dx + 0.5;
        const py = Math.floor(y) + dy + 0.5;
        if (!isValidLie(world, px, py)) continue;
        const d = Math.hypot(px - x, py - y);
        if (d < bd) {
          bd = d;
          best = { x: px, y: py };
        }
      }
    if (best) return best;
  }
  return { x: Math.min(world.w - 1, Math.max(0, x)) + 0, y: Math.min(world.h - 1, Math.max(0, y)) + 0 };
}

export type ShotKind = 'ok' | 'water' | 'oob' | 'tree' | 'treeLand';
export interface ShotResult {
  air: Pt; // where the ball touches down (or is stopped)
  end: Pt; // where it comes to rest (after roll / drop)
  kind: ShotKind;
  penalty: number;
}

const ROLL: Record<number, number> = { [T.FAIRWAY]: 1.4, [T.GREEN]: 1.0, [T.TEE]: 1.2, [T.PATH]: 2.0, [T.ROUGH]: 0.3, [T.BUNKER]: 0 };

/** Deterministic outcome of a ball hit from `from` along `angle` for `dist` tiles. */
export function resolveShot(world: World, from: Pt, angle: number, dist: number): ShotResult {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Trees block the low part of the flight: any tree within the first few tiles in front of the ball.
  if (dist > 1.2) {
    const lowLen = Math.min(3, dist * 0.3);
    for (let s = 0.8; s <= lowLen; s += 0.3) {
      const px = from.x + dx * s;
      const py = from.y + dy * s;
      if (treeAt(world, px, py)) {
        const stop = nearestValid(world, from.x + dx * (s - 0.4), from.y + dy * (s - 0.4));
        return { air: stop, end: stop, kind: 'tree', penalty: 0 };
      }
    }
  }
  const L = { x: from.x + dx * dist, y: from.y + dy * dist };
  const tt = terrainAt(world, L.x, L.y);
  if (tt === -1 || tt === T.BUILDING) return { air: L, end: { ...from }, kind: 'oob', penalty: 1 };
  if (tt === T.WATER) {
    for (let s = dist; s >= 0; s -= 0.25) {
      const px = from.x + dx * s;
      const py = from.y + dy * s;
      if (isValidLie(world, px, py)) return { air: L, end: { x: px, y: py }, kind: 'water', penalty: 1 };
    }
    return { air: L, end: { ...from }, kind: 'water', penalty: 1 };
  }
  if (treeAt(world, L.x, L.y)) return { air: L, end: nearestValid(world, L.x, L.y), kind: 'treeLand', penalty: 0 };
  const rollMax = (ROLL[tt] ?? 0) * Math.min(1, dist / 10);
  let rx = L.x;
  let ry = L.y;
  for (let s = 0.2; s <= rollMax; s += 0.2) {
    const px = L.x + dx * s;
    const py = L.y + dy * s;
    const t2 = terrainAt(world, px, py);
    if (t2 === -1 || t2 === T.WATER || t2 === T.BUILDING || treeAt(world, px, py)) break;
    rx = px;
    ry = py;
  }
  return { air: L, end: { x: rx, y: ry }, kind: 'ok', penalty: 0 };
}

export interface ShotPlan {
  angle: number;
  dist: number;
  aim: Pt;
  directCarryTooLong: boolean;
}

function valueOf(world: World, field: Float64Array, r: ShotResult): number {
  const tx = Math.floor(r.end.x);
  const ty = Math.floor(r.end.y);
  let v = inBounds(world, tx, ty) ? field[ty * world.w + tx] : 200;
  if (v > 200) v = 200;
  if (r.kind === 'water') v += 12;
  else if (r.kind === 'oob') v += 22;
  else if (r.kind === 'tree') v += 3;
  const t = terrainAt(world, r.end.x, r.end.y);
  if (t === T.BUNKER) v += 3.5;
  else if (t === T.ROUGH) v += 0.6 + (world.cond[ty * world.w + tx] < 40 ? 0.8 : 0);
  return v;
}

export function reachFor(type: GolferType, lie: Lie): number {
  return CFG.golfers.types[type].reach * lie.distF * PHYS.dist;
}

/** Choose where to aim: scores candidate lines by the expected route distance left, including hazards. */
export function planShot(world: World, hole: Hole, type: GolferType, from: Pt): ShotPlan {
  const gt = CFG.golfers.types[type];
  const lie = lieAt(world, from.x, from.y);
  const R = reachFor(type, lie);
  const cup = center(hole.cup);
  const field = routeField(world, hole);
  const toCup = Math.hypot(cup.x - from.x, cup.y - from.y);
  const base = Math.atan2(cup.y - from.y, cup.x - from.x);
  let best: { angle: number; dist: number; v: number } | null = null;
  const consider = (angle: number, d: number) => {
    const sa = gt.angSigma * lie.dispF * PHYS.wind;
    const sd = gt.distSigma * lie.dispF * PHYS.wind;
    const lat = Math.max(0.15, d * Math.tan(sa));
    const lon = Math.max(0.15, d * sd);
    const perp = angle + Math.PI / 2;
    const cx = from.x + Math.cos(angle) * d;
    const cy = from.y + Math.sin(angle) * d;
    const sample = (ox: number, oy: number) => {
      const px = cx + ox;
      const py = cy + oy;
      const a = Math.atan2(py - from.y, px - from.x);
      const dd = Math.hypot(px - from.x, py - from.y);
      return valueOf(world, field, resolveShot(world, from, a, dd));
    };
    const ca = Math.cos(angle) * lon;
    const sa2 = Math.sin(angle) * lon;
    const pc = Math.cos(perp) * lat;
    const ps = Math.sin(perp) * lat;
    const v = (2 * sample(0, 0) + sample(pc, ps) + sample(-pc, -ps) + sample(ca, sa2) + sample(-ca, -sa2)) / 6;
    if (!best || v < best.v - 1e-6) best = { angle, dist: d, v };
  };
  if (toCup <= R) consider(base, toCup);
  for (let k = 0; k < 24; k++) {
    const a = base + (k * Math.PI) / 12;
    for (const f of [1, 0.85, 0.7, 0.55, 0.4, 0.25]) consider(a, R * f);
  }
  const b = best!;
  // Would the straight line to the cup need a carry over water that this golfer cannot make?
  let directCarryTooLong = false;
  const dx = Math.cos(base);
  const dy = Math.sin(base);
  let entered = -1;
  let exited = -1;
  for (let s = 0.5; s <= toCup + 0.5; s += 0.5) {
    const t = terrainAt(world, from.x + dx * s, from.y + dy * s);
    if (t === T.WATER && entered < 0) entered = s;
    if (t !== T.WATER && entered >= 0 && exited < 0) exited = s;
  }
  if (entered >= 0 && exited >= 0 && exited > R * 0.95 && toCup > R * 0.9) {
    const chosenCarries = Math.abs(Math.cos(b.angle - base)) > 0.97 && b.dist > exited;
    directCarryTooLong = !chosenCarries;
  }
  return { angle: b.angle, dist: b.dist, aim: { x: from.x + Math.cos(b.angle) * b.dist, y: from.y + Math.sin(b.angle) * b.dist }, directCarryTooLong };
}

export interface ExecutedShot extends ShotResult {
  angle: number;
  dist: number;
  mishit: boolean;
}

/** Apply golfer error and lie to a plan and resolve what the ball actually does. */
export function executeShot(world: World, rng: Rng, type: GolferType, from: Pt, plan: ShotPlan): ExecutedShot {
  const gt = CFG.golfers.types[type];
  const lie = lieAt(world, from.x, from.y);
  const mishitMult = lie.kind === 'bunker' ? 3 : lie.kind === 'rough' ? 1.8 : lie.kind === 'tee' ? 0.6 : 1;
  const mishit = rng.next() < gt.mishit * mishitMult;
  let angErr = rng.normal() * gt.angSigma * lie.dispF * PHYS.wind;
  let distMul = 1 + rng.normal() * gt.distSigma * lie.dispF * PHYS.wind;
  if (mishit) {
    angErr *= 2.8;
    distMul = rng.range(0.4, 0.75);
  }
  distMul = Math.max(0.35, Math.min(1.25, distMul));
  const lateral = rng.normal() * 0.1;
  const angle = plan.angle + angErr + lateral / Math.max(1, plan.dist);
  const dist = Math.max(0.3, plan.dist * distMul);
  return { ...resolveShot(world, from, angle, dist), angle, dist, mishit };
}

// ---- Putting ----
export function puttProbability(feet: number, type: GolferType, greenCond: number): number {
  const half = CFG.golfers.types[type].puttHalf * (0.6 + 0.4 * (greenCond / 100));
  let p = 1 / (1 + Math.pow(feet / half, 1.6));
  if (feet <= 1.6) p = Math.max(p, 0.97 * (0.85 + 0.15 * (greenCond / 100)));
  if (feet > 40) p *= 0.3;
  return Math.min(0.99, p);
}
/** Distance in feet left after a missed putt. */
export function puttLeave(rng: Rng, feet: number): number {
  const hi = Math.max(2.5, Math.min(feet * 0.3, 16));
  return rng.range(1.2, hi);
}
