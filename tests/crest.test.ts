import { describe, expect, it } from 'vitest';
import { CREST_STYLES, CREST_SYMBOLS, PALETTE_IDS, crestSvg, identityOf, initialsFor, nameParts } from '../src/crest';
import { defaultLogo } from '../src/logo';
import { deserialize, serialize } from '../src/save';
import { Game } from '../src/game';
import { createTestCourse } from './fixtures/classic-course';

const blank = { shape: 'circle' as const, primary: '#1f4a35', secondary: '#b8975a', icon: 'flag' as const, initials: '' };
/** Well-formed XML: no attribute appears twice on one element, and every element opened is closed. */
function wellFormed(svg: string): boolean {
  for (const tag of svg.match(/<[a-zA-Z][^>]*>/g) ?? []) {
    const names = [...tag.matchAll(/\s([a-zA-Z:-]+)="/g)].map((m) => m[1]);
    if (new Set(names).size !== names.length) return false;
  }
  const opens = (svg.match(/<(g|svg|text|textPath|defs|clipPath)[\s>]/g) ?? []).length;
  const closes = (svg.match(/<\/(g|svg|text|textPath|defs|clipPath)>/g) ?? []).length;
  return opens === closes;
}

describe('club identities', () => {
  it('every style, symbol and palette draws a well-formed full logo and emblem', () => {
    for (const style of CREST_STYLES) for (const symbol of CREST_SYMBOLS) for (const palette of PALETTE_IDS) for (const v of ['full', 'emblem'] as const) {
      const svg = crestSvg(blank, 'Willow Creek', v, { style, symbol, palette });
      expect(wellFormed(svg), `${style}/${symbol}/${palette}/${v}`).toBe(true);
      expect(svg).toContain('viewBox="0 0 200 200"');
      expect(svg).not.toContain('NaN');
      expect(svg).not.toContain('undefined');
    }
  });
  it('the full logo carries the club name; the emblem has no small text except a monogram or initials', () => {
    const full = crestSvg(defaultLogo(), 'Willow Creek', 'full');
    expect(full).toContain('WILLOW CREEK');
    for (const style of ['seal', 'crest', 'roundel', 'wordmark'] as const) expect(crestSvg(blank, 'Willow Creek', 'emblem', { style })).not.toContain('<text');
  });
  it('names read as a real club: initials and the kind of club', () => {
    expect(nameParts('Saltmarsh Links')).toEqual({ main: 'SALTMARSH', kind: 'LINKS' });
    expect(nameParts('Granite Peak Golf Club')).toEqual({ main: 'GRANITE PEAK', kind: 'GOLF CLUB' });
    expect(nameParts('Willow Creek')).toEqual({ main: 'WILLOW CREEK', kind: 'GOLF CLUB' });
    expect(initialsFor('Willow Creek')).toBe('WC');
    expect(initialsFor('Heronfield')).toBe('H');
    expect(initialsFor('The Old Course')).toBe('OC');
  });
  it('a long name is fitted, never overflowing its space', () => {
    const svg = crestSvg(blank, 'Whispering Pines Country Club', 'full', { style: 'crest' });
    expect(svg).toMatch(/textLength="\d+"/);
  });
  it('an older saved logo maps onto the nearest identity, and keeps it through a save', () => {
    const old = { shape: 'shield' as const, primary: '#7a2433', secondary: '#e6b44c', icon: 'pine' as const, initials: 'PC' };
    expect(identityOf(old)).toEqual({ style: 'crest', symbol: 'pine', palette: 'burgundy' });
    const g = new Game(createTestCourse(), 1, { name: 'Pine Crest', logo: old });
    const back = deserialize(serialize(g))!.game;
    expect(identityOf(back.logo)).toEqual({ style: 'crest', symbol: 'pine', palette: 'burgundy' });
    expect(back.name).toBe('Pine Crest');
  });
});
