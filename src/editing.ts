import { CFG } from './config';
import { center, COMFORT_CARRY, Hole, MAX_BENDS, MAX_CARRY, MIN_HOLE_TILES, findPath, holeBends, lengthAdvice, pathTiles, routesCross, setRoute, Pt, T, World, cloneHole, computeZones, holePathTiles, holePath, idx, inBounds, isOwned, newStats, parFor, polyDist } from './terrain';

export type ToolId = 'green' | 'path' | 'bend' | 'inspect' | 'pan' | 'fairway' | 'rough' | 'bunker' | 'water' | 'treeAdd' | 'treeDel' | 'repair' | 'tee' | 'cup' | 'build' | 'land';

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
  newHole?: Hole;
  removedHole?: Hole;
  /** Plain-language cautions shown with the price: questionable length, crossing routes, long carries. They never block a build. */
  notes?: string[];
}

/** Regional building cost multiplier, set by the game. */
let COST_MULT = 1;
export const setCostMultiplier = (m: number) => {
  COST_MULT = m;
};

export const PAINT_TOOLS: ToolId[] = ['green', 'path', 'fairway', 'rough', 'bunker', 'water', 'treeAdd', 'treeDel', 'repair'];
export const BRUSH_RADII = [0.5, 1.1, 2.1];

export const TOOL_INFO: Record<ToolId, { label: string; hint: string }> = {
  green: { label: 'Green', hint: 'Expand or reshape a putting surface. Costs $24 per tile. Cannot overwrite tees or paths.' },
  path: { label: 'Cart path', hint: 'Lay a cart path for $8 per tile. Paint it across water to build a bridge. Golfers walk faster on paths. Paint rough over a path to remove it.' },
  bend: { label: 'Dogleg', hint: 'Tap a routing point for this hole. Costs $40. Paint fairway along the new route, then reopen.' },
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
  build: { label: 'Build hole', hint: 'Tap a tee spot, then a green spot. A fairway corridor is laid between them.' },
  land: { label: 'Land', hint: 'Tap a locked parcel to see its price and buy it.' },
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
export function blockReason(world: World, tool: ToolId, i: number, cur?: TileState): string | null {
  if (!isOwned(world, i % world.w, Math.floor(i / world.w))) return 'You do not own this land.';
  const t = cur ? cur.t : world.terrain[i];
  if (t === T.BUILDING) return 'The clubhouse cannot be edited.';
  if (t === T.BRIDGE && tool !== 'water' && tool !== 'path') return 'This is a bridge. Paint water over it to take it away.';
  if (tool === 'repair') return null;
  if (t === T.GREEN || t === T.TEE) {
    if (tool === 'treeDel' || tool === 'treeAdd') return null;
    if (world.holes.some((h) => idx(world, h.cup.x, h.cup.y) === i)) return 'The cup is here. Use Move cup to relocate this green.';
    if (world.holes.some((h) => idx(world, h.tee.x, h.tee.y) === i)) return 'This is the middle of a tee box. Use Move tee to relocate it.';
    if (tool === 'fairway' || tool === 'rough') return null; // trims the edge of a green or tee
    if (tool === 'green') return t === T.GREEN ? null : 'Tee boxes are changed with the Move tee tool.';
    return 'Greens and tees only take fairway or rough (to trim them) or the Green tool (to grow a green).';
  }
  return null;
}

/** Plan one tile. `cur` lets staged, not-yet-built edits stack: the tile is judged as it would be after them. */
export function planTile(world: World, tool: ToolId, i: number, cur?: TileState): TileEdit | null {
  if (blockReason(world, tool, i, cur)) return null;
  const b = cur ? { ...cur } : state(world, i);
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
    case 'green':
      if (b.t === T.GREEN) return null;
      cost += 24; stripTree(); a.t = T.GREEN; a.c = CFG.turf.freshGreen; break;
    case 'path':
      if (b.t === T.PATH || b.t === T.BRIDGE) return null;
      // painting a path over water lays a bridge
      cost += b.t === T.WATER ? C.bridge : 8; stripTree(); a.t = b.t === T.WATER ? T.BRIDGE : T.PATH; a.c = 100; break;
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
      if (b.t === T.BUNKER || b.t === T.WATER || b.t === T.PATH || b.t === T.BRIDGE) return null;
      const target = rough ? CFG.turf.repairRoughTo : CFG.turf.repairTo;
      if (b.c >= (rough ? CFG.turf.repairRoughThreshold : CFG.turf.repairThreshold)) return null;
      cost += (C.repairBase + C.repairPerPoint * (target - b.c)) * (b.t === T.GREEN ? C.repairGreenMult : 1);
      a.c = target;
      break;
    }
    default:
      return null;
  }
  return { i, before: b, after: a, cost: cost * COST_MULT };
}

