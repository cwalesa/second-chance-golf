import { paintToolTile } from './classic-art';
import { journalPanel, JournalView } from './journal';
import { projectOffers, commissionProject, nextSuggestion, CAREER, careerLevel, useOperatingReserve } from './experience';
import { designPanel, staffPanel, membersPanel, escapeHtml } from './panels';
import { assessDesign } from './design';
const assessDesignScore = (g: Game, h: Hole) => assessDesign(g.world, h).overall;
import { CHAIN, currentGoal, goalProgressText } from './campaign';
import { panelControl } from './panel-click';
import { nextStep, scoreText } from './first-round';
import { MomentKind, MomentState, nextMoment } from './moments';
import { BUILDING_KINDS, CART_PRICE, ITEMS, ITEM_KINDS, ItemKind, countOf, isAmenity, isBuilding } from './items';
import { flagMark, icon, pic } from './icons';
import { drawFacilityThumb, isFacilityKind } from './art/facilities';
import { drawAmenityThumb } from './art/amenities';
import { Sprite, placedSprites } from './art/props';
import { claimable, rollDay } from './daily';
import { levelXp, playerLevel } from './experience';
import type { Cheer } from './game';
import { StaffId } from './game';
import { CFG } from './config';
import { Game, fmtMoney } from './game';
import { TUTORIAL_STEPS } from './tutorial';
import { Editor, terrainLabel } from './input';
import { BRUSH_RADII, PAINT_TOOLS, TOOL_INFO, ToolId, planPaint, planStraighten } from './editing';
import { EVENTS, EVENT_IDS, EventId } from './events';
import { Hole, MAX_BENDS, PAR_YARDS, holeBends, holeCondition, holeYards, idx } from './terrain';
import { BANDS, CLUB_LEVELS, REGIONS } from './progression';
import { logoDesigner, paintLogo } from './start';
import { operatingProfit, netChange, UPGRADE_IDS, UpgradeId, cartRentalRate } from './economy';

type ToolCat = 'terrain' | 'nature' | 'holes';
const CAT_OF: Partial<Record<ToolId, ToolCat>> = { fairway: 'terrain', green: 'terrain', rough: 'terrain', path: 'terrain', bunker: 'terrain', water: 'terrain', treeAdd: 'nature', treeDel: 'nature', repair: 'nature', tee: 'holes', cup: 'holes', bend: 'holes', build: 'holes' };
type Tab = 'journey' | 'build' | 'course' | 'guests' | 'money' | 'events' | 'club' | 'none';
const SIDE_TABS: Tab[] = ['course', 'guests', 'money', 'club', 'events', 'journey'];
/** Plain help for each tool, the first time it is picked. */
const TOOL_TIPS: Partial<Record<string, string>> = {
  build: 'Tap where the tee goes, then where the green goes. Pick par 3, 4 or 5, add bends with + Bend, and drag any marker to adjust (on touch, press and hold it first). Nothing is built until you tap Build.',
  fairway: 'Hold a finger on the map, then drag to paint fairway. Golfers aim for it. Every hole needs fairway from tee to green.',
  green: 'Hold and drag to grow or reshape a green. Bigger greens are easier to hit.',
  bunker: 'Hold and drag to dig sand. Bunkers beside greens and fairways make holes more interesting, but keep a clear way to the green.',
  water: 'Hold and drag to dig ponds and streams. Water is a hazard; golfers can play over it but cannot walk through it.',
  path: 'Hold and drag to lay a cart path. Golfers walk faster on paths, and a path over water becomes a bridge.',
  treeAdd: 'Hold and drag to plant trees. Trees frame holes and punish wild shots.',
  treeDel: 'Hold and drag to clear trees out of the way of a hole.',
  rough: 'Hold and drag to turn anything back into rough grass.',
  repair: 'Hold and drag over worn fairway, green or tee to reseed it. Holes stay open and time keeps running while you repair.',
};
/** What each panel is for, the first time it opens. */
const TAB_TIPS: Partial<Record<string, string>> = {
  course: 'Every hole you build, with its par, length and whether it is open. Only open holes earn money.',
  guests: 'How happy your golfers are, and why. Happy golfers come back and may join as members.',
  money: 'Set green fees for each time of day; keep them near what guests think is fair. Improvements here earn extra money.',
  club: 'Upgrade the clubhouse to draw more golfers and, later, to allow more than nine holes. Hire staff and see what raises your rating.',
  events: 'Book a tournament or outing for a big one-day crowd. Each event lists what it needs.',
  journey: 'Your goal, daily challenges and streak. Tap Show me on a goal and the game points to what to do.',
};
const TAB_LABEL: Record<string, string> = { journey: 'Goals', build: 'Design', course: 'Course', guests: 'Golfers', money: 'Finances', events: 'Events', club: 'Clubhouse' };
const stars = (n: number) => `${'★'.repeat(Math.floor(n))}${n % 1 ? '½' : ''}${'☆'.repeat(5 - Math.ceil(n))}`;

