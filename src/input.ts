import { projectGround } from './isometric';
import { Game, fmtMoney } from './game';
import { Renderer, Overlay } from './render';
import { BRUSH_RADII, EditPlan, PAINT_TOOLS, TOOL_INFO, TileEdit, ToolId, blockReason, brushTiles, mergeEdit, planMoveBend, planMoveCup, planMoveTee, planNewHole, planPaint, planTile, stagedState } from './editing';
import { CFG } from './config';
import { Pt, idx, inBounds } from './terrain';

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

type Mode = 'none' | 'pan' | 'inspect' | 'paint' | 'place' | 'pinch';

export class Editor {
  tool: ToolId;
  brush: number;
  overlay: Overlay = { tool: 'inspect', hoverTiles: [], changed: new Set(), blocked: new Set(), staged: new Set(), stagedKind: new Map(), tooExpensive: false, hoverPt: null, parcel: null, buildTee: null, buildLine: null, ghost: null };
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
  preview: Preview | null = null;
  inspectTile: Pt | null = null;
  onChange: () => void = () => {};
  onSelect: (what: 'golfer' | 'hole') => void = () => {};

  private mode: Mode = 'none';
  private pointers = new Map<number, Pt>();
  private start: Pt = { x: 0, y: 0 };
  private moved = false;
  private limited = false;
  private skipCost = 0;
  private lastTile: Pt | null = null;
  private pinch = { dist: 0, cx: 0, cy: 0 };
  private space = false;
  private hover: Pt | null = null;
  private lastMsg = '';

