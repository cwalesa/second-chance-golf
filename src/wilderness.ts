// "Blank canvas" start: untouched forest with a creek, a few ponds and rolling valleys, and a spot for the
// player to choose for the clubhouse. Everything here is deterministic from the land seed, so the valley
// shading can be rebuilt on load without saving anything extra.
import { CFG } from './config';
import { lotKindAt } from './lots';
import { REGIONS, RegionId } from './progression';
import { CLUB_H, CLUB_W, Pt, T, World, computeZones, hash2, idx, inBounds, polyDist, vnoise } from './terrain';

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export interface Pond {
  x: number;
  y: number;
  r: number;
}
export interface Land {
  creek: Pt[];
  ponds: Pond[];
  /** 0 = valley floor, 1 = ridge top, one value per tile. */
  relief: Float32Array;
}
const lands = new Map<string, Land>();
export interface Dims {
  w: number;
  h: number;
}

const nearestCreek = (creek: Pt[], x: number, y: number) => polyDist(x, y, creek).d;

/** How much the ground rises and falls: mountains are rugged, prairie and coast are gentle. */
const RELIEF_GAIN: Record<RegionId, number> = { parkland: 1, coast: 0.7, mountain: 1.6, plains: 0.5, desert: 0.9 };

/** The land for a seed: a creek crossing the map, ponds in hollows, and a smooth height field with valleys carved around them. */
export function landOf(seed: number, dims: Dims & { region?: RegionId } = CFG.grid): Land {
  const gain = RELIEF_GAIN[dims.region ?? 'parkland'];
  const key = `${seed}:${dims.w}x${dims.h}:${gain}`;
  const hit = lands.get(key);
  if (hit) return hit;
  const { w, h } = dims;
  const s = seed | 0;
  const creek: Pt[] = [];
  const base = h * (0.3 + 0.4 * hash2(s, 1, 5));
  const phase = hash2(s, 2, 5) * 6.28;
  const amp = 7 + hash2(s, 3, 5) * 5;
  for (let x = -4; x <= w + 4; x += 5) creek.push({ x, y: clamp(base + amp * Math.sin(x / 15 + phase) + (vnoise(x / 8, 3, s) - 0.5) * 8, 6, h - 7) });
  const ponds: Pond[] = [];
  const tries = [[0.16, 0.22], [0.5, 0.2], [0.82, 0.24], [0.2, 0.78], [0.55, 0.8], [0.84, 0.76], [0.38, 0.5]];
  for (let k = 0; k < tries.length && ponds.length < 3; k++) {
    const r = 3.2 + hash2(s, 10 + k, 6) * 2.6;
    for (let j = 0; j < 14; j++) {
      const x = clamp(w * tries[k][0] + (hash2(s, 20 + k * 20 + j, 7) - 0.5) * 18, 12, w - 13);
      const y = clamp(h * tries[k][1] + (hash2(s, 21 + k * 20 + j, 8) - 0.5) * 12, 10, h - 11);
      if (nearestCreek(creek, x, y) < r + 6) continue;
      if (ponds.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + r + 16)) continue;
      ponds.push({ x, y, r });
      break;
    }
  }
  const relief = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0.5 * vnoise(x / 30, y / 30, s) + 0.3 * vnoise(x / 13, y / 13, s + 1) + 0.2 * vnoise(x / 6, y / 6, s + 2);
      const d = nearestCreek(creek, x + 0.5, y + 0.5);
      v -= 0.34 * Math.exp(-Math.pow(d / 9, 2));
      for (const p of ponds) v -= 0.3 * Math.exp(-Math.pow(Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) / (p.r * 2.1), 2));
      relief[y * w + x] = clamp((clamp(v * 1.35 + 0.1) - 0.5) * gain + 0.5);
    }
  const land = { creek, ponds, relief };
  lands.set(key, land);
  return land;
}

/** Height at a tile, 0 (valley floor) to 1 (ridge). Returns 0.5 for the classic course, which has no relief. */
export function reliefAt(seed: number, x: number, y: number, dims: Dims & { region?: RegionId } = CFG.grid): number {
  if (!seed) return 0.5;
  const { w, h } = dims;
  return landOf(seed, dims).relief[clamp(Math.floor(y), 0, h - 1) * w + clamp(Math.floor(x), 0, w - 1)];
}

/** A random-looking but repeatable land seed. */
export const newLandSeed = (n: number) => 1 + (Math.floor(Math.abs(n)) % 99991);

