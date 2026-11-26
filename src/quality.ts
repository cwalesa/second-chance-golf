// Hole quality: what a hole is like to play, for whom, and what would make it better.
//
// The layout report (design.ts) reads the ground: corridor, trees, water, bunkers, bends. This module adds what only
// the whole course and real play can tell: whether the length suits the par, whether the hole repeats another one,
// how far golfers walk to reach it, whether it crowds a neighbour, how it is wearing, and how golfers actually scored,
// splashed and waited on it. Each kind of golfer weighs those things differently, so the same hole can delight a
// skilled player and frustrate a beginner, and a harder hole never scores better by being harder.
import { CFG, GolferType } from './config';
import { assessDesign } from './design';
import { beautyNear } from './items';
import { Hole, HolePlay, PAR_YARDS, PlaySummary, T, World, center, holeBends, holeCondition, holePath, holeYards, polyDist } from './terrain';

export type Segment = 'beginner' | 'regular' | 'skilled' | 'resort';
export const SEGMENTS: Segment[] = ['beginner', 'regular', 'skilled', 'resort'];
export const SEGMENT_LABEL: Record<Segment, string> = { beginner: 'Beginners', regular: 'Regulars', skilled: 'Skilled players', resort: 'Resort visitors' };

export interface Parts {
  /** length suits the par */
  length: number;
  /** different from the other holes */
  variety: number;
  /** choices: a dogleg, a guarded green, a hazard with a way around it */
  strategy: number;
  /** room to land, and misses that can be recovered */
  landing: number;
  /** hazards flank the play rather than block it */
  hazards: number;
  scenery: number;
  condition: number;
  /** a short walk from the previous green */
  walking: number;
  /** little waiting on the tee */
  pace: number;
  /** clear of other holes' landing areas */
  safety: number;
}
export const PART_LABEL: Record<keyof Parts, string> = { length: 'Length for par', variety: 'Variety', strategy: 'Strategy', landing: 'Landing room', hazards: 'Hazard placement', scenery: 'Scenery', condition: 'Turf', walking: 'Walk from last green', pace: 'Pace', safety: 'Safety' };

