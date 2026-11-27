// The opening hole: a deliberately designed, beginner-friendly par 4 laid out beside the clubhouse on every new course.
//
// It is sized from the clubs a player actually swings in a round of their own (owner.ts): the driver carries up to
// 25 tiles (250 yards), the iron 17, the wedge 8. So the hole runs about 34 to 38 tiles (340 to 380 yards):
//  - a good drive finishes in a wide landing area about two thirds of the way down, leaving 110 to 150 yards;
//  - that approach is an iron to a green a little bigger than usual, guarded by one bunker on one side only;
//  - nobody reaches the green from the tee with the starter driver, so it plays as a true par 4.
// Light rough (a mown first cut) borders the fairway, trees frame the hole beyond it, and a small fairway bunker sits
// outside the landing area: something to notice and aim away from, not a trap. The tutorial teaches the game on it.
import { CFG } from './config';
import { applyPlan, planNewHole } from './editing';
import { reserveLots, lotKindAt } from './lots';
import { Hole, Pt, T, World, center, computeZones, holePath, idx, inBounds, isOwned, polyDist } from './terrain';
import { placeClubhouse, suggestClubhouse } from './wilderness';

export const OPENING = {
  /** route length in tiles (10 yards each) */
  minLen: 34,
  maxLen: 38,
  /** how far along the route the landing area sits (the driver carries up to 25 tiles) */
  landingAt: 23,
  landingRadius: 4.6,
  /** fairway half-width elsewhere, and the green's radius */
  fairway: 2.6,
  green: 3.1,
  /** the mown first cut beside the fairway, and how far trees are cleared from the line */
  firstCut: 2.2,
  clear: 6.5,
};

export interface OpeningPlan { tee: Pt; cup: Pt; landing: Pt }

/** Where the opening hole goes: from a tee a short walk from the clubhouse door, straight down the clearest, driest line. */
export function findOpening(world: World): OpeningPlan | null {
  const c = world.clubhouse;
  if (!c) return null;
  const door = { x: c.x + 3.5, y: c.y + 2.5 };
  const bad = (x: number, y: number) => {
    if (!inBounds(world, x, y) || !isOwned(world, x, y)) return true;
    const t = world.terrain[idx(world, x, y)];
    return t === T.WATER || t === T.PATH || t === T.BUILDING || t === T.BRIDGE || lotKindAt(world, x, y) !== null;
  };
  let best: OpeningPlan | null = null, bestScore = -Infinity;
  for (let ty = 4; ty < world.h - 4; ty += 2)
    for (let tx = 4; tx < world.w - 4; tx += 2) {
      const dd = Math.hypot(tx - door.x, ty - door.y);
      if (dd < 9 || dd > 18) continue;
      for (let a = 0; a < 32; a++) {
        const ang = (a / 32) * Math.PI * 2;
        const len = OPENING.minLen + (a % 5);
        const cup = { x: Math.round(tx + Math.cos(ang) * len), y: Math.round(ty + Math.sin(ang) * len) };
        if (cup.x < 8 || cup.y < 8 || cup.x > world.w - 9 || cup.y > world.h - 9) continue;
        // the hole should lead away from the clubhouse, not back across its lawn
        if (Math.hypot(cup.x - door.x, cup.y - door.y) < dd + 14) continue;
        let ok = true, trees = 0, water = 0;
        const steps = 40;
        for (let k = 0; k <= steps && ok; k++) {
          const px = tx + ((cup.x - tx) * k) / steps, py = ty + ((cup.y - ty) * k) / steps;
          const along = (len * k) / steps;
          const half = Math.abs(along - OPENING.landingAt) < OPENING.landingRadius + 1 ? OPENING.landingRadius + 1.5 : 4;
          for (let y = Math.floor(py - half); y <= py + half && ok; y++)
            for (let x = Math.floor(px - half); x <= px + half; x++) {
              if (Math.hypot(x + 0.5 - px, y + 0.5 - py) > half) continue;
              if (bad(x, y)) { ok = false; break; }
              if (k % 4 === 0 && world.tree[idx(world, x, y)]) trees++;
            }
        }
        if (!ok) continue;
        // a pond a little way off the line is scenery; count it as a bonus
        for (let y = cup.y - 12; y <= cup.y + 12; y += 2) for (let x = cup.x - 12; x <= cup.x + 12; x += 2) if (inBounds(world, x, y) && world.terrain[idx(world, x, y)] === T.WATER && Math.hypot(x - cup.x, y - cup.y) > 6) water++;
        const score = -trees * 0.3 + Math.min(8, water) - dd * 0.3;
        if (score > bestScore) {
          bestScore = score;
          const f = OPENING.landingAt / len;
          best = { tee: { x: tx, y: ty }, cup, landing: { x: tx + (cup.x - tx) * f, y: ty + (cup.y - ty) * f } };
        }
      }
    }
  return best;
}

