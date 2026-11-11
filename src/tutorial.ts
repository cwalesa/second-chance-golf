import type { Game } from './game';
import type { Editor } from './input';
import type { Renderer } from './render';
import type { UI } from './ui';
import type { ToolId } from './editing';
import { T, Pt } from './terrain';
import { suggestFirstHole } from './wilderness';
import { REGIONS } from './progression';

/** Saved progress through Level 1's guided walkthrough. */
export interface TutorialState {
  step: number;
  done: boolean;
}
export const freshTutorial = (): TutorialState => ({ step: 0, done: false });

interface Ctx {
  g: Game;
  e: Editor;
  r: Renderer;
  ui: UI;
  /** Values remembered from earlier steps, so a step checks what the player did, not what was already true. */
  mark: Record<string, unknown>;
}
interface Step {
  id?: string;
  /** One short, actionable instruction. */
  short: (c: Ctx) => string;
  /** The longer explanation, shown only when the player taps More. */
  more?: (c: Ctx) => string;
  /** 'map' steps close management panels so the course is visible; 'sheet' steps keep the Holes sheet at half height. */
  view?: 'map' | 'sheet';
  /** What to point at; the first selector that is on screen gets the pulsing ring. */
  target?: (c: Ctx) => string[];
  check?: (c: Ctx) => boolean;
  enter?: (c: Ctx) => void;
  /** Steps without a check advance with a Next button. */
  nextLabel?: string;
  /** Steps that wait for the player to do something can still be waved through. */
  skippable?: boolean;
  /** Glowing suggestions on the map: where a tee and a green might go. */
  hint?: (c: Ctx) => { tee?: Pt; cup?: Pt } | null;
}

const hole = (c: Ctx, id: number) => c.g.world.holes.find((h) => h.id === id);
const newestHole = (c: Ctx) => c.g.world.holes.reduce((a, h) => (h.id > a.id ? h : a), c.g.world.holes[0]);
/** The hole the player built in this walkthrough: the newest one, worked out from the course so it survives a reload. */
const myId = (c: Ctx) => newestHole(c).id;
const groupOf: Partial<Record<ToolId, string>> = { fairway: 'terrain', green: 'terrain', rough: 'terrain', path: 'terrain', bunker: 'terrain', water: 'terrain', treeAdd: 'nature', treeDel: 'nature', repair: 'nature', tee: 'holes', cup: 'holes', bend: 'holes', build: 'holes' };

/** Point at a tool: open the Design tray, then its group, then the tool itself. */
const toolTarget = (c: Ctx, tool: ToolId) => {
  if (c.e.tool === tool) return c.e.proposal ? ['#cfOk'] : [];
  if (c.ui.mobile && c.ui.tab !== 'build') return ['#nav [data-nav="build"]', '#fab'];
  return [`#tools [data-tool="${tool}"]`, `#tools [data-cat="${groupOf[tool]}"]`, '#tools .cat.on'];
};
/** Point at a button in the Holes panel, opening the panel first on phones. */
const panelTarget = (c: Ctx, sel: string) => (c.ui.tab !== 'course' ? ['#nav [data-nav="course"]', '#side .tabs [data-tab="course"]', '#fab'] : [sel]);
/** Make sure the hole bar and Holes panel are on the hole the step is about. */
const holeTarget = (c: Ctx, id: number, then: string[]) => (c.g.selectedHole !== id ? ['#holebar [data-hb="next"]', `[data-hole="${id}"]`] : then);

const isLandscape = (c: Ctx) => c.ui.landscape;
const touchWords = (c: Ctx) => c.ui.mobile || matchMedia('(pointer: coarse)').matches;

/** The first hole the coach suggests, worked out once from the player's own clubhouse spot. */
const suggestion = (c: Ctx) => {
  if (!('hole' in c.mark)) c.mark.hole = suggestFirstHole(c.g.world);
  return c.mark.hole as { tee: Pt; cup: Pt } | null;
};
/** Glow the suggested tee, then the suggested green once the tee is down. */
const holeHint = (c: Ctx) => {
  const s = suggestion(c);
  if (!s || c.e.proposal) return null;
  return c.e.overlay.buildTee ? { cup: s.cup } : { tee: s.tee };
};
const clubReady = (c: Ctx) => !!c.g.world.clubhouse;

