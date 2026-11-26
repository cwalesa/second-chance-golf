import { Experience, freshExperience, awardExperience, constructionFactor } from './experience';
import type { Feedback } from './feedback';
import { createWilderness, newLandSeed, placeClubhouse, relocateClubhouse, suggestClubhouse } from './wilderness';
import { assessDesign } from './design';
import { CampaignState, freshCampaign, GOALS, CHAIN, goalMet } from './campaign';
import { DailyState, KINDS, challengeDone, freshDaily } from './daily';
import { reserveLots, lotFor } from './lots';
import { FirstRoundState, firstRoundResult, freshFirstRound, isPayingRound } from './first-round';
import { AMENITY_KINDS, CART_PRICE, FLEET_BASE, FLEET_WITH_BARN, ITEMS, buildingUpkeep, countOf } from './items';
import { OwnerRound, OwnerRecord } from './owner';
import { CFG } from './config';
import { Rng } from './rng';
import { World, Hole, computeZones, hash2, holeCondition, idx, validateHole, Validation } from './terrain';
import { CourseSim, GuestComment, RoundResult } from './sim';
import { DayLedger, DaySummary, Owned, UpgradeId, amenityBonus, cartRentalRate, noUpgrades, emptyLedger, fairFee, farewellFor, maintenancePerHour, operatingProfit, netChange, pickGolferType, reputationOf, scoreRound, shopSpend, RoundScore } from './economy';
import { ActiveEvent, Booking, EVENTS, EVENT_IDS, EventId, EventResult, eventGuests, eventProblems, pickEventGolfer } from './events';
import { EditPlan, ToolId, applyPlan, planRemoveHole, setCostMultiplier, touchedHoles } from './editing';
import { setPhysics } from './physics';
import { TutorialState, freshTutorial } from './tutorial-state';
import { BANDS, BandId, CLUB_LEVELS, REGIONS, RegionId, SEASON_NAMES, bandAt, ratingStars, seasonIndex, yearOf } from './progression';
import { GoalCtx, MILESTONES } from './goals';
import { Logo, defaultLogo } from './logo';
import { WEATHER, Weather, weatherOn } from './weather';
import { RequestState, freshRequests, requestDone, rollRequests } from './requests';
import { baseDemand, priceFactor, reputationFactor } from './economy';
import { FAC, FacilityState, restaurantSetting, academyPractice, afterRound, facLevel, facilityDailyCost, freshFacilities, hourlyLocals, mealMargin, seatsToday } from './facilities';
import { RegularsState, addInterest, dailyRegulars, dueRegular, fadeProspects, findRegular, freshRegulars, growRoster, regularLesson, regularRound, roundInterest } from './regulars';
import { CalendarState, applyPrep, boardHole, eventIssues, fieldNames, freshCalendar, readinessOf, refreshOffers, routeOf, tournamentReport } from './calendar';
import { DecisionState, dailyDecisions, freshDecisions, heatPlan } from './decisions';
import { Identity, computeIdentity } from './identity';
import { QualityContext, effectiveHoles, holeEnjoyment, holeQuality, playKind, segmentMix, segmentOf, summarisePlays } from './quality';
import { setCourseSetup } from './physics';
import type { Golfer } from './sim';

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
  /** The player's hold on time. Design mode sets it, and only an explicit Resume clears it. */
  paused: boolean;
  /** False until the player chooses "Open for business": setting up a new course never runs the clock. */
  open: boolean;
}
/** How fast test golfers play while the business clock is stopped. It never changes the player's saved speed. */
export const TEST_SPEED = 3;
export interface TestResult { name: string; type: 'beginner' | 'regular' | 'skilled'; hole: number; strokes: number; par: number; shots: number; rough: number; bunker: number; water: number; }
export interface LifetimeStats {
  rounds: number;
  revenue: number;
  events: number;
  aces: number;
  birdies?: number;
  bestDayProfit: number;
  bestDaySat: number;
  years: number;
}
export interface NewGameOptions {
  region?: RegionId;
  name?: string;
  logo?: Logo;
  /** false skips the optional tutorial. */
  tutorial?: boolean;
  /** an old disposable practice course; kept so saves from before the guided tutorial can be recognised */
  practice?: boolean;
}

export const STAFF = {
  gardener: { name: 'Head greenkeeper', hire: 180, daily: 72, detail: 'Restores 2 condition per hour on owned fairways, greens and tees.' },
  ranger: { name: 'Course ranger', hire: 160, daily: 48, detail: 'Spaces tee starts 25% closer and reduces guest frustration with waiting.' },
  host: { name: 'Club host', hire: 140, daily: 42, detail: 'Adds 4 guest satisfaction and helps happy visitors become members.' },
} as const;
export type StaffId = keyof typeof STAFF;
export interface Member { name: string; type: 'beginner' | 'regular' | 'skilled'; visits: number; happiness: number; joined: number; }
export interface Landing { x: number; y: number; hole: number; bad: boolean; }

export interface Cheer { kind: 'ace' | 'level' | 'daily' | 'streak' | 'request'; title: string; sub: string; reward?: number; }
export interface Preferences { sound: boolean; music: boolean; haptics: boolean; dailyReports: boolean; /** help tips already shown, by key */ tipsSeen?: string[]; }
export class Game {
  experience: Experience = freshExperience();
  /** Level 1 walkthrough progress. New games start at step 0. */
  tutorial: TutorialState = freshTutorial();
  preferences: Preferences = { sound: true, music: true, haptics: true, dailyReports: true };
  pendingRecap: DaySummary | null = null;
  onFeedback: (type: Feedback) => void = () => {};
  campaign: CampaignState = freshCampaign();
  staff: Record<StaffId, boolean> = { gardener: false, ranger: false, host: false };
  members: Member[] = [];
  owner = new OwnerRound();
  ownerRecords: OwnerRecord[] = [];
  landings: Landing[] = [];
  heatmap = false;
  followGolfer = 0;
  designMode = false;
  world: World;
  rng: Rng;
  sim: CourseSim;
  cash = CFG.economy.startCash;
  day = 1;
  clock = 0;
  total = 0;
  region: RegionId = 'parkland';
  name = 'Little Links';
  logo: Logo = defaultLogo();
  fees: Record<BandId, number> = { early: 34, mid: 30, twilight: 20 };
  clubLevel = 0;
  stats: LifetimeStats = { rounds: 0, revenue: 0, events: 0, aces: 0, birdies: 0, bestDayProfit: 0, bestDaySat: 0, years: 1 };
  lastAway: { days: number; net: number } | null = null;
  upgrades: Owned = noUpgrades();
  cartFee = CFG.extras.cartFeeDefault;
  /** Golf carts owned. Rentals scale with the fleet; a cart barn raises the most you can keep. */
  fleet = 0;
  get maxFleet(): number { return countOf(this.world, 'barn') ? FLEET_WITH_BARN : FLEET_BASE; }
  buyCart(): boolean {
    if (!this.upgrades.carts) return false;
    if (this.fleet >= this.maxFleet) { this.notify('bad', this.maxFleet === FLEET_BASE ? 'Your carts are full. A cart barn lets you keep more.' : 'The barn is full.'); return false; }
    if (this.cash < CART_PRICE) { this.notify('bad', `A cart costs ${fmtMoney(CART_PRICE)}. You need ${fmtMoney(CART_PRICE - this.cash)} more.`); return false; }
    this.cash -= CART_PRICE;
    this.today.construction += CART_PRICE;
    this.logEntry('Bought a golf cart', -CART_PRICE);
    this.fleet++;
    this.onFeedback('build');
    this.dirtySave = true;
    return true;
  }
  /** Share of cart-rental demand the fleet can serve: six carts cover a small course. */
  get fleetFactor(): number { return Math.min(1, 0.4 + 0.1 * this.fleet); }
  goals: GoalState[] = [...CFG.goals, ...MILESTONES].map((g) => ({ id: g.id, done: false }));
  today: DayLedger = emptyLedger();
  days: DaySummary[] = [];
  log: LogEntry[] = [];
  recent: RoundRecord[] = [];
  comments: GuestComment[] = [];
  undoStack: UndoEntry[] = [];
  redoStack: UndoEntry[] = [];
  /** Most recent test rounds by simulated golfers on the owner's layout (not saved, never paid). */
  testResults: TestResult[] = [];
  settings: Settings = { speed: 1, brush: 1, tool: 'inspect', introSeen: false, paused: false, open: true };
  selectedHole = 1;
  selectedGolfer = 0;
  lastHour = 0;
  notices: Notice[] = [];
  onNotice: (n: Notice) => void = () => {};
  /** True when something worth saving changed. Setting it also tells the interface at once, so guidance never waits for a timer. */
  get dirtySave() { return this._dirtySave; }
  set dirtySave(v: boolean) { this._dirtySave = v; if (v) this.onStateChanged?.(); }
  private _dirtySave = false;
  /** The payoff for the first paying guest to finish a round: recorded once per course, shown once. */
  firstRound: FirstRoundState = freshFirstRound();
  /** Called whenever the committed game state changes (an edit built, undone, a hole opened, the clubhouse placed). */
  onStateChanged: (() => void) | null = null;
  bookings: Booking[] = [];
  eventFees = Object.fromEntries(EVENT_IDS.map((id) => [id, EVENTS[id].fair])) as Record<EventId, number>;
  activeEvent: ActiveEvent | null = null;
  lastEvent: EventResult | null = null;
  private goalTimer = 0;

