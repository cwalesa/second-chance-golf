import type { Game } from './game';
import { fmtMoney } from './game';
import { CAREER, careerLevel, projectOffers, nextSuggestion, SITE_PROJECTS, SiteId, CourseArchive } from './experience';
import { LOCATIONS, activeLocation } from './campaign';
import { escapeHtml } from './panels';
export type JournalView = 'progress' | 'projects' | 'portfolio';
const bar = (n: number) => `<div class="progress-rail"><i style="width:${Math.max(0, Math.min(100, n))}%"></i></div>`;
const art = (g: Game) => `<svg class="journal-art" viewBox="0 0 120 60" aria-hidden="true"><path fill="#71885b" d="M0 35Q35 5 65 25T120 15V60H0Z"/><path fill="#8eac72" d="M0 55Q24 29 56 47T120 32V60H0Z"/><path d="M33 61Q31 43 53 41T83 21" stroke="#c2d59b" stroke-width="12" fill="none"/><path fill="#ead8a4" d="M76 25q-8-6-11 1t7 5q7 0 4-6"/><ellipse fill="#6d9f9b" cx="15" cy="53" rx="18" ry="9"/><path d="M83 24V9" stroke="#f5eed3" stroke-width=".8"/><path fill="${g.region === 'desert' ? '#df9e65' : '#d8795d'}" d="M83 9l9 3-9 3z"/></svg>`;
export function journalPanel(g: Game, view: JournalView): string {
  const loc = activeLocation(g), level = careerLevel(g), current = CAREER[level], next = CAREER[level + 1];
  const earned = g.campaign.claimed.length, suggestion = nextSuggestion(g);
  const header = `<div class="journal-title"><div><span class="eyebrow">WILLOW CREEK · YOUR FIRST COURSE</span><h2>${escapeHtml(g.name)}</h2></div></div><div class="journal-tabs" role="tablist" aria-label="Course goals">${(['progress','projects'] as JournalView[]).map(v => `<button role="tab" aria-selected="${view === v}" data-act="journal" data-id="${v}" class="${view === v ? 'on' : ''}">${v === 'progress' ? 'Goals' : 'Quick fixes'}</button>`).join('')}</div>`;
  const career = `<div class="career-card"><span class="career-medal">${level + 1}</span><div><div class="row"><b>${current.title}</b><span>${g.experience.xp} XP</span></div>${bar(next ? (g.experience.xp - current.xp) / (next.xp - current.xp) * 100 : 100)}<small>${next ? `${next.xp - g.experience.xp} XP to ${next.title.toLowerCase()}` : 'Highest career level reached'}</small></div></div>`;
  let body = '';
  if (view === 'progress') {
    body = `${career}<button class="next-project" data-act="suggest" data-id="${suggestion.action}"><span class="eyebrow">SUGGESTED NEXT STEP</span><b>${suggestion.title}</b><small>${suggestion.description}</small><span class="next-arrow">↗</span></button><div class="property-cover">${art(g)}<span class="eyebrow">${loc.name.toUpperCase()} · ${g.season.name.toUpperCase()}</span><h3>A course worth<br>coming back to.</h3><span class="cover-tag">${earned} / ${loc.objectives.length} restoration goals</span></div><div class="property-stats"><div><b>${g.openHoles.length}</b><small>OPEN HOLES</small></div><div><b>${Math.round(g.reputation)}<em>%</em></b><small>GUEST HAPPINESS</small></div><div><b>${g.members.length}</b><small>MEMBERS</small></div></div><div class="section-label"><span>RESTORATION GOALS</span><span>${earned} OF ${loc.objectives.length}</span></div>${loc.objectives.map(o => {
      const claimed = g.campaign.claimed.includes(o.id), value = Math.max(0, Math.min(o.target, o.value(g))), ready = value >= o.target;
      return `<div class="goal-ticket ${claimed ? 'collected' : ''}"><span class="goal-symbol">${claimed ? '✓' : ready ? '✦' : '○'}</span><div class="goal-ticket-body"><div class="row"><b>${o.title}</b><span class="reward">${fmtMoney(o.reward)}</span></div><p>${o.detail}</p>${bar(value / o.target * 100)}<div class="row goal-footer"><small>${claimed ? 'Reward collected' : Math.round(value) + ' / ' + o.target}</small>${!claimed ? `<button class="btn ${ready ? 'primary' : ''}" data-act="claim" data-id="${o.id}" ${ready ? '' : 'disabled'}>${ready ? 'Collect reward' : 'In progress'}</button>` : '<span class="pos">+75 career XP</span>'}</div></div></div>`;
    }).join('')}`;
  } else if (view === 'projects') {
    const offers = projectOffers(g);
    body = `<div class="section-intro"><span class="eyebrow">REINVEST IN YOUR COURSE</span><h3>Choose your next project.</h3><p>Restore the greens, reopen lost holes, and improve the clubhouse.</p></div><div class="budget-line"><span>Available to invest</span><b>${fmtMoney(g.cash)}</b></div>${offers.map((p, i) => `<article class="project-tile ${p.locked ? 'locked-project' : ''}"><div class="project-illustration project-${p.id}"><svg viewBox="0 0 100 60" aria-hidden="true"><path fill="#6e935c" d="M8 48Q30 13 61 24T92 42Q75 61 43 50T8 48"/><path fill="#bfd595" d="M27 43Q39 26 64 35T62 49Q41 53 27 43"/><path d="M55 43V15" stroke="#f3ecd1" stroke-width="2"/><path fill="#d58b63" d="M56 15l13 5-13 5z"/><circle fill="#dfcc96" cx="25" cy="39" r="5"/></svg><span>0${i + 1}</span></div><div class="project-copy"><div class="row"><h4>${p.title}</h4><span class="xp-chip">${p.xp ? '+' + p.xp + ' XP' : 'TURF CARE'}</span></div><p>${p.description}</p><div class="row"><strong>${fmtMoney(p.cost)}</strong><button class="btn primary" data-act="project" data-id="${p.id}" ${p.locked || g.cash < p.cost ? 'disabled' : ''}>${p.locked ? 'Locked' : 'Review project'}</button></div>${p.locked ? `<small class="lock-note">${p.locked}</small>` : g.cash < p.cost ? `<small class="lock-note">${fmtMoney(p.cost - g.cash)} more needed</small>` : ''}</div></article>`).join('') || '<div class="card"><b>Every planned improvement is complete.</b><p class="dim">Use Course to refine your holes, buy more land, or work toward your restoration goals.</p></div>'}${(Object.keys(SITE_PROJECTS) as SiteId[]).filter(id => g.experience.site[id]).map(id => `<div class="completed-project"><span>✓</span><div><b>${SITE_PROJECTS[id].name}</b><small>Built at this property</small></div></div>`).join('')}${g.cash < 150 && !g.experience.reserveUsed ? '<div class="card"><b>A little breathing room</b><p class="dim">A one-time $650 restoration reserve is available at this property. No interest or purchases.</p><button class="btn" data-act="reserve">Use operating reserve</button></div>' : ''}`;
  } else {
    body = `${career}<div class="section-intro"><span class="eyebrow">YOUR RESTORATION COLLECTION</span><h3>Your restored courses.</h3><p>A record of your completed courses, their designs, and the golfers you won over.</p></div><div class="collection-grid">${LOCATIONS.map((l, i) => {
      const record = g.experience.archives.find(a => a.id === l.id), current = i === g.campaign.stage;
      return `<button class="collection-card ${i > g.campaign.stage ? 'locked' : ''}" data-act="${record ? 'archive' : current ? 'journal' : 'locked'}" data-id="${record ? l.id : 'progress'}"><div class="collection-image">${record ? `<canvas data-archive="${l.id}" width="360" height="240" aria-label="Restored course map"></canvas>` : `<span class="collection-ordinal">0${i + 1}</span>`}<span class="collection-status">${record ? 'RESTORED' : current ? 'YOUR CURRENT COURSE' : 'NEXT CHAPTER'}</span></div><div class="row"><b>${l.name}</b><span>${record ? '↗' : current ? '→' : '○'}</span></div><small>${record ? `${record.holes} holes · design ${record.design} · ${record.members} members` : current ? 'Your restoration is in progress' : 'Complete the previous property to unlock'}</small></button>`;
    }).join('')}</div>`;
  }
  return `<div class="journal">${header}${body}</div>`;
}
export function paintArchive(canvas: HTMLCanvasElement, archive: CourseArchive) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const w = 120, h = 80, sx = canvas.width / w, sy = canvas.height / h;
  const colors = ['#6b8054','#a9bd7d','#c1d3a0','#c6ca91','#e0cc9c','#6b9fa8','#b9b49b','#e8dcc2'];
  ctx.fillStyle = '#657c51';ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let i=0;i<archive.terrain.length;i++){ctx.fillStyle=archive.trees[i]==='1'?'#365d43':colors[Number(archive.terrain[i])] || colors[0];ctx.fillRect(i%w*sx,Math.floor(i/w)*sy,sx+.2,sy+.2);}
  ctx.font='bold 10px system-ui';ctx.textAlign='center';
  for(const p of archive.pins){ctx.fillStyle='#fbefcf';ctx.beginPath();ctx.arc(p.x*sx,p.y*sy,7,0,Math.PI*2);ctx.fill();ctx.fillStyle='#214c36';ctx.fillText(String(p.id),p.x*sx,p.y*sy+3);}
}
export function drawJournalArchives(root: HTMLElement, g: Game) {
  root.querySelectorAll<HTMLCanvasElement>('canvas[data-archive]').forEach(c => { const a = g.experience.archives.find(a => a.id === c.dataset.archive); if (a) paintArchive(c, a); });
}
