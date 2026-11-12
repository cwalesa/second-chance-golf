// Small cached scenery sprites: shrubs, rocks, flower patches, reeds, benches, ball washers, lamp posts
// and the water glint. Each sprite is drawn once; `anchor` is the ground contact point inside the canvas.
import { hash2 } from '../terrain';

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

/* ---------- golf buildings: seen from the front-left, lit from the upper left like everything else ---------- */
const roofStroke = 'rgba(40,28,20,0.55)';
function box(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, depth: number, front: string, side: string, roof: string, roofDark: string, roofH: number) {
  // front face
  c.fillStyle = front; c.fillRect(x, y, w, h);
  // right side face (in shade)
  c.fillStyle = side;
  c.beginPath(); c.moveTo(x + w, y); c.lineTo(x + w + depth, y - depth * 0.5); c.lineTo(x + w + depth, y + h - depth * 0.5); c.lineTo(x + w, y + h); c.closePath(); c.fill();
  // roof: front slope and the shaded slope
  c.fillStyle = roof;
  c.beginPath(); c.moveTo(x - 4, y + 1); c.lineTo(x + w * 0.5, y - roofH); c.lineTo(x + w * 0.5 + depth, y - roofH - depth * 0.5); c.lineTo(x + w + depth + 4, y - depth * 0.5 + 1); c.lineTo(x + w + 4, y + 1); c.closePath(); c.fill();
  c.fillStyle = roofDark;
  c.beginPath(); c.moveTo(x + w * 0.5, y - roofH); c.lineTo(x + w * 0.5 + depth, y - roofH - depth * 0.5); c.lineTo(x + w + depth + 4, y - depth * 0.5 + 1); c.lineTo(x + w + 4, y + 1); c.closePath(); c.fill();
  c.strokeStyle = roofStroke; c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(x - 4, y + 1); c.lineTo(x + w * 0.5, y - roofH); c.lineTo(x + w + 4, y + 1); c.stroke();
  c.strokeRect(x, y, w, h);
}

/** A little snack hut with a striped awning, a counter and a menu board. */
export function makeHalfwayHouse(): Sprite {
  return sprite(150, 118, 70, 100, (c) => {
    groundShadow(c, 80, 100, 62, 12, 0.3);
    box(c, 22, 52, 88, 44, 26, '#f1e6c8', '#c9bc98', '#b3523a', '#8f3f2c', 26);
    // awning
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#f6efe0' : '#2d6b45'; c.beginPath(); c.moveTo(30 + i * 9.5, 62); c.lineTo(39.5 + i * 9.5, 62); c.lineTo(41 + i * 9.5, 76); c.lineTo(28.5 + i * 9.5, 76); c.closePath(); c.fill(); }
    c.fillStyle = '#5a3f27'; c.fillRect(34, 76, 72, 4); // counter
    c.fillStyle = '#2b2b2b'; c.fillRect(42, 80, 20, 16); c.fillStyle = '#e8c55a'; c.fillRect(70, 82, 14, 14);
    c.fillStyle = '#ffffffcc'; c.fillRect(46, 84, 12, 3);
    // menu board and chimney
    c.fillStyle = '#2f3b33'; c.fillRect(94, 74, 12, 16); c.fillStyle = '#f4efe0'; c.fillRect(96, 77, 8, 2); c.fillRect(96, 82, 6, 2);
    c.fillStyle = '#7a5a46'; c.fillRect(88, 18, 7, 16);
    // flag
    c.strokeStyle = '#3b2b1d'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(66, 26); c.lineTo(66, 8); c.stroke();
    c.fillStyle = '#b63d2a'; c.beginPath(); c.moveTo(66, 8); c.lineTo(80, 12); c.lineTo(66, 16); c.fill();
  });
}

