// Panel content for the club's deeper systems: the hole report, regulars and prospects, facilities, club identity,
// the calendar with tournaments, decisions, active goals and the return summary. Plain HTML strings built from the
// game state; the controls carry data-act attributes that ui.ts handles, like every other panel.
import type { Game } from './game';
import { fmtMoney } from './game';
import { escapeHtml } from './panels';
import { Hole, holeYards } from './terrain';
import { KIND_LABEL, PART_LABEL, Parts, SEGMENTS, SEGMENT_LABEL, summarisePlays } from './quality';
import { FAC, FACILITIES, FACILITY_IDS, FacilityId, academyPractice, facLevel, facilityDailyCost, hasFacility, restaurantSetting, seatsToday, upgradeProblem } from './facilities';
import { ITEMS } from './items';
import { PREF_LABEL, REG, favouriteHole, memberCap, skillWord } from './regulars';
import { ACCESS_LABEL, CAL, PREP_LABEL, eventIssues, eventOutlook, readinessOf, routeOf, sortedBoard } from './calendar';
import { EVENTS, EVENT_IDS, EventId } from './events';
import { IDENTITY, IdentityId } from './identity';
import { CHAIN, activeGoals, goalDone, goalProgressText, liveProfit } from './campaign';
import { WEATHER } from './weather';
import type { ReturnSummary } from './returns';

const pct = (v: number) => `${Math.max(0, Math.min(100, Math.round(v)))}%`;
const meter = (v: number, cls = '') => `<div class="qbar ${cls}"><i style="width:${pct(v)};background:${v >= 70 ? '#3f9a52' : v >= 50 ? '#d99b2b' : '#d2503a'}"></i></div>`;
const signed = (n: number, d = 1) => `${n > 0 ? '+' : ''}${n.toFixed(d)}`;

