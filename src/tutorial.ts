import type { Game } from './game';
import type { Editor } from './input';
import type { Renderer } from './render';
import type { UI } from './ui';
import { Pt, holePath, holeYards } from './terrain';
import { lieAt } from './physics';
import { CLUBS, ClubId } from './owner';
import { OPENING } from './opening';
import { tapWord } from './device';
import { suggestFirstHole } from './wilderness';

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
  /** A little more help, shown only when the player expands the strip. Touch gestures are described exactly. */
  more?: string;
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
  /** Glowing suggestions on the map: where a clubhouse, a tee and a green might go, or rings around spots to aim at. */
  hint?: (c: Ctx) => { tee?: Pt; cup?: Pt; club?: Pt; marks?: { at: Pt; r: number; text: string }[] } | null;
  /** The player is struggling: offer a Retry hole button that starts the hole again from the tee. */
  retry?: (c: Ctx) => boolean;
  /** The step's work has been undone (a hole removed, the test golfers gone): go back to this step. */
  regressTo?: (c: Ctx) => string | null;
}

const PHASES = 6;
const HOLE_MORE = 'Tap the glowing spots, or any open ground. Once the tee and green are down you can drag the T or G marker and pick par 3, 4 or 5. Nothing is charged until you tap Build.';

// ---- suggestions: helpful, never required ----
/** The first hole the coach suggests, worked out once from the player's own clubhouse spot. */
const holeSuggestion = (c: Ctx) => {
  if (!('hole' in c.mark)) c.mark.hole = suggestFirstHole(c.g.world);
  return c.mark.hole as { tee: Pt; cup: Pt } | null;
};

/**
 * How far the first hole has got: 0 nothing, 1 New hole picked, 2 tee down, 3 preview showing, 4 built.
 * It is read from the editor, so a player who wanders off and back sees the instruction for where they actually are.
 */
