import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { pic } from '../src/icons';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

describe('one interface stylesheet', () => {
  it('has no separate phone or theme layer', () => {
    expect(existsSync(new URL('../src/phone.css', import.meta.url))).toBe(false);
    expect(existsSync(new URL('../src/theme.css', import.meta.url))).toBe(false);
    expect(main).not.toMatch(/phone\.css|theme\.css/);
    expect((main.match(/\.css'/g) ?? []).length).toBe(1);
  });
  it('keeps colour and typeface in separate tokens (no --text collision)', () => {
    expect(css).not.toMatch(/--text\s*:/);
    expect(css).toMatch(/--font\s*:/);
    expect(css).toMatch(/--ink\s*:/);
    for (const token of ['--title', '--panel', '--panel-2', '--well', '--accent', '--target']) expect(css).toContain(`${token}:`);
  });
  it('defines every var() it reads', () => {
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    // variables published by script at run time (layout, and the confetti and coin flight paths)
    for (const v of ['--hdr', '--dock', '--side-w', '--dx', '--rot', '--tx', '--ty']) defined.add(v);
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
    expect(used.filter((v) => !defined.has(v))).toEqual([]);
  });
  it('sizes touch controls at 44px', () => {
    expect(css).toMatch(/--tap:\s*44px/);
  });
});

describe('illustrated menu icons', () => {
  it('has an illustration for each menu destination, drawn on the shared grid', () => {
    for (const name of ['build', 'course', 'guests', 'money', 'club', 'journey']) {
      const svg = pic(name);
      expect(svg).toContain('class="pic"');
      expect(svg).toContain('viewBox="0 0 44 44"');
      expect(svg).not.toContain('NaN');
      expect(svg).not.toContain('undefined');
    }
  });
  it('falls back to the line icon for anything else', () => {
    expect(pic('pause')).toContain('class="ic ');
  });
});
