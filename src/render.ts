import { ISO_X, ISO_Y, projectGround, unprojectGround } from './isometric';
import { makeClassicTree, drawCountryClub, drawVillageAmenities } from './classic-art';
import { CFG } from './config';
import { Game } from './game';
import { Golfer } from './sim';
import { Pt, T, World, center, hash2, holePath, inBounds, vnoise } from './terrain';
import { ToolId } from './editing';
import { Palette, REGIONS, RGB } from './progression';

export const TS = 32; // tile size in the cached terrain canvas

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, j = 0) => `rgb(${Math.max(0, Math.min(255, Math.round(c[0] + j)))},${Math.max(0, Math.min(255, Math.round(c[1] + j)))},${Math.max(0, Math.min(255, Math.round(c[2] + j)))})`;

const COL: Palette = { ...REGIONS.parkland.palette };

export interface Overlay {
  tool: ToolId;
  hoverTiles: number[];
  changed: Set<number>;
  blocked: Set<number>;
  staged: Set<number>;
  tooExpensive: boolean;
  hoverPt: Pt | null;
  parcel: { col: number; row: number } | null;
  buildTee: Pt | null;
  buildLine: { from: Pt; to: Pt } | null;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  terr = document.createElement('canvas');
  base = document.createElement('canvas');
  tctx: CanvasRenderingContext2D; // base layer
  tctx2: CanvasRenderingContext2D; // composed terrain
  cam = { x: 40 * TS, y: 26 * TS, zoom: 0.62 };
  cw = 800;
  ch = 600;
  dpr = 1;
  private trees: HTMLCanvasElement[] = [];
  private builtFor: World | null = null;
  private regionKey = '';
  private cmaps: Record<string, HTMLCanvasElement> = {};

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.terr.width = CFG.grid.w * TS;
    this.terr.height = CFG.grid.h * TS;
    this.base.width = this.terr.width;
    this.base.height = this.terr.height;
    this.tctx = this.base.getContext('2d')!;
    this.tctx2 = this.terr.getContext('2d')!;
    for (let v = 0; v < 8; v++) this.trees.push(makeClassicTree(v));
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
    const p = projectGround(wx * TS, wy * TS);
    return { x: (p.x - this.cam.x) * this.cam.zoom + this.cw / 2, y: (p.y - this.cam.y) * this.cam.zoom + this.ch / 2 };
  }
  toWorld(sx: number, sy: number): Pt {
    const p = unprojectGround((sx - this.cw / 2) / this.cam.zoom + this.cam.x, (sy - this.ch / 2) / this.cam.zoom + this.cam.y);
    return { x: p.x / TS, y: p.y / TS };
  }
  clampCam(w: World) {
    const p = unprojectGround(this.cam.x, this.cam.y);
    const q = projectGround(Math.max(2 * TS, Math.min((w.w - 2) * TS, p.x)), Math.max(2 * TS, Math.min((w.h - 2) * TS, p.y)));
    this.cam.x = q.x; this.cam.y = q.y;
  }
  zoomAt(sx: number, sy: number, factor: number, w: World) {
    const before = this.toWorld(sx, sy);
    this.cam.zoom = Math.max(.22, Math.min(2.6, this.cam.zoom * factor));
    const after = this.toWorld(sx, sy);
    const delta = projectGround((before.x - after.x) * TS, (before.y - after.y) * TS);
    this.cam.x += delta.x; this.cam.y += delta.y;
    this.clampCam(w);
  }
  insets = { l: 12, r: 12, t: 70, b: 118 };
  focus(tx: number, ty: number, zoom: number, w: World) {
    this.cam.zoom = zoom;
    const sx = (this.insets.l + (this.cw - this.insets.r)) / 2;
    const sy = (this.insets.t + (this.ch - this.insets.b)) / 2;
    const p = projectGround(tx * TS, ty * TS);
    this.cam.x = p.x - (sx - this.cw / 2) / zoom;
    this.cam.y = p.y - (sy - this.ch / 2) / zoom;
    this.clampCam(w);
  }
  fit(w: World) {
    let right = 1, bottom = 1;
    w.parcels.forEach((owned, i) => { if (owned) { right = Math.max(right, (i % CFG.land.cols + 1) * CFG.land.pw); bottom = Math.max(bottom, (Math.floor(i / CFG.land.cols) + 1) * CFG.land.ph); } });
    const zoom = Math.max(.22, Math.min((this.cw - this.insets.l - this.insets.r - 40) / ((right + bottom) * TS * ISO_X), (this.ch - this.insets.t - this.insets.b - 40) / ((right + bottom) * TS * ISO_Y)));
    this.focus(right / 2, bottom / 2, zoom, w);
  }
  private groundPolygon(x: number, y: number, width = 1, depth = 1) {
    const points = [[x,y],[x+width,y],[x+width,y+depth],[x,y+depth]].map(([x,y]) => this.toScreen(x,y));
    this.ctx.beginPath(); points.forEach((p,i) => i ? this.ctx.lineTo(p.x,p.y) : this.ctx.moveTo(p.x,p.y)); this.ctx.closePath();
    return points;
  }

  // ---------- terrain cache ----------
  // Base layer (rough, paths) is drawn per tile. Fairways, greens, tees, sand and water are drawn as
  // smooth organic shapes: tile masks are blurred and thresholded so edges flow instead of stepping.
  private time = 0;
  private prevTerrain: Uint8Array | null = null;
  private composeAt = 0;
  private needCompose = false;
  private masks = new Map<string, HTMLCanvasElement[]>();
  private layerCv = document.createElement('canvas');

  private syncTerrain(w: World) {
    const now = performance.now();
    if (this.builtFor !== w || this.regionKey !== w.region) {
      this.builtFor = w;
      this.regionKey = w.region;
      Object.assign(COL, REGIONS[w.region].palette);
      this.masks.clear();
      this.base.width = CFG.grid.w * TS;
      this.base.height = CFG.grid.h * TS;
      this.layerCv.width = this.layerCv.height = Renderer.CH * TS;
      for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) this.drawTile(w, x, y);
      this.rebuildMasks(w);
      this.allChunks(w);
      this.compose(w);
      this.prevTerrain = Uint8Array.from(w.terrain);
      w.dirty.clear();
      return;
    }
    if (w.dirty.size) {
      const nDirty = w.dirty.size;
      let typeChanged = false;
      const todo = new Set<number>();
      for (const i of w.dirty) {
        if (this.prevTerrain![i] !== w.terrain[i]) typeChanged = true;
        this.markChunk(w, i);
        const x = i % w.w;
        const y = (i - x) / w.w;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inBounds(w, x + dx, y + dy)) todo.add((y + dy) * w.w + x + dx);
      }
      for (const i of todo) this.drawTile(w, i % w.w, Math.floor(i / w.w));
      if (typeChanged) {
        this.rebuildMasks(w);
        this.prevTerrain = Uint8Array.from(w.terrain);
      }
      w.dirty.clear();
      this.needCompose = true;
      // edits and big changes show immediately; gradual wear is batched
      if (typeChanged || nDirty > 20) this.composeAt = 1;
      else if (this.composeAt === 0) this.composeAt = now + 500;
    }
    if (this.needCompose && (this.composeAt === 1 || now >= this.composeAt)) {
      this.compose(w);
      this.needCompose = false;
      this.composeAt = 0;
    }
  }

  /** One pixel per tile, upscaled with smoothing, so colour changes blend instead of stepping. */
  private buildColorMaps(w: World) {
    const mk = (key: string, color: (x: number, y: number, i: number) => RGB) => {
      let cv = this.cmaps[key];
      if (!cv || cv.width !== w.w) {
        cv = this.cmaps[key] = document.createElement('canvas');
        cv.width = w.w;
        cv.height = w.h;
      }
      const cx = cv.getContext('2d')!;
      const img = cx.createImageData(w.w, w.h);
      for (let y = 0; y < w.h; y++)
        for (let x = 0; x < w.w; x++) {
          const i = y * w.w + x;
          const [r, g, b] = color(x, y, i);
          const o = i * 4;
          img.data[o] = r;
          img.data[o + 1] = g;
          img.data[o + 2] = b;
          img.data[o + 3] = 255;
        }
      cx.putImageData(img, 0, 0);
    };
    const jit = (x: number, y: number) => (vnoise(x / 2.6, y / 2.6, 41) - 0.5) * 14;
    const add = (c: RGB, j: number): RGB => [c[0] + j, c[1] + j, c[2] + j];
    const wearOf = (cond: number) => Math.max(0, Math.min(1, (64 - cond) / 54));
    mk('rough', (x, y, i) => add(mix(COL.roughBad, COL.roughGood, Math.max(0, Math.min(1, (w.terrain[i] === T.ROUGH ? w.cond[i] : 62) / 70))), jit(x, y)));
    mk('grass', (x, y, i) => add(w.terrain[i] === T.FAIRWAY ? mix(COL.fairGood, COL.fairWorn, wearOf(w.cond[i])) : COL.fairGood, jit(x, y) * 0.7));
    mk('green', (x, y, i) => add(w.terrain[i] === T.GREEN ? mix(COL.greenGood, COL.greenWorn, wearOf(w.cond[i])) : COL.greenGood, jit(x, y) * 0.6));
    mk('tee', (x, y, i) => add(w.terrain[i] === T.TEE ? mix(COL.teeGood, COL.fairWorn, wearOf(w.cond[i])) : COL.teeGood, jit(x, y) * 0.5));
    mk('sand', (x, y) => add(COL.sand, (vnoise(x / 1.8, y / 1.8, 43) - 0.5) * 12));
    mk('water', (x, y) => mix(COL.water, COL.waterDeep, vnoise(x / 2.2, y / 2.2, 210) * 0.7));
  }
  private drawSmooth(c: CanvasRenderingContext2D, key: string, tx0: number, ty0: number, tx1: number, ty1: number, w: World) {
    const sx0 = Math.max(0, tx0 - 1);
    const sy0 = Math.max(0, ty0 - 1);
    const sx1 = Math.min(w.w, tx1 + 1);
    const sy1 = Math.min(w.h, ty1 + 1);
    c.save();
    c.beginPath();
    c.rect(tx0 * TS, ty0 * TS, (tx1 - tx0) * TS, (ty1 - ty0) * TS);
    c.clip();
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(this.cmaps[key], sx0, sy0, sx1 - sx0, sy1 - sy0, sx0 * TS, sy0 * TS, (sx1 - sx0) * TS, (sy1 - sy0) * TS);
    c.restore();
  }
  // Small seamless material tiles are generated once, then stamped into the terrain cache.
  // No per-frame noise generation, and repainting a tile preserves its grain.
  private materials = new Map<string, CanvasPattern>();
  private material(c: CanvasRenderingContext2D, kind: string) {
    if (this.materials.has(kind)) return this.materials.get(kind)!;
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d')!;
    const n = kind === 'sand' ? 1800 : kind === 'rough' ? 1200 : 950;
    for (let k = 0; k < n; k++) {
      const x = hash2(k, 31, 708) * 128, y = hash2(k, 91, 812) * 128;
      const light = hash2(k, 15, 73) > .5;
      g.fillStyle = light ? 'rgba(255,252,217,.13)' : 'rgba(10,48,37,.13)';
      const h = kind === 'rough' ? 1.5 + hash2(k, 8, 54) * 3 : kind === 'sand' ? .7 : 1.4;
      g.fillRect(x, y, kind === 'sand' ? .8 : .9, h);
    }
    if (kind === 'sand') {
      g.strokeStyle = 'rgba(144,109,64,.12)'; g.lineWidth = .8;
      for (let y = -128; y < 256; y += 6) {
        g.beginPath();
        for (let x = 0; x <= 128; x += 4) {
          const py = y + Math.sin(x / 128 * Math.PI * 2) * 4;
          if (x === 0) g.moveTo(x, py); else g.lineTo(x, py);
        }
        g.stroke();
      }
    }
    const pat = c.createPattern(cv, 'repeat')!; this.materials.set(kind, pat); return pat;
  }
  private stripePattern: CanvasPattern | null = null;
  private getStripes(c: CanvasRenderingContext2D): CanvasPattern {
    if (this.stripePattern) return this.stripePattern;
    const p = document.createElement('canvas');
    p.width = p.height = 2 * TS;
    const g = p.getContext('2d')!;
    g.fillStyle='rgba(225,255,204,.12)';g.fillRect(0,0,TS,TS*2);
    g.fillStyle='rgba(9,77,48,.08)';g.fillRect(TS,0,TS,TS*2);
    this.stripePattern = c.createPattern(p, 'repeat')!;
    return this.stripePattern;
  }

  private static readonly R = 12;
  private maskFor(w: World, pred: (t: number) => boolean, ths: number[]): HTMLCanvasElement[] {
    const R = Renderer.R;
    const src = document.createElement('canvas');
    src.width = w.w * R;
    src.height = w.h * R;
    const sc = src.getContext('2d')!;
    sc.fillStyle = '#fff';
    for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) if (pred(w.terrain[y * w.w + x])) sc.fillRect(x * R, y * R, R, R);
    const blur = document.createElement('canvas');
    blur.width = src.width;
    blur.height = src.height;
    const bc = blur.getContext('2d')!;
    bc.filter = `blur(${R * 0.55}px)`;
    bc.drawImage(src, 0, 0);
    bc.filter = 'none';
    const data = bc.getImageData(0, 0, blur.width, blur.height);
    return ths.map((th) => {
      const out = document.createElement('canvas');
      out.width = blur.width;
      out.height = blur.height;
      const oc = out.getContext('2d')!;
      const img = oc.createImageData(blur.width, blur.height);
      const lo = th - 0.09;
      const hi = th + 0.09;
      for (let i = 0; i < data.data.length; i += 4) {
        const a = data.data[i + 3] / 255;
        const t = Math.max(0, Math.min(1, (a - lo) / (hi - lo)));
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(t * t * (3 - 2 * t) * 255);
      }
      oc.putImageData(img, 0, 0);
      return out;
    });
  }

  private rebuildMasks(w: World) {
    this.masks.set('grass', this.maskFor(w, (t) => t === T.FAIRWAY || t === T.GREEN || t === T.TEE, [0.5, 0.3]));
    this.masks.set('green', this.maskFor(w, (t) => t === T.GREEN, [0.5, 0.32]));
    this.masks.set('tee', this.maskFor(w, (t) => t === T.TEE, [0.5]));
    this.masks.set('bunker', this.maskFor(w, (t) => t === T.BUNKER, [0.5, 0.3]));
    this.masks.set('water', this.maskFor(w, (t) => t === T.WATER, [0.5, 0.3, 0.9]));
  }

  private static readonly CH = 16; // chunk size in tiles for partial recomposition
  private dirtyChunks = new Set<number>();
  allChunks(w: World) {
    for (let cy = 0; cy * Renderer.CH < w.h; cy++) for (let cx = 0; cx * Renderer.CH < w.w; cx++) this.dirtyChunks.add(cy * 1000 + cx);
  }
  private markChunk(w: World, i: number) {
    const x = i % w.w;
    const y = (i - x) / w.w;
    const C = Renderer.CH;
    for (let dy = -2; dy <= 2; dy += 2) for (let dx = -2; dx <= 2; dx += 2) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx >= 0 && ty >= 0 && tx < w.w && ty < w.h) this.dirtyChunks.add(Math.floor(ty / C) * 1000 + Math.floor(tx / C));
    }
  }

  compose(w: World) {
    this.buildColorMaps(w);
    for (const key of this.dirtyChunks) this.composeChunk(w, key % 1000, Math.floor(key / 1000));
    this.dirtyChunks.clear();
  }

  private composeChunk(w: World, cx: number, cy: number) {
    const C = Renderer.CH;
    const tx0 = cx * C;
    const ty0 = cy * C;
    const tx1 = Math.min(w.w, tx0 + C);
    const ty1 = Math.min(w.h, ty0 + C);
    const X = tx0 * TS;
    const Y = ty0 * TS;
    const CW = (tx1 - tx0) * TS;
    const CHH = (ty1 - ty0) * TS;
    const k = Renderer.R / TS;
    const t = this.tctx2;
    t.globalCompositeOperation = 'source-over';
    this.drawSmooth(t, 'rough', tx0, ty0, tx1, ty1, w);
    t.fillStyle = this.material(t, 'rough'); t.fillRect(X, Y, CW, CHH);
    t.drawImage(this.base, X, Y, CW, CHH, X, Y, CW, CHH);
    const lc = this.layerCv.getContext('2d')!;
    // work in a chunk-sized scratch canvas: full-size scratch copies make software canvases crawl
    const stamp = (fill: (c: CanvasRenderingContext2D) => void, mask: HTMLCanvasElement) => {
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalCompositeOperation = 'source-over';
      lc.clearRect(0, 0, this.layerCv.width, this.layerCv.height);
      lc.setTransform(1, 0, 0, 1, -X, -Y);
      fill(lc);
      lc.globalCompositeOperation = 'destination-in';
      lc.drawImage(mask, X * k, Y * k, CW * k, CHH * k, X, Y, CW, CHH);
      lc.globalCompositeOperation = 'source-over';
      t.drawImage(this.layerCv, 0, 0, CW, CHH, X, Y, CW, CHH);
    };
    const flat = (col: string) => (c: CanvasRenderingContext2D) => {
      c.fillStyle = col;
      c.fillRect(X, Y, CW, CHH);
    };
    const tex = (cmap: string, types: number[], draw: (c: CanvasRenderingContext2D, x: number, y: number, i: number) => void) => (c: CanvasRenderingContext2D) => {
      this.drawSmooth(c, cmap, tx0, ty0, tx1, ty1, w);
      if (cmap !== 'water') { c.fillStyle = this.material(c, cmap === 'sand' ? 'sand' : 'turf'); c.fillRect(X, Y, CW, CHH); }
      for (let y = ty0; y < ty1; y++)
        for (let x = tx0; x < tx1; x++) {
          const i = y * w.w + x;
          if (types.includes(w.terrain[i])) draw(c, x, y, i);
        }
    };
    const m = (key: string) => this.masks.get(key)!;
    // grass: first-cut ring, then body
    stamp(flat('rgba(46,112,52,0.32)'), m('grass')[1]);
    stamp(tex('grass', [T.FAIRWAY, T.GREEN, T.TEE], (c, x, y, i) => this.grassTile(c, w, x, y, i, COL.fairGood, COL.fairWorn, ((x - y) >> 1) & 1 ? 4 : -3)), m('grass')[0]);
    stamp((c) => {
      c.fillStyle = this.getStripes(c);
      c.fillRect(X, Y, CW, CHH);
    }, m('grass')[0]);
    stamp(flat('rgba(150,214,140,0.45)'), m('green')[1]);
    stamp(tex('green', [T.GREEN], (c, x, y, i) => this.grassTile(c, w, x, y, i, COL.greenGood, COL.greenWorn, (x + y) & 1 ? 3 : -2)), m('green')[0]);
    stamp(tex('tee', [T.TEE], (c, x, y, i) => this.grassTile(c, w, x, y, i, COL.teeGood, COL.fairWorn, 3)), m('tee')[0]);
    // sand
    stamp(flat('rgba(150,118,70,0.8)'), m('bunker')[1]);
    stamp(tex('sand', [], () => {}), m('bunker')[0]);
    // water: shore ring, body, deeper centre
    stamp(flat('rgba(188,222,206,0.7)'), m('water')[1]);
    stamp(tex('water', [T.WATER], (c, x, y) => {
      c.strokeStyle = 'rgba(190,255,244,.19)'; c.lineWidth = .8;
      for (let q = 0; q < 3; q++) {
        const px = x * TS + hash2(x, y, 601 + q) * 19;
        const py = y * TS + hash2(x, y, 611 + q) * TS;
        c.beginPath(); c.moveTo(px, py); c.quadraticCurveTo(px + 5, py - 1.5, px + 11, py); c.stroke();
      }
    }), m('water')[0]);
    stamp(flat('rgba(20,80,140,0.45)'), m('water')[2]);
  }

  private grassTile(c: CanvasRenderingContext2D, w: World, x: number, y: number, i: number, good: RGB, worn: RGB, stripe: number) {
    const cond = w.cond[i];
    const px = x * TS;
    const py = y * TS;
    void good;
    void worn;
    void stripe;
    if (cond < 44) {
      const n = cond < 25 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const ex = px + hash2(x, y, 50 + k) * TS;
        const ey = py + hash2(x, y, 60 + k) * TS;
        const r = TS * (0.3 + hash2(x, y, 70 + k) * 0.3);
        const g = c.createRadialGradient(ex, ey, 1, ex, ey, r);
        const a = 0.28 + (44 - cond) / 120;
        g.addColorStop(0, `rgba(${COL.dirt[0]},${COL.dirt[1]},${COL.dirt[2]},${a})`);
        g.addColorStop(1, `rgba(${COL.dirt[0]},${COL.dirt[1]},${COL.dirt[2]},0)`);
        c.fillStyle = g;
        c.fillRect(ex - r, ey - r, r * 2, r * 2);
      }
      c.fillStyle = 'rgba(90,70,40,0.35)';
      for (let k = 0; k < 4; k++) c.fillRect(px + hash2(x, y, 100 + k) * TS, py + hash2(x, y, 110 + k) * TS, 1.5, 1.5);
    } else {
      c.fillStyle = 'rgba(255,255,255,0.10)';
      for (let k = 0; k < 4; k++) c.fillRect(px + hash2(x, y, 120 + k) * (TS - 2), py + hash2(x, y, 130 + k) * (TS - 3), 1, 3);
      c.fillStyle = 'rgba(20,70,30,0.10)';
      for (let k = 0; k < 3; k++) c.fillRect(px + hash2(x, y, 140 + k) * (TS - 2), py + hash2(x, y, 150 + k) * (TS - 3), 1, 3);
    }
  }

  /** Base layer: rough, paths and the clubhouse footprint. Other ground shows rough underneath. */
  private drawTile(w: World, x: number, y: number) {
    const c = this.tctx;
    const i = y * w.w + x;
    const t = w.terrain[i];
    const px = x * TS;
    const py = y * TS;
    const jit = (vnoise(x / 2.6, y / 2.6, 41) - 0.5) * 15 + (hash2(x, y, 40) - 0.5) * 4;
    const cond = t === T.ROUGH ? w.cond[i] : 62;
    c.clearRect(px, py, TS, TS);
    if (t === T.ROUGH) {
      const tall = cond < 45;
      const n = tall ? 4 : 2;
      for (let k = 0; k < n; k++) {
        const bx = px + hash2(x, y, 140 + k) * TS;
        const by = py + 4 + hash2(x, y, 150 + k) * (TS - 4);
        c.strokeStyle = tall ? (k % 2 ? 'rgba(151,164,96,0.42)' : 'rgba(85,120,65,0.4)') : k % 2 ? 'rgba(96,166,80,0.7)' : 'rgba(36,98,44,0.6)';
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(bx, by);
        c.quadraticCurveTo(bx + (hash2(x, y, 160 + k) - 0.5) * 5, by - (tall ? 3 : 1.5), bx + (hash2(x, y, 165 + k) - 0.5) * 6, by - (tall ? 6 + hash2(x, y, 170 + k) * 4 : 3));
        c.stroke();
      }
      if (cond < 32 && hash2(x, y, 180) < 0.16) {
        c.fillStyle = ['#f3efe2', '#f1d24f', '#b98bd6'][Math.floor(hash2(x, y, 181) * 3)];
        c.beginPath();
        c.arc(px + 5 + hash2(x, y, 182) * (TS - 10), py + 5 + hash2(x, y, 183) * (TS - 10), 1.7, 0, Math.PI * 2);
        c.fill();
      }
    } else if (t === T.PATH || t === T.BUILDING) {
      c.fillStyle = css(COL.path, jit);
      c.fillRect(px, py, TS, TS);
      c.strokeStyle = 'rgba(83,92,84,.19)'; c.lineWidth = .8;
      for (let row = 0; row < 4; row++) {
        const yy = py + row * 8; c.beginPath(); c.moveTo(px, yy); c.lineTo(px + TS, yy); c.stroke();
        for (let col = 0; col < 3; col++) {
          const xx = px + col * 16 + (row % 2 ? 8 : 0);
          if (xx < px + TS) { c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx, yy + 8); c.stroke(); }
        }
      }
      c.fillStyle = 'rgba(110,100,86,0.25)';
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
    }
  }

  // ---------- frame ----------
  render(game: Game, ov: Overlay, time: number, alpha = 1) {
    const w = game.world;
    this.time = time;
    for (const g of game.sim.golfers) {
      g.rx = g.px + (g.x - g.px) * alpha;
      g.ry = g.py + (g.y - g.py) * alpha;
      g.rbx = g.pbx + (g.ball.x - g.pbx) * alpha;
      g.rby = g.pby + (g.ball.y - g.pby) * alpha;
      g.rbz = g.pbz + (g.ballZ - g.pbz) * alpha;
    }
    this.syncTerrain(w);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#243d2a';
    ctx.fillRect(0, 0, this.cw, this.ch);
    const z = this.cam.zoom;
    const o = this.toScreen(0, 0);
    ctx.imageSmoothingEnabled = true;
    // Only the ground is projected. Trees, people, roofs and signs stay upright.
    ctx.save(); ctx.transform(ISO_X * z, ISO_Y * z, -ISO_X * z, ISO_Y * z, o.x, o.y); ctx.drawImage(this.terr, 0, 0); ctx.restore();
    const ts = this.ts;
    const corners = [[0,0],[this.cw,0],[0,this.ch],[this.cw,this.ch]].map(([x,y]) => this.toWorld(x,y));
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p.x))) - 5);
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map(p => p.y))) - 5);
    const x1 = Math.min(w.w - 1, Math.ceil(Math.max(...corners.map(p => p.x))) + 5);
    const y1 = Math.min(w.h - 1, Math.ceil(Math.max(...corners.map(p => p.y))) + 5);

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
        const a = this.toScreen(x,y0), b = this.toScreen(x,y1+1);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
      }
      for (let y = y0; y <= y1 + 1; y++) {
        const a = this.toScreen(x0,y), b = this.toScreen(x1+1,y);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
      }
      ctx.stroke();
    }

    this.drawHoleMarkers(game, time);
    this.drawClubEnhancements(game, time);

    // y-sorted: trees + golfers
    type Item = { y: number; draw: () => void };
    const items: Item[] = [
      { y: 54, draw: () => this.drawBuilding(game, time) },
      { y: 58, draw: () => this.drawStructures(game, time) },
    ];
    const wts = REGIONS[w.region].trees;
    const wsum = wts.reduce((a, b) => a + b, 0) || 1;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w.w + x;
        if (!w.tree[i]) continue;
        const hh = hash2(x, y, 400);
        const dead = w.cond[i] < 30 && hh < 0.28;
        let variant = dead ? 3 : w.cond[i] < 38 && hh < 0.6 ? 4 : 0;
        if (variant === 0) {
          let r = hash2(x, y, 401) * wsum;
          for (let k = 0; k < wts.length; k++) if ((r -= wts[k]) <= 0) { variant = k; break; }
        }
        if (variant === 0 && hh > .78 && game.region !== 'desert') variant = 7;
        items.push({ y: x + y + 1, draw: () => this.drawTree(x, y, variant, hh) });
      }
    for (const g of game.sim.golfers) items.push({ y: g.rx + g.ry, draw: () => this.drawGolfer(g, g.id === game.selectedGolfer, time) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // balls and trails above everything
    for (const g of game.sim.golfers) this.drawBall(g);
    for (const g of game.sim.golfers) if (g.bubble) this.drawBubble(g);
    for (const g of game.sim.golfers) this.drawChips(g);

    this.drawFx(game);
    this.drawParcels(game, ov);
    this.drawQueues(game);
    this.drawOverlay(game, ov, time);
    this.drawAtmosphere(time, game.season.index, game.region);

    this.drawStudio(game);

    // time-of-day light
    const frac = game.clock / CFG.day.seconds;
    const warm = frac < 0.12 ? (0.12 - frac) / 0.12 : frac > 0.78 ? (frac - 0.78) / 0.22 : 0;
    if (warm > 0) {
      ctx.fillStyle = `rgba(255,150,60,${0.045 * warm})`;
      ctx.fillRect(0, 0, this.cw, this.ch);
    }
  }

  private drawClubEnhancements(game: Game, time: number) {
    if (!game.experience.site.irrigation || game.clock % game.hourLen >= 5) return;
    const ctx = this.ctx, ts = this.ts, w = game.world;
    ctx.strokeStyle='rgba(191,226,224,.5)';ctx.lineWidth=Math.max(.7,ts*.035);
    for(let i=0;i<w.terrain.length;i+=47){
      if(w.terrain[i]!==T.FAIRWAY || !w.zone[i])continue;
      const p=this.toScreen(i%w.w+.5,Math.floor(i/w.w)+.5), phase=(time*.6+i*.03)%1;
      ctx.beginPath();ctx.ellipse(p.x,p.y,ts*(.3+phase),ts*(.1+phase*.35),0,Math.PI,Math.PI*2);ctx.stroke();
    }
  }

  private drawStudio(game: Game) {
    const ctx = this.ctx, ts = this.ts;
    ctx.save();
    if (game.heatmap) {
      for (const dot of game.landings) {
        if (dot.hole !== game.selectedHole) continue;
        const p = this.toScreen(dot.x, dot.y);
        ctx.fillStyle = dot.bad ? 'rgba(246,111,78,.65)' : 'rgba(250,221,139,.4)';
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, ts * .35), 0, Math.PI * 2); ctx.fill();
      }
    }
    if (game.settings.tool === 'bend' || game.heatmap) {
      const h = game.hole(game.selectedHole);
      if (h) {
        const pts = [h.tee, h.bend, h.cup].map(p => this.toScreen(p.x + .5, p.y + .5));
        ctx.strokeStyle = '#fff1b8'; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
        ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#e5b958'; ctx.beginPath(); ctx.arc(pts[1].x, pts[1].y, 6, 0, Math.PI * 2); ctx.fill();
      }
    }
    const owner = game.owner;
    if (owner.active) {
      const f = owner.flight, ball = f ? { x: f.from.x + (f.shot.air.x - f.from.x) * f.t, y: f.from.y + (f.shot.air.y - f.from.y) * f.t } : owner.ball;
      const p = this.toScreen(ball.x, ball.y);
      if (owner.aim && !f && !owner.completed) {
        const d = owner.distance, range = owner.reach(game), scale = Math.min(1, range / Math.max(.01, d));
        const aim = this.toScreen(owner.ball.x + (owner.aim.x - owner.ball.x) * scale, owner.ball.y + (owner.aim.y - owner.ball.y) * scale);
        ctx.strokeStyle = '#fff0b1'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(aim.x, aim.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.strokeStyle = '#fff6d6'; ctx.beginPath(); ctx.ellipse(aim.x, aim.y, Math.max(5, ts * .8), Math.max(4, ts * .5), 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#102d22e6'; ctx.fillRect(aim.x - 39, aim.y - 33, 78, 22); ctx.fillStyle = '#fff2d1'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(Math.round(Math.min(d, range) * 10) + ' yards', aim.x, aim.y - 18);
      }
      const z = f && !f.putt ? Math.sin(f.t * Math.PI) * ts * 3 : 0;
      ctx.fillStyle = '#0005'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, 5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#d4ae5c'; ctx.lineWidth = 2; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y - z, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (!f) { ctx.strokeStyle = '#f8e1a1'; ctx.beginPath(); ctx.arc(p.x, p.y, 12 + Math.sin(this.time * 3) * 2, 0, Math.PI * 2); ctx.stroke(); }
    }
    ctx.restore();
  }

  private drawTree(x: number, y: number, v: number, hh: number) {
    const ctx = this.ctx;
    const ts = this.ts;
    const p = this.toScreen(x + 0.5, y + 0.5);
    const size = ts * (1.5 + hh * .55);
    ctx.fillStyle = 'rgba(10,30,15,0.22)';
    ctx.beginPath();
    ctx.ellipse(p.x + size * 0.22, p.y - size * 0.02, size * 0.34, size * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    const spr = this.trees[v];
    ctx.save();
    ctx.translate(p.x, p.y);
    if (v !== 3) ctx.rotate(Math.sin(this.time * 1.1 + hh * 40) * 0.018);
    ctx.drawImage(spr, -size / 2, -size * 1.5, size, size * 1.55);
    ctx.restore();
  }

  private drawGolfer(g: Golfer, selected: boolean, time: number) {
    const ctx = this.ctx;
    const u = Math.max(this.ts, 16);
    const p = this.toScreen(g.rx, g.ry);
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
    if (!walking) {
      ctx.fillStyle = '#3a3f46';
      ctx.beginPath();
      ctx.roundRect(p.x - g.dir * u * 0.3, p.y - u * 0.5, u * 0.1, u * 0.42, u * 0.04);
      ctx.fill();
      ctx.fillStyle = gt.shirt;
      ctx.fillRect(p.x - g.dir * u * 0.3, p.y - u * 0.5, u * 0.1, u * 0.08);
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
    ctx.fillStyle = g.event ? '#f2c53d' : gt.cap;
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
    const p = this.toScreen(g.rbx, g.rby);
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
    const r = Math.max(2.2, u * 0.085) * (1 + g.rbz * 0.1);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(p.x + g.rbz * u * 0.12, p.y, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(p.x, p.y - g.rbz * u * 0.5 - r * 0.4, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  private drawBubble(g: Golfer) {
    const ctx = this.ctx;
    const b = g.bubble!;
    const p = this.toScreen(g.rx, g.ry);
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
    const p = this.toScreen(g.rx, g.ry);
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

  private drawBuilding(game: Game, time: number) { drawCountryClub(this, game, time); }
  private drawStructures(game: Game, time: number) { drawVillageAmenities(this, game); void time; }

  private drawFx(game: Game) {
    const ctx = this.ctx;
    const u = Math.max(this.ts, 22);
    const now = game.sim.now;
    game.sim.fx.forEach((f, n) => {
      const age = now - f.t0;
      const p = this.toScreen(f.x, f.y);
      if (f.kind === 'splash') {
        const k = Math.min(1, age / 1.2);
        ctx.strokeStyle = `rgba(235,248,255,${0.8 * (1 - k)})`;
        ctx.lineWidth = Math.max(1.5, u * 0.06);
        for (let r = 0; r < 2; r++) {
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, u * (0.15 + 0.55 * k + r * 0.2), u * (0.07 + 0.25 * k + r * 0.1), 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(235,248,255,${0.9 * (1 - k)})`;
        for (let d = 0; d < 8; d++) {
          const a = (d / 8) * Math.PI * 2 + n;
          const t = Math.min(1, age / 0.7);
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * u * 0.4 * t, p.y - Math.sin(t * Math.PI) * u * 0.5 + Math.sin(a) * u * 0.1 * t, Math.max(1.2, u * 0.04), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (f.kind === 'sand' || f.kind === 'divot') {
        const k = Math.min(1, age / 0.8);
        ctx.fillStyle = f.kind === 'sand' ? `rgba(226,204,150,${0.9 * (1 - k)})` : `rgba(88,66,38,${0.8 * (1 - k)})`;
        const cnt = f.kind === 'sand' ? 12 : 6;
        for (let d = 0; d < cnt; d++) {
          const a = (d / cnt) * Math.PI * 2 + n * 0.7;
          const sp = 0.3 + ((d * 37) % 10) / 20;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * u * sp * k, p.y - Math.sin(k * Math.PI) * u * 0.45 * sp * 2 + Math.sin(a) * u * 0.1 * k, Math.max(1, u * 0.035), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (f.kind === 'leaf') {
        const k = Math.min(1, age / 1.6);
        for (let d = 0; d < 7; d++) {
          ctx.fillStyle = `rgba(${90 + d * 12},${150 + d * 8},60,${0.9 * (1 - k)})`;
          const a = d * 0.9 + n;
          ctx.beginPath();
          ctx.ellipse(p.x + Math.sin(k * 5 + a) * u * 0.3, p.y - u * 0.6 + k * u * 0.7, Math.max(1.5, u * 0.05), Math.max(1, u * 0.03), a, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const k = Math.min(1, age / 1.1);
        ctx.strokeStyle = `rgba(255,236,150,${1 - k})`;
        ctx.lineWidth = Math.max(1.5, u * 0.05);
        ctx.beginPath();
        ctx.arc(p.x, p.y, u * (0.1 + 0.6 * k), 0, Math.PI * 2);
        ctx.stroke();
        for (let d = 0; d < 8; d++) {
          const a = (d / 8) * Math.PI * 2;
          ctx.fillStyle = `rgba(255,240,170,${1 - k})`;
          ctx.fillRect(p.x + Math.cos(a) * u * 0.8 * k - 1, p.y - u * 0.3 * k + Math.sin(a) * u * 0.5 * k - 1, 2.5, 2.5);
        }
      }
    });
  }

  private vignette: CanvasGradient | null = null;
  private vigSize = '';
  /** Locked land is dimmed and hatched; the Land tool shows prices. */
  private drawParcels(game: Game, ov: Overlay) {
    const ctx = this.ctx, L = CFG.land;
    for(let row=0;row<L.rows;row++)for(let col=0;col<L.cols;col++){
      const owned=game.isParcelOwned(col,row), sel=!!ov.parcel && ov.parcel.col===col && ov.parcel.row===row;
      if(owned && !(ov.tool==='land' && sel))continue;
      this.groundPolygon(col*L.pw,row*L.ph,L.pw,L.ph);
      if(!owned){ctx.fillStyle=sel?'rgba(25,45,35,.2)':'rgba(16,32,20,.3)';ctx.fill();}
      ctx.strokeStyle=sel?'#f2dc93':'rgba(232,233,191,.28)';ctx.lineWidth=sel?2:1;ctx.setLineDash([6,5]);ctx.stroke();ctx.setLineDash([]);
      if(!owned && (ov.tool==='land'||sel)){
        const p=this.toScreen((col+.5)*L.pw,(row+.5)*L.ph),label=`For sale ${fmtMoneyShort(game.parcelPrice)}`;
        ctx.font='bold 12px Georgia';const width=ctx.measureText(label).width+18;
        ctx.fillStyle=sel?'#e0c987':'#324632';ctx.beginPath();ctx.roundRect(p.x-width/2,p.y-12,width,25,4);ctx.fill();
        ctx.fillStyle=sel?'#30422e':'#f0e5bf';ctx.textAlign='center';ctx.fillText(label,p.x,p.y+4);ctx.textAlign='left';
      }
    }
  }

  private drawAtmosphere(time: number, season: number, region: string) {
    const ctx = this.ctx;
    // seasonal light and falling leaves / snow
    const tint = ['rgba(150,230,140,0.035)', 'rgba(255,225,120,0.05)', 'rgba(235,125,40,0.11)', region === 'mountain' ? 'rgba(190,215,245,0.2)' : 'rgba(170,200,240,0.12)'][season];
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, this.cw, this.ch);
    if (season === 2 || season === 3) {
      const n = season === 3 ? 70 : 28;
      for (let k = 0; k < n; k++) {
        const sp = season === 3 ? 38 + (k % 5) * 6 : 24 + (k % 4) * 8;
        const x = ((hash2(k, 1, 600) * (this.cw + 100) + Math.sin(time * 0.8 + k) * 30 + time * (season === 3 ? 6 : 18)) % (this.cw + 100)) - 50;
        const y = ((hash2(k, 2, 600) * this.ch + time * sp) % (this.ch + 20)) - 10;
        ctx.fillStyle = season === 3 ? 'rgba(255,255,255,0.8)' : ['rgba(214,120,40,0.8)', 'rgba(196,150,50,0.8)', 'rgba(170,70,40,0.8)'][k % 3];
        ctx.beginPath();
        if (season === 3) ctx.arc(x, y, 1.6 + (k % 3) * 0.5, 0, Math.PI * 2);
        else ctx.ellipse(x, y, 3.2, 1.8, time + k, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // drifting cloud shadows
    ctx.fillStyle = 'rgba(10,25,20,0.07)';
    for (let k = 0; k < 4; k++) {
      const x = ((time * (7 + k * 2) + k * 520) % (this.cw + 700)) - 350;
      const y = ((k * 233 + 60) % this.ch) + Math.sin(time * 0.1 + k) * 20;
      ctx.beginPath();
      ctx.ellipse(x, y, 260 + k * 30, 90 + k * 14, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }
    const key = `${this.cw}x${this.ch}`;
    if (!this.vignette || this.vigSize !== key) {
      const g = ctx.createRadialGradient(this.cw / 2, this.ch / 2, Math.min(this.cw, this.ch) * 0.45, this.cw / 2, this.ch / 2, Math.max(this.cw, this.ch) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(5,15,10,0.16)');
      this.vignette = g;
      this.vigSize = key;
    }
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, this.cw, this.ch);
  }

  private drawOverlay(game: Game, ov: Overlay, time: number) {
    const ctx = this.ctx;
    const w = game.world;
    const ts = this.ts;
    const col = ({ fairway:'110,200,80', green:'180,220,130', path:'210,200,160', rough:'70,140,60', bunker:'240,214,140', water:'70,150,230', treeAdd:'40,120,50', treeDel:'230,140,60', repair:'120,230,160' } as Record<string,string>)[ov.tool] ?? '255,255,255';
    const tile = (i:number,staged=false) => {
      this.groundPolygon(i%w.w,Math.floor(i/w.w));
      const blocked=ov.blocked.has(i),changed=ov.changed.has(i)||staged;
      if(blocked||changed){ctx.fillStyle=blocked||ov.tooExpensive?'rgba(220,70,50,.45)':`rgba(${col},.48)`;ctx.fill();}
      ctx.strokeStyle=blocked?'#e08e70':changed?'rgba(250,245,213,.9)':'rgba(244,241,211,.4)';ctx.lineWidth=changed?1.3:.7;ctx.stroke();
    };
    for(const i of ov.hoverTiles)tile(i);
    for(const i of ov.staged)tile(i,true);

    // new-hole placement guide
    if (ov.buildLine) {
      const f = this.toScreen(ov.buildLine.from.x + 0.5, ov.buildLine.from.y + 0.5);
      const t2 = this.toScreen(ov.buildLine.to.x + 0.5, ov.buildLine.to.y + 0.5);
      ctx.setLineDash([10, 8]);
      ctx.strokeStyle = '#ffe27a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(t2.x, t2.y);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [p, label] of [[f, 'T'], [t2, 'G']] as const) {
        ctx.fillStyle = '#ffe27a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2a2110';
        ctx.font = '800 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, p.x, p.y + 0.5);
        ctx.textAlign = 'left';
      }
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

const fmtMoneyShort = (n: number) => (n >= 10000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toLocaleString('en-US')}`);


