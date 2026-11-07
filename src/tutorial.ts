import type { Game } from './game';
import type { Editor } from './input';
import type { Renderer } from './render';
import type { UI } from './ui';
import type { EditPlan, ToolId } from './editing';
import { T, Pt } from './terrain';

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
}

const NEW_HOLE_AREA = { x: 88, y: 46 };

const near = (c: Ctx, i: number, p: Pt, r: number) => Math.hypot((i % c.g.world.w) - p.x, Math.floor(i / c.g.world.w) - p.y) <= r;
const hole = (c: Ctx, id: number) => c.g.world.holes.find((h) => h.id === id);
/** Green tiles near hole 2's cup that a plan or staged batch would reseed. */
const greenRepairs = (c: Ctx, tiles: Iterable<{ i: number; before: { t: number; c: number }; after: { c: number } }>) => {
  const h2 = hole(c, 2);
  if (!h2) return 0;
  let n = 0;
  for (const t of tiles) if (t.before.t === T.GREEN && t.after.c > t.before.c && near(c, t.i, h2.cup, 4.5)) n++;
  return n;
};
const undoTop = (c: Ctx): EditPlan | undefined => c.g.undoStack[c.g.undoStack.length - 1]?.plan;
const newestHole = (c: Ctx) => c.g.world.holes.reduce((a, h) => (h.id > a.id ? h : a), c.g.world.holes[0]);
/** The hole the player built in this walkthrough: the newest one, worked out from the course so it survives a reload. */
const myId = (c: Ctx) => newestHole(c).id;
const groupOf: Partial<Record<ToolId, string>> = { fairway: 'terrain', green: 'terrain', rough: 'terrain', path: 'terrain', bunker: 'terrain', water: 'terrain', treeAdd: 'nature', treeDel: 'nature', repair: 'nature', tee: 'holes', cup: 'holes', bend: 'holes', build: 'holes' };

/** Point at a tool: open the Design tray, then its group, then the tool itself. */
const toolTarget = (c: Ctx, tool: ToolId) => {
  if (c.e.tool === tool) return c.e.proposal ? ['#cfOk'] : [];
  if (c.ui.mobile && c.ui.tab !== 'build') return ['#nav [data-nav="build"]'];
  return [`#tools [data-tool="${tool}"]`, `#tools [data-cat="${groupOf[tool]}"]`, '#tools .cat.on'];
};
/** Point at a button in the Holes panel, opening the panel first on phones. */
const panelTarget = (c: Ctx, sel: string) => (c.ui.tab !== 'course' ? ['#nav [data-nav="course"]', '#side .tabs [data-tab="course"]'] : [sel]);
/** Make sure the hole bar and Holes panel are on the hole the step is about. */
const holeTarget = (c: Ctx, id: number, then: string[]) => (c.g.selectedHole !== id ? ['#holebar [data-hb="next"]', `[data-hole="${id}"]`] : then);

const isLandscape = (c: Ctx) => c.ui.landscape;
const touchWords = (c: Ctx) => c.ui.mobile || matchMedia('(pointer: coarse)').matches;

