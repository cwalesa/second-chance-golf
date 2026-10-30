// Pre-rendered upright tree sprites. Every sprite is lit from the upper left (the same sun that casts
// terrain and golfer shadows toward the lower right), built from overlapping foliage lobes with a bright
// crown, a shaded underside and leaf dabs along the silhouette.
import { hash2 } from '../terrain';

export const TREE_W = 144;
export const TREE_H = 224;
/** Trunk base inside the sprite, as a fraction of its height. */
export const TREE_BASE = 0.955;
const BASE_X = TREE_W / 2;
const BASE_Y = TREE_H * TREE_BASE;

type RGB = [number, number, number];
interface Lobe { x: number; y: number; r: number }
interface Look { light: RGB; mid: RGB; dark: RGB; bark: RGB; barkLight: RGB }

const rgb = (c: RGB, j = 0) => `rgb(${clamp(c[0] + j)},${clamp(c[1] + j)},${clamp(c[2] + j)})`;
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const TREE_VARIANTS = 10;

const LOOKS: Record<number, Look> = {
  0: { light: [150, 190, 90], mid: [84, 140, 66], dark: [40, 86, 52], bark: [92, 70, 48], barkLight: [150, 122, 88] },
  1: { light: [104, 158, 86], mid: [52, 104, 64], dark: [28, 62, 46], bark: [78, 62, 46], barkLight: [128, 106, 80] },
  2: { light: [88, 148, 104], mid: [42, 98, 70], dark: [22, 58, 48], bark: [86, 64, 44], barkLight: [134, 108, 78] },
  4: { light: [196, 178, 84], mid: [150, 142, 66], dark: [98, 100, 52], bark: [96, 76, 52], barkLight: [146, 120, 88] },
  6: { light: [160, 168, 98], mid: [112, 130, 74], dark: [68, 88, 56], bark: [96, 80, 56], barkLight: [140, 118, 90] },
  7: { light: [250, 206, 220], mid: [222, 156, 184], dark: [160, 104, 140], bark: [84, 64, 52], barkLight: [138, 112, 92] },
  8: { light: [196, 214, 112], mid: [138, 176, 84], dark: [78, 118, 62], bark: [226, 222, 208], barkLight: [250, 248, 238] },
  9: { light: [226, 120, 104], mid: [158, 66, 76], dark: [94, 40, 60], bark: [88, 64, 48], barkLight: [144, 116, 86] },
};

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = TREE_W;
  cv.height = TREE_H;
  return [cv, cv.getContext('2d')!];
}

function trunk(c: CanvasRenderingContext2D, look: Look, width: number, topY: number, lean = 0, birch = false) {
  c.lineCap = 'round';
  c.strokeStyle = rgb(look.bark);
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(BASE_X, BASE_Y);
  c.bezierCurveTo(BASE_X - 2, BASE_Y - 30, BASE_X + lean, BASE_Y - 60, BASE_X + lean * 0.6, topY);
  c.stroke();
  // lit left edge
  c.strokeStyle = rgb(look.barkLight);
  c.lineWidth = Math.max(1.4, width * 0.28);
  c.beginPath();
  c.moveTo(BASE_X - width * 0.28, BASE_Y - 2);
  c.bezierCurveTo(BASE_X - width * 0.3, BASE_Y - 30, BASE_X + lean - width * 0.2, BASE_Y - 60, BASE_X + lean * 0.6 - width * 0.2, topY + 6);
  c.stroke();
  if (birch) {
    c.fillStyle = 'rgba(40,36,32,0.8)';
    for (let k = 0; k < 9; k++) c.fillRect(BASE_X - width * 0.4 + hash2(k, 1, 77) * width * 0.6 + lean * (k / 12), BASE_Y - 8 - k * 9, width * (0.25 + hash2(k, 2, 77) * 0.35), 1.6);
  }
  // root flare
  c.fillStyle = rgb(look.bark);
  c.beginPath();
  c.ellipse(BASE_X, BASE_Y - 1, width * 0.85, width * 0.32, 0, 0, Math.PI * 2);
  c.fill();
}

function branches(c: CanvasRenderingContext2D, look: Look, list: Array<[number, number, number]>) {
  c.strokeStyle = rgb(look.bark);
  c.lineCap = 'round';
  for (const [x, y, w] of list) {
    c.lineWidth = w;
    c.beginPath();
    c.moveTo(BASE_X, BASE_Y - 56);
    c.quadraticCurveTo((BASE_X + x) / 2, (BASE_Y - 56 + y) / 2 - 6, x, y);
    c.stroke();
  }
}

