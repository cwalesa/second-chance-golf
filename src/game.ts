import { CFG } from './config';
import { Rng } from './rng';
import { World, Hole, createStartingWorld, computeZones, holeCondition, validateHole, Validation } from './terrain';
import { CourseSim, GuestComment, RoundResult } from './sim';
import { DayLedger, DaySummary, Owned, UpgradeId, amenityBonus, cartRentalRate, noUpgrades, emptyLedger, fairFee, farewellFor, maintenancePerHour, operatingProfit, netChange, pickGolferType, reputationOf, scoreRound, shopSpend, RoundScore } from './economy';
import { ActiveEvent, Booking, EVENTS, EVENT_IDS, EventId, EventResult, eventGuests, eventProblems, pickEventGolfer } from './events';
import { EditPlan, ToolId, applyPlan, setCostMultiplier, touchedHoles } from './editing';
import { setPhysics } from './physics';
import { BANDS, BandId, CLUB_LEVELS, REGIONS, RegionId, SEASON_NAMES, bandAt, ratingStars, seasonIndex, yearOf } from './progression';
import { GoalCtx, MILESTONES } from './goals';
import { Logo, defaultLogo } from './logo';
import { baseDemand, priceFactor, reputationFactor } from './economy';

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
export interface LifetimeStats {
  rounds: number;
  revenue: number;
  events: number;
  aces: number;
  bestDayProfit: number;
  bestDaySat: number;
  years: number;
}
export interface NewGameOptions {
  region?: RegionId;
  name?: string;
  logo?: Logo;
}

export class Game {
  world: World;
  rng: Rng;
  sim: CourseSim;
  cash = CFG.economy.startCash;
  day = 1;
  clock = 0;
  total = 0;
  region: RegionId = 'parkland';
  name = 'Second Chance Golf';
  logo: Logo = defaultLogo();
  fees: Record<BandId, number> = { early: 34, mid: 30, twilight: 20 };
  clubLevel = 0;
  stats: LifetimeStats = { rounds: 0, revenue: 0, events: 0, aces: 0, bestDayProfit: 0, bestDaySat: 0, years: 1 };
  lastAway: { days: number; net: number } | null = null;
  upgrades: Owned = noUpgrades();
  cartFee = CFG.extras.cartFeeDefault;
  goals: GoalState[] = [...CFG.goals, ...MILESTONES].map((g) => ({ id: g.id, done: false }));
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
  bookings: Booking[] = [];
  eventFees = Object.fromEntries(EVENT_IDS.map((id) => [id, EVENTS[id].fair])) as Record<EventId, number>;
  activeEvent: ActiveEvent | null = null;
  lastEvent: EventResult | null = null;
  private goalTimer = 0;

  constructor(world?: World, seed = 20250601, opts: NewGameOptions = {}) {
    this.world = world ?? createStartingWorld(opts.region ?? 'parkland');
    this.region = this.world.region;
    if (opts.name) this.name = opts.name.trim().slice(0, 28) || this.name;
    if (opts.logo) this.logo = opts.logo;
    this.rng = new Rng(seed);
    this.sim = new CourseSim(this.world, this.rng, {
      onRound: (r) => this.onRoundComplete(r),
      onComment: (c) => {
        this.comments.push(c);
        if (this.comments.length > 40) this.comments.shift();
      },
      onAce: () => {
        this.stats.aces++;
        this.notify('good', 'A guest just made a hole in one!');
      },
    });
    this.applyRegion();
  }

