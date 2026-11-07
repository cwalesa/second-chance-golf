import { ISO_X, ISO_Y, projectGround, unprojectGround } from './isometric';
import { drawClubGround, drawCountryClub, drawVillageAmenities } from './classic-art';
import { makePavingTexture, makeSandTexture, makeStripeTexture, makeTurfTexture, makeWaterTexture, makeWearNoise, TurfKind } from './art/textures';
import { paintLilyPad, makeShrub, makeRock, makeFlowers, makeReeds, makeBench, makeBallWasher, makeGlint, Sprite } from './art/props';
import { makeTree, makeTreeShadow, SHADOW_AX, SHADOW_AY, SHADOW_H, SHADOW_W, TREE_BASE, TREE_H, TREE_VARIANTS, TREE_W } from './art/trees';
import { CFG } from './config';
import { Game } from './game';
import { Golfer } from './sim';
import { Pt, T, World, center, hash2, holePath, inBounds, vnoise } from './terrain';
import { ToolId } from './editing';
import { Palette, REGIONS, RGB } from './progression';

interface Decor { x: number; y: number; kind: 'shrub' | 'rock' | 'flowers' | 'reeds'; v: number; i: number }
/** Signed distance to a surface contour (tiles, positive inside) over one chunk plus margin; x0..y1 bound where it matters. */
interface DistMap { d: Float32Array; DW: number; x0: number; y0: number; x1: number; y1: number }
/** Coverage 0..1 at index `k` of a distance map. */
type Shape = (d: Float32Array, k: number) => number;
interface Rect { x: number; y: number; w: number; h: number }

