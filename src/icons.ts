/**
 * One icon family for the whole interface. Every glyph sits on a 24-unit grid, is drawn with the same
 * 1.7 stroke, square-ish joins and no fills, and is built from the game's own vocabulary (flag, pin,
 * green, ledger, clubhouse roof) rather than generic app symbols.
 */
const P: Record<string, string> = {
  // navigation
  design: 'M4.5 19.5l.9-4.2L15.6 5.1a1.6 1.6 0 012.3 0l1 1a1.6 1.6 0 010 2.3L8.7 18.6zM13.6 7.1l3.3 3.3',
  course: 'M7 21V3.5M7 3.5l10.5 3.7L7 11M3.5 21h9',
  guests: 'M12 3.5a3.2 3.2 0 110 6.4 3.2 3.2 0 010-6.4zM5.5 20.5c.4-4.4 3-7 6.5-7s6.1 2.6 6.5 7z',
  money: 'M4.5 4h11a3 3 0 013 3v13h-11a3 3 0 01-3-3zM8.5 4v16M11.5 9h4M11.5 13h4',
  club: 'M3 20.5v-10L12 4l9 6.5v10zM9.5 20.5v-6h5v6M12 4V2',
  journey: 'M4 6.5l1.8 1.8L9 5M12 7h8M4 13.5l1.8 1.8L9 12M12 14h8M4 20.5l1.8 1.8L9 19M12 21h8',
  events: 'M5 21.5V3M5 4.5h14l-3.5 4.5L19 13.5H5',
  build: 'M4.5 19.5l.9-4.2L15.6 5.1a1.6 1.6 0 012.3 0l1 1a1.6 1.6 0 010 2.3L8.7 18.6zM13.6 7.1l3.3 3.3',
  // tools
  inspect: 'M6 3.5l12.5 7.2-5.6 1.6L10.4 18z',
  pan: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
  bend: 'M4 20l6.5-9L20 13M20 13l-3-3.2M20 13l-3.4 2.6',
  undo: 'M8.5 5.5L3.5 10l5 4.5M3.5 10h10a5 5 0 010 10h-4',
  redo: 'M15.5 5.5l5 4.5-5 4.5M20.5 10h-10a5 5 0 000 10h4',
  // menu
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  pause: 'M8.5 5v14M15.5 5v14',
  play: 'M7.5 4.5l11 7.5-11 7.5z',
  fast: 'M3.5 5.5l8 6.5-8 6.5zM12.5 5.5l8 6.5-8 6.5z',
  map: 'M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5zM9 4v14M15 6.5V20',
  whole: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  check: 'M5 12.5l4.5 4.5L19 7',
};
export type IconName = keyof typeof P;
export const icon = (name: string, cls = '') =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] ?? ''}"/></svg>`;

/** The crest-sized flag mark used on the wordmark, empty states and the goal slip. */
export const flagMark = (cls = '') =>
  `<svg class="flagmark ${cls}" viewBox="0 0 24 28" aria-hidden="true"><path d="M5 26V2" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/><path d="M5 3l15 5.5L5 14z" fill="var(--flag,#b63d2a)"/><ellipse cx="5" cy="26" rx="4.5" ry="1.4" fill="currentColor" opacity=".35"/></svg>`;

/**
 * Illustrated destination icons for the menu. One family: a 44-unit grid, light from the upper left
 * (light face, mid face, dark face), a single dark-green outline weight, and the game's own subjects
 * (a green with its flag, a golfer, a clubhouse, a coin stack, a clipboard, a pencil).
 */
