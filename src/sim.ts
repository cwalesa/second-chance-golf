import { CFG, GolferType } from './config';
import { Rng } from './rng';
import { Hole, Pt, SPAWN, DOOR, ENTRY, T, World, center, findPath, idx, inBounds } from './terrain';
import { ExecutedShot, ShotPlan, executeShot, isValidLie, lieAt, nearestValid, planShot, puttLeave, puttProbability } from './physics';

export type Phase = 'arrive' | 'toTee' | 'queue' | 'toBall' | 'address' | 'swing' | 'flight' | 'holed' | 'toExit' | 'leave';

export interface Flight {
  from: Pt;
  air: Pt;
  end: Pt;
  t: number;
  tAir: number;
  tRoll: number;
  apex: number;
  putt: boolean;
  holed: boolean;
  shot: ExecutedShot | null;
  penalty: number;
}

export interface Fx {
  kind: 'splash' | 'sand' | 'divot' | 'cup' | 'leaf';
  x: number;
  y: number;
  t0: number;
}

export interface RoundStats {
  shots: number;
  rough: number;
  bunker: number;
  water: number;
  tree: number;
  condSum: number;
  condN: number;
  wait: number;
  picked: number;
  closedOnMe: number;
}
export interface HoleTrack {
  strokes: number;
  shots: number;
  rough: number;
  carryWarned: boolean;
  saidRough: boolean;
  saidGreen: boolean;
  start: number;
  fwyHit: boolean | null;
  onGreenAt: number | null;
}

export interface Golfer {
  id: number;
  name: string;
  type: GolferType;
  returning: boolean;
  speed: number;
  x: number;
  y: number;
  dir: number;
  walkT: number;
  phase: Phase;
  phaseTime: number;
  timer: number;
  route: number[];
  holeId: number;
  ball: Pt;
  ballZ: number;
  ballVisible: boolean;
  plan: ShotPlan | null;
  flight: Flight | null;
  swingT: number;
  trail: Pt[];
  bubble: { text: string; t: number } | null;
  lastSay: number;
  stats: RoundStats;
  hs: HoleTrack;
  holesDone: number;
  parDone: number;
  strokesDone: number;
  fee: number;
  age: number;
  said: Set<string>;
  scoreFlash: { text: string; t: number } | null;
  path: Pt[] | null;
  pathGoal: Pt | null;
  // previous-step and render-interpolated positions (render only)
  px: number;
  py: number;
  pbx: number;
  pby: number;
  pbz: number;
  rx: number;
  ry: number;
  rbx: number;
  rby: number;
  rbz: number;
  event: boolean;
  fairFee: number | null;
}

export interface RoundResult {
  golferId: number;
  name: string;
  type: GolferType;
  holes: number;
  strokes: number;
  par: number;
  fee: number;
  stats: RoundStats;
  event: boolean;
  fairFee: number | null;
}
export interface GuestComment {
  t: number;
  name: string;
  type: GolferType;
  text: string;
  hole: number;
}
export interface SimHooks {
  onRound(r: RoundResult): string | void;
  onComment(c: GuestComment): void;
  onAce?(g: Golfer): void;
}

const FIRST = ['Avery', 'Bo', 'Casey', 'Dana', 'Eli', 'Farah', 'Gus', 'Hana', 'Ivo', 'June', 'Kai', 'Lena', 'Milo', 'Nora', 'Omar', 'Pia', 'Quinn', 'Ravi', 'Sam', 'Tess', 'Uma', 'Vic', 'Wren', 'Xavi', 'Yara', 'Zed', 'Marta', 'Doug', 'Ines', 'Walt', 'Greta', 'Hugo'];
const LAST = 'ABCDEFGHJKLMNPRSTW';

export function scoreName(diff: number, strokes: number): string {
  if (strokes === 1) return 'Hole in one!';
  if (diff <= -3) return 'Albatross';
  if (diff === -2) return 'Eagle';
  if (diff === -1) return 'Birdie';
  if (diff === 0) return 'Par';
  if (diff === 1) return 'Bogey';
  if (diff === 2) return 'Double';
  return `+${diff}`;
}

