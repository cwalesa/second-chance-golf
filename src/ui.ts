import { paintToolTile } from './classic-art';
import { journalPanel, JournalView, drawJournalArchives, paintArchive } from './journal';
import { projectOffers, commissionProject, nextSuggestion, CAREER, careerLevel, useOperatingReserve } from './experience';
import { designPanel, staffPanel, membersPanel, escapeHtml } from './panels';
import { activeLocation, stageComplete } from './campaign';
import { StaffId } from './game';
import { CFG } from './config';
import { Game, fmtMoney } from './game';
import { Editor, terrainLabel } from './input';
import { BRUSH_RADII, PAINT_TOOLS, TOOL_INFO, ToolId, planPaint } from './editing';
import { EVENTS, EVENT_IDS, EventId } from './events';
import { holeCondition, holeStraightTiles, idx } from './terrain';
import { BANDS, CLUB_LEVELS, REGIONS } from './progression';
import { MILESTONES } from './goals';
import { logoDesigner, paintLogo } from './start';
import { operatingProfit, netChange, UPGRADE_IDS, UpgradeId, cartRentalRate } from './economy';

type Tab = 'journey' | 'build' | 'course' | 'guests' | 'money' | 'events' | 'club' | 'none';
const TAB_LABEL: Record<string, string> = { journey: 'Journey', build: 'Build', course: 'Course', guests: 'Guests', money: 'Money', events: 'Events', club: 'Club' };
const TAB_ICON: Record<string, string> = {
  journey: '<path d="M4 18l5-12 6 12 5-12M4 18h.01M20 6h.01"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="6" r="2"/>',
  build: '<path d="M4 20l6-6M14 4l6 6-8 8-6-6z" />',
  course: '<path d="M12 21V4M12 4l7 3-7 3" /><ellipse cx="12" cy="21" rx="6" ry="1.6" />',
  guests: '<circle cx="12" cy="8" r="3.5" /><path d="M5 20c1-4 4-6 7-6s6 2 7 6" />',
  money: '<circle cx="12" cy="12" r="8" /><path d="M12 7v10M9.5 9.5c0-1.4 5-1.4 5 0s-5 3-5 4.5 5 1.4 5 0" />',
  events: '<rect x="4" y="6" width="16" height="14" rx="2" /><path d="M4 11h16M9 3v5M15 3v5" />',
  club: '<path d="M4 20V9l8-5 8 5v11zM10 20v-6h4v6" />',
};
const stars = (n: number) => `${'★'.repeat(Math.floor(n))}${n % 1 ? '½' : ''}${'☆'.repeat(5 - Math.ceil(n))}`;

const ICON: Record<string, string> = {
  bend: '<path d="M4 20L10 8l10-4M10 8l4 1M10 8l-1 4"/>',
  green: '<ellipse cx="12" cy="14" rx="9" ry="6" fill="#87be78"/><path d="M12 16V4l5 2-5 2"/>',
  path: '<path d="M7 22c12-10-6-12 10-20M3 22C15 12-3 10 13 2" stroke="#d7c9ad"/>',
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
  build: '<path d="M4 20l6-6M14 4l6 6-8 8-6-6z" />',
  land: '<path d="M3 8l9-4 9 4v9l-9 4-9-4zM3 8l9 4 9-4M12 12v9" />',
  undo: '<path d="M9 7L4 12l5 5" /><path d="M4 12h10a6 6 0 010 12" transform="translate(0 -5)" />',
};
const svg = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

const word = (s: number) => (s >= 80 ? 'Great' : s >= 65 ? 'Good' : s >= 50 ? 'Fair' : 'Poor');
const col = (v: number) => (v >= 70 ? '#86cf7e' : v >= 45 ? '#e6b44c' : '#ee7a58');
const bar = (v: number) => `<div class="bar"><i style="width:${Math.max(2, Math.min(100, v))}%;background:${col(v)}"></i></div>`;
const money = (n: number) => `<span class="${n < 0 ? 'neg' : n > 0 ? 'pos' : ''}">${n > 0 ? '+' : ''}${fmtMoney(n)}</span>`;