  constructor(private canvas: HTMLCanvasElement, private game: Game, private r: Renderer) {
    this.tool = game.settings.tool;
    this.brush = game.settings.brush;
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
      else if (e.key.toLowerCase() === 'p') this.game.setSpeed(this.game.settings.speed === 0 ? 1 : 0);
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
    if (h) {
      const width = this.r.cw - this.r.insets.l - this.r.insets.r - 40;
      const height = this.r.ch - this.r.insets.t - this.r.insets.b - 60;
      const points = [h.tee,h.cup,h.bend].map(p => projectGround(p.x * 32,p.y * 32));
      const spanX = Math.max(...points.map(p => p.x))-Math.min(...points.map(p => p.x))+240;
      const spanY = Math.max(...points.map(p => p.y))-Math.min(...points.map(p => p.y))+200;
      const zoom = Math.max(.25, Math.min(.95,width / spanX,Math.max(180,height) / spanY));
      this.r.focus((h.tee.x + h.cup.x) / 2 + .5, (h.tee.y + h.cup.y) / 2 + .5, zoom, this.game.world);
    }
  }
  setTool(t: ToolId) {
    this.cancelStroke();
    if (this.pending && !(t === 'build' && this.tool === 'build')) this.clearPending();
    if (t !== 'build') this.buildTee = null, this.overlay.buildTee = null, this.overlay.buildLine = null;
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
    if (res.ok) this.discard();
    else this.onChange();
  }
  /** Throw away everything not yet built. Nothing is charged. */
  discard() {
    this.batch.clear();
    this.stageKinds.clear();
    this.batchTools.clear();
    this.strokeUndo.clear();
    this.batchCost = 0;
    this.limited = false;
    this.rev++;
    this.clearPending();
    this.buildTee = null;
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
    const ok = this.game.undo();
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
  /** Choose which hole the hole tools work on; unbuilt placements belonged to the old one. */
  selectHole(id: number) {
    if (this.game.selectedHole !== id) this.clearPending();
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
    if (this.pointers.size === 2) {
      this.cancelStroke();
      this.mode = 'pinch';
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 2) return;
    this.start = p;
    this.moved = false;
    if (this.game.owner.active) { this.mode = 'inspect'; return; }
    this.game.followGolfer = 0;
    const panByButton = e.button === 1 || e.button === 2 || this.space || this.tool === 'pan';
    if (panByButton) {
      this.mode = 'pan';
      return;
    }
    if (this.tool === 'inspect') this.mode = 'inspect';
    else if (this.isPaint) {
      if (this.pending) this.clearPending();
      this.mode = 'paint';
      this.strokeUndo.clear();
      this.limited = false;
      this.skipCost = 0;
      this.lastTile = null;
      this.hover = this.tileAt(p);
      this.paintTo(this.hover);
    } else {
      this.mode = 'place';
      this.hover = this.tileAt(p);
      this.updateHover();
    }
  }

  private move(e: PointerEvent) {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      this.r.cam.x -= (cx - this.pinch.cx) / this.r.cam.zoom;
      this.r.cam.y -= (cy - this.pinch.cy) / this.r.cam.zoom;
      if (this.pinch.dist > 0) this.r.zoomAt(cx, cy, d / this.pinch.dist, this.game.world);
      this.r.clampCam(this.game.world);
      this.pinch = { dist: d, cx, cy };
      return;
    }
    if (!this.pointers.has(e.pointerId) && this.mode === 'none' && !this.overCanvas(e)) return;
    const over = this.overCanvas(e);
    if (this.mode === 'pan' || (this.mode === 'inspect' && Math.hypot(p.x - this.start.x, p.y - this.start.y) > 6)) {
      if (this.mode === 'inspect') this.mode = 'pan';
      const prev = this.lastPan ?? this.start;
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
  private lastPan: Pt | null = null;

  private up(e: PointerEvent) {
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    this.lastPan = null;
    if (this.mode === 'pinch') {
      if (this.pointers.size < 2) this.mode = 'none';
      return;
    }
    const over = this.overCanvas(e);
    if (this.mode === 'inspect' && !this.moved && this.game.owner.active) {
      this.game.owner.aim = this.r.toWorld(p.x, p.y);
    } else if (this.mode === 'inspect' && !this.moved) this.inspectAt(p);
    else if (this.mode === 'paint') this.endStroke();
    else if (this.mode === 'place' && over) {
      const t = this.tileAt(p);
      this.commitPlace(t);
    }
    this.mode = 'none';
    if (e.pointerType === 'mouse') this.updateHover();
    else this.clearHover();
  }

  private cancelPointer(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    this.lastPan = null;
    this.cancelStroke();
    this.mode = 'none';
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
        const plan = planNewHole(world, this.game.nextHoleId(), this.buildTee, h);
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
      const plan = this.tool === 'bend' ? planMoveBend(world, hole, h.x, h.y) : this.tool === 'tee' ? planMoveTee(world, hole, h.x, h.y) : planMoveCup(world, hole, h.x, h.y);
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
          bend: !before || before.bend.x !== after.bend.x || before.bend.y !== after.bend.y ? after.bend : undefined,
          par: after.par,
        }
      : null;
  }

  private commitPlace(t: Pt) {
    if (!inBounds(this.game.world, t.x, t.y)) return;
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
      if (!this.buildTee) {
        this.buildTee = t;
        this.overlay.buildTee = t;
        this.hover = t;
        this.updateHover();
        return;
      }
      const plan = planNewHole(this.game.world, this.game.nextHoleId(), this.buildTee, t);
      if (typeof plan === 'string') {
        this.game.notify('bad', plan);
        return;
      }
      this.pending = plan;
      this.rev++;
      this.showPlan(plan, []);
      this.overlay.buildLine = { from: this.buildTee, to: t };
      this.preview = { tool: 'build', label: plan.label, tiles: plan.tiles.length, cost: plan.cost, affordable: plan.cost <= this.game.cash, message: '', stroking: false, limited: false };
      this.onChange();
      return;
    }
    const hole = this.game.hole(this.game.selectedHole);
    const plan = this.tool === 'bend' ? planMoveBend(this.game.world, hole, t.x, t.y) : this.tool === 'tee' ? planMoveTee(this.game.world, hole, t.x, t.y) : planMoveCup(this.game.world, hole, t.x, t.y);
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

  private inspectAt(p: Pt) {
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
