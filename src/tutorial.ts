import type { Game } from './game';
import type { Editor } from './input';
import type { Renderer } from './render';
import type { UI } from './ui';
import { CLUB_H, CLUB_W, Pt } from './terrain';
import { suggestClubhouse, suggestFirstHole } from './wilderness';
import { testObservation, testResultLine } from './tutorial-state';

export { freshTutorial, TUTORIAL_VERSION } from './tutorial-state';
export type { TutorialState } from './tutorial-state';

interface Ctx {
  g: Game;
  e: Editor;
  r: Renderer;
  ui: UI;
  /** Values remembered from earlier steps, so a step checks what the player did, not what was already true. */
  mark: Record<string, unknown>;
}
interface Step {
  id: string;
  /** Which of the tutorial's six parts this belongs to (shown as 2/6). */
  phase: number;
  /** One short, actionable instruction. */
  short: (c: Ctx) => string;
  /** What to point at; the first selector that is on screen gets the pulsing ring. */
  target?: (c: Ctx) => string[];
  /** The action is done when this is true; the tutorial then moves on by itself. */
  check?: (c: Ctx) => boolean;
  /** Runs once when the step starts (and again after a reload). */
  enter?: (c: Ctx) => void;
  /** Runs on every update, to keep the right panel in view. */
  ensure?: (c: Ctx) => void;
  /** Tidies up when the player moves on or skips. */
  leave?: (c: Ctx) => void;
  /** Steps without a check advance with a button. A function lets the button appear only when it makes sense. */
  manual?: boolean | ((c: Ctx) => boolean);
  nextLabel?: string;
  /** Runs when the button is tapped; false keeps the player on this step. */
  action?: (c: Ctx) => boolean;
  /** Optional steps can be skipped: the id of the step to continue with. */
  skipTo?: string;
  /** Glowing suggestions on the map: where a clubhouse, a tee and a green might go. */
  hint?: (c: Ctx) => { tee?: Pt; cup?: Pt; club?: Pt } | null;
  /** The step's work has been undone (a hole removed, the test golfers gone): go back to this step. */
  regressTo?: (c: Ctx) => string | null;
}

const PHASES = 6;

// ---- suggestions: helpful, never required ----
const clubSuggestion = (c: Ctx) => {
  if (!('club' in c.mark)) c.mark.club = suggestClubhouse(c.g.world);
  return c.mark.club as Pt | null;
};
/** The first hole the coach suggests, worked out once from the player's own clubhouse spot. */
const holeSuggestion = (c: Ctx) => {
  if (!('hole' in c.mark)) c.mark.hole = suggestFirstHole(c.g.world);
  return c.mark.hole as { tee: Pt; cup: Pt } | null;
};

/**
 * How far the first hole has got: 0 nothing, 1 New hole picked, 2 tee down, 3 preview showing, 4 built.
 * It is read from the editor, so a player who wanders off and back sees the instruction for where they actually are.
 */
const holeStage = (c: Ctx) => (c.g.world.holes.length ? 4 : c.e.proposal ? 3 : c.e.overlay.buildTee ? 2 : c.e.tool === 'build' ? 1 : 0);
const holeText = (c: Ctx) => ['Tap New hole in the tray.', 'Tap the glowing spot to place your tee.', 'Now tap the glowing green spot.', 'Happy with the preview? Tap Build.', 'Your first hole is built.'][holeStage(c)];
const holeTarget = (c: Ctx) => {
  const s = holeStage(c);
  return s === 0 ? ['#tools .ph-tools [data-tool="build"]', '#tools [data-tool="build"]'] : s === 3 ? ['#cfOk'] : [];
};
/** The tray must be up while the hole is being placed, including after a reload or a tap on Done. */
const holeEnsure = (c: Ctx) => {
  if (holeStage(c) >= 4 || c.ui.tab === 'build') return;
  const s = holeSuggestion(c);
  trayOpen(c, !c.mark.framed && s ? [s.tee, s.cup] : undefined);
  c.mark.framed = true;
};
const holeHint = (c: Ctx) => {
  const s = holeSuggestion(c), st = holeStage(c);
  if (!s || st > 2 || st === 0) return null;
  return st === 1 ? { tee: s.tee } : { cup: s.cup };
};

