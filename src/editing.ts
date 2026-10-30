import { CFG } from './config';
import { Hole, Pt, T, World, cloneHole, computeZones, holeStraightTiles, idx, inBounds, parFor } from './terrain';

export type ToolId = 'inspect' | 'pan' | 'fairway' | 'rough' | 'bunker' | 'water' | 'treeAdd' | 'treeDel' | 'repair' | 'tee' | 'cup';

export interface TileState {
  t: number;
  c: number;
  tr: number;
}
export interface TileEdit {
  i: number;
  before: TileState;
  after: TileState;
  cost: number;
}
export interface EditPlan {
  tool: ToolId;
  label: string;
  tiles: TileEdit[];
  cost: number;
  hole?: { id: number; before: Hole; after: Hole };
}

export const PAINT_TOOLS: ToolId[] = ['fairway', 'rough', 'bunker', 'water', 'treeAdd', 'treeDel', 'repair'];
export const BRUSH_RADII = [0.5, 1.1, 2.1];

export const TOOL_INFO: Record<ToolId, { label: string; hint: string }> = {
  inspect: { label: 'Inspect', hint: 'Tap a hole, a golfer or a tile to see details.' },
  pan: { label: 'Pan', hint: 'Drag to move the map. Scroll or pinch to zoom.' },
  fairway: { label: 'Fairway', hint: 'Paint mown fairway. Replaces rough, sand and water.' },
  rough: { label: 'Rough', hint: 'Paint rough over fairway, sand or water.' },
  bunker: { label: 'Bunker', hint: 'Dig sand traps on rough or fairway.' },
  water: { label: 'Water', hint: 'Flood rough, fairway or sand. Golfers take a penalty.' },
  treeAdd: { label: 'Plant tree', hint: 'Plant trees on rough ground.' },
  treeDel: { label: 'Clear tree', hint: 'Remove trees and stumps.' },
  repair: { label: 'Repair turf', hint: 'Reseed worn or overgrown ground. Greens cost double.' },
  tee: { label: 'Move tee', hint: 'Build the selected hole a new tee box.' },
  cup: { label: 'Move cup', hint: 'Cut a new green and cup for the selected hole.' },
};

export function brushTiles(world: World, tx: number, ty: number, size: number): number[] {
  const r = BRUSH_RADII[size] ?? 0.5;
  const out: number[] = [];
  const n = Math.ceil(r);
  for (let dy = -n; dy <= n; dy++)
    for (let dx = -n; dx <= n; dx++) if (Math.hypot(dx, dy) <= r && inBounds(world, tx + dx, ty + dy)) out.push(idx(world, tx + dx, ty + dy));
  return out;
}

const state = (world: World, i: number): TileState => ({ t: world.terrain[i], c: world.cond[i], tr: world.tree[i] });

/** Why a tile cannot take this tool, or null if it can (or is simply already as requested). */
export function blockReason(world: World, tool: ToolId, i: number): string | null {
  const t = world.terrain[i];
  if (t === T.BUILDING || t === T.PATH) return 'Buildings and cart paths cannot be edited.';
  if (tool === 'repair') return null;
  if (t === T.GREEN || t === T.TEE) {
    if (tool === 'treeDel') return null;
    return 'Greens and tees are changed with the Move cup / Move tee tools.';
  }
  return null;
}

export function planTile(world: World, tool: ToolId, i: number): TileEdit | null {
  if (blockReason(world, tool, i)) return null;
  const b = state(world, i);
  const a: TileState = { ...b };
  let cost = 0;
  const C = CFG.costs;
  const stripTree = () => {
    if (a.tr) {
      a.tr = 0;
      cost += C.treeRemove;
    }
  };
  switch (tool) {
    case 'fairway':
      if (b.t === T.FAIRWAY) return null;
      cost += b.t === T.ROUGH ? C.fairway : C.fairwayFromHazard;
      stripTree();
      a.t = T.FAIRWAY;
      a.c = CFG.turf.freshFairway;
      break;
    case 'rough':
      if (b.t === T.ROUGH) return null;
      cost += C.rough;
      a.t = T.ROUGH;
      a.c = CFG.turf.freshRough;
      break;
    case 'bunker':
      if (b.t === T.BUNKER) return null;
      cost += C.bunker;
      stripTree();
      a.t = T.BUNKER;
      a.c = 100;
      break;
    case 'water':
      if (b.t === T.WATER) return null;
      cost += C.water;
      stripTree();
      a.t = T.WATER;
      a.c = 100;
      break;
    case 'treeAdd':
      if (b.t !== T.ROUGH || b.tr) return null;
      cost += C.treePlant;
      a.tr = 1;
      break;
    case 'treeDel':
      if (!b.tr) return null;
      cost += C.treeRemove;
      a.tr = 0;
      break;
    case 'repair': {
      const rough = b.t === T.ROUGH;
      if (b.t === T.BUNKER || b.t === T.WATER) return null;
      const target = rough ? CFG.turf.repairRoughTo : CFG.turf.repairTo;
      if (b.c >= (rough ? CFG.turf.repairRoughThreshold : CFG.turf.repairThreshold)) return null;
      cost += (C.repairBase + C.repairPerPoint * (target - b.c)) * (b.t === T.GREEN ? C.repairGreenMult : 1);
      a.c = target;
      break;
    }
    default:
      return null;
  }
  return { i, before: b, after: a, cost };
}