const svg = (name: string) => icon(name);

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
  /** Which row the phone build tray shows: course tools or decorations. */
  traySet: 'course' | 'decor' | 'buildings' = 'course';
  private dayCheck = 0;
  /** Phone only: the menu sheet the round button opens. */
  menuOpen = false;
  onInsets: () => void = () => {};
  private busy = false;
  private cache = new Map<string, string>();
  private lastSaved = 0;
  private repeat: number | null = null;
  private toolShown = '';
  private cat: ToolCat = 'terrain';
  onReset: () => void = () => {};
  onSaveNow: () => void = () => {};
  onExport: () => void = () => {};
  onImport: () => void = () => {};
  onNewLook: () => void = () => {};

  constructor(private game: Game, private editor: Editor) {
    document.addEventListener('pointerdown', (e) => {
      // a tap outside the open phone menu closes it
      if (this.menuOpen && !(e.target as HTMLElement).closest('#nav, #fab, #modal')) { this.menuOpen = false; this.refresh(true); }
      if ((e.target as HTMLElement).closest('#side, #top, #tools')) this.busy = true;
    });
    // A press on a panel holds back its rebuilds until the click that follows has been delivered (on touch screens the click can land a moment after
    // the finger lifts), so the control that was pressed is still the one that receives it.
    let releaseT = 0;
    const release = () => { window.clearTimeout(releaseT); releaseT = window.setTimeout(() => (this.busy = false), 350); };
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
    document.addEventListener('pointerdown', () => window.clearTimeout(releaseT), true);
    this.buildRoundCard();
    this.buildTools();
    this.buildTop();
    this.buildSide();
    this.buildNav();
    this.buildChip();
    // One layout: the game is an iPhone game. In a wide browser window it shows in a phone-sized frame.
    this.setMobile(true);
    game.onNotice = (n) => this.toast(n.text, n.kind);
    editor.onSelect = (what) => {
      this.tab = what === 'golfer' ? 'guests' : 'course';
      this.cache.delete('side');
    };
    editor.onChange = () => this.updateConfirm();
    editor.onBuilt = (label, cost) => this.builtToast(label, cost);
  }

  // ---------- static pieces ----------
  private $(id: string) {
    return document.getElementById(id)!;
  }

  private buildTools() {
    const mk = (id: ToolId, label?: string, cls = '') => `<button class="tool ${cls}" data-tool="${id}" title="${TOOL_INFO[id].label}: ${TOOL_INFO[id].hint}" aria-label="${TOOL_INFO[id].label}">${id === 'inspect' || id === 'pan' || id === 'bend' ? svg(id) : `<canvas class="terrain-thumb" data-thumbnail="${id}" width="112" height="74"></canvas>`}<span>${label ?? TOOL_INFO[id].label}</span></button>`;
    const cat = (id: ToolCat, label: string) => `<button class="cat" data-cat="${id}">${label}</button>`;
    this.$('tools').innerHTML = `
      <div class="trayrow catrow">${mk('inspect', 'Select', 'mini')}${mk('pan', 'Pan', 'mini')}<div class="cats" role="group" aria-label="Tool groups">${cat('terrain', 'Terrain')}${cat('nature', 'Nature')}${cat('holes', 'Holes')}</div></div>
      <div class="ph-mode" role="tablist" aria-label="Building or decorating"><button data-trayset="course" class="on">Course</button><button data-trayset="decor">Decorate</button><button data-trayset="buildings">Buildings</button></div>
      <div class="phonerow"><button class="ph-undo" data-undo="1" aria-label="Undo">${icon('undo')}</button><button class="ph-undo ph-redo" data-redo="1" aria-label="Redo" hidden>${icon('redo')}</button><div class="ph-tools">${mk('build', 'New hole')}${mk('fairway')}${mk('green')}${mk('bunker')}${mk('water')}${mk('path', 'Path')}${mk('treeAdd', 'Tree')}${mk('treeDel', 'Clear')}${mk('rough')}${mk('repair', 'Repair')}</div><div class="ph-tools ph-decor ph-bld"><button class="tool" data-moveclub="1" aria-label="Move or turn the clubhouse"><span class="club-tile" aria-hidden="true">${pic('club')}</span><span>Clubhouse</span><em>Move · turn</em></button>${BUILDING_KINDS.map((k) => `<button class="tool" data-decor="${k}" aria-label="${ITEMS[k].label}"><canvas class="decor-thumb" data-decorthumb="${k}" width="96" height="72"></canvas><span>${ITEMS[k].label}</span><em>$${ITEMS[k].cost.toLocaleString('en-US')}</em></button>`).join('')}</div><div class="ph-tools ph-decor ph-fun">${ITEM_KINDS.filter((k) => !isBuilding(k)).map((k) => `<button class="tool" data-decor="${k}" aria-label="${ITEMS[k].label}"><canvas class="decor-thumb" data-decorthumb="${k}" width="96" height="72"></canvas><span>${ITEMS[k].label}</span><em>$${ITEMS[k].cost}</em></button>`).join('')}</div><button class="tray-done" data-done="1">Done</button></div>
      <div class="trayrow toolrow" data-tools="terrain">${mk('fairway')}${mk('green')}${mk('rough')}${mk('path', 'Path')}${mk('bunker')}${mk('water')}</div>
      <div class="trayrow toolrow" data-tools="nature">${mk('treeAdd', 'Plant tree')}${mk('treeDel', 'Clear tree')}${mk('repair', 'Repair')}</div>
      <div class="trayrow toolrow" data-tools="holes">${mk('tee', 'Move tee')}${mk('cup', 'Move cup')}${mk('bend', 'Dogleg')}${mk('build', 'New hole')}</div>`;
    const brushNames = ['Small', 'Medium', 'Large'];
    const bb = document.createElement('div');
    bb.id = 'brushbar';
    bb.setAttribute('role', 'group');
    bb.setAttribute('aria-label', 'Brush size');
    bb.innerHTML = BRUSH_RADII.map((_, i) => `<button data-brush="${i}" title="${brushNames[i]} brush" aria-label="${brushNames[i]} brush"><i style="width:${8 + i * 7}px;height:${8 + i * 7}px"></i><span>${'SML'[i]}</span><em>Brush</em></button>`).join('');
    document.getElementById('app')!.append(bb);
    bb.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      // Phones show one brush button that cycles through the sizes, so it covers as little of the map as possible.
      if (b?.dataset.brush) { this.editor.setBrush(this.mobile ? (this.editor.brush + 1) % BRUSH_RADII.length : Number(b.dataset.brush)); this.refresh(true); }
    });
    this.$('tools').querySelectorAll<HTMLCanvasElement>('canvas[data-thumbnail]').forEach(c => paintToolTile(c,c.dataset.thumbnail as ToolId));
    {
      const sprites: Record<string, Sprite> = placedSprites();
      this.$('tools').querySelectorAll<HTMLCanvasElement>('canvas[data-decorthumb]').forEach((c) => {
        const kk = c.dataset.decorthumb!;
        if (isFacilityKind(kk) || kk === 'cart') { drawFacilityThumb(c, kk as never); return; }
        if (kk === 'puttingGreen' || kk === 'range') { drawAmenityThumb(c, kk); return; }
        const sp = sprites[kk];
        const x = c.getContext('2d')!;
        const k = Math.min((c.width - 8) / sp.cv.width, (c.height - 6) / sp.cv.height);
        x.drawImage(sp.cv, (c.width - sp.cv.width * k) / 2, c.height - 3 - sp.cv.height * k, sp.cv.width * k, sp.cv.height * k);
      });
    }
    this.$('tools').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.undo) { this.editor.undo(); this.refresh(true); return; }
      if (b.dataset.redo) { this.editor.redo(); this.refresh(true); return; }
      if (b.dataset.buycart) { if (!this.game.upgrades.carts) this.game.buyUpgrade('carts'); else this.game.buyCart(); this.refresh(true); return; }
      if (b.dataset.trayset) { this.traySet = b.dataset.trayset as 'course' | 'decor' | 'buildings'; if (this.traySet === 'decor' || this.traySet === 'buildings') { if (this.traySet === 'buildings' && !isBuilding(this.editor.decorKind)) this.editor.decorKind = 'halfway'; if (this.traySet === 'decor' && isBuilding(this.editor.decorKind)) this.editor.decorKind = 'flowers'; this.editor.setTool('decor'); } else if (this.editor.tool === 'decor') this.editor.setTool('inspect'); this.refresh(true); return; }
      if (b.dataset.moveclub) { this.editor.setTool('decor'); this.editor.startMoveClub(); this.refresh(true); return; }
      if (b.dataset.decor) { this.editor.decorKind = b.dataset.decor as ItemKind; this.editor.setTool('decor'); this.refresh(true); return; }
      if (b.dataset.done) { this.tab = 'none'; this.editor.setTool('inspect'); this.designPause = this.game.designMode; this.game.exitDesign(); this.refresh(true); this.onInsets(); return; }
      if (b.dataset.tool) this.editor.setTool(b.dataset.tool as ToolId);
      else if (b.dataset.cat) {
        const order: ToolCat[] = ['terrain', 'nature', 'holes'];
        // On a short landscape screen only the current group is shown, and tapping it advances to the next.
        const id = b.dataset.cat as ToolCat;
        this.cat = this.landscape && id === this.cat ? order[(order.indexOf(id) + 1) % order.length] : id;
      }
      this.refresh(true);
    });
  }

  private buildTop() {
    const speeds: [number, string][] = [[0, 'II'], [1, '1×'], [3, '3×'], [8, '8×']];
    this.$('top').innerHTML = `
      <button class="brand" id="brandBtn" aria-label="Club menu"><canvas width="68" height="68" id="topLogo"></canvas><span id="clubName"></span></button>
      <div class="sep"></div>
      <div class="lvl" id="lvlBox" title="Your level"><span class="k">Lvl</span><b id="lvlN">1</b><i><em id="lvlBar"></em></i></div>
      <div class="stat"><span class="k">Cash</span><span class="v cash" id="cash"></span></div>
      <div class="stat"><span class="k" id="dayk"></span><span class="v small" id="clock"></span><div class="daybar"><i id="daybar"></i></div></div>
      <div id="tstate" role="status"></div>
      <div class="stat hide-m" title="Fee for the tee-time band running now. Set all three in the Money tab."><span class="k" id="feek">Tee time</span><div class="fee"><button data-fee="-1" aria-label="Lower fee">−</button><span class="v" id="fee"></span><button data-fee="1" aria-label="Raise fee">+</button></div></div>
      <div class="stat hide-m" id="starbox" title="Course rating"><span class="k">Rating</span><span class="v small stars" id="starsTxt"></span></div>
      <div class="stat hide-m" id="satbox" title="Average satisfaction of recent guests"><span class="k">Guests</span><span class="v small" id="sat"></span><div class="meter"><i id="satbar"></i></div></div>
      <div class="stat hide-m" title="Operating profit so far today (fees and sales minus maintenance)"><span class="k">Today</span><span class="v small" id="todayp"></span></div>
      <div class="stat hide-m" id="evbox" style="display:none"><span class="k">Event</span><span class="v small" id="evtxt"></span></div>
      <div class="stat hide-m"><span class="k">On course</span><span class="v small" id="oncourse"></span></div>
      <div class="spacer"></div>
      <span class="saved hide-m" id="saved"></span>
      <div class="seg" id="speed">${speeds.map(([s, l]) => `<button data-speed="${s}">${l}</button>`).join('')}</div>
      <button class="btn menu" id="menuBtn" aria-label="Menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg><span>Menu</span></button>`;
    const top = this.$('top');
    top.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.speed !== undefined) this.setTimeSpeed(Number(b.dataset.speed));
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
    this.$('side').innerHTML = `<div class="tabs">${SIDE_TABS.map((t) => `<button data-tab="${t}">${TAB_LABEL[t]}</button>`).join('')}</div><div class="sheet-head" id="sheetHead"><span class="sheet-grip" aria-hidden="true"></span><span class="sheet-title"><b id="sheetTitle">Course</b><small id="sheetSub"></small></span><button id="sheetSize" class="sheet-btn" aria-label="Resize panel">▴</button><button id="sheetClose" class="sheet-btn" aria-label="Close panel">×</button></div><div class="body" id="sidebody"></div>`;
    // expandable sections remember being open, and their contents ease in rather than appearing all at once
    this.$('side').addEventListener('toggle', (e) => {
      const d = e.target as HTMLDetailsElement;
      if (!d.matches?.('details.xp')) return;
      if (d.open) {
        if (!this.openSecs.has(d.dataset.sec!)) {
          this.openSecs.add(d.dataset.sec!);
          const body = d.querySelector<HTMLElement>('.xp-body');
          if (body && !UI.reduced) body.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.7,.3,1)' });
        }
      } else this.openSecs.delete(d.dataset.sec!);
    }, true);
    this.$('sheetClose').onclick = (e) => { e.stopPropagation(); this.tab = 'none'; this.refresh(true); this.onInsets(); };
    this.$('sheetSize').onclick = (e) => { e.stopPropagation(); this.setSheet(this.sheet === 'full' ? 'half' : 'full'); };
    this.bindSheetDrag();
    this.$('side').addEventListener('click', (e) => {
      // see panel-click.ts: a click on a section header or plain text is not a control, and must not rebuild the panel
      const el = panelControl<HTMLElement>(e.target as HTMLElement, this.$('side'));
      if (!el) return;
      if (el.dataset.tab) {
        this.tab = el.dataset.tab as Tab;
        this.cache.delete('side');
      } else if (el.dataset.hole) {
        this.editor.selectHole(Number(el.dataset.hole));
        this.editor.focusHole();
      } else if (el.dataset.act) {
        const id = Number(el.dataset.id);
        if (el.dataset.act === 'journal') this.journalView = el.dataset.id as JournalView;
        else if (el.dataset.act === 'buycart') this.game.buyCart();
        else if (el.dataset.act === 'goalgo') { this.showGoal(el.dataset.id!); return; }
        else if (el.dataset.act === 'tipok') { this.panelTip = null; this.cache.delete('side'); }
        else if (el.dataset.act === 'claimstreak') { const n = this.game.claimStreak(); if (n) this.coinBurst(el, n); }
        else if (el.dataset.act === 'claimch') { const n = this.game.claimChallenge(Number(el.dataset.id)); if (n) { this.coinBurst(el, n); this.confetti(24); } }
        else if (el.dataset.act === 'suggest') {
          if (el.dataset.id === 'course') this.tab = 'course'; else this.journalView = el.dataset.id as JournalView;
        }
        else if (el.dataset.act === 'project') this.projectModal(el.dataset.id!);
        else if (el.dataset.act === 'reserve') useOperatingReserve(this.game);
        else if (el.dataset.act === 'claim') this.game.claimObjective(el.dataset.id!);
        else if (el.dataset.act === 'hire') this.game.hire(el.dataset.id as StaffId);
        else if (el.dataset.act === 'dismiss') this.game.dismiss(el.dataset.id as StaffId);
        else if (el.dataset.act === 'repairgreen') this.repairGreenModal();
        else if (el.dataset.act === 'heat') this.game.heatmap = !this.game.heatmap;
        else if (el.dataset.act === 'routing') { this.editor.setTool('bend'); if (this.mobile) this.tab = 'build'; }
        else if (el.dataset.act === 'issue') this.fixIssue(Number(el.dataset.i), el.dataset.mode === 'fix');
        else if (el.dataset.act === 'holetool') { this.editor.setTool(el.dataset.id as ToolId); this.tab = this.mobile ? 'build' : this.tab; }
        else if (el.dataset.act === 'newhole') { this.editor.setTool('build'); this.tab = this.mobile ? 'build' : this.tab; }
        else if (el.dataset.act === 'testgolfers') {
          // Test golfers play on their own: the business clock and the player's chosen speed are left exactly as they are.
          const g = this.game;
          this.editor.setTool('inspect');
          g.sendTestGolfers(this.game.selectedHole, g.tutorial.done ? undefined : ['regular']);
          g.followGolfer = 0;
          this.editor.focusHole();
          if (this.mobile) this.tab = 'none';
        }
        else if (el.dataset.act === 'focus') { this.editor.focusHole(); if (this.mobile) this.tab = 'none'; }
        else if (el.dataset.act === 'undo') this.editor.undo();
        else if (el.dataset.act === 'practice' || el.dataset.act === 'playround') {
          // The practice round holds the clock only while it lasts; whether time was running or held beforehand is untouched.
          this.editor.discard(); this.editor.setTool('inspect'); this.game.exitDesign(); this.game.owner.start(this.game, el.dataset.act === 'playround');
          this.editor.focusHole(); if (this.mobile) this.tab = 'none';
        }
        else if (el.dataset.act === 'watch') { this.game.selectedGolfer = id; this.game.followGolfer = id; if (this.mobile) this.tab = 'none'; }
        else if (el.dataset.act === 'open') this.openFromPanel(id);
        else if (el.dataset.act === 'close') this.game.closeHole(id);
        else if (el.dataset.act === 'buy') this.game.buyUpgrade(el.dataset.id as UpgradeId);
        else if (el.dataset.act === 'placeamenity') {
          // pick the item in the Buildings tray and show the clubhouse, where there is room to put it
          this.traySet = 'buildings';
          if (this.mobile) this.tab = 'build';
          const lot = this.editor.previewAmenity(el.dataset.id as ItemKind);
          this.refresh(true); this.onInsets();
          // the new tile may be off the end of the row
          requestAnimationFrame(() => this.$('tools').querySelector('.ph-bld .tool.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
          const club = this.game.world.clubhouse;
          const sz = ITEMS[el.dataset.id as ItemKind];
          if (lot) this.editor.focusPoints([{ x: lot.x, y: lot.y }, { x: lot.x + (sz.w ?? 1), y: lot.y + (sz.h ?? 1) }, ...(club ? [{ x: club.x + 3, y: club.y + 2 }] : [])]);
          else this.toast('There is no clear ground left near the clubhouse.', 'bad');
        }
        else if (el.dataset.act === 'newcourse') { this.confirmReset(true); return; }
        else if (el.dataset.act === 'gobuildings') {
          this.traySet = 'buildings';
          if (!isBuilding(this.editor.decorKind)) this.editor.decorKind = 'halfway';
          this.editor.setTool('decor');
          this.tab = 'build';
        }
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
        else if (el.dataset.act === 'setpar') this.game.setHolePar(this.game.selectedHole, id);
        else if (el.dataset.act === 'straighten') { const pl = planStraighten(this.game.world, this.game.hole(this.game.selectedHole)); if (typeof pl === 'string') this.game.notify('bad', pl); else this.game.commitEdit(pl); }
        else if (el.dataset.act === 'editlogo') this.logoModal();
        else if (el.dataset.act === 'renameclub') this.nameModal();
      }
      this.refresh(true);
      this.onInsets();
      if (el.dataset.act === 'focus') this.editor.focusHole();
    });
    this.$('goalbar').addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-gb]')?.dataset.gb;
      if (act) {
        // the closed-hole reminder: open what is ready, or show why the first one cannot open
        const { waiting, ready } = this.closedHoles();
        if (act === 'resume') { this.chipAction(); this.refresh(true); return; }
        if (act === 'open') for (const h of ready) this.game.openHole(h.id);
        else if (waiting[0]) { this.editor.selectHole(waiting[0].id); this.editor.focusHole(); this.tab = 'course'; this.sheet = 'half'; this.cache.delete('side'); }
        this.refresh(true);
        this.onInsets();
        return;
      }
      this.tab = 'journey';
      this.refresh(true);
    });
  }

  /** The time-state control inside the status bar: Pause while running; Resume or Open for business while time is held. */
  private tstate: HTMLElement | null = null;
  private buildChip() {
    this.tstate = this.$('tstate');
    this.tstate.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('button:not(:disabled)')) return;
      if (this.game.timeHold === null) this.game.pause(); else this.chipAction();
      this.refresh(true);
    });
    // Touches on the bar never reach the course underneath.
    this.tstate.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  /** Caption and action for whatever is holding time, or for the running clock. */
  chipView(): { cap: string; act: string; icon: string; hold: string; off: boolean } {
    const g = this.game;
    switch (g.timeHold) {
      case 'design': return { cap: 'Designing · paused', act: 'Resume', icon: 'play', hold: 'design', off: false };
      case 'paused': return { cap: 'Time paused', act: 'Resume', icon: 'play', hold: 'paused', off: false };
      case 'owner': return { cap: 'Practice round', act: 'Playing', icon: 'play', hold: 'paused', off: true };
      case 'unopened': {
        // While the tutorial is teaching, its own last step offers Open for business; the bar only labels the pause until then.
        const teaching = !g.tutorial.done && g.tutorial.step < TUTORIAL_STEPS - 1;
        const can = !!g.world.clubhouse && !teaching;
        return { cap: 'Setting up · paused', act: can ? 'Open for business' : 'Paused', icon: can ? 'play' : 'pause', hold: 'unopened', off: !can };
      }
      default: return { cap: `Playing · ${g.settings.speed}×`, act: 'Pause', icon: 'pause', hold: '', off: false };
    }
  }
  private updateChip() {
    const v = this.chipView();
    const html = `<button type="button" ${v.off ? 'disabled' : ''}><span class="ts-cap">${v.cap}</span><span class="ts-act">${icon(v.icon)}${v.act}</span></button>`;
    if (this.cache.get('chip') !== html) {
      this.cache.set('chip', html);
      this.tstate!.innerHTML = html;
      if (v.hold) this.tstate!.dataset.hold = v.hold; else delete this.tstate!.dataset.hold;
    }
  }

  private buildNav() {
    const tabs = ['build', 'course', 'guests', 'money', 'club', 'events', 'journey'];
    this.$('nav').innerHTML = tabs.map((t) => `<button data-nav="${t}" aria-label="${TAB_LABEL[t]}" title="${TAB_LABEL[t]}">${pic(t)}<span>${TAB_LABEL[t]}</span></button>`).join('');
    // Phone: the destinations live in a menu window that the corner button opens, under a title bar with its own close control.
    this.$('nav').insertAdjacentHTML('afterbegin', `<div class="mhead"><b>Menu</b><button class="mclose" data-m="close" aria-label="Close menu">${icon('close')}</button></div><div class="mspeed" role="group" aria-label="Game speed"><button data-mspeed="0">${icon('pause')}<span>Pause</span></button><button data-mspeed="1">${icon('play')}<span>Play</span></button><button data-mspeed="3">${icon('fast')}<span>Fast</span></button></div>`);
    this.$('nav').insertAdjacentHTML('beforeend', `<button class="mset" data-m="settings">Settings and save</button>`);
    const fab = document.createElement('button');
    fab.id = 'fab';
    fab.setAttribute('aria-label', 'Menu');
    document.getElementById('app')!.append(fab);
    fab.onclick = () => {
      if (this.tab === 'build') { this.tab = 'none'; this.editor.setTool('inspect'); this.designPause = this.game.designMode; this.game.exitDesign(); }
      else this.menuOpen = !this.menuOpen;
      this.refresh(true);
      this.onInsets();
    };
    this.$('nav').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      if (b.dataset.mspeed !== undefined) { this.setTimeSpeed(Number(b.dataset.mspeed)); this.menuOpen = false; this.refresh(true); return; }
      if (b.dataset.m) {
        this.menuOpen = false;
        if (b.dataset.m === 'close') { /* just closes */ }
        else if (b.dataset.m === 'settings') this.openMenu();
        else (document.querySelector(`#map-controls [data-camera="${b.dataset.m}"]`) as HTMLElement | null)?.click();
        this.refresh(true);
        return;
      }
      if (!b.dataset.nav) return;
      this.menuOpen = false;
      const t = b.dataset.nav as Tab;
      this.tab = this.tab === t ? 'none' : t;
      if (this.tab === t && t !== 'build') this.sheet = 'half';
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

  /** A phone on its side. Measured from the game area, which is a portrait frame in a wide browser window. */
  get landscape() {
    const r = document.getElementById('app')!.getBoundingClientRect();
    return r.width > r.height && r.height <= 600;
  }
  /** Phone portrait panels are bottom sheets with three resting heights. */
  get portraitSheet() { return this.mobile && !this.landscape; }
  sheet: 'peek' | 'half' | 'full' = 'half';
  private sheetDragH: number | null = null;

  /** Heights the sheet can rest at, measured from the top of the bottom navigation. */
  /** The game area: the whole window on a phone, a phone-sized frame in a wide browser window. */
  private get appRect() { return document.getElementById('app')!.getBoundingClientRect(); }
  private sheetHeights() {
    // On phones the navigation lives in the menu, so the sheet can use everything below the status chip.
    const floor = this.mobile ? this.appRect.bottom : this.$('nav').getBoundingClientRect().top;
    const topBottom = this.$('top').getBoundingClientRect().bottom;
    const room = Math.max(160, floor - topBottom - 8);
    return { peek: 58, half: Math.round(Math.min(room, Math.max(260, room * 0.5))), full: Math.round(room) };
  }
  /**
   * Publish where the header ends and where the bottom controls begin, so docked pieces
   * (confirm bar, coach, toasts, map buttons) sit in the space that is actually free.
   */
  layoutVars() {
    const root = document.documentElement.style, a = this.appRect, H = a.bottom;
    const vis = (id: string) => { const el = document.getElementById(id); if (!el || el.style.display === 'none' || getComputedStyle(el).display === 'none') return null; const r = el.getBoundingClientRect(); return r.height > 0 ? r : null; };
    const top = vis('top');
    let dockTop = H;
    if (this.mobile && !this.landscape) for (const id of ['tools', 'side']) { const r = vis(id); if (r && r.height) dockTop = Math.min(dockTop, r.top); }
    if (this.mobile && this.landscape) { const r = vis('tools'); if (r && r.height) dockTop = Math.min(dockTop, r.top); }
    // the round menu button sits in the bottom corner: docked cards and bars stay above it
    if (this.mobile && !this.landscape) dockTop = Math.min(dockTop, H - 82);
    const side = this.mobile && this.landscape ? vis('side') : null;
    // values are relative to the game area, which positions its own fixed pieces
    const vals = `${Math.round(top ? top.bottom - a.top : 0)}|${Math.round(H - dockTop)}|${side ? Math.round(a.right - side.left) : 0}`;
    if (vals === this.layoutKey) return;
    this.layoutKey = vals;
    const [hdr, dock, sw] = vals.split('|');
    root.setProperty('--hdr', `${hdr}px`);
    root.setProperty('--dock', `${dock}px`);
    root.setProperty('--side-w', `${sw}px`);
  }
  private layoutKey = '';
  setSheet(s: 'peek' | 'half' | 'full') {
    this.sheet = s;
    this.sheetDragH = null;
    this.applySheet();
    this.onInsets();
  }
  private applySheet() {
    const side = this.$('side');
    if (!this.portraitSheet) { side.style.height = ''; side.dataset.sheet = ''; return; }
    const h = this.sheetDragH ?? this.sheetHeights()[this.sheet];
    side.style.height = `${h}px`;
    side.dataset.sheet = this.sheetDragH === null ? this.sheet : 'drag';
    this.$('sheetSize').textContent = this.sheet === 'full' ? '▾' : '▴';
  }
  /** Drag the header to resize; a short tap steps between half and full. Touches never reach the map. */
  private bindSheetDrag() {
    const head = this.$('sheetHead');
    let startY = 0, startH = 0, id = -1, moved = false;
    head.addEventListener('pointerdown', (e) => {
      if (!this.portraitSheet || (e.target as HTMLElement).closest('button')) return;
      id = e.pointerId; startY = e.clientY; startH = this.$('side').getBoundingClientRect().height; moved = false;
      head.setPointerCapture(id);
    });
    head.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 6) moved = true;
      if (!moved) return;
      const hs = this.sheetHeights();
      this.sheetDragH = Math.max(hs.peek, Math.min(hs.full, startH - dy));
      this.applySheet();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      if (!moved) { this.setSheet(this.sheet === 'peek' ? 'half' : this.sheet === 'half' ? 'full' : 'half'); return; }
      const hs = this.sheetHeights(), h = this.sheetDragH ?? startH;
      const near = (['peek', 'half', 'full'] as const).reduce((a, k) => (Math.abs(hs[k] - h) < Math.abs(hs[a] - h) ? k : a), 'half' as 'peek' | 'half' | 'full');
      this.setSheet(near);
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }

  /** Space taken by panels, so the map can centre itself in what is left. */
  insets() {
    const base = this.panelInsets();
    const coach = document.getElementById('coach');
    if (!coach || coach.hidden || !document.body.classList.contains('coaching')) return base;
    const c = coach.getBoundingClientRect(), a = this.appRect;
    // On its side the coach sits top right, so the map frames itself to its left.
    if (this.landscape) return { ...base, r: Math.max(base.r, a.right - c.left + 8) };
    // The map frames itself clear of the coach, above or below it.
    if (c.top + c.height / 2 > a.top + a.height / 2) return { ...base, b: Math.max(base.b, a.bottom - c.top + 8) };
    return { ...base, t: Math.max(base.t, c.bottom - a.top + 8) };
  }
  private panelInsets() {
    const r = (id: string) => (document.getElementById(id) as HTMLElement).getBoundingClientRect();
    if (this.mobile) {
      const nav = { right: 0, height: 0 };
      if (this.landscape) {
        // sizes, not positions: panels slide in, and a rect taken mid-animation would be wrong
        const el = (id: string) => document.getElementById(id) as HTMLElement;
        const sideOpen = this.tab !== 'none' && this.tab !== 'build';
        return { l: nav.right + 10, r: sideOpen ? el('side').offsetWidth + 16 : 12,
          t: r('top').bottom - this.appRect.top + 10, b: this.tab === 'build' ? el('tools').offsetHeight + 16 : 12 };
      }
      const sheet = this.tab !== 'none' && this.tab !== 'build' ? r('side').height : this.tab === 'build' ? r('tools').height : 0;
      return { l: 0, r: 0, t: r('top').bottom - this.appRect.top + 8, b: nav.height + sheet + this.barH };
    }
    return { l: 12, r: this.tab !== 'none' && this.tab !== 'build' ? r('side').width + 24 : 12, t: r('top').bottom + 12, b: r('tools').height + 24 };
  }

  /** Height of the Build bar when it is showing (0 when hidden), so the map can frame itself above it. */
  private barH = 0;
  private updateConfirm() {
    const el = this.$('confirm');
    const choosingClub = this.editor.placingClub;
    document.body.classList.toggle('placing-club', choosingClub);
    if (choosingClub) {
      const spot = this.editor.clubSpot;
      const ok = !!spot && !spot.problem && this.editor.clubLocked;
      const moving = this.editor.relocClub;
      const msg = !spot ? 'Tap or click the ground to place it.' : spot.problem ? spot.problem : this.editor.clubLocked ? (moving ? 'Tap elsewhere to move it. Rotate turns it the other way. The entrance road moves with it.' : 'Trees will be cleared. An entrance road is included.') : 'Tap or click to choose this spot.';
      const html = `<span class="cf-text"><b>${moving ? 'Move your clubhouse' : 'Place your clubhouse'}</b><span class="cf-sub ${spot?.problem ? 'bad' : ''}">${escapeHtml(msg)}</span></span><button class="btn" id="clubRot" aria-label="Rotate the clubhouse">Rotate</button>${moving ? '<button class="btn" id="clubNo">Cancel</button>' : '<button class="btn" id="clubSuggest">Suggest a spot</button>'}<button class="btn primary" id="clubOk" ${ok ? '' : 'disabled'}>${moving ? 'Move here' : 'Build here'}</button>`;
      if (this.cache.get('confirm') !== html) {
        this.cache.set('confirm', html);
        el.innerHTML = html;
        el.style.display = 'flex';
        const sg = el.querySelector<HTMLElement>('#clubSuggest');
        if (sg) sg.onclick = () => this.editor.suggestClub();
        const cn = el.querySelector<HTMLElement>('#clubNo');
        if (cn) cn.onclick = () => { this.editor.cancelClub(); this.refresh(true); };
        (this.$('clubRot') as HTMLElement).onclick = () => this.editor.rotateClub();
        (this.$('clubOk') as HTMLElement).onclick = () => this.editor.confirmClub();
      }
      return;
    }
    const bg = this.editor.bGhost;
    document.body.classList.toggle('placing-building', !!bg);
    if (bg) {
      const d = ITEMS[bg.k];
      const prob = this.editor.bProblem;
      const moving = bg.move !== undefined;
      const unchanged = moving && !!bg.from && bg.from.x === bg.x && bg.from.y === bg.y;
      const sub = moving ? prob ?? (unchanged ? 'Tap where it should go. Moving is free.' : 'Moving is free.') : bg.sell ? `Sell back for $${d.cost.toLocaleString('en-US')}.` : prob ?? `${d.hint}${d.upkeep ? ` Upkeep $${d.upkeep} a day.` : ''}`;
      const html = moving
        ? `<span class="cf-text"><b>${d.label}</b><span class="cf-sub ${prob ? 'bad' : ''}">${escapeHtml(sub)}</span></span><button class="btn warn" id="bgSell">Sell $${d.cost.toLocaleString('en-US')}</button><button class="btn" id="bgNo">Cancel</button><button class="btn primary" id="bgOk" ${prob || unchanged ? 'disabled' : ''}>Move here</button>`
        : `<span class="cf-text"><b>${d.label} · $${d.cost.toLocaleString('en-US')}</b><span class="cf-sub ${prob ? 'bad' : ''}">${escapeHtml(sub)}</span><span class="cf-hint">Tap elsewhere to move it.</span></span><button class="btn" id="bgNo">${bg.sell ? 'Keep' : 'Cancel'}</button><button class="btn primary" id="bgOk" ${prob ? 'disabled' : ''}>${bg.sell ? 'Sell' : 'Build'}</button>`;
      if (this.cache.get('confirm') !== html) {
        this.cache.set('confirm', html);
        el.innerHTML = html;
        el.style.display = 'flex';
        el.classList.remove('placing');
        (this.$('bgNo') as HTMLElement).onclick = () => this.editor.cancelGhost();
        const bs = el.querySelector<HTMLElement>('#bgSell');
        if (bs) bs.onclick = () => this.editor.sellPicked();
        (this.$('bgOk') as HTMLElement).onclick = () => this.editor.confirmGhost();
      }
      document.body.classList.add('has-proposal');
      return;
    }
    const p = this.editor.proposal;
    const short = p ? p.cost - this.game.cash : 0;
    const what = p ? (p.tiles.length ? `${p.tiles.length} tile${p.tiles.length === 1 ? '' : 's'}` : 'No terrain change') : '';
    const shaping = this.editor.shaping;
    const bendTool = shaping && this.editor.tool === 'bend';
    const placing = !p && !bendTool && this.editor.isPlacement && !this.game.owner.active && (!this.mobile || this.tab === 'build' || this.tab === 'none');
    const hn = this.game.selectedHole;
    const hint = this.editor.tool === 'tee' ? `Tap where hole ${hn}'s new tee goes` : this.editor.tool === 'cup' ? `Tap where hole ${hn}'s new green goes` : this.editor.tool === 'bend' ? `Tap a new turning point for hole ${hn}` : this.editor.buildStarted ? 'Now tap where the green goes' : 'Tap where the new tee goes';
    const building = this.editor.tool === 'build';
    const nh = p?.newHole;
    const ui = this.editor.overlay.bendUi;
    const bends = this.editor.shapingBends;
    const sel = this.editor.selBend;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const bendBtns = shaping
      ? `<button class="mini wide" id="cfBend" ${bends.length >= MAX_BENDS ? 'disabled' : ''}>+ Bend</button>${sel >= 0 && sel < bends.length ? `<button class="mini wide warn" id="cfRemove">Remove bend ${sel + 1}</button>` : ''}${bends.length && !(sel >= 0 && sel < bends.length) ? '<button class="mini wide" id="cfStraight">Straight</button>' : ''}`
      : '';
    const parBar = (building && (nh || placing)) || bendBtns
      ? `<span class="cf-pars" role="group" aria-label="${building ? 'Par and bends' : 'Bends'}">${building && (nh || placing) ? `<b>Par</b>${[3, 4, 5].map((n) => `<button class="mini ${n === this.editor.newPar ? 'on' : ''}" data-par="${n}">${n}</button>`).join('')}` : ''}${bendBtns}</span>`
      : '';
    // live numbers for the route being shaped: the same total the finished hole reports, each leg, and what Build would charge
    const legs = ui && ui.legs.length > 1 ? ` (${ui.legs.join(' + ')})` : '';
    const route = ui ? `${ui.total} yd${legs} · par ${ui.par} · ` : nh ? `${holeYards(nh)} yd · par ${nh.par} · ` : '';
    const problem = ui?.drag?.problem;
    const dragHint = shaping && !problem && !(sel >= 0 && sel < bends.length) ? `<span class="cf-hint">${bends.length ? (coarse ? 'Press and hold a bend, then drag it.' : 'Drag a bend to shape the hole.') : 'Add a bend, then drag it where the turn should be.'}${this.editor.tool === 'bend' ? ' Tap empty ground to add one.' : ''}</span>` : '';
    const badLine = problem ? `<span class="cf-sub bad">${escapeHtml(problem)}</span>` : '';
    // every caution is shown in full, one under another: they wrap instead of being cut off
    const noteLine = p?.notes?.length ? p.notes.map((n) => `<span class="cf-note">${escapeHtml(n)}</span>`).join('') : '';
    const costText = p ? `<span class="cf-cost">${fmtMoney(p.cost)}</span>` : '<span class="dim">No change yet</span>';
    const html = p || bendTool ? `<span class="cf-text"><b>${escapeHtml(p ? p.label : `Shape hole ${hn}`)}</b><span class="cf-sub">${route}${bendTool ? '' : `${what} · `}${costText}${short > 0 ? ` · need ${fmtMoney(short)} more` : ''}</span>${badLine}${dragHint}${noteLine}${parBar}</span><button class="btn" id="${p ? 'cfNo' : 'cfStop'}" ${p ? '' : 'aria-label="Stop shaping"'}>Cancel</button><button class="btn primary" id="cfOk" ${!p || short > 0 ? 'disabled' : ''}>Build</button>`
      : placing ? `<span class="cf-text"><b>${TOOL_INFO[this.editor.tool].label}</b><span class="cf-sub">${hint}. Nothing is built until you confirm.</span>${parBar}</span><button class="btn" id="cfStop">Cancel</button>` : '';
    // while a hole is being placed or shaped the toolbox steps aside, so the one panel at the bottom is all there is
    const showing = !!(p || placing || bendTool);
    document.body.classList.toggle('confirming-plan', showing && !this.editor.bGhost);
    if (this.cache.get('confirm') === html) return;
    this.cache.set('confirm', html);
    el.innerHTML = html;
    el.style.display = p || placing || bendTool ? 'flex' : 'none';
    // the map frames itself above the bar, which grows and shrinks with what is being shaped
    const barH = el.style.display === 'none' ? 0 : el.offsetHeight;
    if (barH !== this.barH) { this.barH = barH; this.onInsets(); }
    el.classList.toggle('placing', placing);
    document.body.classList.toggle('has-proposal', !!p || placing || bendTool);
    el.querySelectorAll<HTMLElement>('[data-par]').forEach((b) => { b.onclick = () => this.editor.setNewPar(Number(b.dataset.par)); });
    const bendBtn = el.querySelector<HTMLElement>('#cfBend');
    if (bendBtn) bendBtn.onclick = () => this.editor.addBend();
    const removeBtn = el.querySelector<HTMLElement>('#cfRemove');
    if (removeBtn) removeBtn.onclick = () => this.editor.removeSelectedBend();
    const straight = el.querySelector<HTMLElement>('#cfStraight');
    if (straight) straight.onclick = () => this.editor.straighten();
    const stop = el.querySelector<HTMLElement>('#cfStop');
    if (stop) stop.onclick = () => { this.editor.setTool('inspect'); this.refresh(true); };
    if (p || bendTool) (this.$('cfOk') as HTMLElement).onclick = () => this.editor.confirm();
    if (p) (this.$('cfNo') as HTMLElement).onclick = () => this.editor.discard();
  }

  /** Jump to a problem on the map and, when asked, pick the tool that fixes it. */
  private fixIssue(i: number, withTool: boolean) {
    const h = this.game.hole(this.game.selectedHole);
    const issue = this.game.validate(h.id).issues[i];
    if (!issue) return;
    if (issue.at) this.editor.focusPoint(issue.at);
    if (withTool && issue.fix) this.editor.setTool(issue.fix);
    if (this.mobile) this.tab = withTool ? 'build' : 'none';
  }
  /** Opening a hole that cannot open explains why and shows where, instead of doing nothing. */
  private openFromPanel(id: number) {
    const v = this.game.openHole(id);
    if (!v.ok && v.issues[0]?.at) this.editor.focusPoint(v.issues[0].at);
  }

  /** Pause, or choose a running speed (which resumes an open course). Closes the build tray when time restarts. */
  setTimeSpeed(speed: number) {
    if (speed <= 0) { this.game.pause(); return; }
    if (!this.leaveDesignForResume()) return;
    this.game.setSpeed(speed);
    this.warnNoHoles();
  }
  /** The Resume / Open for business button on the clock chip. */
  chipAction() {
    const g = this.game;
    if (!g.settings.open) { g.openForBusiness(); return; }
    if (!this.leaveDesignForResume()) return;
    g.resume();
    this.warnNoHoles();
  }
  /** Resuming time ends designing: put the tools down and close the tray, but never throw away an unbuilt change. */
  private leaveDesignForResume(): boolean {
    if (!this.game.settings.open) return true;
    if (this.editor.proposal || this.editor.bGhost || this.editor.placingClub) { this.toast('Build or cancel the change in progress first.', 'info'); return false; }
    if (this.tab === 'build') this.tab = 'none';
    if (this.editor.tool !== 'inspect' && this.editor.tool !== 'pan') this.editor.setTool('inspect');
    this.game.exitDesign();
    this.refresh(true);
    this.onInsets();
    return true;
  }

  // ---------- menu and modals ----------
  /** What the × (or a tap outside the dialog) does: closing is always the safe choice, the same as the dialog's own Cancel or Done. */
  private modalDismiss: () => void = () => {};
  private modal(html: string, onDismiss?: () => void): HTMLElement {
    const m = this.$('modal');
    m.hidden = false;
    m.innerHTML = `<div class="boxwrap"><div class="box" role="dialog">${html}</div><button class="mx" data-mx="1" aria-label="Close">${icon('close')}</button></div>`;
    this.modalDismiss = onDismiss ?? (() => { this.closeModal(); this.refresh(true); });
    m.onclick = (e) => {
      const t = e.target as HTMLElement;
      if (t === m || t.closest('[data-mx]')) this.modalDismiss();
    };
    return m;
  }
  closeModal() {
    this.$('modal').hidden = true;
  }
  openMenu() {
    const g = this.game;
    const m = this.modal(`<h2>Settings and save</h2><div class="menu-list">
      <button class="btn" id="mdName">Rename club</button>
      <button class="btn" id="mdLogo">Edit logo</button>
      <button class="btn" id="mdSettings">Sound and day reports</button><button class="btn" id="mdSave">Save now</button><button class="btn" id="mdExport">Export save backup</button><button class="btn" id="mdImport">Import save backup</button>
      <button class="btn danger" id="mdReset">Reset game</button></div>
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
    const m = this.modal(`<h2>Remove hole ${id}?</h2><p>${escapeHtml(h.name)} will be taken off the scorecard. Its fairway and green stay as they are. Undo brings it back.</p><div class="actions"><button class="btn" id="rmNo">Keep it</button><button class="btn danger" id="rmOk">Remove hole</button></div>`);
    (m.querySelector('#rmNo') as HTMLElement).onclick = () => this.closeModal();
    (m.querySelector('#rmOk') as HTMLElement).onclick = () => {
      this.game.removeHole(id);
      this.closeModal();
      this.refresh(true);
    };
  }

  private projectModal(id: string) {
    const offer = projectOffers(this.game).find(p => p.id === id); if (!offer || offer.locked) return;
    const m = this.modal(`<div class="eyebrow">Project</div><h2>${offer.title}</h2><p class="dim">${offer.description}</p><div class="project-quote"><span>Construction quote</span><strong>${fmtMoney(offer.cost)}</strong></div><p class="dim">${offer.plan ? `${offer.plan.tiles.length} tiles in this plan. ` : ''}${offer.xp ? '+' + offer.xp + ' career XP for the first completion at this property.' : 'Career XP for this type of restoration has already been collected.'}</p><div class="actions"><button class="btn" id="projectNo">Keep planning</button><button class="btn primary" id="projectYes" ${this.game.cash < offer.cost ? 'disabled' : ''}>Build · ${fmtMoney(offer.cost)}</button></div>`);
    (m.querySelector('#projectNo') as HTMLElement).onclick = () => this.closeModal();
    (m.querySelector('#projectYes') as HTMLElement).onclick = () => {
      if (!commissionProject(this.game, id)) this.toast('This project is not available at the current budget.', 'bad');
      this.closeModal(); this.refresh(true);
    };
  }
  private settingsModal() {
    const prefs = this.game.preferences;
    const m = this.modal(`<h2>Sound and day reports</h2><div class="preference-list">${([['music','Music','A relaxed tune while you build.'],['sound','Sound effects','Swing, build and reward sounds.'],['haptics','Touch feedback','Short vibration on touch devices.'],['dailyReports','End-of-day reports','Pause at closing time to show the day’s figures.']] as const).map(([id,title,detail]) => `<label><span><b>${title}</b><small>${detail}</small></span><input type="checkbox" data-pref="${id}" ${prefs[id] ? 'checked' : ''}/></label>`).join('')}</div><p class="dim">Career: ${CAREER[careerLevel(this.game)].title} · ${this.game.experience.xp} XP</p><div class="actions"><button class="btn primary" id="settingsDone">Done</button></div>`);
    m.querySelectorAll<HTMLInputElement>('[data-pref]').forEach(input => { input.onchange = () => { (this.game.preferences as unknown as Record<string, boolean>)[input.dataset.pref!] = input.checked; this.game.dirtySave = true; }; });
    (m.querySelector('#settingsDone') as HTMLElement).onclick = () => this.closeModal();
  }
  private recapShowing = false;
  private showRecap() {
    const g = this.game, d = g.pendingRecap; if (!d) return;
    this.recapShowing = true;
    const history = g.days.slice(-7), max = Math.max(1, ...history.map(d => Math.abs(d.profit)));
    const suggestion = nextSuggestion(g);
    const m = this.modal(`<div class="day-report"><span class="eyebrow">Day ${d.day}</span><h2>Day report</h2><div class="report-profit ${d.profit < 0 ? 'loss' : ''}"><span>${d.profit >= 0 ? '+' : ''}${fmtMoney(d.profit)}</span><small>Operating profit</small></div><div class="report-kpis"><div><b>${d.rounds}</b><small>Rounds</small></div><div><b>${d.rounds ? Math.round(d.avgSat) + '%' : '—'}</b><small>Golfer satisfaction</small></div><div><b>${g.members.length}</b><small>Members</small></div></div><div class="ledger-rows"><div><span>Green fees and shop sales</span><b>${fmtMoney(d.fees + d.shop)}</b></div><div><span>Maintenance and wages</span><b>−${fmtMoney(d.maintenance)}</b></div><div><span>Construction (not in profit)</span><b>${fmtMoney(d.construction)}</b></div></div><div class="report-chart" aria-label="Recent daily operating profit">${history.map(x => `<div title="Day ${x.day}: ${fmtMoney(x.profit)}"><i class="${x.profit < 0 ? 'negative' : ''}" style="height:${Math.max(5, Math.abs(x.profit) / max * 60)}px"></i><small>${x.day}</small></div>`).join('')}</div><div class="report-next"><span class="eyebrow">NEXT ON YOUR COURSE</span><b>${suggestion.title}</b><small>${suggestion.description}</small></div><div class="report-actions"><button class="btn" id="recapPlan">Plan improvements</button><button class="btn primary" id="recapContinue">Start day ${g.day} →</button></div></div>`, () => { finish(); this.refresh(true); });
    const finish = () => { g.pendingRecap = null; this.recapShowing = false; g.dirtySave = true; this.closeModal(); };
    (m.querySelector('#recapContinue') as HTMLElement).onclick = () => { finish(); this.refresh(true); };
    (m.querySelector('#recapPlan') as HTMLElement).onclick = () => {
      // planning holds the clock (the chip offers Resume) and opens Goals, where the next job has a Show me button
      finish(); g.pause(); this.designPause = true; this.tab = 'journey'; this.sheet = 'half'; this.cache.delete('side'); this.refresh(true); this.onInsets();
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
    const m = this.modal(`<h2>Repair this green?</h2><p>Reseed ${plan.tiles.length} worn tiles for ${fmtMoney(plan.cost)}. The hole stays open while the work is done.</p><div class="actions"><button class="btn" id="repairNo">Cancel</button><button class="btn primary" id="repairYes">Repair · ${fmtMoney(plan.cost)}</button></div>`);
    (m.querySelector('#repairNo') as HTMLElement).onclick = () => this.closeModal();
    (m.querySelector('#repairYes') as HTMLElement).onclick = () => { this.game.commitEdit(plan); this.closeModal(); this.refresh(true); };
  }

  confirmReset(another = false) {
    const m = this.modal(another
      ? `<h2>Start a new course?</h2><p>You choose a region and begin again with untouched land. This course, its cash and its goals are replaced and cannot be brought back unless you exported a backup. Regions you have completed stay marked.</p><div class="actions"><button class="btn" id="rsCancel">Keep playing</button><button class="btn danger" id="rsOk">Start a new course</button></div>`
      : `<h2>Reset the game?</h2><p>This deletes your saved course, cash, upgrades and goals and starts a brand new game. It cannot be undone.</p><div class="actions"><button class="btn" id="rsCancel">Keep playing</button><button class="btn danger" id="rsOk">Reset and start over</button></div>`);
    (m.querySelector('#rsCancel') as HTMLElement).onclick = () => this.closeModal();
    (m.querySelector('#rsOk') as HTMLElement).onclick = () => {
      this.closeModal();
      this.onReset();
    };
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    // During the tutorial the coach already says what happened; only problems get through.
    if (this.mobile && kind !== 'bad' && document.body.classList.contains('coaching')) return;
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    const box = this.$('toasts');
    box.appendChild(t);
    while (box.children.length > 1) box.firstChild!.remove();
    window.setTimeout(() => UI.fadeOut(t), kind === 'bad' ? 6000 : 4500);
    if (kind === 'bad' && /need|cash/i.test(text)) {
      const c = this.$('cash');
      c.classList.remove('flash');
      void c.offsetWidth;
      c.classList.add('flash');
    }
  }

  static reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Remove an element after a short fade, so nothing just vanishes. */
  static fadeOut(el: HTMLElement) {
    if (UI.reduced || !el.isConnected) { el.remove(); return; }
    el.classList.add('out');
    window.setTimeout(() => el.remove(), 200);
  }
  private sideKey = '';
  /** Expandable panel sections the player has opened, kept open across refreshes. */
  // ---- the first paying round: a short, non-blocking result card ----
  private roundCard: HTMLElement | null = null;
  private roundCardT = 0;
  private buildRoundCard() {
    const el = document.createElement('div');
    el.id = 'roundcard';
    el.hidden = true;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.getElementById('app')!.append(el);
    this.roundCard = el;
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-rc]');
      if (!b) return;
      const step = nextStep(this.game.world.holes);
      this.markRoundSeen(); // answering the card means it has been seen
      this.hideRoundCard();
      if (b.dataset.rc !== 'go') return;
      if (step.id === 'secondHole') { this.editor.setTool('build'); this.tab = 'build'; }
      else if (step.id === 'openHole') { if (step.holeId) this.editor.selectHole(step.holeId); this.tab = 'course'; }
      else this.tab = 'guests';
      this.refresh(true);
      this.onInsets();
    });
  }
  private roundCardAt = 0;
  private markRoundSeen() {
    const fr = this.game.firstRound;
    if (fr.shown) return;
    fr.shown = true; // from here on a reload never shows it again
    this.game.dirtySave = true;
  }
  private hideRoundCard() {
    window.clearTimeout(this.roundCardT);
    if (this.roundCard) this.roundCard.hidden = true;
    document.body.classList.remove('has-roundcard');
  }
  /** A snapshot of what else has the player's attention, for the moment queue. */
  private momentState(): MomentState {
    const e = this.editor, g = this.game, fr = g.firstRound;
    const open: MomentKind | null = this.roundCard && !this.roundCard.hidden ? 'round' : document.getElementById('goalpop') ? 'goal' : this.recapShowing && this.modalOpen ? 'recap' : null;
    return {
      open,
      pending: { round: fr.done && !fr.shown && !!fr.result, goal: !!g.goalJustDone || g.cheers.length > 0, recap: !!g.pendingRecap },
      blocked: document.body.classList.contains('coaching') || this.menuOpen || (this.modalOpen && open !== 'recap') || this.introOpen || g.owner.active,
      calm: !e.proposal && !e.isPlacement && !e.drag && !e.placingClub && !e.bGhost,
      panelOpen: this.tab !== 'none' && this.tab !== 'build', // the build tray sits below the map; the cards ride above it
    };
  }
  /** Run once a tick: let at most one waiting moment appear, and step the first-round card aside if something else needs the player. */
  private runMoments() {
    const el = this.roundCard, fr = this.game.firstRound;
    const s = this.momentState();
    if (el && !el.hidden) {
      // The card steps aside for a dialog, an edit or a panel. One that was not on screen long enough to be read stays queued.
      if (s.blocked || !s.calm || s.panelOpen) { this.hideRoundCard(); return; }
      if (!fr.shown && performance.now() - this.roundCardAt >= 1500) this.markRoundSeen();
      return;
    }
    const m = nextMoment(s);
    if (m === 'goal') this.showGoalMoment();
    else if (m === 'recap') this.showRecap();
    else if (m === 'round') this.showRoundCard();
  }
  private showRoundCard() {
    const el = this.roundCard, fr = this.game.firstRound;
    if (!el || !fr.result) return;
    const r = fr.result, over = r.strokes - r.par, step = nextStep(this.game.world.holes);
    el.innerHTML = `<div class="rc-head"><span class="rc-k">First round complete</span><button class="rc-x" data-rc="x" aria-label="Dismiss">&times;</button></div>
      <div class="rc-name">${escapeHtml(r.name)} finished</div>
      <div class="rc-score"><b>${scoreText(over)}</b> <span>over ${r.holes} hole${r.holes === 1 ? '' : 's'} · ${r.strokes} strokes</span></div>
      <div class="rc-fee">Green fee ${fmtMoney(r.fee)} <span>already collected</span></div>
      <p class="rc-say">${escapeHtml(r.reaction)}</p>
      <div class="rc-actions"><button class="btn primary" data-rc="go">${escapeHtml(step.label)}</button><button class="btn" data-rc="x">Not now</button></div>`;
    el.hidden = false;
    document.body.classList.add('has-roundcard');
    this.roundCardAt = performance.now();
    this.game.onFeedback('reward');
    window.clearTimeout(this.roundCardT);
    this.roundCardT = window.setTimeout(() => this.hideRoundCard(), 30000);
  }
  private openSecs = new Set<string>();
  private sideAt = 0;
  /** Which control inside the panel has focus, described by what it is rather than where it sits, so it can be found again after a rebuild. */
  private focusKey(body: HTMLElement): { sel: string; n: number; caret: [number, number] | null } | null {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === body || !body.contains(a)) return null;
    const d = a.dataset;
    const sel = a.id ? `#${CSS.escape(a.id)}` : a.matches('summary') ? `details[data-sec="${a.parentElement?.getAttribute('data-sec')}"] > summary` : d.act ? `${a.tagName.toLowerCase()}[data-act="${d.act}"]${d.id ? `[data-id="${d.id}"]` : ''}` : d.hole ? `[data-hole="${d.hole}"]` : '';
    if (!sel) return null;
    const same = [...body.querySelectorAll(sel)];
    const input = a as HTMLInputElement;
    return { sel, n: Math.max(0, same.indexOf(a)), caret: typeof input.selectionStart === 'number' ? [input.selectionStart, input.selectionEnd ?? input.selectionStart] : null };
  }
  private restoreFocus(body: HTMLElement, f: { sel: string; n: number; caret: [number, number] | null } | null) {
    if (!f) return;
    const el = body.querySelectorAll<HTMLElement>(f.sel)[f.n] ?? body.querySelector<HTMLElement>(f.sel);
    if (!el) return;
    el.focus({ preventScroll: true });
    const input = el as HTMLInputElement;
    if (f.caret && typeof input.setSelectionRange === 'function') { try { input.setSelectionRange(f.caret[0], f.caret[1]); } catch { /* not a text field */ } }
  }
  /**
   * Show or hide a panel with a short slide and fade. The state changes at once (so nothing waits on the animation);
   * only the hiding is deferred, and showing again mid-way simply cancels it.
   */
  private reveal(el: HTMLElement, show: boolean) {
    const d = el as HTMLElement & { _hideT?: number };
    if (show) {
      if (d._hideT) { window.clearTimeout(d._hideT); d._hideT = 0; el.classList.remove('closing'); }
      if (el.style.display === 'none') el.style.display = '';
      return;
    }
    if (el.style.display === 'none' || d._hideT) return;
    if (UI.reduced || el.getClientRects().length === 0) { el.style.display = 'none'; return; }
    el.classList.add('closing');
    d._hideT = window.setTimeout(() => { d._hideT = 0; el.classList.remove('closing'); el.style.display = 'none'; this.layoutVars(); }, 190);
  }
  private menuT = 0;
  /** The menu window: opens at once, closes with a short fade (body.menu-closing keeps its layout while it goes). */
  private revealMenu(open: boolean) {
    const b = document.body;
    if (open) {
      if (this.menuT) { window.clearTimeout(this.menuT); this.menuT = 0; b.classList.remove('menu-closing'); }
      b.classList.add('menu-open');
      return;
    }
    if (!b.classList.contains('menu-open')) return;
    b.classList.remove('menu-open');
    if (UI.reduced) return;
    b.classList.add('menu-closing');
    this.menuT = window.setTimeout(() => { this.menuT = 0; b.classList.remove('menu-closing'); }, 180);
  }

  /** After a build: what happened, and one tap to take it back. */
  private builtToast(label: string, cost: number) {
    const box = this.$('toasts');
    box.querySelectorAll('.toast.undo').forEach((n) => n.remove());
    const t = document.createElement('div');
    t.className = 'toast good undo';
    const m = document.createElement('span');
    m.textContent = `Built ${label.replace(/^Build\s+/i, '')} · ${fmtMoney(cost)}`;
    const b = document.createElement('button');
    b.textContent = 'Undo';
    b.setAttribute('aria-label', 'Undo this build');
    b.onclick = () => { this.editor.undo(); t.remove(); this.refresh(true); };
    t.append(m, b);
    box.append(t);
    while (box.children.length > 1) box.firstChild!.remove();
    window.setTimeout(() => UI.fadeOut(t), 7000);
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
    {
      const xp = g.experience.xp, lv = playerLevel(xp), lo = levelXp(lv), hi = levelXp(lv + 1);
      set('lvlN', String(lv));
      (this.$('lvlBar') as HTMLElement).style.width = `${Math.round(((xp - lo) / Math.max(1, hi - lo)) * 100)}%`;
    }
    if (performance.now() - this.dayCheck > 2000) {
      this.dayCheck = performance.now();
      // The very first day's reward and challenges arrive quietly (a badge on the menu and on Goals): a brand-new course
      // has nobody to welcome back, and the player is busy opening for the first time.
      const firstEver = !g.daily.date;
      if (!g.practice && !document.body.classList.contains('coaching') && rollDay(g) && !firstEver) {
        g.cheer({ kind: 'streak', title: g.daily.streak > 1 ? `Day ${g.daily.streak} streak!` : 'Welcome back!', sub: 'Three new daily challenges are waiting in Goals.', reward: g.daily.pending });
      }
    }
    document.body.classList.toggle('practice', g.practice);
    const badge = g.practice ? 0 : claimable(g);
    if (this.cache.get('badge') !== String(badge)) {
      this.cache.set('badge', String(badge));
      this.$('fab').dataset.badge = badge ? String(badge) : '';
      this.$('goalbar').dataset.badge = badge ? String(badge) : '';
    }
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
    this.updateChip();
    this.$('speed').querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.speed) === g.speedShown));

    // tool buttons
    this.$('tools').querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tool === this.editor.tool));
    if (this.editor.tool === 'decor') this.traySet = isBuilding(this.editor.decorKind) ? 'buildings' : 'decor';
    else if (this.editor.tool !== 'inspect' && this.editor.tool !== 'pan') this.traySet = 'course';
    this.$('tools').dataset.set = this.traySet;
    {
      // Redo takes room in the tray only while there is something to redo; Undo greys out when there is nothing to take back.
      const redo = this.$('tools').querySelector<HTMLButtonElement>('.ph-redo')!, undo = this.$('tools').querySelector<HTMLButtonElement>('.ph-undo:not(.ph-redo)')!;
      redo.hidden = !!this.editor.proposal || !g.redoStack.length;
      undo.disabled = !this.editor.proposal && !g.undoStack.length;
    }
    {
      const ct = document.getElementById('cartTile');
      if (ct) ct.textContent = !g.upgrades.carts ? `$${CFG.upgrades.carts.cost}` : g.fleet >= g.maxFleet ? `${g.fleet}/${g.maxFleet} full` : `$${CART_PRICE} · ${g.fleet}/${g.maxFleet}`;
    }
    this.$('tools').querySelectorAll<HTMLElement>('[data-trayset]').forEach((b) => b.classList.toggle('on', b.dataset.trayset === this.traySet));
    this.$('tools').querySelectorAll<HTMLElement>('[data-decor]').forEach((b) => b.classList.toggle('on', this.editor.tool === 'decor' && b.dataset.decor === this.editor.decorKind));
    if (this.toolShown !== this.editor.tool) {
      this.toolShown = this.editor.tool;
      this.cat = CAT_OF[this.editor.tool] ?? this.cat;
    }
    this.$('tools').dataset.cat = this.cat;
    this.$('tools').querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.cat === this.cat));
    const bbar = this.$('brushbar');
    bbar.style.display = this.editor.isPaint && !this.game.owner.active && (!this.mobile || this.tab === 'build') ? '' : 'none';
    bbar.querySelectorAll('[data-brush]').forEach((b) => b.classList.toggle('on', Number((b as HTMLElement).dataset.brush) === this.editor.brush));
    this.$('side').querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.tab === this.tab));
    this.$('nav').querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.nav === this.tab));
    document.body.dataset.tab = this.tab;
    if (!this.mobile) this.menuOpen = false;
    this.revealMenu(this.menuOpen);
    this.$('nav').querySelectorAll<HTMLElement>('[data-mspeed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.mspeed) === g.speedShown));
    const fabState = this.tab === 'build' ? 'done' : this.menuOpen ? 'close' : 'menu';
    if (this.cache.get('fab') !== fabState) {
      this.cache.set('fab', fabState);
      const fab = this.$('fab');
      fab.dataset.state = fabState;
      fab.setAttribute('aria-label', fabState === 'done' ? 'Done building' : fabState === 'close' ? 'Close menu' : 'Menu');
      fab.innerHTML = fabState === 'done' ? `${icon('check')}<span>Done</span>` : fabState === 'close' ? icon('close') : icon('menu');
    }
    document.body.dataset.journalView = this.journalView;
    const titleHole = this.tab === 'course' ? g.world.holes.find((x) => x.id === g.selectedHole) : null;
    this.$('sheetTitle').textContent = titleHole ? titleHole.name : this.tab === 'none' ? '' : TAB_LABEL[this.tab] ?? this.tab;
    const sideOpen = this.tab !== 'none' && this.tab !== 'build';
    this.reveal(this.$('side'), sideOpen);
    if (sideOpen) this.applySheet();
    this.layoutVars();
    const sh = this.tab === 'course' ? g.world.holes.find((x) => x.id === g.selectedHole) : null;
    this.$('sheetSub').textContent = sh ? `Hole ${sh.id} · ${sh.open ? 'Open' : g.validate(sh.id).ok ? 'Ready to open' : 'Closed'}` : '';
    document.body.dataset.sheet = sideOpen && this.portraitSheet ? this.sheet : '';
    this.reveal(this.$('tools'), !this.mobile || this.tab === 'build');
    this.updateConfirm();
    this.runMoments();
    (this.$('view') as HTMLElement).classList.toggle('pan', this.editor.tool === 'pan');

    this.renderPill();
    this.renderGoalBar();
    this.helpTips();
    if (this.busy && !force) return;
    if (this.panelTip && this.panelTip !== this.tab) this.panelTip = null;
    const ptip = this.panelTip && TAB_TIPS[this.panelTip] ? `<div class="ptip"><span aria-hidden="true"></span><p>${TAB_TIPS[this.panelTip]}</p><button data-act="tipok">Got it</button></div>` : '';
    const html = ptip + this.sideHtml();
    // While the simulation runs, the panel's figures change all the time: rebuild the panel at most twice a second unless the player just did something.
    const now = performance.now();
    if (!force && this.cache.get('side') !== html && now - this.sideAt < 500) return;
    if (force || this.cache.get('side') !== html) {
      this.sideAt = now;
      const body = this.$('sidebody');
      const top = body.scrollTop;
      // Remember what the player has expanded and what has focus, straight from the page as it is now, so a rebuild can put both back.
      body.querySelectorAll<HTMLDetailsElement>('details.xp').forEach((d) => { if (d.open) this.openSecs.add(d.dataset.sec!); else this.openSecs.delete(d.dataset.sec!); });
      const focus = this.focusKey(body);
      body.innerHTML = html;
      // Put the expanded sections back first: with them collapsed the panel is shorter, and restoring the scroll position into a shorter
      // panel clamps it, so the content would jump and a tap meant for one header would land on another.
      body.querySelectorAll<HTMLDetailsElement>('details.xp').forEach((d) => { if (this.openSecs.has(d.dataset.sec!)) d.open = true; });
      // a different panel (or a different hole) eases in; a refresh of the same one changes in place
      const key = `${this.tab}:${this.tab === 'course' ? g.selectedHole : ''}:${this.tab === 'journey' ? this.journalView : ''}`;
      if (key !== this.sideKey) { this.sideKey = key; body.scrollTop = 0; if (!UI.reduced) body.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.2,.7,.3,1)' }); }
      else body.scrollTop = top;
      this.cache.set('side', html);
      this.restoreFocus(body, focus);
      const cl = document.getElementById('clubLogo') as HTMLCanvasElement | null;
      if (cl) paintLogo(cl, g.logo);
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
      if (PAINT_TOOLS.includes(tool)) html += `<span class="dim">${matchMedia('(pointer: coarse)').matches ? 'Drag moves the map. Press and hold, then drag to paint. A tap paints one spot.' : 'Drag to paint. Right-drag or Space-drag moves the map.'} Nothing is charged until you tap Build.</span>`;
    }
    const key = cls + html;
    if (this.cache.get('pill') !== key) {
      this.cache.set('pill', key);
      pill.className = cls;
      pill.innerHTML = html;
    }
  }

  /** Holes that were built or closed by building work and have not been opened since, and which of them could open now. */
  private closedHoles() {
    const g = this.game;
    const waiting = g.world.holes.filter((h) => !h.open && h.awaiting);
    return { waiting, ready: waiting.filter((h) => g.validate(h.id).ok) };
  }
  /** Time is running but nobody can play: say so, since nothing else on screen does. */
  private warnNoHoles() {
    const g = this.game;
    if (g.businessRunning && g.world.holes.length && !g.openHoles.length) this.toast('No holes are open, so no golfers will come. Open a hole first.', 'bad');
  }
  /** Time is held because the player was designing (not because they pressed Pause). */
  private designPause = false;
  private renderGoalBar() {
    const g = this.game;
    const goal = currentGoal(g);
    const { waiting, ready } = this.closedHoles();
    const what = waiting.length === 1 ? `Hole ${waiting[0]?.id} is closed` : `${waiting.length} holes are closed`;
    // Leaving Design keeps time paused on purpose. Once the tools are down, say so where the eye is, with the button that restarts it.
    // (A pause the player chose with the Pause button is theirs: the bar stays on the next job.)
    if (g.timeHold !== 'paused') this.designPause = false;
    const held = g.settings.open && (g.timeHold === 'design' || (g.timeHold === 'paused' && this.designPause));
    const html = waiting.length && !g.practice
      ? `<div class="k closed"><span>Closed</span></div><div class="gt">${what}</div><button class="btn primary gb-act" data-gb="${ready.length ? 'open' : 'why'}">${ready.length ? (ready.length > 1 ? `Open ${ready.length}` : 'Open it') : 'See why'}</button>`
      : held ? `<div class="k held"><span>Paused</span></div><div class="gt">Time is paused</div><button class="btn primary gb-act" data-gb="resume">Resume</button>`
      : goal
      ? `<div class="k">${flagMark()}<span>Next goal</span></div><div class="gt">${goal.title}</div><div class="p"><i class="box"></i>${goalProgressText(goal, g)}</div>`
      : `<div class="k">${flagMark()}<span>All done</span></div><div class="gt">Build freely</div>`;
    if (this.cache.get('goalbar') !== html) {
      this.cache.set('goalbar', html);
      this.$('goalbar').innerHTML = html;
      this.$('goalbar').classList.toggle('alert', html.includes('gb-act'));
    }
  }
  /** Goal and reward pop-ups: shown by the moment queue (see moments.ts), one at a time. */
  private showGoalMoment() {
    const g = this.game;
    const done = g.goalJustDone;
    if (done) {
      g.goalJustDone = null;
      this.celebrate({ kicker: 'Goal complete', title: done.title, reward: done.reward, sub: done.next ? `Next: ${done.next}` : 'Every goal is done. The course is yours to build freely.', showNext: !!done.next });
      return;
    }
    const c = g.cheers.shift();
    if (c) this.celebrate(this.cheerCard(c));
  }
  private cheerCard(c: Cheer): { kicker: string; title: string; reward?: number; sub: string; collect?: boolean } {
    if (c.kind === 'streak') return { kicker: 'Daily reward', title: c.title, reward: c.reward, sub: c.sub, collect: true };
    if (c.kind === 'level') return { kicker: 'Level up', title: c.title, reward: c.reward, sub: c.sub };
    if (c.kind === 'ace') return { kicker: 'Amazing', title: c.title, reward: c.reward, sub: c.sub };
    return { kicker: 'Daily challenges', title: c.title, reward: c.reward, sub: c.sub };
  }
  /** First-time help: one short tip the first time each tool or panel is used. */
  private tipKey = '';
  /** The panel whose first-time help card is showing at the top of the panel. */
  private panelTip: string | null = null;
  private helpTips() {
    const g = this.game;
    if (document.body.classList.contains('coaching') || this.modalOpen) return;
    const tool = this.editor.tool;
    let key = '', title = '', text = '';
    if (this.tab === 'build' && tool !== 'inspect' && tool !== 'pan') {
      if (tool === 'decor') { const k = this.editor.decorKind; key = `decor:${k}`; title = ITEMS[k].label; text = `${ITEMS[k].hint} Costs ${fmtMoney(ITEMS[k].cost)}.${isBuilding(k) ? '' : ' Pretty things near tees and greens make golfers happier.'}`; }
      else { key = `tool:${tool}`; title = TOOL_INFO[tool].label; text = TOOL_TIPS[tool] ?? TOOL_INFO[tool].hint; }
    } else if (this.tab !== 'none' && this.tab !== 'build' && TAB_TIPS[this.tab]) {
      // panel help sits inside the panel (see sideHtml), never over it
      const pk = `tab:${this.tab}`;
      const seen = (g.preferences.tipsSeen ??= []);
      if (!seen.includes(pk)) { seen.push(pk); g.dirtySave = true; this.panelTip = this.tab; this.cache.delete('side'); }
    }
    if (!key) { if (this.tipKey && this.tab !== 'build') { document.getElementById('tip')?.remove(); this.tipKey = ''; } return; }
    if (!key || key === this.tipKey) return;
    this.tipKey = key;
    const seen = (g.preferences.tipsSeen ??= []);
    if (seen.includes(key)) return;
    seen.push(key);
    g.dirtySave = true;
    document.getElementById('tip')?.remove();
    const tip = document.createElement('div');
    tip.id = 'tip';
    tip.setAttribute('role', 'status');
    tip.innerHTML = `<span class="tip-i" aria-hidden="true"></span><div><b>${escapeHtml(title)}</b><p>${escapeHtml(text)}</p></div><button aria-label="Got it">Got it</button>`;
    const close = () => { tip.classList.add('out'); window.setTimeout(() => tip.remove(), 300); };
    tip.querySelector('button')!.addEventListener('click', close);
    document.getElementById('app')!.append(tip);
    window.setTimeout(close, 9000);
  }
  /** "Show me" on a goal: open the right place, pick up the right tool, and point at the control to use. */
  showGoal(id: string) {
    const goal = CHAIN.find((c) => c.id === id);
    if (!goal) return;
    this.menuOpen = false;
    if (goal.tool) {
      this.tab = 'build';
      this.editor.setTool(goal.tool);
    } else if (goal.go) this.tab = goal.go === 'money' ? 'money' : goal.go === 'guests' ? 'guests' : goal.go === 'events' ? 'events' : goal.go === 'club' ? 'club' : goal.go === 'course' ? 'course' : 'none';
    else this.tab = 'none';
    if (goal.guide?.startsWith('#nav')) { this.tab = 'none'; this.menuOpen = true; }
    if (this.portraitSheet && this.tab !== 'none' && this.tab !== 'build') this.sheet = 'half';
    this.cache.delete('side');
    this.refresh(true);
    this.onInsets();
    const sel = goal.tool ? `#tools .ph-tools [data-tool="${goal.tool}"]` : goal.guide;
    if (sel) window.setTimeout(() => this.pointTo(sel), 380);
  }
  /** A pulsing ring on one control for a few seconds, scrolled into view if it sits in a panel. */
  private pointTo(sel: string) {
    const el = [...document.querySelectorAll<HTMLElement>(sel)].find((x) => x.getClientRects().length > 0);
    if (!el) return;
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    document.querySelectorAll('.guide-ring').forEach((x) => x.classList.remove('guide-ring'));
    el.classList.add('guide-ring');
    const clear = () => el.classList.remove('guide-ring');
    el.addEventListener('click', clear, { once: true });
    window.setTimeout(clear, 6000);
  }
  private celebrate(card: { kicker: string; title: string; reward?: number; sub: string; showNext?: boolean; collect?: boolean }) {
    document.getElementById('goalpop')?.remove();
    const pop = document.createElement('div');
    pop.id = 'goalpop';
    pop.setAttribute('role', 'status');
    const reward = card.reward ? `<div class="gp-r">+${fmtMoney(card.reward)}</div>` : '';
    const next = currentGoal(this.game);
    const btn = card.collect ? '<button class="gp-go" data-gp="collect">Collect</button>' : card.showNext && next && (next.go || next.guide) ? '<button class="gp-go" data-gp="show">Show me</button>' : '';
    pop.innerHTML = `<div class="gp-k">${escapeHtml(card.kicker)}</div><div class="gp-t">${escapeHtml(card.title)}</div>${reward}<div class="gp-n">${escapeHtml(card.sub)}</div>${btn}`;
    const close = () => { pop.classList.add('out'); window.setTimeout(() => pop.remove(), 400); };
    pop.onclick = (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-gp]')?.dataset.gp;
      if (act === 'collect') { const n = this.game.claimStreak(); if (n) this.coinBurst(e.target as HTMLElement, n); }
      if (act === 'show') { const g2 = currentGoal(this.game); if (g2) this.showGoal(g2.id); }
      close();
      this.refresh(true);
    };
    document.getElementById('app')!.append(pop);
    this.confetti(card.kicker === 'Level up' || card.kicker === 'Amazing' ? 60 : 36);
    // everything steps aside on its own; a reward not collected here waits in Goals (with a badge)
    window.setTimeout(close, card.collect ? 9000 : 6200);
  }
  /** A burst of paper confetti from the top of the screen. */
  confetti(n = 40) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = document.createElement('div');
    box.className = 'confetti';
    const colors = ['#ffd25e', '#4d8a3a', '#cf5b3c', '#4f7fb0', '#8a6bb0', '#fff8e7'];
    for (let i = 0; i < n; i++) {
      const b = document.createElement('i');
      b.style.left = `${Math.random() * 100}%`;
      b.style.background = colors[i % colors.length];
      b.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
      b.style.setProperty('--rot', `${(Math.random() - 0.5) * 1080}deg`);
      b.style.animationDelay = `${Math.random() * 0.25}s`;
      b.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
      box.append(b);
    }
    document.getElementById('app')!.append(box);
    window.setTimeout(() => box.remove(), 3200);
  }
  /** Coins flying from a button up to the money in the corner. */
  coinBurst(from: HTMLElement, amount: number) {
    const app = document.getElementById('app')!.getBoundingClientRect();
    const a = from.getBoundingClientRect();
    const t = this.$('cash').getBoundingClientRect();
    for (let i = 0; i < 9; i++) {
      const c = document.createElement('i');
      c.className = 'flycoin';
      c.style.left = `${a.left - app.left + a.width / 2 + (Math.random() - 0.5) * 30}px`;
      c.style.top = `${a.top - app.top + a.height / 2 + (Math.random() - 0.5) * 16}px`;
      c.style.setProperty('--tx', `${t.left - a.left - a.width / 2 + 10}px`);
      c.style.setProperty('--ty', `${t.top - a.top - a.height / 2 + 8}px`);
      c.style.animationDelay = `${i * 0.05}s`;
      document.getElementById('app')!.append(c);
      window.setTimeout(() => c.remove(), 1400);
    }
    const cash = this.$('cash');
    window.setTimeout(() => { cash.classList.remove('bump'); void cash.offsetWidth; cash.classList.add('bump'); }, 650);
    this.toast(`+${fmtMoney(amount)}`, 'good');
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

  /** One-line state of a hole for lists and the hole bar. */
  holeState(h: Hole): { cls: 'open' | 'ready' | 'blocked'; text: string } {
    if (h.open) return { cls: 'open', text: 'Open' };
    const v = this.game.validate(h.id);
    return v.ok ? { cls: 'ready', text: 'Ready to open' } : { cls: 'blocked', text: `${v.problems.length} problem${v.problems.length === 1 ? '' : 's'}` };
  }

  private courseHtml(): string {
    const g = this.game;
    const w = g.world;
    const h = g.hole(g.selectedHole);
    if (!h) {
      return `<div class="course-heading"><div class="row"><span><span class="eyebrow">${escapeHtml(g.name)}</span><h2>No holes</h2></span><button class="btn primary" data-act="newhole" ${g.addHoleProblem() ? 'disabled' : ''}>+ New hole</button></div><p class="dim course-sum">${w.clubhouse ? 'Use New hole to place a tee and a green. Golfers arrive once a hole is open.' : 'Place the clubhouse first.'}</p></div>`;
    }
    const cond = holeCondition(w, h);
    const v = g.validate(h.id);
    const yards = holeYards(h);
    const queued = g.sim.queueFor(h.id).length;
    const playing = g.sim.onHole(h.id);
    const st = h.stats;
    const repair = this.greenPlan();
    // what golfers actually putt on: the green within a step or two of the cup, which wears far faster than the green as a whole
    let cupSum = 0, cupN = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = h.cup.x + dx, y = h.cup.y + dy;
        if (Math.hypot(dx, dy) > CFG.wear.cupRadius || x < 0 || y < 0 || x >= w.w || y >= w.h || w.terrain[idx(w, x, y)] !== 2) continue;
        cupSum += w.cond[idx(w, x, y)]; cupN++;
      }
    const cupCond = cupN ? cupSum / cupN : cond.green;
    const cupWorn = cupCond < CFG.turf.wornBelow && repair.tiles.length > 0;
    const totalPar = w.holes.reduce((a, x) => a + x.par, 0);
    const totalYards = w.holes.reduce((a, x) => a + holeYards(x), 0);
    const dogleg = holeBends(h).length > 0 || Math.abs((h.cup.x - h.tee.x) * (h.tee.y - h.bend.y) - (h.tee.x - h.bend.x) * (h.cup.y - h.tee.y)) / (Math.hypot(h.cup.x - h.tee.x, h.cup.y - h.tee.y) || 1) > 1.5;
    const nHoles = w.holes.length;
    // A collapsible section: closed by default, remembered once opened (see openSecs).
    const xp = (sec: string, title: string, note: string, body: string) =>
      `<details class="xp" data-sec="${sec}"><summary><span class="xp-t">${title}</span>${note ? `<span class="xp-n">${note}</span>` : ''}</summary><div class="xp-body">${body}</div></details>`;
    // What the next action needs, and nothing else: name, par and length, whether it can open, and the button.
    const hs = this.holeState(h);
    let html = `<div class="card hole-detail hole-summary"><div class="row"><span class="t big-name">${escapeHtml(h.name)}</span><span class="hole-state ${hs.cls}">${hs.text}</span></div>
      <div class="hole-line"><b>Par ${h.par}</b><span>·</span><b>${yards} yd</b><span>·</span><span>${dogleg ? 'Dogleg' : 'Straight'}</span>${h.open ? `<span>·</span><span>${playing} playing, ${queued} waiting</span>` : ''}</div>`;
    if (!h.open && !v.ok) {
      html += `<div class="why-closed"><b>This hole cannot open yet</b>${v.issues.map((it, i) => `<div class="issue"><p>${it.text}</p><div class="btnrow">${it.at ? `<button class="btn sm" data-act="issue" data-i="${i}" data-mode="show">Show on map</button>` : ''}${it.fix ? `<button class="btn sm" data-act="issue" data-i="${i}" data-mode="fix">Fix with ${TOOL_INFO[it.fix].label}</button>` : ''}</div></div>`).join('')}</div>`;
    }
    if (cupWorn) html += `<div class="note warn">The green is worn around the cup (${Math.round(cupCond)} out of 100). Golfers judge the turf by where they putt.</div><div class="btnrow"><button class="btn" data-act="repairgreen" ${repair.cost > g.cash ? 'disabled' : ''}>Repair green · ${fmtMoney(repair.cost)}</button></div>`;
    html += h.open
      ? `<div class="btnrow hole-actions"><button class="btn primary" data-act="testgolfers">Test golfers</button><button class="btn" data-act="practice">Play it</button><button class="btn" data-act="close" data-id="${h.id}">Close hole</button></div>`
      : `<div class="btnrow hole-actions"><button class="btn primary big wide" data-act="open" data-id="${h.id}" ${v.ok ? '' : 'disabled'}>Open hole</button></div>${v.ok ? `<p class="dim small">Opening it lets golfers play.${g.settings.open ? '' : ' Time stays paused until you open for business.'}</p>` : ''}`;
    html += `</div>`;
    if (v.warnings.length) html += xp('warn', 'Things to check', `${v.warnings.length}`, v.warnings.map((p) => `<div class="note warn">${p}</div>`).join(''));
    const icon = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    html += xp('edit', 'Edit hole', 'Par, tee, green, turns', `<div class="par-row"><span>Par</span>${[3, 4, 5].map((n) => `<button class="mini ${n === h.par ? 'on' : ''}" data-act="setpar" data-id="${n}">${n}</button>`).join('')}<small class="dim">${PAR_YARDS[h.par][0]} to ${PAR_YARDS[h.par][1]} yd suits a par ${h.par}</small></div>
      <p class="dim small">Pick an action, then tap the map. You see a preview and the price before anything is built.${h.open ? ' Editing its ground closes the hole while work is done.' : ''}</p><div class="edit-grid">
      <button class="edit-act" data-act="holetool" data-id="tee">${icon('<path d="M8 21l4-7 4 7"/><circle cx="12" cy="10" r="3"/>')}<span><b>Move tee</b><small>New tee box</small></span></button>
      <button class="edit-act" data-act="holetool" data-id="cup">${icon('<path d="M12 21V4l7 3-7 3"/><ellipse cx="12" cy="21" rx="5" ry="1.5"/>')}<span><b>Move cup</b><small>New green</small></span></button>
      <button class="edit-act" data-act="holetool" data-id="bend">${icon('<path d="M4 20L10 8l10-4"/>')}<span><b>Shape bends</b><small>Drag to move, tap to add</small></span></button>
      <button class="edit-act" data-act="straighten" ${holeBends(h).length ? '' : 'disabled'}>${icon('<path d="M4 20L20 4"/>')}<span><b>Straighten</b><small>Remove all turns</small></span></button>
      <button class="edit-act" data-act="rename">${icon('<path d="M4 20h4L19 9l-4-4L4 16z"/>')}<span><b>Rename</b><small>Change its name</small></span></button>
      <button class="edit-act danger" data-act="removehole" ${nHoles <= 1 ? 'disabled' : ''}>${icon('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>')}<span><b>Remove</b><small>Undo brings it back</small></span></button>
    </div>`);
    const tests = g.testResults.filter((r) => r.hole === h.id).slice(-4).reverse();
    const results = (tests.length ? `<div class="card"><div class="t">Test golfers</div>${tests.map((r) => `<div class="row"><span>${escapeHtml(r.name)} <span class="dim">${r.type}</span></span><b>${r.strokes} <span class="dim">(par ${r.par})</span></b></div>`).join('')}</div>` : '')
      + `<div class="card">${st.rounds ? `<div class="row"><span class="k">Rounds</span><span>${st.rounds}</span></div><div class="row"><span class="k">Average score</span><span>${(st.strokes / st.rounds).toFixed(1)} (par ${h.par})</span></div>${st.girN ? `<div class="row"><span class="k">Greens in regulation</span><span>${Math.round((st.gir / st.girN) * 100)}%</span></div>` : ''}${st.fwyN ? `<div class="row"><span class="k">Fairways hit</span><span>${Math.round((st.fwy / st.fwyN) * 100)}%</span></div>` : ''}<div class="row"><span class="k">Water balls</span><span>${st.water}</span></div><div class="row"><span class="k">Picked up</span><span>${st.picked}</span></div>` : '<div class="dim">No guest has finished this hole yet.</div>'}</div>`;
    html += xp('results', 'Scores', st.rounds ? `${st.rounds} rounds` : tests.length ? `${tests.length} test` : '', results);
    html += xp('design', 'Design report', g.designRating || h.open ? `${assessDesignScore(g, h)}/100` : '', designPanel(g, h).replace(/<h3>[^<]*<\/h3>/, ''));
    html += xp('turf', 'Turf and repairs', `${Math.round(Math.min(cond.fairway, cond.green, cond.tee, cupCond))} lowest`, `<div class="card"><div class="barrow"><span>Fairway</span>${bar(cond.fairway)}<span class="n">${Math.round(cond.fairway)}</span></div>
      <div class="barrow"><span>Green</span>${bar(cond.green)}<span class="n">${Math.round(cond.green)}</span></div>
      <div class="barrow"><span>Around the cup</span>${bar(cupCond)}<span class="n">${Math.round(cupCond)}</span></div>
      <div class="barrow"><span>Tee box</span>${bar(cond.tee)}<span class="n">${Math.round(cond.tee)}</span></div>
      <div class="dim">${Math.round(cond.wornShare * 100)}% of its turf is worn</div>${repair.tiles.length ? `<button class="btn" style="margin-top:10px" data-act="repairgreen" ${repair.cost > g.cash ? 'disabled' : ''}>Repair green · ${fmtMoney(repair.cost)}</button>` : ''}</div>`);
    const list = `<div class="course-heading"><div class="row"><span><span class="eyebrow">${escapeHtml(g.name)}</span><h2>${nHoles} hole${nHoles === 1 ? '' : 's'} · Par ${totalPar}</h2></span><button class="btn primary" data-act="newhole" ${g.addHoleProblem() ? 'disabled' : ''}>+ New hole</button></div><p class="dim course-sum">${g.openHoles.length} open · ${totalYards.toLocaleString('en-US')} yards · design ${g.designRating || '—'}/100</p>${g.addHoleProblem() ? `<p class="dim">${g.addHoleProblem()}</p>` : ''}</div><div class="hole-list">${w.holes.map((x) => {
      const xs = this.holeState(x);
      return `<button class="hole-card ${x.id === h.id ? 'on' : ''}" data-hole="${x.id}"><span class="hole-num">${x.id}</span><span class="hole-main"><b>${escapeHtml(x.name)}</b><small>Par ${x.par} · ${holeYards(x)} yd</small></span><span class="hole-state ${xs.cls}">${xs.text}</span></button>`;
    }).join('')}</div>`;
    html += xp('course', 'All holes', `${nHoles} · Par ${totalPar}`, list);
    const it = this.editor.inspectTile;
    if (it) {
      const i = idx(w, it.x, it.y);
      const t = w.terrain[i];
      html += xp('tile', `Tile ${it.x}, ${it.y}`, terrainLabel(t), `<div class="row"><span class="k">Ground</span><span>${terrainLabel(t)}${w.tree[i] ? ' with tree' : ''}</span></div>${t <= 3 ? `<div class="row"><span class="k">Condition</span><span>${Math.round(w.cond[i])}</span></div>${bar(w.cond[i])}` : ''}<div class="row"><span class="k">Belongs to</span><span>${w.zone[i] ? `Hole ${w.zone[i]}` : 'No hole'}</span></div>`);
    }
    if (g.ownerRecords.length) html += xp('cards', 'Your practice scorecards', `${g.ownerRecords.length}`, g.ownerRecords.slice(-4).reverse().map(r => `<div class="card"><div class="row"><b>Day ${r.day}</b><span>${r.scores.reduce((s,x) => s + x.strokes, 0)} strokes · par ${r.scores.reduce((s,x) => s + x.par, 0)}</span></div><div class="owner-scorecard">${r.scores.map(x => `<span>${x.hole}<b>${x.strokes}</b><small>par ${x.par}</small></span>`).join('')}</div></div>`).join(''));
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
      if (avg('cond') < 65) notes.push(`<div class="note ${avg('cond') < 45 ? 'bad' : 'warn'}">Turf: average lie condition is low${wornHoles.length ? `. The green on hole ${wornHoles.map((h) => h.id).join(', ')} is worn` : ''}. Use Repair in Design.</div>`);
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
    if (g.upgrades.carts) html += `<div class="card"><div class="row"><span class="t">Cart fleet</span><span><b>${g.fleet}</b> of ${g.maxFleet}</span></div><div class="dim">Rentals scale with the fleet; six carts cover a small course. ${g.maxFleet === 6 ? 'A cart barn lets you keep 16.' : ''}</div><div style="margin-top:6px"><button class="btn" data-act="buycart" ${g.fleet >= g.maxFleet || g.cash < CART_PRICE ? 'disabled' : ''}>Buy a cart ($${CART_PRICE})</button></div></div>`;
    if (g.upgrades.carts) html += `<div class="card"><div class="row"><span class="t">Cart rental price</span><span><button class="btn" data-act="cartfee" data-id="-1">−</button> <b>${fmtMoney(g.cartFee)}</b> <button class="btn" data-act="cartfee" data-id="1">+</button></span></div><div class="dim">About ${Math.round(cartRentalRate(g.cartFee) * 100)}% of golfers rent a cart at this price.</div></div>`;
    for (const id of UPGRADE_IDS) {
      const u = CFG.upgrades[id];
      if (isAmenity(id as ItemKind)) {
        // these are placed on the property: the button takes you to the Buildings tray with the item selected
        const standing = countOf(g.world, id as ItemKind) > 0;
        html += `<div class="card"><div class="row"><span class="t">${u.name}</span><span class="reward">${fmtMoney(u.cost)}</span></div><div class="dim">${u.blurb}</div><div style="margin-top:6px">${standing ? '<span class="badge open">BUILT</span>' : `<button class="btn" data-act="placeamenity" data-id="${id}" ${g.cash < u.cost ? 'disabled' : ''}>Place it${g.cash < u.cost ? ` (need ${fmtMoney(u.cost - g.cash)} more)` : ''}</button>`}</div></div>`;
        continue;
      }
      html += `<div class="card"><div class="row"><span class="t">${u.name}</span><span class="reward">${fmtMoney(u.cost)}</span></div><div class="dim">${u.blurb}</div><div style="margin-top:6px">${g.upgrades[id] ? '<span class="badge open">OWNED</span>' : `<button class="btn" data-act="buy" data-id="${id}" ${g.cash < u.cost ? 'disabled' : ''}>Buy${g.cash < u.cost ? ` (need ${fmtMoney(u.cost - g.cash)} more)` : ''}</button>`}</div></div>`;
    }
    // buildings are the other half of the same list: they are placed on the course, so the card leads to where that happens
    html += `<div class="card"><div class="row"><span class="t">Buildings</span><span class="dim">${g.world.items?.filter((it) => isBuilding(it.k)).length ?? 0} built</span></div><div class="dim">A halfway house, pro shop, grill room, cart barn and more stand on the course itself. Pick one, then tap where it goes.</div><div style="margin-top:6px"><button class="btn" data-act="gobuildings">Choose a building</button></div></div>`;
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
      <div class="row"><span class="k">Demand</span><span>+${Math.round((club.demand - 1) * 100)}%</span></div><div class="row"><span class="k">Clubhouse spending</span><span>+${Math.round((club.shop - 1) * 100)}%</span></div><div class="row"><span class="k">Fair price</span><span>+${fmtMoney(club.fair)}</span></div><div class="row"><span class="k">Max holes</span><span>${g.maxHoles}</span></div>`;
    html += next ? `<div class="note ${why ? 'warn' : 'good'}">Next: ${next.name}. ${why ?? 'Requirements met.'}</div><button class="btn primary" data-act="club" ${why || g.cash < next.cost ? 'disabled' : ''}>Upgrade for ${fmtMoney(next.cost)}</button>` : '<div class="note good">Fully upgraded.</div>';
    html += `</div></div>`;
    html += `<div class="sec"><h3>What raises your rating</h3><div class="dim">Open holes (${g.openHoles.length}), turf condition (${Math.round(g.avgCondition)}), guest satisfaction (${Math.round(g.reputation)}), improvements owned and the clubhouse level. Higher ratings lift demand and fees, and unlock bigger clubhouse upgrades and events.</div></div>`;
    html += `<div class="sec"><h3>${r.name}</h3><div class="dim">${r.perks.join(' · ')}</div><div class="note">${SEASON_NAMES2[nextSeason]} comes next: demand ${r.seasonDemand[nextSeason] >= 1.1 ? 'rises' : r.seasonDemand[nextSeason] <= 0.7 ? 'drops sharply' : 'is steady'}, turf wear ${r.seasonWear[nextSeason] > 1.1 ? 'is heavier' : 'is normal'}.</div></div>`;
    html += `<div class="sec"><h3>Staff</h3>`;
    html += staffPanel(g);
    html += `</div><div class="sec"><h3>Career</h3><div class="row"><span class="k">Rounds played</span><span>${g.stats.rounds.toLocaleString('en-US')}</span></div><div class="row"><span class="k">Lifetime revenue</span><span>${fmtMoney(g.stats.revenue)}</span></div><div class="row"><span class="k">Best day</span><span>${fmtMoney(g.stats.bestDayProfit)}</span></div><div class="row"><span class="k">Events hosted</span><span>${g.stats.events}</span></div><div class="row"><span class="k">Holes in one</span><span>${g.stats.aces}</span></div></div>`;
    return html;
  }
}

const SEASON_NAMES2 = ['Spring', 'Summer', 'Autumn', 'Winter'];
