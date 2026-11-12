import type { Game } from './game';
import type { Editor } from './input';
import type { Renderer } from './render';
import type { UI } from './ui';
import { Hole, PAR_YARDS, holeBends, Pt, T, World, holePath, holeYards, lengthAdvice, polyDist } from './terrain';
import { suggestFirstHole } from './wilderness';

/** Saved progress through the first-session tutorial. It runs on the player's own course. */
export interface TutorialState {
  step: number;
  done: boolean;
  /** id of the current step, so the list can change between versions without losing the player's place */
  at?: string;
  /** 2 = runs on the real course (older saves used a separate practice course) */
  v?: number;
}
export const freshTutorial = (): TutorialState => ({ step: 0, done: false, v: 2 });

export interface Ctx {
  g: Game;
  e: Editor;
  r: Renderer;
  ui: UI;
  /** Values remembered from earlier steps, so a step checks what the player did, not what was already true. */
  mark: Record<string, unknown>;
}
export type StepId = 'club' | 'par' | 'tee' | 'green' | 'build' | 'bunker' | 'open' | 'watch' | 'finances' | 'fee' | 'done';
export interface Step {
  id: StepId;
  /** One or two short sentences: the single thing to do now. */
  short: (c: Ctx) => string;
  /** Extra detail, shown only when the player taps More. */
  more?: (c: Ctx) => string;
  /** 'map' steps close management panels so the course is visible; 'sheet' steps keep the Course sheet open. */
  view?: 'map' | 'sheet';
  /** The management tab this step needs kept open; every other tab is closed on entry. */
  tab?: 'money' | 'course';
  /** What to point at; the first selector that is on screen gets the pulsing ring. */
  target?: (c: Ctx) => string[];
  /** True once the player has done the thing. */
  check?: (c: Ctx) => boolean;
  /** Runs once when the step starts. */
  enter?: (c: Ctx) => void;
  /** Runs once the card is on screen, to frame the camera in the space the card leaves free. */
  frame?: (c: Ctx) => void;
  /** Runs on every tick: keeps the right tool in hand. */
  keep?: (c: Ctx) => void;
  /** When the player has undone an earlier step's work (cancelled the placement), the step to go back to. */
  back?: (c: Ctx) => StepId | null;
  /** True when the step has nothing left to teach (for example the clubhouse already stands, on a replay). */
  skipIf?: (c: Ctx) => boolean;
  /** Steps without a check advance with a button. */
  nextLabel?: string;
  /** Steps that wait for the player to do something can still be waved through. */
  skippable?: boolean;
  /** Glowing suggestions on the map: where a tee and a green might go. */
  hint?: (c: Ctx) => { tee?: Pt; cup?: Pt } | null;
  /** An outlined target area on the map, with a looping hand showing how to paint it. */
  zone?: (c: Ctx) => { x: number; y: number; r: number; label: string } | null;
  demo?: (c: Ctx) => { from: Pt; to: Pt } | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
/** Whole dollars, as the rest of the interface shows them. */
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US');

// ---- helpers ----

/** The hole the coach suggests, worked out once from the player's own clubhouse spot (and any holes already there). */
export const suggestion = (c: Ctx) => {
  if (!('hole' in c.mark)) {
    const holes = c.g.world.holes;
    c.mark.hole = suggestFirstHole(c.g.world, holes.length ? { avoid: holes, near: holes[holes.length - 1].cup } : {});
  }
  return c.mark.hole as { tee: Pt; cup: Pt } | null;
};
/** The hole this run of the tutorial builds, or the newest one when the page was reloaded part-way. */
export const tutHole = (c: Ctx): Hole | undefined => {
  const w = c.g.world;
  return w.holes.find((h) => h.id === c.mark.holeId) ?? w.holes[w.holes.length - 1];
};
/** Where to ask for sand: an open patch of ground beside the green, off the line of play. */
export function bunkerZone(w: World, h: Hole): { x: number; y: number; r: number } {
  const R = 2.6;
  const along = Math.atan2(h.cup.y - h.tee.y, h.cup.x - h.tee.x);
  let best = { x: h.cup.x + 5, y: h.cup.y, r: R }, bestScore = -Infinity;
  const path = holePath(h);
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    const x = Math.round(h.cup.x + Math.cos(ang) * 5.2), y = Math.round(h.cup.y + Math.sin(ang) * 5.2);
    let score = (1 - Math.abs(Math.cos(ang - along))) * 4 - polyDist(x + 0.5, y + 0.5, path).d * 0.15;
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        if (Math.hypot(dx, dy) > R) continue;
        const tx = x + dx, ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= w.w || ty >= w.h) { score -= 3; continue; }
        const i = ty * w.w + tx, t = w.terrain[i];
        if (t === T.WATER || t === T.PATH || t === T.BUILDING || t === T.BRIDGE) score -= 3;
        else if (t === T.GREEN || t === T.TEE) score -= 1.5;
        else if (w.tree[i]) score -= 0.4;
        else score += 0.5;
      }
    if (score > bestScore) { bestScore = score; best = { x, y, r: R }; }
  }
  return best;
}
const zoneOf = (c: Ctx) => {
  const h = tutHole(c);
  if (!h) return null;
  if (!c.mark.zone) c.mark.zone = bunkerZone(c.g.world, h);
  return c.mark.zone as { x: number; y: number; r: number };
};
const inZone = (c: Ctx, i: number) => {
  const z = zoneOf(c), w = c.g.world;
  return !!z && Math.hypot((i % w.w) - z.x, Math.floor(i / w.w) - z.y) <= z.r;
};
/** Sand already dug inside the outlined area. */
export const sandInZone = (c: Ctx) => {
  const w = c.g.world, z = zoneOf(c);
  if (!z) return 0;
  let n = 0;
  for (let y = Math.floor(z.y - z.r); y <= z.y + z.r; y++) for (let x = Math.floor(z.x - z.r); x <= z.x + z.r; x++) if (x >= 0 && y >= 0 && x < w.w && y < w.h && w.terrain[y * w.w + x] === T.BUNKER && inZone(c, y * w.w + x)) n++;
  return n;
};
/** Sand painted inside the area but not built yet. */
export const stagedInZone = (c: Ctx) => {
  let n = 0;
  for (const i of c.e.overlay.staged) if (c.e.overlay.stagedKind.get(i) === 'bunker' && inZone(c, i)) n++;
  return n;
};
export const SAND_NEEDED = 5;

