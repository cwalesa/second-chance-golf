import type { Game } from './game';
import { fmtMoney } from './game';
import { CHAIN, chainStep, currentGoal, goalProgressText } from './campaign';
import { escapeHtml } from './panels';

export type JournalView = 'progress' | 'projects';

const GO_LABEL: Record<string, string> = { build: 'Start building', course: 'Open Course', club: 'Open Clubhouse', money: 'Open Finances', events: 'Open Events' };

/** The Goals panel: the one goal to work on now, then the road from first hole to eighteen. */
export function journalPanel(g: Game, _view: JournalView): string {
  const step = chainStep(g);
  const goal = currentGoal(g);
  const done = step >= CHAIN.length;
  let html = `<div class="chain">`;
  if (goal) {
    const pct = Math.max(0, Math.min(100, (goal.value(g) / goal.target) * 100));
    html += `<div class="chain-now">
      <span class="chain-k">Goal ${step + 1} of ${CHAIN.length}</span>
      <h3>${goal.title}</h3>
      <p>${goal.how}</p>
      <div class="chain-bar"><i style="width:${pct}%"></i></div>
      <div class="chain-row"><span>${goalProgressText(goal, g)}</span><span class="chain-reward">Reward ${fmtMoney(goal.reward)}</span></div>
      ${goal.go ? `<button class="btn primary chain-go" data-act="goalgo" data-id="${goal.go}">${GO_LABEL[goal.go]}</button>` : ''}
    </div>`;
  } else {
    html += `<div class="chain-now chain-free"><span class="chain-k">All ${CHAIN.length} goals done</span><h3>${escapeHtml(g.name)} is complete</h3><p>Eighteen holes and a grand clubhouse. From here it is a sandbox: build, reshape and decorate however you like.</p></div>`;
  }
  html += `<ol class="chain-list">${CHAIN.map((c, i) => {
    const state = i < step ? 'done' : i === step ? 'now' : 'later';
    return `<li class="${state}"><span class="chain-dot">${i < step ? '✓' : i + 1}</span><span class="chain-t">${c.title}</span><span class="chain-r">${i < step ? 'Done' : fmtMoney(c.reward)}</span></li>`;
  }).join('')}<li class="${done ? 'done' : 'later'}"><span class="chain-dot">★</span><span class="chain-t">Sandbox: build freely</span><span class="chain-r"></span></li></ol>`;
  return html + `</div>`;
}