// ---------------------------------------------------------------- hole report
export function holeReportHtml(g: Game, h: Hole): string {
  const q = g.holeReport(h);
  const r = q.recent;
  const tone = q.overall >= 70 ? 'good' : q.overall >= 55 ? 'warn' : 'bad';
  let html = `<div class="card hole-report"><div class="qhead"><span class="qscore ${tone}">${q.overall}</span><div><b>Hole quality</b><small>For the golfers who actually play here. Not harder = better.</small></div></div>`;
  html += `<div class="seg-grid">${SEGMENTS.map((s) => `<div class="seg ${q.appeal[s] >= 68 ? 'like' : q.appeal[s] < 50 ? 'dislike' : ''}"><span>${SEGMENT_LABEL[s]}</span>${meter(q.appeal[s])}<b>${q.appeal[s]}</b></div>`).join('')}</div>`;
  if (q.strengths.length) html += `<p class="rep-line good"><b>Strengths:</b> ${q.strengths.join(', ')}.</p>`;
  html += `<p class="rep-line ${q.weakness.startsWith('Main') ? 'bad' : ''}"><b>${q.weakness.startsWith('Main') ? 'Weakness:' : 'Weakness:'}</b> ${escapeHtml(q.weakness.replace(/^Main weakness: /, ''))}</p>`;
  const likes = q.likes.map((s) => SEGMENT_LABEL[s]).join(', '), dis = q.dislikes.map((s) => SEGMENT_LABEL[s]).join(', ');
  if (likes || dis) html += `<p class="rep-line">${likes ? `<b>Liked by</b> ${likes}. ` : ''}${dis ? `<b>Disliked by</b> ${dis}.` : ''}</p>`;
  html += `<div class="note suggest"><b>Try this:</b> ${escapeHtml(q.suggestion)}</div>`;
  // what actually happened on it
  if (r.n) {
    const kinds = Object.entries(r.byKind).map(([k, v]) => `${KIND_LABEL[k as keyof typeof KIND_LABEL]} ${signed(v!)}`).join(' · ');
    html += `<div class="rep-stats"><div><b>${r.n}</b><small>recent plays</small></div><div><b>${signed(r.over)}</b><small>avg vs par</small></div><div><b>${pct(r.water * 100)}</b><small>water ball rate</small></div><div><b>${r.sand.toFixed(1)}</b><small>sand shots</small></div><div><b>${Math.round(r.wait)}s</b><small>wait on tee</small></div><div><b>${pct(r.picked * 100)}</b><small>picked up</small></div></div><p class="dim small">${kinds}</p>`;
  } else html += `<p class="dim small">No plays recorded since ${h.reno ? 'the renovation' : 'it opened'}. Scores, water balls and waits appear here as golfers play it.</p>`;
  // renovation: before and after
  if (h.reno) {
    const b = h.reno.before;
    const a = summarisePlays(h.log, q.overall);
    const row = (label: string, before: string, after: string, better: boolean | null) => `<tr><td>${label}</td><td>${before}</td><td class="${better === null ? '' : better ? 'pos' : 'neg'}">${after}</td></tr>`;
    html += `<div class="reno"><b>Renovation, day ${h.reno.day}</b>${a.n >= 3
      ? `<table><tr><th></th><th>Before</th><th>After</th></tr>${row('Quality', `${b.quality}`, `${q.overall}`, q.overall >= b.quality)}${row('Avg vs par', signed(b.over), signed(a.over), null)}${row('Water rate', pct(b.water * 100), pct(a.water * 100), a.water <= b.water)}${row('Picked up', pct(b.picked * 100), pct(a.picked * 100), a.picked <= b.picked)}${row('Tee wait', `${Math.round(b.wait)}s`, `${Math.round(a.wait)}s`, a.wait <= b.wait)}</table><p class="dim small">Before: ${b.n} plays. After: ${a.n} plays.</p>`
      : `<p class="dim small">Quality was ${b.quality} before the work (${b.n} plays, ${signed(b.over)} vs par, ${pct(b.water * 100)} water). ${h.open ? `After ${3 - a.n} more play${3 - a.n === 1 ? '' : 's'} the comparison appears here.` : 'Reopen it to start the comparison.'}</p>`}</div>`;
  }
  // parts, collapsed by default inside the card
  html += `<details class="xp" data-sec="parts"><summary><span class="xp-t">What goes into it</span></summary><div class="xp-body">${(Object.keys(q.parts) as (keyof Parts)[]).map((k) => `<div class="barrow"><span>${PART_LABEL[k]}</span>${meter(q.parts[k])}<span class="n">${q.parts[k]}</span></div>`).join('')}${q.twins.length ? `<p class="dim small">Plays like hole ${q.twins.join(', ')}: repeats count for less in your rating.</p>` : ''}</div></details>`;
  html += `<div class="ovl" role="group" aria-label="Map overlay">${(['landings', 'trouble', 'queues', 'quality'] as const).map((m) => `<button class="btn sm ${g.overlay === m ? 'primary' : ''}" data-act="overlay" data-id="${m}" aria-pressed="${g.overlay === m}">${{ landings: 'Landings', trouble: 'Trouble', queues: 'Queues', quality: 'All holes' }[m]}</button>`).join('')}</div>`;
  return html + '</div>';
}

/** The course setup control and a one-line course summary, shown above the hole list. */
export function courseSetupHtml(g: Game): string {
  const opts: [Game['setup'], string, string][] = [['forgiving', 'Forgiving', 'Middle pins, short rough'], ['standard', 'Standard', 'Balanced'], ['championship', 'Championship', 'Tucked pins, thick rough']];
  return `<div class="card"><div class="t">Course setup</div><div class="seg-pick" role="group" aria-label="Course setup">${opts.map(([id, l, d]) => `<button class="btn sm ${g.setup === id ? 'primary' : ''}" data-act="setup" data-id="${id}" aria-pressed="${g.setup === id}"><b>${l}</b><small>${d}</small></button>`).join('')}</div><p class="dim small">Beginners score better and enjoy a forgiving setup; skilled players and tournaments want a stiffer test. It changes how every hole plays.</p></div>`;
}

