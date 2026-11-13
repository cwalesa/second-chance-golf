import { describe, expect, it } from 'vitest';
import { MomentState, nextMoment } from '../src/moments';

const idle = (o: Partial<MomentState> = {}, pending: Partial<MomentState['pending']> = {}): MomentState => ({
  open: null, blocked: false, calm: true, panelOpen: false, ...o, pending: { round: false, goal: false, recap: false, ...pending },
});

describe('one moment at a time', () => {
  it('shows nothing when nothing is waiting', () => {
    expect(nextMoment(idle())).toBeNull();
  });
  it('never starts a second moment while one is on screen', () => {
    for (const open of ['round', 'goal', 'recap'] as const) expect(nextMoment(idle({ open }, { round: true, goal: true, recap: true }))).toBeNull();
  });
  it('picks by priority: the first round, then rewards, then the day report', () => {
    expect(nextMoment(idle({}, { round: true, goal: true, recap: true }))).toBe('round');
    expect(nextMoment(idle({}, { goal: true, recap: true }))).toBe('goal');
    expect(nextMoment(idle({}, { recap: true }))).toBe('recap');
  });
  it('waits while the tutorial, a dialog, the menu or a practice round has the screen', () => {
    expect(nextMoment(idle({ blocked: true }, { round: true, goal: true, recap: true }))).toBeNull();
  });
  it('celebrations wait for an open panel to be closed and for an edit to be set down', () => {
    expect(nextMoment(idle({ panelOpen: true }, { round: true }))).toBeNull();
    expect(nextMoment(idle({ panelOpen: true }, { goal: true }))).toBeNull();
    expect(nextMoment(idle({ calm: false }, { round: true, goal: true }))).toBeNull();
  });
  it('the day report only waits for the edit; a panel does not hold it back', () => {
    expect(nextMoment(idle({ panelOpen: true }, { recap: true }))).toBe('recap');
    expect(nextMoment(idle({ calm: false }, { recap: true }))).toBeNull();
  });
  it('when the first round is held back by a panel, a lower-priority moment must not jump the queue ahead of it for the same reason', () => {
    // both are celebrations held by the same panel, so neither appears
    expect(nextMoment(idle({ panelOpen: true }, { round: true, goal: true }))).toBeNull();
  });
});