/** Tiles of one kind within a radius of a point. */
const near = (c: Ctx, p: Pt, r: number, kind: number) => {
  const w = c.g.world;
  let n = 0;
  for (let y = Math.floor(p.y - r); y <= p.y + r; y++)
    for (let x = Math.floor(p.x - r); x <= p.x + r; x++) if (x >= 0 && y >= 0 && x < w.w && y < w.h && w.terrain[y * w.w + x] === kind) n++;
  return n;
};
const first = (c: Ctx) => c.g.world.holes[0];
const closedHole = (c: Ctx) => c.g.world.holes.find((h) => !h.open);
const trayOpen = (c: Ctx, focus?: Pt[]) => {
  c.ui.tab = 'build';
  c.ui.traySet = 'course';
  c.ui.refresh(true);
  c.ui.onInsets();
  if (focus) c.e.focusPoints(focus);
};
/** The Holes sheet at half height, on the given hole, so a button inside it is on screen. */
const showHole = (c: Ctx, id: number | undefined) => {
  if (id !== undefined && c.g.selectedHole !== id) c.e.selectHole(id);
  if (c.ui.tab !== 'course') {
    c.ui.tab = 'course';
    if (c.ui.portraitSheet) c.ui.sheet = 'half';
    c.ui.refresh(true);
    c.ui.onInsets();
  } else if (c.ui.portraitSheet && c.ui.sheet !== 'half') c.ui.setSheet('half');
};
const hideSheet = (c: Ctx) => {
  if (c.ui.tab !== 'none') { c.ui.tab = 'none'; c.ui.refresh(true); c.ui.onInsets(); }
};
const lastResult = (c: Ctx) => [...c.g.testResults].reverse().find((r) => r.hole === first(c)?.id) ?? c.g.testResults[c.g.testResults.length - 1];

/**
 * The first-course tutorial: the player's own course, in the region they chose. Everything built here stays.
 * Time is held throughout (a new course is paused and closed until "Open for business"), and test golfers play regardless.
 */
