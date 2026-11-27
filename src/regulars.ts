// Regulars: a handful of golfers the club gets to know by name.
//
// Each regular has a look, an ability that lessons really change (it is the dispersion the simulation uses), two
// things they care about, a membership, a visit history written from what actually happened on their rounds, a
// favourite hole (the one they enjoyed most), and one simple personal goal. Their comments are built from the
// round they just played, never picked at random, so a regular never thanks you for a green that was bumpy.
//
// Prospects are the other half of membership: guests who enjoyed their rounds build up interest, lessons and
// member events add to it, and at 100 they join. The panel shows who is close and what moves them.
import type { Game } from './game';
import { CFG, GolferType } from './config';
import type { RoundResult } from './sim';
import { holeQuality } from './quality';

export type RegularKind = 'learner' | 'junior' | 'founder' | 'competitor' | 'socialite';
export type Pref = 'forgiving' | 'scenery' | 'strategy' | 'value' | 'dining' | 'pace';
export const PREF_LABEL: Record<Pref, string> = { forgiving: 'room to miss', scenery: 'a pretty course', strategy: 'shot choices', value: 'fair prices', dining: 'a good lunch', pace: 'no waiting' };

export interface RegularGoal { kind: 'break' | 'lessons' | 'championship' | 'finisher' | 'patio' | 'fees'; text: string; target: number; progress: number; done: boolean; doneDay?: number }
export interface RoundNote { day: number; holes: number; over: number; note: string }
export interface Regular {
  id: number;
  name: string;
  kind: RegularKind;
  type: GolferType;
  look: { shirt: string; cap: string };
  /** dispersion multiplier: 1 typical for the type, lower is better */
  skill: number;
  prefs: Pref[];
  member: boolean;
  joined: number;
  /** the fee this regular paid when they joined, for reacting to price rises */
  feeAtJoin: number;
  visits: number;
  lessons: number;
  happiness: number;
  history: RoundNote[];
  /** enjoyment summed per hole, for the favourite */
  love: Record<string, number>;
  goal: RegularGoal;
  lastVisit: number;
  /** the day of the last thing said about fees or access, so it is not repeated daily */
  lastGripe: number;
}
export interface Story { day: number; who: string; text: string; tone: 'good' | 'info' | 'bad' }
export interface Prospect { name: string; type: GolferType; interest: number; last: number; why: string }

export const REG = {
  max: 7,
  /** chance that any given arrival is a due regular instead of a new face */
  share: 0.3,
  /** days between visits */
  gap: { learner: 1, junior: 1, founder: 1, competitor: 2, socialite: 2 } as Record<RegularKind, number>,
  prospectJoin: 100,
  maxProspects: 10,
  membersBase: 30,
};
const LOOKS = [
  { shirt: '#c94f6d', cap: '#f2f2f2' }, { shirt: '#3f9a8a', cap: '#20404a' }, { shirt: '#e0a03a', cap: '#7a3b2e' },
  { shirt: '#6a5acd', cap: '#f4e7c8' }, { shirt: '#2f7d4a', cap: '#d8b54a' }, { shirt: '#d46a3a', cap: '#2b2b3a' }, { shirt: '#4a7fc9', cap: '#c0392b' },
];
const NAMES: Record<RegularKind, string[]> = {
  learner: ['Rosa Delgado', 'Pat Okafor', 'Gwen Liddell'],
  junior: ['Theo Marsh', 'Mia Chen', 'Sami Haddad'],
  founder: ['Walter Brand', 'Edith Crane', 'Harold Voss'],
  competitor: ['Nadia Petrova', 'Jonah Reyes', 'Ingrid Sol'],
  socialite: ['Celeste Moreau', 'Vik Anand', 'Lottie Fairbanks'],
};

export const avgFee = (g: Game) => (g.fees.early + g.fees.mid + g.fees.twilight) / 3;
export interface RegularsState { list: Regular[]; seq: number; stories: Story[]; prospects: Prospect[] }
export const freshRegulars = (): RegularsState => ({ list: [], seq: 1, stories: [], prospects: [] });

export function loadRegulars(d: unknown): RegularsState {
  const st = freshRegulars();
  if (!d || typeof d !== 'object') return st;
  const o = d as Partial<RegularsState>;
  if (Number.isInteger(o.seq)) st.seq = o.seq!;
  if (Array.isArray(o.list)) st.list = o.list.filter((r) => r && typeof r.name === 'string' && Number.isFinite(r.skill) && r.goal && Array.isArray(r.history)).map((r) => ({ ...r, love: r.love ?? {}, lastGripe: r.lastGripe ?? 0 }));
  if (Array.isArray(o.stories)) st.stories = o.stories.filter((s) => s && typeof s.text === 'string').slice(-40);
  if (Array.isArray(o.prospects)) st.prospects = o.prospects.filter((p) => p && typeof p.name === 'string' && Number.isFinite(p.interest));
  return st;
}