export function planPaint(world: World, tool: ToolId, tiles: Iterable<number>): EditPlan {
  const out: TileEdit[] = [];
  for (const i of tiles) {
    const e = planTile(world, tool, i);
    if (e) out.push(e);
  }
  return { tool, label: TOOL_INFO[tool].label, tiles: out, cost: Math.max(0, Math.ceil(out.reduce((s, e) => s + e.cost, 0) - 1e-9)) };
}

/** Fold a new edit into the staged edit for the same tile. Returns null when the tile ends up as it started. */
export function mergeEdit(prev: TileEdit | undefined, next: TileEdit): TileEdit | null {
  const before = prev ? prev.before : next.before;
  const cost = (prev?.cost ?? 0) + next.cost;
  if (before.t === next.after.t && before.tr === next.after.tr && Math.abs(before.c - next.after.c) < 0.01) return null;
  return { i: next.i, before, after: next.after, cost };
}

/** The tile state a staged edit would leave behind, or the live state if nothing is staged. */
export const stagedState = (world: World, i: number, staged?: Map<number, TileEdit>): TileState => staged?.get(i)?.after ?? state(world, i);

export function planRemoveHole(world: World, id: number): EditPlan | string {
  const h = world.holes.find((x) => x.id === id);
  if (!h) return 'That hole does not exist.';
  if (world.holes.length <= 1) return 'You need at least one hole on the course.';
  return { tool: 'inspect', label: `Remove hole ${id}, ${h.name}`, tiles: [], cost: 0, removedHole: { ...cloneHole(h), open: false } };
}

/** The hole whose tee box or green this spot would run into, if any. Tees take 3x3 tiles, greens a disc of about 2.6. */
function overlapsHole(world: World, skip: number, x: number, y: number, kind: 'tee' | 'green'): Hole | null {
  const mine = kind === 'tee' ? 1.5 : 2.6;
  return world.holes.find((o) => o.id !== skip && (Math.hypot(o.tee.x - x, o.tee.y - y) < mine + 1.5 + 0.5 || Math.hypot(o.cup.x - x, o.cup.y - y) < mine + 2.6 + 0.5)) ?? null;
}
const SOLID_NOT: number[] = [T.WATER, T.BUILDING, T.PATH, T.BRIDGE];
const solidAt = (world: World, x: number, y: number) => inBounds(world, x, y) && !SOLID_NOT.includes(world.terrain[idx(world, x, y)]);

