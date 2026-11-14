import { projectGround } from './isometric';
import { Game, fmtMoney } from './game';
import { Renderer, Overlay, BendUi } from './render';
import { ITEMS, ItemKind, buildingProblem, isAmenity, isBuilding, itemAt, moveItem, moveProblem, toggleItem } from './items';
import { lotFor } from './lots';
import { BRUSH_RADII, EditPlan, PAINT_TOOLS, TOOL_INFO, TileEdit, ToolId, blockReason, brushTiles, mergeEdit, insertBend, bendProblem, moveBendTo, removeBendAt, suggestBend, planBends, routeStats, planMoveCup, planMoveTee, planNewHole, planPaint, planTile, stagedState } from './editing';
import { CFG } from './config';
import { clubDims, Hole, MAX_BENDS, Pt, holeBends, idx, inBounds } from './terrain';
import { clubhouseProblem, relocateProblem, suggestClubhouse } from './wilderness';

export interface Preview {
  tool: ToolId;
  label: string;
  tiles: number;
  cost: number;
  affordable: boolean;
  message: string;
  stroking: boolean;
  limited: boolean;
}

type Mode = 'none' | 'pan' | 'inspect' | 'paint' | 'place' | 'pinch' | 'hold' | 'handle';

/** Touch gestures: a finger must stay within SLOP pixels to count as a tap or a hold. */
const SLOP = 10;
/** How long a finger rests before a drag paints instead of panning. */
export const HOLD_MS = 320;
/** A shorter hold picks up a bend handle: long enough to tell a grab from a pan, short enough to feel direct. */
export const BEND_HOLD_MS = 170;
/** How far above the fingertip a held pin rides on touch screens, in pixels. */
const BEND_LIFT = 52;

interface BendSnap { pending: EditPlan | null; newBends: Pt[]; tee: Pt | null; cup: Pt | null }
interface BendDrag {
  kind: 'tee' | 'cup' | 'bend';
  i: number;
  touch: boolean;
  /** Touch: true once the hold finished. Mouse: immediately. */
  engaged: boolean;
  moved: boolean;
  /** The layout changed during this drag, so aborting must restore it. */
  dirty: boolean;
  t0: number;
  moveAt: number;
  /** The pin tip in map coordinates, following the pointer continuously. */
  tip: Pt;
  /** The last tile that made a valid layout. */
  tile: Pt;
  /** The tile under the tip now, and the last one checked. */
  cur: Pt;
  tried: Pt;
  attempt: Pt | null;
  problem: string | null;
  ptr: Pt;
  grabOff: Pt;
  snap: BendSnap;
  panAt?: number;
}

/** Distance from a point to the capsule of a pin: its round head, its stem and its tip. */
function distToSegment(p: Pt, a: Pt, b: Pt, r: number): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1)));
  return Math.max(0, Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t)) - r);
}

export class Editor {
  tool: ToolId;
  brush: number;
  overlay: Overlay = { bendUi: null, tool: 'inspect', hoverTiles: [], changed: new Set(), blocked: new Set(), staged: new Set(), stagedKind: new Map(), tooExpensive: false, hoverPt: null, parcel: null, buildTee: null, buildLine: null, ghost: null, club: null, hint: null, hold: null, bGhost: null };
  /** Parcel picked with the Land tool. */
  parcel: { col: number; row: number } | null = null;
  /** A tee, cup, dogleg or new-hole plan waiting for the player to confirm. */
  pending: EditPlan | null = null;
  /** Terrain strokes painted so far but not yet built. They stack until the player builds or cancels. */
  readonly batch = new Map<number, TileEdit>();
  private batchCost = 0;
  private batchTools = new Map<ToolId, number>();
  private strokeUndo = new Map<number, TileEdit | undefined>();
  private proposalCache: { rev: number; plan: EditPlan | null } = { rev: -1, plan: null };
  private rev = 0;
  private buildTee: Pt | null = null;
  private buildCup: Pt | null = null;
  /** The par chosen for the next new hole, picked before or after placing it. */
  newPar = 4;
  /** Turning points on the new hole being planned. */
  newBends: Pt[] = [];
  /** Called after a plan is built, so the interface can offer a quick Undo. */
  onBuilt: (label: string, cost: number) => void = () => {};
  /** A building waiting for Build (or Sell, when tapping one already standing). */
  bGhost: { x: number; y: number; k: ItemKind; sell: boolean; /** index of the placed thing being moved */ move?: number; from?: Pt } | null = null;
  bProblem: string | null = null;
  syncGhost() {
    const g = this.bGhost;
    if (g && g.move !== undefined) this.bProblem = moveProblem(this.game.world, g.move, g.x, g.y);
    else if (g && !g.sell) this.bProblem = buildingProblem(this.game.world, g.x, g.y, g.k) ?? (this.game.cash < ITEMS[g.k].cost ? `You need $${(ITEMS[g.k].cost - this.game.cash).toLocaleString('en-US')} more.` : null);
    else this.bProblem = null;
    this.overlay.bGhost = g ? { x: g.x, y: g.y, k: g.k, ok: g.sell || !this.bProblem, sell: g.sell, move: g.move } : null;
    this.onChange();
  }
  cancelGhost() { this.bGhost = null; this.syncGhost(); }
  /** Pick the putting green or the range and show it on its lot straight away. Returns where it goes, or null when there is no space left. */
  previewAmenity(kind: ItemKind): { x: number; y: number } | null {
    this.decorKind = kind;
    this.setTool('decor');
    const lot = isAmenity(kind) ? lotFor(this.game.world, kind) : null;
    this.bGhost = lot ? { x: lot.x, y: lot.y, k: kind, sell: false } : null;
    this.syncGhost();
    return lot;
  }
  /** Pick a placed thing up: the ghost starts where it stands and follows each tap until the player drops it. */
  pickUp(i: number) {
    const it = this.game.world.items?.[i];
    if (!it) return;
    this.decorKind = it.k;
    this.bGhost = { x: it.x, y: it.y, k: it.k, sell: false, move: i, from: { x: it.x, y: it.y } };
    this.syncGhost();
  }
  /** Sell the thing being moved back for what it cost. */
  sellPicked() {
    const g = this.bGhost;
    if (!g || g.move === undefined || !g.from) return;
    const r = toggleItem(this.game, g.from, g.k);
    if (!r.ok) { this.game.notify('bad', r.message ?? 'Not there.'); return; }
    this.game.onFeedback('build');
    this.r.cost(g.from.x + (ITEMS[g.k].w ?? 1) / 2, g.from.y + (ITEMS[g.k].h ?? 1) / 2, ITEMS[g.k].cost, true);
    this.game.notify('good', `${ITEMS[g.k].label} sold.`);
    this.bGhost = null;
    this.syncGhost();
  }
  confirmGhost() {
    const g = this.bGhost;
    if (!g || this.bProblem) return;
    if (g.move !== undefined) {
      if (g.from && g.from.x === g.x && g.from.y === g.y) return;
      const r = moveItem(this.game, g.move, { x: g.x, y: g.y });
      if (!r.ok) { this.game.notify('bad', r.message ?? 'Not there.'); return; }
      this.game.onFeedback('build');
      this.r.rise(`item:${g.x},${g.y}`);
      this.game.notify('good', `${ITEMS[g.k].label} moved.`);
      this.bGhost = null;
      this.syncGhost();
      return;
    }
    const r = toggleItem(this.game, { x: g.x, y: g.y }, g.k);
    if (!r.ok) { this.game.notify('bad', r.message ?? 'Not there.'); return; }
    this.game.onFeedback('build');
    const d = ITEMS[g.k];
    if (!g.sell) this.r.rise(`item:${g.x},${g.y}`);
    this.r.cost(g.x + (d.w ?? 1) / 2, g.y + (d.h ?? 1) / 2, d.cost, g.sell);
    this.game.notify('good', g.sell ? `${ITEMS[g.k].label} sold.` : `${ITEMS[g.k].label} built.`);
    this.bGhost = null;
    this.syncGhost();
  }
  /** What the Decorate tool places. */
  decorKind: ItemKind = 'flowers';
  /** The bend picked by tapping it, shown with a Remove bend action. -1 when none. */
  selBend = -1;
  /** A handle being held or dragged right now (read by the renderer). */
  drag: BendDrag | null = null;
  /** A released handle gliding to its tile, or back to its last valid one. */
  settle: BendUi['settle'] = null;
  preview: Preview | null = null;
  /** Where the clubhouse would stand (top-left tile) and why it cannot, while the player is choosing. */
  clubSpot: { x: number; y: number; problem: string | null } | null = null;
  /** True once the player has clicked or tapped a spot, so wandering the mouse to the Build button does not move it. */
  clubLocked = false;
  inspectTile: Pt | null = null;
  onChange: () => void = () => {};
  onSelect: (what: 'golfer' | 'hole') => void = () => {};