const STEPS: Step[] = [
  {
    id: 'club',
    phase: 1,
    short: (c) => {
      const spot = c.e.clubSpot;
      if (spot?.problem) return 'That spot will not work. Tap Suggest a spot.';
      return spot && c.e.clubLocked ? 'Tap Build here to put your clubhouse down.' : 'Tap Suggest a spot, or tap the map where the clubhouse goes.';
    },
    enter: (c) => {
      const s = clubSuggestion(c);
      if (s) c.e.focusPoint({ x: s.x + CLUB_W / 2, y: s.y + CLUB_H / 2 }, 0.62);
    },
    target: (c) => (c.e.clubSpot && c.e.clubLocked && !c.e.clubSpot.problem ? ['#clubOk'] : ['#clubSuggest']),
    hint: (c) => {
      const s = clubSuggestion(c);
      return s && !c.e.clubLocked ? { club: { x: s.x + Math.floor(CLUB_W / 2), y: s.y + Math.floor(CLUB_H / 2) } } : null;
    },
    check: (c) => !!c.g.world.clubhouse,
  },
  {
    id: 'newhole',
    phase: 2,
    short: holeText,
    enter: (c) => {
      c.e.setNewPar(3);
      const s = holeSuggestion(c);
      trayOpen(c, s ? [s.tee, s.cup] : undefined);
    },
    ensure: holeEnsure,
    target: holeTarget,
    hint: holeHint,
    check: (c) => holeStage(c) >= 1,
  },
  { id: 'tee', phase: 2, short: holeText, ensure: holeEnsure, target: holeTarget, hint: holeHint, check: (c) => holeStage(c) >= 2 },
  {
    id: 'green',
    phase: 2,
    short: holeText,
    ensure: holeEnsure,
    target: holeTarget,
    hint: (c) => {
      const s = holeSuggestion(c);
      // once the tee is down, frame the tee and the glowing green together
      if (s && c.e.overlay.buildTee && !c.mark.cupShown) { c.mark.cupShown = true; c.e.focusPoints([s.tee, s.cup]); }
      return holeHint(c);
    },
    check: (c) => holeStage(c) >= 3,
  },
  { id: 'build', phase: 2, short: holeText, ensure: holeEnsure, target: holeTarget, check: (c) => holeStage(c) >= 4 && !c.e.proposal },
  {
    id: 'open',
    phase: 3,
    short: (c) => { const h = closedHole(c); return h ? `Tap Open hole to let golfers play ${h.name}.` : 'Your hole is open.'; },
    enter: (c) => { c.e.setTool('inspect'); c.g.exitDesign(); showHole(c, (closedHole(c) ?? first(c))?.id); },
    ensure: (c) => { const h = closedHole(c); if (h) showHole(c, h.id); },
    target: () => ['[data-act="open"]'],
    check: (c) => c.g.world.holes.length > 0 && c.g.world.holes.every((h) => h.open),
    regressTo: (c) => (c.g.world.holes.length ? null : 'newhole'),
  },
  {
    id: 'test',
    phase: 4,
    short: () => 'Tap Test golfers to send one out. It plays for free, and the clock stays paused.',
    enter: (c) => { c.mark.rn = c.g.testResults.length; showHole(c, first(c)?.id); },
    ensure: (c) => showHole(c, first(c)?.id),
    target: () => ['[data-act="testgolfers"]'],
    check: (c) => c.g.hasTestGolfers || c.g.testResults.length > ((c.mark.rn as number) ?? 0),
    skipTo: 'improve',
    regressTo: (c) => (c.g.world.holes.every((h) => h.open) && c.g.world.holes.length ? null : 'open'),
  },
  {
    id: 'watch',
    phase: 4,
    short: () => 'Watch your test golfer play the hole.',
    enter: (c) => {
      if (c.mark.rn === undefined) c.mark.rn = c.g.testResults.length;
      hideSheet(c);
      const t = c.g.sim.golfers.find((x) => x.test);
      if (t) c.g.followGolfer = t.id; else c.e.focusHole();
    },
    check: (c) => c.g.testResults.length > ((c.mark.rn as number) ?? 0),
    skipTo: 'improve',
    leave: (c) => { c.g.followGolfer = 0; },
    // nobody is playing and nothing came back (a reload, say): send the player back to try again
    regressTo: (c) => (!c.g.hasTestGolfers && c.g.testResults.length <= ((c.mark.rn as number) ?? 0) ? 'test' : null),
  },
  {
    id: 'result',
    phase: 4,
    short: (c) => {
      const r = lastResult(c);
      return r ? `${testResultLine(r)} ${testObservation(r)}` : 'Your test golfer finished the hole.';
    },
    enter: (c) => { c.g.followGolfer = 0; c.e.focusHole(); },
    manual: true,
    nextLabel: 'Next',
  },
  {
    id: 'improve',
    phase: 5,
    short: (c) => (c.e.proposal ? 'Tap Build to dig the bunker.' : 'Optional: hold a finger beside the green, then drag to dig a bunker.'),
    enter: (c) => {
      const h = first(c);
      c.mark.sand = h ? near(c, h.cup, 6, 4) : 0;
      c.e.setTool('bunker');
      trayOpen(c, h ? [{ x: h.cup.x - 3, y: h.cup.y - 3 }, { x: h.cup.x + 3, y: h.cup.y + 3 }] : undefined);
    },
    ensure: (c) => { if (c.ui.tab !== 'build') trayOpen(c); },
    target: (c) => (c.e.proposal ? ['#cfOk'] : []),
    check: (c) => { const h = first(c); return !!h && near(c, h.cup, 6, 4) >= (c.mark.sand as number) + 3 && !c.e.proposal; },
    leave: (c) => {
      // moving on from the optional step: put the bunker tool down but keep anything the player built
      if (!c.e.proposal) { c.e.setTool('inspect'); hideSheet(c); c.g.exitDesign(); }
    },
    skipTo: 'finish',
  },
  {
    id: 'finish',
    phase: 6,
    short: (c) => {
      const h = closedHole(c);
      return h ? `Editing closes a hole. Tap Open hole to reopen ${h.name}.` : 'Your course is ready. Open for business and welcome your first guests.';
    },
    enter: (c) => { c.e.setTool('inspect'); c.g.exitDesign(); const h = closedHole(c); if (h) showHole(c, h.id); else hideSheet(c); },
    ensure: (c) => { const h = closedHole(c); if (h) showHole(c, h.id); else if (c.ui.tab === 'course') hideSheet(c); },
    target: (c) => (closedHole(c) ? ['[data-act="open"]'] : []),
    manual: (c) => !closedHole(c),
    nextLabel: 'Open for business',
    action: (c) => c.g.openForBusiness(),
  },
];

const indexOf = (id: string) => STEPS.findIndex((s) => s.id === id);

/** The coach: one short instruction at a time, docked under the status bar, with a ring on the control or glow on the map spot to use. */
export class Tutorial {
  private card = document.createElement('div');
  private ctx: Ctx;
  private entered = -1;
  private ring: HTMLElement | null = null;
  private html = '';
  private doneFlash = 0;

