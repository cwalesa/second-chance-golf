import { CFG } from './config';
import { REGIONS, RegionId } from './progression';

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
}

export const SPAWN: Pt = { x: 0.5, y: 47.5 };
export const DOOR: Pt = { x: 6.5, y: 40.6 };
export const ENTRY: Pt = { x: 1.6, y: 40.6 };

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
const condCache = new Map<string, { v: number; r: HoleCondition }>();
export function holeCondition(world: World, h: Hole): HoleCondition {
  const key = String(h.id);
  const hit = condCache.get(key);
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
  condCache.set(key, { v: world.version, r });
  return r;
}

// ---- Route field: weighted distance-to-cup used by golfers to choose safe lines ----
const fieldCache = new Map<number, { v: number; cx: number; cy: number; f: Float64Array }>();
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
  const hit = fieldCache.get(h.id);
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
  fieldCache.set(h.id, { v: world.version, cx: h.cup.x, cy: h.cup.y, f: dist });
  return dist;
}

// ---- Validation ----
export interface Validation {
  ok: boolean;
  problems: string[];
  warnings: string[];
  breakAt: Pt | null;
}
export function validateHole(world: World, h: Hole): Validation {
  const problems: string[] = [];
  const warnings: string[] = [];
  let breakAt: Pt | null = null;
  const ti = idx(world, h.tee.x, h.tee.y);
  const ci = idx(world, h.cup.x, h.cup.y);
  if (world.terrain[ti] !== T.TEE) problems.push('The tee box is damaged. Move the tee to rebuild it.');
  if (world.terrain[ci] !== T.GREEN) problems.push('The cup is not on a green.');
  let greenTiles = 0;
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const x = h.cup.x + dx;
      const y = h.cup.y + dy;
      if (inBounds(world, x, y) && Math.hypot(dx, dy) <= 3.5 && world.terrain[idx(world, x, y)] === T.GREEN) greenTiles++;
    }
  if (world.terrain[ci] === T.GREEN && greenTiles < 8) problems.push(`The green is too small (${greenTiles} tiles, needs 8). Move the cup to rebuild it.`);
  const len = holeStraightTiles(h);
  if (len < 8) problems.push('Tee and cup are too close together (minimum 80 yards).');
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
      problems.push(`No continuous fairway (3 tiles wide) from tee to green. It breaks near the marked spot.`);
    }
  }
  const c = holeCondition(world, h);
  if (!problems.length && c.overall < 45) warnings.push('Turf is in poor shape. Expect complaints until you repair it.');
  if (!problems.length && c.green < 40) warnings.push('The green is badly worn and will make putting hard.');
  return { ok: problems.length === 0, problems, warnings, breakAt };
}

