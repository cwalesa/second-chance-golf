// The chunky tycoon look for the map: every sprite gets a thick ink outline, and colours are pushed a little brighter.
export const INK = '#1c1a2e';
export const INK_RGB: [number, number, number] = [28, 26, 46];

/**
 * Add an ink outline around the solid part of a sprite, in place. Pixels that are mostly transparent (soft shadows,
 * glints) do not count as solid, so they never grow a halo. The sprite needs a few pixels of margin for the outline.
 */
export function inkOutline(cv: HTMLCanvasElement, radius = 3): HTMLCanvasElement {
  const w = cv.width, h = cv.height;
  const c = cv.getContext('2d');
  if (!c || !w || !h) return cv;
  let img: ImageData;
  try { img = c.getImageData(0, 0, w, h); } catch { return cv; }
  const src = img.data;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = src[i * 4 + 3] >= 140 ? 1 : 0;
  const offs: [number, number][] = [];
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= radius * radius + 0.25) offs.push([dx, dy]);
  const ring = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!solid[y * w + x]) continue;
      for (const [dx, dy] of offs) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) ring[ny * w + nx] = 1;
      }
    }
  for (let i = 0; i < w * h; i++) {
    if (!ring[i]) continue;
    const o = i * 4;
    const a = src[o + 3] / 255;
    if (a >= 1) continue;
    // the sprite's own pixel over solid ink
    src[o] = INK_RGB[0] * (1 - a) + src[o] * a;
    src[o + 1] = INK_RGB[1] * (1 - a) + src[o + 1] * a;
    src[o + 2] = INK_RGB[2] * (1 - a) + src[o + 2] * a;
    src[o + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return cv;
}

/** Push a colour toward a brighter, cleaner cartoon green or blue: a little more saturation, a touch lighter. */
export function chunky(c: [number, number, number], sat = 1.22, lift = 6): [number, number, number] {
  const [r, g, b] = c.map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d < 1e-6) return [Math.min(255, c[0] + lift), Math.min(255, c[1] + lift), Math.min(255, c[2] + lift)];
  const s = d / (1 - Math.abs(2 * l - 1));
  const hh = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const S = Math.min(1, s * sat);
  const L = Math.min(0.92, l + lift / 255);
  const C = (1 - Math.abs(2 * L - 1)) * S;
  const X = C * (1 - Math.abs((hh % 2) - 1));
  const m = L - C / 2;
  const [r1, g1, b1] = hh < 1 ? [C, X, 0] : hh < 2 ? [X, C, 0] : hh < 3 ? [0, C, X] : hh < 4 ? [0, X, C] : hh < 5 ? [X, 0, C] : [C, 0, X];
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}
