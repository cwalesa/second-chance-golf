import { CFG } from './config';
import { Rng } from './rng';
import { World, Hole, createStartingWorld, computeZones, holeCondition, validateHole, Validation } from './terrain';
import { CourseSim, GuestComment, RoundResult } from './sim';
import { DayLedger, DaySummary, arrivalsPerDay, emptyLedger, fairFee, farewellFor, maintenancePerHour, operatingProfit, netChange, pickGolferType, reputationOf, scoreRound, shopSpend, RoundScore } from './economy';
import { EditPlan, ToolId, applyPlan, touchedHoles } from './editing';

export interface LogEntry {
  day: number;
  hour: string;
  label: string;
  amount: number;
}
export interface RoundRecord extends RoundScore {
  rough: number;
  water: number;
  wait: number;
  cond: number;
  fee: number;
  fair: number;
  name: string;
}
export interface GoalState {
  id: string;
  done: boolean;
}
export interface Notice {
  kind: 'info' | 'good' | 'bad';
  text: string;
}
interface UndoEntry {
  plan: EditPlan;
  cost: number;
}
export interface Settings {
  speed: number;
  brush: number;
  tool: ToolId;
  introSeen: boolean;
}

export class Game {
  world: World;
  rng: Rng;
  sim: CourseSim;
  cash = CFG.economy.startCash;
  day = 1;
  clock = 0;
  total = 0;
  fee = CFG.economy.fee.default;
  upgrades = { proShop: false, crew: false };
  goals: GoalState[] = CFG.goals.map((g) => ({ id: g.id, done: false }));
  today: DayLedger = emptyLedger();
  days: DaySummary[] = [];
  log: LogEntry[] = [];
  recent: RoundRecord[] = [];
  comments: GuestComment[] = [];
  undoStack: UndoEntry[] = [];
  settings: Settings = { speed: 1, brush: 1, tool: 'inspect', introSeen: false };
  selectedHole = 1;
  selectedGolfer = 0;
  lastHour = 0;
  notices: Notice[] = [];
  onNotice: (n: Notice) => void = () => {};
  dirtySave = false;
  private goalTimer = 0;

  constructor(world?: World, seed = 20250601) {
    this.world = world ?? createStartingWorld();
    this.rng = new Rng(seed);
    this.sim = new CourseSim(this.world, this.rng, {
      onRound: (r) => this.onRoundComplete(r),
      onComment: (c) => {
        this.comments.push(c);
        if (this.comments.length > 40) this.comments.shift();
      },
    });
    this.sim.crewWear = 1;
  }