const STEPS: Step[] = [
  {
    short: () => 'Welcome to Willow Creek, Level 1.',
    more: () => 'This walkthrough teaches every control while you restore two holes and build one of your own. Each step asks for one thing; the gold ring marks where to tap.',
    nextLabel: 'Start',
    view: 'map',
  },
  {
    short: (c) => (touchWords(c) ? 'Drag one finger to move the map, then pinch to zoom.' : 'Drag to move the map, then scroll to zoom.'),
    more: (c) => `Moving the map never changes your course.${isLandscape(c) ? '' : ' The + and − buttons zoom too.'}`,
    view: 'map',
    enter: (c) => { c.mark.x = c.r.cam.x; c.mark.y = c.r.cam.y; c.mark.z = c.r.cam.zoom; },
    check: (c) => Math.hypot(c.r.cam.x - (c.mark.x as number), c.r.cam.y - (c.mark.y as number)) * c.r.cam.zoom > 80 && Math.abs(c.r.cam.zoom / (c.mark.z as number) - 1) > 0.08,
  },
  {
    short: () => 'Tap › to select Cattail Carry.',
    more: () => 'The hole bar shows which hole the hole tools work on, with its status, par and length. Tap the name to manage that hole.',
    view: 'map',
    target: () => ['#holebar [data-hb="next"]'],
    check: (c) => c.g.selectedHole === 2,
  },
  {
    short: (c) => (c.ui.mobile ? 'Tap Design to open the building tools.' : 'The building tools are along the bottom of the screen.'),
    more: () => 'Tools come in three groups: Terrain, Nature and Holes.',
    view: 'map',
    target: (c) => (c.ui.mobile ? ['#nav [data-nav="build"]'] : []),
    check: (c) => !c.ui.mobile || c.ui.tab === 'build',
    nextLabel: 'Next',
  },
  {
    short: () => 'Tap Nature, then Repair.',
    more: () => "Hole 2's green is worn down to dirt. Repair reseeds worn turf.",
    view: 'map',
    enter: (c) => { c.e.selectHole(2); const h = hole(c, 2); if (h) c.e.focusPoint(h.cup, 1.1); },
    target: (c) => toolTarget(c, 'repair'),
    check: (c) => c.e.tool === 'repair',
  },
  {
    short: (c) => (touchWords(c) ? 'Press and hold the brown green, then drag across it.' : 'Drag across the brown green.'),
    more: (c) => (touchWords(c) ? "A quick tap paints one spot. A drag without holding only moves the map, so you can't paint by accident. The Brush button changes the size." : 'S, M and L change the brush size.'),
    view: 'map',
    target: (c) => (c.e.tool === 'repair' ? [] : toolTarget(c, 'repair')),
    check: (c) => greenRepairs(c, c.e.batch.values()) >= 6 || c.g.undoStack.some((u) => greenRepairs(c, u.plan.tiles) >= 6),
  },
  {
    short: (c) => (c.e.proposal ? 'Tap Build to pay for the repair.' : 'Paint a few tiles of the green first.'),
    more: () => 'Tinted tiles are a preview and the bar shows the tile count and price. Nothing is charged until Build; Cancel throws it away for free.',
    view: 'map',
    target: (c) => (c.e.proposal ? ['#cfOk'] : []),
    check: (c) => { const p = c.g.undoStack.map((u) => u.plan).reverse().find((pl) => greenRepairs(c, pl.tiles) >= 6); if (p) c.mark.plan = p; return !!p && !c.e.proposal; },
  },
  {
    short: () => 'Tap Undo ↶ to take the repair back.',
    more: () => 'Everything you build can be undone, and Undo refunds what you paid.',
    enter: (c) => { if (!c.mark.plan) c.mark.plan = c.g.undoStack.map((u) => u.plan).reverse().find((pl) => greenRepairs(c, pl.tiles) >= 6); },
    target: () => ['#undoBtn'],
    check: (c) => !c.mark.plan || undoTop(c) !== c.mark.plan,
  },
  {
    short: () => 'Tap Redo ↷ to put it back.',
    target: () => ['#redoBtn'],
    check: (c) => !c.mark.plan || c.g.undoStack.some((u) => u.plan === c.mark.plan),
  },
  {
    short: (c) => (c.ui.tab === 'course' ? 'Tap Open hole.' : 'Tap Holes, then Open hole.'),
    more: () => 'Working on a hole closes it so no golfer is caught in the work. Reopen it when you are done.',
    view: 'sheet',
    target: (c) => holeTarget(c, 2, panelTarget(c, '[data-act="open"]')),
    check: (c) => !!hole(c, 2)?.open,
  },
  {
    short: (c) => (c.g.selectedHole !== 3 ? 'Tap › to select hole 3, Foxglove Run.' : c.ui.tab === 'course' ? 'Tap Fix with Fairway.' : 'Tap Holes to see why hole 3 is closed.'),
    more: () => 'The Holes panel lists exactly what stops a hole opening, with a button that takes you to the fix.',
    view: 'sheet',
    target: (c) => holeTarget(c, 3, panelTarget(c, '[data-act="issue"][data-mode="fix"]')),
    check: (c) => c.g.selectedHole === 3 && c.e.tool === 'fairway',
  },
  {
    short: (c) => {
      const v = c.g.validate(3);
      if (c.e.proposal) return 'Tap Build to lay the fairway.';
      return v.ok ? 'Connected. Tap Build if anything is still staged.' : `${touchWords(c) ? 'Hold and drag' : 'Drag'} fairway across the red ring.`;
    },
    more: () => 'The fairway must run three tiles wide from tee to green. Fairway clears trees as it goes; set Brush to L for wide strokes.',
    view: 'map',
    enter: (c) => { c.e.selectHole(3); const b = c.g.validate(3).breakAt; if (b) c.e.focusPoint(b, 1); if (c.e.tool !== 'fairway') c.e.setTool('fairway'); },
    target: (c) => (c.e.proposal ? ['#cfOk'] : c.e.tool === 'fairway' ? [] : toolTarget(c, 'fairway')),
    check: (c) => c.g.validate(3).ok && !c.e.proposal,
  },
  {
    short: (c) => (c.ui.tab === 'course' ? 'Tap Open hole for Foxglove Run.' : 'Tap Holes, then Open hole.'),
    more: () => 'Every check passes now. That is two holes restored.',
    view: 'sheet',
    target: (c) => holeTarget(c, 3, panelTarget(c, '[data-act="open"]')),
    check: (c) => !!hole(c, 3)?.open,
  },
  {
    short: (c) => (c.e.tool !== 'build' ? 'Tap Holes, then New hole.' : c.e.proposal ? 'Tap Build to lay out your hole.' : c.e.buildStarted ? 'Tap where the green goes.' : 'Tap open land for the tee.'),
    more: () => 'Put the green about two thumb-widths from the tee. A gold preview shows the route, par and yards before anything is built.',
    view: 'map',
    enter: (c) => { c.mark.n = c.g.world.holes.length; c.e.focusPoint(NEW_HOLE_AREA, 0.55); },
    target: (c) => toolTarget(c, 'build'),
    check: (c) => c.g.world.holes.length > (c.mark.n as number) && !c.e.proposal,
  },
  {
    short: (c) => (c.e.tool !== 'cup' ? 'Tap Move cup.' : c.e.proposal ? 'Tap Build to cut the new green.' : 'Tap a new spot for the green.'),
    more: () => 'A gold ghost shows the new pin, route and yardage first. Cancel leaves the hole as it was.',
    view: 'map',
    enter: (c) => { const h = newestHole(c); c.e.selectHole(h.id); c.mark.cup = `${h.cup.x},${h.cup.y}`; },
    target: (c) => toolTarget(c, 'cup'),
    check: (c) => { const h = hole(c, myId(c)); return !!h && `${h.cup.x},${h.cup.y}` !== c.mark.cup && !c.e.proposal; },
  },
  {
    short: (c) => (c.e.tool !== 'bunker' ? 'Tap Terrain, then Bunker.' : c.e.proposal ? 'Tap Build to dig the bunker.' : 'Hold and drag beside the green.'),
    more: () => 'Hazards give a hole character. Leave fairway open to the green or the hole cannot open.',
    view: 'map',
    enter: (c) => { c.mark.sand = sandNear(c); const h = hole(c, myId(c)); if (h) c.e.focusPoint(h.cup, 0.95); },
    target: (c) => toolTarget(c, 'bunker'),
    check: (c) => sandNear(c) >= (c.mark.sand as number) + 3 && !c.e.proposal,
  },
  {
    short: (c) => (c.ui.tab === 'course' ? 'Tap Open hole.' : 'Tap Holes, then Open hole.'),
    more: () => "If it can't open, the panel says why and Show on map takes you there.",
    view: 'sheet',
    target: (c) => holeTarget(c, myId(c), panelTarget(c, '[data-act="open"]')),
    check: (c) => !!hole(c, myId(c))?.open,
  },
  {
    id: 'testgolfers',
    short: () => 'Tap Test golfers.',
    more: () => 'A beginner, a regular and a skilled golfer walk out and play your hole for free. Their scores appear in the Holes panel.',
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
  },
  {
    short: (c) => (c.g.owner.active ? 'Tap Start swing, then tap again in the middle.' : c.ui.tab === 'course' ? 'Tap Play it.' : 'Tap Holes, then Play it.'),
    more: () => 'Pick a club first. Tap the map to aim somewhere else. The needle in the centre gives clean contact.',
    view: 'sheet',
    target: (c) => (c.g.owner.active ? ['[data-owner="hit"]'] : holeTarget(c, myId(c), panelTarget(c, '[data-act="practice"]'))),
    check: (c) => c.g.owner.active && c.g.owner.strokes >= 1,
  },
  {
    short: () => 'Tap Finish when you are done.',
    target: (c) => (c.g.owner.active ? ['[data-owner="stop"]'] : []),
    check: (c) => !c.g.owner.active,
  },
  {
    short: () => 'Level 1 complete. Willow Creek is yours.',
    more: () => 'You restored two holes and built, tested and played your own. Keep shaping the course: up to nine holes, water, paths and trees. Goals lists rewards to chase. Everything saves on this device.',
    nextLabel: 'Finish',
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
        if (confirm('Skip the tutorial? You can keep designing Willow Creek freely, and replay it from the Menu.')) this.finish();
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
    this.card.hidden = true;
    document.body.classList.remove('coaching', 'coach-folded');
    this.g.notify('good', 'Level 1 is yours. Keep designing Willow Creek.');
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
    const html = `<div class="coach-row"><span class="coach-count">${flash ? '✓ ' : ''}${t.step + 1}/${STEPS.length}</span><p class="coach-short">${step.short(this.ctx)}</p>${manual ? `<button class="btn primary coach-next" data-coach="next">${this.reviewing ? 'Next' : step.nextLabel ?? 'Next'}</button>` : ''}${this.slim && !this.collapsed ? `<button class="coach-dots" data-coach="tools" aria-label="${showTools ? 'Hide' : 'Show'} tutorial options" aria-expanded="${showTools}">⋯</button>` : ''}</div>${this.collapsed || !showTools ? '' : `${this.more && moreText ? `<p class="coach-more">${moreText}</p>` : ''}<div class="coach-tools"><button data-coach="back" ${t.step === 0 ? 'disabled' : ''} aria-label="Previous step">‹<span> Back</span></button>${moreText ? `<button data-coach="more" aria-expanded="${this.more}">${this.more ? 'Less' : 'More'}</button>` : ''}<button data-coach="skip">Skip</button><button data-coach="fold" aria-label="Collapse instructions">▾</button></div>`}${this.collapsed ? '<button class="coach-unfold" data-coach="fold" aria-label="Expand instructions">▴</button>' : ''}`;
    if (force || entering || html !== this.html) {
      const resized = this.html === '' || entering || force || this.card.classList.contains('collapsed') !== this.collapsed;
      this.html = html;
      this.card.innerHTML = html;
      this.card.classList.toggle('collapsed', this.collapsed);
      this.card.classList.toggle('flash', flash);
      if (resized) this.ui.onInsets();
    }
    this.dock();
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
      const found = [...document.querySelectorAll<HTMLElement>(s)].find((x) => x.offsetParent !== null && x.getBoundingClientRect().width > 0);
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
