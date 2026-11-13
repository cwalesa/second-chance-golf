// The practice putting green and the driving range, drawn on the ground where the player places them.
// Flat surfaces with a few upright details (flag sticks, a net), lit from the upper left like everything else.
import { ISO_X, ISO_Y } from '../isometric';
import type { Painter } from './buildings';

type Pt = { x: number; y: number };
export type AmenityKind = 'puttingGreen' | 'range';

const at = (p: Painter, x: number, y: number, z = 0): Pt => {
  const a = p.toScreen(x, y);
  return { x: a.x, y: a.y - z * p.ts };
};
const ring = (p: Painter, cx: number, cy: number, rx: number, ry: number, n = 30): Pt[] =>
  Array.from({ length: n }, (_, i) => at(p, cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry));
const fill = (c: CanvasRenderingContext2D, pts: Pt[], color: string, stroke?: string, lw = 0.8) => {
  c.fillStyle = color;
  c.beginPath();
  pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
  c.closePath();
  c.fill();
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
};
const rect = (p: Painter, x: number, y: number, w: number, d: number, z = 0): Pt[] => [at(p, x, y, z), at(p, x + w, y, z), at(p, x + w, y + d, z), at(p, x, y + d, z)];
const stick = (p: Painter, x: number, y: number, h: number, color: string) => {
  const c = p.ctx, a = at(p, x, y), b = at(p, x, y, h);
  c.fillStyle = 'rgba(10,28,18,0.2)';
  c.beginPath(); c.ellipse(a.x + p.ts * 0.12, a.y + p.ts * 0.03, p.ts * 0.14, p.ts * 0.05, 0.2, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#f4efd8'; c.lineWidth = Math.max(1, p.ts * 0.04);
  c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  fill(c, [b, { x: b.x + p.ts * 0.34, y: b.y + p.ts * 0.1 }, { x: b.x, y: b.y + p.ts * 0.2 }], color, 'rgba(60,30,20,0.4)', 0.6);
};
const cup = (p: Painter, x: number, y: number) => {
  const a = at(p, x, y), c = p.ctx;
  c.fillStyle = '#1b2a1b';
  c.beginPath(); c.ellipse(a.x, a.y, p.ts * 0.09, p.ts * 0.045, 0, 0, Math.PI * 2); c.fill();
};
const ball = (p: Painter, x: number, y: number) => {
  const a = at(p, x, y, 0.02), c = p.ctx;
  c.fillStyle = '#fffdf2'; c.strokeStyle = 'rgba(60,60,50,0.5)'; c.lineWidth = 0.6;
  c.beginPath(); c.ellipse(a.x, a.y, p.ts * 0.06, p.ts * 0.045, 0, 0, Math.PI * 2); c.fill(); c.stroke();
};
/** Light mowing bands inside whatever path the caller has just built (used with a clip). */
const bands = (p: Painter, x: number, y: number, w: number, d: number, step: number) => {
  const c = p.ctx;
  for (let k = 0; k * step < w; k += 2) fill(c, rect(p, x + k * step, y, Math.min(step, w - k * step), d), 'rgba(255,255,226,0.13)');
};

/** A 4 x 3 putting green with a fringe, three cups and a couple of balls. */
function putting(p: Painter, x0: number, y0: number) {
  const c = p.ctx, cx = x0 + 2, cy = y0 + 1.5;
  fill(c, ring(p, cx + 0.06, cy + 0.08, 2.0, 1.46), 'rgba(40,90,50,0.28)'); // soft grounding
  fill(c, ring(p, cx, cy, 1.92, 1.4), '#86c066', '#5c9a52');
  const surface = ring(p, cx, cy, 1.7, 1.2);
  fill(c, surface, '#a9dd7e', '#5f9e55');
  c.save();
  c.beginPath(); surface.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath(); c.clip();
  bands(p, cx - 1.7, cy - 1.2, 3.4, 2.4, 0.45);
  c.restore();
  const holes: [number, number, string][] = [[cx - 0.85, cy - 0.15, '#d2432f'], [cx + 0.7, cy + 0.35, '#f2c230'], [cx + 0.05, cy - 0.6, '#f4efd8']];
  for (const [x, y] of holes) cup(p, x, y);
  ball(p, cx - 0.3, cy + 0.55); ball(p, cx + 1.1, cy - 0.35);
  for (const [x, y, col] of holes) stick(p, x, y, 0.9, col);
}

/** A 7 x 3 driving range: four hitting mats, a ball bucket, three target greens and a net at the far end. */
function range(p: Painter, x0: number, y0: number) {
  const c = p.ctx;
  fill(c, rect(p, x0 + 0.1, y0 + 0.1, 6.8, 2.8), '#92c96c', '#5f9e55');
  c.save();
  c.beginPath(); rect(p, x0 + 0.1, y0 + 0.1, 6.8, 2.8).forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.closePath(); c.clip();
  bands(p, x0 + 1.5, y0 + 0.1, 5.4, 2.8, 0.7);
  c.restore();
  // hitting bay: a pale apron with a mat for each stall
  fill(c, rect(p, x0 + 0.1, y0 + 0.2, 1.4, 2.6), '#d3ccb6', 'rgba(110,100,80,0.6)');
  for (let i = 0; i < 4; i++) {
    const my = y0 + 0.34 + i * 0.62;
    fill(c, rect(p, x0 + 0.3, my, 0.85, 0.46, 0.02), '#3f7a4a', 'rgba(215,220,175,0.7)');
    const t = at(p, x0 + 0.95, my + 0.23, 0.03);
    c.fillStyle = '#fffdf2'; c.beginPath(); c.arc(t.x, t.y, Math.max(1, p.ts * 0.04), 0, Math.PI * 2); c.fill();
  }
  // a bucket of balls at the end of the bay
  const b0 = at(p, x0 + 0.2, y0 + 0.1), b1 = at(p, x0 + 0.2, y0 + 0.1, 0.22);
  c.fillStyle = '#c2573a'; c.fillRect(b0.x - p.ts * 0.1, b1.y, p.ts * 0.2, b0.y - b1.y);
  c.fillStyle = '#fffdf2'; c.beginPath(); c.ellipse(b1.x, b1.y, p.ts * 0.1, p.ts * 0.04, 0, 0, Math.PI * 2); c.fill();
  // target greens with flags
  const targets: [number, number, string][] = [[x0 + 3.1, y0 + 0.9, '#f2c230'], [x0 + 4.6, y0 + 2.1, '#d2432f'], [x0 + 6.0, y0 + 1.2, '#f4efd8']];
  for (const [x, y, col] of targets) {
    fill(c, ring(p, x, y, 0.55, 0.42, 20), '#b6e68c', '#5f9e55');
    stick(p, x, y, 0.8, col);
  }
  // netting along the far end
  const posts = [0.2, 1.0, 2.0, 2.8].map((d) => y0 + d);
  const top = posts.map((y) => at(p, x0 + 6.9, y, 1.25)), foot = posts.map((y) => at(p, x0 + 6.9, y));
  c.fillStyle = 'rgba(244,244,232,0.22)';
  c.beginPath(); top.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); [...foot].reverse().forEach((q) => c.lineTo(q.x, q.y)); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(70,70,64,0.55)'; c.lineWidth = Math.max(0.8, p.ts * 0.03);
  for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(foot[i].x, foot[i].y); c.lineTo(top[i].x, top[i].y); c.stroke(); }
  c.beginPath(); top.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); c.stroke();
}

/** Draw an amenity with its top-left tile at (x, y). */
export function drawAmenity(p: Painter, kind: AmenityKind, x: number, y: number, alpha = 1) {
  if (alpha !== 1) p.ctx.globalAlpha = alpha;
  if (kind === 'puttingGreen') putting(p, x, y); else range(p, x, y);
  if (alpha !== 1) p.ctx.globalAlpha = 1;
}

/** A tray thumbnail drawn with the same art. */
export function drawAmenityThumb(canvas: HTMLCanvasElement, kind: AmenityKind) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const [fw, fh, tall] = kind === 'range' ? [7, 3, 1.3] : [4, 3, 1];
  const ts = Math.min(canvas.width / ((fw + fh) * ISO_X * 1.05), canvas.height / ((fw + fh) * ISO_Y + tall * 1.05));
  const cx = canvas.width / 2, base = canvas.height - 4;
  const toScreen = (x: number, y: number) => ({ x: cx + (x - y - (fw - fh) / 2) * ISO_X * ts, y: base - (fw + fh) * ISO_Y * ts + (x + y) * ISO_Y * ts });
  drawAmenity({ ctx, ts, toScreen }, kind, 0, 0);
}