// ---------------------------------------------------------------- regulars
export function regularsHtml(g: Game): string {
  const st = g.regulars;
  let html = `<div class="sec"><h3>Regulars</h3>`;
  if (!st.list.length) html += `<p class="dim">Regulars arrive as the course grows: open two holes for your first founding member.</p>`;
  for (const r of st.list) {
    const fav = favouriteHole(r);
    const last = r.history[r.history.length - 1];
    const goalPct = r.goal.done ? 100 : r.goal.kind === 'break' ? (r.goal.progress >= 99 ? 0 : Math.max(5, 100 - (r.goal.progress - r.goal.target) * 40)) : r.goal.kind === 'patio' ? (r.goal.progress / r.goal.target) * 100 : r.goal.kind === 'finisher' ? (r.goal.progress / r.goal.target) * 100 : r.goal.kind === 'championship' ? (r.skill <= 0.9 ? 60 : 30) : r.goal.done ? 100 : 40;
    html += `<div class="reg-card"><span class="avatar" style="background:${r.look.shirt};box-shadow:inset 0 6px 0 ${r.look.cap}">${escapeHtml(r.name[0])}</span><div class="reg-main"><div class="row"><b>${escapeHtml(r.name)}</b><span class="dim small">${r.member ? 'Member' : 'Visitor'} · ${r.visits} visit${r.visits === 1 ? '' : 's'}</span></div>
      <small>${skillWord(r)}${r.lessons ? ` · ${r.lessons} lesson${r.lessons === 1 ? '' : 's'}` : ''} · likes ${r.prefs.map((p) => PREF_LABEL[p]).join(' and ')}${fav ? ` · favourite: hole ${fav}` : ''}</small>
      <div class="reg-goal ${r.goal.done ? 'done' : ''}"><span>${r.goal.done ? '✓ ' : ''}${escapeHtml(r.goal.text)}</span><div class="chain-bar"><i style="width:${pct(goalPct)}"></i></div></div>
      ${last ? `<small class="dim">Day ${last.day}: ${last.holes} holes, ${last.over >= 0 ? '+' : ''}${last.over}. ${escapeHtml(last.note)}.</small>` : ''}<small class="dim"> Mood ${r.happiness}.</small></div></div>`;
  }
  html += `</div>`;
  if (st.stories.length) html += `<div class="sec"><h3>Club news</h3><div class="feed">${st.stories.slice(-6).reverse().map((s) => `<div class="story ${s.tone}"><span class="dim">Day ${s.day}</span> <b>${escapeHtml(s.who)}</b> ${escapeHtml(s.text)}</div>`).join('')}</div></div>`;
  // recruitment
  const ps = [...st.prospects].sort((a, b) => b.interest - a.interest).slice(0, 5);
  html += `<div class="sec"><h3>Membership · ${g.members.length} / ${memberCap(g)}</h3><div class="card"><div class="row"><b>Daily dues</b><span class="reward">${fmtMoney(g.members.length * (8 + g.clubLevel * 3))}</span></div><p class="dim small">Guests who enjoy a round build interest; at ${REG.prospectJoin} they join. A lesson adds 35, a member appreciation day 40, a junior camp brings parents. The club host and the restaurant add to every good round. Interest fades if they stop coming.</p>
    ${ps.length ? ps.map((p) => `<div class="prospect"><span>${escapeHtml(p.name)} <small class="dim">${escapeHtml(p.why)}</small></span><div class="chain-bar"><i style="width:${pct(p.interest)}"></i></div><b>${Math.round(p.interest)}</b></div>`).join('') : '<p class="dim small">No prospects yet. Happy rounds of two holes or more start them off.</p>'}</div></div>`;
  return html;
}

// ---------------------------------------------------------------- facilities and identity
export function identityHtml(g: Game): string {
  const id = g.identity;
  if (!id) return '';
  const keys = Object.keys(IDENTITY) as IdentityId[];
  const top = id.top ? IDENTITY[id.top] : null;
  return `<div class="sec"><h3>Club identity</h3><div class="card identity"><div class="t">${top ? top.name : 'Still finding its feet'}</div><p class="dim small">${top ? `${top.blurb} ${top.perk}` : 'No one leaning stands out yet. It comes from how you price, build, staff and what you host, measured over the last week.'}</p>
    ${keys.map((k) => `<div class="barrow"><span>${IDENTITY[k].short}</span>${meter(id.scores[k])}<span class="n">${id.scores[k]}</span></div><p class="dim tiny">${id.evidence[k].join(' · ')}</p>`).join('')}</div></div>`;
}

