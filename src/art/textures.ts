// Seamless procedural material textures. Each one is generated once into a small canvas and then used as a
// CanvasPattern by the terrain compositor, so none of this costs anything per frame.
//
// Style rules shared by every surface: texture detail lives at one consistent scale (a few terrain pixels,
// i.e. a fraction of a tile), contrast is low, and there is no low-frequency "cloud" noise: large-scale
// colour comes from the surface colour maps, not from the texture. Light comes from the upper left of the
// screen, which is the -x direction on the ground.
import { hash2 } from '../terrain';

type RGB = [number, number, number];

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

/** Stretch values to cover 0..1 exactly (so thresholds behave the same for every seed). */
function stretch(a: Float32Array): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of a) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const k = 1 / Math.max(1e-6, hi - lo);
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * k;
  return a;
}

function makeCanvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return [cv, cv.getContext('2d')!];
}

/** Run `draw` at wrapped offsets so strokes crossing a tile edge continue on the far side. */
function wrapDraw(size: number, x: number, y: number, reach: number, draw: (dx: number, dy: number) => void, sizeY = size) {
  for (let oy = -1; oy <= 1; oy++)
    for (let ox = -1; ox <= 1; ox++) {
      const px = x + ox * size;
      const py = y + oy * sizeY;
      if (px < -reach || py < -reach || px > size + reach || py > sizeY + reach) continue;
      draw(ox * size, oy * sizeY);
    }
}

/** Paint signed noise as a light/dark overlay: positive values lighten, negative values shade. */
function paintNoise(g: CanvasRenderingContext2D, size: number, noise: Float32Array, light: RGB, dark: RGB, amp: number) {
  const img = g.createImageData(size, size);
  for (let i = 0; i < noise.length; i++) {
    const v = (noise[i] - 0.5) * 2;
    const o = i * 4;
    const c = v > 0 ? light : dark;
    img.data[o] = c[0];
    img.data[o + 1] = c[1];
    img.data[o + 2] = c[2];
    img.data[o + 3] = Math.min(255, Math.abs(v) * amp * 255);
  }
  g.putImageData(img, 0, 0);
}

export type TurfKind = 'rough' | 'fairway' | 'green' | 'tee';

interface TurfRecipe {
  /** fine mottling amplitude (alpha); kept at sub-tile scale so it reads as grain, never as clouds */
  grain: number;
  /** grass blade flecks per 256x256 texture (8x8 tiles) */
  blades: number;
  bladeLen: [number, number];
  bladeAlpha: number;
  /** coarse clumps (rough only): small shaded tufts with a lit top */
  clumps: number;
}

const RECIPES: Record<TurfKind, TurfRecipe> = {
  rough: { grain: 0.16, blades: 1500, bladeLen: [2.2, 4.4], bladeAlpha: 0.2, clumps: 260 },
  fairway: { grain: 0.07, blades: 1100, bladeLen: [1.4, 2.6], bladeAlpha: 0.12, clumps: 0 },
  green: { grain: 0.035, blades: 900, bladeLen: [0.9, 1.6], bladeAlpha: 0.08, clumps: 0 },
  tee: { grain: 0.04, blades: 900, bladeLen: [0.9, 1.6], bladeAlpha: 0.09, clumps: 0 },
};

/**
 * Turf overlay: sub-tile grain, then short blade flecks with random lean (no single wind direction, which
 * reads as streaks once projected). Rough also gets coarse clumps. The overlay is neutral (pale and dark
 * green) so it sits on top of any region palette.
 */