/** Open the build tray with one tool picked. */
const pickTool = (c: Ctx, tool: 'build' | 'bunker') => {
  c.e.setTool(tool);
  if (c.ui.mobile) { c.ui.tab = 'build'; c.ui.refresh(true); c.ui.onInsets(); }
};
const SHOTS: Record<number, string> = { 3: 'one shot to the green', 4: 'two shots to the green', 5: 'three shots to the green' };
export const parLine = (par: number) => `Par ${par}: ${SHOTS[par]}, about ${PAR_YARDS[par][0]}–${PAR_YARDS[par][1]} yd.`;

/** The new-hole plan the player is looking at, if any. */
const plan = (c: Ctx) => c.e.proposal?.newHole ?? null;
const keepBuild = (c: Ctx) => { if (c.e.tool !== 'build' && !c.e.proposal) pickTool(c, 'build'); };

/**
 * The tutorial teaches only what one hole needs: the clubhouse, a par, a tee and a green, building it,
 * a bunker, opening it, watching test golfers play it and setting a fee. Everything else is introduced later (intros.ts).
 */
export const STEPS: Step[] = [
  {
    id: 'club',
    short: (c) => (!c.e.clubSpot ? 'First, the clubhouse. Tap the ground where it should go, or tap Suggest a spot.' : c.e.clubSpot.problem ? 'That spot will not work. Tap somewhere else, or tap Suggest a spot.' : 'Tap Build here.'),
    more: () => 'Golfers arrive by the road beside the clubhouse. Trees on the spot are cleared for you, and the clubhouse is free.',
    view: 'map',
    skipIf: (c) => c.g.world.clubhouse !== null,
    target: (c) => (c.e.clubSpot && !c.e.clubSpot.problem && c.e.clubLocked ? ['#clubOk'] : ['#clubSuggest']),
    check: (c) => c.g.world.clubhouse !== null,
  },
  {
    id: 'par',
    short: (c) => `Pick a par for your first hole. ${parLine(c.e.newPar)}`,
    more: () => "Par is the number of shots a good golfer needs. Longer holes need a higher par. Par 3 is the quickest to build, so it makes a good first hole. You can change a hole's par later.",
    view: 'map',
    enter: (c) => {
      c.mark.n = c.g.world.holes.length;
      c.e.newPar = 3;
      c.e.parPicked = false;
      pickTool(c, 'build');
    },
    keep: keepBuild,
    frame: (c) => { const s = suggestion(c); if (s) c.e.focusPoints([s.tee, s.cup]); },
    target: () => ['#confirm .cf-pars'],
    nextLabel: 'Next',
  },
  {
    id: 'tee',
    short: () => 'Tap the glowing spot to place the tee. Anywhere works.',
    more: () => 'The tee is where golfers start. Nothing is built until you tap Build, so you can try different spots.',
    view: 'map',
    keep: keepBuild,
    hint: (c) => { const s = suggestion(c); return s && !c.e.buildStarted && !c.e.proposal ? { tee: s.tee } : null; },
    check: (c) => c.e.buildStarted || !!plan(c),
  },
  {
    id: 'green',
    short: (c) => {
      const y = c.e.liveYards;
      const fit = y === null ? null : lengthAdvice(c.e.newPar, y);
      return `Tap where the green goes. ${y === null ? parLine(c.e.newPar) : fit ? `${y} yd: ${fit.includes('short') ? 'short' : 'long'} for par ${c.e.newPar}.` : `${y} yd fits par ${c.e.newPar}.`}`;
    },
    more: () => 'You will see the length and the price before anything is built, and you can drag either end to adjust.',
    view: 'map',
    keep: keepBuild,
    back: (c) => (!c.e.buildStarted && !plan(c) ? 'tee' : null),
    hint: (c) => { const s = suggestion(c); return s && !plan(c) ? { cup: s.cup } : null; },
    check: (c) => !!plan(c),
  },
  {
    id: 'build',
    short: (c) => {
      const nh = plan(c), p = c.e.proposal;
      if (!nh || !p) return 'Tap Build.';
      const yards = holeYards(nh), advice = lengthAdvice(nh.par, yards);
      if (advice) return `${yards} yd is ${yards < PAR_YARDS[nh.par][0] ? 'short' : 'long'} for a par ${nh.par}. Change the par, or drag T or G.`;
      return `${yards} yd, par ${nh.par}, ${money(p.cost)}. Tap Build.`;
    },
    more: () => 'Drag T or G to move an end. The cost covers clearing trees and laying fairway, tee and green. Undo takes it back and refunds you.',
    view: 'map',
    enter: (c) => { c.mark.n = c.g.world.holes.length; },
    frame: (c) => { const nh = plan(c); if (nh) c.e.ensureVisible([nh.tee, nh.cup, ...holeBends(nh)]); },
    keep: keepBuild,
    back: (c) => (!c.e.proposal && c.g.world.holes.length === c.mark.n ? 'tee' : null),
    target: () => ['#cfOk'],
    check: (c) => {
      if (c.g.world.holes.length > (c.mark.n as number) && !c.e.proposal) {
        c.mark.holeId = c.g.world.holes[c.g.world.holes.length - 1].id;
        return true;
      }
      return false;
    },
  },
  {
    id: 'bunker',
    short: (c) => (c.e.proposal && stagedInZone(c) >= 3 ? 'Tap Build to dig the bunker.' : 'Paint sand in the outlined area: tap it, or hold, then drag.'),
    more: () => 'One finger moves the map, so to paint you hold still until the ring fills and then drag. A single tap also paints a patch. Nothing is charged until you tap Build.',
    view: 'map',
    enter: (c) => {
      zoneOf(c);
      pickTool(c, 'bunker');
      c.e.setBrush(1);
    },
    frame: (c) => {
      const z = zoneOf(c), h = tutHole(c);
      if (z && h) c.e.focusPoints([h.cup, { x: z.x - 3, y: z.y - 3 }, { x: z.x + 3, y: z.y + 3 }]);
    },
    keep: (c) => { if (c.e.tool !== 'bunker' && !c.e.proposal) pickTool(c, 'bunker'); },
    target: (c) => (c.e.proposal && stagedInZone(c) >= 3 ? ['#cfOk'] : []),
    zone: (c) => { const z = zoneOf(c); return z ? { ...z, label: 'Sand here' } : null; },
    demo: (c) => { const z = zoneOf(c); return z && !c.e.proposal && c.e.overlay.staged.size === 0 ? { from: { x: z.x - 1.5, y: z.y + 0.5 }, to: { x: z.x + 1.5, y: z.y - 0.5 } } : null; },
    check: (c) => sandInZone(c) >= SAND_NEEDED && !c.e.proposal,
    skippable: true,
  },
  {
    id: 'open',
    short: (c) => { const h = tutHole(c); return h ? `Tap Open hole to let golfers play ${esc(h.name)}.` : 'Tap Open hole.'; },
    more: () => 'Only open holes earn money. A hole can open once it has a tee, a green and a fairway between them.',
    view: 'sheet',
    tab: 'course',
    enter: (c) => {
      c.e.setTool('inspect');
      const h = tutHole(c);
      if (h) c.e.selectHole(h.id);
      c.ui.tab = 'course';
      if (c.ui.portraitSheet) c.ui.sheet = 'half';
      c.ui.refresh(true);
      c.ui.onInsets();
    },
    frame: (c) => c.e.focusHole(),
    target: (c) => {
      const h = tutHole(c);
      if (h && c.g.selectedHole !== h.id) { c.e.selectHole(h.id); c.ui.refresh(true); }
      return ['[data-act="open"]'];
    },
    check: (c) => !!tutHole(c)?.open,
  },
  {
    id: 'watch',
    short: (c) => {
      const last = c.g.testResults[c.g.testResults.length - 1];
      return last ? `${esc(last.name)} scored ${last.strokes} on a par ${last.par}.` : 'Three test golfers are playing your hole. Their scores show how hard it is.';
    },
    more: () => 'Test golfers are free and play only this hole. You can send them again from the Course panel whenever you change a hole.',
    view: 'map',
    enter: (c) => {
      if (c.ui.tab === 'course') { c.ui.tab = 'none'; c.ui.refresh(true); c.ui.onInsets(); }
      c.g.setDesignMode(false, true);
      c.g.setSpeed(8);
      c.g.followGolfer = 0;
      c.mark.results = c.g.testResults.length;
      const h = tutHole(c);
      if (h) c.g.sendTestGolfers(h.id);
    },
    frame: (c) => c.e.focusHole(),
    check: (c) => c.g.testResults.length > ((c.mark.results as number) ?? 0),
    skippable: true,
  },
  {
    id: 'finances',
    short: (c) => (c.ui.menuOpen ? 'Tap Finances.' : 'Now the price. Tap the menu button, then Finances.'),
    view: 'map',
    tab: 'money',
    enter: (c) => {
      // from here the clock waits again until the tutorial is over
      c.g.setDesignMode(true, true);
      c.ui.tab = 'none';
      c.ui.refresh(true);
    },
    target: (c) => (c.ui.menuOpen ? ['#nav [data-nav="money"]'] : ['#fab']),
    check: (c) => c.ui.tab === 'money',
    skippable: true,
  },
  {
    id: 'fee',
    short: (c) => `Tap + or − to change a green fee. Guests think about ${money(c.g.fair)} is fair.`,
    more: () => 'This is what each golfer pays. Too high and fewer guests book and they leave unhappy; too low and you leave money behind. The other prices wait for later.',
    view: 'map',
    tab: 'money',
    enter: (c) => { c.mark.fees = JSON.stringify(c.g.fees); },
    target: () => ['[data-act="bandfee"][data-band="mid"][data-id="1"]', '[data-act="bandfee"]'],
    check: (c) => JSON.stringify(c.g.fees) !== c.mark.fees,
    skippable: true,
  },
  {
    id: 'done',
    short: () => "Golfers will start arriving. Build your next hole whenever you're ready.",
    more: () => 'Goals in the menu show what to build next, and a few tips appear as new things become useful.',
    view: 'map',
    enter: (c) => { c.ui.tab = 'none'; c.ui.refresh(true); c.ui.onInsets(); },
    nextLabel: 'Start',
  },
];
export const stepIndex = (id: StepId) => STEPS.findIndex((s) => s.id === id);