  constructor(world?: World, seed = 20250601, opts: NewGameOptions = {}) {
    this.world = world ?? createWilderness(newLandSeed(seed), opts.region ?? 'parkland');
    if (!world) this.selectedHole = 0;
    this.region = this.world.region;
    if (opts.name) this.name = opts.name.trim().slice(0, 28) || this.name;
    if (opts.logo) this.logo = opts.logo;
    // A new course starts paused and closed: the player sets it up unhurried and then chooses to open for business.
    if (!world) { this.settings.paused = true; this.settings.open = false; }
    // Ready-made courses have nothing to learn from the walkthrough.
    if (opts.tutorial === false || world) this.tutorial.done = true;
    if (opts.practice) {
      // a ready clubhouse, plenty of money, nothing that counts: just learning
      this.practice = true;
      this.name = 'Practice Course';
      this.cash = 60000;
      const spot = suggestClubhouse(this.world);
      if (spot) { placeClubhouse(this.world, spot); reserveLots(this.world); }
    }
    // a course handed in ready-made starts its goals at the first one it has not reached, unpaid
    if (world) this.catchUpGoals(true);
    this.rng = new Rng(seed);
    this.sim = new CourseSim(this.world, this.rng, {
      onRound: (r) => this.onRoundComplete(r),
      onComment: (c) => {
        this.comments.push(c);
        if (this.comments.length > 40) this.comments.shift();
      },
      onHole: (g, h) => {
        // each kind of golfer judges the hole on what they care about (quality.ts); what they say is true to that judgement
        const q = holeQuality(this.world, h, this.qualityCtx);
        const seg = segmentOf(g.type, g.seg);
        const bonus = holeEnjoyment(q, seg);
        const reg = findRegular(this, g.regId);
        if (reg) reg.love[h.id] = (reg.love[h.id] ?? 0) + bonus;
        if (bonus >= 4 && this.rng.next() < 0.5) this.sim.say(g, seg === 'beginner' ? 'Room to miss. I could play here every week.' : seg === 'skilled' ? 'A proper choice of shots. I like this hole.' : seg === 'resort' ? 'What a setting. Like a postcard.' : 'Lovely hole. Worth coming back for.');
        else if (bonus <= -4 && this.rng.next() < 0.5) this.sim.say(g, seg === 'beginner' ? 'Nowhere to miss on that one.' : seg === 'skilled' ? 'Nothing to think about on that hole.' : seg === 'resort' ? 'Not much to look at here.' : q.parts.pace < 60 ? 'Too much waiting on that hole.' : 'That hole felt like the last one.');
        return bonus;
      },
      onHoleDone: (g, h, strokes, picked) => this.recordPlay(g, h, strokes, picked),
      onStop: (g) => this.facilityStop(g),
      onShot: (h, shot) => {
        this.landings.push({ x: shot.air.x, y: shot.air.y, hole: h.id, bad: shot.kind !== 'ok' });
        if (this.landings.length > 400) this.landings.shift();
      },
      onAce: (g) => {
        this.stats.aces++;
        this.earn('bonus', 500, 'Hole in one: word gets around');
        awardExperience(this, 50);
        this.cheer({ kind: 'ace', title: 'Hole in one!', sub: `${g.name} aced hole ${g.holeId}. Word gets around.`, reward: 500 });
      },
      onHoleOut: (g, h, diff) => {
        if (diff > -1 || g.test) return;
        this.stats.birdies = (this.stats.birdies ?? 0) + 1;
        awardExperience(this, diff <= -2 ? 8 : 3);
        this.sim.pop('cheer', h.cup.x + 0.5, h.cup.y - 0.2, diff <= -2 ? 'Eagle! +8 XP' : 'Birdie! +3 XP');
      },
    });
    this.applyRegion();
  }

  /** Blank-canvas start: put the clubhouse where the player chose. It is the club's first gift, so it costs nothing. */
  buildClubhouse(at: { x: number; y: number }, flip = false): boolean {
    if (this.world.clubhouse) return false;
    const why = placeClubhouse(this.world, at, flip);
    if (why) {
      this.notify('bad', why);
      return false;
    }
    reserveLots(this.world); // space for the putting green and the range, kept clear from the start
    this.onFeedback('build');
    this.notify('good', `Clubhouse built. Golfers arrive by the entrance road.`);
    this.dirtySave = true;
    return true;
  }

  /** Pick the clubhouse up and put it down at another corner or turned the other way. Free; anything in the way has to be moved first. */
  moveClubhouse(at: { x: number; y: number }, flip: boolean): boolean {
    const why = relocateClubhouse(this.world, at, flip);
    if (why) {
      this.notify('bad', why);
      return false;
    }
    this.onFeedback('build');
    this.notify('good', 'Clubhouse moved. Golfers arrive by the new entrance road.');
    this.dirtySave = true;
    return true;
  }

  /**
   * Improvements that used to be bought without being placed (the putting green and the driving range) now stand on the
   * property. A save that owns one with nothing standing gets it placed on its lot beside the clubhouse, free of charge.
   */
  placeOwnedAmenities(): void {
    const w = this.world, c = w.clubhouse;
    if (!c) return;
    w.items ??= [];
    for (const kind of AMENITY_KINDS) {
      if (!this.upgrades[kind] || countOf(w, kind) > 0) continue;
      const d = ITEMS[kind], fw = d.w ?? 1, fh = d.h ?? 1;
      const found = lotFor(w, kind);
      if (!found) continue;
      for (let yy = found.y; yy < found.y + fh; yy++) for (let xx = found.x; xx < found.x + fw; xx++) { w.tree[idx(w, xx, yy)] = 0; w.dirty.add(idx(w, xx, yy)); }
      w.items.push({ x: found.x, y: found.y, k: kind });
      if (w.lots) delete w.lots[kind];
      w.version++;
      this.dirtySave = true;
    }
  }

  /** First-course designer: all of Willow Creek is yours to build on from the start. */
  openProperty() {
    if (!this.world.parcels.every((p) => p === 1)) {
      this.world.parcels.fill(1);
      this.world.version++;
      this.dirtySave = true;
    }
  }

  /** Push regional rules into the physics and building-cost modules. */
  applyRegion() {
    const r = REGIONS[this.region];
    setPhysics(r.wind, r.distance);
    setCourseSetup(this.setup === 'forgiving' ? 0.86 : this.setup === 'championship' ? 1.14 : 1);
    setCostMultiplier(r.buildMult * constructionFactor(this));
    this.updateWear();
  }
  private updateWear() {
    const r = REGIONS[this.region];
    this.sim.wearMult = WEATHER[this.weather].wear * (this.upgrades.crew ? CFG.upgrades.crew.wearMultiplier : 1) * r.wear * r.seasonWear[seasonIndex(this.day)] * (this.experience.site.irrigation ? .8 : 1) * (countOf(this.world, 'shed') ? 0.85 : 1) * (countOf(this.world, 'nursery') ? 0.92 : 1) * heatPlan(this);
  }

