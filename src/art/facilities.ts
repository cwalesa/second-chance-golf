// Course facilities and golf carts, modelled as small 3D meshes and drawn through the same isometric
// projection as the ground, the trees and the clubhouse. Every face is lit from one sun (upper left of the
// screen, so +y fronts are half-lit and +x sides fall in shade), faces turned away from the camera are
// culled, and the rest are painted back to front. Because carts are geometry rather than a flat picture,
// they keep a correct perspective at any heading.
import type { Painter } from './buildings';
import { ISO_X, ISO_Y } from '../isometric';

type V3 = [number, number, number];
interface Face {
  kind: 'poly' | 'line' | 'ring' | 'text';
  p: V3[];
  /** outward normal; faces whose normal points away from the camera are not drawn */
  n: V3 | null;
  c: string;
  /** false for paint that does not take the sun: glass, glow, interior shade */
  lit: boolean;
  alpha: number;
  /** outline colour, or null for none */
  edge: string | null;
  /** darken a wall toward its foot */
  grad: boolean;
  bias: number;
  w?: number;
  text?: { s: string; size: number; u: V3; v: V3 };
}

// ---------- colour ----------
const hexRgb = (h: string): [number, number, number] => {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
};
const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
function tone(hex: string, f: number): string {
  if (!hex.startsWith('#')) return hex;
  const [r, g, b] = hexRgb(hex);
  // a touch warmer in the light, a touch cooler in the shade
  const warm = f > 1 ? (f - 1) * 18 : 0;
  const cool = f < 0.8 ? (0.8 - f) * 30 : 0;
  return `rgb(${cl(r * f + warm)},${cl(g * f + warm * 0.6)},${cl(b * f + cool)})`;
}

const VIEW: V3 = [1, 1, 1]; // toward the camera
const SUN: V3 = (() => {
  const v: V3 = [-0.32, 0.44, 0.84];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const light = (n: V3) => 0.66 + 0.44 * Math.max(0, dot(n, SUN));

// ---------- building a mesh ----------
interface FaceOpts {
  lit?: boolean;
  alpha?: number;
  edge?: string | null;
  grad?: boolean;
  bias?: number;
}
const EDGE = 'rgba(28,26,46,0.9)';

export class Mesh {
  faces: Face[] = [];
  quad(p: V3[], n: V3, c: string, o: FaceOpts = {}) {
    this.faces.push({ kind: 'poly', p, n: norm(n), c, lit: o.lit ?? true, alpha: o.alpha ?? 1, edge: o.edge === undefined ? EDGE : o.edge, grad: o.grad ?? false, bias: o.bias ?? 0 });
    return this;
  }
  /** a face with no culling (both sides can be seen), e.g. a sign on a post */
  flat(p: V3[], c: string, o: FaceOpts = {}) {
    this.faces.push({ kind: 'poly', p, n: null, c, lit: o.lit ?? false, alpha: o.alpha ?? 1, edge: o.edge === undefined ? null : o.edge, grad: false, bias: o.bias ?? 0 });
    return this;
  }
  line(a: V3, b: V3, c: string, w: number, n: V3 | null = null, bias = 0.002) {
    this.faces.push({ kind: 'line', p: [a, b], n: n ? norm(n) : null, c, lit: false, alpha: 1, edge: null, grad: false, bias, w });
    return this;
  }
  /** a circle (outline) in the plane spanned by unit vectors a and b */
  ring(c0: V3, a: V3, b: V3, r: number, c: string, w: number, bias = 0.004) {
    const p: V3[] = [];
    for (let k = 0; k < 14; k++) {
      const t = (k / 14) * Math.PI * 2;
      p.push([c0[0] + (a[0] * Math.cos(t) + b[0] * Math.sin(t)) * r, c0[1] + (a[1] * Math.cos(t) + b[1] * Math.sin(t)) * r, c0[2] + (a[2] * Math.cos(t) + b[2] * Math.sin(t)) * r]);
    }
    this.faces.push({ kind: 'ring', p, n: null, c, lit: false, alpha: 1, edge: null, grad: false, bias, w });
    return this;
  }
  text(o: V3, u: V3, v: V3, s: string, size: number, c: string, n: V3) {
    this.faces.push({ kind: 'text', p: [o], n: norm(n), c, lit: false, alpha: 1, edge: null, grad: false, bias: 0.006, text: { s, size, u, v } });
    return this;
  }
  /** axis-aligned box; `faces` overrides colours per side (px, nx, py, ny, pz) */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: string, o: FaceOpts & { faces?: Partial<Record<'px' | 'nx' | 'py' | 'ny' | 'pz', string>>; top?: boolean } = {}) {
    const f = o.faces ?? {};
    const w = o.grad ?? true;
    this.quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0], f.px ?? c, { ...o, grad: w });
    this.quad([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], [-1, 0, 0], f.nx ?? c, { ...o, grad: w });
    this.quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], f.py ?? c, { ...o, grad: w });
    this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], f.ny ?? c, { ...o, grad: w });
    if (o.top !== false) this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], f.pz ?? c, { ...o, grad: false });
    return this;
  }
  /** a prism: a convex profile in the x-z plane, extruded from y0 to y1 */
  prismY(profile: [number, number][], y0: number, y1: number, c: string, o: FaceOpts & { cap?: string } = {}) {
    const n = profile.length;
    // orient the profile counter-clockwise (x right, z up) so edge normals point outward
    let area = 0;
    for (let i = 0; i < n; i++) { const [a, b] = profile[i], [d, e] = profile[(i + 1) % n]; area += a * e - d * b; }
    const pr = area < 0 ? [...profile].reverse() : profile;
    for (let i = 0; i < n; i++) {
      const [ax, az] = pr[i], [bx, bz] = pr[(i + 1) % n];
      this.quad([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], [bz - az, 0, -(bx - ax)], c, { ...o, grad: false });
    }
    this.quad(pr.map(([x, z]) => [x, y1, z] as V3), [0, 1, 0], o.cap ?? c, o);
    this.quad(pr.map(([x, z]) => [x, y0, z] as V3), [0, -1, 0], o.cap ?? c, o);
    return this;
  }
  /** a cylinder; axis 'z' stands upright, 'y' lies across (wheels on a cart facing +x) */
  cyl(cx: number, cy: number, cz: number, r: number, len: number, axis: 'y' | 'z' | 'x', c: string, o: FaceOpts & { cap?: string; sides?: number } = {}) {
    const N = o.sides ?? 12;
    const at = (t: number, s: number): V3 => {
      const a = Math.cos(t) * r, b = Math.sin(t) * r;
      return axis === 'z' ? [cx + a, cy + b, cz + s] : axis === 'y' ? [cx + a, cy + s, cz + b] : [cx + s, cy + a, cz + b];
    };
    for (let k = 0; k < N; k++) {
      const t0 = (k / N) * Math.PI * 2, t1 = ((k + 1) / N) * Math.PI * 2, tm = (t0 + t1) / 2;
      const nn: V3 = axis === 'z' ? [Math.cos(tm), Math.sin(tm), 0] : axis === 'y' ? [Math.cos(tm), 0, Math.sin(tm)] : [0, Math.cos(tm), Math.sin(tm)];
      this.quad([at(t0, 0), at(t1, 0), at(t1, len), at(t0, len)], nn, c, { ...o, edge: null, grad: false });
    }
    const cap = (s: number, n: V3) => this.quad(Array.from({ length: N }, (_, k) => at((k / N) * Math.PI * 2, s)), n, o.cap ?? c, { ...o, grad: false });
    if (axis === 'z') { cap(len, [0, 0, 1]); }
    else if (axis === 'y') { cap(len, [0, 1, 0]); cap(0, [0, -1, 0]); }
    else { cap(len, [1, 0, 0]); cap(0, [-1, 0, 0]); }
    return this;
  }
  /** a gable roof with its ridge along x, real thickness at the eaves and rakes, overhanging the walls */
  gableX(x0: number, x1: number, y0: number, y1: number, zEave: number, rise: number, roof: string, fascia: string, o: { ex?: number; ey?: number; t?: number; wall?: string; courses?: 'shingle' | 'seam'; wallSide?: string } = {}) {
    const ex = o.ex ?? 0.16, ey = o.ey ?? 0.22, t = o.t ?? 0.08;
    const ym = (y0 + y1) / 2, run = (y1 - y0) / 2, zR = zEave + rise;
    const slope = rise / run;
    const zE = zEave - ey * slope; // the slope carries on past the wall to the eave
    const X0 = x0 - ex, X1 = x1 + ex, Y0 = y0 - ey, Y1 = y1 + ey;
    // gable end walls (under the roof)
    if (o.wall) {
      this.quad([[x1, y0, zEave], [x1, y1, zEave], [x1, ym, zR]], [1, 0, 0], o.wallSide ?? o.wall, { grad: false });
      this.quad([[x0, y0, zEave], [x0, y1, zEave], [x0, ym, zR]], [-1, 0, 0], o.wall, { grad: false });
    }
    // slopes
    const nf: V3 = [0, rise, run], nb: V3 = [0, -rise, run];
    this.quad([[X0, ym, zR], [X1, ym, zR], [X1, Y1, zE], [X0, Y1, zE]], nf, roof);
    this.quad([[X0, ym, zR], [X1, ym, zR], [X1, Y0, zE], [X0, Y0, zE]], nb, roof);
    // thickness: the eave edge and the rakes
    this.quad([[X0, Y1, zE], [X1, Y1, zE], [X1, Y1, zE - t], [X0, Y1, zE - t]], [0, 1, 0], fascia, { bias: 0.003 });
    this.quad([[X1, ym, zR], [X1, Y1, zE], [X1, Y1, zE - t], [X1, ym, zR - t]], [1, 0, 0], fascia, { bias: 0.003 });
    this.quad([[X1, ym, zR], [X1, Y0, zE], [X1, Y0, zE - t], [X1, ym, zR - t]], [1, 0, 0], fascia, { bias: 0.003 });
    // the soffit under the front eave, in shadow (seen only at a glance, but it makes the overhang read)
    // courses on the front slope: shingle rows across, or standing seams down
    const along = (yy: number): V3 => [0, yy, zR - (Math.abs(yy - ym) / run) * rise];
    if (o.courses === 'seam') {
      for (let x = X0 + 0.2; x < X1 - 0.05; x += 0.22) {
        const a = along(ym), b = along(Y1);
        this.line([x, a[1], a[2] + 0.004], [x, b[1], b[2] + 0.004], 'rgba(255,255,255,0.22)', 0.03, nf);
        this.line([x + 0.03, a[1], a[2] + 0.004], [x + 0.03, b[1], b[2] + 0.004], 'rgba(20,24,24,0.2)', 0.025, nf);
      }
    } else {
      for (let yy = ym + 0.16; yy < Y1 - 0.02; yy += 0.16) {
        const z = zR - ((yy - ym) / run) * rise;
        this.line([X0, yy, z + 0.003], [X1, yy, z + 0.003], 'rgba(28,20,14,0.26)', 0.022, nf);
      }
    }
    // ridge cap
    this.box(X0, ym - 0.05, zR - 0.02, X1, ym + 0.05, zR + 0.05, roof, { grad: false, faces: { pz: tone(roof.startsWith('#') ? roof : '#666666', 1.18) } });
    return { zR, ym };
  }
}

// ---------- drawing ----------
interface Prepared { faces: Face[] }
const prepCache = new Map<string, Prepared>();

function transform(v: V3, cos: number, sin: number): V3 {
  return [v[0] * cos - v[1] * sin, v[0] * sin + v[1] * cos, v[2]];
}
/** Rotate, cull and sort once per mesh and heading; the result is reused every frame. */
function prepare(key: string, mesh: Mesh, heading: number): Prepared {
  const hit = prepCache.get(key);
  if (hit) return hit;
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const faces: (Face & { d: number })[] = [];
  for (const f of mesh.faces) {
    const n = f.n ? transform(f.n, cos, sin) : null;
    if (n && dot(n, VIEW) <= 0.002) continue;
    const p = f.p.map((v) => transform(v, cos, sin));
    let d = 0;
    for (const q of p) d += q[0] + q[1] + q[2];
    d = d / p.length + f.bias;
    const tx = f.text ? { ...f.text, u: transform(f.text.u, cos, sin), v: transform(f.text.v, cos, sin) } : undefined;
    faces.push({ ...f, p, n, text: tx, d });
  }
  faces.sort((a, b) => a.d - b.d);
  const out = { faces };
  if (prepCache.size > 400) prepCache.clear();
  prepCache.set(key, out);
  return out;
}