const holeStage = (c: Ctx) => ((c.mark.holesAt !== undefined ? c.g.world.holes.length > (c.mark.holesAt as number) : c.g.world.holes.length > 1) ? 4 : c.e.proposal ? 3 : c.e.overlay.buildTee ? 2 : c.e.tool === 'build' ? 1 : 0);
const holeText = (c: Ctx) => { const t = tapWord(); return [`Now build a second hole. ${t} New hole in the tray.`, `${t} the glowing spot to place the tee.`, `Now ${t.toLowerCase()} the glowing green spot.`, `Happy with the preview? ${t} Build.`, 'Your second hole is built.'][holeStage(c)]; };
const holeTarget = (c: Ctx) => {
  const s = holeStage(c);
  return s === 0 ? ['#tools .ph-tools [data-tool="build"]', '#tools [data-tool="build"]'] : s === 3 ? ['#cfOk'] : [];
};
/** The tray must be up while the hole is being placed, including after a reload or a tap on Done. */
const holeEnsure = (c: Ctx) => {
  const st = holeStage(c);
  if (st >= 4) return;
  const s = holeSuggestion(c);
  if (c.ui.tab !== 'build') {
    trayOpen(c, !c.mark.framed && s ? [s.tee, s.cup] : undefined);
    c.mark.framed = true;
  } else if (s && st >= 1 && st <= 2 && !c.e.proposal) {
    // a glowing spot that has slid off screen (the player panned or zoomed) is brought back, once for each stage, before they need it
    const key = `seen${st}`;
    const spot = st === 1 ? s.tee : s.cup;
    const p = c.r.toScreen(spot.x + 0.5, spot.y + 0.5), ins = c.r.insets;
    const inside = p.x > ins.l + 24 && p.x < c.r.cw - ins.r - 24 && p.y > ins.t + 24 && p.y < c.r.ch - ins.b - 24;
    if (!inside && !c.mark[key] && !c.r.cameraMoving && !c.e.interacting) { c.mark[key] = true; c.e.focusPoints([s.tee, s.cup]); }
  }
};
const holeHint = (c: Ctx) => {
  const s = holeSuggestion(c), st = holeStage(c);
  if (!s || st > 2 || st === 0) return null;
  return st === 1 ? { tee: s.tee } : { cup: s.cup };
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
/**
 * While a step asks for one button in the hole panel, the panel shows only the hole's summary and that button: no other
 * actions, no sections below. Cleared when the step ends. (The stylesheet does the hiding, keyed on body[data-tut-only].)
 */
const only = (act: string | null) => {
  const b = document.body;
  if (act) { if (b.dataset.tutOnly !== act) b.dataset.tutOnly = act; } else if (b.dataset.tutOnly) delete b.dataset.tutOnly;
};

// ---- the opening round: helpers ----
/** Instructions say Tap on a touch screen and Click with a mouse. */
const tap = () => tapWord();
const tapl = () => tapWord().toLowerCase();
/** The hole the tutorial plays: the opening par 4 (hole 1), or the first hole an older course has. */
const opening = (c: Ctx) => c.g.world.holes.find((h) => h.id === 1) ?? c.g.world.holes[0];
const owner = (c: Ctx) => c.g.owner;
const inRound = (c: Ctx) => { const h = opening(c); return !!h && c.g.owner.active && c.g.owner.holeId === h.id; };
/** The landing area for the drive: along the route, about where a good drive finishes (the driver carries 25 tiles). */
function zone(c: Ctx): { at: Pt; r: number } | null {
  const h = opening(c);
  if (!h) return null;
  const path = holePath(h);
  const total = path.reduce((s, p, i) => (i ? s + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) : 0), 0);
  let want = Math.min(OPENING.landingAt, total * 0.64);
  for (let i = 1; i < path.length; i++) {
    const seg = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    if (want <= seg) return { at: { x: path[i - 1].x + ((path[i].x - path[i - 1].x) * want) / seg, y: path[i - 1].y + ((path[i].y - path[i - 1].y) * want) / seg }, r: OPENING.landingRadius };
    want -= seg;
  }
  return { at: path[path.length - 1], r: OPENING.landingRadius };
}
const cupOf = (c: Ctx) => { const h = opening(c); return h ? { x: h.cup.x + 0.5, y: h.cup.y + 0.5 } : null; };
const near = (a: Pt | null, b: Pt | null, r: number) => !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) <= r;
/** One short line about where the last shot finished, from what actually happened. */
function lastShot(c: Ctx): string {
  const L = owner(c).landing;
  if (!L) return '';
  if (L.penalty) return `Into the water: one penalty stroke, and the ball is dropped. ${L.left} yd to go.`;
  const where: Record<string, string> = { fairway: 'In the fairway', rough: 'In the light rough (it costs a little distance)', bunker: 'In the sand (it costs a little distance)', green: 'On the green', tee: 'Still near the tee' };
  return `${where[L.lie] ?? 'Safe'}, ${L.left} yd from the pin.`;
}
/** Short of the target, help after a few extra shots: what to try, and that the hole can be started again. */
function struggleTip(c: Ctx): string {
  const o = owner(c), h = opening(c);
  if (!h || o.strokes < h.par + 2) return '';
  return ' Tip: aim at the middle of the green, and strike when the marker is centred. Or retry the hole.';
}
const struggling = (c: Ctx) => { const h = opening(c); return !!h && owner(c).strokes >= h.par + 2 && !owner(c).completed; };
const clubName = (id: ClubId) => CLUBS[id].name;
const HUD = (sel: string) => [`#owner-hud ${sel}`];

/**
 * The tutorial: play the opening hole first (aim, swing, follow the ball, approach, putt), one action at a time, then build a
 * second hole and open for business with the game's own tools. Every step advances on what the player actually did.
 * Time is held throughout: a new course is paused and closed until "Open for business".
 */