  /** Push regional rules into the physics and building-cost modules. */
  applyRegion() {
    const r = REGIONS[this.region];
    setPhysics(r.wind, r.distance);
    setCostMultiplier(r.buildMult);
    this.updateWear();
  }
  private updateWear() {
    const r = REGIONS[this.region];
    this.sim.wearMult = (this.upgrades.crew ? CFG.upgrades.crew.wearMultiplier : 1) * r.wear * r.seasonWear[seasonIndex(this.day)];
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
  get regionDef() {
    return REGIONS[this.region];
  }
  get club() {
    return CLUB_LEVELS[this.clubLevel];
  }
  get season() {
    const i = seasonIndex(this.day);
    return { index: i, name: SEASON_NAMES[i], demand: this.regionDef.seasonDemand[i], wear: this.regionDef.seasonWear[i] };
  }
  get stars(): number {
    return ratingStars({ openHoles: this.openHoles.length, avgCond: this.avgCondition, rep: this.reputation, amenities: Object.values(this.upgrades).filter(Boolean).length, clubLevel: this.clubLevel });
  }
  get fair(): number {
    return fairFee(this.avgCondition, this.openHoles.length) * this.regionDef.fairMult * (1 + 0.04 * this.stars) + this.club.fair;
  }
  get band() {
    return bandAt(this.clock / CFG.day.seconds);
  }
  /** Fee for the tee-time band that is running right now. */
  get fee(): number {
    return this.fees[this.band.id];
  }
  get parcelsOwned(): number {
    return this.world.parcels.reduce((a, b) => a + b, 0);
  }
  get maxHoles(): number {
    return this.club.holes;
  }
  get parcelPrice(): number {
    return Math.round((CFG.land.base * this.regionDef.landMult * Math.pow(CFG.land.growth, Math.max(0, this.parcelsOwned - CFG.land.startCols * CFG.land.startRows))) / 10) * 10;
  }
  /** Demand per day before price: reputation, season, region, clubhouse, rating and range all count. */
  get dailyBase(): number {
    return baseDemand(this.openHoles.length) * reputationFactor(this.reputation) * this.regionDef.demand * this.season.demand * this.club.demand * (1 + 0.06 * this.stars) * (this.upgrades.range ? CFG.extras.rangeDemand : 1);
  }
  bandArrivals(id: BandId): number {
    const b = BANDS.find((x) => x.id === id)!;
    return this.dailyBase * b.share * priceFactor(this.fair * b.fair, this.fees[id]);
  }
  goalCtx(): GoalCtx {
    return { stars: this.stars, clubLevel: this.clubLevel, holeCount: this.world.holes.length, openHoleCount: this.openHoles.length, parcelsOwned: this.parcelsOwned, upgradeCount: Object.values(this.upgrades).filter(Boolean).length, cash: this.cash, stats: this.stats };
  }
  get reputation(): number {
    return reputationOf(this.recent.map((r) => r.total));
  }
  /** Expected arrivals per day at the current prices. */
  get arrivalRate(): number {
    return BANDS.reduce((s, b) => s + this.bandArrivals(b.id), 0);
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
    return maintenancePerHour(open, this.world.holes.length - open, this.upgrades);
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
    if (cat !== 'bonus') this.stats.revenue += amount;
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
    this.updateWear();
    this.maybeArrive(dt);
    this.eventArrivals();
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
    const frac = this.clock / CFG.day.seconds;
    const b = bandAt(frac);
    const window = (Math.min(b.to, CFG.day.lastArrivalFrac) - b.from) * CFG.day.seconds;
    if (window <= 0) return;
    const lambda = this.bandArrivals(b.id) / window;
    if (this.rng.next() < 1 - Math.exp(-lambda * dt)) this.arrive();
  }

  private arrive() {
    const cap = 12 + 3 * this.openHoles.length + (this.activeEvent ? 18 : 0);
    if (this.sim.golfers.length >= cap) return; // course is full, they drive on by
    const band = this.band;
    const fee = this.fees[band.id];
    const g = this.sim.spawn(pickGolferType(this.rng), fee, { fair: this.fair * band.fair });
    if (g) {
      this.today.arrivals++;
      this.earn('fees', fee, `${band.name} tee time, ${g.name}`);
      if (this.upgrades.carts && this.rng.next() < cartRentalRate(this.cartFee)) this.earn('fees', this.cartFee, `Cart rental, ${g.name}`);
    }
  }

  private onRoundComplete(r: RoundResult): string {
    const sc = scoreRound(r, r.fee, r.fairFee ?? this.fair, amenityBonus(this.upgrades) + this.club.sat);
    if (r.event && this.activeEvent) {
      this.activeEvent.rounds++;
      this.activeEvent.satSum += sc.total;
    }
    const spend = shopSpend(this.rng, sc.total, this.upgrades, this.club.shop);
    this.stats.rounds++;
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
    this.stats.bestDayProfit = Math.max(this.stats.bestDayProfit, sum.profit);
    if (t.rounds >= CFG.satisfaction.goalMinRounds) this.stats.bestDaySat = Math.max(this.stats.bestDaySat, sum.avgSat);
    this.finishEvent(sum.day);
    this.day++;
    this.stats.years = yearOf(this.day);
    const s = this.season;
    if (seasonIndex(this.day) !== seasonIndex(this.day - 1)) this.notify('info', `${s.name} begins. ${s.demand >= 1.2 ? 'Expect a busy season.' : s.demand <= 0.6 ? 'Expect quiet tee sheets.' : 'Demand shifts with the season.'}`);
    this.clock = 0;
    this.lastHour = 0;
    this.today = emptyLedger();
    this.startEvent();
    this.dirtySave = true;
  }

  // ---- events ----
  eventProblemsFor(id: EventId): string[] {
    return eventProblems(id, this.openHoles.length, this.reputation, this.avgCondition, this.clubLevel);
  }
  expectedGuests(id: EventId): number {
    return eventGuests(id, this.eventFees[id], this.reputation);
  }
  setEventFee(id: EventId, v: number) {
    this.eventFees[id] = Math.max(5, Math.min(200, Math.round(v)));
    this.dirtySave = true;
  }
  /** Book the next free day. Nothing is charged until the event starts. */
  bookEvent(id: EventId): boolean {
    const p = this.eventProblemsFor(id);
    if (p.length) {
      this.notify('bad', `Cannot book ${EVENTS[id].name}: ${p[0]}`);
      return false;
    }
    let day = this.day + 1;
    while (this.bookings.some((b) => b.day === day)) day++;
    if (day > this.day + 4) {
      this.notify('bad', 'You can only book a few days ahead. Cancel one first.');
      return false;
    }
    this.bookings.push({ id, day, fee: this.eventFees[id] });
    this.bookings.sort((a, b) => a.day - b.day);
    this.notify('good', `${EVENTS[id].name} booked for day ${day}. Setup (${fmtMoney(EVENTS[id].cost)}) is charged when it starts.`);
    this.dirtySave = true;
    return true;
  }
  cancelEvent(day: number) {
    const i = this.bookings.findIndex((b) => b.day === day);
    if (i < 0) return;
    const [b] = this.bookings.splice(i, 1);
    this.notify('info', `${EVENTS[b.id].name} on day ${day} cancelled. Nothing was charged.`);
    this.dirtySave = true;
  }
  private startEvent() {
    const i = this.bookings.findIndex((b) => b.day === this.day);
    if (i < 0) return;
    const [b] = this.bookings.splice(i, 1);
    const d = EVENTS[b.id];
    const problems = this.eventProblemsFor(b.id);
    if (problems.length) {
      this.notify('bad', `${d.name} was cancelled, no charge: ${problems[0]}`);
      return;
    }
    const total = eventGuests(b.id, b.fee, this.reputation);
    this.spend('maintenance', d.cost, `Event setup: ${d.name}`);
    this.activeEvent = { id: b.id, fee: b.fee, total, spawned: 0, nextAt: 0.5, revenue: 0, rounds: 0, satSum: 0 };
    this.notify('good', `${d.name} today: ${total} golfers expected for a shotgun start.`);
  }
  private eventArrivals() {
    const e = this.activeEvent;
    if (!e || e.spawned >= e.total || this.clock < e.nextAt) return;
    const g = this.sim.spawn(pickEventGolfer(e.id, this.rng), e.fee, { event: true, fair: EVENTS[e.id].fair });
    if (g) {
      e.spawned++;
      e.revenue += e.fee;
      this.today.arrivals++;
      this.earn('fees', e.fee, `Event entry, ${g.name}`);
    }
    e.nextAt = this.clock + 35 / Math.max(1, e.total);
  }
  private finishEvent(day: number) {
    const e = this.activeEvent;
    if (!e) return;
    const res: EventResult = { id: e.id, day, guests: e.spawned, revenue: e.revenue, cost: EVENTS[e.id].cost, rounds: e.rounds, avgSat: e.rounds ? e.satSum / e.rounds : 0 };
    this.lastEvent = res;
    this.stats.events++;
    this.activeEvent = null;
    this.notify(res.revenue >= res.cost ? 'good' : 'bad', `${EVENTS[res.id].name}: ${res.guests} golfers, ${fmtMoney(res.revenue)} in entries against ${fmtMoney(res.cost)} setup${res.rounds ? `, satisfaction ${Math.round(res.avgSat)}` : ''}.`);
  }

  completeGoal(id: string) {
    const g = this.goals.find((x) => x.id === id);
    const def = CFG.goals.find((x) => x.id === id) ?? MILESTONES.find((x) => x.id === id);
    if (!g || g.done || !def) return;
    g.done = true;
    this.earn('bonus', def.reward, `Goal bonus: ${def.title}`);
    this.notify('good', `Goal complete: ${def.title} (+${fmtMoney(def.reward)})`);
  }

  checkGoals() {
    const h2 = this.world.holes.find((h) => h.id === 2);
    const h3 = this.world.holes.find((h) => h.id === 3);
    if (!this.goalDone('green') && h2 && holeCondition(this.world, h2).green >= 75) this.completeGoal('green');
    if (!this.goalDone('reopen') && h3?.open) this.completeGoal('reopen');
    const ctx = this.goalCtx();
    for (const m of MILESTONES) {
      if (this.goalDone(m.id)) continue;
      const [cur, target] = m.progress(ctx);
      if (cur >= target) this.completeGoal(m.id);
    }
  }

  // ---- player actions ----
  setBandFee(id: BandId, v: number) {
    this.fees[id] = Math.max(CFG.economy.fee.min, Math.min(CFG.economy.fee.max * 3, Math.round(v)));
    this.dirtySave = true;
  }
  /** Adjusts the tee-time band that is running now. */
  setFee(v: number) {
    this.setBandFee(this.band.id, v);
  }
  setCartFee(v: number) {
    this.cartFee = Math.max(1, Math.min(CFG.extras.cartFeeMax, Math.round(v)));
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

  buyUpgrade(id: UpgradeId): boolean {
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
    this.updateWear();
    this.notify('good', `${u.name} purchased.`);
    this.dirtySave = true;
    return true;
  }

  /** Apply a planned edit. Charges exactly once, closes any open hole it touches, records undo. */
  commitEdit(plan: EditPlan): { ok: boolean; message: string } {
    if (!plan.tiles.length && !plan.hole && !plan.newHole) return { ok: false, message: 'Nothing would change.' };
    if (plan.newHole) {
      const why = this.addHoleProblem();
      if (why) {
        this.notify('bad', why);
        return { ok: false, message: why };
      }
    }
    if (plan.cost > this.cash) {
      const m = `You need ${fmtMoney(plan.cost - this.cash)} more for that (cost ${fmtMoney(plan.cost)}, cash ${fmtMoney(this.cash)}).`;
      this.notify('bad', m);
      return { ok: false, message: m };
    }
    const touched = touchedHoles(this.world, plan);
    const before = new Map(touched.filter((id) => this.world.holes.some((h) => h.id === id)).map((id) => [id, holeCondition(this.world, this.hole(id)).green]));
    applyPlan(this.world, plan, 'do');
    this.spend('construction', plan.cost, plan.label);
    this.undoStack.push({ plan, cost: plan.cost });
    if (this.undoStack.length > 20) this.undoStack.shift();
    this.afterTerrainChange(touched, before);
    if (plan.newHole) {
      this.selectedHole = plan.newHole.id;
      this.notify('good', `${plan.newHole.name} is laid out. Check the fairway, then open it from the Course tab.`);
    }
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
    if (!this.world.holes.some((h) => h.id === this.selectedHole)) this.selectedHole = this.world.holes[0]?.id ?? 1;
    for (const id of touched) {
      const h = this.world.holes.find((x) => x.id === id);
      if (!h) continue;
      if (holeCondition(this.world, h).green < 50) h.fixedGreenAt = -1;
    }
    this.notify('info', `Undid ${e.plan.label}. ${fmtMoney(e.cost)} refunded.`);
    return true;
  }

  private afterTerrainChange(touched: number[], greenBefore: Map<number, number> | null) {
    computeZones(this.world);
    for (const id of touched) {
      const h = this.world.holes.find((x) => x.id === id);
      if (!h) continue;
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

  // ---- expansion ----
  addHoleProblem(): string | null {
    if (this.world.holes.length >= this.maxHoles) return `${this.club.name} allows ${this.maxHoles} holes. Upgrade the clubhouse for more.`;
    return null;
  }
  nextHoleId(): number {
    return Math.max(0, ...this.world.holes.map((h) => h.id)) + 1;
  }
  isParcelOwned(col: number, row: number): boolean {
    return this.world.parcels[row * CFG.land.cols + col] === 1;
  }
  buyParcel(col: number, row: number): boolean {
    if (this.isParcelOwned(col, row)) return false;
    const price = this.parcelPrice;
    if (this.cash < price) {
      this.notify('bad', `Not enough cash for that land. You need ${fmtMoney(price - this.cash)} more.`);
      return false;
    }
    this.cash -= price;
    this.today.construction += price;
    this.logEntry('Bought land parcel', -price);
    this.world.parcels[row * CFG.land.cols + col] = 1;
    this.world.version++;
    this.notify('good', `Land purchased for ${fmtMoney(price)}. You can now build there.`);
    this.checkGoals();
    this.dirtySave = true;
    return true;
  }
  clubUpgradeProblem(): string | null {
    const next = CLUB_LEVELS[this.clubLevel + 1];
    if (!next) return 'The clubhouse is fully upgraded.';
    if (this.stars < next.minStars) return `Needs a ${next.minStars}-star course rating (you have ${this.stars}).`;
    return null;
  }
  upgradeClubhouse(): boolean {
    const next = CLUB_LEVELS[this.clubLevel + 1];
    const why = this.clubUpgradeProblem();
    if (why) {
      this.notify('bad', why);
      return false;
    }
    if (this.cash < next.cost) {
      this.notify('bad', `Not enough cash. You need ${fmtMoney(next.cost - this.cash)} more.`);
      return false;
    }
    this.cash -= next.cost;
    this.today.construction += next.cost;
    this.logEntry(`Clubhouse upgrade: ${next.name}`, -next.cost);
    this.clubLevel++;
    this.notify('good', `${next.name} complete. Demand, spending and satisfaction all rise.`);
    this.checkGoals();
    this.dirtySave = true;
    return true;
  }
  renameHole(id: number, name: string) {
    const h = this.world.holes.find((x) => x.id === id);
    const n = name.trim().slice(0, 24);
    if (h && n) {
      h.name = n;
      this.dirtySave = true;
    }
  }
  /** Remove a hole entirely. Its ground stays as it is. */
  removeHole(id: number): boolean {
    if (this.world.holes.length <= 1) {
      this.notify('bad', 'You need at least one hole.');
      return false;
    }
    this.closeHole(id, true);
    this.world.holes = this.world.holes.filter((h) => h.id !== id);
    computeZones(this.world);
    this.world.version++;
    this.undoStack = this.undoStack.filter((u) => !(u.plan.hole?.id === id || u.plan.newHole?.id === id));
    if (this.selectedHole === id) this.selectedHole = this.world.holes[0].id;
    this.notify('info', `Hole ${id} removed. Its fairway and green are left as they were.`);
    this.dirtySave = true;
    return true;
  }
  setName(name: string) {
    const n = name.trim().slice(0, 28);
    if (n) this.name = n;
    this.dirtySave = true;
  }

  /** Catch up on time spent away: a modest, simplified version of the days that passed. */
  applyAway(seconds: number): { days: number; net: number } | null {
    if (seconds < CFG.offline.minAwaySeconds) return null;
    const days = Math.min(CFG.offline.maxDays, Math.floor(seconds / CFG.offline.realSecondsPerDay));
    if (days < 1) return null;
    let net = 0;
    for (let d = 0; d < days; d++) {
      const arrivals = this.arrivalRate * CFG.offline.efficiency;
      const fees = BANDS.reduce((s, b) => s + this.bandArrivals(b.id) * CFG.offline.efficiency * this.fees[b.id], 0);
      const shop = arrivals * (CFG.economy.shopBase + this.reputation * CFG.economy.shopSatFactor + 1.5 + (this.upgrades.snackBar ? CFG.extras.snackSpend : 0)) * (this.upgrades.proShop ? CFG.economy.proShopMultiplier : 1) * this.club.shop;
      const maint = this.maintenanceRate * CFG.day.hours;
      const profit = Math.round(fees + shop - maint);
      this.cash += profit;
      net += profit;
      this.stats.rounds += Math.round(arrivals);
      this.stats.revenue += Math.round(fees + shop);
      this.stats.bestDayProfit = Math.max(this.stats.bestDayProfit, profit);
      this.day++;
    }
    this.stats.years = yearOf(this.day);
    // bookings for the days that passed are cancelled without charge
    const lost = this.bookings.filter((b) => b.day < this.day);
    this.bookings = this.bookings.filter((b) => b.day >= this.day);
    this.clock = 0;
    this.lastHour = 0;
    this.today = emptyLedger();
    this.logEntry(`While you were away (${days} day${days === 1 ? '' : 's'})`, net);
    this.lastAway = { days, net };
    if (lost.length) this.notify('info', `${lost.length} booked event${lost.length === 1 ? ' was' : 's were'} cancelled while you were away. Nothing was charged.`);
    this.dirtySave = true;
    return this.lastAway;
  }

  get canUndo(): EditPlan | null {
    return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].plan : null;
  }
}

export const fmtMoney = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