export function story(g: Game, who: string, text: string, tone: Story['tone'] = 'info', notify = false) {
  const st = g.regulars;
  st.stories.push({ day: g.day, who, text, tone });
  if (st.stories.length > 40) st.stories.shift();
  if (notify) g.notify(tone === 'bad' ? 'bad' : tone === 'good' ? 'good' : 'info', `${who}: ${text}`);
  g.dirtySave = true;
}

function goalFor(kind: RegularKind, g: Game): RegularGoal {
  switch (kind) {
    case 'learner': return { kind: 'break', text: 'Finish a round of 4+ holes at no more than 1.5 over par a hole', target: 1.5, progress: 99, done: false };
    case 'junior': return { kind: 'championship', text: 'Improve enough to finish in the top half of a club championship', target: 1, progress: 0, done: false };
    case 'founder': return { kind: 'fees', text: 'Keep average green fees within 30% of what they paid when they joined', target: Math.round(avgFee(g) * 1.3), progress: Math.round(avgFee(g)), done: true };
    case 'competitor': return { kind: 'finisher', text: 'Play a strategic finishing hole (strategy 70+ on the last hole)', target: 70, progress: 0, done: false };
    case 'socialite': return { kind: 'patio', text: 'Lunch on the restaurant patio three times', target: 3, progress: 0, done: false };
  }
}
const PREFS: Record<RegularKind, Pref[]> = { learner: ['forgiving', 'value'], junior: ['forgiving', 'pace'], founder: ['value', 'pace'], competitor: ['strategy', 'pace'], socialite: ['scenery', 'dining'] };
const TYPE: Record<RegularKind, GolferType> = { learner: 'beginner', junior: 'beginner', founder: 'regular', competitor: 'skilled', socialite: 'regular' };

/** Add a regular of a kind the club does not have yet, if the course is ready for them. */
function introduce(g: Game, kind: RegularKind): Regular | null {
  const st = g.regulars;
  if (st.list.length >= REG.max || st.list.some((r) => r.kind === kind)) return null;
  const pool = NAMES[kind];
  const name = pool[(g.world.landSeed + st.seq) % pool.length];
  if (st.list.some((r) => r.name === name)) return null;
  const r: Regular = {
    id: st.seq++, name, kind, type: TYPE[kind], look: LOOKS[(st.seq * 3) % LOOKS.length],
    skill: kind === 'learner' ? 1.15 : kind === 'junior' ? 1.2 : kind === 'competitor' ? 0.92 : 1,
    prefs: PREFS[kind], member: kind === 'founder', joined: g.day, feeAtJoin: avgFee(g), visits: 0, lessons: 0, happiness: 70,
    history: [], love: {}, goal: goalFor(kind, g), lastVisit: 0, lastGripe: 0,
  };
  st.list.push(r);
  if (r.member && !g.members.some((m) => m.name === r.name)) g.members.push({ name: r.name, type: r.type, visits: 0, happiness: 70, joined: g.day });
  const intro: Record<RegularKind, string> = {
    learner: 'has started playing here. New to golf, keen to improve.',
    junior: 'joined the junior program. Wants to play the club championship one day.',
    founder: 'became a founding member. Plays most days and remembers what things used to cost.',
    competitor: 'is a strong player who has noticed your course. Wants holes that make them think.',
    socialite: 'comes for the golf and stays for lunch. Cares about the view.',
  };
  story(g, r.name, intro[kind], 'good', true);
  return r;
}

/** Once a day: new regulars arrive as the club grows into what would attract them. */
export function growRoster(g: Game) {
  const open = g.openHoles.length;
  if (open >= 2) introduce(g, 'founder');
  if (open >= 2 && g.day >= 3) introduce(g, 'learner');
  if (open >= 4) introduce(g, 'competitor');
  if (open >= 5 || (g.world.items ?? []).some((it) => it.k === 'restaurant')) introduce(g, 'socialite');
  if ((g.world.items ?? []).some((it) => it.k === 'academy') && g.fac.academy.level >= 2) introduce(g, 'junior');
}

/** A regular who is due a visit and not already on the course, chosen for this arrival, or null. */
export function dueRegular(g: Game): Regular | null {
  const on = new Set(g.sim.golfers.map((x) => x.regId).filter(Boolean));
  const due = g.regulars.list.filter((r) => !on.has(r.id) && r.lastVisit < g.day && g.day - r.lastVisit >= REG.gap[r.kind] && r.happiness >= 25);
  if (!due.length || g.rng.next() > REG.share) return null;
  return due[Math.floor(g.rng.next() * due.length)];
}