/** The cart barn: a long low shed with a wide open bay. */
export function makeCartBarn(): Sprite {
  return sprite(190, 124, 90, 104, (c) => {
    groundShadow(c, 100, 104, 84, 13, 0.3);
    box(c, 20, 54, 124, 46, 30, '#ddd5bd', '#b9b095', '#4a6f78', '#355259', 22);
    c.fillStyle = '#26302d'; c.fillRect(34, 66, 96, 34);
    c.fillStyle = '#3a4742'; c.fillRect(34, 66, 96, 5);
    // two carts inside the bay
    for (const x of [44, 86]) {
      c.fillStyle = '#f2ede0'; c.fillRect(x, 82, 32, 12); c.fillStyle = '#2d6b45'; c.fillRect(x + 2, 76, 28, 3);
      c.fillStyle = '#1b1b1b'; c.beginPath(); c.arc(x + 7, 95, 4, 0, 6.3); c.arc(x + 25, 95, 4, 0, 6.3); c.fill();
    }
    c.fillStyle = '#f4efe0'; c.fillRect(56, 56, 52, 9); c.fillStyle = '#2d4a39'; c.font = '700 8px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText('CART BARN', 82, 63.5);
  });
}

/** The maintenance shed: a green tin building with a roller door, a mower and a rake. */
export function makeMaintShed(): Sprite {
  return sprite(150, 118, 70, 100, (c) => {
    groundShadow(c, 80, 100, 62, 12, 0.3);
    box(c, 24, 54, 84, 42, 24, '#7a9a73', '#5e7b59', '#8d9aa0', '#6c7a80', 18);
    c.fillStyle = '#c8cec6'; c.fillRect(36, 62, 38, 34);
    for (let y = 66; y < 96; y += 5) { c.fillStyle = '#aab2aa'; c.fillRect(36, y, 38, 1.2); }
    c.fillStyle = '#e8c55a'; c.fillRect(82, 64, 18, 14); c.fillStyle = '#26413a'; c.fillRect(84, 66, 14, 10);
    // mower
    c.fillStyle = '#c4412c'; c.fillRect(86, 84, 20, 8); c.fillStyle = '#222'; c.beginPath(); c.arc(90, 93, 3.5, 0, 6.3); c.arc(103, 93, 3.5, 0, 6.3); c.fill();
    c.strokeStyle = '#777'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(104, 84); c.lineTo(112, 74); c.stroke();
    // rake leaning on the wall
    c.strokeStyle = '#8a6a46'; c.lineWidth = 2; c.beginPath(); c.moveTo(18, 96); c.lineTo(28, 62); c.stroke();
    c.strokeStyle = '#bbb'; c.beginPath(); c.moveTo(24, 66); c.lineTo(34, 70); c.stroke();
  });
}

/** One parked golf cart, white with a green canopy. */
export function makeGolfCart(): Sprite {
  return sprite(44, 38, 22, 31, (c) => {
    groundShadow(c, 26, 31, 17, 5, 0.3);
    c.fillStyle = '#f4efe2'; c.strokeStyle = 'rgba(30,30,24,0.6)'; c.lineWidth = 1;
    c.beginPath(); c.roundRect(7, 17, 28, 11, 3); c.fill(); c.stroke();
    c.fillStyle = '#2d6b45'; c.fillRect(8, 6, 26, 3); c.strokeStyle = '#555'; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(10, 9); c.lineTo(10, 18); c.moveTo(32, 9); c.lineTo(32, 18); c.stroke();
    c.fillStyle = '#3a4a52'; c.fillRect(12, 13, 9, 6); // seat back
    c.fillStyle = '#1c1c1c'; c.beginPath(); c.arc(13, 29, 4, 0, 6.3); c.arc(30, 29, 4, 0, 6.3); c.fill();
    c.fillStyle = '#9aa0a0'; c.beginPath(); c.arc(13, 29, 1.6, 0, 6.3); c.arc(30, 29, 1.6, 0, 6.3); c.fill();
  });
}
