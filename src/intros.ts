import type { Game } from './game';
import type { Editor } from './input';
import type { UI } from './ui';
import type { ToolId } from './editing';
import { CHAIN, currentGoal } from './campaign';
import { EVENT_IDS } from './events';
import { CLUB_LEVELS, SEASON_DAYS, seasonIndex } from './progression';
import { CFG } from './config';
import { countOf, isBuilding } from './items';
import { holeCondition, parFor } from './terrain';
import { suggestFirstHole } from './wilderness';
import { escapeHtml } from './panels';

/**
 * Introductions: short, one-at-a-time explanations of a system, shown the first time it matters.
 * The first-session tutorial (tutorial.ts) teaches only what one hole needs; everything else is in this list.
 *
 * Rules the engine keeps, whatever an entry's trigger says:
 * - never during the tutorial, a placement, a stroke, a confirm bar, a dialog, the menu or a celebration
 * - one at a time, and at least COOLDOWN seconds of play after the last one (the first waits FIRST_WAIT after the tutorial)
 * - each is marked seen the moment it appears, so it never comes back, whether it was used, dismissed or ignored
 * - everything is switched off by the "Show tips" setting
 */
export const COOLDOWN = 240;
export const FIRST_WAIT = 120;
/** First-use tips for tools and panels share the same gate, with a shorter rest between them. */
export const TIP_COOLDOWN = 45;

export interface ShowMe {
  label?: string;
  tab?: 'course' | 'guests' | 'money' | 'events' | 'club' | 'journey';
  tool?: ToolId;
  tray?: 'course' | 'decor' | 'buildings';
  /** a control to ring once there */
  ring?: string;
}
export interface Intro {
  id: string;
  title: string;
  text: string;
  more?: string;
  /** a control to ring while the card is up */
  ring?: string[];
  show?: ShowMe;
  /** the moment it matters */
  when: (g: Game, env: Env) => boolean;
  /** shown without waiting out the cooldown (still never during the busy moments) */
  free?: boolean;
}
/** What the engine knows about the player's hands right now. */
export interface Env {
  /** seconds of real play */
  playSec: number;
  /** the active tool */
  tool: string;
}

const MENU_RING = ['#fab'];
const openHoles = (g: Game) => g.openHoles.length;
const wornHole = (g: Game) => g.openHoles.some((h) => { const c = holeCondition(g.world, h); return c.green < CFG.turf.wornBelow + 15 || c.wornShare > 0.15; });