/** Lay the opening hole into the world as hole 1, open and in fine condition. Returns the hole, or null if no line fits. */
export function layOpening(world: World): { hole: Hole; plan: OpeningPlan } | null {
  const plan = findOpening(world);
  if (!plan) return null;
  const built = planNewHole(world, 1, plan.tee, plan.cup, { par: 4 });
  if (typeof built === 'string') return null;
  applyPlan(world, built, 'do');
  const hole = world.holes.find((h) => h.id === 1)!;
  hole.open = true;
  const path = holePath(hole);
  const cup = center(hole.cup), land = plan.landing;
  // the shape of the hole, tile by tile, within a box around it
  const box = { x0: Math.max(0, Math.min(plan.tee.x, plan.cup.x) - 12), y0: Math.max(0, Math.min(plan.tee.y, plan.cup.y) - 12), x1: Math.min(world.w - 1, Math.max(plan.tee.x, plan.cup.x) + 12), y1: Math.min(world.h - 1, Math.max(plan.tee.y, plan.cup.y) + 12) };
  const dirx = (plan.cup.x - plan.tee.x) / Math.hypot(plan.cup.x - plan.tee.x, plan.cup.y - plan.tee.y), diry = (plan.cup.y - plan.tee.y) / Math.hypot(plan.cup.x - plan.tee.x, plan.cup.y - plan.tee.y);
  // which side the hazards go: away from the clubhouse, so a miss toward it stays safe
  const club = world.clubhouse!;
  const side = Math.sign((club.x + 3 - plan.tee.x) * diry - (club.y + 2 - plan.tee.y) * dirx) || 1;
  for (let y = box.y0; y <= box.y1; y++)
    for (let x = box.x0; x <= box.x1; x++) {
      const i = idx(world, x, y);
      const t = world.terrain[i];
      if (t === T.WATER || t === T.PATH || t === T.BUILDING || t === T.BRIDGE || !isOwned(world, x, y)) continue;
      if (lotKindAt(world, x, y) !== null) continue;
      const px = x + 0.5, py = y + 0.5;
      const d = polyDist(px, py, path);
      const toCup = Math.hypot(px - cup.x, py - cup.y);
      const toLand = Math.hypot(px - land.x, py - land.y);
      const nearTee = Math.hypot(px - (plan.tee.x + 0.5), py - (plan.tee.y + 0.5)) < 2;
      if (t === T.TEE || nearTee) { world.tree[i] = 0; continue; }
      // green: a little bigger than the default, so a beginner's approach has something to hit
      if (toCup <= OPENING.green) { world.terrain[i] = T.GREEN; world.cond[i] = CFG.turf.freshGreen + 6; world.tree[i] = 0; continue; }
      // fairway: generous where drives land, narrower (but fair) toward the green, with an apron in front of it
      const half = toLand < OPENING.landingRadius + 1.5 ? Math.max(OPENING.fairway, OPENING.landingRadius - toLand * 0.15) : OPENING.fairway;
      if (d.d <= half || toLand <= OPENING.landingRadius) { world.terrain[i] = T.FAIRWAY; world.cond[i] = CFG.turf.freshFairway + 4; world.tree[i] = 0; continue; }
      // a mown first cut of light rough around the fairway and green: misses here are easy to play from
      if (d.d <= half + OPENING.firstCut || toCup <= OPENING.green + OPENING.firstCut) { world.terrain[i] = T.ROUGH; world.cond[i] = 82; world.tree[i] = 0; continue; }
      // trees are cleared well away from the line of play; beyond that they frame the hole
      if (d.d <= OPENING.clear) { world.tree[i] = 0; if (t === T.ROUGH) world.cond[i] = Math.max(world.cond[i], 70); }
    }
  // restrained hazards: one bunker beside the green (the far side from the clubhouse), and a small one outside the landing area
  const perp = { x: -diry * side, y: dirx * side };
  const sand = (cx: number, cy: number, r: number) => {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++)
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        if (!inBounds(world, x, y) || Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
        const i = idx(world, x, y);
        if (world.terrain[i] !== T.ROUGH) continue;
        world.terrain[i] = T.BUNKER; world.cond[i] = 100; world.tree[i] = 0;
      }
  };
  sand(cup.x + perp.x * (OPENING.green + 1.6) + dirx * 0.5, cup.y + perp.y * (OPENING.green + 1.6) + diry * 0.5, 1.6);
  sand(land.x + perp.x * (OPENING.landingRadius + 2.2) + dirx * 2.5, land.y + perp.y * (OPENING.landingRadius + 2.2) + diry * 2.5, 1.4);
  for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) world.dirty.add(idx(world, x, y));
  computeZones(world);
  world.version++;
  return { hole, plan };
}

/** A new course's starting point: the clubhouse on the best spot in the starting block, its lots, and the opening par 4. */
export function setUpOpening(world: World): { hole: Hole; plan: OpeningPlan } | null {
  if (!world.clubhouse) {
    const spot = suggestClubhouse(world);
    if (!spot || placeClubhouse(world, spot)) return null;
    reserveLots(world);
  }
  if (world.holes.length) return null;
  const res = layOpening(world);
  // the hole's ground may now cover a lot reserved for the putting green or range: settle them now, so the course is
  // already exactly what it will be when it is saved and loaded again
  if (res) reserveLots(world);
  return res;
}