export function facilitiesHtml(g: Game): string {
  let html = `<div class="sec"><h3>Facilities</h3><p class="dim small">Running costs today: ${fmtMoney(facilityDailyCost(g))} (levels, coaches and kitchen staff), charged hourly with maintenance.</p>`;
  for (const id of FACILITY_IDS) html += facilityCard(g, id);
  return html + '</div>';
}
function facilityCard(g: Game, id: FacilityId): string {
  const d = FACILITIES[id], it = ITEMS[id], built = hasFacility(g, id), lv = facLevel(g, id), t = g.today;
  let html = `<div class="card fac"><div class="row"><span class="t">${d.name}</span><span class="dim">${built ? `Level ${lv}: ${d.levels[lv - 1].name}` : `${fmtMoney(it.cost)} · ${it.w}×${it.h} tiles`}</span></div><p class="dim small"><b>For:</b> ${d.serves}. ${d.effect}</p><p class="dim small"><b>Where:</b> ${d.placement}</p>`;
  if (!built) return html + `<button class="btn primary" data-act="facbuild" data-id="${id}" ${g.cash < it.cost ? 'disabled' : ''}>Place it${g.cash < it.cost ? ` (need ${fmtMoney(it.cost - g.cash)} more)` : ''}</button></div>`;
  if (id === 'academy') {
    const a = g.fac.academy, prac = academyPractice(g.world), cap = a.coaches * FAC.academy.lessonsPerCoach[lv];
    html += `<div class="row"><span class="k">Coaches (${fmtMoney(FAC.academy.coachWage)}/day each)</span><span><button class="btn sm" data-act="coach" data-id="-1" ${a.coaches <= 0 ? 'disabled' : ''} aria-label="One fewer coach">−</button> <b>${a.coaches}</b> <button class="btn sm" data-act="coach" data-id="1" ${a.coaches >= FAC.academy.maxCoaches ? 'disabled' : ''} aria-label="One more coach">+</button></span></div>
      <div class="row"><span class="k">Lessons today</span><span>${t.lessons ?? 0} of ${cap}${t.turnedAway ? ` · <b class="neg">${t.turnedAway} turned away</b>` : ''}</span></div>
      <p class="dim small">${prac.near.length ? `Practice nearby (${prac.near.join(', ')}): lessons ${Math.round((prac.quality - 0.8) * 100 + 80)}% effective.` : 'No practice ground within a short walk: lessons are 80% effective. Place the putting green or range nearby.'} Each lesson pays ${fmtMoney(FAC.academy.lessonFee)}.</p>`;
  }
  if (id === 'restaurant') {
    const r = g.fac.restaurant, set = restaurantSetting(g.world);
    html += `<div class="seg-pick" role="group" aria-label="Service">${(Object.keys(FAC.restaurant.service) as (keyof typeof FAC.restaurant.service)[]).map((k) => { const s = FAC.restaurant.service[k]; return `<button class="btn sm ${r.service === k ? 'primary' : ''}" data-act="service" data-id="${k}" aria-pressed="${r.service === k}"><b>${s.label}</b><small>${fmtMoney(s.wage)}/day</small></button>`; }).join('')}</div><p class="dim small">${FAC.restaurant.service[r.service].blurb}</p>
      <div class="row"><span class="k">Meals today</span><span>${t.covers ?? 0} of ${seatsToday(g)} seats${t.locals ? ` · ${t.locals} locals` : ''}${t.diningTurnedAway ? ` · <b class="neg">${t.diningTurnedAway} turned away</b>` : ''}</span></div>
      <div class="row"><span class="k">View / walk from the clubhouse</span><span>${set.view}/100 · ${Math.round(set.walk * 10)} yd</span></div>${r.functionDay === g.day ? '<div class="note warn">A private function has the dining room tonight: fewer seats for golfers.</div>' : ''}`;
  }
  if (id === 'tourney') {
    const rd = readinessOf(g, routeOf(g, {}));
    html += `<div class="row"><span class="k">Prestige</span><span>${Math.round(g.prestige)} / 100</span></div><div class="row"><span class="k">Course readiness (all open holes)</span><span>${rd.score} / 100</span></div>${rd.notes.slice(0, 2).map((n) => `<p class="dim small">${escapeHtml(n)}</p>`).join('')}<p class="dim small">Competitions appear on the calendar. You choose their holes, preparation and who can play.</p>`;
  }
  if (lv < 3) {
    const nx = d.levels[lv], why = upgradeProblem(g, id);
    html += `<div class="fac-up"><div><b>Upgrade: ${nx.name}</b> <span class="dim">${fmtMoney(nx.cost)} + ${fmtMoney(nx.upkeep)}/day</span><p class="dim small">${nx.what}</p></div><button class="btn primary" data-act="facup" data-id="${id}" ${why ? 'disabled' : ''}>${why ? `Need ${fmtMoney(nx.cost - g.cash)} more` : `Upgrade · ${fmtMoney(nx.cost)}`}</button></div>`;
  } else html += `<p class="dim small">Fully upgraded.</p>`;
  return html + '</div>';
}

