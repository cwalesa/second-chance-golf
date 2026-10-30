import { REGIONS, REGION_IDS, RegionId } from './progression';
import { LOGO_COLORS, LOGO_ICONS, LOGO_SHAPES, Logo, defaultLogo, drawLogo, initialsOf } from './logo';
import type { NewGameOptions } from './game';

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

/** The new-game screen: choose a region, name the club, design a logo. */
export function startScreen(): Promise<NewGameOptions> {
  return new Promise((resolve) => {
    const root = document.getElementById('start')!;
    root.hidden = false;
    let region: RegionId = 'parkland';
    let name = 'Second Chance Golf';
    const logo = defaultLogo();
    const swatch = (id: RegionId) => {
      const p = REGIONS[id].palette;
      return [p.roughGood, p.fairGood, p.sand, p.water].map((c) => `<i style="background:rgb(${c.join(',')})"></i>`).join('');
    };
    root.innerHTML = `
      <div class="start-card">
        <h1>Second Chance Golf</h1>
        <p class="sub">You bought a worn-out public course. Restore it, grow it, and make it famous.</p>
        <h2>1. Choose your region</h2>
        <div class="regions" id="regions">${REGION_IDS.map((id) => {
          const r = REGIONS[id];
          return `<button class="region ${id === region ? 'on' : ''}" data-id="${id}"><span class="sw4">${swatch(id)}</span><b>${r.name}</b><em>${r.tagline}</em><ul>${r.perks.map((p) => `<li>${p}</li>`).join('')}</ul></button>`;
        }).join('')}</div>
        <h2>2. Name your club</h2>
        <input id="clubName" maxlength="28" value="${name}" aria-label="Club name" />
        <h2>3. Design your logo</h2>
        <div id="logoBox" class="logo-box"></div>
        <button class="btn primary big" id="startBtn">Open the gates</button>
      </div>`;
    const lg = root.querySelector('#logoBox') as HTMLElement;
    logoDesigner(lg, logo, () => name, () => {});
    root.querySelector('#regions')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('.region') as HTMLElement | null;
      if (!b) return;
      region = b.dataset.id as RegionId;
      root.querySelectorAll('.region').forEach((x) => x.classList.toggle('on', x === b));
    });
    const input = root.querySelector('#clubName') as HTMLInputElement;
    input.addEventListener('input', () => {
      name = input.value;
      logo.initials = initialsOf(name);
      logoDesigner(lg, logo, () => name, () => {});
    });
    logo.initials = initialsOf(name);
    logoDesigner(lg, logo, () => name, () => {});
    (root.querySelector('#startBtn') as HTMLElement).onclick = () => {
      root.hidden = true;
      resolve({ region, name: name.trim() || 'Second Chance Golf', logo: { ...logo, initials: initialsOf(name) } });
    };
  });
}