/** Cautions about a route: length for the par, other routes it crosses, water it carries, and whether anyone can walk it. */
function routeNotes(world: World, hole: Hole, route: Pt[]): string[] {
  const notes: string[] = [];
  const yards = Math.round(pathTiles(route) * CFG.grid.yardsPerTile);
  const advice = lengthAdvice(hole.par, yards);
  if (advice) notes.push(advice);
  for (const o of world.holes) if (o.id !== hole.id && routesCross(route, holePath(o))) notes.push(`Crosses hole ${o.id}, ${o.name}.`);
  let run = 0;
  let worst = 0;
  for (let k = 0; k + 1 < route.length; k++) {
    const len = Math.hypot(route[k + 1].x - route[k].x, route[k + 1].y - route[k].y);
    for (let t = 0; t <= len; t += 0.5) {
      const x = Math.floor(route[k].x + ((route[k + 1].x - route[k].x) * t) / (len || 1));
      const y = Math.floor(route[k].y + ((route[k + 1].y - route[k].y) * t) / (len || 1));
      if (inBounds(world, x, y) && world.terrain[idx(world, x, y)] === T.WATER) { run += 0.5; worst = Math.max(worst, run); } else run = 0;
    }
  }
  if (worst > MAX_CARRY) notes.push(`A ${Math.round(worst * CFG.grid.yardsPerTile)} yard water carry is too long for anyone. Add land or turn the route.`);
  else if (worst > COMFORT_CARRY) notes.push(`A ${Math.round(worst * CFG.grid.yardsPerTile)} yard water carry: only strong golfers will clear it.`);
  if (worst > 0 && !findPath(world, route[0], route[route.length - 1])) notes.push('Water cuts the walk to the green. Paint a path across it to add a bridge before opening.');
  return notes;
}

export function planMoveTee(world: World, hole: Hole, x: number, y: number): EditPlan | string {
  if (x === hole.tee.x && y === hole.tee.y && world.terrain[idx(world, x, y)] === T.TEE) return 'The tee is already here.';
  if (x < 2 || y < 2 || x > world.w - 3 || y > world.h - 3) return 'Too close to the edge of the property.';
  if (!isOwned(world, x, y)) return 'You do not own this land.';
  if (!solidAt(world, x, y)) return 'A tee needs solid ground: not water, a path, a bridge or the clubhouse.';
  if (Math.hypot(hole.cup.x - x, hole.cup.y - y) < MIN_HOLE_TILES) return 'That is on top of the green. Pick a spot with some distance to the cup.';
  const hit = overlapsHole(world, hole.id, x, y, 'tee');
  if (hit) return `That runs into hole ${hit.id}'s tee or green.`;
  const tiles = new Map<number, TileEdit>();
  // the box takes whatever solid, unclaimed ground is within one tile; water, paths and other greens stay as they are
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const bx = x + dx, by = y + dy;
      if (!solidAt(world, bx, by)) continue;
      const i = idx(world, bx, by);
      if (world.terrain[i] === T.GREEN || (world.terrain[i] === T.TEE && !(bx === hole.tee.x && by === hole.tee.y) && world.holes.some((o) => o.id !== hole.id && Math.hypot(o.tee.x - bx, o.tee.y - by) <= 1.5))) continue;
      tiles.set(i, { i, before: state(world, i), after: { t: T.TEE, c: CFG.turf.freshTee, tr: 0 }, cost: 0 });
    }
  // the old box reverts to rough
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
  const cost = Math.ceil((CFG.costs.moveTeeBase + CFG.costs.moveTeePerTile * list.length) * COST_MULT);
  // the player's par and turning points stay as they chose them
  const after = cloneHole(hole);
  after.tee = { x, y };
  const route = [center(after.tee), ...holeBends(after).map(center), center(after.cup)];
  return { tool: 'tee', label: `Move tee, hole ${hole.id}`, tiles: list, cost, hole: { id: hole.id, before: cloneHole(hole), after }, notes: routeNotes(world, after, route) };
}

