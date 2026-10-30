import { Game } from '../src/game';
import { CFG } from '../src/config';
import { planPaint } from '../src/editing';
import { T, holePath, idx, polyDist } from '../src/terrain';

export const DT = CFG.sim.dt;
export function run(g: Game, seconds: number) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) g.step(DT);
}
/** Tiles of a given terrain within a rectangle. */
export function tilesIn(g: Game, x0: number, y0: number, x1: number, y1: number, pred: (i: number) => boolean = () => true) {
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (pred(idx(g.world, x, y))) out.push(idx(g.world, x, y));
  return out;
}
/** Repair every worn tile around hole 2's green. */
export function repairGreen2(g: Game) {
  const tiles = tilesIn(g, 56, 24, 65, 33, (i) => g.world.terrain[i] === T.GREEN);
  const plan = planPaint(g.world, 'repair', tiles);
  return { plan, res: g.commitEdit(plan) };
}
/** Everything needed to make hole 3 playable: clear trees, bridge the fairway gap, repair tee and green, open. */
export function restoreHole3(g: Game) {
  const w = g.world;
  const h = g.hole(3);
  const path = holePath(h);
  const near: number[] = [];
  const gap: number[] = [];
  for (let y = 0; y < w.h; y++)
    for (let x = 0; x < w.w; x++) {
      const d = polyDist(x + 0.5, y + 0.5, path);
      if (d.d > 2.4) continue;
      const i = idx(w, x, y);
      near.push(i);
      const f = d.s / d.total;
      if (f > 0.36 && f < 0.62 && w.terrain[i] === T.ROUGH) gap.push(i);
    }
  const results = [
    g.commitEdit(planPaint(w, 'treeDel', near.filter((i) => w.tree[i] === 1))),
    g.commitEdit(planPaint(w, 'fairway', gap)),
    g.commitEdit(planPaint(w, 'repair', near)),
  ];
  return results;
}
export { CFG, T };