// ---------------------------------------------------------------- calendar and tournaments
export function calendarHtml(g: Game, editing: number | null): string {
  let html = `<div class="sec"><h3>The next ${CAL.horizon} days</h3><div class="cal-strip">`;
  for (let d = g.day; d < g.day + CAL.horizon; d++) {
    const b = g.bookings.find((x) => x.day === d), o = g.calendar.offers.find((x) => x.day === d);
    const wx = g.weatherFor(d), ev = d === g.day ? g.activeEvent : null;
    const known = d - g.day <= 3;
    html += `<div class="cal-day ${b || ev ? 'booked' : o ? 'offer' : ''} ${d === g.day ? 'today' : ''}"><b>${d === g.day ? 'Today' : `Day ${d}`}</b><span class="wx">${known ? WEATHER[wx].mark || '☼' : '·'}</span><small>${ev ? EVENTS[ev.id].name : b ? EVENTS[b.id].name : o ? EVENTS[o.ev].name + '?' : ''}</small></div>`;
  }
  html += `</div><p class="dim small">Weather is forecast three days ahead. Bright days are committed events, dashed ones are offers you can take or leave.</p></div>`;
  const e = g.activeEvent;
  if (e) {
    const d = EVENTS[e.id];
    html += `<div class="sec"><h3>Happening today: ${d.name}</h3><div class="card">`;
    if (e.board) {
      const rows = sortedBoard(e.board).slice(0, 10);
      html += `<table class="board"><tr><th>#</th><th>Player</th><th>Score</th><th>Thru</th></tr>${rows.map((r, i) => `<tr class="${r.regId ? 'reg' : ''}"><td>${i + 1}</td><td>${escapeHtml(r.name)}</td><td>${r.strokes - r.par > 0 ? '+' : ''}${r.strokes - r.par === 0 ? 'E' : r.strokes - r.par}</td><td>${r.done ? 'F' : r.holes}</td></tr>`).join('')}</table>${rows.length ? '' : '<p class="dim">The field is on its way to the first tee.</p>'}<p class="dim small">${e.spawned} of ${e.total} in the field · route: hole ${e.route?.join(', ')} · ${e.prep ?? 'none'} preparation · ${ACCESS_LABEL[e.access ?? 'open'].split(':')[0].toLowerCase()}${e.gallery ? ` · grandstand ${fmtMoney(e.gallery)}` : ''}</p>`;
    } else html += `<div class="row"><span class="k">Arrived</span><span>${e.spawned} of ${e.total}</span></div><div class="row"><span class="k">Takings</span><span>${fmtMoney(e.revenue)}</span></div>`;
    html += `</div></div>`;
  }
  // offers
  const offers = g.calendar.offers;
  html += `<div class="sec"><h3>Opportunities</h3>`;
  if (!offers.length) html += `<p class="dim">Nothing offered right now. Facilities bring their own: a junior camp with the academy's junior program, a championship with the tournament center, functions with the restaurant, member days once you have members.</p>`;
  for (const o of offers) html += offerCard(g, o.ev, o.day, o.commitBy, o.id);
  html += `</div>`;
  // committed
  html += `<div class="sec"><h3>Committed</h3>`;
  html += g.bookings.length ? g.bookings.map((b) => bookingCard(g, b.day, editing === b.day)).join('') : '<p class="dim">Nothing committed.</p>';
  html += `</div>`;
  // reports
  const hist = g.calendar.history;
  if (hist.length) {
    const r = hist[hist.length - 1];
    html += `<div class="sec"><h3>Last tournament: ${r.name}, day ${r.day}</h3><div class="card"><table class="board"><tr><th>#</th><th>Player</th><th>Score</th></tr>${r.top.map((t, i) => `<tr class="${t.regId ? 'reg' : ''}"><td>${i + 1}</td><td>${escapeHtml(t.name)}</td><td>${t.over > 0 ? '+' : ''}${t.over === 0 ? 'E' : t.over}${t.holes < r.route.length ? ` (${t.holes})` : ''}</td></tr>`).join('')}</table>
      <div class="rep-stats"><div><b>${r.field}</b><small>field</small></div><div><b>${r.readiness}</b><small>readiness</small></div><div><b>${r.sat}</b><small>satisfaction</small></div><div><b>${r.prestige >= 0 ? '+' : ''}${r.prestige}</b><small>prestige</small></div><div><b>${fmtMoney(r.revenue - r.cost)}</b><small>net of setup</small></div><div><b>${r.wait}s</b><small>avg tee wait</small></div></div>
      ${r.toughest ? `<p class="small"><b>Toughest:</b> hole ${r.toughest.hole} (${signed(r.toughest.over)}). ${r.easiest ? `<b>Easiest:</b> hole ${r.easiest.hole} (${signed(r.easiest.over)}).` : ''}</p>` : ''}${r.notes.map((n) => `<p class="dim small">${escapeHtml(n)}</p>`).join('')}</div></div>`;
  }
  // any-day events
  html += `<details class="xp" data-sec="anyday"><summary><span class="xp-t">Events you can book any day</span></summary><div class="xp-body">`;
  for (const id of EVENT_IDS.filter((x) => !EVENTS[x].dated)) {
    const d = EVENTS[id], probs = eventIssues(g, id), out = eventOutlook(g, id, { day: g.day + 1 });
    html += `<div class="card"><div class="row"><span class="t">${d.name}</span><span class="reward">${fmtMoney(d.cost)} setup</span></div><div class="dim small">${d.blurb}</div>
      <div class="row" style="align-items:center"><span class="k">Entry fee (fair ${fmtMoney(d.fair)})</span><span><button class="btn sm" data-act="evfee" data-ev="${id}" data-id="-5" aria-label="Lower fee">−</button> <b>${fmtMoney(g.eventFees[id])}</b> <button class="btn sm" data-act="evfee" data-ev="${id}" data-id="5" aria-label="Raise fee">+</button></span></div>
      <div class="row"><span class="k">Expected</span><span>about ${out.guests} golfers · ${fmtMoney(out.revenue - out.cost)} net</span></div>${probs.map((p) => `<div class="note bad">${escapeHtml(p)}</div>`).join('')}
      <button class="btn" data-act="book" data-id="${id}" ${probs.length ? 'disabled' : ''}>Book next free day</button></div>`;
  }
  return html + `</div></details>`;
}

