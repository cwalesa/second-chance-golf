/**
 * One thing at a time. The game has several moments that want the player's attention: the first-round card, goal and
 * reward pop-ups, and the end-of-day report. Each used to decide for itself when to appear, so they could land on top
 * of each other, over a panel, or in the middle of an edit. This decides, from one snapshot, which one (if any) may appear now.
 */
export type MomentKind = 'round' | 'goal' | 'recap';

export interface MomentState {
  /** The moment on screen right now, if any. Nothing else may start while one is. */
  open: MomentKind | null;
  pending: { round: boolean; goal: boolean; recap: boolean };
  /** Something else owns the screen: the tutorial strip, a dialog, the menu, the intro, a practice round. */
  blocked: boolean;
  /** No edit, drag, placement or staged change is in progress. */
  calm: boolean;
  /** A management panel is open. */
  panelOpen: boolean;
}

/** Highest priority first: a first round is rare and personal, rewards come next, the day report closes the day. */
export function nextMoment(s: MomentState): MomentKind | null {
  if (s.open || s.blocked) return null;
  // celebrations wait until the player is not busy and nothing is open beside them
  if (s.pending.round && s.calm && !s.panelOpen) return 'round';
  if (s.pending.goal && s.calm && !s.panelOpen) return 'goal';
  // the day report is a dialog of its own and holds the clock, so it need not wait for panels, only for the edit in progress to be set down
  if (s.pending.recap && s.calm) return 'recap';
  return null;
}