/** Untouched land in any region: the player picks the clubhouse spot, then builds one hole from nothing. */
const STEPS: Step[] = [
  {
    short: (c) => `Welcome to ${c.g.name}.`,
    more: (c) => `${REGIONS[c.g.region].blurb.split('.')[0]}. Nothing is built yet. Time is paused while you set up. You will place the clubhouse and build one hole. The gold ring shows where to tap.`,
    nextLabel: 'Start',
    view: 'map',
  },
  {
    short: (c) => (touchWords(c) ? 'Drag one finger to move the map, then pinch to zoom.' : 'Drag to move the map, then scroll to zoom.'),
    more: (c) => `Moving the map changes nothing. Meadows sit in the valleys; the ridges are forest.${isLandscape(c) ? '' : ' The + and − buttons zoom too.'}`,
    view: 'map',
    enter: (c) => { c.mark.x = c.r.cam.x; c.mark.y = c.r.cam.y; c.mark.z = c.r.cam.zoom; },
    check: (c) => clubReady(c) || (Math.hypot(c.r.cam.x - (c.mark.x as number), c.r.cam.y - (c.mark.y as number)) * c.r.cam.zoom > 60 && Math.abs(c.r.cam.zoom / (c.mark.z as number) - 1) > 0.06),
    skippable: true,
  },
  {
    id: 'clubhouse',
    short: (c) => {
      const s = c.e.clubSpot;
      if (!s) return `${touchWords(c) ? 'Tap' : 'Click'} the ground where the clubhouse should stand.`;
      if (s.problem) return s.problem;
      return c.e.clubLocked ? 'Tap Build here.' : `${touchWords(c) ? 'Tap' : 'Click'} to choose this spot.`;
    },
    more: () => 'Flat ground is best. Trees on the lot are cleared and an entrance road runs to the nearest edge, where golfers arrive. Suggest a spot picks one for you.',
    view: 'map',
    target: (c) => (c.e.clubSpot && !c.e.clubSpot.problem && c.e.clubLocked ? ['#clubOk'] : ['#clubSuggest']),
    check: (c) => clubReady(c),
  },
  {
    short: () => 'Clubhouse built.',
    more: () => 'Golfers arrive by the entrance road. The clubhouse is free; holes cost money.',
    view: 'map',
    enter: (c) => { const k = c.g.world.clubhouse; if (k) c.e.focusPoint({ x: k.x + 6, y: k.y + 2 }, 0.62); },
    nextLabel: 'Next',
  },
  {
    short: (c) => (c.ui.mobile ? (c.ui.menuOpen ? 'Tap Design to open the building tools.' : 'Tap the round menu button.') : 'The building tools are along the bottom of the screen.'),
    more: () => 'Tools come in three groups: Terrain, Nature and Holes.',
    view: 'map',
    target: (c) => (c.ui.mobile ? ['#nav [data-nav="build"]', '#fab'] : []),
    check: (c) => !c.ui.mobile || c.ui.tab === 'build',
    nextLabel: 'Next',
  },
  {
    short: (c) => (c.e.tool !== 'build' ? 'Tap Holes, then New hole.' : c.e.proposal ? 'Tap Build to lay out your hole.' : c.e.overlay.buildTee ? 'Tap where the green goes.' : 'Tap where the tee goes.'),
    more: (c) => `${suggestion(c) ? 'Tee here and Green here mark a short par 3; any spot works. ' : ''}The preview shows par and yardage. Fairway, tee and green are laid out and trees in the way are cleared. Nothing is built until you tap Build.`,
    view: 'map',
    enter: (c) => { c.mark.n = c.g.world.holes.length; const s = suggestion(c); if (s) c.e.focusPoints([s.tee, s.cup]); },
    target: (c) => toolTarget(c, 'build'),
    hint: holeHint,
    check: (c) => c.g.world.holes.length > (c.mark.n as number) && !c.e.proposal,
  },
  {
    short: () => 'Hole 1 built.',
    more: (c) => { const h = newestHole(c); return `${h.name} is a par ${h.par}. Move tee and Move cup adjust it; Undo refunds the cost. New holes start closed.`; },
    view: 'map',
    enter: (c) => { c.e.selectHole(myId(c)); c.e.focusHole(); },
    nextLabel: 'Next',
  },
  {
    short: (c) => (c.e.tool !== 'bunker' ? 'Tap Terrain, then Bunker.' : c.e.proposal ? 'Tap Build to dig the bunker.' : 'Hold and drag beside the green.'),
    more: () => 'Keep a fairway route open to the green or the hole cannot open. Optional.',
    view: 'map',
    enter: (c) => { c.mark.sand = sandNear(c); const h = hole(c, myId(c)); if (h) c.e.focusPoint(h.cup, 0.95); },
    target: (c) => toolTarget(c, 'bunker'),
    check: (c) => sandNear(c) >= (c.mark.sand as number) + 3 && !c.e.proposal,
    skippable: true,
  },
  {
    short: (c) => (c.ui.tab === 'course' ? 'Tap Open hole.' : 'Tap Course, then Open hole.'),
    more: () => "If it can't open, the panel says why and Show on map takes you there.",
    view: 'sheet',
    target: (c) => holeTarget(c, myId(c), panelTarget(c, '[data-act="open"]')),
    check: (c) => !!hole(c, myId(c))?.open,
  },
  {
    id: 'testgolfers',
    short: () => 'Tap Send test golfers.',
    more: () => 'A beginner, a regular and a skilled golfer play the hole for free. Scores appear in the Course panel.',
    view: 'sheet',
    target: (c) => holeTarget(c, myId(c), panelTarget(c, '[data-act="testgolfers"]')),
    check: (c) => c.g.sim.golfers.some((x) => x.test && x.route.includes(myId(c))) || c.g.testResults.some((r) => r.hole === myId(c)),
  },
  {
    short: (c) => (c.g.settings.speed < 3 ? `Tap ${c.ui.mobile && !isLandscape(c) ? '3×' : '8×'} to speed up time.` : 'Watch them finish the hole.'),
    more: () => 'II pauses and 1× is normal speed.',
    view: 'map',
    target: (c) => (c.g.settings.speed < 3 ? ['#speed [data-speed="8"]', '#speed [data-speed="3"]'] : []),
    check: (c) => c.g.testResults.some((r) => r.hole === myId(c)),
    skippable: true,
  },
  {
    short: (c) => (c.g.owner.active ? 'Tap Start swing, then tap again in the middle.' : c.ui.tab === 'course' ? 'Tap Play it.' : 'Tap Course, then Play it.'),
    more: () => 'Pick a club, then tap the map to aim. Stop the needle in the middle for clean contact. Optional.',
    view: 'sheet',
    target: (c) => (c.g.owner.active ? ['[data-owner="hit"]'] : holeTarget(c, myId(c), panelTarget(c, '[data-act="practice"]'))),
    check: (c) => c.g.owner.active && c.g.owner.strokes >= 1,
    skippable: true,
  },
  {
    short: () => 'Tap Finish when you are done.',
    target: (c) => (c.g.owner.active ? ['[data-owner="stop"]'] : []),
    check: (c) => !c.g.owner.active,
  },
  {
    short: () => 'Open the course.',
    more: () => 'Next: build up to nine holes. The Goals tab starts with opening three. Tap below to start the clock and let golfers in.',
    nextLabel: 'Start clock',
  },
];