export class UI {
  tab: Tab = 'none';
  journalView: JournalView = 'progress';
  get modalOpen() { return !this.$('modal').hidden; }
  get introOpen() { return this.$('intro').childElementCount > 0; }
  mobile = false;
  onInsets: () => void = () => {};
  private busy = false;
  private cache = new Map<string, string>();
  private lastSaved = 0;
  private repeat: number | null = null;
  onReset: () => void = () => {};
  onSaveNow: () => void = () => {};
  onExport: () => void = () => {};
  onImport: () => void = () => {};
  onNewLook: () => void = () => {};

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
    this.buildNav();
    this.buildIntro();
    this.setMobile(window.matchMedia('(max-width: 860px), (max-height: 520px) and (pointer: coarse)').matches);
    window.matchMedia('(max-width: 860px), (max-height: 520px) and (pointer: coarse)').addEventListener('change', (e) => this.setMobile(e.matches));
    game.onNotice = (n) => this.toast(n.text, n.kind);
    editor.onSelect = (what) => {
      this.tab = what === 'golfer' ? 'guests' : 'course';
      this.cache.delete('side');
    };
    editor.onChange = () => this.updateConfirm();
  }

  // ---------- static pieces ----------
  private $(id: string) {
    return document.getElementById(id)!;
  }

  private buildTools() {
    const mk = (id: ToolId, label?: string) => `<button class="tool" data-tool="${id}" title="${TOOL_INFO[id].label}: ${TOOL_INFO[id].hint}">${id === 'inspect' || id === 'pan' || id === 'bend' ? svg(id) : `<canvas class="terrain-thumb" data-thumbnail="${id}" width="112" height="74"></canvas>`}<span>${label ?? TOOL_INFO[id].label}</span></button>`;
    this.$('tools').innerHTML = `
      <div class="grp">${mk('inspect')}${mk('pan')}</div>
      <div class="grp"><div class="cap">Paint</div>${mk('fairway')}${mk('green')}${mk('rough')}${mk('path')}${mk('bunker')}${mk('water')}${mk('repair', 'Repair')}</div>
      <div class="grp"><div class="cap">Trees</div>${mk('treeAdd', 'Plant')}${mk('treeDel', 'Clear')}</div>
      <div class="grp"><div class="cap">Hole</div>${mk('tee', 'Move tee')}${mk('cup', 'Move cup')}${mk('bend', 'Dogleg')}${mk('build', 'New hole')}</div>
      <div class="grp"><div class="cap">Land</div>${mk('land', 'Land')}</div>
      <div class="grp"><div class="cap">Brush</div><div class="brushes">${BRUSH_RADII.map((_, i) => `<button data-brush="${i}" title="Brush size ${i + 1}"><i style="width:${5 + i * 4}px;height:${5 + i * 4}px"></i></button>`).join('')}</div></div>
      <div class="grp"><button class="tool" data-act="undo" id="undoBtn">${svg('undo')}<span>Undo</span></button></div>`;
    this.$('tools').querySelectorAll<HTMLCanvasElement>('canvas[data-thumbnail]').forEach(c => paintToolTile(c,c.dataset.thumbnail as ToolId));
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
    const speeds: [number, string][] = [[0, 'II'], [1, '1×'], [3, '3×'], [8, '8×']];
    this.$('top').innerHTML = `
      <button class="brand" id="brandBtn" aria-label="Club menu"><canvas width="68" height="68" id="topLogo"></canvas><span id="clubName"></span></button>
      <div class="sep"></div>
      <div class="stat"><span class="k">Cash</span><span class="v cash" id="cash"></span></div>
      <div class="stat"><span class="k" id="dayk"></span><span class="v small" id="clock"></span><div class="daybar"><i id="daybar"></i></div></div>
      <div class="stat hide-m" title="Fee for the tee-time band running now. Set all three in the Money tab."><span class="k" id="feek">Tee time</span><div class="fee"><button data-fee="-1" aria-label="Lower fee">−</button><span class="v" id="fee"></span><button data-fee="1" aria-label="Raise fee">+</button></div></div>
      <div class="stat hide-m" id="starbox" title="Course rating"><span class="k">Rating</span><span class="v small stars" id="starsTxt"></span></div>
      <div class="stat hide-m" id="satbox" title="Average satisfaction of recent guests"><span class="k">Guests</span><span class="v small" id="sat"></span><div class="meter"><i id="satbar"></i></div></div>
      <div class="stat hide-m" title="Operating profit so far today (fees and sales minus maintenance)"><span class="k">Today</span><span class="v small" id="todayp"></span></div>
      <div class="stat hide-m" id="evbox" style="display:none"><span class="k">Event</span><span class="v small" id="evtxt"></span></div>
      <div class="stat hide-m"><span class="k">On course</span><span class="v small" id="oncourse"></span></div>
      <div class="spacer"></div>
      <span class="saved hide-m" id="saved"></span>
      <div class="seg" id="speed">${speeds.map(([s, l]) => `<button data-speed="${s}">${l}</button>`).join('')}</div>
      <button class="btn menu" id="menuBtn" aria-label="Menu">Menu</button>`;
    const top = this.$('top');
    top.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.speed !== undefined) this.game.setSpeed(Number(b.dataset.speed));
      if (b.id === 'menuBtn' || b.id === 'brandBtn') this.openMenu();
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
    this.$('side').innerHTML = `<div class="tabs">${(['journey', 'course', 'guests', 'money', 'events', 'club'] as Tab[]).map((t) => `<button data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div><div class="sheet-heading"><span id="sheetTitle">Your course</span><button id="sheetClose" aria-label="Close panel">×</button></div><div class="body" id="sidebody"></div>`;
    this.$('sheetClose').onclick = () => { this.tab = 'none'; this.refresh(true); this.onInsets(); };
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
        if (el.dataset.act === 'journal') this.journalView = el.dataset.id as JournalView;
        else if (el.dataset.act === 'suggest') {
          if (el.dataset.id === 'course') this.tab = 'course'; else this.journalView = el.dataset.id as JournalView;
        }
        else if (el.dataset.act === 'project') this.projectModal(el.dataset.id!);
        else if (el.dataset.act === 'archive') this.archiveModal(el.dataset.id!);
        else if (el.dataset.act === 'reserve') useOperatingReserve(this.game);
        else if (el.dataset.act === 'claim') this.game.claimObjective(el.dataset.id!);
        else if (el.dataset.act === 'travel') this.travelModal();
        else if (el.dataset.act === 'hire') this.game.hire(el.dataset.id as StaffId);
        else if (el.dataset.act === 'dismiss') this.game.dismiss(el.dataset.id as StaffId);
        else if (el.dataset.act === 'repairgreen') this.repairGreenModal();
        else if (el.dataset.act === 'heat') this.game.heatmap = !this.game.heatmap;
        else if (el.dataset.act === 'routing') { this.editor.setTool('bend'); if (this.mobile) this.tab = 'none'; }
        else if (el.dataset.act === 'focus') { this.editor.focusHole(); if (this.mobile) this.tab = 'none'; }
        else if (el.dataset.act === 'practice' || el.dataset.act === 'playround') {
          this.game.designMode = false; this.editor.setTool('inspect'); this.game.owner.start(this.game, el.dataset.act === 'playround');
          this.game.setSpeed(0); this.editor.focusHole(); if (this.mobile) this.tab = 'none';
        }
        else if (el.dataset.act === 'watch') { this.game.selectedGolfer = id; this.game.followGolfer = id; if (this.mobile) this.tab = 'none'; }
        else if (el.dataset.act === 'open') this.game.openHole(id);
        else if (el.dataset.act === 'close') this.game.closeHole(id);
        else if (el.dataset.act === 'buy') this.game.buyUpgrade(el.dataset.id as UpgradeId);
        else if (el.dataset.act === 'book') this.game.bookEvent(el.dataset.id as EventId);
        else if (el.dataset.act === 'cancelev') this.game.cancelEvent(id);
        else if (el.dataset.act === 'evfee') this.game.setEventFee(el.dataset.ev as EventId, this.game.eventFees[el.dataset.ev as EventId] + Number(el.dataset.id));
        else if (el.dataset.act === 'cartfee') this.game.setCartFee(this.game.cartFee + Number(el.dataset.id));
        else if (el.dataset.act === 'tool') this.editor.setTool(el.dataset.id as ToolId);
        else if (el.dataset.act === 'clear-golfer') this.game.selectedGolfer = 0;
        else if (el.dataset.act === 'bandfee') this.game.setBandFee(el.dataset.band as never, this.game.fees[el.dataset.band as 'early'] + Number(el.dataset.id));
        else if (el.dataset.act === 'club') this.game.upgradeClubhouse();
        else if (el.dataset.act === 'parcel') {
          const p = this.editor.parcel;
          if (p) this.game.buyParcel(p.col, p.row);
        } else if (el.dataset.act === 'landtool') this.editor.setTool('land');
        else if (el.dataset.act === 'buildtool') {
          this.editor.setTool('build');
          if (this.mobile) this.tab = 'build';
        } else if (el.dataset.act === 'rename') this.renameModal(this.game.selectedHole);
        else if (el.dataset.act === 'removehole') this.removeModal(this.game.selectedHole);
        else if (el.dataset.act === 'editlogo') this.logoModal();
        else if (el.dataset.act === 'renameclub') this.nameModal();
      }
      this.refresh(true);
      this.onInsets();
      if (el.dataset.act === 'focus') this.editor.focusHole();
    });
    this.$('goalbar').addEventListener('click', () => {
      this.tab = 'journey';
      this.refresh(true);
    });
  }

  private buildNav() {
    const tabs = ['journey', 'build', 'course', 'guests', 'money', 'events', 'club'];
    this.$('nav').innerHTML = tabs.map((t) => `<button data-nav="${t}" aria-label="${TAB_LABEL[t]}" title="${TAB_LABEL[t]}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${TAB_ICON[t]}</svg><span>${TAB_LABEL[t]}</span></button>`).join('');
    this.$('nav').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const t = b.dataset.nav as Tab;
      this.tab = this.tab === t ? 'none' : t;
      if (t === 'build' && this.tab === 'build' && this.editor.tool === 'inspect') this.editor.setTool('fairway');
      this.cache.delete('side');
      this.refresh(true);
      this.onInsets();
    });
  }

  setMobile(m: boolean) {
    this.mobile = m;
    document.body.classList.toggle('mobile', m);
    if (m && this.tab === 'course') this.tab = 'none';
    if (!m && this.tab === 'build') this.tab = 'none';
    this.cache.delete('side');
    this.onInsets();
  }

  get landscape() { return this.mobile && window.innerWidth > window.innerHeight && window.innerHeight <= 600; }

  /** Space taken by panels, so the map can centre itself in what is left. */
  insets() {
    const r = (id: string) => (document.getElementById(id) as HTMLElement).getBoundingClientRect();
    if (this.mobile) {
      const nav = r('nav');
      if (this.landscape) {
        const side = this.tab !== 'none' && this.tab !== 'build' ? r('side') : null;
        return { l: nav.right + 10, r: side ? window.innerWidth - side.left + 10 : 12,
          t: r('top').bottom + 10, b: this.tab === 'build' ? window.innerHeight - r('tools').top + 10 : 12 };
      }
      const sheet = this.tab !== 'none' && this.tab !== 'build' ? r('side').height : this.tab === 'build' ? r('tools').height : 0;
      return { l: 0, r: 0, t: r('top').bottom + 8, b: nav.height + sheet };
    }
    return { l: 12, r: this.tab !== 'none' && this.tab !== 'build' ? r('side').width + 24 : 12, t: r('top').bottom + 12, b: r('tools').height + 24 };
  }

  private updateConfirm() {
    const el = this.$('confirm');
    const p = this.editor.pending;
    const html = p ? `<span><b>${p.label}</b><br><span class="dim">${p.tiles.length} tiles · ${fmtMoney(p.cost)}${p.cost > this.game.cash ? ' (not enough cash)' : ''}</span></span><button class="btn primary" id="cfOk" ${p.cost > this.game.cash ? 'disabled' : ''}>Build</button><button class="btn" id="cfNo">Cancel</button>` : '';
    if (this.cache.get('confirm') === html) return;
    this.cache.set('confirm', html);
    el.innerHTML = html;
    el.style.display = p ? 'flex' : 'none';
    if (p) {
      (this.$('cfOk') as HTMLElement).onclick = () => this.editor.confirmBuild();
      (this.$('cfNo') as HTMLElement).onclick = () => this.editor.cancelBuild();
    }
  }

  // ---------- menu and modals ----------
  private modal(html: string): HTMLElement {
    const m = this.$('modal');
    m.hidden = false;
    m.innerHTML = `<div class="box" role="dialog">${html}</div>`;
    return m;
  }
  closeModal() {
    this.$('modal').hidden = true;
  }
  openMenu() {
    const g = this.game;
    const m = this.modal(`<h2>${escapeHtml(g.name)}</h2><div class="menu-list">
      <button class="btn" id="mdName">Rename club</button>
      <button class="btn" id="mdLogo">Edit logo</button>
      <button class="btn" id="mdSettings">Sound, feedback & daily reports</button><button class="btn" id="mdSave">Save now</button><button class="btn" id="mdExport">Export save backup</button><button class="btn" id="mdImport">Import save backup</button>
      <button class="btn danger" id="mdReset">Reset game</button>
      <button class="btn" id="mdClose">Close</button></div>
      <p class="dim" style="margin-top:10px">Your game saves automatically on this device. ${REGIONS[g.region].name}, ${g.season.name}, year ${g.stats.years}.</p>`);
    (m.querySelector('#mdSettings') as HTMLElement).onclick = () => this.settingsModal();
    (m.querySelector('#mdExport') as HTMLElement).onclick = () => this.onExport();
    (m.querySelector('#mdImport') as HTMLElement).onclick = () => this.onImport();
    (m.querySelector('#mdName') as HTMLElement).onclick = () => this.nameModal();
    (m.querySelector('#mdLogo') as HTMLElement).onclick = () => this.logoModal();
    (m.querySelector('#mdSave') as HTMLElement).onclick = () => {
      this.onSaveNow();
      this.closeModal();
      this.toast('Saved.', 'good');
    };
    (m.querySelector('#mdReset') as HTMLElement).onclick = () => this.confirmReset();
    (m.querySelector('#mdClose') as HTMLElement).onclick = () => this.closeModal();
  }
  nameModal() {
    const m = this.modal(`<h2>Rename your club</h2><input id="nmIn" maxlength="28" value="${this.game.name.replace(/"/g, '&quot;')}" /><div class="actions"><button class="btn" id="nmNo">Cancel</button><button class="btn primary" id="nmOk">Save</button></div>`);
    (m.querySelector('#nmNo') as HTMLElement).onclick = () => this.closeModal();
    (m.querySelector('#nmOk') as HTMLElement).onclick = () => {
      this.game.setName((m.querySelector('#nmIn') as HTMLInputElement).value);
      this.closeModal();
      this.refresh(true);
    };
  }
  logoModal() {
    const m = this.modal(`<h2>Club logo</h2><div id="lgBox" class="logo-box"></div><div class="actions"><button class="btn primary" id="lgOk">Done</button></div>`);
    logoDesigner(m.querySelector('#lgBox') as HTMLElement, this.game.logo, () => this.game.name, () => {
      this.game.dirtySave = true;
      this.cache.delete('logo');
    });
    (m.querySelector('#lgOk') as HTMLElement).onclick = () => {
      this.closeModal();
      this.refresh(true);
    };
  }
  renameModal(id: number) {
    const h = this.game.hole(id);
    const m = this.modal(`<h2>Rename hole ${id}</h2><input id="rnIn" maxlength="24" value="${h.name.replace(/"/g, '&quot;')}" /><div class="actions"><button class="btn" id="rnNo">Cancel</button><button class="btn primary" id="rnOk">Save</button></div>`);
    (m.querySelector('#rnNo') as HTMLElement).onclick = () => this.closeModal();
    (m.querySelector('#rnOk') as HTMLElement).onclick = () => {
      this.game.renameHole(id, (m.querySelector('#rnIn') as HTMLInputElement).value);
      this.closeModal();
      this.refresh(true);
    };
  }
  removeModal(id: number) {
    const h = this.game.hole(id);
    const m = this.modal(`<h2>Remove hole ${id}?</h2><p>${escapeHtml(h.name)} will be taken off the scorecard. Its fairway and green stay as they are. This cannot be undone.</p><div class="actions"><button class="btn" id="rmNo">Keep it</button><button class="btn danger" id="rmOk">Remove hole</button></div>`);
    (m.querySelector('#rmNo') as HTMLElement).onclick = () => this.closeModal();
    (m.querySelector('#rmOk') as HTMLElement).onclick = () => {
      this.game.removeHole(id);
      this.closeModal();
      this.refresh(true);
    };
  }

  private projectModal(id: string) {
    const offer = projectOffers(this.game).find(p => p.id === id); if (!offer || offer.locked) return;
    const m = this.modal(`<div class="eyebrow">RESTORATION PROJECT</div><h2>${offer.title}</h2><p class="dim">${offer.description}</p><div class="project-quote"><span>Construction quote</span><strong>${fmtMoney(offer.cost)}</strong></div><p class="dim">${offer.plan ? `${offer.plan.tiles.length} tiles in this plan. ` : ''}${offer.xp ? '+' + offer.xp + ' career XP for the first completion at this property.' : 'Career XP for this type of restoration has already been collected.'}</p><div class="actions"><button class="btn" id="projectNo">Keep planning</button><button class="btn primary" id="projectYes" ${this.game.cash < offer.cost ? 'disabled' : ''}>Build · ${fmtMoney(offer.cost)}</button></div>`);
    (m.querySelector('#projectNo') as HTMLElement).onclick = () => this.closeModal();
    (m.querySelector('#projectYes') as HTMLElement).onclick = () => {
      if (!commissionProject(this.game, id)) this.toast('This project is not available at the current budget.', 'bad');
      this.closeModal(); this.refresh(true);
    };
  }
  private archiveModal(id: string) {
    const a = this.game.experience.archives.find(a => a.id === id); if (!a) return;
    const m = this.modal(`<span class="eyebrow">YOUR RESTORATION COLLECTION</span><h2>${escapeHtml(a.name)}</h2><canvas id="archiveMap" width="720" height="480" aria-label="Preserved course plan"></canvas><div class="archive-summary"><div><b>${a.holes}</b><small>Open holes</small></div><div><b>${a.design}</b><small>Design rating</small></div><div><b>${a.members}</b><small>Members</small></div></div><p class="dim">Preserved on day ${a.day} · ${a.rounds} rounds · ${fmtMoney(a.profit)} operating profit.</p><p class="dim">This is a record of your completed course. Your active property stays unchanged.</p><div class="actions"><button class="btn primary" id="archiveClose">Back to portfolio</button></div>`);
    paintArchive(m.querySelector('#archiveMap') as HTMLCanvasElement, a);
    (m.querySelector('#archiveClose') as HTMLElement).onclick = () => this.closeModal();
  }
  private settingsModal() {
    const prefs = this.game.preferences;
    const m = this.modal(`<span class="eyebrow">PLAY YOUR WAY</span><h2>Game settings</h2><div class="preference-list">${([['sound','Sound effects','Subtle swing, build, and reward cues.'],['haptics','Touch feedback','Brief vibration where supported by your device.'],['dailyReports','End-of-day reports','Pause at closing time to review the day.']] as const).map(([id,title,detail]) => `<label><span><b>${title}</b><small>${detail}</small></span><input type="checkbox" data-pref="${id}" ${prefs[id] ? 'checked' : ''}/></label>`).join('')}</div><p class="dim">Career: ${CAREER[careerLevel(this.game)].title} · ${this.game.experience.xp} XP</p><div class="actions"><button class="btn primary" id="settingsDone">Done</button></div>`);
    m.querySelectorAll<HTMLInputElement>('[data-pref]').forEach(input => { input.onchange = () => { this.game.preferences[input.dataset.pref as keyof typeof prefs] = input.checked; this.game.dirtySave = true; }; });
    (m.querySelector('#settingsDone') as HTMLElement).onclick = () => this.closeModal();
  }
  private showRecap() {
    const g = this.game, d = g.pendingRecap; if (!d) return;
    const history = g.days.slice(-7), max = Math.max(1, ...history.map(d => Math.abs(d.profit)));
    const suggestion = nextSuggestion(g);
    const m = this.modal(`<div class="day-report"><span class="eyebrow">THE CLUBHOUSE LEDGER · DAY ${d.day}</span><h2>A day on your course.</h2><div class="report-profit ${d.profit < 0 ? 'loss' : ''}"><span>${d.profit >= 0 ? '+' : ''}${fmtMoney(d.profit)}</span><small>OPERATING PROFIT</small></div><div class="report-kpis"><div><b>${d.rounds}</b><small>ROUNDS PLAYED</small></div><div><b>${d.rounds ? Math.round(d.avgSat) + '%' : '—'}</b><small>GUEST HAPPINESS</small></div><div><b>${g.members.length}</b><small>CLUB MEMBERS</small></div></div><div class="ledger-rows"><div><span>Green fees & clubhouse sales</span><b>${fmtMoney(d.fees + d.shop)}</b></div><div><span>Maintenance & staff wages</span><b>−${fmtMoney(d.maintenance)}</b></div><div><span>Construction, tracked separately</span><b>${fmtMoney(d.construction)}</b></div></div><div class="report-chart" aria-label="Recent daily operating profit">${history.map(x => `<div title="Day ${x.day}: ${fmtMoney(x.profit)}"><i class="${x.profit < 0 ? 'negative' : ''}" style="height:${Math.max(5, Math.abs(x.profit) / max * 60)}px"></i><small>${x.day}</small></div>`).join('')}</div><div class="report-next"><span class="eyebrow">NEXT ON YOUR COURSE</span><b>${suggestion.title}</b><small>${suggestion.description}</small></div><div class="report-actions"><button class="btn" id="recapPlan">Plan improvements</button><button class="btn primary" id="recapContinue">Start day ${g.day} →</button></div></div>`);
    const finish = () => { g.pendingRecap = null; g.dirtySave = true; this.closeModal(); };
    (m.querySelector('#recapContinue') as HTMLElement).onclick = () => { finish(); this.refresh(true); };
    (m.querySelector('#recapPlan') as HTMLElement).onclick = () => {
      finish(); this.tab = 'journey'; this.journalView = 'projects';
      if (!g.designMode) g.toggleDesignMode(); this.refresh(true); this.onInsets();
    };
  }

  private greenPlan() {
    const g = this.game, h = g.hole(g.selectedHole), w = g.world;
    const tiles: number[] = [];
    for (let i = 0; i < w.terrain.length; i++) if (w.terrain[i] === 2 && Math.hypot(i % w.w - h.cup.x, Math.floor(i / w.w) - h.cup.y) <= 4.5) tiles.push(i);
    return planPaint(w, 'repair', tiles);
  }
  private repairGreenModal() {
    const plan = this.greenPlan();
    if (!plan.tiles.length) return;
    const m = this.modal(`<h2>Repair this green?</h2><p>Reseed ${plan.tiles.length} worn tiles for ${fmtMoney(plan.cost)}. The hole closes for construction. Reopen it from Course when ready.</p><div class="actions"><button class="btn" id="repairNo">Cancel</button><button class="btn primary" id="repairYes">Repair · ${fmtMoney(plan.cost)}</button></div>`);
    (m.querySelector('#repairNo') as HTMLElement).onclick = () => this.closeModal();
    (m.querySelector('#repairYes') as HTMLElement).onclick = () => { this.game.commitEdit(plan); this.closeModal(); this.refresh(true); };
  }

  private travelModal() {
    if (!stageComplete(this.game)) return;
    const m = this.modal(`<h2>Start the next restoration?</h2><p>Your portfolio and medals carry forward. The next course starts with a fresh budget. The completed course plan and results will be preserved in your portfolio. The next property starts with its own budget, staff, and local members.</p><div class="actions"><button class="btn" id="travelCancel">Keep playing here</button><button class="btn primary" id="travelOk">Start next course</button></div>`);
    (m.querySelector('#travelCancel') as HTMLElement).onclick = () => this.closeModal();
    (m.querySelector('#travelOk') as HTMLElement).onclick = () => {
      this.editor.setTool('inspect'); this.editor.cancelBuild();
      this.game.travel(); this.closeModal(); this.tab = 'journey'; this.editor.focusHole(); this.refresh(true);
    };
  }

  private buildIntro() {
    if (this.game.settings.introSeen) return;
    this.$('intro').innerHTML = `<div class="card"><h2>Your first restoration</h2>
      <div>Start with the Journey tab. Each restoration has four objectives with cash rewards. Complete them to unlock the next location.</div>
      <ol><li>Watch the golfers. Their comments and the Guests tab show what is going wrong.</li>
      <li>Hole 2 has a worn green: pick <b>Repair</b>, drag over the green, then reopen the hole.</li>
      <li>Restore hole 3 by connecting its fairway, then open it. Use Design mode to pause while building.</li><li>Play your own holes from the Course tab. Hire specialists from Club.</li></ol>
      <button class="btn primary" id="introOk">Got it</button></div>`;
    this.$('introOk').addEventListener('click', () => {
      this.game.settings.introSeen = true;
      this.$('intro').innerHTML = '';
    });
  }

  confirmReset() {
    const m = this.modal(`<h2>Reset the game?</h2><p>This deletes your saved course, cash, upgrades and goals and starts a brand new game. It cannot be undone.</p><div class="actions"><button class="btn" id="rsCancel">Keep playing</button><button class="btn danger" id="rsOk">Reset and start over</button></div>`);
    (m.querySelector('#rsCancel') as HTMLElement).onclick = () => this.closeModal();
    (m.querySelector('#rsOk') as HTMLElement).onclick = () => {
      this.closeModal();
      this.onReset();
    };
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    const box = this.$('toasts');
    box.appendChild(t);
    while (box.children.length > 1) box.firstChild!.remove();
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
    if (g.pendingRecap && this.$('modal').hidden) this.showRecap();
    const set = (id: string, v: string) => {
      if (this.cache.get(id) !== v) {
        this.cache.set(id, v);
        this.$(id).textContent = v;
      }
    };
    set('cash', fmtMoney(g.cash));
    set('clock', g.clockText);
    (this.$('daybar') as HTMLElement).style.width = `${(g.clock / CFG.day.seconds) * 100}%`;
    set('fee', fmtMoney(g.fee));
    set('feek', `${g.band.name}`);
    set('starsTxt', stars(g.stars));
    set('clubName', g.name);
    set('dayk', this.mobile ? `Day ${g.day}` : `Day ${g.day}, ${g.season.name}`);
    if (this.cache.get('logo') !== g.logo.primary + g.logo.secondary + g.logo.icon + g.logo.shape + g.logo.initials) {
      this.cache.set('logo', g.logo.primary + g.logo.secondary + g.logo.icon + g.logo.shape + g.logo.initials);
      paintLogo(this.$('topLogo') as HTMLCanvasElement, g.logo);
    }
    const nb = g.bookings[0];
    const evText = g.activeEvent ? `${EVENTS[g.activeEvent.id].name}, today` : nb ? `${EVENTS[nb.id].name}, day ${nb.day}` : '';
    (this.$('evbox') as HTMLElement).style.display = evText ? '' : 'none';
    set('evtxt', evText);
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
    this.$('nav').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.nav === this.tab));
    document.body.dataset.tab = this.tab;
    document.body.dataset.journalView = this.journalView;
    this.$('sheetTitle').textContent = this.tab === 'journey' ? 'Your restoration' : this.tab[0].toUpperCase() + this.tab.slice(1);
    const sideOpen = this.tab !== 'none' && this.tab !== 'build';
    this.$('side').style.display = sideOpen ? '' : 'none';
    this.$('tools').style.display = !this.mobile || this.tab === 'build' ? '' : 'none';
    this.updateConfirm();
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
      const cl = document.getElementById('clubLogo') as HTMLCanvasElement | null;
      if (cl) paintLogo(cl, g.logo);
      drawJournalArchives(body, g);
    }
  }

  private renderPill() {
    const pill = this.$('pill');
    const p = this.editor.preview;
    let html: string;
    let cls = '';
    const tool = this.editor.tool;
    if (this.mobile && !(p && (p.tiles > 0 || p.message))) {
      if (this.cache.get('pill') !== 'hidden') {
        this.cache.set('pill', 'hidden');
        pill.innerHTML = '';
        pill.style.display = 'none';
      }
      return;
    }
    pill.style.display = '';
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

  private allGoals() {
    return [...CFG.goals, ...MILESTONES].map((d) => ({ id: d.id, title: d.title, detail: d.detail, reward: d.reward }));
  }
  private renderGoalBar() {
    const g = this.game;
    const loc = activeLocation(g);
    const next = loc.objectives.find(o => !g.campaign.claimed.includes(o.id));
    const html = next ? `<div class="k">${loc.name} · +${fmtMoney(next.reward)}</div><div>${next.title}</div><div class="p">${Math.max(0, Math.round(next.value(g)))} / ${next.target} · Tap to view journey</div>` : `<div class="k">Restoration complete</div><div>${loc.name}</div><div class="p">Your next course is ready.</div>`;
    if (this.cache.get('goalbar') !== html) {
      this.cache.set('goalbar', html);
      this.$('goalbar').innerHTML = html;
    }
  }

  private goalProgress(id: string): string {
    const g = this.game;
    const h2 = g.world.holes.find((h) => h.id === 2);
    const h3 = g.world.holes.find((h) => h.id === 3);
    if (id === 'green') return h2 ? `Hole 2 green condition ${Math.round(holeCondition(g.world, h2).green)} of 75 needed${h2.open ? '' : ' (closed for work)'}` : 'Hole 2 was removed';
    if (id === 'reopen') {
      if (!h3) return 'Hole 3 was removed';
      if (h3.open) return 'Open';
      const v = g.validate(3);
      return v.ok ? 'Ready: press Open hole' : v.problems[0];
    }
    if (id === 'day') {
      const t = g.today;
      const avg = t.rounds ? t.satSum / t.rounds : 0;
      return `Today: profit ${fmtMoney(operatingProfit(t))}, ${t.rounds}/${CFG.satisfaction.goalMinRounds} rounds, satisfaction ${t.rounds ? Math.round(avg) : '-'}/${CFG.satisfaction.goal}`;
    }
    const m = MILESTONES.find((x) => x.id === id);
    if (!m) return '';
    const [cur, target] = m.progress(g.goalCtx());
    const fmt = (n: number) => (n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(Math.round(n * 10) / 10));
    return `${fmt(Math.min(cur, target))} of ${fmt(target)}`;
  }

  private sideHtml(): string {
    switch (this.tab) {
      case 'journey': return journalPanel(this.game, this.journalView);
      case 'course': return this.courseHtml();
      case 'guests': return this.guestsHtml();
      case 'money': return this.moneyHtml();
      case 'events': return this.eventsHtml();
      case 'club': return this.clubHtml();
      default: return '';
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
      build: `${fmtMoney(C.newHole)} design fee plus the fairway, green and tree clearing`,
      land: `Next parcel ${fmtMoney(g.parcelPrice)}`,
    };
    const h = g.hole(g.selectedHole);
    const cond = holeCondition(w, h);
    const v = g.validate(h.id);
    const lenYd = Math.round(holeStraightTiles(h) * CFG.grid.yardsPerTile);
    const queued = g.sim.queueFor(h.id).length;
    const playing = g.sim.onHole(h.id);
    const st = h.stats;
    const repair = this.greenPlan();
    let html = `<div class="sec"><h3>Tool</h3><div class="card"><div class="t">${info.label}</div><div class="dim">${info.hint}</div>${costLine[tool] ? `<div style="margin-top:4px">${costLine[tool]}</div>` : ''}${tool === 'tee' || tool === 'cup' ? `<div style="margin-top:4px" class="note warn">Editing hole ${h.id}. Tap a tile on the map to place it.</div>` : ''}${tool === 'land' ? this.landCard() : ''}</div></div>`;
    html += `<div class="sec"><h3>Holes</h3><div class="chips">${w.holes.map((x) => `<button class="chip ${x.id === h.id ? 'on' : ''}" data-hole="${x.id}"><span class="st ${x.open ? 'open' : ''}"></span>${x.id} ${escapeHtml(x.name)}</button>`).join('')}</div>`;
    html += `<div class="card"><div class="row"><span class="t">Hole ${h.id}, ${escapeHtml(h.name)}</span><span class="badge ${h.open ? 'open' : 'closed'}">${h.open ? 'OPEN' : 'CLOSED'}</span></div>
      <div class="row"><span class="k">Par ${h.par}</span><span>${lenYd} yards</span></div>
      <div class="barrow"><span>Fairway</span>${bar(cond.fairway)}<span class="n">${Math.round(cond.fairway)}</span></div>
      <div class="barrow"><span>Green</span>${bar(cond.green)}<span class="n">${Math.round(cond.green)}</span></div>
      <div class="barrow"><span>Tee box</span>${bar(cond.tee)}<span class="n">${Math.round(cond.tee)}</span></div>
      <div class="dim" style="margin-top:2px">${Math.round(cond.wornShare * 100)}% of its turf is worn</div>${repair.tiles.length ? `<button class="btn primary" style="margin-top:10px" data-act="repairgreen" ${repair.cost > g.cash ? 'disabled' : ''}>Repair green · ${fmtMoney(repair.cost)}</button>` : ''}`;
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
    html += `<div class="card"><div class="t">Results on this hole</div>${st.rounds ? `<div class="row"><span class="k">Rounds</span><span>${st.rounds}</span></div><div class="row"><span class="k">Average score</span><span>${(st.strokes / st.rounds).toFixed(1)} (par ${h.par})</span></div>${st.girN ? `<div class="row"><span class="k">Greens in regulation</span><span>${Math.round((st.gir / st.girN) * 100)}%</span></div>` : ''}${st.fwyN ? `<div class="row"><span class="k">Fairways hit</span><span>${Math.round((st.fwy / st.fwyN) * 100)}%</span></div>` : ''}<div class="row"><span class="k">Water balls</span><span>${st.water}</span></div><div class="row"><span class="k">Picked up</span><span>${st.picked}</span></div>` : '<div class="dim">No golfer has finished this hole yet.</div>'}</div>
      <div class="btnrow"><button class="btn" data-act="rename">Rename</button><button class="btn" data-act="removehole" ${w.holes.length <= 1 ? 'disabled' : ''}>Remove</button></div></div>
      <div class="sec"><h3>Expand</h3><div class="card"><div class="row"><span class="t">Holes</span><span>${w.holes.length} of ${g.maxHoles} allowed</span></div><div class="dim">${g.addHoleProblem() ?? 'Tap a tee spot and a green spot on land you own. A fairway is laid between them.'}</div><div style="margin-top:6px"><button class="btn primary" data-act="buildtool" ${g.addHoleProblem() ? 'disabled' : ''}>Build a new hole</button></div></div></div>`;
    const it = this.editor.inspectTile;
    if (it) {
      const i = idx(w, it.x, it.y);
      const t = w.terrain[i];
      html += `<div class="sec"><h3>Tile (${it.x}, ${it.y})</h3><div class="row"><span class="k">Ground</span><span>${terrainLabel(t)}${w.tree[i] ? ' with tree' : ''}</span></div>${t <= 3 ? `<div class="row"><span class="k">Condition</span><span>${Math.round(w.cond[i])}</span></div>${bar(w.cond[i])}<div class="dim" style="margin-top:4px">${t === 0 ? (w.cond[i] < 45 ? 'Overgrown: bad lies and slow shots.' : 'Maintained rough.') : w.cond[i] < CFG.turf.wornBelow ? 'Worn: shorter, wilder shots from here.' : 'Healthy turf.'}</div>` : ''}<div class="row"><span class="k">Belongs to</span><span>${w.zone[i] ? `Hole ${w.zone[i]}` : 'No hole'}</span></div></div>`;
    }
    return `<div class="course-heading"><span class="eyebrow">COURSE ARCHITECT</span><h2>Shape the next great hole.</h2><div class="btnrow"><button class="btn" data-act="focus">Find hole</button><button class="btn primary" data-act="practice">Play this hole</button><button class="btn" data-act="playround">Play course</button></div></div>` + designPanel(g, h) + html + (g.ownerRecords.length ? `<div class="sec"><h3>Your practice scorecards</h3>${g.ownerRecords.slice(-4).reverse().map(r => `<div class="card"><div class="row"><b>Day ${r.day}</b><span>${r.scores.reduce((s,x) => s + x.strokes, 0)} strokes · par ${r.scores.reduce((s,x) => s + x.par, 0)}</span></div><div class="owner-scorecard">${r.scores.map(x => `<span>${x.hole}<b>${x.strokes}</b><small>par ${x.par}</small></span>`).join('')}</div></div>`).join('')}</div>` : '');
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
    const selected = g.sim.golfers.find(x => x.id === g.selectedGolfer);
    if (selected?.scorecard.length) html += `<div class="card"><div class="t">${escapeHtml(selected.name)} · scorecard</div>${selected.scorecard.map(x => `<div class="row"><span>Hole ${x.hole} · par ${x.par}</span><b>${x.strokes}</b></div>`).join('')}</div>`;
    html += membersPanel(g);
    html += `<div class="sec"><h3>Watch a golfer</h3><div class="golfer-list">${g.sim.golfers.slice(0, 12).map(x => `<button class="golfer-row" data-act="watch" data-id="${x.id}"><span class="avatar" style="background:${CFG.golfers.types[x.type].shirt}">${escapeHtml(x.name[0])}</span><span><b>${escapeHtml(x.name)}</b><small>${x.type} · ${x.holeId ? 'Hole ' + x.holeId : 'At the clubhouse'}</small></span><span>Follow →</span></button>`).join('') || '<p class="dim">The next guests will arrive shortly.</p>'}</div></div>`;
    html += `<div class="sec"><h3>Recent comments</h3><div class="feed">${g.comments.length ? g.comments.slice(-9).reverse().map((c) => `<div><b>${c.name}</b> <span class="dim">${CFG.golfers.types[c.type].label}${c.hole ? `, hole ${c.hole}` : ''}</span><br>${c.text}</div>`).join('') : '<div class="dim">Quiet so far. Golfers react to what happens to them.</div>'}</div></div>`;
    return html;
  }

  private moneyHtml(): string {
    const g = this.game;
    const t = g.today;
    const toNext = g.hourLen - (g.clock % g.hourLen);
    const row = (k: string, v: number, sign = 1) => `<div class="row"><span class="k">${k}</span>${money(sign * v)}</div>`;
    let html = `<div class="sec"><h3>Tee time pricing</h3>${BANDS.map((b) => {
      const fee = g.fees[b.id];
      const fair = g.fair * b.fair;
      const n = g.bandArrivals(b.id);
      const tone = fee > fair + 6 ? 'bad' : fee > fair + 2 ? 'warn' : fee < fair - 8 ? 'warn' : 'good';
      return `<div class="card ${g.band.id === b.id ? 'now' : ''}"><div class="row"><span class="t">${b.name}</span><span class="dim">${b.hours}${g.band.id === b.id ? ' · now' : ''}</span></div>
        <div class="row" style="align-items:center"><span class="k">Fee</span><span><button class="btn sm" data-act="bandfee" data-band="${b.id}" data-id="-5">−5</button> <button class="btn sm" data-act="bandfee" data-band="${b.id}" data-id="-1">−</button> <b>${fmtMoney(fee)}</b> <button class="btn sm" data-act="bandfee" data-band="${b.id}" data-id="1">+</button> <button class="btn sm" data-act="bandfee" data-band="${b.id}" data-id="5">+5</button></span></div>
        <div class="note ${tone}">Guests think about ${fmtMoney(fair)} is fair. About ${n.toFixed(1)} golfers a day book this band.</div></div>`;
    }).join('')}<div class="dim">Expected ${Math.round(g.arrivalRate)} golfers a day. ${g.season.name} demand is ${g.season.demand >= 1.1 ? 'strong' : g.season.demand <= 0.7 ? 'weak' : 'normal'} in ${REGIONS[g.region].name}.</div></div>
      <div class="sec"><h3>Today, day ${g.day}</h3>${row('Green fees and cart rentals', t.fees)}${row('Clubhouse sales', t.shop)}${row('Maintenance', t.maintenance, -1)}<div class="row total"><span>Operating profit</span>${money(operatingProfit(t))}</div>${row('Construction and upgrades', t.construction, -1)}${t.bonus ? row('Goal bonuses', t.bonus) : ''}<div class="row total"><span>Net change in cash</span>${money(netChange(t))}</div>
      <div class="dim" style="margin-top:6px">Maintenance of ${fmtMoney(g.maintenanceRate)} is charged every game hour. Next charge in ${Math.ceil(toNext / 1)}s. ${t.arrivals} arrivals so far, expecting about ${Math.round(g.arrivalRate)} per day at these prices.</div></div>`;
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

  private eventsHtml(): string {
    const g = this.game;
    let html = '';
    const a = g.activeEvent;
    if (a) html += `<div class="sec"><h3>Happening today</h3><div class="card"><div class="t">${EVENTS[a.id].name}</div><div class="row"><span class="k">Golfers arrived</span><span>${a.spawned} of ${a.total}</span></div><div class="row"><span class="k">Entry fees</span><span>${fmtMoney(a.revenue)}</span></div><div class="row"><span class="k">Rounds finished</span><span>${a.rounds}</span></div></div></div>`;
    html += `<div class="sec"><h3>Booked</h3>`;
    html += g.bookings.length ? g.bookings.map((b) => `<div class="card"><div class="row"><span class="t">${EVENTS[b.id].name}</span><span>Day ${b.day}</span></div><div class="dim">Entry ${fmtMoney(b.fee)}, setup ${fmtMoney(EVENTS[b.id].cost)} charged at the start.</div><div style="margin-top:6px"><button class="btn" data-act="cancelev" data-id="${b.day}">Cancel, free</button></div></div>`).join('') : '<div class="dim">Nothing booked. Events bring a burst of paying golfers at a 7 AM shotgun start.</div>';
    html += `</div><div class="sec"><h3>Host an event</h3>`;
    for (const id of EVENT_IDS) {
      const d = EVENTS[id];
      const fee = g.eventFees[id];
      const n = g.expectedGuests(id);
      const probs = g.eventProblemsFor(id);
      const net = n * fee - d.cost;
      html += `<div class="card"><div class="row"><span class="t">${d.name}</span><span class="reward">${fmtMoney(d.cost)} setup</span></div><div class="dim">${d.blurb}</div>
        <div class="row" style="margin-top:6px;align-items:center"><span class="k">Entry fee (fair: ${fmtMoney(d.fair)})</span><span><button class="btn" data-act="evfee" data-ev="${id}" data-id="-5">−</button> <b>${fmtMoney(fee)}</b> <button class="btn" data-act="evfee" data-ev="${id}" data-id="5">+</button></span></div>
        <div class="row"><span class="k">Expected turnout</span><span>about ${n} golfers</span></div>
        <div class="row"><span class="k">Expected profit before upkeep</span>${money(net)}</div>
        ${probs.map((p) => `<div class="note bad">${p}</div>`).join('')}
        <div style="margin-top:6px"><button class="btn primary" data-act="book" data-id="${id}" ${probs.length ? 'disabled' : ''}>Book next free day</button></div></div>`;
    }
    html += '</div>';
    const l = g.lastEvent;
    if (l) html += `<div class="sec"><h3>Last event</h3><div class="card"><div class="t">${EVENTS[l.id].name}, day ${l.day}</div><div class="row"><span class="k">Golfers</span><span>${l.guests}</span></div><div class="row"><span class="k">Entries minus setup</span>${money(l.revenue - l.cost)}</div><div class="row"><span class="k">Satisfaction</span><span>${l.rounds ? Math.round(l.avgSat) : '-'}</span></div></div></div>`;
    return html;
  }

  private landCard(): string {
    const g = this.game;
    const p = this.editor.parcel;
    if (!p) return `<div style="margin-top:6px" class="dim">${g.parcelsOwned} of ${CFG.land.cols * CFG.land.rows} parcels owned. Tap a locked parcel on the map.</div>`;
    const owned = g.isParcelOwned(p.col, p.row);
    return `<div style="margin-top:6px"><b>Parcel ${p.col + 1}, ${p.row + 1}</b><div class="dim">${owned ? 'You own this land.' : `For sale at ${fmtMoney(g.parcelPrice)}. Each parcel you buy makes the next cost more.`}</div>${owned ? '' : `<div style="margin-top:6px"><button class="btn primary" data-act="parcel" ${g.cash < g.parcelPrice ? 'disabled' : ''}>Buy for ${fmtMoney(g.parcelPrice)}</button></div>`}</div>`;
  }

  private clubHtml(): string {
    const g = this.game;
    const club = g.club;
    const next = CLUB_LEVELS[g.clubLevel + 1];
    const why = g.clubUpgradeProblem();
    const r = REGIONS[g.region];
    const si = g.season.index;
    const nextSeason = (si + 1) % 4;
    let html = `<div class="sec"><div class="clubhead"><canvas id="clubLogo" width="96" height="96"></canvas><div><div class="t big">${escapeHtml(g.name)}</div><div class="dim">${r.name} · ${g.season.name}, year ${g.stats.years}</div><div class="stars lg">${stars(g.stars)} <span class="dim">${g.stars.toFixed(1)}</span></div></div></div>
      <div class="btnrow"><button class="btn" data-act="renameclub">Rename</button><button class="btn" data-act="editlogo">Edit logo</button></div></div>`;
    html += `<div class="sec"><h3>Clubhouse</h3><div class="card"><div class="row"><span class="t">${club.name}</span><span class="dim">Level ${g.clubLevel + 1} of ${CLUB_LEVELS.length}</span></div><div class="dim">${club.blurb}</div>
      <div class="row"><span class="k">Demand</span><span>+${Math.round((club.demand - 1) * 100)}%</span></div><div class="row"><span class="k">Clubhouse spending</span><span>+${Math.round((club.shop - 1) * 100)}%</span></div><div class="row"><span class="k">Fair price</span><span>+${fmtMoney(club.fair)}</span></div><div class="row"><span class="k">Max holes</span><span>${club.holes}</span></div>`;
    html += next ? `<div class="note ${why ? 'warn' : 'good'}">Next: ${next.name}. ${why ?? 'Requirements met.'}</div><button class="btn primary" data-act="club" ${why || g.cash < next.cost ? 'disabled' : ''}>Upgrade for ${fmtMoney(next.cost)}</button>` : '<div class="note good">Fully upgraded.</div>';
    html += `</div></div>`;
    html += `<div class="sec"><h3>What raises your rating</h3><div class="dim">Open holes (${g.openHoles.length}), turf condition (${Math.round(g.avgCondition)}), guest satisfaction (${Math.round(g.reputation)}), improvements owned and the clubhouse level. Higher ratings lift demand and fees, and unlock bigger clubhouse upgrades and events.</div></div>`;
    html += `<div class="sec"><h3>Land</h3><div class="card"><div class="row"><span class="t">${g.parcelsOwned} of ${CFG.land.cols * CFG.land.rows} parcels</span><span>Next ${fmtMoney(g.parcelPrice)}</span></div><div class="dim">Locked land is shaded on the map. Buy parcels to build more holes.</div><div style="margin-top:6px"><button class="btn" data-act="landtool">Show land for sale</button></div></div></div>`;
    html += `<div class="sec"><h3>${r.name}</h3><div class="dim">${r.perks.join(' · ')}</div><div class="note">${SEASON_NAMES2[nextSeason]} comes next: demand ${r.seasonDemand[nextSeason] >= 1.1 ? 'rises' : r.seasonDemand[nextSeason] <= 0.7 ? 'drops sharply' : 'is steady'}, turf wear ${r.seasonWear[nextSeason] > 1.1 ? 'is heavier' : 'is normal'}.</div></div>`;
    const goals = this.allGoals();
    const open = goals.filter((d) => !g.goalDone(d.id));
    const done = goals.length - open.length;
    html += `<div class="sec"><h3>Goals · ${done} of ${goals.length} done</h3>`;
    for (const d of open.slice(0, 4)) html += `<div class="goal"><div class="check"></div><div><div class="t">${d.title}</div><div class="dim">${d.detail}</div><div style="margin-top:3px">${this.goalProgress(d.id)} · <span class="reward">Bonus ${fmtMoney(d.reward)}</span></div></div></div>`;
    if (!open.length) html += '<div class="dim">Every goal is done. Legend.</div>';
    html += staffPanel(g);
    html += `</div><div class="sec"><h3>Career</h3><div class="row"><span class="k">Rounds played</span><span>${g.stats.rounds.toLocaleString('en-US')}</span></div><div class="row"><span class="k">Lifetime revenue</span><span>${fmtMoney(g.stats.revenue)}</span></div><div class="row"><span class="k">Best day</span><span>${fmtMoney(g.stats.bestDayProfit)}</span></div><div class="row"><span class="k">Events hosted</span><span>${g.stats.events}</span></div><div class="row"><span class="k">Holes in one</span><span>${g.stats.aces}</span></div></div>`;
    return html;
  }
}

const SEASON_NAMES2 = ['Spring', 'Summer', 'Autumn', 'Winter'];
