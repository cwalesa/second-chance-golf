import { CFG } from './config';
import { Game, fmtMoney } from './game';
import { Editor, terrainLabel } from './input';
import { BRUSH_RADII, PAINT_TOOLS, TOOL_INFO, ToolId } from './editing';
import { holeCondition, holeStraightTiles, idx } from './terrain';
import { operatingProfit, netChange, UPGRADE_IDS, UpgradeId, cartRentalRate } from './economy';

type Tab = 'course' | 'guests' | 'money' | 'goals';

const ICON: Record<string, string> = {
  inspect: '<circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l6 6" />',
  pan: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />',
  fairway: '<rect x="4" y="5" width="16" height="14" rx="5" fill="#6ab24a" stroke="none" /><path d="M8 7v10M12 7v10M16 7v10" stroke="#8fd06a" />',
  rough: '<path d="M5 20c0-6 1-10 2-13M10 20c0-5 0-9 1-13M15 20c0-4 1-8 3-11M20 20c-1-3-1-6 0-8" stroke="#69a85a" />',
  bunker: '<path d="M3 17c2-5 5-8 9-8s7 3 9 8z" fill="#e8d49c" stroke="#b89a5a" /><path d="M7 15h.01M12 13h.01M16 15h.01" stroke="#b89a5a" />',
  water: '<path d="M3 9c3-3 6 3 9 0s6 3 9 0M3 15c3-3 6 3 9 0s6 3 9 0" stroke="#5aaee8" />',
  treeAdd: '<circle cx="11" cy="9" r="6" fill="#3d8f55" stroke="none" /><path d="M11 14v7" stroke="#8a6a46" /><path d="M19 3v6M16 6h6" stroke="#f1ead6" />',
  treeDel: '<circle cx="11" cy="9" r="6" fill="#3d8f55" stroke="none" /><path d="M11 14v7" stroke="#8a6a46" /><path d="M16 3l5 5M21 3l-5 5" stroke="#ee7a58" />',
  repair: '<path d="M12 21V11" stroke="#7fd17a" /><path d="M12 13c-4 0-6-2-6-6 4 0 6 2 6 6zM12 11c0-4 2-6 6-6 0 4-2 6-6 6z" fill="#7fd17a" stroke="none" />',
  tee: '<path d="M8 21l4-7 4 7" /><circle cx="12" cy="11" r="3" fill="#f5f5ef" /><path d="M4 4l4 3M4 4l1 4" />',
  cup: '<ellipse cx="12" cy="20" rx="6" ry="2" fill="#2b3b2d" /><path d="M12 20V4" /><path d="M12 4l7 3-7 3" fill="#d2432f" stroke="none" />',
  undo: '<path d="M9 7L4 12l5 5" /><path d="M4 12h10a6 6 0 010 12" transform="translate(0 -5)" />',
};
const svg = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

const word = (s: number) => (s >= 80 ? 'Great' : s >= 65 ? 'Good' : s >= 50 ? 'Fair' : 'Poor');
const col = (v: number) => (v >= 70 ? '#86cf7e' : v >= 45 ? '#e6b44c' : '#ee7a58');
const bar = (v: number) => `<div class="bar"><i style="width:${Math.max(2, Math.min(100, v))}%;background:${col(v)}"></i></div>`;
const money = (n: number) => `<span class="${n < 0 ? 'neg' : n > 0 ? 'pos' : ''}">${n > 0 ? '+' : ''}${fmtMoney(n)}</span>`;

export class UI {
  tab: Tab = 'course';
  private busy = false;
  private cache = new Map<string, string>();
  private lastSaved = 0;
  private repeat: number | null = null;
  onReset: () => void = () => {};
  onSaveNow: () => void = () => {};

