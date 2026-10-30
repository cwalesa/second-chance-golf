// Seamless procedural material textures. Each one is generated once into a small canvas and then used as a
// CanvasPattern by the terrain compositor, so none of this costs anything per frame.
import { hash2 } from '../terrain';

const smooth = (t: number) => t * t * (3 - 2 * t);

/** Periodic value noise on a size*size grid with `cells` lattice points per side, values 0..1. */
export function periodicNoise(size: number, cells: number, seed: number): Float32Array {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = hash2(i % cells, (i / cells) | 0, seed);
  const out = new Float32Array(size * size);
  const step = cells / size;
  for (let y = 0; y < size; y++) {
    const fy = y * step;
    const y0 = Math.floor(fy);
    const ty = smooth(fy - y0);
    const ra = (y0 % cells) * cells;
    const rb = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = x * step;
      const x0 = Math.floor(fx);
      const tx = smooth(fx - x0);
      const xa = x0 % cells;
      const xb = (x0 + 1) % cells;
      const a = lat[ra + xa];
      const b = lat[ra + xb];
      const c = lat[rb + xa];
      const d = lat[rb + xb];
      out[y * size + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    }
  }
  return out;
}

/** Multi-scale noise, normalised to roughly 0..1. */
export function fbm(size: number, octaves: Array<[cells: number, weight: number]>, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let total = 0;
  octaves.forEach(([cells, weight], k) => {
    const n = periodicNoise(size, cells, seed + k * 31);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * weight;
    total += weight;
  });
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function makeCanvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return [cv, cv.getContext('2d')!];
}

/** Run `draw` at wrapped offsets so strokes crossing a tile edge continue on the far side. */
function wrapDraw(size: number, x: number, y: number, reach: number, draw: (dx: number, dy: number) => void) {
  for (let oy = -1; oy <= 1; oy++)
    for (let ox = -1; ox <= 1; ox++) {
      const px = x + ox * size;
      const py = y + oy * size;
      if (px < -reach || py < -reach || px > size + reach || py > size + reach) continue;
      draw(ox * size, oy * size);
    }
}

export type TurfKind = 'rough' | 'fairway' | 'green' | 'tee';

interface TurfRecipe {
  /** dappled light / shade amplitude (alpha) */
  dapple: number;
  /** number of grass blade flecks per 256x256 tile */
  blades: number;
  bladeLen: [number, number];
  bladeAlpha: number;
  /** clover/tuft speckles */
  tufts: number;
}

const RECIPES: Record<TurfKind, TurfRecipe> = {
  rough: { dapple: 0.2, blades: 2400, bladeLen: [3.5, 7.5], bladeAlpha: 0.26, tufts: 90 },
  fairway: { dapple: 0.1, blades: 1500, bladeLen: [2.2, 4.2], bladeAlpha: 0.2, tufts: 20 },
  green: { dapple: 0.045, blades: 1200, bladeLen: [1.2, 2.4], bladeAlpha: 0.14, tufts: 0 },
  tee: { dapple: 0.04, blades: 900, bladeLen: [1.2, 2.2], bladeAlpha: 0.12, tufts: 0 },
};

/**
 * Layered turf overlay: soft multi-scale dapple (light and shade), then short blade flecks.
 * The overlay is neutral (white and dark green) so it sits on top of any region palette.
 */
export function makeTurfTexture(kind: TurfKind, size = 256): HTMLCanvasElement {
  const rec = RECIPES[kind];
  const seed = 900 + kind.length * 13;
  const [cv, g] = makeCanvas(size);
  const noise = fbm(size, [[3, 1], [6, 0.8], [12, 0.55], [24, 0.3]], seed);
  const img = g.createImageData(size, size);
  for (let i = 0; i < noise.length; i++) {
    const v = (noise[i] - 0.5) * 2;
    const o = i * 4;
    if (v > 0) {
      img.data[o] = 236;
      img.data[o + 1] = 255;
      img.data[o + 2] = 190;
      img.data[o + 3] = Math.min(255, v * rec.dapple * 2.6 * 255);
    } else {
      img.data[o] = 8;
      img.data[o + 1] = 44;
      img.data[o + 2] = 28;
      img.data[o + 3] = Math.min(255, -v * rec.dapple * 2.6 * 255);
    }
  }
  g.putImageData(img, 0, 0);
  g.lineCap = 'round';
  for (let k = 0; k < rec.blades; k++) {
    const x = hash2(k, 3, seed) * size;
    const y = hash2(k, 5, seed) * size;
    const len = rec.bladeLen[0] + hash2(k, 7, seed) * (rec.bladeLen[1] - rec.bladeLen[0]);
    const lean = (hash2(k, 9, seed) - 0.5) * (kind === 'rough' ? 3.4 : 1.6);
    const light = hash2(k, 11, seed) > 0.46;
    g.strokeStyle = light ? `rgba(226,250,158,${rec.bladeAlpha})` : `rgba(10,58,30,${rec.bladeAlpha * 1.15})`;
    g.lineWidth = kind === 'rough' ? 1 : 0.75;
    wrapDraw(size, x, y, len + 2, (dx, dy) => {
      g.beginPath();
      g.moveTo(x + dx, y + dy);
      g.lineTo(x + dx + lean, y + dy - len);
      g.stroke();
    });
  }
  for (let k = 0; k < rec.tufts; k++) {
    const x = hash2(k, 21, seed) * size;
    const y = hash2(k, 23, seed) * size;
    wrapDraw(size, x, y, 6, (dx, dy) => {
      g.fillStyle = k % 5 === 0 ? 'rgba(244,238,205,0.5)' : 'rgba(18,70,38,0.28)';
      g.beginPath();
      g.ellipse(x + dx, y + dy, 1.5 + hash2(k, 25, seed) * 2.5, 0.9 + hash2(k, 27, seed) * 1.2, 0, 0, Math.PI * 2);
      g.fill();
    });
  }
  return cv;
}

