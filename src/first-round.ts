import type { RoundResult } from './sim';
import type { Hole } from './terrain';

/** What the first paying guest's finished round looked like, kept so the card can be shown once and survive a save. */
export interface FirstRoundResult {
  name: string;
  holes: number;
  strokes: number;
  par: number;
  /** The green fee this guest paid. It was collected when they teed off, so the card only reports it. */
  fee: number;
  /** One short line, always drawn from something the simulation measured for this round. */
  reaction: string;
}
export interface FirstRoundState {
  /** The first paying round has finished (set once, whether or not the card has been seen yet). */
  done: boolean;
  /** The card has been put in front of the player. Never reset, so a reload cannot repeat it. */
  shown: boolean;
  result: FirstRoundResult | null;
}
export const freshFirstRound = (): FirstRoundState => ({ done: false, shown: false, result: null });

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/**
 * One reaction taken from the numbers the simulation kept about this guest's round. The first thing that was
 * actually measured and worth mentioning wins; with nothing to say, a plain and true general line is used.
 */
export function roundReaction(r: Pick<RoundResult, 'strokes' | 'par' | 'holes' | 'stats'>): string {
  const s = r.stats;
  const turf = s.condN > 0 ? s.condSum / s.condN : null;
  const over = r.strokes - r.par;
  if (s.water > 0) return `Found the water ${times(s.water)}. A safer line would help.`;
  if (s.tree >= 2) return `Got tangled in the trees ${times(s.tree)}.`;
  if (s.bunker >= 2) return `Spent a while in the sand (${s.bunker} shots from bunkers).`;
  if (s.wait >= 20) return 'Had a wait at the tee. Busy days will do that.';
  if (turf !== null && turf < 45) return 'Said the turf was worn in places. A little repair would help.';
  if (s.shots >= 4 && s.rough / s.shots >= 0.45) return 'Spent a lot of the round in the rough.';
  if (turf !== null && turf >= 75) return 'Enjoyed the smooth fairways and greens.';
  if (over < 0) return 'Played really well on your course.';
  return `Finished all ${r.holes} hole${r.holes === 1 ? '' : 's'} and headed home.`;
}

export const scoreText = (over: number) => (over === 0 ? 'Even par' : over < 0 ? `${-over} under par` : `${over} over par`);

export function firstRoundResult(r: RoundResult): FirstRoundResult {
  return { name: r.name, holes: r.holes, strokes: r.strokes, par: r.par, fee: r.fee, reaction: roundReaction(r) };
}

/** Whether this finished round is the one to celebrate: a paying guest, not a test golfer. */
export const isPayingRound = (r: Pick<RoundResult, 'test' | 'fee'>) => !r.test && r.fee > 0;

export type NextStep = { id: 'secondHole' | 'openHole' | 'guests'; label: string; holeId?: number };
/** One optional thing to try next, chosen from the course as it stands now. */
export function nextStep(holes: Pick<Hole, 'id' | 'name' | 'open'>[]): NextStep {
  if (holes.length <= 1) return { id: 'secondHole', label: 'Build your second hole' };
  const closed = holes.find((h) => !h.open);
  if (closed) return { id: 'openHole', label: `Open ${closed.name}`, holeId: closed.id };
  return { id: 'guests', label: 'See what guests think' };
}
