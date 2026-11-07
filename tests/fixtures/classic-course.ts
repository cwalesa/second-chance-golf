// Test-only fixtures: a small hand-built three-hole course (two open holes and one overgrown, closed one) and
// four authored routings, used to test economy, simulation, design scoring and saving against known geometry.
// The game itself never builds these: every real game starts from blank land (src/wilderness.ts).
import { CFG } from '../../src/config';
import { REGIONS, RegionId } from '../../src/progression';
import { Hole, Pt, T, World, computeZones, hash2, holePath, holePathTiles, idx, inBounds, isOwned, newStats, parFor, polyDist, startsOwned, vnoise } from '../../src/terrain';

// ---- Starting property ----
export function createTestCourse(regionId: RegionId = 'parkland'): World {
  const region = REGIONS[regionId];
  const { w, h } = CFG.grid;
  const n = w * h;
  const holes: Hole[] = [
    { id: 1, name: 'Old Orchard', tee: { x: 9, y: 33 }, cup: { x: 42, y: 31 }, bend: { x: 24, y: 35 }, open: true, par: 4, fixedGreenAt: -1, reopenedAt: -1, stats: newStats() },
    { id: 2, name: 'Cattail Carry', tee: { x: 48, y: 42 }, cup: { x: 60, y: 28 }, bend: { x: 62, y: 41 }, open: true, par: 3, fixedGreenAt: -1, reopenedAt: -1, stats: newStats() },
    { id: 3, name: 'Foxglove Run', tee: { x: 10, y: 10 }, cup: { x: 42, y: 10 }, bend: { x: 26, y: 14 }, open: false, par: 4, fixedGreenAt: -1, reopenedAt: -1, stats: newStats() },
  ];
  for (const hole of holes) hole.par = parFor(holePathTiles(hole));
  const world: World = { w, h, terrain: new Uint8Array(n), cond: new Float32Array(n), tree: new Uint8Array(n), zone: new Uint8Array(n), holes, version: 1, region: regionId, parcels: Uint8Array.from({ length: CFG.land.cols * CFG.land.rows }, (_, i) => (startsOwned(i % CFG.land.cols, Math.floor(i / CFG.land.cols)) ? 1 : 0)), dirty: new Set(), clubhouse: { x: 3, y: 41 }, gate: { x: 0.5, y: 47.5 }, landSeed: 1 };
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


/** Authored campaign routings. The clubhouse stays at the entry road; the golf changes. */
const ROUTES: Record<Exclude<RegionId, 'parkland'>, { names: string[]; points: [Pt, Pt, Pt][]; ponds: [number, number, number][] }> = {
  coast: { names: ['Sea Breeze', 'Dune Passage', 'The Long Way Home'], points: [[{x:12,y:33},{x:30,y:32},{x:45,y:24}], [{x:56,y:45},{x:63,y:33},{x:61,y:17}], [{x:49,y:8},{x:33,y:15},{x:12,y:9}]], ponds: [[40,39,3.5],[21,22,2.5]] },
  mountain: { names: ['Pine Hollow', 'High Pass', 'North Ridge'], points: [[{x:12,y:33},{x:29,y:29},{x:43,y:22}], [{x:53,y:43},{x:56,y:30},{x:63,y:15}], [{x:47,y:7},{x:31,y:11},{x:12,y:8}]], ponds: [[43,36,3],[31,20,2.5]] },
  plains: { names: ['Open Country', 'Windbreak', 'Homestead'], points: [[{x:11,y:33},{x:28,y:28},{x:44,y:32}], [{x:59,y:46},{x:63,y:32},{x:60,y:15}], [{x:49,y:9},{x:32,y:15},{x:12,y:10}]], ponds: [[37,42,3],[18,21,2]] },
  desert: { names: ['Golden Hour', 'Mirage', 'The Oasis'], points: [[{x:12,y:33},{x:29,y:36},{x:44,y:27}], [{x:57,y:45},{x:63,y:32},{x:61,y:16}], [{x:49,y:8},{x:31,y:14},{x:12,y:9}]], ponds: [[44,43,4],[31,22,3]] },
};
export function createTestCampaign(region: RegionId): World {
  const w = createTestCourse(region);
  if (region === 'parkland') return w;
  const route = ROUTES[region];
  // Preserve arrival roads, clubhouse, vegetation and regional ground texture.
  for (let i=0;i<w.terrain.length;i++) {
    if (!isOwned(w,i%w.w,Math.floor(i/w.w))) continue;
    if (w.terrain[i] !== T.PATH && w.terrain[i] !== T.BUILDING) {
      w.terrain[i]=T.ROUGH;
      w.cond[i]=44+hash2(i%w.w,Math.floor(i/w.w),17)*30;
    }
  }
  w.holes.forEach((h,k)=> { const [tee,bend,cup]=route.points[k]; h.tee={...tee};h.bend={...bend};h.cup={...cup};h.name=route.names[k];h.par=parFor(Math.hypot(cup.x-tee.x,cup.y-tee.y)); });
  computeZones(w);
  const disc=(cx:number,cy:number,r:number,t:number,cond:number)=> {
    for(let y=Math.floor(cy-r);y<=cy+r;y++) for(let x=Math.floor(cx-r);x<=cx+r;x++) {
      if(!isOwned(w,x,y)||Math.hypot(x-cx,y-cy)>r)continue;
      const i=idx(w,x,y);if(w.terrain[i]===T.PATH||w.terrain[i]===T.BUILDING)continue;
      w.terrain[i]=t;w.cond[i]=cond;w.tree[i]=0;
    }
  };
  for(const h of w.holes) {
    const path=holePath(h);
    for(let y=0;y<w.h;y++)for(let x=0;x<w.w;x++) {
      if(!isOwned(w,x,y))continue;
      const d=polyDist(x+.5,y+.5,path),i=idx(w,x,y),f=d.s/Math.max(1,d.total);
      if(d.d>3.3||w.terrain[i]===T.PATH||w.terrain[i]===T.BUILDING)continue;
      if(h.id===3 && f>.4 && f<.57){ w.cond[i]=22;continue; }
      w.terrain[i]=T.FAIRWAY;w.tree[i]=0;w.cond[i]=h.id===3?32:74;
    }
    disc(h.cup.x,h.cup.y,2.7,T.GREEN,h.id===1?82:h.id===2?24:15);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) { const i=idx(w,h.tee.x+dx,h.tee.y+dy);w.terrain[i]=T.TEE;w.cond[i]=h.id===3?24:82;w.tree[i]=0; }
    // Bunkers frame the green; they do not sever the safe fairway corridor.
    disc(h.cup.x-3.7,h.cup.y-3.4,1.4,T.BUNKER,100);
    disc(h.bend.x+1,h.bend.y+5.2,region==='coast'?2.2:1.5,T.BUNKER,100);
  }
  for(const [x,y,r] of route.ponds)disc(x,y,r,T.WATER,100);
  computeZones(w);w.version++;w.dirty=new Set(Array.from({length:CFG.grid.w*CFG.grid.h},(_,i)=>i));
  return w;
}
