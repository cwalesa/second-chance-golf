// Clubhouse, village amenities and their landscaping. Everything is drawn as upright geometry on top of the
// isometric ground, lit from the upper left: faces toward the sun are bright, the +x face is in shade.
import type { Game } from '../game';
import { hash2, Pt } from '../terrain';
import { ISO_X, ISO_Y } from '../isometric';

export interface Painter {
  ctx: CanvasRenderingContext2D;
  ts: number;
  toScreen(x: number, y: number): Pt;
}

// ---------- small drawing helpers ----------
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** Multiply a #rrggbb colour's brightness. */
function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${clamp(r * f)},${clamp(g * f)},${clamp(b * f)})`;
}

function pt(p: Painter, x: number, y: number, z = 0): Pt {
  const a = p.toScreen(x, y);
  return { x: a.x, y: a.y - z * p.ts };
}

function poly(ctx: CanvasRenderingContext2D, points: Pt[], fill: string | CanvasGradient, stroke?: string, lw = 0.7) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  points.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function line(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** Ground-level rectangle. */
function flat(p: Painter, x: number, y: number, w: number, d: number, z: number, fill: string, stroke?: string) {
  poly(p.ctx, [pt(p, x, y, z), pt(p, x + w, y, z), pt(p, x + w, y + d, z), pt(p, x, y + d, z)], fill, stroke);
}

/** Box with a lit top, a mid-tone front (+y) and a shaded right side (+x). */
function box(p: Painter, x: number, y: number, w: number, d: number, z0: number, z1: number, color: string, outline?: string) {
  const ctx = p.ctx;
  poly(ctx, [pt(p, x + w, y, z0), pt(p, x + w, y + d, z0), pt(p, x + w, y + d, z1), pt(p, x + w, y, z1)], shade(color, 0.7), outline);
  poly(ctx, [pt(p, x, y + d, z0), pt(p, x + w, y + d, z0), pt(p, x + w, y + d, z1), pt(p, x, y + d, z1)], shade(color, 0.93), outline);
  poly(ctx, [pt(p, x, y, z1), pt(p, x + w, y, z1), pt(p, x + w, y + d, z1), pt(p, x, y + d, z1)], shade(color, 1.1), outline);
}

/** Soft cast shadow on the ground, toward the lower right (ground +x, a little +y). */
function castShadow(p: Painter, x: number, y: number, w: number, d: number, height: number, alpha = 0.22) {
  const k = height * 0.9;
  const ctx = p.ctx;
  ctx.fillStyle = `rgba(10,28,18,${alpha})`;
  ctx.beginPath();
  const pts = [pt(p, x, y, 0), pt(p, x + w, y, 0), pt(p, x + w + k, y + k * 0.25, 0), pt(p, x + w + k, y + d + k * 0.25, 0), pt(p, x + w, y + d, 0), pt(p, x, y + d, 0)];
  pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
  ctx.fill();
}

/** Draw text lying on a wall that runs along ground x (the +y face). */
function wallText(p: Painter, text: string, x: number, y: number, z: number, size: number, color: string, font = 'Georgia') {
  const ctx = p.ctx;
  const o = pt(p, x, y, z);
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.transform(ISO_X, ISO_Y, 0, 1, 0, 0);
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.max(5, size)}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// ---------- building parts ----------
type WallAxis = 'x' | 'y';

function glassGradient(p: Painter, a: Pt, d: Pt): CanvasGradient {
  const g = p.ctx.createLinearGradient(a.x, d.y, a.x, a.y);
  g.addColorStop(0, '#8fb6b8');
  g.addColorStop(0.45, '#3d6670');
  g.addColorStop(1, '#223a44');
  return g;
}

function wallWindow(p: Painter, x: number, y: number, z: number, axis: WallAxis, lit: boolean, shutters: boolean, width = 0.46, height = 0.66) {
  const ctx = p.ctx;
  const dx = axis === 'x' ? width : 0;
  const dy = axis === 'y' ? width : 0;
  const a = pt(p, x, y, z);
  const b = pt(p, x + dx, y + dy, z);
  const c = pt(p, x + dx, y + dy, z + height);
  const d = pt(p, x, y, z + height);
  if (shutters) {
    const sw = width * 0.34;
    for (const side of [-1, 1]) {
      const ox = side < 0 ? -sw - 0.02 : width + 0.02;
      const s0 = pt(p, x + (axis === 'x' ? ox : 0), y + (axis === 'y' ? ox : 0), z);
      const s1 = pt(p, x + (axis === 'x' ? ox + sw : 0), y + (axis === 'y' ? ox + sw : 0), z);
      const s2 = pt(p, x + (axis === 'x' ? ox + sw : 0), y + (axis === 'y' ? ox + sw : 0), z + height);
      const s3 = pt(p, x + (axis === 'x' ? ox : 0), y + (axis === 'y' ? ox : 0), z + height);
      poly(ctx, [s0, s1, s2, s3], lit ? '#547a58' : '#3c5a44');
    }
  }
  poly(ctx, [a, b, c, d], glassGradient(p, a, d), lit ? '#f4ecd0' : '#cfc7a6', Math.max(0.6, p.ts * 0.03));
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const midTop = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
  line(ctx, mid, midTop, 'rgba(236,230,200,0.75)', Math.max(0.5, p.ts * 0.025));
  const ym = { x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 };
  const yn = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  line(ctx, ym, yn, 'rgba(236,230,200,0.75)', Math.max(0.5, p.ts * 0.025));
  // reflected sky streak and a stone sill
  ctx.fillStyle = 'rgba(210,240,250,0.22)';
  ctx.beginPath();
  ctx.moveTo(d.x, d.y);
  ctx.lineTo(c.x, c.y);
  ctx.lineTo(c.x * 0.5 + b.x * 0.5, c.y * 0.5 + b.y * 0.5 + (b.y - c.y) * 0.5);
  ctx.lineTo(d.x * 0.5 + a.x * 0.5 + (b.x - a.x) * 0.2, d.y * 0.5 + a.y * 0.5 + (a.y - d.y) * 0.1);
  ctx.closePath();
  ctx.fill();
  const sill = 0.05;
  poly(ctx, [pt(p, x - (axis === 'x' ? 0.04 : 0), y - (axis === 'y' ? 0.04 : 0), z - sill), pt(p, x + dx + (axis === 'x' ? 0.04 : 0), y + dy + (axis === 'y' ? 0.04 : 0), z - sill), b, a], '#b8ae92');
}

export interface HouseColors {
  wall: string;
  side: string;
  roof: string;
  near: string;
}

interface HouseOpts {
  detail?: boolean;
  shutters?: boolean;
  dormers?: number;
  /** wall sign text across the front gable */
  sign?: string;
}

function house(p: Painter, x: number, y: number, w: number, d: number, h: number, roofHeight: number, colors: HouseColors, opts: HouseOpts = {}) {
  const ctx = p.ctx;
  const ts = p.ts;
  const detail = opts.detail ?? true;
  castShadow(p, x, y, w, d, h + roofHeight * 0.8, 0.2);
  const B = pt(p, x + w, y);
  const C = pt(p, x + w, y + d);
  const D = pt(p, x, y + d);
  const a = pt(p, x, y, h);
  const b = pt(p, x + w, y, h);
  const c = pt(p, x + w, y + d, h);
  const dd = pt(p, x, y + d, h);
  const outline = 'rgba(70,66,48,0.65)';
  // side (+x, shaded) and front (+y) walls with a soft darkening toward the ground
  const sideG = ctx.createLinearGradient(0, b.y, 0, B.y);
  sideG.addColorStop(0, colors.side);
  sideG.addColorStop(1, shade(colors.side, 0.82));
  poly(ctx, [B, C, c, b], sideG, outline);
  const frontG = ctx.createLinearGradient(0, dd.y, 0, D.y);
  frontG.addColorStop(0, colors.wall);
  frontG.addColorStop(1, shade(colors.wall, 0.84));
  poly(ctx, [C, D, dd, c], frontG, outline);
  if (detail) {
    // clapboard courses
    ctx.lineWidth = Math.max(0.4, ts * 0.016);
    ctx.strokeStyle = 'rgba(120,112,84,0.2)';
    for (let z = 0.3; z < h; z += 0.24) {
      const f0 = pt(p, x, y + d, z);
      const f1 = pt(p, x + w, y + d, z);
      ctx.beginPath();
      ctx.moveTo(f0.x, f0.y);
      ctx.lineTo(f1.x, f1.y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(70,62,44,0.2)';
    for (let z = 0.3; z < h; z += 0.24) {
      const s0 = pt(p, x + w, y, z);
      const s1 = pt(p, x + w, y + d, z);
      ctx.beginPath();
      ctx.moveTo(s0.x, s0.y);
      ctx.lineTo(s1.x, s1.y);
      ctx.stroke();
    }
    // stone footing and corner quoins
    poly(ctx, [pt(p, x, y + d, 0), pt(p, x + w, y + d, 0), pt(p, x + w, y + d, 0.26), pt(p, x, y + d, 0.26)], '#a69b7e', outline);
    poly(ctx, [pt(p, x + w, y, 0), pt(p, x + w, y + d, 0), pt(p, x + w, y + d, 0.26), pt(p, x + w, y, 0.26)], '#7f7660', outline);
    for (let z = 0.3; z < h - 0.1; z += 0.34) {
      const q0 = pt(p, x + w - 0.12, y + d + 0.005, z);
      const q1 = pt(p, x + w, y + d + 0.005, z);
      const q2 = pt(p, x + w, y + d + 0.005, z + 0.2);
      const q3 = pt(p, x + w - 0.12, y + d + 0.005, z + 0.2);
      poly(ctx, [q0, q1, q2, q3], '#f1e8c8');
    }
    // windows, floor by floor, with the front lit and the side in shade
    const floors = h > 3.8 ? 3 : h > 2.4 ? 2 : 1;
    const doorAt = w > 4 ? x + w * 0.48 : -999;
    for (let level = 0; level < floors; level++) {
      const z = 0.5 + level * 1.16;
      for (let k = 0.6; k < w - 0.5; k += 1.2) {
        if (level === 0 && Math.abs(x + k - (doorAt + 0.33)) < 0.9) continue;
        wallWindow(p, x + k, y + d + 0.01, z, 'x', true, !!opts.shutters);
      }
      for (let k = 0.5; k < d - 0.4; k += 1.15) wallWindow(p, x + w + 0.01, y + k, z, 'y', false, false);
    }
    // front door with a transom and a brass handle
    if (w > 4) {
      const dx = doorAt;
      const dw = 0.7;
      const d0 = pt(p, dx, y + d + 0.02, 0.2);
      const d1 = pt(p, dx + dw, y + d + 0.02, 0.2);
      const d2 = pt(p, dx + dw, y + d + 0.02, 1.25);
      const d3 = pt(p, dx, y + d + 0.02, 1.25);
      poly(ctx, [pt(p, dx - 0.1, y + d + 0.015, 0.2), pt(p, dx + dw + 0.1, y + d + 0.015, 0.2), pt(p, dx + dw + 0.1, y + d + 0.015, 1.42), pt(p, dx - 0.1, y + d + 0.015, 1.42)], '#f3ead0');
      poly(ctx, [d0, d1, d2, d3], '#5d4631', '#2d2418');
      poly(ctx, [pt(p, dx + 0.08, y + d + 0.03, 1.02), pt(p, dx + dw - 0.08, y + d + 0.03, 1.02), pt(p, dx + dw - 0.08, y + d + 0.03, 1.3), pt(p, dx + 0.08, y + d + 0.03, 1.3)], '#9fc3c0');
      const knob = pt(p, dx + dw * 0.8, y + d + 0.04, 0.7);
      ctx.fillStyle = '#e1c067';
      ctx.beginPath();
      ctx.arc(knob.x, knob.y, Math.max(0.8, ts * 0.03), 0, Math.PI * 2);
      ctx.fill();
    }
    // cornice trim at the eaves
    poly(ctx, [pt(p, x - 0.08, y + d + 0.08, h - 0.12), pt(p, x + w + 0.08, y + d + 0.08, h - 0.12), pt(p, x + w + 0.08, y + d + 0.08, h + 0.02), pt(p, x - 0.08, y + d + 0.08, h + 0.02)], '#f4ecd0', 'rgba(110,100,70,0.5)');
    if (opts.sign) {
      const sx = x + w / 2 - 1.15;
      poly(ctx, [pt(p, sx, y + d + 0.03, h - 0.62), pt(p, sx + 2.3, y + d + 0.03, h - 0.62), pt(p, sx + 2.3, y + d + 0.03, h - 0.28), pt(p, sx, y + d + 0.03, h - 0.28)], '#3d5440', '#e6d9a6');
      wallText(p, opts.sign, x + w / 2, y + d + 0.04, h - 0.45, ts * 0.17, '#f1e4b0');
    }
  }
  // roof: gables, then the two slopes with shingle courses and a ridge cap
  const e = 0.26;
  const ra = pt(p, x - e, y - e, h);
  const rb = pt(p, x + w + e, y - e, h);
  const rc = pt(p, x + w + e, y + d + e, h);
  const rd = pt(p, x - e, y + d + e, h);
  const ridgeA = pt(p, x - e, y + d / 2, h + roofHeight);
  const ridgeB = pt(p, x + w + e, y + d / 2, h + roofHeight);
  poly(ctx, [a, dd, ridgeA], colors.wall, 'rgba(120,112,80,0.7)');
  poly(ctx, [b, c, ridgeB], colors.side, 'rgba(100,96,72,0.7)');
  poly(ctx, [ra, rb, ridgeB, ridgeA], colors.roof, 'rgba(40,36,30,0.7)');
  const nearG = ctx.createLinearGradient(rd.x, rd.y, ridgeA.x, ridgeA.y);
  nearG.addColorStop(0, shade(colors.near, 0.86));
  nearG.addColorStop(1, shade(colors.near, 1.12));
  poly(ctx, [ridgeA, ridgeB, rc, rd], nearG, 'rgba(36,32,26,0.75)');
  if (detail) {
    const half = d / 2 + e;
    // shingle courses with staggered seams
    for (let row = 0; row * 0.3 < half - 0.2; row++) {
      const t0 = (row * 0.3) / half;
      const t1 = Math.min(1, ((row + 1) * 0.3) / half);
      const z0 = h + roofHeight * (1 - t0);
      const z1 = h + roofHeight * (1 - t1);
      const y0 = y + d / 2 + t0 * half;
      const y1 = y + d / 2 + t1 * half;
      const l = pt(p, x - e, y1, z1);
      const r = pt(p, x + w + e, y1, z1);
      ctx.strokeStyle = 'rgba(30,24,20,0.28)';
      ctx.lineWidth = Math.max(0.5, ts * 0.02);
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(r.x, r.y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,236,200,0.1)';
      ctx.beginPath();
      ctx.moveTo(l.x, l.y - 1);
      ctx.lineTo(r.x, r.y - 1);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(30,24,20,0.16)';
      ctx.lineWidth = Math.max(0.4, ts * 0.016);
      for (let k = (row % 2) * 0.28; k < w + 2 * e; k += 0.56) {
        const s0 = pt(p, x - e + k, y0, z0);
        const s1 = pt(p, x - e + k, y1, z1);
        ctx.beginPath();
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
        ctx.stroke();
      }
    }
    // ridge cap and bright rake edge
    line(ctx, ridgeA, ridgeB, shade(colors.near, 1.4), Math.max(1, ts * 0.06));
    line(ctx, rd, rc, 'rgba(250,236,200,0.5)', Math.max(0.8, ts * 0.035));
    // brick chimney with courses and a cap
    const chim = pt(p, x + w * 0.74, y + d * 0.44, h + roofHeight * 0.92);
    const cw = ts * 0.36;
    const ch = ts * 0.85;
    ctx.fillStyle = '#9a6a52';
    ctx.fillRect(chim.x - cw * 0.3, chim.y - ch, cw, ch);
    ctx.fillStyle = '#6f4a3a';
    ctx.fillRect(chim.x + cw * 0.7, chim.y - ch, cw * 0.3, ch);
    ctx.strokeStyle = 'rgba(230,200,170,0.35)';
    ctx.lineWidth = 0.6;
    for (let r = 1; r < 7; r++) {
      ctx.beginPath();
      ctx.moveTo(chim.x - cw * 0.3, chim.y - (ch * r) / 7);
      ctx.lineTo(chim.x + cw * 0.7, chim.y - (ch * r) / 7);
      ctx.stroke();
    }
    ctx.fillStyle = '#4a4540';
    ctx.fillRect(chim.x - cw * 0.45, chim.y - ch - ts * 0.07, cw * 1.25, ts * 0.1);
    // dormers on the front slope
    const dormers = opts.dormers ?? (h > 2.4 ? 1 : 0);
    for (let k = 0; k < dormers; k++) {
      const fx = x + w * ((k + 1) / (dormers + 1)) - 0.45;
      const yy = y + d * 0.76;
      const z = h + roofHeight * (1 - (yy - (y + d / 2)) / half);
      const base = pt(p, fx, yy, z);
      const dw = ts * 0.9;
      const dh = ts * 0.62;
      ctx.fillStyle = shade(colors.wall, 0.96);
      ctx.fillRect(base.x - dw / 2, base.y - dh, dw, dh);
      const glass = ctx.createLinearGradient(0, base.y - dh, 0, base.y);
      glass.addColorStop(0, '#8fb6b8');
      glass.addColorStop(1, '#2c4a54');
      ctx.fillStyle = glass;
      ctx.fillRect(base.x - dw * 0.3, base.y - dh * 0.86, dw * 0.6, dh * 0.7);
      ctx.strokeStyle = '#f4ecd0';
      ctx.lineWidth = Math.max(0.6, ts * 0.03);
      ctx.strokeRect(base.x - dw * 0.3, base.y - dh * 0.86, dw * 0.6, dh * 0.7);
      poly(ctx, [{ x: base.x - dw * 0.62, y: base.y - dh }, { x: base.x, y: base.y - dh * 1.65 }, { x: base.x + dw * 0.62, y: base.y - dh }], shade(colors.near, 1.15), 'rgba(36,32,26,0.7)');
      poly(ctx, [{ x: base.x, y: base.y - dh * 1.65 }, { x: base.x + dw * 0.62, y: base.y - dh }, { x: base.x + dw * 0.85, y: base.y - dh * 0.8 }, { x: base.x + dw * 0.25, y: base.y - dh * 1.5 }], shade(colors.near, 0.8));
    }
  }
}

function bench(p: Painter, x: number, y: number) {
  const ctx = p.ctx;
  castShadow(p, x, y, 1.2, 0.3, 0.5, 0.18);
  box(p, x, y, 1.2, 0.34, 0.36, 0.44, '#8b6a42');
  box(p, x, y - 0.02, 1.2, 0.06, 0.44, 0.9, '#7b5c38');
  for (const k of [0.06, 1.08]) line(ctx, pt(p, x + k, y + 0.3, 0.36), pt(p, x + k, y + 0.3, 0), '#46371f', p.ts * 0.07);
}

function lampPost(p: Painter, x: number, y: number) {
  const ctx = p.ctx;
  const base = pt(p, x, y);
  const top = pt(p, x, y, 1.9);
  ctx.fillStyle = 'rgba(10,28,18,0.2)';
  ctx.beginPath();
  ctx.ellipse(base.x + p.ts * 0.45, base.y + p.ts * 0.12, p.ts * 0.55, p.ts * 0.14, 0.4, 0, Math.PI * 2);
  ctx.fill();
  line(ctx, base, top, '#2f3a34', Math.max(1.2, p.ts * 0.07));
  ctx.fillStyle = '#2f3a34';
  ctx.fillRect(base.x - p.ts * 0.1, base.y - p.ts * 0.12, p.ts * 0.2, p.ts * 0.12);
  const lw = p.ts * 0.2;
  const lh = p.ts * 0.3;
  const glow = ctx.createLinearGradient(0, top.y - lh, 0, top.y);
  glow.addColorStop(0, '#fff6c8');
  glow.addColorStop(1, '#f1c96a');
  ctx.fillStyle = glow;
  ctx.fillRect(top.x - lw / 2, top.y - lh, lw, lh);
  poly(ctx, [{ x: top.x - lw * 0.8, y: top.y - lh }, { x: top.x, y: top.y - lh - p.ts * 0.18 }, { x: top.x + lw * 0.8, y: top.y - lh }], '#2f3a34');
}

function hedge(p: Painter, x: number, y: number, w: number, d: number, hgt: number) {
  const ctx = p.ctx;
  castShadow(p, x, y, w, d, hgt, 0.2);
  box(p, x, y, w, d, 0, hgt, '#4b8a44');
  // clipped leaf texture on the lit top and front
  for (let k = 0; k < Math.ceil(w * 7); k++) {
    const q = pt(p, x + hash2(k, 3, 1401) * w, y + hash2(k, 5, 1401) * d + d * 0.6, hgt * (0.3 + hash2(k, 7, 1401) * 0.7));
    ctx.fillStyle = hash2(k, 9, 1401) > 0.5 ? 'rgba(170,214,104,0.65)' : 'rgba(24,70,40,0.55)';
    ctx.fillRect(q.x, q.y, Math.max(1, p.ts * 0.07), Math.max(1, p.ts * 0.05));
  }
}

function flowerBox(p: Painter, x: number, y: number, w: number, seed: number) {
  const ctx = p.ctx;
  box(p, x, y, w, 0.42, 0, 0.26, '#a89870');
  flat(p, x + 0.05, y + 0.05, w - 0.1, 0.32, 0.27, '#4a3a28');
  const colors = ['#f1e8c4', '#e46a64', '#f2c14e', '#d68ab6', '#a98ad0'];
  for (let k = 0; k < Math.ceil(w * 9); k++) {
    const q = pt(p, x + 0.1 + hash2(k, seed, 1411) * (w - 0.2), y + 0.1 + hash2(k, seed, 1412) * 0.24, 0.28 + hash2(k, seed, 1413) * 0.1);
    ctx.fillStyle = colors[(k + seed) % colors.length];
    ctx.beginPath();
    ctx.arc(q.x, q.y, Math.max(1, p.ts * 0.05), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(40,110,52,0.9)';
    ctx.fillRect(q.x - 0.4, q.y + p.ts * 0.04, 0.8, p.ts * 0.06);
  }
}

const CAR_COLORS = ['#c8493a', '#3d6aa8', '#e6e0d0', '#3f7a5a', '#d6a63c', '#4b4f58'];

function car(p: Painter, x: number, y: number, seed: number) {
  const ctx = p.ctx;
  const body = CAR_COLORS[seed % CAR_COLORS.length];
  castShadow(p, x, y, 0.8, 1.3, 0.5, 0.24);
  for (const [wx, wy] of [[0.05, 0.25], [0.75, 0.25], [0.05, 1.05], [0.75, 1.05]]) {
    const q = pt(p, x + wx, y + wy, 0.06);
    ctx.fillStyle = '#23262a';
    ctx.beginPath();
    ctx.ellipse(q.x, q.y, p.ts * 0.05, p.ts * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  box(p, x, y, 0.8, 1.3, 0.08, 0.32, body, 'rgba(20,24,24,0.4)');
  // glass cabin, narrower and set back, with a pale windscreen toward the front (+y)
  box(p, x + 0.07, y + 0.3, 0.66, 0.6, 0.32, 0.54, shade(body, 0.95), 'rgba(20,24,24,0.4)');
  poly(ctx, [pt(p, x + 0.1, y + 0.9, 0.34), pt(p, x + 0.7, y + 0.9, 0.34), pt(p, x + 0.7, y + 0.9, 0.52), pt(p, x + 0.1, y + 0.9, 0.52)], '#7fa5ad');
  poly(ctx, [pt(p, x + 0.73, y + 0.32, 0.34), pt(p, x + 0.73, y + 0.88, 0.34), pt(p, x + 0.73, y + 0.88, 0.52), pt(p, x + 0.73, y + 0.32, 0.52)], '#45646c');
  const hl = pt(p, x + 0.12, y + 1.3, 0.2);
  ctx.fillStyle = '#fff4c8';
  ctx.fillRect(hl.x, hl.y - 1, Math.max(1.5, p.ts * 0.07), Math.max(1, p.ts * 0.04));
  const hr = pt(p, x + 0.58, y + 1.3, 0.2);
  ctx.fillRect(hr.x, hr.y - 1, Math.max(1.5, p.ts * 0.07), Math.max(1, p.ts * 0.04));
}

function golfCart(p: Painter, x: number, y: number, seed: number) {
  const ctx = p.ctx;
  const trim = ['#3f7a5a', '#c8493a', '#3d6aa8'][seed % 3];
  castShadow(p, x, y, 1.1, 0.7, 1, 0.22);
  for (const wx of [0.12, 0.92]) {
    for (const wy of [0.1, 0.6]) {
      const q = pt(p, x + wx, y + wy, 0.1);
      ctx.fillStyle = '#23262a';
      ctx.beginPath();
      ctx.ellipse(q.x, q.y, p.ts * 0.07, p.ts * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  box(p, x, y, 1.1, 0.7, 0.14, 0.42, '#ece4cc', 'rgba(50,50,40,0.45)');
  box(p, x + 0.7, y + 0.04, 0.34, 0.62, 0.42, 0.55, trim);
  box(p, x + 0.08, y + 0.08, 0.5, 0.54, 0.42, 0.52, '#d9d0b4');
  // bag rack and clubs
  box(p, x + 0.02, y + 0.1, 0.2, 0.5, 0.42, 0.9, '#3a3f46');
  for (const wy of [0.12, 0.55]) line(p.ctx, pt(p, x + 0.9, y + wy, 0.5), pt(p, x + 0.9, y + wy, 1.15), '#6b6b60', p.ts * 0.03);
  poly(ctx, [pt(p, x - 0.05, y - 0.04, 1.15), pt(p, x + 1.15, y - 0.04, 1.15), pt(p, x + 1.15, y + 0.76, 1.15), pt(p, x - 0.05, y + 0.76, 1.15)], '#f2ead0', 'rgba(110,104,80,0.6)');
}

// ---------- clubhouse ----------
const CLUB_COLORS: HouseColors = { wall: '#efe4bd', side: '#bfb58f', roof: '#7a4a3a', near: '#9a5a44' };

/** Flat ground details for the clubhouse grounds: painted parking, path joins. Called before the sorted pass. */
export function drawClubGround(p: Painter, g: Game) {
  void g;
  const ctx = p.ctx;
  // parking: painted bays along the lower road
  const y0 = 47.15;
  const y1 = 48.8;
  for (let k = 0; k <= 6; k++) {
    const x = 1.2 + k * 1.45;
    line(ctx, pt(p, x, y0), pt(p, x, y1), 'rgba(250,246,232,0.8)', Math.max(0.8, p.ts * 0.045));
  }
  line(ctx, pt(p, 1.2, y0), pt(p, 1.2 + 6 * 1.45, y0), 'rgba(250,246,232,0.65)', Math.max(0.8, p.ts * 0.04));
  // wheel stops and an accessible bay mark
  for (let k = 0; k < 6; k++) {
    const x = 1.2 + k * 1.45 + 0.35;
    line(ctx, pt(p, x, y0 + 0.14), pt(p, x + 0.75, y0 + 0.14), 'rgba(120,112,92,0.6)', Math.max(1, p.ts * 0.06));
  }
  const mark = pt(p, 1.2 + 0.72, y1 - 0.4);
  ctx.fillStyle = 'rgba(60,110,190,0.85)';
  ctx.beginPath();
  ctx.ellipse(mark.x, mark.y, p.ts * 0.2, p.ts * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawCountryClub(p: Painter, g: Game, time: number) {
  const ctx = p.ctx;
  const ts = p.ts;
  const l = g.clubLevel;
  const colors = CLUB_COLORS;
  const mainX = l ? 5 : 3.2;
  const mainW = l ? 5 : 6.2;
  if (l >= 1) house(p, 3.2, 40.9, 2.2, 4.6, 1.45, 1.1, colors, { shutters: true, dormers: 0 });
  house(p, mainX, 41, mainW, 4.3, l >= 2 ? 3.1 : 1.65, l >= 2 ? 1.7 : 1.2, colors, { shutters: true, dormers: l >= 1 ? 2 : 1 });
  if (l >= 2) {
    house(p, 9.3, 41.4, 2.1, 3.8, 1.8, 1.15, colors, { shutters: true, dormers: 0 });
    house(p, 5.5, 42, 1.7, 1.6, 3.9, 0.9, colors, { detail: false });
  }
  // veranda: deck, columns with capitals, striped awning with a scalloped edge, railings and steps
  const vy = 45.6;
  const vx = l ? 5.3 : 3.6;
  const vw = l ? 4.2 : 5.2;
  castShadow(p, vx, vy, vw, 0.9, 1, 0.18);
  flat(p, vx, vy, vw, 0.9, 0.12, '#c9bd9c', 'rgba(90,84,60,0.6)');
  for (let k = 0; k < vw; k += 0.5) line(ctx, pt(p, vx + k, vy, 0.12), pt(p, vx + k, vy + 0.9, 0.12), 'rgba(120,108,80,0.3)', 0.6);
  box(p, vx, vy + 0.9, vw, 0.06, 0, 0.12, '#a89c7c');
  const stepX = vx + vw / 2 - 0.6;
  box(p, stepX, vy + 0.96, 1.2, 0.26, 0, 0.06, '#bcb090');
  box(p, stepX + 0.05, vy + 0.96, 1.1, 0.14, 0.06, 0.12, '#cfc4a4');
  // awning: alternating cream / sage stripes sloping down to the front edge
  const stripeCount = Math.round(vw / 0.5);
  for (let k = 0; k < stripeCount; k++) {
    const sx = vx - 0.12 + ((vw + 0.24) * k) / stripeCount;
    const ex = vx - 0.12 + ((vw + 0.24) * (k + 1)) / stripeCount;
    poly(ctx, [pt(p, sx, vy - 0.05, 1.12), pt(p, ex, vy - 0.05, 1.12), pt(p, ex, vy + 1.05, 0.88), pt(p, sx, vy + 1.05, 0.88)], k % 2 ? '#7b9a74' : '#f1e8c8', 'rgba(70,80,60,0.25)', 0.5);
    poly(ctx, [pt(p, sx, vy + 1.05, 0.88), pt(p, ex, vy + 1.05, 0.88), pt(p, (sx + ex) / 2, vy + 1.05, 0.76)], k % 2 ? '#6a8a64' : '#e4d9b4');
  }
  for (let k = 0; k <= vw; k += vw / Math.max(2, Math.round(vw / 1.05))) {
    const base = pt(p, vx + k, vy + 0.82, 0.12);
    const top = pt(p, vx + k, vy + 0.82, 0.86);
    line(ctx, base, top, '#f1e8c8', Math.max(1.4, ts * 0.1));
    line(ctx, { x: base.x - ts * 0.03, y: base.y }, { x: top.x - ts * 0.03, y: top.y }, 'rgba(255,255,248,0.6)', Math.max(0.6, ts * 0.035));
    poly(ctx, [{ x: top.x - ts * 0.09, y: top.y }, { x: top.x + ts * 0.09, y: top.y }, { x: top.x + ts * 0.09, y: top.y + ts * 0.05 }, { x: top.x - ts * 0.09, y: top.y + ts * 0.05 }], '#d8cfae');
  }
  for (let k = 0; k < vw - 0.2; k += 0.3) {
    if (k > vw / 2 - 0.7 && k < vw / 2 + 0.5) continue;
    line(ctx, pt(p, vx + k, vy + 0.82, 0.12), pt(p, vx + k, vy + 0.82, 0.44), 'rgba(246,238,210,0.8)', Math.max(0.5, ts * 0.03));
  }
  line(ctx, pt(p, vx, vy + 0.82, 0.44), pt(p, vx + vw / 2 - 0.7, vy + 0.82, 0.44), '#f1e8c8', Math.max(0.8, ts * 0.04));
  line(ctx, pt(p, vx + vw / 2 + 0.5, vy + 0.82, 0.44), pt(p, vx + vw, vy + 0.82, 0.44), '#f1e8c8', Math.max(0.8, ts * 0.04));

  // landscaping: clipped hedges either side of the steps, flower boxes, lamps
  hedge(p, vx + 0.1, vy + 1.1, vw / 2 - 1, 0.42, 0.34);
  hedge(p, vx + vw / 2 + 0.9, vy + 1.1, vw / 2 - 1, 0.42, 0.34);
  flowerBox(p, vx + 0.1, vy + 1.62, Math.min(1.4, vw / 2 - 1), 1);
  flowerBox(p, vx + vw - 1.5, vy + 1.62, Math.min(1.4, vw / 2 - 1), 2);
  lampPost(p, vx - 0.4, vy + 1.3);
  lampPost(p, vx + vw + 0.4, vy + 1.3);
  lampPost(p, 10.6, 46.7);

  // entrance sign on two posts, standing on the lawn by the plaza corner
  const sx = 10.2;
  const sy = 41.2;
  castShadow(p, sx, sy, 2.4, 0.1, 0.9, 0.18);
  line(ctx, pt(p, sx + 0.15, sy, 0), pt(p, sx + 0.15, sy, 0.95), '#4b3a28', ts * 0.09);
  line(ctx, pt(p, sx + 2.25, sy, 0), pt(p, sx + 2.25, sy, 0.95), '#4b3a28', ts * 0.09);
  poly(ctx, [pt(p, sx, sy, 0.45), pt(p, sx + 2.4, sy, 0.45), pt(p, sx + 2.4, sy, 0.98), pt(p, sx, sy, 0.98)], '#355a40', '#e6d9a6', 1);
  wallText(p, l >= 2 ? 'COUNTRY CLUB' : 'CLUBHOUSE', sx + 1.2, sy, 0.72, ts * 0.17, '#f1e4b0');

  // flag
  const flag = pt(p, 10.2, 46.2);
  const wave = Math.sin(time * 2.5) * ts * 0.06;
  ctx.strokeStyle = '#f1e8c8';
  ctx.lineWidth = Math.max(1, ts * 0.04);
  ctx.beginPath();
  ctx.moveTo(flag.x, flag.y);
  ctx.lineTo(flag.x, flag.y - ts * 2.7);
  ctx.stroke();
  ctx.fillStyle = 'rgba(10,28,18,0.2)';
  ctx.beginPath();
  ctx.ellipse(flag.x + ts * 0.4, flag.y + ts * 0.08, ts * 0.42, ts * 0.09, 0.4, 0, Math.PI * 2);
  ctx.fill();
  poly(ctx, [{ x: flag.x, y: flag.y - ts * 2.7 }, { x: flag.x + ts * 0.85, y: flag.y - ts * 2.46 + wave }, { x: flag.x, y: flag.y - ts * 2.2 }], '#e0b64a', 'rgba(110,80,20,0.5)');

  // parked cars on the painted bays
  for (let k = 0; k < 6; k++) {
    if (hash2(k, 4, 1500) < 0.45) continue;
    car(p, 1.2 + k * 1.45 + 0.32, 47.3, k + 2);
  }
}

// ---------- village amenities ----------
export function drawVillageAmenities(p: Painter, g: Game) {
  const c = p.ctx;
  const u = p.ts;
  const colors: HouseColors = { wall: '#e0d3ae', side: '#a9b68f', roof: '#668060', near: '#7a9a70' };
  if (g.upgrades.snackBar) house(p, 11.3, 38.5, 1.8, 1.5, 1.1, 0.7, { wall: '#efe0b8', side: '#bfae88', roof: '#b0623e', near: '#cf7c4a' }, { shutters: true, dormers: 0 });
  if (g.upgrades.proShop) house(p, 14.4, 39.7, 2.4, 1.8, 1.5, 0.9, colors, { shutters: true, dormers: 0, sign: 'PRO SHOP' });
  if (g.upgrades.crew) house(p, 18.5, 44.1, 2.8, 2.2, 1.2, 0.7, { ...colors, wall: '#a9a883', side: '#7a8760' }, { dormers: 0 });
  if (g.upgrades.puttingGreen) {
    const pts = Array.from({ length: 20 }, (_, i) => pt(p, 17 + Math.cos((i * Math.PI) / 10) * 2.05, 37.5 + Math.sin((i * Math.PI) / 10) * 1.25));
    const edge = Array.from({ length: 20 }, (_, i) => pt(p, 17 + Math.cos((i * Math.PI) / 10) * 2.3, 37.5 + Math.sin((i * Math.PI) / 10) * 1.5));
    poly(c, edge, '#8fcf74');
    poly(c, pts, '#aee07e', '#5f9e55');
    const a = pt(p, 17, 37.5);
    c.fillStyle = '#1b2a1b';
    c.beginPath();
    c.ellipse(a.x, a.y, u * 0.08, u * 0.04, 0, 0, Math.PI * 2);
    c.fill();
    line(c, a, { x: a.x, y: a.y - u * 0.95 }, '#f1e8c8', Math.max(1, u * 0.04));
    poly(c, [{ x: a.x, y: a.y - u * 0.95 }, { x: a.x + u * 0.38, y: a.y - u * 0.8 }, { x: a.x, y: a.y - u * 0.65 }], '#d2432f');
  }
  if (g.upgrades.range) {
    flat(p, 12, 34, 4, 1.2, 0, '#9bb27c', 'rgba(90,110,70,0.6)');
    for (let i = 0; i < 4; i++) {
      flat(p, 12.08 + i, 34.08, 0.84, 0.84, 0.01, '#3f7a4a', 'rgba(210,214,170,0.7)');
      flat(p, 12.38 + i, 34.38, 0.22, 0.22, 0.02, '#f4efd8');
    }
  }
  if (g.experience.site.terrace) {
    castShadow(p, 11.5, 42, 4, 3, 0.1, 0.1);
    flat(p, 11.5, 42, 4, 3, 0.1, '#d4c8a6', 'rgba(140,134,104,0.7)');
    for (let k = 0; k < 4; k++) line(c, pt(p, 11.5 + k + 1, 42, 0.1), pt(p, 11.5 + k + 1, 45, 0.1), 'rgba(130,120,96,0.3)', 0.6);
    for (const [x, y] of [[12.5, 43], [14.5, 44]]) {
      const a = pt(p, x, y);
      const top = pt(p, x, y, 1.3);
      c.fillStyle = 'rgba(10,28,18,0.2)';
      c.beginPath();
      c.ellipse(a.x + u * 0.5, a.y + u * 0.1, u * 0.8, u * 0.22, 0.3, 0, Math.PI * 2);
      c.fill();
      box(p, x - 0.35, y - 0.35, 0.7, 0.7, 0.3, 0.38, '#8b6a42');
      line(c, a, top, '#7e7055', u * 0.05);
      const wedges = 8;
      for (let k = 0; k < wedges; k++) {
        const a0 = (k * 2 * Math.PI) / wedges;
        const a1 = ((k + 1) * 2 * Math.PI) / wedges;
        c.fillStyle = k % 2 ? '#f1e8c8' : '#d57a5a';
        c.beginPath();
        c.moveTo(top.x, top.y - u * 0.16);
        c.lineTo(top.x + Math.cos(a0) * u * 0.78, top.y + Math.sin(a0) * u * 0.34);
        c.lineTo(top.x + Math.cos(a1) * u * 0.78, top.y + Math.sin(a1) * u * 0.34);
        c.closePath();
        c.fill();
      }
    }
  }
  if (g.experience.site.garden) {
    flat(p, 8.5, 37, 2.5, 1.3, 0.04, '#5a432e', 'rgba(150,130,90,0.8)');
    for (let k = 0; k < 44; k++) {
      const a = pt(p, 8.6 + hash2(k, 1, 9) * 2.3, 37.1 + hash2(k, 2, 9) * 1.1, 0.12);
      c.strokeStyle = 'rgba(40,110,52,0.9)';
      c.lineWidth = 0.9;
      c.beginPath();
      c.moveTo(a.x, a.y + u * 0.08);
      c.lineTo(a.x, a.y);
      c.stroke();
      c.fillStyle = ['#f1e8c8', '#d68ab6', '#f2c14e', '#e46a64'][k % 4];
      c.beginPath();
      c.arc(a.x, a.y, Math.max(1, u * 0.06), 0, Math.PI * 2);
      c.fill();
    }
    bench(p, 8.8, 38.8);
  }
  // parked buggies with roofs, seats and wheels
  if (g.upgrades.carts) for (let k = 0; k < 3; k++) golfCart(p, 12 + k * 1.8, 47, k);
}
