
import { LOGO_COLORS, LOGO_ICONS, LOGO_LETTERING, LOGO_NAMES, LOGO_PATTERNS, LOGO_SHAPES, Logo, defaultLogo, drawLogo, initialsOf } from './logo';
import type { NewGameOptions } from './game';
import { REGIONS, REGION_IDS, RegionId } from './progression';
import { BANNER_ART, REGION_ART, levelFlags } from './start-art';
import { flagMark, icon } from './icons';
import { CFG } from './config';
import { regionsDone } from './save';

/** Easiest first, so the choice reads as a ladder. */
const ORDER = [...REGION_IDS].sort((a, b) => REGIONS[a].level - REGIONS[b].level);

export function paintLogo(canvas: HTMLCanvasElement, logo: Logo) {
  const s = canvas.width;
  const c = canvas.getContext('2d')!;
  c.clearRect(0, 0, s, s);
  drawLogo(c, s / 2, s / 2, s * 0.94, logo);
}

const COLOUR_NAMES = ['Forest green', 'Fairway green', 'Teal', 'Sky blue', 'Blue', 'Navy', 'Purple', 'Pink', 'Red', 'Maroon', 'Orange', 'Gold', 'Cream', 'Grey', 'Charcoal', 'White'];

/**
 * The emblem designer: shape, background, emblem, lettering and two colours, with a live preview. Shapes, backgrounds
 * and emblems are shown as small pictures of the player's own crest with that one thing changed, so each choice shows
 * what it would look like. Built once; a tweak only moves the highlight and repaints. Calls onChange after every tweak.
 */
export function logoDesigner(root: HTMLElement, logo: Logo, getName: () => string, onChange: (l: Logo) => void): () => void {
  logo.pattern ??= 'plain';
  logo.lettering ??= 'serif';
  const pics = (k: string, vals: string[]) => `<div class="opts pics" data-k="${k}">${vals.map((v) => `<button class="opt pic" data-v="${v}" aria-label="${LOGO_NAMES[v] ?? v}" title="${LOGO_NAMES[v] ?? v}"><canvas width="88" height="88"></canvas></button>`).join('')}</div>`;
  const words = (k: string, vals: string[]) => `<div class="opts" data-k="${k}">${vals.map((v) => `<button class="opt" data-v="${v}">${LOGO_NAMES[v] ?? v}</button>`).join('')}</div>`;
  const swatches = (k: string) => `<div class="opts" data-k="${k}">${LOGO_COLORS.map((c, i) => `<button class="sw" data-v="${c}" style="background:${c}" aria-label="${COLOUR_NAMES[i] ?? c}" title="${COLOUR_NAMES[i] ?? c}"></button>`).join('')}</div>`;
  root.innerHTML = `
      <div class="logo-prev"><canvas width="140" height="140" id="lgPrev"></canvas></div>
      <div class="logo-opts">
        <div class="lbl">Shape</div>${pics('shape', LOGO_SHAPES)}
        <div class="lbl">Background</div>${pics('pattern', LOGO_PATTERNS)}
        <div class="lbl">Emblem</div>${pics('icon', LOGO_ICONS)}
        <div class="lbl">Lettering</div>${words('lettering', LOGO_LETTERING)}
        <div class="lbl">Main colour</div>${swatches('primary')}
        <div class="lbl">Accent colour</div>${swatches('secondary')}
      </div>`;
  const update = () => {
    logo.initials = initialsOf(getName());
    paintLogo(root.querySelector('#lgPrev') as HTMLCanvasElement, logo);
    root.querySelectorAll<HTMLElement>('.opts').forEach((row) => {
      const k = row.dataset.k as keyof Logo;
      row.querySelectorAll<HTMLElement>('button').forEach((b) => {
        const on = String(logo[k]) === b.dataset.v;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
        const cv = b.querySelector('canvas');
        if (cv) paintLogo(cv, { ...logo, [k]: b.dataset.v } as Logo);
      });
    });
  };
  update();
  root.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    const k = (b?.parentElement as HTMLElement | null)?.dataset.k as keyof Logo | undefined;
    if (!b || !k) return;
    (logo as unknown as Record<string, string>)[k] = b.dataset.v!;
    update();
    onChange(logo);
  };
  // the caller repaints every picture (option thumbnails included) when the name, and so the initials, change
  return update;
}

/** What a place costs you and pays you, as the few figures that differ from an ordinary course. */
function practical(id: RegionId): string {
  const r = REGIONS[id];
  const items: [string, number][] = [
    ['Building', r.buildMult - 1],
    ['Green fees', r.fairMult - 1],
    ['Upkeep', r.upkeep - 1],
    ['Wind', r.wind - 1],
    ['Spending', r.spend - 1],
  ];
  return items
    .filter(([, v]) => Math.abs(v) >= 0.03)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 2)
    .map(([k, v]) => `<span class="${v > 0 === (k === 'Green fees' || k === 'Spending') ? 'up' : 'down'}">${k} ${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%</span>`)
    .join('');
}

