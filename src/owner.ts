import { SwingMeter } from './swing';
import type { Game } from './game';
import { Pt, center } from './terrain';
import { executeShot, lieAt, puttProbability, puttLeave, ShotResult } from './physics';
import { Rng } from './rng';

export const CLUBS = { driver: { name: 'Driver', reach: 25 }, iron: { name: 'Iron', reach: 17 }, wedge: { name: 'Wedge', reach: 8 }, putter: { name: 'Putter', reach: 4 } };
export type ClubId = keyof typeof CLUBS;
export interface OwnerScore { hole: number; name: string; par: number; strokes: number; }
export interface OwnerRecord { day: number; scores: OwnerScore[]; }
/** A separate practice round: no guest income, wear, rewards, or simulation RNG consumed. */
export class OwnerRound {
  swing = new SwingMeter();
  lastStrike = '';
  active = false;
  holeId = 0;
  ball: Pt = { x: 0, y: 0 };
  aim: Pt | null = null;
  club: ClubId = 'driver';
  strokes = 0;
  completed = false;
  scores: OwnerScore[] = [];
  route: number[] = [];
  flight: { from: Pt; shot: ShotResult; t: number; holed: boolean; putt: boolean } | null = null;
  message = 'Tap the course to aim, then hit your shot.';
  private rng = new Rng(78391);
  start(g: Game, all = false) {
    const h = g.world.holes.find(h => h.id === g.selectedHole);
    if (!h) return;
    this.active = true; this.scores = []; this.route = all ? g.openHoles.map(h => h.id) : [h.id];
    if (!this.route.length) this.route = [h.id];
    this.next(g);
  }
  next(g: Game): void {
    const id = this.route.shift();
    if (id === undefined) { this.stop(g); return; }
    const h = g.world.holes.find(h => h.id === id);
    if (!h) return this.next(g);
    this.swing.cancel(); this.lastStrike = '';
    this.holeId = id; this.ball = center(h.tee); this.strokes = 0; this.completed = false; this.flight = null;
    this.aim = center(h.cup); this.club = h.par === 3 ? 'iron' : 'driver'; this.message = 'Tap a landing spot. Pick a club, then hit.';
    g.selectedHole = id;
  }
  stop(g: Game) {
    if (this.scores.length) { g.ownerRecords.push({ day: g.day, scores: [...this.scores] }); g.ownerRecords = g.ownerRecords.slice(-12); g.dirtySave = true; }
    this.active = false; this.flight = null; this.swing.cancel();
  }
  get distance() { return this.aim ? Math.hypot(this.aim.x - this.ball.x, this.aim.y - this.ball.y) : 0; }
  reach(g: Game) {
    const lie = lieAt(g.world, this.ball.x, this.ball.y);
    return CLUBS[this.club].reach * (this.club === 'putter' ? 1 : lie.distF * g.regionDef.distance);
  }
  hit(g: Game, timingOffset = 0) {
    if (!this.active || this.completed || this.flight || !this.aim || this.distance < .01) return;
    const h = g.world.holes.find(h => h.id === this.holeId); if (!h) { this.stop(g); return; }
    const cup = center(h.cup), lie = lieAt(g.world, this.ball.x, this.ball.y);
    const miss = Math.abs(timingOffset);
    this.lastStrike = miss < .12 ? 'Pure strike' : miss < .4 ? 'Solid contact' : timingOffset < 0 ? 'Early · pulled left' : 'Late · pushed right';
    const d = Math.min(this.distance, this.reach(g)) * (1 - miss * .12);
    const angle = Math.atan2(this.aim.y - this.ball.y, this.aim.x - this.ball.x) + timingOffset * .13;
    let holed = false;
    let shot: ShotResult;
    const putt = this.club === 'putter';
    if (putt && lie.kind === 'green') {
      const cupDist = Math.hypot(cup.x - this.ball.x, cup.y - this.ball.y);
      const aimedAtCup = Math.hypot(this.aim.x - cup.x, this.aim.y - cup.y) < .75;
      holed = aimedAtCup && cupDist <= this.reach(g) && this.rng.next() < puttProbability(cupDist * 30, 'skilled', lie.cond) * (1 - miss * .7);
      let end = { x: this.ball.x + Math.cos(angle) * d, y: this.ball.y + Math.sin(angle) * d };
      if (holed) end = cup;
      else if (aimedAtCup && cupDist <= this.reach(g)) { const a = this.rng.next() * Math.PI * 2, left = puttLeave(this.rng, cupDist * 30) / 30; end = { x: cup.x + Math.cos(a) * left, y: cup.y + Math.sin(a) * left }; }
      shot = { air: end, end, kind: 'ok', penalty: 0 };
    } else {
      shot = executeShot(g.world, this.rng, 'skilled', this.ball, { angle, dist: d, aim: this.aim, directCarryTooLong: false });
      holed = shot.kind === 'ok' && Math.hypot(shot.end.x - cup.x, shot.end.y - cup.y) < .18;
    }
    g.onFeedback('swing');
    this.strokes += 1 + shot.penalty;
    this.flight = { from: { ...this.ball }, shot, t: 0, holed, putt };
    this.message = shot.penalty ? `${shot.kind === 'water' ? 'Water' : 'Out of bounds'}. One penalty stroke; drop included.` : 'Ball in motion…';
  }
  update(g: Game, dt: number) {
    if (!this.active) return;
    this.swing.update(dt);
    const h = g.world.holes.find(h => h.id === this.holeId);
    if (!h) { this.stop(g); return; }
    const f = this.flight; if (!f) return;
    f.t = Math.min(1, f.t + dt / (f.putt ? .7 : 1.1));
    if (f.t < 1) return;
    this.ball = { ...f.shot.end }; this.flight = null;
    if (f.holed || this.strokes >= h.par + 5) {
      this.completed = true;
      g.onFeedback('cup');
      this.scores.push({ hole: h.id, name: h.name, par: h.par, strokes: this.strokes });
      const diff = this.strokes - h.par;
      this.message = f.holed ? `${diff === 0 ? 'Par' : diff === -1 ? 'Birdie' : diff < -1 ? 'Eagle or better' : '+' + diff}! Hole complete.` : 'Stroke limit reached. Score recorded.';
    } else {
      const lie = lieAt(g.world, this.ball.x, this.ball.y);
      this.club = lie.kind === 'green' ? 'putter' : Math.hypot(h.cup.x - this.ball.x, h.cup.y - this.ball.y) < 8 ? 'wedge' : 'iron';
      this.aim = center(h.cup);
      if (!f.shot.penalty) this.message = `${Math.round(Math.hypot(h.cup.x + .5 - this.ball.x, h.cup.y + .5 - this.ball.y) * 10)} yards to the pin. ${lie.kind}.`;
    }
  }
}
