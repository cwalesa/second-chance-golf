import { CFG } from './config';
import { Game } from './game';
import { Golfer } from './sim';
import { Pt, T, World, center, hash2, holePath, inBounds, vnoise } from './terrain';
import { ToolId } from './editing';

export const TS = 28; // tile size in the cached terrain canvas
type RGB = [number, number, number];

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, j = 0) => `rgb(${Math.max(0, Math.min(255, Math.round(c[0] + j)))},${Math.max(0, Math.min(255, Math.round(c[1] + j)))},${Math.max(0, Math.min(255, Math.round(c[2] + j)))})`;

const COL = {
  roughGood: [64, 137, 60] as RGB,
  roughBad: [118, 140, 66] as RGB,
  fairGood: [106, 180, 74] as RGB,
  fairWorn: [158, 144, 88] as RGB,
  greenGood: [84, 170, 96] as RGB,
  greenWorn: [152, 142, 92] as RGB,
  teeGood: [112, 188, 96] as RGB,
  dirt: [146, 116, 78] as RGB,
  sand: [236, 218, 164] as RGB,
  sandRim: [196, 168, 110] as RGB,
  water: [58, 142, 198] as RGB,
  waterDeep: [40, 112, 172] as RGB,
  path: [192, 184, 168] as RGB,
};