  constructor(private g: Game, e: Editor, r: Renderer, private ui: UI) {
    this.ctx = { g, e, r, ui, mark: {} };
    this.card.id = 'coach';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-live', 'polite');
    document.getElementById('app')!.append(this.card);
    this.card.onclick = (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-coach]');
      if (!b) return;
      const act = b.dataset.coach;
      if (act === 'next') this.next();
      else if (act === 'skip') this.skip();
      else if (act === 'exit') this.exit();
      this.update(true);
      this.ui.onInsets();
    };
    // Touches on the card never reach the course underneath.
    this.card.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    if (this.active) g.settings.introSeen = true;
    window.addEventListener('resize', () => this.update(true));
  }

  get active() {
    return !this.g.tutorial.done;
  }

  private goTo(i: number) {
    const cur = STEPS[this.g.tutorial.step];
    cur?.leave?.(this.ctx);
    this.g.tutorial.step = i;
    this.g.dirtySave = true;
    if (i >= STEPS.length) this.finish();
  }
  private advance() { this.goTo(this.g.tutorial.step + 1); }
  private next() {
    const step = STEPS[this.g.tutorial.step];
    if (!step) return;
    if (step.action && !step.action(this.ctx)) return;
    // opening for business is the end of the tutorial
    if (step.action && this.g.settings.open) { this.finish(); return; }
    this.advance();
  }
  private skip() {
    const step = STEPS[this.g.tutorial.step];
    if (step?.skipTo) this.goTo(indexOf(step.skipTo));
  }
  /** Leave the walkthrough. The course stays exactly as it is, and the status bar offers Open for business. */
  exit() {
    STEPS[this.g.tutorial.step]?.leave?.(this.ctx);
    this.finish();
    if (!this.g.settings.open) this.g.notify('info', this.g.world.clubhouse ? 'Tutorial closed. Finish your course, then tap Open for business in the status bar.' : 'Tutorial closed. Place your clubhouse to begin.');
  }
  private finish() {
    this.g.tutorial.done = true;
    this.g.dirtySave = true;
    this.g.followGolfer = 0;
    this.clearRing();
    this.ctx.e.overlay.hint = null;
    this.card.hidden = true;
    document.body.classList.remove('coaching');
    this.ui.onInsets();
  }

  /** Close panels the step doesn't use. */
  private arrange() {
    const ui = this.ui;
    if (ui.tab !== 'none' && ui.tab !== 'build' && ui.tab !== 'course') { ui.tab = 'none'; ui.refresh(true); ui.onInsets(); }
  }

  /** Called a few times a second from the main loop. */
  update(force = false): void {
    if (!this.active) {
      if (!this.card.hidden) { this.card.hidden = true; this.clearRing(); document.body.classList.remove('coaching'); }
      return;
    }
    // Opening for business by any route (the status bar, say) ends the tutorial.
    if (this.g.settings.open) { this.finish(); return; }
    document.body.classList.add('coaching');
    this.card.hidden = this.ui.modalOpen;
    const t = this.g.tutorial;
    const step = STEPS[t.step];
    if (!step) { this.finish(); return; }
    const entering = this.entered !== t.step;
    if (entering) {
      this.entered = t.step;
      step.enter?.(this.ctx);
      this.arrange();
    }
    const back = step.regressTo?.(this.ctx);
    if (back && !entering) { this.goTo(indexOf(back)); this.update(true); return; }
    step.ensure?.(this.ctx);
    if (!entering && step.check && step.check(this.ctx)) {
      this.doneFlash = performance.now();
      this.advance();
      this.update(true);
      return;
    }
    const flash = performance.now() - this.doneFlash < 900;
    const manual = typeof step.manual === 'function' ? step.manual(this.ctx) : step.manual ?? !step.check;
    const html = `<div class="coach-title"><b>Tutorial</b><span class="coach-count">Step ${step.phase} of ${PHASES}</span></div><div class="coach-row"><p class="coach-short">${flash ? '✓ ' : ''}${step.short(this.ctx)}</p>${manual ? `<button class="btn primary coach-next" data-coach="next">${step.nextLabel ?? 'Next'}</button>` : ''}</div><div class="coach-foot">${step.skipTo ? '<button class="coach-x" data-coach="skip">Skip this step</button>' : ''}<button class="coach-x" data-coach="exit">Exit tutorial</button></div>`;
    if (force || entering || html !== this.html) {
      this.html = html;
      this.card.innerHTML = html;
      this.card.classList.toggle('flash', flash);
      this.ui.onInsets();
    }
    this.dock();
    this.ctx.e.overlay.hint = step.hint?.(this.ctx) ?? null;
    this.pointAt(step.target?.(this.ctx) ?? []);
  }

  /** Phones: the top of the screen is free, so the coach sits under the status bar and the bottom stays for building. */
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
