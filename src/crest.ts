// Club identities: each club's logo as an SVG, in two forms: the full logo (with the club's name) for larger places, and a
// simplified emblem for small interface spots. Built from three choices a player makes: a construction (seal, shield,
// monogram, roundel, pennant or wordmark), a symbol drawn for the club's land or character, and a restrained palette.
// Everything is vector, drawn on a transparent background, with solid shapes that survive being shown small.
import type { Logo } from './logo';

export type CrestStyle = 'seal' | 'crest' | 'monogram' | 'roundel' | 'pennant' | 'wordmark';
export type CrestSymbol = 'willow' | 'oak' | 'pine' | 'flag' | 'crossed' | 'heron' | 'lighthouse' | 'peaks' | 'wheat' | 'mesa' | 'waves' | 'acorn';
export type PaletteId = 'forest' | 'navy' | 'burgundy' | 'slate' | 'cream' | 'ink';
export type CrestVariant = 'full' | 'emblem';

export const CREST_STYLES: CrestStyle[] = ['seal', 'crest', 'monogram', 'roundel', 'pennant', 'wordmark'];
export const CREST_SYMBOLS: CrestSymbol[] = ['willow', 'oak', 'pine', 'flag', 'crossed', 'heron', 'lighthouse', 'peaks', 'wheat', 'mesa', 'waves', 'acorn'];
export const PALETTE_IDS: PaletteId[] = ['forest', 'navy', 'burgundy', 'slate', 'cream', 'ink'];
export const STYLE_NAMES: Record<CrestStyle, string> = { seal: 'Seal', crest: 'Shield', monogram: 'Monogram', roundel: 'Roundel', pennant: 'Pennant', wordmark: 'Wordmark' };
export const SYMBOL_NAMES: Record<CrestSymbol, string> = { willow: 'Willow', oak: 'Oak', pine: 'Pine', flag: 'Pin flag', crossed: 'Crossed clubs', heron: 'Heron', lighthouse: 'Lighthouse', peaks: 'Peaks', wheat: 'Wheat', mesa: 'Mesa', waves: 'Waves', acorn: 'Acorn' };

/** plate: the main field; ink: what is drawn on the plate; accent: rules, rings and ribbons; text: the name where it sits on the page itself. */
export interface Palette { name: string; plate: string; ink: string; accent: string; text: string }
export const PALETTES: Record<PaletteId, Palette> = {
  forest: { name: 'Forest and gold', plate: '#1f4a35', ink: '#f2ead4', accent: '#b8975a', text: '#1f4a35' },
  navy: { name: 'Navy and gold', plate: '#1c2b4a', ink: '#f2ecdd', accent: '#c2a15e', text: '#1c2b4a' },
  burgundy: { name: 'Burgundy and cream', plate: '#6b1e2c', ink: '#f4ecdc', accent: '#b9965b', text: '#6b1e2c' },
  slate: { name: 'Slate and sage', plate: '#2e3a3f', ink: '#ede6d6', accent: '#8fa98f', text: '#2e3a3f' },
  cream: { name: 'Cream and green', plate: '#f1e8d0', ink: '#1f4a35', accent: '#8a2f39', text: '#1f4a35' },
  ink: { name: 'Black and gold', plate: '#1b1b1f', ink: '#ebe1c8', accent: '#c9a65c', text: '#1b1b1f' },
};

