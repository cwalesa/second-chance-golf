// Club identity: what the club has actually become, read from how it runs, not chosen from a menu.
//
// Four leanings are scored from the last week of operations: pricing, who plays, what the facilities do, which
// events run and how the holes suit each kind of golfer. The strongest one names the club, and each has its own
// effect, felt through the existing systems rather than a shared bonus: a community course gets word of mouth from
// the golfers it treats well, a competitive club gets bigger fields, a learning center gets more lesson bookings and
// juniors, and a scenic resort draws local diners and resort visitors.
import type { Game } from './game';
import { facLevel } from './facilities';
import { holeQuality } from './quality';

export type IdentityId = 'community' | 'competitive' | 'learning' | 'resort';
export const IDENTITY: Record<IdentityId, { name: string; blurb: string; perk: string }> = {
  community: { name: 'Affordable community course', blurb: 'Fair prices and lots of everyday golfers.', perk: 'Word of mouth: a little more everyday demand while prices stay fair.' },
  competitive: { name: 'Competitive tournament club', blurb: 'Strategic holes, competitions and a growing reputation.', perk: 'Tournament fields are bigger and earn more prestige.' },
  learning: { name: 'Family learning center', blurb: 'Lessons, juniors and forgiving holes.', perk: 'More golfers book lessons, and more juniors come.' },
  resort: { name: 'Scenic resort', blurb: 'Beautiful holes, good food and visitors who pay for both.', perk: 'More local diners and resort visitors.' },
};
export interface Identity { scores: Record<IdentityId, number>; top: IdentityId | null; evidence: Record<IdentityId, string[]> }

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
export function computeIdentity(g: Game): Identity {
  const days = g.days.slice(-7);
  const sum = (f: (d: typeof days[number]) => number) => days.reduce((s, d) => s + f(d), 0);
  const rounds = Math.max(1, sum((d) => d.rounds));
  const kind = (k: 'b' | 'r' | 's' | 'v' | 'j' | 'f') => sum((d) => d.kinds?.[k] ?? 0) / rounds;
  const feeRatio = days.length ? sum((d) => d.feeRatio ?? 0) / rounds : 1;
  const lessons = sum((d) => d.lessons ?? 0) / Math.max(1, days.length);
  const covers = sum((d) => d.covers ?? 0) / Math.max(1, days.length);
  const open = g.openHoles;
  const qs = open.map((h) => holeQuality(g.world, h, g.qualityCtx));
  const avg = (f: (q: (typeof qs)[number]) => number) => (qs.length ? qs.reduce((s, q) => s + f(q), 0) / qs.length : 0);
  const evidence: Record<IdentityId, string[]> = { community: [], competitive: [], learning: [], resort: [] };
  const value = clamp(100 - Math.max(0, (feeRatio - 0.9) * 220));
  const volume = clamp((rounds / Math.max(1, days.length)) * 2.2);
  const community = clamp(value * 0.45 + volume * 0.3 + Math.min(100, g.members.length * 4) * 0.25);
  if (feeRatio <= 1) evidence.community.push(`fees ${Math.round(feeRatio * 100)}% of fair`);
  evidence.community.push(`${Math.round(rounds / Math.max(1, days.length))} rounds a day`, `${g.members.length} members`);
  const competitive = clamp(avg((q) => q.appeal.skilled) * 0.4 + g.prestige * 0.35 + kind('s') * 120 + facLevel(g, 'tourney') * 6);
  evidence.competitive.push(`skilled appeal ${Math.round(avg((q) => q.appeal.skilled))}`, `prestige ${Math.round(g.prestige)}`);
  const learning = clamp(Math.min(100, lessons * 9) * 0.45 + avg((q) => q.appeal.beginner) * 0.3 + (kind('b') + kind('j')) * 60 + facLevel(g, 'academy') * 5);
  evidence.learning.push(`${lessons.toFixed(1)} lessons a day`, `beginner appeal ${Math.round(avg((q) => q.appeal.beginner))}`);
  const resort = clamp(avg((q) => q.parts.scenery) * 0.4 + Math.min(100, covers * 2.5) * 0.35 + kind('v') * 150 + (g.fac.restaurant.service === 'premium' && facLevel(g, 'restaurant') ? 10 : 0));
  evidence.resort.push(`scenery ${Math.round(avg((q) => q.parts.scenery))}`, `${Math.round(covers)} meals a day`);
  const scores = { community, competitive, learning, resort };
  const ranked = (Object.keys(scores) as IdentityId[]).sort((a, b) => scores[b] - scores[a]);
  const top = days.length >= 2 && scores[ranked[0]] >= 45 && scores[ranked[0]] - scores[ranked[1]] >= 4 ? ranked[0] : null;
  return { scores, top, evidence };
}