const PLAYING: Phase[] = ['toBall', 'address', 'swing', 'flight', 'holed'];
const isPlaying = (g: Golfer) => PLAYING.includes(g.phase);
const newStats = (): RoundStats => ({ shots: 0, rough: 0, bunker: 0, water: 0, tree: 0, condSum: 0, condN: 0, wait: 0, picked: 0, closedOnMe: 0 });
const newTrack = (now: number): HoleTrack => ({ strokes: 0, shots: 0, rough: 0, carryWarned: false, saidRough: false, saidGreen: false, start: now, fwyHit: null, onGreenAt: null });

export class CourseSim {
  golfers: Golfer[] = [];
  fx: Fx[] = [];
  nextId = 1;
  now = 0;
  queues = new Map<number, number[]>();
  tee = new Map<number, { last: number; occupant: number }>();
  wearMult = 1;
  private wearDirty = false;
  private lastWearBump = 0;

  constructor(public world: World, public rng: Rng, public hooks: SimHooks) {}

  private addFx(kind: Fx['kind'], x: number, y: number) {
    this.fx.push({ kind, x, y, t0: this.now });
    if (this.fx.length > 80) this.fx.shift();
  }

  hole(id: number): Hole | undefined {
    return this.world.holes.find((h) => h.id === id);
  }
  queueFor(id: number): number[] {
    let q = this.queues.get(id);
    if (!q) this.queues.set(id, (q = []));
    return q;
  }
  teeFor(id: number) {
    let t = this.tee.get(id);
    if (!t) this.tee.set(id, (t = { last: -999, occupant: 0 }));
    return t;
  }
  waitingAt(id: number): Golfer[] {
    return this.queueFor(id).map((gid) => this.golfers.find((g) => g.id === gid)!).filter(Boolean);
  }
  onHole(id: number): number {
    return this.golfers.filter((g) => g.holeId === id && isPlaying(g)).length;
  }
  /** Position where a golfer stands to wait in line at a hole's tee. */
  queueSlot(h: Hole, i: number): Pt {
    const tee = center(h.tee);
    const bend = center(h.bend);
    let bx = tee.x - bend.x;
    let by = tee.y - bend.y;
    const l = Math.hypot(bx, by) || 1;
    bx /= l;
    by /= l;
    const px = -by;
    const py = bx;
    const side = i % 2 === 0 ? 0.5 : -0.5;
    return { x: tee.x + bx * (2.4 + i * 0.9) + px * side, y: tee.y + by * (2.4 + i * 0.9) + py * side };
  }

  spawn(type: GolferType, fee: number, opts: { event?: boolean; fair?: number } = {}): Golfer | null {
    const open = this.world.holes.filter((h) => h.open);
    if (!open.length) return null;
    // start on the least busy open hole, then play the rest in order
    let startIdx = 0;
    let bestLoad = Infinity;
    open.forEach((h, i) => {
      const load = this.queueFor(h.id).length + this.onHole(h.id) * 0.8;
      if (load < bestLoad) {
        bestLoad = load;
        startIdx = i;
      }
    });
    const route = open.map((_, i) => open[(startIdx + i) % open.length].id);
    const g: Golfer = {
      id: this.nextId++,
      name: `${this.rng.pick(FIRST)} ${this.rng.pick(LAST.split(''))}.`,
      type,
      returning: this.rng.next() < 0.4,
      speed: this.rng.range(0.9, 1.12),
      x: SPAWN.x,
      y: SPAWN.y,
      dir: 1,
      walkT: this.rng.next() * 6,
      phase: 'arrive',
      phaseTime: 0,
      timer: 0,
      route,
      holeId: 0,
      ball: { x: 0, y: 0 },
      ballZ: 0,
      ballVisible: false,
      plan: null,
      flight: null,
      swingT: 0,
      trail: [],
      bubble: null,
      lastSay: -99,
      stats: newStats(),
      hs: newTrack(this.now),
      holesDone: 0,
      parDone: 0,
      strokesDone: 0,
      fee,
      age: 0,
      said: new Set(),
      scoreFlash: null,
      path: null,
      pathGoal: null,
      px: SPAWN.x,
      py: SPAWN.y,
      pbx: 0,
      pby: 0,
      pbz: 0,
      rx: SPAWN.x,
      ry: SPAWN.y,
      rbx: 0,
      rby: 0,
      rbz: 0,
      event: !!opts.event,
      fairFee: opts.fair ?? null,
    };
    this.golfers.push(g);
    return g;
  }