export const TS = 32; // tile size in the cached terrain canvas

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
/** Anti-aliased step (1.5 terrain px wide, so magnified edges stay smooth instead of stair-stepped): coverage of a contour at distance `o` (tiles) for a pixel at distance `d`. */
const aa = (d: number, o: number) => clamp01((d - o) * (TS / 1.5) + 0.5);
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
  // The ground is composed into one top-down canvas (TS px per tile) that the frame projects with a single
  // affine draw. It is built in CH x CH tile chunks, and an edit or wear change only recomposes the chunks
  // it touches.
  //
  // Surface shapes come from per-surface distance fields: the tile mask is blurred (a rounded, organic
  // contour that still follows the tiles) and converted to an approximate signed distance from that
  // contour, in tiles. Every edge, rim and inner shade is then a function of distance, rasterised at full
  // terrain resolution with a one-pixel anti-aliased edge. That gives crisp, smooth outlines and bands of
  // constant width (collars, lips, shorelines) instead of thresholded blur.
  private time = 0;
  private prevTerrain: Uint8Array | null = null;
  private composeAt = 0;
  private needCompose = false;

  private syncTerrain(w: World) {
    const now = performance.now();
    if (this.builtFor !== w || this.regionKey !== w.region) {
      this.builtFor = w;
      this.regionKey = w.region;
      Object.assign(COL, REGIONS[w.region].palette);
      this.fields.clear();
      this.patterns.clear();
      this.buildWarp(w);
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
      }
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

  /**
   * Surface colour maps: one pixel per tile, upscaled with smoothing. They carry only broad, gentle colour
   * (condition, water depth); all fine detail comes from the textures, so there are no cloudy blotches.
   */
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
    // very low-frequency, low-amplitude variation so large lawns are not perfectly flat
    const jit = (x: number, y: number) => (vnoise(x / 9, y / 9, 40) - 0.5) * 7;
    const add = (c: RGB, j: number): RGB => [c[0] + j, c[1] + j, c[2] + j];
    const wearOf = (cond: number) => Math.max(0, Math.min(1, (64 - cond) / 54));
    // rough colour follows condition averaged over the 3x3 neighbourhood: overgrown areas read as areas
    const roughCond = (x: number, y: number) => {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!inBounds(w, x + dx, y + dy)) continue;
          const j = (y + dy) * w.w + x + dx;
          s += w.terrain[j] === T.ROUGH ? w.cond[j] : 62;
          n++;
        }
      return s / n;
    };
    mk('rough', (x, y) => add(mix(COL.roughBad, COL.roughGood, Math.max(0, Math.min(1, (roughCond(x, y) - 8) / 56))), jit(x, y)));
    // broad wear only tints a little; the actual damage is drawn as crisp patches (see wearStamp)
    mk('grass', (x, y, i) => add(w.terrain[i] === T.FAIRWAY ? mix(COL.fairGood, COL.fairWorn, wearOf(w.cond[i]) * 0.45) : COL.fairGood, jit(x, y)));
    mk('green', (x, y, i) => add(w.terrain[i] === T.GREEN ? mix(COL.greenGood, COL.greenWorn, wearOf(w.cond[i]) * 0.4) : COL.greenGood, jit(x, y) * 0.4));
    mk('tee', (x, y, i) => add(w.terrain[i] === T.TEE ? mix(COL.teeGood, COL.fairWorn, wearOf(w.cond[i]) * 0.4) : COL.teeGood, jit(x, y) * 0.4));
    mk('sand', (x, y) => add(COL.sand, jit(x, y) * 0.5));
    // water darkens with distance from the shore: light shallows, restrained deep centre
    mk('water', (x, y, i) => {
      if (w.terrain[i] !== T.WATER) return COL.water;
      let best = 3.5;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          if (inBounds(w, tx, ty) && w.terrain[ty * w.w + tx] !== T.WATER) best = Math.min(best, Math.hypot(dx, dy));
        }
      const t = Math.max(0, Math.min(1, (best - 1) / 2.5));
      return mix(COL.water, COL.waterDeep, t * t * (3 - 2 * t) * 0.85);
    });
  }
  private drawSmooth(c: CanvasRenderingContext2D, key: string, tx0: number, ty0: number, tx1: number, ty1: number, w: World) {
    c.save();
    c.beginPath();
    c.rect(tx0 * TS, ty0 * TS, (tx1 - tx0) * TS, (ty1 - ty0) * TS);
    c.clip();
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    // draw the whole map (clipped) so sampling near a chunk border sees the real neighbours: no seams
    c.drawImage(this.cmaps[key], 0, 0, w.w * TS, w.h * TS);
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

  // ---- distance fields ----
  private static readonly R = 16; // field pixels per tile
  /**
   * Two blur radii (Gaussian sigma, tiles) per surface. The broad one rounds large shapes into flowing
   * contours; the tight one keeps single tiles and 1-tile strips readable. A surface is the union of both,
   * with the tight shape pulled in by SHRINK so it only shows where the broad one would lose a small feature.
   */
  private static readonly SIGMA: Record<string, [broad: number, tight: number]> = {
    grass: [0.65, 0.3],
    green: [0.72, 0.3],
    tee: [0.3, 0.3],
    bunker: [0.66, 0.3],
    water: [0.7, 0.3],
    path: [0.36, 0.3],
  };
  private static readonly SHRINK = 0.09;
  /** Stored field byte = 128 + distance(tiles) * ENC, so the field spans about +-0.85 tiles. */
  private static readonly ENC = 150;
  /** How far outside a contour any rim or shade reaches, in tiles. */
  private static readonly REACH = 0.5;
  private static readonly CH = 8; // chunk size in tiles
  private static readonly MP = 12; // margin (terrain px) around a chunk's distance map, for shifted lookups
  private fields = new Map<string, Uint8Array>();
  private fieldW = 0;
  private fieldH = 0;
  /** blurred coverage byte -> encoded signed distance, per sigma */
  private static distLuts = new Map<number, Uint8Array>();
  /** low-frequency edge wobble on a 4-per-tile grid, about -1..1 */
  private warp = new Float32Array(0);
  private warpW = 0;
  private wearNoise = makeWearNoise();

  private static readonly FIELD_PRED: Record<string, (t: number) => boolean> = {
    grass: (t) => t === T.FAIRWAY || t === T.GREEN || t === T.TEE,
    green: (t) => t === T.GREEN,
    tee: (t) => t === T.TEE,
    bunker: (t) => t === T.BUNKER,
    water: (t) => t === T.WATER,
    path: (t) => t === T.PATH || t === T.BUILDING,
  };
  /** How far each surface's contour may wander, in tiles. Tees and paving stay geometric. */
  private static readonly WARP: Record<string, number> = { grass: 0.2, green: 0.12, tee: 0, bunker: 0.18, water: 0.22, path: 0 };

  /** Which distance fields a terrain type feeds. */
  private static fieldsFor(t: number): string[] {
    return t === T.FAIRWAY ? ['grass'] : t === T.GREEN ? ['grass', 'green'] : t === T.TEE ? ['grass', 'tee'] : t === T.BUNKER ? ['bunker'] : t === T.WATER ? ['water'] : t === T.PATH || t === T.BUILDING ? ['path'] : [];
  }

  /** Coverage -> signed distance for a straight edge blurred by `sigma`: d = sigma * probit(coverage). */
  private static lut(sigma: number, shrink = 0): Uint8Array {
    const id = sigma * 1000 + shrink;
    const cached = Renderer.distLuts.get(id);
    if (cached) return cached;
    // inverse normal CDF (Acklam's rational approximation)
    const probit = (p: number) => {
      const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
      const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
      const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
      const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
      const lo = 0.02425;
      if (p < lo) {
        const q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
      }
      if (p > 1 - lo) {
        const q = Math.sqrt(-2 * Math.log(1 - p));
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
      }
      const q = p - 0.5;
      const r = q * q;
      return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    };
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      const p = Math.max(0.3 / 255, Math.min(1 - 0.3 / 255, v / 255));
      const dist = sigma * probit(p) - shrink;
      lut[v] = Math.max(0, Math.min(255, Math.round(128 + dist * Renderer.ENC)));
    }
    Renderer.distLuts.set(id, lut);
    return lut;
  }

  private buildWarp(w: World) {
    const G = 4;
    this.warpW = w.w * G + 2;
    const wh = w.h * G + 3;
    this.warp = new Float32Array(this.warpW * wh);
    for (let j = 0; j < wh; j++)
      for (let i = 0; i < this.warpW; i++) {
        const tx = i / G;
        const ty = j / G;
        this.warp[j * this.warpW + i] = (vnoise(tx / 2.6, ty / 2.6, 6) - 0.5) * 1.6 + (vnoise(tx / 1.2, ty / 1.2, 7) - 0.5) * 0.5;
      }
  }

  /**
   * Blur the tile mask for one surface and store it as an encoded distance field. With a region (in
   * tiles) only that part is recomputed, so painting a few tiles does not re-blur the whole map.
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
    const has = (x: number, y: number) => inBounds(w, x, y) && pred(w.terrain[y * w.w + x]);
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
    if (key === 'path') {
      // paths drawn as diagonal staircases touch only at corners: bridge those so the walk stays continuous
      for (let y = src.y0; y < src.y1 - 1; y++)
        for (let x = src.x0; x < src.x1 - 1; x++) {
          const a = has(x, y);
          const b = has(x + 1, y);
          const c = has(x, y + 1);
          const d = has(x + 1, y + 1);
          if ((a && d && !b && !c) || (b && c && !a && !d)) {
            sc.beginPath();
            sc.arc((x + 1 - src.x0) * R, (y + 1 - src.y0) * R, R * 0.5, 0, Math.PI * 2);
            sc.fill();
          }
        }
    }
    const [broad, tight] = Renderer.SIGMA[key];
    const blurred = (sigma: number) => {
      const blur = document.createElement('canvas');
      blur.width = sw;
      blur.height = sh;
      const bc = blur.getContext('2d', { willReadFrequently: true })!;
      bc.filter = `blur(${R * sigma}px)`;
      bc.drawImage(cv, 0, 0);
      bc.filter = 'none';
      return bc.getImageData((copy.x0 - src.x0) * R, (copy.y0 - src.y0) * R, (copy.x1 - copy.x0) * R, (copy.y1 - copy.y0) * R).data;
    };
    const cw = (copy.x1 - copy.x0) * R;
    const ch = (copy.y1 - copy.y0) * R;
    const pa = blurred(broad);
    const lutA = Renderer.lut(broad);
    const pb = broad !== tight ? blurred(tight) : null;
    // local amount of surface at a wide scale: small for lone tiles and tiny groups, large next to big shapes
    const pc = pb ? blurred(1) : null;
    const lutB = Renderer.lut(tight, Renderer.SHRINK);
    // Edge wobble: only on contours of broad shapes (where the broad coverage is near one half), so it
    // never erodes a single tile or a thin strip, which are carried by the tight shape.
    const amp = Renderer.WARP[key] * Renderer.ENC;
    const G = 4 / R; // warp cells per field px
    const WW = this.warpW;
    for (let j = 0; j < ch; j++) {
      const fy = copy.y0 * R + j;
      const row = fy * FW + copy.x0 * R;
      const wy = (fy + 0.5) * G;
      const wy0 = wy | 0;
      const wfy = wy - wy0;
      for (let i = 0; i < cw; i++) {
        const o = (j * cw + i) * 4 + 3;
        let a = lutA[pa[o]];
        if (amp) {
          const cov = pa[o] / 255;
          const wt = cov <= 0.26 ? 0 : cov >= 0.44 ? 1 : ((cov - 0.26) / 0.18) ** 2 * (3 - 2 * ((cov - 0.26) / 0.18));
          if (wt > 0) {
            const wx = (copy.x0 * R + i + 0.5) * G;
            const wx0 = wx | 0;
            const wfx = wx - wx0;
            const k0 = wy0 * WW + wx0;
            const p = this.warp[k0] + (this.warp[k0 + 1] - this.warp[k0]) * wfx;
            const q = this.warp[k0 + WW] + (this.warp[k0 + WW + 1] - this.warp[k0 + WW]) * wfx;
            a = Math.max(0, Math.min(255, Math.round(a + (p + (q - p) * wfy) * amp * wt)));
          }
        }
        if (pb && pc) {
          // the tight shape only stands in for features the broad blur would lose (lone tiles, tiny groups);
          // next to a large shape it is pulled in, so it cannot add slivers at the stair-steps of its edge
          const area = pc[o] / 255;
          const t = area <= 0.2 ? 0 : area >= 0.36 ? 1 : (area - 0.2) / 0.16;
          a = Math.max(a, lutB[pb[o]] - t * t * (3 - 2 * t) * 0.4 * Renderer.ENC);
        }
        field[row + i] = a;
      }
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
          else if (near((n) => n !== T.WATER) && h > 0.95) list.push({ x: jx, y: jy, kind: 'rock', v: Math.floor(hash2(x, y, 953) * 2), i });
        } else if (t === T.ROUGH && !w.tree[i]) {
          const edge = near((n) => n !== T.ROUGH && n !== T.PATH && n !== T.BUILDING);
          const wooded = w.tree[i - 1] || w.tree[i + 1] || w.tree[i - w.w] || w.tree[i + w.w];
          const kind = hash2(x, y, 954);
          if (edge) {
            if (h < 0.04) list.push({ x: jx, y: jy, kind: 'shrub', v: Math.floor(kind * 4), i });
            else if (h < 0.055) list.push({ x: jx, y: jy, kind: 'rock', v: Math.floor(kind * 2), i });
            else if (h < 0.07) list.push({ x: jx, y: jy, kind: 'flowers', v: Math.floor(kind * 3), i });
          } else if (wooded) {
            // undergrowth belongs to the woods, not to open lawn
            if (h < 0.05) list.push({ x: jx, y: jy, kind: 'shrub', v: Math.floor(kind * 4), i });
            else if (h < 0.06) list.push({ x: jx, y: jy, kind: 'flowers', v: Math.floor(kind * 3), i });
          } else if (h > 0.996) list.push({ x: jx, y: jy, kind: 'rock', v: Math.floor(kind * 2), i });
        }
      }
    this.decor = list;
  }

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

  // ---- chunk compositor ----
  private layerCv = document.createElement('canvas');
  private maskCv = document.createElement('canvas');
  private maskImg: ImageData | null = null;
  private distBufs = new Map<string, Float32Array>();

  /**
   * Signed distance (tiles, positive inside) for one surface over a chunk plus margin, at terrain
   * resolution (bilinear from the field). Returns null when the surface is nowhere near.
   */
  private chunkDist(key: string, X: number, Y: number, CW: number, CHH: number): DistMap | null {
    const MP = Renderer.MP;
    const ENC = Renderer.ENC;
    const field = this.fields.get(key)!;
    const FW = this.fieldW;
    const FH = this.fieldH;
    const cut = 128 - Renderer.REACH * ENC;
    // quick reject at field resolution
    const fx0 = Math.max(0, Math.floor((X - MP) / 2));
    const fx1 = Math.min(FW, Math.ceil((X + CW + MP) / 2));
    const fy0 = Math.max(0, Math.floor((Y - MP) / 2));
    const fy1 = Math.min(FH, Math.ceil((Y + CHH + MP) / 2));
    let any = false;
    for (let fy = fy0; fy < fy1 && !any; fy++) {
      const row = fy * FW;
      for (let fx = fx0; fx < fx1; fx++)
        if (field[row + fx] > cut) {
          any = true;
          break;
        }
    }
    if (!any) return null;
    const DW = CW + 2 * MP;
    const DH = CHH + 2 * MP;
    let d = this.distBufs.get(key);
    if (!d || d.length !== DW * DH) {
      d = new Float32Array(DW * DH);
      this.distBufs.set(key, d);
    }
    const inv = 1 / ENC;
    const reach = -Renderer.REACH;
    let x0 = DW;
    let y0 = DH;
    let x1 = 0;
    let y1 = 0;
    for (let j = 0; j < DH; j++) {
      const py = Y - MP + j;
      // field pixel centres sit at 2k+1 in terrain px
      const v = Math.max(0, Math.min(FH - 1.001, py / 2 - 0.25));
      const v0 = v | 0;
      const fv = v - v0;
      const ra = v0 * FW;
      const rb = Math.min(FH - 1, v0 + 1) * FW;
      for (let i = 0; i < DW; i++) {
        const px = X - MP + i;
        const u = Math.max(0, Math.min(FW - 1.001, px / 2 - 0.25));
        const u0 = u | 0;
        const fu = u - u0;
        const u1 = u0 + 1 < FW ? u0 + 1 : u0;
        const top = field[ra + u0] + (field[ra + u1] - field[ra + u0]) * fu;
        const bot = field[rb + u0] + (field[rb + u1] - field[rb + u0]) * fu;
        const dist = (top + (bot - top) * fv - 128) * inv;
        d[j * DW + i] = dist;
        if (dist > reach) {
          if (i < x0) x0 = i;
          if (i >= x1) x1 = i + 1;
          if (j < y0) y0 = j;
          if (j >= y1) y1 = j + 1;
        }
      }
    }
    if (x1 <= x0) return null;
    return { d, DW, x0, y0, x1, y1 };
  }

  /**
   * Rasterise an alpha shape over the chunk into the shared mask image, coloured `rgb` with opacity
   * `alpha`. Returns the chunk-local rect that has any coverage, or null.
   */
  private rasterise(D: DistMap, CW: number, CHH: number, shape: Shape, rgb: RGB, alpha: number): Rect | null {
    const MP = Renderer.MP;
    const img = this.maskImg!;
    const px = img.data;
    const i0 = Math.max(D.x0, MP);
    const i1 = Math.min(D.x1, MP + CW);
    const j0 = Math.max(D.y0, MP);
    const j1 = Math.min(D.y1, MP + CHH);
    if (i0 >= i1 || j0 >= j1) return null;
    const [r, g, b] = rgb;
    const k255 = alpha * 255;
    let bx0 = CW;
    let by0 = CHH;
    let bx1 = 0;
    let by1 = 0;
    const d = D.d;
    for (let j = j0; j < j1; j++) {
      let o = ((j - MP) * CW + (i0 - MP)) * 4;
      let k = j * D.DW + i0;
      let rowHit = false;
      for (let i = i0; i < i1; i++, k++, o += 4) {
        const a = shape(d, k);
        if (a > 0.003) {
          px[o] = r;
          px[o + 1] = g;
          px[o + 2] = b;
          px[o + 3] = a * k255;
          if (i - MP < bx0) bx0 = i - MP;
          if (i - MP >= bx1) bx1 = i - MP + 1;
          rowHit = true;
        } else px[o + 3] = 0;
      }
      if (rowHit) {
        if (j - MP < by0) by0 = j - MP;
        by1 = j - MP + 1;
      }
    }
    if (bx1 <= bx0 || by1 <= by0) return null;
    return { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
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
    const t = this.tctx2;
    if (this.layerCv.width !== CW || this.layerCv.height !== CHH) {
      this.layerCv.width = this.maskCv.width = CW;
      this.layerCv.height = this.maskCv.height = CHH;
    }
    if (!this.maskImg || this.maskImg.width !== CW || this.maskImg.height !== CHH) this.maskImg = new ImageData(CW, CHH);
    const lc = this.layerCv.getContext('2d')!;
    const mc = this.maskCv.getContext('2d')!;
    const DW = CW + 2 * Renderer.MP;
    /** index offset for a lookup shifted by (sx, sy) terrain px */
    const off = (sx: number, sy: number) => sy * DW + sx;

    // ---- rough base: broad colour, coarse texture, per-tile tufts
    t.globalCompositeOperation = 'source-over';
    t.globalAlpha = 1;
    this.drawSmooth(t, 'rough', tx0, ty0, tx1, ty1, w);
    t.save();
    t.beginPath();
    t.rect(X, Y, CW, CHH);
    t.clip();
    t.fillStyle = this.turfPattern(t, 'rough');
    t.fillRect(X, Y, CW, CHH);
    for (let y = ty0; y < ty1; y++) for (let x = tx0; x < tx1; x++) if (w.terrain[y * w.w + x] === T.ROUGH) this.roughTufts(t, w, x, y);
    t.restore();

    const flatStamp = (D: DistMap | null, shape: Shape, rgb: RGB, alpha: number) => {
      if (!D) return;
      const r = this.rasterise(D, CW, CHH, shape, rgb, alpha);
      if (!r) return;
      mc.putImageData(this.maskImg!, 0, 0, r.x, r.y, r.w, r.h);
      t.drawImage(this.maskCv, r.x, r.y, r.w, r.h, X + r.x, Y + r.y, r.w, r.h);
    };
    const fillStamp = (D: DistMap | null, shape: Shape, fill: (c: CanvasRenderingContext2D) => void) => {
      if (!D) return;
      const r = this.rasterise(D, CW, CHH, shape, [255, 255, 255], 1);
      if (!r) return;
      mc.putImageData(this.maskImg!, 0, 0, r.x, r.y, r.w, r.h);
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalCompositeOperation = 'source-over';
      lc.globalAlpha = 1;
      lc.clearRect(r.x, r.y, r.w, r.h);
      lc.save();
      lc.beginPath();
      lc.rect(r.x, r.y, r.w, r.h);
      lc.clip();
      lc.setTransform(1, 0, 0, 1, -X, -Y);
      fill(lc);
      lc.restore();
      lc.globalCompositeOperation = 'destination-in';
      lc.drawImage(this.maskCv, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
      lc.globalCompositeOperation = 'source-over';
      t.drawImage(this.layerCv, r.x, r.y, r.w, r.h, X + r.x, Y + r.y, r.w, r.h);
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
    const layers = (...fns: Array<(c: CanvasRenderingContext2D) => void>) => (c: CanvasRenderingContext2D) => fns.forEach((f) => f(c));
    const surface = (cmap: string, kind: TurfKind, stripes?: CanvasPattern) =>
      layers((c) => this.drawSmooth(c, cmap, tx0, ty0, tx1, ty1, w), pat(this.turfPattern(t, kind)), ...(stripes ? [pat(stripes)] : []));

    const dist = (key: string) => this.chunkDist(key, X, Y, CW, CHH);

    // Shapes. `d[k]` is the signed distance at this pixel; shifted lookups read d[k - offset].
    const inside: Shape = (d, k) => aa(d[k], 0);
    const band = (a: number, b: number): Shape => (d, k) => aa(d[k], a) - aa(d[k], b);
    /** darkening just outside an edge, strongest at the edge and fading out over `width` */
    const falloff = (width: number): Shape => (d, k) => {
      const v = d[k];
      return v < -width ? 0 : (1 - aa(v, 0)) * clamp01((v + width) / width);
    };
    /** inner side of a depression that faces away from the sun (-x): `shift` px toward +x, fading over `width` */
    const innerShade = (sx: number, sy: number, width: number, gamma: number): Shape => {
      const o = off(sx, sy);
      return (d, k) => {
        const v = d[k];
        if (v <= -0.03) return 0;
        const s = clamp01(-d[k - o] / width);
        return s > 0 ? aa(v, 0) * Math.pow(s, gamma) : 0;
      };
    };

    // ---- fairway family (fairway, plus the ground under greens and tees)
    const grass = dist('grass');
    flatStamp(grass, falloff(0.1), [14, 50, 26], 0.3);
    fillStamp(grass, inside, surface('grass', 'fairway', this.pattern(t, 'stripe-fw', () => makeStripeTexture(64, 0.075, 'x'))));
    // a fine pale cut line just inside the edge of the mown area
    flatStamp(grass, band(0, 0.045), [216, 242, 156], 0.2);

    // ---- green: fringe collar with its own cut line, crisp perimeter, finest turf
    const green = dist('green');
    if (green) {
      const collar = mix(COL.fairGood, COL.greenGood, 0.45);
      fillStamp(green, band(-0.24, 0), layers(flat(css(collar)), pat(this.turfPattern(t, 'green'))));
      fillStamp(green, inside, surface('green', 'green', this.pattern(t, 'stripe-green', () => makeStripeTexture(32, 0.05, 'y'))));
      flatStamp(green, band(-0.02, 0.025), [22, 82, 38], 0.3);
    }

    // ---- tee box: geometric, tight, with a lit rim
    const tee = dist('tee');
    if (tee) {
      flatStamp(tee, falloff(0.07), [14, 50, 26], 0.32);
      fillStamp(tee, inside, surface('tee', 'tee', this.pattern(t, 'stripe-tee', () => makeStripeTexture(16, 0.05, 'y'))));
      flatStamp(tee, band(0, 0.04), [228, 248, 176], 0.3);
    }

    // ---- worn turf: crisp patches that grow from where condition is lowest
    if (grass) this.wearStamp(w, grass, tx0, ty0, tx1, ty1, X, Y, CW, CHH);

    // ---- bunkers: turf lip, warm sand, crisp edge, shaded inner wall on the side away from the sun
    const bunker = dist('bunker');
    if (bunker) {
      flatStamp(bunker, falloff(0.07), [28, 66, 30], 0.42);
      fillStamp(
        bunker,
        inside,
        layers(
          (c) => {
            this.drawSmooth(c, 'sand', tx0, ty0, tx1, ty1, w);
            pat(this.pattern(c, 'sand', () => makeSandTexture()))(c);
          },
        ),
      );
      flatStamp(bunker, innerShade(10, 4, 0.32, 1.15), [150, 108, 60], 0.62);
      flatStamp(bunker, innerShade(-6, -2, 0.18, 1), [255, 251, 234], 0.45);
      flatStamp(bunker, band(-0.005, 0.03), [122, 88, 46], 0.55);
    }

    // ---- water: wet bank, a thin pale shoreline, depth from the colour map, bank shadow on the sun side
    const water = dist('water');
    if (water) {
      flatStamp(water, falloff(0.11), [58, 74, 38], 0.45);
      flatStamp(water, band(-0.035, 0.005), [204, 198, 150], 0.7);
      fillStamp(
        water,
        inside,
        layers(
          (c) => {
            this.drawSmooth(c, 'water', tx0, ty0, tx1, ty1, w);
            pat(this.pattern(c, 'water', () => makeWaterTexture()))(c);
          },
          (c) => {
            for (let y = ty0; y < ty1; y++) for (let x = tx0; x < tx1; x++) if (w.terrain[y * w.w + x] === T.WATER) this.waterDetail(c, w, x, y);
          },
        ),
      );
      flatStamp(water, (d, k) => aa(d[k], 0) * clamp01(1 - d[k] / 0.18), [156, 228, 216], 0.26);
      flatStamp(water, innerShade(7, 3, 0.22, 1.2), [10, 46, 72], 0.4);
    }

    // ---- paths and paving: contact shadow, flagstones at a fixed scale, a kerb of constant width
    const path = dist('path');
    if (path) {
      flatStamp(path, falloff(0.06), [24, 40, 22], 0.32);
      fillStamp(path, inside, pat(this.pattern(t, 'paving', () => makePavingTexture(COL.path))));
      flatStamp(path, band(0, 0.07), mix(COL.path, [70, 62, 50], 0.38), 0.9);
      flatStamp(path, band(0.07, 0.095), [255, 250, 236], 0.28);
    }
  }

  /**
   * Worn turf as localized damage: per-tile wear is interpolated smoothly, compared against a patch noise,
   * and drawn as thin yellowed turf with bare earth at the core. Healthy turf gets nothing at all.
   */
  private wearStamp(w: World, grass: DistMap, tx0: number, ty0: number, tx1: number, ty1: number, X: number, Y: number, CW: number, CHH: number) {
    const gw = tx1 - tx0 + 2;
    const gh = ty1 - ty0 + 2;
    const wear = new Float32Array(gw * gh);
    let any = false;
    for (let y = ty0 - 1; y <= ty1; y++)
      for (let x = tx0 - 1; x <= tx1; x++) {
        if (!inBounds(w, x, y)) continue;
        const i = y * w.w + x;
        const t = w.terrain[i];
        if (t !== T.FAIRWAY && t !== T.GREEN && t !== T.TEE) continue;
        const v = Math.max(0, Math.min(1, (58 - w.cond[i]) / 46));
        wear[(y - ty0 + 1) * gw + (x - tx0 + 1)] = v;
        if (v > 0) any = true;
      }
    if (!any) return;
    const MP = Renderer.MP;
    const img = this.maskImg!;
    const px = img.data;
    const noise = this.wearNoise;
    const thin = COL.fairWorn;
    const dirt = mix(COL.dirt, COL.fairWorn, 0.3);
    const d = grass.d;
    let bx0 = CW;
    let by0 = CHH;
    let bx1 = 0;
    let by1 = 0;
    for (let j = 0; j < CHH; j++) {
      // tile-centre interpolation: wear fades out halfway into healthy neighbours
      const gy = (j + 0.5) / TS + 0.5;
      const gy0 = Math.min(gh - 2, gy | 0);
      const fy = gy - gy0;
      for (let i = 0; i < CW; i++) {
        const o = (j * CW + i) * 4;
        const gx = (i + 0.5) / TS + 0.5;
        const gx0 = Math.min(gw - 2, gx | 0);
        const fx = gx - gx0;
        const a = wear[gy0 * gw + gx0];
        const b = wear[gy0 * gw + gx0 + 1];
        const c = wear[(gy0 + 1) * gw + gx0];
        const e = wear[(gy0 + 1) * gw + gx0 + 1];
        const lv = a + (b - a) * fx + (c - a) * fy + (a - b - c + e) * fx * fy;
        if (lv <= 0.01) {
          px[o + 3] = 0;
          continue;
        }
        const n = noise[((Y + j) & 127) * 128 + ((X + i) & 127)];
        const L = lv * 1.15;
        const cover = aa(d[(j + MP) * grass.DW + i + MP], 0.04);
        const fade = Math.min(1, lv * 6);
        const a1 = clamp01((L + 0.05 - n) * 8) * 0.42 * fade * cover;
        const a2 = clamp01((L - 0.35 - n) * 10) * 0.72 * fade * cover;
        const oa = a2 + a1 * (1 - a2);
        if (oa < 0.004) {
          px[o + 3] = 0;
          continue;
        }
        const k1 = (a1 * (1 - a2)) / oa;
        const k2 = a2 / oa;
        px[o] = thin[0] * k1 + dirt[0] * k2;
        px[o + 1] = thin[1] * k1 + dirt[1] * k2;
        px[o + 2] = thin[2] * k1 + dirt[2] * k2;
        px[o + 3] = oa * 255;
        if (i < bx0) bx0 = i;
        if (i >= bx1) bx1 = i + 1;
        if (j < by0) by0 = j;
        by1 = j + 1;
      }
    }
    if (bx1 <= bx0) return;
    const mc = this.maskCv.getContext('2d')!;
    mc.putImageData(img, 0, 0, bx0, by0, bx1 - bx0, by1 - by0);
    this.tctx2.drawImage(this.maskCv, bx0, by0, bx1 - bx0, by1 - by0, X + bx0, Y + by0, bx1 - bx0, by1 - by0);
  }

  /** Occasional lily pads on open water, painted flat into the terrain. */
  private waterDetail(c: CanvasRenderingContext2D, w: World, x: number, y: number) {
    if (hash2(x, y, 930) > 0.06) return;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (!inBounds(w, x + dx, y + dy) || w.terrain[(y + dy) * w.w + x + dx] !== T.WATER) return;
    const n = 1 + Math.floor(hash2(x, y, 931) * 3);
    const cx = x * TS + 8 + hash2(x, y, 932) * 16;
    const cy = y * TS + 8 + hash2(x, y, 933) * 16;
    for (let k = 0; k < n; k++) paintLilyPad(c, cx + (hash2(x, y, 934 + k) - 0.5) * 12, cy + (hash2(x, y, 938 + k) - 0.5) * 9, 4 + hash2(x, y, 942 + k) * 2.5, x * 7 + y * 13 + k);
  }

  /** A few coarse grass tufts per rough tile; overgrown rough grows taller, paler seed heads. */
  private roughTufts(c: CanvasRenderingContext2D, w: World, x: number, y: number) {
    const cond = w.cond[y * w.w + x];
    const px = x * TS;
    const py = y * TS;
    const tall = cond < 40;
    const n = tall ? 4 : 2;
    c.lineWidth = 1.1;
    c.lineCap = 'round';
    for (let k = 0; k < n; k++) {
      const bx = px + 3 + hash2(x, y, 140 + k) * (TS - 6);
      const by = py + 3 + hash2(x, y, 150 + k) * (TS - 6);
      const len = tall ? 4 + hash2(x, y, 170 + k) * 3 : 2.5 + hash2(x, y, 170 + k) * 1.5;
      // shaded blades lean away from the sun (+x), a lit blade toward it
      c.strokeStyle = tall ? 'rgba(150,150,86,0.42)' : 'rgba(20,70,34,0.4)';
      c.beginPath();
      c.moveTo(bx, by);
      c.lineTo(bx - len * 0.4, by - len);
      c.moveTo(bx, by);
      c.lineTo(bx - len * 0.7, by - len * 0.7);
      c.stroke();
      c.strokeStyle = tall ? 'rgba(206,196,128,0.38)' : 'rgba(132,186,96,0.3)';
      c.beginPath();
      c.moveTo(bx, by);
      c.lineTo(bx - len * 0.95, by - len * 0.35);
      c.stroke();
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
    // magnified ground uses cubic filtering so anti-aliased contours stay smooth instead of showing the pixel grid
    ctx.imageSmoothingQuality = 'low';
    // Only the ground is projected. Trees, people, roofs and signs stay upright.
    ctx.save(); ctx.transform(ISO_X * z, ISO_Y * z, -ISO_X * z, ISO_Y * z, o.x, o.y); ctx.drawImage(this.terr, 0, 0); ctx.restore();
    ctx.imageSmoothingQuality = 'low';
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
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w.w + x;
        if (!w.tree[i]) continue;
        const hh = hash2(x, y, 400);
        const variant = this.treeVariant(game, x, y, i, hh);
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

  // Tree species are chosen from low-frequency noise so neighbouring trees share a species and woods read
  // as stands (oak wood, pine belt, birch grove) rather than confetti. Accent species are placed on purpose:
  // blossom only near the clubhouse and tees, red maples as rare small groups. Only the per-tile health
  // (dry or dead trees on neglected ground) is read live; the species itself is cached per world version.
  private species = new Int8Array(0);
  private speciesFor: World | null = null;
  private speciesVersion = -1;

  private treeSpecies(game: Game, x: number, y: number, i: number): number {
    const w = game.world;
    if (this.speciesFor !== w || this.speciesVersion !== w.version || this.species.length !== w.terrain.length) {
      this.speciesFor = w;
      this.speciesVersion = w.version;
      if (this.species.length !== w.terrain.length) this.species = new Int8Array(w.terrain.length);
      this.species.fill(-1);
    }
    if (this.species[i] >= 0) return this.species[i];
    const wts = REGIONS[w.region].trees;
    const sum = wts.reduce((a, b) => a + b, 0) || 1;
    // value noise clusters around 0.5: stretch and wrap it so each species gets its share of stands
    const n = vnoise(x / 7, y / 7, 410);
    let r = (((n - 0.5) * 2.6 + 0.5 + (hash2(x, y, 401) - 0.5) * 0.12) % 1 + 1) % 1;
    r *= sum;
    let v = 0;
    for (let k = 0; k < wts.length; k++) if ((r -= wts[k]) <= 0) { v = k; break; }
    if (v === 0 && game.region !== 'desert') {
      const hh = hash2(x, y, 402);
      const club = Math.hypot(x - 8, y - 43);
      let nearTee = 99;
      for (const h of w.holes) nearTee = Math.min(nearTee, Math.hypot(x - h.tee.x, y - h.tee.y));
      if ((club < 14 || nearTee < 5) && hh > 0.62) v = 7; // ornamental blossom framing the clubhouse and tees
      else if (vnoise(x / 5, y / 5, 420) > 0.66) v = 8; // birch groves
      else if (vnoise(x / 4, y / 4, 430) > 0.74 && hh > 0.55) v = 9; // a few maples together
    }
    this.species[i] = v;
    return v;
  }

  private treeVariant(game: Game, x: number, y: number, i: number, hh: number): number {
    const w = game.world;
    const cond = w.cond[i];
    // neglected ground: some trees dead, more of them dry, both following the overgrown patches
    if (cond < 24 && hh < 0.16) return 3;
    if (cond < 32 && hh < 0.34) return 4;
    const v = this.treeSpecies(game, x, y, i);
    // autumn turns whole stands of broadleaves, not single trees
    if (game.season.index === 2 && (v === 0 || v === 8) && vnoise(x / 6, y / 6, 440) > 0.5) return 4;
    return v;
  }

  private drawTree(x: number, y: number, v: number, hh: number) {
    const ctx = this.ctx;
    const ts = this.ts;
    const p = this.toScreen(x + 0.5, y + 0.5);
    const size = ts * (1.5 + hh * 0.55);
    const s = size / TREE_W;
    // sun is upper left: the cast shadow stretches toward the lower right, with a tight contact shadow at the trunk
    const reach = v === 2 ? 1.05 : v === 6 ? 0.5 : 0.85;
    const k = s * reach;
    ctx.drawImage(this.treeShadow, p.x - SHADOW_AX * k, p.y - SHADOW_AY * k, SHADOW_W * k, SHADOW_H * k);
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


