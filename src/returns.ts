// Coming back: a short, accurate summary of what changed since the player last saw the club, and what is worth
// doing next. Built from a snapshot taken at every save and the club as it is now, so every line is a real change.
import type { Game } from './game';
import { fmtMoney } from './game';
import { EVENTS } from './events';
import { holeQuality } from './quality';
import { cupCondition } from './requests';
import { liveProfit } from './campaign';

export interface Snapshot { day: number; cash: number; rounds: number; members: number; prestige: number; profit: number; stories: number; at: number; regulars: Record<number, { visits: number; skill: number; done: boolean }> }

export function snapshotFor(g: Game): Snapshot {
  const regulars: Snapshot['regulars'] = {};
  for (const r of g.regulars.list) regulars[r.id] = { visits: r.visits, skill: r.skill, done: r.goal.done };
  return { day: g.day, cash: Math.round(g.cash), rounds: g.stats.rounds, members: g.members.length, prestige: Math.round(g.prestige), profit: Math.round(liveProfit(g)), stories: g.regulars.stories.length, at: Date.now(), regulars };
}

export interface SummaryAction { label: string; act: 'hole' | 'calendar' | 'regulars' | 'goals' | 'finances'; id?: number }
export interface ReturnSummary {
  title: string;
  lines: { label: string; value: string; tone?: 'good' | 'bad' }[];
  regulars: string[];
  attention: { text: string; action?: SummaryAction }[];
  upcoming: { text: string; action?: SummaryAction } | null;
}

/** Worth showing when the player has been away a while or days have passed. */
export const worthSummary = (g: Game, snap: Snapshot | null, awayDays: number) => !!snap && (awayDays > 0 || g.day > snap.day || Date.now() - snap.at > 20 * 60 * 1000);

export function returnSummary(g: Game, snap: Snapshot, away: { days: number; net: number } | null): ReturnSummary {
  const days = g.day - snap.day;
  const lines: ReturnSummary['lines'] = [];
  const profit = Math.round(liveProfit(g) - snap.profit);
  lines.push({ label: days > 0 ? `Operating profit over ${days} day${days === 1 ? '' : 's'}` : 'Operating profit since', value: `${profit >= 0 ? '+' : ''}${fmtMoney(profit)}`, tone: profit >= 0 ? 'good' : 'bad' });
  lines.push({ label: 'Cash now', value: fmtMoney(g.cash) });
  const rounds = g.stats.rounds - snap.rounds;
  if (rounds) lines.push({ label: 'Rounds played', value: `${rounds}` });
  const recent = g.days.slice(-Math.max(1, days));
  const withRounds = recent.filter((d) => d.rounds);
  if (withRounds.length) lines.push({ label: 'Guest satisfaction', value: `${Math.round(withRounds.reduce((s, d) => s + d.avgSat, 0) / withRounds.length)}` });
  if (g.members.length !== snap.members) lines.push({ label: 'Members', value: `${snap.members} → ${g.members.length}`, tone: g.members.length > snap.members ? 'good' : 'bad' });
  if (Math.round(g.prestige) !== snap.prestige) lines.push({ label: 'Prestige', value: `${snap.prestige} → ${Math.round(g.prestige)}`, tone: g.prestige > snap.prestige ? 'good' : 'bad' });
  if (away) lines.push({ label: 'While the app was closed', value: `${away.days} day${away.days === 1 ? '' : 's'} played at a quieter pace` });

  const regs: string[] = [];
  for (const r of g.regulars.list) {
    const was = snap.regulars[r.id];
    if (!was) { regs.push(`${r.name} is new: ${r.goal.text.toLowerCase()}.`); continue; }
    const v = r.visits - was.visits;
    const better = was.skill - r.skill > 0.005;
    if (r.goal.done && !was.done) regs.push(`${r.name} reached their goal: ${r.goal.text.toLowerCase()}.`);
    else if (v > 0 || better) regs.push(`${r.name}: ${v} visit${v === 1 ? '' : 's'}${better ? `, playing ${Math.round((was.skill - r.skill) * 100)}% steadier after lessons` : ''}.`);
  }
  const fresh = g.regulars.stories.slice(Math.max(0, Math.min(g.regulars.stories.length, snap.stories > g.regulars.stories.length ? g.regulars.stories.length - 3 : snap.stories)));
  for (const st of fresh.slice(-3)) if (!regs.some((x) => x.startsWith(st.who))) regs.push(`${st.who} ${st.text}`);

  const attention: ReturnSummary['attention'] = [];
  const closed = g.world.holes.filter((h) => !h.open);
  if (closed.length) attention.push({ text: `Hole ${closed.map((h) => h.id).join(', ')} ${closed.length === 1 ? 'is' : 'are'} closed.`, action: { label: 'Show', act: 'hole', id: closed[0].id } });
  const worn = g.openHoles.filter((h) => cupCondition(g, h) < 55);
  if (worn.length) attention.push({ text: `Worn greens on hole ${worn.map((h) => h.id).join(', ')}.`, action: { label: 'Repair', act: 'hole', id: worn[0].id } });
  if (g.stormDamage) attention.push({ text: 'A storm washed out turf. One button on the bar repairs it all.' });
  for (const d of g.decisions.open) attention.push({ text: `Decide by day ${d.until}: ${d.title}.`, action: { label: 'Decide', act: 'goals' } });
  for (const r of g.requests.list) attention.push({ text: `${r.who} asked: “${r.text}” (${fmtMoney(r.reward)})`, action: { label: 'See', act: 'goals' } });
  if (g.openHoles.length >= 2) {
    const ctx = g.qualityCtx;
    const weakest = [...g.openHoles].sort((a, b) => holeQuality(g.world, a, ctx).overall - holeQuality(g.world, b, ctx).overall)[0];
    const q = holeQuality(g.world, weakest, ctx);
    if (q.overall < 62) attention.push({ text: `Hole ${weakest.id} is your weakest (${q.overall}/100). ${q.suggestion}`, action: { label: 'Review', act: 'hole', id: weakest.id } });
  }

  let upcoming: ReturnSummary['upcoming'] = null;
  const b = g.bookings[0];
  const o = g.calendar.offers.find((x) => x.commitBy >= g.day);
  if (b) upcoming = { text: `${EVENTS[b.id].name} on day ${b.day}${b.day - g.day <= 1 ? ' (tomorrow or today)' : ''}.`, action: { label: 'Prepare', act: 'calendar' } };
  else if (o) upcoming = { text: `${EVENTS[o.ev].name} offered for day ${o.day}: commit by day ${o.commitBy}.`, action: { label: 'Look', act: 'calendar' } };

  return { title: days > 0 ? `Welcome back: day ${snap.day} → day ${g.day}` : `Welcome back to ${g.name}`, lines, regulars: regs.slice(0, 4), attention: attention.slice(0, 4), upcoming };
}
