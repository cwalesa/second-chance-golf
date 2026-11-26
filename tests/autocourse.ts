// Test helper: lay out a real course on blank land the way a player would (clubhouse, then holes of a chosen
// par mix, each tee near the previous green), open the holes, and place buildings on clear ground near the
// clubhouse. Used by unit tests, the browser checks and balance runs, so they all play a varied, believable course.
import type { Game } from '../src/game';
import { planNewHole } from '../src/editing';
import { suggestClubhouse } from '../src/wilderness';
import { T, holePath, polyDist, idx } from '../src/terrain';
import { Rng } from '../src/rng';
import { ITEMS, ItemKind, buildingProblem, toggleItem } from '../src/items';

const LEN: Record<number, [number, number]> = { 3: [15, 21], 4: [30, 40], 5: [46, 54] };

/** Add one hole of this par, close to the last green. Returns its cost, or null if no spot worked. */
export function addHole(g: Game, par: number, rng: Rng, bend = false): number | null {
  const holes = g.world.holes;
  const club = g.world.clubhouse!;
  const from = holes.length ? holes[holes.length - 1].cup : { x: club.x + 3, y: club.y + 3 };
  for (let attempt = 0; attempt < 5; attempt++) {
    let best: { plan: Exclude<ReturnType<typeof planNewHole>, string>; score: number } | null = null;
    for (let k = 0; k < 400; k++) {
      const r = 4 + rng.next() * 14, a0 = rng.next() * Math.PI * 2;
      const tee = { x: Math.round(from.x + Math.cos(a0) * r), y: Math.round(from.y + Math.sin(a0) * r) };
      const [lo, hi] = LEN[par];
      const L = lo + rng.next() * (hi - lo), a = rng.next() * Math.PI * 2;
      const cup = { x: Math.round(tee.x + Math.cos(a) * L), y: Math.round(tee.y + Math.sin(a) * L) };
      const bends = bend ? [{ x: Math.round((tee.x + cup.x) / 2 - Math.sin(a) * 6), y: Math.round((tee.y + cup.y) / 2 + Math.cos(a) * 6) }] : undefined;
      const plan = planNewHole(g.world, g.nextHoleId(), tee, cup, { par, bends });
      if (typeof plan === 'string') continue;
      let overlap = 0;
      for (const t of plan.tiles) if (t.before.t === T.FAIRWAY || t.before.t === T.BUNKER || t.before.t === T.WATER) overlap++;
      const path = holePath(plan.newHole!);
      let near = 0;
      for (const h of holes) { if (polyDist(h.cup.x, h.cup.y, path).d < 6) near += 10; if (polyDist(h.tee.x, h.tee.y, path).d < 6) near += 10; }
      if (club && polyDist(club.x + 3, club.y + 3, path).d < 8) near += 10;
      const score = overlap * 30 + near * 40 + r * 10;
      if (!best || score < best.score) best = { plan, score };
    }
    if (!best) continue;
    if (g.cash < best.plan.cost) g.cash = best.plan.cost + 1;
    if (!g.commitEdit(best.plan).ok) continue;
    const v = g.openHole(best.plan.newHole!.id);
    if (v.ok) return best.plan.cost;
    g.undo();
  }
  return null;
}

/** A clubhouse and a set of open holes. `cash` tops the account up so construction never fails a test. */
export function autoCourse(g: Game, pars: number[], seed = 1, cash = 400000): void {
  if (!g.world.clubhouse) g.buildClubhouse(suggestClubhouse(g.world)!);
  g.tutorial.done = true;
  g.cash = cash;
  const rng = new Rng(seed * 7 + 1);
  pars.forEach((p, i) => addHole(g, p, rng, i === 2));
  // building a later hole can touch an earlier one and close it for work: open everything that is ready
  for (const h of g.world.holes) if (!h.open && g.validate(h.id).ok) g.openHole(h.id);
  g.settings.open = true;
  g.settings.paused = false;
  g.designMode = false;
}

/** Put a building on the nearest clear ground to the clubhouse (or to a point). Returns its top-left tile or null. */
export function placeNear(g: Game, k: ItemKind, near?: { x: number; y: number }): { x: number; y: number } | null {
  const c = near ?? { x: g.world.clubhouse!.x + 3, y: g.world.clubhouse!.y + 3 };
  const d = ITEMS[k];
  if (g.cash < d.cost) g.cash = d.cost + 1;
  for (let r = 4; r < 40; r++)
    for (let a = 0; a < 24; a++) {
      const x = Math.round(c.x + Math.cos((a / 24) * Math.PI * 2) * r), y = Math.round(c.y + Math.sin((a / 24) * Math.PI * 2) * r);
      if (x < 2 || y < 2 || x + (d.w ?? 1) >= g.world.w - 2 || y + (d.h ?? 1) >= g.world.h - 2) continue;
      if (buildingProblem(g.world, x, y, k)) continue;
      // keep it out of the way of play: nothing of a hole's fairway within the footprint and a tile around it
      let clear = true;
      for (let yy = y - 1; yy <= y + (d.h ?? 1) && clear; yy++) for (let xx = x - 1; xx <= x + (d.w ?? 1); xx++) { const t = g.world.terrain[idx(g.world, xx, yy)]; if (t === T.FAIRWAY || t === T.GREEN || t === T.TEE) { clear = false; break; } }
      if (!clear) continue;
      if (toggleItem(g, { x, y }, k).ok) return { x, y };
    }
  return null;
}