  /** Things guests have asked for, and what putting each right pays (see requests.ts). */
  requests: RequestState = freshRequests();
  /** The academy, restaurant and tournament center: their levels and how they are staffed (see facilities.ts). */
  fac: FacilityState = freshFacilities();
  /** Golfers the club knows by name, their stories, and guests on their way to membership (see regulars.ts). */
  regulars: RegularsState = freshRegulars();
  /** Dated opportunities and past tournament reports (see calendar.ts). */
  calendar: CalendarState = freshCalendar();
  /** Choices announced ahead of the day they matter (see decisions.ts). */
  decisions: DecisionState = freshDecisions();
  /** Standing earned from competitions: bigger fields, the qualifier, skilled and resort visitors. 0 to 100. */
  prestige = 0;
  /** How the pins and rough are set: forgiving helps beginners, championship rewards skill. */
  setup: 'forgiving' | 'standard' | 'championship' = 'standard';
  /** What the club has become, worked out each morning from the last week (see identity.ts). Not saved. */
  identity: Identity | null = null;
  /** A snapshot of the club when it was last saved, for the summary a returning player sees (see returns.ts). */
  seen: { day: number; cash: number; rounds: number; members: number; prestige: number; profit: number; stories: number; at: number; regulars: Record<number, { visits: number; skill: number; done: boolean }> } | null = null;
  /** The setup in force before a championship-prepared tournament day, restored afterwards. */
  private setupBefore: Game['setup'] | null = null;
  setSetup(s: Game['setup']) {
    this.setup = s;
    setCourseSetup(s === 'forgiving' ? 0.86 : s === 'championship' ? 1.14 : 1);
    this.dirtySave = true;
  }
  /** Weather for any day: deterministic, so the next few days can be forecast. */
  weatherFor(day: number): Weather { return weatherOn(this.world.landSeed, day, this.region, seasonIndex(day)); }
  /** What the quality model needs to know about the whole club: carts, and the mix of golfers lately. */
  get qualityCtx(): QualityContext {
    const last = this.days.slice(-5);
    const k = (c: 'b' | 'r' | 's' | 'v' | 'j' | 'f') => last.reduce((sum, d) => sum + (d.kinds?.[c] ?? 0), 0);
    const counts = last.length ? { beginner: k('b') + k('j'), regular: k('r'), skilled: k('s') + k('f'), resort: k('v') } : null;
    return { carts: this.upgrades.carts, mix: segmentMix(counts) };
  }
  /** Today's weather. */
  get weather(): Weather { return weatherOn(this.world.landSeed, this.day, this.region, seasonIndex(this.day)); }
  /** A storm has washed out turf and it has not been put right yet. The interface keeps a repair prompt up while this is set. */
  stormDamage = false;
  /** What the new day's weather does to the course, once, as the day begins. */
  private beginWeather() {
    const wx = this.weather, w = this.world;
    if (wx === 'clear') return;
    if (wx === 'rain') {
      for (let i = 0; i < w.terrain.length; i++) { const t = w.terrain[i]; if (t >= 1 && t <= 3 && w.cond[i] < 90) { w.cond[i] = Math.min(90, w.cond[i] + 5); w.dirty.add(i); } }
      w.version++;
      this.notify('info', 'Rain today. Fewer golfers will come, but the turf is recovering.');
    } else if (wx === 'heat') {
      this.notify('info', 'Heatwave today. Turf wears faster in the heat.');
    } else {
      // washed-out patches on every hole: blotches a few tiles across, on fairway, green and tee alike
      let hit = 0;
      for (let i = 0; i < w.terrain.length; i++) {
        const t = w.terrain[i];
        if (t < 1 || t > 3 || !w.zone[i]) continue;
        const x = i % w.w, y = Math.floor(i / w.w);
        if (hash2(Math.floor(x / 3), Math.floor(y / 3), this.day * 31 + 5) > 0.45) continue;
        w.cond[i] = Math.max(CFG.turf.floor, w.cond[i] - 55);
        w.dirty.add(i);
        hit++;
      }
      w.version++;
      if (hit) this.stormDamage = true;
      if (this.fellTrees()) return void this.updateWear();
      this.notify('bad', hit ? 'A storm came through overnight and washed out patches of turf. Golfers will notice until it is repaired.' : 'A storm came through overnight. Very few golfers will come today.');
    }
    this.updateWear();
  }

  /** Holes whose fairway is blocked by trees a storm brought down, with the tiles they lie on. Cleared from the bar under the header. */
  fallen: { hole: number; tiles: number[] }[] = [];
  /** Rare: about one storm in three brings trees down across one open hole's fairway, which closes it until they are cleared. */
  private fellTrees(): boolean {
    const w = this.world, open = this.openHoles;
    if (this.day < 20 || !open.length || hash2(this.day, 91, w.landSeed % 1000003) > 0.25) return false;
    const h = open[Math.floor(hash2(this.day, 92, w.landSeed % 1000003) * open.length)];
    const tiles: number[] = [];
    for (let dy = -2; dy <= 2 && tiles.length < 4; dy++)
      for (let dx = -2; dx <= 2 && tiles.length < 4; dx++) {
        const x = h.bend.x + dx, y = h.bend.y + dy;
        if (x < 0 || y < 0 || x >= w.w || y >= w.h) continue;
        const i = idx(w, x, y);
        if (w.terrain[i] === 1 && !w.tree[i] && hash2(x, y, this.day) < 0.5) tiles.push(i);
      }
    if (tiles.length < 2) return false;
    for (const i of tiles) { w.tree[i] = 1; w.dirty.add(i); }
    this.closeHole(h.id, true);
    h.awaiting = true;
    w.version++;
    this.fallen.push({ hole: h.id, tiles });
    this.notify('bad', `A storm brought trees down across hole ${h.id}, and washed out turf. The hole is closed until the trees are cleared.`);
    return true;
  }
  /** Clear the fallen trees from a hole and open it again. Time carries on as it was. */
  clearFallen(holeId: number, plan: EditPlan): boolean {
    const running = this.businessRunning;
    if (plan.tiles.length && !this.commitEdit(plan).ok) return false;
    this.fallen = this.fallen.filter((f) => f.hole !== holeId);
    if (this.world.holes.some((h) => h.id === holeId)) this.openHole(holeId);
    if (running) { this.exitDesign(); this.resume(); }
    return true;
  }