export const findRegular = (g: Game, id?: number) => (id ? g.regulars.list.find((r) => r.id === id) : undefined);
export function favouriteHole(r: Regular): number | null {
  const e = Object.entries(r.love);
  if (!e.length) return null;
  e.sort((a, b) => b[1] - a[1]);
  return Number(e[0][0]);
}

/** What a regular says about the round they just played: built from its scorecard and stats, nothing invented. */
function roundNote(_g: Game, r: Regular, res: RoundResult, sat: number): string {
  const card = res.scorecard ?? [];
  const best = [...card].sort((a, b) => (a.strokes - a.par) - (b.strokes - b.par))[0];
  const wet = [...card].sort((a, b) => (b.water ?? 0) - (a.water ?? 0))[0];
  const bits: string[] = [];
  if (best && best.strokes - best.par <= -1) bits.push(`${best.strokes - best.par <= -2 ? 'Eagle' : 'Birdie'} on hole ${best.hole}`);
  else if (best && best.strokes === best.par) bits.push(`par on hole ${best.hole}`);
  if (wet && (wet.water ?? 0) >= 2) bits.push(`${wet.water} balls in the water on hole ${wet.hole}`);
  if (res.stats.wait > 60) bits.push(`waited about ${Math.round(res.stats.wait / 20)} minutes on tees`);
  if (r.prefs.includes('value') && res.fairFee && res.fee > res.fairFee + 4) bits.push(`felt $${Math.round(res.fee)} was steep`);
  if (!bits.length) bits.push(sat >= 75 ? 'a steady, enjoyable round' : 'an ordinary round');
  return bits.join(', ');
}

/** A regular finished a round: history, favourite hole, happiness, goal progress, and a comment true to the round. */
export function regularRound(g: Game, r: Regular, res: RoundResult, sat: number): string | null {
  r.visits++;
  r.lastVisit = g.day;
  const over = res.strokes - res.par;
  const note = roundNote(g, r, res, sat);
  r.history.push({ day: g.day, holes: res.holes, over, note });
  if (r.history.length > 8) r.history.shift();
  r.happiness = Math.round(r.happiness * 0.6 + sat * 0.4);
  const m = g.members.find((x) => x.name === r.name);
  if (m) { m.visits++; m.happiness = r.happiness; }
  let say: string | null = null;
  const goal = r.goal;
  if (!goal.done) {
    if (goal.kind === 'break' && res.holes >= 4) {
      const per = over / res.holes;
      goal.progress = Math.min(goal.progress, Math.round(per * 10) / 10);
      if (per <= goal.target) { goal.done = true; goal.doneDay = g.day; say = `${over >= 0 ? '+' : ''}${over} over ${res.holes} holes! My best ever${r.lessons ? `, and only ${r.lessons} lesson${r.lessons === 1 ? '' : 's'} in` : ''}.`; story(g, r.name, `reached their goal: ${say}`, 'good', true); }
    }
    if (goal.kind === 'finisher') {
      const open = g.openHoles.sort((a, b) => a.id - b.id);
      const last = open[open.length - 1];
      if (last) {
        const q = holeQuality(g.world, last, g.qualityCtx);
        goal.progress = q.parts.strategy;
        if (q.parts.strategy >= goal.target && res.holeIds?.includes(last.id)) {
          goal.done = true; goal.doneDay = g.day;
          say = `Hole ${last.id} is a proper finishing hole now. I will bring my league friends.`;
          story(g, r.name, `loves the new finishing hole ${last.id}, and is bringing friends (+prestige).`, 'good', true);
          g.prestige = Math.min(100, g.prestige + 4);
          for (let k = 0; k < 2; k++) addInterest(g, `${r.name.split(' ')[0]}'s friend ${k + 1}`, 'skilled', 60, `${r.name.split(' ')[0]}'s league friend`);
        }
      }
    }
  }
  if (!say) {
    const fav = favouriteHole(r);
    say = r.kind === 'competitor' && !goal.done && goal.progress < goal.target
      ? `${note[0].toUpperCase()}${note.slice(1)}. The last hole still needs something to think about.`
      : `${note[0].toUpperCase()}${note.slice(1)}.${fav && r.visits % 3 === 0 ? ` Hole ${fav} is still my favourite.` : ''}`;
  }
  // after three visits a happy regular who is not yet a member asks to join
  if (!r.member && r.visits >= 3 && r.happiness >= 68 && g.members.length < memberCap(g)) {
    r.member = true; r.joined = g.day; r.feeAtJoin = avgFee(g);
    if (!g.members.some((x) => x.name === r.name)) g.members.push({ name: r.name, type: r.type, visits: r.visits, happiness: r.happiness, joined: g.day });
    story(g, r.name, 'joined as a member.', 'good', true);
  }
  g.dirtySave = true;
  return say;
}

