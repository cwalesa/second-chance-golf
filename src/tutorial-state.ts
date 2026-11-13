/** Saved progress through the first-course tutorial. Pure data, so the game and saves can use it without the interface. */
export const TUTORIAL_VERSION = 2;
export interface TutorialState {
  step: number;
  done: boolean;
  /** 2 = the guided tutorial on the player's own course. Missing = a save from before it existed (or the old practice course). */
  v?: number;
}
export const freshTutorial = (): TutorialState => ({ step: 0, done: false, v: TUTORIAL_VERSION });

export interface TestRound { name: string; type: 'beginner' | 'regular' | 'skilled'; strokes: number; par: number; shots: number; rough: number; bunker: number; water: number; }
const parWord = (over: number) => (over === 0 ? 'par' : over === -1 ? 'a birdie' : over < -1 ? `${-over} under par` : over === 1 ? 'a bogey' : `${over} over par`);
/** The result line the tutorial shows for a test golfer, from what that golfer actually did. */
export function testResultLine(r: TestRound): string {
  return `${r.name}, a ${r.type} golfer, took ${r.strokes} on this par ${r.par}${r.strokes === r.par ? '' : ` (${parWord(r.strokes - r.par)})`}.`;
}
/** One brief, useful thing to take from that round. Always drawn from the round itself. */
export function testObservation(r: TestRound): string {
  const over = r.strokes - r.par;
  if (r.water > 0) return 'They found water. Leave a safe route around it.';
  if (r.bunker > 0 && over > 0) return 'Sand cost them strokes. A bunker or two is plenty.';
  if (over >= 2) return r.type === 'skilled' ? 'Even a skilled golfer struggled. Check for trees or hazards on the line.' : 'A tough hole for them. Wider fairway gives golfers room to miss.';
  if (r.rough >= 2) return 'They spent time in the rough. More fairway where drives land keeps play moving.';
  if (over < 0) return 'Easy and friendly. A bunker by the green would add a little challenge.';
  if (over === 0 && r.bunker === 0) return 'A comfortable par with no hazards in play. A bunker beside the green would add interest.';
  return 'A fair test. Golfers enjoy a mix of easy and tricky holes.';
}
