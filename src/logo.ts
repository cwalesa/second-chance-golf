export type LogoShape = 'circle' | 'shield' | 'rounded' | 'diamond' | 'hexagon' | 'octagon' | 'oval' | 'banner' | 'rosette' | 'arch';
export type LogoIcon =
  | 'flag' | 'ball' | 'club' | 'tree' | 'sun' | 'wave' | 'peak' | 'cactus'
  | 'crossed' | 'tee' | 'birdie' | 'leaf' | 'anchor' | 'crown' | 'star' | 'trophy' | 'pine' | 'lighthouse';
/** What fills the background behind the emblem, drawn in the accent colour. */
export type LogoPattern = 'plain' | 'stripes' | 'hoops' | 'chevron' | 'halves' | 'quarters' | 'sash' | 'inset' | 'dots' | 'rays';
/** How the initials are lettered, or none. */
export type LogoLettering = 'serif' | 'bold' | 'script' | 'none';
export interface Logo {
  shape: LogoShape;
  primary: string;
  secondary: string;
  icon: LogoIcon;
  initials: string;
  /** Older saves have neither: they draw as plain with serif initials, exactly as before. */
  pattern?: LogoPattern;
  lettering?: LogoLettering;
}
export const LOGO_SHAPES: LogoShape[] = ['shield', 'circle', 'rounded', 'diamond', 'hexagon', 'octagon', 'oval', 'banner', 'rosette', 'arch'];
export const LOGO_ICONS: LogoIcon[] = ['flag', 'ball', 'tee', 'club', 'crossed', 'trophy', 'birdie', 'tree', 'pine', 'leaf', 'sun', 'star', 'crown', 'wave', 'anchor', 'lighthouse', 'peak', 'cactus'];
export const LOGO_PATTERNS: LogoPattern[] = ['plain', 'inset', 'stripes', 'hoops', 'chevron', 'sash', 'halves', 'quarters', 'dots', 'rays'];
export const LOGO_LETTERING: LogoLettering[] = ['serif', 'bold', 'script', 'none'];
export const LOGO_COLORS = [
  '#1f5a3a', '#4f9a4a', '#3fa7a0', '#7fb6e0', '#2d6ccb', '#1d2f5a', '#6a3d9a', '#d97aa0',
  '#b8402a', '#7a2433', '#e07a2e', '#e6b44c', '#f1ead6', '#8a8f96', '#1e1e24', '#ffffff',
];
/** Names for the designer's buttons. */
export const LOGO_NAMES: Record<string, string> = {
  shield: 'Shield', circle: 'Circle', rounded: 'Square', diamond: 'Diamond', hexagon: 'Hexagon', octagon: 'Octagon', oval: 'Oval', banner: 'Banner', rosette: 'Rosette', arch: 'Arch',
  flag: 'Flag', ball: 'Ball', tee: 'Tee', club: 'Club', crossed: 'Crossed clubs', trophy: 'Trophy', birdie: 'Birdie', tree: 'Oak', pine: 'Pine', leaf: 'Leaf', sun: 'Sun', star: 'Star', crown: 'Crown', wave: 'Waves', anchor: 'Anchor', lighthouse: 'Lighthouse', peak: 'Peaks', cactus: 'Cactus',
  plain: 'Plain', inset: 'Inner line', stripes: 'Stripes', hoops: 'Hoops', chevron: 'Chevron', sash: 'Sash', halves: 'Halves', quarters: 'Quarters', dots: 'Dots', rays: 'Sunburst',
  serif: 'Classic', bold: 'Bold', script: 'Script', none: 'No letters',
};
export const defaultLogo = (): Logo => ({ shape: 'shield', primary: '#1f5a3a', secondary: '#e6b44c', icon: 'flag', initials: 'SC', pattern: 'plain', lettering: 'serif' });

export function initialsOf(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? 'G').slice(0, 2)).toUpperCase();
}

