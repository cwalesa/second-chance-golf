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
  title: string;
  body: (c: Ctx) => string;
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

const touchWords = (c: Ctx) => c.ui.mobile || matchMedia('(pointer: coarse)').matches;

const STEPS: Step[] = [
  {
    title: 'Welcome to Willow Creek',
    body: () => `This is Level 1, your first course. It has seen better days. This walkthrough shows every control while you <b>restore two holes</b> and <b>build a brand-new one</b>. Each step tells you what to tap; the glowing ring shows where.`,
    nextLabel: "Let's start",
  },
  {
    title: 'Look around',
    body: (c) => touchWords(c)
      ? `<b>Drag one finger</b> to move the map. <b>Pinch</b> with two fingers to zoom (or use <b>+</b> and <b>−</b>). Moving the map never changes your course.`
      : `<b>Drag</b> to move the map and use the <b>mouse wheel</b> (or <b>+</b> and <b>−</b>) to zoom.`,
    enter: (c) => { c.mark.x = c.r.cam.x; c.mark.y = c.r.cam.y; c.mark.z = c.r.cam.zoom; },
    check: (c) => Math.hypot(c.r.cam.x - (c.mark.x as number), c.r.cam.y - (c.mark.y as number)) * c.r.cam.zoom > 80 && Math.abs(c.r.cam.zoom / (c.mark.z as number) - 1) > 0.08,
  },
  {
    title: 'Choose a hole',
    body: () => `The bar at the top shows the hole your hole tools work on, with its par, length and status. Tap <b>›</b> to go to hole 2, Cattail Carry.`,
    target: () => ['#holebar [data-hb="next"]'],
    check: (c) => c.g.selectedHole === 2,
  },
  {
    title: 'Open the Design tools',
    body: (c) => c.ui.mobile ? `Tap <b>Design</b> in the bottom bar. The tool tray opens above it.` : `The tool tray is along the bottom of the screen. Its groups are Terrain, Nature and Holes.`,
    target: (c) => (c.ui.mobile ? ['#nav [data-nav="build"]'] : []),
    check: (c) => !c.ui.mobile || c.ui.tab === 'build',
    nextLabel: 'Next',
  },
  {
    title: 'Restore hole 2: pick Repair',
    body: () => `Hole 2's green is worn to dirt. Tools come in three groups: <b>Terrain</b>, <b>Nature</b> and <b>Holes</b>. Tap <b>Nature</b>, then <b>Repair</b>.`,
    enter: (c) => { c.e.selectHole(2); const h = hole(c, 2); if (h) c.e.focusPoint(h.cup, 1.1); },
    target: (c) => toolTarget(c, 'repair'),
    check: (c) => c.e.tool === 'repair',
  },
  {
    title: 'Paint the repair',
    body: (c) => touchWords(c)
      ? `<b>Press and hold</b> on the brown green until the brush outline appears, then <b>drag</b> across it. A quick <b>tap</b> paints one spot. A drag <i>without</i> holding just moves the map, so you can't paint by accident. The <b>Brush</b> button cycles small, medium and large.`
      : `<b>Click and drag</b> across the brown green. S, M and L change the brush size.`,
    target: (c) => (c.e.tool === 'repair' ? ['#brushbar [data-brush="2"]'] : toolTarget(c, 'repair')),
    check: (c) => greenRepairs(c, c.e.batch.values()) >= 6 || c.g.undoStack.some((u) => greenRepairs(c, u.plan.tiles) >= 6),
  },
  {
    title: 'Review, then Build',
    body: (c) => `Nothing is built yet. The tinted tiles are a <b>preview</b>, and the bar shows how many tiles and what it costs. Keep painting to cover more of the green, then tap <b>Build</b> to pay. <b>Cancel</b> would throw it away for free.${c.e.proposal ? '' : ' (Paint a few tiles first.)'}`,
    target: (c) => (c.e.proposal ? ['#cfOk'] : []),
    check: (c) => { const p = c.g.undoStack.map((u) => u.plan).reverse().find((pl) => greenRepairs(c, pl.tiles) >= 6); if (p) c.mark.plan = p; return !!p && !c.e.proposal; },
  },
  {
    title: 'Undo a mistake',
    body: () => `Everything you build can be undone, and undo gives the money back. Tap <b>Undo</b> (the curved arrow at the top).`,
    enter: (c) => { if (!c.mark.plan) c.mark.plan = c.g.undoStack.map((u) => u.plan).reverse().find((pl) => greenRepairs(c, pl.tiles) >= 6); },
    target: () => ['#undoBtn'],
    check: (c) => !c.mark.plan || undoTop(c) !== c.mark.plan,
  },
  {
    title: '…and Redo',
    body: () => `Changed your mind again? <b>Redo</b> (the arrow beside it) puts the repair back.`,
    target: () => ['#redoBtn'],
    check: (c) => !c.mark.plan || undoTop(c) === c.mark.plan || c.g.undoStack.some((u) => u.plan === c.mark.plan),
  },
  {
    title: 'Reopen hole 2',
    body: (c) => `Working on a hole closes it so no golfer gets caught in the work. ${c.ui.mobile ? 'Tap <b>Holes</b> in the bottom bar, then' : 'In the Holes panel, tap'} <b>Open hole</b>. That's one hole restored.`,
    target: (c) => holeTarget(c, 2, panelTarget(c, '[data-act="open"]')),
    check: (c) => !!hole(c, 2)?.open,
  },
  {
    title: 'Hole 3 is overgrown',
    body: () => `Foxglove Run has been closed for years. Go to <b>hole 3</b> (the <b>›</b> in the top bar or its row in Holes). The Holes panel lists exactly what stops a hole opening. Tap <b>Fix with Fairway</b>.`,
    target: (c) => holeTarget(c, 3, panelTarget(c, '[data-act="issue"][data-mode="fix"]')),
    check: (c) => c.g.selectedHole === 3 && c.e.tool === 'fairway',
  },
  {
    title: 'Bridge the gap',
    body: (c) => {
      const v = c.g.validate(3);
      const why = v.ok ? 'Connected: the fairway runs from tee to green.' : c.e.proposal ? 'Looks connected? Tap Build to check.' : 'Still broken at the red ring.';
      return `The red ring marks where the fairway breaks. ${touchWords(c) ? 'Hold, then drag' : 'Drag'} fairway across the gap, three tiles wide, then tap <b>Build</b>. Fairway clears trees as it goes. Set <b>Brush</b> to <b>L</b> for wide strokes.<br><span class="coach-note">${why}</span>`;
    },
    enter: (c) => { c.e.selectHole(3); const b = c.g.validate(3).breakAt; if (b) c.e.focusPoint(b, 1); if (c.e.tool !== 'fairway') c.e.setTool('fairway'); },
    target: (c) => (c.e.proposal ? ['#cfOk'] : c.e.tool === 'fairway' ? ['#brushbar [data-brush="2"]'] : toolTarget(c, 'fairway')),
    check: (c) => c.g.validate(3).ok && !c.e.proposal,
  },
  {
    title: 'Open hole 3',
    body: (c) => `Every check passes. ${c.ui.mobile ? 'In <b>Holes</b>, tap' : 'Tap'} <b>Open hole</b> for Foxglove Run. Two holes restored!`,
    target: (c) => holeTarget(c, 3, panelTarget(c, '[data-act="open"]')),
    check: (c) => !!hole(c, 3)?.open,
  },
  {
    title: 'Build a new hole',
    body: (c) => `Now something of your own. In the open land shown here, choose <b>Holes → New hole</b>. Tap where the <b>tee</b> goes, then tap where the <b>green</b> goes, about two thumb-widths away. A gold preview shows the route, par and yards. Tap <b>Build</b>.${c.e.tool === 'build' && c.e.proposal ? ' Looks good? Tap Build.' : ''}`,
    enter: (c) => { c.mark.n = c.g.world.holes.length; c.e.focusPoint(NEW_HOLE_AREA, 0.55); },
    target: (c) => toolTarget(c, 'build'),
    check: (c) => c.g.world.holes.length > (c.mark.n as number) && !c.e.proposal,
  },
  {
    title: 'Move the cup',
    body: (c) => `Not quite right? With <b>Move cup</b>, tap a new spot for the green. A gold ghost shows the new pin before anything is built. Tap <b>Build</b> to cut the new green.${c.e.tool === 'cup' ? ' Tap the map near the green.' : ''}`,
    enter: (c) => { const h = newestHole(c); c.e.selectHole(h.id); c.mark.cup = `${h.cup.x},${h.cup.y}`; },
    target: (c) => toolTarget(c, 'cup'),
    check: (c) => { const h = hole(c, myId(c)); return !!h && `${h.cup.x},${h.cup.y}` !== c.mark.cup && !c.e.proposal; },
  },
  {
    title: 'Add a hazard',
    body: () => `Holes need character. Choose <b>Terrain → Bunker</b> and paint a bunker or two beside the green (hold, then drag), then <b>Build</b>. Keep a path of fairway open to the green or the hole can't open.`,
    enter: (c) => { c.mark.sand = sandNear(c); const h = hole(c, myId(c)); if (h) c.e.focusPoint(h.cup, 0.95); },
    target: (c) => toolTarget(c, 'bunker'),
    check: (c) => sandNear(c) >= (c.mark.sand as number) + 3 && !c.e.proposal,
  },
  {
    title: 'Open your hole',
    body: (c) => `${c.ui.mobile ? 'In <b>Holes</b>, tap' : 'Tap'} <b>Open hole</b>. If it can't open, the panel says why and <b>Show on map</b> takes you there.`,
    target: (c) => holeTarget(c, myId(c), panelTarget(c, '[data-act="open"]')),
    check: (c) => !!hole(c, myId(c))?.open,
  },
  {
    title: 'Send test golfers',
    body: () => `Let's watch real golfers try it. Tap <b>Send test golfers</b>. Three of them (a beginner, a regular and a skilled player) walk out and play your hole for free.`,
    target: (c) => holeTarget(c, myId(c), panelTarget(c, '[data-act="testgolfers"]')),
    check: (c) => c.g.sim.golfers.some((x) => x.test && x.route.includes(myId(c))) || c.g.testResults.some((r) => r.hole === myId(c)),
  },
  {
    title: 'Speed up time',
    body: (c) => `Use the speed buttons at the top: <b>II</b> pauses, <b>1×</b> is normal${c.ui.mobile && innerHeight > innerWidth ? '' : ', <b>3×</b> and <b>8×</b> are faster'}. Watch them play; their scores appear in the Holes panel.`,
    target: (c) => (c.g.settings.speed < 3 ? ['#speed [data-speed="8"]', '#speed [data-speed="1"]'] : []),
    check: (c) => c.g.testResults.some((r) => r.hole === myId(c)),
  },
  {
    title: 'Play it yourself',
    body: () => `Now you try. In Holes, tap <b>Play it</b>. Pick a club, tap <b>Start swing</b>, then tap again as the needle crosses the middle. Tap the map to aim somewhere else.`,
    target: (c) => (c.g.owner.active ? ['[data-owner="hit"]'] : holeTarget(c, myId(c), panelTarget(c, '[data-act="practice"]'))),
    check: (c) => c.g.owner.active && c.g.owner.strokes >= 1,
  },
  {
    title: 'Finish your round',
    body: () => `Play on as long as you like. Tap <b>Finish</b> to return to designing.`,
    target: (c) => (c.g.owner.active ? ['[data-owner="stop"]'] : []),
    check: (c) => !c.g.owner.active,
  },
  {
    title: 'Level 1 complete',
    body: () => `You restored two holes, built one, tested it and played it. Willow Creek is yours to keep shaping: add holes (up to nine), water, paths and trees. <b>Goals</b> lists rewards to chase. Everything saves on this device automatically.`,
    nextLabel: 'Finish tutorial',
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

/** Level 1's coach: one card, one ring, one thing to do at a time. */
export class Tutorial {
  private card = document.createElement('div');
  private ctx: Ctx;
  private entered = -1;
  private ring: HTMLElement | null = null;
  private html = '';
  private collapsed = false;
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
      if (act === 'next') this.advance();
      else if (act === 'fold') this.collapsed = !this.collapsed;
      else if (act === 'skip') {
        if (confirm('Skip the tutorial? You can keep designing Willow Creek freely.')) this.finish();
      }
      this.update(true);
    };
    if (this.active) {
      // The walkthrough runs with the clock stopped so guests and closing time never interrupt it.
      g.settings.introSeen = true;
      g.designMode = true;
      g.setSpeed(0);
    }
  }

  get active() {
    return !this.g.tutorial.done;
  }

  private advance() {
    this.g.tutorial.step++;
    this.g.dirtySave = true;
    if (this.g.tutorial.step >= STEPS.length) this.finish();
  }
  private finish() {
    this.g.tutorial.done = true;
    this.g.dirtySave = true;
    this.clearRing();
    this.card.hidden = true;
    document.body.classList.remove('coaching', 'coach-folded');
    this.g.notify('good', 'Level 1 is yours. Keep designing Willow Creek.');
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
    }
    if (!entering && step.check && step.check(this.ctx)) {
      this.doneFlash = performance.now();
      this.advance();
      this.update(true);
      return;
    }
    const flash = performance.now() - this.doneFlash < 900;
    const html = `<div class="coach-head"><span class="coach-count">${flash ? '✓ Done · ' : ''}Step ${t.step + 1} of ${STEPS.length}</span><span class="coach-tools"><button class="coach-skip" data-coach="skip">Skip</button><button class="coach-fold" data-coach="fold" aria-label="${this.collapsed ? 'Show instructions' : 'Hide instructions'}">${this.collapsed ? '▾' : '▴'}</button></span></div><h3>${step.title}</h3>${this.collapsed ? '' : `<p>${step.body(this.ctx)}</p>${step.check ? '' : `<div class="coach-actions"><button class="btn primary" data-coach="next">${step.nextLabel ?? 'Next'}</button></div>`}`}<div class="coach-bar"><i style="width:${(t.step / STEPS.length) * 100}%"></i></div>`;
    if (force || entering || html !== this.html) {
      const grew = this.html.length === 0 || entering || force;
      this.html = html;
      this.card.innerHTML = html;
      this.card.classList.toggle('collapsed', this.collapsed);
      document.body.classList.toggle('coach-folded', this.collapsed);
      this.card.classList.toggle('flash', flash);
      // Frame the map around the card, so whatever the step asks for is never hidden under it.
      if (grew) this.ui.onInsets();
    }
    if (entering) step.enter?.(this.ctx);
    this.pointAt(step.target?.(this.ctx) ?? []);
  }

  private pointAt(selectors: string[]) {
    let el: HTMLElement | null = null;
    for (const s of selectors) {
      const found = [...document.querySelectorAll<HTMLElement>(s)].find((x) => x.offsetParent !== null && x.getBoundingClientRect().width > 0);
      if (found) { el = found; break; }
    }
    if (el === this.ring) return;
    this.clearRing();
    if (el) {
      el.classList.add('coach-target');
      this.ring = el;
      // Scroll a highlighted panel button into view; the panel scrolls on its own, the page never does.
      const body = el.closest<HTMLElement>('#sidebody');
      if (body) {
        const er = el.getBoundingClientRect(), br = body.getBoundingClientRect();
        if (er.bottom > br.bottom - 12 || er.top < br.top + 12) body.scrollTop += er.top - br.top - br.height / 2 + er.height / 2;
      }
    }
  }
  private clearRing() {
    this.ring?.classList.remove('coach-target');
    this.ring = null;
  }
}

export const TUTORIAL_STEPS = STEPS.length;
