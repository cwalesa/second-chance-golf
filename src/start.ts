
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

/** Campaign-first onboarding; the map stays visible once play begins. */
export function startScreen(): Promise<NewGameOptions> {
  return new Promise(resolve => {
    const root = document.getElementById('start')!;
    root.hidden = false;
    let name = 'Willow Creek';
    const logo = defaultLogo();
    root.innerHTML = `<div class="start-card premium-start">
      <div class="start-art" aria-hidden="true"><svg viewBox="0 0 800 340" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#b5ccc1"/><stop offset="1" stop-color="#e9dfb8"/></linearGradient><linearGradient id="grass" x2="0" y2="1"><stop stop-color="#8ba568"/><stop offset="1" stop-color="#29543d"/></linearGradient></defs><path fill="url(#sky)" d="M0 0h800v340H0z"/><circle fill="#fff1c5" cx="630" cy="70" r="36"/><path fill="#668473" d="M0 180Q140 70 260 160T520 145T800 120V340H0z"/><path fill="url(#grass)" d="M0 220Q180 120 400 210T800 165V340H0z"/><path fill="#bed092" d="M200 340Q270 260 390 260T510 205Q570 178 625 210Q660 240 555 255T415 308L400 340z"/><path fill="#d6dba6" d="M470 225Q500 205 548 212Q580 230 545 239T470 225"/><path fill="#e9d8ad" d="M433 234q-32-14-47 4t25 21q40-4 22-25M575 221q20-10 30 3t-19 15q-23-3-11-18"/><path fill="#6b9b9c" d="M0 295Q110 250 175 285T235 340H0z"/><g fill="#204734"><path d="M98 144l-40 114h80zM150 165l-35 100h70zM690 140l-40 110h80zM745 165l-31 95h62z"/><path d="M80 240h12v70H80zM687 230h12v55h-12z"/></g><path stroke="#f5e9ce" stroke-width="3" d="M520 220v-60"/><path fill="#c75f43" d="M521 160l32 10-32 13z"/><ellipse fill="#12382b" cx="520" cy="222" rx="6" ry="2"/></svg><span class="edition">THE RESTORATION COLLECTION</span></div>
      <div class="start-content"><div class="eyebrow">BUILD SOMETHING WORTH PLAYING.</div><h1>Second Chance<br><em>Golf</em></h1><p class="sub">Five forgotten courses. A fresh start.<br>Design the holes. Win over the golfers. Make each course your own.</p>
      <div class="start-route"><span>01 <b>Willow Creek</b></span><span>02 Dunes & Tide</span><span>03 Pine Ridge</span><span>04 Prairie Run</span><span>05 The Oasis</span></div>
      <label class="eyebrow" for="newClubName">NAME YOUR FIRST CLUB</label><input id="newClubName" maxlength="28" value="Willow Creek" aria-label="Club name" />
      <details class="identity"><summary>Customize your club crest</summary><div id="logoBox" class="logo-box"></div></details>
      <button class="btn primary start-play" id="startBtn">Begin your first restoration <span>→</span></button><p class="start-foot">Your course saves on this device. No timers to buy past. Just golf.</p></div></div>`;
    const lg = root.querySelector('#logoBox') as HTMLElement;
    logoDesigner(lg, logo, () => name, () => {});
    const input = root.querySelector('#newClubName') as HTMLInputElement;
    input.oninput = () => { name = input.value; logo.initials = initialsOf(name); };
    (root.querySelector('#startBtn') as HTMLElement).onclick = () => {
      root.hidden = true;
      resolve({ region: 'parkland', name: name.trim() || 'Willow Creek', logo: { ...logo, initials: initialsOf(name) } });
    };
  });
}
