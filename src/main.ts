import { FeedbackPlayer } from './feedback';
import { Studio } from './studio';
import './style.css';
import { CFG } from './config';
import { Game } from './game';
import { Renderer } from './render';
import { Editor } from './input';
import { UI } from './ui';
import { clearSave, loadGame, saveGame, serialize, importSave } from './save';
import { startScreen } from './start';

async function boot() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const loaded = loadGame();
  let game: Game;
  let away: { days: number; net: number } | null = null;
  if (loaded) {
    game = loaded.game;
    away = game.applyAway((Date.now() - loaded.savedAt) / 1000);
  } else {
    const opts = await startScreen();
    game = new Game(undefined, Math.floor(Math.random() * 1e9), opts);
  }
  game.applyRegion();
  game.openProperty();

  const renderer = new Renderer(canvas);
  renderer.resize();
  const editor = new Editor(canvas, game, renderer);
  const ui = new UI(game, editor);
  new FeedbackPlayer(game);
  const studio = new Studio(game, editor, renderer, ui);
  let resetting = false;
  const persist = () => {
    if (resetting) return;
    if (saveGame(game)) ui.markSaved();
  };
  ui.onReset = () => {
    resetting = true;
    clearSave();
    location.reload();
  };
  ui.onSaveNow = persist;
  ui.onExport = () => {
    persist();
    const blob = new Blob([serialize(game)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'Second-Chance-Golf-Save.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ui.toast('Save backup exported.', 'good');
  };
  ui.onImport = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      if (file.size > 3000000) { ui.toast('That file is too large for a game save.', 'bad'); return; }
      const text = await file.text();
      if (!confirm('Replace this device’s current course with the selected backup?')) return;
      if (importSave(text)) { resetting = true; location.reload(); }
      else ui.toast('That file is not a compatible game save.', 'bad');
    };
    input.click();
  };
  const place = () => {
    renderer.resize();
    renderer.insets = ui.insets();
    renderer.clampCam(game.world);
  };
  ui.onInsets = place;
  window.addEventListener('resize', place);
  window.addEventListener('orientationchange', () => setTimeout(place, 200));
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) persist();
  });
  window.setInterval(persist, 6000);

  ui.refresh(true);
  renderer.resize();
  renderer.insets = ui.insets();
  renderer.focus(ui.mobile ? 11 : 21, ui.mobile ? 40 : 35, ui.mobile ? .58 : .7, game.world);

  if (loaded?.recovered) ui.toast('Your previous save was recovered from the automatic backup.', 'info');
  if (away) {
    ui.toast(`While you were away (${away.days} day${away.days === 1 ? '' : 's'}) your course earned ${away.net >= 0 ? '+' : ''}$${Math.round(away.net).toLocaleString('en-US')}.`, away.net >= 0 ? 'good' : 'bad');
  } else if (loaded) game.notify('info', `Welcome back. Day ${game.day}, ${game.clockText}.`);

  const STEP = CFG.sim.dt;
  let last = performance.now();
  let acc = 0;
  let uiClock = 0;
  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    studio.update(dt);
    const speed = game.owner.active || game.pendingRecap || ui.modalOpen || ui.introOpen || document.hidden ? 0 : game.settings.speed;
    acc += dt * speed;
    let steps = 0;
    while (acc >= STEP && steps < CFG.sim.maxStepsPerFrame) {
      game.step(STEP);
      if (game.pendingRecap) { acc = 0; break; }
      acc -= STEP;
      steps++;
    }
    if (steps >= CFG.sim.maxStepsPerFrame) acc = 0;
    // render between the last two simulation steps so motion is smooth at any refresh rate
    renderer.render(game, editor.overlay, now / 1000, speed === 0 ? 1 : Math.min(1, acc / STEP));
    uiClock += dt;
    if (uiClock > 0.12) {
      uiClock = 0;
      ui.refresh();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  (window as unknown as { scg: unknown }).scg = { game, renderer, editor, ui };

  if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
boot();
