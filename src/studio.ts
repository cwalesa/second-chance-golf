import { Game } from './game';
import { Editor } from './input';
import { Renderer } from './render';
import { UI } from './ui';
import { CLUBS, ClubId } from './owner';
import { escapeHtml } from './panels';

/** Persistent map controls and a practice HUD that stays above mobile sheets. */
export class Studio {
  private controls = document.createElement('div');
  private hud = document.createElement('div');
  private mini = document.createElement('canvas');
  private cache = '';
  private miniTime = 0;
  private layoutKey = ''; 
  constructor(private g: Game, private editor: Editor, private r: Renderer, private ui: UI) {
    this.controls.id = 'map-controls'; this.hud.id = 'owner-hud'; this.mini.id = 'minimap';
    this.mini.width = 192; this.mini.height = 128;
    document.getElementById('app')!.append(this.controls, this.hud, this.mini);
    this.controls.innerHTML = `<button data-camera="design" title="Pause time to design">Design mode</button><button data-camera="projects" title="Plan your next improvement">Projects</button><button data-camera="fit" title="See your property">Overview</button><button data-camera="home" title="Find selected hole">◎</button><button data-camera="in" aria-label="Zoom in">+</button><button data-camera="out" aria-label="Zoom out">−</button>`;
    this.controls.onclick = e => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-camera]')?.dataset.camera;
      if (action === 'projects') { this.ui.tab = 'journey'; this.ui.journalView = 'projects'; this.ui.refresh(true); this.ui.onInsets(); }
      else if (action === 'design') { this.g.toggleDesignMode(); this.editor.setTool('inspect'); }
      else if (action === 'fit') { this.g.followGolfer = 0; this.r.fit(this.g.world); }
      else if (action === 'home') { this.g.followGolfer = 0; this.editor.focusHole(); }
      else if (action) this.r.zoomAt(this.r.cw / 2, this.r.ch / 2, action === 'in' ? 1.3 : 1 / 1.3, this.g.world);
      this.update(0);
    };
    this.mini.onclick = e => {
      const b = this.mini.getBoundingClientRect(); this.g.followGolfer = 0;
      this.r.focus((e.clientX - b.left) / b.width * this.g.world.w, (e.clientY - b.top) / b.height * this.g.world.h, this.r.cam.zoom, this.g.world);
    };
    this.hud.onclick = e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!b) return;
      if (b.dataset.club) { this.g.owner.club = b.dataset.club as ClubId; this.g.owner.swing.cancel(); }
      if (b.dataset.owner === 'hit') { const o = this.g.owner; if (o.swing.active) o.hit(this.g, o.swing.strike()); else o.swing.start(); }
      if (b.dataset.owner === 'aim') { const h = this.g.hole(this.g.owner.holeId); this.g.owner.aim = { x: h.cup.x + .5, y: h.cup.y + .5 }; this.g.owner.swing.cancel(); }
      if (b.dataset.owner === 'next') { this.g.owner.next(this.g); if (!this.g.owner.active) this.g.setSpeed(1); this.editor.focusHole(); }
      if (b.dataset.owner === 'stop') { this.g.owner.stop(this.g); this.g.designMode = false; this.g.setSpeed(1); this.ui.refresh(true); }
      this.update(0);
    };
  }
  update(dt: number) {
    const g = this.g, o = g.owner;
    o.update(g, dt);
    if (g.followGolfer) {
      const golfer = g.sim.golfers.find(x => x.id === g.followGolfer);
      if (golfer) this.r.focus(golfer.x, golfer.y, this.r.cam.zoom, g.world);
      else g.followGolfer = 0;
    }
    document.body.classList.toggle('owner-playing', o.active);
    document.body.classList.toggle('designing', g.designMode);
    this.controls.querySelector('[data-camera="design"]')!.textContent = g.designMode ? '✓ Designing · paused' : 'Design mode';
    this.hud.hidden = !o.active;
    if (o.active) {
      const hole = g.hole(o.holeId), diff = o.scores.reduce((s, x) => s + x.strokes - x.par, 0);
      const html = `<div class="owner-top"><div><span class="eyebrow">OWNER’S ROUND · PRACTICE</span><h3>Hole ${hole.id} · ${escapeHtml(hole.name)}</h3></div><button class="btn" data-owner="stop">Finish</button></div><div class="owner-stats"><span>Par <b>${hole.par}</b></span><span>Strokes <b>${o.strokes}</b></span><span>Total <b>${diff > 0 ? '+' : ''}${diff || 'E'}</b></span><span>Target <b>${Math.round(o.distance * 10)} yd</b></span></div><div class="owner-clubs">${(Object.keys(CLUBS) as ClubId[]).map(id => `<button class="${id === o.club ? 'on' : ''}" data-club="${id}">${CLUBS[id].name}<small>${Math.round((id === o.club ? o.reach(g) : CLUBS[id].reach) * 10)} yd</small></button>`).join('')}</div><div class="swing-panel ${o.swing.active ? 'is-swinging' : ''}"><div class="swing-label"><span>${o.swing.active ? 'TIME YOUR STRIKE' : 'SWING TIMING'}</span><b id="swingQuality">${o.lastStrike || 'Aim · swing · strike'}</b></div><div class="swing-rail"><i class="swing-center"></i><i id="swingNeedle"></i></div><small>${o.swing.active ? 'Tap Strike when the marker crosses the center.' : 'Start the swing, then strike through the center for clean contact.'}</small></div><p>${o.message}</p><div class="btnrow"><button class="btn" data-owner="aim">Aim at pin</button>${o.completed ? `<button class="btn primary" data-owner="next">${o.route.length ? 'Next hole →' : 'Save scorecard'}</button>` : `<button class="btn primary" data-owner="hit" ${o.flight ? 'disabled' : ''}>${o.swing.active ? 'Strike →' : 'Start swing →'}</button>`}</div>${o.scores.length ? `<div class="owner-scorecard">${o.scores.map(x => `<span>${x.hole}<b>${x.strokes}</b><small>par ${x.par}</small></span>`).join('')}</div>` : ''}`;
      if (html !== this.cache) { this.hud.innerHTML = html; this.cache = html; }
      const needle = this.hud.querySelector<HTMLElement>('#swingNeedle');
      if (needle) needle.style.left = `${o.swing.active ? (o.swing.offset + 1) * 50 : 50}%`;
      const quality = this.hud.querySelector<HTMLElement>('#swingQuality');
      if (quality && o.swing.active) quality.textContent = o.swing.quality > .88 ? 'Perfect window' : o.swing.quality > .6 ? 'Good contact' : 'Find the center';
    }
    const layoutKey = `${o.active}:${o.holeId}:${this.r.cw}:${this.r.ch}:${this.hud.offsetHeight}`;
    if (layoutKey !== this.layoutKey) {
      const wasPlaying = this.layoutKey.startsWith('true'); this.layoutKey = layoutKey;
      if (o.active) {
        const box = this.hud.getBoundingClientRect();
        this.r.insets = this.ui.landscape
          ? { l: this.ui.insets().l, r: this.r.cw - box.left + 10, t: document.getElementById('top')!.getBoundingClientRect().bottom + 12, b: 12 }
          : { l: 0, r: 0, t: document.getElementById('top')!.getBoundingClientRect().bottom + 12, b: this.r.ch - box.top + 12 };
        this.editor.focusHole();
      } else if (wasPlaying) { this.ui.refresh(true); this.r.insets = this.ui.insets(); this.editor.focusHole(); }
    }
    this.miniTime += dt;
    if (this.miniTime > .5 || dt === 0) { this.miniTime = 0; this.drawMini(); }
  }
  private drawMini() {
    const c = this.mini.getContext('2d')!, w = this.g.world, sx = 192 / w.w, sy = 128 / w.h;
    const palette = ['#5e7850', '#9bb568', '#c2d68d', '#c5cd84', '#e8d6a2', '#5f9ca7', '#c1b595', '#ede1c9'];
    for (let i = 0; i < w.terrain.length; i++) {
      c.fillStyle = w.tree[i] ? '#2b503d' : palette[w.terrain[i]];
      c.fillRect(i % w.w * sx, Math.floor(i / w.w) * sy, sx + .2, sy + .2);
    }
    for (const h of w.holes) {
      c.fillStyle = h.open ? '#fff5d4' : '#f0a16b'; c.beginPath(); c.arc((h.cup.x + .5) * sx, (h.cup.y + .5) * sy, 2.5, 0, Math.PI * 2); c.fill();
    }
    for (const x of this.g.sim.golfers) { c.fillStyle = '#f8e3b0'; c.fillRect(x.x * sx, x.y * sy, 2, 2); }
    const corners = [[0,0],[this.r.cw,0],[this.r.cw,this.r.ch],[0,this.r.ch]].map(([x,y])=>this.r.toWorld(x,y));
    c.strokeStyle='#ffffffb0';c.lineWidth=1;c.beginPath();corners.forEach((p,i)=>i?c.lineTo(p.x*sx,p.y*sy):c.moveTo(p.x*sx,p.y*sy));c.closePath();c.stroke();
    c.fillStyle = '#11291dd9'; c.fillRect(0, 112, 192, 16); c.fillStyle = '#f4e9ce'; c.font = '9px sans-serif';
    c.fillText(`${this.g.openHoles.length} HOLES OPEN  ·  DESIGN ${this.g.designRating}`, 8, 123);
  }
}