/** Untouched wilderness: no holes, no clubhouse, every tile ready to build on. */
export function createWilderness(landSeed: number, region: RegionId = 'parkland', dims: Dims = CFG.grid): World {
  const { w, h } = dims;
  const n = w * h;
  const s = landSeed;
  const land = landOf(s, { ...dims, region });
  const world: World = {
    w,
    h,
    terrain: new Uint8Array(n),
    cond: new Float32Array(n),
    tree: new Uint8Array(n),
    zone: new Uint8Array(n),
    holes: [],
    version: 1,
    region,
    parcels: new Uint8Array(CFG.land.cols * CFG.land.rows).fill(1),
    dirty: new Set(),
    clubhouse: null,
    gate: { x: 0.5, y: h / 2 + 0.5 },
    landSeed: s,
    items: [],
  };
  // Coast: the sea fills the top or bottom edge (never the sides, so the entrance road always has land to leave by).
  const seaTop = hash2(s, 90, 3) < 0.5;
  const seaDepth = (x: number) => 18 + 12 * vnoise(x / 22, 4, s + 91) + 4 * vnoise(x / 6, 9, s + 92);
  const seaDist = (x: number, y: number) => (seaTop ? y + 0.5 : h - y - 0.5) - seaDepth(x);
  const desert = region === 'desert';
  const reg = REGIONS[region];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const relief = land.relief[i];
      const d = nearestCreek(land.creek, x + 0.5, y + 0.5);
      const wob = (vnoise(x / 2.5, y / 2.5, s + 40) - 0.5) * 1.1;
      // the desert creek is a dry wash; its ponds become oases
      let wet = !desert && d < 1.15 + wob * 0.8;
      for (const p of land.ponds) if (Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) < p.r * (desert ? 1.35 : 1) * (1 + wob * 0.55)) wet = true;
      const sea = region === 'coast' ? seaDist(x, y) : 99;
      if (sea < wob * 1.2) wet = true;
      if (wet) {
        world.terrain[i] = T.WATER;
        world.cond[i] = 100;
        continue;
      }
      const shore = Math.min(desert ? 99 : d - 1.2, sea - 0.5, ...land.ponds.map((q) => Math.hypot(x + 0.5 - q.x, y + 0.5 - q.y) - q.r * (desert ? 1.35 : 1)));
      // Meadows gather on valley floors; ridges and slopes are forest.
      const valley = smooth(0.62, 0.34, relief);
      const open = clamp(0.1 + 0.6 * valley + 1.15 * (vnoise(x / 10, y / 10, s + 7) - 0.5));
      let p = (0.04 + 0.64 * (1 - open)) * Math.min(1.35, reg.treeDensity);
      let flowers = open > 0.6 && vnoise(x / 4.5, y / 4.5, s + 50) > 0.58;
      let natural: number = T.ROUGH;
      let dry = 0;
      if (region === 'parkland') p *= 0.8 - 0.3 * smooth(0.4, 0.7, vnoise(x / 24, y / 24, s + 60)); // big clearings
      else if (region === 'plains') p *= 0.25 + 1.6 * smooth(0.55, 0.78, vnoise(x / 15, y / 15, s + 61)); // a few groves in open grass
      else if (region === 'mountain') {
        p = Math.min(0.95, (0.32 + 0.8 * (1 - open)) * (0.85 + 0.5 * relief)) * (1 - 0.85 * smooth(0.82, 0.97, relief)); // dense pines up to a bare treeline
        flowers = false;
      } else if (region === 'coast') {
        // beach, then dunes of sand and scrub, then thin grass inland
        const dune = vnoise(x / 4, y / 5, s + 62) + 0.35 * vnoise(x / 2, y / 2, s + 63);
        if (sea < 3.2 + wob) natural = T.BUNKER;
        else if (sea < 30 && dune > 0.82 + sea * 0.01) natural = T.BUNKER;
        p *= 0.5 + 0.6 * smooth(0.3, 0.7, vnoise(x / 12, y / 12, s + 64));
        dry = sea < 30 ? 1 : 0;
        flowers = false;
      } else if (desert) {
        const dune = vnoise(x / 9, y / 7, s + 65) + 0.3 * vnoise(x / 3, y / 3, s + 66);
        const wash = nearestCreek(land.creek, x + 0.5, y + 0.5) < 1.6 + wob;
        if (wash || dune > 0.98) natural = T.BUNKER;
        // sparse scrub, with palms gathered around the oases
        p = 0.012 + 0.03 * (1 - open);
        if (shore < 6) p = Math.max(p, 0.55 - shore * 0.07);
        dry = 1;
        flowers = false;
      }
      if (!desert && shore < 2.2) p *= 0.45;
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge < 3 && !desert) p = Math.max(p, 0.9 - edge * 0.12);
      if (natural === T.BUNKER) {
        world.terrain[i] = T.BUNKER;
        world.cond[i] = 60;
        if (hash2(x, y, s + 23) < p * 0.12) world.tree[i] = 1;
        continue;
      }
      if (hash2(x, y, s + 21) < p) world.tree[i] = 1;
      world.cond[i] = flowers ? 24 + hash2(x, y, 3) * 14 : dry ? 30 + hash2(x, y, 1) * 14 : world.tree[i] ? 54 + hash2(x, y, 2) * 14 : 60 + hash2(x, y, 1) * 16;
    }
  computeZones(world);
  world.version++;
  return world;
}