/** The identity a club's saved logo describes. Older saves (shape, icon and colours only) map to the nearest one. */
export interface Identity { style: CrestStyle; symbol: CrestSymbol; palette: PaletteId }
const SHAPE_STYLE: Record<string, CrestStyle> = { circle: 'seal', rosette: 'seal', octagon: 'seal', shield: 'crest', banner: 'pennant', diamond: 'crest', rounded: 'roundel', hexagon: 'roundel', oval: 'monogram', arch: 'wordmark' };
const ICON_SYMBOL: Record<string, CrestSymbol> = { flag: 'flag', ball: 'flag', tee: 'flag', club: 'crossed', crossed: 'crossed', trophy: 'crossed', birdie: 'heron', tree: 'oak', pine: 'pine', leaf: 'willow', sun: 'mesa', star: 'flag', crown: 'oak', wave: 'waves', anchor: 'lighthouse', lighthouse: 'lighthouse', peak: 'peaks', cactus: 'mesa' };
function nearestPalette(hex: string): PaletteId {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if (r > 200 && g > 190 && b > 160) return 'cream';
  if (r < 50 && g < 50 && b < 60) return 'ink';
  if (Math.abs(r - g) < 20 && Math.abs(g - b) < 20) return 'slate';
  if (r > g + 30 && r > b + 20) return 'burgundy';
  if (b > g && b > r) return 'navy';
  return 'forest';
}
export function identityOf(logo: Logo): Identity {
  return {
    style: (logo.style as CrestStyle) ?? SHAPE_STYLE[logo.shape] ?? 'crest',
    symbol: (logo.symbol as CrestSymbol) ?? ICON_SYMBOL[logo.icon] ?? 'flag',
    palette: (logo.palette as PaletteId) ?? nearestPalette(logo.primary ?? '#1f4a35'),
  };
}
/** A symbol that suits each kind of land, for a new club that has not chosen one. */
export const REGION_SYMBOL: Record<string, CrestSymbol> = { parkland: 'willow', coast: 'lighthouse', mountain: 'peaks', plains: 'wheat', desert: 'mesa' };

