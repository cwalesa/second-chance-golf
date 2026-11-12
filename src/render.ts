import { ISO_X, ISO_Y, projectGround, unprojectGround } from './isometric';
import { drawClubGround, drawCountryClub, drawVillageAmenities } from './classic-art';
import { makeDeckTexture, makePavingTexture, makeSandTexture, makeStripeTexture, makeTurfTexture, makeWaterTexture, makeWearNoise, TurfKind } from './art/textures';
import { paintLilyPad, makeShrub, makeRock, makeFlowers, makeReeds, makeBench, makeBallWasher, makeGlint, makeLamp, makeFountain, makeStatue, Sprite } from './art/props';
import { makeTree, makeTreeShadow, SHADOW_AX, SHADOW_AY, SHADOW_H, SHADOW_W, TREE_BASE, TREE_H, TREE_VARIANTS, TREE_W } from './art/trees';
import { CFG } from './config';
import { Game } from './game';
import { Golfer } from './sim';
import { CLUB_H, CLUB_W, Pt, T, World, center, hash2, holePath, inBounds, vnoise } from './terrain';
import { reliefAt, clubLot } from './wilderness';
import type { Painter } from './art/buildings';
import { ToolId } from './editing';
import { Palette, REGIONS, RGB } from './progression';

interface Decor { x: number; y: number; kind: 'shrub' | 'rock' | 'flowers' | 'reeds'; v: number; i: number }
/** Signed distance to a surface contour (tiles, positive inside) over one chunk plus margin; x0..y1 bound where it matters. */
interface DistMap { d: Float32Array; DW: number; x0: number; y0: number; x1: number; y1: number }
/** Coverage 0..1 at index `k` of a distance map. */
type Shape = (d: Float32Array, k: number) => number;
interface Rect { x: number; y: number; w: number; h: number }