export function planMoveCup(world: World, hole: Hole, x: number, y: number): EditPlan | string {
  if (x === hole.cup.x && y === hole.cup.y) return 'The cup is already here.';
  if (x < 3 || y < 3 || x > world.w - 4 || y > world.h - 4) return 'Too close to the edge of the property.';
  if (!isOwned(world, x, y)) return 'You do not own this land.';
  if (!solidAt(world, x, y) || world.terrain[idx(world, x, y)] === T.TEE) return 'The cup needs solid ground that is not a tee, path, bridge or water. Islands are fine.';
  if (Math.hypot(hole.tee.x - x, hole.tee.y - y) < MIN_HOLE_TILES) return 'That is on top of the tee. Pick a spot with some distance from it.';
  const hit = overlapsHole(world, hole.id, x, y, 'green');
  if (hit) return `That runs into hole ${hit.id}'s tee or green.`;
  const R = 2.4;
  const newGreen = new Set<number>();
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      const gx = x + dx;
      const gy = y + dy;
      if (!inBounds(world, gx, gy) || Math.hypot(dx, dy) > R) continue;
      const i = idx(world, gx, gy);
      const t = world.terrain[i];
      if (t === T.WATER || t === T.BUILDING || t === T.PATH || t === T.BRIDGE || t === T.TEE) continue;
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
  const cost = changed ? Math.ceil((CFG.costs.moveCupBase + CFG.costs.moveCupPerTile * changed) * COST_MULT) : CFG.costs.moveCupSameGreen;
  const after = cloneHole(hole);
  after.cup = { x, y };
  const route = [center(after.tee), ...holeBends(after).map(center), center(after.cup)];
  return { tool: 'cup', label: `Move cup, hole ${hole.id}`, tiles, cost, hole: { id: hole.id, before: cloneHole(hole), after }, notes: routeNotes(world, after, route) };
}

const HOLE_NAMES = ['Birch Bend', 'Heron Pond', 'The Long Acre', 'Lantern Hill', 'Sparrow Drop', 'Kettle Run', 'Windmill', 'The Narrows', 'Copper Ridge', 'Fern Hollow', 'Gull Point', 'Old Quarry', 'Larkspur', 'Thistle Way', 'The Lookout'];
/** Names for the first holes of a blank-canvas course; the classic course already has its own holes 1 to 3. */
const FIRST_NAMES = ['Willow Bend', 'Mossy Hollow', 'Quiet Water'];
export const holeNameFor = (n: number) => (n < 4 ? FIRST_NAMES[n - 1] : HOLE_NAMES[(n - 4) % HOLE_NAMES.length]) ?? `Hole ${n}`;

export interface NewHoleOpts {
  /** The par the player chose. When absent it follows the length. */
  par?: number;
  /** Optional turning points, in playing order. */
  bends?: Pt[];
}

/**
 * Lay out a brand-new hole: a tee box, a fairway corridor along the route and a green. It starts closed.
 * The corridor leaves water, sand, paths, bridges, buildings and other tees and greens exactly as they are.
 */