/** Draw foliage lobes back to front: gradient body, then leaf dabs for a hand-painted feel. */
function foliage(c: CanvasRenderingContext2D, lobes: Lobe[], look: Look, seed: number, dabDensity = 2.4) {
  const sorted = [...lobes].sort((a, b) => a.y - b.y);
  sorted.forEach((lobe, n) => {
    const { x, y, r } = lobe;
    const g = c.createRadialGradient(x - r * 0.34, y - r * 0.4, r * 0.08, x, y, r * 1.08);
    g.addColorStop(0, rgb(look.light));
    g.addColorStop(0.45, rgb(look.mid));
    g.addColorStop(1, rgb(look.dark));
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    const count = Math.floor(r * dabDensity);
    for (let k = 0; k < count; k++) {
      const a = hash2(k, n, seed) * Math.PI * 2;
      const d = Math.sqrt(hash2(k, n, seed + 1)) * r * 0.98;
      const dx = Math.cos(a) * d;
      const dy = Math.sin(a) * d;
      // light factor: top-left is bright, bottom-right dark
      const lit = (-dx - dy) / (r * 1.4);
      const base = lit > 0.28 ? look.light : lit < -0.2 ? look.dark : look.mid;
      const j = (hash2(k, n, seed + 2) - 0.5) * 26;
      c.fillStyle = rgb(base, j);
      c.beginPath();
      c.ellipse(x + dx, y + dy, 1.6 + hash2(k, n, seed + 3) * 2.8, 1.2 + hash2(k, n, seed + 4) * 2, a, 0, Math.PI * 2);
      c.fill();
    }
  });
}