/** The outline of each shape, centred on the origin, `s` across. */
function shapePath(shape: LogoShape, s: number): Path2D {
  const r = s / 2;
  const p = new Path2D();
  const poly = (n: number, rot: number) => {
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      if (i) p.lineTo(Math.cos(a) * r, Math.sin(a) * r); else p.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    p.closePath();
  };
  switch (shape) {
    case 'circle': p.arc(0, 0, r, 0, Math.PI * 2); break;
    case 'rounded': p.roundRect(-r, -r, s, s, s * 0.22); break;
    case 'diamond': p.moveTo(0, -r); p.lineTo(r, 0); p.lineTo(0, r); p.lineTo(-r, 0); p.closePath(); break;
    case 'hexagon': poly(6, -Math.PI / 2); break;
    case 'octagon': poly(8, Math.PI / 8); break;
    case 'oval': p.ellipse(0, 0, r * 0.8, r, 0, 0, Math.PI * 2); break;
    case 'banner':
      // a hanging pennant with a notched foot
      p.moveTo(-r * 0.8, -r * 0.95); p.lineTo(r * 0.8, -r * 0.95); p.lineTo(r * 0.8, r); p.lineTo(0, r * 0.74); p.lineTo(-r * 0.8, r); p.closePath();
      break;
    case 'rosette': {
      // a scalloped edge: sixteen shallow bumps around a circle
      const n = 16;
      for (let i = 0; i <= n * 8; i++) {
        const a = (i / (n * 8)) * Math.PI * 2 - Math.PI / 2;
        const rr = r * (0.92 + 0.08 * Math.abs(Math.cos((a + Math.PI / 2) * n / 2)));
        if (i) p.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else p.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      p.closePath();
      break;
    }
    case 'arch':
      p.moveTo(-r * 0.85, r); p.lineTo(-r * 0.85, -r * 0.15); p.arc(0, -r * 0.15, r * 0.85, Math.PI, 0); p.lineTo(r * 0.85, r); p.closePath();
      break;
    default:
      // shield
      p.moveTo(-r * 0.85, -r * 0.9); p.lineTo(r * 0.85, -r * 0.9); p.lineTo(r * 0.85, r * 0.1);
      p.quadraticCurveTo(r * 0.85, r * 0.7, 0, r); p.quadraticCurveTo(-r * 0.85, r * 0.7, -r * 0.85, r * 0.1); p.closePath();
  }
  return p;
}

/** The background pattern, inside the clip, in the accent colour (faint, so the emblem stays the thing you see). */
function drawPattern(c: CanvasRenderingContext2D, pattern: LogoPattern, s: number, shape: LogoShape, colour: string) {
  if (pattern === 'plain') return;
  const r = s / 2;
  c.save();
  c.fillStyle = colour;
  c.strokeStyle = colour;
  if (pattern === 'inset') {
    c.lineWidth = Math.max(1, s * 0.025);
    c.scale(0.82, 0.82);
    c.stroke(shapePath(shape, s));
    c.restore();
    return;
  }
  c.globalAlpha = 0.3;
  const band = s / 8;
  switch (pattern) {
    case 'stripes': for (let x = -r + band; x < r; x += band * 2) c.fillRect(x, -r, band, s); break;
    case 'hoops': for (let y = -r + band; y < r; y += band * 2) c.fillRect(-r, y, s, band); break;
    case 'chevron':
      c.beginPath(); c.moveTo(-r, -r * 0.05); c.lineTo(0, r * 0.45); c.lineTo(r, -r * 0.05); c.lineTo(r, -r * 0.4); c.lineTo(0, r * 0.1); c.lineTo(-r, -r * 0.4); c.closePath(); c.fill();
      break;
    case 'sash': c.rotate(-Math.PI / 4); c.fillRect(-s, -band * 1.2, s * 2, band * 2.4); break;
    case 'halves': c.fillRect(-r, -r, r, s); break;
    case 'quarters': c.fillRect(-r, -r, r, r); c.fillRect(0, 0, r, r); break;
    case 'dots': {
      const g = s / 7;
      for (let y = -r; y <= r; y += g) for (let x = -r + ((Math.round((y + r) / g) % 2) * g) / 2; x <= r; x += g) { c.beginPath(); c.arc(x, y, g * 0.18, 0, Math.PI * 2); c.fill(); }
      break;
    }
    case 'rays':
      for (let i = 0; i < 12; i += 2) {
        const a0 = (i / 12) * Math.PI * 2, a1 = ((i + 1) / 12) * Math.PI * 2;
        c.beginPath(); c.moveTo(0, -s * 0.08); c.lineTo(Math.cos(a0) * s, Math.sin(a0) * s - s * 0.08); c.lineTo(Math.cos(a1) * s, Math.sin(a1) * s - s * 0.08); c.closePath(); c.fill();
      }
      break;
  }
  c.restore();
}

/** The emblem, drawn in a 100-unit box centred on the origin, in the accent colour with cut-outs in the main colour. */
function drawIcon(c: CanvasRenderingContext2D, icon: LogoIcon, fg: string, bg: string) {
  const line = (x0: number, y0: number, x1: number, y1: number) => { c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); };
  const shape = (pts: number[][]) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill(); };
  const dot = (x: number, y: number, r: number) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
  c.fillStyle = fg;
  c.strokeStyle = fg;
  switch (icon) {
    case 'flag':
      line(-6, 22, -6, -24);
      shape([[-6, -24], [20, -15], [-6, -6]]);
      c.beginPath(); c.ellipse(-6, 24, 16, 4, 0, 0, Math.PI * 2); c.fill();
      break;
    case 'ball':
      dot(0, 0, 20);
      c.fillStyle = bg;
      for (const [x, y] of [[-6, -6], [6, -6], [0, 2], [-8, 8], [8, 8]]) dot(x, y, 2.4);
      break;
    case 'tee':
      dot(0, -10, 12);
      shape([[-11, 4], [11, 4], [3, 9], [1.5, 25], [-1.5, 25], [-3, 9]]);
      c.fillStyle = bg;
      for (const [x, y] of [[-4, -13], [4, -13], [0, -7], [-6, -6], [6, -6]]) dot(x, y, 1.6);
      break;
    case 'club':
      line(18, -26, -10, 16);
      shape([[-10, 16], [-22, 22], [-14, 10]]);
      break;
    case 'crossed':
      line(-18, -24, 16, 20);
      line(18, -24, -16, 20);
      c.beginPath(); c.ellipse(19, 21, 8, 3.6, -0.5, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(-19, 21, 8, 3.6, 0.5, 0, Math.PI * 2); c.fill();
      dot(0, -24, 5);
      break;
    case 'trophy':
      c.beginPath(); c.moveTo(-15, -22); c.lineTo(15, -22); c.quadraticCurveTo(15, 4, 0, 6); c.quadraticCurveTo(-15, 4, -15, -22); c.closePath(); c.fill();
      c.beginPath(); c.arc(-15, -13, 7, Math.PI * 0.5, Math.PI * 1.5); c.stroke();
      c.beginPath(); c.arc(15, -13, 7, -Math.PI * 0.5, Math.PI * 0.5); c.stroke();
      c.fillRect(-3, 5, 6, 11);
      c.fillRect(-13, 16, 26, 6);
      break;
    case 'birdie':
      c.beginPath(); c.ellipse(-2, 4, 15, 9, -0.25, 0, Math.PI * 2); c.fill();
      dot(12, -6, 7);
      shape([[17, -8], [26, -5], [17, -3]]);
      shape([[-14, 4], [-27, -5], [-25, 9]]);
      c.fillStyle = bg;
      c.beginPath(); c.ellipse(-3, 3, 8, 3.6, -0.5, 0, Math.PI * 2); c.fill();
      dot(14, -7, 1.6);
      break;
    case 'tree':
      dot(0, -8, 16);
      c.fillRect(-3, 6, 6, 18);
      break;
    case 'pine':
      shape([[0, -27], [12, -9], [-12, -9]]);
      shape([[0, -17], [17, 5], [-17, 5]]);
      shape([[0, -5], [22, 18], [-22, 18]]);
      c.fillRect(-3, 17, 6, 8);
      break;
    case 'leaf':
      c.beginPath(); c.moveTo(0, -25); c.bezierCurveTo(24, -12, 20, 14, 0, 21); c.bezierCurveTo(-20, 14, -24, -12, 0, -25); c.closePath(); c.fill();
      line(0, 18, 0, 27);
      c.strokeStyle = bg; c.lineWidth = 2;
      line(0, -18, 0, 18);
      for (const y of [-8, 2, 11]) { line(0, y, 9, y - 6); line(0, y, -9, y - 6); }
      break;
    case 'sun':
      dot(0, 0, 11);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; line(Math.cos(a) * 16, Math.sin(a) * 16, Math.cos(a) * 24, Math.sin(a) * 24); }
      break;
    case 'star': {
      const pts: number[][] = [];
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI * 2, rr = i % 2 ? 10 : 25; pts.push([Math.cos(a) * rr, Math.sin(a) * rr + 2]); }
      shape(pts);
      break;
    }
    case 'crown':
      shape([[-23, 12], [-23, -12], [-11, 1], [0, -18], [11, 1], [23, -12], [23, 12]]);
      c.fillRect(-23, 14, 46, 7);
      for (const [x, y] of [[-23, -14], [0, -20], [23, -14]]) dot(x, y, 3.4);
      c.fillStyle = bg;
      for (const x of [-12, 0, 12]) dot(x, 17.5, 2);
      break;
    case 'wave':
      for (const y of [-10, 2, 14]) {
        c.beginPath(); c.moveTo(-24, y); c.bezierCurveTo(-14, y - 10, -6, y + 10, 4, y); c.bezierCurveTo(12, y - 8, 18, y + 8, 24, y); c.stroke();
      }
      break;
    case 'anchor':
      c.beginPath(); c.arc(0, -21, 5, 0, Math.PI * 2); c.stroke();
      line(0, -16, 0, 22);
      line(-11, -8, 11, -8);
      c.beginPath(); c.arc(0, 5, 18, Math.PI * 0.12, Math.PI * 0.88); c.stroke();
      shape([[17, 9], [22, 3], [12, 3]]);
      shape([[-17, 9], [-22, 3], [-12, 3]]);
      break;
    case 'lighthouse':
      shape([[-9, 24], [-5, -10], [5, -10], [9, 24]]);
      c.fillRect(-7, -20, 14, 9);
      shape([[-9, -20], [0, -29], [9, -20]]);
      c.fillStyle = bg;
      c.fillRect(-3.5, -18, 7, 5);
      c.fillRect(-7, 0, 14, 5);
      c.fillRect(-8.5, 13, 17, 4);
      c.strokeStyle = fg; c.lineWidth = 2;
      line(9, -16, 26, -22); line(9, -14, 26, -8); line(-9, -16, -26, -22); line(-9, -14, -26, -8);
      break;
    case 'peak':
      shape([[-26, 20], [-6, -18], [6, 2], [14, -8], [28, 20]]);
      c.fillStyle = bg;
      shape([[-6, -18], [-12, -7], [-8, -9], [-5, -5], [-2, -10]]);
      break;
    case 'cactus':
      c.fillRect(-4, -22, 8, 44);
      c.fillRect(-16, -8, 8, 5);
      c.fillRect(-16, -18, 5, 14);
      c.fillRect(8, 0, 8, 5);
      c.fillRect(11, -10, 5, 14);
      break;
  }
}