export function planNewHole(world: World, id: number, tee: Pt, cup: Pt, opts: NewHoleOpts = {}): EditPlan | string {
  if (tee.x < 3 || tee.y < 3 || tee.x > world.w - 4 || tee.y > world.h - 4 || cup.x < 4 || cup.y < 4 || cup.x > world.w - 5 || cup.y > world.h - 5) return 'Too close to the edge of the property.';
  if (!isOwned(world, tee.x, tee.y) || !isOwned(world, cup.x, cup.y)) return 'You do not own that land.';
  if (!solidAt(world, tee.x, tee.y)) return 'A tee needs solid ground: not water, a path, a bridge or the clubhouse.';
  if (!solidAt(world, cup.x, cup.y)) return 'A green needs solid ground. Islands are fine; open water is not.';
  if (Math.hypot(cup.x - tee.x, cup.y - tee.y) < MIN_HOLE_TILES) return 'Tee and green are on top of each other. Put some distance between them.';
  const bends = (opts.bends ?? []).slice(0, MAX_BENDS);
  for (const b of bends) if (!inBounds(world, b.x, b.y) || world.terrain[idx(world, b.x, b.y)] === T.BUILDING) return 'A turning point cannot be on the clubhouse or off the property.';
  const teeHit = overlapsHole(world, 0, tee.x, tee.y, 'tee');
  if (teeHit) return `That tee runs into hole ${teeHit.id}'s tee or green.`;
  const cupHit = overlapsHole(world, 0, cup.x, cup.y, 'green');
  if (cupHit) return `That green runs into hole ${cupHit.id}'s tee or green.`;
  const hole: Hole = { id, name: holeNameFor(id), tee, cup, bend: { x: 0, y: 0 }, open: false, par: 4, fixedGreenAt: -1, reopenedAt: -1, stats: newStats() };
  setRoute(hole, bends);
  hole.par = opts.par && [3, 4, 5].includes(opts.par) ? opts.par : parFor(holePathTiles(hole));
  const path = holePath(hole);
  const tiles = new Map<number, TileEdit>();
  const KEEP: number[] = [T.BUILDING, T.PATH, T.BRIDGE, T.WATER];
  const set = (x: number, y: number, t: number, force: boolean) => {
    if (!inBounds(world, x, y) || !isOwned(world, x, y)) return;
    const i = idx(world, x, y);
    const cur = state(world, i);
    if (KEEP.includes(cur.t)) return;
    // the corridor never overwrites sand or another hole's tee and green; a tee box or green the player asked for does replace sand
    if (!force && (cur.t === T.BUNKER || cur.t === T.GREEN || cur.t === T.TEE)) return;
    if (force && (cur.t === T.GREEN || cur.t === T.TEE) && cur.t !== t) return;
    if (!force && tiles.has(i)) return;
    let cost = 0;
    if (cur.tr) cost += CFG.costs.treeRemove;
    if (t === T.FAIRWAY && cur.t !== T.FAIRWAY) cost += cur.t === T.ROUGH ? CFG.costs.fairway : CFG.costs.fairwayFromHazard;
    else if ((t === T.GREEN || t === T.TEE) && cur.t !== t) cost += CFG.costs.fairway;
    tiles.set(i, { i, before: cur, after: { t, c: t === T.FAIRWAY && cur.t === T.FAIRWAY ? cur.c : t === T.GREEN ? CFG.turf.freshGreen : t === T.TEE ? CFG.turf.freshTee : CFG.turf.freshFairway, tr: 0 }, cost: cost * COST_MULT });
  };
  // only the box around the route needs a look
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of path) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  for (let y = Math.max(0, Math.floor(y0 - 3)); y <= Math.min(world.h - 1, Math.ceil(y1 + 3)); y++)
    for (let x = Math.max(0, Math.floor(x0 - 3)); x <= Math.min(world.w - 1, Math.ceil(x1 + 3)); x++) if (polyDist(x + 0.5, y + 0.5, path).d <= 2.4) set(x, y, T.FAIRWAY, false);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set(tee.x + dx, tee.y + dy, T.TEE, true);
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (Math.hypot(dx, dy) <= 2.6) set(cup.x + dx, cup.y + dy, T.GREEN, true);
  const list = [...tiles.values()].filter((e) => e.before.t !== e.after.t || e.before.tr !== e.after.tr || Math.abs(e.before.c - e.after.c) > 0.01);
  const cost = Math.ceil(CFG.costs.newHole * COST_MULT + list.reduce((sum, e) => sum + e.cost, 0));
  return { tool: 'inspect', label: `Build hole ${id}, ${hole.name}`, tiles: list, cost, newHole: hole, notes: routeNotes(world, hole, path) };
}

