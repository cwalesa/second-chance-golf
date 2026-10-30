import { Game, STAFF, StaffId, fmtMoney } from './game';
import { LOCATIONS, activeLocation, stageComplete } from './campaign';
import { assessDesign } from './design';
import { Hole } from './terrain';
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const meter = (value: number) => `<div class="rating-track"><i style="width:${Math.min(100, Math.max(0, value))}%"></i></div>`;
export function journeyPanel(g: Game): string {
  const loc = activeLocation(g), ready = stageComplete(g);
  const done = loc.objectives.filter(o => g.campaign.claimed.includes(o.id)).length;
  return `<div class="journey-hero"><div class="eyebrow">RESTORATION ${g.campaign.stage + 1} / ${LOCATIONS.length}</div><h2>${loc.name}</h2><p>${loc.brief}</p><div class="journey-progress">${meter(done / loc.objectives.length * 100)}<span>${done} / ${loc.objectives.length} objectives</span></div></div>
    <div class="sec"><h3>Your next improvements</h3>${loc.objectives.map(o => {
      const claimed = g.campaign.claimed.includes(o.id), value = Math.min(o.target, Math.max(0, o.value(g))), can = value >= o.target;
      return `<div class="objective ${claimed ? 'complete' : ''}"><div class="row"><span class="t">${claimed ? '✓ ' : ''}${o.title}</span><span class="reward">${fmtMoney(o.reward)}</span></div><p class="dim">${o.detail}</p>${meter(value / o.target * 100)}<div class="row"><span class="dim">${Math.round(value)} / ${o.target}</span><button class="btn ${can && !claimed ? 'primary' : ''}" data-act="claim" data-id="${o.id}" ${claimed || !can ? 'disabled' : ''}>${claimed ? 'Collected' : can ? 'Collect reward' : 'In progress'}</button></div></div>`;
    }).join('')}</div>
    ${ready ? `<div class="travel-card"><h3>${g.campaign.stage === 4 ? 'Portfolio complete' : 'Ready for your next course'}</h3><p>${g.campaign.stage === 4 ? 'Five restorations. Keep refining your resort and playing your favorite holes.' : 'Keep playing here as long as you like, or take on a new property. Your medals and completed locations stay with you.'}</p>${g.campaign.stage < 4 ? `<button class="btn primary" data-act="travel">Move to ${LOCATIONS[g.campaign.stage + 1].name} →</button>` : '<span class="reward">All five locations unlocked</span>'}</div>` : ''}
    <div class="sec"><h3>Your portfolio · ${g.campaign.medals} medals</h3><div class="portfolio">${LOCATIONS.map((l, i) => `<div class="portfolio-stop ${i === g.campaign.stage ? 'current' : ''} ${i > g.campaign.stage ? 'locked' : ''}"><span>${i < g.campaign.stage ? '✓' : i + 1}</span><div><b>${l.name}</b><small>${i < g.campaign.stage ? 'Restored' : i === g.campaign.stage ? 'Your current course' : 'Complete the previous restoration'}</small></div></div>`).join('')}</div></div>`;
}
export function designPanel(g: Game, h: Hole): string {
  const r = assessDesign(g.world, h);
  return `<div class="sec"><h3>Design report</h3><div class="design-report"><div class="design-score"><strong>${r.overall}</strong><div><b>${r.verdict}</b><small>Layout rating / 100</small></div></div>${(['forgiveness', 'scenery', 'strategy', 'character'] as const).map(k => `<div class="design-metric"><span>${k[0].toUpperCase() + k.slice(1)}</span>${meter(r[k])}<b>${r[k]}</b></div>`).join('')}<p class="dim">Beginners value room to miss. Skilled players enjoy choices. Every golfer notices the scenery. Design affects enjoyment after each hole.</p>${r.advice.slice(0, 3).map(t => `<div class="note">${t}</div>`).join('')}<div class="btnrow"><button class="btn ${g.heatmap ? 'primary' : ''}" data-act="heat">${g.heatmap ? 'Hide' : 'Show'} shot landings</button><button class="btn" data-act="routing">Set dogleg</button></div></div></div>`;
}
export function staffPanel(g: Game): string {
  return `<div class="sec"><h3>Your team · ${fmtMoney(g.dailyWages)} / day</h3>${(Object.keys(STAFF) as StaffId[]).map(id => {
    const d = STAFF[id], hired = g.staff[id];
    return `<div class="card"><div class="row"><b>${d.name}</b><span class="${hired ? 'pos' : 'dim'}">${hired ? 'On staff' : fmtMoney(d.hire) + ' to hire'}</span></div><p class="dim">${d.detail}</p><div class="row"><span>${fmtMoney(d.daily)} / day</span><button class="btn ${hired ? '' : 'primary'}" data-act="${hired ? 'dismiss' : 'hire'}" data-id="${id}" ${!hired && g.cash < d.hire ? 'disabled' : ''}>${hired ? 'Dismiss' : 'Hire'}</button></div></div>`;
  }).join('')}</div>`;
}
export function membersPanel(g: Game): string {
  return `<div class="sec"><h3>Club members · ${g.members.length} / 30</h3><div class="card"><div class="row"><b>Daily membership dues</b><span class="reward">${fmtMoney(g.members.length * (8 + g.clubLevel * 3))}</span></div><p class="dim">Happy guests who finish at least two holes can join. Dues arrive each morning. Disappointed members eventually leave. A club host helps recruit.</p></div>${g.members.slice(-8).reverse().map(m => `<div class="member-row"><span class="avatar">${escapeHtml(m.name[0])}</span><div><b>${escapeHtml(m.name)}</b><small>${m.type} · ${m.visits} visit${m.visits === 1 ? '' : 's'}</small></div><strong class="pos">${m.happiness}%</strong></div>`).join('') || '<p class="dim">Your first regulars are out there. Improve the course and keep prices fair.</p>'}</div>`;
}