const O = '#22402b', GL = '#a9d68a', GM = '#74b45e', GD = '#4e8f49', CREAM = '#f3ecd6', CREAM_D = '#d9cdaa', ROOF = '#b9573b', ROOF_L = '#d3735a', GOLD = '#e9b72a', GOLD_L = '#f8d96a', GOLD_D = '#b98912';
const slab = (cx: number, cy: number, w: number) => {
  const h = w / 2, d = w * 0.22;
  return `<path d="M${cx} ${cy - h / 2}L${cx + w / 2} ${cy}L${cx} ${cy + h / 2}L${cx - w / 2} ${cy}Z" fill="${GL}" stroke="${O}"/><path d="M${cx - w / 2} ${cy}L${cx} ${cy + h / 2}L${cx} ${cy + h / 2 + d}L${cx - w / 2} ${cy + d}Z" fill="${GM}" stroke="${O}"/><path d="M${cx + w / 2} ${cy}L${cx} ${cy + h / 2}L${cx} ${cy + h / 2 + d}L${cx + w / 2} ${cy + d}Z" fill="${GD}" stroke="${O}"/>`;
};
const PICS: Record<string, string> = {
  build: `${slab(22, 33, 30)}<g transform="rotate(42 22 18)"><rect x="19" y="3" width="6" height="19" fill="#f4c63a" stroke="${O}"/><rect x="22.2" y="3.5" width="2.3" height="18" fill="#d49e18"/><path d="M19 22h6l-3 7z" fill="#ecd2a0" stroke="${O}"/><path d="M21 26.4h2L22 29z" fill="#3a3a3a"/><rect x="19" y="1" width="6" height="3.5" rx="1" fill="#e58f8f" stroke="${O}"/></g>`,
  course: `${slab(22, 33, 34)}<path d="M22 31V7" stroke="${O}" stroke-width="2.4" stroke-linecap="round"/><path d="M22 7l12 5.5L22 18z" fill="#d0472d" stroke="${O}"/><path d="M22 7l12 5.5-12 2z" fill="#e5705a"/><circle cx="29" cy="33" r="2" fill="#fff" stroke="${O}"/>`,
  guests: `<ellipse cx="22" cy="39" rx="12" ry="3" fill="rgba(34,64,43,.25)"/><circle cx="20" cy="9" r="4.6" fill="#f1cba2" stroke="${O}"/><path d="M15.5 8.5a5 4 0 0110 -1.2l-1 2.6h-9z" fill="#f3ecd6" stroke="${O}"/><path d="M14 16.5q6-3 12 0l2 12h-16z" fill="#4f86b6" stroke="${O}"/><path d="M14 16.5q3-1.5 6-1.6l-2 13.100h-4.200z" fill="#79a6d1"/><path d="M16 28.5h8l.5 10h-3.200l-1.300-7-1.300 7h-3.200z" fill="#3d4a55" stroke="${O}"/><path d="M26 18l9 17" stroke="${O}" stroke-width="2" stroke-linecap="round"/><path d="M33.500 34.500l4 .5-.5 2.500-4-.5z" fill="#c9ced2" stroke="${O}"/><circle cx="38" cy="39" r="1.800" fill="#fff" stroke="${O}"/>`,
  money: `<ellipse cx="22" cy="39" rx="15" ry="3" fill="rgba(34,64,43,.25)"/>${[32, 25, 18].map((y) => `<path d="M7 ${y}v5a15 6 0 0030 0v-5z" fill="${GOLD}" stroke="${O}"/><path d="M7 ${y}v5a15 6 0 0015 6v-5z" fill="${GOLD_L}" opacity=".55"/><ellipse cx="22" cy="${y}" rx="15" ry="6" fill="${GOLD_L}" stroke="${O}"/>`).join('')}<text x="22" y="22" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="11" fill="${GOLD_D}">$</text>`,
  club: `<ellipse cx="22" cy="39" rx="17" ry="3" fill="rgba(34,64,43,.25)"/><path d="M6 21h32v17H6z" fill="${CREAM}" stroke="${O}"/><path d="M26 21h12v17H26z" fill="${CREAM_D}" stroke="${O}"/><path d="M3 22L22 8l19 14z" fill="${ROOF}" stroke="${O}"/><path d="M3 22L22 8v14z" fill="${ROOF_L}"/><rect x="18" y="28" width="8" height="10" fill="#8a5a38" stroke="${O}"/><rect x="9" y="26" width="6" height="6" fill="#a9d0e6" stroke="${O}"/><rect x="29" y="26" width="6" height="6" fill="#a9d0e6" stroke="${O}"/><path d="M22 8V2" stroke="${O}" stroke-width="1.600"/><path d="M22 2l7 2-7 2.500z" fill="#d0472d" stroke="${O}"/>`,
  events: `<ellipse cx="22" cy="39" rx="12" ry="3" fill="rgba(34,64,43,.25)"/><path d="M12 10H6.5v3.500a6 6 0 006 6M32 10h5.500v3.500a6 6 0 01-6 6" fill="none" stroke="${O}" stroke-width="2.200"/><path d="M12 6h20v10a10 10 0 01-20 0z" fill="${GOLD}" stroke="${O}"/><path d="M12 6h8v19.800a10 10 0 01-8-9.800z" fill="${GOLD_L}" opacity=".7"/><path d="M19.500 25.500h5v6h-5z" fill="${GOLD_D}" stroke="${O}"/><path d="M13 31.500h18v6.500H13z" fill="#8a5a38" stroke="${O}"/><path d="M17 34.800h10" stroke="${CREAM}" stroke-width="1.600"/>`,
  journey: `<rect x="8" y="6" width="28" height="34" rx="3" fill="#b9824f" stroke="${O}"/><rect x="11" y="10" width="22" height="27" rx="1" fill="${CREAM}" stroke="${O}"/><rect x="16" y="3" width="12" height="7" rx="2" fill="#aab2ad" stroke="${O}"/>${[16, 23, 30].map((y, i) => `<path d="M14 ${y}l2 2 3.500-4" fill="none" stroke="${i < 2 ? '#2f8a3f' : '#b9b39c'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 ${y}h8" stroke="#8d8a78" stroke-width="2" stroke-linecap="round"/>`).join('')}`,
};
/** An illustrated menu icon, or the plain line icon when none exists. */
export const pic = (name: string) =>
  PICS[name] ? `<svg class="pic" viewBox="0 0 44 44" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${PICS[name]}</svg>` : icon(name);
