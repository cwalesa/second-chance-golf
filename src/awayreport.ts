import type { Game } from './game';
import { fmtMoney } from './game';
import { CFG } from './config';
import { holeCondition } from './terrain';

/** What the player is shown on coming back: what happened on the course, one guest's remark about a named hole, and one thing to do about it. */
export interface AwayReport {
  days: number;
  rounds: number;
  net: number;
  /** a guest remark about a specific hole (or the course), in the guest's own words */
  comment: { who: string; hole: number | null; text: string };
  /** one suggested next step; `holeId` opens that hole in Course */
  fix: { label: string; go: 'course' | 'build' | 'money'; holeId?: number };
}

const WHO = ['Sam K.', 'Priya R.', 'Tom W.', 'Alma G.', 'Dev P.', 'Jo L.', 'Nina B.', 'Luis M.'];

/** A remark drawn from how the holes are actually doing, so the suggested fix is always real. */
export function awayComment(g: Game): AwayReport['comment'] & { fix: AwayReport['fix'] } {
  const who = WHO[(g.day + g.world.holes.length) % WHO.length];
  const open = g.world.holes.filter((h) => h.open);
  const worn = open.map((h) => ({ h, c: holeCondition(g.world, h) })).sort((a, b) => a.c.green - b.c.green)[0];
  if (worn && worn.c.green < CFG.turf.wornBelow + 20)
    return { who, hole: worn.h.id, text: `The green on ${worn.h.name} was getting patchy by my last putts.`, fix: { label: `Repair the green on ${worn.h.name}`, go: 'course', holeId: worn.h.id } };
  const wet = open.find((h) => h.stats.rounds >= 3 && h.stats.water / h.stats.rounds >= 0.35);
  if (wet) return { who, hole: wet.id, text: `I lost a ball in the water on ${wet.name} again.`, fix: { label: `Look at ${wet.name}`, go: 'course', holeId: wet.id } };
  const hard = open.find((h) => h.stats.rounds >= 3 && h.stats.picked / h.stats.rounds >= 0.15);
  if (hard) return { who, hole: hard.id, text: `${hard.name} was too tough for me. I picked up.`, fix: { label: `Ease up ${hard.name}`, go: 'course', holeId: hard.id } };
  const easy = open.find((h) => h.stats.rounds >= 3 && h.stats.strokes / h.stats.rounds < h.par - 0.3);
  if (easy) return { who, hole: easy.id, text: `${easy.name} felt a bit too easy. A bunker would help.`, fix: { label: `Add a bunker on ${easy.name}`, go: 'build', holeId: easy.id } };
  const fav = open[open.length - 1];
  if (fav) return { who, hole: fav.id, text: `I enjoyed ${fav.name}. What is next?`, fix: { label: g.world.holes.length < 3 ? `Build hole ${g.world.holes.length + 1}` : 'Check your prices', go: g.world.holes.length < 3 ? 'build' : 'money' } };
  return { who, hole: null, text: 'Nothing to play yet. I will be back when a hole is open.', fix: { label: 'Open a hole', go: 'course' } };
}

export function buildAwayReport(g: Game, away: { days: number; net: number; rounds?: number }): AwayReport {
  const { fix, ...comment } = awayComment(g);
  return { days: away.days, rounds: away.rounds ?? 0, net: away.net, comment, fix };
}
export const awayHeadline = (r: AwayReport) => `${r.days} day${r.days === 1 ? '' : 's'} passed. ${r.rounds} round${r.rounds === 1 ? '' : 's'} played, ${r.net >= 0 ? '+' : ''}${fmtMoney(r.net)}.`;