// ------------------------------------------------------------------ symbols (100 x 100, centred on 50,50; solid shapes)
/** Each symbol in the ink colour, with cut-outs in the plate colour. */
function symbol(id: CrestSymbol, ink: string, plate: string): string {
  const f = `fill="${ink}"`, cut = `fill="${plate}"`;
  switch (id) {
    case 'willow':
      // a weeping willow: a small crown, then long strands that sweep down almost to the ground, over a leaning trunk and a bank
      return `<path ${f} d="M28 40 C28 18 72 18 72 40 Z"/><g ${f}><path d="M28 38 C24 52 23 64 25 76 C27 78 29 77 30 74 C30 62 32 50 35 40 Z"/><path d="M37 40 C34 54 34 66 36 80 C38 82 40 81 41 78 C41 64 42 52 44 40 Z"/><path d="M56 40 C58 52 59 64 59 78 C60 81 62 82 64 80 C66 66 66 54 63 40 Z"/><path d="M65 40 C68 50 70 62 70 74 C71 77 73 78 75 76 C77 64 76 52 72 38 Z"/></g><path ${f} d="M47 36 C47 58 46 74 41 87 L57 87 C53 74 52 58 53 36 Z"/><rect ${f} x="24" y="86" width="52" height="5" rx="2.5"/>`;
    case 'oak':
      return `<circle ${f} cx="36" cy="44" r="17"/><circle ${f} cx="64" cy="44" r="17"/><circle ${f} cx="50" cy="31" r="19"/><circle ${f} cx="50" cy="50" r="16"/><path ${f} d="M46 56 L44 84 L56 84 L54 56 Z"/><path ${f} d="M45 70 L36 62 L39 60 L47 66 Z M55 70 L64 62 L61 60 L53 66 Z"/><rect ${f} x="30" y="83" width="40" height="5" rx="2.5"/>`;
    case 'pine':
      return `<path ${f} d="M50 12 L64 34 L57 34 L70 52 L61 52 L76 72 L24 72 L39 52 L30 52 L43 34 L36 34 Z"/><rect ${f} x="45" y="71" width="10" height="14"/><rect ${f} x="30" y="84" width="40" height="5" rx="2.5"/>`;
    case 'flag':
      return `<rect ${f} x="46" y="14" width="5" height="64" rx="1.5"/><path ${f} d="M51 15 L80 25 L51 36 Z"/><ellipse ${f} cx="50" cy="82" rx="30" ry="7"/><circle ${cut} cx="62" cy="80" r="3.4"/>`;
    case 'crossed':
      return `<g ${f}><rect x="47" y="10" width="6" height="74" rx="3" transform="rotate(-32 50 50)"/><rect x="47" y="10" width="6" height="74" rx="3" transform="rotate(32 50 50)"/><path d="M24 77 C20 82 22 88 30 87 L38 85 L35 77 Z"/><path d="M76 77 C80 82 78 88 70 87 L62 85 L65 77 Z"/></g><circle ${f} cx="50" cy="20" r="8"/><circle ${cut} cx="47.5" cy="18.5" r="1.4"/><circle ${cut} cx="52.5" cy="19" r="1.4"/><circle ${cut} cx="50" cy="23" r="1.4"/>`;
    case 'heron':
      // a heron wading: long neck in an S, dagger bill, body, two legs, a ripple
      return `<path ${f} d="M30 56 C30 44 44 40 56 42 C62 43 66 46 68 50 C72 57 64 62 52 62 C42 62 33 62 30 56 Z"/><path ${f} d="M58 44 C52 36 50 30 54 24 C57 19 63 18 66 22 L82 20 L67 27 C64 30 58 31 60 38 C61 41 63 43 64 46 Z"/><rect ${f} x="44" y="60" width="4" height="22" rx="2"/><rect ${f} x="52" y="60" width="4" height="22" rx="2" transform="rotate(10 54 60)"/><rect ${f} x="24" y="82" width="52" height="4" rx="2"/><circle ${cut} cx="62" cy="23" r="1.6"/>`;
    case 'lighthouse':
      return `<path ${f} d="M40 84 L44 36 L56 36 L60 84 Z"/><rect ${cut} x="42.6" y="48" width="14.8" height="6"/><rect ${cut} x="41.4" y="64" width="17.2" height="6"/><rect ${f} x="40" y="30" width="20" height="6"/><rect ${f} x="43" y="20" width="14" height="10"/><rect ${cut} x="46" y="22" width="8" height="6"/><path ${f} d="M41 20 L50 12 L59 20 Z"/><path ${f} d="M60 22 L84 14 L84 30 Z M40 22 L16 14 L16 30 Z" opacity="0.85"/><path ${f} d="M22 88 C30 82 40 82 50 85 C60 82 70 82 78 88 Z"/>`;
    case 'peaks':
      return `<path ${f} d="M10 80 L38 30 L52 54 L62 40 L90 80 Z"/><path ${cut} d="M38 30 L46 44 L41 42 L37 47 L33 42 L30 44 Z"/><path ${cut} d="M62 40 L68 49 L64 48 L61 51 L58 47 Z"/><rect ${f} x="10" y="82" width="80" height="5" rx="2.5"/>`;
    case 'wheat': {
      // a sheaf of three stalks, each with three pairs of plump grains and a pointed head, tied with a band
      const stalk = (rot: number) => {
        let g = `<g transform="rotate(${rot} 50 84)"><rect x="47.8" y="34" width="4.4" height="52" rx="2.2"/>`;
        for (let k = 0; k < 3; k++) { const y = 30 + k * 11; g += `<ellipse cx="44" cy="${y}" rx="4.2" ry="7" transform="rotate(-30 44 ${y})"/><ellipse cx="56" cy="${y}" rx="4.2" ry="7" transform="rotate(30 56 ${y})"/>`; }
        return g + `<ellipse cx="50" cy="20" rx="4" ry="8"/></g>`;
      };
      return `<g ${f}>${stalk(-24)}${stalk(0)}${stalk(24)}</g><rect ${f} x="38" y="66" width="24" height="7" rx="2.5"/><rect ${cut} x="38" y="68.6" width="24" height="1.8"/>`;
    }
    case 'mesa':
      return `<circle ${f} cx="62" cy="38" r="14"/><path ${cut} d="M8 80 L20 52 L30 50 L34 42 L66 42 L70 50 L80 52 L92 80 Z"/><path ${f} d="M12 80 L22 56 L32 54 L36 46 L64 46 L68 54 L78 56 L88 80 Z"/><rect ${cut} x="20" y="64" width="60" height="3"/><rect ${f} x="8" y="82" width="84" height="5" rx="2.5"/>`;
    case 'waves':
      return `<g fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round"><path d="M16 36 C26 26 36 26 46 36 C56 46 66 46 76 36 C80 32 84 31 86 32"/><path d="M14 54 C24 44 34 44 44 54 C54 64 64 64 74 54 C78 50 82 49 86 50"/><path d="M14 72 C24 62 34 62 44 72 C54 82 64 82 74 72 C78 68 82 67 86 68"/></g>`;
    case 'acorn':
      // a cap with a stalk over a plump nut, with a cut line under the cap and a highlight curve
      return `<path ${f} d="M28 44 C28 28 72 28 72 44 C72 48 28 48 28 44 Z"/><rect ${f} x="47" y="18" width="6" height="14" rx="3" transform="rotate(14 50 25)"/><path ${f} d="M33 48 L67 48 C67 66 60 80 50 86 C40 80 33 66 33 48 Z"/><rect ${cut} x="33" y="45.6" width="34" height="2.6"/><path d="M42 54 C42 64 45 72 50 77" fill="none" stroke="${plate}" stroke-width="2.6" stroke-linecap="round"/>`;
  }
}