export interface HoleQuality {
  parts: Parts;
  appeal: Record<Segment, number>;
  /** blended for this course's actual mix of golfers */
  overall: number;
  strengths: string[];
  weakness: string;
  likes: Segment[];
  dislikes: Segment[];
  suggestion: string;
  /** near-identical holes elsewhere on the course */
  twins: number[];
  recent: PlaySummary;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const W: Record<Segment, Partial<Record<keyof Parts, number>>> = {
  // forgiveness first, and a hole that is not a slog
  beginner: { landing: 0.34, length: 0.12, condition: 0.14, scenery: 0.1, pace: 0.12, hazards: 0.1, walking: 0.08 },
  // variety, condition and pace (price is judged on the round, not the hole)
  regular: { variety: 0.22, condition: 0.24, pace: 0.2, length: 0.1, scenery: 0.1, landing: 0.08, walking: 0.06 },
  // interesting shot choices and proper length; a flat, wide, featureless hole bores them
  skilled: { strategy: 0.38, hazards: 0.18, length: 0.16, condition: 0.16, variety: 0.12 },
  // the view, the turf, and an easy day out
  resort: { scenery: 0.46, condition: 0.2, landing: 0.14, walking: 0.1, pace: 0.1 },
};

/** Recent plays summarised: strokes over par, water and sand per play, seconds waited, share picked up. */
export function summarisePlays(log: HolePlay[] | undefined, quality = 0): PlaySummary {
  const l = log ?? [];
  const n = l.length;
  const byKind: PlaySummary['byKind'] = {};
  const counts: Partial<Record<HolePlay['k'], number>> = {};
  for (const p of l) { byKind[p.k] = (byKind[p.k] ?? 0) + p.d; counts[p.k] = (counts[p.k] ?? 0) + 1; }
  for (const k of Object.keys(byKind) as HolePlay['k'][]) byKind[k] = byKind[k]! / counts[k]!;
  const avg = (f: (p: HolePlay) => number) => (n ? l.reduce((s, p) => s + f(p), 0) / n : 0);
  return { n, over: avg((p) => p.d), water: avg((p) => p.w), sand: avg((p) => p.s), wait: avg((p) => p.t), picked: avg((p) => p.p), quality, byKind };
}

/** Two holes that play alike: the same par, nearly the same length, both straight. Repeats earn less and less. */
export function isTwin(a: Hole, b: Hole): boolean {
  if (a.id === b.id || a.par !== b.par) return false;
  if (Math.abs(holeYards(a) - holeYards(b)) > 25) return false;
  const bentA = holeBends(a).length > 0, bentB = holeBends(b).length > 0;
  return !bentA && !bentB;
}
export function twinsOf(holes: Hole[], h: Hole): number[] {
  return holes.filter((x) => x.open && isTwin(h, x)).map((x) => x.id);
}
/**
 * How much each open hole counts toward the course's reputation: a distinct hole counts fully; each repeat of a hole
 * already counted counts for less (1, then 0.6, then 0.35...). Twelve copies of the same short par 3 are not twelve holes.
 */
export function effectiveHoles(holes: Hole[]): number {
  const open = holes.filter((h) => h.open).sort((a, b) => a.id - b.id);
  let sum = 0;
  open.forEach((h, i) => {
    const earlier = open.slice(0, i).filter((x) => isTwin(h, x)).length;
    sum += earlier === 0 ? 1 : Math.pow(0.6, earlier);
  });
  return sum;
}

/** Ground-only parts of the score, cached per layout. */
interface LayoutParts { length: number; strategy: number; landing: number; hazards: number; scenery: number; inPlay: number; flank: number; }
const layoutCache = new WeakMap<World, Map<number, { v: number; key: string; r: LayoutParts }>>();
function layoutParts(w: World, h: Hole): LayoutParts {
  let m = layoutCache.get(w);
  if (!m) layoutCache.set(w, (m = new Map()));
  const v = w.version - (w.wearBumps ?? 0);
  const key = `${h.par}:${h.tee.x},${h.tee.y}:${h.cup.x},${h.cup.y}:${JSON.stringify(h.bends ?? h.bend)}:${(w.items ?? []).length}`;
  const hit = m.get(h.id);
  if (hit && hit.v === v && hit.key === key) return hit.r;
  const d = assessDesign(w, h);
  const yards = holeYards(h);
  const [lo, hi] = PAR_YARDS[h.par] ?? PAR_YARDS[4];
  const mid = (lo + hi) / 2;
  // inside the band is good, the heart of it is best; outside falls off quickly
  const length = clamp(yards < lo ? 70 - (lo - yards) * 0.9 : yards > hi ? 70 - (yards - hi) * 0.7 : 100 - (Math.abs(yards - mid) / ((hi - lo) / 2)) * 30);
  // hazards in the middle of the corridor block play; hazards beside it shape decisions
  const path = holePath(h);
  let inPlay = 0, flank = 0;
  for (let i = 0; i < w.terrain.length; i++) {
    if (w.zone[i] !== h.id) continue;
    const t = w.terrain[i];
    if (t !== T.WATER && t !== T.BUNKER) continue;
    const dist = polyDist((i % w.w) + 0.5, Math.floor(i / w.w) + 0.5, path).d;
    if (dist < 1.3) inPlay++;
    else if (dist < 5.5) flank++;
  }
  const hazards = clamp(inPlay + flank === 0 ? 45 : 55 + Math.min(35, flank * 1.6) - inPlay * 3.5 - Math.max(0, flank - 30) * 1.2);
  const beauty = beautyNear(w, h.tee) + beautyNear(w, h.cup);
  // decorations help, with sharply diminishing returns: a few well-placed things matter, a carpet of them does not
  const scenery = clamp(d.scenery * 0.8 + 20 * (1 - Math.exp(-beauty / 5)));
  const r: LayoutParts = { length, strategy: d.strategy, landing: d.forgiveness, hazards, scenery, inPlay, flank };
  m.set(h.id, { v, key, r });
  return r;
}

/** The open holes in the order golfers play them (route order is by id). */
const playOrder = (w: World) => w.holes.filter((h) => h.open).sort((a, b) => a.id - b.id);

/** Course-level parts: variety, the walk from the previous green, and how close other holes' play comes. */
function contextParts(w: World, h: Hole, hasCarts: boolean): { variety: number; walking: number; safety: number; twins: number[]; walk: number; nearest: number } {
  const others = w.holes.filter((x) => x.open && x.id !== h.id);
  const twins = twinsOf(w.holes, h);
  // variety: repeats hurt, and so does being the same par as both neighbours
  const order = playOrder(w);
  const at = order.findIndex((x) => x.id === h.id);
  const prev = at > 0 ? order[at - 1] : order.length > 1 && at === 0 ? order[order.length - 1] : null;
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  const samePar = [prev, next].filter((x) => x && x.par === h.par).length;
  const variety = clamp(90 - twins.length * 22 - samePar * 9 + (holeBends(h).length ? 6 : 0));
  // walking: from the previous green (or the clubhouse for the first hole) to this tee
  const from = at > 0 && prev ? center(prev.cup) : w.clubhouse ? { x: w.clubhouse.x + 3, y: w.clubhouse.y + 3 } : center(h.tee);
  const tee = center(h.tee);
  const walk = Math.hypot(from.x - tee.x, from.y - tee.y);
  const walking = clamp(100 - Math.max(0, walk - 10) * (hasCarts ? 1.4 : 2.4));
  // safety: how close another hole's line of play comes to this one's landing area (two thirds of the way down)
  const path = holePath(h);
  const land = path.length > 2 ? path[1] : { x: tee.x + (center(h.cup).x - tee.x) * 0.6, y: tee.y + (center(h.cup).y - tee.y) * 0.6 };
  let nearest = 99;
  for (const o of others) nearest = Math.min(nearest, polyDist(land.x, land.y, holePath(o)).d);
  const safety = clamp(nearest >= 9 ? 100 : 40 + nearest * 6.5);
  return { variety, walking, safety, twins, walk, nearest };
}

/** The share of each kind of golfer on this course lately, for blending appeal into one number. */
export function segmentMix(counts: Partial<Record<Segment, number>> | null): Record<Segment, number> {
  const base: Record<Segment, number> = { beginner: 0.36, regular: 0.36, skilled: 0.14, resort: 0.14 };
  if (!counts) return base;
  const total = SEGMENTS.reduce((s, k) => s + (counts[k] ?? 0), 0);
  if (total < 10) return base;
  const out = {} as Record<Segment, number>;
  for (const k of SEGMENTS) out[k] = 0.5 * base[k] + 0.5 * ((counts[k] ?? 0) / total);
  return out;
}

export interface QualityContext { carts: boolean; mix: Record<Segment, number>; }
const SUGGEST: Record<keyof Parts, (h: Hole, q: Parts, extra: { walk: number; twins: number[]; inPlay: number }) => string> = {
  length: (h) => { const y = holeYards(h), [lo, hi] = PAR_YARDS[h.par]; return y < lo ? `Move the tee back to stretch it toward ${lo}-${hi} yd, or make it a par ${h.par - 1}.` : `Move the tee forward to bring it into ${lo}-${hi} yd, or make it a par ${h.par + 1}.`; },
  variety: (_h, _q, e) => e.twins.length ? `It plays like hole ${e.twins.join(' and ')}. Add a bend, change its length, or change the par so it stands apart.` : 'Give it a turn or a different length from the holes either side of it.',
  strategy: (h) => h.par === 3 ? 'Add a bunker beside the green, on one side only, so the safe miss is the other side.' : 'Add a bend with a bunker on the inside corner: a bold line saves a shot, the wide line is safe.',
  landing: () => 'Widen the fairway where tee shots land, and clear trees from the corridor.',
  hazards: (_h, _q, e) => e.inPlay > 0 ? 'Move hazards out of the middle of the fairway to its edges, so there is always a way around.' : 'A bunker or pond beside the landing area would give golfers something to think about.',
  scenery: () => 'Plant trees beside the hole, or put flowers, a bench or a fountain by the tee or green.',
  condition: () => 'Repair the worn turf, or hire a greenkeeper to keep it up.',
  walking: (_h, _q, e) => `The walk from the previous green is about ${Math.round(e.walk * CFG.grid.yardsPerTile)} yd. Move the tee closer, or add carts and a path.`,
  pace: () => 'Golfers queue here. A ranger, an easier opening shot, or another hole to spread play would help.',
  safety: () => 'Another hole plays right across this landing area. Move a tee or turn one of the holes so they run apart.',
};
const STRENGTH: Record<keyof Parts, string> = {
  length: 'just the right length for its par', variety: 'unlike any other hole here', strategy: 'gives a real choice of shots',
  landing: 'generous landing room', hazards: 'hazards that frame the play', scenery: 'a lovely setting', condition: 'turf in fine shape',
  walking: 'a short walk from the last green', pace: 'rarely a wait on the tee', safety: 'well clear of the other holes',
};
const WEAK: Record<keyof Parts, string> = {
  length: 'the length does not suit the par', variety: 'repeats another hole', strategy: 'offers no decisions', landing: 'tight with little room to miss',
  hazards: 'hazards block the line of play', scenery: 'bare surroundings', condition: 'worn turf', walking: 'a long walk to the tee', pace: 'golfers wait on the tee',
  safety: 'shots from another hole land nearby',
};

const qCache = new WeakMap<World, Map<number, { key: string; q: HoleQuality }>>();
/** The full evaluation of a hole for the report, the golfers' enjoyment and the course rating. */
export function holeQuality(w: World, h: Hole, ctx: QualityContext): HoleQuality {
  let m = qCache.get(w);
  if (!m) qCache.set(w, (m = new Map()));
  const order = playOrder(w).map((x) => `${x.id}:${x.par}:${holeYards(x)}:${holeBends(x).length}`).join(',');
  const key = `${w.version}|${order}|${ctx.carts}|${h.log?.length ?? 0}|${h.log?.[h.log.length - 1]?.day ?? 0}|${JSON.stringify(ctx.mix)}`;
  const hit = m.get(h.id);
  if (hit && hit.key === key) return hit.q;
  const L = layoutParts(w, h);
  const C = contextParts(w, h, ctx.carts);
  const cond = holeCondition(w, h);
  const recent = summarisePlays(h.log);
  // what play shows: lots of water balls and pickups mean misses are not recoverable, whatever the ground looks like
  const playPenalty = recent.n >= 4 ? recent.water * 35 + recent.picked * 60 : 0;
  const pace = clamp(recent.n >= 3 ? 100 - Math.max(0, recent.wait - 8) * 1.6 : 85);
  const parts: Parts = {
    length: L.length,
    variety: C.variety,
    strategy: L.strategy,
    landing: clamp(L.landing - playPenalty),
    hazards: L.hazards,
    scenery: L.scenery,
    condition: clamp(cond.overall),
    walking: C.walking,
    pace,
    safety: C.safety,
  };
  const appeal = {} as Record<Segment, number>;
  for (const s of SEGMENTS) {
    const wts = W[s];
    let sum = 0, tw = 0;
    for (const [k, wt] of Object.entries(wts) as [keyof Parts, number][]) { sum += parts[k] * wt; tw += wt; }
    let a = sum / tw;
    // safety worries everyone a little
    a -= Math.max(0, 70 - parts.safety) * 0.15;
    // beginners struggle with real difficulty: shown by their own scores where there are any
    if (s === 'beginner' && recent.byKind.b !== undefined && recent.n >= 4) a -= Math.max(0, recent.byKind.b - 2) * 8;
    // skilled players are bored by a hole that offers nothing to think about, however pretty
    if (s === 'skilled' && parts.strategy < 45) a -= (45 - parts.strategy) * 0.5;
    appeal[s] = clamp(a);
  }
  const overall = clamp(SEGMENTS.reduce((s, k) => s + appeal[k] * ctx.mix[k], 0));
  const keys = Object.keys(parts) as (keyof Parts)[];
  // the weakness that matters most to the golfers who actually come: weight each part by how much this mix cares about it
  const care = (k: keyof Parts) => SEGMENTS.reduce((s, seg) => s + (W[seg][k] ?? 0) * ctx.mix[seg], 0) + 0.04;
  const worst = [...keys].sort((a, b) => (parts[a] - 100) * care(a) - (parts[b] - 100) * care(b))[0];
  const strengths = [...keys].filter((k) => parts[k] >= 78).sort((a, b) => parts[b] * care(b) - parts[a] * care(a)).slice(0, 3).map((k) => STRENGTH[k]);
  const weakness = parts[worst] >= 75 ? 'Nothing stands out. Watch the scores before changing it.' : `Main weakness: ${WEAK[worst]} (${PART_LABEL[worst].toLowerCase()} ${parts[worst]}/100).`;
  const suggestion = parts[worst] >= 75 ? 'Keep it as it is, and keep the turf repaired.' : SUGGEST[worst](h, parts, { walk: C.walk, twins: C.twins, inPlay: L.inPlay });
  const likes = SEGMENTS.filter((s) => appeal[s] >= 68);
  const dislikes = SEGMENTS.filter((s) => appeal[s] < 50);
  const q: HoleQuality = { parts, appeal, overall, strengths, weakness, likes, dislikes, suggestion, twins: C.twins, recent };
  m.set(h.id, { key, q });
  return q;
}

/** The kind of golfer a sim golfer is, for appeal: resort visitors and juniors by segment, everyone else by skill. */
export function segmentOf(type: GolferType, seg?: 'resort' | 'junior' | 'field'): Segment {
  if (seg === 'resort') return 'resort';
  if (seg === 'junior') return 'beginner';
  if (seg === 'field') return 'skilled';
  return type;
}
export const playKind = (type: GolferType, seg?: 'resort' | 'junior' | 'field'): HolePlay['k'] => (seg === 'resort' ? 'v' : seg === 'junior' ? 'j' : seg === 'field' ? 'f' : type === 'beginner' ? 'b' : type === 'skilled' ? 's' : 'r');
export const KIND_LABEL: Record<HolePlay['k'], string> = { b: 'Beginners', r: 'Regulars', s: 'Skilled', v: 'Resort visitors', j: 'Juniors', f: 'Tournament field' };

/** Enjoyment points a golfer takes from one hole: -8 to +8 around a middling hole. */
export function holeEnjoyment(q: HoleQuality, seg: Segment): number {
  return Math.max(-8, Math.min(8, (q.appeal[seg] - 55) * 0.22));
}

/** How well a set of holes would host a competition: quality for skilled players, turf, variety, length and pars. */
export function eventReadiness(w: World, holes: Hole[], ctx: QualityContext): { score: number; notes: string[] } {
  if (!holes.length) return { score: 0, notes: ['Choose at least one open hole.'] };
  const qs = holes.map((h) => holeQuality(w, h, ctx));
  const avg = (f: (q: HoleQuality) => number) => qs.reduce((s, q) => s + f(q), 0) / qs.length;
  const skilled = avg((q) => q.appeal.skilled), cond = avg((q) => q.parts.condition), len = avg((q) => q.parts.length);
  const pars = new Set(holes.map((h) => h.par)).size;
  const twins = holes.filter((h) => holes.some((o) => isTwin(h, o))).length;
  const variety = Math.max(0, 100 - twins * 14) * (pars >= 3 ? 1 : pars === 2 ? 0.85 : 0.65);
  const score = clamp(skilled * 0.4 + cond * 0.25 + variety * 0.2 + len * 0.15);
  const notes: string[] = [];
  if (skilled < 60) notes.push('Skilled players find these holes too plain. Add strategy: bends, guarded greens.');
  if (cond < 75) notes.push(`Turf averages ${Math.round(cond)}. Repair before the day, or choose championship preparation.`);
  if (pars < 2) notes.push('Every hole is the same par. A mix of pars makes a fairer test.');
  if (twins) notes.push(`${twins} hole${twins === 1 ? ' plays' : 's play'} like another on the route.`);
  if (len < 65) notes.push('Some holes are the wrong length for their par.');
  return { score, notes };
}
