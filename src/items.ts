import type { Game } from './game';
import { T, Pt, World, inBounds, idx } from './terrain';
import { CFG } from './config';

/**
 * Things the player places on the course one at a time: flower beds, shrubs, benches, lamps,
 * ball washers, fountains and statues. They make the course prettier; golfers who play a hole
 * with a few of them around the tee or green enjoy it more.
 */
export type ItemKind = 'flowers' | 'shrub' | 'bench' | 'lamp' | 'washer' | 'fountain' | 'statue' | 'halfway' | 'barn' | 'shed' | 'puttingGreen' | 'range';
export interface Item { x: number; y: number; k: ItemKind }

export interface ItemDef { label: string; cost: number; beauty: number; hint: string; /** footprint in tiles, for buildings */ w?: number; h?: number; max?: number; /** dollars per day */ upkeep?: number }
export const ITEMS: Record<ItemKind, ItemDef> = {
  flowers: { label: 'Flowers', cost: 40, beauty: 1, hint: 'A bed of flowers. Tap to plant; tap one again to remove it.' },
  shrub: { label: 'Shrub', cost: 30, beauty: 1, hint: 'A low shrub to frame a tee or a path.' },
  bench: { label: 'Bench', cost: 120, beauty: 1, hint: 'Somewhere to sit while the group ahead plays.' },
  lamp: { label: 'Lamp', cost: 90, beauty: 1, hint: 'A lamp post for paths and the clubhouse.' },
  washer: { label: 'Ball wash', cost: 80, beauty: 1, hint: 'Golfers like a clean ball. Best beside a tee.' },
  fountain: { label: 'Fountain', cost: 600, beauty: 4, hint: 'A stone fountain. A centrepiece by the clubhouse or a green.' },
  statue: { label: 'Statue', cost: 450, beauty: 3, hint: 'A bronze golfer on a plinth. Everyone wants a photo.' },
  halfway: { label: 'Halfway house', cost: 3200, beauty: 2, w: 3, h: 2, max: 2, upkeep: 6, hint: 'A snack hut between nines. Golfers spend about 18% more at the clubhouse and shop. A second one adds more.' },
  barn: { label: 'Cart barn', cost: 4500, beauty: 1, w: 4, h: 2, max: 1, upkeep: 5, hint: 'Shelter for the cart fleet. Raises the most carts you can own from 6 to 16 and parks them in view.' },
  puttingGreen: { label: 'Putting green', cost: CFG.upgrades.puttingGreen.cost, beauty: 1, w: 4, h: 3, max: 1, hint: 'A practice green for warm-ups. Guests rate their day higher. Its upkeep is part of your hourly costs.' },
  range: { label: 'Driving range', cost: CFG.upgrades.range.cost, beauty: 0, w: 7, h: 3, max: 1, hint: 'Hitting mats and target greens. Draws about 15% more golfers. Its upkeep is part of your hourly costs.' },
  shed: { label: 'Maintenance shed', cost: 3800, beauty: 0, w: 3, h: 2, max: 1, upkeep: 8, hint: 'Mowers and tools kept close. Turf wears about 15% more slowly across the course.' },
};
export const BUILDING_KINDS: ItemKind[] = ['halfway', 'barn', 'shed', 'puttingGreen', 'range'];
/** Improvements that used to be bought from the Finances panel and are now placed on the property. Owning one means it stands somewhere. */
export const AMENITY_KINDS = ['puttingGreen', 'range'] as const;
export const isAmenity = (k: ItemKind): k is (typeof AMENITY_KINDS)[number] => (AMENITY_KINDS as readonly string[]).includes(k);
export const isBuilding = (k: ItemKind) => !!ITEMS[k].w;
export const CART_PRICE = 450;
export const FLEET_BASE = 6;
export const FLEET_WITH_BARN = 16;
export const ITEM_KINDS = Object.keys(ITEMS) as ItemKind[];

export const itemAt = (w: World, x: number, y: number) =>
  (w.items ?? []).findIndex((it) => {
    const d = ITEMS[it.k];
    return x >= it.x && y >= it.y && x < it.x + (d.w ?? 1) && y < it.y + (d.h ?? 1);
  });
export const countOf = (w: World, k: ItemKind) => (w.items ?? []).filter((it) => it.k === k).length;

/** Why a building cannot stand with its top-left tile here, or null when it can. */
export function buildingProblem(w: World, x: number, y: number, k: ItemKind): string | null {
  const d = ITEMS[k];
  if (countOf(w, k) >= (d.max ?? 99)) return d.max === 1 ? `You already have a ${d.label.toLowerCase()}.` : `You can have ${d.max} of these.`;
  for (let yy = y; yy < y + (d.h ?? 1); yy++)
    for (let xx = x; xx < x + (d.w ?? 1); xx++) {
      const why = itemProblem(w, xx, yy);
      if (why) return why.startsWith('Not on the fairway') ? 'Fairway is for golfers. Pick rough beside it.' : why;
      if (itemAt(w, xx, yy) >= 0) return 'Something is already there.';
      if (isAmenity(k) && w.terrain[idx(w, xx, yy)] === T.PATH) return 'Keep it off the paths and the clubhouse forecourt.';
    }
  return null;
}
/** Daily running cost of all placed buildings. */
export const buildingUpkeep = (w: World) => (w.items ?? []).reduce((a, it) => a + (ITEMS[it.k].upkeep ?? 0), 0);

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
  if (isBuilding(kind) && itemAt(w, at.x, at.y) < 0) {
    const why = buildingProblem(w, at.x, at.y, kind);
    if (why) return { ok: false, message: why };
    const d = ITEMS[kind];
    if (g.cash < d.cost) return { ok: false, message: `${d.label} costs $${d.cost.toLocaleString('en-US')}.` };
    g.cash -= d.cost;
    g.today.construction += d.cost;
    for (let yy = at.y; yy < at.y + (d.h ?? 1); yy++) for (let xx = at.x; xx < at.x + (d.w ?? 1); xx++) { w.tree[idx(w, xx, yy)] = 0; w.dirty.add(idx(w, xx, yy)); }
    w.items.push({ x: at.x, y: at.y, k: kind });
    w.version++;
    if (isAmenity(kind)) g.upgrades[kind] = true; // the improvement exists once it is standing; its benefits and upkeep follow
    g.logEntry(`Built ${d.label.toLowerCase()}`, -d.cost);
    g.applyRegion();
    g.dirtySave = true;
    return { ok: true };
  }
  const i = itemAt(w, at.x, at.y);
  if (i >= 0) {
    const it = w.items[i];
    w.items.splice(i, 1);
    g.cash += ITEMS[it.k].cost;
    g.today.construction -= ITEMS[it.k].cost;
    if (isBuilding(it.k)) { if (isAmenity(it.k)) g.upgrades[it.k] = false; g.logEntry(`Sold ${ITEMS[it.k].label.toLowerCase()}`, ITEMS[it.k].cost); g.fleet = Math.min(g.fleet, g.maxFleet); g.applyRegion(); }
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