function draw(P: Painter, prep: Prepared, ox: number, oy: number, alpha = 1) {
  const ctx = P.ctx;
  const ts = P.ts;
  const o0 = P.toScreen(ox, oy);
  // the projection is affine, so a world offset is a fixed screen offset: project with arithmetic, not calls
  const kx = ISO_X * ts, ky = ISO_Y * ts;
  const sx = (v: V3) => o0.x + (v[0] - v[1]) * kx;
  const sy = (v: V3) => o0.y + (v[0] + v[1]) * ky - v[2] * ts;
  const lw = Math.max(2.6, ts * 0.1); // thick ink edges on every face: the chunky look
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const f of prep.faces) {
    const a = f.alpha * alpha;
    if (f.kind === 'poly') {
      const lt = f.lit && f.n ? light(f.n) : 1;
      let fill: string | CanvasGradient = f.lit ? tone(f.c, lt) : f.c;
      ctx.beginPath();
      let top = Infinity, bot = -Infinity;
      f.p.forEach((v, i) => {
        const X = sx(v), Y = sy(v);
        if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
        if (Y < top) top = Y;
        if (Y > bot) bot = Y;
      });
      ctx.closePath();
      if (f.grad && f.lit && bot - top > 2) {
        const g = ctx.createLinearGradient(0, top, 0, bot);
        g.addColorStop(0, tone(f.c, lt * 1.03));
        g.addColorStop(1, tone(f.c, lt * 0.84));
        fill = g;
      }
      ctx.globalAlpha = a;
      ctx.fillStyle = fill;
      ctx.fill();
      if (f.edge) {
        ctx.strokeStyle = f.edge;
        ctx.lineWidth = lw;
        ctx.stroke();
      } else if (a >= 1) {
        // close the hairline gap anti-aliasing leaves between neighbouring faces
        ctx.strokeStyle = typeof fill === 'string' ? fill : tone(f.c, lt * 0.93);
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    } else if (f.kind === 'line' || f.kind === 'ring') {
      ctx.globalAlpha = a;
      ctx.strokeStyle = f.c;
      ctx.lineWidth = Math.max(0.5, (f.w ?? 0.02) * ts);
      ctx.beginPath();
      f.p.forEach((v, i) => (i ? ctx.lineTo(sx(v), sy(v)) : ctx.moveTo(sx(v), sy(v))));
      if (f.kind === 'ring') ctx.closePath();
      ctx.stroke();
    } else if (f.kind === 'text' && f.text && ts >= 14) {
      const t = f.text, o = f.p[0];
      const ux = (t.u[0] - t.u[1]) * kx, uy = (t.u[0] + t.u[1]) * ky - t.u[2] * ts;
      const vx = (t.v[0] - t.v[1]) * kx, vy = (t.v[0] + t.v[1]) * ky - t.v[2] * ts;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(sx(o), sy(o));
      ctx.transform(ux / 100, uy / 100, -vx / 100, -vy / 100, 0, 0);
      ctx.fillStyle = f.c;
      ctx.font = `700 ${Math.round(t.size * 100)}px Georgia, 'Iowan Old Style', serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.s, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}

// ---------- sprite cache ----------
// Building a frame from a hundred lit polygons is too slow to repeat for every object every frame, so each
// object is painted once into an offscreen canvas at the current zoom (in 9% steps, at full device
// resolution) and stamped from there. The projection is affine, so a stamp is exact up to that step.
const sprites = new Map<string, { cv: HTMLCanvasElement; ox: number; oy: number; ts: number; sc: number }>();
let spritePx = 0;
const SPRITE_BUDGET = 4_000_000;
function cached(P: Painter, key: string, x: number, y: number, ext: [number, number, number, number], tall: number, alpha: number, paint: (Q: Painter) => void) {
  const ctx = P.ctx;
  const sc = Math.max(1, Math.min(4, ctx.getTransform().a || 1));
  const tsq = Math.pow(2, Math.round(Math.log2(Math.max(2, P.ts)) * 8) / 8);
  const full = `${key}@${tsq.toFixed(3)}x${sc}`;
  let sp = sprites.get(full);
  if (!sp) {
    const [x0, y0, x1, y1] = ext;
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([a, b]) => ({ x: (a - b) * ISO_X * tsq, y: (a + b) * ISO_Y * tsq }));
    const minX = Math.min(...corners.map((c) => c.x)) - 4, maxX = Math.max(...corners.map((c) => c.x)) + 4;
    const minY = Math.min(...corners.map((c) => c.y)) - tall * tsq - 4, maxY = Math.max(...corners.map((c) => c.y)) + 4;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil((maxX - minX) * sc));
    cv.height = Math.max(1, Math.ceil((maxY - minY) * sc));
    const c2 = cv.getContext('2d')!;
    c2.setTransform(sc, 0, 0, sc, 0, 0);
    paint({ ctx: c2, ts: tsq, toScreen: (a: number, b: number) => ({ x: (a - b) * ISO_X * tsq - minX, y: (a + b) * ISO_Y * tsq - minY }) });
    sp = { cv, ox: minX, oy: minY, ts: tsq, sc };
    // iPhone Safari has a hard cap on total canvas memory, and going past it breaks other canvases (the
    // ground turned white). Keep the stamps under a pixel budget and free evicted ones at once.
    spritePx += cv.width * cv.height;
    while (sprites.size && (spritePx > SPRITE_BUDGET || sprites.size > 60)) {
      const oldKey = sprites.keys().next().value!;
      const old = sprites.get(oldKey)!;
      spritePx -= old.cv.width * old.cv.height;
      old.cv.width = old.cv.height = 0;
      sprites.delete(oldKey);
    }
    sprites.set(full, sp);
  } else {
    // keep recently used stamps at the back of the queue
    sprites.delete(full);
    sprites.set(full, sp);
  }
  const o = P.toScreen(x, y);
  const k = P.ts / sp.ts;
  const prev = ctx.globalAlpha;
  if (alpha !== 1) ctx.globalAlpha = prev * alpha;
  ctx.drawImage(sp.cv, o.x + sp.ox * k, o.y + sp.oy * k, (sp.cv.width / sp.sc) * k, (sp.cv.height / sp.sc) * k);
  ctx.globalAlpha = prev;
}

/** Soft shadow on the ground: a tight contact shade under the footprint and a longer cast toward +x (screen lower right). */
function groundShadow(P: Painter, x0: number, y0: number, x1: number, y1: number, height: number, ox: number, oy: number, strength = 1) {
  const ctx = P.ctx;
  const sp = (x: number, y: number) => P.toScreen(ox + x, oy + y);
  const k = height * 0.75;
  const layers: [number, number][] = [[0.13 * strength, 1], [0.1 * strength, 0.72]];
  for (const [a, f] of layers) {
    ctx.fillStyle = `rgba(14,32,20,${a})`;
    ctx.beginPath();
    const q = [sp(x0, y0), sp(x1, y0), sp(x1 + k * f, y0 + k * 0.28 * f), sp(x1 + k * f, y1 + k * 0.28 * f), sp(x1, y1), sp(x0, y1)];
    q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  }
  // contact shade hugging the base
  ctx.fillStyle = `rgba(10,24,16,${0.24 * strength})`;
  ctx.beginPath();
  const e = 0.07;
  const q = [sp(x0 - e, y0 - e), sp(x1 + e, y0 - e), sp(x1 + e, y1 + e), sp(x0 - e, y1 + e)];
  q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();
}

// =====================================================================================================
// Golf cart. Local frame: nose toward +x, centred on the origin, wheels on the ground. 1 unit = 1 tile,
// and a golfer is about 1 unit tall, so the cart is ~1.36 long, 0.7 wide and 1.2 to the roof.
// =====================================================================================================
export const CART_TRIMS = ['#2f6a4b', '#8e3a2e', '#2f4f74', '#c39a3a'];
const cartMeshes = new Map<number, Mesh>();
function cartMesh(trim: number): Mesh {
  const hit = cartMeshes.get(trim);
  if (hit) return hit;
  const m = new Mesh();
  const body = '#ece6d6';
  const dark = '#2b2e30';
  const t = CART_TRIMS[trim % CART_TRIMS.length];
  // frame and wheels
  m.box(-0.6, -0.27, 0.1, 0.64, 0.27, 0.2, '#3a3d40', { grad: false, edge: null });
  for (const wx of [-0.42, 0.44])
    for (const wy of [-0.36, 0.28]) {
      m.cyl(wx, wy, 0.14, 0.14, 0.08, 'y', '#1f2124', { cap: '#26292c', sides: 12 });
      // hubcap on the outer face
      const out = wy > 0 ? wy + 0.081 : wy - 0.001;
      m.ring([wx, out, 0.14], [1, 0, 0], [0, 0, 1], 0.065, '#b9bcb6', 0.025, 0.004);
    }
  // lower body tub with a rocker panel
  m.box(-0.6, -0.31, 0.19, 0.66, 0.31, 0.36, body, { grad: false });
  m.box(-0.6, -0.315, 0.19, 0.6, 0.315, 0.23, '#cfc8b6', { grad: false, edge: null });
  // nose cowl, rounded off toward the bumper
  m.prismY([[0.3, 0.36], [0.66, 0.36], [0.66, 0.45], [0.52, 0.58], [0.3, 0.6]], -0.31, 0.31, body);
  m.box(0.66, -0.29, 0.17, 0.72, 0.29, 0.24, dark, { grad: false, edge: null });
  // headlights
  for (const hy of [-0.2, 0.2]) m.quad([[0.664, hy - 0.06, 0.38], [0.664, hy + 0.06, 0.38], [0.664, hy + 0.06, 0.42], [0.664, hy - 0.06, 0.42]], [1, 0, 0], '#fff3c4', { lit: false, edge: 'rgba(60,50,30,0.5)', bias: 0.01 });
  // floorboard
  m.quad([[0.26, -0.29, 0.361], [0.36, -0.29, 0.361], [0.36, 0.29, 0.361], [0.26, 0.29, 0.361]], [0, 0, 1], '#3b3f40', { edge: null, bias: 0.002 });
  // seat: base, cushion, back
  m.box(-0.2, -0.29, 0.36, 0.24, 0.29, 0.5, body, { grad: false });
  m.box(-0.18, -0.27, 0.5, 0.22, 0.27, 0.56, t, { grad: false });
  m.prismY([[-0.26, 0.5], [-0.17, 0.5], [-0.13, 0.86], [-0.22, 0.86]], -0.27, 0.27, t);
  // rear deck, bag well and two golf bags
  m.box(-0.6, -0.3, 0.36, -0.22, 0.3, 0.42, '#3a3d40', { grad: false, edge: null });
  const bags: [number, string, string][] = [[-0.13, '#2e3b55', '#d9d2bf'], [0.13, '#9a4032', '#e6dcc3']];
  for (const [by, bc, rim] of bags) {
    m.cyl(-0.44, by, 0.42, 0.105, 0.5, 'z', bc, { cap: '#20242a', sides: 10 });
    m.ring([-0.44, by, 0.92], [1, 0, 0], [0, 1, 0], 0.105, rim, 0.025);
    // club heads poking out
    for (let k = 0; k < 3; k++) {
      const a: V3 = [-0.47 + k * 0.03, by - 0.04 + k * 0.04, 0.92];
      const b: V3 = [a[0] - 0.02, a[1], 1.04 + (k % 2) * 0.03];
      m.line(a, b, '#c7c9c4', 0.022, null, 0.01);
      m.line(b, [b[0] - 0.04, b[1], b[2] - 0.01], '#4a4d50', 0.04, null, 0.011);
    }
  }
  // steering column and wheel
  m.line([0.36, 0.12, 0.56], [0.25, 0.12, 0.72], '#2a2c2e', 0.04, null, 0.01);
  {
    // the wheel itself: a small dark disc tilted toward the driver
    const c0: V3 = [0.25, 0.12, 0.73], A: V3 = [0, 1, 0], B: V3 = [0.55, 0, 0.84], r = 0.075;
    const pts: V3[] = Array.from({ length: 12 }, (_, k) => { const t = (k / 12) * Math.PI * 2; return [c0[0] + B[0] * Math.sin(t) * r, c0[1] + A[1] * Math.cos(t) * r, c0[2] + B[2] * Math.sin(t) * r] as V3; });
    m.flat(pts, '#2a2c2e', { bias: 0.012 });
  }
  // roof posts
  for (const py of [-0.27, 0.27]) {
    m.box(0.36, py - 0.024, 0.56, 0.41, py + 0.024, 1.15, '#5d6264', { grad: false, edge: null });
    m.box(-0.57, py - 0.024, 0.42, -0.52, py + 0.024, 1.15, '#5d6264', { grad: false, edge: null });
  }
  // windshield, tinted and see-through, with a frame
  m.flat([[0.4, -0.27, 0.6], [0.4, 0.27, 0.6], [0.37, 0.27, 1.12], [0.37, -0.27, 1.12]], 'rgba(200,226,232,0.34)', { edge: 'rgba(235,240,236,0.8)' });
  m.line([0.39, -0.27, 0.86], [0.39, 0.27, 0.86], 'rgba(255,255,255,0.35)', 0.012, null, 0.02);
  // canopy roof with a lighter top and a coloured edge
  // the canopy sits above everything else on the cart, so it is always painted last
  m.box(-0.64, -0.36, 1.13, 0.54, 0.36, 1.19, t, { grad: false, faces: { pz: '#e6dfcc' }, bias: 3 });
  m.line([-0.58, -0.3, 1.195], [0.48, -0.3, 1.195], 'rgba(255,255,255,0.45)', 0.02, [0, 0, 1], 3.01);
  m.line([-0.58, 0.3, 1.195], [0.48, 0.3, 1.195], 'rgba(90,80,60,0.25)', 0.02, [0, 0, 1], 3.01);
  cartMeshes.set(trim, m);
  return m;
}

/** A golf cart at a ground point, nose pointing along `heading` (radians; 0 = ground +x). */
export function drawCart(P: Painter, x: number, y: number, heading: number, trim = 0, alpha = 1) {
  const h = Math.round((heading * 64) / (Math.PI * 2)) / 64 * Math.PI * 2; // 64 headings are plenty and keep the cache small
  cached(P, `cart${trim % CART_TRIMS.length}:${Math.round((h * 64) / (Math.PI * 2)) & 63}`, x, y, [-0.9, -0.9, 1.5, 1.2], 1.35, alpha, (Q) => rawCart(Q, 0, 0, h, trim));
}
function rawCart(P: Painter, x: number, y: number, h: number, trim: number) {
  // shadow: the cart's footprint, cast toward the lower right
  const cos = Math.cos(h), sin = Math.sin(h);
  const ctx = P.ctx;
  const corner = (u: number, v: number, dx = 0) => P.toScreen(x + u * cos - v * sin + dx, y + u * sin + v * cos + dx * 0.28);
  ctx.fillStyle = 'rgba(12,28,18,0.2)';
  ctx.beginPath();
  [[0.72, 0.38], [0.72, -0.38], [-0.7, -0.38], [-0.7, 0.38]].forEach(([u, v], i) => { const q = corner(u, v, 0.55); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(10,24,16,0.3)';
  ctx.beginPath();
  [[0.7, 0.34], [0.7, -0.34], [-0.62, -0.34], [-0.62, 0.34]].forEach(([u, v], i) => { const q = corner(u, v); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
  ctx.closePath();
  ctx.fill();
  draw(P, prepare(`cart${trim}:${h.toFixed(4)}`, cartMesh(trim), h), x, y);
}

// =====================================================================================================
// Cart barn (4 x 2 tiles). Timber board-and-batten walls, three open bays facing +y, a shingled gable roof
// with real eaves, a louvred cupola and a painted sign.
// =====================================================================================================
// One property: the barn, shed and halfway house share the clubhouse's cream walls and terracotta roofs.
const ROOF = '#8a4f3c';
const BARN = { wood: '#e3d6ad', trim: '#f6f0dc', roof: ROOF, interior: '#2c221c', apron: '#cbc6ba', stone: '#a9a293' };
const BW = { x0: 0.14, x1: 3.86, y0: 0.14, y1: 1.4, h: 1.58 };
let barnBack: Mesh | null = null;
let barnFront: Mesh | null = null;
/** Where the three bays are, as [x0, x1], for parking carts inside. */
export const BARN_BAYS: [number, number][] = [[0.28, 1.34], [1.47, 2.53], [2.66, 3.72]];
function buildBarn() {
  const back = new Mesh();
  const front = new Mesh();
  const { x0, x1, y0, y1, h } = BW;
  // apron and plinth
  back.quad([[0.02, 0.02, 0.005], [3.98, 0.02, 0.005], [3.98, 1.98, 0.005], [0.02, 1.98, 0.005]], [0, 0, 1], BARN.apron, { edge: 'rgba(80,76,66,0.3)' });
  for (const jx of [1.4, 2.6]) back.line([jx, y1 + 0.02, 0.008], [jx, 1.96, 0.008], 'rgba(90,86,76,0.35)', 0.012, [0, 0, 1]);
  back.box(x0 - 0.04, y0 - 0.04, 0, x1 + 0.04, y0 + 0.16, 0.1, BARN.stone, { grad: false });
  back.box(x1 - 0.12, y0, 0, x1 + 0.04, y1, 0.1, BARN.stone, { grad: false });
  // interior: dark floor, back wall and the inner side of the left wall
  back.quad([[x0 + 0.12, y0 + 0.12, 0.012], [x1 - 0.12, y0 + 0.12, 0.012], [x1 - 0.12, y1, 0.012], [x0 + 0.12, y1, 0.012]], [0, 0, 1], 'rgba(26,20,16,0.42)', { lit: false, edge: null });
  back.quad([[x0 + 0.12, y0 + 0.12, 0.012], [x1 - 0.12, y0 + 0.12, 0.012], [x1 - 0.12, y0 + 0.62, 0.012], [x0 + 0.12, y0 + 0.62, 0.012]], [0, 0, 1], 'rgba(20,14,10,0.3)', { lit: false, edge: null, bias: 0.001 });
  back.box(x0, y0, 0, x1, y0 + 0.12, h, BARN.wood, { faces: { py: BARN.interior } });
  back.box(x0, y0, 0, x0 + 0.12, y1, h, BARN.wood, { faces: { px: '#3a2c23' } });
  // chargers on the back wall, one per bay, with a small green lamp
  for (const [b0, b1] of BARN_BAYS) {
    const cx = (b0 + b1) / 2;
    back.box(cx - 0.09, y0 + 0.12, 0.55, cx + 0.09, y0 + 0.2, 0.75, '#6d6a62', { grad: false, edge: null });
    back.quad([[cx - 0.03, y0 + 0.201, 0.68], [cx + 0.03, y0 + 0.201, 0.68], [cx + 0.03, y0 + 0.201, 0.71], [cx - 0.03, y0 + 0.201, 0.71]], [0, 1, 0], '#8fe08a', { lit: false, edge: null, bias: 0.01 });
  }
  // a soft band of shade just under the header, falling into the bays
  back.quad([[x0 + 0.12, y0 + 0.121, h - 0.55], [x1 - 0.12, y0 + 0.121, h - 0.55], [x1 - 0.12, y0 + 0.121, h], [x0 + 0.12, y0 + 0.121, h]], [0, 1, 0], 'rgba(10,6,4,0.35)', { lit: false, edge: null, bias: 0.004 });

  // front: right wall, posts, header, trim, roof and cupola
  front.box(x1 - 0.12, y0, 0.1, x1, y1, h, BARN.wood);
  for (const [px0, px1] of [[x0, x0 + 0.14], [1.34, 1.47], [2.53, 2.66], [x1 - 0.14, x1]])
    front.box(px0, y1 - 0.14, 0, px1, y1, h - 0.3, BARN.wood, { faces: { py: tone(BARN.wood, 1.02) } });
  front.box(x0, y1 - 0.16, h - 0.32, x1, y1, h, BARN.wood);
  // board-and-batten: battens across the header and down the side wall
  for (let bx = x0 + 0.18; bx < x1 - 0.05; bx += 0.2) front.line([bx, y1 + 0.004, h - 0.31], [bx, y1 + 0.004, h - 0.01], 'rgba(40,24,14,0.35)', 0.018, [0, 1, 0]);
  for (let by = y0 + 0.12; by < y1 - 0.02; by += 0.2) {
    front.line([x1 + 0.004, by, 0.12], [x1 + 0.004, by, h - 0.02], 'rgba(30,18,10,0.32)', 0.02, [1, 0, 0]);
    front.line([x1 + 0.004, by + 0.025, 0.12], [x1 + 0.004, by + 0.025, h - 0.02], 'rgba(255,220,180,0.12)', 0.012, [1, 0, 0]);
  }
  // cream trim: corner boards, the header's lower board, and the bay openings' edges
  front.box(x1 - 0.02, y1 - 0.06, 0.1, x1 + 0.02, y1 + 0.02, h, BARN.trim, { grad: false });
  front.box(x0, y1 - 0.05, 0, x0 + 0.05, y1 + 0.015, h, BARN.trim, { grad: false });
  front.box(x0, y1 - 0.02, h - 0.34, x1, y1 + 0.02, h - 0.28, BARN.trim, { grad: false });
  // a side window with a cross mullion
  const wy0 = 0.5, wy1 = 1.0, wz0 = 0.72, wz1 = 1.12;
  front.quad([[x1 + 0.006, wy0 - 0.05, wz0 - 0.05], [x1 + 0.006, wy1 + 0.05, wz0 - 0.05], [x1 + 0.006, wy1 + 0.05, wz1 + 0.05], [x1 + 0.006, wy0 - 0.05, wz1 + 0.05]], [1, 0, 0], BARN.trim, { bias: 0.01 });
  front.quad([[x1 + 0.01, wy0, wz0], [x1 + 0.01, wy1, wz0], [x1 + 0.01, wy1, wz1], [x1 + 0.01, wy0, wz1]], [1, 0, 0], '#3c5a62', { lit: false, edge: null, bias: 0.012 });
  front.line([x1 + 0.012, (wy0 + wy1) / 2, wz0], [x1 + 0.012, (wy0 + wy1) / 2, wz1], BARN.trim, 0.03, [1, 0, 0], 0.014);
  front.line([x1 + 0.012, wy0, (wz0 + wz1) / 2], [x1 + 0.012, wy1, (wz0 + wz1) / 2], BARN.trim, 0.03, [1, 0, 0], 0.014);
  front.quad([[x1 + 0.013, wy0 + 0.04, wz1 - 0.04], [x1 + 0.013, wy0 + 0.2, wz1 - 0.04], [x1 + 0.013, wy0 + 0.04, wz0 + 0.2]], [1, 0, 0], 'rgba(220,240,245,0.25)', { lit: false, edge: null, bias: 0.016 });
  // sign over the middle bay
  front.quad([[1.3, y1 + 0.03, h - 0.27], [2.7, y1 + 0.03, h - 0.27], [2.7, y1 + 0.03, h - 0.04], [1.3, y1 + 0.03, h - 0.04]], [0, 1, 0], BARN.trim, { bias: 0.02, edge: 'rgba(60,40,24,0.6)' });
  front.text([2, y1 + 0.035, h - 0.155], [1, 0, 0], [0, 0, 1], 'CART BARN', 0.14, '#2c4a38', [0, 1, 0]);
  // roof
  const { zR, ym } = front.gableX(x0, x1, y0, y1, h, 0.82, BARN.roof, BARN.trim, { ex: 0.16, ey: 0.24, t: 0.09, wall: BARN.wood, courses: 'shingle' });
  // gable battens and a vent
  for (let by = y0 + 0.2; by < y1 - 0.1; by += 0.2) {
    const zt = h + 0.82 * (1 - Math.abs(by - ym) / ((y1 - y0) / 2)) - 0.04;
    front.line([x1 + 0.004, by, h + 0.02], [x1 + 0.004, by, zt], 'rgba(30,18,10,0.3)', 0.02, [1, 0, 0]);
  }
  front.quad([[x1 + 0.008, ym - 0.14, h + 0.22], [x1 + 0.008, ym + 0.14, h + 0.22], [x1 + 0.008, ym, h + 0.46]], [1, 0, 0], BARN.trim, { bias: 0.012 });
  // cupola with louvres and a little pyramid roof, then a weathervane
  const cx = 2, cy = ym, cs = 0.24;
  front.box(cx - cs, cy - cs, zR - 0.2, cx + cs, cy + cs, zR + 0.3, BARN.trim, { grad: false });
  for (let z = zR + 0.02; z < zR + 0.26; z += 0.06) {
    front.line([cx - cs + 0.04, cy + cs + 0.004, z], [cx + cs - 0.04, cy + cs + 0.004, z], 'rgba(60,50,40,0.5)', 0.018, [0, 1, 0]);
    front.line([cx + cs + 0.004, cy - cs + 0.04, z], [cx + cs + 0.004, cy + cs - 0.04, z], 'rgba(60,50,40,0.5)', 0.018, [1, 0, 0]);
  }
  const ap: V3 = [cx, cy, zR + 0.62];
  const r = cs + 0.08, zc = zR + 0.3;
  front.quad([[cx - r, cy + r, zc], [cx + r, cy + r, zc], ap], [0, 1, 0.9], BARN.roof);
  front.quad([[cx + r, cy - r, zc], [cx + r, cy + r, zc], ap], [1, 0, 0.9], BARN.roof);
  front.quad([[cx - r, cy - r, zc], [cx + r, cy - r, zc], ap], [0, -1, 0.9], BARN.roof);
  front.quad([[cx - r, cy - r, zc], [cx - r, cy + r, zc], ap], [-1, 0, 0.9], BARN.roof);
  front.line(ap, [cx, cy, zR + 0.98], '#2a2622', 0.025, null, 0.05);
  front.flat([[cx, cy, zR + 0.94], [cx + 0.2, cy + 0.03, zR + 0.9], [cx, cy, zR + 0.86]], '#b63d2a', { bias: 0.06 });
  barnBack = back;
  barnFront = front;
}

// =====================================================================================================
// Maintenance shed (3 x 2 tiles). Sage lap siding, a white-trimmed standing-seam roof, a sectional garage
// door, a side door with a lamp, a hose reel on the side wall, and a pallet of seed bags.
// =====================================================================================================
let shedMesh: Mesh | null = null;
function buildShed() {
  const m = new Mesh();
  const x0 = 0.16, x1 = 2.84, y0 = 0.18, y1 = 1.3, h = 1.4;
  const wall = '#c9d2a8', trim = '#f1ecdc', roof = ROOF;
  // concrete pad in front of the door, a gravel strip along the side
  m.quad([[0.24, y1, 0.005], [1.9, y1, 0.005], [1.9, 1.96, 0.005], [0.24, 1.96, 0.005]], [0, 0, 1], '#cfcbc0', { edge: 'rgba(80,76,66,0.3)' });
  m.quad([[x1, 0.1, 0.004], [2.98, 0.1, 0.004], [2.98, 1.96, 0.004], [x1, 1.96, 0.004]], [0, 0, 1], '#b9b19c', { edge: null });
  for (let k = 0; k < 18; k++) m.line([x1 + 0.03 + ((k * 37) % 10) / 80, 0.2 + k * 0.095, 0.006], [x1 + 0.05 + ((k * 37) % 10) / 80, 0.22 + k * 0.095, 0.006], 'rgba(90,82,66,0.5)', 0.02, [0, 0, 1]);
  // body on a low concrete footing
  m.box(x0 - 0.03, y0 - 0.03, 0, x1 + 0.03, y1 + 0.03, 0.1, '#b4afa4', { grad: false });
  m.box(x0, y0, 0.1, x1, y1, h, wall);
  // lap siding courses on the two visible walls
  for (let z = 0.22; z < h - 0.05; z += 0.11) {
    m.line([x0, y1 + 0.004, z], [x1, y1 + 0.004, z], 'rgba(36,48,36,0.28)', 0.014, [0, 1, 0]);
    m.line([x1 + 0.004, y0, z], [x1 + 0.004, y1, z], 'rgba(30,40,30,0.3)', 0.014, [1, 0, 0]);
  }
  // corner boards
  m.box(x1 - 0.02, y1 - 0.02, 0.1, x1 + 0.03, y1 + 0.03, h, trim, { grad: false });
  m.box(x0 - 0.03, y1 - 0.02, 0.1, x0 + 0.03, y1 + 0.03, h, trim, { grad: false });
  // sectional garage door, set into the wall: frame, recess shade, panels, a row of windows, a handle
  const g0 = 0.34, g1 = 1.66, gz = 1.08;
  m.quad([[g0 - 0.07, y1 + 0.01, 0.1], [g1 + 0.07, y1 + 0.01, 0.1], [g1 + 0.07, y1 + 0.01, gz + 0.07], [g0 - 0.07, y1 + 0.01, gz + 0.07]], [0, 1, 0], trim, { bias: 0.01 });
  m.quad([[g0, y1 + 0.014, 0.1], [g1, y1 + 0.014, 0.1], [g1, y1 + 0.014, gz], [g0, y1 + 0.014, gz]], [0, 1, 0], '#d7d9d3', { bias: 0.014, grad: true });
  m.quad([[g0, y1 + 0.016, gz - 0.06], [g1, y1 + 0.016, gz - 0.06], [g1, y1 + 0.016, gz], [g0, y1 + 0.016, gz]], [0, 1, 0], 'rgba(20,24,20,0.35)', { lit: false, edge: null, bias: 0.016 });
  m.quad([[g0, y1 + 0.016, 0.1], [g0 + 0.04, y1 + 0.016, 0.1], [g0 + 0.04, y1 + 0.016, gz], [g0, y1 + 0.016, gz]], [0, 1, 0], 'rgba(20,24,20,0.25)', { lit: false, edge: null, bias: 0.016 });
  for (let z = 0.34; z < gz - 0.05; z += 0.24) m.line([g0, y1 + 0.018, z], [g1, y1 + 0.018, z], 'rgba(70,74,70,0.45)', 0.016, [0, 1, 0], 0.02);
  for (let k = 0; k < 4; k++) {
    const a = g0 + 0.12 + k * 0.3;
    m.quad([[a, y1 + 0.02, 0.74], [a + 0.22, y1 + 0.02, 0.74], [a + 0.22, y1 + 0.02, 0.86], [a, y1 + 0.02, 0.86]], [0, 1, 0], '#41575c', { lit: false, edge: 'rgba(220,224,218,0.8)', bias: 0.022 });
  }
  m.line([(g0 + g1) / 2 - 0.08, y1 + 0.022, 0.2], [(g0 + g1) / 2 + 0.08, y1 + 0.022, 0.2], '#4a4d4a', 0.03, [0, 1, 0], 0.024);
  // side door with a little window, a step, and a wall lamp
  const d0 = 1.96, d1 = 2.42, dz = 1.02;
  m.quad([[d0 - 0.05, y1 + 0.01, 0.1], [d1 + 0.05, y1 + 0.01, 0.1], [d1 + 0.05, y1 + 0.01, dz + 0.05], [d0 - 0.05, y1 + 0.01, dz + 0.05]], [0, 1, 0], trim, { bias: 0.01 });
  m.quad([[d0, y1 + 0.014, 0.1], [d1, y1 + 0.014, 0.1], [d1, y1 + 0.014, dz], [d0, y1 + 0.014, dz]], [0, 1, 0], '#3f5d4b', { bias: 0.014, grad: true });
  m.quad([[d0 + 0.1, y1 + 0.018, 0.66], [d1 - 0.1, y1 + 0.018, 0.66], [d1 - 0.1, y1 + 0.018, 0.9], [d0 + 0.1, y1 + 0.018, 0.9]], [0, 1, 0], '#5b7880', { lit: false, edge: 'rgba(230,226,214,0.8)', bias: 0.018 });
  m.ring([d1 - 0.08, y1 + 0.02, 0.5], [1, 0, 0], [0, 0, 1], 0.022, '#d8bd6a', 0.03, 0.02);
  m.box(d0 - 0.06, y1, 0, d1 + 0.06, y1 + 0.18, 0.1, '#bdb8ad', { grad: false });
  m.box((d0 + d1) / 2 - 0.05, y1, dz + 0.14, (d0 + d1) / 2 + 0.05, y1 + 0.08, dz + 0.24, '#2d3230', { grad: false, edge: null });
  m.quad([[(d0 + d1) / 2 - 0.04, y1 + 0.081, dz + 0.15], [(d0 + d1) / 2 + 0.04, y1 + 0.081, dz + 0.15], [(d0 + d1) / 2 + 0.04, y1 + 0.081, dz + 0.2], [(d0 + d1) / 2 - 0.04, y1 + 0.081, dz + 0.2]], [0, 1, 0], '#ffe4a0', { lit: false, edge: null, bias: 0.01 });
  // hose reel on the side wall: a bracket, a drum and coils of green hose
  const hy = 0.72, hz = 0.52;
  m.box(x1, hy - 0.04, hz - 0.2, x1 + 0.05, hy + 0.04, hz + 0.2, '#5a5f5c', { grad: false, edge: null });
  m.cyl(x1 + 0.05, hy, hz, 0.17, 0.14, 'x', '#3d7a3e', { cap: '#356b37', sides: 14 });
  for (const r of [0.13, 0.09, 0.05]) m.ring([x1 + 0.193, hy, hz], [0, 1, 0], [0, 0, 1], r, 'rgba(20,50,20,0.55)', 0.016, 0.01);
  m.cyl(x1 + 0.19, hy, hz, 0.035, 0.03, 'x', '#c9c4b4', { sides: 8 });
  m.line([x1 + 0.12, hy + 0.12, hz - 0.12], [x1 + 0.2, hy + 0.28, 0.02], '#3d7a3e', 0.04, null, 0.03);
  // a small high window on the side
  m.quad([[x1 + 0.006, 0.28, 0.86], [x1 + 0.006, 0.52, 0.86], [x1 + 0.006, 0.52, 1.12], [x1 + 0.006, 0.28, 1.12]], [1, 0, 0], trim, { bias: 0.01 });
  m.quad([[x1 + 0.01, 0.31, 0.89], [x1 + 0.01, 0.49, 0.89], [x1 + 0.01, 0.49, 1.09], [x1 + 0.01, 0.31, 1.09]], [1, 0, 0], '#3c545a', { lit: false, edge: null, bias: 0.012 });
  // pallet of seed bags by the side door
  m.box(2.5, 1.5, 0, 2.96, 1.92, 0.08, '#a88a5e', { grad: false });
  for (let k = 0; k < 4; k++) {
    const bx = 2.53 + (k % 2) * 0.21, by = 1.53 + Math.floor(k / 2) * 0.19;
    m.box(bx, by, 0.08, bx + 0.19, by + 0.17, 0.2, k % 2 ? '#e2dcc6' : '#d6cfb5', { grad: false });
  }
  m.box(2.6, 1.6, 0.2, 2.82, 1.78, 0.31, '#cfc7ac', { grad: false });
  // roof: low-pitch standing seam, white fascia
  m.gableX(x0, x1, y0, y1, h, 0.5, roof, trim, { ex: 0.14, ey: 0.2, t: 0.07, wall, courses: 'seam' });
  shedMesh = m;
}

// =====================================================================================================
// Halfway house (3 x 2 tiles). A small clapboard snack pavilion: serving window under a striped awning,
// a counter, an A-frame menu board, a deck with a bench, and a table under a parasol.
// =====================================================================================================
let halfwayMesh: Mesh | null = null;
function buildHalfway() {
  const m = new Mesh();
  const x0 = 0.24, x1 = 1.86, y0 = 0.22, y1 = 1.12, h = 1.32;
  const wall = '#efe6cc', trim = '#2f5c44', roof = ROOF;
  // timber deck with planks, then a stone step
  m.box(0.08, 0.08, 0, 2.94, 1.94, 0.06, '#b58d62', { grad: false });
  for (let y = 0.2; y < 1.92; y += 0.12) m.line([0.08, y, 0.062], [2.94, y, 0.062], 'rgba(80,50,26,0.3)', 0.012, [0, 0, 1]);
  m.box(2.94, 0.08, 0, 2.97, 1.94, 0.05, '#8d6a48', { grad: false, edge: null });
  // walls on a painted skirt
  m.box(x0, y0, 0.06, x1, y1, 0.2, trim, { grad: false });
  m.box(x0, y0, 0.2, x1, y1, h, wall);
  for (let z = 0.3; z < h - 0.04; z += 0.1) {
    m.line([x0, y1 + 0.004, z], [x1, y1 + 0.004, z], 'rgba(130,112,74,0.3)', 0.012, [0, 1, 0]);
    m.line([x1 + 0.004, y0, z], [x1 + 0.004, y1, z], 'rgba(90,76,50,0.3)', 0.012, [1, 0, 0]);
  }
  m.box(x1 - 0.02, y1 - 0.02, 0.2, x1 + 0.03, y1 + 0.03, h, trim, { grad: false });
  m.box(x0 - 0.03, y1 - 0.02, 0.2, x0 + 0.03, y1 + 0.03, h, trim, { grad: false });
  // serving window: a frame, a warm dim interior with a coffee urn and a shelf of cups
  const w0 = 0.46, w1 = 1.62, wz0 = 0.6, wz1 = 1.06;
  m.quad([[w0 - 0.05, y1 + 0.01, wz0 - 0.05], [w1 + 0.05, y1 + 0.01, wz0 - 0.05], [w1 + 0.05, y1 + 0.01, wz1 + 0.04], [w0 - 0.05, y1 + 0.01, wz1 + 0.04]], [0, 1, 0], trim, { bias: 0.01 });
  m.quad([[w0, y1 + 0.014, wz0], [w1, y1 + 0.014, wz0], [w1, y1 + 0.014, wz1], [w0, y1 + 0.014, wz1]], [0, 1, 0], '#3a2c22', { lit: false, edge: null, bias: 0.014 });
  m.quad([[w0, y1 + 0.016, wz1 - 0.1], [w1, y1 + 0.016, wz1 - 0.1], [w1, y1 + 0.016, wz1], [w0, y1 + 0.016, wz1]], [0, 1, 0], 'rgba(255,214,140,0.35)', { lit: false, edge: null, bias: 0.016 });
  m.quad([[w0 + 0.12, y1 + 0.018, wz0 + 0.02], [w0 + 0.3, y1 + 0.018, wz0 + 0.02], [w0 + 0.3, y1 + 0.018, wz0 + 0.3], [w0 + 0.12, y1 + 0.018, wz0 + 0.3]], [0, 1, 0], '#9aa4a6', { lit: false, edge: null, bias: 0.018 });
  for (let k = 0; k < 4; k++) m.quad([[w0 + 0.55 + k * 0.12, y1 + 0.018, wz0 + 0.24], [w0 + 0.62 + k * 0.12, y1 + 0.018, wz0 + 0.24], [w0 + 0.62 + k * 0.12, y1 + 0.018, wz0 + 0.33], [w0 + 0.55 + k * 0.12, y1 + 0.018, wz0 + 0.33]], [0, 1, 0], k % 2 ? '#e8e0cc' : '#c8553e', { lit: false, edge: null, bias: 0.018 });
  // counter ledge
  m.box(w0 - 0.08, y1, wz0 - 0.08, w1 + 0.08, y1 + 0.17, wz0 - 0.02, '#8a6440', { grad: false });
  // striped awning, sloping out over the counter, with a scalloped valance
  const a0 = w0 - 0.12, a1 = w1 + 0.12, az0 = 1.2, ay = 0.44, az1 = 0.96;
  const stripes = 7;
  for (let k = 0; k < stripes; k++) {
    const s0 = a0 + ((a1 - a0) * k) / stripes, s1 = a0 + ((a1 - a0) * (k + 1)) / stripes;
    m.quad([[s0, y1 + 0.01, az0], [s1, y1 + 0.01, az0], [s1, y1 + ay, az1], [s0, y1 + ay, az1]], [0, (az0 - az1), ay], k % 2 ? '#f3ecdc' : trim, { edge: null, bias: 0.03 });
    // valance tongue
    m.quad([[s0, y1 + ay, az1], [s1, y1 + ay, az1], [s1, y1 + ay, az1 - 0.06], [(s0 + s1) / 2, y1 + ay, az1 - 0.1], [s0, y1 + ay, az1 - 0.06]], [0, 1, 0], k % 2 ? '#e4dcc8' : tone(trim, 0.92), { edge: null, bias: 0.031 });
  }
  m.line([a0, y1 + ay, az1], [a1, y1 + ay, az1], 'rgba(30,40,30,0.4)', 0.014, [0, 1, 0.5], 0.032);
  m.quad([[a1, y1 + 0.01, az0], [a1, y1 + ay, az1], [a1, y1 + ay, az1 - 0.06], [a1, y1 + 0.01, az0 - 0.06]], [1, 0, 0], trim, { edge: null, bias: 0.03 });
  // side window and the club's flag pennant on the gable
  m.quad([[x1 + 0.006, 0.42, 0.62], [x1 + 0.006, 0.88, 0.62], [x1 + 0.006, 0.88, 1.02], [x1 + 0.006, 0.42, 1.02]], [1, 0, 0], trim, { bias: 0.01 });
  m.quad([[x1 + 0.01, 0.46, 0.66], [x1 + 0.01, 0.84, 0.66], [x1 + 0.01, 0.84, 0.98], [x1 + 0.01, 0.46, 0.98]], [1, 0, 0], '#4a6168', { lit: false, edge: null, bias: 0.012 });
  m.line([x1 + 0.012, 0.65, 0.66], [x1 + 0.012, 0.65, 0.98], trim, 0.025, [1, 0, 0], 0.014);
  // roof: warm shingles matching the clubhouse
  const { ym } = m.gableX(x0, x1, y0, y1, h, 0.62, roof, '#efe6cf', { ex: 0.16, ey: 0.2, t: 0.07, wall, courses: 'shingle' });
  m.text([x1 + 0.008, ym, h + 0.2], [0, -1, 0], [0, 0, 1], '9', 0.24, trim, [1, 0, 0]);
  // A-frame menu board
  const mx = 1.98, my = 1.42;
  m.quad([[mx, my, 0.06], [mx + 0.32, my, 0.06], [mx + 0.32, my + 0.08, 0.6], [mx, my + 0.08, 0.6]], [0, 1, 0.15], '#8a6440');
  m.quad([[mx + 0.04, my + 0.012, 0.18], [mx + 0.28, my + 0.012, 0.18], [mx + 0.28, my + 0.07, 0.56], [mx + 0.04, my + 0.07, 0.56]], [0, 1, 0.15], '#2b3330', { lit: false, edge: null, bias: 0.01 });
  for (let k = 0; k < 3; k++) {
    const z = 0.48 - k * 0.09, yy = my + 0.012 + ((z - 0.18) / 0.38) * 0.058;
    m.line([mx + 0.08, yy + 0.002, z], [mx + 0.24 - (k % 2) * 0.05, yy + 0.002, z], 'rgba(240,236,220,0.85)', 0.016, [0, 1, 0.15], 0.02);
  }
  m.quad([[mx, my + 0.16, 0.06], [mx + 0.32, my + 0.16, 0.06], [mx + 0.32, my + 0.08, 0.6], [mx, my + 0.08, 0.6]], [0, -1, 0.15], '#7a5636');
  // bench along the front of the deck
  const bx0 = 0.3, bx1 = 1.1, by = 1.6;
  for (const lx of [bx0 + 0.05, bx1 - 0.08]) m.box(lx, by, 0.06, lx + 0.04, by + 0.2, 0.3, '#3c3a36', { grad: false, edge: null });
  m.box(bx0, by, 0.3, bx1, by + 0.22, 0.34, '#9a7048', { grad: false });
  m.box(bx0, by - 0.02, 0.34, bx1, by + 0.02, 0.58, '#9a7048', { grad: false });
  // round table, two stools and a parasol
  const tx = 2.42, ty = 0.78;
  m.cyl(tx, ty, 0.06, 0.03, 0.4, 'z', '#3a3a36', { sides: 6 });
  m.cyl(tx, ty, 0.46, 0.26, 0.04, 'z', '#ede4cf', { sides: 14 });
  for (const [sx, sy] of [[tx - 0.36, ty + 0.12], [tx + 0.12, ty + 0.38]]) {
    m.cyl(sx, sy, 0.06, 0.025, 0.24, 'z', '#3a3a36', { sides: 6 });
    m.cyl(sx, sy, 0.3, 0.12, 0.04, 'z', '#9a7048', { sides: 10 });
  }
  m.line([tx, ty, 0.5], [tx, ty, 1.36], '#d9d4c6', 0.03, null, 0.2);
  const R = 0.56, zr = 1.08, apex: V3 = [tx, ty, 1.34];
  for (let k = 0; k < 8; k++) {
    const t0 = (k / 8) * Math.PI * 2, t1 = ((k + 1) / 8) * Math.PI * 2, tm = (t0 + t1) / 2;
    m.quad([[tx + Math.cos(t0) * R, ty + Math.sin(t0) * R, zr], [tx + Math.cos(t1) * R, ty + Math.sin(t1) * R, zr], apex], [Math.cos(tm) * 0.26, Math.sin(tm) * 0.26, R], k % 2 ? '#f3ecdc' : trim, { edge: 'rgba(30,40,30,0.25)', bias: 0.3 });
  }
  // planter of flowers by the step
  m.box(0.12, 1.16, 0.06, 0.4, 1.4, 0.26, '#7d5a3c', { grad: false });
  for (let k = 0; k < 7; k++) m.cyl(0.16 + (k % 4) * 0.07, 1.2 + Math.floor(k / 4) * 0.1, 0.26, 0.045, 0.05, 'z', ['#d65a6a', '#f2d05a', '#e8e4f0', '#c45ab0'][k % 4], { sides: 6, edge: null });
  halfwayMesh = m;
}

// =====================================================================================================
// More buildings: pro shop, grill room, garden pavilion, greenhouse and rain shelter. They share the clubhouse's
// cream walls and terracotta roofs so the property still looks like one place.
// =====================================================================================================
const meshes = new Map<string, Mesh>();

/** Corner posts, a front window, awning, door and sign: the pro shop. 4 x 2 tiles. */
function buildProShop(): Mesh {
  const m = new Mesh();
  const x0 = 0.2, x1 = 3.7, y0 = 0.2, y1 = 1.32, h = 1.36;
  const wall = '#f0e7cf', trim = '#2f5c44', roof = ROOF;
  m.box(0.04, 0.04, 0, 3.96, 1.96, 0.05, '#cbc6ba', { grad: false });
  m.box(x0, y0, 0.05, x1, y1, 0.2, '#a69b7e', { grad: false });
  m.box(x0, y0, 0.2, x1, y1, h, wall);
  for (let z = 0.3; z < h - 0.04; z += 0.1) m.line([x0, y1 + 0.004, z], [x1, y1 + 0.004, z], 'rgba(130,112,74,0.28)', 0.012, [0, 1, 0]);
  m.box(x1 - 0.02, y1 - 0.02, 0.2, x1 + 0.03, y1 + 0.03, h, trim, { grad: false });
  m.box(x0 - 0.03, y1 - 0.02, 0.2, x0 + 0.03, y1 + 0.03, h, trim, { grad: false });
  // big shop window with a display: a golf bag, a pair of shoes and a folded sweater
  const w0 = 0.46, w1 = 2.3, z0 = 0.4, z1 = 1.02;
  m.quad([[w0 - 0.06, y1 + 0.01, z0 - 0.06], [w1 + 0.06, y1 + 0.01, z0 - 0.06], [w1 + 0.06, y1 + 0.01, z1 + 0.05], [w0 - 0.06, y1 + 0.01, z1 + 0.05]], [0, 1, 0], trim, { bias: 0.01 });
  m.quad([[w0, y1 + 0.014, z0], [w1, y1 + 0.014, z0], [w1, y1 + 0.014, z1], [w0, y1 + 0.014, z1]], [0, 1, 0], '#46606a', { lit: false, edge: null, bias: 0.014 });
  m.quad([[w0, y1 + 0.016, z1 - 0.12], [w1, y1 + 0.016, z1 - 0.12], [w1, y1 + 0.016, z1], [w0, y1 + 0.016, z1]], [0, 1, 0], 'rgba(255,255,255,0.25)', { lit: false, edge: null, bias: 0.016 });
  m.quad([[w0 + 0.22, y1 + 0.02, z0], [w0 + 0.46, y1 + 0.02, z0], [w0 + 0.46, y1 + 0.02, z0 + 0.4], [w0 + 0.22, y1 + 0.02, z0 + 0.4]], [0, 1, 0], '#2f8a47', { lit: false, edge: null, bias: 0.02 });
  m.quad([[w0 + 0.28, y1 + 0.022, z0 + 0.4], [w0 + 0.4, y1 + 0.022, z0 + 0.4], [w0 + 0.4, y1 + 0.022, z0 + 0.5], [w0 + 0.28, y1 + 0.022, z0 + 0.5]], [0, 1, 0], '#d9d4c6', { lit: false, edge: null, bias: 0.022 });
  m.quad([[w0 + 0.7, y1 + 0.02, z0], [w0 + 1.0, y1 + 0.02, z0], [w0 + 1.0, y1 + 0.02, z0 + 0.12], [w0 + 0.7, y1 + 0.02, z0 + 0.12]], [0, 1, 0], '#f4efe0', { lit: false, edge: null, bias: 0.02 });
  m.quad([[w0 + 1.2, y1 + 0.02, z0], [w0 + 1.6, y1 + 0.02, z0], [w0 + 1.6, y1 + 0.02, z0 + 0.2], [w0 + 1.2, y1 + 0.02, z0 + 0.2]], [0, 1, 0], '#e2503f', { lit: false, edge: null, bias: 0.02 });
  m.line([(w0 + w1) / 2, y1 + 0.018, z0], [(w0 + w1) / 2, y1 + 0.018, z1], 'rgba(240,240,230,0.7)', 0.02, [0, 1, 0], 0.018);
  // door
  const d0 = 2.7, d1 = 3.2, dz = 1.06;
  m.quad([[d0 - 0.05, y1 + 0.01, 0.2], [d1 + 0.05, y1 + 0.01, 0.2], [d1 + 0.05, y1 + 0.01, dz + 0.05], [d0 - 0.05, y1 + 0.01, dz + 0.05]], [0, 1, 0], trim, { bias: 0.01 });
  m.quad([[d0, y1 + 0.014, 0.2], [d1, y1 + 0.014, 0.2], [d1, y1 + 0.014, dz], [d0, y1 + 0.014, dz]], [0, 1, 0], '#3f6a54', { bias: 0.014, grad: true });
  m.quad([[d0 + 0.08, y1 + 0.018, 0.6], [d1 - 0.08, y1 + 0.018, 0.6], [d1 - 0.08, y1 + 0.018, 0.96], [d0 + 0.08, y1 + 0.018, 0.96]], [0, 1, 0], '#6a8a92', { lit: false, edge: null, bias: 0.018 });
  m.box(d0 - 0.1, y1, 0, d1 + 0.1, y1 + 0.2, 0.2, '#bdb8ad', { grad: false });
  // striped awning over window and door
  const a0 = w0 - 0.1, a1 = d1 + 0.14, az0 = 1.2, ay = 0.42, az1 = 0.98, stripes = 9;
  for (let k = 0; k < stripes; k++) {
    const s0 = a0 + ((a1 - a0) * k) / stripes, s1 = a0 + ((a1 - a0) * (k + 1)) / stripes;
    m.quad([[s0, y1 + 0.01, az0], [s1, y1 + 0.01, az0], [s1, y1 + ay, az1], [s0, y1 + ay, az1]], [0, az0 - az1, ay], k % 2 ? '#f3ecdc' : '#c0392b', { edge: null, bias: 0.03 });
    m.quad([[s0, y1 + ay, az1], [s1, y1 + ay, az1], [s1, y1 + ay, az1 - 0.06], [(s0 + s1) / 2, y1 + ay, az1 - 0.1], [s0, y1 + ay, az1 - 0.06]], [0, 1, 0], k % 2 ? '#e4dcc8' : '#a83024', { edge: null, bias: 0.031 });
  }
  // side window
  m.quad([[x1 + 0.006, 0.4, 0.5], [x1 + 0.006, 1.0, 0.5], [x1 + 0.006, 1.0, 1.0], [x1 + 0.006, 0.4, 1.0]], [1, 0, 0], trim, { bias: 0.01 });
  m.quad([[x1 + 0.01, 0.45, 0.55], [x1 + 0.01, 0.95, 0.55], [x1 + 0.01, 0.95, 0.95], [x1 + 0.01, 0.45, 0.95]], [1, 0, 0], '#4a6168', { lit: false, edge: null, bias: 0.012 });
  const { zR } = m.gableX(x0, x1, y0, y1, h, 0.6, roof, '#efe6cf', { ex: 0.16, ey: 0.2, t: 0.07, wall, courses: 'shingle' });
  // painted sign above the awning, on the gable wall
  m.box(1.0, y1 + 0.01, h - 0.02, 2.9, y1 + 0.08, h + 0.3, trim, { grad: false });
  m.text([1.95, y1 + 0.086, h + 0.16], [1, 0, 0], [0, 0, 1], 'PRO SHOP', 0.17, '#f6ecc8', [0, 1, 0]);
  void zR;
  // a bag stand and a bench by the door
  m.cyl(3.5, 1.6, 0.0, 0.1, 0.5, 'z', '#2f6a8a', { sides: 8 });
  m.cyl(3.5, 1.6, 0.5, 0.06, 0.22, 'z', '#d9d4c6', { sides: 6, edge: null });
  m.box(0.4, 1.6, 0.14, 1.2, 1.82, 0.2, '#9a7048', { grad: false });
  m.box(0.46, 1.62, 0, 0.5, 1.8, 0.14, '#3c3a36', { grad: false, edge: null });
  m.box(1.1, 1.62, 0, 1.14, 1.8, 0.14, '#3c3a36', { grad: false, edge: null });
  return m;
}

/** A porch dining room: a main house, a deck with parasols, a chimney. 4 x 3 tiles. */
function buildGrill(): Mesh {
  const m = new Mesh();
  const x0 = 0.2, x1 = 3.8, y0 = 0.2, y1 = 1.3, h = 1.5;
  const wall = '#f1e8d2', trim = '#7a3b2e', roof = ROOF;
  // deck
  m.box(0.05, 0.05, 0, 3.95, 2.95, 0.07, '#b58d62', { grad: false });
  for (let y = 0.2; y < 2.94; y += 0.12) m.line([0.05, y, 0.072], [3.95, y, 0.072], 'rgba(80,50,26,0.28)', 0.012, [0, 0, 1]);
  m.box(x0, y0, 0.07, x1, y1, 0.22, '#a69b7e', { grad: false });
  m.box(x0, y0, 0.22, x1, y1, h, wall);
  for (let z = 0.34; z < h - 0.04; z += 0.1) {
    m.line([x0, y1 + 0.004, z], [x1, y1 + 0.004, z], 'rgba(130,112,74,0.28)', 0.012, [0, 1, 0]);
    m.line([x1 + 0.004, y0, z], [x1 + 0.004, y1, z], 'rgba(90,76,50,0.28)', 0.012, [1, 0, 0]);
  }
  m.box(x1 - 0.02, y1 - 0.02, 0.22, x1 + 0.03, y1 + 0.03, h, trim, { grad: false });
  m.box(x0 - 0.03, y1 - 0.02, 0.22, x0 + 0.03, y1 + 0.03, h, trim, { grad: false });
  // tall windows with shutters, and a pair of glass doors
  for (const wx of [0.5, 1.2, 2.3, 3.0]) {
    m.quad([[wx, y1 + 0.012, 0.5], [wx + 0.4, y1 + 0.012, 0.5], [wx + 0.4, y1 + 0.012, 1.18], [wx, y1 + 0.012, 1.18]], [0, 1, 0], '#f6f0dc', { bias: 0.012 });
    m.quad([[wx + 0.04, y1 + 0.016, 0.54], [wx + 0.36, y1 + 0.016, 0.54], [wx + 0.36, y1 + 0.016, 1.14], [wx + 0.04, y1 + 0.016, 1.14]], [0, 1, 0], '#4a6a72', { lit: false, edge: null, bias: 0.016 });
    m.line([wx + 0.2, y1 + 0.018, 0.54], [wx + 0.2, y1 + 0.018, 1.14], '#f6f0dc', 0.02, [0, 1, 0], 0.018);
    m.quad([[wx - 0.1, y1 + 0.014, 0.5], [wx - 0.02, y1 + 0.014, 0.5], [wx - 0.02, y1 + 0.014, 1.18], [wx - 0.1, y1 + 0.014, 1.18]], [0, 1, 0], trim, { edge: null, bias: 0.014 });
    m.quad([[wx + 0.42, y1 + 0.014, 0.5], [wx + 0.5, y1 + 0.014, 0.5], [wx + 0.5, y1 + 0.014, 1.18], [wx + 0.42, y1 + 0.014, 1.18]], [0, 1, 0], trim, { edge: null, bias: 0.014 });
  }
  m.quad([[1.74, y1 + 0.012, 0.22], [2.12, y1 + 0.012, 0.22], [2.12, y1 + 0.012, 1.08], [1.74, y1 + 0.012, 1.08]], [0, 1, 0], trim, { bias: 0.012 });
  m.quad([[1.78, y1 + 0.016, 0.26], [2.08, y1 + 0.016, 0.26], [2.08, y1 + 0.016, 1.04], [1.78, y1 + 0.016, 1.04]], [0, 1, 0], '#5b7e84', { lit: false, edge: null, bias: 0.016 });
  m.line([1.93, y1 + 0.018, 0.26], [1.93, y1 + 0.018, 1.04], trim, 0.02, [0, 1, 0], 0.018);
  // side window
  m.quad([[x1 + 0.006, 0.4, 0.62], [x1 + 0.006, 0.92, 0.62], [x1 + 0.006, 0.92, 1.1], [x1 + 0.006, 0.4, 1.1]], [1, 0, 0], trim, { bias: 0.01 });
  m.quad([[x1 + 0.01, 0.45, 0.66], [x1 + 0.01, 0.87, 0.66], [x1 + 0.01, 0.87, 1.06], [x1 + 0.01, 0.45, 1.06]], [1, 0, 0], '#4a6168', { lit: false, edge: null, bias: 0.012 });
  // brick chimney
  m.box(3.0, 0.3, h - 0.05, 3.28, 0.58, h + 0.75, '#a85f48', { grad: false });
  m.box(2.96, 0.26, h + 0.7, 3.32, 0.62, h + 0.8, '#8a4a38', { grad: false });
  const { ym } = m.gableX(x0, x1, y0, y1, h, 0.62, roof, '#efe6cf', { ex: 0.18, ey: 0.2, t: 0.07, wall, courses: 'shingle' });
  m.text([x1 + 0.008, ym, h + 0.2], [0, -1, 0], [0, 0, 1], 'G', 0.22, trim, [1, 0, 0]);
  // three tables with parasols on the deck
  const R = 0.5;
  [[0.9, 2.1, '#c0392b'], [2.0, 2.3, '#2f5c44'], [3.1, 2.0, '#c0392b']].forEach(([tx, ty, col]) => {
    const x = tx as number, y = ty as number;
    m.cyl(x, y, 0.07, 0.04, 0.32, 'z', '#3a3a36', { sides: 6 });
    m.cyl(x, y, 0.39, 0.24, 0.04, 'z', '#ede4cf', { sides: 14 });
    for (const [sx, sy] of [[x - 0.36, y + 0.06], [x + 0.3, y + 0.24]]) { m.cyl(sx, sy, 0.07, 0.03, 0.2, 'z', '#3a3a36', { sides: 6 }); m.cyl(sx, sy, 0.27, 0.1, 0.04, 'z', '#9a7048', { sides: 8 }); }
    m.line([x, y, 0.4], [x, y, 1.3], '#d9d4c6', 0.03, null, 0.2);
    const apex: V3 = [x, y, 1.26];
    for (let k = 0; k < 8; k++) {
      const t0 = (k / 8) * Math.PI * 2, t1 = ((k + 1) / 8) * Math.PI * 2, tm = (t0 + t1) / 2;
      m.quad([[x + Math.cos(t0) * R, y + Math.sin(t0) * R, 1.02], [x + Math.cos(t1) * R, y + Math.sin(t1) * R, 1.02], apex], [Math.cos(tm) * 0.24, Math.sin(tm) * 0.24, R], k % 2 ? '#f3ecdc' : (col as string), { edge: 'rgba(30,40,30,0.25)', bias: 0.2 });
    }
  });
  return m;
}

/** An open pavilion on four posts under a pointed copper-green roof. 3 x 3 tiles. */
function buildPavilion(): Mesh {
  const m = new Mesh();
  const x0 = 0.3, x1 = 2.7, y0 = 0.3, y1 = 2.7, pz = 1.5, cx = 1.5, cy = 1.5;
  const white = '#f4f1e6', roof = '#3f8a6a';
  m.box(0.1, 0.1, 0, 2.9, 2.9, 0.06, '#c9c3b2', { grad: false });
  m.box(x0 - 0.06, y0 - 0.06, 0.06, x1 + 0.06, y1 + 0.06, 0.16, '#e0d9c6', { grad: false });
  // low rail on the back and left sides, open at the front and right
  m.box(x0, y0, 0.16, x1, y0 + 0.05, 0.62, white, { grad: false });
  m.box(x0, y0, 0.16, x0 + 0.05, y1, 0.62, white, { grad: false });
  for (let t = 0.5; t < 2.7; t += 0.32) {
    m.box(t, y0, 0.16, t + 0.03, y0 + 0.05, 0.62, '#d4cfbf', { grad: false, edge: null });
    m.box(x0, t, 0.16, x0 + 0.05, t + 0.03, 0.62, '#d4cfbf', { grad: false, edge: null });
  }
  // bench inside against the rail
  m.box(0.6, 0.5, 0.16, 2.0, 0.78, 0.3, '#9a7048', { grad: false });
  // posts
  for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) m.box(px - 0.06, py - 0.06, 0.16, px + 0.06, py + 0.06, pz, white, { grad: false });
  // beam ring
  m.box(x0 - 0.08, y0 - 0.08, pz, x1 + 0.08, y0 + 0.06, pz + 0.1, white, { grad: false });
  m.box(x0 - 0.08, y0 - 0.08, pz, x0 + 0.06, y1 + 0.08, pz + 0.1, white, { grad: false });
  m.box(x0 - 0.08, y1 - 0.06, pz, x1 + 0.08, y1 + 0.08, pz + 0.1, white, { grad: false });
  m.box(x1 - 0.06, y0 - 0.08, pz, x1 + 0.08, y1 + 0.08, pz + 0.1, white, { grad: false });
  // pointed roof: four slopes, an overhang, a lantern at the top
  const ov = 0.28, X0 = x0 - ov, X1 = x1 + ov, Y0 = y0 - ov, Y1 = y1 + ov, zb = pz + 0.1, zt = pz + 1.0;
  const apex: V3 = [cx, cy, zt];
  const rise = zt - zb, run = (X1 - X0) / 2;
  m.quad([[X0, Y1, zb], [X1, Y1, zb], apex], [0, rise, run], roof);
  m.quad([[X1, Y0, zb], [X1, Y1, zb], apex], [rise, 0, run], roof);
  m.quad([[X0, Y0, zb], [X1, Y0, zb], apex], [0, -rise, run], roof);
  m.quad([[X0, Y0, zb], [X0, Y1, zb], apex], [-rise, 0, run], roof);
  m.quad([[X0, Y1, zb], [X1, Y1, zb], [X1, Y1, zb - 0.06], [X0, Y1, zb - 0.06]], [0, 1, 0], white, { bias: 0.003 });
  m.quad([[X1, Y0, zb], [X1, Y1, zb], [X1, Y1, zb - 0.06], [X1, Y0, zb - 0.06]], [1, 0, 0], white, { bias: 0.003 });
  for (let k = 1; k < 6; k++) {
    const t = k / 6;
    m.line([X0 + (cx - X0) * t * 0.9, Y1 + (cy - Y1) * t * 0.9, zb + rise * t * 0.9 + 0.004], [X1 + (cx - X1) * t * 0.9, Y1 + (cy - Y1) * t * 0.9, zb + rise * t * 0.9 + 0.004], 'rgba(20,50,40,0.28)', 0.02, [0, rise, run]);
  }
  m.cyl(cx, cy, zt - 0.02, 0.1, 0.22, 'z', white, { sides: 8 });
  const t2: V3 = [cx, cy, zt + 0.52];
  for (let k = 0; k < 4; k++) {
    const a0 = (k / 4) * Math.PI * 2 + Math.PI / 4, a1 = ((k + 1) / 4) * Math.PI * 2 + Math.PI / 4, am = (a0 + a1) / 2;
    m.quad([[cx + Math.cos(a0) * 0.16, cy + Math.sin(a0) * 0.16, zt + 0.2], [cx + Math.cos(a1) * 0.16, cy + Math.sin(a1) * 0.16, zt + 0.2], t2], [Math.cos(am), Math.sin(am), 0.6], roof, { bias: 0.1 });
  }
  m.cyl(cx, cy, zt + 0.5, 0.012, 0.18, 'z', '#f2c230', { sides: 4, edge: null });
  // hanging flower baskets at two posts
  for (const [px, py] of [[x1, y1], [x0, y1]]) {
    m.cyl(px, py, pz - 0.28, 0.1, 0.1, 'z', '#7d5a3c', { sides: 8 });
    for (let k = 0; k < 4; k++) m.cyl(px + Math.cos(k * 1.6) * 0.05, py + Math.sin(k * 1.6) * 0.05, pz - 0.18, 0.04, 0.06, 'z', ['#e8503f', '#f2c230', '#f4a0c0', '#e8503f'][k], { sides: 6, edge: null });
  }
  return m;
}

/** A glass house on a low brick footing, with plant benches inside. 3 x 2 tiles. */
function buildNursery(): Mesh {
  const m = new Mesh();
  const x0 = 0.2, x1 = 2.8, y0 = 0.2, y1 = 1.8, h = 0.95;
  const frame = '#f4f1e6';
  m.box(0.06, 0.06, 0, 2.94, 1.94, 0.05, '#cbc6ba', { grad: false });
  m.box(x0, y0, 0.05, x1, y1, 0.24, '#b0644c');
  for (let z = 0.1; z < 0.24; z += 0.06) m.line([x0, y1 + 0.004, z], [x1, y1 + 0.004, z], 'rgba(60,24,16,0.25)', 0.012, [0, 1, 0]);
  // inside: two plant benches with seedlings, seen through the glass
  const plants = ['#e8503f', '#f2c230', '#f4a0c0', '#9fd86a', '#e8503f', '#f4f0f8'];
  for (const by of [0.55, 1.3]) {
    m.box(0.45, by, 0.24, 2.55, by + 0.34, 0.5, '#9a7048', { grad: false });
    for (let k = 0; k < 8; k++) {
      m.cyl(0.58 + k * 0.26, by + 0.17, 0.5, 0.075, 0.16, 'z', '#3f9a48', { sides: 6, edge: null });
      m.cyl(0.58 + k * 0.26, by + 0.17, 0.66, 0.06, 0.05, 'z', plants[(k + (by > 1 ? 2 : 0)) % plants.length], { sides: 6, edge: null });
    }
  }
  // glass walls: translucent panes between white frames
  const pane = 'rgba(190,226,232,0.34)';
  m.quad([[x0, y1, 0.24], [x1, y1, 0.24], [x1, y1, h], [x0, y1, h]], [0, 1, 0], pane, { lit: false, edge: null, bias: 0.1 });
  m.quad([[x1, y0, 0.24], [x1, y1, 0.24], [x1, y1, h], [x1, y0, h]], [1, 0, 0], pane, { lit: false, edge: null, bias: 0.1 });
  for (let x = x0; x <= x1 + 0.01; x += 0.5) m.line([x, y1 + 0.004, 0.24], [x, y1 + 0.004, h], frame, 0.03, [0, 1, 0], 0.12);
  for (let y = y0; y <= y1 + 0.01; y += 0.4) m.line([x1 + 0.004, y, 0.24], [x1 + 0.004, y, h], frame, 0.03, [1, 0, 0], 0.12);
  m.line([x0, y1 + 0.004, h], [x1, y1 + 0.004, h], frame, 0.05, [0, 1, 0], 0.12);
  m.line([x0, y1 + 0.004, 0.5], [x1, y1 + 0.004, 0.5], frame, 0.025, [0, 1, 0], 0.12);
  // door on the front
  m.quad([[1.3, y1 + 0.01, 0.24], [1.7, y1 + 0.01, 0.24], [1.7, y1 + 0.01, 0.86], [1.3, y1 + 0.01, 0.86]], [0, 1, 0], 'rgba(244,241,230,0.9)', { lit: false, bias: 0.14, edge: null });
  m.line([1.5, y1 + 0.012, 0.24], [1.5, y1 + 0.012, 0.86], '#8a8a80', 0.02, [0, 1, 0], 0.15);
  // glass gable roof
  const ym = (y0 + y1) / 2, run = (y1 - y0) / 2, rise = 0.5, zR = h + rise, ex = 0.06;
  m.quad([[x1, y0, h], [x1, y1, h], [x1, ym, zR]], [1, 0, 0], 'rgba(190,226,232,0.4)', { lit: false, edge: frame, bias: 0.1 });
  const roofC = '#d3ecf0';
  m.quad([[x0 - ex, ym, zR], [x1 + ex, ym, zR], [x1 + ex, y1 + 0.1, h - 0.04], [x0 - ex, y1 + 0.1, h - 0.04]], [0, rise, run], roofC, { edge: frame, bias: 0.12 });
  m.quad([[x0 - ex, ym, zR], [x1 + ex, ym, zR], [x1 + ex, y0 - 0.1, h - 0.04], [x0 - ex, y0 - 0.1, h - 0.04]], [0, -rise, run], roofC, { edge: frame, bias: 0.12 });
  for (let x = x0; x <= x1 + 0.01; x += 0.5) m.line([x, ym, zR + 0.004], [x, y1 + 0.1, h - 0.04 + 0.004], frame, 0.025, [0, rise, run], 0.14);
  m.box(x0 - ex, ym - 0.04, zR - 0.02, x1 + ex, ym + 0.04, zR + 0.05, frame, { grad: false });
  // a watering can and a pot by the door
  m.cyl(2.2, 1.95, 0.0, 0.09, 0.2, 'z', '#3f8aa8', { sides: 8 });
  m.cyl(0.6, 1.95, 0.0, 0.1, 0.18, 'z', '#b0644c', { sides: 8 });
  m.cyl(0.6, 1.95, 0.18, 0.1, 0.06, 'z', '#3f9a48', { sides: 8, edge: null });
  return m;
}

/** A small roofed hut on four posts with a bench. 2 x 2 tiles. */
function buildShelter(): Mesh {
  const m = new Mesh();
  const white = '#f4efe0';
  m.box(0.1, 0.1, 0, 1.9, 1.9, 0.05, '#b58d62', { grad: false });
  m.box(0.22, 1.5, 0.05, 1.78, 1.78, 0.05 + 0.02, '#9a7048', { grad: false, edge: null });
  // bench against the back
  m.box(0.4, 0.34, 0.05, 1.6, 0.6, 0.28, '#9a7048', { grad: false });
  m.box(0.4, 0.3, 0.28, 1.6, 0.36, 0.7, '#9a7048', { grad: false });
  for (const [px, py] of [[0.28, 0.28], [1.72, 0.28], [0.28, 1.72], [1.72, 1.72]]) m.box(px - 0.05, py - 0.05, 0.05, px + 0.05, py + 0.05, 1.3, white, { grad: false });
  // back wall boards
  m.box(0.26, 0.24, 0.05, 1.74, 0.3, 1.3, '#c9b48a', { grad: false });
  m.gableX(0.24, 1.76, 0.24, 1.76, 1.3, 0.5, ROOF, '#efe6cf', { ex: 0.14, ey: 0.2, t: 0.06, wall: '#f0e7cf', courses: 'shingle' });
  m.cyl(1.72, 1.9, 0.0, 0.08, 0.28, 'z', '#7d5a3c', { sides: 8 });
  m.cyl(1.72, 1.9, 0.28, 0.07, 0.06, 'z', '#e8503f', { sides: 6, edge: null });
  return m;
}

export const CAR_COLOURS = ['#c8493a', '#3d6aa8', '#e6e0d0', '#3f7a5a', '#d6a63c', '#4b4f58']; // the same six, in the same order, as the parked cars in buildings.ts
/** A small hatchback built into a mesh at (ox, oy), nose along +x, or along +y when `alongY`. */
function addCar(m: Mesh, ox: number, oy: number, alongY: boolean, colour: string) {
  // boxes are axis-aligned, so a car turned a quarter swaps its length and width
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: string, o: Parameters<Mesh['box']>[7] = { grad: false }) =>
    alongY ? m.box(ox + y0, oy + x0, z0, ox + y1, oy + x1, z1, c, o) : m.box(ox + x0, oy + y0, z0, ox + x1, oy + y1, z1, c, o);
  for (const wx of [-0.46, 0.46])
    for (const wy of [-0.33, 0.25])
      if (alongY) m.cyl(ox + wy, oy + wx, 0.15, 0.15, 0.08, 'x', '#1f2124', { cap: '#3a3d40', sides: 10 });
      else m.cyl(ox + wx, oy + wy, 0.15, 0.15, 0.08, 'y', '#1f2124', { cap: '#3a3d40', sides: 10 });
  box(-0.74, -0.32, 0.12, 0.74, 0.32, 0.42, colour);
  box(-0.76, -0.3, 0.14, -0.74, 0.3, 0.26, '#2b2e30', { grad: false, edge: null });
  box(0.74, -0.3, 0.14, 0.76, 0.3, 0.26, '#2b2e30', { grad: false, edge: null });
  box(0.745, -0.27, 0.3, 0.765, -0.13, 0.38, '#fff3c4', { grad: false, edge: null });
  box(0.745, 0.13, 0.3, 0.765, 0.27, 0.38, '#fff3c4', { grad: false, edge: null });
  box(-0.765, -0.27, 0.3, -0.745, -0.15, 0.38, '#e8503f', { grad: false, edge: null });
  box(-0.765, 0.15, 0.3, -0.745, 0.27, 0.38, '#e8503f', { grad: false, edge: null });
  // glasshouse: tinted glass all round under a roof in the body colour
  box(-0.5, -0.3, 0.42, 0.3, 0.3, 0.64, '#bfe0ee');
  box(-0.52, -0.31, 0.64, 0.32, 0.31, 0.69, colour);
  box(-0.12, -0.305, 0.42, -0.07, 0.305, 0.64, colour, { grad: false, edge: null });
}
const carMeshes = new Map<number, Mesh>();
function carMesh(k: number): Mesh {
  let m = carMeshes.get(k);
  if (!m) { m = new Mesh(); addCar(m, 0, 0, false, CAR_COLOURS[k]); carMeshes.set(k, m); }
  return m;
}
/** A golfer's car on the entrance road, nose pointing along `heading` (radians; 0 = ground +x). */
export function drawCar(P: Painter, x: number, y: number, heading: number, colour = 0, alpha = 1) {
  const k = ((colour % CAR_COLOURS.length) + CAR_COLOURS.length) % CAR_COLOURS.length;
  const step = Math.round((heading * 32) / (Math.PI * 2)) & 31; // 32 headings keep the cache small
  const h = (step / 32) * Math.PI * 2;
  cached(P, `car${k}:${step}`, x, y, [-1.1, -1.1, 1.8, 1.4], 0.95, alpha, (Q) => {
    const cos = Math.cos(h), sin = Math.sin(h), ctx = Q.ctx;
    const corner = (u: number, v: number, dx = 0) => Q.toScreen(u * cos - v * sin + dx, u * sin + v * cos + dx * 0.28);
    ctx.fillStyle = 'rgba(10,24,16,0.28)';
    ctx.beginPath();
    [[0.8, 0.38], [0.8, -0.38], [-0.8, -0.38], [-0.8, 0.38]].forEach(([u, v], i) => { const q = corner(u, v, 0.3); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    ctx.closePath();
    ctx.fill();
    draw(Q, prepare(`car${k}:${step}`, carMesh(k), h), 0, 0);
  });
}
/** A car park: tarmac with painted bays and a few cars already in them. */
function buildCarPark(): Mesh {
  const m = new Mesh();
  m.box(0.06, 0.06, 0, 3.94, 2.94, 0.04, '#6a6d73', { grad: false });
  m.box(0.06, 0.06, 0.04, 3.94, 0.14, 0.1, '#c9c3b2', { grad: false, edge: null });
  m.box(0.06, 0.06, 0.04, 0.14, 2.94, 0.1, '#c9c3b2', { grad: false, edge: null });
  for (let k = 0; k <= 4; k++) {
    const x = 0.34 + k * 0.84;
    m.box(x, 0.2, 0.04, x + 0.04, 1.3, 0.045, '#f4efe0', { grad: false, edge: null });
    m.box(x, 1.75, 0.04, x + 0.04, 2.8, 0.045, '#f4efe0', { grad: false, edge: null });
  }
  addCar(m, 0.78, 0.8, true, CAR_COLOURS[1]);
  addCar(m, 2.46, 0.8, true, CAR_COLOURS[3]);
  addCar(m, 1.62, 2.24, true, CAR_COLOURS[0]);
  addCar(m, 3.3, 2.24, true, CAR_COLOURS[3]);
  return m;
}

/** Restrooms: a small rendered block with two coloured doors under a blue seamed roof. */
function buildRestroom(): Mesh {
  const m = new Mesh();
  m.box(0.1, 0.1, 0, 1.9, 1.9, 0.05, '#cbc6ba', { grad: false });
  m.box(0.3, 0.3, 0.05, 1.7, 1.45, 1.2, '#f0e7cf', { grad: false });
  m.box(0.3, 0.3, 0.05, 1.7, 1.47, 0.3, '#b9ad8a', { grad: false, edge: null });
  m.box(0.48, 1.45, 0.05, 0.86, 1.48, 0.95, '#3f6f93', { grad: false });
  m.box(1.14, 1.45, 0.05, 1.52, 1.48, 0.95, '#a44a5c', { grad: false });
  m.box(0.6, 1.48, 0.62, 0.74, 1.5, 0.76, '#f6f0dc', { grad: false, edge: null });
  m.box(1.26, 1.48, 0.62, 1.4, 1.5, 0.76, '#f6f0dc', { grad: false, edge: null });
  m.gableX(0.3, 1.7, 0.3, 1.45, 1.2, 0.42, '#4f7f96', '#efe6cf', { ex: 0.12, ey: 0.18, t: 0.06, wall: '#f0e7cf', courses: 'seam' });
  return m;
}
/** The starter's hut: a timber kiosk with a serving hatch, a shelf, and the club flag on a pole. */
function buildStarter(): Mesh {
  const m = new Mesh();
  m.box(0.1, 0.1, 0, 1.9, 1.9, 0.05, '#b58d62', { grad: false });
  m.box(0.4, 0.4, 0.05, 1.6, 1.4, 1.15, '#e3d6ad', { grad: false });
  m.box(0.68, 1.4, 0.55, 1.32, 1.42, 0.98, '#2c221c', { grad: false });
  m.box(0.6, 1.4, 0.48, 1.4, 1.58, 0.54, '#9a7048', { grad: false });
  m.box(1.6, 0.7, 0.05, 1.62, 1.05, 0.9, '#7d5a3c', { grad: false });
  m.gableX(0.4, 1.6, 0.4, 1.4, 1.15, 0.45, '#3f8a6a', '#f6f0dc', { ex: 0.14, ey: 0.24, t: 0.06, wall: '#e3d6ad', courses: 'shingle' });
  m.cyl(0.26, 1.72, 0.05, 0.035, 2.0, 'z', '#f4efe0', { sides: 6 });
  m.flat([[0.26, 1.72, 2.05], [0.26, 1.72, 1.7], [0.78, 1.72, 1.87]], '#e8503f');
  return m;
}
/** A windmill: a white tower on a stone base, a red cap, and four sails facing the camera side. */
function buildWindmill(): Mesh {
  const m = new Mesh();
  m.cyl(1, 1, 0, 0.66, 0.42, 'z', '#a9a293', { sides: 12 });
  m.cyl(1, 1, 0.42, 0.56, 0.75, 'z', '#f4efe0', { sides: 12 });
  m.cyl(1, 1, 1.17, 0.5, 0.75, 'z', '#f4efe0', { sides: 12 });
  m.cyl(1, 1, 1.92, 0.44, 0.5, 'z', '#f4efe0', { sides: 12 });
  m.cyl(1, 1, 2.42, 0.5, 0.2, 'z', ROOF, { sides: 12 });
  m.cyl(1, 1, 2.62, 0.3, 0.2, 'z', ROOF, { sides: 12 });
  m.box(0.86, 1.52, 0.42, 1.14, 1.6, 0.98, '#7d5a3c', { grad: false });
  m.box(0.92, 1.44, 1.4, 1.08, 1.5, 1.62, '#3a4a5a', { grad: false });
  // the sails: four flat arms in the plane facing +y, turned a little off the vertical
  const hx = 1, hy = 1.66, hz = 2.2;
  m.cyl(hx, 1.46, hz, 0.07, 0.24, 'y', '#7d5a3c', { sides: 8 });
  for (let k = 0; k < 4; k++) {
    const a = (25 + 90 * k) * Math.PI / 180;
    const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx;
    const q = (t: number, s: number): [number, number, number] => [hx + dx * t + px * s, hy, hz + dz * t + pz * s];
    m.flat([q(0.05, -0.03), q(1.35, -0.03), q(1.35, 0.03), q(0.05, 0.03)], '#7d5a3c');
    m.flat([q(0.35, 0.03), q(1.3, 0.03), q(1.3, 0.3), q(0.35, 0.3)], '#f6f0dc');
    // lattice: an outer rail and three cross bars
    m.flat([q(0.35, 0.27), q(1.3, 0.27), q(1.3, 0.31), q(0.35, 0.31)], '#9a7048', { edge: null });
    for (const t of [0.35, 0.67, 0.98, 1.27]) m.flat([q(t, 0.03), q(t + 0.035, 0.03), q(t + 0.035, 0.3), q(t, 0.3)], '#9a7048', { edge: null });
  }
  return m;
}

// =====================================================================================================
// Upgradeable buildings: the golf academy, the restaurant and the tournament centre. Each is built for a
// level (1-3, extras added at each) and a number of people (0-9) at fixed slots, and every variant is cached.
// =====================================================================================================
const SHIRTS = ['#c0392b', '#2f6a8a', '#f2c230', '#3f8a5a', '#f4efe0', '#8e4a7a', '#e07a3a'];
const SKIN = ['#efcfae', '#d2a07a', '#a06a48', '#e6bd96'];
const PANTS = ['#3a3d48', '#c9b896', '#2f3f5c', '#5a4a3a'];
/** A tiny figure: legs, a shirt, a head. Seated figures sit on a stool at `z`. */
function person(m: Mesh, x: number, y: number, z: number, k: number, seated = false) {
  const shirt = SHIRTS[k % SHIRTS.length], skin = SKIN[(k * 3 + 1) % SKIN.length], pants = PANTS[(k * 5 + 2) % PANTS.length];
  const e = { grad: false, edge: 'rgba(28,26,46,0.55)' };
  let zt: number;
  if (seated) {
    m.box(x - 0.06, y - 0.02, z, x + 0.06, y + 0.16, z + 0.08, pants, e);
    m.box(x - 0.08, y - 0.06, z + 0.06, x + 0.08, y + 0.05, z + 0.3, shirt, e);
    zt = z + 0.3;
  } else {
    m.box(x - 0.055, y - 0.04, z, x + 0.055, y + 0.04, z + 0.3, pants, e);
    m.box(x - 0.08, y - 0.055, z + 0.28, x + 0.08, y + 0.055, z + 0.55, shirt, e);
    zt = z + 0.55;
  }
  m.box(x - 0.055, y - 0.055, zt + 0.01, x + 0.055, y + 0.055, zt + 0.13, skin, { grad: false, edge: 'rgba(28,26,46,0.5)' });
}

/** A hipped roof (ridge along x, slopes on all four sides) with an overhang, fascia and courses. */
function hipX(m: Mesh, x0: number, x1: number, y0: number, y1: number, zEave: number, rise: number, roof: string, fascia: string, ov = 0.2) {
  const X0 = x0 - ov, X1 = x1 + ov, Y0 = y0 - ov, Y1 = y1 + ov, zE = zEave - 0.08, ym = (y0 + y1) / 2, run = (Y1 - Y0) / 2, zR = zE + rise;
  const R0: V3 = [X0 + run, ym, zR], R1: V3 = [X1 - run, ym, zR];
  m.quad([[X0, Y1, zE], [X1, Y1, zE], R1, R0], [0, rise, run], roof);
  m.quad([[X0, Y0, zE], [X1, Y0, zE], R1, R0], [0, -rise, run], roof);
  m.quad([[X1, Y0, zE], [X1, Y1, zE], R1], [rise, 0, run], roof);
  m.quad([[X0, Y0, zE], [X0, Y1, zE], R0], [-rise, 0, run], roof);
  const t = 0.07;
  m.quad([[X0, Y1, zE], [X1, Y1, zE], [X1, Y1, zE - t], [X0, Y1, zE - t]], [0, 1, 0], fascia, { bias: 0.003 });
  m.quad([[X1, Y0, zE], [X1, Y1, zE], [X1, Y1, zE - t], [X1, Y0, zE - t]], [1, 0, 0], fascia, { bias: 0.003 });
  for (let f = 0.14; f < 0.97; f += 0.14) {
    const z = zE + rise * f + 0.004, d = run * f;
    m.line([X0 + d, Y1 - d, z], [X1 - d, Y1 - d, z], 'rgba(28,20,14,0.26)', 0.022, [0, rise, run]);
    m.line([X1 - d, Y0 + d, z], [X1 - d, Y1 - d, z], 'rgba(28,20,14,0.22)', 0.022, [rise, 0, run]);
  }
  m.box(R0[0], ym - 0.05, zR - 0.02, R1[0], ym + 0.05, zR + 0.05, roof, { grad: false, faces: { pz: tone(roof, 1.18) } });
}

/** The two walls of a block the camera sees (+x and +y), sorted early so the windows, signs and boards
 *  painted on them always land on top of a long wall rather than sinking behind its centre. */
function walls(m: Mesh, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: string, side = c) {
  m.quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], c, { grad: true, bias: -1.6 });
  m.quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0], side, { grad: true, bias: -1.0 });
}

/** A front window (on the +y wall at y) with a trim frame, glass and a glint. */
function frontWindow(m: Mesh, y: number, w0: number, w1: number, z0: number, z1: number, trim: string, glass = '#4a6a72', mullion = true) {
  m.quad([[w0 - 0.05, y + 0.01, z0 - 0.05], [w1 + 0.05, y + 0.01, z0 - 0.05], [w1 + 0.05, y + 0.01, z1 + 0.05], [w0 - 0.05, y + 0.01, z1 + 0.05]], [0, 1, 0], trim, { bias: 0.01 });
  m.quad([[w0, y + 0.014, z0], [w1, y + 0.014, z0], [w1, y + 0.014, z1], [w0, y + 0.014, z1]], [0, 1, 0], glass, { lit: false, edge: null, bias: 0.014 });
  m.quad([[w0, y + 0.016, z1 - (z1 - z0) * 0.22], [w1, y + 0.016, z1 - (z1 - z0) * 0.22], [w1, y + 0.016, z1], [w0, y + 0.016, z1]], [0, 1, 0], 'rgba(255,255,255,0.22)', { lit: false, edge: null, bias: 0.016 });
  if (mullion) m.line([(w0 + w1) / 2, y + 0.018, z0], [(w0 + w1) / 2, y + 0.018, z1], '#f6f0dc', 0.02, [0, 1, 0], 0.018);
}
/** A side window on the +x wall at x. */
function sideWindow(m: Mesh, x: number, v0: number, v1: number, z0: number, z1: number, trim: string) {
  m.quad([[x + 0.006, v0 - 0.05, z0 - 0.05], [x + 0.006, v1 + 0.05, z0 - 0.05], [x + 0.006, v1 + 0.05, z1 + 0.05], [x + 0.006, v0 - 0.05, z1 + 0.05]], [1, 0, 0], trim, { bias: 0.01 });
  m.quad([[x + 0.01, v0, z0], [x + 0.01, v1, z0], [x + 0.01, v1, z1], [x + 0.01, v0, z1]], [1, 0, 0], '#4a6168', { lit: false, edge: null, bias: 0.012 });
}
/** A flag on a pole: a pennant in the x-z plane. */
function flagPole(m: Mesh, x: number, y: number, h: number, col: string, len = 0.5, r = 0.03, z0 = 0) {
  m.cyl(x, y, z0, r, h - z0, 'z', '#f4efe0', { sides: 6 });
  m.flat([[x, y, h - 0.02], [x, y, h - 0.34], [x + len, y, h - 0.18]], col, { edge: 'rgba(28,26,46,0.6)' });
}
/** A café table with two stools; returns the stool positions for diners. */
function cafeTable(m: Mesh, x: number, y: number, z: number): [number, number][] {
  m.cyl(x, y, z, 0.04, 0.32, 'z', '#3a3a36', { sides: 4, edge: null });
  m.cyl(x, y, z + 0.32, 0.22, 0.04, 'z', '#ede4cf', { sides: 8 });
  const seats: [number, number][] = [[x - 0.34, y + 0.04], [x + 0.28, y + 0.22]];
  for (const [sx, sy] of seats) { m.cyl(sx, sy, z, 0.03, 0.2, 'z', '#3a3a36', { sides: 4, edge: null }); m.cyl(sx, sy, z + 0.2, 0.1, 0.04, 'z', '#9a7048', { sides: 6 }); }
  return seats;
}
function parasol(m: Mesh, x: number, y: number, z: number, col: string, R = 0.46) {
  m.line([x, y, z + 0.33], [x, y, z + 1.22], '#d9d4c6', 0.03, null, 0.2);
  const apex: V3 = [x, y, z + 1.2];
  for (let k = 0; k < 8; k++) {
    const t0 = (k / 8) * Math.PI * 2, t1 = ((k + 1) / 8) * Math.PI * 2, tm = (t0 + t1) / 2;
    m.quad([[x + Math.cos(t0) * R, y + Math.sin(t0) * R, z + 0.96], [x + Math.cos(t1) * R, y + Math.sin(t1) * R, z + 0.96], apex], [Math.cos(tm) * 0.24, Math.sin(tm) * 0.24, R], k % 2 ? '#f3ecdc' : col, { edge: 'rgba(30,40,30,0.25)', bias: 0.2 });
  }
}
/** A flat ellipse on the ground (a green, a hole). */
function disc(m: Mesh, cx: number, cy: number, rx: number, ry: number, z: number, c: string, n = 14, edge: string | null = null) {
  const p: V3[] = [];
  for (let k = 0; k < n; k++) { const t = (k / n) * Math.PI * 2; p.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry, z]); }
  m.quad(p, [0, 0, 1], c, { edge, grad: false });
}
/** String lights: a sagging wire from a to b with warm bulbs. */
function lights(m: Mesh, a: V3, b: V3, sag = 0.14, bulbs = 6) {
  const at = (t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - sag * 4 * t * (1 - t)];
  const segs = 4;
  for (let k = 0; k < segs; k++) m.line(at(k / segs), at((k + 1) / segs), 'rgba(40,36,30,0.75)', 0.012, null, 0.3);
  for (let k = 1; k <= bulbs; k++) { const p = at(k / (bulbs + 1)); m.line(p, [p[0], p[1], p[2] - 0.035], '#ffe08a', 0.05, null, 0.32); }
}

/** Golf academy: a classroom with a sign, three roofed hitting bays with mats, a bucket of balls and a target flag. 5 x 3 tiles. */
function buildAcademy(level: number, people: number): Mesh {
  const m = new Mesh();
  const wall = '#f0e7cf', trim = '#2f5c44', roof = ROOF;
  const x0 = 0.2, x1 = 2.0, y0 = 0.2, y1 = 1.4, h = 1.32;
  m.box(0.06, 0.06, 0, 4.94, 1.78, 0.05, '#cbc6ba', { grad: false });
  // classroom
  m.box(x0, y0, 0.05, x1, y1, 0.2, '#a69b7e', { grad: false });
  walls(m, x0, y0, 0.2, x1, y1, h, wall);
  for (let z = 0.3; z < h - 0.04; z += 0.1) m.line([x0, y1 + 0.004, z], [x1, y1 + 0.004, z], 'rgba(130,112,74,0.28)', 0.012, [0, 1, 0]);
  m.box(x0 - 0.03, y1 - 0.02, 0.2, x0 + 0.03, y1 + 0.03, h, trim, { grad: false });
  m.box(x1 - 0.03, y1 - 0.02, 0.2, x1 + 0.03, y1 + 0.03, h, trim, { grad: false });
  frontWindow(m, y1, 0.42, 1.12, 0.46, 1.0, trim);
  // a little whiteboard seen through the window
  m.quad([[0.52, y1 + 0.018, 0.74], [0.8, y1 + 0.018, 0.74], [0.8, y1 + 0.018, 0.92], [0.52, y1 + 0.018, 0.92]], [0, 1, 0], '#e9eee8', { lit: false, edge: null, bias: 0.02 });
  const d0 = 1.38, d1 = 1.78;
  m.quad([[d0 - 0.05, y1 + 0.01, 0.2], [d1 + 0.05, y1 + 0.01, 0.2], [d1 + 0.05, y1 + 0.01, 1.08], [d0 - 0.05, y1 + 0.01, 1.08]], [0, 1, 0], trim, { bias: 0.01 });
  m.quad([[d0, y1 + 0.014, 0.2], [d1, y1 + 0.014, 0.2], [d1, y1 + 0.014, 1.03], [d0, y1 + 0.014, 1.03]], [0, 1, 0], '#3f6a54', { bias: 0.05, grad: true });
  m.quad([[d0 + 0.07, y1 + 0.018, 0.62], [d1 - 0.07, y1 + 0.018, 0.62], [d1 - 0.07, y1 + 0.018, 0.96], [d0 + 0.07, y1 + 0.018, 0.96]], [0, 1, 0], '#6a8a92', { lit: false, edge: null, bias: 0.06 });
  m.gableX(x0, x1, y0, y1, h, 0.56, roof, '#efe6cf', { ex: 0.14, ey: 0.2, t: 0.07, wall, courses: 'shingle' });
  m.box(0.4, y1 + 0.01, h - 0.02, 1.8, y1 + 0.08, h + 0.28, trim, { grad: false });
  m.text([1.1, y1 + 0.086, h + 0.13], [1, 0, 0], [0, 0, 1], 'ACADEMY', 0.16, '#f6ecc8', [0, 1, 0]);
  // hitting bays: a back wall, partitions, posts, a lean-to roof, a mat in each bay
  const bx0 = 2.22, bx1 = 4.8, by0 = 0.24, by1 = 1.52, bh = 1.0;
  const bays = 3, bw = (bx1 - bx0) / bays;
  m.box(bx0, 0.06, 0.05, bx1, 1.62, 0.09, '#d8d2c2', { grad: false });
  walls(m, bx0, by0, 0.09, bx1, by0 + 0.08, bh + 0.24, wall);
  m.box(bx1 - 0.06, by0, 0.09, bx1, 0.9, bh + 0.05, wall, { grad: false });
  for (let k = 0; k <= bays; k++) {
    const px = bx0 + k * bw;
    if (k > 0 && k < bays) m.box(px - 0.03, by0 + 0.08, 0.09, px + 0.03, 0.86, 0.8, trim, { grad: false });
    m.box(px - (k === bays ? 0.08 : 0.04), by1 - 0.08, 0.09, px + (k === 0 ? 0.08 : 0.04), by1, bh, '#f4efe0', { grad: false });
  }
  for (let k = 0; k < bays; k++) {
    const a = bx0 + k * bw + 0.14, b = bx0 + (k + 1) * bw - 0.14;
    m.box(a, 0.98, 0.09, b, 1.46, 0.11, '#3f9a52', { grad: false });
    m.cyl((a + b) / 2, 1.3, 0.11, 0.02, 0.04, 'z', '#f6f6f0', { sides: 5, edge: null });
    // yardage number above each bay
    m.text([(a + b) / 2, by0 + 0.085, 0.92], [1, 0, 0], [0, 0, 1], String(k + 1), 0.14, trim, [0, 1, 0]);
  }
  // lean-to roof falling toward the front
  const rz0 = bh + 0.3, rz1 = bh, ry0 = 0.12, ry1 = by1 + 0.14, rxa = bx0 - 0.06, rxb = bx1 + 0.14;
  m.quad([[rxa, ry0, rz0], [rxb, ry0, rz0], [rxb, ry1, rz1], [rxa, ry1, rz1]], [0, rz0 - rz1, ry1 - ry0], roof);
  m.quad([[rxa, ry1, rz1], [rxb, ry1, rz1], [rxb, ry1, rz1 - 0.07], [rxa, ry1, rz1 - 0.07]], [0, 1, 0], '#efe6cf', { bias: 0.003 });
  m.quad([[rxb, ry0, rz0], [rxb, ry1, rz1], [rxb, ry1, rz1 - 0.07], [rxb, ry0, rz0 - 0.07]], [1, 0, 0], '#efe6cf', { bias: 0.003 });
  for (let x = rxa + 0.22; x < rxb - 0.05; x += 0.24) m.line([x, ry0, rz0 + 0.004], [x, ry1, rz1 + 0.004], 'rgba(28,20,14,0.24)', 0.02, [0, rz0 - rz1, ry1 - ry0]);
  m.quad([[bx1 + 0.004, by0, bh * 0.3], [bx1 + 0.004, 0.9, bh * 0.3], [bx1 + 0.004, 0.9, bh * 0.36], [bx1 + 0.004, by0, bh * 0.36]], [1, 0, 0], trim, { edge: null, bias: 0.01 });
  // a bucket of balls by the first bay, a target flag out on the grass
  m.cyl(bx0 + 0.2, 1.7, 0.0, 0.11, 0.18, 'z', '#c39a3a', { sides: 8 });
  for (const [dx, dy] of [[-0.04, -0.03], [0.04, 0.0], [0.0, 0.05], [-0.03, 0.04]]) m.cyl(bx0 + 0.2 + dx, 1.7 + dy, 0.18, 0.035, 0.03, 'z', '#f8f8f2', { sides: 5, edge: null });
  disc(m, 4.55, 2.3, 0.22, 0.14, 0.004, '#e8e2c8', 10, 'rgba(28,26,46,0.35)');
  flagPole(m, 4.55, 2.3, 1.05, '#f2c230', 0.32, 0.022);
  // level 2: a practice putting green with a flag, and a chipping net
  const slots: [number, number, number, boolean][] = [];
  for (let k = 0; k < bays; k++) slots.push([bx0 + (k + 0.5) * bw - 0.1, 1.22, 0.11, false]);
  if (level >= 2) {
    disc(m, 1.1, 2.3, 0.95, 0.56, 0.006, '#5f9e48', 16);
    disc(m, 1.1, 2.3, 0.82, 0.46, 0.012, '#7cc062', 16);
    for (let k = 0; k < 4; k++) m.line([0.42 + k * 0.4, 1.94 + (k % 2) * 0.06, 0.014], [0.6 + k * 0.4, 2.66 - (k % 2) * 0.06, 0.014], 'rgba(255,255,255,0.12)', 0.06, [0, 0, 1]);
    disc(m, 1.5, 2.42, 0.05, 0.035, 0.016, '#1e2a1e', 8);
    flagPole(m, 1.5, 2.42, 0.85, '#c0392b', 0.26, 0.018);
    for (const [bx, by] of [[0.7, 2.18], [0.95, 2.5]]) m.cyl(bx, by, 0.014, 0.03, 0.03, 'z', '#f8f8f2', { sides: 5, edge: null });
    // chipping net: a hoop on a stand
    const nx = 2.55, ny = 2.45;
    m.box(nx - 0.3, ny - 0.03, 0, nx + 0.3, ny + 0.03, 0.04, '#3a3a36', { grad: false });
    m.flat([[nx - 0.26, ny, 0.06], [nx + 0.26, ny, 0.06], [nx + 0.22, ny - 0.12, 0.5], [nx - 0.22, ny - 0.12, 0.5]], 'rgba(240,240,230,0.35)', { edge: null });
    m.ring([nx, ny - 0.06, 0.3], [1, 0, 0], [0, -0.28, 0.96], 0.26, '#d8d2c2', 0.03);
    slots.push([0.8, 2.25, 0.012, false], [1.3, 2.62, 0.012, false]);
  }
  // level 3: a junior zone of bright little flags on soft turf, with a parasol
  if (level >= 3) {
    m.box(2.95, 1.9, 0, 4.1, 2.88, 0.03, '#8fcf6a', { grad: false });
    const col = ['#c0392b', '#2f6a8a', '#f2c230', '#8e4a7a'];
    [[3.15, 2.05], [3.85, 2.1], [3.25, 2.7], [3.9, 2.72]].forEach(([fx, fy], i) => {
      disc(m, fx, fy, 0.05, 0.035, 0.034, '#1e2a1e', 6);
      m.cyl(fx, fy, 0.03, 0.012, 0.5, 'z', '#f4efe0', { sides: 4, edge: null });
      m.flat([[fx, fy, 0.53], [fx, fy, 0.38], [fx + 0.18, fy, 0.455]], col[i], { edge: 'rgba(28,26,46,0.5)' });
    });
    m.cyl(3.55, 2.4, 0.03, 0.08, 0.1, 'z', '#e07a3a', { sides: 8 });
    for (const [a, b] of [[[2.95, 2.88], [4.1, 2.88]], [[4.1, 1.9], [4.1, 2.88]]] as [number, number][][]) {
      m.line([a[0], a[1], 0.16], [b[0], b[1], 0.16], '#f4efe0', 0.03, null, 0.05);
      for (let t = 0; t <= 1.001; t += 0.25) m.line([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0.03], [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0.2], '#f4efe0', 0.03, null, 0.05);
    }
    slots.push([3.3, 2.6, 0.03, false], [3.85, 2.25, 0.03, false]);
  }
  slots.push([2.5, 1.95, 0, false], [0.55, 1.7, 0, false], [1.95, 1.78, 0, false], [4.0, 1.95, 0, false], [0.3, 2.6, 0, false], [2.9, 2.75, 0, false]);
  for (let k = 0; k < Math.min(people, slots.length, 9); k++) {
    const [px, py, pz] = slots[k];
    person(m, px, py, pz, k);
    if (k < bays) m.line([px + 0.08, py + 0.04, pz + 0.4], [px + 0.2, py + 0.18, pz + 0.02], '#2a2a2a', 0.018, null, 0.05);
  }
  return m;
}

/** Restaurant: a long dining hall under a hipped roof, big windows, a patio deck in front with tables, parasols, planters and string lights. 5 x 4 tiles. */
function buildRestaurant(level: number, people: number): Mesh {
  const m = new Mesh();
  const wall = '#f1e8d2', trim = '#7a3b2e', roof = ROOF;
  const x0 = 0.25, x1 = 4.75, y0 = 0.2, y1 = 1.6, h = 1.56;
  const deckY = level >= 2 ? 3.9 : 3.05;
  m.box(0.08, 0.08, 0, 4.92, y1 + 0.1, 0.05, '#cbc6ba', { grad: false });
  // deck
  m.box(0.1, y1 + 0.05, 0, 4.9, deckY, 0.09, '#b58d62', { grad: false });
  for (let x = 0.3; x < 4.9; x += 0.2) m.line([x, y1 + 0.05, 0.092], [x, deckY, 0.092], 'rgba(80,50,26,0.26)', 0.012, [0, 0, 1]);
  // hall
  m.box(x0, y0, 0.05, x1, y1, 0.22, '#a69b7e', { grad: false });
  walls(m, x0, y0, 0.22, x1, y1, h, wall);
  for (let z = 0.34; z < h - 0.04; z += 0.1) {
    m.line([x0, y1 + 0.004, z], [x1, y1 + 0.004, z], 'rgba(130,112,74,0.26)', 0.012, [0, 1, 0]);
    m.line([x1 + 0.004, y0, z], [x1 + 0.004, y1, z], 'rgba(90,76,50,0.26)', 0.012, [1, 0, 0]);
  }
  m.box(x0 - 0.03, y1 - 0.02, 0.22, x0 + 0.03, y1 + 0.03, h, trim, { grad: false });
  m.box(x1 - 0.03, y1 - 0.02, 0.22, x1 + 0.03, y1 + 0.03, h, trim, { grad: false });
  // big windows either side of the doors, warm light inside
  for (const wx of [0.5, 1.28, 3.12, 3.9]) {
    frontWindow(m, y1, wx, wx + 0.56, 0.4, 1.14, trim, '#5a6e6a');
    m.quad([[wx + 0.04, y1 + 0.015, 0.42], [wx + 0.52, y1 + 0.015, 0.42], [wx + 0.52, y1 + 0.015, 0.62], [wx + 0.04, y1 + 0.015, 0.62]], [0, 1, 0], 'rgba(255,214,140,0.35)', { lit: false, edge: null, bias: 0.015 });
  }
  const d0 = 2.18, d1 = 2.82;
  m.quad([[d0 - 0.05, y1 + 0.01, 0.22], [d1 + 0.05, y1 + 0.01, 0.22], [d1 + 0.05, y1 + 0.01, 1.14], [d0 - 0.05, y1 + 0.01, 1.14]], [0, 1, 0], trim, { bias: 0.01 });
  m.quad([[d0, y1 + 0.014, 0.22], [d1, y1 + 0.014, 0.22], [d1, y1 + 0.014, 1.1], [d0, y1 + 0.014, 1.1]], [0, 1, 0], '#5b7e84', { lit: false, edge: null, bias: 0.05 });
  m.line([2.5, y1 + 0.018, 0.22], [2.5, y1 + 0.018, 1.1], trim, 0.025, [0, 1, 0], 0.06);
  sideWindow(m, x1, 0.45, 0.85, 0.5, 1.12, trim);
  sideWindow(m, x1, 1.0, 1.4, 0.5, 1.12, trim);
  // brick chimney at the back
  m.box(3.7, 0.5, h - 0.1, 3.98, 0.78, h + 0.92, '#a85f48', { grad: false });
  m.box(3.66, 0.46, h + 0.86, 4.02, 0.82, h + 0.96, '#8a4a38', { grad: false });
  hipX(m, x0, x1, y0, y1, h, 0.78, roof, '#efe6cf', 0.2);
  // sign board on the wall above the doors
  // sign board standing on the front eave
  m.box(1.62, y1 + 0.2, h - 0.12, 3.38, y1 + 0.27, h + 0.22, trim, { grad: false });
  m.text([2.5, y1 + 0.276, h + 0.05], [1, 0, 0], [0, 0, 1], 'RESTAURANT', 0.17, '#f6ecc8', [0, 1, 0]);
  // planters along the deck's front edge
  const planter = (px: number, py: number) => {
    m.box(px - 0.16, py - 0.12, 0.09, px + 0.16, py + 0.12, 0.3, '#9a6a48', { grad: false });
    m.box(px - 0.13, py - 0.09, 0.3, px + 0.13, py + 0.09, 0.4, '#3f8a48', { grad: false, edge: 'rgba(20,50,30,0.5)' });
    for (let k = 0; k < 3; k++) { const fx = px - 0.08 + k * 0.08, fy = py + (k % 2 ? -0.03 : 0.04); m.line([fx, fy, 0.41], [fx, fy, 0.44], ['#e8503f', '#f2c230', '#f4a0c0'][k], 0.06, null, 0.05); }
  };
  planter(0.3, deckY - 0.18);
  planter(4.7, deckY - 0.18);
  planter(0.3, y1 + 0.3);
  planter(4.7, y1 + 0.3);
  // tables: a row by the hall, and a second row when the deck is extended
  const seats: [number, number, number, boolean][] = [];
  const cols = ['#c0392b', '#2f5c44', '#c0392b'];
  const rowA = 2.4;
  [0.95, 2.5, 4.05].forEach((tx, i) => {
    for (const [sx, sy] of cafeTable(m, tx, rowA, 0.09)) seats.push([sx, sy, 0.33, true]);
    if (level < 3) parasol(m, tx, rowA, 0.09, cols[i]);
  });
  if (level >= 2) {
    [1.7, 3.3].forEach((tx, i) => {
      for (const [sx, sy] of cafeTable(m, tx, 3.25, 0.09)) seats.push([sx, sy, 0.33, true]);
      parasol(m, tx, 3.25, 0.09, ['#2f5c44', '#c0392b'][i]);
    });
  }
  // string lights: tall posts at the deck corners, wires back to the eave
  const zl = 1.5;
  const posts: V3[] = [[0.18, deckY - 0.08, zl], [4.82, deckY - 0.08, zl]];
  for (const [px, py] of posts) m.box(px - 0.035, py - 0.035, 0.09, px + 0.035, py + 0.035, zl + 0.04, '#9a7048', { grad: false });
  if (level < 3) {
    lights(m, [0.4, y1 + 0.02, 1.48], posts[0], 0.16, 4);
    lights(m, [4.6, y1 + 0.02, 1.48], posts[1], 0.16, 4);
    lights(m, posts[0], posts[1], 0.22, 10);
  }
  // level 3: a garden pergola over the inner patio, hung with lights
  if (level >= 3) {
    const py1 = 2.95, pz = 1.42, wood = '#f4efe0';
    const pe = { grad: false, edge: 'rgba(28,26,46,0.45)' };
    for (const px of [0.3, 1.72, 3.28, 4.7]) m.box(px - 0.06, py1 - 0.06, 0.09, px + 0.06, py1 + 0.06, pz, wood, pe);
    m.box(0.2, py1 - 0.08, pz, 4.8, py1 + 0.08, pz + 0.14, wood, pe);
    m.box(0.2, y1 + 0.02, pz, 4.8, y1 + 0.1, pz + 0.1, wood, pe);
    for (let x = 0.5; x < 4.6; x += 0.68) m.box(x - 0.03, y1 + 0.02, pz + 0.1, x + 0.03, py1 + 0.16, pz + 0.16, wood, { grad: false, edge: null, faces: { px: '#d8ccb0' } });
    // climbing vine at the posts and along the beam
    for (const px of [0.3, 4.7]) m.cyl(px, py1, 0.09, 0.08, pz - 0.1, 'z', '#4f8a3c', { sides: 6, edge: null });
    for (let k = 0; k < 3; k++) { const a = 0.4 + k * 1.55; lights(m, [a, y1 + 0.06, pz - 0.02], [a + 1.4, py1, pz - 0.02], 0.12, 5); }
    lights(m, [0.3, py1 + 0.06, pz], [4.7, py1 + 0.06, pz], 0.12, 10);
    if (level >= 2) { lights(m, posts[0], [0.3, py1 + 0.06, pz], 0.1, 2); lights(m, posts[1], [4.7, py1 + 0.06, pz], 0.1, 2); lights(m, posts[0], posts[1], 0.22, 10); }
  }
  // a waiter and a few standing guests if the seats run out
  seats.push([2.5, 1.95, 0.09, false], [1.6, 2.95, 0.09, false], [3.5, 2.0, 0.09, false]);
  for (let k = 0; k < Math.min(people, seats.length); k++) { const [px, py, pz, s] = seats[k]; person(m, px, py, pz, k + 2, s); }
  return m;
}

/** Tournament centre: a two-storey scoring office with a sign, three pennants and a big leaderboard. 4 x 3 tiles. */
function buildTourney(level: number, people: number): Mesh {
  const m = new Mesh();
  const wall = '#f0e7cf', trim = '#2f5c44', roof = ROOF;
  const x0 = 0.2, x1 = 1.85, y0 = 0.2, y1 = 1.35, h = 1.95, mid = 1.0;
  m.box(0.06, 0.06, 0, 3.94, 1.7, 0.05, '#cbc6ba', { grad: false });
  m.box(x0, y0, 0.05, x1, y1, 0.2, '#a69b7e', { grad: false });
  walls(m, x0, y0, 0.2, x1, y1, h, wall);
  for (let z = 0.3; z < h - 0.04; z += 0.1) {
    m.line([x0, y1 + 0.004, z], [x1, y1 + 0.004, z], 'rgba(130,112,74,0.26)', 0.012, [0, 1, 0]);
    m.line([x1 + 0.004, y0, z], [x1 + 0.004, y1, z], 'rgba(90,76,50,0.26)', 0.012, [1, 0, 0]);
  }
  m.box(x0 - 0.03, y1 - 0.02, 0.2, x0 + 0.03, y1 + 0.03, h, trim, { grad: false });
  m.box(x1 - 0.03, y1 - 0.02, 0.2, x1 + 0.03, y1 + 0.03, h, trim, { grad: false });
  // string course between the floors
  m.box(x0 - 0.02, y1, mid - 0.03, x1 + 0.02, y1 + 0.04, mid + 0.03, trim, { grad: false, edge: null });
  m.box(x1, y0, mid - 0.03, x1 + 0.04, y1 + 0.04, mid + 0.03, trim, { grad: false, edge: null });
  // ground floor: door and window; upper floor: a balcony across the scorers' window
  frontWindow(m, y1, 0.36, 0.98, 0.42, 0.84, trim);
  m.quad([[1.24, y1 + 0.01, 0.2], [1.66, y1 + 0.01, 0.2], [1.66, y1 + 0.01, 0.9], [1.24, y1 + 0.01, 0.9]], [0, 1, 0], trim, { bias: 0.01 });
  m.quad([[1.28, y1 + 0.014, 0.2], [1.62, y1 + 0.014, 0.2], [1.62, y1 + 0.014, 0.86], [1.28, y1 + 0.014, 0.86]], [0, 1, 0], '#3f6a54', { bias: 0.05, grad: true });
  frontWindow(m, y1, 0.4, 1.65, 1.18, 1.62, trim);
  m.box(0.3, y1, mid + 0.04, 1.75, y1 + 0.28, mid + 0.1, '#e0d9c6', { grad: false });
  m.box(0.3, y1 + 0.24, mid + 0.3, 1.75, y1 + 0.28, mid + 0.34, '#f4efe0', { grad: false, edge: 'rgba(28,26,46,0.6)' });
  for (let x = 0.32; x < 1.76; x += 0.12) m.line([x, y1 + 0.27, mid + 0.1], [x, y1 + 0.27, mid + 0.3], '#f4efe0', 0.022, null, 0.02);
  sideWindow(m, x1, 0.45, 0.95, 0.42, 0.8, trim);
  sideWindow(m, x1, 0.45, 0.95, 1.2, 1.6, trim);
  m.gableX(x0, x1, y0, y1, h, 0.52, roof, '#efe6cf', { ex: 0.14, ey: 0.2, t: 0.07, wall, courses: 'shingle' });
  m.box(0.22, y1 + 0.01, h - 0.02, 1.83, y1 + 0.08, h + 0.26, trim, { grad: false });
  m.text([1.025, y1 + 0.086, h + 0.12], [1, 0, 0], [0, 0, 1], 'TOURNAMENT', 0.13, '#f6ecc8', [0, 1, 0]);
  // three pennants on poles behind the leaderboard
  // the leaderboard, with three pennants flying from its top
  const lx0 = 2.12, lx1 = 3.86, ly = 0.62, lz0 = 0.6, lz1 = 1.86;
  [[2.24, '#c0392b'], [2.9, '#f2c230'], [3.56, '#2f6a8a']].forEach(([fx, col]) => flagPole(m, fx as number, ly - 0.06, lz1 + 0.75, col as string, 0.36, 0.022, lz1 + 0.07));
  for (const lx of [2.3, 3.68]) m.box(lx - 0.05, ly - 0.14, 0, lx + 0.05, ly - 0.04, lz0 + 0.1, '#5a4030', { grad: false });
  walls(m, lx0, ly - 0.12, lz0, lx1, ly, lz1, '#1f4a35');
  m.box(lx0 - 0.04, ly - 0.13, lz1, lx1 + 0.04, ly + 0.02, lz1 + 0.07, '#f4efe0', { grad: false });
  m.text([(lx0 + lx1) / 2, ly + 0.006, lz1 - 0.13], [1, 0, 0], [0, 0, 1], 'LEADERS', 0.13, '#f6ecc8', [0, 1, 0]);
  const yf = ly + 0.004;
  for (let k = 0; k < 6; k++) {
    const z = lz1 - 0.3 - k * 0.16;
    const nl = 0.6 + ((k * 37) % 5) * 0.08;
    m.line([lx0 + 0.14, yf, z], [lx0 + 0.14 + nl, yf, z], 'rgba(244,239,224,0.9)', 0.04, [0, 1, 0], 0.01);
    m.line([lx1 - 0.42, yf, z], [lx1 - 0.3, yf, z], k < 3 ? '#e8503f' : 'rgba(244,239,224,0.9)', 0.04, [0, 1, 0], 0.01);
    m.line([lx1 - 0.24, yf, z], [lx1 - 0.14, yf, z], k < 3 ? '#e8503f' : 'rgba(244,239,224,0.9)', 0.04, [0, 1, 0], 0.01);
  }
  const slots: [number, number, number, boolean][] = [];
  // level 2: a grandstand of three tiers facing the course
  if (level >= 2) {
    const gx0 = 0.35, gx1 = 1.95;
    for (let k = 0; k < 3; k++) {
      const ya = 2.45 - k * 0.36, z = 0.18 + k * 0.2;
      m.box(gx0, ya, 0, gx1, ya + 0.36, z, '#2f5c44', { grad: false, faces: { pz: '#9a7048' } });
      m.box(gx0, ya + 0.04, z, gx1, ya + 0.14, z + 0.05, '#c9a070', { grad: false, edge: null });
    }
    m.box(gx0, 1.67, 0, gx0 + 0.05, 2.81, 0.75, '#f4efe0', { grad: false });
    m.box(gx1 - 0.05, 1.67, 0, gx1, 2.81, 0.75, '#f4efe0', { grad: false });
    for (let k = 0; k < 3; k++) for (const sx of [0.6, 1.15, 1.7].slice(0, k === 0 ? 2 : 3)) slots.push([sx - (k % 2) * 0.12, 2.5 - k * 0.36, 0.23 + k * 0.2, true]);
  }
  // level 3: a white media marquee with a peaked roof
  if (level >= 3) {
    const tx0 = 2.45, tx1 = 3.85, ty0 = 1.95, ty1 = 2.85, tz = 0.62, white = '#f6f3ea';
    m.box(tx0, ty0, 0, tx1, ty1, tz, white);
    m.quad([[2.9, ty1 + 0.004, 0], [3.4, ty1 + 0.004, 0], [3.4, ty1 + 0.004, 0.52], [2.9, ty1 + 0.004, 0.52]], [0, 1, 0], '#4a4a52', { lit: false, edge: null, bias: 0.15 });
    m.flat([[2.9, ty1 + 0.01, 0.52], [3.15, ty1 + 0.01, 0.52], [2.98, ty1 + 0.01, 0.06]], '#efe9da', { edge: 'rgba(28,26,46,0.4)', bias: 0.17 });
    for (const [cx0, cx1] of [[tx0, (tx0 + tx1) / 2], [(tx0 + tx1) / 2, tx1]]) {
      const cx = (cx0 + cx1) / 2, cy = (ty0 + ty1) / 2, apex: V3 = [cx, cy, tz + 0.5], ov = 0.06;
      const X0 = cx0 - ov, X1 = cx1 + ov, Y0 = ty0 - ov, Y1 = ty1 + ov, zb = tz - 0.04, rise = 0.54;
      m.quad([[X0, Y1, zb], [X1, Y1, zb], apex], [0, rise, (Y1 - Y0) / 2], white);
      m.quad([[X1, Y0, zb], [X1, Y1, zb], apex], [rise, 0, (X1 - X0) / 2], white);
      m.quad([[X0, Y0, zb], [X1, Y0, zb], apex], [0, -rise, (Y1 - Y0) / 2], white);
      m.quad([[X0, Y0, zb], [X0, Y1, zb], apex], [-rise, 0, (X1 - X0) / 2], white);
      m.cyl(cx, cy, tz + 0.48, 0.012, 0.2, 'z', '#8a8a80', { sides: 4, edge: null });
      m.flat([[cx, cy, tz + 0.68], [cx, cy, tz + 0.56], [cx + 0.16, cy, tz + 0.62]], '#c0392b', { edge: null });
    }
    // scalloped valance in the club green
    for (let k = 0; k < 6; k++) {
      const a = tx0 - 0.06 + k * ((tx1 - tx0 + 0.12) / 6), b = a + (tx1 - tx0 + 0.12) / 6;
      m.quad([[a, ty1 + 0.065, tz - 0.04], [b, ty1 + 0.065, tz - 0.04], [b, ty1 + 0.065, tz - 0.12], [(a + b) / 2, ty1 + 0.065, tz - 0.17], [a, ty1 + 0.065, tz - 0.12]], [0, 1, 0], k % 2 ? '#f6f3ea' : '#2f5c44', { edge: null, bias: 0.02 });
    }
  }
  // spectators: in the stand first, then along the front of the leaderboard
  slots.push([2.4, 1.05, 0, false], [2.8, 1.25, 0, false], [3.25, 1.05, 0, false], [3.6, 1.3, 0, false], [2.25, 1.6, 0, false], [3.0, 1.65, 0, false], [1.35, 1.85, 0, false], [0.75, 2.05, 0, false], [2.1, 2.4, 0, false]);
  for (let k = 0; k < Math.min(people, 9); k++) { const [px, py, pz, s] = slots[k]; person(m, px, py, pz, k + 4, s); }
  return m;
}

export type FacilityKind = 'barn' | 'shed' | 'halfway' | 'proShop' | 'grill' | 'pavilion' | 'nursery' | 'shelter' | 'restroom' | 'starter' | 'windmill' | 'carpark' | 'academy' | 'restaurant' | 'tourney';
export const FACILITY_KINDS: FacilityKind[] = ['barn', 'shed', 'halfway', 'proShop', 'grill', 'pavilion', 'nursery', 'shelter', 'restroom', 'starter', 'windmill', 'carpark', 'academy', 'restaurant', 'tourney'];
export const isFacilityKind = (k: string): k is FacilityKind => (FACILITY_KINDS as string[]).includes(k);
/** Footprint in tiles and height, for the stamp bounds, the shadow and the tray thumbnail. */
const SIZE: Record<FacilityKind, [number, number, number]> = { barn: [4, 2, 3.1], shed: [3, 2, 2.4], halfway: [3, 2, 2.4], proShop: [4, 2, 2.6], grill: [4, 3, 2.9], pavilion: [3, 3, 3.3], nursery: [3, 2, 2.3], shelter: [2, 2, 2.2], restroom: [2, 2, 2.2], starter: [2, 2, 2.6], windmill: [2, 2, 4.2], carpark: [4, 3, 1.0], academy: [5, 3, 2.6], restaurant: [5, 4, 2.9], tourney: [4, 3, 3.0] };
const BUILDERS: Partial<Record<FacilityKind, () => Mesh>> = { proShop: buildProShop, grill: buildGrill, pavilion: buildPavilion, nursery: buildNursery, shelter: buildShelter, restroom: buildRestroom, starter: buildStarter, windmill: buildWindmill, carpark: buildCarPark };
const BUILT: Record<FacilityKind, number> = { barn: 2.4, shed: 1.9, halfway: 2.0, proShop: 2.0, grill: 2.4, pavilion: 2.6, nursery: 1.6, shelter: 1.7, restroom: 1.6, starter: 1.6, windmill: 2.6, carpark: 0.05, academy: 1.9, restaurant: 2.3, tourney: 2.4 };

/** Buildings that grow with upgrades and fill with people. Their `inside` is level * 10 + people. */
type DetailedKind = 'academy' | 'restaurant' | 'tourney';
const DETAILED: Record<DetailedKind, { build: (level: number, people: number) => Mesh; shadow: [number, number, number, number] }> = {
  academy: { build: buildAcademy, shadow: [0.2, 0.2, 4.8, 1.45] },
  restaurant: { build: buildRestaurant, shadow: [0.25, 0.2, 4.75, 1.6] },
  tourney: { build: buildTourney, shadow: [0.2, 0.2, 1.85, 1.35] },
};
const isDetailed = (k: FacilityKind): k is DetailedKind => k in DETAILED;
/** Unpack `inside` for the upgradeable buildings: level = floor(inside / 10) in 1..3 (0 counts as 1), people = inside % 10. */
export function facilityDetail(inside: number): { level: number; people: number } {
  const v = Math.max(0, Math.floor(inside) || 0);
  return { level: Math.max(1, Math.min(3, Math.floor(v / 10))), people: v % 10 };
}

/** Draw a placed facility with its top-left tile at (x, y). Interior carts in the barn go between its two halves.
 *  For the academy, restaurant and tournament centre, `inside` is level * 10 + people (see facilityDetail). */
export function drawFacility(P: Painter, kind: FacilityKind, x: number, y: number, alpha = 1, inside = 0) {
  let n = 0;
  if (kind === 'barn') n = Math.min(3, inside);
  else if (isDetailed(kind)) { const d = facilityDetail(inside); n = d.level * 10 + d.people; }
  const [w, h, tall] = SIZE[kind];
  const ext: [number, number, number, number] = kind === 'barn' ? [-0.3, -0.4, 6.0, 2.4] : kind === 'shed' || kind === 'halfway' ? [-0.3, -0.4, 4.8, 2.4] : [-0.3, -0.4, w + 1.8, h + 0.4];
  cached(P, `${kind}:${n}`, x, y, ext, tall, alpha, (Q) => rawFacility(Q, kind, 0, 0, 1, n));
}
function rawFacility(P: Painter, kind: FacilityKind, x: number, y: number, alpha = 1, inside = 0) {
  if (kind === 'barn') {
    if (!barnBack) buildBarn();
    groundShadow(P, BW.x0, BW.y0, BW.x1, BW.y1, BUILT.barn, x, y, alpha);
    draw(P, prepare('barnB', barnBack!, 0), x, y, alpha);
    for (let k = 0; k < Math.min(3, inside); k++) {
      const [b0, b1] = BARN_BAYS[k];
      rawCart(P, x + (b0 + b1) / 2, y + 0.8, Math.PI / 2, k);
    }
    draw(P, prepare('barnF', barnFront!, 0), x, y, alpha);
  } else if (kind === 'shed') {
    if (!shedMesh) buildShed();
    groundShadow(P, 0.16, 0.18, 2.84, 1.3, BUILT.shed, x, y, alpha);
    draw(P, prepare('shed', shedMesh!, 0), x, y, alpha);
  } else if (kind === 'halfway') {
    if (!halfwayMesh) buildHalfway();
    groundShadow(P, 0.24, 0.22, 1.86, 1.12, BUILT.halfway, x, y, alpha * 0.9);
    draw(P, prepare('halfway', halfwayMesh!, 0), x, y, alpha);
  } else if (isDetailed(kind)) {
    const { level, people } = facilityDetail(inside);
    const key = `${kind}:${level}:${people}`;
    let mesh = meshes.get(key);
    if (!mesh) { mesh = DETAILED[kind].build(level, people); meshes.set(key, mesh); }
    const [sx0, sy0, sx1, sy1] = DETAILED[kind].shadow;
    groundShadow(P, sx0, sy0, sx1, sy1, BUILT[kind], x, y, alpha * 0.9);
    draw(P, prepare(key, mesh, 0), x, y, alpha);
  } else {
    let mesh = meshes.get(kind);
    if (!mesh) { mesh = BUILDERS[kind]!(); meshes.set(kind, mesh); }
    const [w, h] = SIZE[kind];
    groundShadow(P, 0.2, 0.2, w - 0.2, h - 0.5, BUILT[kind], x, y, alpha * 0.9);
    draw(P, prepare(kind, mesh, 0), x, y, alpha);
  }
}

/** A tray thumbnail drawn with the same models. The upgradeable buildings show at their top level, with a few people. */
export function drawFacilityThumb(canvas: HTMLCanvasElement, kind: FacilityKind | 'cart') {
  drawFacilityPreview(canvas, kind, kind === 'barn' ? 2 : kind !== 'cart' && isDetailed(kind) ? 35 : 0);
}
/** Draw one facility variant (same `inside` meaning as drawFacility) fitted to a canvas, uncached: thumbnails and previews. */
export function drawFacilityPreview(canvas: HTMLCanvasElement, kind: FacilityKind | 'cart', inside = 0) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const [fw, fh, tall] = kind === 'cart' ? [1.6, 1.6, 1.3] : SIZE[kind];
  const ts = Math.min(canvas.width / ((fw + fh) * ISO_X * 1.05), canvas.height / ((fw + fh) * ISO_Y + tall * 1.05));
  const cx = canvas.width / 2, base = canvas.height - 4;
  const toScreen = (x: number, y: number) => ({ x: cx + (x - y - (fw - fh) / 2) * ISO_X * ts, y: base - (fw + fh) * ISO_Y * ts + (x + y) * ISO_Y * ts });
  const P: Painter = { ctx, ts, toScreen };
  if (kind === 'cart') rawCart(P, 0.8, 0.8, Math.PI * 0.75, 0);
  else rawFacility(P, kind, 0, 0, 1, inside);
}