/** Fine sand grain with faint wind ripples. */
export function makeSandTexture(size = 128): HTMLCanvasElement {
  const [cv, g] = makeCanvas(size);
  const noise = fbm(size, [[4, 1], [8, 0.6], [16, 0.4]], 1300);
  const img = g.createImageData(size, size);
  for (let i = 0; i < noise.length; i++) {
    const v = (noise[i] - 0.5) * 2;
    const o = i * 4;
    if (v > 0) {
      img.data[o] = 255;
      img.data[o + 1] = 250;
      img.data[o + 2] = 222;
      img.data[o + 3] = Math.min(255, v * 90);
    } else {
      img.data[o] = 150;
      img.data[o + 1] = 112;
      img.data[o + 2] = 64;
      img.data[o + 3] = Math.min(255, -v * 80);
    }
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 1500; k++) {
    const x = hash2(k, 31, 1300) * size;
    const y = hash2(k, 33, 1300) * size;
    g.fillStyle = k % 3 === 0 ? 'rgba(255,253,235,0.55)' : k % 3 === 1 ? 'rgba(138,100,56,0.32)' : 'rgba(200,170,120,0.35)';
    g.fillRect(x, y, 0.9, 0.9);
  }
  for (let k = 0; k < 6; k++) {
    const x = hash2(k, 35, 1300) * size;
    const y = hash2(k, 37, 1300) * size;
    g.fillStyle = k % 2 ? 'rgba(122,110,98,0.55)' : 'rgba(176,160,140,0.55)';
    g.beginPath();
    g.ellipse(x, y, 0.9 + hash2(k, 39, 1300), 0.7, 0, 0, Math.PI * 2);
    g.fill();
  }
  return cv;
}

/** Water surface: soft caustic blobs and short ripple dashes, light from the upper left. */
export function makeWaterTexture(size = 256): HTMLCanvasElement {
  const [cv, g] = makeCanvas(size);
  const noise = fbm(size, [[4, 1], [8, 0.7], [16, 0.35]], 1700);
  const img = g.createImageData(size, size);
  for (let i = 0; i < noise.length; i++) {
    const v = (noise[i] - 0.5) * 2;
    const o = i * 4;
    if (v > 0.08) {
      img.data[o] = 200;
      img.data[o + 1] = 255;
      img.data[o + 2] = 248;
      img.data[o + 3] = Math.min(255, (v - 0.08) * 150);
    } else if (v < -0.1) {
      img.data[o] = 6;
      img.data[o + 1] = 50;
      img.data[o + 2] = 96;
      img.data[o + 3] = Math.min(255, (-v - 0.1) * 130);
    }
  }
  g.putImageData(img, 0, 0);
  g.lineCap = 'round';
  for (let k = 0; k < 90; k++) {
    const x = hash2(k, 41, 1700) * size;
    const y = hash2(k, 43, 1700) * size;
    const len = 6 + hash2(k, 45, 1700) * 12;
    g.strokeStyle = `rgba(215,255,250,${0.1 + hash2(k, 47, 1700) * 0.14})`;
    g.lineWidth = 0.9;
    wrapDraw(size, x, y, len + 4, (dx, dy) => {
      g.beginPath();
      g.moveTo(x + dx, y + dy);
      g.quadraticCurveTo(x + dx + len * 0.5, y + dy - 2, x + dx + len, y + dy);
      g.stroke();
    });
  }
  return cv;
}

/**
 * Mowing-stripe pattern: soft sine-shaped light and dark bands with a faint cross-hatch from the mower
 * roller. `period` is in terrain pixels; bands run along the canvas y axis.
 */
export function makeStripeTexture(period: number, strength: number): HTMLCanvasElement {
  const [cv, g] = makeCanvas(period * 2, 8);
  const img = g.createImageData(period * 2, 8);
  for (let x = 0; x < period * 2; x++) {
    const s = Math.sin((x / period) * Math.PI * 2 - Math.PI / 2); // -1 dark .. 1 light
    const soft = Math.sign(s) * Math.pow(Math.abs(s), 0.7);
    for (let y = 0; y < 8; y++) {
      const o = (y * period * 2 + x) * 4;
      if (soft > 0) {
        img.data[o] = 232;
        img.data[o + 1] = 255;
        img.data[o + 2] = 190;
        img.data[o + 3] = soft * strength * 255;
      } else {
        img.data[o] = 6;
        img.data[o + 1] = 70;
        img.data[o + 2] = 38;
        img.data[o + 3] = -soft * strength * 0.9 * 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}