  private setPhase(g: Golfer, p: Phase) {
    g.phase = p;
    g.phaseTime = 0;
    g.path = null;
    g.pathGoal = null;
  }

  say(g: Golfer, text: string, force = false) {
    if (!force && this.now - g.lastSay < 3.5) return;
    g.lastSay = this.now;
    g.bubble = { text, t: 3.6 };
    this.hooks.onComment({ t: this.now, name: g.name, type: g.type, text, hole: g.holeId });
  }
  private sayOnce(g: Golfer, key: string, text: string) {
    if (g.said.has(key)) return;
    g.said.add(key);
    this.say(g, text);
  }

  private walk(g: Golfer, tx: number, ty: number, dt: number): boolean {
    const direct = Math.hypot(tx - g.x, ty - g.y);
    let gx = tx;
    let gy = ty;
    if (direct > 2.5) {
      if (!g.pathGoal || Math.hypot(g.pathGoal.x - tx, g.pathGoal.y - ty) > 1.2) {
        g.path = findPath(this.world, { x: g.x, y: g.y }, { x: tx, y: ty });
        g.pathGoal = { x: tx, y: ty };
      }
      while (g.path && g.path.length > 1 && Math.hypot(g.path[0].x - g.x, g.path[0].y - g.y) < 0.35) g.path.shift();
      if (g.path && g.path.length) {
        gx = g.path[0].x;
        gy = g.path[0].y;
      }
    } else g.path = null;
    const dx = gx - g.x;
    const dy = gy - g.y;
    const d = Math.hypot(dx, dy);
    const step = CFG.golfers.walkSpeed * g.speed * dt;
    if (d <= step || d < 0.05) {
      g.x = gx;
      g.y = gy;
      if (g.path && g.path.length > 1) {
        g.path.shift();
        return false;
      }
      return gx === tx && gy === ty;
    }
    g.x += (dx / d) * step;
    g.y += (dy / d) * step;
    if (Math.abs(dx) > 0.01) g.dir = dx > 0 ? 1 : -1;
    g.walkT += dt * 9;
    return false;
  }

  /** Move on to the next open hole in the golfer's route, or head for the exit. */
  private startNextHole(g: Golfer) {
    g.flight = null;
    g.plan = null;
    g.ballVisible = false;
    while (g.route.length) {
      const h = this.hole(g.route[0]);
      if (h && h.open) {
        g.holeId = h.id;
        g.hs = newTrack(this.now);
        g.timer = 0;
        this.setPhase(g, 'toTee');
        g.said.delete('slowTee');
        return;
      }
      g.route.shift();
    }
    g.holeId = 0;
    this.setPhase(g, 'toExit');
  }

  private completeHole(g: Golfer, h: Hole, strokes: number, picked: boolean) {
    const diff = strokes - h.par;
    g.holesDone++;
    g.parDone += h.par;
    g.strokesDone += strokes;
    h.stats.rounds++;
    if (!picked) {
      h.stats.girN++;
      if (g.hs.onGreenAt !== null && g.hs.onGreenAt <= h.par - 2) h.stats.gir++;
      if (h.par > 3 && g.hs.fwyHit !== null) {
        h.stats.fwyN++;
        if (g.hs.fwyHit) h.stats.fwy++;
      }
    }
    h.stats.strokes += strokes;
    h.stats.par += h.par;
    if (picked) {
      h.stats.picked++;
      g.stats.picked++;
    }
    if (g.hs.shots >= 4 && g.hs.rough / g.hs.shots >= 0.5 && !g.hs.saidRough) {
      g.hs.saidRough = true;
      this.say(g, 'Spent half the hole in the rough.', true);
    } else if (!picked && diff <= -1) this.say(g, diff <= -2 ? 'Eagle! Put that on the wall.' : 'Birdie! Thank you.');
    else if (!picked && diff >= 3) this.say(g, 'That hole got away from me.');
    g.scoreFlash = { text: picked ? 'Picked up' : scoreName(diff, strokes), t: 2.2 };
    g.route.shift();
    this.startNextHole(g);
  }

