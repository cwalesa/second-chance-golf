import type { Game } from './game';
import type { Editor } from './input';
import type { Renderer } from './render';
import type { UI } from './ui';
import { Pt } from './terrain';
import { suggestFirstHole } from './wilderness';

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

/** Tiles of one kind within a radius of a point. */
const near = (c: Ctx, p: Pt, r: number, kind: number) => {
  const w = c.g.world;
  let n = 0;
  for (let y = Math.floor(p.y - r); y <= p.y + r; y++)
    for (let x = Math.floor(p.x - r); x <= p.x + r; x++) if (x >= 0 && y >= 0 && x < w.w && y < w.h && w.terrain[y * w.w + x] === kind) n++;
  return n;
};
const itemsOf = (c: Ctx, k: string) => (c.g.world.items ?? []).filter((it) => it.k === k).length;
/** Open the build tray with one tool picked, and frame a spot on the map. */
const pick = (c: Ctx, tool: 'build' | 'bunker' | 'water' | 'decor', kind?: 'flowers' | 'bench', focus?: Pt[]) => {
  if (kind) c.e.decorKind = kind;
  c.e.setTool(tool);
  if (c.ui.mobile) { c.ui.tab = 'build'; c.ui.refresh(true); c.ui.onInsets(); }
  if (focus) c.e.focusPoints(focus);
};
const first = (c: Ctx) => c.g.world.holes[0];

/**
 * The practice course: a few minutes on land that does not count, with the clubhouse already built.
 * It walks through one hole, a bunker, a pond, flowers, a bench, a second hole with a bend, opening
 * the holes and watching golfers. Then the player starts their own course from scratch.
 */
