import { GolferType, CFG } from './config';
import { Hole, World, T, holePath, polyDist, center, terrainAt } from './terrain';

export interface DesignReport {
  scenery: number; strategy: number; forgiveness: number; character: number;
  overall: number; verdict: string; advice: string[]; carry: number;
}
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const cache = new WeakMap<World, Map<number, { version: number; report: DesignReport }>>();
/** Layout only: condition and guest scores are deliberately shown separately. */
export function assessDesign(w: World, h: Hole): DesignReport {
  let m = cache.get(w); if (!m) cache.set(w, m = new Map());
  const hit = m.get(h.id); if (hit?.version === w.version) return hit.report;
  const path = holePath(h);
  let corridor = 0, fair = 0, trees = 0, edgeTrees = 0, water = 0, sand = 0, nearGreen = 0;
  const cup = center(h.cup);
  for (let i = 0; i < w.terrain.length; i++) {
    if (w.zone[i] !== h.id) continue;
    const x = i % w.w + .5, y = Math.floor(i / w.w) + .5;
    const d = polyDist(x, y, path).d, t = w.terrain[i];
    if (d < 2.8) {
      corridor++;
      if ((t === T.FAIRWAY || t === T.GREEN || t === T.TEE) && !w.tree[i]) fair++;
      if (w.tree[i]) trees++;
    } else if (w.tree[i]) edgeTrees++;
    if (t === T.WATER) water++;
    if (t === T.BUNKER) { sand++; if (Math.hypot(x - cup.x, y - cup.y) < 6) nearGreen++; }
  }
  const tee = center(h.tee), length = Math.hypot(cup.x - tee.x, cup.y - tee.y);
  let run = 0, carry = 0;
  for (let s = 0; s <= length; s += .5) {
    const t = terrainAt(w, tee.x + (cup.x - tee.x) * s / Math.max(1, length), tee.y + (cup.y - tee.y) * s / Math.max(1, length));
    run = t === T.WATER ? run + .5 : 0; carry = Math.max(carry, run);
  }
  const bend = polyDist(h.bend.x + .5, h.bend.y + .5, [tee, cup]).d;
  const forgiveness = clamp(35 + 65 * fair / Math.max(1, corridor) - trees * .7 - Math.max(0, carry - 5) * 5);
  const scenery = clamp(30 + Math.min(30, edgeTrees * .5) + Math.min(22, water * .45) + Math.min(12, sand * .5) - trees * .35);
  // A few well-placed hazards create decisions; filling a hole with hazards does not.
  const hazard = sand + water;
  const strategy = clamp(38 + Math.min(22, bend * 4) + Math.min(20, nearGreen * 1.2) + Math.min(16, water * .5) - Math.max(0, hazard - corridor * .55) * .65 - Math.max(0, carry - 8) * 4);
  const character = clamp(40 + Math.min(25, bend * 5) + (nearGreen ? 12 : 0) + (water ? 12 : 0) + (edgeTrees > 12 ? 10 : 0));
  const overall = clamp(forgiveness * .4 + scenery * .25 + strategy * .25 + character * .1);
  const advice: string[] = [];
  if (fair / Math.max(1, corridor) < .65) advice.push('Widen the landing areas with fairway. Beginners need room to miss.');
  if (trees > 3) advice.push('Clear trees from the playing corridor; keep the trees beside it.');
  if (carry > 5) advice.push(`The direct line crosses ${Math.round(carry * 10)} yards of water. Leave a safe route around it.`);
  if (nearGreen < 3) advice.push('A small bunker beside the green can make the approach more interesting.');
  if (edgeTrees < 16) advice.push('Plant trees beside the hole to frame the view without blocking shots.');
  if (bend < 2 && h.par > 3) advice.push('Move the routing point to create a dogleg and a choice of landing areas.');
  if (!advice.length) advice.push('A balanced layout. Watch actual scores and landing marks before adding more difficulty.');
  const report = { scenery, strategy, forgiveness, character, overall, verdict: overall >= 80 ? 'Signature hole' : overall >= 65 ? 'Worth coming back for' : overall >= 50 ? 'Promising layout' : 'Needs a redesign', advice, carry };
  m.set(h.id, { version: w.version, report }); return report;
}
export function designEnjoyment(r: DesignReport, type: GolferType): number {
  const score = type === 'beginner' ? r.forgiveness * .7 + r.scenery * .3 : type === 'skilled' ? r.strategy * .65 + r.scenery * .35 : r.overall;
  return Math.max(-8, Math.min(8, (score - 55) * .22));
}
export const expectedCarry = (type: GolferType) => Math.round(CFG.golfers.types[type].reach * 10);