  private abandon(g: Golfer, h: Hole | undefined, why: 'closed' | 'cap') {
    const t = this.tee.get(g.holeId);
    if (t && t.occupant === g.id) t.occupant = 0;
    const q = this.queues.get(g.holeId);
    if (q) {
      const i = q.indexOf(g.id);
      if (i >= 0) q.splice(i, 1);
    }
    if (why === 'cap' && h) {
      this.say(g, 'Picking up. That is enough for me.', true);
      this.completeHole(g, h, h.par + CFG.holes.maxStrokesOverPar, true);
      return;
    }
    if (isPlaying(g) || g.phase === 'queue' || g.phase === 'toTee') {
      g.stats.closedOnMe++;
      this.say(g, 'They closed my hole. Moving on.', true);
    }
    g.route.shift();
    this.startNextHole(g);
  }

  closeHole(id: number) {
    const q = this.queues.get(id);
    if (q) q.length = 0;
    const t = this.tee.get(id);
    if (t) t.occupant = 0;
    for (const g of this.golfers) if (g.holeId === id && g.phase !== 'leave' && g.phase !== 'toExit') this.abandon(g, this.hole(id), 'closed');
    for (const g of this.golfers) g.route = g.route.filter((r) => r !== id || g.holeId === id);
  }

  private manageTees() {
    for (const h of this.world.holes) {
      if (!h.open) continue;
      const q = this.queueFor(h.id);
      const t = this.teeFor(h.id);
      if (t.occupant) {
        const o = this.golfers.find((g) => g.id === t.occupant);
        if (!o || o.holeId !== h.id || !isPlaying(o)) t.occupant = 0;
      }
      if (!q.length || t.occupant) continue;
      if (this.now - t.last < CFG.holes.teeInterval || this.onHole(h.id) >= CFG.holes.maxOnHole) continue;
      const g = this.golfers.find((x) => x.id === q[0]);
      q.shift();
      if (!g) continue;
      t.occupant = g.id;
      t.last = this.now;
      const c = center(h.tee);
      g.ball = { x: c.x + this.rng.range(-0.8, 0.8), y: c.y + this.rng.range(-0.8, 0.8) };
      g.ballVisible = true;
      g.stats.wait += g.phaseTime;
      if (g.phaseTime > 28) this.sayOnce(g, 'slowTee', 'Backed up at the tee again.');
      else if (g.returning && h.reopenedAt >= 0 && this.now - h.reopenedAt < 900) this.sayOnce(g, 'reopen' + h.id, 'Good to see this hole open again.');
      this.setPhase(g, 'toBall');
    }
  }