function sandNear(c: Ctx) {
  const h = hole(c, myId(c));
  if (!h) return 0;
  const w = c.g.world;
  let n = 0;
  for (let y = h.cup.y - 8; y <= h.cup.y + 8; y++)
    for (let x = h.cup.x - 8; x <= h.cup.x + 8; x++) if (x >= 0 && y >= 0 && x < w.w && y < w.h && w.terrain[y * w.w + x] === T.BUNKER) n++;
  return n;
}

/** Level 1's coach: one short instruction at a time, docked beside the free map area, with a ring on the target. */
export class Tutorial {
  private card = document.createElement('div');
  private ctx: Ctx;
  private entered = -1;
  private ring: HTMLElement | null = null;
  private html = '';
  private collapsed = false;
  private more = false;
  /** While a confirm or placement bar is up, the coach shrinks to its instruction; ⋯ shows Back/More/Skip. */
  private toolsOpen = false;
  private slim = false;
  private doneFlash = 0;
  /** Highest step reached this session; Back reviews earlier steps without re-checking them. */
  private furthest = 0;

  constructor(private g: Game, e: Editor, r: Renderer, private ui: UI) {
    this.ctx = { g, e, r, ui, mark: {} };
    this.furthest = g.tutorial.step;
    this.card.id = 'coach';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-live', 'polite');
    document.getElementById('app')!.append(this.card);
    this.card.onclick = (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-coach]');
      if (!b) return;
      const act = b.dataset.coach;
      if (act === 'next') this.advance();
      else if (act === 'back') this.back();
      else if (act === 'more') this.more = !this.more;
      else if (act === 'fold') this.collapsed = !this.collapsed;
      else if (act === 'tools') this.toolsOpen = !this.toolsOpen;
      else if (act === 'skip') {
        if (confirm('Skip the tutorial? You can replay it from the Menu.')) this.finish();
      }
      this.update(true);
      this.ui.onInsets();
    };
    // Touches on the card never reach the course underneath.
    this.card.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    if (this.active && g.tutorial.step < TEST_GOLFER_STEP) {
      // Building steps run with the clock stopped so guests and closing time never interrupt them;
      // from the test-golfer step on, time has to run for the golfers to play.
      g.settings.introSeen = true;
      g.designMode = true;
      g.setSpeed(0);
    }
    window.addEventListener('resize', () => this.update(true));
  }

  get active() {
    return !this.g.tutorial.done;
  }
  private get reviewing() {
    return this.g.tutorial.step < this.furthest;
  }

  private advance() {
    this.g.tutorial.step++;
    this.furthest = Math.max(this.furthest, this.g.tutorial.step);
    this.more = false;
    this.g.dirtySave = true;
    if (this.g.tutorial.step >= STEPS.length) this.finish();
  }
  private back() {
    if (this.g.tutorial.step === 0) return;
    this.g.tutorial.step--;
    this.more = false;
    this.entered = -1;
  }
  private finish() {
    this.g.tutorial.done = true;
    this.g.dirtySave = true;
    this.clearRing();
    this.ctx.e.overlay.hint = null;
    this.card.hidden = true;
    document.body.classList.remove('coaching', 'coach-folded');
    // The walkthrough ran with the clock stopped; now the club opens its doors.
    if (this.g.designMode) this.g.toggleDesignMode();
    this.g.notify('good', 'Your club is open. Keep designing, and welcome your guests.');
    this.ui.onInsets();
  }

  /** Close panels the step doesn't use, and keep the Holes sheet usable when it is the lesson. */
  private arrange(step: Step) {
    const ui = this.ui;
    if (ui.tab !== 'none' && ui.tab !== 'build' && ui.tab !== 'course') { ui.tab = 'none'; ui.refresh(true); ui.onInsets(); }
    if (step.view === 'map' && ui.mobile && ui.tab === 'course') { ui.tab = 'none'; ui.refresh(true); ui.onInsets(); }
    if (step.view === 'sheet' && ui.tab === 'course' && ui.portraitSheet && ui.sheet !== 'half') ui.setSheet('half');
  }

  /** Called a few times a second from the main loop. */
  update(force = false): void {
    if (!this.active) {
      if (!this.card.hidden) { this.card.hidden = true; this.clearRing(); document.body.classList.remove('coaching'); }
      return;
    }
    document.body.classList.add('coaching');
    this.card.hidden = this.ui.modalOpen;
    const t = this.g.tutorial;
    const step = STEPS[t.step];
    if (!step) { this.finish(); return; }
    const entering = this.entered !== t.step;
    if (entering) {
      this.entered = t.step;
      this.collapsed = false;
      if (!this.reviewing) step.enter?.(this.ctx);
      this.arrange(step);
    }
    if (!entering && !this.reviewing && step.check && step.check(this.ctx)) {
      this.doneFlash = performance.now();
      this.advance();
      this.update(true);
      return;
    }
    const flash = performance.now() - this.doneFlash < 900;
    const manual = !step.check || this.reviewing;
    const moreText = step.more?.(this.ctx);
    const confirm = document.getElementById('confirm');
    this.slim = this.ui.mobile && !!confirm && confirm.style.display !== 'none';
    const showTools = !this.slim || this.toolsOpen;
    const html = `<div class="coach-row"><span class="coach-count">${flash ? '✓ ' : ''}${t.step + 1}/${STEPS.length}</span><p class="coach-short">${step.short(this.ctx)}</p>${manual ? `<button class="btn primary coach-next" data-coach="next">${this.reviewing ? 'Next' : step.nextLabel ?? 'Next'}</button>` : step.skippable ? '<button class="btn coach-next" data-coach="next">Skip step</button>' : ''}${this.slim && !this.collapsed ? `<button class="coach-dots" data-coach="tools" aria-label="${showTools ? 'Hide' : 'Show'} tutorial options" aria-expanded="${showTools}">⋯</button>` : ''}</div>${this.collapsed || !showTools ? '' : `${this.more && moreText ? `<p class="coach-more">${moreText}</p>` : ''}<div class="coach-tools"><button data-coach="back" ${t.step === 0 ? 'disabled' : ''} aria-label="Previous step">‹<span> Back</span></button>${moreText ? `<button data-coach="more" aria-expanded="${this.more}">${this.more ? 'Less' : 'More'}</button>` : ''}<button data-coach="skip">Skip</button><button data-coach="fold" aria-label="Collapse instructions">▾</button></div>`}${this.collapsed ? '<button class="coach-unfold" data-coach="fold" aria-label="Expand instructions">▴</button>' : ''}`;
    if (force || entering || html !== this.html) {
      const resized = this.html === '' || entering || force || this.card.classList.contains('collapsed') !== this.collapsed;
      this.html = html;
      this.card.innerHTML = html;
      this.card.classList.toggle('collapsed', this.collapsed);
      this.card.classList.toggle('flash', flash);
      if (resized) this.ui.onInsets();
    }
    this.dock();
    this.ctx.e.overlay.hint = step.hint?.(this.ctx) ?? null;
    this.pointAt(step.target?.(this.ctx) ?? []);
  }

  /** Sit just above whatever occupies the bottom of the screen: nav, tool tray, sheet or confirm bar. */
  private dock() {
    if (!this.ui.mobile) { this.card.style.bottom = ''; this.card.style.left = ''; this.card.style.width = ''; this.card.classList.remove('beside'); return; }
    const confirm = document.getElementById('confirm');
    const cr = confirm && confirm.style.display !== 'none' ? confirm.getBoundingClientRect() : null;
    const dock = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dock')) || 0;
    const sideW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--side-w')) || 0;
    // In landscape there is usually room beside the confirm bar; stacking would leave almost no map.
    const room = cr ? window.innerWidth - cr.right - 14 - sideW : 0;
    const beside = this.ui.landscape && !!cr && room >= 250;
    const bottom = beside ? `${Math.round(window.innerHeight - cr!.bottom)}px` : `${Math.round(dock + (cr ? cr.height + 8 : 0) + 8)}px`;
    const left = beside ? `${Math.round(cr!.right + 8)}px` : '';
    const width = beside ? `${Math.round(Math.min(room, 420))}px` : '';
    this.card.classList.toggle('beside', beside);
    if (this.card.style.bottom !== bottom || this.card.style.left !== left || this.card.style.width !== width) {
      this.card.style.bottom = bottom;
      this.card.style.left = left;
      this.card.style.width = width;
      this.ui.onInsets();
    }
  }

  private pointAt(selectors: string[]) {
    let el: HTMLElement | null = null;
    for (const s of selectors) {
      const found = [...document.querySelectorAll<HTMLElement>(s)].find((x) => x.getClientRects().length > 0 && x.getBoundingClientRect().width > 0 && getComputedStyle(x).visibility !== 'hidden');
      if (found) { el = found; break; }
    }
    if (el && el.closest('#side') && this.ui.portraitSheet && this.ui.sheet === 'peek') this.ui.setSheet('half');
    if (el) {
      // Keep the ring's target inside the panel's visible scroll area.
      const body = el.closest<HTMLElement>('#sidebody');
      if (body) {
        const er = el.getBoundingClientRect(), br = body.getBoundingClientRect();
        if (er.bottom > br.bottom - 8 || er.top < br.top + 8) body.scrollTop += er.top - br.top - br.height / 2 + er.height / 2;
      }
    }
    if (el === this.ring) return;
    this.clearRing();
    if (el) { el.classList.add('coach-target'); this.ring = el; }
  }
  private clearRing() {
    this.ring?.classList.remove('coach-target');
    this.ring = null;
  }
}

export const TUTORIAL_STEPS = STEPS.length;
/** Index of 'Send test golfers': from here on the clock must be allowed to run. */
const TEST_GOLFER_STEP = STEPS.findIndex((st) => st.id === 'testgolfers');
