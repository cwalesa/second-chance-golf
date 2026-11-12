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