/** Where a tutorial saved by the old practice-course version carries on from. */
export function legacyTutorialStep(old: number, hasHole: boolean): number {
  // old order: welcome, hole, bunker, halfway house, open, watch, fees, finish
  const map: StepId[] = ['par', 'par', hasHole ? 'bunker' : 'par', hasHole ? 'open' : 'par', hasHole ? 'open' : 'par', hasHole ? 'watch' : 'par', hasHole ? 'finances' : 'par', hasHole ? 'done' : 'par'];
  return stepIndex(map[Math.min(Math.max(0, old), map.length - 1)]);
}

/** The first-session coach: one short instruction at a time, docked clear of the map area it points at, with a ring on the target. */
export class Tutorial {
  private card = document.createElement('div');
  private ctx: Ctx;
  private entered = -1;
  private ring: HTMLElement | null = null;
  private html = '';
  private more = false;
  private doneFlash = 0;

  constructor(private g: Game, e: Editor, r: Renderer, private ui: UI) {
    this.ctx = { g, e, r, ui, mark: {} };
    // the saved id wins over the saved number, so reordering steps never strands a player
    const at = g.tutorial.at ? stepIndex(g.tutorial.at as StepId) : -1;
    if (at >= 0) g.tutorial.step = at;
    this.card.id = 'coach';
    this.card.dataset.owner = 'tutorial';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-live', 'polite');
    document.getElementById('app')!.append(this.card);
    this.card.onclick = (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-coach]');
      if (!b) return;
      const act = b.dataset.coach;
      if (act === 'next' || act === 'skipstep') this.advance();
      else if (act === 'more') this.more = !this.more;
      else if (act === 'skip') this.finish();
      this.update(true);
      this.ui.onInsets();
    };
    // Touches on the card never reach the course underneath.
    this.card.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    if (this.active) this.begin();
    window.addEventListener('resize', () => this.update(true));
  }

  /** Building steps run with the clock stopped so guests and closing time never interrupt them. */
  private begin() {
    this.g.settings.introSeen = true;
    this.g.setDesignMode(true, true);
  }

  /** Run the tutorial again on the current course (Settings). The clubhouse step is skipped when one stands. */
  restart() {
    this.g.tutorial = { step: 0, done: false, v: 2 };
    this.ctx.mark = {};
    this.entered = -1;
    this.more = false;
    this.ui.tab = 'none';
    this.ui.menuOpen = false;
    this.begin();
    this.g.dirtySave = true;
    this.update(true);
  }

  get active() {
    return !this.g.tutorial.done;
  }
  get step(): Step | undefined {
    return STEPS[this.g.tutorial.step];
  }

  private goTo(i: number) {
    this.g.tutorial.step = i;
    this.g.tutorial.at = STEPS[i]?.id;
    this.more = false;
    this.entered = -1;
    this.g.dirtySave = true;
  }
  private advance() {
    this.goTo(this.g.tutorial.step + 1);
    if (this.g.tutorial.step >= STEPS.length) this.finish();
  }

  private finish() {
    this.g.tutorial = { ...this.g.tutorial, done: true, v: 2 };
    this.g.dirtySave = true;
    this.clearRing();
    const o = this.ctx.e.overlay;
    o.hint = null; o.zone = null; o.demo = null;
    this.card.hidden = true;
    document.body.classList.remove('coaching', 'coach-folded');
    // the walkthrough ran with the clock stopped; now the club opens its doors, at normal speed
    this.g.setDesignMode(false, true);
    this.g.setSpeed(1);
    if (this.ctx.e.tool === 'bunker' || this.ctx.e.tool === 'build') this.ctx.e.setTool('inspect');
    this.ui.tab = 'none';
    this.ui.refresh(true);
    this.ui.onInsets();
  }

  /** Close panels the step doesn't use, and keep the Course sheet usable when it is the lesson. */
  private arrange(step: Step) {
    const ui = this.ui;
    if (ui.tab !== 'none' && ui.tab !== 'build' && ui.tab !== 'course' && ui.tab !== step.tab) { ui.tab = 'none'; ui.refresh(true); ui.onInsets(); }
    if (step.view === 'map' && ui.mobile && ui.tab === 'course') { ui.tab = 'none'; ui.refresh(true); ui.onInsets(); }
    if (step.view === 'sheet' && ui.tab === 'course' && ui.portraitSheet && ui.sheet !== 'half') ui.setSheet('half');
  }

  /** Called a few times a second from the main loop. */
  update(force = false): void {
    if (!this.active) {
      if (!this.card.hidden && this.card.dataset.owner !== 'intro') { this.card.hidden = true; this.clearRing(); document.body.classList.remove('coaching'); }
      return;
    }
    document.body.classList.add('coaching');
    this.card.dataset.owner = 'tutorial';
    this.card.hidden = this.ui.modalOpen;
    const t = this.g.tutorial;
    const step = STEPS[t.step];
    if (!step) { this.finish(); return; }
    const c = this.ctx;
    const entering = this.entered !== t.step;
    if (entering) {
      if (step.skipIf?.(c)) { this.advance(); if (this.active) this.update(true); return; }
      this.entered = t.step;
      t.at = step.id;
      step.enter?.(c);
      this.arrange(step);
    }
    step.keep?.(c);
    const back = step.back?.(c);
    if (back && !entering) { this.goTo(stepIndex(back)); this.update(true); return; }
    if (!entering && step.check?.(c)) {
      this.doneFlash = performance.now();
      this.advance();
      if (this.active) this.update(true);
      return;
    }
    const flash = performance.now() - this.doneFlash < 900;
    const manual = !step.check;
    const moreText = step.more?.(c);
    const html = `<div class="coach-row"><p class="coach-short">${step.short(c)}</p>${manual ? `<button class="btn primary coach-next" data-coach="next">${step.nextLabel ?? 'Next'}</button>` : ''}</div><div class="coach-actions"><button class="coach-x" data-coach="more" aria-expanded="${this.more}">${this.more ? 'Less' : 'More'}</button>${!manual && step.skippable ? '<button class="coach-x" data-coach="skipstep">Skip step</button>' : ''}</div>${this.more ? `<div class="coach-more">${moreText ? `<p>${moreText}</p>` : ''}<button class="coach-x quiet" data-coach="skip">Skip the tutorial</button></div>` : ''}`;
    if (force || entering || html !== this.html) {
      const resized = this.html === '' || entering || force || this.html.length !== html.length;
      this.html = html;
      this.card.innerHTML = html;
      this.card.dataset.step = step.id;
      this.card.classList.toggle('flash', flash);
      this.card.classList.toggle('open', this.more);
      if (resized) this.ui.onInsets();
    }
    this.dock();
    if (entering && step.frame) { this.ui.onInsets(); step.frame(c); }
    const o = c.e.overlay;
    o.hint = step.hint?.(c) ?? null;
    o.zone = step.zone?.(c) ?? null;
    o.demo = step.demo?.(c) ?? null;
    this.pointAt(step.target?.(c) ?? []);
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