  // ---- derived ----
  get openHoles(): Hole[] {
    return this.world.holes.filter((h) => h.open);
  }
  get avgCondition(): number {
    const open = this.openHoles;
    const list = open.length ? open : this.world.holes;
    return list.reduce((s, h) => s + holeCondition(this.world, h).overall, 0) / list.length;
  }
  get fair(): number {
    return fairFee(this.avgCondition, this.openHoles.length);
  }
  get reputation(): number {
    return reputationOf(this.recent.map((r) => r.total));
  }
  get arrivalRate(): number {
    return arrivalsPerDay(this.openHoles.length, this.reputation, this.fee, this.fair);
  }
  get hourLen(): number {
    return CFG.day.seconds / CFG.day.hours;
  }
  get clockText(): string {
    const mins = Math.floor((this.clock / CFG.day.seconds) * CFG.day.hours * 60);
    const h = CFG.day.startHour + Math.floor(mins / 60);
    const m = mins % 60;
    const hh = ((h + 11) % 12) + 1;
    return `${hh}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }
  get maintenanceRate(): number {
    const open = this.openHoles.length;
    return maintenancePerHour(open, this.world.holes.length - open, this.upgrades.crew);
  }
  hole(id: number): Hole {
    return this.world.holes.find((h) => h.id === id)!;
  }
  goalDone(id: string) {
    return this.goals.find((g) => g.id === id)?.done ?? false;
  }

  notify(kind: Notice['kind'], text: string) {
    const n = { kind, text };
    this.notices.push(n);
    this.onNotice(n);
  }

  // ---- ledger ----
  private logEntry(label: string, amount: number) {
    this.log.push({ day: this.day, hour: this.clockText, label, amount });
    if (this.log.length > 80) this.log.shift();
  }
  earn(cat: 'fees' | 'shop' | 'bonus', amount: number, label: string) {
    this.cash += amount;
    this.today[cat] += amount;
    this.logEntry(label, amount);
    this.dirtySave = true;
  }
  spend(cat: 'maintenance' | 'construction', amount: number, label: string) {
    this.cash -= amount;
    this.today[cat] += amount;
    this.logEntry(label, -amount);
    this.dirtySave = true;
  }

  // ---- simulation ----
  step(dt: number) {
    this.total += dt;
    this.clock += dt;
    const hourIdx = Math.floor(this.clock / this.hourLen);
    while (this.lastHour < Math.min(hourIdx, CFG.day.hours)) {
      this.lastHour++;
      this.hourly();
    }
    this.maybeArrive(dt);
    this.sim.update(dt);
    this.goalTimer += dt;
    if (this.goalTimer >= 0.5) {
      this.goalTimer = 0;
      this.checkGoals();
    }
    if (this.clock >= CFG.day.seconds) this.endDay();
  }

  private hourly() {
    this.spend('maintenance', this.maintenanceRate, 'Hourly maintenance');
    if (this.upgrades.crew) {
      const w = this.world;
      const u = CFG.upgrades.crew;
      for (let i = 0; i < w.terrain.length; i++) {
        const t = w.terrain[i];
        if ((t === 1 || t === 2 || t === 3) && w.cond[i] < u.restoreCeil) {
          w.cond[i] = Math.min(u.restoreCeil, w.cond[i] + u.restorePerHour);
          w.dirty.add(i);
        }
      }
      w.version++;
    }
  }

  private maybeArrive(dt: number) {
    if (this.clock / CFG.day.seconds > CFG.day.lastArrivalFrac) return;
    const open = this.openHoles.length;
    if (!open) return;
    // the very first guests of a new game show up right away so there is something to watch
    if (this.day === 1 && this.today.arrivals < 2 && this.clock > 1 + this.today.arrivals * 7) {
      this.arrive();
      return;
    }
    const lambda = this.arrivalRate / (CFG.day.seconds * CFG.day.lastArrivalFrac);
    if (this.rng.next() < 1 - Math.exp(-lambda * dt)) this.arrive();
  }

  private arrive() {
    if (this.sim.golfers.length >= 16) return; // course is full, they drive on by
    const g = this.sim.spawn(pickGolferType(this.rng), this.fee);
    if (g) {
      this.today.arrivals++;
      this.earn('fees', this.fee, `Green fee, ${g.name}`);
    }
  }

  private onRoundComplete(r: RoundResult): string {
    const sc = scoreRound(r, r.fee, this.fair);
    const spend = shopSpend(this.rng, sc.total, this.upgrades.proShop);
    this.earn('shop', spend, `Clubhouse sales, ${r.name}`);
    this.today.rounds++;
    this.today.satSum += sc.total;
    this.recent.push({ ...sc, rough: r.stats.shots ? r.stats.rough / r.stats.shots : 0, water: r.stats.water, wait: r.stats.wait, fee: r.fee, fair: this.fair, name: r.name });
    if (this.recent.length > CFG.satisfaction.window) this.recent.shift();
    return farewellFor(sc);
  }

  private endDay() {
    const t = this.today;
    const sum: DaySummary = { ...t, day: this.day, profit: operatingProfit(t), net: netChange(t), avgSat: t.rounds ? t.satSum / t.rounds : 0 };
    this.days.push(sum);
    if (this.days.length > CFG.day.historyKeep) this.days.shift();
    const happy = sum.profit > 0 && t.rounds >= CFG.satisfaction.goalMinRounds && sum.avgSat >= CFG.satisfaction.goal;
    this.notify(sum.profit >= 0 ? 'good' : 'bad', `Day ${this.day} closed. Operating profit ${fmtMoney(sum.profit)}${t.rounds ? `, guest satisfaction ${Math.round(sum.avgSat)}` : ''}.`);
    if (happy) this.completeGoal('day');
    this.day++;
    this.clock = 0;
    this.lastHour = 0;
    this.today = emptyLedger();
    this.dirtySave = true;
  }

  completeGoal(id: string) {
    const g = this.goals.find((x) => x.id === id);
    const def = CFG.goals.find((x) => x.id === id);
    if (!g || g.done || !def) return;
    g.done = true;
    this.earn('bonus', def.reward, `Goal bonus: ${def.title}`);
    this.notify('good', `Goal complete: ${def.title} (+${fmtMoney(def.reward)})`);
  }

  checkGoals() {
    if (!this.goalDone('green') && holeCondition(this.world, this.hole(2)).green >= 75) this.completeGoal('green');
    if (!this.goalDone('reopen') && this.hole(3).open) this.completeGoal('reopen');
  }

  // ---- player actions ----
  setFee(v: number) {
    this.fee = Math.max(CFG.economy.fee.min, Math.min(CFG.economy.fee.max, Math.round(v)));
    this.dirtySave = true;
  }
  setSpeed(s: number) {
    this.settings.speed = s;
    this.dirtySave = true;
  }

  validate(id: number): Validation {
    return validateHole(this.world, this.hole(id));
  }

  openHole(id: number): Validation {
    const h = this.hole(id);
    const v = validateHole(this.world, h);
    if (!v.ok) {
      this.notify('bad', `Hole ${id} cannot open: ${v.problems[0]}`);
      return v;
    }
    if (!h.open) {
      h.open = true;
      h.reopenedAt = this.total;
      this.world.version++;
      this.notify('good', `Hole ${id}, ${h.name}, is open for play.`);
      this.checkGoals();
      this.dirtySave = true;
    }
    return v;
  }

  closeHole(id: number, quiet = false) {
    const h = this.hole(id);
    if (!h.open) return;
    h.open = false;
    this.sim.closeHole(id);
    this.world.version++;
    if (!quiet) this.notify('info', `Hole ${id} is closed. Golfers on it have been sent on to the next hole.`);
    this.dirtySave = true;
  }

  buyUpgrade(id: 'proShop' | 'crew'): boolean {
    const u = CFG.upgrades[id];
    if (this.upgrades[id]) return false;
    if (this.cash < u.cost) {
      this.notify('bad', `Not enough cash for ${u.name}. You need ${fmtMoney(u.cost - this.cash)} more.`);
      return false;
    }
    this.cash -= u.cost;
    this.today.construction += u.cost;
    this.logEntry(`Upgrade: ${u.name}`, -u.cost);
    this.upgrades[id] = true;
    if (id === 'crew') this.sim.crewWear = CFG.upgrades.crew.wearMultiplier;
    this.notify('good', `${u.name} purchased.`);
    this.dirtySave = true;
    return true;
  }

  /** Apply a planned edit. Charges exactly once, closes any open hole it touches, records undo. */
  commitEdit(plan: EditPlan): { ok: boolean; message: string } {
    if (!plan.tiles.length && !plan.hole) return { ok: false, message: 'Nothing would change.' };
    if (plan.cost > this.cash) {
      const m = `You need ${fmtMoney(plan.cost - this.cash)} more for that (cost ${fmtMoney(plan.cost)}, cash ${fmtMoney(this.cash)}).`;
      this.notify('bad', m);
      return { ok: false, message: m };
    }
    const touched = touchedHoles(this.world, plan);
    const before = new Map(touched.map((id) => [id, holeCondition(this.world, this.hole(id)).green]));
    applyPlan(this.world, plan, 'do');
    this.spend('construction', plan.cost, plan.label);
    this.undoStack.push({ plan, cost: plan.cost });
    if (this.undoStack.length > 20) this.undoStack.shift();
    this.afterTerrainChange(touched, before);
    return { ok: true, message: `${plan.label}: ${plan.tiles.length} tiles, ${fmtMoney(plan.cost)}` };
  }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    const touched = touchedHoles(this.world, e.plan);
    applyPlan(this.world, e.plan, 'undo');
    this.cash += e.cost;
    this.today.construction -= e.cost;
    this.logEntry(`Undo: ${e.plan.label}`, e.cost);
    this.afterTerrainChange(touched, null);
    for (const id of touched) {
      const h = this.hole(id);
      if (holeCondition(this.world, h).green < 50) h.fixedGreenAt = -1;
    }
    this.notify('info', `Undid ${e.plan.label}. ${fmtMoney(e.cost)} refunded.`);
    return true;
  }

  private afterTerrainChange(touched: number[], greenBefore: Map<number, number> | null) {
    computeZones(this.world);
    for (const id of touched) {
      const h = this.hole(id);
      if (h.open) {
        this.closeHole(id, true);
        this.notify('info', `Hole ${id} closed for work. Fix it up, then open it again from the hole panel.`);
      }
      if (greenBefore) {
        const now = holeCondition(this.world, h).green;
        if ((greenBefore.get(id) ?? 100) < 50 && now >= 70) h.fixedGreenAt = this.total;
      }
    }
    this.checkGoals();
    this.dirtySave = true;
  }

  get canUndo(): EditPlan | null {
    return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].plan : null;
  }
}

export const fmtMoney = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