function outlookRows(g: Game, id: EventId, day: number, b: Parameters<typeof eventOutlook>[2]) {
  const d = EVENTS[id], o = eventOutlook(g, id, { ...b, day });
  return `<div class="row"><span class="k">Expected turnout</span><span>${id === 'function' ? 'a private party' : `about ${o.guests}`}</span></div>
    <div class="row"><span class="k">Money</span><span>${fmtMoney(o.low - o.cost)} to ${fmtMoney(o.high - o.cost)} net</span></div>
    <div class="row"><span class="k">Costs</span><span>${fmtMoney(o.cost)}${d.tournament ? ' incl. preparation' : ''}</span></div>
    ${d.serves ? `<p class="dim small"><b>Benefits:</b> ${d.serves}.</p>` : ''}${d.disruption ? `<p class="dim small"><b>Disruption:</b> ${d.disruption}</p>` : ''}<p class="dim small">${o.note}</p>`;
}
function offerCard(g: Game, id: EventId, day: number, commitBy: number, offerId: number): string {
  const d = EVENTS[id], probs = eventIssues(g, id);
  return `<div class="card offer"><div class="row"><span class="t">${d.name}</span><span class="dim">Day ${day} · commit by day ${commitBy}</span></div><p class="dim small">${d.blurb}</p>${outlookRows(g, id, day, {})}
    ${probs.length ? `<div class="reqs">${probs.map((p) => `<div class="note bad">${escapeHtml(p)}</div>`).join('')}</div>` : `<p class="dim small">Preparation: ${d.prep ?? 1} day${(d.prep ?? 1) === 1 ? '' : 's'} of notice. You can still change its setup after committing.</p>`}
    <div class="btnrow"><button class="btn primary" data-act="commit" data-id="${offerId}" ${probs.length ? 'disabled' : ''}>Commit</button></div></div>`;
}
function bookingCard(g: Game, day: number, open: boolean): string {
  const b = g.bookings.find((x) => x.day === day)!;
  const d = EVENTS[b.id];
  let html = `<div class="card"><div class="row"><span class="t">${d.name}</span><span class="dim">Day ${b.day}</span></div>`;
  if (d.tournament) {
    const route = routeOf(g, b), rd = readinessOf(g, route);
    html += `<div class="row"><span class="k">Route</span><span>${route.length} holes · readiness <b class="${rd.score >= (d.minReady ?? 0) ? 'pos' : 'neg'}">${rd.score}</b>${d.minReady ? ` / ${d.minReady} needed` : ''}</span></div>${rd.notes.slice(0, 2).map((n) => `<p class="dim small">${escapeHtml(n)}</p>`).join('')}`;
    if (open) {
      html += `<p class="small"><b>Holes the field plays</b> (tap to include or leave out):</p><div class="chips">${g.openHoles.sort((a, c) => a.id - c.id).map((h) => `<button class="chip ${route.includes(h.id) ? 'on' : ''}" data-act="tourhole" data-id="${h.id}" data-day="${b.day}" aria-pressed="${route.includes(h.id)}">${h.id}<small>par ${h.par} · ${holeYards(h)}y</small></button>`).join('')}</div>
        <p class="small"><b>Preparation</b></p><div class="seg-pick">${(['none', 'standard', 'championship'] as const).map((p) => `<button class="btn sm ${(b.prep ?? 'none') === p ? 'primary' : ''}" data-act="tourprep" data-id="${p}" data-day="${b.day}"><b>${p[0].toUpperCase() + p.slice(1)}</b><small>${fmtMoney(CAL.prepCost[p] * route.length)}</small></button>`).join('')}</div><p class="dim small">${PREP_LABEL[b.prep ?? 'none']}</p>
        <p class="small"><b>Who else plays that day</b></p><div class="seg-pick">${(['open', 'members', 'closed'] as const).map((a) => `<button class="btn sm ${(b.access ?? 'open') === a ? 'primary' : ''}" data-act="touraccess" data-id="${a}" data-day="${b.day}"><b>${a[0].toUpperCase() + a.slice(1)}</b></button>`).join('')}</div><p class="dim small">${ACCESS_LABEL[b.access ?? 'open']}. Closing pleases the field but costs green fees and upsets members.</p>
        <div class="row" style="align-items:center"><span class="k">Entry fee</span><span><button class="btn sm" data-act="tourfee" data-id="-5" data-day="${b.day}" aria-label="Lower entry fee">−</button> <b>${fmtMoney(b.fee)}</b> <button class="btn sm" data-act="tourfee" data-id="5" data-day="${b.day}" aria-label="Raise entry fee">+</button></span></div>`;
    }
    html += outlookRows(g, b.id, b.day, b);
    html += `<div class="btnrow"><button class="btn" data-act="touredit" data-id="${b.day}">${open ? 'Done' : 'Set up'}</button><button class="btn" data-act="cancelev" data-id="${b.day}">Cancel</button></div>`;
  } else html += `${outlookRows(g, b.id, b.day, b)}<div class="btnrow"><button class="btn" data-act="cancelev" data-id="${b.day}">Cancel, free</button></div>`;
  return html + '</div>';
}