  private wearAt(x: number, y: number, amount: number) {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!inBounds(this.world, tx, ty)) return;
    const i = idx(this.world, tx, ty);
    const t = this.world.terrain[i];
    if (t !== T.FAIRWAY && t !== T.TEE && t !== T.GREEN) return;
    this.world.cond[i] = Math.max(CFG.turf.floor, this.world.cond[i] - amount * this.wearMult);
    this.world.dirty.add(i);
    this.wearDirty = true;
  }

  private launch(g: Golfer, h: Hole) {
    const world = this.world;
    const lie = lieAt(world, g.ball.x, g.ball.y);
    const cup = center(h.cup);
    const toCup = Math.hypot(cup.x - g.ball.x, cup.y - g.ball.y);
    g.stats.shots++;
    g.hs.shots++;
    if (lie.kind === 'rough') {
      g.stats.rough++;
      g.hs.rough++;
    } else if (lie.kind === 'bunker') {
      g.stats.bunker++;
      g.hs.rough++;
    }
    if (lie.kind !== 'bunker') {
      g.stats.condSum += lie.cond * (lie.kind === 'green' ? 1.5 : 1);
      g.stats.condN += lie.kind === 'green' ? 1.5 : 1;
    }
    if (lie.kind === 'green' && toCup < 6) {
      const feet = toCup * CFG.grid.feetPerTile;
      const holed = this.rng.next() < puttProbability(feet, g.type, lie.cond);
      let end = cup;
      if (!holed) {
        const left = puttLeave(this.rng, feet) / CFG.grid.feetPerTile;
        const a = this.rng.range(0, Math.PI * 2);
        end = { x: cup.x + Math.cos(a) * left, y: cup.y + Math.sin(a) * left };
        if (!isValidLie(world, end.x, end.y)) end = nearestValid(world, end.x, end.y);
      }
      g.flight = { from: { ...g.ball }, air: { ...g.ball }, end, t: 0, tAir: 0, tRoll: 0.4 + feet / 35, apex: 0, putt: true, holed, shot: null, penalty: 0 };
      this.wearAt(g.ball.x, g.ball.y, CFG.wear.putt);
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) if (Math.hypot(dx, dy) <= CFG.wear.cupRadius) this.wearAt(cup.x + dx, cup.y + dy, CFG.wear.putt * 0.6);
      if (!g.hs.saidGreen) {
        g.hs.saidGreen = true;
        if (g.returning && h.fixedGreenAt >= 0 && this.now - h.fixedGreenAt < 900 && lie.cond >= 60) this.say(g, 'Much better since you fixed the green.');
        else if (lie.cond < CFG.turf.wornBelow) this.say(g, 'These greens are bumpy. Hard to read.');
      }
      return;
    }
    const plan = g.plan ?? planShot(world, h, g.type, g.ball);
    const shot = executeShot(world, this.rng, g.type, g.ball, plan);
    this.addFx(lie.kind === 'bunker' ? 'sand' : 'divot', g.ball.x, g.ball.y);
    this.wearAt(g.ball.x, g.ball.y, lie.kind === 'tee' ? CFG.wear.teeShot : CFG.wear.fairwayShot);
    if (lie.kind !== 'tee' && lie.kind !== 'bunker' && lie.cond < 35) this.sayOnce(g, 'dirt', 'Playing off bare dirt out here.');
    const dist = Math.hypot(shot.air.x - g.ball.x, shot.air.y - g.ball.y);
    g.flight = {
      from: { ...g.ball },
      air: shot.air,
      end: shot.end,
      t: 0,
      tAir: shot.kind === 'tree' ? 0.35 : 0.45 + dist * 0.055,
      tRoll: 0.15 + Math.hypot(shot.end.x - shot.air.x, shot.end.y - shot.air.y) * 0.25,
      apex: shot.kind === 'tree' ? 0.5 : Math.min(4, 0.18 * dist),
      putt: false,
      holed: false,
      shot,
      penalty: shot.penalty,
    };
  }

  private land(g: Golfer, h: Hole) {
    const f = g.flight!;
    g.flight = null;
    g.ball = { ...f.end };
    g.ballZ = 0;
    g.trail = [];
    const t = this.teeFor(h.id);
    if (t.occupant === g.id) t.occupant = 0;
    g.hs.strokes += 1 + f.penalty;
    const sh = f.shot;
    if (!f.putt) {
      const kind = lieAt(this.world, f.end.x, f.end.y).kind;
      if (g.hs.shots === 1 && g.hs.fwyHit === null) g.hs.fwyHit = kind === 'fairway' || kind === 'green';
      if (kind === 'green' && g.hs.onGreenAt === null && f.penalty === 0) g.hs.onGreenAt = g.hs.strokes;
    }
    if (f.putt) {
      if (f.holed) return this.holeOut(g);
    } else if (sh) {
      const cup = center(h.cup);
      if (sh.kind === 'water') {
        this.addFx('splash', sh.air.x, sh.air.y);
        g.stats.water++;
        h.stats.water++;
        this.say(g, this.rng.pick(['Splash. That is a penalty stroke.', 'Into the water. One-stroke penalty.']));
      } else if (sh.kind === 'oob') this.say(g, 'Out of bounds. Hitting again.');
      else if (sh.kind === 'tree' || sh.kind === 'treeLand') {
        this.addFx('leaf', sh.air.x, sh.air.y);
        g.stats.tree++;
        this.say(g, 'Right into the trees.');
      } else if (sh.mishit) this.say(g, this.rng.pick(['Topped it.', 'Caught that thin.']));
      else if (lieAt(this.world, g.ball.x, g.ball.y).kind === 'bunker') {
        this.addFx('sand', g.ball.x, g.ball.y);
        this.say(g, 'Plugged in the sand again.');
      } else {
        const dc = Math.hypot(cup.x - g.ball.x, cup.y - g.ball.y);
        if (dc < 0.12 && lieAt(this.world, g.ball.x, g.ball.y).kind === 'green') return this.holeOut(g);
        if (dc < 0.45 && g.type !== 'beginner' && lieAt(this.world, g.ball.x, g.ball.y).kind === 'green') this.say(g, 'Nice one. That is close.');
      }
    }
    if (g.hs.strokes >= h.par + CFG.holes.maxStrokesOverPar) return this.abandon(g, h, 'cap');
    this.setPhase(g, 'toBall');
  }

  private holeOut(g: Golfer) {
    const h = this.hole(g.holeId)!;
    this.addFx('cup', h.cup.x + 0.5, h.cup.y + 0.5);
    if (g.hs.strokes === 1) this.hooks.onAce?.(g);
    g.ballVisible = false;
    g.scoreFlash = { text: scoreName(g.hs.strokes - h.par, g.hs.strokes), t: 2.2 };
    g.timer = 1.2;
    this.setPhase(g, 'holed');
  }

  private finishRound(g: Golfer) {
    const farewell = this.hooks.onRound({
      golferId: g.id,
      name: g.name,
      type: g.type,
      holes: g.holesDone,
      strokes: g.strokesDone,
      par: g.parDone,
      fee: g.fee,
      stats: g.stats,
      event: g.event,
      fairFee: g.fairFee,
    });
    if (farewell) this.say(g, farewell, true);
    this.setPhase(g, 'leave');
  }

  update(dt: number) {
    this.now += dt;
    while (this.fx.length && this.now - this.fx[0].t0 > 2.5) this.fx.shift();
    this.manageTees();
    for (const g of this.golfers) {
      g.px = g.x;
      g.py = g.y;
      g.pbx = g.ball.x;
      g.pby = g.ball.y;
      g.pbz = g.ballZ;
      g.age += dt;
      g.phaseTime += dt;
      if (g.bubble && (g.bubble.t -= dt) <= 0) g.bubble = null;
      if (g.scoreFlash && (g.scoreFlash.t -= dt) <= 0) g.scoreFlash = null;
      this.updateGolfer(g, dt);
    }
    // golfers that left
    if (this.golfers.some((g) => g.phase === 'leave' && g.x === SPAWN.x && g.y === SPAWN.y)) this.golfers = this.golfers.filter((g) => !(g.phase === 'leave' && g.x === SPAWN.x && g.y === SPAWN.y));
    if (this.wearDirty && this.now - this.lastWearBump > 1) {
      this.world.version++;
      this.wearDirty = false;
      this.lastWearBump = this.now;
    }
  }

  private updateGolfer(g: Golfer, dt: number) {
    const h = this.hole(g.holeId);
    switch (g.phase) {
      case 'arrive':
        if (g.timer === 0) {
          if (this.walk(g, ENTRY.x, ENTRY.y, dt) || g.phaseTime > 30) g.timer = 1;
        } else if (this.walk(g, DOOR.x, DOOR.y, dt) || g.phaseTime > 60) {
          g.x = DOOR.x;
          g.y = DOOR.y;
          g.timer = 0;
          this.startNextHole(g);
        }
        break;
      case 'toTee': {
        if (!h || !h.open) return this.abandon(g, h, 'closed');
        const q = this.queueFor(h.id);
        const slot = this.queueSlot(h, q.length);
        if (this.walk(g, slot.x, slot.y, dt) || g.phaseTime > 60) {
          q.push(g.id);
          this.setPhase(g, 'queue');
        }
        break;
      }
      case 'queue': {
        if (!h || !h.open) return this.abandon(g, h, 'closed');
        const i = this.queueFor(h.id).indexOf(g.id);
        if (i < 0) return this.abandon(g, h, 'closed');
        const slot = this.queueSlot(h, i);
        this.walk(g, slot.x, slot.y, dt * 0.6);
        if (g.phaseTime > 400) {
          // safety valve: never wait forever
          this.queueFor(h.id).splice(i, 1);
          g.route.shift();
          this.startNextHole(g);
        }
        break;
      }
      case 'toBall': {
        if (!h || !h.open) return this.abandon(g, h, 'closed');
        if (!isValidLie(this.world, g.ball.x, g.ball.y)) g.ball = nearestValid(this.world, g.ball.x, g.ball.y);
        const sx = g.ball.x - 0.45;
        const sy = g.ball.y + 0.15;
        if (this.walk(g, sx, sy, dt) || g.phaseTime > 90) {
          g.x = sx;
          g.y = sy;
          g.timer = 0.35 + this.rng.next() * 0.35;
          this.setPhase(g, 'address');
        }
        break;
      }
      case 'address': {
        if (!h || !h.open) return this.abandon(g, h, 'closed');
        g.timer -= dt;
        if (g.timer > 0) return;
        if (!isValidLie(this.world, g.ball.x, g.ball.y)) g.ball = nearestValid(this.world, g.ball.x, g.ball.y);
        if (this.now - g.hs.start > CFG.holes.holeTimeout) return this.abandon(g, h, 'cap');
        const lie = lieAt(this.world, g.ball.x, g.ball.y);
        const cup = center(h.cup);
        const puttMode = lie.kind === 'green' && Math.hypot(cup.x - g.ball.x, cup.y - g.ball.y) < 6;
        g.plan = puttMode ? null : planShot(this.world, h, g.type, g.ball);
        if (g.plan?.directCarryTooLong && !g.hs.carryWarned) {
          g.hs.carryWarned = true;
          this.say(g, 'That carry is too long for me.', true);
        }
        g.timer = 0.4;
        g.swingT = 0;
        this.setPhase(g, 'swing');
        break;
      }
      case 'swing':
        g.swingT += dt;
        g.timer -= dt;
        if (g.timer <= 0) {
          if (!h || !h.open) return this.abandon(g, h, 'closed');
          this.launch(g, h);
          this.setPhase(g, 'flight');
        }
        break;
      case 'flight': {
        if (!h || !h.open) return this.abandon(g, h, 'closed');
        const f = g.flight;
        if (!f) return this.setPhase(g, 'toBall');
        f.t += dt;
        if (f.t < f.tAir) {
          const u = f.t / f.tAir;
          g.ball = { x: f.from.x + (f.air.x - f.from.x) * u, y: f.from.y + (f.air.y - f.from.y) * u };
          g.ballZ = f.apex * 4 * u * (1 - u);
        } else {
          const u = f.tRoll > 0 ? Math.min(1, (f.t - f.tAir) / f.tRoll) : 1;
          g.ball = { x: f.air.x + (f.end.x - f.air.x) * u, y: f.air.y + (f.end.y - f.air.y) * u };
          g.ballZ = 0;
          if (u >= 1 || f.t > 25) this.land(g, h);
        }
        if (g.flight && !f.putt) {
          g.trail.push({ x: g.ball.x, y: g.ball.y - g.ballZ });
          if (g.trail.length > 60) g.trail.shift();
        }
        break;
      }
      case 'holed':
        g.timer -= dt;
        if (g.timer <= 0 && h) this.completeHole(g, h, g.hs.strokes, false);
        else if (!h) this.startNextHole(g);
        break;
      case 'toExit':
        if (this.walk(g, DOOR.x, DOOR.y, dt) || g.phaseTime > 90) {
          g.timer = 0;
          this.finishRound(g);
        }
        break;
      case 'leave':
        if (g.timer === 0) {
          if (this.walk(g, ENTRY.x, ENTRY.y, dt) || g.phaseTime > 30) g.timer = 1;
        } else if (this.walk(g, SPAWN.x, SPAWN.y, dt) || g.phaseTime > 60) {
          g.x = SPAWN.x;
          g.y = SPAWN.y;
        }
        break;
    }
    if (g.age > 1800 && g.phase !== 'leave') {
      // absolute guard: nobody stays forever
      const q = this.queues.get(g.holeId);
      if (q && q.includes(g.id)) q.splice(q.indexOf(g.id), 1);
      this.setPhase(g, 'leave');
    }
  }
}