  get designRating(): number {
    const open = this.openHoles;
    return open.length ? Math.round(open.reduce((sum, h) => sum + assessDesign(this.world, h).overall, 0) / open.length) : 0;
  }
  get dailyWages(): number { return (Object.keys(STAFF) as StaffId[]).reduce((sum, id) => sum + (this.staff[id] ? STAFF[id].daily : 0), 0); }
  hire(id: StaffId) {
    if (!(id in STAFF) || this.staff[id]) return;
    if (this.cash < STAFF[id].hire) { this.notify('bad', 'Not enough cash for the hiring fee.'); return; }
    this.spend('construction', STAFF[id].hire, `Hire ${STAFF[id].name}`);
    this.staff[id] = true;
    this.notify('good', `${STAFF[id].name} hired. Daily wages: ${fmtMoney(STAFF[id].daily)}.`);
  }
  dismiss(id: StaffId) { if (id in STAFF) { this.staff[id] = false; this.dirtySave = true; } }
  /** Designing stops the business clock. Leaving design never restarts it; only an explicit resume does. */
  enterDesign() {
    if (this.owner.active) return;
    if (!this.designMode) this.designMode = true;
    if (!this.settings.paused) { this.settings.paused = true; this.dirtySave = true; this.notify('info', 'Designing: time is paused. Tap Resume when you are ready.'); }
  }
  /** Stop designing but leave time paused. */
  exitDesign() { this.designMode = false; }
  toggleDesignMode() {
    if (this.owner.active) return;
    if (this.designMode) this.exitDesign(); else this.enterDesign();
  }
  /** Hold time. The selected running speed is kept for the resume. */
  pause() { if (!this.settings.paused) { this.settings.paused = true; this.dirtySave = true; } }
  /** Start the business clock again at the player's chosen speed. Never starts a course that has not opened. */
  resume(): boolean {
    if (!this.settings.open) { this.notify('info', 'Your course is not open yet. Choose Open for business when you are ready.'); return false; }
    this.designMode = false;
    this.settings.paused = false;
    this.dirtySave = true;
    return true;
  }
  /** Speed 0 is the pause button; any other speed is the player's choice of running speed and resumes an open course. */
  setSpeed(s: number) {
    if (s <= 0) { this.pause(); return; }
    this.settings.speed = s;
    this.dirtySave = true;
    if (this.settings.open) this.resume();
    else this.notify('info', 'Speed saved. The clock starts when you open for business.');
  }
  /** Why a course cannot open yet, or null. */
  get openProblem(): string | null {
    if (!this.world.clubhouse) return 'Place your clubhouse first.';
    if (!this.world.holes.some((h) => h.open)) return 'Open at least one hole first, so guests have somewhere to play.';
    return null;
  }
  /** The course welcomes guests. This is the one explicit step that starts the business clock on a new course. */
  openForBusiness(): boolean {
    if (this.settings.open) return this.resume();
    const why = this.openProblem;
    if (why) { this.notify('bad', why); return false; }
    this.settings.open = true;
    this.designMode = false;
    this.settings.paused = false;
    this.notify('good', 'Your course is open for business.');
    this.dirtySave = true;
    return true;
  }
  /** What is holding the business clock, if anything. */
  get timeHold(): 'owner' | 'unopened' | 'design' | 'paused' | null {
    if (this.owner.active) return 'owner';
    if (!this.settings.open || !this.world.clubhouse) return 'unopened';
    if (this.designMode) return 'design';
    return this.settings.paused ? 'paused' : null;
  }
  get businessRunning(): boolean { return this.timeHold === null; }
  /** The speed button that should look pressed. */
  get speedShown(): number { return this.settings.paused || !this.settings.open ? 0 : this.settings.speed; }
  get hasTestGolfers(): boolean { return this.sim.golfers.some((g) => g.test); }
  /** How fast the frame loop should run the simulation: 0 means nothing moves. */
  get timeScale(): number {
    if (this.owner.active) return 0;
    if (this.businessRunning) return this.settings.speed;
    return this.hasTestGolfers ? TEST_SPEED : 0;
  }
  /** One frame-loop step honouring every pause reason. Test golfers still play while the business is held. */
  advance(dt: number) {
    if (this.owner.active) return;
    if (this.businessRunning) this.step(dt);
    else if (this.hasTestGolfers) this.stepTest(dt);
  }
  /** Move only the test golfers (guests already on the course stay where they are). No clock, arrivals, upkeep, wear, goals or day changes. */
  stepTest(dt: number) {
    this.sim.teeIntervalMult = this.staff.ranger ? .75 : 1;
    this.sim.update(dt, true);
  }
  claimObjective(id: string) {
    const o = GOALS.find(o => o.id === id);
    if (!o || this.campaign.claimed.includes(id) || o.value(this) < o.target) return false;
    this.campaign.claimed.push(id); this.campaign.medals++;
    this.earn('bonus', o.reward, `Goal: ${o.title}`);
    awardExperience(this, 75, `${this.campaign.stage}:objective:${id}`);
    this.onFeedback('reward');
    this.notify('good', `${o.title}: ${fmtMoney(o.reward)} grant.`);
    return true;
  }