// ---- Choosing the clubhouse spot ----

/** Tile rectangle the clubhouse lawn, plaza and entrance road occupy around a footprint's top-left corner. */
export const clubLot = (c: Pt) => ({ x0: c.x - 3, y0: c.y - 2, x1: c.x + 17, y1: c.y + 8 });

/** Highest minus lowest ground under the building: valley sides are too steep to build on. */
export function slopeAt(world: World, c: Pt): number {
  if (!world.landSeed) return 0;
  let lo = 1;
  let hi = 0;
  for (const [dx, dy] of [[0, 0], [CLUB_W, 0], [0, CLUB_H], [CLUB_W, CLUB_H], [CLUB_W / 2, CLUB_H / 2]]) {
    const v = reliefAt(world.landSeed, c.x + dx, c.y + dy, world);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi - lo;
}

/** Why a clubhouse cannot stand with its top-left corner here, or null when it can. */
export function clubhouseProblem(world: World, c: Pt): string | null {
  const lot = clubLot(c);
  if (lot.x0 < 1 || lot.y0 < 1 || lot.x1 > world.w - 2 || lot.y1 > world.h - 2) return 'Too close to the edge. The clubhouse needs room for its lawn, car park and road.';
  for (let y = c.y - 1; y <= c.y + CLUB_H; y++)
    for (let x = c.x - 1; x <= c.x + CLUB_W; x++) if (world.terrain[idx(world, x, y)] === T.WATER) return 'Too close to the water. Pick drier ground.';
  if (slopeAt(world, c) > 0.2) return 'Too steep. Look for flatter ground on the valley floor.';
  return null;
}

/** The best-looking legal spot: open meadow, a view of water, and room for holes around it. */
export function suggestClubhouse(world: World): Pt | null {
  let best: Pt | null = null;
  let bestScore = -Infinity;
  for (let y = 3; y <= world.h - 10; y += 2)
    for (let x = 4; x <= world.w - 19; x += 2) {
      const c = { x, y };
      if (clubhouseProblem(world, c)) continue;
      const lot = clubLot(c);
      let trees = 0;
      for (let yy = lot.y0; yy <= lot.y1; yy++) for (let xx = lot.x0; xx <= lot.x1; xx++) if (world.tree[idx(world, xx, yy)] || world.terrain[idx(world, xx, yy)] === T.BUNKER) trees++;
      // a view of water: some within sight, but not right under the clubhouse
      let nearWater = 0;
      for (let ry = -24; ry <= 24 && !nearWater; ry += 4)
        for (let rx = -24; rx <= 24; rx += 4) {
          const d = Math.hypot(rx, ry);
          if (d < 8 || d > 24) continue;
          const xx = x + 3 + rx, yy = y + 2 + ry;
          if (inBounds(world, xx, yy) && world.terrain[idx(world, xx, yy)] === T.WATER) { nearWater = 12; break; }
        }
      // Holes will fan out from the clubhouse, so sitting near the middle of the map gives the most room.
      const middle = Math.hypot(x + 3.5 - world.w * 0.45, y + 2.5 - world.h * 0.5);
      const score = -trees - middle * 0.6 + nearWater - slopeAt(world, c) * 60;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
  return best;
}

/** Build the clubhouse, its lawn, car park and an entrance road to the nearest edge. Free: it is the club's start. */
export function placeClubhouse(world: World, c: Pt): string | null {
  const why = clubhouseProblem(world, c);
  if (why) return why;
  const lot = clubLot(c);
  const set = (x: number, y: number, t: number, cond: number) => {
    if (!inBounds(world, x, y)) return;
    const i = idx(world, x, y);
    world.terrain[i] = t;
    world.cond[i] = cond;
    world.tree[i] = 0;
    world.dirty.add(i);
  };
  // Clear the lawn: trees go, with a ragged edge so it looks mown rather than stamped.
  for (let y = lot.y0 - 1; y <= lot.y1 + 1; y++)
    for (let x = lot.x0 - 1; x <= lot.x1 + 1; x++) {
      if (!inBounds(world, x, y)) continue;
      const i = idx(world, x, y);
      const rim = x < lot.x0 || x > lot.x1 || y < lot.y0 || y > lot.y1;
      if (world.terrain[i] === T.WATER) continue;
      if (rim && hash2(x, y, 77) > 0.5) continue;
      world.tree[i] = 0;
      world.dirty.add(i);
      if (world.terrain[i] === T.ROUGH) world.cond[i] = Math.max(world.cond[i], 66);
    }
  const rowA = c.y + 6;
  // Same layout as the classic clubhouse, moved to wherever the player chose.
  for (let y = c.y; y < c.y + CLUB_H; y++) for (let x = c.x; x < c.x + CLUB_W; x++) set(x, y, T.BUILDING, 100);
  for (let x = c.x + 8; x <= c.x + 16; x++) for (let y = c.y + 1; y <= c.y + 5; y++) set(x, y, T.PATH, 60);
  for (let y = c.y + 1; y <= c.y + 5; y++) set(c.x + 7, y, T.PATH, 60);
  for (let x = c.x - 2; x <= c.x + 5; x++) set(x, c.y - 1, T.PATH, 60);
  for (let y = c.y - 1; y <= c.y + 5; y++) for (let x = c.x - 2; x <= c.x - 1; x++) set(x, y, T.PATH, 60);
  // The road leaves along the side with the least water to cross.
  const wet = (x0: number, x1: number) => {
    let n = 0;
    for (let x = x0; x <= x1; x++) for (let y = rowA; y <= rowA + 1; y++) if (world.terrain[idx(world, x, y)] === T.WATER) n++;
    return n;
  };
  const left = wet(0, c.x + 19 < world.w ? c.x + 19 : world.w - 1);
  const right = wet(c.x - 3, world.w - 1);
  const goLeft = left + c.x * 0.02 <= right + (world.w - c.x) * 0.02;
  const x0 = goLeft ? 0 : c.x - 3;
  const x1 = goLeft ? Math.min(world.w - 1, c.x + 19) : world.w - 1;
  for (let x = x0; x <= x1; x++) for (let y = rowA; y <= rowA + 1; y++) set(x, y, T.PATH, 60);
  world.gate = { x: goLeft ? 0.5 : world.w - 0.5, y: rowA + 0.5 };
  world.clubhouse = { x: c.x, y: c.y };
  computeZones(world);
  world.version++;
  return null;
}

// ---- A gentle first hole ----

/**
 * A short, dry, easy-to-build par 3 near the clubhouse for the tutorial to point at: a clear corridor with
 * no water or paving in the way, a pond to look at beside the green when there is one, and as few trees to cut as it can find.
 */
export function suggestFirstHole(world: World): { tee: Pt; cup: Pt } | null {
  const c = world.clubhouse;
  if (!c) return null;
  const door = { x: c.x + 3.5, y: c.y + 2.5 };
  const blocked = (x: number, y: number) => {
    if (!inBounds(world, x, y)) return true;
    const t = world.terrain[idx(world, x, y)];
    return t === T.WATER || t === T.PATH || t === T.BUILDING || lotKindAt(world, x, y) !== null; // the putting green and range lots stay clear
  };
  let best: { tee: Pt; cup: Pt } | null = null;
  let bestScore = -Infinity;
  for (let ty = 5; ty < world.h - 5; ty += 2)
    for (let tx = 5; tx < world.w - 5; tx += 2) {
      const dd = Math.hypot(tx - door.x, ty - door.y);
      if (dd < 9 || dd > 20) continue;
      for (let a = 0; a < 24; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const len = 15 + (a % 3);
        const cup = { x: Math.round(tx + Math.cos(ang) * len), y: Math.round(ty + Math.sin(ang) * len) };
        if (cup.x < 6 || cup.y < 6 || cup.x > world.w - 7 || cup.y > world.h - 7) continue;
        let ok = true;
        let trees = 0;
        for (let k = 0; k <= 30 && ok; k++) {
          const px = tx + ((cup.x - tx) * k) / 30;
          const py = ty + ((cup.y - ty) * k) / 30;
          for (let y = Math.floor(py - 3.4); y <= py + 3.4 && ok; y++)
            for (let x = Math.floor(px - 3.4); x <= px + 3.4; x++) {
              if (Math.hypot(x + 0.5 - px, y + 0.5 - py) > 3.4) continue;
              if (blocked(x, y)) {
                ok = false;
                break;
              }
              if (k % 3 === 0 && Math.hypot(x + 0.5 - px, y + 0.5 - py) <= 2.5 && (world.tree[idx(world, x, y)] || world.terrain[idx(world, x, y)] === T.BUNKER)) trees++;
            }
        }
        if (!ok) continue;
        let view = 0;
        for (let y = cup.y - 9; y <= cup.y + 9 && !view; y++)
          for (let x = cup.x - 9; x <= cup.x + 9; x++) {
            const d = Math.hypot(x - cup.x, y - cup.y);
            if (d >= 4.5 && d <= 9 && inBounds(world, x, y) && world.terrain[idx(world, x, y)] === T.WATER) {
              view = 1;
              break;
            }
          }
        const score = -trees * 0.25 + view * 10 - dd * 0.4;
        if (score > bestScore) {
          bestScore = score;
          best = { tee: { x: tx, y: ty }, cup };
        }
      }
    }
  return best;
}