  private mode: Mode = 'none';
  /** A marker of the planned new hole being dragged: its tee, its green or one of its turning points. */
  private pointers = new Map<number, Pt>();
  private start: Pt = { x: 0, y: 0 };
  /** The tile under the pointer when it went down: a tap places there even if the camera has moved since. */
  private startTile: Pt = { x: 0, y: 0 };
  private moved = false;
  private limited = false;
  private skipCost = 0;
  private lastTile: Pt | null = null;
  private pinch = { dist: 0, cx: 0, cy: 0 };
  private lastPan: Pt | null = null;
  private panVx = 0;
  private panVy = 0;
  private panT = 0;
  private glide = 0;
  private lastTap = { t: 0, x: 0, y: 0 };
  /** Let the map keep drifting after a flick, slowing to a stop. */
  private startGlide() {
    cancelAnimationFrame(this.glide);
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(40, now - last);
      last = now;
      this.r.cam.x -= (this.panVx * dt) / this.r.cam.zoom;
      this.r.cam.y -= (this.panVy * dt) / this.r.cam.zoom;
      this.r.clampCam(this.game.world);
      const f = Math.pow(0.0025, dt / 1000);
      this.panVx *= f;
      this.panVy *= f;
      if (Math.hypot(this.panVx, this.panVy) > 0.02) this.glide = requestAnimationFrame(step);
    };
    this.glide = requestAnimationFrame(step);
  }
  private holdTimer: number | null = null;
  private touch = false;
  private space = false;
  private hover: Pt | null = null;
  private lastMsg = '';

  constructor(private canvas: HTMLCanvasElement, private game: Game, private r: Renderer) {
    this.tool = game.settings.tool;
    this.brush = game.settings.brush;
    // the bend handles are read fresh every frame, so they can never fall out of step with the plan
    Object.defineProperty(this.overlay, 'bendUi', { get: () => this.bendUi(), enumerable: true, configurable: true });
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.cancelPointer(e));
    canvas.addEventListener('pointerleave', () => {
      if (this.mode === 'none') this.clearHover();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const b = canvas.getBoundingClientRect();
        this.r.zoomAt(e.clientX - b.left, e.clientY - b.top, Math.exp(-e.deltaY * 0.0015), this.game.world);
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === ' ') {
        this.space = true;
        e.preventDefault();
      } else if (e.key === 'Escape') {
        if (this.drag) { this.abortDrag(); return; }
        this.cancelStroke();
        if (this.proposal) this.discard();
        else this.setTool('inspect');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if (e.key === 'Enter' && this.proposal) this.confirm();
      else if (e.key === '[') this.setBrush(Math.max(0, this.brush - 1));
      else if (e.key === ']') this.setBrush(Math.min(BRUSH_RADII.length - 1, this.brush + 1));
      else if (e.key.toLowerCase() === 'p') { if (this.game.settings.paused) this.game.resume(); else this.game.pause(); }
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') this.space = false;
    });
    window.addEventListener('blur', () => this.cancelStroke());
  }

  /** Bring a spot (a problem marker, say) into the middle of the free map area. */
  focusPoint(p: Pt, zoom = 0.9) {
    this.r.focus(p.x + 0.5, p.y + 0.5, zoom, this.game.world);
  }
  focusHole() {
    const h = this.game.hole(this.game.selectedHole);
    if (h) this.focusPoints([h.tee, h.cup, h.bend]);
  }
  /** Zoom and centre so every given tile is on screen, clear of the panels. */
  focusPoints(pts: Pt[], maxZoom = 0.95) {
    const width = this.r.cw - this.r.insets.l - this.r.insets.r - 40;
    const height = this.r.ch - this.r.insets.t - this.r.insets.b - 30;
    const points = pts.map((p) => projectGround(p.x * 32, p.y * 32));
    const spanX = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)) + 240;
    const spanY = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)) + 130;
    // never so far out that the ground switches to the flat overview while building
    const zoom = Math.max(0.45, Math.min(maxZoom, width / spanX, Math.max(120, height) / spanY));
    this.r.focus((Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2 + 0.5, (Math.min(...pts.map((p) => p.y)) + Math.max(...pts.map((p) => p.y))) / 2 + 0.5, zoom, this.game.world);
  }
  setTool(t: ToolId) {
    // Picking anything that edits the course starts designing: the business clock holds until the player resumes.
    // Decorating, placing buildings and repairing turf are not design changes: guests keep playing while you do them.
    if (t !== 'inspect' && t !== 'pan' && t !== 'decor' && t !== 'repair') this.game.enterDesign();
    if (t !== 'decor' && this.bGhost) { this.bGhost = null; this.syncGhost(); }
    if (t !== 'decor' && this.relocClub) this.cancelClub();
    this.cancelStroke();
    if (this.pending && !(t === 'build' && this.tool === 'build')) this.clearPending();
    if (t !== 'build') { this.buildTee = null; this.buildCup = null; this.newBends = []; this.overlay.buildTee = null; this.overlay.buildLine = null; }
    this.selBend = -1;
    this.tool = t;
    this.game.settings.tool = t;
    this.overlay.tool = t;
    this.updateHover();
    this.onChange();
  }
  setBrush(b: number) {
    this.brush = b;
    this.game.settings.brush = b;
    this.updateHover();
    this.onChange();
  }
  get isPaint() {
    return PAINT_TOOLS.includes(this.tool);
  }
  /** New hole: true once the tee spot has been tapped. */
  get buildStarted() {
    return !!this.buildTee;
  }
  get isPlacement() {
    return this.tool === 'tee' || this.tool === 'cup' || this.tool === 'bend' || this.tool === 'build';
  }

  // ---- the proposal: what Build would do right now ----
  /** Pending placement, or the stacked paint strokes. Null when there is nothing to confirm. */
  get proposal(): EditPlan | null {
    if (this.pending) return this.pending;
    if (!this.batch.size) return null;
    if (this.proposalCache.rev !== this.rev) {
      const tools = [...this.batchTools.keys()];
      this.proposalCache = {
        rev: this.rev,
        plan: { tool: tools[0] ?? this.tool, label: tools.map((t) => TOOL_INFO[t].label).join(' + ') || 'Terrain', tiles: [...this.batch.values()], cost: Math.ceil(this.batchCost - 1e-9) },
      };
    }
    return this.proposalCache.plan;
  }
  /** Build the proposal, charging once. */
  confirm() {
    const p = this.proposal;
    if (!p) return;
    const res = this.game.commitEdit(p);
    this.lastMsg = res.message;
    if (res.ok) {
      // the new ground settles in, and the price shows where the work was done
      this.r.settle(p.tiles.map((t) => t.i));
      const at = planCentre(this.game.world, p);
      if (at) this.r.cost(at.x, at.y, p.cost);
      this.discard();
      this.onBuilt(p.label, p.cost);
    }
    else this.onChange();
  }
  /** Throw away everything not yet built. Nothing is charged. */
  discard() {
    this.abortDrag(); // a handle in the air is put down first, so nothing it changed can come back
    this.batch.clear();
    this.stageKinds.clear();
    this.batchTools.clear();
    this.strokeUndo.clear();
    this.batchCost = 0;
    this.limited = false;
    this.rev++;
    this.clearPending();
    this.buildTee = null;
    this.buildCup = null;
    this.newBends = [];
    this.selBend = -1;
    this.overlay.buildTee = null;
    this.overlay.buildLine = null;
    this.syncStagedOverlay();
    this.updateHover();
    this.onChange();
  }
  /** Undo: first discards unbuilt changes, otherwise steps back through built ones. */
  undo(): boolean {
    if (this.proposal) {
      this.discard();
      this.game.notify('info', 'Unbuilt changes discarded.');
      return true;
    }
    const last = this.game.undoStack[this.game.undoStack.length - 1];
    const ok = this.game.undo();
    if (ok && last) {
      // undo is answered the same way as building: the ground settles back and the refund shows where it happened
      this.r.settle(last.plan.tiles.map((t) => t.i));
      const at = planCentre(this.game.world, last.plan);
      if (at) this.r.cost(at.x, at.y, last.cost, true);
    }
    this.onChange();
    return ok;
  }
  redo(): boolean {
    if (this.proposal) return false;
    const ok = this.game.redo();
    this.onChange();
    return ok;
  }
  cancelBuild() {
    this.discard();
  }
  confirmBuild() {
    this.confirm();
  }
  private newHolePlan(tee: Pt, cup: Pt) {
    return planNewHole(this.game.world, this.game.nextHoleId(), tee, cup, { par: this.newPar, bends: this.newBends });
  }
  /** Re-plan the pending new hole after its par or turning points changed. */
  private replanNew() {
    if (!this.buildTee || !this.buildCup) return; // nothing placed yet: the par just waits for the tee and green
    const why = this.tryReplan();
    if (why) this.game.notify('bad', why);
  }
  /** Re-plan the new hole with the markers where they are now. Null on success, otherwise why that layout is not allowed (nothing changes then). */
  private tryReplan(): string | null {
    if (!this.buildTee || !this.buildCup) return 'Place the tee and green first.';
    const plan = this.newHolePlan(this.buildTee, this.buildCup);
    if (typeof plan === 'string') return plan;
    this.pending = plan;
    this.rev++;
    this.showPlan(plan, []);
    this.overlay.buildTee = this.buildTee;
    this.overlay.buildLine = { from: this.buildTee, to: this.buildCup };
    this.preview = { tool: 'build', label: plan.label, tiles: plan.tiles.length, cost: plan.cost, affordable: plan.cost <= this.game.cash, message: '', stroking: false, limited: false };
    this.onChange();
    return null;
  }

  // ---- bend editing: grab, drag, release, Build ----
  /** The hole whose route is being shaped: the new hole being planned, or the selected hole with the Dogleg tool. Bends come from the plan, so cancel and undo need no bookkeeping. */
  private routeCtx(): { hole: Hole | null; tee: Pt; cup: Pt; bends: Pt[] } | null {
    if (this.game.owner.active || this.placingClub) return null;
    if (this.tool === 'build' && this.pending?.newHole && this.buildTee && this.buildCup) return { hole: null, tee: this.buildTee, cup: this.buildCup, bends: this.newBends };
    if (this.tool === 'bend') {
      const hole = this.game.hole(this.game.selectedHole);
      if (!hole) return null;
      return { hole, tee: hole.tee, cup: hole.cup, bends: this.pending?.hole ? holeBends(this.pending.hole.after) : holeBends(hole) };
    }
    return null;
  }
  /** Make these the bends of the route being shaped. Returns why not (and changes nothing) if the layout is not allowed. */
  private applyBends(bends: Pt[]): string | null {
    const c = this.routeCtx();
    if (!c) return 'Nothing to shape.';
    if (!c.hole) {
      const prev = this.newBends;
      this.newBends = bends;
      const why = this.tryReplan();
      if (why) this.newBends = prev;
      return why;
    }
    const plan = planBends(this.game.world, c.hole, bends);
    if (!plan) {
      this.pending = null;
      this.overlay.ghost = null;
      this.overlay.hoverTiles = [];
      this.overlay.changed = new Set();
    } else {
      this.pending = plan;
      this.showPlan(plan, []);
    }
    this.rev++;
    this.preview = null;
    this.onChange();
    return null;
  }
  /** What the interface needs to draw the handles, yardage and cost for the route being shaped. */
  private bendUi(): BendUi | null {
    const c = this.routeCtx();
    if (!c) return null;
    const stats = routeStats(c.tee, c.bends, c.cup);
    const d = this.drag;
    return {
      tee: c.tee, cup: c.cup, bends: c.bends,
      par: this.pending?.hole?.after.par ?? this.pending?.newHole?.par ?? c.hole?.par ?? this.newPar,
      cost: this.pending?.cost ?? 0,
      legs: stats.legs, total: stats.total,
      selected: this.selBend, movable: !!c.hole ? 'bends' : 'all',
      drag: d ? { kind: d.kind, i: d.i, engaged: d.engaged, tip: d.tip, tile: d.tile, problem: d.problem, attempt: d.attempt, touch: d.touch, since: d.t0 } : null,
      settle: this.settle,
    };
  }
  /** The tee, green or bend whose visible pin is under this screen point, using the same geometry the renderer draws. */
  private handleAt(p: Pt): { kind: 'tee' | 'cup' | 'bend'; i: number; tile: Pt } | null {
    const c = this.routeCtx();
    if (!c) return null;
    const reach = this.touch ? 34 : 20;
    const pts: { kind: 'tee' | 'cup' | 'bend'; i: number; tile: Pt }[] = c.bends.map((b, i) => ({ kind: 'bend' as const, i, tile: b }));
    if (!c.hole) pts.push({ kind: 'tee', i: 0, tile: c.tee }, { kind: 'cup', i: 0, tile: c.cup });
    let best: (typeof pts)[number] | null = null;
    let bestD = reach;
    for (const q of pts) {
      const g = this.r.pinGeom({ x: q.tile.x + 0.5, y: q.tile.y + 0.5 });
      const d = distToSegment(p, g.head, g.base, g.r);
      if (d < bestD) { bestD = d; best = q; }
    }
    return best ? { ...best, tile: { ...best.tile } } : null;
  }
  private beginDrag(p: Pt, h: { kind: 'tee' | 'cup' | 'bend'; i: number; tile: Pt }, touch: boolean) {
    const base = this.r.toScreen(h.tile.x + 0.5, h.tile.y + 0.5);
    const t0 = performance.now();
    this.settle = null;
    this.drag = {
      kind: h.kind, i: h.i, touch, engaged: false, moved: false, dirty: false, t0, moveAt: 0,
      tip: { x: h.tile.x + 0.5, y: h.tile.y + 0.5 }, tile: { ...h.tile }, cur: { ...h.tile }, tried: { ...h.tile }, attempt: null, problem: null,
      ptr: p, grabOff: { x: base.x - p.x, y: base.y - p.y },
      snap: { pending: this.pending, newBends: this.newBends.map((b) => ({ ...b })), tee: this.buildTee, cup: this.buildCup },
    };
    if (touch) {
      // a brief hold picks the handle up; moving first means the finger wanted to pan the map
      this.overlay.hold = { x: p.x, y: p.y, t0, ms: BEND_HOLD_MS };
      this.holdTimer = window.setTimeout(() => {
        this.holdTimer = null;
        if (this.mode === 'handle' && this.pointers.size === 1) this.engageDrag();
      }, BEND_HOLD_MS);
    } else this.engageDrag();
  }
  private engageDrag() {
    const d = this.drag;
    if (!d || d.engaged) return;
    this.overlay.hold = null;
    d.engaged = true;
    d.t0 = performance.now();
    if (d.kind === 'bend') this.selBend = d.i;
    if (this.game.preferences.haptics) navigator.vibrate?.(14);
    this.onChange();
    const tick = () => {
      if (this.drag !== d) return;
      this.retarget();
      this.edgePan(d);
      this.evalDrag();
      this.dragRaf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.dragRaf);
    this.dragRaf = requestAnimationFrame(tick);
  }
  private dragRaf = 0;
  /** Where the pin tip is for the finger's position: it keeps the offset it was grabbed with, and on touch rises above the fingertip so it stays in view. */
  private retarget() {
    const d = this.drag;
    if (!d || !d.engaged) return;
    // on touch the pin rises above the fingertip once the finger starts to move; just holding changes nothing
    const k = !d.touch || !d.moved ? 0 : Renderer.reducedMotion ? 1 : Math.min(1, (performance.now() - d.moveAt) / 160);
    const lift = BEND_LIFT * (k * k * (3 - 2 * k));
    d.tip = this.r.toWorld(d.ptr.x + d.grabOff.x, d.ptr.y + d.grabOff.y - lift);
    d.cur = { x: Math.floor(d.tip.x), y: Math.floor(d.tip.y) };
  }
  /** Check the tile under the pin tip, once per frame and only when it changed. A bad spot is shown, not refused silently. */
  private evalDrag() {
    const d = this.drag;
    if (!d || !d.engaged || (d.cur.x === d.tried.x && d.cur.y === d.tried.y)) return;
    d.tried = { ...d.cur };
    const c = this.routeCtx();
    if (!c) return;
    const t = d.cur;
    let why: string | null;
    if (d.tile.x === t.x && d.tile.y === t.y) why = null;
    else if (!inBounds(this.game.world, t.x, t.y)) why = 'That is off the property.';
    else if (d.kind === 'bend') why = bendProblem(this.game.world, c.tee, c.cup, c.bends, d.i, t) ?? this.applyBends(moveBendTo(c.bends, d.i, t));
    else {
      const was = { tee: this.buildTee, cup: this.buildCup };
      if (d.kind === 'tee') this.buildTee = t; else this.buildCup = t;
      why = this.tryReplan();
      if (why) { this.buildTee = was.tee; this.buildCup = was.cup; }
    }
    if (why) { d.attempt = { ...t }; d.problem = why; }
    else { d.attempt = null; d.problem = null; if (d.tile.x !== t.x || d.tile.y !== t.y) d.dirty = true; d.tile = { ...t }; }
  }
  /** While a handle is held near a screen edge nothing blocks, the map drifts that way, gently and faster the closer it gets. */
  private edgePan(d: BendDrag) {
    const now = performance.now();
    const dt = Math.min(0.05, (now - (d.panAt ?? now)) / 1000);
    d.panAt = now;
    if (!d.moved || dt <= 0) return;
    const ins = this.r.insets;
    const zone = 48;
    // an open edge reacts near the screen edge; an edge under a panel only once the finger has gone under it
    const depth = (fromEdge: number, inset: number) => (inset <= 24 ? Math.max(0, zone - fromEdge) : Math.max(0, inset - fromEdge)) / zone;
    const q = d.ptr;
    const vx = Math.min(1, depth(this.r.cw - q.x, ins.r)) - Math.min(1, depth(q.x, ins.l));
    const vy = Math.min(1, depth(this.r.ch - q.y, ins.b)) - Math.min(1, depth(q.y, ins.t));
    if (!vx && !vy) return;
    const speed = 340; // px per second right at the edge
    this.r.cancelCamera();
    cancelAnimationFrame(this.glide);
    this.r.cam.x += (vx * speed * dt) / this.r.cam.zoom;
    this.r.cam.y += (vy * speed * dt) / this.r.cam.zoom;
    this.r.clampCam(this.game.world);
    this.retarget();
  }
  /** Put everything back as it was when the handle was picked up (a second finger, a lost pointer, Escape). Never commits. */
  private abortDrag() {
    const d = this.drag;
    if (!d) return;
    this.stopHold();
    cancelAnimationFrame(this.dragRaf);
    if (d.engaged && d.dirty) this.restoreSnap(d.snap);
    this.drag = null;
    this.settle = null;
    if (this.mode === 'handle') this.mode = 'none';
    this.onChange();
  }
  private restoreSnap(s: BendSnap) {
    this.buildTee = s.tee;
    this.buildCup = s.cup;
    this.newBends = s.newBends.map((b) => ({ ...b }));
    this.pending = s.pending;
    this.rev++;
    if (s.pending) this.showPlan(s.pending, []);
    else { this.overlay.ghost = null; this.overlay.hoverTiles = []; this.overlay.changed = new Set(); }
    if (s.pending?.newHole) { this.overlay.buildTee = s.tee; this.overlay.buildLine = s.tee && s.cup ? { from: s.tee, to: s.cup } : null; }
  }
  /** Finger or mouse released. A drag keeps the proposed layout (or glides back from an invalid spot); a plain tap only selects. */
  private finishDrag() {
    const d = this.drag;
    this.stopHold();
    cancelAnimationFrame(this.dragRaf);
    this.drag = null;
    if (!d) return;
    if (d.engaged && (d.moved || d.dirty)) {
      const to = { x: d.tile.x + 0.5, y: d.tile.y + 0.5 };
      this.settle = { kind: d.kind, i: d.i, from: d.tip, to, t0: performance.now(), dur: d.problem ? 300 : 150 };
      if (d.problem) this.game.notify('bad', `${d.problem} The handle went back.`);
      else if (this.game.preferences.haptics) navigator.vibrate?.(6);
    } else if (d.kind === 'bend') this.selBend = d.i;
    this.onChange();
  }
  /** Tap on empty ground: the Dogleg tool adds a bend there; anywhere else it just lets go of the selection. */
  private tapRoute(t: Pt): boolean {
    const c = this.routeCtx();
    if (!c) return false;
    if (this.tool !== 'bend') { this.selBend = -1; this.onChange(); return true; }
    if (c.bends.length >= MAX_BENDS) { this.selBend = -1; this.game.notify('bad', `A hole can have up to ${MAX_BENDS} bends. Move or remove one.`); this.onChange(); return true; }
    const why = bendProblem(this.game.world, c.tee, c.cup, c.bends, -1, t);
    if (why) { this.game.notify('bad', why); return true; }
    const next = insertBend(c.tee, c.bends, c.cup, t);
    const fail = this.applyBends(next);
    if (fail) { this.game.notify('bad', fail); return true; }
    this.selBend = next.findIndex((b) => b.x === t.x && b.y === t.y);
    this.r.pulse(t.x + 0.5, t.y + 0.5);
    return true;
  }
  /** True while a finger or the mouse is down on the map, or a handle is held: the camera must not move then. */
  get interacting() {
    return this.mode !== 'none' || !!this.drag || this.pointers.size > 0;
  }
  /** If any pin of the route is hidden (off screen, or under the Build bar once it has grown), frame the route. Waits a moment for the bar to settle. */
  private keepInView(pts: Pt[], tries = 0) {
    window.setTimeout(() => {
      // never move the camera under a placement or a drag: try again once the pointer is up
      if (this.interacting) { if (tries < 8) this.keepInView(pts, tries + 1); return; }
      const ins = this.r.insets;
      const hidden = pts.some((q) => {
        const g = this.r.pinGeom({ x: q.x + 0.5, y: q.y + 0.5 });
        return g.base.x < ins.l + 14 || g.base.x > this.r.cw - ins.r - 14 || g.head.y - g.r < ins.t || g.base.y > this.r.ch - ins.b - 6;
      });
      if (hidden && (this.shaping || this.buildTee)) this.focusPoints(pts, Math.max(0.45, Math.min(0.95, this.r.cam.zoom)));
    }, 280);
  }
  /** Painted ground waiting to be built: if it is off screen or under the panel, slide the map (without zooming) so it shows above the panel. */
  private keepAreaInView(tries = 0) {
    window.setTimeout(() => {
      if (this.interacting) { if (tries < 8) this.keepAreaInView(tries + 1); return; }
      if (!this.batch.size) return;
      const w = this.game.world, ins = this.r.insets;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const i of this.batch.keys()) { const x = i % w.w, y = Math.floor(i / w.w); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1); }
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => this.r.toScreen(x, y));
      const hidden = corners.some((c) => c.x < ins.l + 8 || c.x > this.r.cw - ins.r - 8 || c.y < ins.t + 8 || c.y > this.r.ch - ins.b - 8);
      if (hidden) this.r.focus((x0 + x1) / 2, (y0 + y1) / 2, this.r.cam.zoom, w);
    }, 300);
  }
  /** Add a bend in the middle of the longest leg, ready to drag. */
  addBend() {
    const c = this.routeCtx();
    if (!c) return;
    const r = suggestBend(this.game.world, c.tee, c.cup, c.bends);
    if (typeof r === 'string') { this.game.notify('bad', r); return; }
    const fail = this.applyBends(r.bends);
    if (fail) { this.game.notify('bad', fail); return; }
    this.selBend = r.index;
    const p = r.bends[r.index];
    this.r.pulse(p.x + 0.5, p.y + 0.5);
    this.keepInView([c.tee, ...r.bends, c.cup]);
    this.onChange();
  }
  /** The Remove bend action for the selected bend. Only changes the preview; Build keeps it, Cancel brings it back. */
  removeSelectedBend() {
    const c = this.routeCtx();
    if (!c || this.selBend < 0 || this.selBend >= c.bends.length) return;
    const fail = this.applyBends(removeBendAt(c.bends, this.selBend));
    if (fail) { this.game.notify('bad', fail); return; }
    this.selBend = -1;
    this.onChange();
  }
  /** Remove every bend from the preview. */
  straighten() {
    const c = this.routeCtx();
    if (!c || !c.bends.length) return;
    const fail = this.applyBends([]);
    if (fail) { this.game.notify('bad', fail); return; }
    this.selBend = -1;
    this.onChange();
  }
  /** True while a route is being shaped (the Dogleg tool, or a new hole with its tee and green placed). */
  get shaping() {
    return !!this.routeCtx();
  }
  get shapingBends(): Pt[] {
    return this.routeCtx()?.bends ?? [];
  }
  setNewPar(par: number) {
    this.newPar = par;
    this.replanNew();
    this.onChange();
  }
  /** Choose which hole the hole tools work on; unbuilt placements belonged to the old one. */
  selectHole(id: number) {
    if (this.game.selectedHole !== id) { this.abortDrag(); this.clearPending(); this.selBend = -1; }
    this.game.selectedHole = id;
    this.onChange();
  }
  private clearPending() {
    this.pending = null;
    this.overlay.ghost = null;
    this.rev++;
  }
  private syncStagedOverlay() {
    this.overlay.staged = new Set(this.batch.keys());
    this.overlay.stagedKind = new Map([...this.batch.keys()].map((i) => [i, this.stageKinds.get(i) ?? this.tool]));
  }
  private stageKinds = new Map<number, ToolId>();

  /** Roll back the stroke in progress (a second finger landed, or the pointer was lost). */
  private cancelStroke() {
    this.stopHold();
    this.abortDrag();
    if (this.mode === 'hold') this.mode = 'none';
    if (this.mode === 'paint') {
      for (const [i, prev] of this.strokeUndo) {
        const now = this.batch.get(i);
        this.batchCost += (prev?.cost ?? 0) - (now?.cost ?? 0);
        if (prev) this.batch.set(i, prev);
        else this.batch.delete(i);
      }
      this.rev++;
    }
    this.strokeUndo.clear();
    this.limited = false;
    this.syncStagedOverlay();
    if (this.mode === 'paint' || this.mode === 'place') this.mode = 'none';
    this.updateHover();
  }

  private local(e: PointerEvent): Pt {
    const b = this.canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  }
  private tileAt(p: Pt): Pt {
    const w = this.r.toWorld(p.x, p.y);
    return { x: Math.floor(w.x), y: Math.floor(w.y) };
  }
  private overCanvas(e: PointerEvent): boolean {
    return document.elementFromPoint(e.clientX, e.clientY) === this.canvas;
  }

  private down(e: PointerEvent) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    cancelAnimationFrame(this.glide);
    this.panVx = this.panVy = 0;
    this.panT = performance.now();
    if (this.pointers.size >= 2) {
      // A second finger means pinch or two-finger pan. Never an edit: roll back anything the first finger started.
      this.stopHold();
      this.cancelStroke();
      this.clearHover();
      this.mode = 'pinch';
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (this.mode === 'pinch') return; // a finger left over from a pinch must lift before anything else happens
    this.start = p;
    this.startTile = this.tileAt(p); // the tile the finger actually landed on, whatever the camera does next
    this.moved = false;
    this.touch = e.pointerType !== 'mouse';
    if (this.game.owner.active) { this.mode = 'inspect'; return; }
    this.game.followGolfer = 0;
    const handle = this.handleAt(p);
    if (handle && !(e.button === 1 || e.button === 2 || this.space)) {
      this.mode = 'handle';
      this.beginDrag(p, handle, this.touch);
      return;
    }
    // While the camera is gliding to frame something, the ground under a finger is moving: a tap then must not place anything on it.
    // The touch still pans (and stops the glide); a placement tap is simply not taken.
    if ((this.placingClub || this.isPlacement || this.tool === 'land' || this.tool === 'decor') && this.r.cameraMoving) {
      this.mode = 'pan';
      return;
    }
    const panByButton = e.button === 1 || e.button === 2 || this.space || this.tool === 'pan';
    if (panByButton) {
      this.mode = 'pan';
      return;
    }
    if (this.tool === 'inspect' || this.placingClub) this.mode = 'inspect';
    else if (this.touch && (this.isPaint || this.isPlacement || this.tool === 'land' || this.tool === 'decor')) {
      // Touch: one finger drags the map. Only a clean tap, or a press-and-hold for painting, edits.
      this.mode = 'hold';
      this.hover = this.tileAt(p);
      if (this.isPaint) {
        this.overlay.hoverTiles = brushTiles(this.game.world, this.hover.x, this.hover.y, this.brush);
        this.overlay.changed = new Set();
        this.overlay.blocked = new Set();
        this.onChange();
        this.overlay.hold = { x: p.x, y: p.y, t0: performance.now() };
        this.holdTimer = window.setTimeout(() => {
          this.holdTimer = null;
          if (this.mode !== 'hold' || this.pointers.size !== 1) return;
          this.startStroke(this.start);
          if (this.game.preferences.haptics) navigator.vibrate?.(12);
        }, HOLD_MS);
      }
    } else if (this.isPaint) this.startStroke(p);
    else {
      this.mode = 'place';
      this.hover = this.tileAt(p);
      this.updateHover();
    }
  }

  private startStroke(p: Pt) {
    this.overlay.hold = null;
    if (this.pending) this.clearPending();
    this.mode = 'paint';
    this.strokeUndo.clear();
    this.limited = false;
    this.skipCost = 0;
    this.lastTile = null;
    this.hover = this.tileAt(p);
    this.paintTo(this.hover);
  }
  private stopHold() {
    this.overlay.hold = null;
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }
  /** True while a finger is resting, waiting to see whether it will tap, hold or drag. */
  get holding() {
    return this.mode === 'hold';
  }

  private move(e: PointerEvent) {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.mode === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      this.r.cancelCamera();
      this.r.cam.x -= (cx - this.pinch.cx) / this.r.cam.zoom;
      this.r.cam.y -= (cy - this.pinch.cy) / this.r.cam.zoom;
      if (this.pinch.dist > 0) this.r.zoomAt(cx, cy, d / this.pinch.dist, this.game.world);
      this.r.clampCam(this.game.world);
      this.pinch = { dist: d, cx, cy };
      return;
    }
    if (this.mode === 'handle' && this.drag && !this.drag.engaged && Math.hypot(p.x - this.start.x, p.y - this.start.y) > SLOP) {
      // the finger travelled before the hold finished: it wanted to pan the map, not pick the handle up
      this.stopHold();
      this.drag = null;
      this.mode = 'pan';
    }
    if (this.mode === 'handle') {
      const d = this.drag;
      if (!d || !d.engaged) return;
      d.ptr = p;
      if (!d.moved && Math.hypot(p.x - this.start.x, p.y - this.start.y) > 3) { d.moved = true; d.moveAt = performance.now(); }
      this.retarget(); // the handle follows at once; checking the ground waits for the next frame
      return;
    }
    if (!this.pointers.has(e.pointerId) && this.mode === 'none' && !this.overCanvas(e)) return;
    if (this.mode === 'none' && e.pointerType !== 'mouse') return; // no hover on touch screens
    const over = this.overCanvas(e);
    const far = Math.hypot(p.x - this.start.x, p.y - this.start.y) > SLOP;
    if (this.mode === 'hold' && far) {
      // The finger travelled before the hold finished: this is a pan, not an edit.
      this.stopHold();
      this.mode = 'pan';
      this.overlay.hoverTiles = [];
      this.preview = null;
      this.onChange();
    }
    if (this.mode === 'hold') return;
    if (this.mode === 'pan' || (this.mode === 'inspect' && Math.hypot(p.x - this.start.x, p.y - this.start.y) > 6)) {
      if (this.mode === 'inspect') this.mode = 'pan';
      const prev = this.lastPan ?? this.start;
      const nowT = performance.now(), dtv = Math.max(8, nowT - this.panT);
      this.panVx = 0.6 * this.panVx + 0.4 * ((p.x - prev.x) / dtv);
      this.panVy = 0.6 * this.panVy + 0.4 * ((p.y - prev.y) / dtv);
      this.panT = nowT;
      // direct manipulation: the map follows the finger exactly, and any automatic move stops
      this.r.cancelCamera();
      this.r.cam.x -= (p.x - prev.x) / this.r.cam.zoom;
      this.r.cam.y -= (p.y - prev.y) / this.r.cam.zoom;
      this.r.clampCam(this.game.world);
      this.lastPan = p;
      this.moved = true;
      return;
    }
    this.lastPan = null;
    if (Math.hypot(p.x - this.start.x, p.y - this.start.y) > 4) this.moved = true;
    if (this.mode === 'paint') {
      if (over) {
        const t = this.tileAt(p);
        this.hover = t;
        this.paintTo(t);
      }
      return;
    }
    if (over) {
      this.hover = this.tileAt(p);
      this.overlay.hoverPt = this.r.toWorld(p.x, p.y);
      this.updateHover();
    } else if (this.mode === 'none') this.clearHover();
  }

  private up(e: PointerEvent) {
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    this.lastPan = null;
    if (this.mode === 'pinch') {
      if (this.pointers.size === 0) this.mode = 'none';
      return;
    }
    if (this.mode === 'handle') {
      // a drag keeps the proposed layout; a tap only selects the bend
      if (this.drag) { this.drag.ptr = p; this.retarget(); this.evalDrag(); }
      this.finishDrag();
      this.mode = 'none';
      return;
    }
    if (this.mode === 'pan' && this.moved && e.pointerType !== 'mouse' && performance.now() - this.panT < 90 && Math.hypot(this.panVx, this.panVy) > 0.25) this.startGlide();
    const over = this.overCanvas(e);
    if (this.mode === 'inspect' && !this.moved && !this.game.owner.active && e.pointerType !== 'mouse') {
      // double-tap the map to step in; a second double-tap steps out again
      const now = performance.now();
      if (now - this.lastTap.t < 320 && Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 28) {
        const zoomOut = this.r.cam.zoom > 1.3;
        this.r.zoomAt(p.x, p.y, zoomOut ? 0.6 : 1.7, this.game.world);
        this.lastTap.t = 0;
        this.mode = 'none';
        return;
      }
      this.lastTap = { t: now, x: p.x, y: p.y };
    }
    if (this.mode === 'hold') {
      // A clean tap: stamp the brush once, or drop the tee/cup/dogleg/new-hole marker for review.
      this.stopHold();
      if (over && this.isPaint) {
        this.startStroke(this.start);
        this.endStroke();
      } else if (over) this.commitPlace(this.startTile);
    } else if (this.mode === 'inspect' && !this.moved && this.game.owner.active) {
      this.game.owner.aim = this.r.toWorld(p.x, p.y);
    } else if (this.mode === 'inspect' && !this.moved) this.inspectAt(p);
    else if (this.mode === 'paint') this.endStroke();
    else if (this.mode === 'place' && over) this.commitPlace(this.moved ? this.tileAt(p) : this.startTile);
    this.mode = 'none';
    if (e.pointerType === 'mouse') this.updateHover();
    else this.clearHover();
  }

  private cancelPointer(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    this.lastPan = null;
    this.stopHold();
    this.cancelStroke();
    this.mode = this.pointers.size ? 'pinch' : 'none';
  }

  private clearHover() {
    this.hover = null;
    this.overlay.hoverTiles = [];
    this.overlay.changed = new Set();
    this.overlay.blocked = new Set();
    this.overlay.hoverPt = null;
    this.preview = null;
    this.onChange();
  }

  /** Recompute the footprint, affected tiles and cost for the tile under the pointer. */
  updateHover() {
    const world = this.game.world;
    const h = this.hover;
    if (this.placingClub) {
      if (h) this.aimClub(h, false);
      return;
    }
    this.overlay.tool = this.tool;
    if (this.pending && this.mode !== 'place' && this.isPlacement) {
      this.onChange();
      return;
    }
    if (!h || !inBounds(world, h.x, h.y) || (!this.isPaint && this.tool !== 'tee' && this.tool !== 'cup' && this.tool !== 'bend' && this.tool !== 'build' && this.tool !== 'land')) {
      this.overlay.hoverTiles = [];
      this.overlay.changed = new Set();
      this.overlay.blocked = new Set();
      this.preview = null;
      this.onChange();
      return;
    }
    if (this.tool === 'land') {
      this.overlay.hoverTiles = [];
      this.overlay.changed = new Set();
      this.overlay.blocked = new Set();
      const col = Math.floor(h.x / CFG.land.pw);
      const row = Math.floor(h.y / CFG.land.ph);
      this.overlay.parcel = { col, row };
      this.preview = null;
      this.onChange();
      return;
    }
    if (this.tool === 'build') {
      const foot = boxTiles(world, h);
      this.overlay.hoverTiles = foot;
      this.overlay.changed = new Set();
      this.overlay.blocked = new Set();
      this.overlay.buildTee = this.buildTee;
      this.overlay.buildLine = this.buildTee ? { from: this.buildTee, to: h } : null;
      if (this.buildTee && !this.pending) {
        const plan = this.newHolePlan(this.buildTee, h);
        if (typeof plan === 'string') this.preview = { tool: 'build', label: '', tiles: 0, cost: 0, affordable: false, message: plan, stroking: false, limited: false };
        else this.preview = { tool: 'build', label: plan.label, tiles: plan.tiles.length, cost: plan.cost, affordable: plan.cost <= this.game.cash, message: '', stroking: false, limited: false };
      } else if (!this.buildTee) this.preview = { tool: 'build', label: '', tiles: 0, cost: 0, affordable: true, message: 'Step 1 of 2: tap where the tee box goes.', stroking: false, limited: false };
      this.onChange();
      return;
    }
    if (this.isPaint) {
      const foot = brushTiles(world, h.x, h.y, this.brush);
      const plan = planPaint(world, this.tool, foot.filter((i) => !this.batch.has(i)));
      const changed = new Set(plan.tiles.map((t) => t.i));
      const blocked = new Set(foot.filter((i) => !changed.has(i) && blockReason(world, this.tool, i, stagedState(world, i, this.batch)) !== null));
      this.overlay.hoverTiles = foot;
      this.overlay.changed = changed;
      this.overlay.blocked = blocked;
      if (this.mode === 'paint') return;
      const afford = plan.cost <= this.game.cash;
      this.overlay.tooExpensive = !afford;
      this.preview = {
        tool: this.tool,
        label: plan.label,
        tiles: plan.tiles.length,
        cost: plan.cost,
        affordable: afford,
        message: plan.tiles.length ? '' : blocked.size ? 'This ground cannot be changed with this tool.' : this.tool === 'repair' ? 'Nothing here needs repair.' : 'No change here.',
        stroking: false,
        limited: false,
      };
    } else {
      const hole = this.game.hole(this.game.selectedHole);
      if (!hole) {
        this.overlay.hoverTiles = [];
        this.preview = { tool: this.tool, label: '', tiles: 0, cost: 0, affordable: false, message: 'Build a hole first, then you can move its tee, cup or bend.', stroking: false, limited: false };
        this.onChange();
        return;
      }
      if (this.tool === 'bend') {
        const c = this.routeCtx();
        const why = !c ? null : c.bends.length >= MAX_BENDS ? `Up to ${MAX_BENDS} bends. Drag one to move it.` : bendProblem(world, c.tee, c.cup, c.bends, -1, h);
        this.overlay.hoverTiles = [idx(world, h.x, h.y)];
        this.overlay.changed = new Set();
        this.overlay.blocked = why ? new Set(this.overlay.hoverTiles) : new Set();
        this.preview = { tool: 'bend', label: `Hole ${hole.id}`, tiles: 0, cost: why ? 0 : Math.ceil(40), affordable: !why, message: why ?? 'Click to add a bend here, or drag a bend to reshape.', stroking: false, limited: false };
        this.onChange();
        return;
      }
      const plan = this.tool === 'tee' ? planMoveTee(world, hole, h.x, h.y) : planMoveCup(world, hole, h.x, h.y);
      if (typeof plan === 'string') {
        this.overlay.hoverTiles = this.tool === 'tee' ? boxTiles(world, h) : brushTiles(world, h.x, h.y, 2);
        this.overlay.changed = new Set();
        this.overlay.blocked = new Set(this.overlay.hoverTiles);
        this.overlay.ghost = null;
        this.preview = { tool: this.tool, label: plan.length ? `Hole ${hole.id}` : '', tiles: 0, cost: 0, affordable: false, message: plan, stroking: false, limited: false };
      } else {
        const foot = this.tool === 'tee' ? boxTiles(world, h) : brushTiles(world, h.x, h.y, 2);
        this.showPlan(plan, foot);
        const afford = plan.cost <= this.game.cash;
        this.overlay.tooExpensive = !afford;
        this.preview = { tool: this.tool, label: plan.label, tiles: plan.tiles.length, cost: plan.cost, affordable: afford, message: plan.tiles.length ? '' : 'Only the cup position moves.', stroking: false, limited: false };
      }
    }
    this.onChange();
  }

  private paintTo(t: Pt) {
    const world = this.game.world;
    const from = this.lastTile ?? t;
    const steps = Math.max(Math.abs(t.x - from.x), Math.abs(t.y - from.y), 1);
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(from.x + ((t.x - from.x) * s) / steps);
      const y = Math.round(from.y + ((t.y - from.y) * s) / steps);
      if (!inBounds(world, x, y)) continue;
      for (const i of brushTiles(world, x, y, this.brush)) {
        const e = planTile(world, this.tool, i, stagedState(world, i, this.batch));
        if (!e) continue;
        if (Math.ceil(this.batchCost + e.cost - 1e-9) > this.game.cash) {
          this.limited = true;
          this.skipCost = Math.max(this.skipCost, Math.ceil(e.cost));
          continue;
        }
        const prev = this.batch.get(i);
        if (!this.strokeUndo.has(i)) this.strokeUndo.set(i, prev);
        const merged = mergeEdit(prev, e);
        if (merged) {
          this.batch.set(i, merged);
          this.stageKinds.set(i, this.tool);
        } else this.batch.delete(i);
        this.batchCost += (merged?.cost ?? 0) - (prev?.cost ?? 0);
        this.batchTools.set(this.tool, (this.batchTools.get(this.tool) ?? 0) + 1);
      }
    }
    this.lastTile = t;
    this.rev++;
    this.syncStagedOverlay();
    this.overlay.hoverTiles = brushTiles(world, t.x, t.y, this.brush);
    this.overlay.changed = new Set();
    this.overlay.blocked = new Set();
    this.overlay.tooExpensive = this.limited;
    this.preview = this.stackPreview();
    this.onChange();
  }

  private stackPreview(): Preview {
    return {
      tool: this.tool,
      label: this.proposal?.label ?? '',
      tiles: this.batch.size,
      cost: Math.ceil(this.batchCost - 1e-9),
      affordable: !this.limited,
      message: this.limited ? 'Out of cash: the rest of this stroke will not be painted.' : '',
      stroking: true,
      limited: this.limited,
    };
  }

  /** Finger up: the stroke joins the stack. Nothing is charged until Build. */
  private endStroke() {
    if (!this.batch.size && this.limited) this.game.notify('bad', `Not enough cash for that. A tile costs about ${fmtMoney(this.skipCost)} here and you have ${fmtMoney(this.game.cash)}.`);
    else if (this.limited) this.game.notify('bad', 'You ran out of cash partway through. Only the affordable tiles are staged.');
    this.strokeUndo.clear();
    this.limited = false;
    this.skipCost = 0;
    this.lastTile = null;
    this.preview = null;
    this.onChange();
    if (this.batch.size) this.keepAreaInView();
  }

  /** Describe a pending or hovered hole plan on the map: footprint, changed tiles and the pins it would move. */
  private showPlan(plan: EditPlan, foot: number[]) {
    const changed = new Set(plan.tiles.map((t) => t.i));
    this.overlay.hoverTiles = [...new Set([...foot, ...changed])];
    this.overlay.changed = changed;
    this.overlay.blocked = new Set();
    const after = plan.hole?.after ?? plan.newHole;
    const before = plan.hole?.before;
    this.overlay.ghost = after
      ? {
          tee: !before || before.tee.x !== after.tee.x || before.tee.y !== after.tee.y ? after.tee : undefined,
          cup: !before || before.cup.x !== after.cup.x || before.cup.y !== after.cup.y ? after.cup : undefined,
          bends: !before || JSON.stringify(holeBends(before)) !== JSON.stringify(holeBends(after)) ? holeBends(after) : undefined,
          route: [after.tee, ...holeBends(after), after.cup],
          par: after.par,
          notes: plan.notes,
        }
      : null;
  }

  private commitPlace(t: Pt) {
    if (!inBounds(this.game.world, t.x, t.y)) return;
    if (this.tool === 'decor') {
      const w0 = this.game.world;
      const hit = itemAt(w0, t.x, t.y);
      const existing = hit >= 0 ? w0.items![hit] : null;
      // the clubhouse can be picked up and turned too
      const cl = w0.clubhouse;
      if (cl && !this.bGhost) {
        const dm = clubDims(w0.clubFlip);
        if (t.x >= cl.x && t.y >= cl.y && t.x < cl.x + dm.w && t.y < cl.y + dm.h) { this.startMoveClub(); return; }
      }
      // tapping something already standing picks it up; tap another tile to put it down, or sell it
      if (existing && hit >= 0) { this.pickUp(hit); return; }
      if (this.bGhost?.move !== undefined) {
        const mv = ITEMS[this.bGhost.k];
        this.bGhost = { ...this.bGhost, x: t.x - Math.floor((mv.w ?? 1) / 2), y: t.y - Math.floor((mv.h ?? 1) / 2) };
        this.syncGhost();
        return;
      }
      if (isBuilding(this.decorKind) || (existing && isBuilding(existing.k))) {
        // buildings are priced in thousands: preview first, then confirm or sell
        if (existing && isBuilding(existing.k)) this.bGhost = { x: existing.x, y: existing.y, k: existing.k, sell: true };
        else {
          // the putting green and the range snap to their marked lot; everything else goes where the player taps
          const lot = isAmenity(this.decorKind) ? lotFor(this.game.world, this.decorKind) : null;
          this.bGhost = lot ? { x: lot.x, y: lot.y, k: this.decorKind, sell: false } : { x: t.x - Math.floor((ITEMS[this.decorKind].w ?? 1) / 2), y: t.y - Math.floor((ITEMS[this.decorKind].h ?? 1) / 2), k: this.decorKind, sell: false };
        }
        this.syncGhost();
        return;
      }
      const r = toggleItem(this.game, t, this.decorKind);
      if (!r.ok) this.game.notify('bad', r.message ?? 'Not there.');
      else this.game.onFeedback('build');
      this.onChange();
      return;
    }
    if (this.tool === 'land') {
      this.parcel = { col: Math.floor(t.x / CFG.land.pw), row: Math.floor(t.y / CFG.land.ph) };
      this.overlay.parcel = this.parcel;
      this.onChange();
      return;
    }
    if (this.batch.size) {
      this.game.notify('bad', 'Build or cancel your terrain changes first, then place the hole markers.');
      return;
    }
    if (this.tool === 'build') {
      if (this.pending?.newHole && this.buildTee && this.buildCup) {
        // the hole is placed: a tap on bare ground never moves it, it only lets go of the selected bend
        this.tapRoute(t);
        return;
      }
      if (!this.buildTee) {
        this.buildTee = t;
        this.overlay.buildTee = t;
        this.r.pulse(t.x + 0.5, t.y + 0.5);
        this.hover = t;
        this.updateHover();
        this.keepInView([t]);
        return;
      }
      const plan = this.newHolePlan(this.buildTee, t);
      if (typeof plan === 'string') {
        this.game.notify('bad', plan);
        return;
      }
      this.buildCup = t;
      this.r.pulse(t.x + 0.5, t.y + 0.5);
      this.pending = plan;
      this.rev++;
      this.showPlan(plan, []);
      this.overlay.buildLine = { from: this.buildTee, to: t };
      this.preview = { tool: 'build', label: plan.label, tiles: plan.tiles.length, cost: plan.cost, affordable: plan.cost <= this.game.cash, message: '', stroking: false, limited: false };
      this.onChange();
      this.keepInView([this.buildTee, t]);
      return;
    }
    const hole = this.game.hole(this.game.selectedHole);
    if (!hole) {
      this.game.notify('bad', 'Build a hole first, then you can move its tee, cup or bend.');
      return;
    }
    if (this.tool === 'bend') { this.tapRoute(t); return; }
    const plan = this.tool === 'tee' ? planMoveTee(this.game.world, hole, t.x, t.y) : planMoveCup(this.game.world, hole, t.x, t.y);
    if (typeof plan === 'string') {
      this.game.notify('bad', plan);
      return;
    }
    this.pending = plan;
    this.rev++;
    this.showPlan(plan, this.tool === 'tee' ? boxTiles(this.game.world, t) : brushTiles(this.game.world, t.x, t.y, 2));
    this.preview = null;
    this.onChange();
  }

  /** True until the player has chosen where the clubhouse goes, and again while a standing clubhouse is picked up to be moved or turned. */
  get placingClub() {
    return this.game.world.clubhouse === null || this.relocClub;
  }
  /** The standing clubhouse is lifted: the ghost is where it will go. */
  relocClub = false;
  /** Which way the clubhouse being placed is turned. */
  clubFlip = false;
  /** Centre the clubhouse footprint on a tile and check the ground. */
  private aimClub(t: Pt, lock: boolean) {
    if (this.clubLocked && !lock) return;
    const dm = clubDims(this.clubFlip);
    const c = { x: t.x - Math.floor(dm.w / 2), y: t.y - Math.floor(dm.h / 2) };
    const w = this.game.world;
    const problem = inBounds(w, c.x, c.y) && inBounds(w, c.x + dm.w, c.y + dm.h) ? (this.relocClub ? relocateProblem(w, c, this.clubFlip) : clubhouseProblem(w, c, this.clubFlip)) : 'Too close to the edge of the map.';
    this.clubSpot = { ...c, problem };
    if (lock) this.clubLocked = true;
    this.overlay.club = { ...this.clubSpot, flip: this.clubFlip };
    this.onChange();
  }
  /** Jump to the best-looking legal spot. */
  suggestClub() {
    const c = suggestClubhouse(this.game.world);
    if (!c) {
      this.game.notify('bad', 'No flat, dry spot found. Try scrolling to a meadow.');
      return;
    }
    const dm = clubDims(this.clubFlip);
    this.clubLocked = false;
    this.aimClub({ x: c.x + Math.floor(dm.w / 2), y: c.y + Math.floor(dm.h / 2) }, true);
    this.r.focus(c.x + dm.w / 2, c.y + dm.h / 2, Math.max(this.r.cam.zoom, 0.7), this.game.world);
  }
  /** Turn the clubhouse the other way, keeping its centre where it is. */
  rotateClub() {
    const before = clubDims(this.clubFlip);
    const spot = this.clubSpot;
    this.clubFlip = !this.clubFlip;
    if (spot) this.aimClub({ x: spot.x + Math.floor(before.w / 2), y: spot.y + Math.floor(before.h / 2) }, true);
    else this.onChange();
  }
  /** Pick the standing clubhouse up to move it or turn it. */
  startMoveClub() {
    const c = this.game.world.clubhouse;
    if (!c || this.proposal) return;
    this.game.enterDesign(); // moving the clubhouse moves the entrance golfers use, so this one does hold time
    this.cancelGhost();
    this.relocClub = true;
    this.clubFlip = !!this.game.world.clubFlip;
    this.clubLocked = false;
    const dm = clubDims(this.clubFlip);
    this.aimClub({ x: c.x + Math.floor(dm.w / 2), y: c.y + Math.floor(dm.h / 2) }, true);
  }
  /** Put the clubhouse back where it was. */
  cancelClub() {
    this.relocClub = false;
    this.clubSpot = null;
    this.clubLocked = false;
    this.overlay.club = null;
    this.onChange();
  }
  /** Build the clubhouse where the ghost stands (or, when it was picked up, move it there). */
  confirmClub() {
    const c = this.clubSpot;
    if (!c || c.problem || !this.clubLocked) return;
    const dm = clubDims(this.clubFlip);
    const ok = this.relocClub ? this.game.moveClubhouse({ x: c.x, y: c.y }, this.clubFlip) : this.game.buildClubhouse({ x: c.x, y: c.y }, this.clubFlip);
    if (ok) {
      this.r.rise('club');
      const moved = this.relocClub;
      this.relocClub = false;
      this.clubSpot = null;
      this.clubLocked = false;
      this.overlay.club = null;
      this.r.focus(c.x + dm.w / 2 + (moved ? 0 : 4), c.y + dm.h / 2, moved ? Math.max(this.r.cam.zoom, 0.5) : 0.7, this.game.world);
      this.onChange();
    }
  }

  private inspectAt(p: Pt) {
    if (this.placingClub) {
      this.aimClub(this.startTile, true);
      return;
    }
    const w = this.r.toWorld(p.x, p.y);
    let best: { id: number; d: number } | null = null;
    for (const g of this.game.sim.golfers) {
      const anchor=this.r.toScreen(g.x,g.y),size=Math.max(this.r.ts,16);
      const d=Math.hypot(p.x-anchor.x,(p.y-(anchor.y-size*.37))*.8);
      if (d < Math.max(10,size*.45) && (!best || d < best.d)) best = { id: g.id, d };
    }
    if (best) {
      this.game.selectedGolfer = best.id;
      this.onSelect('golfer');
      this.onChange();
      return;
    }
    const tx = Math.floor(w.x);
    const ty = Math.floor(w.y);
    if (!inBounds(this.game.world, tx, ty)) return;
    this.inspectTile = { x: tx, y: ty };
    const z = this.game.world.zone[idx(this.game.world, tx, ty)];
    if (z) this.game.selectedHole = z;
    this.game.selectedGolfer = 0;
    this.onSelect('hole');
    this.onChange();
  }

  get lastMessage() {
    return this.lastMsg;
  }
}

function boxTiles(world: Game['world'], c: Pt): number[] {
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inBounds(world, c.x + dx, c.y + dy)) out.push(idx(world, c.x + dx, c.y + dy));
  return out;
}

export const terrainLabel = (t: number) => ['Rough', 'Fairway', 'Green', 'Tee box', 'Bunker', 'Water', 'Cart path', 'Clubhouse'][t] ?? 'Unknown';

/** Roughly where an edit happened, for its cost tag: the middle of a new hole, or of the changed tiles. */
function planCentre(w: Game['world'], p: { tiles: { i: number }[]; newHole?: { tee: Pt; cup: Pt } }): Pt | null {
  if (p.newHole) return { x: (p.newHole.tee.x + p.newHole.cup.x) / 2 + 0.5, y: (p.newHole.tee.y + p.newHole.cup.y) / 2 + 0.5 };
  if (!p.tiles.length) return null;
  let sx = 0, sy = 0;
  for (const t of p.tiles) { sx += t.i % w.w; sy += Math.floor(t.i / w.w); }
  return { x: sx / p.tiles.length + 0.5, y: sy / p.tiles.length + 0.5 };
}
