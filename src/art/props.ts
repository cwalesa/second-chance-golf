// Small cached scenery sprites: shrubs, rocks, flower patches, reeds, benches, ball washers, lamp posts
// and the water glint. Each sprite is drawn once; `anchor` is the ground contact point inside the canvas.
import { hash2 } from '../terrain';

import { inkOutline } from './ink';

export interface Sprite {
  cv: HTMLCanvasElement;
  ax: number;
  ay: number;
}

function sprite(w: number, h: number, ax: number, ay: number, paint: (c: CanvasRenderingContext2D) => void): Sprite {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  paint(cv.getContext('2d')!);
  inkOutline(cv, 2.2);
  return { cv, ax, ay };
}

function blob(c: CanvasRenderingContext2D, x: number, y: number, r: number, light: string, mid: string, dark: string) {
  const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.05);
  g.addColorStop(0, light);
  g.addColorStop(0.5, mid);
  g.addColorStop(1, dark);
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

function groundShadow(c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a = 0.3) {
  const g = c.createRadialGradient(x, y, 1, x, y, rx);
  g.addColorStop(0, `rgba(6,22,14,${a})`);
  g.addColorStop(1, 'rgba(6,22,14,0)');
  c.save();
  c.translate(0, y);
  c.scale(1, ry / rx);
  c.translate(0, -y);
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, rx, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

export function makeShrub(v: number): Sprite {
  const flower = ['#f4e8f0', '#f2d24f', '#e58aa8', '#b88cd8'][v % 4];
  const flowering = v % 2 === 1;
  return sprite(72, 56, 34, 48, (c) => {
    groundShadow(c, 44, 48, 30, 12, 0.35);
    const lobes: Array<[number, number, number]> = [[24, 36, 14], [44, 34, 15], [34, 26, 14], [34, 40, 13]];
    for (const [x, y, r] of lobes) blob(c, x, y, r, '#98c562', '#4f9246', '#26583a');
    for (let k = 0; k < 40; k++) {
      const x = 14 + hash2(k, v, 11) * 40;
      const y = 14 + hash2(k, v, 12) * 32;
      const lit = (50 - x - y * 0.8) / 50;
      c.fillStyle = lit > 0.1 ? 'rgba(190,226,110,0.8)' : 'rgba(24,70,44,0.7)';
      c.beginPath();
      c.ellipse(x, y, 1.8, 1.2, hash2(k, v, 13) * 3, 0, Math.PI * 2);
      c.fill();
    }
    if (flowering) {
      c.fillStyle = flower;
      for (let k = 0; k < 14; k++) {
        c.beginPath();
        c.arc(14 + hash2(k, v, 14) * 40, 16 + hash2(k, v, 15) * 28, 1.7, 0, Math.PI * 2);
        c.fill();
      }
    }
  });
}

export function makeRock(v: number): Sprite {
  return sprite(64, 40, 30, 34, (c) => {
    groundShadow(c, 38, 34, 26, 8, 0.4);
    const stones: Array<[number, number, number, number]> = v % 2 ? [[26, 26, 14, 10], [42, 28, 9, 7]] : [[30, 25, 17, 12], [18, 30, 8, 6], [46, 30, 8, 6]];
    for (const [x, y, rx, ry] of stones) {
      const g = c.createLinearGradient(x - rx, y - ry, x + rx, y + ry);
      g.addColorStop(0, '#cfcabc');
      g.addColorStop(0.5, '#9a9a90');
      g.addColorStop(1, '#5c6360');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(x - rx, y + ry * 0.4);
      c.quadraticCurveTo(x - rx * 0.9, y - ry, x - rx * 0.2, y - ry);
      c.quadraticCurveTo(x + rx, y - ry * 0.8, x + rx, y + ry * 0.4);
      c.quadraticCurveTo(x, y + ry * 0.9, x - rx, y + ry * 0.4);
      c.fill();
      c.fillStyle = 'rgba(255,255,240,0.35)';
      c.beginPath();
      c.ellipse(x - rx * 0.3, y - ry * 0.5, rx * 0.4, ry * 0.22, -0.3, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(70,110,60,0.4)';
      c.fillRect(x + rx * 0.1, y + ry * 0.2, rx * 0.5, ry * 0.2);
    }
  });
}

export function makeFlowers(v: number): Sprite {
  const palettes = [['#f4efe2', '#f1d24f', '#e8a0c0'], ['#e86f64', '#f3b04a', '#f6e7a0'], ['#b88cd8', '#e2c6f2', '#f4efe2']];
  const pal = palettes[v % 3];
  return sprite(64, 32, 32, 20, (c) => {
    const g = c.createRadialGradient(32, 18, 2, 32, 18, 28);
    g.addColorStop(0, 'rgba(36,96,48,0.9)');
    g.addColorStop(1, 'rgba(36,96,48,0)');
    c.fillStyle = g;
    c.save();
    c.translate(0, 18);
    c.scale(1, 0.5);
    c.translate(0, -18);
    c.beginPath();
    c.arc(32, 18, 28, 0, Math.PI * 2);
    c.fill();
    c.restore();
    for (let k = 0; k < 34; k++) {
      const a = hash2(k, v, 21) * Math.PI * 2;
      const d = Math.sqrt(hash2(k, v, 22)) * 24;
      const x = 32 + Math.cos(a) * d;
      const y = 18 + Math.sin(a) * d * 0.45;
      c.strokeStyle = 'rgba(40,110,52,0.9)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x, y + 3);
      c.lineTo(x, y);
      c.stroke();
      c.fillStyle = pal[k % 3];
      c.beginPath();
      c.arc(x, y - 0.5, 1.9, 0, Math.PI * 2);
      c.fill();
    }
  });
}

export function makeReeds(v: number): Sprite {
  return sprite(48, 64, 24, 58, (c) => {
    groundShadow(c, 28, 58, 18, 6, 0.28);
    for (let k = 0; k < 9; k++) {
      const x = 12 + hash2(k, v, 31) * 24;
      const h = 30 + hash2(k, v, 32) * 22;
      const lean = (hash2(k, v, 33) - 0.5) * 12;
      const lit = (30 - x) / 20;
      c.strokeStyle = lit > 0 ? '#7aa94e' : '#3f7a3c';
      c.lineWidth = 1.7;
      c.beginPath();
      c.moveTo(x, 58);
      c.quadraticCurveTo(x + lean * 0.3, 58 - h * 0.6, x + lean, 58 - h);
      c.stroke();
      if (k % 3 === 0) {
        c.strokeStyle = '#6b4a2c';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(x + lean, 58 - h);
        c.lineTo(x + lean * 1.05, 58 - h - 7);
        c.stroke();
      }
    }
  });
}

export function makeBench(): Sprite {
  return sprite(64, 44, 32, 38, (c) => {
    groundShadow(c, 40, 38, 26, 7, 0.3);
    c.fillStyle = '#4b3a28';
    for (const x of [10, 52]) c.fillRect(x - 1.5, 26, 3, 12);
    c.fillStyle = '#9b7648';
    c.fillRect(8, 22, 48, 5);
    c.fillStyle = '#c3a06a';
    c.fillRect(8, 22, 48, 1.6);
    c.fillStyle = '#86653c';
    c.fillRect(8, 11, 48, 4);
    c.fillRect(8, 17, 48, 3.4);
    c.fillStyle = '#4b3a28';
    for (const x of [10, 52]) c.fillRect(x - 1.5, 10, 3, 14);
  });
}

export function makeBallWasher(): Sprite {
  return sprite(32, 56, 16, 50, (c) => {
    groundShadow(c, 21, 50, 12, 4, 0.3);
    c.fillStyle = '#3f5d45';
    c.fillRect(13, 26, 6, 24);
    const g = c.createLinearGradient(6, 0, 26, 0);
    g.addColorStop(0, '#6aa078');
    g.addColorStop(1, '#2f5d4c');
    c.fillStyle = g;
    c.beginPath();
    c.roundRect(7, 8, 18, 22, 4);
    c.fill();
    c.fillStyle = '#f1ead2';
    c.beginPath();
    c.arc(16, 18, 5, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#d9c46c';
    c.fillRect(11, 6, 10, 3);
    c.strokeStyle = '#d9d6c4';
    c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(25, 14);
    c.lineTo(29, 14);
    c.lineTo(29, 22);
    c.stroke();
  });
}

export function makeLamp(): Sprite {
  return sprite(28, 84, 14, 78, (c) => {
    groundShadow(c, 18, 78, 12, 4, 0.3);
    c.fillStyle = '#2e3a34';
    c.fillRect(12.5, 18, 3, 60);
    c.fillRect(9, 72, 10, 6);
    c.fillStyle = '#3d4b44';
    c.fillRect(10, 62, 8, 3);
    c.beginPath();
    c.moveTo(7, 18);
    c.lineTo(21, 18);
    c.lineTo(18, 7);
    c.lineTo(10, 7);
    c.closePath();
    c.fill();
    const g = c.createRadialGradient(14, 13, 1, 14, 13, 8);
    g.addColorStop(0, '#fff6c8');
    g.addColorStop(1, '#f1c96a');
    c.fillStyle = g;
    c.fillRect(10.5, 9, 7, 8);
    c.fillStyle = '#2e3a34';
    c.beginPath();
    c.moveTo(6, 8);
    c.lineTo(14, 1);
    c.lineTo(22, 8);
    c.closePath();
    c.fill();
  });
}

export function makeGlint(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = 40;
  cv.height = 12;
  const c = cv.getContext('2d')!;
  const g = c.createRadialGradient(20, 6, 0, 20, 6, 18);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(220,255,252,0.5)');
  g.addColorStop(1, 'rgba(220,255,252,0)');
  c.save();
  c.translate(20, 6);
  c.scale(1, 0.18);
  c.translate(-20, -6);
  c.fillStyle = g;
  c.beginPath();
  c.arc(20, 6, 18, 0, Math.PI * 2);
  c.fill();
  c.restore();
  return cv;
}

/** Flat lily pad, painted straight into the terrain cache. */
export function paintLilyPad(c: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number) {
  const notch = hash2(seed, 1, 81) * Math.PI * 2;
  c.fillStyle = 'rgba(8,48,40,0.35)';
  c.beginPath();
  c.ellipse(x + 1.2, y + 1, r, r * 0.95, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#4f9a4e';
  c.beginPath();
  c.moveTo(x, y);
  c.arc(x, y, r, notch + 0.25, notch + Math.PI * 2 - 0.25);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(190,236,120,0.5)';
  c.beginPath();
  c.ellipse(x - r * 0.25, y - r * 0.25, r * 0.5, r * 0.35, 0, 0, Math.PI * 2);
  c.fill();
  if (hash2(seed, 2, 81) > 0.6) {
    c.fillStyle = '#f7e6f0';
    c.beginPath();
    c.arc(x + r * 0.2, y - r * 0.1, r * 0.28, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#f3c84a';
    c.beginPath();
    c.arc(x + r * 0.2, y - r * 0.1, r * 0.1, 0, Math.PI * 2);
    c.fill();
  }
}

/** A round stone fountain with a little spray. */
export function makeFountain(): Sprite {
  return sprite(84, 76, 42, 62, (c) => {
    groundShadow(c, 48, 62, 38, 11, 0.3);
    // basin
    c.fillStyle = '#b9b2a2';
    c.beginPath(); c.ellipse(42, 56, 36, 13, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#d8d2c2';
    c.beginPath(); c.ellipse(42, 52, 36, 13, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#5fc0d0';
    c.beginPath(); c.ellipse(42, 52, 29, 9.5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#9fe0e8';
    c.beginPath(); c.ellipse(36, 50, 12, 3, 0, 0, Math.PI * 2); c.fill();
    // column and bowl
    c.fillStyle = '#c9c2b2';
    c.fillRect(38, 26, 8, 24);
    c.fillStyle = '#e2dccd';
    c.beginPath(); c.ellipse(42, 26, 14, 5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#6fcbd8';
    c.beginPath(); c.ellipse(42, 25, 10, 3, 0, 0, Math.PI * 2); c.fill();
    // spray
    c.strokeStyle = 'rgba(220,248,255,0.95)';
    c.lineWidth = 2;
    for (const dx of [-9, -4, 0, 4, 9]) {
      c.beginPath();
      c.moveTo(42, 22);
      c.quadraticCurveTo(42 + dx * 0.6, 4, 42 + dx * 1.4, 22);
      c.stroke();
    }
  });
}

/** A bronze golfer mid-swing on a stone plinth. */
export function makeStatue(): Sprite {
  return sprite(48, 96, 24, 88, (c) => {
    groundShadow(c, 30, 88, 20, 6, 0.32);
    c.fillStyle = '#a9a294';
    c.fillRect(10, 62, 28, 26);
    c.fillStyle = '#cfc8b8';
    c.fillRect(10, 62, 28, 4);
    c.fillRect(8, 84, 32, 4);
    // the golfer
    const g = c.createLinearGradient(14, 0, 34, 0);
    g.addColorStop(0, '#b78a45');
    g.addColorStop(1, '#6e4f22');
    c.fillStyle = g;
    c.strokeStyle = g;
    c.beginPath(); c.arc(24, 18, 5, 0, Math.PI * 2); c.fill();
    c.fillRect(20, 23, 8, 18);
    c.lineWidth = 4;
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(22, 41); c.lineTo(17, 61); c.moveTo(26, 41); c.lineTo(31, 61); c.stroke();
    c.lineWidth = 3;
    c.beginPath(); c.moveTo(21, 27); c.lineTo(33, 16); c.moveTo(27, 27); c.lineTo(34, 17); c.stroke();
    c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(34, 16); c.lineTo(40, 3); c.stroke();
  });
}

// ---------- more things to place ----------
const oval = (c: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill: string) => { c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); };
const slab = (c: CanvasRenderingContext2D, pts: [number, number][], fill: string) => { c.fillStyle = fill; c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill(); };

/** A stone bird bath with a small bird on the rim. */
export function makeBirdbath(): Sprite {
  return sprite(70, 84, 35, 70, (c) => {
    groundShadow(c, 40, 70, 24, 7, 0.3);
    oval(c, 35, 68, 16, 6, '#a9a293');
    slab(c, [[29, 66], [41, 66], [38, 40], [32, 40]], '#cfc8b6');
    oval(c, 35, 38, 26, 9, '#b9b2a2');
    oval(c, 35, 35, 26, 9, '#dcd6c6');
    oval(c, 35, 35, 20, 6.5, '#69c3d6');
    oval(c, 30, 33.5, 8, 2, '#a9e4ee');
    // a little bird
    oval(c, 52, 27, 5.5, 4.2, '#d65a4a');
    c.fillStyle = '#d65a4a'; c.beginPath(); c.arc(56.5, 23.5, 3.2, 0, Math.PI * 2); c.fill();
    slab(c, [[59, 23], [63, 24.5], [59, 25.5]], '#f2c230');
    slab(c, [[47, 27], [41, 24], [46, 30]], '#a83c30');
  });
}

/** A picnic table with a checked cloth and two benches. */
export function makePicnic(): Sprite {
  return sprite(96, 76, 48, 64, (c) => {
    groundShadow(c, 52, 64, 40, 9, 0.28);
    // far bench and legs
    slab(c, [[18, 46], [70, 36], [74, 42], [22, 52]], '#8a6038');
    slab(c, [[26, 52], [30, 52], [30, 62], [26, 62]], '#6b4a2c');
    slab(c, [[64, 42], [68, 41], [68, 56], [64, 57]], '#6b4a2c');
    // table top with cloth
    slab(c, [[14, 36], [66, 24], [84, 34], [32, 47]], '#b98650');
    slab(c, [[18, 36], [64, 26], [78, 34], [32, 44]], '#e9503f');
    c.save(); c.beginPath(); c.moveTo(18, 36); c.lineTo(64, 26); c.lineTo(78, 34); c.lineTo(32, 44); c.closePath(); c.clip();
    c.strokeStyle = '#fff4ea'; c.lineWidth = 2.4;
    for (let k = -2; k < 10; k++) { c.beginPath(); c.moveTo(18 + k * 8, 46); c.lineTo(40 + k * 8, 20); c.stroke(); c.beginPath(); c.moveTo(14 + k * 8, 24); c.lineTo(48 + k * 8, 50); c.stroke(); }
    c.restore();
    // near bench
    slab(c, [[24, 54], [74, 43], [80, 51], [30, 62]], '#9a7048');
    slab(c, [[30, 62], [36, 61], [36, 70], [30, 70]], '#6b4a2c');
    slab(c, [[72, 50], [78, 49], [78, 66], [72, 66]], '#6b4a2c');
  });
}

/** A tall white flagpole flying the club's green and gold. */
export function makeFlagpole(): Sprite {
  return sprite(64, 124, 32, 112, (c) => {
    groundShadow(c, 36, 112, 18, 5, 0.3);
    oval(c, 32, 110, 12, 5, '#a9a293');
    slab(c, [[27, 110], [37, 110], [35, 100], [29, 100]], '#cfc8b6');
    c.strokeStyle = '#f4f1e6'; c.lineWidth = 3.4; c.lineCap = 'round';
    c.beginPath(); c.moveTo(32, 102); c.lineTo(32, 12); c.stroke();
    oval(c, 32, 10, 3.4, 3.4, '#f2c230');
    slab(c, [[34, 16], [60, 20], [58, 30], [60, 40], [34, 38]], '#2f8a47');
    slab(c, [[34, 25], [60, 28], [59, 31], [34, 30]], '#f2c230');
  });
}

/** A small raked-gravel garden with boulders and grass tufts. */
export function makeRockGarden(): Sprite {
  return sprite(92, 70, 46, 56, (c) => {
    oval(c, 46, 48, 40, 14, '#b9ad8a');
    oval(c, 46, 46, 36, 11.5, '#e4d9b4');
    c.strokeStyle = 'rgba(150,134,96,0.7)'; c.lineWidth = 1.2;
    for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(46, 46, 30 - k * 6, 9 - k * 1.8, 0, 0, Math.PI * 2); c.stroke(); }
    const rock = (x: number, y: number, r: number) => { blob(c, x, y, r, '#c9c9c4', '#8e908e', '#5a5c5e'); };
    rock(34, 40, 11); rock(58, 44, 8); rock(48, 34, 6);
    c.strokeStyle = '#3f8a3c'; c.lineWidth = 2; c.lineCap = 'round';
    for (const [x, y] of [[22, 36], [70, 50], [64, 36]] as [number, number][]) for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + k * 3, y - 11 - Math.abs(k)); c.stroke(); }
  });
}

/** A half barrel overflowing with flowers. */
export function makePlanter(): Sprite {
  return sprite(64, 72, 32, 60, (c) => {
    groundShadow(c, 36, 60, 22, 6, 0.28);
    slab(c, [[16, 38], [48, 38], [45, 60], [19, 60]], '#9a6a3c');
    oval(c, 32, 60, 13, 4, '#7d5230');
    oval(c, 32, 38, 16, 5.5, '#6b4a2c');
    c.strokeStyle = '#3a3a40'; c.lineWidth = 2.4;
    for (const y of [44, 54]) { c.beginPath(); c.moveTo(17.5 + (y - 38) * 0.1, y); c.lineTo(46.5 - (y - 38) * 0.1, y); c.stroke(); }
    blob(c, 32, 30, 15, '#6cc060', '#3f9a48', '#2a6c36');
    const cols = ['#e8503f', '#f2c230', '#f4f0f8', '#d65ab0', '#e8503f'];
    [[22, 26], [32, 20], [42, 27], [27, 33], [38, 33]].forEach(([x, y], i) => { oval(c, x, y, 4.4, 4.4, cols[i]); oval(c, x, y, 1.5, 1.5, '#f6d96a'); });
  });
}

/** A white arch wound with roses, for a path or a green. */
export function makeArch(): Sprite {
  return sprite(86, 96, 43, 84, (c) => {
    groundShadow(c, 48, 84, 36, 8, 0.28);
    c.strokeStyle = '#f4f1e6'; c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(16, 82); c.lineTo(16, 38); c.quadraticCurveTo(43, -6, 70, 38); c.lineTo(70, 82); c.stroke();
    c.strokeStyle = '#3f9a48'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(14, 80); c.quadraticCurveTo(22, 56, 15, 38); c.quadraticCurveTo(43, -2, 71, 38); c.quadraticCurveTo(64, 56, 72, 80); c.stroke();
    const cols = ['#e8503f', '#f4a0c0', '#f2c230'];
    for (let k = 0; k < 11; k++) {
      const t = k / 10;
      const x = 14 + t * 58 + Math.sin(k * 2.1) * 3;
      const y = 76 - Math.sin(t * Math.PI) * 74 + (t < 0.2 || t > 0.8 ? 0 : 10);
      oval(c, x, Math.max(8, y), 4.6, 4.6, cols[k % 3]);
      oval(c, x, Math.max(8, y), 1.6, 1.6, '#fff0b0');
    }
  });
}

/** A trimmed hedge block. */
export function makeHedge(): Sprite {
  return sprite(88, 62, 44, 50, (c) => {
    groundShadow(c, 50, 50, 38, 8, 0.28);
    slab(c, [[8, 36], [8, 24], [48, 12], [80, 24], [80, 36], [44, 48]], '#2f7a38');
    slab(c, [[8, 24], [48, 12], [80, 24], [44, 36]], '#58b04c');
    slab(c, [[8, 24], [44, 36], [44, 48], [8, 36]], '#3a8a42');
    c.fillStyle = 'rgba(190,240,150,0.5)';
    for (const [x, y] of [[30, 24], [48, 20], [60, 26], [40, 30], [22, 28]] as [number, number][]) { c.beginPath(); c.arc(x, y, 2.4, 0, Math.PI * 2); c.fill(); }
  });
}

/** Every placeable decoration's sprite, built once for the map and for the tray thumbnails. */
export function placedSprites(): Record<string, Sprite> {
  return {
    flowers: makeFlowers(1), shrub: makeShrub(2), bench: makeBench(), lamp: makeLamp(), washer: makeBallWasher(), fountain: makeFountain(), statue: makeStatue(),
    birdbath: makeBirdbath(), picnic: makePicnic(), flagpole: makeFlagpole(), rockgarden: makeRockGarden(), planter: makePlanter(), arch: makeArch(), hedge: makeHedge(),
  };
}
