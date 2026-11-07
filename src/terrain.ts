import { CFG } from './config';
import { RegionId } from './progression';

export const T = { ROUGH: 0, FAIRWAY: 1, GREEN: 2, TEE: 3, BUNKER: 4, WATER: 5, PATH: 6, BUILDING: 7 } as const;
export type TerrainId = (typeof T)[keyof typeof T];
export const TERRAIN_NAMES = ['Rough', 'Fairway', 'Green', 'Tee box', 'Bunker', 'Water', 'Cart path', 'Clubhouse'];

export interface Pt {
  x: number;
  y: number;
}

export interface Hole {
  id: number;
  name: string;
  tee: Pt; // tile coordinates (integer); play position is +0.5
  cup: Pt;
  bend: Pt; // routing waypoint, drives the hole's zone and par
  open: boolean;
  par: number;
  fixedGreenAt: number; // total sim time a worn green was repaired, -1 if never
  reopenedAt: number;
  stats: HoleStats;
}
export interface HoleStats {
  rounds: number;
  strokes: number;
  par: number;
  water: number;
  picked: number;
  fwy: number; // fairways hit off the tee (par 4/5 only)
  fwyN: number;
  gir: number; // greens in regulation
  girN: number;
}
export const newStats = (): HoleStats => ({ rounds: 0, strokes: 0, par: 0, water: 0, picked: 0, fwy: 0, fwyN: 0, gir: 0, girN: 0 });

export interface World {
  w: number;
  h: number;
  terrain: Uint8Array;
  cond: Float32Array; // turf condition 0..100
  tree: Uint8Array;
  zone: Uint8Array; // owning hole id, 0 = none
  holes: Hole[];
  version: number;
  region: RegionId;
  parcels: Uint8Array; // 1 when the parcel is owned
  dirty: Set<number>; // tile indices changed since the renderer last looked
  /** Top-left tile of the 7x5 clubhouse. null while the player has not chosen a spot yet. */
  clubhouse: Pt | null;
  /** Where arriving golfers appear: the far end of the entrance road. */
  gate: Pt;
  /** Seeds the generated land and its valley shading (see wilderness.ts). */
  landSeed: number;
}

export const CLUB_W = 7;
export const CLUB_H = 5;

/** Where golfers spawn, walk in and queue at the door, worked out from wherever the clubhouse stands. */
export function clubSites(w: Pick<World, 'clubhouse' | 'gate'>): { spawn: Pt; door: Pt; entry: Pt } {
  const c = w.clubhouse ?? { x: w.gate.x, y: w.gate.y };
  return { spawn: w.gate, door: { x: c.x + 3.5, y: c.y - 0.4 }, entry: { x: c.x - 1.4, y: c.y - 0.4 } };
}

export const idx = (w: World, x: number, y: number) => y * w.w + x;
export const inBounds = (w: World, x: number, y: number) => x >= 0 && y >= 0 && x < w.w && y < w.h;
export const center = (p: Pt): Pt => ({ x: p.x + 0.5, y: p.y + 0.5 });

/** Terrain id at a continuous position, or -1 outside the property. */
export function parcelIndex(tx: number, ty: number): number {
  return Math.floor(ty / CFG.land.ph) * CFG.land.cols + Math.floor(tx / CFG.land.pw);
}
export function isOwned(w: World, tx: number, ty: number): boolean {
  return inBounds(w, tx, ty) && w.parcels[parcelIndex(tx, ty)] === 1;
}
export const startsOwned = (col: number, row: number) => col < CFG.land.startCols && row < CFG.land.startRows;

export function terrainAt(w: World, x: number, y: number): number {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (!inBounds(w, tx, ty) || !isOwned(w, tx, ty)) return -1;
  return w.terrain[ty * w.w + tx];
}
export function treeAt(w: World, x: number, y: number): boolean {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  return inBounds(w, tx, ty) && w.tree[ty * w.w + tx] === 1;
}

export function hash2(x: number, y: number, s = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x: number, y: number, s = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, s);
  const b = hash2(x0 + 1, y0, s);
  const c = hash2(x0, y0 + 1, s);
  const d = hash2(x0 + 1, y0 + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

export function segDist(px: number, py: number, a: Pt, b: Pt): { d: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return { d: Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t)), t };
}