export function planPaint(world: World, tool: ToolId, tiles: Iterable<number>): EditPlan {
  const out: TileEdit[] = [];
  for (const i of tiles) {
    const e = planTile(world, tool, i);
    if (e) out.push(e);
  }
  return { tool, label: TOOL_INFO[tool].label, tiles: out, cost: Math.max(0, Math.ceil(out.reduce((s, e) => s + e.cost, 0) - 1e-9)) };
}

function plan3x3(world: World, c: Pt, pred: (i: number) => boolean) {
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = c.x + dx;
      const y = c.y + dy;
      if (!inBounds(world, x, y)) return null;
      const i = idx(world, x, y);
      if (!pred(i)) return null;
      out.push(i);
    }
  return out;
}

function otherHoleMarker(world: World, h: Hole, x: number, y: number): boolean {
  return world.holes.some((o) => o.id !== h.id && (Math.abs(o.tee.x - x) <= 3 && Math.abs(o.tee.y - y) <= 3 || Math.abs(o.cup.x - x) <= 3 && Math.abs(o.cup.y - y) <= 3));
}

export function planMoveTee(world: World, hole: Hole, x: number, y: number): EditPlan | string {
  if (x === hole.tee.x && y === hole.tee.y && world.terrain[idx(world, x, y)] === T.TEE) return 'The tee is already here.';
  const newBox = plan3x3(world, { x, y }, (i) => !([T.WATER, T.BUILDING, T.PATH, T.GREEN] as number[]).includes(world.terrain[i]));
  if (!newBox) return 'A tee box needs a clear 3x3 patch of land. Water, paths, greens and the map edge are in the way.';
  if (Math.hypot(hole.cup.x - x, hole.cup.y - y) < 8) return 'That is too close to the cup. A hole needs at least 80 yards.';
  if (otherHoleMarker(world, hole, x, y)) return 'Too close to another hole\'s tee or green.';
  const tiles = new Map<number, TileEdit>();
  const cost0 = 0;
  for (const i of newBox) tiles.set(i, { i, before: state(world, i), after: { t: T.TEE, c: CFG.turf.freshTee, tr: 0 }, cost: cost0 });
  // old box reverts to rough
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const ox = hole.tee.x + dx;
      const oy = hole.tee.y + dy;
      if (!inBounds(world, ox, oy)) continue;
      const i = idx(world, ox, oy);
      if (tiles.has(i) || world.terrain[i] !== T.TEE) continue;
      tiles.set(i, { i, before: state(world, i), after: { t: T.ROUGH, c: CFG.turf.freshRough, tr: 0 }, cost: 0 });
    }
  const list = [...tiles.values()].filter((e) => e.before.t !== e.after.t || Math.abs(e.before.c - e.after.c) > 0.01 || e.before.tr !== e.after.tr);
  const cost = Math.ceil(CFG.costs.moveTeeBase + CFG.costs.moveTeePerTile * list.length);
  const after = cloneHole(hole);
  const mid0 = { x: (hole.tee.x + hole.cup.x) / 2, y: (hole.tee.y + hole.cup.y) / 2 };
  const mid1 = { x: (x + hole.cup.x) / 2, y: (y + hole.cup.y) / 2 };
  after.tee = { x, y };
  after.bend = { x: Math.round(hole.bend.x - mid0.x + mid1.x), y: Math.round(hole.bend.y - mid0.y + mid1.y) };
  after.bend.x = Math.max(1, Math.min(world.w - 2, after.bend.x));
  after.bend.y = Math.max(1, Math.min(world.h - 2, after.bend.y));
  after.par = parFor(holeStraightTiles(after));
  return { tool: 'tee', label: `Move tee, hole ${hole.id}`, tiles: list, cost, hole: { id: hole.id, before: cloneHole(hole), after } };
}