export function applyPlan(world: World, plan: EditPlan, dir: 'do' | 'undo') {
  if (plan.removedHole) {
    const id = plan.removedHole.id;
    if (dir === 'do') world.holes = world.holes.filter((h) => h.id !== id);
    else if (!world.holes.some((h) => h.id === id)) world.holes = [...world.holes, cloneHole(plan.removedHole)].sort((a, b) => a.id - b.id);
    computeZones(world);
  }
  if (plan.newHole) {
    const id = plan.newHole.id;
    if (dir === 'do') world.holes.push(JSON.parse(JSON.stringify(plan.newHole)));
    else world.holes = world.holes.filter((h) => h.id !== id);
    computeZones(world);
  }
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
    if (src.bends) target.bends = src.bends.map((p) => ({ ...p }));
    else delete target.bends;
    target.par = src.par;
    computeZones(world);
    // zones changed everywhere: let the renderer redraw hole overlays only; tiles unaffected
  }
  world.version++;
  world.layout = (world.layout ?? 0) + 1;
}

/** Holes whose ground (or markers) this plan touches, judged on the world as it is now. */
export function touchedHoles(world: World, plan: EditPlan): number[] {
  const ids = new Set<number>();
  for (const e of plan.tiles) if (world.zone[e.i]) ids.add(world.zone[e.i]);
  if (plan.hole) ids.add(plan.hole.id);
  if (plan.removedHole) ids.add(plan.removedHole.id);
  return [...ids];
}

/** Where a new turning point goes in a route: between the two neighbours it lengthens the route least. */
export function insertBend(tee: Pt, bends: Pt[], cup: Pt, p: Pt): Pt[] {
  const pts = [tee, ...bends, cup];
  let at = 0;
  let least = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) {
    const extra = Math.hypot(pts[k].x - p.x, pts[k].y - p.y) + Math.hypot(p.x - pts[k + 1].x, p.y - pts[k + 1].y) - Math.hypot(pts[k].x - pts[k + 1].x, pts[k].y - pts[k + 1].y);
    if (extra < least) { least = extra; at = k; }
  }
  const out = bends.map((b) => ({ ...b }));
  out.splice(at, 0, { x: p.x, y: p.y });
  return out;
}

/**
 * Turning points for a hole, one tap at a time: tap beside a turning point to move it, tap right on it to take it
 * away, tap anywhere else to add one (up to three). Nothing is painted; the player shapes the ground with the usual tools.
 */
export function planMoveBend(w: World, h: Hole, x: number, y: number): EditPlan | string {
  if (!isOwned(w, x, y)) return 'Choose a routing point on land you own.';
  if (x < 1 || y < 1 || x > w.w - 2 || y > w.h - 2) return 'Too close to the edge of the property.';
  if (w.terrain[idx(w, x, y)] === T.BUILDING) return 'A dogleg cannot run through the clubhouse.';
  const bends = holeBends(h).map((p) => ({ ...p }));
  const near = bends.map((p, i) => ({ i, d: Math.hypot(p.x - x, p.y - y) })).sort((a, b) => a.d - b.d)[0];
  let label: string;
  let cost = Math.ceil(40 * COST_MULT);
  if (near && near.d < 1.2) {
    bends.splice(near.i, 1);
    label = 'Remove turning point';
    cost = 0;
  } else if (near && (near.d < 4 || bends.length >= MAX_BENDS)) {
    bends[near.i] = { x, y };
    label = 'Move turning point';
  } else {
    bends.splice(0, bends.length, ...insertBend(h.tee, bends, h.cup, { x, y }));
    label = 'Add turning point';
  }
  const after = cloneHole(h);
  setRoute(after, bends);
  const route = [center(after.tee), ...holeBends(after).map(center), center(after.cup)];
  return { tool: 'bend', label, tiles: [], hole: { id: h.id, before: cloneHole(h), after }, cost, notes: routeNotes(w, after, route) };
}

/** Straighten a hole: no turning points at all. */
export function planStraighten(w: World, h: Hole): EditPlan | string {
  if (!holeBends(h).length) return 'This hole is already straight.';
  const after = cloneHole(h);
  setRoute(after, []);
  return { tool: 'bend', label: 'Straighten hole', tiles: [], hole: { id: h.id, before: cloneHole(h), after }, cost: 0, notes: routeNotes(w, after, [center(after.tee), center(after.cup)]) };
}