const STEPS: Step[] = [
  {
    short: () => 'Welcome to your practice course! Learn the basics here, then build your own course from scratch.',
    view: 'map',
    enter: (c) => { const k = c.g.world.clubhouse; if (k) c.e.focusPoint({ x: k.x + 6, y: k.y + 2 }, 0.62); },
    nextLabel: "Let's go",
  },
  {
    id: 'hole',
    short: (c) => (c.e.tool !== 'build' ? 'Tap New hole in the tray.' : c.e.proposal ? 'Tap Build.' : c.e.overlay.buildTee ? 'Now tap the glowing green.' : 'Tap the glowing spot to put your first tee there.'),
    view: 'map',
    enter: (c) => {
      c.mark.n = c.g.world.holes.length;
      c.e.setNewPar(3);
      const s = suggestion(c);
      pick(c, 'build', undefined, s ? [s.tee, s.cup] : undefined);
    },
    target: (c) => (c.e.tool !== 'build' ? ['#tools .ph-tools [data-tool="build"]', '#tools [data-tool="build"]'] : c.e.proposal ? ['#cfOk'] : []),
    hint: (c) => {
      const s = suggestion(c);
      if (s && c.e.overlay.buildTee && !c.mark.cupShown) { c.mark.cupShown = true; c.e.focusPoints([s.tee, s.cup]); }
      return holeHint(c);
    },
    check: (c) => c.g.world.holes.length > (c.mark.n as number) && !c.e.proposal,
  },
  {
    short: (c) => (c.e.proposal ? 'Tap Build to dig it.' : 'Hazards make holes fun. Hold a finger beside the green, then drag to dig a bunker.'),
    view: 'map',
    enter: (c) => { const h = first(c); c.mark.sand = h ? near(c, h.cup, 6, 4) : 0; pick(c, 'bunker', undefined, h ? [{ x: h.cup.x - 3, y: h.cup.y - 3 }, { x: h.cup.x + 3, y: h.cup.y + 3 }] : undefined); },
    target: (c) => (c.e.proposal ? ['#cfOk'] : []),
    check: (c) => { const h = first(c); return !!h && near(c, h.cup, 6, 4) >= (c.mark.sand as number) + 3 && !c.e.proposal; },
    skippable: true,
  },
  {
    short: (c) => (c.e.proposal ? 'Tap Build.' : 'Now some water: hold and drag beside the fairway to dig a pond.'),
    view: 'map',
    enter: (c) => { const h = first(c); const mid = h ? { x: (h.tee.x + h.cup.x) / 2, y: (h.tee.y + h.cup.y) / 2 } : null; c.mark.mid = mid; c.mark.wet = mid ? near(c, mid, 9, 5) : 0; pick(c, 'water', undefined, h ? [h.tee, h.cup] : undefined); },
    target: (c) => (c.e.proposal ? ['#cfOk'] : []),
    check: (c) => !!c.mark.mid && near(c, c.mark.mid as Pt, 9, 5) >= (c.mark.wet as number) + 3 && !c.e.proposal,
    skippable: true,
  },
  {
    short: (c) => `Make it pretty: tap the rough near the tee to plant flowers (${Math.min(2, itemsOf(c, 'flowers') - (c.mark.fl as number))} of 2).`,
    view: 'map',
    enter: (c) => { c.mark.fl = itemsOf(c, 'flowers'); const h = first(c); pick(c, 'decor', 'flowers', h ? [{ x: h.tee.x - 3, y: h.tee.y - 3 }, { x: h.tee.x + 3, y: h.tee.y + 3 }] : undefined); },
    check: (c) => itemsOf(c, 'flowers') >= (c.mark.fl as number) + 2,
    skippable: true,
  },
  {
    short: () => 'Add a structure: tap the rough beside the tee to place a bench.',
    view: 'map',
    enter: (c) => { c.mark.b = itemsOf(c, 'bench'); pick(c, 'decor', 'bench'); },
    check: (c) => itemsOf(c, 'bench') > (c.mark.b as number),
    skippable: true,
  },
  {
    short: (c) => (c.e.tool !== 'build' ? 'Tap New hole in the tray.' : c.e.proposal ? (c.e.newBends.length ? 'Nice bend! Drag any marker to adjust it, then tap Build.' : 'Tap + Bend, then tap where the fairway should turn.') : c.e.overlay.buildTee ? 'Now tap where its green goes.' : 'Build a second hole. Tap where its tee goes.'),
    view: 'map',
    enter: (c) => { c.mark.n2 = c.g.world.holes.length; c.e.setNewPar(4); pick(c, 'build'); },
    target: (c) => (c.e.tool !== 'build' ? ['#tools .ph-tools [data-tool="build"]'] : c.e.proposal ? (c.e.newBends.length ? ['#cfOk'] : ['#cfBend']) : []),
    check: (c) => c.g.world.holes.length > (c.mark.n2 as number) && !c.e.proposal,
    skippable: true,
  },
  {
    short: (c) => { const h = c.g.world.holes.find((x) => !x.open); return h ? `Tap Open hole for ${h.name}.` : 'All open!'; },
    view: 'sheet',
    enter: (c) => {
      c.e.setTool('inspect');
      const h = c.g.world.holes.find((x) => !x.open) ?? first(c);
      if (h) c.e.selectHole(h.id);
      c.ui.tab = 'course';
      if (c.ui.portraitSheet) c.ui.sheet = 'half';
      c.ui.refresh(true);
      c.ui.onInsets();
    },
    target: (c) => {
      const h = c.g.world.holes.find((x) => !x.open);
      if (h && c.g.selectedHole !== h.id) { c.e.selectHole(h.id); c.ui.refresh(true); }
      return ['[data-act="open"]'];
    },
    check: (c) => c.g.world.holes.length > 0 && c.g.world.holes.every((h) => h.open),
  },
  {
    id: 'watch',
    short: () => 'Here come three test golfers. Watch them play your first hole.',
    view: 'map',
    enter: (c) => {
      if (c.ui.tab === 'course') { c.ui.tab = 'none'; c.ui.refresh(true); c.ui.onInsets(); }
      if (c.g.designMode) c.g.toggleDesignMode();
      c.g.setSpeed(3);
      const h = first(c);
      if (h) { c.g.sendTestGolfers(h.id); c.e.focusHole(); }
    },
    check: (c) => c.g.testResults.length > 0,
    skippable: true,
  },
  {
    short: () => "You've got the basics! Now start your own course from scratch. Goals and tips will help you along the way.",
    view: 'map',
    nextLabel: 'Start my course',
  },
];

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
        this.finish();
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
  /** Called when the practice course is over (finished or skipped): start the player's own course. */
  onGraduate: () => void = () => {};
  private finish() {
    if (this.g.practice) {
      this.clearRing();
      this.card.hidden = true;
      this.onGraduate();
      return;
    }
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
    const html = `<div class="coach-row"><p class="coach-short">${flash ? '✓ ' : ''}${step.short(this.ctx)}</p>${manual ? `<button class="btn primary coach-next" data-coach="next">${step.nextLabel ?? 'Next'}</button>` : ''}${manual && t.step === STEPS.length - 1 ? '' : '<button class="coach-x" data-coach="skip" aria-label="Skip the tutorial">Skip</button>'}</div>`;
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

  /** Phones: the top of the screen is free, so the coach sits under the status chip and the bottom stays for building. */
  private dock() {
    if (!this.ui.mobile) { this.card.style.top = ''; this.card.style.bottom = ''; this.card.classList.remove('ontop'); return; }
    const hdr = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr')) || 56;
    const top = `${Math.round(hdr + 8)}px`;
    this.card.classList.add('ontop');
    if (this.card.style.top !== top || this.card.style.bottom !== 'auto') {
      this.card.style.top = top;
      this.card.style.bottom = 'auto';
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
const TEST_GOLFER_STEP = STEPS.findIndex((st) => st.id === 'watch');
