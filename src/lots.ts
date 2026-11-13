import { T, Pt, World, idx, inBounds } from './terrain';
import { AMENITY_KINDS, ITEMS } from './items';
import type { ItemKind } from './items';

/**
 * Dedicated space for the practice putting green and the driving range, kept near the clubhouse from the day it
 * is built. A lot is clear ground that nothing else may be placed on, marked on the map until the amenity stands
 * there, and the spot the amenity snaps to when the player chooses it. Lots are saved with the course.
 */
export type LotKind = (typeof AMENITY_KINDS)[number];
export const LOT_LABEL: Record<LotKind, string> = { puttingGreen: 'Putting green', range: 'Driving range' };

const size = (k: ItemKind) => ({ w: ITEMS[k].w ?? 1, h: ITEMS[k].h ?? 1 });
const built = (w: World, k: LotKind) => (w.items ?? []).some((it) => it.k === k);
const overlaps = (a: Pt, as: { w: number; h: number }, b: Pt, bs: { w: number; h: number }, gap = 0) =>
  a.x < b.x + bs.w + gap && b.x < a.x + as.w + gap && a.y < b.y + bs.h + gap && b.y < a.y + as.h + gap;

/** Can this lot's ground still take the amenity: open rough, no hole's ground, nothing built on it. */
export function lotUsable(w: World, k: LotKind, at: Pt): boolean {
  const s = size(k);
  for (let y = at.y; y < at.y + s.h; y++)
    for (let x = at.x; x < at.x + s.w; x++) {
      if (x < 1 || y < 1 || x >= w.w - 1 || y >= w.h - 1) return false;
      const i = idx(w, x, y);
      if (w.terrain[i] !== T.ROUGH || w.zone[i] !== 0) return false;
    }
  for (const it of w.items ?? []) if (it.k !== k && overlaps(at, s, it, size(it.k))) return false;
  return true;
}

/** The nearest usable ground to the clubhouse that does not touch the other lot. */
function findSpot(w: World, k: LotKind, taken: { at: Pt; k: LotKind }[]): Pt | null {
  const c = w.clubhouse;
  if (!c) return null;
  const s = size(k);
  const cx = c.x + 3.5, cy = c.y + 2.5;
  const spots: { x: number; y: number; d: number }[] = [];
  for (let y = c.y - 12; y <= c.y + 22; y++)
    for (let x = c.x - 12; x <= c.x + 28; x++) {
      // ground behind the clubhouse (up the screen) is hidden by it, so prefer ground in front or beside it
      const behind = x + s.w / 2 + y + s.h / 2 < cx + cy ? 9 : 0;
      spots.push({ x, y, d: Math.hypot(x + s.w / 2 - cx, y + s.h / 2 - cy) + behind });
    }
  spots.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  const club = { x: c.x - 3, y: c.y - 3 }, clubSize = { w: 14, h: 12 }; // the clubhouse, its lawn and its entrance road
  for (const p of spots) {
    if (!inBounds(w, p.x, p.y)) continue;
    if (overlaps(p, s, club, clubSize)) continue;
    if (taken.some((t) => overlaps(p, s, t.at, size(t.k), 1))) continue;
    if (lotUsable(w, k, p)) return { x: p.x, y: p.y };
  }
  return null;
}

/** Give every amenity that is not standing a lot, replacing any whose ground was built over. Clears the trees on new lots. */
export function reserveLots(w: World): void {
  if (!w.clubhouse) return;
  w.lots ??= {};
  for (const k of AMENITY_KINDS) {
    const lot = w.lots[k];
    if (built(w, k)) { delete w.lots[k]; continue; }
    if (lot && lotUsable(w, k, lot)) continue;
    delete w.lots[k];
    const taken = AMENITY_KINDS.filter((o) => o !== k && w.lots![o]).map((o) => ({ at: w.lots![o]!, k: o }));
    const spot = findSpot(w, k, taken);
    if (!spot) continue;
    w.lots[k] = spot;
    const s = size(k);
    for (let y = spot.y; y < spot.y + s.h; y++) for (let x = spot.x; x < spot.x + s.w; x++) { w.tree[idx(w, x, y)] = 0; w.dirty.add(idx(w, x, y)); }
    w.version++;
  }
}

/** Where this amenity goes, or null when it already stands or no space was left. */
export function lotFor(w: World, k: LotKind): Pt | null {
  reserveLots(w);
  return w.lots?.[k] ?? null;
}

/** Which unbuilt lot, if any, covers this tile. */
export function lotKindAt(w: World, x: number, y: number): LotKind | null {
  if (!w.lots) return null;
  for (const k of AMENITY_KINDS) {
    const l = w.lots[k];
    if (!l || built(w, k)) continue;
    const s = size(k);
    if (x >= l.x && y >= l.y && x < l.x + s.w && y < l.y + s.h) return k;
  }
  return null;
}