// ------------------------------------------------------------------ lettering helpers
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const SERIF = "Georgia, 'Times New Roman', serif";
/** Text that fits its space: an estimate of its width decides whether it is squeezed (never stretched). */
function text(s: string, x: number, y: number, size: number, maxW: number, fill: string, opts: { weight?: number; spacing?: number; italic?: boolean } = {}): string {
  const spacing = opts.spacing ?? 0;
  const est = s.length * size * 0.66 + Math.max(0, s.length - 1) * spacing;
  const fit = est > maxW ? ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<text x="${x}" y="${y}" text-anchor="middle" font-family="${SERIF}" font-size="${size}" font-weight="${opts.weight ?? 700}"${opts.italic ? ' font-style="italic"' : ''} letter-spacing="${spacing}" fill="${fill}"${fit}>${esc(s)}</text>`;
}
/** The club's name split for display: "Willow Creek" stays as it is; the kind of club goes underneath. */
export function nameParts(name: string): { main: string; kind: string } {
  const n = name.trim() || 'Little Links';
  const m = n.match(/^(.*?)\s+(golf club|country club|golf links|links|golf course)$/i);
  if (m) return { main: m[1].toUpperCase(), kind: m[2].toUpperCase() };
  return { main: n.toUpperCase(), kind: 'GOLF CLUB' };
}
export const initialsFor = (name: string) => {
  const w = nameParts(name).main.split(/\s+/).filter((x) => x && !/^(THE|OF|AT)$/.test(x));
  // two words give two letters; a one-word name is better as its single initial than as two letters of one word
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? 'L')[0]).toUpperCase();
};

// ------------------------------------------------------------------ constructions (200 x 200 viewBox)
const SHIELD = 'M30 14 L170 14 L170 92 C170 136 136 160 100 176 C64 160 30 136 30 92 Z';
function build(id: Identity, name: string, variant: CrestVariant): string {
  const P = PALETTES[id.palette];
  const { main, kind } = nameParts(name);
  const ini = initialsFor(name);
  const sym = (cx: number, cy: number, size: number, ink = P.ink, plate = P.plate) => `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 100})">${symbol(id.symbol, ink, plate)}</g>`;
  const full = variant === 'full';
  switch (id.style) {
    case 'seal': {
      if (!full) return `<circle cx="100" cy="100" r="96" fill="${P.plate}"/><circle cx="100" cy="100" r="84" fill="none" stroke="${P.accent}" stroke-width="5"/>${sym(100, 100, 118)}`;
      // name around the top, the kind of club around the bottom, the symbol in the middle
      const r = 77;
      const top = `M${100 - r} 100 A${r} ${r} 0 0 1 ${100 + r} 100`, bottom = `M${100 - r - 8} 100 A${r + 8} ${r + 8} 0 0 0 ${100 + r + 8} 100`;
      const arcLen = Math.PI * r * 0.86;
      const fitTop = main.length * 15 * 0.68 > arcLen ? ` textLength="${arcLen.toFixed(0)}" lengthAdjust="spacingAndGlyphs"` : '';
      return `<defs><path id="sT" d="${top}"/><path id="sB" d="${bottom}"/></defs><circle cx="100" cy="100" r="97" fill="${P.plate}"/><circle cx="100" cy="100" r="91" fill="none" stroke="${P.accent}" stroke-width="2.5"/><circle cx="100" cy="100" r="60" fill="none" stroke="${P.accent}" stroke-width="2.5"/>
        <text font-family="${SERIF}" font-size="15" font-weight="700" letter-spacing="1.5" fill="${P.ink}"><textPath href="#sT" startOffset="50%" text-anchor="middle"${fitTop}>${esc(main)}</textPath></text>
        <text font-family="${SERIF}" font-size="11" font-weight="700" letter-spacing="3" fill="${P.accent}"><textPath href="#sB" startOffset="50%" text-anchor="middle">${esc(kind)}</textPath></text>
        <path d="M17 100 l5 -5 l5 5 l-5 5 Z M173 100 l5 -5 l5 5 l-5 5 Z" fill="${P.accent}"/>${sym(100, 100, 88)}`;
    }
    case 'crest': {
      const shield = `<path d="${SHIELD}" fill="${P.plate}"/><path d="${SHIELD}" fill="none" stroke="${P.accent}" stroke-width="5" transform="translate(100 95) scale(0.9) translate(-100 -95)"/>`;
      if (!full) return `<g transform="translate(0 8)">${shield}${sym(100, 84, 96)}</g>`;
      // shield above, a ribbon with the name across its foot
      const ribbon = `<path d="M14 150 L36 144 L36 178 L14 184 L22 166 Z M186 150 L164 144 L164 178 L186 184 L178 166 Z" fill="${P.accent}"/><path d="M30 142 L170 142 L170 176 L30 176 Z" fill="${P.ink}" stroke="${P.accent}" stroke-width="2.5"/>`;
      return `<g transform="translate(0 -4) scale(1 0.94)">${shield}</g>${sym(100, 72, 80)}${ribbon}${text(main, 100, 165, 15, 126, P.plate, { spacing: 1 })}`;
    }
    case 'monogram': {
      const mono = (cx: number, cy: number, size: number, c1: string, c2: string, halo: string) => {
        const a = ini[0] ?? 'L', b = ini[1] ?? '';
        if (!b) return `<text x="${cx}" y="${cy + size * 0.35}" text-anchor="middle" font-family="${SERIF}" font-size="${size * 1.1}" font-weight="700" fill="${c1}">${esc(a)}</text>`;
        // two letters set close, the second in italic and the accent colour, just touching the first
        return `<text x="${cx - size * 0.27}" y="${cy + size * 0.3}" text-anchor="middle" font-family="${SERIF}" font-size="${size * 0.92}" font-weight="700" fill="${c1}">${esc(a)}</text>` +
          `<text x="${cx + size * 0.27}" y="${cy + size * 0.36}" text-anchor="middle" font-family="${SERIF}" font-size="${size * 0.92}" font-weight="700" font-style="italic" fill="${c2}" stroke="${halo}" stroke-width="${size * 0.04}" paint-order="stroke">${esc(b)}</text>`;
      };
      if (!full) return `<circle cx="100" cy="100" r="96" fill="${P.plate}"/><circle cx="100" cy="100" r="86" fill="none" stroke="${P.accent}" stroke-width="3"/>${mono(100, 98, 92, P.ink, P.accent, P.plate)}`;
      return `<circle cx="100" cy="74" r="58" fill="none" stroke="${P.text}" stroke-width="3"/><circle cx="100" cy="74" r="51" fill="none" stroke="${P.accent}" stroke-width="1.5"/>${mono(100, 72, 70, P.text, P.accent, '#ffffff')}
        ${text(main, 100, 160, 17, 176, P.text, { spacing: 2.5 })}<rect x="40" y="172" width="34" height="2" fill="${P.accent}"/><rect x="126" y="172" width="34" height="2" fill="${P.accent}"/>${text(kind, 100, 177, 9, 46, P.accent, { spacing: 2 })}`;
    }
    case 'roundel': {
      if (!full) return `<circle cx="100" cy="100" r="96" fill="${P.plate}"/>${sym(100, 100, 124)}`;
      // a solid disc, the symbol above, the name on a band across the lower third
      return `<defs><clipPath id="rc"><circle cx="100" cy="100" r="96"/></clipPath></defs><circle cx="100" cy="100" r="96" fill="${P.plate}"/><g clip-path="url(#rc)"><rect x="0" y="122" width="200" height="34" fill="${P.accent}"/></g><circle cx="100" cy="100" r="96" fill="none" stroke="${P.accent}" stroke-width="4"/>${sym(100, 70, 86)}${text(main, 100, 145, 15, 150, P.plate, { spacing: 1.2 })}${text(kind, 100, 178, 9, 80, P.ink, { spacing: 2.5 })}`;
    }
    case 'pennant': {
      const flag = (x: number, y: number, w: number, h: number) => `<path d="M${x} ${y} L${x + w} ${y + h * 0.18} L${x + w * 0.78} ${y + h * 0.5} L${x + w} ${y + h * 0.82} L${x} ${y + h} Z" fill="${P.plate}"/><path d="M${x} ${y} L${x + w} ${y + h * 0.18} L${x + w * 0.78} ${y + h * 0.5} L${x + w} ${y + h * 0.82} L${x} ${y + h} Z" fill="none" stroke="${P.accent}" stroke-width="3"/>`;
      if (!full) return `<rect x="30" y="10" width="9" height="182" rx="4" fill="${P.accent}"/>${flag(39, 18, 140, 112)}${text(ini, 98, 92, 52, 100, P.ink, { spacing: 2 })}`;
      return `<rect x="44" y="6" width="7" height="132" rx="3.5" fill="${P.accent}"/>${flag(51, 12, 112, 86)}${text(ini, 98, 67, 38, 76, P.ink, { spacing: 2 })}<ellipse cx="48" cy="138" rx="30" ry="6" fill="${P.text}"/>${text(main, 100, 170, 18, 184, P.text, { spacing: 2 })}${text(kind, 100, 190, 10, 90, P.accent, { spacing: 3 })}`;
    }
    case 'wordmark': {
      if (!full) return `<rect x="8" y="8" width="184" height="184" rx="36" fill="${P.plate}"/><rect x="20" y="20" width="160" height="160" rx="26" fill="none" stroke="${P.accent}" stroke-width="3"/>${sym(100, 100, 118)}`;
      const words = main.split(/\s+/);
      const two = main.length > 13 && words.length > 1;
      const half = Math.ceil(words.length / 2);
      const l1 = two ? words.slice(0, half).join(' ') : main, l2 = two ? words.slice(half).join(' ') : '';
      return `${sym(100, 50, 72, P.text, '#ffffff')}${text(l1, 100, two ? 118 : 132, two ? 24 : 26, 184, P.text, { spacing: 1.5 })}${l2 ? text(l2, 100, 146, 24, 184, P.text, { spacing: 1.5 }) : ''}<rect x="30" y="${two ? 162 : 150}" width="40" height="2" fill="${P.accent}"/><rect x="130" y="${two ? 162 : 150}" width="40" height="2" fill="${P.accent}"/>${text(kind, 100, two ? 167 : 155, 10, 50, P.accent, { spacing: 2.5 })}`;
    }
  }
}