export const STEPS: Step[] = [
  {
    id: 'meet',
    phase: 1,
    more: 'Your ball starts on the tee box. The fairway is the short grass that leads to the green, where the flag marks the hole. Fewer shots is better: par is the number a good player takes.',
    short: (c) => { const h = opening(c); return h ? `This is hole 1, a par 4 of ${holeYards(h)} yards. Get your ball from the tee into the hole in as few shots as you can.` : 'Your course needs a hole to play.'; },
    enter: (c) => { hideSheet(c); c.e.setTool('inspect'); const h = opening(c); if (h) { c.e.selectHole(h.id); c.e.focusHole(); } },
    hint: (c) => { const h = opening(c), z = zone(c); return h && z ? { marks: [{ at: { x: h.tee.x + 0.5, y: h.tee.y + 0.5 }, r: 1.6, text: 'Your ball: the tee' }, { at: z.at, r: z.r, text: 'Fairway' }, { at: { x: h.cup.x + 0.5, y: h.cup.y + 0.5 }, r: 2.6, text: 'Green and hole' }] } : null; },
    manual: (c) => !!opening(c),
    nextLabel: 'Play the hole',
    action: (c) => { const h = opening(c); if (!h) return false; c.g.selectedHole = h.id; c.g.owner.start(c.g, false, true); c.e.focusHole(); return true; },
  },
  {
    id: 'aim',
    phase: 2,
    more: 'The dashed line shows where the ball will go. A shot flies toward the spot you pick, as far as the club reaches. The Driver reaches about 250 yards, so aim at the wide part of the fairway rather than straight at the flag.',
    short: (c) => {
      const o = owner(c), z = zone(c);
      if (o.aim && z && !near(o.landingPoint(c.g), z.at, z.r + 1.5)) return 'That would land outside the landing area. Aim at the highlighted fairway.';
      return `${tap()} the highlighted fairway to aim your drive.`;
    },
    hint: (c) => { const z = zone(c); return z ? { marks: [{ at: z.at, r: z.r, text: 'Aim here' }] } : null; },
    check: (c) => { const o = owner(c), z = zone(c); return inRound(c) && o.shots === 0 && !!z && near(o.landingPoint(c.g), z.at, z.r + 1.5); },
    regressTo: (c) => (inRound(c) ? null : 'meet'),
  },
  {
    id: 'swing',
    phase: 3,
    more: 'The swing has two taps. The first starts it; a marker then sweeps across the timing bar. The second strikes the ball.',
    short: () => `The Driver is selected. ${tap()} Start swing.`,
    target: () => HUD('[data-owner="hit"]'),
    check: (c) => owner(c).swing.active || owner(c).shots > 0,
    regressTo: (c) => { const o = owner(c), z = zone(c); return !inRound(c) ? 'meet' : o.shots === 0 && !(z && near(o.landingPoint(c.g), z.at, z.r + 1.5)) ? 'aim' : null; },
  },
  {
    id: 'strike',
    phase: 3,
    more: 'Striking early pulls the ball left, late pushes it right. Strike in the middle of the bar for a straight shot.',
    short: () => `Now ${tapl()} Strike as the marker crosses the centre line.`,
    target: () => [...HUD('[data-owner="hit"]'), ...HUD('.swing-rail')],
    check: (c) => owner(c).shots > 0,
    regressTo: (c) => (!inRound(c) ? 'meet' : !owner(c).swing.active && owner(c).shots === 0 ? 'swing' : null),
  },
  {
    id: 'flight',
    phase: 3,
    short: () => 'Watch the ball. The camera follows it.',
    manual: false,
    check: (c) => owner(c).shots > 0 && !owner(c).flight,
    regressTo: (c) => (inRound(c) ? null : 'meet'),
  },
  {
    id: 'sort',
    phase: 4,
    // where the round goes next depends on where the ball finished: in the hole, on the green, or still short of it
    short: () => 'Lining up the next shot…',
    manual: false,
    regressTo: (c) => (!inRound(c) && !owner(c).completed ? 'meet' : owner(c).completed ? 'done' : lieAt(c.g.world, owner(c).ball.x, owner(c).ball.y).kind === 'green' ? 'putt-aim' : 'club2'),
  },
  {
    id: 'club2',
    phase: 4,
    more: 'Each club button shows how far it reaches. Pick one that reaches the green: too little club leaves you short, and the Driver is hard to control this close.',
    short: (c) => { const s = owner(c).suggestedClub(c.g); return `${lastShot(c)} Pick the ${clubName(s)}: it reaches about ${Math.round(CLUBS[s].reach * 10)} yd.${struggleTip(c)}`; },
    target: (c) => HUD(`[data-club="${owner(c).suggestedClub(c.g)}"]`),
    check: (c) => owner(c).club === owner(c).suggestedClub(c.g),
    regressTo: (c) => (!inRound(c) ? 'meet' : lieAt(c.g.world, owner(c).ball.x, owner(c).ball.y).kind === 'green' ? 'putt-aim' : null),
    retry: struggling,
  },
  {
    id: 'aim2',
    phase: 4,
    more: 'Aim at the middle of the green rather than the flag: there is more room to land, and a bunker guards one side.',
    short: (c) => (owner(c).aim && !near(owner(c).aim, cupOf(c), OPENING.green + 2) ? 'Aim at the green: the highlighted ring.' : `${tap()} the green to aim your approach.${struggleTip(c)}`),
    hint: (c) => { const cp = cupOf(c); return cp ? { marks: [{ at: cp, r: OPENING.green, text: 'Green' }] } : null; },
    check: (c) => near(owner(c).aim, cupOf(c), OPENING.green + 2),
    enter: (c) => { c.mark.shotsAt = owner(c).shots; },
    regressTo: (c) => (!inRound(c) ? 'meet' : owner(c).club !== owner(c).suggestedClub(c.g) && owner(c).suggestedClub(c.g) !== 'putter' ? 'club2' : null),
    retry: struggling,
  },
  {
    id: 'swing2',
    phase: 4,
    short: (c) => `${tap()} Start swing, then Strike on the centre line.${struggleTip(c)}`,
    target: () => HUD('[data-owner="hit"]'),
    enter: (c) => { c.mark.shotsAt = owner(c).shots; },
    check: (c) => owner(c).shots > ((c.mark.shotsAt as number) ?? 0) && !owner(c).flight,
    regressTo: (c) => (!inRound(c) ? 'meet' : !owner(c).flight && owner(c).shots === ((c.mark.shotsAt as number) ?? 0) && !near(owner(c).aim, cupOf(c), OPENING.green + 2) ? 'aim2' : null),
    retry: struggling,
  },
  // after the approach: back to the sorting step, which sends the player on to the green or to another approach
  { id: 'sort2', phase: 4, short: () => 'Lining up the next shot…', manual: false, regressTo: () => 'sort' },
  {
    id: 'putt-aim',
    phase: 5,
    more: 'Putts roll along the green. Aim right at the hole; the closer you are, the more often it drops.',
    short: (c) => `${lastShot(c)} The Putter is selected for you on the green. ${tap()} the hole to aim your putt.${struggleTip(c)}`,
    hint: (c) => { const cp = cupOf(c); return cp ? { marks: [{ at: cp, r: 0.8, text: 'The hole' }] } : null; },
    check: (c) => near(owner(c).aim, cupOf(c), 0.8),
    regressTo: (c) => (!inRound(c) && !owner(c).completed ? 'meet' : owner(c).completed ? 'done' : null),
    retry: struggling,
  },
  {
    id: 'putt',
    phase: 5,
    short: (c) => `Start the swing, then Strike. A centred strike holes more putts.${struggleTip(c)}`,
    target: () => HUD('[data-owner="hit"]'),
    enter: (c) => { c.mark.shotsAt = owner(c).shots; },
    check: (c) => owner(c).shots > ((c.mark.shotsAt as number) ?? 0) && !owner(c).flight,
    regressTo: (c) => (!inRound(c) && !owner(c).completed ? 'meet' : !owner(c).flight && owner(c).shots === ((c.mark.shotsAt as number) ?? 0) && !near(owner(c).aim, cupOf(c), 0.8) ? 'putt-aim' : null),
    retry: struggling,
  },
  { id: 'sort3', phase: 5, short: () => 'Lining up the next shot…', manual: false, regressTo: () => 'sort' },
  {
    id: 'done',
    phase: 6,
    short: (c) => {
      const o = owner(c), h = opening(c), s = o.scores[o.scores.length - 1];
      const strokes = s?.strokes ?? o.strokes, par = h?.par ?? 4, d = strokes - par;
      const word = d <= -2 ? 'an eagle' : d === -1 ? 'a birdie' : d === 0 ? 'par' : d === 1 ? 'a bogey' : `${d} over par`;
      return `${strokes} shots on a par ${par}: ${word}. That is your first hole done!${c.g.tutorial.replay ? '' : ' Next, make the course ready for golfers.'}`;
    },
    manual: true,
    nextLabel: 'Continue',
    action: (c) => {
      if (c.g.owner.active) c.g.owner.stop(c.g);
      if (!c.mark.paid && !c.g.tutorial.replay && !c.g.campaign.claimed.includes('opening-round')) {
        c.mark.paid = true;
        c.g.campaign.claimed.push('opening-round');
        c.g.earn('bonus', 400, 'Your first round on the opening hole');
        c.g.cheer({ kind: 'request', title: 'First hole played', sub: 'A gift from the club to celebrate your first round.', reward: 400 });
      }
      c.e.focusHole();
      return true;
    },
  },
  {
    id: 'newhole',
    more: 'Tap the glowing spots, or any open ground on your land. Once the tee and green are down you can move either end and pick par 3, 4 or 5. Nothing is charged until you tap Build.',
    phase: 6,
    short: holeText,
    enter: (c) => {
      c.mark.holesAt ??= c.g.world.holes.length;
      c.e.setNewPar(3);
      const s = holeSuggestion(c);
      trayOpen(c, s ? [s.tee, s.cup] : undefined);
    },
    ensure: holeEnsure,
    target: holeTarget,
    hint: holeHint,
    check: (c) => holeStage(c) >= 1,
    skipTo: 'finish',
  },
  { id: 'tee', phase: 6, more: HOLE_MORE, short: holeText, ensure: holeEnsure, target: holeTarget, hint: holeHint, check: (c) => holeStage(c) >= 2, skipTo: 'finish' },
  { id: 'green', phase: 6, more: HOLE_MORE, short: holeText, ensure: holeEnsure, target: holeTarget, hint: holeHint, check: (c) => holeStage(c) >= 3, skipTo: 'finish' },
  { id: 'build', phase: 6, more: HOLE_MORE, short: holeText, ensure: holeEnsure, target: holeTarget, hint: holeHint, check: (c) => holeStage(c) >= 4 && !c.e.proposal, skipTo: 'finish' },
  {
    id: 'open',
    more: 'An open hole is ready for golfers. The business clock stays paused until you choose Open for business.',
    phase: 6,
    short: (c) => { const h = closedHole(c); return h ? `${tap()} Open hole to let golfers play ${h.name}.` : 'Your new hole is open.'; },
    enter: (c) => { c.e.setTool('inspect'); c.g.exitDesign(); only('open'); showHole(c, (closedHole(c) ?? first(c))?.id); c.e.focusHole(); },
    ensure: (c) => { const h = closedHole(c); if (h) showHole(c, h.id); },
    leave: () => only(null),
    target: () => ['[data-act="open"]'],
    check: (c) => c.g.world.holes.length > 1 && c.g.world.holes.every((h) => h.open),
    regressTo: (c) => (c.g.world.holes.length > 1 ? null : 'newhole'),
    skipTo: 'finish',
  },
  {
    id: 'finish',
    more: 'Opening for business starts the clock. Guests arrive, pay green fees and play your open holes. You can pause or keep designing at any time.',
    phase: 6,
    short: (c) => {
      const h = closedHole(c);
      return h ? `Building closes a hole. ${tap()} Open hole to reopen ${h.name}.` : 'Your course is ready. Open for business and welcome your first golfers.';
    },
    enter: (c) => { c.e.setTool('inspect'); c.g.exitDesign(); const h = closedHole(c); only(h ? 'open' : null); if (h) showHole(c, h.id); else hideSheet(c); },
    ensure: (c) => { const h = closedHole(c); only(h ? 'open' : null); if (h) showHole(c, h.id); else if (c.ui.tab === 'course') hideSheet(c); },
    leave: () => only(null),
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
  /** The strip is one line; expanded, it adds a little help and the Exit option. */
  private expanded = false;
  /** When the step last changed: a second tap that lands just after a step advances must not advance another. */
  private stepAt = 0;
  private inUpdate = false;
  private shownStep = -1;

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
      if (act === 'more') { this.expanded = !this.expanded; this.update(true); this.ui.onInsets(); return; }
      if (performance.now() - this.stepAt < 400) return; // a double tap must not run two steps
      if (act === 'next') this.next();
      else if (act === 'skip') this.skip();
      else if (act === 'exit') this.exit();
      else if (act === 'retry') this.retryHole();
      this.update(true);
      this.ui.onInsets();
    };
    // Touches on the card never reach the course underneath.
    this.card.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    if (this.active) g.settings.introSeen = true;
    window.addEventListener('resize', () => this.update(true));
  }

  private poked = false;
  /** Bring the guidance up to date on the very next frame: called whenever the game or the editor changes, so an instruction never lags the action. */
  poke() {
    if (this.poked || !this.active) return;
    this.poked = true;
    requestAnimationFrame(() => { this.poked = false; this.update(); });
  }
  static reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  get active() {
    return !this.g.tutorial.done;
  }

  private goTo(i: number) {
    const cur = STEPS[this.g.tutorial.step];
    cur?.leave?.(this.ctx);
    this.g.tutorial.step = i;
    this.stepAt = performance.now();
    this.expanded = false;
    this.g.dirtySave = true;
    if (i >= STEPS.length) this.finish();
  }
  private advance() { this.goTo(this.g.tutorial.step + 1); }
  private next() {
    const step = STEPS[this.g.tutorial.step];
    if (!step) return;
    if (step.action && !step.action(this.ctx)) return;
    // opening for business is the end of the tutorial
    if (step.action && this.g.settings.open && !this.g.tutorial.replay) { this.finish(); return; }
    // a replay ends once the opening hole has been played again
    if (this.g.tutorial.replay && step.id === 'done') { this.finish(); this.g.notify('good', 'Tutorial replayed. Your course is just as you left it.'); return; }
    this.advance();
  }
  private skip() {
    const step = STEPS[this.g.tutorial.step];
    if (step?.skipTo) this.goTo(indexOf(step.skipTo));
  }
  /** Start the opening hole again from the tee, keeping everything else: the player's way out of a bad hole. */
  retryHole() {
    const o = this.g.owner;
    if (o.active) o.restartHole(this.g);
    else { const h = opening(this.ctx); if (h) { this.g.selectedHole = h.id; o.start(this.g, false, true); } }
    this.ctx.e.focusHole();
    this.goTo(indexOf('aim'));
  }
  /** The practice panel's Retry hole was used during the round: back to aiming the drive. */
  retried() {
    if (!this.active) return;
    const id = STEPS[this.g.tutorial.step]?.id ?? '';
    if (['aim', 'swing', 'strike', 'flight', 'sort', 'club2', 'aim2', 'swing2', 'sort2', 'putt-aim', 'putt', 'sort3'].includes(id)) this.goTo(indexOf('aim'));
  }
  /** Replay from the menu: play the opening hole again with the coach. The course is untouched and nothing is paid twice. */
  replay() {
    if (this.g.owner.active) this.g.owner.stop(this.g);
    this.g.tutorial = { step: 0, done: false, v: this.g.tutorial.v ?? 3, replay: true };
    this.entered = -1;
    this.ctx.mark = {};
    this.card.hidden = false;
    this.g.dirtySave = true;
    this.update(true);
    this.ui.onInsets();
  }
  /** Leave the walkthrough. The course stays exactly as it is, and the status bar offers Open for business. */
  exit() {
    STEPS[this.g.tutorial.step]?.leave?.(this.ctx);
    if (this.g.owner.active && this.g.owner.guided) this.g.owner.stop(this.g);
    this.finish();
    if (!this.g.settings.open) this.g.notify('info', this.g.world.clubhouse ? 'Tutorial closed. Finish your course, then tap Open for business at the top of the screen.' : 'Tutorial closed. Place your clubhouse to begin.');
  }
  private finish() {
    this.g.tutorial.done = true;
    this.g.tutorial.replay = false;
    this.g.dirtySave = true;
    this.g.followGolfer = 0;
    this.clearRing();
    this.ctx.e.overlay.hint = null;
    this.card.hidden = true;
    document.body.classList.remove('coaching', 'tut-edit');
    delete document.body.dataset.tutOnly;
    document.documentElement.style.setProperty('--coach-h', '0px');
    this.ui.onInsets();
  }

  /** Close panels the step doesn't use. */
  private arrange() {
    const ui = this.ui;
    if (ui.tab !== 'none' && ui.tab !== 'build' && ui.tab !== 'course') { ui.tab = 'none'; ui.refresh(true); ui.onInsets(); }
  }

  /** Called a few times a second from the main loop. */
  update(force = false): void {
    if (this.inUpdate) return; // steps call the interface, which may ask for an update: never re-enter
    this.inUpdate = true;
    try { this.updateNow(force); } finally { this.inUpdate = false; }
  }
  private updateNow(force: boolean): void {
    if (!this.active) {
      if (!this.card.hidden) { this.card.hidden = true; this.clearRing(); document.body.classList.remove('coaching'); }
      return;
    }
    // Opening for business by any route (the status bar, say) ends the tutorial (a replay runs on an open course).
    if (this.g.settings.open && !this.g.tutorial.replay) { this.finish(); return; }
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
    if (back && !entering) { this.goTo(indexOf(back)); this.updateNow(true); return; }
    step.ensure?.(this.ctx);
    if (!entering && step.check && step.check(this.ctx)) {
      this.advance();
      this.updateNow(true);
      return;
    }
    const manual = typeof step.manual === 'function' ? step.manual(this.ctx) : step.manual ?? !step.check;
    const text = step.short(this.ctx);
    // the strip's frame only changes when its controls do; the instruction itself is swapped in place, at once
    const retry = !!step.retry?.(this.ctx);
    const first = t.step === 0;
    const frame = `<div class="coach-strip ${manual && text.length > 70 ? 'stack' : ''}"><span class="coach-step" aria-label="Step ${step.phase} of ${PHASES}">${step.phase}/${PHASES}</span><p class="coach-short"></p>${retry ? '<button class="btn coach-retry" data-coach="retry">Retry hole</button>' : ''}${manual ? `<button class="btn primary coach-next" data-coach="next">${step.nextLabel ?? 'Next'}</button>` : ''}${step.skipTo ? '<button class="coach-x" data-coach="skip">Skip</button>' : ''}<button class="coach-more-btn" data-coach="more" aria-expanded="${this.expanded}" aria-label="${this.expanded ? 'Less help' : 'More help and options'}">${this.expanded ? '▴' : '▾'}</button></div>${first && !this.expanded ? '<div class="coach-foot coach-first"><button class="coach-x" data-coach="exit">Skip tutorial</button><span>Replay it any time from the menu.</span></div>' : ''}${this.expanded ? `<div class="coach-more"><p>${step.more ?? 'Follow the highlighted control or the glowing spot on the map.'}</p><div class="coach-foot">${step.skipTo ? '<button class="coach-x" data-coach="skip">Skip this step</button>' : ''}<button class="coach-x" data-coach="exit">Skip tutorial</button></div></div>` : ''}`;
    if (force || entering || frame !== this.html) {
      this.html = frame;
      this.card.innerHTML = frame;
      this.ui.onInsets();
    }
    const p = this.card.querySelector<HTMLElement>('.coach-short');
    if (p && p.textContent !== text) {
      p.textContent = text;
      // a new step eases its words in; the strip itself stays put
      if (this.shownStep !== t.step && !Tutorial.reduced) p.animate([{ opacity: 0.15, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
    }
    this.shownStep = t.step;
    this.dock();
    document.documentElement.style.setProperty('--coach-h', `${Math.round(this.card.getBoundingClientRect().height)}px`);
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
