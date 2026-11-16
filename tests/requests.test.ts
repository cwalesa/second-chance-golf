import { describe, expect, it } from 'vitest';
import { Game } from '../src/game';
import { BANDS } from '../src/progression';
import { GuestRequest, REQUEST_DAYS, cupCondition, requestDone, rollRequests } from '../src/requests';
import { deserialize, serialize } from '../src/save';
import { createTestCourse } from './fixtures/classic-course';

const course = () => {
  const g = new Game(createTestCourse(), 5);
  for (const h of g.world.holes) g.openHole(h.id);
  return g;
};
const ask = (g: Game, r: Partial<GuestRequest>): GuestRequest => {
  const full: GuestRequest = { id: g.requests.seq++, kind: 'price', who: 'Dana K.', text: 'x', reward: 300, until: g.day + 2, base: 0, ...r };
  g.requests.list.push(full);
  return full;
};

describe('guest requests', () => {
  it('only asks about what the course actually has wrong, never more than two at once, and none in the first days', () => {
    const g = course();
    // nothing wrong yet: fees fair, turf fresh, nothing to ask
    for (const b of BANDS) g.setBandFee(b.id, Math.round(g.fair * b.fair));
    for (let d = 1; d < 40; d++) { g.day = d; rollRequests(g); }
    expect(g.requests.list.filter((r) => r.kind === 'price')).toEqual([]);
    // steep fees: sooner or later a guest says so
    for (const b of BANDS) g.setBandFee(b.id, Math.round(g.fair * b.fair) + 25);
    g.requests = { list: [], seq: 1, last: {} };
    for (let d = 1; d < 3; d++) { g.day = d; expect(rollRequests(g)).toBeNull(); }
    let asked = 0;
    for (let d = 4; d < 60; d++) {
      g.day = d;
      if (rollRequests(g)) asked++;
      expect(g.requests.list.length).toBeLessThanOrEqual(2);
    }
    expect(asked).toBeGreaterThan(0);
  });

  it('lapses after its days are up', () => {
    const g = course();
    g.day = 10;
    ask(g, { until: g.day + REQUEST_DAYS - 1 });
    g.day += REQUEST_DAYS;
    rollRequests(g);
    expect(g.requests.list).toEqual([]);
  });

  it('pays once, when the thing is put right', () => {
    const g = course();
    for (const b of BANDS) g.setBandFee(b.id, Math.round(g.fair * b.fair) + 25);
    const r = ask(g, { kind: 'price', reward: 300 });
    g.checkRequests();
    expect(g.requests.list).toContain(r);
    const cash = g.cash;
    for (const b of BANDS) g.setBandFee(b.id, Math.round(g.fair * b.fair));
    g.checkRequests();
    expect(g.requests.list).toEqual([]);
    expect(g.cash).toBeGreaterThanOrEqual(cash + 300);
    expect(g.cheers.some((c) => c.kind === 'request')).toBe(true);
  });

  it('a bumpy green is done when the green around the cup is repaired', () => {
    const g = course();
    const h = g.world.holes[0], w = g.world;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = (h.cup.y + dy) * w.w + h.cup.x + dx; if (w.terrain[i] === 2) w.cond[i] = 20; }
    expect(cupCondition(g, h)).toBeLessThan(50);
    const r = ask(g, { kind: 'worn', hole: h.id });
    expect(requestDone(g, r)).toBe(false);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const i = (h.cup.y + dy) * w.w + h.cup.x + dx; if (w.terrain[i] === 2) w.cond[i] = 95; }
    expect(requestDone(g, r)).toBe(true);
  });

  it('a punishing hole is done only once it has been reworked and opened again', () => {
    const g = course();
    const h = g.world.holes[0];
    const r = ask(g, { kind: 'water', hole: h.id, base: h.reopenedAt });
    expect(requestDone(g, r)).toBe(false);
    g.total += 50;
    g.closeHole(h.id);
    expect(requestDone(g, r)).toBe(false);
    g.openHole(h.id);
    expect(requestDone(g, r)).toBe(true);
  });

  it('survives a save and reload, and bad data is dropped', () => {
    const g = course();
    ask(g, { kind: 'restroom', text: 'somewhere to stop' });
    const back = deserialize(serialize(g))!.game;
    expect(back.requests.list.map((r) => r.kind)).toEqual(['restroom']);
    const raw = JSON.parse(serialize(g));
    raw.requests.list.push({ id: 'x', kind: 'nonsense' });
    expect(deserialize(JSON.stringify(raw))!.game.requests.list.length).toBe(1);
    delete raw.requests;
    expect(deserialize(JSON.stringify(raw))!.game.requests.list).toEqual([]);
  });
});