export function planMoveCup(world: World, hole: Hole, x: number, y: number): EditPlan | string {
  if (x === hole.cup.x && y === hole.cup.y) return 'The cup is already here.';
  if (x < 2 || y < 2 || x > world.w - 3 || y > world.h - 3) return 'Too close to the edge of the property.';
  const ct = world.terrain[idx(world, x, y)];
  if (([T.WATER, T.BUILDING, T.PATH, T.TEE] as number[]).includes(ct)) return 'The cup needs solid ground that is not a tee, path or water.';
  if (Math.hypot(hole.tee.x - x, hole.tee.y - y) < 8) return 'That is too close to the tee. A hole needs at least 80 yards.';
  if (otherHoleMarker(world, hole, x, y)) return 'Too close to another hole\'s tee or green.';
  const R = 2.4;
  const newGreen = new Set<number>();
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const gx = x + dx;
      const gy = y + dy;
      if (!inBounds(world, gx, gy) || Math.hypot(dx, dy) > R) continue;
      const i = idx(world, gx, gy);
      const t = world.terrain[i];
      if (t === T.WATER || t === T.BUILDING || t === T.PATH || t === T.TEE) continue;
      newGreen.add(i);
    }
  const tiles: TileEdit[] = [];
  let changed = 0;
  for (const i of newGreen) {
    if (world.terrain[i] === T.GREEN) continue;
    tiles.push({ i, before: state(world, i), after: { t: T.GREEN, c: CFG.turf.freshGreen, tr: 0 }, cost: 0 });
    changed++;
  }
  for (let dy = -5; dy <= 5; dy++)
    for (let dx = -5; dx <= 5; dx++) {
      const ox = hole.cup.x + dx;
      const oy = hole.cup.y + dy;
      if (!inBounds(world, ox, oy)) continue;
      const i = idx(world, ox, oy);
      if (world.terrain[i] !== T.GREEN || newGreen.has(i) || Math.hypot(dx, dy) > 4.2) continue;
      tiles.push({ i, before: state(world, i), after: { t: T.FAIRWAY, c: world.cond[i], tr: 0 }, cost: 0 });
      changed++;
    }
  const cost = changed ? Math.ceil(CFG.costs.moveCupBase + CFG.costs.moveCupPerTile * changed) : CFG.costs.moveCupSameGreen;
  const after = cloneHole(hole);
  const mid0 = { x: (hole.tee.x + hole.cup.x) / 2, y: (hole.tee.y + hole.cup.y) / 2 };
  const mid1 = { x: (hole.tee.x + x) / 2, y: (hole.tee.y + y) / 2 };
  after.cup = { x, y };
  after.bend = { x: Math.max(1, Math.min(world.w - 2, Math.round(hole.bend.x - mid0.x + mid1.x))), y: Math.max(1, Math.min(world.h - 2, Math.round(hole.bend.y - mid0.y + mid1.y))) };
  after.par = parFor(holeStraightTiles(after));
  return { tool: 'cup', label: `Move cup, hole ${hole.id}`, tiles, cost, hole: { id: hole.id, before: cloneHole(hole), after } };
}

export function applyPlan(world: World, plan: EditPlan, dir: 'do' | 'undo') {
  for (const e of plan.tiles) {
    const s = dir === 'do' ? e.after : e.before;
    world.terrain[e.i] = s.t;
    world.cond[e.i] = s.c;
    world.tree[e.i] = s.tr;
    world.dirty.add(e.i);
  }
  if (plan.hole) {
    const target = world.holes.find((h) => h.id === plan.hole!.id)!;
    const src = dir === 'do' ? plan.hole.after : plan.hole.before;
    target.tee = { ...src.tee };
    target.cup = { ...src.cup };
    target.bend = { ...src.bend };
    target.par = src.par;
    computeZones(world);
    // zones changed everywhere: let the renderer redraw hole overlays only; tiles unaffected
  }
  world.version++;
}

/** Holes whose ground (or markers) this plan touches, judged on the world as it is now. */
export function touchedHoles(world: World, plan: EditPlan): number[] {
  const ids = new Set<number>();
  for (const e of plan.tiles) if (world.zone[e.i]) ids.add(world.zone[e.i]);
  if (plan.hole) ids.add(plan.hole.id);
  return [...ids];
}
