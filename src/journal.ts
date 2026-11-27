import type { Game } from './game';
import { fmtMoney } from './game';
import { CHAIN, chainStep, currentGoal, goalDone, regionComplete } from './campaign';
import { activeGoalsHtml, decisionsHtml } from './clubpanels';
import { escapeHtml } from './panels';
import { KINDS, challengeDone, challengeProgress } from './daily';
import { requestDone } from './requests';

export type JournalView = 'progress' | 'projects';

const GO_LABEL: Record<string, string> = { build: 'Show me', course: 'Show me', club: 'Show me', money: 'Show me', events: 'Show me', guests: 'Show me' };

/** The Goals panel: the one goal to work on now, then the road from first hole to eighteen. */
export function journalPanel(g: Game, _view: JournalView): string {
  const step = chainStep(g);
  const goal = currentGoal(g);
  const done = step >= CHAIN.length;
  void GO_LABEL;
  let html = `<div class="chain">`;
  // what guests have asked for: the most immediate things to do, so they come first among the goals
  if (g.requests.list.length) {
    html += `<div class="ch-head"><span>Guest requests</span><small>Fix within the time to earn the reward</small></div>`;
    for (const r of g.requests.list) {
      const left = r.until - g.day + 1, ok = requestDone(g, r);
      html += `<div class="req"><p class="req-q">\u201c${escapeHtml(r.text)}\u201d</p><div class="req-row"><span class="req-who">${escapeHtml(r.who)} · ${left <= 1 ? 'today only' : `${left} days left`}</span><span class="chain-reward">${ok ? 'Done' : fmtMoney(r.reward)}</span><button class="btn primary sm" data-act="reqgo" data-id="${r.id}">Show me</button></div></div>`;
    }
  }
  // choices with a deadline come first, then the few goals worth working on now (reached in any order)
  html += decisionsHtml(g);
  html += activeGoalsHtml(g);
  if (!goal) html += `<div class="chain-now chain-free"><span class="chain-k">All ${CHAIN.length} goals done</span><h3>${escapeHtml(g.name)} is complete</h3><p>A full eighteen and a resort lodge. From here it is a sandbox: build, reshape and decorate however you like.</p></div>`;
  // daily challenges are an optional extra, kept out of the way
  const d = g.daily;
  if (d.date) {
    const ready = d.challenges.filter((c) => !c.claimed && challengeDone(g, c)).length + (d.pending ? 1 : 0);
    html += `<details class="xp" data-sec="daily"><summary><span class="xp-t">Daily extras</span><span class="xp-n">${ready ? `${ready} to collect` : 'optional'}</span></summary><div class="xp-body today">
      ${d.pending ? `<div class="streak"><span class="flame" aria-hidden="true"></span><div><b>Welcome back</b><small>A small thank-you for visiting.</small></div><button class="btn primary" data-act="claimstreak">Collect ${fmtMoney(d.pending)}</button></div>` : ''}
      ${d.challenges.map((c, i) => {
        const v = challengeProgress(g, c), ok = challengeDone(g, c);
        return `<div class="ch ${c.claimed ? 'claimed' : ok ? 'ready' : ''}"><div class="ch-t"><b>${KINDS[c.kind].title(c.target)}</b><small>${c.claimed ? 'Collected' : `${Math.floor(v)} / ${c.target} · ${fmtMoney(c.reward)} + ${c.xp} XP`}</small><div class="chain-bar"><i style="width:${Math.round((v / c.target) * 100)}%"></i></div></div>${c.claimed ? '<span class="ch-check">✓</span>' : ok ? `<button class="btn primary" data-act="claimch" data-id="${i}">Collect</button>` : ''}</div>`;
      }).join('')}
    </div></details>`;
  }
  // a finished eighteen earns the region its mark; the other regions play differently and are there to try
  if (regionComplete(g)) html += `<div class="chain-now chain-free"><span class="chain-k">${escapeHtml(g.regionDef.name)} complete</span><h3>Try another region</h3><p>Each region changes costs, wind, seasons and what guests will pay. Starting a new course replaces this one, so export a backup first (Settings and save) if you want to keep it.</p><button class="btn chain-go" data-act="newcourse">Start a new course</button></div>`;
  html += `<div class="ch-head"><span>All goals</span></div><ol class="chain-list">${CHAIN.map((c, i) => {
    const ok = goalDone(g, c.id);
    const state = ok ? 'done' : i === step ? 'now' : 'later';
    return `<li class="${state}"><span class="chain-dot">${ok ? '✓' : i + 1}</span><span class="chain-t">${c.title}</span><span class="chain-r">${ok ? 'Done' : fmtMoney(c.reward)}</span></li>`;
  }).join('')}<li class="${done ? 'done' : 'later'}"><span class="chain-dot">★</span><span class="chain-t">Sandbox: build freely</span><span class="chain-r"></span></li></ol>`;
  return html + `</div>`;
}