export interface Overlay {
  tool: ToolId;
  hoverTiles: number[];
  changed: Set<number>;
  blocked: Set<number>;
  staged: Set<number>;
  tooExpensive: boolean;
  hoverPt: Pt | null;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  terr = document.createElement('canvas');
  tctx: CanvasRenderingContext2D;
  cam = { x: 40 * TS, y: 26 * TS, zoom: 0.62 };
  cw = 800;
  ch = 600;
  dpr = 1;
  private trees: HTMLCanvasElement[] = [];
  private builtFor: World | null = null;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.terr.width = CFG.grid.w * TS;
    this.terr.height = CFG.grid.h * TS;
    this.tctx = this.terr.getContext('2d')!;
    for (let v = 0; v < 5; v++) this.trees.push(makeTree(v));
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cw = Math.max(200, r.width);
    this.ch = Math.max(200, r.height);
    this.canvas.width = Math.round(this.cw * this.dpr);
    this.canvas.height = Math.round(this.ch * this.dpr);
  }

  get ts() {
    return TS * this.cam.zoom;
  }
  toScreen(wx: number, wy: number): Pt {
    return { x: (wx * TS - this.cam.x) * this.cam.zoom + this.cw / 2, y: (wy * TS - this.cam.y) * this.cam.zoom + this.ch / 2 };
  }
  toWorld(sx: number, sy: number): Pt {
    return { x: ((sx - this.cw / 2) / this.cam.zoom + this.cam.x) / TS, y: ((sy - this.ch / 2) / this.cam.zoom + this.cam.y) / TS };
  }
  clampCam(w: World) {
    const z = this.cam.zoom;
    const hw = this.cw / 2 / z;
    const hh = this.ch / 2 / z;
    const mw = w.w * TS;
    const mh = w.h * TS;
    this.cam.x = mw <= hw * 2 ? mw / 2 : Math.max(hw - 60, Math.min(mw - hw + 60, this.cam.x));
    this.cam.y = mh <= hh * 2 ? mh / 2 : Math.max(hh - 60, Math.min(mh - hh + 60, this.cam.y));
  }
  zoomAt(sx: number, sy: number, factor: number, w: World) {
    const before = this.toWorld(sx, sy);
    this.cam.zoom = Math.max(0.35, Math.min(2.6, this.cam.zoom * factor));
    const after = this.toWorld(sx, sy);
    this.cam.x += (before.x - after.x) * TS;
    this.cam.y += (before.y - after.y) * TS;
    this.clampCam(w);
  }
  /** Put world point (tx,ty) in the middle of the area not covered by the side panels. */
  focus(tx: number, ty: number, zoom: number, w: World) {
    this.cam.zoom = zoom;
    const left = this.cw > 900 ? 90 : 84;
    const right = this.cw > 1100 ? 330 : this.cw > 860 ? 280 : 250;
    const sx = (left + (this.cw - right)) / 2;
    const sy = (46 + (this.ch - 50)) / 2;
    this.cam.x = tx * TS - (sx - this.cw / 2) / zoom;
    this.cam.y = ty * TS - (sy - this.ch / 2) / zoom;
    this.clampCam(w);
  }
  fit(w: World) {
    this.cam.zoom = Math.min(this.cw / (w.w * TS), this.ch / (w.h * TS)) * 1.02;
    this.cam.x = (w.w * TS) / 2;
    this.cam.y = (w.h * TS) / 2;
    this.clampCam(w);
  }

  // ---------- terrain cache ----------
  private syncTerrain(w: World) {
    if (this.builtFor !== w) {
      this.builtFor = w;
      for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) this.drawTile(w, x, y);
      w.dirty.clear();
      return;
    }
    if (!w.dirty.size) return;
    const todo = new Set<number>();
    for (const i of w.dirty) {
      const x = i % w.w;
      const y = (i - x) / w.w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inBounds(w, x + dx, y + dy)) todo.add((y + dy) * w.w + x + dx);
    }
    for (const i of todo) this.drawTile(w, i % w.w, Math.floor(i / w.w));
    w.dirty.clear();
  }

  private drawTile(w: World, x: number, y: number) {
    const c = this.tctx;
    const i = y * w.w + x;
    const t = w.terrain[i];
    const cond = w.cond[i];
    const px = x * TS;
    const py = y * TS;
    const tt = (dx: number, dy: number) => (inBounds(w, x + dx, y + dy) ? w.terrain[i + dy * w.w + dx] : T.ROUGH);
    const jit = (vnoise(x / 2.6, y / 2.6, 41) - 0.5) * 15 + (hash2(x, y, 40) - 0.5) * 4;
    const roughCol = (cc: number) => mix(COL.roughBad, COL.roughGood, Math.max(0, Math.min(1, cc / 70)));
    const same = (a: number) => (t === a) || (t === T.FAIRWAY && (a === T.GREEN || a === T.TEE));
    const corners = (): [number, number, number, number] => {
      const up = same(tt(0, -1));
      const dn = same(tt(0, 1));
      const lf = same(tt(-1, 0));
      const rt = same(tt(1, 0));
      const r = TS * 0.5;
      return [!up && !lf ? r : 0, !up && !rt ? r : 0, !dn && !rt ? r : 0, !dn && !lf ? r : 0];
    };
    const shape = (r: [number, number, number, number]) => {
      c.beginPath();
      c.moveTo(px + r[0], py);
      c.lineTo(px + TS - r[1], py);
      if (r[1]) c.arcTo(px + TS, py, px + TS, py + r[1], r[1]);
      else c.lineTo(px + TS, py);
      c.lineTo(px + TS, py + TS - r[2]);
      if (r[2]) c.arcTo(px + TS, py + TS, px + TS - r[2], py + TS, r[2]);
      else c.lineTo(px + TS, py + TS);
      c.lineTo(px + r[3], py + TS);
      if (r[3]) c.arcTo(px, py + TS, px, py + TS - r[3], r[3]);
      else c.lineTo(px, py + TS);
      c.lineTo(px, py + r[0]);
      if (r[0]) c.arcTo(px, py, px + r[0], py, r[0]);
      c.closePath();
    };
    // underlay
    let under = mix(roughCol(62), roughCol(62), 0);
    if (t === T.GREEN || t === T.TEE) {
      const nf = [tt(0, -1), tt(0, 1), tt(-1, 0), tt(1, 0)].filter((v) => v === T.FAIRWAY).length;
      if (nf) under = mix(COL.fairGood, COL.fairWorn, 0.15);
    }
    if (t === T.ROUGH) under = roughCol(cond);
    if (t === T.PATH || t === T.BUILDING) under = roughCol(60);
    c.fillStyle = css(under, jit);
    c.fillRect(px, py, TS, TS);

    const grass = (base: RGB, worn: RGB, stripe: number) => {
      const wear = Math.max(0, Math.min(1, (64 - cond) / 54));
      let col = mix(base, worn, wear);
      col = [col[0] + stripe, col[1] + stripe, col[2] + stripe * 0.6];
      shape(corners());
      c.fillStyle = css(col, jit * 0.7);
      c.fill();
      if (cond < 42) {
        c.save();
        shape(corners());
        c.clip();
        const n = cond < 25 ? 3 : 2;
        for (let k = 0; k < n; k++) {
          const ex = px + hash2(x, y, 50 + k) * TS;
          const ey = py + hash2(x, y, 60 + k) * TS;
          c.fillStyle = `rgba(${COL.dirt[0]},${COL.dirt[1]},${COL.dirt[2]},${0.22 + (42 - cond) / 140})`;
          c.beginPath();
          c.ellipse(ex, ey, TS * (0.16 + hash2(x, y, 70 + k) * 0.22), TS * (0.1 + hash2(x, y, 80 + k) * 0.16), hash2(x, y, 90 + k) * 3, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = 'rgba(90,70,40,0.35)';
        for (let k = 0; k < 4; k++) c.fillRect(px + hash2(x, y, 100 + k) * TS, py + hash2(x, y, 110 + k) * TS, 1.5, 1.5);
        c.restore();
      } else {
        c.fillStyle = 'rgba(255,255,255,0.09)';
        for (let k = 0; k < 3; k++) c.fillRect(px + hash2(x, y, 120 + k) * (TS - 2), py + hash2(x, y, 130 + k) * (TS - 3), 1, 3);
      }
    };

    const fringe = () => {
      c.strokeStyle = 'rgba(20,60,25,0.28)';
      c.lineWidth = 1.6;
      const e = (dx: number, dy: number, x1: number, y1: number, x2: number, y2: number) => {
        if (!same(tt(dx, dy))) {
          c.beginPath();
          c.moveTo(px + x1, py + y1);
          c.lineTo(px + x2, py + y2);
          c.stroke();
        }
      };
      e(0, -1, 5, 0.8, TS - 5, 0.8);
      e(-1, 0, 0.8, 5, 0.8, TS - 5);
      e(0, 1, 5, TS - 0.8, TS - 5, TS - 0.8);
      e(1, 0, TS - 0.8, 5, TS - 0.8, TS - 5);
    };
    switch (t) {
      case T.ROUGH: {
        const tall = cond < 45;
        const n = tall ? 7 : 3;
        for (let k = 0; k < n; k++) {
          const bx = px + hash2(x, y, 140 + k) * TS;
          const by = py + 4 + hash2(x, y, 150 + k) * (TS - 4);
          c.strokeStyle = tall ? (k % 2 ? 'rgba(176,170,88,0.8)' : 'rgba(112,126,52,0.85)') : k % 2 ? 'rgba(88,158,76,0.7)' : 'rgba(40,104,46,0.6)';
          c.lineWidth = 1.2;
          c.beginPath();
          c.moveTo(bx, by);
          c.lineTo(bx + (hash2(x, y, 160 + k) - 0.5) * 4, by - (tall ? 6 + hash2(x, y, 170 + k) * 4 : 3));
          c.stroke();
        }
        if (cond < 32 && hash2(x, y, 180) < 0.14) {
          c.fillStyle = ['#f3efe2', '#f1d24f', '#b98bd6'][Math.floor(hash2(x, y, 181) * 3)];
          c.beginPath();
          c.arc(px + 5 + hash2(x, y, 182) * (TS - 10), py + 5 + hash2(x, y, 183) * (TS - 10), 1.7, 0, Math.PI * 2);
          c.fill();
        }
        break;
      }
      case T.FAIRWAY:
        grass(COL.fairGood, COL.fairWorn, ((x - y) >> 1) & 1 ? 6 : -4);
        fringe();
        break;
      case T.GREEN:
        grass(COL.greenGood, COL.greenWorn, (x + y) & 1 ? 4 : -3);
        fringe();
        break;
      case T.TEE:
        grass(COL.teeGood, COL.fairWorn, 0);
        fringe();
        break;
      case T.BUNKER: {
        shape(corners());
        c.fillStyle = css(COL.sand, jit);
        c.fill();
        c.fillStyle = 'rgba(160,130,80,0.35)';
        for (let k = 0; k < 6; k++) c.fillRect(px + hash2(x, y, 190 + k) * (TS - 1), py + hash2(x, y, 200 + k) * (TS - 1), 1.4, 1.4);
        c.strokeStyle = css(COL.sandRim);
        c.lineWidth = 2.2;
        const edge = (dx: number, dy: number, x1: number, y1: number, x2: number, y2: number) => {
          if (tt(dx, dy) !== T.BUNKER) {
            c.beginPath();
            c.moveTo(px + x1, py + y1);
            c.lineTo(px + x2, py + y2);
            c.stroke();
          }
        };
        edge(0, -1, 3, 1, TS - 3, 1);
        edge(-1, 0, 1, 3, 1, TS - 3);
        edge(0, 1, 3, TS - 1, TS - 3, TS - 1);
        edge(1, 0, TS - 1, 3, TS - 1, TS - 3);
        break;
      }
      case T.WATER: {
        shape(corners());
        c.fillStyle = css(mix(COL.water, COL.waterDeep, vnoise(x / 2.2, y / 2.2, 210) * 0.7));
        c.fill();
        c.strokeStyle = 'rgba(170,220,230,0.6)';
        c.lineWidth = 2;
        const edge = (dx: number, dy: number, x1: number, y1: number, x2: number, y2: number) => {
          if (tt(dx, dy) !== T.WATER) {
            c.beginPath();
            c.moveTo(px + x1, py + y1);
            c.lineTo(px + x2, py + y2);
            c.stroke();
          }
        };
        edge(0, -1, 4, 1, TS - 4, 1);
        edge(-1, 0, 1, 4, 1, TS - 4);
        edge(0, 1, 4, TS - 1, TS - 4, TS - 1);
        edge(1, 0, TS - 1, 4, TS - 1, TS - 4);
        // cattails on shore
        if (tt(0, 1) !== T.WATER && tt(0, 1) !== T.BUNKER && hash2(x, y, 220) < 0.3) {
          for (let k = 0; k < 2; k++) {
            const bx = px + 6 + hash2(x, y, 221 + k) * (TS - 12);
            c.strokeStyle = '#4e6b2e';
            c.lineWidth = 1.2;
            c.beginPath();
            c.moveTo(bx, py + TS);
            c.lineTo(bx + 1, py + TS - 11);
            c.stroke();
            c.fillStyle = '#6b4226';
            c.fillRect(bx - 0.5, py + TS - 14, 2.4, 5);
          }
        }
        break;
      }
      case T.PATH:
      case T.BUILDING: {
        c.fillStyle = css(COL.path, jit);
        c.fillRect(px, py, TS, TS);
        c.fillStyle = 'rgba(110,100,86,0.4)';
        for (let k = 0; k < 6; k++) c.fillRect(px + hash2(x, y, 230 + k) * (TS - 1), py + hash2(x, y, 240 + k) * (TS - 1), 1.5, 1.5);
        if (hash2(x, y, 250) < 0.35) {
          c.strokeStyle = 'rgba(70,64,52,0.55)';
          c.lineWidth = 1;
          const sx = px + hash2(x, y, 251) * TS;
          c.beginPath();
          c.moveTo(sx, py);
          c.lineTo(sx + 5, py + TS * 0.4);
          c.lineTo(sx - 2, py + TS * 0.75);
          c.stroke();
          c.fillStyle = 'rgba(80,140,60,0.9)';
          c.fillRect(sx + 3, py + TS * 0.4 - 1, 2, 3);
        }
        break;
      }
    }
  }

  // ---------- frame ----------
  render(game: Game, ov: Overlay, time: number) {
    const w = game.world;
    this.syncTerrain(w);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#243d2a';
    ctx.fillRect(0, 0, this.cw, this.ch);
    const z = this.cam.zoom;
    const o = this.toScreen(0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.terr, o.x, o.y, w.w * TS * z, w.h * TS * z);
    const ts = this.ts;
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(this.cw, this.ch);
    const x0 = Math.max(0, Math.floor(tl.x) - 1);
    const y0 = Math.max(0, Math.floor(tl.y) - 1);
    const x1 = Math.min(w.w - 1, Math.ceil(br.x) + 1);
    const y1 = Math.min(w.h - 1, Math.ceil(br.y) + 2);

    // water shimmer
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = Math.max(1, ts * 0.04);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (w.terrain[y * w.w + x] !== T.WATER || hash2(x, y, 300) > 0.55) continue;
        const p = this.toScreen(x, y);
        const ph = time * 0.9 + hash2(x, y, 301) * 6;
        const a = (Math.sin(ph) * 0.5 + 0.5) * 0.7 + 0.15;
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.moveTo(p.x + ts * 0.2, p.y + ts * (0.35 + 0.3 * hash2(x, y, 302)));
        ctx.lineTo(p.x + ts * (0.45 + 0.1 * Math.sin(ph)), p.y + ts * (0.35 + 0.3 * hash2(x, y, 302)));
        ctx.stroke();
      }
    ctx.globalAlpha = 1;

    // grid while editing
    if (ov.tool !== 'inspect' && ov.tool !== 'pan' && ts >= 14) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1 + 1; x++) {
        const p = this.toScreen(x, 0);
        ctx.moveTo(Math.round(p.x) + 0.5, 0);
        ctx.lineTo(Math.round(p.x) + 0.5, this.ch);
      }
      for (let y = y0; y <= y1 + 1; y++) {
        const p = this.toScreen(0, y);
        ctx.moveTo(0, Math.round(p.y) + 0.5);
        ctx.lineTo(this.cw, Math.round(p.y) + 0.5);
      }
      ctx.stroke();
    }

    this.drawHoleMarkers(game, time);
    this.drawBuilding(game, time);

    // y-sorted: trees + golfers
    type Item = { y: number; draw: () => void };
    const items: Item[] = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w.w + x;
        if (!w.tree[i]) continue;
        const hh = hash2(x, y, 400);
        const dead = w.cond[i] < 30 && hh < 0.28;
        const variant = dead ? 3 : w.cond[i] < 38 && hh < 0.6 ? 4 : hh < 0.4 ? 0 : hh < 0.7 ? 1 : 2;
        items.push({ y: y + 0.95, draw: () => this.drawTree(x, y, variant, hh) });
      }
    for (const g of game.sim.golfers) items.push({ y: g.y, draw: () => this.drawGolfer(g, g.id === game.selectedGolfer, time) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // balls and trails above everything
    for (const g of game.sim.golfers) this.drawBall(g);
    for (const g of game.sim.golfers) if (g.bubble) this.drawBubble(g);
    for (const g of game.sim.golfers) this.drawChips(g);

    this.drawQueues(game);
    this.drawOverlay(game, ov, time);

    // time-of-day light
    const frac = game.clock / CFG.day.seconds;
    const warm = frac < 0.12 ? (0.12 - frac) / 0.12 : frac > 0.78 ? (frac - 0.78) / 0.22 : 0;
    if (warm > 0) {
      ctx.fillStyle = `rgba(255,150,60,${0.14 * warm})`;
      ctx.fillRect(0, 0, this.cw, this.ch);
    }
  }

  private drawTree(x: number, y: number, v: number, hh: number) {
    const ctx = this.ctx;
    const ts = this.ts;
    const p = this.toScreen(x + 0.5, y + 0.95);
    const size = ts * (1.55 + hh * 0.45);
    ctx.fillStyle = 'rgba(10,30,15,0.22)';
    ctx.beginPath();
    ctx.ellipse(p.x + size * 0.22, p.y - size * 0.02, size * 0.34, size * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    const spr = this.trees[v];
    ctx.drawImage(spr, p.x - size / 2, p.y - size * 1.12, size, size * 1.17);
  }

  private drawGolfer(g: Golfer, selected: boolean, time: number) {
    const ctx = this.ctx;
    const u = Math.max(this.ts, 28);
    const p = this.toScreen(g.x, g.y);
    const gt = CFG.golfers.types[g.type];
    const walking = g.phase === 'arrive' || g.phase === 'toTee' || g.phase === 'toBall' || g.phase === 'toExit' || g.phase === 'leave';
    const sw = walking ? Math.sin(g.walkT) : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, u * 0.2, u * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = '#ffe27a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, u * 0.34, u * 0.14, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#3b3f4d';
    ctx.lineWidth = Math.max(1.5, u * 0.07);
    ctx.beginPath();
    ctx.moveTo(p.x - u * 0.04, p.y - u * 0.26);
    ctx.lineTo(p.x - u * 0.05 + sw * u * 0.08, p.y);
    ctx.moveTo(p.x + u * 0.04, p.y - u * 0.26);
    ctx.lineTo(p.x + u * 0.05 - sw * u * 0.08, p.y);
    ctx.stroke();
    const bob = walking ? Math.abs(sw) * u * 0.02 : 0;
    ctx.fillStyle = gt.shirt;
    ctx.beginPath();
    ctx.roundRect(p.x - u * 0.11, p.y - u * 0.56 - bob, u * 0.22, u * 0.32, u * 0.06);
    ctx.fill();
    ctx.fillStyle = '#e8c39e';
    ctx.beginPath();
    ctx.arc(p.x, p.y - u * 0.66 - bob, u * 0.095, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = gt.cap;
    ctx.beginPath();
    ctx.arc(p.x, p.y - u * 0.68 - bob, u * 0.098, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(p.x + (g.dir > 0 ? 0 : -u * 0.13), p.y - u * 0.69 - bob, u * 0.13, u * 0.03);
    // club
    let ang = 0.5;
    if (g.phase === 'swing') {
      const s = Math.min(1, g.swingT / 0.4);
      ang = s < 0.55 ? -2.2 + (s / 0.55) * 0.3 : -1.9 + ((s - 0.55) / 0.45) * 4.2;
    } else if (g.phase === 'address') ang = 0.9;
    const hx = p.x + g.dir * u * 0.12;
    const hy = p.y - u * 0.4;
    const cx = hx + Math.sin(ang) * g.dir * u * 0.5;
    const cy = hy + Math.cos(ang) * u * 0.5;
    ctx.strokeStyle = '#d9d9d9';
    ctx.lineWidth = Math.max(1, u * 0.04);
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    void time;
  }

  private drawBall(g: Golfer) {
    if (!g.ballVisible) return;
    const ctx = this.ctx;
    const u = Math.max(this.ts, 22);
    const p = this.toScreen(g.ball.x, g.ball.y);
    if (g.flight && g.trail.length > 1 && !g.flight.putt) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = Math.max(1, u * 0.05);
      ctx.setLineDash([u * 0.12, u * 0.1]);
      ctx.beginPath();
      g.trail.forEach((t, k) => {
        const s = this.toScreen(t.x, t.y);
        if (k === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const r = Math.max(2.2, u * 0.085) * (1 + g.ballZ * 0.1);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(p.x + g.ballZ * u * 0.12, p.y, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(p.x, p.y - g.ballZ * u * 0.5 - r * 0.4, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private drawBubble(g: Golfer) {
    const ctx = this.ctx;
    const b = g.bubble!;
    const p = this.toScreen(g.x, g.y);
    const u = Math.max(this.ts, 22);
    ctx.font = '600 12px system-ui, sans-serif';
    const maxW = 170;
    const words = b.text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const wd of words) {
      const t = cur ? cur + ' ' + wd : wd;
      if (ctx.measureText(t).width > maxW && cur) {
        lines.push(cur);
        cur = wd;
      } else cur = t;
    }
    lines.push(cur);
    const wpx = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14;
    const hpx = lines.length * 15 + 8;
    const bx = p.x - wpx / 2;
    const by = p.y - u * 0.95 - hpx - 4;
    ctx.globalAlpha = Math.min(1, b.t / 0.6);
    ctx.fillStyle = 'rgba(255,252,244,0.96)';
    ctx.strokeStyle = 'rgba(40,40,30,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, wpx, hpx, 7);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - 4, by + hpx);
    ctx.lineTo(p.x, by + hpx + 5);
    ctx.lineTo(p.x + 4, by + hpx);
    ctx.fillStyle = 'rgba(255,252,244,0.96)';
    ctx.fill();
    ctx.fillStyle = '#2a2a22';
    ctx.textBaseline = 'middle';
    lines.forEach((l, k) => ctx.fillText(l, bx + 7, by + 4 + 7.5 + k * 15));
    ctx.globalAlpha = 1;
  }

  private drawChips(g: Golfer) {
    const ctx = this.ctx;
    const u = Math.max(this.ts, 22);
    const p = this.toScreen(g.x, g.y);
    const chip = (text: string, y: number, bg: string, fg = '#fff') => {
      ctx.font = '700 11px system-ui, sans-serif';
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(p.x - w / 2, y - 7, w, 14, 7);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, p.x - w / 2 + 5, y + 0.5);
    };
    if (g.scoreFlash) {
      ctx.globalAlpha = Math.min(1, g.scoreFlash.t / 0.5);
      chip(g.scoreFlash.text, p.y - u * 0.95 - (2.2 - g.scoreFlash.t) * 6, '#f7e08a', '#3a3000');
      ctx.globalAlpha = 1;
    } else if (g.hs.strokes > 0 && (g.phase === 'toBall' || g.phase === 'address' || g.phase === 'swing' || g.phase === 'flight') && !g.bubble && u > 14) {
      chip(String(g.hs.strokes), p.y - u * 0.92, 'rgba(25,32,28,0.78)');
    }
  }

  private drawQueues(game: Game) {
    const ctx = this.ctx;
    for (const h of game.world.holes) {
      if (!h.open) continue;
      const n = game.sim.queueFor(h.id).length;
      if (!n) continue;
      const slot = game.sim.queueSlot(h, 0);
      const p = this.toScreen(slot.x, slot.y);
      const text = n === 1 ? '1 waiting' : `${n} waiting`;
      ctx.font = '700 11px system-ui, sans-serif';
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = n >= 3 ? '#c2552d' : '#d79a2f';
      ctx.beginPath();
      ctx.roundRect(p.x - w / 2, p.y + this.ts * 0.2, w, 16, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, p.x - w / 2 + 6, p.y + this.ts * 0.2 + 8.5);
    }
  }

  private drawHoleMarkers(game: Game, time: number) {
    const ctx = this.ctx;
    const u = this.ts;
    for (const h of game.world.holes) {
      const cup = this.toScreen(h.cup.x + 0.5, h.cup.y + 0.5);
      const tee = center(h.tee);
      const dir = Math.atan2(h.bend.y - h.tee.y, h.bend.x - h.tee.x);
      // cup + flag
      ctx.fillStyle = '#1b2a1b';
      ctx.beginPath();
      ctx.ellipse(cup.x, cup.y, u * 0.1, u * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
      if (h.open) {
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.beginPath();
        ctx.ellipse(cup.x + u * 0.25, cup.y + u * 0.04, u * 0.3, u * 0.05, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#f2f2ee';
        ctx.lineWidth = Math.max(1.4, u * 0.05);
        ctx.beginPath();
        ctx.moveTo(cup.x, cup.y);
        ctx.lineTo(cup.x, cup.y - u * 1.25);
        ctx.stroke();
        const wave = Math.sin(time * 4 + h.id) * u * 0.05;
        ctx.fillStyle = h.id === 2 ? '#e4c13a' : h.id === 3 ? '#3a73d1' : '#d2432f';
        ctx.beginPath();
        ctx.moveTo(cup.x, cup.y - u * 1.25);
        ctx.lineTo(cup.x + u * 0.55, cup.y - u * 1.1 + wave);
        ctx.lineTo(cup.x, cup.y - u * 0.92);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#a89870';
        ctx.lineWidth = Math.max(1.4, u * 0.05);
        ctx.beginPath();
        ctx.moveTo(cup.x, cup.y);
        ctx.lineTo(cup.x + u * 0.3, cup.y - u * 0.55);
        ctx.stroke();
        ctx.fillStyle = '#7a6a48';
        ctx.fillRect(cup.x + u * 0.28, cup.y - u * 0.62, u * 0.28, u * 0.16);
      }
      // tee markers
      const t = this.toScreen(tee.x, tee.y);
      const px = -Math.sin(dir) * u * 1.05;
      const py = Math.cos(dir) * u * 1.05;
      for (const s of [-1, 1]) {
        ctx.fillStyle = h.open ? (s < 0 ? '#2d6ccb' : '#f3f3ee') : '#8a8068';
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(t.x + px * s, t.y + py * s - u * 0.08, Math.max(2.5, u * 0.1), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      // sign
      const sx = t.x - Math.cos(dir) * u * 1.5 - px * 1.2;
      const sy = t.y - Math.sin(dir) * u * 1.5 - py * 1.2;
      ctx.strokeStyle = '#5a3f26';
      ctx.lineWidth = Math.max(1.5, u * 0.06);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy - u * 0.65);
      ctx.stroke();
      ctx.fillStyle = h.open ? '#f4ead0' : '#cfc7b0';
      ctx.strokeStyle = '#5a3f26';
      ctx.beginPath();
      ctx.roundRect(sx - u * 0.34, sy - u * 1.0, u * 0.68, u * 0.4, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2b2218';
      ctx.font = `700 ${Math.max(9, u * 0.28)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${h.id}`, sx - u * 0.12, sy - u * 0.8);
      ctx.font = `600 ${Math.max(7, u * 0.18)}px system-ui, sans-serif`;
      ctx.fillText(`P${h.par}`, sx + u * 0.15, sy - u * 0.8);
      ctx.textAlign = 'left';
      if (!h.open) {
        // rope and CLOSED sign
        ctx.strokeStyle = '#c24a2c';
        ctx.lineWidth = Math.max(1.5, u * 0.05);
        ctx.beginPath();
        ctx.moveTo(t.x - px * 1.2 + u * 1.3 * Math.cos(dir), t.y - py * 1.2 + u * 1.3 * Math.sin(dir));
        ctx.quadraticCurveTo(t.x + u * 1.5 * Math.cos(dir), t.y + u * 1.5 * Math.sin(dir) + u * 0.2, t.x + px * 1.2 + u * 1.3 * Math.cos(dir), t.y + py * 1.2 + u * 1.3 * Math.sin(dir));
        ctx.stroke();
        const bx = t.x + u * 1.6 * Math.cos(dir);
        const by = t.y + u * 1.6 * Math.sin(dir) - u * 0.5;
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(-0.08);
        ctx.fillStyle = '#b8402a';
        ctx.beginPath();
        ctx.roundRect(-u * 0.55, -u * 0.18, u * 1.1, u * 0.36, 3);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `800 ${Math.max(8, u * 0.22)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('CLOSED', 0, 1);
        ctx.restore();
        ctx.textAlign = 'left';
      }
    }
  }

  private drawBuilding(game: Game, time: number) {
    const ctx = this.ctx;
    const a = this.toScreen(3, 41);
    const u = this.ts;
    const w = 7 * u;
    const h = 5 * u;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(a.x + u * 0.3, a.y + u * 0.35, w, h);
    // walls peek + roof
    ctx.fillStyle = '#d9c7a0';
    ctx.fillRect(a.x, a.y, w, h);
    const g = ctx.createLinearGradient(a.x, a.y, a.x, a.y + h);
    g.addColorStop(0, '#b4533d');
    g.addColorStop(1, '#8d3c2e');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(a.x - u * 0.2, a.y + u * 0.2, w + u * 0.4, h - u * 0.6, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth = 1;
    for (let k = 1; k < 8; k++) {
      ctx.beginPath();
      ctx.moveTo(a.x - u * 0.2, a.y + u * 0.2 + ((h - u * 0.6) / 8) * k);
      ctx.lineTo(a.x + w + u * 0.2, a.y + u * 0.2 + ((h - u * 0.6) / 8) * k);
      ctx.stroke();
    }
    // missing shingles (neglect)
    ctx.fillStyle = '#6e3a2c';
    ctx.fillRect(a.x + u * 1.2, a.y + u * 1.0, u * 0.9, u * 0.5);
    ctx.fillRect(a.x + u * 4.8, a.y + u * 2.3, u * 0.7, u * 0.45);
    // porch + door facing the course
    ctx.fillStyle = '#c8b690';
    ctx.fillRect(a.x + u * 2.5, a.y - u * 0.35, u * 2, u * 0.55);
    ctx.fillStyle = '#5b3d28';
    ctx.fillRect(a.x + u * 3.25, a.y - u * 0.3, u * 0.5, u * 0.5);
    // chimney
    ctx.fillStyle = '#7b6e66';
    ctx.fillRect(a.x + u * 5.6, a.y + u * 0.5, u * 0.5, u * 0.6);
    // sign
    ctx.save();
    ctx.translate(a.x + u * 3.5, a.y + u * 2.7);
    ctx.rotate(-0.045);
    ctx.fillStyle = '#efe4c4';
    ctx.strokeStyle = '#4a3320';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-u * 2, -u * 0.38, u * 4, u * 0.76, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#2d4a33';
    ctx.font = `700 ${Math.max(8, u * 0.3)}px Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SECOND CHANCE GOLF', 0, -u * 0.1);
    ctx.font = `italic ${Math.max(7, u * 0.2)}px Georgia, serif`;
    ctx.fillStyle = '#6b5a3c';
    ctx.fillText('under new management', 0, u * 0.18);
    ctx.restore();
    ctx.textAlign = 'left';
    // cars
    const cars: [number, number, string][] = [[12, 43, '#6f8fa8'], [15.2, 45, '#a35a4a'], [17.5, 43.2, '#8d8f86']];
    for (const [cx, cy, col] of cars) {
      const p = this.toScreen(cx, cy);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(p.x + 2, p.y + 3, u * 1.5, u * 0.8);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, u * 1.5, u * 0.8, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(30,40,50,0.55)';
      ctx.fillRect(p.x + u * 0.4, p.y + u * 0.1, u * 0.6, u * 0.6);
    }
    // golfers' bags and entrance gate
    const gate = this.toScreen(0, 46.8);
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(gate.x, gate.y - u * 0.4, u * 0.2, u * 1.9);
    ctx.fillRect(gate.x + u * 2.4, gate.y - u * 0.4, u * 0.2, u * 1.9);
    void game;
    void time;
  }

  private drawOverlay(game: Game, ov: Overlay, time: number) {
    const ctx = this.ctx;
    const w = game.world;
    const ts = this.ts;
    const tileRect = (i: number) => {
      const x = i % w.w;
      const y = (i - x) / w.w;
      const p = this.toScreen(x, y);
      return { x: p.x, y: p.y };
    };
    const toolColor: Record<string, string> = { fairway: '110,200,80', rough: '70,140,60', bunker: '240,214,140', water: '70,150,230', treeAdd: '40,120,50', treeDel: '230,140,60', repair: '120,230,160', tee: '255,255,255', cup: '255,255,255' };
    const col = toolColor[ov.tool] ?? '255,255,255';
    for (const i of ov.hoverTiles) {
      const r = tileRect(i);
      if (ov.blocked.has(i)) {
        ctx.fillStyle = 'rgba(220,60,50,0.35)';
        ctx.fillRect(r.x, r.y, ts, ts);
      } else if (ov.changed.has(i)) {
        ctx.fillStyle = ov.tooExpensive ? 'rgba(220,60,50,0.45)' : `rgba(${col},0.5)`;
        ctx.fillRect(r.x, r.y, ts, ts);
        ctx.strokeStyle = ov.tooExpensive ? 'rgba(255,120,100,1)' : 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(r.x + 0.75, r.y + 0.75, ts - 1.5, ts - 1.5);
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, ts - 1, ts - 1);
      }
    }
    for (const i of ov.staged) {
      const r = tileRect(i);
      ctx.fillStyle = `rgba(${col},0.55)`;
      ctx.fillRect(r.x, r.y, ts, ts);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.x + 0.75, r.y + 0.75, ts - 1.5, ts - 1.5);
    }

    // selected hole routing line
    const h = game.world.holes.find((x) => x.id === game.selectedHole);
    if (h) {
      const pts = holePath(h).map((p) => this.toScreen(p.x, p.y));
      ctx.setLineDash([8, 7]);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      const mk = (p: Pt, label: string, color: string) => {
        const s = this.toScreen(p.x, p.y);
        ctx.fillStyle = color;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y - ts * 1.9, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '700 10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, s.x, s.y - ts * 1.9 + 0.5);
        ctx.textAlign = 'left';
      };
      mk(center(h.tee), 'T', '#2d6ccb');
      mk(center(h.cup), String(h.id), '#c2552d');
      if (!h.open) {
        const v = game.validate(h.id);
        if (v.breakAt) {
          const s = this.toScreen(v.breakAt.x + 0.5, v.breakAt.y + 0.5);
          const pulse = 1 + 0.15 * Math.sin(time * 5);
          ctx.strokeStyle = '#ff5a40';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(s.x, s.y, ts * 1.3 * pulse, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#ff5a40';
          ctx.font = '700 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('fairway breaks here', s.x, s.y - ts * 1.6);
          ctx.textAlign = 'left';
        }
      }
    }
  }
}

function makeTree(v: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 112;
  const g = c.getContext('2d')!;
  const trunk = (col: string, w = 8) => {
    g.fillStyle = col;
    g.fillRect(48 - w / 2, 70, w, 38);
  };
  const blob = (x: number, y: number, r: number, c1: string, c2: string) => {
    const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    gr.addColorStop(0, c1);
    gr.addColorStop(1, c2);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  };
  if (v === 2) {
    trunk('#5b3d28', 6);
    const tier = (y: number, w: number, h: number, a: string, b: string) => {
      const gr = g.createLinearGradient(48 - w, y, 48 + w, y);
      gr.addColorStop(0, a);
      gr.addColorStop(1, b);
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(48, y - h);
      g.lineTo(48 + w, y);
      g.lineTo(48 - w, y);
      g.fill();
    };
    tier(95, 30, 40, '#2c6a46', '#1d4a33');
    tier(72, 25, 38, '#327650', '#215338');
    tier(50, 19, 34, '#3a8359', '#265c3d');
    tier(30, 13, 28, '#43916a', '#2d6a49');
  } else if (v === 3) {
    trunk('#6f5a46', 9);
    g.strokeStyle = '#6f5a46';
    g.lineCap = 'round';
    g.lineWidth = 5;
    const br = (x1: number, y1: number, x2: number, y2: number, w: number) => {
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    };
    br(48, 74, 30, 44, 4);
    br(48, 70, 66, 38, 4);
    br(34, 50, 22, 36, 2.5);
    br(60, 46, 74, 34, 2.5);
    br(48, 66, 50, 30, 3);
  } else if (v === 4) {
    trunk('#5b4630', 8);
    blob(34, 56, 22, '#a7a64e', '#6c7632');
    blob(62, 52, 24, '#98a049', '#5e6c2e');
    blob(48, 34, 24, '#b1ae56', '#75803a');
  } else {
    trunk('#59402a', 8);
    const pal = v === 0 ? ['#6fc26a', '#2f7a3a', '#58b05e', '#277036'] : ['#4f9f5a', '#25633a', '#3f8a4e', '#1e5731'];
    blob(32, 58, 22, pal[0], pal[1]);
    blob(64, 56, 23, pal[0], pal[1]);
    blob(48, 40, 28, pal[2], pal[3]);
    blob(38, 30, 18, pal[0], pal[1]);
    blob(60, 28, 17, pal[2], pal[3]);
  }
  return c;
}