/** Distance to a polyline plus the arc-length position of the nearest point. */
export function polyDist(px: number, py: number, pts: Pt[]): { d: number; s: number; total: number } {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    const r = segDist(px, py, pts[i], pts[i + 1]);
    if (r.d < best) {
      best = r.d;
      bestS = acc + len * r.t;
    }
    acc += len;
  }
  return { d: best, s: bestS, total };
}

export const holePath = (h: Hole): Pt[] => [center(h.tee), center(h.bend), center(h.cup)];
/** Playing length in yards along tee, routing point and cup. */
export const holeYards = (h: Hole) => Math.round(holePathTiles(h) * CFG.grid.yardsPerTile);
/** Length in tiles along tee, routing point and cup: what par and the scorecard yardage are based on. */
export const holePathTiles = (h: Hole) => Math.hypot(h.bend.x - h.tee.x, h.bend.y - h.tee.y) + Math.hypot(h.cup.x - h.bend.x, h.cup.y - h.bend.y);
export const holeStraightTiles = (h: Hole) => Math.hypot(h.cup.x - h.tee.x, h.cup.y - h.tee.y);
export function parFor(tiles: number): number {
  const yards = tiles * CFG.grid.yardsPerTile;
  return yards <= CFG.holes.par3Max * 10 ? 3 : yards <= CFG.holes.par4Max * 10 ? 4 : 5;
}

export function computeZones(world: World) {
  const R = CFG.holes.zoneRadius;
  world.zone.fill(0);
  const paths = world.holes.map(holePath);
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      let best = R;
      let id = 0;
      for (let i = 0; i < paths.length; i++) {
        const d = polyDist(x + 0.5, y + 0.5, paths[i]).d;
        if (d <= best) {
          best = d;
          id = world.holes[i].id;
        }
      }
      world.zone[y * world.w + x] = id;
    }
  }
}

export interface HoleCondition {
  fairway: number;
  green: number;
  tee: number;
  overall: number;
  wornShare: number;
}
const condCache = new WeakMap<World, Map<string, { v: number; r: HoleCondition }>>();
export function holeCondition(world: World, h: Hole): HoleCondition {
  let localCache = condCache.get(world);
  if (!localCache) condCache.set(world, localCache = new Map());
  const key = String(h.id);
  const hit = localCache.get(key);
  if (hit && hit.v === world.version) return hit.r;
  const sums = { f: 0, fn: 0, t: 0, tn: 0 };
  let gs = 0;
  let gn = 0;
  let worn = 0;
  let total = 0;
  const cup = center(h.cup);
  for (let i = 0; i < world.terrain.length; i++) {
    const t = world.terrain[i];
    if (t !== T.FAIRWAY && t !== T.GREEN && t !== T.TEE) continue;
    const x = (i % world.w) + 0.5;
    const y = Math.floor(i / world.w) + 0.5;
    if (t === T.GREEN) {
      if (Math.hypot(x - cup.x, y - cup.y) <= 4) {
        gs += world.cond[i];
        gn++;
        total++;
        if (world.cond[i] < CFG.turf.wornBelow) worn++;
      }
      continue;
    }
    if (world.zone[i] !== h.id) continue;
    total++;
    if (world.cond[i] < CFG.turf.wornBelow) worn++;
    if (t === T.FAIRWAY) {
      sums.f += world.cond[i];
      sums.fn++;
    } else {
      sums.t += world.cond[i];
      sums.tn++;
    }
  }
  const fairway = sums.fn ? sums.f / sums.fn : 0;
  const green = gn ? gs / gn : 0;
  const tee = sums.tn ? sums.t / sums.tn : 0;
  const nn = sums.fn + sums.tn + gn;
  const overall = nn ? (sums.f + sums.t + gs) / nn : 0;
  const r = { fairway, green, tee, overall, wornShare: total ? worn / total : 0 };
  localCache.set(key, { v: world.version, r });
  return r;
}