/** In the order they are likely to be needed. */
export const INTROS: Intro[] = [
  {
    id: 'goals',
    title: 'Goals',
    text: 'Goals in the menu show what to build next, and each one pays a grant.',
    more: 'Open the menu, then Goals. Tap Show me on the current goal and the game points to the control to use.',
    ring: MENU_RING,
    show: { label: 'Show goals', tab: 'journey' },
    free: true,
    when: () => true,
  },
  {
    id: 'bends',
    title: 'Bends',
    text: 'A hole can bend. Once the green is down, tap + Bend, then tap where the fairway should turn.',
    more: 'A bend, or dogleg, makes golfers choose a line. Drag a bend to move it, tap it to remove it. Straight puts the hole back as it was.',
    when: (g, env) => g.world.holes.length === 1 && env.tool === 'build',
  },
  {
    id: 'shaping',
    title: 'Fairway and rough',
    text: 'Paint fairway and rough to shape a hole. Hold, then drag; or tap for a single patch.',
    more: 'Golfers aim for fairway and lose distance from rough. Wide fairways suit beginners; narrow ones test skilled players. Nothing is charged until you tap Build.',
    show: { label: 'Open Design', tool: 'fairway' },
    when: (g) => g.world.holes.length >= 2,
  },
  {
    id: 'bands',
    title: 'Tee-time prices',
    text: 'Early, midday and twilight tee times each have their own fee.',
    more: 'Mornings are in demand and twilight is quieter, so a lower twilight fee can fill the late tee sheet. Guests judge each fee against what they think is fair.',
    ring: MENU_RING,
    show: { label: 'Open Finances', tab: 'money', ring: '[data-act="bandfee"]' },
    when: (g) => g.days.length >= 1,
  },
  {
    id: 'upkeep',
    title: 'Running costs',
    text: 'Yesterday cost more than it earned. Upkeep is charged every game hour.',
    more: 'Maintenance, staff wages and building upkeep all count. More open holes bring more guests but cost more to keep. Finances shows today in detail.',
    ring: MENU_RING,
    show: { label: 'Open Finances', tab: 'money' },
    when: (g) => g.days.some((d) => d.profit < 0),
  },
  {
    id: 'turf',
    title: 'Worn turf',
    text: 'Turf wears where golfers play. A worn green plays badly and guests notice.',
    more: 'Open the hole in Course and tap Repair green. The hole closes while it is being fixed. A grounds crew and a maintenance shed slow the wear.',
    show: { label: 'Open Course', tab: 'course' },
    when: wornHole,
  },
  {
    id: 'golfers',
    title: 'Golfers',
    text: 'Golfers shows how happy your guests are, and why.',
    more: 'Satisfaction comes from price, conditions, difficulty and pace. Recent comments point at what to fix. Tap Follow to watch one golfer play.',
    ring: MENU_RING,
    show: { label: 'Open Golfers', tab: 'guests' },
    when: (g) => g.stats.rounds >= 5 || g.recent.some((r) => r.total < 45),
  },
  {
    id: 'stars',
    title: 'Course rating',
    text: 'Your course is rated in stars. Stars lift demand and fees.',
    more: 'The rating grows with open holes, turf condition, happy guests, improvements and the clubhouse level. Higher ratings also unlock clubhouse upgrades and bigger events.',
    ring: MENU_RING,
    show: { label: 'Open Clubhouse', tab: 'club' },
    when: (g) => g.stars >= 1 || (g.stars >= 0.5 && openHoles(g) >= 3),
  },
  {
    id: 'b-shed',
    title: 'Maintenance shed',
    text: 'With four holes, turf wear adds up. A maintenance shed slows it by about 15%.',
    more: 'Find it under Buildings in Design. It costs upkeep every day, so it pays for itself on a busier course.',
    show: { label: 'Open Buildings', tool: 'decor', tray: 'buildings' },
    when: (g) => openHoles(g) >= 4,
  },
  {
    id: 'b-halfway',
    title: 'Halfway house',
    text: 'With six holes, a halfway house makes sense. Golfers spend more at the clubhouse after a snack.',
    more: 'Place it on rough between holes, not on a fairway, tee or green. A second one adds a little more.',
    show: { label: 'Open Buildings', tool: 'decor', tray: 'buildings' },
    when: (g) => openHoles(g) >= 6,
  },
  {
    id: 'paths',
    title: 'Cart paths',
    text: 'A path helps golfers walk to a building or a distant tee. Paint one with the Path tool.',
    more: 'Golfers walk faster on paths, and a path across water becomes a bridge, which some holes need.',
    show: { label: 'Pick Path', tool: 'path' },
    when: (g) => (g.world.items ?? []).some((it) => isBuilding(it.k)),
  },
  {
    id: 'b-barn',
    title: 'Cart barn',
    text: 'A cart barn lets you keep up to 16 carts instead of 6.',
    more: 'Carts rent for a second fee. More carts serve more guests, but only if guests think the price is fair.',
    show: { label: 'Open Buildings', tool: 'decor', tray: 'buildings' },
    when: (g) => openHoles(g) >= 8 || (g.upgrades.carts && openHoles(g) >= 5),
  },
  {
    id: 'fleet',
    title: 'Carts',
    text: 'Your barn holds more carts. Buy them in Finances and set the rental price there.',
    more: 'About a third of golfers rent a cart at a fair price. A higher price means fewer rentals.',
    ring: MENU_RING,
    show: { label: 'Open Finances', tab: 'money' },
    when: (g) => countOf(g.world, 'barn') >= 1,
  },
  {
    id: 'amenities',
    title: 'Improvements',
    text: 'You can afford an improvement now. A snack bar or pro shop earns more from every round.',
    more: 'Improvements are in Finances. Each adds a little upkeep and most raise satisfaction too.',
    ring: MENU_RING,
    show: { label: 'Open Finances', tab: 'money', ring: '[data-act="buy"]' },
    when: (g) => openHoles(g) >= 2 && g.cash >= 1500 && Object.values(g.upgrades).filter(Boolean).length === 0,
  },
  {
    id: 'staff',
    title: 'Staff',
    text: 'A bigger course keeps staff busy. A greenkeeper mends turf and a ranger keeps play moving.',
    more: 'Staff are paid every day. Hire from the Clubhouse panel and let go of anyone you no longer need.',
    ring: MENU_RING,
    show: { label: 'Open Clubhouse', tab: 'club' },
    when: (g) => openHoles(g) >= 5,
  },
  {
    id: 'clubup',
    title: 'Clubhouse upgrade',
    text: 'You can upgrade the clubhouse. It raises demand, sales and the number of holes you may build.',
    more: 'Each level needs a minimum course rating and some cash.',
    ring: MENU_RING,
    show: { label: 'Open Clubhouse', tab: 'club', ring: '[data-act="club"]' },
    when: (g) => g.clubLevel === 0 && g.stars >= CLUB_LEVELS[1].minStars,
  },
  {
    id: 'members',
    title: 'Members',
    text: 'A happy guest has joined as a member. Members pay daily dues.',
    more: 'Members leave if their rounds disappoint, so keep conditions and pace good. A club host helps recruit.',
    ring: MENU_RING,
    show: { label: 'Open Golfers', tab: 'guests' },
    when: (g) => g.members.length >= 1,
  },
  {
    id: 'events',
    title: 'Events',
    text: 'You can host an event now: a one-day crowd of paying golfers.',
    more: 'Each event lists what it needs. Setup is charged when the day starts, and you can cancel a booking for free before then.',
    ring: MENU_RING,
    show: { label: 'Open Events', tab: 'events' },
    when: (g) => openHoles(g) >= 2 && EVENT_IDS.some((id) => g.eventProblemsFor(id).length === 0),
  },
  {
    id: 'seasons',
    title: 'Seasons',
    text: 'The season has changed. Demand and turf wear shift through the year.',
    more: 'Each season lasts four days. The Clubhouse panel shows what the next one brings in your region, so you can price and plan for it.',
    ring: MENU_RING,
    show: { label: 'Open Clubhouse', tab: 'club' },
    when: (g) => g.day > SEASON_DAYS && seasonIndex(g.day) !== 0,
  },
  {
    id: 'daily',
    title: 'Daily challenges',
    text: 'Three new challenges arrive each day you play, and a streak pays more every day you return.',
    more: 'Challenges are small and optional. Collect each one in Goals when it is done.',
    ring: MENU_RING,
    show: { label: 'Open Goals', tab: 'journey' },
    free: true,
    when: (g) => g.daily.challenges.length > 0,
  },
];
export const introById = (id: string) => INTROS.find((i) => i.id === id);