  constructor(private game: Game, private editor: Editor) {
    document.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('#side, #top, #tools')) this.busy = true;
    });
    const release = () => (this.busy = false);
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
    this.buildTools();
    this.buildTop();
    this.buildSide();
    this.buildIntro();
    game.onNotice = (n) => this.toast(n.text, n.kind);
    editor.onSelect = (what) => {
      this.tab = what === 'golfer' ? 'guests' : 'course';
      this.cache.delete('side');
    };
  }

  // ---------- static pieces ----------
  private $(id: string) {
    return document.getElementById(id)!;
  }

  private buildTools() {
    const mk = (id: ToolId, label?: string) => `<button class="tool" data-tool="${id}" title="${TOOL_INFO[id].label}: ${TOOL_INFO[id].hint}">${svg(id)}<span>${label ?? TOOL_INFO[id].label}</span></button>`;
    this.$('tools').innerHTML = `
      <div class="grp">${mk('inspect')}${mk('pan')}</div>
      <div class="grp"><div class="cap">Paint</div>${mk('fairway')}${mk('rough')}${mk('bunker')}${mk('water')}${mk('repair', 'Repair')}</div>
      <div class="grp"><div class="cap">Trees</div>${mk('treeAdd', 'Plant')}${mk('treeDel', 'Clear')}</div>
      <div class="grp"><div class="cap">Hole</div>${mk('tee', 'Move tee')}${mk('cup', 'Move cup')}</div>
      <div class="grp"><div class="cap">Brush</div><div class="brushes">${BRUSH_RADII.map((_, i) => `<button data-brush="${i}" title="Brush size ${i + 1}"><i style="width:${5 + i * 4}px;height:${5 + i * 4}px"></i></button>`).join('')}</div></div>
      <div class="grp"><button class="tool" data-act="undo" id="undoBtn">${svg('undo')}<span>Undo</span></button></div>`;
    this.$('tools').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.tool) this.editor.setTool(b.dataset.tool as ToolId);
      else if (b.dataset.brush) this.editor.setBrush(Number(b.dataset.brush));
      else if (b.dataset.act === 'undo') this.game.undo();
      this.refresh(true);
    });
  }

  private buildTop() {
    const speeds: [number, string][] = [[0, 'Pause'], [1, '1×'], [3, '3×'], [8, '8×']];
    this.$('top').innerHTML = `
      <div class="brand"><svg width="24" height="24" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#244d33"/><path d="M12 24V7l10 4-10 4" fill="#e6b44c" stroke="#e6b44c" stroke-width="2" stroke-linejoin="round"/><ellipse cx="12" cy="25" rx="6" ry="2" fill="#95d17a"/></svg><span>Second Chance Golf</span></div>
      <div class="sep"></div>
      <div class="stat"><span class="k">Cash</span><span class="v cash" id="cash"></span></div>
      <div class="stat"><span class="k" id="dayk"></span><span class="v small" id="clock"></span><div class="daybar"><i id="daybar"></i></div></div>
      <div class="stat"><span class="k">Green fee</span><div class="fee"><button data-fee="-1" aria-label="Lower fee">−</button><span class="v" id="fee"></span><button data-fee="1" aria-label="Raise fee">+</button></div></div>
      <div class="stat" id="satbox" title="Average satisfaction of recent guests"><span class="k">Guests</span><span class="v small" id="sat"></span><div class="meter"><i id="satbar"></i></div></div>
      <div class="stat" title="Operating profit so far today (fees and sales minus maintenance)"><span class="k">Today</span><span class="v small" id="todayp"></span></div>
      <div class="stat"><span class="k">On course</span><span class="v small" id="oncourse"></span></div>
      <div class="spacer"></div>
      <span class="saved" id="saved"></span>
      <div class="seg" id="speed">${speeds.map(([s, l]) => `<button data-speed="${s}">${l}</button>`).join('')}</div>
      <button class="btn" id="resetBtn">Reset</button>`;
    const top = this.$('top');
    top.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.speed !== undefined) this.game.setSpeed(Number(b.dataset.speed));
      if (b.id === 'resetBtn') this.confirmReset();
    });
    const stopRepeat = () => {
      if (this.repeat) window.clearInterval(this.repeat);
      this.repeat = null;
    };
    top.addEventListener('pointerdown', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b || !b.dataset.fee) return;
      const step = Number(b.dataset.fee);
      const apply = () => {
        this.game.setFee(this.game.fee + step);
        this.refresh(true);
      };
      apply();
      stopRepeat();
      const t = window.setTimeout(() => {
        this.repeat = window.setInterval(apply, 70);
      }, 380);
      const end = () => {
        window.clearTimeout(t);
        stopRepeat();
        window.removeEventListener('pointerup', end);
      };
      window.addEventListener('pointerup', end);
    });
  }

  private buildSide() {
    this.$('side').innerHTML = `<div class="tabs">${(['course', 'guests', 'money', 'goals'] as Tab[]).map((t) => `<button data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div><div class="body" id="sidebody"></div>`;
    this.$('side').addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-tab],[data-act],[data-hole]') as HTMLElement | null;
      if (!el) return;
      if (el.dataset.tab) {
        this.tab = el.dataset.tab as Tab;
        this.cache.delete('side');
      } else if (el.dataset.hole) {
        this.game.selectedHole = Number(el.dataset.hole);
      } else if (el.dataset.act) {
        const id = Number(el.dataset.id);
        if (el.dataset.act === 'open') this.game.openHole(id);
        else if (el.dataset.act === 'close') this.game.closeHole(id);
        else if (el.dataset.act === 'buy') this.game.buyUpgrade(el.dataset.id as UpgradeId);
        else if (el.dataset.act === 'cartfee') this.game.setCartFee(this.game.cartFee + Number(el.dataset.id));
        else if (el.dataset.act === 'tool') this.editor.setTool(el.dataset.id as ToolId);
        else if (el.dataset.act === 'clear-golfer') this.game.selectedGolfer = 0;
      }
      this.refresh(true);
    });
    this.$('goalbar').addEventListener('click', () => {
      this.tab = 'goals';
      this.refresh(true);
    });
  }

  private buildIntro() {
    if (this.game.settings.introSeen) return;
    this.$('intro').innerHTML = `<div class="card"><h2>A second chance</h2>
      <div>You bought a struggling public course. Two holes are playable, one is closed, and your cash is tight.</div>
      <ol><li>Watch the golfers. Their comments and the Guests tab show what is going wrong.</li>
      <li>Hole 2 has a worn green: pick <b>Repair</b>, drag over the green, then reopen the hole.</li>
      <li>Restore hole 3 by connecting its fairway, then open it.</li></ol>
      <button class="btn primary" id="introOk">Got it</button></div>`;
    this.$('introOk').addEventListener('click', () => {
      this.game.settings.introSeen = true;
      this.$('intro').innerHTML = '';
    });
  }

  confirmReset() {
    const m = this.$('modal');
    m.hidden = false;
    m.innerHTML = `<div class="box" role="dialog" aria-label="Reset game"><h2>Reset the game?</h2><p>This deletes your saved course, cash, upgrades and goals and starts a brand new game. It cannot be undone.</p><div class="actions"><button class="btn" id="rsCancel">Keep playing</button><button class="btn danger" id="rsOk">Reset and start over</button></div></div>`;
    this.$('rsCancel').onclick = () => (m.hidden = true);
    this.$('rsOk').onclick = () => {
      m.hidden = true;
      this.onReset();
    };
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    const box = this.$('toasts');
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild!.remove();
    window.setTimeout(() => t.remove(), kind === 'bad' ? 6000 : 4500);
    if (kind === 'bad' && /need|cash/i.test(text)) {
      const c = this.$('cash');
      c.classList.remove('flash');
      void c.offsetWidth;
      c.classList.add('flash');
    }
  }

  markSaved() {
    this.lastSaved = performance.now();
  }

  // ---------- dynamic ----------
  refresh(force = false) {
    const g = this.game;
    const set = (id: string, v: string) => {
      if (this.cache.get(id) !== v) {
        this.cache.set(id, v);
        this.$(id).textContent = v;
      }
    };
    set('cash', fmtMoney(g.cash));
    set('dayk', `Day ${g.day}`);
    set('clock', g.clockText);
    (this.$('daybar') as HTMLElement).style.width = `${(g.clock / CFG.day.seconds) * 100}%`;
    set('fee', fmtMoney(g.fee));
    set('todayp', `${operatingProfit(g.today) >= 0 ? '+' : ''}${fmtMoney(operatingProfit(g.today))} · ${g.today.rounds} rounds`);
    const rep = g.reputation;
    set('sat', `${Math.round(rep)} · ${word(rep)}`);
    const sb = this.$('satbar') as HTMLElement;
    sb.style.width = `${rep}%`;
    sb.style.background = col(rep);
    set('oncourse', `${g.sim.golfers.length} golfers`);
    const waiting = g.world.holes.reduce((s, h) => s + g.sim.queueFor(h.id).length, 0);
    if (waiting) set('oncourse', `${g.sim.golfers.length} · ${waiting} waiting`);
    const sec = Math.round((performance.now() - this.lastSaved) / 1000);
    set('saved', this.lastSaved ? (sec < 4 ? 'Saved' : `Saved ${sec}s ago`) : '');
    this.$('speed').querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.speed) === g.settings.speed));

    // tool buttons
    this.$('tools').querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tool === this.editor.tool));
    this.$('tools').querySelectorAll('[data-brush]').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.brush) === this.editor.brush));
    const brushOn = this.editor.isPaint;
    (this.$('tools').querySelector('.brushes') as HTMLElement).style.opacity = brushOn ? '1' : '0.4';
    const undo = this.$('undoBtn') as HTMLButtonElement;
    const u = g.canUndo;
    undo.disabled = !u;
    undo.title = u ? `Undo ${u.label} (refunds ${fmtMoney(u.cost)})` : 'Nothing to undo';
    this.$('side').querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tab === this.tab));
    (this.$('view') as HTMLElement).classList.toggle('pan', this.editor.tool === 'pan');

    this.renderPill();
    this.renderGoalBar();
    if (this.busy && !force) return;
    const html = this.sideHtml();
    if (force || this.cache.get('side') !== html) {
      const body = this.$('sidebody');
      const top = body.scrollTop;
      body.innerHTML = html;
      body.scrollTop = top;
      this.cache.set('side', html);
    }
  }

  private renderPill() {
    const pill = this.$('pill');
    const p = this.editor.preview;
    let html: string;
    let cls = '';
    const tool = this.editor.tool;
    if (p && (p.tiles > 0 || p.message)) {
      if (p.tiles > 0) {
        const need = p.cost - this.game.cash;
        cls = p.affordable ? 'good' : 'bad';
        html = `<span><b>${p.label}</b> · ${p.tiles} tile${p.tiles === 1 ? '' : 's'}${p.stroking ? ' this stroke' : ''}</span><span class="money">${fmtMoney(p.cost)}</span>${p.affordable ? '' : `<span>Need ${fmtMoney(need)} more</span>`}${p.limited ? `<span>${p.message}</span>` : ''}`;
      } else {
        cls = 'bad';
        html = `<span>${p.message}</span>`;
      }
    } else {
      const info = TOOL_INFO[tool];
      html = `<span><b>${info.label}</b> · ${info.hint}</span>`;
      if (PAINT_TOOLS.includes(tool)) html += `<span class="dim">Drag to paint. You are only charged for tiles that change.</span>`;
    }
    const key = cls + html;
    if (this.cache.get('pill') !== key) {
      this.cache.set('pill', key);
      pill.className = cls;
      pill.innerHTML = html;
    }
  }

  private renderGoalBar() {
    const g = this.game;
    const next = CFG.goals.find((d) => !g.goalDone(d.id));
    const html = next ? `<div class="k">Next goal · +${fmtMoney(next.reward)}</div><div>${next.title}</div><div class="p">${this.goalProgress(next.id)}</div>` : `<div class="k">All goals complete</div><div class="p">Keep improving the course and the books.</div>`;
    if (this.cache.get('goalbar') !== html) {
      this.cache.set('goalbar', html);
      this.$('goalbar').innerHTML = html;
    }
  }

  private goalProgress(id: string): string {
    const g = this.game;
    if (id === 'green') return `Hole 2 green condition ${Math.round(holeCondition(g.world, g.hole(2)).green)} of 75 needed${g.hole(2).open ? '' : ' (closed for work)'}`;
    if (id === 'reopen') {
      const h = g.hole(3);
      if (h.open) return 'Open';
      const v = g.validate(3);
      return v.ok ? 'Ready: press Open hole' : v.problems[0];
    }
    const t = g.today;
    const avg = t.rounds ? t.satSum / t.rounds : 0;
    return `Today: profit ${fmtMoney(operatingProfit(t))}, ${t.rounds}/${CFG.satisfaction.goalMinRounds} rounds, satisfaction ${t.rounds ? Math.round(avg) : '-'}/${CFG.satisfaction.goal}`;
  }

  private sideHtml(): string {
    switch (this.tab) {
      case 'course': return this.courseHtml();
      case 'guests': return this.guestsHtml();
      case 'money': return this.moneyHtml();
      default: return this.goalsHtml();
    }
  }

  private courseHtml(): string {
    const g = this.game;
    const w = g.world;
    const tool = this.editor.tool;
    const info = TOOL_INFO[tool];
    const C = CFG.costs;
    const costLine: Partial<Record<ToolId, string>> = {
      fairway: `${fmtMoney(C.fairway)} per tile (${fmtMoney(C.fairwayFromHazard)} over sand or water)`,
      rough: `${fmtMoney(C.rough)} per tile`,
      bunker: `${fmtMoney(C.bunker)} per tile`,
      water: `${fmtMoney(C.water)} per tile`,
      treeAdd: `${fmtMoney(C.treePlant)} per tree`,
      treeDel: `${fmtMoney(C.treeRemove)} per tree`,
      repair: `About ${fmtMoney(1)} to ${fmtMoney(6)} per tile, greens double. Only worn tiles are charged.`,
      tee: `${fmtMoney(C.moveTeeBase)} plus ${fmtMoney(C.moveTeePerTile)} per tile changed`,
      cup: `${fmtMoney(C.moveCupBase)} plus ${fmtMoney(C.moveCupPerTile)} per tile changed`,
    };
    const h = g.hole(g.selectedHole);
    const cond = holeCondition(w, h);
    const v = g.validate(h.id);
    const lenYd = Math.round(holeStraightTiles(h) * CFG.grid.yardsPerTile);
    const queued = g.sim.queueFor(h.id).length;
    const playing = g.sim.onHole(h.id);
    const st = h.stats;
    let html = `<div class="sec"><h3>Tool</h3><div class="card"><div class="t">${info.label}</div><div class="dim">${info.hint}</div>${costLine[tool] ? `<div style="margin-top:4px">${costLine[tool]}</div>` : ''}${tool === 'tee' || tool === 'cup' ? `<div style="margin-top:4px" class="note warn">Editing hole ${h.id}. Tap a tile on the map to place it.</div>` : ''}</div></div>`;
    html += `<div class="sec"><h3>Holes</h3><div class="chips">${w.holes.map((x) => `<button class="chip ${x.id === h.id ? 'on' : ''}" data-hole="${x.id}"><span class="st ${x.open ? 'open' : ''}"></span>${x.id} ${x.name}</button>`).join('')}</div>`;
    html += `<div class="card"><div class="row"><span class="t">Hole ${h.id}, ${h.name}</span><span class="badge ${h.open ? 'open' : 'closed'}">${h.open ? 'OPEN' : 'CLOSED'}</span></div>
      <div class="row"><span class="k">Par ${h.par}</span><span>${lenYd} yards</span></div>
      <div class="barrow"><span>Fairway</span>${bar(cond.fairway)}<span class="n">${Math.round(cond.fairway)}</span></div>
      <div class="barrow"><span>Green</span>${bar(cond.green)}<span class="n">${Math.round(cond.green)}</span></div>
      <div class="barrow"><span>Tee box</span>${bar(cond.tee)}<span class="n">${Math.round(cond.tee)}</span></div>
      <div class="dim" style="margin-top:2px">${Math.round(cond.wornShare * 100)}% of its turf is worn</div>`;
    if (!h.open) {
      for (const p of v.problems) html += `<div class="note bad">${p}</div>`;
      for (const p of v.warnings) html += `<div class="note warn">${p}</div>`;
      html += `<div style="margin-top:8px"><button class="btn primary" data-act="open" data-id="${h.id}" ${v.ok ? '' : 'disabled'}>Open hole</button></div>`;
      if (!v.ok) html += `<div class="dim" style="margin-top:6px">Fix the problems above, then open it.</div>`;
    } else {
      for (const p of v.warnings) html += `<div class="note warn">${p}</div>`;
      html += `<div class="row"><span class="k">Playing now</span><span>${playing}</span></div><div class="row"><span class="k">Waiting at tee</span><span>${queued}</span></div>`;
      html += `<div style="margin-top:8px"><button class="btn" data-act="close" data-id="${h.id}">Close hole</button></div><div class="dim" style="margin-top:6px">Editing this hole closes it automatically so no golfer is caught mid-hole.</div>`;
    }
    html += `</div>`;
    html += `<div class="card"><div class="t">Results on this hole</div>${st.rounds ? `<div class="row"><span class="k">Rounds</span><span>${st.rounds}</span></div><div class="row"><span class="k">Average score</span><span>${(st.strokes / st.rounds).toFixed(1)} (par ${h.par})</span></div><div class="row"><span class="k">Water balls</span><span>${st.water}</span></div><div class="row"><span class="k">Picked up</span><span>${st.picked}</span></div>` : '<div class="dim">No golfer has finished this hole yet.</div>'}</div></div>`;
    const it = this.editor.inspectTile;
    if (it) {
      const i = idx(w, it.x, it.y);
      const t = w.terrain[i];
      html += `<div class="sec"><h3>Tile (${it.x}, ${it.y})</h3><div class="row"><span class="k">Ground</span><span>${terrainLabel(t)}${w.tree[i] ? ' with tree' : ''}</span></div>${t <= 3 ? `<div class="row"><span class="k">Condition</span><span>${Math.round(w.cond[i])}</span></div>${bar(w.cond[i])}<div class="dim" style="margin-top:4px">${t === 0 ? (w.cond[i] < 45 ? 'Overgrown: bad lies and slow shots.' : 'Maintained rough.') : w.cond[i] < CFG.turf.wornBelow ? 'Worn: shorter, wilder shots from here.' : 'Healthy turf.'}</div>` : ''}<div class="row"><span class="k">Belongs to</span><span>${w.zone[i] ? `Hole ${w.zone[i]}` : 'No hole'}</span></div></div>`;
    }
    return html;
  }

  private guestsHtml(): string {
    const g = this.game;
    const rec = g.recent;
    const rep = g.reputation;
    const avg = (k: 'price' | 'cond' | 'diff' | 'pace') => (rec.length ? rec.reduce((s, r) => s + r[k], 0) / rec.length : 0);
    let html = `<div class="sec"><h3>Satisfaction</h3><div class="row" style="align-items:baseline"><span class="big">${Math.round(rep)}</span><span style="font-weight:700">${word(rep)}</span></div>`;
    if (!rec.length) html += `<div class="note">No rounds finished yet. Satisfaction starts at a neutral ${CFG.satisfaction.prior} until guests have played.</div>`;
    else {
      const rows: [string, 'price' | 'cond' | 'diff' | 'pace', string][] = [['Price', 'price', ''], ['Conditions', 'cond', ''], ['Difficulty', 'diff', ''], ['Pace', 'pace', '']];
      for (const [label, k] of rows) html += `<div class="barrow"><span>${label}</span>${bar(avg(k))}<span class="n">${Math.round(avg(k))}</span></div>`;
      html += `<div class="dim" style="margin-top:2px">Average of the last ${rec.length} rounds.</div>`;
    }
    html += `</div><div class="sec"><h3>Why</h3>`;
    const notes: string[] = [];
    const fair = g.fair;
    notes.push(`<div class="note ${g.fee > fair + 6 ? 'bad' : g.fee > fair + 2 ? 'warn' : 'good'}">Fee ${fmtMoney(g.fee)} against a fair price of about ${fmtMoney(fair)}.${g.fee > fair + 2 ? ' Guests feel overcharged.' : g.fee < fair - 8 ? ' Great value, but you are leaving money behind.' : ''}</div>`);
    if (rec.length) {
      const wornHoles = g.world.holes.filter((h) => h.open && holeCondition(g.world, h).green < CFG.turf.wornBelow);
      if (avg('cond') < 65) notes.push(`<div class="note ${avg('cond') < 45 ? 'bad' : 'warn'}">Turf: average lie condition is low${wornHoles.length ? `. The green on hole ${wornHoles.map((h) => h.id).join(', ')} is worn` : ''}. Use Repair.</div>`);
      const rough = rec.reduce((s, r) => s + r.rough, 0) / rec.length;
      const water = rec.reduce((s, r) => s + r.water, 0) / rec.length;
      if (avg('diff') < 60) notes.push(`<div class="note bad">Difficulty: ${Math.round(rough * 100)}% of shots from rough, ${water.toFixed(1)} water balls per round.</div>`);
      const wait = rec.reduce((s, r) => s + r.wait, 0) / rec.length;
      if (avg('pace') < 70) notes.push(`<div class="note ${avg('pace') < 50 ? 'bad' : 'warn'}">Pace: guests wait about ${Math.round(wait)} seconds at tees. Open another hole or raise the fee.</div>`);
      if (avg('cond') >= 65 && avg('diff') >= 60 && avg('pace') >= 70 && g.fee <= fair + 2) notes.push('<div class="note good">Nothing is dragging scores down right now.</div>');
    }
    for (const h of g.world.holes) {
      if (!h.open || h.stats.rounds < 3) continue;
      const wr = h.stats.water / h.stats.rounds;
      if (wr >= 0.4) notes.push(`<div class="note warn">Hole ${h.id}: ${Math.round(wr * 100)}% of rounds lose a ball in the water.</div>`);
      if (h.stats.picked / h.stats.rounds >= 0.15) notes.push(`<div class="note warn">Hole ${h.id}: ${Math.round((h.stats.picked / h.stats.rounds) * 100)}% of golfers pick up. It may be too hard for beginners.</div>`);
    }
    html += notes.join('') + '</div>';
    const sg = g.sim.golfers.find((x) => x.id === g.selectedGolfer);
    if (sg) {
      const gt = CFG.golfers.types[sg.type];
      const h = g.world.holes.find((x) => x.id === sg.holeId);
      html += `<div class="sec"><h3>Selected golfer</h3><div class="card"><div class="row"><span class="t">${sg.name}</span><span class="dim">${gt.label}${sg.returning ? ', regular guest' : ''}</span></div>
        <div class="row"><span class="k">Now</span><span>${h ? `Hole ${h.id}, stroke ${sg.hs.strokes}` : sg.phase === 'toExit' || sg.phase === 'leave' ? 'Heading home' : 'Arriving'}</span></div>
        <div class="row"><span class="k">This round</span><span>${sg.holesDone} holes, ${sg.strokesDone - sg.parDone >= 0 ? '+' : ''}${sg.strokesDone - sg.parDone}</span></div>
        <div class="row"><span class="k">Rough / sand / water</span><span>${sg.stats.rough} / ${sg.stats.bunker} / ${sg.stats.water}</span></div>
        <div class="row"><span class="k">Waited</span><span>${Math.round(sg.stats.wait)}s</span></div><div style="margin-top:6px"><button class="btn" data-act="clear-golfer">Deselect</button></div></div></div>`;
    }
    html += `<div class="sec"><h3>Recent comments</h3><div class="feed">${g.comments.length ? g.comments.slice(-9).reverse().map((c) => `<div><b>${c.name}</b> <span class="dim">${CFG.golfers.types[c.type].label}${c.hole ? `, hole ${c.hole}` : ''}</span><br>${c.text}</div>`).join('') : '<div class="dim">Quiet so far. Golfers react to what happens to them.</div>'}</div></div>`;
    return html;
  }

  private moneyHtml(): string {
    const g = this.game;
    const t = g.today;
    const toNext = g.hourLen - (g.clock % g.hourLen);
    const row = (k: string, v: number, sign = 1) => `<div class="row"><span class="k">${k}</span>${money(sign * v)}</div>`;
    let html = `<div class="sec"><h3>Today, day ${g.day}</h3>${row('Green fees and cart rentals', t.fees)}${row('Clubhouse sales', t.shop)}${row('Maintenance', t.maintenance, -1)}<div class="row total"><span>Operating profit</span>${money(operatingProfit(t))}</div>${row('Construction and upgrades', t.construction, -1)}${t.bonus ? row('Goal bonuses', t.bonus) : ''}<div class="row total"><span>Net change in cash</span>${money(netChange(t))}</div>
      <div class="dim" style="margin-top:6px">Maintenance of ${fmtMoney(g.maintenanceRate)} is charged every game hour. Next charge in ${Math.ceil(toNext / 1)}s. ${t.arrivals} arrivals so far, expecting about ${Math.round(g.arrivalRate)} per day at this price.</div></div>`;
    const last = g.days[g.days.length - 1];
    if (last) html += `<div class="sec"><h3>Day ${last.day} summary</h3><div class="card"><div class="row"><span class="k">Revenue</span><span>${fmtMoney(last.fees + last.shop)}</span></div><div class="row"><span class="k">Maintenance</span><span>${fmtMoney(last.maintenance)}</span></div><div class="row"><span class="k">Construction</span><span>${fmtMoney(last.construction)}</span></div><div class="row"><span class="k">Rounds / satisfaction</span><span>${last.rounds} / ${last.rounds ? Math.round(last.avgSat) : '-'}</span></div><div class="row total"><span>Operating profit</span>${money(last.profit)}</div></div></div>`;
    html += `<div class="sec"><h3>Improvements</h3>`;
    if (g.upgrades.carts) html += `<div class="card"><div class="row"><span class="t">Cart rental price</span><span><button class="btn" data-act="cartfee" data-id="-1">−</button> <b>${fmtMoney(g.cartFee)}</b> <button class="btn" data-act="cartfee" data-id="1">+</button></span></div><div class="dim">About ${Math.round(cartRentalRate(g.cartFee) * 100)}% of golfers rent a cart at this price.</div></div>`;
    for (const id of UPGRADE_IDS) {
      const u = CFG.upgrades[id];
      html += `<div class="card"><div class="row"><span class="t">${u.name}</span><span class="reward">${fmtMoney(u.cost)}</span></div><div class="dim">${u.blurb}</div><div style="margin-top:6px">${g.upgrades[id] ? '<span class="badge open">OWNED</span>' : `<button class="btn" data-act="buy" data-id="${id}" ${g.cash < u.cost ? 'disabled' : ''}>Buy${g.cash < u.cost ? ` (need ${fmtMoney(u.cost - g.cash)} more)` : ''}</button>`}</div></div>`;
    }
    html += `</div><div class="sec"><h3>Recent transactions</h3><div class="feed">${g.log.filter((l) => !l.label.startsWith('Green fee')).slice(-8).reverse().map((l) => `<div class="row"><span>${l.label}<br><span class="dim">Day ${l.day}, ${l.hour}</span></span>${money(l.amount)}</div>`).join('') || '<div class="dim">Nothing yet.</div>'}</div></div>`;
    return html;
  }

  private goalsHtml(): string {
    const g = this.game;
    let html = `<div class="sec"><h3>Goals</h3>`;
    for (const d of CFG.goals) {
      const done = g.goalDone(d.id);
      html += `<div class="goal ${done ? 'done' : ''}"><div class="check">${done ? '✓' : ''}</div><div><div class="t">${d.title}</div><div class="dim">${d.detail}</div><div style="margin-top:3px">${done ? 'Complete' : this.goalProgress(d.id)} · <span class="reward">Bonus ${fmtMoney(d.reward)}</span></div></div></div>`;
    }
    html += `</div><div class="note">Bonuses are paid once, the moment a goal is met.</div>`;
    return html;
  }
}