export function makeTurfTexture(kind: TurfKind, size = 256): HTMLCanvasElement {
  const rec = RECIPES[kind];
  const seed = 900 + kind.length * 13 + kind.charCodeAt(0);
  const [cv, g] = makeCanvas(size);
  // 256px = 8 tiles, so 16 cells = half a tile, 32 cells = a quarter tile
  const noise = fbm(size, kind === 'rough' ? [[16, 1], [32, 0.8], [64, 0.5]] : [[32, 1], [64, 0.6]], seed);
  paintNoise(g, size, stretch(noise), [226, 248, 180], [10, 46, 26], rec.grain);
  g.lineCap = 'round';
  for (let k = 0; k < rec.blades; k++) {
    const x = hash2(k, 3, seed) * size;
    const y = hash2(k, 5, seed) * size;
    const len = rec.bladeLen[0] + hash2(k, 7, seed) * (rec.bladeLen[1] - rec.bladeLen[0]);
    const ang = hash2(k, 9, seed) * Math.PI * 2;
    const light = hash2(k, 11, seed) > 0.5;
    g.strokeStyle = light ? `rgba(220,246,160,${rec.bladeAlpha})` : `rgba(12,52,28,${rec.bladeAlpha * 1.2})`;
    g.lineWidth = kind === 'rough' ? 1 : 0.8;
    const ex = Math.cos(ang) * len;
    const ey = Math.sin(ang) * len;
    wrapDraw(size, x, y, len + 2, (dx, dy) => {
      g.beginPath();
      g.moveTo(x + dx, y + dy);
      g.lineTo(x + dx + ex, y + dy + ey);
      g.stroke();
    });
  }
  for (let k = 0; k < rec.clumps; k++) {
    const x = hash2(k, 21, seed) * size;
    const y = hash2(k, 23, seed) * size;
    const r = 1.6 + hash2(k, 25, seed) * 1.6;
    wrapDraw(size, x, y, 6, (dx, dy) => {
      // shade toward +x (away from the sun), lit cap toward -x
      g.fillStyle = 'rgba(8,40,22,0.26)';
      g.beginPath();
      g.ellipse(x + dx + 0.8, y + dy + 0.4, r, r * 0.8, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(190,224,130,0.16)';
      g.beginPath();
      g.ellipse(x + dx - 0.6, y + dy - 0.3, r * 0.6, r * 0.45, 0, 0, Math.PI * 2);
      g.fill();
    });
  }
  return cv;
}

/** Fine sand grain: even, warm and quiet. */
export function makeSandTexture(size = 128, base: RGB = [244, 228, 186]): HTMLCanvasElement {
  const [cv, g] = makeCanvas(size);
  // fully opaque: every pixel is a sand colour, a little lighter or darker than the base
  const noise = stretch(fbm(size, [[16, 1], [32, 0.7]], 1300));
  const img = g.createImageData(size, size);
  for (let i = 0; i < noise.length; i++) {
    const v = (noise[i] - 0.5) * 2;
    const k = v > 0 ? v * 0.1 : v * 0.16;
    const o = i * 4;
    img.data[o] = Math.max(0, Math.min(255, base[0] + (k > 0 ? (255 - base[0]) : base[0] - 120) * k));
    img.data[o + 1] = Math.max(0, Math.min(255, base[1] + (k > 0 ? (255 - base[1]) : base[1] - 120) * k));
    img.data[o + 2] = Math.max(0, Math.min(255, base[2] + (k > 0 ? (255 - base[2]) : base[2] - 120) * k));
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 900; k++) {
    const x = hash2(k, 31, 1300) * size;
    const y = hash2(k, 33, 1300) * size;
    g.fillStyle = k % 2 ? 'rgba(255,252,236,0.4)' : 'rgba(150,112,66,0.22)';
    g.fillRect(x, y, 1, 1);
  }
  return cv;
}

/** Water surface: faint long ripples and a little mid-scale shimmer; depth comes from the colour map. */
export function makeWaterTexture(size = 256): HTMLCanvasElement {
  const [cv, g] = makeCanvas(size);
  paintNoise(g, size, stretch(fbm(size, [[16, 1], [32, 0.5]], 1700)), [200, 250, 246], [6, 48, 92], 0.07);
  g.lineCap = 'round';
  for (let k = 0; k < 70; k++) {
    const x = hash2(k, 41, 1700) * size;
    const y = hash2(k, 43, 1700) * size;
    const len = 10 + hash2(k, 45, 1700) * 14;
    g.strokeStyle = `rgba(220,255,250,${0.08 + hash2(k, 47, 1700) * 0.1})`;
    g.lineWidth = 1;
    // ripples run along the ground y axis, which projects to the long screen diagonal
    wrapDraw(size, x, y, len + 4, (dx, dy) => {
      g.beginPath();
      g.moveTo(x + dx, y + dy);
      g.quadraticCurveTo(x + dx + 1.6, y + dy + len * 0.5, x + dx, y + dy + len);
      g.stroke();
    });
  }
  return cv;
}

/**
 * Mowing stripes: alternating light and dark bands with short soft transitions, so they read as a
 * deliberate cut pattern. `period` is one light + one dark band, in terrain pixels. With axis 'x' the bands
 * change along the x axis (stripes run along y); with axis 'y' they run along x.
 */
export function makeStripeTexture(period: number, strength: number, axis: 'x' | 'y' = 'x'): HTMLCanvasElement {
  const n = period;
  const [cv, g] = axis === 'x' ? makeCanvas(n, 4) : makeCanvas(4, n);
  const img = g.createImageData(cv.width, cv.height);
  const edge = Math.max(1.5, period * 0.08);
  for (let p = 0; p < n; p++) {
    // distance into the band, folded so both halves are symmetric
    const u = (p + 0.5) % (n / 2);
    const ramp = Math.min(1, Math.min(u, n / 2 - u) / edge);
    const s = (p < n / 2 ? 1 : -1) * smooth(ramp);
    for (let q = 0; q < 4; q++) {
      const o = (axis === 'x' ? q * n + p : p * 4 + q) * 4;
      if (s > 0) {
        img.data[o] = 236;
        img.data[o + 1] = 255;
        img.data[o + 2] = 196;
        img.data[o + 3] = s * strength * 255;
      } else {
        img.data[o] = 8;
        img.data[o + 1] = 64;
        img.data[o + 2] = 34;
        img.data[o + 3] = -s * strength * 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

/**
 * Flagstone paving in running bond, tinted from the region's path colour. 64px = 2 tiles, so the stone size
 * stays constant however wide the path is.
 */
export function makePavingTexture(base: RGB, size = 64): HTMLCanvasElement {
  const [cv, g] = makeCanvas(size);
  const col = (j: number) => `rgb(${Math.round(base[0] + j)},${Math.round(base[1] + j)},${Math.round(base[2] + j * 1.1)})`;
  g.fillStyle = col(-30);
  g.fillRect(0, 0, size, size);
  const rows = 6;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    const y0 = r * rh;
    // stone widths for this row, summing to exactly `size` so the row wraps seamlessly
    const widths: number[] = [];
    let left = size;
    let k = 0;
    while (left > 0) {
      let wd = 13 + Math.floor(hash2(r, k, 1900) * 9);
      if (left - wd < 10) wd = left;
      widths.push(wd);
      left -= wd;
      k++;
    }
    let x = Math.floor(hash2(r, 99, 1900) * size);
    widths.forEach((wd, s) => {
      const tint = (hash2(r, s, 1901) - 0.5) * 12;
      wrapDraw(size, x, y0, wd + 2, (dx, dy) => {
        const sx = x + dx;
        const sy = y0 + dy;
        g.fillStyle = col(tint);
        g.fillRect(sx + 0.6, sy + 0.6, wd - 1.2, rh - 1.2);
        // lit top-left edge, shaded bottom edge
        g.fillStyle = 'rgba(255,252,236,0.3)';
        g.fillRect(sx + 0.6, sy + 0.6, wd - 1.2, 0.8);
        g.fillRect(sx + 0.6, sy + 0.6, 0.8, rh - 1.2);
        g.fillStyle = 'rgba(80,70,56,0.18)';
        g.fillRect(sx + 0.6, sy + rh - 1.4, wd - 1.2, 0.8);
      });
      x = (x + wd) % size;
    });
  }
  // a faint grain so stones are not plastic
  for (let k = 0; k < 160; k++) {
    g.fillStyle = k % 2 ? 'rgba(255,250,236,0.18)' : 'rgba(90,80,64,0.16)';
    g.fillRect(hash2(k, 1, 1902) * size, hash2(k, 2, 1902) * size, 1, 1);
  }
  return cv;
}

/**
 * Periodic noise used to break worn turf into patches: values 0..1 on a size*size grid that repeats every
 * `size` terrain pixels. Wear is drawn where this noise falls below the local wear level, so damage
 * concentrates where condition is lowest and grows outward as it drops.
 */
export function makeWearNoise(size = 128): Float32Array {
  // 128px = 4 tiles: 8 cells = half-tile patches, 24 cells adds ragged edges
  return stretch(fbm(size, [[8, 1], [24, 0.35]], 2100));
}

/** Wooden deck planks for bridges: boards run across the tile pattern with a faint grain and nail dots. */
export function makeDeckTexture(size = 64): HTMLCanvasElement {
  const [cv, g] = makeCanvas(size);
  const rows = 8;
  const rh = size / rows;
  for (let r = 0; r < rows; r++) {
    const tint = (hash2(r, 3, 2100) - 0.5) * 18;
    g.fillStyle = `rgb(${Math.round(150 + tint)},${Math.round(112 + tint * 0.8)},${Math.round(72 + tint * 0.6)})`;
    g.fillRect(0, r * rh, size, rh);
    g.fillStyle = 'rgba(40,24,10,0.55)';
    g.fillRect(0, r * rh + rh - 1.2, size, 1.2);
    g.fillStyle = 'rgba(255,236,196,0.2)';
    g.fillRect(0, r * rh, size, 0.8);
    for (let k = 0; k < 4; k++) {
      g.fillStyle = 'rgba(70,44,20,0.16)';
      g.fillRect(hash2(r, k, 2101) * size, r * rh + 1 + hash2(r, k, 2102) * (rh - 3), 6 + hash2(r, k, 2103) * 14, 0.7);
    }
    g.fillStyle = 'rgba(40,26,12,0.5)';
    g.fillRect(3, r * rh + rh / 2 - 0.5, 1.3, 1.3);
    g.fillRect(size - 4, r * rh + rh / 2 - 0.5, 1.3, 1.3);
  }
  return cv;
}
