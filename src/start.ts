
import { LOGO_COLORS, LOGO_ICONS, LOGO_SHAPES, Logo, defaultLogo, drawLogo, initialsOf } from './logo';
import type { NewGameOptions } from './game';
import { REGIONS, REGION_IDS, RegionId } from './progression';
import { BANNER_ART, REGION_ART, levelFlags } from './start-art';
import { flagMark, icon } from './icons';

/** Easiest first, so the choice reads as a ladder. */
const ORDER = [...REGION_IDS].sort((a, b) => REGIONS[a].level - REGIONS[b].level);

export function paintLogo(canvas: HTMLCanvasElement, logo: Logo) {
  const s = canvas.width;
  const c = canvas.getContext('2d')!;
  c.clearRect(0, 0, s, s);
  drawLogo(c, s / 2, s / 2, s * 0.94, logo);
}

/** Shape, icon and colour pickers with a live preview. Calls onChange after every tweak. */
export function logoDesigner(root: HTMLElement, logo: Logo, getName: () => string, onChange: (l: Logo) => void) {
  const render = () => {
    root.innerHTML = `
      <div class="logo-prev"><canvas width="140" height="140" id="lgPrev"></canvas></div>
      <div class="logo-opts">
        <div class="lbl">Shape</div><div class="opts" data-k="shape">${LOGO_SHAPES.map((s) => `<button class="opt ${logo.shape === s ? 'on' : ''}" data-v="${s}">${s}</button>`).join('')}</div>
        <div class="lbl">Emblem</div><div class="opts" data-k="icon">${LOGO_ICONS.map((s) => `<button class="opt ${logo.icon === s ? 'on' : ''}" data-v="${s}">${s}</button>`).join('')}</div>
        <div class="lbl">Main colour</div><div class="opts" data-k="primary">${LOGO_COLORS.map((c) => `<button class="sw ${logo.primary === c ? 'on' : ''}" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
        <div class="lbl">Accent colour</div><div class="opts" data-k="secondary">${LOGO_COLORS.map((c) => `<button class="sw ${logo.secondary === c ? 'on' : ''}" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
      </div>`;
    paintLogo(root.querySelector('#lgPrev') as HTMLCanvasElement, logo);
  };
  render();
  root.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
    const k = (b?.parentElement as HTMLElement | null)?.dataset.k as keyof Logo | undefined;
    if (!b || !k) return;
    (logo as unknown as Record<string, string>)[k] = b.dataset.v!;
    logo.initials = initialsOf(getName());
    render();
    onChange(logo);
  };
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
export function startScreen(practiced = false): Promise<NewGameOptions> {
  return new Promise(resolve => {
    const root = document.getElementById('start')!;
    root.hidden = false;
    let name = 'Willow Creek';
    let region: RegionId = 'parkland';
    const logo = defaultLogo();
    const rows = ORDER.map((id) => {
      const r = REGIONS[id];
      return `<button type="button" class="place ${id === region ? 'on' : ''}" role="radio" aria-checked="${id === region}" data-region="${id}">
        <span class="place-art">${REGION_ART[id]}</span>
        <span class="place-text"><span class="place-head"><b>${r.name}</b><span class="place-level"><span class="flags" aria-hidden="true">${levelFlags(r.level)}</span><em>${r.difficulty}</em></span></span>
        <span class="place-stats">${practical(id)}</span>
        <span class="place-blurb">${r.blurb}</span></span>
        <span class="place-mark" aria-hidden="true">${icon('check')}</span>
      </button>`;
    }).join('');
    root.innerHTML = `<div class="guide">
      <header class="guide-head">${BANNER_ART}
        <div class="wordmark">${flagMark('wm-flag')}<h1><span class="wm-a">Little Links</span><span class="wm-b"><i></i>A course of your own<i></i></span></h1></div>
      </header>
      <main class="guide-body">
        <section class="guide-places" aria-labelledby="gp">
          <div class="rule-head"><h2 id="gp">Choose your ground</h2><span>Build anywhere on the map</span></div>
          <div class="places" role="radiogroup" aria-label="Starting location">${rows}</div>
        </section>
        <section class="guide-club" aria-labelledby="gc">
          <div class="rule-head"><h2 id="gc">Found your club</h2><span>$25,000 to start</span></div>
          <div class="club-line">
            <button type="button" class="crest-btn" id="crestBtn" aria-label="Design the club crest" aria-expanded="false"><canvas id="crestCv" width="112" height="112"></canvas><span>Crest</span></button>
            <label class="club-name"><span>Club name</span><input id="newClubName" maxlength="28" value="Willow Creek" autocomplete="off" /></label>
          </div>
          <div id="logoBox" class="logo-box" hidden></div>
          ${practiced ? '<p class="practiced">Practice done. Pick where to build your own course.</p>' : '<label class="check-line"><input type="checkbox" id="tutOn" checked /><span>Start with a short practice course</span></label>'}
        </section>
      </main>
      <footer class="guide-foot"><button class="btn primary start-play" id="startBtn">Start course</button><p>Saves automatically on this device.</p></footer>
    </div>`;
    const crest = root.querySelector('#crestCv') as HTMLCanvasElement;
    const repaint = () => paintLogo(crest, { ...logo, initials: initialsOf(name) });
    const lg = root.querySelector('#logoBox') as HTMLElement;
    logoDesigner(lg, logo, () => name, repaint);
    repaint();
    const crestBtn = root.querySelector('#crestBtn') as HTMLElement;
    crestBtn.onclick = () => { lg.hidden = !lg.hidden; crestBtn.setAttribute('aria-expanded', String(!lg.hidden)); if (!lg.hidden) lg.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
    const input = root.querySelector('#newClubName') as HTMLInputElement;
    input.oninput = () => { name = input.value; logo.initials = initialsOf(name); repaint(); };
    const cards = Array.from(root.querySelectorAll<HTMLElement>('.place'));
    cards.forEach((c) => (c.onclick = () => {
      region = c.dataset.region as RegionId;
      cards.forEach((o) => { const on = o === c; o.classList.toggle('on', on); o.setAttribute('aria-checked', String(on)); });
    }));
    (root.querySelector('#startBtn') as HTMLElement).onclick = () => {
      root.hidden = true;
      resolve({ region, name: name.trim() || 'Willow Creek', logo: { ...logo, initials: initialsOf(name) }, tutorial: false, practice: !practiced && !!(root.querySelector('#tutOn') as HTMLInputElement | null)?.checked });
    };
  });
}