export function drawLogo(c: CanvasRenderingContext2D, cx: number, cy: number, s: number, logo: Logo) {
  const pattern = logo.pattern ?? 'plain', lettering = logo.lettering ?? 'serif';
  const outline = shapePath(logo.shape, s);
  c.save();
  c.translate(cx, cy);
  c.fillStyle = logo.primary;
  c.fill(outline);
  c.save();
  c.clip(outline);
  drawPattern(c, pattern, s, logo.shape, logo.secondary);
  c.lineWidth = Math.max(1, s * 0.05);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  // without letters the emblem moves to the middle and grows a little
  const letters = lettering !== 'none' && logo.initials.trim().length > 0;
  const k = (s / 100) * (letters ? 1 : 1.2);
  c.save();
  c.translate(0, letters ? -s * 0.08 : logo.shape === 'banner' ? -s * 0.06 : 0);
  c.scale(k, k);
  c.lineWidth = Math.max(1, s * 0.05) / k;
  drawIcon(c, logo.icon, logo.secondary, logo.primary);
  c.restore();
  if (letters) {
    const px = Math.round(s * 0.2);
    c.fillStyle = logo.secondary;
    c.font = lettering === 'bold' ? `900 ${px}px Nunito, system-ui, sans-serif` : lettering === 'script' ? `italic 700 ${Math.round(px * 1.05)}px Georgia, serif` : `800 ${px}px Georgia, serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(logo.initials.slice(0, 3), 0, logo.shape === 'banner' ? s * 0.25 : s * 0.31);
  }
  c.restore();
  c.lineWidth = Math.max(1.5, s * 0.06);
  c.strokeStyle = logo.secondary;
  c.lineJoin = 'round';
  c.stroke(outline);
  c.restore();
}
