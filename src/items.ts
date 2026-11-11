import type { Game } from './game';
import { T, Pt, World, inBounds, idx } from './terrain';

/**
 * Things the player places on the course one at a time: flower beds, shrubs, benches, lamps,
 * ball washers, fountains and statues. They make the course prettier; golfers who play a hole
 * with a few of them around the tee or green enjoy it more.
 */
export type ItemKind = 'flowers' | 'shrub' | 'bench' | 'lamp' | 'washer' | 'fountain' | 'statue';
export interface Item { x: number; y: number; k: ItemKind }

export const ITEMS: Record<ItemKind, { label: string; cost: number; beauty: number; hint: string }> = {
  flowers: { label: 'Flowers', cost: 40, beauty: 1, hint: 'A bed of flowers. Tap to plant; tap one again to remove it.' },
  shrub: { label: 'Shrub', cost: 30, beauty: 1, hint: 'A low shrub to frame a tee or a path.' },
  bench: { label: 'Bench', cost: 120, beauty: 1, hint: 'Somewhere to sit while the group ahead plays.' },
  lamp: { label: 'Lamp', cost: 90, beauty: 1, hint: 'A lamp post for paths and the clubhouse.' },
  washer: { label: 'Ball wash', cost: 80, beauty: 1, hint: 'Golfers like a clean ball. Best beside a tee.' },
  fountain: { label: 'Fountain', cost: 600, beauty: 4, hint: 'A stone fountain. A centrepiece by the clubhouse or a green.' },
  statue: { label: 'Statue', cost: 450, beauty: 3, hint: 'A bronze golfer on a plinth. Everyone wants a photo.' },
};
export const ITEM_KINDS = Object.keys(ITEMS) as ItemKind[];

export const itemAt = (w: World, x: number, y: number) => (w.items ?? []).findIndex((it) => it.x === x && it.y === y);

/** Why an item cannot go on this tile, or null when it can. */
export function itemProblem(w: World, x: number, y: number): string | null {
  if (!inBounds(w, x, y)) return 'Off the map.';
  const t = w.terrain[idx(w, x, y)];
  if (t === T.WATER) return 'Not in the water.';
  if (t === T.GREEN || t === T.TEE) return 'Not on a green or tee: golfers play there.';
  if (t === T.FAIRWAY) return 'Not on the fairway: put it in the rough beside it.';
  if (t === T.BUILDING || t === T.BRIDGE) return 'There is no room there.';
  return null;
}

/** Place an item, or take away the one already on this tile (with a refund). Returns what happened. */
export function toggleItem(g: Game, at: Pt, kind: ItemKind): { ok: boolean; removed?: boolean; message?: string } {
  const w = g.world;
  w.items ??= [];
  const i = itemAt(w, at.x, at.y);
  if (i >= 0) {
    const it = w.items[i];
    w.items.splice(i, 1);
    g.cash += ITEMS[it.k].cost;
    g.today.construction -= ITEMS[it.k].cost;
    w.version++;
    g.dirtySave = true;
    return { ok: true, removed: true };
  }
  const why = itemProblem(w, at.x, at.y);
  if (why) return { ok: false, message: why };
  const cost = ITEMS[kind].cost;
  if (g.cash < cost) return { ok: false, message: `${ITEMS[kind].label} costs $${cost}.` };
  g.cash -= cost;
  g.today.construction += cost;
  w.tree[idx(w, at.x, at.y)] = 0;
  w.dirty.add(idx(w, at.x, at.y));
  w.items.push({ x: at.x, y: at.y, k: kind });
  w.version++;
  g.dirtySave = true;
  return { ok: true };
}

/** Beauty near a point: the sum of the items within a few tiles. */
export function beautyNear(w: World, p: Pt, r = 7): number {
  let b = 0;
  for (const it of w.items ?? []) if (Math.hypot(it.x - p.x, it.y - p.y) <= r) b += ITEMS[it.k].beauty;
  return b;
}
