import type { Game } from './game';
import { CFG } from './config';
import { EditPlan, TileEdit, planPaint } from './editing';
import { T, holePath, polyDist, holeCondition, center, isOwned } from './terrain';
import { activeLocation } from './campaign';

export const CAREER = [
  { xp: 0, title: 'Course caretaker', perk: 'Restore the basics and welcome your first regulars.' },
  { xp: 160, title: 'Course builder', perk: 'Unlock smart irrigation for your current and future courses.' },
  { xp: 650, title: 'Club steward', perk: 'Unlock the clubhouse terrace and its extra shop income.' },
  { xp: 1800, title: 'Course architect', perk: 'A permanent 5% discount on terrain construction.' },
  { xp: 4500, title: 'Resort designer', perk: 'A permanent 10% discount on terrain construction.' },
];
export type SiteId = 'irrigation' | 'terrace' | 'garden';
export const SITE_PROJECTS: Record<SiteId, { name: string; cost: number; level: number; upkeep: number; description: string }> = {
  garden: { name: 'Clubhouse garden', cost: 280, level: 0, upkeep: 0, description: 'Flower beds, a bench, and a better welcome. Adds 2 guest satisfaction.' },
  irrigation: { name: 'Smart irrigation', cost: 650, level: 1, upkeep: 12, description: 'Reduces turf wear by 20% and restores 1 condition each hour, up to 88. Costs $12/day.' },
  terrace: { name: 'Clubhouse terrace', cost: 480, level: 2, upkeep: 0, description: 'A shaded place to linger. Adds 3 satisfaction and 15% to clubhouse sales.' },
};
export interface CourseArchive {
  id: string; name: string; region: string; day: number; design: number; rounds: number; profit: number;
  members: number; holes: number; terrain: string; trees: string; pins: { x: number; y: number; id: number }[];
}
export interface Experience {
  xp: number; earned: string[]; site: Record<SiteId, boolean>; archives: CourseArchive[]; reserveUsed: boolean;
}
export const freshExperience = (): Experience => ({ xp: 0, earned: [], site: { irrigation: false, terrace: false, garden: false }, archives: [], reserveUsed: false });
export const careerLevel = (g: Game) => CAREER.reduce((level, step, i) => g.experience.xp >= step.xp ? i : level, 0);
export const constructionFactor = (g: Game) => careerLevel(g) >= 4 ? .9 : careerLevel(g) >= 3 ? .95 : 1;
export function awardExperience(g: Game, amount: number, once?: string) {
  if (once && g.experience.earned.includes(once)) return;
  const old = careerLevel(g);
  if (once) g.experience.earned.push(once);
  g.experience.xp += amount; g.dirtySave = true;
  if (careerLevel(g) > old) {
    g.applyRegion();
    g.notify('good', `Career level up: ${CAREER[careerLevel(g)].title}. ${CAREER[careerLevel(g)].perk}`);
    g.onFeedback('level');
  }
}
export function archiveCourse(g: Game) {
  const id = activeLocation(g).id;
  const entry: CourseArchive = {
    id, name: g.name, region: g.region, day: g.day, design: g.designRating, rounds: g.campaign.rounds,
    profit: Math.round(g.campaign.profit), members: g.members.length, holes: g.openHoles.length,
    terrain: Array.from(g.world.terrain).join(''), trees: Array.from(g.world.tree).join(''),
    pins: g.world.holes.map(h => ({ x: h.cup.x, y: h.cup.y, id: h.id })),
  };
  const i = g.experience.archives.findIndex(a => a.id === id);
  if (i < 0) g.experience.archives.push(entry); else g.experience.archives[i] = entry;
  g.dirtySave = true;
}
export function greenProject(g: Game): EditPlan | null {
  const h = [...g.world.holes].filter(h => holeCondition(g.world, h).green < 75).sort((a, b) => Number(b.open) - Number(a.open) || holeCondition(g.world, a).green - holeCondition(g.world, b).green)[0];
  if (!h) return null;
  const c = center(h.cup), tiles: number[] = [];
  for (let i = 0; i < g.world.terrain.length; i++) if (g.world.terrain[i] === T.GREEN && Math.hypot(i % g.world.w + .5 - c.x, Math.floor(i / g.world.w) + .5 - c.y) <= 4.5) tiles.push(i);
  const p = planPaint(g.world, 'repair', tiles); p.label = `Restore hole ${h.id} green`;
  return p.tiles.length ? p : null;
}
/** A quoted construction plan built from the actual map, not a flat-price shortcut. */
export function reopenProject(g: Game): EditPlan | null {
  const h = g.world.holes.find(h => !h.open); if (!h) return null;
  const w = g.world, path = holePath(h), cup = center(h.cup), tee = center(h.tee), tiles: TileEdit[] = [];
  for (let i = 0; i < w.terrain.length; i++) {
    const x = i % w.w, y = Math.floor(i / w.w); if (!isOwned(w, x, y)) continue;
    const t = w.terrain[i], c = w.cond[i], tr = w.tree[i];
    if (t === T.BUILDING || t === T.PATH) continue;
    const d = polyDist(x + .5, y + .5, path).d;
    const green = t === T.GREEN && Math.hypot(x + .5 - cup.x, y + .5 - cup.y) <= 4.5;
    const nearTee = Math.hypot(x + .5 - tee.x, y + .5 - tee.y) <= 2;
    if (d > 2.5 && !green && !nearTee) continue;
    let nt = t, nc = c, ntr = tr, cost = 0;
    if (tr) { ntr = 0; cost += CFG.costs.treeRemove; }
    if (d <= 2.5 && t === T.ROUGH) { nt = T.FAIRWAY; nc = 95; cost += CFG.costs.fairway; }
    else if (t <= T.TEE && c < 88) { nc = CFG.turf.repairTo; cost += (CFG.costs.repairBase + CFG.costs.repairPerPoint * (nc - c)) * (t === T.GREEN ? 2 : 1); }
    // Do not automatically erase intentional water or bunkers: unsupported layouts still need an architect.
    if (nt !== t || nc !== c || ntr !== tr) tiles.push({ i, before: { t, c, tr }, after: { t: nt, c: nc, tr: ntr }, cost: cost * g.regionDef.buildMult * constructionFactor(g) });
  }
  return { tool: 'repair', label: `Restore hole ${h.id}`, tiles, cost: Math.ceil(tiles.reduce((s, t) => s + t.cost, 0)) };
}
export interface ProjectOffer { id: string; title: string; description: string; cost: number; xp: number; locked: string | null; plan?: EditPlan; hole?: number; }
export function projectOffers(g: Game): ProjectOffer[] {
  const offers: ProjectOffer[] = [], green = greenProject(g), reopen = reopenProject(g);
  if (green) offers.push({ id: 'green', title: green.label, description: 'Reseed the actual worn tiles. A previously open hole reopens after repair if its layout validates.', cost: green.cost, xp: g.experience.earned.includes(`${g.campaign.stage}:project:green`) ? 0 : 25, locked: null, plan: green, hole: g.world.holes.find(h => h.id === Number(green.label.match(/\d+/)?.[0]) && h.open)?.id });
  if (reopen) {
    const hole = g.world.holes.find(h => !h.open)!.id;
    offers.push({ id: 'reopen', title: reopen.label, description: 'Clear the playing line, reconnect fairway, and restore the turf. The hole reopens if its layout validates.', cost: reopen.cost, xp: g.experience.earned.includes(`${g.campaign.stage}:project:reopen`) ? 0 : 50, locked: null, plan: reopen, hole });
  }
  for (const id of Object.keys(SITE_PROJECTS) as SiteId[]) {
    const p = SITE_PROJECTS[id]; if (g.experience.site[id]) continue;
    offers.push({ id, title: p.name, description: p.description, cost: p.cost, xp: 35, locked: careerLevel(g) < p.level ? `Unlock at ${CAREER[p.level].title} · ${CAREER[p.level].xp} XP` : null });
  }
  return offers;
}
export function commissionProject(g: Game, id: string): boolean {
  const offer = projectOffers(g).find(p => p.id === id);
  if (!offer || offer.locked || g.cash < offer.cost) return false;
  if (offer.plan) {
    if (offer.plan.tiles.length && !g.commitEdit(offer.plan).ok) return false;
    if (offer.hole) g.openHole(offer.hole);
  } else {
    g.spend('construction', offer.cost, offer.title);
    g.experience.site[id as SiteId] = true;
    g.applyRegion();
  }
  awardExperience(g, offer.xp, `${g.campaign.stage}:project:${id}`);
  g.notify('good', `${offer.title} complete. See the results on your course.`);
  g.onFeedback('build');
  return true;
}
export function nextSuggestion(g: Game): { title: string; description: string; action: string } {
  const ready = activeLocation(g).objectives.find(o => !g.campaign.claimed.includes(o.id) && o.value(g) >= o.target);
  if (ready) return { title: 'A restoration reward is ready', description: ready.title, action: 'progress' };
  if (greenProject(g)) return { title: 'Start with the greens', description: 'A reliable putting surface gives golfers a reason to come back.', action: 'projects' };
  if (g.world.holes.some(h => !h.open)) return { title: 'Bring another hole back into play', description: 'More open holes mean more tee times and a better day out.', action: 'projects' };
  if (!g.experience.site.garden) return { title: 'Give your clubhouse a proper welcome', description: 'Add a garden to lift guest satisfaction and make the entrance your own.', action: 'projects' };
  return { title: 'Watch your guests, then refine', description: 'Follow a golfer or test your own holes. Their scores tell you where to improve.', action: 'course' };
}

export function useOperatingReserve(g: Game): boolean {
  if (g.experience.reserveUsed || g.cash >= 150) return false;
  g.experience.reserveUsed = true;
  g.earn('bonus', 650, 'One-time operating reserve'); g.onFeedback('reward'); return true;
}