/** A lesson at the academy: the regular's ability really improves (the simulation reads it), more with practice ground nearby. */
export function regularLesson(g: Game, r: Regular, quality: number) {
  const studio = g.fac.academy.level >= 3 ? 1.35 : 1;
  const before = r.skill;
  r.skill = Math.max(0.72, r.skill - 0.025 * quality * studio);
  r.lessons++;
  if (r.goal.kind === 'championship' && r.skill <= 0.9 && r.goal.progress === 0) story(g, r.name, 'is ready for the club championship. Book one in Calendar when you can.', 'good', true);
  else if (r.lessons === 1 || r.lessons % 3 === 0) story(g, r.name, `took lesson ${r.lessons}. Their game is ${Math.round((1 - r.skill / 1.2) * 100 + 20)}% of the way to a single-figure handicap (was ${Math.round((1 - before / 1.2) * 100 + 20)}%).`, 'info');
}

/** Once a day: founders notice fee rises against what they joined at; members' happiness drifts with the club's. */
export function dailyRegulars(g: Game) {
  for (const r of g.regulars.list) {
    if (r.kind === 'founder' && r.member) {
      const avg = avgFee(g), joined = r.feeAtJoin;
      r.goal.target = Math.round(joined * 1.3);
      r.goal.progress = Math.round(avg);
      // the founder's goal is a standing one: met while fees stay within 30% of what they joined at
      r.goal.done = avg <= joined * 1.3;
      if (avg > joined * 1.3 && g.day - r.lastGripe >= 4) {
        r.lastGripe = g.day;
        r.happiness = Math.max(0, r.happiness - 8);
        story(g, r.name, `says fees are up ${Math.round((avg / joined - 1) * 100)}% since they joined. Founders feel priced out.`, 'bad', true);
      }
    }
    if (r.kind === 'socialite') r.goal.done = r.goal.done || r.goal.progress >= r.goal.target;
  }
}

/** Members a club can hold: grows with the clubhouse. */
export const memberCap = (g: Game) => REG.membersBase + 5 * g.clubLevel;

/** Add interest from a guest; at 100 they join (no daily limit, only the club's size). */
export function addInterest(g: Game, name: string, type: GolferType, amount: number, why: string) {
  if (g.members.some((m) => m.name === name) || amount <= 0) return;
  const ps = g.regulars.prospects;
  let p = ps.find((x) => x.name === name);
  if (!p) {
    if (ps.length >= REG.maxProspects) { ps.sort((a, b) => b.interest - a.interest); ps.pop(); }
    p = { name, type, interest: 0, last: g.day, why };
    ps.push(p);
  }
  p.interest += amount;
  p.last = g.day;
  p.why = why;
  if (p.interest >= REG.prospectJoin && g.members.length < memberCap(g)) {
    g.members.push({ name, type, visits: 1, happiness: 75, joined: g.day });
    g.regulars.prospects = ps.filter((x) => x !== p);
    g.notify('good', `${name} joined as a member (${why}). Members pay daily dues.`);
  }
}
/** Interest fades for prospects who have not been back in a while. */
export function fadeProspects(g: Game) {
  for (const p of g.regulars.prospects) if (g.day - p.last > 3) p.interest = Math.max(0, p.interest - 10);
  g.regulars.prospects = g.regulars.prospects.filter((p) => p.interest > 0);
}

/** Interest a round earns toward membership, and the reason shown for it. */
export function roundInterest(g: Game, sat: number, holes: number): { amount: number; why: string } {
  if (holes < 2 || sat < 62) return { amount: 0, why: '' };
  let a = (sat - 58) * 1.4;
  const why: string[] = ['enjoyed the round'];
  if (g.staff.host) { a += 10; why.push('the club host'); }
  const svc = g.fac.restaurant.service;
  if ((g.world.items ?? []).some((it) => it.k === 'restaurant') && svc !== 'lean') { a += svc === 'premium' ? 10 : 5; why.push('the restaurant'); }
  return { amount: Math.round(a), why: why.join(', ') };
}

export const skillWord = (r: Regular) => {
  const typical = CFG.golfers.types[r.type].label;
  return r.skill <= 0.8 ? `${typical}, much improved` : r.skill <= 0.92 ? `${typical}, improving` : r.skill >= 1.1 ? `${typical}, still learning` : typical;
};