// ---- the rules, as pure functions so they can be tested ----

export interface Gate { busy: boolean }
export const introsSeen = (g: Game) => (g.preferences.introsSeen ??= []);
export const introsOn = (g: Game) => !g.preferences.introsOff;

/**
 * The introduction to show now, or null. `busy` is true while the player is placing, painting, confirming,
 * in a dialog or menu, or something else is on screen.
 */
export function pickIntro(g: Game, env: Env, busy: boolean): Intro | null {
  const p = g.preferences;
  if (busy || p.introsOff || !g.tutorial.done) return null;
  const since = env.playSec - (p.introAt ?? env.playSec);
  for (const i of INTROS) {
    if (introsSeen(g).includes(i.id)) continue;
    if (!i.when(g, env)) continue;
    // a first introduction waits a little after the tutorial; the rest wait the full cooldown after the one before
    if (i.free ? since < 6 : since < (p.introsSeen!.length ? COOLDOWN : FIRST_WAIT)) continue;
    // tool and panel tips count too, so nothing arrives right on top of one
    if (env.playSec - (p.tipAt ?? -999) < 20) continue;
    return i;
  }
  return null;
}
/** Record that an introduction was shown (so it never returns) and start the rest. */
export function markIntro(g: Game, id: string, playSec: number) {
  const seen = introsSeen(g);
  if (!seen.includes(id)) seen.push(id);
  g.preferences.introAt = playSec;
  g.dirtySave = true;
}
/** First-use tips (a tool or a panel) share the gate: off with the setting, spaced out, and never right after an introduction. */
export function tipAllowed(g: Game, playSec: number): boolean {
  const p = g.preferences;
  if (p.introsOff) return false;
  return playSec - Math.max(p.tipAt ?? -999, p.introAt ?? -999) >= TIP_COOLDOWN;
}