// ---- Route field: weighted distance-to-cup used by golfers to choose safe lines ----
const fieldCache = new WeakMap<World, Map<number, { v: number; cx: number; cy: number; f: Float64Array }>>();
function stepCost(world: World, i: number): number {
  let c: number;
  switch (world.terrain[i]) {
    case T.FAIRWAY: c = 0.92; break;
    case T.GREEN: c = 0.9; break;
    case T.TEE: c = 1; break;
    case T.ROUGH: c = world.cond[i] < 40 ? 1.4 : 1.15; break;
    case T.BUNKER: c = 2.2; break;
    case T.WATER: c = 7; break;
    case T.PATH: c = 1; break;
    default: c = 40;
  }
  return world.tree[i] ? c + 5 : c;
}
export function routeField(world: World, h: Hole): Float64Array {
  let fields = fieldCache.get(world);
  if (!fields) fieldCache.set(world, fields = new Map());
  const hit = fields.get(h.id);
  if (hit && hit.v === world.version && hit.cx === h.cup.x && hit.cy === h.cup.y) return hit.f;
  const n = world.w * world.h;
  const dist = new Float64Array(n).fill(1e9);
  const heapD: number[] = [];
  const heapI: number[] = [];
  const push = (d: number, i: number) => {
    let k = heapD.length;
    heapD.push(d);
    heapI.push(i);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p] <= d) break;
      heapD[k] = heapD[p];
      heapI[k] = heapI[p];
      k = p;
    }
    heapD[k] = d;
    heapI[k] = i;
  };
  const pop = (): [number, number] => {
    const d0 = heapD[0];
    const i0 = heapI[0];
    const d = heapD.pop()!;
    const i = heapI.pop()!;
    const len = heapD.length;
    if (len > 0) {
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= len) break;
        if (c + 1 < len && heapD[c + 1] < heapD[c]) c++;
        if (heapD[c] >= d) break;
        heapD[k] = heapD[c];
        heapI[k] = heapI[c];
        k = c;
      }
      heapD[k] = d;
      heapI[k] = i;
    }
    return [d0, i0];
  };
  const start = h.cup.y * world.w + h.cup.x;
  dist[start] = 0;
  push(0, start);
  while (heapD.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    const x = i % world.w;
    const y = (i - x) / world.w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= world.w || ny >= world.h) continue;
        const j = ny * world.w + nx;
        const nd = d + stepCost(world, j) * (dx && dy ? 1.414 : 1);
        if (nd < dist[j]) {
          dist[j] = nd;
          push(nd, j);
        }
      }
    }
  }
  fields.set(h.id, { v: world.version, cx: h.cup.x, cy: h.cup.y, f: dist });
  return dist;
}

// ---- Validation ----
/** One thing stopping a hole from opening: what is wrong, where it is, and the tool that fixes it. */
export interface Issue {
  text: string;
  at: Pt | null;
  fix: 'tee' | 'cup' | 'fairway' | 'green' | null;
}
export interface Validation {
  ok: boolean;
  problems: string[];
  warnings: string[];
  breakAt: Pt | null;
  issues: Issue[];
}
export function validateHole(world: World, h: Hole): Validation {
  const problems: string[] = [];
  const issues: Issue[] = [];
  const warnings: string[] = [];
  let breakAt: Pt | null = null;
  const problem = (text: string, at: Pt | null, fix: Issue['fix']) => {
    problems.push(text);
    issues.push({ text, at, fix });
  };
  const ti = idx(world, h.tee.x, h.tee.y);
  const ci = idx(world, h.cup.x, h.cup.y);
  if (world.terrain[ti] !== T.TEE) problem('The tee box is damaged. Use Move tee to build it again.', h.tee, 'tee');
  if (world.terrain[ci] !== T.GREEN) problem('The cup is not on a green. Paint green around it, or use Move cup to cut a new green.', h.cup, 'green');
  let greenTiles = 0;
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const x = h.cup.x + dx;
      const y = h.cup.y + dy;
      if (inBounds(world, x, y) && Math.hypot(dx, dy) <= 3.5 && world.terrain[idx(world, x, y)] === T.GREEN) greenTiles++;
    }
  if (world.terrain[ci] === T.GREEN && greenTiles < 8) problem(`The green is too small (${greenTiles} tiles, it needs 8). Paint more green around the cup, or use Move cup.`, h.cup, 'green');
  const len = holeStraightTiles(h);
  if (len < 8) problem('Tee and cup are too close together (minimum 80 yards). Use Move tee or Move cup.', h.cup, 'cup');
  if (!problems.length) {
    const ok = (x: number, y: number) => {
      if (!inBounds(world, x, y)) return false;
      const t = world.terrain[idx(world, x, y)];
      return t === T.FAIRWAY || t === T.GREEN || t === T.TEE;
    };
    const wide = (x: number, y: number) => ok(x, y) && ok(x + 1, y) && ok(x - 1, y) && ok(x, y + 1) && ok(x, y - 1);
    const seen = new Set<number>();
    const q: Pt[] = [h.tee];
    seen.add(ti);
    let bestD = Infinity;
    let best = h.tee;
    let reached = false;
    while (q.length) {
      const p = q.pop()!;
      const dd = Math.hypot(p.x - h.cup.x, p.y - h.cup.y);
      if (dd < bestD) {
        bestD = dd;
        best = p;
      }
      if (p.x === h.cup.x && p.y === h.cup.y) {
        reached = true;
        break;
      }
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = p.x + dx;
          const ny = p.y + dy;
          if (!inBounds(world, nx, ny) || seen.has(idx(world, nx, ny))) continue;
          if (!wide(nx, ny)) continue;
          seen.add(idx(world, nx, ny));
          q.push({ x: nx, y: ny });
        }
    }
    if (!reached) {
      breakAt = best;
      problem(`No continuous fairway (3 tiles wide) from tee to green. It breaks near the marked spot: paint fairway across the gap, or clear the water, sand or trees that cut it.`, best, 'fairway');
    }
  }
  const c = holeCondition(world, h);
  if (!problems.length && c.overall < 45) warnings.push('Turf is in poor shape. Expect complaints until you repair it.');
  if (!problems.length && c.green < 40) warnings.push('The green is badly worn and will make putting hard.');
  return { ok: problems.length === 0, problems, warnings, breakAt, issues };
}

