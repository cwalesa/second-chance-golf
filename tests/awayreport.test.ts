import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { awayComment, awayHeadline, buildAwayReport } from '../src/awayreport';
import { CHAIN } from '../src/campaign';
import { createTestCourse } from './fixtures/classic-course';

describe('while you were away', () => {
  it('names a real hole and offers one real fix', () => {
    const g = new Game(createTestCourse());
    const r = buildAwayReport(g, { days: 2, net: 340, rounds: 18 });
    expect(r.comment.hole === null || g.world.holes.some((h) => h.id === r.comment.hole)).toBe(true);
    expect(r.fix.label.length).toBeGreaterThan(3);
    expect(awayHeadline(r)).toBe('2 days passed. 18 rounds played, +$340.');
  });
  it('a worn green is the thing to fix', () => {
    const g = new Game(createTestCourse());
    const h = g.world.holes.find((x) => x.open) ?? g.world.holes[0];
    h.open = true;
    for (let y = h.cup.y - 4; y <= h.cup.y + 4; y++) for (let x = h.cup.x - 4; x <= h.cup.x + 4; x++) { const i = y * g.world.w + x; if (g.world.terrain[i] === 2) g.world.cond[i] = 10; }
    const c = awayComment(g);
    expect(c.hole).toBe(h.id);
    expect(c.text).toContain(h.name);
    expect(c.fix.holeId).toBe(h.id);
  });
});

describe('one progression', () => {
  it('goal text uses the menu names that exist and never mentions removed tabs', () => {
    const text = CHAIN.map((c) => `${c.title} ${c.how}`).join(' ');
    for (const old of ['Club tab', 'Money tab', 'Events tab', 'Build hole tool', 'click']) expect(text).not.toContain(old);
    expect(CHAIN.some((c) => /parcel|land/i.test(c.title))).toBe(false);
  });
});
