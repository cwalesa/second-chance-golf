import { Game, STAFF, StaffId, fmtMoney } from './game';
import { assessDesign } from './design';
import { Hole } from './terrain';
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const meter = (value: number) => `<div class="rating-track"><i style="width:${Math.min(100, Math.max(0, value))}%"></i></div>`;
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