/** The SVG markup for a club's logo: transparent background, square 200 x 200 viewBox, scales to any size. */
export function crestSvg(logo: Logo, name: string, variant: CrestVariant = 'full', override: Partial<Identity> = {}): string {
  const id = { ...identityOf(logo), ...override };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200" role="img" aria-label="${esc(name)} ${variant === 'emblem' ? 'emblem' : 'logo'}">${build(id, name, variant)}</svg>`;
}

// ------------------------------------------------------------------ drawing into canvases the interface already has
const images = new Map<string, HTMLImageElement>();
/** Draw a logo into a canvas at its own pixel size. The SVG is rasterised once and kept, so repaints are cheap. */
export function paintCrest(canvas: HTMLCanvasElement, logo: Logo, name: string, variant: CrestVariant = 'full', override: Partial<Identity> = {}) {
  const svg = crestSvg(logo, name, variant, override);
  const c = canvas.getContext('2d');
  if (!c) return;
  const draw = (img: HTMLImageElement) => { c.clearRect(0, 0, canvas.width, canvas.height); const pad = Math.round(canvas.width * 0.03); c.drawImage(img, pad, pad, canvas.width - pad * 2, canvas.height - pad * 2); };
  canvas.dataset.crest = svg.length + ':' + name + ':' + variant;
  let img = images.get(svg);
  if (img && img.complete && img.naturalWidth) { draw(img); return; }
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    images.set(svg, img);
    if (images.size > 400) images.delete(images.keys().next().value!);
  }
  const key = canvas.dataset.crest;
  img.addEventListener('load', () => { if (canvas.dataset.crest === key) draw(img!); }, { once: true });
}