// ---- Starting property ----
export function createStartingWorld(regionId: RegionId = 'parkland'): World {
  const region = REGIONS[regionId];
  const { w, h } = CFG.grid;
  const n = w * h;
  const holes: Hole[] = [
    { id: 1, name: 'Old Orchard', tee: { x: 9, y: 33 }, cup: { x: 42, y: 31 }, bend: { x: 24, y: 35 }, open: true, par: 4, fixedGreenAt: -1, reopenedAt: -1, stats: newStats() },
    { id: 2, name: 'Cattail Carry', tee: { x: 48, y: 42 }, cup: { x: 60, y: 28 }, bend: { x: 62, y: 41 }, open: true, par: 3, fixedGreenAt: -1, reopenedAt: -1, stats: newStats() },
    { id: 3, name: 'Foxglove Run', tee: { x: 10, y: 10 }, cup: { x: 42, y: 10 }, bend: { x: 26, y: 14 }, open: false, par: 4, fixedGreenAt: -1, reopenedAt: -1, stats: newStats() },
  ];
  for (const hole of holes) hole.par = parFor(holeStraightTiles(hole));
  const world: World = { w, h, terrain: new Uint8Array(n), cond: new Float32Array(n), tree: new Uint8Array(n), zone: new Uint8Array(n), holes, version: 1, region: regionId, parcels: Uint8Array.from({ length: CFG.land.cols * CFG.land.rows }, (_, i) => (startsOwned(i % CFG.land.cols, Math.floor(i / CFG.land.cols)) ? 1 : 0)), dirty: new Set() };
  computeZones(world);
  const set = (x: number, y: number, t: number, c: number) => {
    if (!inBounds(world, x, y)) return;
    const i = idx(world, x, y);
    world.terrain[i] = t;
    world.cond[i] = Math.max(0, Math.min(100, c));
  };
  // Base rough: mostly tidy near the played holes, overgrown elsewhere.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const nz = vnoise(x / 5.5, y / 5.5, 11);
      const zone = world.zone[y * w + x];
      let c = nz > 0.6 ? 16 + hash2(x, y, 1) * 16 : 58 + hash2(x, y, 2) * 18;
      if (zone === 3) c = 12 + hash2(x, y, 3) * 20;
      set(x, y, T.ROUGH, c);
    }
  const strip = (pts: Pt[], r: number, fn: (x: number, y: number, s: number, total: number) => void) => {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = polyDist(x + 0.5, y + 0.5, pts);
        if (d.d <= r + (vnoise(x / 3, y / 3, 5) - 0.5)) fn(x, y, d.s, d.total);
      }
  };
  const disc = (cx: number, cy: number, r: number, fn: (x: number, y: number) => void) => {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) fn(x, y);
  };
  const box = (cx: number, cy: number, fn: (x: number, y: number) => void) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) fn(cx + dx, cy + dy);
  };
  const bunker = (cx: number, cy: number, r: number) => disc(cx, cy, r, (x, y) => set(x, y, T.BUNKER, 100));
  const water = (cx: number, cy: number, r: number) => disc(cx, cy, r, (x, y) => set(x, y, T.WATER, 100));
  const green = (hole: Hole, lo: number, span: number) =>
    disc(hole.cup.x + 0.5, hole.cup.y + 0.5, 2.7, (x, y) => set(x, y, T.GREEN, lo + hash2(x, y, 7) * span));
  const tee = (hole: Hole, lo: number, span: number) => box(hole.tee.x, hole.tee.y, (x, y) => set(x, y, T.TEE, lo + hash2(x, y, 8) * span));

  // Hole 1: open, par 4, worn patches and a greenside bunker pair
  const [h1, h2, h3] = holes;
  strip(holePath(h1), 3.1, (x, y) => set(x, y, T.FAIRWAY, 74 + hash2(x, y, 4) * 14));
  disc(12.5, 33.5, 2.3, (x, y) => world.terrain[idx(world, x, y)] === T.FAIRWAY && set(x, y, T.FAIRWAY, 28 + hash2(x, y, 9) * 12));
  disc(29, 35, 1.8, (x, y) => world.terrain[idx(world, x, y)] === T.FAIRWAY && set(x, y, T.FAIRWAY, 34 + hash2(x, y, 9) * 12));
  green(h1, 76, 10);
  tee(h1, 70, 10);
  bunker(26.5, 31, 1.6);
  bunker(39.8, 34.6, 1.7);
  bunker(44.6, 29.4, 1.5);
  bunker(38.4, 28.2, 1.2);
  water(22.5, 40.5, 2.5);

  // Hole 2: par 3 with a pond carry; worn green
  strip(holePath(h2), 2.5, (x, y) => set(x, y, T.FAIRWAY, 72 + hash2(x, y, 4) * 14));
  green(h2, 10, 20);
  tee(h2, 58, 10);
  water(53.5, 34, 5);
  bunker(56.6, 29.8, 1.5);
  bunker(64, 29.6, 1.6);
  bunker(60.4, 24.7, 1.3);

  // Hole 3: closed, overgrown with a broken fairway
  strip(holePath(h3), 2.3, (x, y, s, total) => {
    const f = s / total;
    if (f > 0.4 && f < 0.58) return;
    set(x, y, T.FAIRWAY, 22 + hash2(x, y, 4) * 20);
  });
  green(h3, 6, 12);
  tee(h3, 14, 14);
  bunker(41.8, 14.4, 1.5);
  bunker(45, 8.2, 1.4);
  const creek: Pt[] = [{ x: 18, y: 24 }, { x: 24, y: 20 }, { x: 30, y: 17.5 }, { x: 36, y: 15.6 }, { x: 42, y: 15 }, { x: 48, y: 16 }, { x: 56, y: 19 }];
  strip(creek, 1.05, (x, y) => set(x, y, T.WATER, 100));

  // Paths, parking and the clubhouse
  const pathTile = (x: number, y: number) => {
    if (!inBounds(world, x, y)) return;
    const i = idx(world, x, y);
    if (world.terrain[i] === T.ROUGH) set(x, y, T.PATH, 60);
  };
  const pathLine = (a: Pt, b: Pt) => {
    const steps = Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2);
    for (let i = 0; i <= steps; i++) pathTile(Math.round(a.x + ((b.x - a.x) * i) / steps), Math.round(a.y + ((b.y - a.y) * i) / steps));
  };
  for (let x = 0; x <= 22; x++) for (let y = 47; y <= 48; y++) set(x, y, T.PATH, 60);
  for (let x = 11; x <= 19; x++) for (let y = 42; y <= 46; y++) set(x, y, T.PATH, 60);
  for (let y = 42; y <= 46; y++) set(10, y, T.PATH, 60);
  for (let x = 3; x <= 9; x++) for (let y = 41; y <= 45; y++) set(x, y, T.BUILDING, 100);
  for (let x = 1; x <= 8; x++) set(x, 40, T.PATH, 60);
  for (let y = 40; y <= 46; y++) for (let x = 1; x <= 2; x++) set(x, y, T.PATH, 60);
  pathLine({ x: 6, y: 40 }, { x: 6, y: 36 });
  pathLine({ x: 6, y: 36 }, { x: 7, y: 34 });
  pathLine({ x: 6, y: 36 }, { x: 6, y: 12 });
  pathLine({ x: 6, y: 12 }, { x: 8, y: 11 });
  pathLine({ x: 43, y: 35 }, { x: 46, y: 38 });
  pathLine({ x: 46, y: 38 }, { x: 47, y: 42 });
  for (let x = 20; x <= 22; x++) for (let y = 42; y <= 46; y++) if (world.terrain[idx(world, x, y)] === T.ROUGH) set(x, y, T.ROUGH, 30);

  // Trees: clusters, tree-lined holes, edge woods
  const bounds = [
    { hole: h1, r: 3.1 },
    { hole: h2, r: 2.5 },
    { hole: h3, r: 2.3 },
  ];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = idx(world, x, y);
      if (world.terrain[i] !== T.ROUGH) continue;
      if (x < 24 && y > 38) continue;
      let ring = 99;
      let rr = 0;
      for (const b of bounds) {
        const d = polyDist(x + 0.5, y + 0.5, holePath(b.hole)).d - b.r;
        if (d < ring) {
          ring = d;
          rr = b.r;
        }
      }
      if (ring < 1.4) continue;
      const nz = vnoise(x / 4, y / 4, 3);
      let p = (nz > 0.58 ? 0.55 : 0.035) * region.treeDensity;
      if (ring < 3.6 && rr) p = Math.max(p, 0.16 * Math.min(1, region.treeDensity));
      if (x < 2 || x > w - 3 || y < 2 || y > h - 3) p = Math.min(0.9, 0.6 * region.treeDensity);
      p = Math.min(0.9, p);
      if (hash2(x, y, 21) < p) world.tree[i] = 1;
    }
  // Natural waste ground (dunes, scrub, desert sand) well away from the played holes
  if (region.waste > 0) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = idx(world, x, y);
        if (world.terrain[i] !== T.ROUGH || (x < 24 && y > 38 && x < 24)) continue;
        let ring = 99;
        for (const b of bounds) ring = Math.min(ring, polyDist(x + 0.5, y + 0.5, holePath(b.hole)).d - b.r);
        if (ring < 3.2) continue;
        if (vnoise(x / 6, y / 6, 77) > 0.86 - region.waste * 0.14 && hash2(x, y, 78) < 0.5) {
          world.terrain[i] = T.BUNKER;
          world.cond[i] = 100;
          world.tree[i] = 0;
        }
      }
  }
  // Hand-placed trees: shot-shaping on hole 1/2, blockers on hole 3
  const addTree = (x: number, y: number) => {
    if (inBounds(world, x, y) && world.terrain[idx(world, x, y)] === T.ROUGH) world.tree[idx(world, x, y)] = 1;
  };
  [[17, 30], [18, 29], [19, 30], [34, 29], [35, 28], [36, 37], [37, 38], [41, 36]].forEach(([x, y]) => addTree(x, y));
  [[65, 36], [66, 38], [64, 33], [57, 40]].forEach(([x, y]) => addTree(x, y));
  [[22, 14], [23, 15], [24, 13], [25, 16], [27, 12], [28, 15], [26, 17], [30, 9], [14, 14], [34, 7]].forEach(([x, y]) => addTree(x, y));
  // Fallen-in gap trees in hole 3 (removable)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = polyDist(x + 0.5, y + 0.5, holePath(h3));
      const f = d.s / d.total;
      if (d.d < 2.4 && f > 0.4 && f < 0.58 && world.terrain[idx(world, x, y)] === T.ROUGH && hash2(x, y, 30) < 0.22) world.tree[idx(world, x, y)] = 1;
    }
  world.version++;
  return world;
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