/** Pick a place from the course guide, found your club and begin. The map stays visible once play begins. */
export function startScreen(): Promise<NewGameOptions> {
  return new Promise(resolve => {
    const root = document.getElementById('start')!;
    root.hidden = false;
    let name = 'Willow Creek';
    let region: RegionId = 'parkland';
    const logo = defaultLogo();
    logo.initials = initialsOf(name);
    const finished = regionsDone();
    const rows = ORDER.map((id) => {
      const r = REGIONS[id];
      return `<button type="button" class="place ${id === region ? 'on' : ''}" role="radio" aria-checked="${id === region}" data-region="${id}">
        <span class="place-art">${REGION_ART[id]}</span>
        <span class="place-text"><span class="place-head"><b>${r.name}${finished.includes(id) ? ' <i class="place-done">18 holes ✓</i>' : ''}</b><span class="place-level"><span class="flags" aria-hidden="true">${levelFlags(r.level)}</span><em>${r.difficulty}</em></span></span>
        <span class="place-stats">${practical(id)}</span>
        <span class="place-blurb">${r.blurb}</span></span>
        <span class="place-mark" aria-hidden="true">${icon('check')}</span>
      </button>`;
    }).join('');
    root.innerHTML = `<div class="guide" data-step="club">
      <header class="guide-head">${BANNER_ART}
        <div class="wordmark">${flagMark('wm-flag')}<h1><span class="wm-a">Little Links</span><span class="wm-b"><i></i>A course of your own<i></i></span></h1></div>
      </header>
      <main class="guide-body">
        <section class="guide-places" aria-labelledby="gp">
          <div class="rule-head"><h2 id="gp">Choose your ground</h2><span>Build anywhere on the map</span></div>
          <div class="places" role="radiogroup" aria-label="Starting location">${rows}</div>
        </section>
        <section class="guide-club" aria-labelledby="gc">
          <div class="rule-head"><h2 id="gc">Found your club</h2><span>$${CFG.economy.startCash.toLocaleString('en-US')} to start</span></div>
          <div class="club-line">
            <button type="button" class="crest-btn" id="crestBtn" aria-label="Design the club crest" aria-expanded="false"><canvas id="crestCv" width="112" height="112"></canvas><span>Crest</span></button>
            <label class="club-name"><span>Club name</span><input id="newClubName" maxlength="28" value="Willow Creek" autocomplete="off" /></label>
          </div>
          <div class="rule-head crest-head"><h2>Choose your emblem</h2><span>You can change it later</span></div>
          <div id="logoBox" class="logo-box"></div>
        </section>
      </main>
      <footer class="guide-foot"><button class="btn primary step-next" id="stepNext">Next: choose your ground</button><button class="btn step-back" id="stepBack" aria-label="Back to your club">‹ Back</button><label class="check-line"><input type="checkbox" id="tutOn" checked /><span>Guide me through my first hole</span></label><button class="btn primary start-play" id="startBtn">Start course</button><p>Saves automatically on this device.</p></footer>
    </div>`;
    const crest = root.querySelector('#crestCv') as HTMLCanvasElement;
    // both pictures of the emblem (the small crest and the designer's big preview) follow the name as it is typed
    const repaint = () => {
      const shown = { ...logo, initials: initialsOf(name) };
      paintLogo(crest, shown);
      const big = root.querySelector('#lgPrev') as HTMLCanvasElement | null;
      if (big) paintLogo(big, shown);
    };
    const lg = root.querySelector('#logoBox') as HTMLElement;
    const redrawDesigner = logoDesigner(lg, logo, () => name, repaint);
    repaint();
    const crestBtn = root.querySelector('#crestBtn') as HTMLElement;
    // Two steps: the club first (its name and emblem), then the ground. On the second step the crest in the corner goes back to the first.
    const guide = root.querySelector('.guide') as HTMLElement;
    const step = (to: 'club' | 'ground') => { guide.dataset.step = to; root.querySelectorAll<HTMLElement>('.guide-places, .guide-club').forEach((el) => (el.scrollTop = 0)); (root.querySelector('.guide-body') as HTMLElement).scrollTop = 0; };
    (root.querySelector('#stepNext') as HTMLElement).onclick = () => step('ground');
    (root.querySelector('#stepBack') as HTMLElement).onclick = () => step('club');
    crestBtn.onclick = () => step('club');
    const input = root.querySelector('#newClubName') as HTMLInputElement;
    input.oninput = () => { name = input.value; logo.initials = initialsOf(name); redrawDesigner(); repaint(); };
    const cards = Array.from(root.querySelectorAll<HTMLElement>('.place'));
    cards.forEach((c) => (c.onclick = () => {
      region = c.dataset.region as RegionId;
      cards.forEach((o) => { const on = o === c; o.classList.toggle('on', on); o.setAttribute('aria-checked', String(on)); });
    }));
    (root.querySelector('#startBtn') as HTMLElement).onclick = () => {
      root.hidden = true;
      resolve({ region, name: name.trim() || 'Willow Creek', logo: { ...logo, initials: initialsOf(name) }, tutorial: (root.querySelector('#tutOn') as HTMLInputElement | null)?.checked !== false });
    };
  });
}
