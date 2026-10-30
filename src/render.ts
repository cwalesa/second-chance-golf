import { ISO_X, ISO_Y, projectGround, unprojectGround } from './isometric';
import { drawClubGround, drawCountryClub, drawVillageAmenities } from './classic-art';
import { makeSandTexture, makeStripeTexture, makeTurfTexture, makeWaterTexture, TurfKind } from './art/textures';
import { paintLilyPad, makeShrub, makeRock, makeFlowers, makeReeds, makeBench, makeBallWasher, makeGlint, Sprite } from './art/props';
import { makeTree, makeTreeShadow, TREE_BASE, TREE_H, TREE_VARIANTS, TREE_W } from './art/trees';
import { CFG } from './config';
import { Game } from './game';
import { Golfer } from './sim';
import { Pt, T, World, center, hash2, holePath, inBounds, vnoise } from './terrain';
import { ToolId } from './editing';
import { Palette, REGIONS, RGB } from './progression';

interface Decor { x: number; y: number; kind: 'shrub' | 'rock' | 'flowers' | 'reeds'; v: number; i: number }

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
  /** Tool that staged each tile, so unbuilt strokes preview in the colour of what they will become. */
  stagedKind: Map<number, ToolId>;
  tooExpensive: boolean;
  hoverPt: Pt | null;
  parcel: { col: number; row: number } | null;
  buildTee: Pt | null;
  buildLine: { from: Pt; to: Pt } | null;
  /** Pins an unbuilt tee/cup/dogleg/new-hole plan would move. */
  ghost: { tee?: Pt; cup?: Pt; bend?: Pt; par: number } | null;
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
  private treesSmall: HTMLCanvasElement[] = [];
  private treeShadow = makeTreeShadow();
  private glint = makeGlint();
  private shrubs = [0, 1, 2, 3].map(makeShrub);
  private rocks = [0, 1].map(makeRock);
  private flowers = [0, 1, 2].map(makeFlowers);
  private reeds = [0, 1].map(makeReeds);
  private bench = makeBench();
  private washer = makeBallWasher();
  private decor: Decor[] = [];
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
    for (let v = 0; v < TREE_VARIANTS; v++) {
      const big = makeTree(v);
      const small = document.createElement('canvas');
      small.width = TREE_W / 2;
      small.height = TREE_H / 2;
      const sc = small.getContext('2d')!;
      sc.imageSmoothingQuality = 'high';
      sc.drawImage(big, 0, 0, small.width, small.height);
      this.trees.push(big);
      this.treesSmall.push(small);
    }
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
  private layerCv = document.createElement('canvas');

  private syncTerrain(w: World) {
    const now = performance.now();
    if (this.builtFor !== w || this.regionKey !== w.region) {
      this.builtFor = w;
      this.regionKey = w.region;
      Object.assign(COL, REGIONS[w.region].palette);
      this.fields.clear();
      this.patterns.clear();
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
      const region = { x0: w.w, y0: w.h, x1: 0, y1: 0 };
      const keys = new Set<string>();
      for (const i of w.dirty) {
        const x = i % w.w;
        const y = (i - x) / w.w;
        if (this.prevTerrain![i] !== w.terrain[i]) {
          typeChanged = true;
          region.x0 = Math.min(region.x0, x);
          region.y0 = Math.min(region.y0, y);
          region.x1 = Math.max(region.x1, x + 1);
          region.y1 = Math.max(region.y1, y + 1);
          for (const k of Renderer.fieldsFor(this.prevTerrain![i])) keys.add(k);
          for (const k of Renderer.fieldsFor(w.terrain[i])) keys.add(k);
        }
        this.markChunk(w, i);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inBounds(w, x + dx, y + dy)) todo.add((y + dy) * w.w + x + dx);
      }
      for (const i of todo) this.drawTile(w, i % w.w, Math.floor(i / w.w));
      if (typeChanged) {
        this.rebuildMasks(w, region, keys);
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
    const jit = (x: number, y: number) => (vnoise(x / 6.5, y / 6.5, 40) - 0.5) * 14 + (vnoise(x / 2.4, y / 2.4, 41) - 0.5) * 9;
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
  // Seamless material overlays are generated once (see art/textures.ts) and stamped into the terrain cache.
  private patterns = new Map<string, CanvasPattern>();
  private pattern(c: CanvasRenderingContext2D, key: string, make: () => HTMLCanvasElement): CanvasPattern {
    let p = this.patterns.get(key);
    if (!p) {
      p = c.createPattern(make(), 'repeat')!;
      this.patterns.set(key, p);
    }
    return p;
  }
  private turfPattern(c: CanvasRenderingContext2D, kind: TurfKind) {
    return this.pattern(c, 'turf-' + kind, () => makeTurfTexture(kind));
  }

  // Organic edges: each surface is a tile mask blurred into a smooth field (stored as bytes), and every
  // chunk thresholds that field after adding a little noise, so borders wobble like hand-mown turf.
  private static readonly R = 16; // field pixels per tile
  private static readonly M = 8; // margin (field pixels) around a chunk so shifted masks have data
  private fields = new Map<string, Uint8Array>();
  private fieldW = 0;
  private fieldH = 0;
  private maskCv = document.createElement('canvas');
  private maskImages = new Map<string, ImageData>();
  private warpNoise = new Float32Array(0);

  private static readonly FIELD_PRED: Record<string, (t: number) => boolean> = {
    grass: (t) => t === T.FAIRWAY || t === T.GREEN || t === T.TEE,
    green: (t) => t === T.GREEN,
    tee: (t) => t === T.TEE,
    bunker: (t) => t === T.BUNKER,
    water: (t) => t === T.WATER,
  };

  /** Which blurred fields a terrain type feeds. */
  private static fieldsFor(t: number): string[] {
    return t === T.FAIRWAY ? ['grass'] : t === T.GREEN ? ['grass', 'green'] : t === T.TEE ? ['grass', 'tee'] : t === T.BUNKER ? ['bunker'] : t === T.WATER ? ['water'] : [];
  }

  /**
   * Blur the tile mask for one surface into its byte field. With a region (in tiles) only that part is
   * recomputed, so painting a few tiles does not re-blur the whole map.
   */
  private updateField(w: World, key: string, region?: { x0: number; y0: number; x1: number; y1: number }) {
    const R = Renderer.R;
    const pred = Renderer.FIELD_PRED[key];
    const FW = w.w * R;
    let field = this.fields.get(key);
    if (!field || field.length !== FW * w.h * R) {
      field = new Uint8Array(FW * w.h * R);
      this.fields.set(key, field);
      region = undefined;
    }
    const grow = (r: { x0: number; y0: number; x1: number; y1: number }, n: number) => ({ x0: Math.max(0, r.x0 - n), y0: Math.max(0, r.y0 - n), x1: Math.min(w.w, r.x1 + n), y1: Math.min(w.h, r.y1 + n) });
    const full = { x0: 0, y0: 0, x1: w.w, y1: w.h };
    const copy = region ? grow(region, 2) : full;
    const src = grow(copy, 3);
    const sw = (src.x1 - src.x0) * R;
    const sh = (src.y1 - src.y0) * R;
    const cv = document.createElement('canvas');
    cv.width = sw;
    cv.height = sh;
    const sc = cv.getContext('2d')!;
    sc.fillStyle = '#fff';
    for (let y = src.y0; y < src.y1; y++) {
      let x = src.x0;
      while (x < src.x1) {
        if (!pred(w.terrain[y * w.w + x])) { x++; continue; }
        let x2 = x;
        while (x2 < src.x1 && pred(w.terrain[y * w.w + x2])) x2++;
        sc.fillRect((x - src.x0) * R, (y - src.y0) * R, (x2 - x) * R, R);
        x = x2;
      }
    }
    const blur = document.createElement('canvas');
    blur.width = sw;
    blur.height = sh;
    const bc = blur.getContext('2d')!;
    bc.filter = `blur(${R * 0.55}px)`;
    bc.drawImage(cv, 0, 0);
    bc.filter = 'none';
    const ox = (copy.x0 - src.x0) * R;
    const oy = (copy.y0 - src.y0) * R;
    const cw = (copy.x1 - copy.x0) * R;
    const ch = (copy.y1 - copy.y0) * R;
    const px = bc.getImageData(ox, oy, cw, ch).data;
    for (let j = 0; j < ch; j++) {
      const row = (copy.y0 * R + j) * FW + copy.x0 * R;
      for (let i = 0; i < cw; i++) field[row + i] = px[(j * cw + i) * 4 + 3];
    }
  }

  private rebuildMasks(w: World, region?: { x0: number; y0: number; x1: number; y1: number }, keys?: Set<string>) {
    this.fieldW = w.w * Renderer.R;
    this.fieldH = w.h * Renderer.R;
    for (const key of Object.keys(Renderer.FIELD_PRED)) if (!keys || keys.has(key)) this.updateField(w, key, region);
    this.buildDecor(w);
  }

  /** Scatter shrubs, rocks, flower patches and shore reeds. Placement depends only on terrain and hashes, so it is stable. */
  private buildDecor(w: World) {
    const list: Decor[] = [];
    const at = (x: number, y: number) => (inBounds(w, x, y) ? w.terrain[y * w.w + x] : T.ROUGH);
    for (let y = 1; y < w.h - 1; y++)
      for (let x = 1; x < w.w - 1; x++) {
        const i = y * w.w + x;
        const t = w.terrain[i];
        const h = hash2(x, y, 950);
        const jx = x + 0.15 + hash2(x, y, 951) * 0.7;
        const jy = y + 0.15 + hash2(x, y, 952) * 0.7;
        const near = (pred: (n: number) => boolean) => pred(at(x - 1, y)) || pred(at(x + 1, y)) || pred(at(x, y - 1)) || pred(at(x, y + 1));
        if (t === T.WATER) {
          const shoreRough = near((n) => n === T.ROUGH);
          if (shoreRough && h < 0.2) list.push({ x: jx, y: jy, kind: 'reeds', v: Math.floor(hash2(x, y, 953) * 2), i });
          else if (near((n) => n !== T.WATER) && h > 0.93) list.push({ x: jx, y: jy, kind: 'rock', v: Math.floor(hash2(x, y, 953) * 2), i });
        } else if (t === T.ROUGH && !w.tree[i]) {
          const edge = near((n) => n !== T.ROUGH && n !== T.PATH && n !== T.BUILDING);
          const kind = hash2(x, y, 954);
          if (edge) {
            if (h < 0.05) list.push({ x: jx, y: jy, kind: 'shrub', v: Math.floor(kind * 4), i });
            else if (h < 0.075) list.push({ x: jx, y: jy, kind: 'rock', v: Math.floor(kind * 2), i });
            else if (h < 0.1) list.push({ x: jx, y: jy, kind: 'flowers', v: Math.floor(kind * 3), i });
          } else if (h < 0.012) list.push({ x: jx, y: jy, kind: 'flowers', v: Math.floor(kind * 3), i });
          else if (h > 0.992) list.push({ x: jx, y: jy, kind: 'shrub', v: Math.floor(kind * 4), i });
          else if (h > 0.986) list.push({ x: jx, y: jy, kind: 'rock', v: Math.floor(kind * 2), i });
        } else if (t === T.BUNKER && h > 0.985) {
          list.push({ x: jx, y: jy, kind: 'rock', v: 1, i });
        }
      }
    this.decor = list;
  }

  /** How much each surface's edge wanders (in field alpha units). Tee boxes stay tidy. */
  private static readonly WARP: Record<string, number> = { grass: 0.2, green: 0.15, tee: 0.03, bunker: 0.3, water: 0.26 };

  /** Threshold the blurred field into a chunk-sized soft-edged alpha mask (drawn into the shared scratch canvas). */
  private chunkMask(key: string, th: number, soft: number, tx0: number, ty0: number, tx1: number, ty1: number): HTMLCanvasElement {
    const R = Renderer.R;
    const M = Renderer.M;
    const mw = (tx1 - tx0) * R + 2 * M;
    const mh = (ty1 - ty0) * R + 2 * M;
    const field = this.fields.get(key)!;
    const warp = Renderer.WARP[key] ?? 0.15;
    const imgKey = mw + 'x' + mh;
    let img = this.maskImages.get(imgKey);
    if (!img) {
      img = new ImageData(mw, mh);
      this.maskImages.set(imgKey, img);
    }
    const px = new Uint32Array(img.data.buffer);
    const fx0 = tx0 * R - M;
    const fy0 = ty0 * R - M;
    const lo = th - soft;
    const inv = 1 / (2 * soft);
    for (let j = 0; j < mh; j++) {
      const fy = Math.max(0, Math.min(this.fieldH - 1, fy0 + j));
      const row = fy * this.fieldW;
      for (let i = 0; i < mw; i++) {
        const fx = Math.max(0, Math.min(this.fieldW - 1, fx0 + i));
        const f = field[row + fx] / 255;
        // noise only wobbles existing edges; it never conjures a surface out of empty ground
        const a = f + warp * this.warpNoise[j * mw + i] * (f * 12 > 1 ? 1 : f * 12);
        let t = (a - lo) * inv;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        px[j * mw + i] = (Math.round(t * t * (3 - 2 * t) * 255) << 24) | 0x00ffffff;
      }
    }
    const cv = this.maskCv;
    if (cv.width !== mw || cv.height !== mh) {
      cv.width = mw;
      cv.height = mh;
    }
    cv.getContext('2d')!.putImageData(img, 0, 0);
    return cv;
  }

  private prepareWarp(tx0: number, ty0: number, tx1: number, ty1: number) {
    const R = Renderer.R;
    const M = Renderer.M;
    const mw = (tx1 - tx0) * R + 2 * M;
    const mh = (ty1 - ty0) * R + 2 * M;
    if (this.warpNoise.length !== mw * mh) this.warpNoise = new Float32Array(mw * mh);
    const fx0 = tx0 * R - M;
    const fy0 = ty0 * R - M;
    for (let j = 0; j < mh; j++)
      for (let i = 0; i < mw; i++) {
        const gx = (fx0 + i) / R;
        const gy = (fy0 + j) / R;
        this.warpNoise[j * mw + i] = (vnoise(gx * 0.5, gy * 0.5, 6) - 0.5) * 1.3 + (vnoise(gx * 1.3, gy * 1.3, 7) - 0.5) * 0.7 + (vnoise(gx * 3.3, gy * 3.3, 8) - 0.5) * 0.3;
      }
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
    const R = Renderer.R;
    const M = Renderer.M;
    const tx0 = cx * C;
    const ty0 = cy * C;
    const tx1 = Math.min(w.w, tx0 + C);
    const ty1 = Math.min(w.h, ty0 + C);
    const X = tx0 * TS;
    const Y = ty0 * TS;
    const CW = (tx1 - tx0) * TS;
    const CHH = (ty1 - ty0) * TS;
    const k = R / TS; // field pixels per terrain pixel
    const t = this.tctx2;
    this.prepareWarp(tx0, ty0, tx1, ty1);
    t.globalCompositeOperation = 'source-over';
    // rough: darker, longer, with big soft dapples of sun and shade
    this.drawSmooth(t, 'rough', tx0, ty0, tx1, ty1, w);
    t.fillStyle = this.turfPattern(t, 'rough');
    t.fillRect(X, Y, CW, CHH);
    t.drawImage(this.base, X, Y, CW, CHH, X, Y, CW, CHH);
    const lc = this.layerCv.getContext('2d')!;
    // work in a chunk-sized scratch canvas: full-size scratch copies make software canvases crawl
    type Shift = [number, number];
    interface Cut { th: number; soft?: number; shift: Shift }
    // largest field value per surface inside this chunk (plus margin): lets us skip layers that cannot appear here
    const peak = new Map<string, number>();
    for (const key of Object.keys(Renderer.FIELD_PRED)) {
      const field = this.fields.get(key)!;
      let max = 0;
      const fy0 = Math.max(0, ty0 * R - M);
      const fy1 = Math.min(this.fieldH, ty1 * R + M);
      const fx0 = Math.max(0, tx0 * R - M);
      const fx1 = Math.min(this.fieldW, tx1 * R + M);
      for (let fy = fy0; fy < fy1 && max < 255; fy++) {
        const row = fy * this.fieldW;
        for (let fx = fx0; fx < fx1; fx++) if (field[row + fx] > max) max = field[row + fx];
      }
      peak.set(key, max / 255);
    }
    const stamp = (fill: (c: CanvasRenderingContext2D) => void, key: string, th: number, soft = 0.09, cut?: Cut) => {
      const top = peak.get(key)!;
      if (top < 0.01 || top + (Renderer.WARP[key] ?? 0.15) * 0.9 < th - soft) return;
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalCompositeOperation = 'source-over';
      lc.clearRect(0, 0, this.layerCv.width, this.layerCv.height);
      lc.setTransform(1, 0, 0, 1, -X, -Y);
      fill(lc);
      const dx = X - M / k;
      const dy = Y - M / k;
      lc.globalCompositeOperation = 'destination-in';
      let mask = this.chunkMask(key, th, soft, tx0, ty0, tx1, ty1);
      lc.drawImage(mask, dx, dy, mask.width / k, mask.height / k);
      if (cut) {
        mask = this.chunkMask(key, cut.th, cut.soft ?? soft, tx0, ty0, tx1, ty1);
        lc.globalCompositeOperation = 'destination-out';
        lc.drawImage(mask, dx + cut.shift[0], dy + cut.shift[1], mask.width / k, mask.height / k);
      }
      lc.globalCompositeOperation = 'source-over';
      t.drawImage(this.layerCv, 0, 0, CW, CHH, X, Y, CW, CHH);
    };
    const flat = (col: string) => (c: CanvasRenderingContext2D) => {
      c.fillStyle = col;
      c.fillRect(X, Y, CW, CHH);
    };
    const pat = (p: CanvasPattern, alpha = 1) => (c: CanvasRenderingContext2D) => {
      c.globalAlpha = alpha;
      c.fillStyle = p;
      c.fillRect(X, Y, CW, CHH);
      c.globalAlpha = 1;
    };
    const eachTile = (types: number[], draw: (c: CanvasRenderingContext2D, x: number, y: number, i: number) => void) => (c: CanvasRenderingContext2D) => {
      for (let y = ty0; y < ty1; y++)
        for (let x = tx0; x < tx1; x++) {
          const i = y * w.w + x;
          if (types.includes(w.terrain[i])) draw(c, x, y, i);
        }
    };
    const layers = (...fns: Array<(c: CanvasRenderingContext2D) => void>) => (c: CanvasRenderingContext2D) => fns.forEach((f) => f(c));
    const tex = (cmap: string, kind: TurfKind, extra?: (c: CanvasRenderingContext2D) => void) => (c: CanvasRenderingContext2D) => {
      this.drawSmooth(c, cmap, tx0, ty0, tx1, ty1, w);
      pat(this.turfPattern(c, kind))(c);
      extra?.(c);
    };

    // ---- fairway family: soft shade just outside, a lighter first cut, then the striped body
    stamp(flat('rgba(18,58,30,0.26)'), 'grass', 0.14, 0.14);
    stamp(flat('rgba(132,196,88,0.62)'), 'grass', 0.3, 0.12);
    const fairwayWear = eachTile([T.FAIRWAY, T.GREEN, T.TEE], (c, x, y, i) => this.grassTile(c, w, x, y, i));
    stamp(layers(tex('grass', 'fairway'), pat(this.pattern(t, 'stripe-fw', () => makeStripeTexture(100, 0.3))), fairwayWear), 'grass', 0.5, 0.075);
    // slim darker line where the cut turns: reads as the edge of the mown area
    stamp(flat('rgba(20,84,36,0.22)'), 'grass', 0.52, 0.04, { th: 0.6, shift: [0, 0] });

    // ---- green: collar, defining edge, brightest finest turf
    stamp(layers(flat('rgba(146,212,102,0.9)'), pat(this.turfPattern(t, 'fairway'), 0.8), pat(this.pattern(t, 'stripe-collar', () => makeStripeTexture(16, 0.18)), 0.7)), 'green', 0.28, 0.1);
    stamp(flat('rgba(30,106,44,0.4)'), 'green', 0.46, 0.06);
    stamp(layers(tex('green', 'green'), pat(this.pattern(t, 'stripe-green', () => makeStripeTexture(48, 0.16))), eachTile([T.GREEN], (c, x, y, i) => this.grassTile(c, w, x, y, i))), 'green', 0.54, 0.05);

    // ---- tee box: flat, tight, crisp, with its own pale cut lines
    stamp(flat('rgba(24,92,40,0.45)'), 'tee', 0.46, 0.035);
    stamp(layers(tex('tee', 'tee'), pat(this.pattern(t, 'stripe-tee', () => makeStripeTexture(TS, 0.2))), eachTile([T.TEE], (c, x, y, i) => this.grassTile(c, w, x, y, i))), 'tee', 0.52, 0.03);

    // ---- bunkers: grass lip, shaded NW inner wall, fine grain, raked furrows, a few footprints
    stamp(flat('rgba(40,92,36,0.6)'), 'bunker', 0.22, 0.12);
    stamp(flat('rgba(160,214,108,0.85)'), 'bunker', 0.36, 0.1);
    const sandSurface = layers(
      (c) => {
        this.drawSmooth(c, 'sand', tx0, ty0, tx1, ty1, w);
        pat(this.pattern(c, 'sand', () => makeSandTexture()))(c);
      },
      (c) => this.rakeLines(c, X, Y, CW, CHH),
      eachTile([T.BUNKER], (c, x, y) => this.sandDetail(c, x, y)),
    );
    stamp(sandSurface, 'bunker', 0.5, 0.065);
    // the lip shades the side facing away from the sun (upper left on screen, -x on the ground)
    stamp(flat('rgba(118,84,42,0.7)'), 'bunker', 0.5, 0.065, { th: 0.5, soft: 0.2, shift: [6, 2.5] });
    stamp(flat('rgba(255,250,226,0.4)'), 'bunker', 0.5, 0.2, { th: 0.5, soft: 0.065, shift: [-4, -1.6] });
    stamp(flat('rgba(120,86,44,0.55)'), 'bunker', 0.52, 0.03, { th: 0.58, shift: [0, 0] });

    // ---- water: wet bank, pale pebbled shore, depth bands (light shallows -> dark centre), bank shadow
    stamp(flat('rgba(72,84,44,0.5)'), 'water', 0.2, 0.1);
    stamp(flat('rgba(214,212,166,0.82)'), 'water', 0.34, 0.08);
    const waterSurface = layers(
      (c) => {
        this.drawSmooth(c, 'water', tx0, ty0, tx1, ty1, w);
        pat(this.pattern(c, 'water', () => makeWaterTexture()))(c);
      },
      eachTile([T.WATER], (c, x, y, i) => this.waterDetail(c, w, x, y, i)),
    );
    stamp(waterSurface, 'water', 0.5, 0.065);
    stamp(flat('rgba(24,128,176,0.3)'), 'water', 0.62, 0.12);
    stamp(flat('rgba(14,94,150,0.36)'), 'water', 0.78, 0.12);
    stamp(flat('rgba(8,58,112,0.42)'), 'water', 0.92, 0.1);
    stamp(flat('rgba(178,248,222,0.42)'), 'water', 0.5, 0.08, { th: 0.58, soft: 0.1, shift: [0, 0] });
    stamp(flat('rgba(6,40,60,0.5)'), 'water', 0.5, 0.065, { th: 0.5, soft: 0.2, shift: [7, 2.8] });
    stamp(flat('rgba(40,70,50,0.45)'), 'water', 0.5, 0.03, { th: 0.56, shift: [0, 0] });
  }

  /** Curved rake furrows: continuous across tiles because they depend only on world position. */
  private rakeLines(c: CanvasRenderingContext2D, X: number, Y: number, CW: number, CHH: number) {
    c.lineWidth = 1.1;
    c.lineCap = 'round';
    const gap = 9;
    for (let y = Math.floor(Y / gap) * gap - 20; y < Y + CHH + 20; y += gap) {
      const row = Math.round(y / gap);
      const furrow = (dy: number) => {
        c.beginPath();
        for (let x = X - 8; x <= X + CW + 8; x += 8) {
          const bend = Math.sin(x / 46 + row * 0.5) * 7 + Math.sin(x / 120 - y / 70) * 11;
          if (x === X - 8) c.moveTo(x, y + dy + bend);
          else c.lineTo(x, y + dy + bend);
        }
        c.stroke();
      };
      // broken furrows read as raked marks rather than ruled lines
      c.setLineDash([26 + (row % 5) * 6, 8, 44, 10 + (row % 3) * 4]);
      c.lineDashOffset = row * 17;
      c.strokeStyle = 'rgba(140,102,58,0.2)';
      furrow(0);
      c.strokeStyle = 'rgba(255,252,232,0.32)';
      furrow(1.4);
    }
    c.setLineDash([]);
  }

  /** Footprints and pebbles scattered on sand tiles. */
  private sandDetail(c: CanvasRenderingContext2D, x: number, y: number) {
    const px = x * TS;
    const py = y * TS;
    if (hash2(x, y, 910) < 0.16) {
      const fx = px + 6 + hash2(x, y, 911) * (TS - 12);
      const fy = py + 6 + hash2(x, y, 912) * (TS - 12);
      const ang = hash2(x, y, 913) * Math.PI * 2;
      c.fillStyle = 'rgba(120,88,48,0.4)';
      for (let s = 0; s < 4; s++) {
        const ox = Math.cos(ang) * s * 7 + (s % 2 ? 1.6 : -1.6) * -Math.sin(ang);
        const oy = Math.sin(ang) * s * 7 + (s % 2 ? 1.6 : -1.6) * Math.cos(ang);
        c.beginPath();
        c.ellipse(fx + ox, fy + oy, 2.4, 1.4, ang, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(255,250,228,0.3)';
        c.fillRect(fx + ox - 2, fy + oy - 1.6, 2, 0.9);
        c.fillStyle = 'rgba(120,88,48,0.4)';
      }
    }
    if (hash2(x, y, 914) < 0.14) {
      for (let s = 0; s < 3; s++) {
        const bx = px + hash2(x, y, 915 + s) * TS;
        const by = py + hash2(x, y, 920 + s) * TS;
        c.fillStyle = 'rgba(96,84,72,0.4)';
        c.beginPath();
        c.ellipse(bx + 0.8, by + 0.7, 1.8, 1.2, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = s % 2 ? '#b8ab94' : '#cfc3ac';
        c.beginPath();
        c.ellipse(bx, by, 1.7, 1.2, 0, 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  /** Lily pads on open water, painted flat into the terrain. */
  private waterDetail(c: CanvasRenderingContext2D, w: World, x: number, y: number, i: number) {
    void i;
    if (hash2(x, y, 930) > 0.1) return;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (!inBounds(w, x + dx, y + dy) || w.terrain[(y + dy) * w.w + x + dx] !== T.WATER) return;
    const n = 1 + Math.floor(hash2(x, y, 931) * 3);
    const cx = x * TS + 8 + hash2(x, y, 932) * 16;
    const cy = y * TS + 8 + hash2(x, y, 933) * 16;
    for (let k = 0; k < n; k++) paintLilyPad(c, cx + (hash2(x, y, 934 + k) - 0.5) * 12, cy + (hash2(x, y, 938 + k) - 0.5) * 9, 4 + hash2(x, y, 942 + k) * 2.5, x * 7 + y * 13 + k);
  }

  /** Worn turf stays readable: dirt scuffs and thin patches appear as condition drops. */
  private grassTile(c: CanvasRenderingContext2D, w: World, x: number, y: number, i: number) {
    const cond = w.cond[i];
    const px = x * TS;
    const py = y * TS;
    if (cond < 44) {
      const n = cond < 25 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const ex = px + hash2(x, y, 50 + k) * TS;
        const ey = py + hash2(x, y, 60 + k) * TS;
        const r = TS * (0.34 + hash2(x, y, 70 + k) * 0.34);
        const g = c.createRadialGradient(ex, ey, 1, ex, ey, r);
        const a = 0.3 + (44 - cond) / 110;
        g.addColorStop(0, `rgba(${COL.dirt[0]},${COL.dirt[1]},${COL.dirt[2]},${a})`);
        g.addColorStop(0.6, `rgba(${COL.dirt[0]},${COL.dirt[1]},${COL.dirt[2]},${a * 0.5})`);
        g.addColorStop(1, `rgba(${COL.dirt[0]},${COL.dirt[1]},${COL.dirt[2]},0)`);
        c.fillStyle = g;
        c.fillRect(ex - r, ey - r, r * 2, r * 2);
      }
      c.fillStyle = 'rgba(96,74,42,0.4)';
      for (let k = 0; k < 6; k++) c.fillRect(px + hash2(x, y, 100 + k) * TS, py + hash2(x, y, 110 + k) * TS, 1.6, 1.3);
      c.fillStyle = 'rgba(224,196,140,0.35)';
      for (let k = 0; k < 3; k++) c.fillRect(px + hash2(x, y, 160 + k) * TS, py + hash2(x, y, 170 + k) * TS, 1.3, 1.3);
    }
  }

  /** Base layer: rough tufts, paved paths with stone edging, and the clubhouse footprint. */
  private drawTile(w: World, x: number, y: number) {
    const c = this.tctx;
    const i = y * w.w + x;
    const t = w.terrain[i];
    const px = x * TS;
    const py = y * TS;
    const cond = t === T.ROUGH ? w.cond[i] : 62;
    c.clearRect(px, py, TS, TS);
    if (t === T.ROUGH) {
      const tall = cond < 45;
      const n = tall ? 5 : 3;
      for (let k = 0; k < n; k++) {
        const bx = px + hash2(x, y, 140 + k) * TS;
        const by = py + 4 + hash2(x, y, 150 + k) * (TS - 4);
        c.strokeStyle = tall ? (k % 2 ? 'rgba(168,176,104,0.48)' : 'rgba(92,124,66,0.46)') : k % 2 ? 'rgba(104,170,76,0.62)' : 'rgba(28,86,40,0.58)';
        c.lineWidth = 1.2;
        c.beginPath();
        c.moveTo(bx, by);
        c.quadraticCurveTo(bx + (hash2(x, y, 160 + k) - 0.5) * 5, by - (tall ? 3 : 1.5), bx + (hash2(x, y, 165 + k) - 0.5) * 6, by - (tall ? 6 + hash2(x, y, 170 + k) * 4 : 3.5));
        c.stroke();
      }
      if (cond < 32 && hash2(x, y, 180) < 0.16) {
        c.fillStyle = ['#f3efe2', '#f1d24f', '#b98bd6'][Math.floor(hash2(x, y, 181) * 3)];
        c.beginPath();
        c.arc(px + 5 + hash2(x, y, 182) * (TS - 10), py + 5 + hash2(x, y, 183) * (TS - 10), 1.7, 0, Math.PI * 2);
        c.fill();
      }
    } else if (t === T.PATH || t === T.BUILDING) {
      this.paveTile(c, w, x, y);
    }
  }

  /** Flagstone paving: tinted pavers, grout, a lit top-left edge on every stone, and stone edging where it meets turf. */
  private paveTile(c: CanvasRenderingContext2D, w: World, x: number, y: number) {
    const px = x * TS;
    const py = y * TS;
    const jit = (vnoise(x / 3.2, y / 3.2, 41) - 0.5) * 16;
    c.fillStyle = css(COL.path, jit - 6);
    c.fillRect(px, py, TS, TS);
    const rows = [0, 11, 21, 32];
    for (let r = 0; r < 3; r++) {
      const y0 = py + rows[r];
      const y1 = py + rows[r + 1];
      const off = hash2(x, y, 700 + r) * 10;
      let sx = px - 10 + off;
      let k = 0;
      while (sx < px + TS) {
        const wd = 12 + hash2(x, y, 710 + r * 5 + k) * 8;
        const x0 = Math.max(px, sx);
        const x1 = Math.min(px + TS, sx + wd);
        if (x1 > x0 + 1) {
          const tint = (hash2(x, y, 730 + r * 5 + k) - 0.5) * 18;
          c.fillStyle = css(COL.path, jit + tint + 4);
          c.fillRect(x0 + 0.7, y0 + 0.7, x1 - x0 - 1.4, y1 - y0 - 1.4);
          c.fillStyle = 'rgba(255,250,232,0.34)';
          c.fillRect(x0 + 0.7, y0 + 0.7, x1 - x0 - 1.4, 1);
          c.fillRect(x0 + 0.7, y0 + 0.7, 1, y1 - y0 - 1.4);
          c.fillStyle = 'rgba(96,86,70,0.28)';
          c.fillRect(x0 + 0.7, y1 - 1.3, x1 - x0 - 1.4, 0.8);
        }
        sx += wd;
        k++;
      }
    }
    c.fillStyle = 'rgba(110,100,86,0.25)';
    for (let k = 0; k < 4; k++) c.fillRect(px + hash2(x, y, 230 + k) * (TS - 1), py + hash2(x, y, 240 + k) * (TS - 1), 1.3, 1.3);
    if (hash2(x, y, 250) < 0.22) {
      c.strokeStyle = 'rgba(70,64,52,0.5)';
      c.lineWidth = 0.9;
      const sx = px + hash2(x, y, 251) * TS;
      c.beginPath();
      c.moveTo(sx, py);
      c.lineTo(sx + 4, py + TS * 0.4);
      c.lineTo(sx - 2, py + TS * 0.75);
      c.stroke();
      c.fillStyle = 'rgba(90,150,64,0.85)';
      c.fillRect(sx + 2.5, py + TS * 0.4 - 1, 2, 2.5);
    }
    // stone edging along every side that borders something other than paving
    const solid = (tx: number, ty: number) => {
      if (!inBounds(w, tx, ty)) return true;
      const n = w.terrain[ty * w.w + tx];
      return n === T.PATH || n === T.BUILDING;
    };
    const edge = (dx: number, dy: number) => {
      if (solid(x + dx, y + dy)) return;
      const along = dx === 0 ? [1, 0] : [0, 1];
      for (let s = 0; s < 4; s++) {
        const a = (s + 0.5) * (TS / 4);
        const ex = px + (dx === 0 ? a : dx > 0 ? TS - 2.6 : 2.6);
        const ey = py + (dy === 0 ? a : dy > 0 ? TS - 2.6 : 2.6);
        const tone = 168 + hash2(x * 4 + s, y, 760 + dx * 3 + dy) * 40;
        c.fillStyle = 'rgba(70,64,50,0.45)';
        c.beginPath();
        c.ellipse(ex + 0.8, ey + 0.9, along[0] ? 4.4 : 3, along[1] ? 4.4 : 3, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = `rgb(${tone},${tone - 8},${tone - 26})`;
        c.beginPath();
        c.ellipse(ex, ey, along[0] ? 4.2 : 2.8, along[1] ? 4.2 : 2.8, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(255,252,236,0.45)';
        c.beginPath();
        c.ellipse(ex - 0.8, ey - 0.8, along[0] ? 2.4 : 1.2, along[1] ? 2.4 : 1.2, 0, 0, Math.PI * 2);
        c.fill();
      }
    };
    edge(-1, 0);
    edge(1, 0);
    edge(0, -1);
    edge(0, 1);
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

    // restrained water glints: one pre-rendered sprite, slowly twinkling
    const gw = Math.max(8, ts * 0.9);
    const gh = gw * 0.3;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (w.terrain[y * w.w + x] !== T.WATER || hash2(x, y, 300) > 0.4) continue;
        const ph = Math.sin(time * 0.7 + hash2(x, y, 301) * 40);
        if (ph < 0.2) continue;
        const p = this.toScreen(x + 0.2 + hash2(x, y, 302) * 0.6, y + 0.2 + hash2(x, y, 303) * 0.6);
        ctx.globalAlpha = (ph - 0.2) * 0.9;
        ctx.drawImage(this.glint, p.x - gw / 2, p.y - gh / 2, gw, gh);
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
    if (this.nearScreen(7, 44, 16)) drawClubGround(this, game);

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
        if (variant === 0 && game.region !== 'desert') {
          if (hh > .96) variant = 9;
          else if (hh > .82) variant = 7;
          else if (hh > .5) variant = 8;
        }
        if (variant === 0 && game.season.index === 2 && hh < .2) variant = 4;
        items.push({ y: x + y + 1, draw: () => this.drawTree(x, y, variant, hh) });
      }
    for (const d of this.decor) {
      if (d.x < x0 || d.x > x1 + 1 || d.y < y0 || d.y > y1 + 1 || w.tree[d.i]) continue;
      items.push({ y: d.x + d.y, draw: () => this.drawDecor(d) });
    }
    this.teeFurniture(game, items);
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

  private drawSprite(sp: Sprite, x: number, y: number, scale: number, alpha = 1) {
    const ctx = this.ctx;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(sp.cv, x - sp.ax * scale, y - sp.ay * scale, sp.cv.width * scale, sp.cv.height * scale);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  private drawDecor(d: Decor) {
    const p = this.toScreen(d.x, d.y);
    const scale = this.ts / 52;
    const sp = d.kind === 'shrub' ? this.shrubs[d.v % this.shrubs.length] : d.kind === 'rock' ? this.rocks[d.v % this.rocks.length] : d.kind === 'flowers' ? this.flowers[d.v % this.flowers.length] : this.reeds[d.v % this.reeds.length];
    this.drawSprite(sp, p.x, p.y, scale);
  }

  /** Bench and ball washer beside each tee box, on the side away from the fairway. */
  private teeFurniture(game: Game, items: Array<{ y: number; draw: () => void }>) {
    const w = game.world;
    for (const h of game.world.holes) {
      const dir = Math.atan2(h.bend.y - h.tee.y, h.bend.x - h.tee.x);
      const tc = center(h.tee);
      const px = -Math.sin(dir);
      const py = Math.cos(dir);
      const place = (side: number, back: number, sp: Sprite, scale: number) => {
        const wx = tc.x + px * side - Math.cos(dir) * back;
        const wy = tc.y + py * side - Math.sin(dir) * back;
        const tx = Math.floor(wx);
        const ty = Math.floor(wy);
        if (!inBounds(w, tx, ty)) return;
        const tt = w.terrain[ty * w.w + tx];
        if (tt === T.WATER || tt === T.BUNKER || tt === T.BUILDING || w.tree[ty * w.w + tx]) return;
        items.push({ y: wx + wy, draw: () => { const s = this.toScreen(wx, wy); this.drawSprite(sp, s.x, s.y, this.ts / 52 * scale); } });
      };
      place(2.6, 0.4, this.bench, 1);
      place(-2.5, 0.8, this.washer, 1);
    }
  }

  private drawTree(x: number, y: number, v: number, hh: number) {
    const ctx = this.ctx;
    const ts = this.ts;
    const p = this.toScreen(x + 0.5, y + 0.5);
    const size = ts * (1.5 + hh * 0.55);
    const s = size / TREE_W;
    // sun is upper left: the cast shadow stretches toward the lower right, with a tight contact shadow at the trunk
    const reach = v === 2 ? 1.05 : v === 6 ? 0.5 : 0.85;
    ctx.drawImage(this.treeShadow, p.x - 58 * s * reach - size * 0.02, p.y - 30 * s * reach, 192 * s * reach, 64 * s * reach);
    const small = size * this.dpr < 80;
    const spr = small ? this.treesSmall[v] : this.trees[v];
    const h = size * (TREE_H / TREE_W);
    const baseY = h * TREE_BASE;
    if (v === 3) {
      ctx.drawImage(spr, p.x - size / 2, p.y - baseY, size, h);
      return;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.sin(this.time * 1.1 + hh * 40) * 0.018);
    ctx.drawImage(spr, -size / 2, -baseY, size, h);
    ctx.restore();
  }

  private drawGolfer(g: Golfer, selected: boolean, time: number) {
    const ctx = this.ctx;
    const u = Math.max(this.ts, 16);
    const p = this.toScreen(g.rx, g.ry);
    const gt = CFG.golfers.types[g.type];
    const walking = g.phase === 'arrive' || g.phase === 'toTee' || g.phase === 'toBall' || g.phase === 'toExit' || g.phase === 'leave';
    const sw = walking ? Math.sin(g.walkT) : 0;
    // same sun as the trees: a soft shadow stretched toward the lower right, plus a tight contact shadow
    ctx.fillStyle = 'rgba(8,26,16,0.2)';
    ctx.beginPath();
    ctx.ellipse(p.x + u * 0.2, p.y + u * 0.03, u * 0.3, u * 0.075, 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(4,16,10,0.3)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, u * 0.17, u * 0.055, 0, 0, Math.PI * 2);
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

  /** True when a ground point (with a radius in tiles) could be on screen; lets static scenery skip off-screen work. */
  private nearScreen(wx: number, wy: number, radiusTiles: number) {
    const p = this.toScreen(wx, wy);
    const r = radiusTiles * this.ts * 1.2;
    return p.x > -r && p.x < this.cw + r && p.y > -r * 1.4 && p.y < this.ch + r;
  }
  private drawBuilding(game: Game, time: number) { if (this.nearScreen(7, 44, 16)) drawCountryClub(this, game, time); }
  private drawStructures(game: Game, time: number) { if (this.nearScreen(15, 41, 14)) drawVillageAmenities(this, game); void time; }

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

  /** Yardage chips along a tee-bend-cup route: one per leg when it doglegs, plus par and total at the green. */
  private drawYardage(route: Pt[], par: number, ghost = false) {
    const ctx = this.ctx;
    const yd = (a: Pt, b: Pt) => Math.round(Math.hypot(b.x - a.x, b.y - a.y) * CFG.grid.yardsPerTile);
    const [tee, bend, cup] = route;
    const lineDev = Math.abs((cup.x - tee.x) * (tee.y - bend.y) - (tee.x - bend.x) * (cup.y - tee.y)) / (Math.hypot(cup.x - tee.x, cup.y - tee.y) || 1);
    const chip = (text: string, wx: number, wy: number, lift: number) => {
      const s = this.toScreen(wx, wy);
      ctx.font = '700 11px system-ui, sans-serif';
      const tw = ctx.measureText(text).width + 12;
      ctx.fillStyle = ghost ? 'rgba(58,45,12,.92)' : 'rgba(10,28,44,.88)';
      ctx.strokeStyle = ghost ? '#ffe27a' : 'rgba(176,222,232,.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(s.x - tw / 2, s.y - lift - 10, tw, 20, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = ghost ? '#ffe9a6' : '#eef7f4';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, s.x, s.y - lift + 0.5);
      ctx.textAlign = 'left';
    };
    if (lineDev > 1.5) {
      chip(`${yd(tee, bend)} y`, (tee.x + bend.x) / 2, (tee.y + bend.y) / 2, 4);
      chip(`${yd(bend, cup)} y`, (bend.x + cup.x) / 2, (bend.y + cup.y) / 2, 4);
    }
    const total = Math.round((Math.hypot(bend.x - tee.x, bend.y - tee.y) + Math.hypot(cup.x - bend.x, cup.y - bend.y)) * CFG.grid.yardsPerTile);
    chip(`Par ${par} · ${total} y`, (tee.x + cup.x) / 2, (tee.y + cup.y) / 2, lineDev > 1.5 ? 4 : 4);
  }

  private drawOverlay(game: Game, ov: Overlay, time: number) {
    const ctx = this.ctx;
    const w = game.world;
    const ts = this.ts;
    const COLS: Record<string, string> = { fairway:'110,200,80', green:'180,220,130', path:'210,200,160', rough:'70,140,60', bunker:'240,214,140', water:'70,150,230', treeAdd:'40,120,50', treeDel:'230,140,60', repair:'120,230,160' };
    const col = COLS[ov.tool] ?? '255,255,255';
    const tile = (i:number,staged=false) => {
      this.groundPolygon(i%w.w,Math.floor(i/w.w));
      const blocked=ov.blocked.has(i),changed=ov.changed.has(i)||staged;
      const rgb = staged ? COLS[ov.stagedKind.get(i) ?? ov.tool] ?? col : col;
      if(blocked||changed){ctx.fillStyle=blocked||ov.tooExpensive?'rgba(220,70,50,.45)':`rgba(${rgb},${staged ? .58 : .48})`;ctx.fill();}
      ctx.strokeStyle=blocked?'#e08e70':staged?'rgba(255,226,140,.95)':changed?'rgba(250,245,213,.9)':'rgba(244,241,211,.4)';ctx.lineWidth=changed?1.3:.7;ctx.stroke();
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
      this.drawYardage(holePath(h), h.par);
      if (ov.ghost) {
        const g = ov.ghost;
        const route = [center(g.tee ?? h.tee), center(g.bend ?? h.bend), center(g.cup ?? h.cup)];
        const pts2 = route.map((p) => this.toScreen(p.x, p.y));
        ctx.setLineDash([3, 6]);
        ctx.strokeStyle = '#ffe27a';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        pts2.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineCap = 'butt';
        const pin = (p: Pt | undefined, label: string) => {
          if (!p) return;
          const s = this.toScreen(p.x + 0.5, p.y + 0.5);
          ctx.fillStyle = '#ffe27a';
          ctx.strokeStyle = '#3a2d0c';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(s.x, s.y - ts * 1.9, 11, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(s.x, s.y - ts * 1.9 + 11);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
          ctx.fillStyle = '#2a2110';
          ctx.font = '800 11px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, s.x, s.y - ts * 1.9 + 0.5);
          ctx.textAlign = 'left';
        };
        pin(g.tee, 'T');
        pin(g.cup, 'G');
        pin(g.bend, '◆');
        this.drawYardage(route, g.par, true);
      }
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