/** Shade the whole crown toward the lower right and darken the underside, clipped to the silhouette. */
function shadeCrown(c: CanvasRenderingContext2D, cx: number, top: number, bottom: number, strength = 0.34) {
  c.save();
  c.globalCompositeOperation = 'source-atop';
  const g = c.createLinearGradient(cx - 50, top, cx + 50, bottom);
  g.addColorStop(0, 'rgba(255,248,190,0.14)');
  g.addColorStop(0.5, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(8,26,30,${strength})`);
  c.fillStyle = g;
  c.fillRect(0, 0, TREE_W, TREE_H);
  c.restore();
}

function rim(c: CanvasRenderingContext2D) {
  // thin dark outline behind everything keeps silhouettes crisp against bright turf
  const copy = document.createElement('canvas');
  copy.width = TREE_W;
  copy.height = TREE_H;
  const cc = copy.getContext('2d')!;
  cc.drawImage(c.canvas, 0, 0);
  c.save();
  c.globalCompositeOperation = 'destination-over';
  c.globalAlpha = 0.5;
  for (const [dx, dy] of [[1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4]]) c.drawImage(darken(copy), dx, dy);
  c.restore();
}

function darken(src: HTMLCanvasElement): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  const g = cv.getContext('2d')!;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#10261c';
  g.fillRect(0, 0, cv.width, cv.height);
  return cv;
}

function lobesFor(v: number): Lobe[] {
  const r = (i: number, s = 0) => hash2(i, v, 5000 + s);
  const jitter = (x: number, y: number, rad: number, i: number): Lobe => ({ x: x + (r(i, 1) - 0.5) * 6, y: y + (r(i, 2) - 0.5) * 6, r: rad * (0.92 + r(i, 3) * 0.16) });
  if (v === 1) {
    // dense, tall, dark
    return [jitter(72, 70, 30, 0), jitter(46, 94, 26, 1), jitter(98, 92, 27, 2), jitter(72, 108, 32, 3), jitter(58, 52, 22, 4), jitter(88, 50, 21, 5), jitter(72, 34, 18, 6), jitter(40, 118, 18, 7), jitter(104, 116, 19, 8)];
  }
  if (v === 8) {
    // airy birch crown
    return [jitter(72, 58, 22, 0), jitter(52, 76, 20, 1), jitter(92, 76, 20, 2), jitter(72, 92, 22, 3), jitter(62, 38, 15, 4), jitter(84, 40, 15, 5), jitter(44, 98, 14, 6), jitter(100, 98, 14, 7)];
  }
  if (v === 9) {
    // maple: rounder, with a lobed top
    return [jitter(72, 74, 32, 0), jitter(44, 90, 24, 1), jitter(100, 90, 24, 2), jitter(56, 52, 22, 3), jitter(90, 52, 22, 4), jitter(72, 104, 26, 5), jitter(72, 40, 17, 6)];
  }
  if (v === 6) return [jitter(72, 150, 28, 0), jitter(48, 164, 20, 1), jitter(98, 162, 21, 2), jitter(72, 136, 20, 3)];
  // oak, blossom, dry: wide spreading crown
  return [jitter(72, 66, 28, 0), jitter(40, 86, 25, 1), jitter(104, 84, 25, 2), jitter(70, 100, 32, 3), jitter(52, 52, 22, 4), jitter(92, 50, 22, 5), jitter(30, 108, 17, 6), jitter(114, 106, 17, 7), jitter(72, 36, 17, 8)];
}

function pine(c: CanvasRenderingContext2D, look: Look) {
  trunk(c, look, 8, 150);
  const tiers = 7;
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1);
    const y = 168 - t * 20.5;
    const w = 44 - k * 33;
    const h = 40 - k * 12;
    const tier: Lobe[] = [];
    // each tier is a skirt of drooping boughs
    const g = c.createLinearGradient(BASE_X - w, y - h, BASE_X + w, y);
    g.addColorStop(0, rgb(look.light));
    g.addColorStop(0.5, rgb(look.mid));
    g.addColorStop(1, rgb(look.dark));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(BASE_X, y - h);
    for (let s = 0; s <= 8; s++) {
      const px = BASE_X + w - (2 * w * s) / 8;
      const py = y + (s % 2 ? -4 : 3) + Math.sin(s * 1.7 + t) * 1.5;
      c.lineTo(px, py);
    }
    c.closePath();
    c.fill();
    void tier;
    // needle flecks
    for (let k2 = 0; k2 < 26; k2++) {
      const ty = y - h * hash2(k2, t, 41) * 0.95;
      const span = w * (1 - (y - ty) / h) * 0.9;
      const tx = BASE_X + (hash2(k2, t, 42) * 2 - 1) * span;
      const lit = (BASE_X - tx) / Math.max(1, span) * 0.5 + (y - ty) / h * 0.3;
      c.fillStyle = rgb(lit > 0.3 ? look.light : lit < -0.15 ? look.dark : look.mid, (hash2(k2, t, 43) - 0.5) * 24);
      c.fillRect(tx, ty, 2.2, 1.4);
    }
  }
  // lit left flank
  c.save();
  c.globalCompositeOperation = 'source-atop';
  const lg = c.createLinearGradient(BASE_X - 44, 0, BASE_X + 44, 0);
  lg.addColorStop(0, 'rgba(210,255,190,0.2)');
  lg.addColorStop(0.5, 'rgba(0,0,0,0)');
  lg.addColorStop(1, 'rgba(6,28,30,0.34)');
  c.fillStyle = lg;
  c.fillRect(0, 0, TREE_W, TREE_H);
  c.restore();
}

function palm(c: CanvasRenderingContext2D) {
  const bark: RGB = [138, 112, 80];
  c.strokeStyle = rgb(bark);
  c.lineCap = 'round';
  c.lineWidth = 7;
  c.beginPath();
  c.moveTo(BASE_X, BASE_Y);
  c.bezierCurveTo(BASE_X + 8, BASE_Y - 40, BASE_X - 6, BASE_Y - 80, BASE_X + 4, 62);
  c.stroke();
  c.strokeStyle = 'rgba(70,52,34,0.5)';
  c.lineWidth = 1;
  for (let k = 0; k < 14; k++) {
    const t = k / 14;
    c.beginPath();
    c.moveTo(BASE_X - 3 + t * 6, BASE_Y - t * 148);
    c.lineTo(BASE_X + 4 + t * 2, BASE_Y - t * 148);
    c.stroke();
  }
  const cx = BASE_X + 4;
  const cy = 62;
  for (let k = 0; k < 9; k++) {
    const a = -Math.PI + (k / 8) * Math.PI * 1.0 + (hash2(k, 5, 61) - 0.5) * 0.3;
    const len = 44 + hash2(k, 6, 61) * 12;
    const ex = cx + Math.cos(a) * len;
    const ey = cy + Math.sin(a) * len * 0.55 + len * 0.34;
    const lit = -Math.cos(a);
    c.strokeStyle = rgb(mixc([36, 96, 52], [132, 188, 84], Math.max(0, lit * 0.6 + 0.3)));
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(cx, cy);
    c.quadraticCurveTo((cx + ex) / 2, cy - 22, ex, ey);
    c.stroke();
    c.strokeStyle = rgb([60, 130, 60], 20);
    c.lineWidth = 1;
    for (let f = 1; f < 7; f++) {
      const t = f / 7;
      const px = (1 - t) * (1 - t) * cx + 2 * (1 - t) * t * ((cx + ex) / 2) + t * t * ex;
      const py = (1 - t) * (1 - t) * cy + 2 * (1 - t) * t * (cy - 22) + t * t * ey;
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px - 4, py + 8);
      c.moveTo(px, py);
      c.lineTo(px + 4, py + 8);
      c.stroke();
    }
  }
  c.fillStyle = '#7a5a36';
  for (const dx of [-3, 3]) {
    c.beginPath();
    c.arc(cx + dx, cy + 5, 3, 0, Math.PI * 2);
    c.fill();
  }
}

function dead(c: CanvasRenderingContext2D) {
  const look = LOOKS[0];
  trunk(c, { ...look, bark: [104, 94, 84], barkLight: [160, 150, 136] }, 8, 70, 4);
  branches(c, { ...look, bark: [104, 94, 84] }, [[30, 62, 4], [112, 50, 4], [46, 38, 3], [100, 28, 3], [64, 22, 3]]);
}

function blossomFlecks(c: CanvasRenderingContext2D, lobes: Lobe[]) {
  c.save();
  c.globalCompositeOperation = 'source-atop';
  for (const lobe of lobes) {
    for (let k = 0; k < 16; k++) {
      const a = hash2(k, lobe.x, 91) * Math.PI * 2;
      const d = Math.sqrt(hash2(k, lobe.y, 92)) * lobe.r;
      c.fillStyle = k % 3 ? 'rgba(255,240,244,0.75)' : 'rgba(190,80,120,0.5)';
      c.beginPath();
      c.arc(lobe.x + Math.cos(a) * d, lobe.y + Math.sin(a) * d, 1.2 + hash2(k, lobe.x, 93) * 1.2, 0, Math.PI * 2);
      c.fill();
    }
  }
  c.restore();
}

/** Build one cached tree sprite. Variants: 0 oak, 1 dark broadleaf, 2 pine, 3 dead, 4 dry, 5 palm, 6 scrub, 7 blossom, 8 birch, 9 maple. */
export function makeTree(v: number): HTMLCanvasElement {
  const [cv, c] = makeCanvas();
  if (v === 3) {
    dead(c);
    rim(c);
    return cv;
  }
  if (v === 5) {
    palm(c);
    rim(c);
    return cv;
  }
  const look = LOOKS[v] ?? LOOKS[0];
  if (v === 2) {
    pine(c, look);
    rim(c);
    return cv;
  }
  const lobes = lobesFor(v);
  if (v === 6) {
    foliage(c, lobes, look, 700 + v, 2.8);
    shadeCrown(c, BASE_X, 120, BASE_Y, 0.3);
    rim(c);
    return cv;
  }
  const trunkW = v === 8 ? 6 : v === 1 ? 9 : 8;
  trunk(c, look, trunkW, 92, v === 8 ? 5 : 2, v === 8);
  branches(c, look, [[40, 80, 3.2], [104, 78, 3.2], [72, 58, 3]]);
  foliage(c, lobes, look, 600 + v * 13, v === 8 ? 2 : 2.6);
  if (v === 7) blossomFlecks(c, lobes);
  const top = Math.min(...lobes.map((l) => l.y - l.r));
  const bottom = Math.max(...lobes.map((l) => l.y + l.r));
  shadeCrown(c, BASE_X, top, bottom);
  rim(c);
  return cv;
}

/** Soft ground shadow (and contact shadow) for a tree, cast toward the lower right. */
export function makeTreeShadow(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 192;
  cv.height = 64;
  const c = cv.getContext('2d')!;
  c.save();
  c.translate(104, 30);
  c.rotate(0.1);
  c.scale(1, 0.34);
  const g = c.createRadialGradient(0, 0, 4, 0, 0, 88);
  g.addColorStop(0, 'rgba(8,28,18,0.5)');
  g.addColorStop(0.65, 'rgba(8,28,18,0.3)');
  g.addColorStop(1, 'rgba(8,28,18,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 88, 0, Math.PI * 2);
  c.fill();
  c.restore();
  // contact shadow right under the trunk
  c.save();
  c.translate(58, 30);
  c.scale(1, 0.4);
  const g2 = c.createRadialGradient(0, 0, 1, 0, 0, 20);
  g2.addColorStop(0, 'rgba(4,16,10,0.6)');
  g2.addColorStop(1, 'rgba(4,16,10,0)');
  c.fillStyle = g2;
  c.beginPath();
  c.arc(0, 0, 20, 0, Math.PI * 2);
  c.fill();
  c.restore();
  return cv;
}