  // ---- derived ----
  get openHoles(): Hole[] {
    return this.world.holes.filter((h) => h.open);
  }
  get avgCondition(): number {
    const open = this.openHoles;
    const list = open.length ? open : this.world.holes;
    if (!list.length) return 0;
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
    // repeats of the same hole count for less: the rating reads distinct holes (see quality.ts)
    return ratingStars({ openHoles: effectiveHoles(this.world.holes), avgCond: this.avgCondition, rep: this.reputation, amenities: Object.values(this.upgrades).filter(Boolean).length, clubLevel: this.clubLevel });
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
    return Math.max(this.club.holes, CFG.holes.designCap);
  }
  get parcelPrice(): number {
    return Math.round((CFG.land.base * this.regionDef.landMult * Math.pow(CFG.land.growth, Math.max(0, this.parcelsOwned - CFG.land.startCols * CFG.land.startRows))) / 10) * 10;
  }
  /** Demand per day before price: reputation, season, region, clubhouse, rating and range all count. */
  get dailyBase(): number {
    return baseDemand(this.openHoles.length) * reputationFactor(this.reputation) * this.regionDef.demand * this.season.demand * this.club.demand * (1 + 0.06 * this.stars) * (this.upgrades.range ? CFG.extras.rangeDemand : 1) * (1 + 0.08 * countOf(this.world, 'carpark')) * WEATHER[this.weather].demand * (this.identity?.top === 'community' && BANDS.every((b) => this.fees[b.id] <= this.fair * b.fair + 1) ? 1.06 : 1) * (1 + this.prestige / 500);
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
    // the region's upkeep modifier applies to everything that is kept up: turf, improvements and buildings
    return (maintenancePerHour(open, this.world.holes.length - open, this.upgrades) + (this.experience.site.irrigation ? 1 : 0) + buildingUpkeep(this.world) / CFG.day.hours) * this.regionDef.upkeep + facilityDailyCost(this) / CFG.day.hours;
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
  logEntry(label: string, amount: number) {
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
    this.sim.teeIntervalMult = this.staff.ranger ? .75 : 1;
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
    // local diners who come for the restaurant, not the golf
    const locals = hourlyLocals(this);
    if (locals) {
      this.today.covers = (this.today.covers ?? 0) + locals;
      this.today.locals = (this.today.locals ?? 0) + locals;
      this.earn('shop', locals * mealMargin(this), `Restaurant: ${locals} local diner${locals === 1 ? '' : 's'}`);
    }
    if (this.dailyWages) this.spend('maintenance', this.dailyWages / CFG.day.hours, 'Staff wages');
    if (this.upgrades.crew || this.staff.gardener || this.experience.site.irrigation) {
      const w = this.world;
      const u = CFG.upgrades.crew;
      for (let i = 0; i < w.terrain.length; i++) {
        const t = w.terrain[i];
        if ((t === 1 || t === 2 || t === 3) && w.cond[i] < (this.experience.site.irrigation ? 88 : u.restoreCeil)) {
          w.cond[i] = Math.min(this.experience.site.irrigation ? 88 : u.restoreCeil, w.cond[i] + (this.upgrades.crew ? u.restorePerHour : 0) + (this.staff.gardener ? 2 : 0) + (this.experience.site.irrigation ? 1 : 0));
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
    // juniors from the academy's program arrive through the morning
    const jl = FAC.academy.juniorsPerDay[facLevel(this, 'academy')] + (this.identity?.top === 'learning' && facLevel(this, 'academy') >= 2 ? 1 : 0);
    if (jl && this.rng.next() < 1 - Math.exp(-(jl / (CFG.day.seconds * 0.5)) * dt) && this.clock < CFG.day.seconds * 0.5) {
      const g = this.sim.spawn('beginner', FAC.academy.juniorFee, { seg: 'junior', fair: FAC.academy.juniorFee + 4, holes: this.openHoles.sort((a, b) => a.id - b.id).slice(0, 3).map((h) => h.id), skill: 1.15 });
      if (g) { this.today.arrivals++; this.earn('fees', FAC.academy.juniorFee, `Junior program, ${g.name}`); }
    }
    // an event can limit who else plays today
    const access = this.todayAccess;
    // the very first guests of a new game show up right away so there is something to watch
    if (this.day === 1 && this.today.arrivals < 2 && this.clock > 1 + this.today.arrivals * 7) {
      this.arrive();
      return;
    }
    const frac = this.clock / CFG.day.seconds;
    const b = bandAt(frac);
    const window = (Math.min(b.to, CFG.day.lastArrivalFrac) - b.from) * CFG.day.seconds;
    if (window <= 0) return;
    const lambda = (this.bandArrivals(b.id) / window) * (access === 'closed' ? 0 : access === 'members' ? 0.3 : this.activeEvent?.id === 'memberday' && frac < 0.5 ? 0.6 : 1);
    if (this.rng.next() < 1 - Math.exp(-lambda * dt)) this.arrive(access === 'members');
  }
  /** Who else may play today: set by an event's access choice. */
  get todayAccess(): 'open' | 'members' | 'closed' {
    const e = this.activeEvent;
    return e?.access ?? 'open';
  }

  private arrive(membersOnly = false) {
    const cap = 12 + 3 * this.openHoles.length + (this.activeEvent ? 18 : 0) + 8 * countOf(this.world, 'carpark');
    if (this.sim.golfers.length >= cap) return; // course is full, they drive on by
    const band = this.band;
    const fee = this.fees[band.id];
    // a regular who is due comes by name, with their own ability
    const reg = dueRegular(this);
    const availableMembers = this.members.filter(m => !this.sim.golfers.some(g => g.name === m.name) && !this.regulars.list.some((r) => r.name === m.name));
    const returning = !reg && availableMembers.length && (membersOnly || this.rng.next() < .35) ? this.rng.pick(availableMembers) : null;
    if (membersOnly && !reg && !returning) return;
    // resort visitors come for the scenery and the food; prestige and a premium restaurant draw more
    const resortShare = 0.04 + this.prestige / 900 + (facLevel(this, 'restaurant') && this.fac.restaurant.service === 'premium' ? 0.07 : 0) + (this.identity?.top === 'resort' ? 0.06 : 0);
    const resort = !reg && !returning && this.rng.next() < resortShare;
    const type = reg ? reg.type : returning ? returning.type : resort ? 'regular' : pickGolferType(this.rng);
    const g = this.sim.spawn(type, fee, { fair: this.fair * band.fair, ...(reg ? { name: reg.name, regId: reg.id, skill: reg.skill } : {}), ...(resort ? { seg: 'resort' as const } : {}) });
    if (g && reg) { g.returning = true; reg.lastVisit = this.day; }
    if (g && returning) { g.name = returning.name; g.returning = true; }
    if (g) {
      this.today.arrivals++;
      this.earn('fees', fee, `${band.name} tee time, ${g.name}`);
      const door = this.world.clubhouse;
      if (door) this.sim.pop('coin', door.x + (this.world.clubFlip ? 1 : 3.5), door.y + (this.world.clubFlip ? 3.5 : 1), `+$${Math.round(fee)}`);
      if (this.upgrades.carts && this.rng.next() < cartRentalRate(this.cartFee) * this.fleetFactor) {
        this.earn('fees', this.cartFee, `Cart rental, ${g.name}`);
        // the renter drives a cart from the barn, if one is free (the rental is the same either way)
        if (this.sim.golfers.filter((x) => x.cart !== undefined && x.cart >= 0 && x.phase !== 'leave').length < this.fleet) g.cart = g.id % 4;
      }
    }
  }

  private onRoundComplete(r: RoundResult): string {
    if (r.test) {
      const hole = r.holeIds?.[0] ?? 0;
      this.testResults.push({ name: r.name, type: r.type, hole, strokes: r.strokes, par: r.par, shots: r.stats.shots, rough: r.stats.rough, bunker: r.stats.bunker, water: r.stats.water });
      if (this.testResults.length > 12) this.testResults.shift();
      const diff = r.strokes - r.par;
      this.notify('info', `Test golfer ${r.name} finished hole ${hole}: ${r.strokes} strokes (${diff === 0 ? 'par' : (diff > 0 ? '+' : '') + diff}).`);
      return diff <= 0 ? 'Lovely layout. Is it open to the public?' : 'Tough but fair.';
    }
    // The first paying guest to finish gets a result card. Their fee was already collected when they teed off; nothing is paid here.
    if (!this.firstRound.done && !this.practice && isPayingRound(r)) {
      this.firstRound = { done: true, shown: false, result: firstRoundResult(r) };
      const golfer = this.sim.golfers.find((x) => x.id === r.golferId);
      if (golfer) golfer.cheer = this.sim.now; // a small cheer as they head home (drawing only)
      this.dirtySave = true;
    }
    const svc = facLevel(this, 'restaurant') ? FAC.restaurant.service[this.fac.restaurant.service].sat : 0;
    const sc = scoreRound(r, r.fee, r.fairFee ?? this.fair, amenityBonus(this.upgrades) + this.club.sat + svc);
    const designBonus = r.holes ? (r.designSum ?? 0) / r.holes : 0;
    sc.total = Math.max(0, Math.min(100, sc.total + designBonus + (this.staff.host ? 4 : 0) + (this.experience.site.terrace ? 3 : 0) + (this.experience.site.garden ? 2 : 0) + (this.staff.ranger ? Math.min(5, r.stats.wait / 20) : 0)));
    this.campaign.rounds++;
    awardExperience(this, 2);
    const k = playKind(r.type, r.seg);
    this.today.kinds = this.today.kinds ?? {};
    this.today.kinds[k] = (this.today.kinds[k] ?? 0) + 1;
    if (r.fairFee && !r.event) this.today.feeRatio = (this.today.feeRatio ?? 0) + r.fee / Math.max(1, r.fairFee);
    else this.today.feeRatio = (this.today.feeRatio ?? 0) + 1;
    const reg = findRegular(this, r.regId);
    let regSay: string | null = null;
    if (reg) regSay = regularRound(this, reg, r, sc.total);
    const member = this.members.find(m => m.name === r.name);
    if (member && !reg) { member.visits++; member.happiness = Math.round(member.happiness * .5 + sc.total * .5); }
    else if (!member && !reg && !r.event) {
      // enjoying a round builds interest in joining; the panel shows who is close and why (regulars.ts)
      const before = this.members.length;
      const gain = roundInterest(this, sc.total, r.holes);
      addInterest(this, r.name, r.type, gain.amount, gain.why);
      if (this.members.length > before) awardExperience(this, 12, `${this.campaign.stage}:member:${r.name}`);
    }
    // after the round: a lesson at the academy or a meal on the patio (the golfer walks over before leaving)
    const golfer = this.sim.golfers.find((x) => x.id === r.golferId);
    if (golfer && !r.event) golfer.stopAt = afterRound(this, r.type, sc.total, r.seg, !!reg && (reg.goal.kind === 'break' || reg.goal.kind === 'championship') && !reg.goal.done);
    else if (golfer && r.event && this.activeEvent?.id !== 'function' && facLevel(this, 'restaurant') && this.rng.next() < 0.5 && (this.today.covers ?? 0) < seatsToday(this)) golfer.stopAt = afterRound(this, r.type, sc.total, r.seg, false);
    if (r.event && this.activeEvent) {
      this.activeEvent.rounds++;
      this.activeEvent.satSum += sc.total;
    }
    // the restaurant takes over from the grill room: its meals are counted when golfers sit down (facilityStop)
    const grill = facLevel(this, 'restaurant') ? 0 : 0.22 * countOf(this.world, 'grill');
    const spend = Math.round(shopSpend(this.rng, sc.total, this.upgrades, this.club.shop) * REGIONS[this.region].spend * (1 + 0.18 * countOf(this.world, 'halfway') + 0.15 * countOf(this.world, 'proShop') + grill) * (this.experience.site.terrace ? 1.15 : 1) * (r.seg === 'resort' ? 1.45 : 1));
    this.stats.rounds++;
    this.earn('shop', spend, `Clubhouse sales, ${r.name}`);
    this.today.rounds++;
    this.today.satSum += sc.total;
    this.recent.push({ ...sc, rough: r.stats.shots ? r.stats.rough / r.stats.shots : 0, water: r.stats.water, wait: r.stats.wait, fee: r.fee, fair: this.fair, name: r.name });
    if (this.recent.length > CFG.satisfaction.window) this.recent.shift();
    this.warnWornTurf();
    return regSay ?? farewellFor(sc);
  }

  /** One golfer's play of one hole goes into that hole's recent record, and onto the leaderboard if they are in the field. */
  private recordPlay(g: Golfer, h: Hole, strokes: number, picked: boolean) {
    h.log ??= [];
    h.log.push({ d: strokes - h.par, w: g.hs.water ?? 0, s: g.hs.sand ?? 0, t: Math.round(g.hs.wait ?? 0), p: picked ? 1 : 0, k: playKind(g.type, g.seg), day: this.day });
    if (h.log.length > 30) h.log.shift();
    if (g.event && g.seg === 'field') boardHole(this, g.name, g.regId, h.par, strokes, g.hs.water ?? 0);
  }

  /** A golfer reached the academy or the restaurant after the round. */
  private facilityStop(g: Golfer) {
    const stop = g.stopAt;
    if (!stop) return;
    const t = this.today;
    if (stop.what === 'lesson') {
      t.lessons = (t.lessons ?? 0) + 1;
      this.earn('fees', FAC.academy.lessonFee, `Lesson, ${g.name}`);
      const reg = findRegular(this, g.regId);
      if (reg) regularLesson(this, reg, academyPractice(this.world).quality);
      else if (!this.members.some((m) => m.name === g.name)) addInterest(this, g.name, g.type, 35, 'took a lesson');
    } else {
      t.covers = (t.covers ?? 0) + 1;
      this.earn('shop', mealMargin(this), `Restaurant, ${g.name}`);
      const reg = findRegular(this, g.regId);
      if (reg && reg.goal.kind === 'patio' && !reg.goal.done) {
        reg.goal.progress++;
        if (reg.goal.progress >= reg.goal.target) { reg.goal.done = true; reg.goal.doneDay = this.day; this.regularsStory(reg.name, 'has lunched on the patio three times and tells everyone about it. More locals come.'); }
      }
    }
  }
  private regularsStory(who: string, text: string) {
    this.regulars.stories.push({ day: this.day, who, text, tone: 'good' });
    if (this.regulars.stories.length > 40) this.regulars.stories.shift();
    this.notify('good', `${who} ${text}`);
  }

  private turfWarnDay = -9;
  /** Worn turf drags satisfaction down slowly and out of sight (it gathers where golfers putt). Say so, with what to do, at most every few days. */
  private warnWornTurf() {
    const last = this.recent.slice(-6);
    if (last.length < 6 || this.day - this.turfWarnDay < 3) return;
    if (last.reduce((s, r) => s + r.cond, 0) / last.length >= 55) return;
    this.turfWarnDay = this.day;
    this.notify('bad', this.upgrades.crew || this.staff.gardener
      ? 'Golfers say the greens are worn around the cups. Tap a hole and use Repair green.'
      : 'Golfers say the greens are worn around the cups. Tap a hole and use Repair green, or buy the Grounds crew in Finances to keep turf healthy.');
  }

  private endDay() {
    const t = this.today;
    const sum: DaySummary = { ...t, day: this.day, profit: operatingProfit(t), net: netChange(t), avgSat: t.rounds ? t.satSum / t.rounds : 0 };
    this.campaign.profit += sum.profit;
    if (this.preferences.dailyReports) this.pendingRecap = sum;
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
    // after the new day's ledger exists, so a level grant earned here is booked rather than lost with yesterday's
    if (sum.profit > 0) awardExperience(this, 20);
    for (const member of [...this.members]) {
      member.happiness = Math.round(member.happiness * .8 + this.reputation * .2);
      if (member.happiness < 45) { this.members = this.members.filter(m => m !== member); this.notify('info', `${member.name} left the club after disappointing visits.`); }
      else this.earn('shop', 8 + this.clubLevel * 3, `Daily dues: ${member.name}`);
    }
    this.beginWeather();
    if (!this.practice) {
      const asked = rollRequests(this);
      if (asked) this.notify('info', `${asked.who} asks: \u201c${asked.text}\u201d See Goals.`);
      this.morning();
    }
    this.startEvent();
    this.dirtySave = true;
  }

  /** What happens as each day begins, also run for days that pass while the player is away. */
  morning() {
    if (this.fac.restaurant.functionDay !== undefined && this.fac.restaurant.functionDay < this.day) this.fac.restaurant.functionDay = undefined;
    this.identity = computeIdentity(this);
    growRoster(this);
    dailyRegulars(this);
    fadeProspects(this);
    refreshOffers(this);
    dailyDecisions(this);
    this.updateWear();
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
    const p = EVENTS[id].dated ? ['It is offered on set days: see the calendar.'] : this.eventProblemsFor(id);
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
    const route = routeOf(this, b);
    const problems = d.dated || d.tournament ? eventIssues(this, b.id, route).filter((p) => !p.startsWith('Course readiness')) : this.eventProblemsFor(b.id);
    if (problems.length) {
      this.notify('bad', `${d.name} was cancelled, no charge: ${problems[0]}`);
      return;
    }
    let total = eventGuests(b.id, b.fee, this.reputation);
    if (d.tournament) total = Math.round(total * (0.8 + this.prestige / 250) * (this.identity?.top === 'competitive' ? 1.15 : 1));
    if (b.id === 'memberday') total = this.members.length;
    if (b.id === 'function') total = 0;
    const prepCost = d.tournament ? applyPrep(this, route, b.prep ?? 'none') : 0;
    const memberCost = b.id === 'memberday' ? 25 * this.members.length : 0;
    this.spend('maintenance', d.cost + prepCost + memberCost, `Event setup: ${d.name}${prepCost ? ` (with ${b.prep} preparation)` : ''}`);
    this.activeEvent = { id: b.id, fee: b.fee, total, spawned: 0, nextAt: 0.5, revenue: 0, rounds: 0, satSum: 0, route: d.tournament || b.id === 'junior' ? (b.id === 'junior' ? route.slice(0, 3) : route) : undefined, prep: b.prep, access: d.tournament ? b.access ?? 'open' : 'open' };
    if (d.tournament) {
      this.activeEvent.board = [];
      this.activeEvent.readiness = readinessOf(this, route).score;
      this.activeEvent.gallery = 0;
      if (b.prep === 'championship' && this.setup !== 'championship') { this.setupBefore = this.setup; this.setSetup('championship'); }
    }
    if (b.id === 'function') {
      const fee = FAC.restaurant.functionFee[facLevel(this, 'restaurant')] || FAC.restaurant.functionFee[1];
      this.earn('shop', fee, 'Restaurant function');
      this.spend('maintenance', FAC.restaurant.functionCost, 'Function staff and food');
      this.activeEvent.revenue = fee - FAC.restaurant.functionCost;
      this.notify('good', `A private function has the dining room tonight: ${fmtMoney(fee)}. Golfers have fewer seats today.`);
      return;
    }
    this.notify('good', `${d.name} today: ${total} ${b.id === 'memberday' ? 'members' : 'golfers'} expected${d.tournament ? ` over ${route.length} holes. Follow the leaderboard in Calendar.` : ' for a shotgun start.'}`);
  }
  private fieldQueue: ReturnType<typeof fieldNames> = [];
  private eventArrivals() {
    const e = this.activeEvent;
    if (!e || e.spawned >= e.total || this.clock < e.nextAt) return;
    const d = EVENTS[e.id];
    if (e.spawned === 0) this.fieldQueue = d.tournament ? fieldNames(this, e.total, e.id) : e.id === 'memberday' ? this.members.map((m) => ({ name: m.name, type: m.type })) : [];
    const named = this.fieldQueue.shift();
    const reg = named?.regId ? findRegular(this, named.regId) : undefined;
    const fee = e.id === 'memberday' ? 0 : e.fee;
    const g = this.sim.spawn(named?.type ?? pickEventGolfer(e.id, this.rng), fee, { event: true, fair: EVENTS[e.id].fair, holes: e.route, name: named?.name, regId: named?.regId, skill: reg?.skill ?? named?.skill, seg: d.tournament ? 'field' : e.id === 'junior' ? 'junior' : undefined });
    if (g) {
      e.spawned++;
      e.revenue += fee;
      this.today.arrivals++;
      if (fee) this.earn('fees', fee, `Event entry, ${g.name}`);
      if (d.tournament && facLevel(this, 'tourney') >= 2) {
        e.gallery = (e.gallery ?? 0) + FAC.tourney.galleryPerPlayer;
        this.earn('fees', FAC.tourney.galleryPerPlayer, 'Grandstand tickets');
      }
      if (e.id === 'junior') addInterest(this, `${g.name.split(' ')[0]}'s parents`, 'beginner', 45, 'junior camp');
    }
    e.nextAt = this.clock + 35 / Math.max(1, e.total);
  }
  private finishEvent(day: number) {
    const e = this.activeEvent;
    if (!e) return;
    const report = tournamentReport(this, day) ?? undefined;
    if (report) { this.calendar.history.push(report); if (this.calendar.history.length > 6) this.calendar.history.shift(); }
    if (this.setupBefore) { this.setSetup(this.setupBefore); this.setupBefore = null; }
    if (e.id === 'memberday') {
      for (const m of this.members) m.happiness = Math.min(100, m.happiness + 12);
      for (const r of this.regulars.list.filter((x) => x.member)) r.happiness = Math.min(100, r.happiness + 10);
      for (const p of [...this.regulars.prospects]) addInterest(this, p.name, p.type, 40, 'member appreciation day');
    }
    const res: EventResult = { id: e.id, day, guests: e.spawned, revenue: e.revenue, cost: EVENTS[e.id].cost, rounds: e.rounds, avgSat: e.rounds ? e.satSum / e.rounds : 0, report };
    this.lastEvent = res;
    this.stats.events++;
    this.campaign.events++;
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

  /** Big moments waiting for the interface to celebrate them, oldest first. */
  cheers: Cheer[] = [];
  cheer(c: Cheer) {
    this.cheers.push(c);
    if (this.cheers.length > 4) this.cheers.shift();
    this.onFeedback(c.kind === 'level' ? 'level' : 'reward');
  }
  daily: DailyState = freshDaily();
  /** The practice course the tutorial runs on: no goals, no streaks, not the player's real club. */
  practice = false;
  /** Collect the streak reward. */
  claimStreak(): number {
    const n = this.daily.pending;
    if (!n) return 0;
    this.daily.pending = 0;
    this.earn('bonus', n, `Day ${this.daily.streak} streak`);
    awardExperience(this, 10 + 5 * Math.min(7, this.daily.streak));
    this.onFeedback('reward');
    this.dirtySave = true;
    return n;
  }
  /** Collect a finished daily challenge. */
  claimChallenge(i: number): number {
    const c = this.daily.challenges[i];
    if (!c || c.claimed || !challengeDone(this, c)) return 0;
    c.claimed = true;
    this.earn('bonus', c.reward, `Daily challenge: ${KINDS[c.kind].title(c.target)}`);
    awardExperience(this, c.xp);
    this.onFeedback('reward');
    this.dirtySave = true;
    if (this.daily.challenges.every((x) => x.claimed)) {
      this.earn('bonus', 500, 'All daily challenges done');
      this.cheer({ kind: 'daily', title: 'All three done!', sub: 'New challenges arrive tomorrow. Keep your streak going.', reward: 500 });
    }
    return c.reward;
  }
  /** The goal just reached, waiting for the interface to celebrate it. */
  goalJustDone: { title: string; reward: number; next: string | null } | null = null;
  /** Pay for any request that has been put right. */
  checkRequests() {
    const st = this.requests;
    if (!st.list.length) return;
    for (const r of [...st.list]) {
      if (!requestDone(this, r)) continue;
      st.list = st.list.filter((x) => x !== r);
      this.earn('bonus', r.reward, `Guest request: ${r.text}`);
      awardExperience(this, 20);
      this.cheer({ kind: 'request', title: 'Request done', sub: `${r.who} noticed. \u201c${r.text}\u201d`, reward: r.reward });
      this.dirtySave = true;
    }
  }
  /** Advance the goal chain: one goal at a time, each paying its grant. */
  checkGoals() {
    if (this.practice) return;
    this.checkRequests();
    // every goal is checked on its own: anything reached is recognised and paid once, in whatever order it happened
    const done = (this.campaign.done ??= []);
    const reached: typeof CHAIN = [];
    for (const goal of CHAIN) {
      if (done.includes(goal.id) || !goalMet(this, goal)) continue;
      done.push(goal.id);
      reached.push(goal);
      this.earn('bonus', goal.reward, 'Goal: ' + goal.title);
      awardExperience(this, Math.round(goal.reward / 18));
    }
    if (!reached.length) return;
    const next = CHAIN.find((c) => !done.includes(c.id)) ?? null;
    this.campaign.step = next ? CHAIN.indexOf(next) : CHAIN.length;
    this.campaign.goalId = next?.id ?? 'complete';
    const first = reached[0];
    this.goalJustDone = { title: reached.length > 1 ? `${first.title} and ${reached.length - 1} more` : first.title, reward: reached.reduce((s2, x) => s2 + x.reward, 0), next: next ? next.title : null };
    this.onFeedback('reward');
    this.dirtySave = true;
  }
  /**
   * Mark, without paying, goals the course has already met. A ready-made course (all) comes with everything it already has;
   * an older save marks those up to the first one it has not met, and anything further it has achieved is recognised and paid
   * by the next check, since under the old chain it simply had not been reached in order.
   */
  catchUpGoals(all = false) {
    const done = (this.campaign.done ??= []);
    for (const c of CHAIN) {
      if (done.includes(c.id)) continue;
      if (!goalMet(this, c)) { if (all) continue; break; }
      done.push(c.id);
    }
    const next = CHAIN.find((c) => !done.includes(c.id));
    this.campaign.step = next ? CHAIN.indexOf(next) : CHAIN.length;
    this.campaign.goalId = next?.id ?? 'complete';
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
  /** Change a hole's par. It is the player's choice and edits to the layout keep it. */
  setHolePar(id: number, par: number) {
    const h = this.world.holes.find((x) => x.id === id);
    if (!h || ![3, 4, 5].includes(par) || h.par === par) return;
    h.par = par;
    this.world.version++;
    this.dirtySave = true;
  }

  /** Send three free simulated golfers (beginner, regular, skilled) round one open hole. */
  sendTestGolfers(id: number, types: readonly ('beginner' | 'regular' | 'skilled')[] = ['beginner', 'regular', 'skilled']): number {
    const h = this.world.holes.find((x) => x.id === id);
    if (!h) return 0;
    if (!h.open) { this.notify('bad', `Open hole ${id} first. Test golfers only play open holes.`); return 0; }
    let n = 0;
    for (const type of types) {
      if (this.sim.golfers.length >= 40) break;
      if (this.sim.spawn(type, 0, { test: true, holes: [id] })) n++;
    }
    if (n) this.notify('good', `${n} test golfers sent to hole ${id}.`);
    return n;
  }

  private validations = new Map<number, { key: string; v: Validation }>();
  /** Validation is a flood fill, so remember it until the ground or the hole's pins change. */
  validate(id: number): Validation {
    const h = this.hole(id);
    const key = `${this.world.layout ?? 0}:${this.world.holes.length}:${h.tee.x},${h.tee.y},${h.cup.x},${h.cup.y}:${JSON.stringify(h.bends ?? h.bend)}:${h.par}`;
    const hit = this.validations.get(id);
    if (hit && hit.key === key) return hit.v;
    const v = validateHole(this.world, h);
    this.validations.set(id, { key, v });
    return v;
  }

  openHole(id: number): Validation {
    const h = this.hole(id);
    const v = validateHole(this.world, h);
    if (!v.ok) {
      this.notify('bad', `Hole ${id} can't open yet: ${v.problems[0].split(/(?<=\.) /)[0]} The Course panel shows how to fix it.`);
      return v;
    }
    if (!h.open) {
      h.open = true;
      delete h.awaiting;
      h.reopenedAt = this.total;
      this.world.version++;
      this.notify('good', `Hole ${id}, ${h.name}, is open.`);
      this.checkGoals();
      this.dirtySave = true;
    }
    return v;
  }

  closeHole(id: number, quiet = false) {
    const h = this.hole(id);
    if (!h.open) return;
    h.open = false;
    delete h.awaiting; // closed on purpose; building work sets the reminder again after this
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
    if (id === 'carts' && this.fleet < FLEET_BASE) this.fleet = FLEET_BASE;
    this.updateWear();
    this.notify('good', `${u.name} purchased.`);
    this.dirtySave = true;
    return true;
  }

  /** Apply a planned edit. Charges exactly once, closes any open hole it touches, records undo. */
  commitEdit(plan: EditPlan, redo = false): { ok: boolean; message: string } {
    // Any edit made through a panel (not only the build tray) counts as designing: time holds until the player resumes.
    // Turf repair is the exception: it is upkeep, not design, so the hole stays open and the clock keeps running.
    const upkeep = isUpkeep(plan);
    if (!upkeep && (plan.tiles.length || plan.hole || plan.newHole || plan.removedHole)) this.enterDesign();
    if (!plan.tiles.length && !plan.hole && !plan.newHole && !plan.removedHole) return { ok: false, message: 'Nothing would change.' };
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
    if (plan.removedHole) this.closeHole(plan.removedHole.id, true);
    applyPlan(this.world, plan, 'do');
    if (plan.cost) this.spend('construction', plan.cost, plan.label);
    else this.logEntry(plan.label, 0);
    this.undoStack.push({ plan, cost: plan.cost });
    if (this.undoStack.length > 60) this.undoStack.shift();
    if (!redo) this.redoStack = [];
    this.afterTerrainChange(touched, before, upkeep);
    this.dirtySave = true;
    if (plan.newHole) {
      this.selectedHole = plan.newHole.id;
      const built = this.world.holes.find((h) => h.id === plan.newHole!.id);
      if (built && !built.open) built.awaiting = true;
      this.notify('good', `Hole ${plan.newHole.id} built. Open it to let golfers play.`);
    }
    if (plan.removedHole && this.selectedHole === plan.removedHole.id) this.selectedHole = this.world.holes[0]?.id ?? 1;
    return { ok: true, message: `${plan.label}: ${plan.tiles.length} tiles, ${fmtMoney(plan.cost)}` };
  }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    const upkeep = isUpkeep(e.plan);
    if (!upkeep) this.enterDesign();
    const touched = touchedHoles(this.world, e.plan);
    if (e.plan.newHole) this.closeHole(e.plan.newHole.id, true);
    applyPlan(this.world, e.plan, 'undo');
    this.cash += e.cost;
    this.today.construction -= e.cost;
    this.redoStack.push(e);
    this.logEntry(`Undo: ${e.plan.label}`, e.cost);
    this.afterTerrainChange(touched, null, upkeep);
    if (!this.world.holes.some((h) => h.id === this.selectedHole)) this.selectedHole = e.plan.removedHole?.id ?? this.world.holes[0]?.id ?? 1;
    for (const id of touched) {
      const h = this.world.holes.find((x) => x.id === id);
      if (!h) continue;
      if (holeCondition(this.world, h).green < 50) h.fixedGreenAt = -1;
    }
    this.notify('info', `Undid ${e.plan.label}.${e.cost ? ` ${fmtMoney(e.cost)} refunded.` : ''}`);
    this.dirtySave = true;
    return true;
  }

  /** Re-apply the edit most recently undone, at its original price. */
  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    const r = this.commitEdit(e.plan, true);
    if (!r.ok) this.redoStack.push(e);
    return r.ok;
  }

  private afterTerrainChange(touched: number[], greenBefore: Map<number, number> | null, keepOpen = false) {
    // a renovation begins: remember how the hole played, so the report can compare once golfers have played it again
    if (!keepOpen) for (const id of touched) {
      const h = this.world.holes.find((x) => x.id === id);
      if (!h || !h.log || h.log.length < 4) continue;
      const inProgress = h.reno && summarisePlays(h.log.filter((p) => p.day >= h.reno!.day)).n < 3 && (h.log[h.log.length - 1]?.day ?? 0) <= h.reno.day;
      if (inProgress) continue;
      const q = holeQuality(this.world, h, this.qualityCtx);
      h.reno = { day: this.day, before: summarisePlays(h.log, q.overall) };
      h.log = [];
    }
    computeZones(this.world);
    for (const id of touched) {
      const h = this.world.holes.find((x) => x.id === id);
      if (!h) continue;
      if (h.open && !keepOpen) {
        this.closeHole(id, true);
        h.awaiting = true;
        this.notify('info', `Hole ${id} closed for work. Reopen it when you are done.`);
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
    this.notify('good', `Land bought for ${fmtMoney(price)}.`);
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
    this.notify('good', `${next.name} built. Demand, spending and satisfaction rise.`);
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
  /** Remove a hole entirely. Its ground stays as it is, and the removal can be undone. */
  removeHole(id: number): boolean {
    const plan = planRemoveHole(this.world, id);
    if (typeof plan === 'string') {
      this.notify('bad', plan);
      return false;
    }
    const r = this.commitEdit(plan);
    if (r.ok) this.notify('info', `Hole ${id} removed. Its fairway and green are left as they were. Undo brings it back.`);
    return r.ok;
  }
  setName(name: string) {
    const n = name.trim().slice(0, 28);
    if (n) this.name = n;
    this.dirtySave = true;
  }

  /** Catch up on time spent away: a modest, simplified version of the days that passed. */
  applyAway(seconds: number): { days: number; net: number } | null {
    if (seconds < CFG.offline.minAwaySeconds) return null;
    // Time was held when the player left (paused, designing, or the course never opened), so nothing happened while away.
    if (!this.settings.open || this.settings.paused || !this.world.clubhouse) return null;
    const days = Math.min(CFG.offline.maxDays, Math.floor(seconds / CFG.offline.realSecondsPerDay));
    if (days < 1) return null;
    let net = 0;
    for (let d = 0; d < days; d++) {
      const arrivals = this.arrivalRate * CFG.offline.efficiency;
      const fees = BANDS.reduce((s, b) => s + this.bandArrivals(b.id) * CFG.offline.efficiency * this.fees[b.id], 0);
      const shop = arrivals * (CFG.economy.shopBase + this.reputation * CFG.economy.shopSatFactor + 1.5 + (this.upgrades.snackBar ? CFG.extras.snackSpend : 0)) * (this.upgrades.proShop ? CFG.economy.proShopMultiplier : 1) * this.club.shop;
      const maint = this.maintenanceRate * CFG.day.hours + this.dailyWages;
      // the restaurant and academy keep working too, at the same quieter pace
      const meals = facLevel(this, 'restaurant') ? Math.min(seatsToday(this), arrivals * 0.3 + restaurantSetting(this.world).locals * CFG.offline.efficiency) * mealMargin(this) : 0;
      const lessons = facLevel(this, 'academy') ? Math.min(this.fac.academy.coaches * FAC.academy.lessonsPerCoach[facLevel(this, 'academy')], arrivals * 0.12) * FAC.academy.lessonFee : 0;
      const profit = Math.round(fees + shop + meals + lessons - maint);
      this.cash += profit;
      net += profit;
      this.stats.rounds += Math.round(arrivals);
      this.campaign.rounds += Math.round(arrivals);
      this.campaign.profit += profit;
      this.stats.revenue += Math.round(fees + shop);
      this.stats.bestDayProfit = Math.max(this.stats.bestDayProfit, profit);
      // regulars keep coming while you are away; pupils keep taking lessons (one a day, if the academy has coaches)
      for (const r of this.regulars.list) {
        if (this.day - r.lastVisit < (r.kind === 'competitor' || r.kind === 'socialite' ? 2 : 1)) continue;
        r.visits++; r.lastVisit = this.day;
        if ((r.kind === 'learner' || r.kind === 'junior') && facLevel(this, 'academy') && this.fac.academy.coaches > 0 && !r.goal.done) { regularLesson(this, r, academyPractice(this.world).quality); this.cash += FAC.academy.lessonFee; net += FAC.academy.lessonFee; }
      }
      this.day++;
      this.today = emptyLedger();
      this.morning();
    }
    this.stats.years = yearOf(this.day);
    this.pendingRecap = null;
    // Offline income represents completed days, so stale on-course actors cannot resume those days.
    this.sim.golfers = []; this.sim.queues.clear(); this.sim.tee.clear(); this.activeEvent = null;
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

/** Reseeding turf: the ground keeps its kind and its trees, only its condition changes. Golfers can play straight through it. */
const isUpkeep = (plan: EditPlan) => !plan.hole && !plan.newHole && !plan.removedHole && plan.tiles.length > 0 && plan.tiles.every((t) => t.before.t === t.after.t && t.before.tr === t.after.tr);

export const fmtMoney = (n: number) => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