/** Top-left tile the clubhouse art in art/buildings.ts was drawn for; everything is shifted from here to the real spot. */
const CLUB_ART_ORIGIN = { x: 3, y: 41 };

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
  ghost: { tee?: Pt; cup?: Pt; bend?: Pt; bends?: Pt[]; /** whole route as tile corners, tee to cup */ route?: Pt[]; par: number; notes?: string[] } | null;
  /** The clubhouse the player is about to place, with the reason it cannot stand there (null = fine). */
  club: { x: number; y: number; problem: string | null } | null;
  /** Where the tutorial suggests putting a tee and a green. */
  hint: { tee?: Pt; cup?: Pt } | null;
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  tctx2: CanvasRenderingContext2D; // the page context the chunk compositor is currently drawing into
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
  private placed: Record<string, Sprite> | null = null;
  private bench = makeBench();
  private washer = makeBallWasher();
  private decor: Decor[] = [];
  private builtFor: World | null = null;
  private regionKey = '';
  private cmaps: Record<string, HTMLCanvasElement> = {};

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.tctx2 = this.pageFor(0, 0).ctx;
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
    const want = Math.min(3, window.devicePixelRatio || 1);
    // keep the backing store under ~4.2M pixels (iPhone Pro Max at 3x is about 3.9M)
    this.dpr = Math.max(1, Math.min(want, Math.sqrt(4.2e6 / Math.max(1, r.width * r.height))));
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
    this.cam.zoom = Math.max(Renderer.MIN_ZOOM, Math.min(Renderer.MAX_ZOOM, this.cam.zoom * factor));
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
    const zoom = Math.max(Renderer.MIN_ZOOM, Math.min((this.cw - this.insets.l - this.insets.r - 40) / ((right + bottom) * TS * ISO_X), (this.ch - this.insets.t - this.insets.b - 40) / ((right + bottom) * TS * ISO_Y)));
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
  static readonly MIN_ZOOM = 0.12;
  /** Closer than this and the ground texture would look soft on a 3x screen. */
  static readonly MAX_ZOOM = 2.0;
  /** Milliseconds per frame the ground builder may spend on unbuilt chunks. */
  frameBudget = 10;
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
      this.pages.clear();
      this.queue.length = 0;
      this.dirtyChunks.clear();
      this.buildWarp(w);
      this.fieldW = w.w * Renderer.R;
      this.fieldH = w.h * Renderer.R;
      for (const key of Object.keys(Renderer.FIELD_PRED)) this.fields.set(key, new Uint8Array(this.fieldW * this.fieldH));
      const n = Math.ceil(w.w / Renderer.CH) * Math.ceil(w.h / Renderer.CH);
      this.fieldReady = new Uint8Array(n);
      this.built = new Uint8Array(n);
      this.buildColorMaps(w);
      this.buildDecor(w);
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
        this.invalidateFields(w, region);
        this.buildDecor(w);
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
    // Valleys and ridges: low ground is deeper green, high ground is sunnier, and slopes facing the light are brighter.
    const seed = w.landSeed;
    const lit = (c: RGB, x: number, y: number, k: number): RGB => {
      if (!seed) return c;
      const r = reliefAt(seed, x, y, w);
      const slope = reliefAt(seed, x - 1, y, w) - reliefAt(seed, x + 1, y, w) + reliefAt(seed, x, y - 1, w) - reliefAt(seed, x, y + 1, w);
      const j = ((r - 0.5) * 46 + slope * 120) * k;
      return [c[0] + j * 1.05, c[1] + j * 0.9, c[2] + j * 0.45 - (0.5 - r) * 14 * k];
    };
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
    mk('rough', (x, y) => lit(add(mix(COL.roughGood, COL.roughBad, 0.75 * (1 - Math.max(0, Math.min(1, (roughCond(x, y) - 8) / 56)))), jit(x, y)), x, y, 1));
    // broad wear only tints a little; the actual damage is drawn as crisp patches (see wearStamp)
    // tiles off the fairway borrow their fairway neighbours' wear, so a worn fairway has no fresh-looking rim
    const fairWear = (x: number, y: number, i: number) => {
      if (w.terrain[i] === T.FAIRWAY) return wearOf(w.cond[i]);
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!inBounds(w, x + dx, y + dy)) continue;
          const j = (y + dy) * w.w + x + dx;
          if (w.terrain[j] !== T.FAIRWAY) continue;
          s += wearOf(w.cond[j]);
          n++;
        }
      return n ? s / n : 0;
    };
    mk('grass', (x, y, i) => lit(add(mix(COL.fairGood, COL.fairWorn, fairWear(x, y, i) * 0.45), jit(x, y)), x, y, 0.55));
    mk('green', (x, y, i) => lit(add(w.terrain[i] === T.GREEN ? mix(COL.greenGood, COL.greenWorn, wearOf(w.cond[i]) * 0.4) : COL.greenGood, jit(x, y) * 0.4), x, y, 0.4));
    mk('tee', (x, y, i) => lit(add(w.terrain[i] === T.TEE ? mix(COL.teeGood, COL.fairWorn, wearOf(w.cond[i]) * 0.4) : COL.teeGood, jit(x, y) * 0.4), x, y, 0.4));
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
    bridge: [0.3, 0.3],
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
    water: (t) => t === T.WATER || t === T.BRIDGE, // the water runs on beneath a bridge
    bridge: (t) => t === T.BRIDGE,
    path: (t) => t === T.PATH || t === T.BUILDING,
  };
  /** How far each surface's contour may wander, in tiles. Tees and paving stay geometric. */
  private static readonly WARP: Record<string, number> = { grass: 0.2, green: 0.12, tee: 0, bunker: 0.18, water: 0.22, bridge: 0, path: 0 };

  /** Which distance fields a terrain type feeds. */
  private static fieldsFor(t: number): string[] {
    return t === T.FAIRWAY ? ['grass'] : t === T.GREEN ? ['grass', 'green'] : t === T.TEE ? ['grass', 'tee'] : t === T.BUNKER ? ['bunker'] : t === T.WATER ? ['water'] : t === T.BRIDGE ? ['bridge', 'water'] : t === T.PATH || t === T.BUILDING ? ['path'] : [];
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
    // The blur is done here in plain code, not with the canvas `filter`: Safari on iPhone ignores that
    // filter, which left every surface with hard, square, tile-shaped edges.
    const srcAlpha = (() => {
      const rgba = sc.getImageData(0, 0, sw, sh).data;
      const al = new Float32Array(sw * sh);
      for (let k = 0; k < al.length; k++) al[k] = rgba[k * 4 + 3];
      return al;
    })();
    const blurred = (sigma: number) => {
      const out = gaussBlur(srcAlpha, sw, sh, R * sigma);
      const ox = (copy.x0 - src.x0) * R;
      const oy = (copy.y0 - src.y0) * R;
      const cw2 = (copy.x1 - copy.x0) * R;
      const ch2 = (copy.y1 - copy.y0) * R;
      const alpha = new Uint8Array(cw2 * ch2);
      for (let j = 0; j < ch2; j++) {
        const row = (oy + j) * sw + ox;
        for (let i = 0; i < cw2; i++) alpha[j * cw2 + i] = Math.max(0, Math.min(255, Math.round(out[row + i])));
      }
      return alpha;
    };
    const cw = (copy.x1 - copy.x0) * R;
    const ch = (copy.y1 - copy.y0) * R;
    const pa = blurred(broad);
    const lutA = Renderer.lut(broad);
    const pb = broad !== tight ? blurred(tight) : null;
    // local amount of surface at a wide scale: small for lone tiles and tiny groups, large next to big shapes
    const pc = pb ? blurred(1) : null;
    cv.width = cv.height = 0;
    const lutB = Renderer.lut(tight, Renderer.SHRINK);
    const lutT = Renderer.lut(tight);
    // accuracy guard: however much the broad shape is smoothed or wobbled, it stays within a fixed band
    // around the tile-accurate tight shape (no bleeding into neighbouring tiles, no eaten corners)
    const over = 0.22 * Renderer.ENC;
    const under = 0.3 * Renderer.ENC;
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
        const o = j * cw + i;
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
        if (pb) {
          const exact = lutT[pb[o]];
          a = Math.min(Math.max(a, exact - under), exact + over);
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

  /** Fields are computed per chunk, on demand. An edit only has to mark the chunks it can reach as stale. */
  private fieldReady = new Uint8Array(0);
  private built = new Uint8Array(0);
  private queue: number[] = [];
  private chunksX(w: World) {
    return Math.ceil(w.w / Renderer.CH);
  }
  private invalidateFields(w: World, region: { x0: number; y0: number; x1: number; y1: number }) {
    const C = Renderer.CH;
    const cx0 = Math.max(0, Math.floor((region.x0 - 5) / C));
    const cy0 = Math.max(0, Math.floor((region.y0 - 5) / C));
    const cx1 = Math.min(this.chunksX(w) - 1, Math.floor((region.x1 + 5) / C));
    const cy1 = Math.min(Math.ceil(w.h / C) - 1, Math.floor((region.y1 + 5) / C));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) this.fieldReady[cy * this.chunksX(w) + cx] = 0;
  }
  /** Distance fields for one chunk (plus margin). Surfaces that are nowhere near are zero-filled instead of blurred. */
  private ensureFields(w: World, cx: number, cy: number) {
    const C = Renderer.CH;
    const ci = cy * this.chunksX(w) + cx;
    if (this.fieldReady[ci]) return;
    const region = { x0: cx * C, y0: cy * C, x1: Math.min(w.w, (cx + 1) * C), y1: Math.min(w.h, (cy + 1) * C) };
    const reach = { x0: Math.max(0, region.x0 - 5), y0: Math.max(0, region.y0 - 5), x1: Math.min(w.w, region.x1 + 5), y1: Math.min(w.h, region.y1 + 5) };
    const R = Renderer.R;
    for (const key of Object.keys(Renderer.FIELD_PRED)) {
      const pred = Renderer.FIELD_PRED[key];
      let near = false;
      for (let y = reach.y0; y < reach.y1 && !near; y++) for (let x = reach.x0; x < reach.x1; x++) if (pred(w.terrain[y * w.w + x])) { near = true; break; }
      if (near) this.updateField(w, key, region);
      else {
        const f = this.fields.get(key)!;
        const c = { x0: Math.max(0, region.x0 - 2), y0: Math.max(0, region.y0 - 2), x1: Math.min(w.w, region.x1 + 2), y1: Math.min(w.h, region.y1 + 2) };
        for (let fy = c.y0 * R; fy < c.y1 * R; fy++) f.fill(0, fy * this.fieldW + c.x0 * R, fy * this.fieldW + c.x1 * R);
      }
    }
    this.fieldReady[ci] = 1;
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
  // The composed ground lives in fixed-size pages instead of one map-sized canvas: a 240x160 map would be
  // 7680x5120 px, past what phones allow. Each page's context is translated so chunk code keeps using
  // whole-map terrain pixel coordinates. Only pages near the screen stay resident (MAX_PAGES), and a page is
  // filled chunk by chunk, nearest the screen centre first, so nothing stalls a frame.
  private static readonly PAGE = 32; // tiles per page side
  private static readonly MAX_PAGES = 14;
  private pages = new Map<number, { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D; used: number }>();
  private frameNo = 0;
  private pageFor(px: number, py: number) {
    const key = py * 1000 + px;
    let pg = this.pages.get(key);
    if (!pg) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = Renderer.PAGE * TS;
      const ctx = cv.getContext('2d')!;
      ctx.translate(-px * Renderer.PAGE * TS, -py * Renderer.PAGE * TS);
      pg = { cv, ctx, used: this.frameNo };
      this.pages.set(key, pg);
    }
    return pg;
  }
  private pageOfChunk(cx: number, cy: number) {
    const per = Renderer.PAGE / Renderer.CH;
    return { px: Math.floor(cx / per), py: Math.floor(cy / per) };
  }
  /** Drop the pages furthest from the screen once too many are resident. */
  private evictPages(w: World, visible: Set<number>) {
    if (this.pages.size <= Renderer.MAX_PAGES) return;
    const per = Renderer.PAGE / Renderer.CH;
    const cx = this.chunksX(w);
    const old = [...this.pages.entries()].filter(([k]) => !visible.has(k)).sort((a, b) => a[1].used - b[1].used);
    for (const [key, pg] of old) {
      if (this.pages.size <= Renderer.MAX_PAGES) break;
      pg.cv.width = pg.cv.height = 0;
      this.pages.delete(key);
      const px = key % 1000;
      const py = Math.floor(key / 1000);
      for (let y = py * per; y < (py + 1) * per && y * Renderer.CH < w.h; y++) for (let x = px * per; x < (px + 1) * per && x * Renderer.CH < w.w; x++) this.built[y * cx + x] = 0;
    }
  }
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

  /** Pages the screen can see, as keys. */
  private visiblePages(w: World): number[] {
    const P = Renderer.PAGE;
    const corners = [[0, 0], [this.cw, 0], [0, this.ch], [this.cw, this.ch]].map(([x, y]) => this.toWorld(x, y));
    const px0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x)) / P));
    const py0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y)) / P));
    const px1 = Math.min(Math.ceil(w.w / P) - 1, Math.floor(Math.max(...corners.map((p) => p.x)) / P));
    const py1 = Math.min(Math.ceil(w.h / P) - 1, Math.floor(Math.max(...corners.map((p) => p.y)) / P));
    const out: number[] = [];
    for (let py = py0; py <= py1; py++) for (let px = px0; px <= px1; px++) out.push(py * 1000 + px);
    return out;
  }

  /** Queue the unbuilt chunks of visible pages, then build the ones nearest the screen centre within a time budget. */
  private pumpChunks(w: World, visible: number[], budgetMs: number) {
    this.frameNo++;
    const per = Renderer.PAGE / Renderer.CH;
    const cxN = this.chunksX(w);
    const vis = new Set(visible);
    for (const key of visible) {
      const px = key % 1000;
      const py = Math.floor(key / 1000);
      this.pageFor(px, py).used = this.frameNo;
      for (let cy = py * per; cy < (py + 1) * per && cy * Renderer.CH < w.h; cy++)
        for (let cx = px * per; cx < (px + 1) * per && cx * Renderer.CH < w.w; cx++) {
          const ci = cy * cxN + cx;
          if (!this.built[ci] && !this.queue.includes(ci)) this.queue.push(ci);
        }
    }
    this.evictPages(w, vis);
    if (!this.queue.length) return;
    const c = this.toWorld(this.cw / 2, this.ch / 2);
    const mid = (ci: number) => Math.hypot(((ci % cxN) + 0.5) * Renderer.CH - c.x, (Math.floor(ci / cxN) + 0.5) * Renderer.CH - c.y);
    const t0 = performance.now();
    let did = false;
    while (this.queue.length && (performance.now() - t0 < budgetMs || !did)) {
      let bi = 0;
      for (let k = 1; k < this.queue.length; k++) if (mid(this.queue[k]) < mid(this.queue[bi])) bi = k;
      const ci = this.queue.splice(bi, 1)[0];
      const cx = ci % cxN;
      const cy = Math.floor(ci / cxN);
      const pg = this.pageOfChunk(cx, cy);
      if (!vis.has(pg.py * 1000 + pg.px)) continue;
      did = true;
      this.ensureFields(w, cx, cy);
      this.composeChunk(w, cx, cy);
      this.built[ci] = 1;
    }
  }

  /** Draw the ground pages that touch the screen, in the already-projected transform. */
  private drawPages(visible: number[]) {
    const P = Renderer.PAGE;
    for (const key of visible) {
      const px = key % 1000;
      const py = Math.floor(key / 1000);
      this.ctx.drawImage(this.pageFor(px, py).cv, px * P * TS, py * P * TS);
    }
  }

  // Zoomed far out, individual surfaces are too small to read: one flat-colour tile map stands in for the
  // detailed ground, and trees and props are skipped. It is one pixel per tile, rebuilt when the world changes.
  private static readonly OVERVIEW_ZOOM = 0.3;
  private ovCv = document.createElement('canvas');
  private ovBig = document.createElement('canvas');
  private static readonly OV_SCALE = 6;
  private ovVersion = -1;
  private ovFor: World | null = null;
  private ovAt = 0;
  private drawOverview(w: World) {
    const now = performance.now();
    if (this.ovFor !== w || (this.ovVersion !== w.version && now - this.ovAt > 400)) {
      this.ovFor = w;
      this.ovVersion = w.version;
      this.ovAt = now;
      if (this.ovCv.width !== w.w) { this.ovCv.width = w.w; this.ovCv.height = w.h; }
      const c = this.ovCv.getContext('2d')!;
      const img = c.createImageData(w.w, w.h);
      const pal: RGB[] = [COL.roughGood, COL.fairGood, COL.greenGood, COL.teeGood, COL.sand, COL.water, COL.path, [150, 138, 112], [150, 112, 72]];
      const canopy: RGB = [42, 92, 56];
      for (let i = 0; i < w.terrain.length; i++) {
        let col = pal[w.terrain[i]] ?? COL.roughGood;
        if (w.tree[i]) col = mix(col, canopy, 0.3);
        else if (w.terrain[i] === T.ROUGH) col = mix(col, COL.roughBad, 0.25 * (1 - Math.min(1, w.cond[i] / 70)));
        img.data[i * 4] = col[0];
        img.data[i * 4 + 1] = col[1];
        img.data[i * 4 + 2] = col[2];
        img.data[i * 4 + 3] = 255;
      }
      c.putImageData(img, 0, 0);
      // A finer picture on top of the tile colours: soft surface edges and a rounded crown for every tree,
      // so the far view reads as a painted map and not as blurred squares.
      const S = Renderer.OV_SCALE;
      if (this.ovBig.width !== w.w * S) { this.ovBig.width = w.w * S; this.ovBig.height = w.h * S; }
      const b = this.ovBig.getContext('2d')!;
      b.imageSmoothingEnabled = true;
      b.imageSmoothingQuality = 'high';
      b.drawImage(this.ovCv, 0, 0, w.w * S, w.h * S);
      const crowns: RGB[] = [[58, 122, 62], [74, 140, 66], [46, 104, 62], [88, 150, 70]];
      b.fillStyle = 'rgba(20,50,30,0.35)';
      for (let i = 0; i < w.terrain.length; i++) {
        if (!w.tree[i]) continue;
        const x = i % w.w, y = (i - x) / w.w;
        b.beginPath();
        b.arc((x + 0.3 + hash2(x, y, 71) * 0.4 + 0.22) * S, (y + 0.3 + hash2(x, y, 72) * 0.4 + 0.22) * S, S * 0.5, 0, Math.PI * 2);
        b.fill();
      }
      for (let i = 0; i < w.terrain.length; i++) {
        if (!w.tree[i]) continue;
        const x = i % w.w, y = (i - x) / w.w;
        const cxp = (x + 0.3 + hash2(x, y, 71) * 0.4) * S, cyp = (y + 0.3 + hash2(x, y, 72) * 0.4) * S;
        const col = crowns[Math.floor(hash2(x, y, 73) * crowns.length)];
        b.fillStyle = css(col);
        b.beginPath();
        b.arc(cxp, cyp, S * (0.42 + hash2(x, y, 74) * 0.14), 0, Math.PI * 2);
        b.fill();
        b.fillStyle = css(mix(col, [200, 230, 130], 0.35));
        b.beginPath();
        b.arc(cxp - S * 0.12, cyp - S * 0.12, S * 0.2, 0, Math.PI * 2);
        b.fill();
      }
    }
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'medium';
    this.ctx.drawImage(this.ovBig, 0, 0, w.w * TS, w.h * TS);
  }

  /** Compose the chunks an edit touched. Chunks on pages that are not resident are simply marked unbuilt. */
  compose(w: World) {
    const cxN = this.chunksX(w);
    const per = Renderer.PAGE / Renderer.CH;
    this.buildColorMaps(w);
    for (const key of this.dirtyChunks) {
      const cx = key % 1000;
      const cy = Math.floor(key / 1000);
      const ci = cy * cxN + cx;
      if (this.pages.has(Math.floor(cy / per) * 1000 + Math.floor(cx / per)) && this.built[ci]) {
        this.ensureFields(w, cx, cy);
        this.composeChunk(w, cx, cy);
      } else this.built[ci] = 0;
    }
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
    this.tctx2 = this.pageFor(Math.floor(tx0 / Renderer.PAGE), Math.floor(ty0 / Renderer.PAGE)).ctx;
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
      fillStamp(tee, inside, layers(flat(css(COL.teeGood)), pat(this.turfPattern(t, 'tee')), pat(this.pattern(t, 'stripe-tee', () => makeStripeTexture(16, 0.05, 'y')))));
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
          // solid sand colour first (no colour map), then an opaque grain: nothing here can come out blank
          flat(css(COL.sand)),
          pat(this.pattern(t, 'sand-' + css(COL.sand), () => makeSandTexture(128, COL.sand))),
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

    // ---- bridges: a plank deck over the water with a shadow below and a rail along each edge
    const bridge = dist('bridge');
    if (bridge) {
      flatStamp(bridge, falloff(0.1), [10, 30, 44], 0.45);
      fillStamp(bridge, inside, pat(this.pattern(t, 'deck', () => makeDeckTexture())));
      flatStamp(bridge, band(0, 0.12), [58, 38, 18], 0.95);
      flatStamp(bridge, band(0.12, 0.17), [236, 208, 160], 0.35);
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
    // cells off the turf borrow their turf neighbours' wear, so worn turf stays worn right up to its edge
    const own = wear.slice();
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        const x = tx0 - 1 + gx;
        const y = ty0 - 1 + gy;
        if (inBounds(w, x, y)) {
          const t = w.terrain[y * w.w + x];
          if (t === T.FAIRWAY || t === T.GREEN || t === T.TEE) continue;
        }
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = gx + dx;
            const ny = gy + dy;
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
            const xx = x + dx;
            const yy = y + dy;
            if (!inBounds(w, xx, yy)) continue;
            const t = w.terrain[yy * w.w + xx];
            if (t !== T.FAIRWAY && t !== T.GREEN && t !== T.TEE) continue;
            sum += own[ny * gw + nx];
            n++;
          }
        wear[gy * gw + gx] = n ? sum / n : 0;
      }
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
    const far = z < Renderer.OVERVIEW_ZOOM;
    ctx.save();
    ctx.transform(ISO_X * z, ISO_Y * z, -ISO_X * z, ISO_Y * z, o.x, o.y);
    if (far) this.drawOverview(w);
    else {
      const visible = this.visiblePages(w);
      this.pumpChunks(w, visible, this.frameBudget);
      this.drawPages(visible);
    }
    ctx.restore();
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
    if (!far) for (let y = y0; y <= y1; y++)
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
    const club = game.world.clubhouse;
    if (club && this.nearScreen(club.x + 4, club.y + 3, 16)) drawClubGround(this.clubPainter(club), game);

    // y-sorted: trees + golfers
    type Item = { y: number; draw: () => void };
    const items: Item[] = club
      ? [
          { y: club.y + 13, draw: () => this.drawBuilding(game, time) },
          { y: club.y + 17, draw: () => this.drawStructures(game, time) },
        ]
      : [];
    if (!far) for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w.w + x;
        if (!w.tree[i]) continue;
        const hh = hash2(x, y, 400);
        const variant = this.treeVariant(game, x, y, i, hh);
        items.push({ y: x + y + 1, draw: () => this.drawTree(x, y, variant, hh) });
      }
    if (!far) for (const d of this.decor) {
      if (d.x < x0 || d.x > x1 + 1 || d.y < y0 || d.y > y1 + 1 || w.tree[d.i]) continue;
      items.push({ y: d.x + d.y, draw: () => this.drawDecor(d) });
    }
    if (!far) this.teeFurniture(game, items);
    for (const it of w.items ?? []) {
      if (it.x < x0 - 1 || it.x > x1 + 1 || it.y < y0 - 1 || it.y > y1 + 1) continue;
      items.push({ y: it.x + it.y + 1, draw: () => this.drawPlaced(it.k, it.x, it.y) });
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

  private drawSprite(sp: Sprite, x: number, y: number, scale: number, alpha = 1) {
    const ctx = this.ctx;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(sp.cv, x - sp.ax * scale, y - sp.ay * scale, sp.cv.width * scale, sp.cv.height * scale);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  /** Something the player placed: flowers, a shrub, a bench, a lamp, a ball wash, a fountain or a statue. */
  drawPlaced(k: string, x: number, y: number) {
    this.placed ??= { flowers: makeFlowers(1), shrub: makeShrub(2), bench: makeBench(), lamp: makeLamp(), washer: makeBallWasher(), fountain: makeFountain(), statue: makeStatue() };
    const sp = this.placed[k];
    if (!sp) return;
    const p = this.toScreen(x + 0.5, y + 0.5);
    const big = k === 'fountain' || k === 'statue';
    this.drawSprite(sp, p.x, p.y, (this.ts / 52) * (big ? 1.25 : k === 'flowers' ? 1.3 : 1));
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
  private speciesRegion = '';

  private treeSpecies(game: Game, x: number, y: number, i: number): number {
    const w = game.world;
    if (this.speciesFor !== w || this.speciesVersion !== w.version || this.speciesRegion !== w.region || this.species.length !== w.terrain.length) {
      this.speciesFor = w;
      this.speciesVersion = w.version;
      this.speciesRegion = w.region;
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
      const cl = w.clubhouse;
      const club = cl ? Math.hypot(x - cl.x - 3, y - cl.y - 2) : 99;
      let nearTee = 99;
      for (const h of w.holes) nearTee = Math.min(nearTee, Math.hypot(x - h.tee.x, y - h.tee.y));
      if ((club < 14 || nearTee < 5) && hh > 0.62) v = 7; // ornamental blossom framing the clubhouse and tees
      else if (vnoise(x / 5, y / 5, 420) > 0.66) v = 8; // birch groves
      else if (vnoise(x / 4, y / 4, 430) > 0.74 && hh > 0.55 && this.treeNeighbours(w, x, y) >= 2) v = 9; // a few maples inside a stand, never a lone red tree
    }
    this.species[i] = v;
    return v;
  }

  private treeNeighbours(w: World, x: number, y: number): number {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && inBounds(w, x + dx, y + dy) && w.tree[(y + dy) * w.w + x + dx]) n++;
    return n;
  }

  private treeVariant(game: Game, x: number, y: number, i: number, hh: number): number {
    const w = game.world;
    const cond = w.cond[i];
    // neglected ground: some trees dead, more of them dry, both following the overgrown patches
    if (cond < 20 && hh < 0.12) return 3;
    if (cond < 32 && hh < 0.34) return 4;
    const v = this.treeSpecies(game, x, y, i);
    // autumn turns whole stands of broadleaves, not single trees
    if (game.season.index === 2 && (v === 0 || v === 8) && vnoise(x / 6, y / 6, 440) > 0.5) return 4;
    return v;
  }

  private shaded(x: number, y: number): boolean {
    const w = this.builtFor;
    if (!w) return false;
    return x + 1 < w.w && y + 1 < w.h && w.tree[(y + 1) * w.w + x + 1] === 1 && w.tree[y * w.w + x + 1] === 1;
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
    // In a dense stand a neighbour's canopy to the lower right already covers this shadow: skip it when zoomed out
    if (ts >= 22 || !this.shaded(x, y)) ctx.drawImage(this.treeShadow, p.x - SHADOW_AX * k, p.y - SHADOW_AY * k, SHADOW_W * k, SHADOW_H * k);
    const small = size * this.dpr < 80;
    const spr = small ? this.treesSmall[v] : this.trees[v];
    const h = size * (TREE_H / TREE_W);
    const baseY = h * TREE_BASE;
    // Swaying costs a save/rotate/restore per tree, so it is only worth it when trees are big enough to see it
    if (v === 3 || ts < 26) {
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
  /** The clubhouse art is drawn for the classic course's spot; this shifts it to wherever the player put the clubhouse. */
  private clubPainter(at: Pt): Painter {
    const dx = at.x - CLUB_ART_ORIGIN.x;
    const dy = at.y - CLUB_ART_ORIGIN.y;
    return { ctx: this.ctx, ts: this.ts, toScreen: (x: number, y: number) => this.toScreen(x + dx, y + dy) };
  }
  private drawBuilding(game: Game, time: number) {
    const c = game.world.clubhouse;
    if (c && this.nearScreen(c.x + 4, c.y + 3, 16)) drawCountryClub(this.clubPainter(c), game, time);
  }
  private drawStructures(game: Game, time: number) {
    const c = game.world.clubhouse;
    if (c && this.nearScreen(c.x + 12, c.y, 14)) drawVillageAmenities(this.clubPainter(c), game);
    void time;
  }
  /** The clubhouse the player is placing: a translucent building on a coloured lot, red when the ground will not do. */
  private drawClubGhost(game: Game, spot: { x: number; y: number; problem: string | null }, time: number) {
    const ctx = this.ctx;
    const bad = !!spot.problem;
    const poly = (x0: number, y0: number, x1: number, y1: number) => {
      const a = this.toScreen(x0, y0), b = this.toScreen(x1, y0), c = this.toScreen(x1, y1), d = this.toScreen(x0, y1);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.closePath();
    };
    const lot = clubLot(spot);
    poly(lot.x0, lot.y0, lot.x1 + 1, lot.y1 + 1);
    ctx.fillStyle = bad ? 'rgba(220,70,50,.10)' : 'rgba(250,236,170,.10)';
    ctx.fill();
    ctx.setLineDash([8, 7]);
    ctx.strokeStyle = bad ? 'rgba(255,150,120,.7)' : 'rgba(255,238,170,.75)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    poly(spot.x, spot.y, spot.x + CLUB_W, spot.y + CLUB_H);
    ctx.fillStyle = bad ? 'rgba(220,70,50,.5)' : 'rgba(255,226,140,.45)';
    ctx.fill();
    ctx.strokeStyle = bad ? '#ff8a6a' : '#ffe27a';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    if (!bad) {
      ctx.save();
      ctx.globalAlpha = 0.72 + 0.1 * Math.sin(time * 4);
      drawCountryClub(this.clubPainter(spot), game, time);
      ctx.restore();
    }
    const label = this.toScreen(spot.x + CLUB_W / 2, spot.y + CLUB_H / 2);
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = bad ? spot.problem! : 'Clubhouse';
    const wd = ctx.measureText(text).width + 18;
    const ly = label.y - this.ts * (bad ? 0.2 : 4.4);
    ctx.fillStyle = bad ? 'rgba(80,24,14,.9)' : 'rgba(18,42,30,.88)';
    ctx.beginPath();
    ctx.roundRect(label.x - wd / 2, ly - 12, wd, 24, 12);
    ctx.fill();
    ctx.fillStyle = bad ? '#ffd2c4' : '#f6ecc9';
    ctx.fillText(text, label.x, ly + 0.5);
    ctx.textAlign = 'left';
  }

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
      } else if (f.kind === 'coin' || f.kind === 'cheer') {
        // a word that pops up, floats and fades: money in at the clubhouse, a cheer at the green
        const life = f.kind === 'coin' ? 1.6 : 2.4;
        const k = Math.min(1, age / life);
        const pop = Math.min(1, age / 0.18);
        const scale = (f.kind === 'coin' ? 0.9 : 1.15) * (0.6 + 0.4 * pop) * (1 + 0.15 * Math.sin(Math.min(1, age / 0.3) * Math.PI));
        const y = p.y - u * (0.6 + 1.1 * k);
        ctx.save();
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.translate(p.x, y);
        ctx.scale(scale, scale);
        const fs = Math.max(11, Math.min(22, u * 0.42));
        ctx.font = `800 ${fs}px ui-rounded, 'SF Pro Rounded', system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const text = f.text ?? '';
        const tw = ctx.measureText(text).width;
        if (f.kind === 'coin') {
          // a little gold coin beside the amount
          const r = fs * 0.42;
          ctx.fillStyle = '#e9a92a';
          ctx.beginPath(); ctx.arc(-tw / 2 - r - 2, 0, r, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#ffd969';
          ctx.beginPath(); ctx.arc(-tw / 2 - r - 2, -r * 0.12, r * 0.72, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(38,56,31,0.85)';
          const w = tw + fs * 1.1, h = fs * 1.5;
          ctx.beginPath();
          ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
          ctx.fill();
        }
        ctx.lineWidth = Math.max(2, fs * 0.22);
        ctx.strokeStyle = f.kind === 'coin' ? 'rgba(60,40,0,0.75)' : 'rgba(0,0,0,0)';
        if (f.kind === 'coin') ctx.strokeText(text, 0, 0);
        ctx.fillStyle = f.kind === 'coin' ? '#ffe27a' : '#fff3c4';
        ctx.fillText(text, 0, 0);
        ctx.restore();
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
    // falling leaves in autumn; no snow in winter (just the cool tint)
    if (season === 2) {
      const n = 28;
      for (let k = 0; k < n; k++) {
        const sp = 24 + (k % 4) * 8;
        const x = ((hash2(k, 1, 600) * (this.cw + 100) + Math.sin(time * 0.8 + k) * 30 + time * 18) % (this.cw + 100)) - 50;
        const y = ((hash2(k, 2, 600) * this.ch + time * sp) % (this.ch + 20)) - 10;
        ctx.fillStyle = ['rgba(214,120,40,0.8)', 'rgba(196,150,50,0.8)', 'rgba(170,70,40,0.8)'][k % 3];
        ctx.beginPath();
        ctx.ellipse(x, y, 3.2, 1.8, time + k, 0, Math.PI * 2);
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

  /** Yardage chips along a route: one per leg when it turns, plus par and the total length at the green. */
  private drawYardage(route: Pt[], par: number, ghost = false) {
    const ctx = this.ctx;
    const yd = (a: Pt, b: Pt) => Math.round(Math.hypot(b.x - a.x, b.y - a.y) * CFG.grid.yardsPerTile);
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
    const tee = route[0];
    const cup = route[route.length - 1];
    const dev = (p: Pt) => Math.abs((cup.x - tee.x) * (tee.y - p.y) - (tee.x - p.x) * (cup.y - tee.y)) / (Math.hypot(cup.x - tee.x, cup.y - tee.y) || 1);
    const turns = route.length > 2 && route.slice(1, -1).some((p) => dev(p) > 1.5);
    if (turns) for (let k = 0; k + 1 < route.length; k++) chip(`${yd(route[k], route[k + 1])} y`, (route[k].x + route[k + 1].x) / 2, (route[k].y + route[k + 1].y) / 2, 4);
    let total = 0;
    for (let k = 0; k + 1 < route.length; k++) total += Math.hypot(route[k + 1].x - route[k].x, route[k + 1].y - route[k].y);
    // a straight hole wears its total at the middle; one with turns wears it above the green so it never sits on a leg chip
    if (turns) chip(`Par ${par} · ${Math.round(total * CFG.grid.yardsPerTile)} y`, cup.x, cup.y, 36);
    else chip(`Par ${par} · ${Math.round(total * CFG.grid.yardsPerTile)} y`, (tee.x + cup.x) / 2, (tee.y + cup.y) / 2, 4);
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
    if (ov.club) this.drawClubGhost(game, ov.club, time);
    if (ov.hint) {
      for (const [p, label] of [[ov.hint.tee, 'Tee here'], [ov.hint.cup, 'Green here']] as const) {
        if (!p) continue;
        const s = this.toScreen(p.x + 0.5, p.y + 0.5);
        const pulse = 1 + 0.12 * Math.sin(time * 4);
        ctx.strokeStyle = '#ffe27a';
        ctx.fillStyle = 'rgba(255,226,122,.22)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(s.x, s.y, ts * 1.7 * pulse, ts * 0.9 * pulse, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const wd = ctx.measureText(label).width + 16;
        ctx.fillStyle = 'rgba(40,32,10,.9)';
        ctx.beginPath();
        ctx.roundRect(s.x - wd / 2, s.y - ts * 1.9 - 12, wd, 24, 12);
        ctx.fill();
        ctx.fillStyle = '#ffe9a6';
        ctx.fillText(label, s.x, s.y - ts * 1.9 + 0.5);
        ctx.textAlign = 'left';
      }
    }

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
          ctx.fillText(v.issues[0]?.fix === 'path' ? 'needs a bridge' : 'fairway breaks here', s.x, s.y - ts * 1.6);
          ctx.textAlign = 'left';
        }
      }
    }
    this.drawGhost(ov, h);
  }

  /** The unbuilt tee, green and turning points a pending hole plan would create, with its route and length. */
  private drawGhost(ov: Overlay, h?: { tee: Pt; cup: Pt; bend: Pt }) {
    const g = ov.ghost;
    if (!g) return;
    const ctx = this.ctx;
    const ts = this.ts;
    const route = g.route ? g.route.map(center) : h ? [center(g.tee ?? h.tee), center(g.bend ?? h.bend), center(g.cup ?? h.cup)] : [];
    if (route.length < 2) return;
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
    (g.bends ?? (g.bend ? [g.bend] : [])).forEach((b, k) => pin(b, String(k + 1)));
    this.drawYardage(route, g.par, true);
  }
}

const fmtMoneyShort = (n: number) => (n >= 10000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toLocaleString('en-US')}`);



/** Gaussian blur of a single-channel image (three box passes each way). Outside the image counts as empty. */
function gaussBlur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  // box widths whose three-fold convolution approximates a Gaussian of this sigma
  const wi = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let wl = Math.floor(wi);
  if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
  let a = Float32Array.from(src);
  let b = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    const r = ((pass < m ? wl : wl + 2) - 1) / 2;
    const norm = 1 / (2 * r + 1);
    // horizontal: a -> b
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let acc = 0;
      for (let x = 0; x <= r && x < w; x++) acc += a[o + x];
      for (let x = 0; x < w; x++) {
        b[o + x] = acc * norm;
        const add = x + r + 1;
        const sub = x - r;
        if (add < w) acc += a[o + add];
        if (sub >= 0) acc -= a[o + sub];
      }
    }
    // vertical: b -> a
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = 0; y <= r && y < h; y++) acc += b[y * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc * norm;
        const add = y + r + 1;
        const sub = y - r;
        if (add < h) acc += b[add * w + x];
        if (sub >= 0) acc -= b[sub * w + x];
      }
    }
  }
  return a;
}