// ---------------------------------------------------------------- goals: decisions and active opportunities
export function decisionsHtml(g: Game): string {
  const ds = g.decisions.open;
  if (!ds.length) return '';
  return `<div class="ch-head"><span>Decisions</span><small>Choose before the deadline; otherwise the default is taken</small></div>${ds.map((d) => `<div class="card decision"><div class="row"><b>${escapeHtml(d.title)}</b><span class="dim small">by end of day ${d.until}</span></div><p class="small">${escapeHtml(d.text)}</p>${d.options.map((o) => `<button class="opt" data-act="decide" data-id="${d.id}" data-opt="${o.id}" ${o.cost && o.cost > g.cash ? 'disabled' : ''}><b>${escapeHtml(o.label)}${o.id === d.fallback ? ' <span class="dim">(default)</span>' : ''}</b><small>${escapeHtml(o.detail)}</small></button>`).join('')}</div>`).join('')}`;
}
export function activeGoalsHtml(g: Game): string {
  const list = activeGoals(g);
  if (!list.length) return '';
  const doneN = CHAIN.filter((c) => goalDone(g, c.id)).length;
  return `<div class="ch-head"><span>Active goals</span><small>${doneN} of ${CHAIN.length} done · reached in any order</small></div>${list.map((c) => {
    const v = c.value(g), p = Math.max(0, Math.min(100, (v / c.target) * 100)), blocked = c.blocked?.(g);
    return `<div class="chain-now"><h3>${c.title}</h3><p>${c.how}</p><div class="chain-bar"><i style="width:${p}%"></i></div><div class="chain-row"><span>${goalProgressText(c, g)}</span><span class="chain-reward">Reward ${fmtMoney(c.reward)}</span></div>${blocked ? `<div class="note warn small">${escapeHtml(blocked)}</div>` : ''}${c.go || c.guide ? `<button class="btn primary chain-go" data-act="goalgo" data-id="${c.id}">Show me</button>` : ''}</div>`;
  }).join('')}`;
}