/** The suggested spots for the next hole, worked out from where the last one ends. */
export function nextHoleSuggestion(g: Game) {
  const holes = g.world.holes;
  return suggestFirstHole(g.world, holes.length ? { avoid: holes, near: holes[holes.length - 1].cup } : {});
}

/** Shows introductions on the coach card (the tutorial and the introductions never appear together) and guides holes two and three. */
export class Intros {
  private card = document.getElementById('coach')!;
  private current: Intro | null = null;
  private more = false;
  private shownAt = 0;
  private ring: HTMLElement | null = null;
  private tick = 0;
  private guideKey = '';
  private guideSpot: { tee: { x: number; y: number }; cup: { x: number; y: number } } | null = null;
  private followUntil = 0;
  private frameAt = 0;

  constructor(private g: Game, private e: Editor, private ui: UI) {
    this.card.addEventListener('click', (ev) => {
      if (this.card.dataset.owner !== 'intro') return;
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-intro]');
      if (!b) return;
      const act = b.dataset.intro;
      if (act === 'more') { this.more = !this.more; this.render(); }
      else if (act === 'ok') this.close();
      else if (act === 'show') { const s = this.current?.show; this.close(); if (s) this.ui.showMe(s); }
    });
  }

  /** Real play time: counted while the page is in front, once the tutorial is out of the way. */
  addPlay(dt: number) {
    if (!document.hidden && this.g.tutorial.done) this.g.preferences.playSec = (this.g.preferences.playSec ?? 0) + dt;
  }
  get playSec() { return this.g.preferences.playSec ?? 0; }

  /** True when something the player is doing, or something already on screen, means "not now". */
  private busy(): boolean {
    const e = this.e, ui = this.ui, g = this.g;
    return (
      ui.modalOpen || ui.menuOpen || ui.introOpen || g.pendingRecap !== null || g.owner.active || document.hidden ||
      e.placing || !!document.getElementById('goalpop') || !!document.getElementById('tip') || g.cheers.length > 0 || !!g.goalJustDone ||
      document.body.classList.contains('coaching') || (ui.tab !== 'none' && ui.tab !== 'build')
    );
  }

  /** Called a few times a second. */
  update() {
    const g = this.g;
    if (!g.tutorial.done) return;
    if (g.preferences.introAt === undefined) { g.preferences.introAt = this.playSec; g.dirtySave = true; }
    this.guide();
    if (this.current) {
      // an introduction steps aside the moment the player starts something, and fades on its own
      if (this.busy() && this.card.dataset.owner === 'intro' && performance.now() - this.shownAt > 1500 && (this.e.placing || this.ui.modalOpen || this.ui.menuOpen)) this.close();
      else if (performance.now() - this.shownAt > 30000 && !this.more) this.close();
      this.followRing();
      return;
    }
    if (++this.tick % 4) return;
    const intro = pickIntro(g, { playSec: this.playSec, tool: this.e.tool }, this.busy());
    if (intro) this.open(intro);
    else this.followRing();
  }

  private open(i: Intro) {
    markIntro(this.g, i.id, this.playSec);
    this.current = i;
    this.more = false;
    this.shownAt = performance.now();
    this.card.dataset.owner = 'intro';
    this.card.hidden = false;
    document.body.classList.add('introing');
    this.render();
    this.guideKey = ''; // frame the suggested spots again, in the space the card leaves free
    if (i.id === 'bends') this.followUntil = performance.now() + 90000;
  }
  private render() {
    const i = this.current;
    if (!i) return;
    this.card.dataset.step = 'intro';
    this.card.innerHTML = `<div class="coach-row"><p class="coach-short"><b class="intro-k">${escapeHtml(i.title)}</b> ${escapeHtml(this.text(i))}</p>${i.show ? `<button class="btn primary coach-next" data-intro="show">${escapeHtml(i.show.label ?? 'Show me')}</button>` : ''}</div><div class="coach-actions">${i.more ? `<button class="coach-x" data-intro="more">${this.more ? 'Less' : 'More'}</button>` : ''}<button class="coach-x" data-intro="ok">Got it</button></div>${this.more && i.more ? `<div class="coach-more"><p>${escapeHtml(i.more)}</p></div>` : ''}`;
    this.setRing(i.ring ?? []);
    this.ui.onInsets();
  }
  private text(i: Intro) {
    if (i.id === 'goals') { const goal = currentGoal(this.g); return goal ? `Your next goal: ${goal.title}. ${i.text}` : i.text; }
    return i.text;
  }
  private close() {
    this.current = null;
    this.card.hidden = true;
    this.card.dataset.owner = '';
    this.card.innerHTML = '';
    document.body.classList.remove('introing');
    this.setRing([]);
    this.ui.onInsets();
  }
  private setRing(sels: string[]) {
    let el: HTMLElement | null = null;
    for (const s of sels) { el = [...document.querySelectorAll<HTMLElement>(s)].find((x) => x.getClientRects().length > 0) ?? null; if (el) break; }
    if (el === this.ring) return;
    this.ring?.classList.remove('coach-target');
    this.ring = el;
    el?.classList.add('coach-target');
  }
  /** The +Bend button only exists once a hole is placed, so the ring for the bends introduction follows the player there. */
  private followRing() {
    if (this.followUntil && performance.now() < this.followUntil && this.g.world.holes.length === 1 && this.e.proposal?.newHole && !this.e.addingBend) this.setRing(['#cfBend']);
    else if (!this.current) this.setRing([]);
  }

  /** After the tutorial, holes two and three get the same glowing tee and green suggestions. They can be hidden in one tap, for good. */
  private guide() {
    const g = this.g, e = this.e;
    const n = g.world.holes.length;
    const on = !g.preferences.holeGuideOff && !g.preferences.introsOff && n <= 2 && e.tool === 'build' && !e.proposal && !e.bGhost && g.world.clubhouse !== null;
    if (!on) { if (this.guideKey) { this.guideKey = ''; e.overlay.hint = null; } return; }
    const key = `${n}`;
    if (this.guideKey !== key) {
      this.guideKey = key;
      this.guideSpot = nextHoleSuggestion(g);
      if (this.guideSpot) {
        // pick the par the suggestion fits, so its length is not flagged as wrong
        e.newPar = parFor(Math.hypot(this.guideSpot.cup.x - this.guideSpot.tee.x, this.guideSpot.cup.y - this.guideSpot.tee.y));
        // frame once the bars have settled, so the glow is clear of them
        this.frameAt = performance.now() + 450;
      }
    }
    const s = this.guideSpot;
    if (s && this.frameAt && performance.now() > this.frameAt) { this.frameAt = 0; this.ui.onInsets(); e.focusPoints([s.tee, s.cup]); }
    e.overlay.hint = s ? (e.buildStarted ? { cup: s.cup } : { tee: s.tee }) : null;
  }
}

export { CHAIN };
