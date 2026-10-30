export type LogoShape = 'circle' | 'shield' | 'rounded' | 'diamond';
export type LogoIcon = 'flag' | 'ball' | 'club' | 'tree' | 'sun' | 'wave' | 'peak' | 'cactus';
export interface Logo {
  shape: LogoShape;
  primary: string;
  secondary: string;
  icon: LogoIcon;
  initials: string;
}
export const LOGO_SHAPES: LogoShape[] = ['circle', 'shield', 'rounded', 'diamond'];
export const LOGO_ICONS: LogoIcon[] = ['flag', 'ball', 'club', 'tree', 'sun', 'wave', 'peak', 'cactus'];
export const LOGO_COLORS = ['#1f5a3a', '#2d6ccb', '#b8402a', '#e6b44c', '#6a3d9a', '#1e1e24', '#f1ead6', '#3fa7a0'];
export const defaultLogo = (): Logo => ({ shape: 'shield', primary: '#1f5a3a', secondary: '#e6b44c', icon: 'flag', initials: 'SC' });

export function initialsOf(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? 'G').slice(0, 2)).toUpperCase();
}

export function drawLogo(c: CanvasRenderingContext2D, cx: number, cy: number, s: number, logo: Logo) {
  c.save();
  c.translate(cx, cy);
  const r = s / 2;
  c.beginPath();
  if (logo.shape === 'circle') c.arc(0, 0, r, 0, Math.PI * 2);
  else if (logo.shape === 'rounded') c.roundRect(-r, -r, s, s, s * 0.22);
  else if (logo.shape === 'diamond') {
    c.moveTo(0, -r);
    c.lineTo(r, 0);
    c.lineTo(0, r);
    c.lineTo(-r, 0);
    c.closePath();
  } else {
    c.moveTo(-r * 0.85, -r * 0.9);
    c.lineTo(r * 0.85, -r * 0.9);
    c.lineTo(r * 0.85, r * 0.1);
    c.quadraticCurveTo(r * 0.85, r * 0.7, 0, r);
    c.quadraticCurveTo(-r * 0.85, r * 0.7, -r * 0.85, r * 0.1);
    c.closePath();
  }
  c.fillStyle = logo.primary;
  c.fill();
  c.lineWidth = Math.max(1.5, s * 0.06);
  c.strokeStyle = logo.secondary;
  c.stroke();
  c.clip();
  c.fillStyle = logo.secondary;
  c.strokeStyle = logo.secondary;
  c.lineWidth = Math.max(1, s * 0.05);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const k = s / 100;
  c.save();
  c.translate(0, -s * 0.08);
  c.scale(k, k);
  switch (logo.icon) {
    case 'flag':
      c.beginPath();
      c.moveTo(-6, 22);
      c.lineTo(-6, -24);
      c.stroke();
      c.beginPath();
      c.moveTo(-6, -24);
      c.lineTo(20, -15);
      c.lineTo(-6, -6);
      c.fill();
      c.beginPath();
      c.ellipse(-6, 24, 16, 4, 0, 0, Math.PI * 2);
      c.fill();
      break;
    case 'ball':
      c.beginPath();
      c.arc(0, 0, 20, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = logo.primary;
      for (const [x, y] of [[-6, -6], [6, -6], [0, 2], [-8, 8], [8, 8]]) {
        c.beginPath();
        c.arc(x, y, 2.4, 0, Math.PI * 2);
        c.fill();
      }
      break;
    case 'club':
      c.beginPath();
      c.moveTo(18, -26);
      c.lineTo(-10, 16);
      c.stroke();
      c.beginPath();
      c.moveTo(-10, 16);
      c.lineTo(-22, 22);
      c.lineTo(-14, 10);
      c.fill();
      break;
    case 'tree':
      c.beginPath();
      c.arc(0, -8, 16, 0, Math.PI * 2);
      c.fill();
      c.fillRect(-3, 6, 6, 18);
      break;
    case 'sun':
      c.beginPath();
      c.arc(0, 0, 11, 0, Math.PI * 2);
      c.fill();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        c.beginPath();
        c.moveTo(Math.cos(a) * 16, Math.sin(a) * 16);
        c.lineTo(Math.cos(a) * 24, Math.sin(a) * 24);
        c.stroke();
      }
      break;
    case 'wave':
      for (const y of [-10, 2, 14]) {
        c.beginPath();
        c.moveTo(-24, y);
        c.bezierCurveTo(-14, y - 10, -6, y + 10, 4, y);
        c.bezierCurveTo(12, y - 8, 18, y + 8, 24, y);
        c.stroke();
      }
      break;
    case 'peak':
      c.beginPath();
      c.moveTo(-26, 20);
      c.lineTo(-6, -18);
      c.lineTo(6, 2);
      c.lineTo(14, -8);
      c.lineTo(28, 20);
      c.closePath();
      c.fill();
      break;
    case 'cactus':
      c.fillRect(-4, -22, 8, 44);
      c.fillRect(-16, -8, 8, 5);
      c.fillRect(-16, -18, 5, 14);
      c.fillRect(8, 0, 8, 5);
      c.fillRect(11, -10, 5, 14);
      break;
  }
  c.restore();
  c.fillStyle = logo.secondary;
  c.font = `800 ${Math.round(s * 0.2)}px Georgia, serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(logo.initials.slice(0, 3), 0, s * 0.31);
  c.restore();
}