/** The Finances money summary: today, lifetime, cash, construction and bonuses kept apart, all live. */
export function moneySummaryHtml(g: Game): string {
  const t = g.today, op = t.fees + t.shop - t.maintenance;
  const life = liveProfit(g);
  return `<div class="money-sum"><div><b class="${op >= 0 ? 'pos' : 'neg'}">${op >= 0 ? '+' : ''}${fmtMoney(op)}</b><small>Operating profit today (live)</small></div><div><b>${fmtMoney(life)}</b><small>Lifetime operating profit</small></div><div><b>${fmtMoney(g.cash)}</b><small>Cash</small></div><div><b>${fmtMoney(t.construction)}</b><small>Construction today</small></div><div><b>${fmtMoney(t.bonus)}</b><small>Bonuses today</small></div></div>`;
}

// ---------------------------------------------------------------- return summary
export function returnSummaryHtml(s: ReturnSummary): string {
  const act = (a?: { label: string; act: string; id?: number }) => (a ? `<button class="btn sm" data-ret="${a.act}" data-id="${a.id ?? ''}">${a.label}</button>` : '');
  return `<div class="ret"><span class="eyebrow">Return summary</span><h2>${escapeHtml(s.title)}</h2>
    <div class="ret-lines">${s.lines.map((l) => `<div><span>${escapeHtml(l.label)}</span><b class="${l.tone === 'good' ? 'pos' : l.tone === 'bad' ? 'neg' : ''}">${escapeHtml(l.value)}</b></div>`).join('')}</div>
    ${s.regulars.length ? `<h3>Your regulars</h3><ul class="ret-list">${s.regulars.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
    ${s.attention.length ? `<h3>Needs attention</h3><ul class="ret-list">${s.attention.map((a) => `<li><span>${escapeHtml(a.text)}</span>${act(a.action)}</li>`).join('')}</ul>` : '<p class="dim">Nothing needs attention.</p>'}
    ${s.upcoming ? `<h3>Coming up</h3><ul class="ret-list"><li><span>${escapeHtml(s.upcoming.text)}</span>${act(s.upcoming.action)}</li></ul>` : ''}
    <div class="actions"><button class="btn primary" data-ret="close">Back to the club</button></div></div>`;
}