export function cloneHole(h: Hole): Hole {
  return JSON.parse(JSON.stringify(h));
}

// ---- Walking paths for golfers (avoid water, buildings and, where possible, trees) ----
export function findPath(world: World, a: Pt, b: Pt): Pt[] | null {
  const sx = Math.floor(a.x);
  const sy = Math.floor(a.y);
  const gx = Math.floor(b.x);
  const gy = Math.floor(b.y);
  if (!inBounds(world, sx, sy) || !inBounds(world, gx, gy)) return null;
  const n = world.w * world.h;
  const g = new Float64Array(n).fill(1e9);
  const from = new Int32Array(n).fill(-1);
  const open: number[] = [];
  const f = new Float64Array(n).fill(1e9);
  const cost = (i: number): number => {
    const t = world.terrain[i];
    if (t === T.WATER || t === T.BUILDING) return -1;
    let c = t === T.PATH ? 0.8 : t === T.BUNKER ? 1.6 : t === T.ROUGH ? 1.1 : 1;
    if (world.tree[i]) c += 3;
    return c;
  };
  const h = (x: number, y: number) => Math.hypot(x - gx, y - gy);
  const si = sy * world.w + sx;
  g[si] = 0;
  f[si] = h(sx, sy);
  open.push(si);
  const closed = new Uint8Array(n);
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % world.w;
    const cy = (cur - cx) / world.w;
    if (cx === gx && cy === gy) {
      const out: Pt[] = [];
      for (let i = cur; i !== -1 && i !== si; i = from[i]) out.push({ x: (i % world.w) + 0.5, y: Math.floor(i / world.w) + 0.5 });
      out.reverse();
      if (out.length) out[out.length - 1] = { x: b.x, y: b.y };
      return out;
    }
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inBounds(world, nx, ny)) continue;
        const ni = ny * world.w + nx;
        if (closed[ni]) continue;
        const c = cost(ni);
        if (c < 0 && !(nx === gx && ny === gy)) continue;
        if (dx && dy && (cost(cy * world.w + nx) < 0 || cost(ny * world.w + cx) < 0)) continue;
        const ng = g[cur] + Math.max(0.5, c) * (dx && dy ? 1.414 : 1);
        if (ng < g[ni]) {
          g[ni] = ng;
          from[ni] = cur;
          f[ni] = ng + h(nx, ny);
          open.push(ni);
        }
      }
  }
  return null;
}
