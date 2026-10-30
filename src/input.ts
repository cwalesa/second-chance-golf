import { Game, fmtMoney } from './game';
import { Renderer, Overlay } from './render';
import { BRUSH_RADII, EditPlan, PAINT_TOOLS, TileEdit, ToolId, blockReason, brushTiles, planMoveCup, planMoveTee, planNewHole, planPaint, planTile } from './editing';
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
  overlay: Overlay = { tool: 'inspect', hoverTiles: [], changed: new Set(), blocked: new Set(), staged: new Set(), tooExpensive: false, hoverPt: null, parcel: null, buildTee: null, buildLine: null };
  /** Parcel picked with the Land tool. */
  parcel: { col: number; row: number } | null = null;
  /** A new-hole plan waiting for the player to confirm. */
  pending: EditPlan | null = null;
  private buildTee: Pt | null = null;
  preview: Preview | null = null;
  inspectTile: Pt | null = null;
  onChange: () => void = () => {};
  onSelect: (what: 'golfer' | 'hole') => void = () => {};

  private mode: Mode = 'none';
  private pointers = new Map<number, Pt>();
  private start: Pt = { x: 0, y: 0 };
  private moved = false;
  private staged = new Map<number, TileEdit>();
  private stagedCost = 0;
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
        this.setTool('inspect');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.game.undo();
        this.onChange();
      } else if (e.key === '[') this.setBrush(Math.max(0, this.brush - 1));
      else if (e.key === ']') this.setBrush(Math.min(BRUSH_RADII.length - 1, this.brush + 1));
      else if (e.key.toLowerCase() === 'p') this.game.setSpeed(this.game.settings.speed === 0 ? 1 : 0);
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') this.space = false;
    });
    window.addEventListener('blur', () => this.cancelStroke());
  }

  setTool(t: ToolId) {
    this.cancelStroke();
    if (t !== 'build') this.cancelBuild();
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

  private cancelStroke() {
    this.staged.clear();
    this.stagedCost = 0;
    this.limited = false;
    this.overlay.staged = new Set();
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
    const panByButton = e.button === 1 || e.button === 2 || this.space || this.tool === 'pan';
    if (panByButton) {
      this.mode = 'pan';
      return;
    }
    if (this.tool === 'inspect') this.mode = 'inspect';
    else if (this.isPaint) {
      this.mode = 'paint';
      this.staged.clear();
      this.stagedCost = 0;
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

  cancelBuild() {
    this.buildTee = null;
    this.pending = null;
    this.overlay.buildTee = null;
    this.overlay.buildLine = null;
    this.updateHover();
    this.onChange();
  }
  confirmBuild() {
    if (!this.pending) return;
    const res = this.game.commitEdit(this.pending);
    this.lastMsg = res.message;
    if (res.ok) this.cancelBuild();
    else this.onChange();
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
    if (this.mode === 'inspect' && !this.moved) this.inspectAt(p);
    else if (this.mode === 'paint') this.commitStroke();
    else if (this.mode === 'place' && over) {
      const t = this.tileAt(p);
      this.commitPlace(t);
    }
    this.mode = 'none';
    this.staged.clear();
    this.overlay.staged = new Set();
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
    if (!h || !inBounds(world, h.x, h.y) || (!this.isPaint && this.tool !== 'tee' && this.tool !== 'cup' && this.tool !== 'build' && this.tool !== 'land')) {
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
      const plan = planPaint(world, this.tool, foot);
      const changed = new Set(plan.tiles.map((t) => t.i));
      const blocked = new Set(foot.filter((i) => !changed.has(i) && blockReason(world, this.tool, i) !== null));
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
      const plan = this.tool === 'tee' ? planMoveTee(world, hole, h.x, h.y) : planMoveCup(world, hole, h.x, h.y);
      if (typeof plan === 'string') {
        this.overlay.hoverTiles = this.tool === 'tee' ? boxTiles(world, h) : brushTiles(world, h.x, h.y, 2);
        this.overlay.changed = new Set();
        this.overlay.blocked = new Set(this.overlay.hoverTiles);
        this.preview = { tool: this.tool, label: plan.length ? `Hole ${hole.id}` : '', tiles: 0, cost: 0, affordable: false, message: plan, stroking: false, limited: false };
      } else {
        const foot = this.tool === 'tee' ? boxTiles(world, h) : brushTiles(world, h.x, h.y, 2);
        const changed = new Set(plan.tiles.map((t) => t.i));
        this.overlay.hoverTiles = [...new Set([...foot, ...changed])];
        this.overlay.changed = changed;
        this.overlay.blocked = new Set();
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
        if (this.staged.has(i)) continue;
        const e = planTile(world, this.tool, i);
        if (!e) continue;
        if (Math.ceil(this.stagedCost + e.cost - 1e-9) > this.game.cash) {
          this.limited = true;
          this.skipCost = Math.max(this.skipCost, Math.ceil(e.cost));
          continue;
        }
        this.staged.set(i, e);
        this.stagedCost += e.cost;
      }
    }
    this.lastTile = t;
    this.overlay.staged = new Set(this.staged.keys());
    const foot = brushTiles(world, t.x, t.y, this.brush);
    this.overlay.hoverTiles = foot;
    this.overlay.changed = new Set();
    this.overlay.blocked = new Set();
    this.overlay.tooExpensive = this.limited;
    this.preview = {
      tool: this.tool,
      label: planPaint(world, this.tool, []).label,
      tiles: this.staged.size,
      cost: Math.ceil(this.stagedCost - 1e-9),
      affordable: !this.limited,
      message: this.limited ? 'Out of cash: the rest of this stroke will not be painted.' : '',
      stroking: true,
      limited: this.limited,
    };
    this.onChange();
  }

  private commitStroke() {
    if (!this.staged.size) {
      if (this.limited) this.game.notify('bad', `Not enough cash for that. A tile costs about ${fmtMoney(this.skipCost)} here and you have ${fmtMoney(this.game.cash)}.`);
      this.limited = false;
      this.skipCost = 0;
      return;
    }
    const plan: EditPlan = { tool: this.tool, label: this.preview?.label ?? 'Edit', tiles: [...this.staged.values()], cost: Math.ceil(this.stagedCost - 1e-9) };
    const limited = this.limited;
    const res = this.game.commitEdit(plan);
    this.lastMsg = res.message;
    if (res.ok && limited) this.game.notify('bad', 'You ran out of cash partway through. Only the affordable tiles were painted.');
    this.stagedCost = 0;
    this.limited = false;
    this.skipCost = 0;
    this.onChange();
  }

  private commitPlace(t: Pt) {
    if (!inBounds(this.game.world, t.x, t.y)) return;
    if (this.tool === 'land') {
      this.parcel = { col: Math.floor(t.x / CFG.land.pw), row: Math.floor(t.y / CFG.land.ph) };
      this.overlay.parcel = this.parcel;
      this.onChange();
      return;
    }
    if (this.tool === 'build') {
      if (this.pending) return;
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
      const ids = plan.tiles.map((x) => x.i);
      this.overlay.hoverTiles = ids;
      this.overlay.changed = new Set(ids);
      this.overlay.buildLine = { from: this.buildTee, to: t };
      this.preview = { tool: 'build', label: plan.label, tiles: plan.tiles.length, cost: plan.cost, affordable: plan.cost <= this.game.cash, message: '', stroking: false, limited: false };
      this.onChange();
      return;
    }
    const hole = this.game.hole(this.game.selectedHole);
    const plan = this.tool === 'tee' ? planMoveTee(this.game.world, hole, t.x, t.y) : planMoveCup(this.game.world, hole, t.x, t.y);
    if (typeof plan === 'string') {
      this.game.notify('bad', plan);
      return;
    }
    const res = this.game.commitEdit(plan);
    this.lastMsg = res.message;
    this.hover = null;
    this.updateHover();
  }

  private inspectAt(p: Pt) {
    const w = this.r.toWorld(p.x, p.y);
    let best: { id: number; d: number } | null = null;
    for (const g of this.game.sim.golfers) {
      const d = Math.hypot(g.x - w.x, g.y - 0.35 - w.y);
      if (d < 1.1 && (!best || d < best.d)) best = { id: g.id, d };
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
