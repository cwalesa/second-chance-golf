import { CFG } from './config';
import { RegionId } from './progression';
import { T, Pt, World, createStartingWorld, computeZones, holePath, polyDist, hash2, idx, isOwned, parFor } from './terrain';

/** Authored campaign routings. The clubhouse stays at the entry road; the golf changes. */
const ROUTES: Record<Exclude<RegionId, 'parkland'>, { names: string[]; points: [Pt, Pt, Pt][]; ponds: [number, number, number][] }> = {
  coast: { names: ['Sea Breeze', 'Dune Passage', 'The Long Way Home'], points: [[{x:12,y:33},{x:30,y:32},{x:45,y:24}], [{x:56,y:45},{x:63,y:33},{x:61,y:17}], [{x:49,y:8},{x:33,y:15},{x:12,y:9}]], ponds: [[40,39,3.5],[21,22,2.5]] },
  mountain: { names: ['Pine Hollow', 'High Pass', 'North Ridge'], points: [[{x:12,y:33},{x:29,y:29},{x:43,y:22}], [{x:53,y:43},{x:56,y:30},{x:63,y:15}], [{x:47,y:7},{x:31,y:11},{x:12,y:8}]], ponds: [[43,36,3],[31,20,2.5]] },
  plains: { names: ['Open Country', 'Windbreak', 'Homestead'], points: [[{x:11,y:33},{x:28,y:28},{x:44,y:32}], [{x:59,y:46},{x:63,y:32},{x:60,y:15}], [{x:49,y:9},{x:32,y:15},{x:12,y:10}]], ponds: [[37,42,3],[18,21,2]] },
  desert: { names: ['Golden Hour', 'Mirage', 'The Oasis'], points: [[{x:12,y:33},{x:29,y:36},{x:44,y:27}], [{x:57,y:45},{x:63,y:32},{x:61,y:16}], [{x:49,y:8},{x:31,y:14},{x:12,y:9}]], ponds: [[44,43,4],[31,22,3]] },
};
export function createCampaignWorld(region: RegionId): World {
  const w = createStartingWorld(region);
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
